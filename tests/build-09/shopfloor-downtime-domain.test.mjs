import test from 'node:test';
import assert from 'node:assert/strict';
import { productionFixture } from './production-fixture.mjs';
import * as shopfloor from '../../platform/manufacturing/shopfloor.mjs';
import * as downtime from '../../platform/manufacturing/downtime-performance.mjs';
import * as canonicalWorkOrders from '../../platform/manufacturing/work-orders.mjs';

test('shop-floor terminal delegates canonical work-order transitions and calculates only evidenced performance', async (t) => {
  const { db, ctx, workOrderId, workCenterId } = await productionFixture(t, 'shopfloor');
  const session = shopfloor.openShopfloorSession(db, {
    ...ctx, work_order_id: workOrderId, operator_id: 'operator-a', shift_code: 'DAY-A',
    asset_reference: 'ASSET-LINE-1', tool_reference: 'TOOL-TORQUE-1', instructions: 'Follow approved drawing',
    files: [{ fileId: 'drawing-900', revision: 'A' }], collaboration: { channel: 'production-900' },
    planned_start_at: '2026-08-03T08:00:00.000Z', planned_end_at: '2026-08-03T09:00:00.000Z',
    idempotency_key: 'shopfloor-session-1',
  });
  assert.equal(session.status, 'assigned');
  const startRequest = shopfloor.requestOperationStart(db, { ...ctx, session_id: session.id, operator_id: 'operator-a' });
  assert.equal(startRequest.status, 'awaiting_canonical');
  assert.equal(startRequest.canonicalAction, 'manufacturing:work_order:start');
  assert.equal(startRequest.canonicalManufacturingWritten, false);
  assert.equal(db.prepare('SELECT state FROM mfg_work_orders WHERE id=?').get(workOrderId).state, 'ready');
  canonicalWorkOrders.startWorkOrder(db, { work_order_id: workOrderId, actor: 'operator-a' });
  assert.equal(shopfloor.acknowledgeOperationTransition(db, { ...ctx, session_id: session.id }).status, 'running');

  const output = shopfloor.recordOperationOutput(db, { ...ctx, session_id: session.id, produced_quantity: 8, rejected_quantity: 1, scrap_quantity: 1, evidence: [{ fileId: 'check-sheet-1' }] });
  assert.equal(output.producedQuantity, 8);
  assert.equal(output.canonicalProductionOrderWritten, false);
  const stopped = downtime.startDowntime(db, { ...ctx, session_id: session.id, starts_at: '2026-08-03T08:20:00.000Z', reason_code: 'MATERIAL_WAIT', reason_category: 'material', maintenance_required: false });
  assert.equal(stopped.status, 'open');
  const ended = downtime.endDowntime(db, { ...ctx, downtime_id: stopped.id, ends_at: '2026-08-03T08:30:00.000Z' });
  assert.equal(ended.durationMinutes, 10);
  canonicalWorkOrders.recordLabor(db, { work_order_id: workOrderId, operator_id: 'operator-a', setup_minutes: 5, run_minutes: 20 });

  const pauseRequest = shopfloor.requestOperationPause(db, { ...ctx, session_id: session.id });
  assert.equal(pauseRequest.executionBoundary, 'REQUEST_ONLY');
  canonicalWorkOrders.pauseWorkOrder(db, { work_order_id: workOrderId });
  assert.equal(shopfloor.acknowledgeOperationTransition(db, { ...ctx, session_id: session.id }).status, 'paused');
  const resumeRequest = shopfloor.requestOperationResume(db, { ...ctx, session_id: session.id });
  assert.equal(resumeRequest.requestedStatus, 'running');
  canonicalWorkOrders.resumeWorkOrder(db, { work_order_id: workOrderId });
  shopfloor.acknowledgeOperationTransition(db, { ...ctx, session_id: session.id });
  const completeRequest = shopfloor.requestOperationComplete(db, { ...ctx, session_id: session.id });
  assert.equal(completeRequest.requestedStatus, 'completed');
  canonicalWorkOrders.completeWorkOrder(db, { work_order_id: workOrderId, completed_quantity: 8, rejected_quantity: 1 });
  assert.equal(db.prepare('SELECT state FROM mfg_work_orders WHERE id=?').get(workOrderId).state, 'completed');
  assert.equal(shopfloor.acknowledgeOperationTransition(db, { ...ctx, session_id: session.id }).status, 'completed');

  const metric = downtime.sessionPerformance(db, { ...ctx, session_id: session.id });
  assert.equal(metric.downtimeMinutes, 10);
  assert.equal(metric.runtimeMinutes, 20);
  assert.equal(metric.metricsReliable.availability, true);
  assert.equal(metric.metricsReliable.performance, true);
  assert.equal(metric.metricsReliable.qualityRate, true);
  assert.equal(metric.metricsReliable.oee, true);
  assert.ok(shopfloor.sessionTimeline(db, { ...ctx, session_id: session.id }).length >= 8);
  assert.equal(shopfloor.shopfloorStatusBoard(db, ctx).byWorkCenter[workCenterId], 1);
});

test('performance metrics remain unavailable when timing and output evidence are absent', async (t) => {
  const { db, ctx, workOrderId } = await productionFixture(t, 'shopfloor-unknown');
  const session = shopfloor.openShopfloorSession(db, { ...ctx, work_order_id: workOrderId, idempotency_key: 'shopfloor-unknown-1' });
  const metric = downtime.sessionPerformance(db, { ...ctx, session_id: session.id });
  assert.equal(metric.runtimeMinutes, null);
  assert.equal(metric.qualityRate, null);
  assert.equal(metric.performance, null);
  assert.equal(metric.oee, null);
});
