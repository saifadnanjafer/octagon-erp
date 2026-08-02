import assert from 'node:assert/strict';
import test from 'node:test';
import { mobileFixture } from './mobile-fixture.mjs';
import { productionFixture } from './production-fixture.mjs';
import { postStockMove } from '../../platform/inventory/ledger.mjs';
import * as replenishment from '../../platform/wms/replenishment.mjs';
import * as putaway from '../../platform/wms/putaway.mjs';
import * as material from '../../platform/manufacturing/material-flow.mjs';
import * as shopfloor from '../../platform/manufacturing/shopfloor.mjs';
import * as workOrders from '../../platform/manufacturing/work-orders.mjs';
import * as inspection from '../../platform/quality/inspection.mjs';
import * as quality from '../../platform/quality/operations.mjs';

test('cross-domain scenario 3 restores a depleted pick face through governed replenishment and canonical Inventory', async (t) => {
  const { db, ctx, companyId, warehouse, productId, source, destination } = await mobileFixture(t, 'scenario-replenishment');
  const stamp = new Date().toISOString();
  db.prepare('INSERT OR IGNORE INTO warehouse_branch_scopes(warehouse_id,company_id,branch_id,created_at) VALUES(?,?,?,?)').run(warehouse.id, companyId, 'branch-a', stamp);
  const rule = replenishment.createReplenishmentRule(db, {
    ...ctx, product_id: productId, source_location_id: source.locationId,
    destination_location_id: destination.locationId, minimum_quantity: 5,
    reorder_point: 5, target_quantity: 12, maximum_quantity: 15, priority: 1,
  });
  const calculated = replenishment.calculateReplenishment(db, { ...ctx, rule_id: rule.id, idempotency_key: 'scenario-replenishment-calc' });
  assert.equal(calculated.proposals.length, 1);
  const approved = replenishment.approveReplenishment(db, { ...ctx, actor: 'replenishment-approver', proposal_id: calculated.proposals[0].id });
  assert.equal(approved.task.canonicalRequest.uom_id, 'unit');
  let task = putaway.scanTaskSource(db, { ...ctx, actor: 'warehouse-operator', task_id: approved.task.id, barcode: 'PICK-A' });
  task = putaway.scanTaskDestination(db, { ...ctx, actor: 'warehouse-operator', task_id: task.id, barcode: 'RECV-A' });
  const pending = putaway.requestCanonicalMovement(db, { ...ctx, actor: 'warehouse-operator', task_id: task.id });
  const move = postStockMove(db, pending.canonicalRequest);
  const completed = putaway.acknowledgeCanonicalMovement(db, { ...ctx, actor: 'warehouse-operator', task_id: task.id, canonical_result_id: move.id });
  assert.equal(completed.status, 'completed');
  assert.equal(db.prepare('SELECT status FROM wms_replenishment_proposals_v2 WHERE id=?').get(calculated.proposals[0].id).status, 'completed');
  assert.equal(db.prepare('SELECT quantity FROM stock_quants WHERE company_id=? AND product_id=? AND location_id=?').get(companyId, productId, destination.locationId).quantity, 12);
});

test('cross-domain scenario 4 joins Production operation, material issue, Quality pass, receipt, and putaway', async (t) => {
  const fixture = await productionFixture(t, 'scenario-production');
  const { db, ctx, companyId, productId, orderId, workOrderId, requirementId, source, destination, staging, storageZone } = fixture;
  const session = shopfloor.openShopfloorSession(db, { ...ctx, work_order_id: workOrderId, operator_id: 'production-operator', idempotency_key: 'scenario-production-session' });
  shopfloor.requestOperationStart(db, { ...ctx, actor: 'production-operator', session_id: session.id, operator_id: 'production-operator' });
  workOrders.startWorkOrder(db, { work_order_id: workOrderId, actor: 'production-operator' });
  assert.equal(shopfloor.acknowledgeOperationTransition(db, { ...ctx, actor: 'production-operator', session_id: session.id }).status, 'running');

  async function executeMaterialFlow(type, quantity, from, to, key) {
    const request = material.createMaterialFlowRequest(db, { ...ctx, production_order_id: orderId, work_order_id: workOrderId,
      requirement_id: type === 'issue' ? requirementId : null, request_type: type, product_id: productId,
      requested_quantity: quantity, source_location_id: from, destination_location_id: to, idempotency_key: key });
    material.checkMaterialAvailability(db, { ...ctx, request_id: request.id });
    material.approveMaterialFlow(db, { ...ctx, actor: 'production-supervisor', request_id: request.id, assigned_to: 'warehouse-operator' });
    const pending = material.requestCanonicalMaterialEffect(db, { ...ctx, actor: 'warehouse-operator', request_id: request.id });
    const move = postStockMove(db, pending.canonicalRequest);
    return material.acknowledgeCanonicalMaterialEffect(db, { ...ctx, actor: 'warehouse-operator', request_id: request.id, canonical_result_id: move.id });
  }
  assert.equal((await executeMaterialFlow('issue', 3, source.locationId, destination.locationId, 'scenario-production-issue')).status, 'completed');

  const plan = inspection.createQualityPlan(db, { company_id: companyId, name: 'Scenario in-process plan', code: 'QP-SCENARIO', product_id: productId, points: [{ title: 'Visual', test_type: 'pass_fail' }] });
  const canonicalInspection = inspection.createQualityInspection(db, { company_id: companyId, plan_id: plan.id, inspection_type: 'in_process', source_type: 'work_order', source_id: workOrderId, product_id: productId, sample_size: 1, actor: 'quality-inspector' });
  const checkpoint = quality.openOperationalCheckpoint(db, { ...ctx, checkpoint_type: 'in_process', source_type: 'shopfloor_session', source_id: session.id, inspection_id: canonicalInspection.id, sampling_plan_reference: plan.code, idempotency_key: 'scenario-quality-checkpoint' });
  inspection.passInspection(db, { inspection_id: canonicalInspection.id, inspected_quantity: 1, actor: 'quality-inspector' });
  assert.equal(quality.syncOperationalCheckpoint(db, { ...ctx, checkpoint_id: checkpoint.id }).status, 'pass');

  assert.equal((await executeMaterialFlow('production_receipt', 2, destination.locationId, staging.locationId, 'scenario-production-receipt')).status, 'completed');
  putaway.createPutawayRule(db, { ...ctx, name: 'Finished-goods scenario rule', rule_type: 'product', product_id: productId, destination_zone_id: storageZone.id, destination_location_id: source.locationId, priority: 1 });
  const recommendation = putaway.recommendPutaway(db, { ...ctx, source_location_id: staging.locationId, product_id: productId, quantity: 2, quality_status: 'released', idempotency_key: 'scenario-production-putaway' });
  const accepted = putaway.acceptPutaway(db, { ...ctx, actor: 'warehouse-operator', recommendation_id: recommendation.id });
  let task = putaway.scanTaskSource(db, { ...ctx, actor: 'warehouse-operator', task_id: accepted.tasks[0].id, barcode: 'STAGE-A' });
  task = putaway.scanTaskDestination(db, { ...ctx, actor: 'warehouse-operator', task_id: task.id, barcode: 'PICK-A' });
  const pendingPutaway = putaway.requestCanonicalMovement(db, { ...ctx, actor: 'warehouse-operator', task_id: task.id });
  const putawayMove = postStockMove(db, pendingPutaway.canonicalRequest);
  assert.equal(putaway.acknowledgeCanonicalMovement(db, { ...ctx, actor: 'warehouse-operator', task_id: task.id, canonical_result_id: putawayMove.id }).status, 'completed');
  assert.equal(db.prepare('SELECT COUNT(*) count FROM stock_moves').get().count, 3);
});
