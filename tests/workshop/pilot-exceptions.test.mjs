import assert from 'node:assert/strict';
import test from 'node:test';
import { openPilot, seedPilotWorkshop } from './pilot-fixture.mjs';
import { PILOT_ACTORS } from './pilot-actors.mjs';
import { createPicking } from '../../platform/wms/operations.mjs';
import * as receiving from '../../platform/wms/receiving.mjs';
import * as material from '../../platform/manufacturing/material-flow.mjs';
import * as shopfloor from '../../platform/manufacturing/shopfloor.mjs';
import * as workOrders from '../../platform/manufacturing/work-orders.mjs';
import * as inspection from '../../platform/quality/inspection.mjs';
import * as ncrCapa from '../../platform/quality/ncr-capa.mjs';
import * as quality from '../../platform/quality/operations.mjs';
import { getQuantBalance } from '../../platform/inventory/ledger.mjs';

function scope(seed, actor) {
  return { company_id: seed.companyId, warehouse_id: seed.warehouse.id, branch_id: 'branch-pilot', actor: actor.id };
}

test('pilot exception A: receiving discrepancy is reviewed by a different actor before posting', async (t) => {
  const pilot = await openPilot(t, 'exception-receiving');
  const seed = seedPilotWorkshop(pilot);
  const { db } = pilot;
  const stockMovesBeforeReceiving = db.prepare('SELECT COUNT(*) value FROM stock_moves').get().value;
  const stamp = '2026-08-05T06:15:00.000Z';
  db.prepare('INSERT INTO stock_picking_types(id,company_id,warehouse_id,name,code,created_at) VALUES(?,?,?,?,?,?)')
    .run('pilot-incoming', seed.companyId, seed.warehouse.id, 'Pilot Receipts', 'incoming', stamp);

  const warehouseCtx = scope(seed, PILOT_ACTORS.warehouseOperator);
  const session = receiving.startReceiving(db, {
    ...warehouseCtx, receipt_type: 'purchase_order', reference: 'PILOT-PO-DISC', source_document_id: 'pilot-po-disc',
    expected_line_count: 1, over_receipt_tolerance: 0, quarantine_location_id: seed.quarantine.locationId,
    idempotency_key: 'pilot-receiving-discrepancy',
  });
  assert.equal(session.status, 'started');
  assert.equal(receiving.scanReceivingReference(db, { ...warehouseCtx, session_id: session.id, reference: 'PILOT-PO-DISC' }).status, 'scanning');
  const scanned = receiving.scanReceivingProduct(db, {
    ...warehouseCtx, session_id: session.id, product_id: seed.productId, barcode: 'PILOT-BC', uom_id: seed.unit.id,
    expected_quantity: 5, quantity: 2, damaged: false, quality_required: true,
    lot_code: 'PILOT-LOT-DISC', evidence: [{ fileId: 'pilot-receipt-photo' }], discrepancy_reason: 'Three units missing',
  });
  assert.equal(scanned.session.status, 'discrepancy_review');
  assert.equal(scanned.session.discrepancies.length, 1);
  const discrepancy = scanned.session.discrepancies[0];
  assert.ok(discrepancy.id);
  assert.throws(
    () => receiving.approveReceivingDiscrepancy(db, { ...warehouseCtx, session_id: session.id, discrepancy_id: discrepancy.id, decision: 'approved' }),
    (error) => error.code === 'MAKER_CHECKER_REQUIRED',
  );
  const approved = receiving.approveReceivingDiscrepancy(db, {
    ...scope(seed, PILOT_ACTORS.supervisor), session_id: session.id, discrepancy_id: discrepancy.id,
    decision: 'approved', reason: 'Supplier note confirms controlled partial delivery',
  });
  assert.equal(approved.status, 'discrepancy_review');
  const reviewed = receiving.reviewReceiving(db, { ...scope(seed, PILOT_ACTORS.qualityInspector), session_id: session.id });
  assert.equal(reviewed.status, 'ready');
  const picking = createPicking(db, {
    company_id: seed.companyId, picking_type_id: 'pilot-incoming', reference: 'PILOT-PO-DISC',
    location_id: seed.warehouse.input_location_id, location_dest_id: seed.quarantine.locationId,
  });
  const requested = receiving.requestReceivingPost(db, {
    ...scope(seed, PILOT_ACTORS.qualityInspector), session_id: session.id, picking_id: picking.id,
  });
  assert.equal(requested.status, 'awaiting_canonical');
  assert.equal(requested.executionBoundary, 'REQUEST_ONLY');
  assert.equal(requested.inventoryWritten, false);
  assert.equal(db.prepare('SELECT COUNT(*) value FROM stock_moves').get().value, stockMovesBeforeReceiving);
  const stored = db.prepare('SELECT status,discrepancy_type,requested_by,approved_by,resolved_at FROM wms_receiving_discrepancies WHERE id=?').get(discrepancy.id);
  assert.equal(stored.status, 'approved');
  assert.equal(stored.discrepancy_type, 'under');
  assert.equal(stored.requested_by, PILOT_ACTORS.warehouseOperator.id);
  assert.equal(stored.approved_by, PILOT_ACTORS.supervisor.id);
  assert.ok(stored.resolved_at);
});

test('pilot exception B: material shortage remains a proposal and preserves canonical stock', async (t) => {
  const pilot = await openPilot(t, 'exception-shortage');
  const seed = seedPilotWorkshop(pilot);
  const { db } = pilot;
  const before = getQuantBalance(db, { company_id: seed.companyId, product_id: seed.productId, location_id: seed.component.locationId });
  assert.equal(before.quantity, 20);

  const request = material.createMaterialFlowRequest(db, {
    ...scope(seed, PILOT_ACTORS.productionOperator), production_order_id: seed.productionOrderId,
    work_order_id: seed.workOrderId, requirement_id: seed.requirementId, request_type: 'issue',
    product_id: seed.productId, requested_quantity: 60, source_location_id: seed.component.locationId,
    destination_location_id: seed.wip.locationId, idempotency_key: 'pilot-shortage-request',
  });
  assert.equal(request.status, 'requested');
  const checked = material.checkMaterialAvailability(db, { ...scope(seed, PILOT_ACTORS.warehouseOperator), request_id: request.id });
  assert.equal(checked.status, 'shortage');
  assert.equal(checked.availableQuantity, 20);
  assert.equal(checked.shortageQuantity, 40);
  const queueBeforeApproval = material.materialShortageBoard(db, scope(seed, PILOT_ACTORS.supervisor));
  assert.ok(queueBeforeApproval.some((item) => item.id === request.id));
  const approved = material.approveMaterialFlow(db, {
    ...scope(seed, PILOT_ACTORS.supervisor), request_id: request.id,
    assigned_to: PILOT_ACTORS.warehouseOperator.id, allow_partial: true,
  });
  assert.ok(['approved','task_created'].includes(approved.status));
  assert.equal(approved.approvedQuantity, 20);
  assert.equal(approved.shortageQuantity, 40);
  assert.equal(approved.inventoryWritten, false);
  const afterApproval = getQuantBalance(db, { company_id: seed.companyId, product_id: seed.productId, location_id: seed.component.locationId });
  assert.equal(afterApproval.quantity, 20);
  const stored = db.prepare('SELECT status,requested_quantity,available_quantity,shortage_quantity,approved_by FROM mfg_material_flow_requests WHERE id=?').get(request.id);
  assert.equal(stored.requested_quantity, 60);
  assert.equal(stored.available_quantity, 20);
  assert.equal(stored.shortage_quantity, 40);
  assert.equal(stored.approved_by, PILOT_ACTORS.supervisor.id);
  assert.equal(db.prepare('SELECT assigned_to FROM wms_warehouse_tasks WHERE source_record_id=?').get(request.id).assigned_to, PILOT_ACTORS.warehouseOperator.id);
});

test('pilot exception C: failed quality checkpoint enters NCR and governed rework/retest', async (t) => {
  const pilot = await openPilot(t, 'exception-quality');
  const seed = seedPilotWorkshop(pilot);
  const { db } = pilot;
  const stockMovesBefore = db.prepare('SELECT COUNT(*) value FROM stock_moves').get().value;
  const productionCtx = scope(seed, PILOT_ACTORS.productionOperator);
  const session = shopfloor.openShopfloorSession(db, {
    ...productionCtx, work_order_id: seed.workOrderId, operator_id: PILOT_ACTORS.productionOperator.id,
    idempotency_key: 'pilot-quality-session',
  });
  shopfloor.requestOperationStart(db, { ...productionCtx, session_id: session.id, operator_id: PILOT_ACTORS.productionOperator.id });
  workOrders.startWorkOrder(db, { work_order_id: seed.workOrderId, actor: PILOT_ACTORS.productionOperator.id });
  assert.equal(shopfloor.acknowledgeOperationTransition(db, { ...productionCtx, session_id: session.id }).status, 'running');

  const plan = inspection.createQualityPlan(db, {
    company_id: seed.companyId, name: 'Pilot exception quality plan', code: 'PILOT-QP-FAIL',
    product_id: seed.productId, points: [{ title: 'Torque tolerance', test_type: 'pass_fail' }],
  });
  const canonical = inspection.createQualityInspection(db, {
    company_id: seed.companyId, plan_id: plan.id, inspection_type: 'in_process', source_type: 'work_order',
    source_id: seed.workOrderId, product_id: seed.productId, sample_size: 2, actor: PILOT_ACTORS.qualityInspector.id,
  });
  const checkpoint = quality.openOperationalCheckpoint(db, {
    ...scope(seed, PILOT_ACTORS.qualityInspector), checkpoint_type: 'in_process', source_type: 'shopfloor_session',
    source_id: session.id, inspection_id: canonical.id, hold_location_id: seed.quarantine.locationId,
    sampling_plan_reference: plan.code, evidence: [{ fileId: 'pilot-failed-torque-photo' }],
    idempotency_key: 'pilot-quality-failure',
  });
  inspection.failInspection(db, {
    inspection_id: canonical.id, inspected_quantity: 2, failed_quantity: 2, actor: PILOT_ACTORS.qualityInspector.id,
  });
  const held = quality.syncOperationalCheckpoint(db, {
    ...scope(seed, PILOT_ACTORS.qualityInspector), checkpoint_id: checkpoint.id,
    evidence: [{ fileId: 'pilot-failure-sheet' }],
  });
  assert.equal(held.status, 'hold');
  assert.equal(held.canonicalQualityWritten, false);
  const ncr = ncrCapa.createNCR(db, {
    company_id: seed.companyId, inspection_id: canonical.id, title: 'Pilot torque failure',
    severity: 'major', disposition: 'hold', assigned_to: PILOT_ACTORS.qualityInspector.id,
    actor: PILOT_ACTORS.qualityInspector.id,
  });
  assert.equal(ncr.state, 'open');
  assert.equal(quality.syncOperationalCheckpoint(db, { ...scope(seed, PILOT_ACTORS.qualityInspector), checkpoint_id: checkpoint.id }).status, 'ncr');
  const disposition = quality.requestDisposition(db, {
    ...scope(seed, PILOT_ACTORS.qualityInspector), checkpoint_id: checkpoint.id, disposition_type: 'rework',
    quantity: 2, reason_code: 'TORQUE_OUT_OF_RANGE', ncr_id: ncr.id, evidence: [{ fileId: 'pilot-rework-request' }],
  });
  assert.equal(disposition.status, 'requested');
  assert.throws(
    () => quality.approveDisposition(db, { ...scope(seed, PILOT_ACTORS.qualityInspector), disposition_id: disposition.id }),
    (error) => error.code === 'MAKER_CHECKER_REQUIRED',
  );
  const approved = quality.approveDisposition(db, {
    ...scope(seed, PILOT_ACTORS.supervisor), disposition_id: disposition.id,
    operations: [{ sequence: 10, instruction: 'Re-torque fasteners' }, { sequence: 20, instruction: 'Independent visual verification' }],
    retest_required: true,
  });
  assert.equal(approved.status, 'route_created');
  assert.equal(approved.canonicalManufacturingWritten, false);
  const started = quality.startRework(db, {
    ...scope(seed, PILOT_ACTORS.productionOperator), rework_route_id: approved.reworkRouteId,
  });
  assert.equal(started.status, 'running');
  const completed = quality.completeRework(db, {
    ...scope(seed, PILOT_ACTORS.productionOperator), rework_route_id: approved.reworkRouteId,
  });
  assert.equal(completed.status, 'retest');
  assert.equal(completed.retestProposal.executionBoundary, 'REQUEST_ONLY');
  assert.equal(db.prepare('SELECT COUNT(*) value FROM stock_moves').get().value, stockMovesBefore);
  const route = db.prepare('SELECT status,retest_required,started_at,completed_at FROM quality_rework_routes WHERE id=?').get(approved.reworkRouteId);
  assert.equal(route.status, 'retest');
  assert.equal(route.retest_required, 1);
  assert.ok(route.started_at);
  assert.ok(route.completed_at);
});
