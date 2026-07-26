import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import {
  buildFixture, teardown, seedAccounts, seedUnit, seedProduct, receiveStock,
  CTX, approverCtx,
} from './helpers.mjs';
import { quality } from '../../platform/quality/index.mjs';
import { orders } from '../../platform/manufacturing/index.mjs';

let fx;
let accounts;
let unit;
let warehouse;
let supplier;
let finished;
let component;
let plan;
let criticalPointId;
let visualPointId;

before(async () => {
  fx = await buildFixture('quality');
  accounts = seedAccounts(fx.db);
  unit = seedUnit(fx.db);
  warehouse = fx.execute('warehouse:create', { name: 'Main', code: 'MAIN' }, 'wh');
  supplier = fx.execute('stock:location:create', { name: 'Supplier', usage: 'supplier' }, 'sup');
  fx.execute('manufacturing:account_mapping:set', {
    wip_account_id: accounts.wip,
    labor_absorption_account_id: accounts.laborAbsorption,
    overhead_absorption_account_id: accounts.overheadAbsorption,
    scrap_account_id: accounts.scrap,
    variance_account_id: accounts.variance,
  }, 'mapping');

  component = seedProduct(fx.db, fx.execute, accounts, {
    name: 'Blank', sku: 'RM-BLANK', unitId: unit.id, categoryName: 'Raw blanks',
  });
  finished = seedProduct(fx.db, fx.execute, accounts, {
    name: 'Machined Part', sku: 'FG-PART', unitId: unit.id, categoryName: 'Finished parts',
    stockAccountId: accounts.finishedGoods,
  });
  receiveStock(fx.execute, {
    warehouse, supplierLocation: supplier, productId: component.variantId,
    unitId: unit.id, quantity: 500, unitCost: 6, key: 'blanks',
  });
  const bom = fx.execute('manufacturing:bom:create', {
    product_id: finished.variantId, quantity: 1, code: 'BOM-PART',
    lines: [{ product_id: component.variantId, quantity: 2 }],
  }, 'bom');
  fx.execute('manufacturing:bom:approve', { bom_id: bom.id }, 'bom-approve');

  plan = fx.execute('quality:plan:create', {
    name: 'Final dimensional check',
    code: 'QP-DIM',
    trigger_event: 'production_completion',
    is_mandatory: true,
    points: [
      { characteristic: 'Length (mm)', measurement_type: 'numeric', min_value: 99.5, max_value: 100.5, is_critical: 1 },
      { characteristic: 'Surface finish', measurement_type: 'text', expected_text: 'smooth' },
    ],
  }, 'qp');
  criticalPointId = plan.points[0].id;
  visualPointId = plan.points[1].id;
});

after(() => teardown(fx));

function releasedOrder(quantity, key) {
  const order = fx.execute('manufacturing:order:create', {
    product_id: finished.variantId, planned_quantity: quantity, warehouse_id: warehouse.id,
  }, `mo-${key}`);
  fx.execute('manufacturing:order:approve', { order_id: order.id }, `mo-${key}-approve`);
  fx.execute('manufacturing:order:release', { order_id: order.id }, `mo-${key}-release`);
  fx.execute('manufacturing:material:issue', {
    order_id: order.id, product_id: component.variantId, quantity: quantity * 2,
  }, `mo-${key}-issue`);
  return order;
}

test('a plan point with min above max is rejected at creation', () => {
  assert.throws(
    () => fx.execute('quality:plan:create', {
      name: 'Impossible', code: 'QP-BAD', trigger_event: 'receipt',
      points: [{ characteristic: 'Weight', min_value: 10, max_value: 5 }],
    }, 'qp-bad'),
    /min_value cannot exceed max_value/,
  );
});

test('pass/fail is derived from the specification, not asserted by the inspector', () => {
  const order = releasedOrder(2, 'derive');
  const inspection = fx.execute('quality:inspection:create', {
    plan_id: plan.id, subject_type: 'production_order', subject_id: order.id,
  }, 'qi-derive');

  const recorded = fx.execute('quality:inspection:record', {
    inspection_id: inspection.id,
    measurements: [
      { plan_point_id: criticalPointId, numeric_value: 103 },
      { plan_point_id: visualPointId, text_value: 'smooth' },
    ],
  }, 'qi-derive-record');

  const critical = recorded.measurements.find((row) => row.plan_point_id === criticalPointId);
  const visual = recorded.measurements.find((row) => row.plan_point_id === visualPointId);
  assert.equal(critical.passed, 0, '103 is outside 99.5–100.5');
  assert.equal(visual.passed, 1);
});

test('an inspection cannot pass with an out-of-specification measurement', () => {
  const order = releasedOrder(2, 'cannotpass');
  const inspection = fx.execute('quality:inspection:create', {
    plan_id: plan.id, subject_id: order.id,
  }, 'qi-cannotpass');
  fx.execute('quality:inspection:record', {
    inspection_id: inspection.id,
    measurements: [
      { plan_point_id: criticalPointId, numeric_value: 200 },
      { plan_point_id: visualPointId, text_value: 'smooth' },
    ],
  }, 'qi-cannotpass-record');
  assert.throws(
    () => fx.execute('quality:inspection:decide', { inspection_id: inspection.id, decision: 'pass' }, 'qi-cannotpass-decide'),
    /out of specification/,
  );
});

test('an inspection cannot pass on incomplete evidence', () => {
  const order = releasedOrder(2, 'incomplete');
  const inspection = fx.execute('quality:inspection:create', { plan_id: plan.id, subject_id: order.id }, 'qi-incomplete');
  fx.execute('quality:inspection:record', {
    inspection_id: inspection.id,
    measurements: [{ plan_point_id: criticalPointId, numeric_value: 100 }],
  }, 'qi-incomplete-record');
  assert.throws(
    () => fx.execute('quality:inspection:decide', { inspection_id: inspection.id, decision: 'pass' }, 'qi-incomplete-decide'),
    /have no measurement/,
  );
});

test('a pending mandatory inspection blocks manufacturing completion', () => {
  const order = releasedOrder(3, 'block');
  fx.execute('quality:inspection:create', { plan_id: plan.id, subject_id: order.id }, 'qi-block');
  assert.throws(
    () => fx.execute('manufacturing:order:complete', { order_id: order.id, quantity: 3 }, 'mo-block-complete'),
    /must pass \(or carry an approved deviation\) before completion/,
  );
});

test('a passed inspection releases the completion', () => {
  const order = releasedOrder(3, 'release');
  const inspection = fx.execute('quality:inspection:create', { plan_id: plan.id, subject_id: order.id }, 'qi-release');
  fx.execute('quality:inspection:record', {
    inspection_id: inspection.id,
    measurements: [
      { plan_point_id: criticalPointId, numeric_value: 100.1 },
      { plan_point_id: visualPointId, text_value: 'Smooth' },
    ],
  }, 'qi-release-record');
  const decided = fx.execute('quality:inspection:decide', { inspection_id: inspection.id, decision: 'pass' }, 'qi-release-decide');
  assert.equal(decided.state, 'passed');

  const completed = fx.execute('manufacturing:order:complete', { order_id: order.id, quantity: 3 }, 'mo-release-complete');
  assert.equal(completed.state, 'completed');
});

test('a failed inspection opens a nonconformance with a canonical rework Work Item', () => {
  const order = releasedOrder(2, 'fail');
  const inspection = fx.execute('quality:inspection:create', { plan_id: plan.id, subject_id: order.id }, 'qi-fail');
  fx.execute('quality:inspection:record', {
    inspection_id: inspection.id,
    measurements: [
      { plan_point_id: criticalPointId, numeric_value: 90 },
      { plan_point_id: visualPointId, text_value: 'rough' },
    ],
  }, 'qi-fail-record');
  const decided = fx.execute('quality:inspection:decide', { inspection_id: inspection.id, decision: 'fail' }, 'qi-fail-decide');

  assert.equal(decided.state, 'failed');
  assert.ok(decided.nonconformance, 'a failure must open a nonconformance');
  assert.equal(decided.nonconformance.severity, 'critical', 'a failed critical characteristic is critical');
  assert.ok(decided.nonconformance.work_item_id, 'corrective action must be a canonical Work Item');

  const item = fx.db.prepare('SELECT * FROM work_items WHERE id = ?').get(decided.nonconformance.work_item_id);
  assert.equal(item.source_type, 'quality_nonconformance');
  assert.equal(item.qc_ref, decided.nonconformance.id);
  assert.equal(item.priority, 'urgent');

  // The failure still blocks completion.
  assert.throws(
    () => fx.execute('manufacturing:order:complete', { order_id: order.id, quantity: 2 }, 'mo-fail-complete'),
    /QUALITY_HOLD_ACTIVE|must pass/,
  );
});

test('a deviation must be approved by someone other than the person who failed it', () => {
  const order = releasedOrder(2, 'deviation');
  const inspection = fx.execute('quality:inspection:create', { plan_id: plan.id, subject_id: order.id }, 'qi-dev');
  fx.execute('quality:inspection:record', {
    inspection_id: inspection.id,
    measurements: [
      { plan_point_id: criticalPointId, numeric_value: 101 },
      { plan_point_id: visualPointId, text_value: 'smooth' },
    ],
  }, 'qi-dev-record');
  fx.execute('quality:inspection:decide', { inspection_id: inspection.id, decision: 'fail' }, 'qi-dev-decide');

  assert.throws(
    () => fx.execute('quality:deviation:approve', {
      inspection_id: inspection.id, reason: 'within customer tolerance',
    }, 'qi-dev-self'),
    /cannot be approved by the person who recorded the failure/,
  );
  // The action registry rejects a missing reason before the handler is reached,
  // so the requirement is enforced at the contract boundary, not only in code.
  assert.throws(
    () => fx.executor.execute('quality:deviation:approve', {
      inspection_id: inspection.id, idempotency_key: 'qi-dev-noreason',
    }, approverCtx()),
    /input missing required field: reason/,
  );
  assert.throws(
    () => fx.executor.execute('quality:deviation:approve', {
      inspection_id: inspection.id, reason: '   ', idempotency_key: 'qi-dev-blankreason',
    }, approverCtx()),
    /requires a reason/,
  );

  const approved = fx.executor.execute('quality:deviation:approve', {
    inspection_id: inspection.id,
    reason: 'Customer accepted 101mm in writing (ref CR-8821)',
    idempotency_key: 'qi-dev-approve',
  }, approverCtx());
  assert.equal(approved.state, 'failed', 'the failure stays on record');
  assert.equal(approved.deviation_approved_by, 'phase05-approver');
  assert.match(approved.deviation_reason, /CR-8821/);

  // With the deviation on file the completion is allowed.
  const completed = fx.execute('manufacturing:order:complete', { order_id: order.id, quantity: 2 }, 'mo-dev-complete');
  assert.equal(completed.state, 'completed');
});

test('conditional approval is unavailable when a critical characteristic failed', () => {
  const order = releasedOrder(2, 'conditional');
  const inspection = fx.execute('quality:inspection:create', { plan_id: plan.id, subject_id: order.id }, 'qi-cond');
  fx.execute('quality:inspection:record', {
    inspection_id: inspection.id,
    measurements: [
      { plan_point_id: criticalPointId, numeric_value: 80 },
      { plan_point_id: visualPointId, text_value: 'smooth' },
    ],
  }, 'qi-cond-record');
  assert.throws(
    () => fx.execute('quality:inspection:decide', { inspection_id: inspection.id, decision: 'conditional' }, 'qi-cond-decide'),
    /critical characteristic failed/,
  );
});

test('a nonconformance cannot be resolved without a root cause and corrective action', () => {
  const ncr = fx.execute('quality:nonconformance:create', {
    title: 'Coating blistering', severity: 'high', create_work_item: false,
  }, 'ncr-1');
  assert.throws(
    () => fx.execute('quality:nonconformance:resolve', { nonconformance_id: ncr.id }, 'ncr-1-resolve'),
    /root cause is required/,
  );
  assert.throws(
    () => fx.execute('quality:nonconformance:resolve', {
      nonconformance_id: ncr.id, root_cause: 'oven temperature drift',
    }, 'ncr-1-resolve-2'),
    /corrective action is required/,
  );
  const resolved = fx.execute('quality:nonconformance:resolve', {
    nonconformance_id: ncr.id,
    root_cause: 'oven temperature drift',
    corrective_action: 'recalibrate the oven controller',
    preventive_action: 'monthly calibration check added to the PM plan',
    disposition: 'rework',
  }, 'ncr-1-resolve-3');
  assert.equal(resolved.state, 'resolved');
  assert.equal(resolved.disposition, 'rework');
});

test('the quality gate helper answers the same question every domain asks', () => {
  const order = releasedOrder(1, 'gate');
  assert.deepEqual(
    quality.isBlockedByQuality(fx.db, CTX.companyId, 'production_order', order.id),
    { blocked: false },
  );
  const inspection = fx.execute('quality:inspection:create', { plan_id: plan.id, subject_id: order.id }, 'qi-gate');
  const blocked = quality.isBlockedByQuality(fx.db, CTX.companyId, 'production_order', order.id);
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.inspection_reference, inspection.reference);
});
