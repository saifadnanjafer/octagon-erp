import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileFixture } from './mobile-fixture.mjs';
import * as counting from '../../platform/wms/cycle-counting.mjs';

test('blind cycle count routes variance through maker-checker and canonical adjustment request', async (t) => {
  const { db, ctx, productId, source } = await mobileFixture(t, 'counting');
  const plan = counting.createCountPlan(db, { ...ctx, name: 'A-class weekly bins', count_scope: 'location', location_id: source.locationId, abc_class: 'A', frequency_days: 7, tolerance_quantity: 0.5, tolerance_percent: 2, blind_count: true });
  const session = counting.startCountSession(db, { ...ctx, plan_id: plan.id, session_type: 'planned', assigned_to: 'counter-a', idempotency_key: 'count-a' });
  assert.equal(session.status, 'counting');
  assert.equal(session.lines[0].theoreticalQuantity, undefined, 'blind count hides snapshot quantity');
  const recorded = counting.recordCountLine(db, { ...ctx, actor: 'counter-a', session_id: session.id, line_id: session.lines[0].id, counted_quantity: 18, discrepancy_reason: 'Two damaged units isolated' });
  assert.equal(recorded.lines[0].countedQuantity, 18);
  const submitted = counting.submitCount(db, { ...ctx, actor: 'counter-a', session_id: session.id });
  assert.equal(submitted.status, 'variance_review');
  assert.equal(submitted.lines[0].varianceQuantity, -2);
  assert.throws(() => counting.approveCountVariance(db, { ...ctx, actor: 'counter-a', session_id: session.id, reason: 'Verified damage' }), (error) => error.code === 'MAKER_CHECKER_REQUIRED');
  const approved = counting.approveCountVariance(db, { ...ctx, actor: 'supervisor-b', session_id: session.id, reason: 'Verified damaged units' });
  assert.equal(approved.status, 'approved');
  const request = counting.requestCountAdjustment(db, { ...ctx, actor: 'supervisor-b', session_id: session.id });
  assert.equal(request.status, 'awaiting_canonical');
  assert.equal(request.executionBoundary, 'REQUEST_ONLY');
  assert.equal(request.requests[0].action, 'stock:move:post');
  assert.equal(request.inventoryWritten, false);
  assert.equal(db.prepare('SELECT quantity FROM stock_quants WHERE id=?').get('quant-mobile-source').quantity, 20);
  assert.equal(productId, request.requests[0].product_id);
});

// Regression: startCountSession hid the snapshot for a blind count, but listCountSessions
// revealed it unconditionally - so a counter could simply list the sessions and read the very
// quantity a blind count exists to withhold. The snapshot is only revealed once counting ends.
test('listCountSessions withholds the blind snapshot while counting and reveals it for review', async (t) => {
  const { db, ctx, source } = await mobileFixture(t, 'counting-list');
  const plan = counting.createCountPlan(db, { ...ctx, name: 'Blind bins', count_scope: 'location', location_id: source.locationId, blind_count: true });
  const session = counting.startCountSession(db, { ...ctx, plan_id: plan.id, assigned_to: 'counter-a', idempotency_key: 'count-list-a' });

  const whileCounting = counting.listCountSessions(db, ctx).find((row) => row.id === session.id);
  assert.equal(whileCounting.status, 'counting');
  assert.equal(whileCounting.lines[0].theoreticalQuantity, undefined, 'the list surface must not leak the blind snapshot');
  assert.equal(whileCounting.lines[0].countedQuantity, null);

  counting.recordCountLine(db, { ...ctx, actor: 'counter-a', session_id: session.id, line_id: session.lines[0].id, counted_quantity: 18 });
  counting.submitCount(db, { ...ctx, actor: 'counter-a', session_id: session.id });

  const afterSubmit = counting.listCountSessions(db, ctx).find((row) => row.id === session.id);
  assert.equal(afterSubmit.status, 'variance_review');
  assert.equal(afterSubmit.lines[0].theoreticalQuantity, 20, 'variance review needs the snapshot to be reviewable');

  // A directed (non-blind) count is unaffected: its snapshot is visible from the start.
  const directed = counting.startCountSession(db, { ...ctx, location_id: source.locationId, blind_count: false, idempotency_key: 'count-list-directed' });
  const listedDirected = counting.listCountSessions(db, ctx).find((row) => row.id === directed.id);
  assert.equal(listedDirected.lines[0].theoreticalQuantity, 20);
});
