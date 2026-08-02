import test from 'node:test';
import assert from 'node:assert/strict';
import { productionFixture } from './production-fixture.mjs';
import * as shopfloor from '../../platform/manufacturing/shopfloor.mjs';
import * as workOrders from '../../platform/manufacturing/work-orders.mjs';
import * as inspection from '../../platform/quality/inspection.mjs';
import * as ncrCapa from '../../platform/quality/ncr-capa.mjs';
import * as operations from '../../platform/quality/operations.mjs';
import { createStockLocation } from '../../platform/inventory/warehouses.mjs';
import { postStockMove } from '../../platform/inventory/ledger.mjs';

test('quality failure creates canonical NCR-linked rework or maker-checker scrap with canonical inventory effect', async (t) => {
  const fixture = await productionFixture(t, 'quality-ops');
  const { db, ctx, companyId, warehouse, productId, workOrderId, source, quarantine } = fixture;
  const session = shopfloor.openShopfloorSession(db, { ...ctx, work_order_id: workOrderId, operator_id: 'operator-a', idempotency_key: 'quality-shopfloor-1' });
  shopfloor.requestOperationStart(db, { ...ctx, session_id: session.id, operator_id: 'operator-a' });
  workOrders.startWorkOrder(db, { work_order_id: workOrderId, actor: 'operator-a' });
  shopfloor.acknowledgeOperationTransition(db, { ...ctx, session_id: session.id });

  const plan = inspection.createQualityPlan(db, { company_id: companyId, name: 'In-process Assembly Plan', code: 'QP-B09', product_id: productId, points: [{ title: 'Torque', test_type: 'pass_fail' }] });
  function failedCheckpoint(key) {
    const canonical = inspection.createQualityInspection(db, { company_id: companyId, plan_id: plan.id, inspection_type: 'in_process', source_type: 'work_order', source_id: workOrderId, product_id: productId, sample_size: 2, actor: 'inspector-a' });
    const checkpoint = operations.openOperationalCheckpoint(db, {
      ...ctx, checkpoint_type: 'in_process', source_type: 'shopfloor_session', source_id: session.id,
      inspection_id: canonical.id, hold_location_id: quarantine.locationId, sampling_plan_reference: plan.code,
      evidence: [{ fileId: `inspection-photo-${key}` }], idempotency_key: `quality-checkpoint-${key}`,
    });
    inspection.failInspection(db, { inspection_id: canonical.id, inspected_quantity: 2, failed_quantity: 2, actor: 'inspector-a' });
    const held = operations.syncOperationalCheckpoint(db, { ...ctx, checkpoint_id: checkpoint.id, evidence: [{ fileId: `failure-sheet-${key}` }] });
    assert.equal(held.status, 'hold');
    assert.equal(held.canonicalQualityWritten, false);
    const ncr = ncrCapa.createNCR(db, { company_id: companyId, inspection_id: canonical.id, title: `Assembly failure ${key}`, severity: 'major', disposition: 'hold', actor: 'quality-lead' });
    const synced = operations.syncOperationalCheckpoint(db, { ...ctx, checkpoint_id: checkpoint.id });
    assert.equal(synced.status, 'ncr');
    return { checkpoint: synced, ncr };
  }

  const reworkFailure = failedCheckpoint('rework');
  const reworkRequest = operations.requestDisposition(db, {
    ...ctx, checkpoint_id: reworkFailure.checkpoint.id, disposition_type: 'rework', quantity: 2,
    reason_code: 'TORQUE_OUT_OF_RANGE', ncr_id: reworkFailure.ncr.id, evidence: [{ fileId: 'ncr-evidence-rework' }],
  });
  assert.throws(() => operations.approveDisposition(db, { ...ctx, disposition_id: reworkRequest.id }), (error) => error.code === 'MAKER_CHECKER_REQUIRED');
  const reworkApproved = operations.approveDisposition(db, {
    ...ctx, actor: 'quality-approver-b', disposition_id: reworkRequest.id,
    operations: [{ sequence: 10, instruction: 'Re-torque and verify' }], retest_required: true,
  });
  assert.equal(reworkApproved.status, 'route_created');
  assert.equal(reworkApproved.canonicalManufacturingWritten, false);
  const started = operations.startRework(db, { ...ctx, actor: 'rework-operator-c', rework_route_id: reworkApproved.reworkRouteId });
  assert.equal(started.status, 'running');
  const completed = operations.completeRework(db, { ...ctx, actor: 'rework-operator-c', rework_route_id: reworkApproved.reworkRouteId });
  assert.equal(completed.status, 'retest');
  assert.equal(completed.retestProposal.executionBoundary, 'REQUEST_ONLY');

  const scrapFailure = failedCheckpoint('scrap');
  const scrapLocation = createStockLocation(db, { company_id: companyId, warehouse_id: warehouse.id, parent_id: warehouse.view_location_id, name: 'Quality Scrap', usage: 'inventory', is_scrap: 1 });
  const supplierLocation = createStockLocation(db, { company_id: companyId, warehouse_id: warehouse.id, parent_id: warehouse.view_location_id, name: 'Quality Supplier', usage: 'supplier' });
  postStockMove(db, { company_id: companyId, reference: 'QUALITY-STOCK-OPEN', product_id: productId, uom_id: 'unit', product_qty: 5,
    location_id: supplierLocation.id, location_dest_id: source.locationId, unit_cost: 10, idempotency_key: 'quality-stock-open' });
  const scrapRequest = operations.requestDisposition(db, {
    ...ctx, actor: 'inspector-scrap', checkpoint_id: scrapFailure.checkpoint.id, disposition_type: 'scrap', quantity: 1,
    reason_code: 'IRREPARABLE_DEFECT', ncr_id: scrapFailure.ncr.id, source_location_id: source.locationId,
    destination_location_id: scrapLocation.id, evidence: [{ fileId: 'scrap-photo-1' }],
  });
  assert.throws(() => operations.approveDisposition(db, { ...ctx, actor: 'inspector-scrap', disposition_id: scrapRequest.id }), (error) => error.code === 'MAKER_CHECKER_REQUIRED');
  const scrapApproved = operations.approveDisposition(db, { ...ctx, actor: 'scrap-approver-b', disposition_id: scrapRequest.id, decision_notes: 'Confirmed non-reworkable' });
  assert.equal(scrapApproved.executionBoundary, 'REQUEST_ONLY');
  assert.equal(scrapApproved.inventoryWritten, false);
  const pending = operations.requestCanonicalScrap(db, { ...ctx, actor: 'scrap-approver-b', disposition_id: scrapRequest.id });
  const stockBefore = db.prepare('SELECT COUNT(*) count FROM stock_moves').get().count;
  assert.equal(pending.inventoryWritten, false);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM stock_moves').get().count, stockBefore);
  const move = postStockMove(db, pending.canonicalRequest);
  const acknowledged = operations.acknowledgeCanonicalScrap(db, { ...ctx, actor: 'quality-closer-c', disposition_id: scrapRequest.id, canonical_result_id: move.id });
  assert.equal(acknowledged.status, 'completed');
  assert.equal(operations.closeDisposition(db, { ...ctx, actor: 'quality-closer-c', disposition_id: scrapRequest.id }).status, 'closed');
  assert.equal(operations.listDispositions(db, ctx).length, 2);
  assert.equal(operations.listReworkRoutes(db, ctx).length, 1);
});
