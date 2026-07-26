import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import {
  buildFixture, teardown, seedAccounts, seedUnit, seedProduct, CTX, approverCtx,
} from './helpers.mjs';
import { engineering } from '../../platform/manufacturing/index.mjs';

let fx;
let accounts;
let unit;
let finished;
let componentA;
let componentB;
let subAssembly;

before(async () => {
  fx = await buildFixture('engineering');
  accounts = seedAccounts(fx.db);
  unit = seedUnit(fx.db);
  finished = seedProduct(fx.db, fx.execute, accounts, { name: 'Cabinet', sku: 'FG-CAB', unitId: unit.id, categoryName: 'Finished cabinets' });
  subAssembly = seedProduct(fx.db, fx.execute, accounts, { name: 'Door Assembly', sku: 'SA-DOOR', unitId: unit.id, categoryName: 'Sub assemblies' });
  componentA = seedProduct(fx.db, fx.execute, accounts, { name: 'Steel Panel', sku: 'RM-PANEL', unitId: unit.id, categoryName: 'Raw panels' });
  componentB = seedProduct(fx.db, fx.execute, accounts, { name: 'Hinge', sku: 'RM-HINGE', unitId: unit.id, categoryName: 'Raw hinges' });
});

after(() => teardown(fx));

test('a BOM cannot be approved while it is empty', () => {
  const empty = fx.execute('manufacturing:bom:create', {
    product_id: finished.variantId, quantity: 1, code: 'BOM-EMPTY',
  }, 'bom-empty');
  assert.throws(
    () => fx.execute('manufacturing:bom:approve', { bom_id: empty.id }, 'bom-empty-approve'),
    /at least one line/,
  );
});

test('approving a revision supersedes its predecessor and keeps both versions', () => {
  const v1 = fx.execute('manufacturing:bom:create', {
    product_id: finished.variantId,
    quantity: 1,
    code: 'BOM-CAB',
    lines: [{ product_id: componentA.variantId, quantity: 2 }],
  }, 'bom-cab-v1');
  fx.execute('manufacturing:bom:approve', { bom_id: v1.id }, 'bom-cab-v1-approve');
  assert.equal(engineering.getBom(fx.db, v1.id, CTX.companyId).status, 'approved');

  const v2 = fx.execute('manufacturing:bom:revise', {
    bom_id: v1.id,
    lines: [
      { product_id: componentA.variantId, quantity: 3 },
      { product_id: componentB.variantId, quantity: 4 },
    ],
  }, 'bom-cab-v2');
  assert.equal(v2.version, 2);
  assert.equal(v2.status, 'draft');
  assert.equal(engineering.getBom(fx.db, v1.id, CTX.companyId).status, 'approved', 'v1 stays approved until v2 is approved');

  fx.execute('manufacturing:bom:approve', { bom_id: v2.id }, 'bom-cab-v2-approve');
  assert.equal(engineering.getBom(fx.db, v1.id, CTX.companyId).status, 'superseded');
  assert.equal(engineering.getBom(fx.db, v2.id, CTX.companyId).status, 'approved');

  const effective = engineering.resolveEffectiveBom(fx.db, {
    company_id: CTX.companyId, product_id: finished.variantId,
  });
  assert.equal(effective.id, v2.id, 'the effective BOM is the newest approved version');
});

test('an approved BOM refuses in-place line edits', () => {
  const approved = engineering.resolveEffectiveBom(fx.db, {
    company_id: CTX.companyId, product_id: finished.variantId,
  });
  assert.throws(
    () => fx.execute('manufacturing:bom:update_lines', {
      bom_id: approved.id,
      lines: [{ product_id: componentA.variantId, quantity: 99 }],
    }, 'bom-illegal-edit'),
    /does not allow this transition/,
  );
});

test('multi-level explosion applies scrap, yield and phantom substitution', () => {
  // Sub-assembly BOM: 1 door = 2 panels + 6 hinges, marked phantom.
  const subBom = fx.execute('manufacturing:bom:create', {
    product_id: subAssembly.variantId,
    quantity: 1,
    code: 'BOM-DOOR',
    bom_type: 'phantom',
    lines: [
      { product_id: componentA.variantId, quantity: 2 },
      { product_id: componentB.variantId, quantity: 6 },
    ],
  }, 'bom-door');
  fx.execute('manufacturing:bom:approve', { bom_id: subBom.id }, 'bom-door-approve');

  // Parent BOM consumes the phantom sub-assembly plus a scrapped panel.
  const parent = fx.execute('manufacturing:bom:create', {
    product_id: finished.variantId,
    quantity: 2,
    code: 'BOM-CAB-MULTI',
    scrap_percent: 0,
    yield_percent: 100,
    lines: [
      { product_id: subAssembly.variantId, quantity: 2, is_phantom: 1 },
      { product_id: componentA.variantId, quantity: 4, scrap_percent: 25 },
    ],
  }, 'bom-cab-multi');
  fx.execute('manufacturing:bom:approve', { bom_id: parent.id }, 'bom-cab-multi-approve');

  const bom = engineering.getBom(fx.db, parent.id, CTX.companyId);
  const { requirements } = engineering.explodeBom(fx.db, {
    company_id: CTX.companyId, bom, quantity: 10,
  });

  // Nothing named "Door Assembly" survives: a phantom is replaced by its children.
  assert.ok(
    requirements.every((row) => row.product_id !== subAssembly.variantId),
    'the phantom sub-assembly must not appear as a requirement',
  );

  const total = (productId) => requirements
    .filter((row) => row.product_id === productId)
    .reduce((sum, row) => sum + row.quantity, 0);

  // Panels: phantom path (2 doors per 2 cabinets = 1/unit × 2 panels) = 2/unit
  //         direct path (4 per 2 cabinets = 2/unit, +25% scrap)      = 2.5/unit
  //         → 10 units × 4.5 = 45
  assert.equal(total(componentA.variantId), 45);
  // Hinges: 1 door per cabinet × 6 hinges × 10 = 60
  assert.equal(total(componentB.variantId), 60);

  // Requirements from different branches stay separate rows with distinct paths.
  const panelRows = requirements.filter((row) => row.product_id === componentA.variantId);
  assert.equal(panelRows.length, 2);
  assert.equal(new Set(panelRows.map((row) => row.bom_path)).size, 2);
});

test('yield loss increases the quantity that must be issued', () => {
  const lossy = fx.execute('manufacturing:bom:create', {
    product_id: finished.variantId,
    quantity: 1,
    code: 'BOM-YIELD',
    yield_percent: 80,
    lines: [{ product_id: componentB.variantId, quantity: 10 }],
  }, 'bom-yield');
  const bom = engineering.getBom(fx.db, lossy.id, CTX.companyId);
  const { requirements } = engineering.explodeBom(fx.db, { company_id: CTX.companyId, bom, quantity: 1 });
  assert.equal(requirements[0].quantity, 12.5, '10 units at 80% yield needs 12.5 issued');
});

test('a self-referencing BOM is rejected rather than looping', () => {
  const looping = fx.execute('manufacturing:bom:create', {
    product_id: componentB.variantId,
    quantity: 1,
    code: 'BOM-LOOP',
    lines: [{ product_id: componentB.variantId, quantity: 1, is_phantom: 1 }],
  }, 'bom-loop');
  fx.execute('manufacturing:bom:approve', { bom_id: looping.id }, 'bom-loop-approve');
  const bom = engineering.getBom(fx.db, looping.id, CTX.companyId);
  assert.throws(
    () => engineering.explodeBom(fx.db, { company_id: CTX.companyId, bom, quantity: 1 }),
    /cycle/i,
  );
});

test('by-products are reported separately and never become requirements', () => {
  const withByProduct = fx.execute('manufacturing:bom:create', {
    product_id: finished.variantId,
    quantity: 1,
    code: 'BOM-BYPROD',
    lines: [
      { product_id: componentA.variantId, quantity: 5 },
      { product_id: componentB.variantId, quantity: 1, line_type: 'by_product', cost_share_percent: 10 },
    ],
  }, 'bom-byprod');
  const bom = engineering.getBom(fx.db, withByProduct.id, CTX.companyId);
  const { requirements, byProducts } = engineering.explodeBom(fx.db, { company_id: CTX.companyId, bom, quantity: 3 });
  assert.equal(requirements.length, 1);
  assert.equal(byProducts.length, 1);
  assert.equal(byProducts[0].quantity, 3);
  assert.equal(byProducts[0].cost_share_percent, 10);
});

test('a routing needs at least one operation before approval and versions like a BOM', () => {
  const workCenter = fx.execute('manufacturing:work_center:create', {
    code: 'WC-CUT', name: 'Cutting', labor_cost_per_hour: 12, machine_cost_per_hour: 8,
  }, 'wc-cut');

  const empty = fx.execute('manufacturing:routing:create', { name: 'Empty routing', code: 'RT-EMPTY' }, 'rt-empty');
  assert.throws(
    () => fx.execute('manufacturing:routing:approve', { routing_id: empty.id }, 'rt-empty-approve'),
    /at least one operation/,
  );

  const routing = fx.execute('manufacturing:routing:create', {
    name: 'Cabinet routing',
    code: 'RT-CAB',
    operations: [
      {
        name: 'Cut', sequence: 10, work_center_id: workCenter.id,
        setup_minutes: 15, run_minutes_per_unit: 4,
        instructions: [{ title: 'Wear gloves', instruction_type: 'safety' }],
      },
      { name: 'Assemble', sequence: 20, work_center_id: workCenter.id, run_minutes_per_unit: 9 },
    ],
  }, 'rt-cab');
  assert.equal(routing.operations.length, 2);
  assert.equal(routing.operations[0].instructions.length, 1);
  assert.equal(routing.operations[0].instructions[0].instruction_type, 'safety');

  fx.execute('manufacturing:routing:approve', { routing_id: routing.id }, 'rt-cab-approve');
  assert.equal(engineering.getRouting(fx.db, routing.id, CTX.companyId).status, 'approved');
});

test('an engineering change cannot be approved by its own requester', () => {
  const change = fx.execute('manufacturing:engineering_change:create', {
    title: 'Switch to 3mm panel', description: 'Cost reduction',
  }, 'eco-1');
  assert.equal(change.status, 'submitted');
  assert.throws(
    () => fx.execute('manufacturing:engineering_change:approve', { change_id: change.id }, 'eco-1-self'),
    /cannot be approved by the person who requested it/,
  );

  const approved = fx.executor.execute(
    'manufacturing:engineering_change:approve',
    { change_id: change.id, idempotency_key: 'eco-1-approve' },
    approverCtx(),
  );
  assert.equal(approved.status, 'approved');
  assert.equal(approved.approved_by, 'phase05-approver');
});

test('a BOM linked to an unapproved engineering change cannot be approved', () => {
  const change = fx.execute('manufacturing:engineering_change:create', { title: 'Pending change' }, 'eco-2');
  const bom = fx.execute('manufacturing:bom:create', {
    product_id: subAssembly.variantId,
    quantity: 1,
    code: 'BOM-ECO-GATED',
    engineering_change_id: change.id,
    lines: [{ product_id: componentA.variantId, quantity: 1 }],
  }, 'bom-eco-gated');
  assert.throws(
    () => fx.execute('manufacturing:bom:approve', { bom_id: bom.id }, 'bom-eco-gated-approve'),
    /engineering change must be approved/,
  );
});
