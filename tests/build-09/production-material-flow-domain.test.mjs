import test from 'node:test';
import assert from 'node:assert/strict';
import { productionFixture } from './production-fixture.mjs';
import { postStockMove } from '../../platform/inventory/ledger.mjs';
import * as material from '../../platform/manufacturing/material-flow.mjs';

test('production issue return receipt and shortages use canonical inventory movements', async (t) => {
  const fixture = await productionFixture(t, 'material-flow');
  const { db, ctx, companyId, productId, orderId, workOrderId, requirementId, source, destination, staging } = fixture;
  async function completeFlow({ key, type, quantity, from, to }) {
    const request = material.createMaterialFlowRequest(db, {
      ...ctx, production_order_id: orderId, work_order_id: workOrderId,
      requirement_id: type === 'issue' ? requirementId : null, request_type: type, product_id: productId,
      requested_quantity: quantity, source_location_id: from, destination_location_id: to,
      idempotency_key: `mflow-${key}`,
    });
    const checked = material.checkMaterialAvailability(db, { ...ctx, request_id: request.id });
    assert.notEqual(checked.status, 'requested');
    assert.throws(() => material.approveMaterialFlow(db, { ...ctx, request_id: request.id }), (error) => error.code === 'MAKER_CHECKER_REQUIRED');
    const approved = material.approveMaterialFlow(db, { ...ctx, actor: 'supervisor-b', request_id: request.id, assigned_to: 'warehouse-c' });
    assert.equal(approved.warehouseTaskGenerated, true);
    assert.equal(approved.inventoryWritten, false);
    const pending = material.requestCanonicalMaterialEffect(db, { ...ctx, actor: 'warehouse-c', request_id: request.id });
    assert.equal(pending.executionBoundary, 'REQUEST_ONLY');
    const move = postStockMove(db, pending.canonicalRequest);
    const completed = material.acknowledgeCanonicalMaterialEffect(db, { ...ctx, actor: 'warehouse-c', request_id: request.id, canonical_result_id: move.id });
    assert.equal(completed.status, 'completed');
    return completed;
  }

  const issue = await completeFlow({ key: 'issue', type: 'issue', quantity: 6, from: source.locationId, to: destination.locationId });
  assert.equal(issue.followUpCanonicalAction, 'manufacturing:material:issue');
  const returned = await completeFlow({ key: 'return', type: 'return', quantity: 2, from: destination.locationId, to: source.locationId });
  assert.equal(returned.followUpCanonicalAction, 'manufacturing:material:return');
  const receipt = await completeFlow({ key: 'receipt', type: 'production_receipt', quantity: 3, from: destination.locationId, to: staging.locationId });
  assert.equal(receipt.followUpCanonicalAction, 'manufacturing:order:complete');
  assert.equal(db.prepare('SELECT COUNT(*) count FROM stock_moves').get().count, 3);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM wms_warehouse_tasks WHERE source_record_type='mfg_material_flow_request' AND status='completed'").get().count, 3);

  const shortage = material.createMaterialFlowRequest(db, {
    ...ctx, production_order_id: orderId, work_order_id: workOrderId, requirement_id: requirementId,
    request_type: 'issue', product_id: productId, requested_quantity: 50,
    source_location_id: source.locationId, destination_location_id: destination.locationId,
  });
  const shortageChecked = material.checkMaterialAvailability(db, { ...ctx, request_id: shortage.id });
  assert.equal(shortageChecked.status, 'shortage');
  assert.ok(shortageChecked.shortageQuantity > 0);
  const partial = material.approveMaterialFlow(db, { ...ctx, actor: 'supervisor-b', request_id: shortage.id });
  assert.ok(partial.approvedQuantity < partial.requestedQuantity);
  assert.equal(material.materialShortageBoard(db, ctx).length, 0);
  assert.equal(db.prepare('SELECT company_id FROM stock_moves LIMIT 1').get().company_id, companyId);
});
