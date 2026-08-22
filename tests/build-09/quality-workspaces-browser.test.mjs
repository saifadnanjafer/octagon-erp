import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductionOrder } from '../../platform/manufacturing/manufacturing-orders.mjs';
import { createStockLocation } from '../../platform/inventory/warehouses.mjs';
import * as inspection from '../../platform/quality/inspection.mjs';
import * as ncrCapa from '../../platform/quality/ncr-capa.mjs';
import { browserAction, clickStable, latinDigits, openBuild09Browser } from './browser-harness.mjs';

// BUILD-09R-2 Group E: real Chromium drives the Quality Hold Queue, Rework Workspace and Scrap
// Approval (modules/build09-quality-workspace.js) through visible controls only.
//
// Two boundaries are proven from the UI rather than assumed:
//   * approval is a second person - the requester's own approve click is refused and rendered
//     as a denied panel (this is the group's required permission-denial proof);
//   * Quality never moves stock - an approved scrap only ever produces a canonical
//     stock:move:post request, and on-hand stock is unchanged until canonical Inventory posts
//     the move and the acknowledgement is verified against it.

const QUALITY_MODULES = ['build09r-shared.js', 'build09-quality-workspace.js'];

function seedHeldCheckpoint(dialect, seed) {
  const stamp = new Date().toISOString();
  dialect.prepare(`INSERT INTO boms(id,company_id,code,product_id,name_en,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run('bom-b09r2-q', seed.companyId, 'BOM-B09R2-Q', seed.productId, 'Group E BOM', 'planner-a', stamp, stamp);
  dialect.prepare(`INSERT INTO bom_versions(id,company_id,bom_id,revision,state,approved_by,approved_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`)
    .run('bomv-b09r2-q', seed.companyId, 'bom-b09r2-q', 1, 'approved', 'approver-b', stamp, stamp, stamp);
  const order = createProductionOrder(dialect, {
    company_id: seed.companyId, product_id: seed.productId, planned_quantity: 10, bom_version_id: 'bomv-b09r2-q',
    warehouse_id: seed.warehouse.id, wip_location_id: seed.destination.locationId, finished_location_id: seed.staging.locationId, actor: 'planner-a',
  });
  dialect.prepare(`INSERT INTO work_centers(id,company_id,code,name_ar,name_en,warehouse_id,wip_location_id,capacity_per_hour,efficiency_percent,working_hours_per_day,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('wc-b09r2-q', seed.companyId, 'WC-B09R2-Q', 'تجميع', 'Assembly', seed.warehouse.id, seed.destination.locationId, 12, 95, 8, 1, stamp, stamp);
  dialect.prepare(`INSERT INTO mfg_work_orders(id,company_id,production_order_id,operation_sequence,work_center_id,name,planned_setup_minutes,planned_run_minutes,quantity_to_produce,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('wo-b09r2-q', seed.companyId, order.id, 10, 'wc-b09r2-q', 'Assembly operation', 5, 60, 10, 'ready', stamp, stamp);
  dialect.prepare(`UPDATE mfg_production_orders SET state='released',updated_at=? WHERE id=?`).run(stamp, order.id);

  const plan = inspection.createQualityPlan(dialect, { company_id: seed.companyId, name: 'Group E In-process Plan', code: 'QP-B09R2', product_id: seed.productId, points: [{ title: 'Torque', test_type: 'pass_fail' }] });
  const scrapLocation = createStockLocation(dialect, { company_id: seed.companyId, warehouse_id: seed.warehouse.id, parent_id: seed.warehouse.view_location_id, name: 'Group E Scrap', usage: 'inventory', is_scrap: 1 });
  return { orderId: order.id, workOrderId: 'wo-b09r2-q', planId: plan.id, scrapLocationId: scrapLocation.id };
}

/** Drive a checkpoint into the NCR-linked held state the disposition flow requires. */
async function heldCheckpoint(page, dialect, seed, fixture, key) {
  const session = await browserAction(page, 'shopfloor:session_open', { warehouse_id: seed.warehouse.id, work_order_id: fixture.workOrderId, idempotency_key: `q-session-${key}` });
  const canonical = inspection.createQualityInspection(dialect, { company_id: seed.companyId, plan_id: fixture.planId, inspection_type: 'in_process', source_type: 'work_order', source_id: fixture.workOrderId, product_id: seed.productId, sample_size: 2, actor: 'inspector-a' });
  const checkpoint = await browserAction(page, 'quality:checkpoint_open', {
    warehouse_id: seed.warehouse.id, checkpoint_type: 'in_process', source_type: 'shopfloor_session', source_id: session.id,
    inspection_id: canonical.id, hold_location_id: seed.staging.locationId, sampling_plan_reference: 'QP-B09R2',
    evidence: [{ fileId: `inspection-photo-${key}` }], idempotency_key: `q-checkpoint-${key}`,
  });
  inspection.failInspection(dialect, { inspection_id: canonical.id, inspected_quantity: 2, failed_quantity: 2, actor: 'inspector-a' });
  // Sync once so the failure actually puts the checkpoint on hold - a checkpoint only reaches the
  // hold queue after a sync, and the NCR must exist before the second sync can pick it up. The
  // UI test drives that second sync itself.
  const held = await browserAction(page, 'quality:checkpoint_sync', { warehouse_id: seed.warehouse.id, checkpoint_id: checkpoint.id });
  assert.equal(held.status, 'hold');
  ncrCapa.createNCR(dialect, { company_id: seed.companyId, inspection_id: canonical.id, title: `Assembly failure ${key}`, severity: 'major', disposition: 'hold', actor: 'quality-lead' });
  return { checkpointId: checkpoint.id, sessionId: session.id };
}

test('real Chromium works the quality hold queue and refuses self-approval of a disposition', async (t) => {
  const { consoleErrors, dialect, page, seed } = await openBuild09Browser(t, { name: 'quality-hold-ui', initialPage: 'quality_hold_queue', extraModules: QUALITY_MODULES });
  const host = '[data-build09-page="quality_hold_queue"]';
  const scrapHost = '[data-build09-page="scrap_approval"]';
  const fixture = seedHeldCheckpoint(dialect, seed);
  const { checkpointId } = await heldCheckpoint(page, dialect, seed, fixture, 'hold');

  await page.evaluate(() => window.switchPage('quality_hold_queue'));
  await page.waitForFunction((selector) => document.querySelectorAll(`${selector} [data-role="qh-open"]`).length > 0, { timeout: 15000 }, host);
  await clickStable(page, `${host} [data-role="qh-open"][data-checkpoint-id="${checkpointId}"]`);
  await page.waitForSelector(`${host} [data-role="qh-detail"]`, { timeout: 10000 });

  // Sync pulls the canonical inspection verdict through - the checkpoint becomes NCR-linked.
  await clickStable(page, `${host} [data-role="qh-sync"]`);
  await page.waitForFunction((selector) => /ncr/i.test(document.querySelector(`${selector} [data-role="qh-detail"]`)?.textContent || ''), { timeout: 10000 }, host);
  const synced = dialect.prepare('SELECT status,ncr_id,rejected_quantity FROM quality_operational_checkpoints WHERE id=?').get(checkpointId);
  assert.equal(synced.status, 'ncr');
  assert.ok(synced.ncr_id, 'the canonical NCR is linked to the checkpoint');
  assert.equal(Number(synced.rejected_quantity), 2);

  const evidence = await page.$eval(`${host} [data-role="qh-evidence"]`, (node) => node.textContent);
  assert.match(evidence, /inspection-photo-hold/, 'checkpoint evidence is rendered, not just stored');

  // Request a rework disposition through the visible form.
  await page.waitForSelector(`${host} [data-role="qh-disposition-form"]`, { timeout: 10000 });
  await page.select(`${host} [data-role="qh-disposition-form"] [name="disposition_type"]`, 'rework');
  await page.type(`${host} [data-role="qh-disposition-form"] [name="quantity"]`, '2');
  await page.type(`${host} [data-role="qh-disposition-form"] [name="reason_code"]`, 'TORQUE_OUT_OF_RANGE');
  await page.click(`${host} [data-role="qh-disposition-form"] button[type="submit"]`);

  // The submit re-reads the checkpoint list, so wait on that settling rather than on a timer.
  await page.waitForFunction((selector) => !document.querySelector(`${selector} [data-role="qh-alert"]`), { timeout: 10000 }, host);
  const disposition = dialect.prepare('SELECT * FROM quality_disposition_requests WHERE checkpoint_id=?').get(checkpointId);
  assert.ok(disposition, 'the disposition form created a real disposition request');
  assert.equal(disposition.disposition_type, 'rework');
  assert.equal(disposition.status, 'requested');
  assert.equal(disposition.requested_by, 'browser-manager');
  assert.ok(disposition.ncr_id, 'the NCR link the server requires was carried through from the checkpoint');

  // Permission denial: the requester cannot approve their own disposition.
  await page.evaluate(() => window.switchPage('scrap_approval'));
  await page.waitForFunction((selector) => document.querySelectorAll(`${selector} [data-role="sc-open"]`).length > 0, { timeout: 15000 }, scrapHost);
  await clickStable(page, `${scrapHost} [data-role="sc-open"][data-disposition-id="${disposition.id}"]`);
  await page.waitForSelector(`${scrapHost} [data-role="sc-approve-form"]`, { timeout: 10000 });
  await page.click(`${scrapHost} [data-role="sc-approve-form"] button[type="submit"]`);

  await page.waitForFunction((selector) => document.querySelector(selector)?.dataset.phase === 'denied', { timeout: 10000 }, `${scrapHost} [data-role="sc-alert"]`);
  assert.match(await page.$eval(`${scrapHost} [data-role="sc-alert"]`, (node) => node.textContent), /maker-checker/i);
  assert.equal(dialect.prepare('SELECT status FROM quality_disposition_requests WHERE id=?').get(disposition.id).status, 'requested');

  // A second approver creates the rework route; the Rework Workspace then runs it.
  const approved = await browserAction(page, 'quality:disposition_approve', { warehouse_id: seed.warehouse.id, disposition_id: disposition.id, decision_notes: 'Reworkable' }, { user: 'quality-approver-b' });
  assert.equal(approved.canonicalManufacturingWritten, false);

  const reworkHost = '[data-build09-page="rework_workspace"]';
  await page.evaluate(() => window.switchPage('rework_workspace'));
  await page.waitForFunction((selector) => document.querySelectorAll(`${selector} [data-role="rw-start"]`).length > 0, { timeout: 15000 }, reworkHost);
  await clickStable(page, `${reworkHost} [data-role="rw-start"]`);
  await page.waitForFunction((selector) => document.querySelectorAll(`${selector} [data-role="rw-complete"]`).length > 0, { timeout: 10000 }, reworkHost);
  assert.equal(dialect.prepare('SELECT status FROM quality_rework_routes WHERE disposition_request_id=?').get(disposition.id).status, 'running');

  await clickStable(page, `${reworkHost} [data-role="rw-complete"]`);
  await page.waitForSelector(`${reworkHost} [data-role="rw-retest"]`, { timeout: 10000 });
  const retest = await page.$eval(`${reworkHost} [data-role="rw-retest"]`, (node) => node.textContent);
  assert.match(retest, /REQUEST_ONLY/, 'the retest is proposed, not created');
  assert.equal(dialect.prepare('SELECT status FROM quality_rework_routes WHERE disposition_request_id=?').get(disposition.id).status, 'retest');

  assert.equal(consoleErrors.filter((message) => !/403/.test(message)).length, 0, consoleErrors.join('\n'));
});

test('real Chromium approves a scrap and proves Quality never moves the stock itself', async (t) => {
  const { consoleErrors, dialect, page, seed } = await openBuild09Browser(t, { name: 'quality-scrap-ui', initialPage: 'scrap_approval', extraModules: QUALITY_MODULES });
  const host = '[data-build09-page="scrap_approval"]';
  const fixture = seedHeldCheckpoint(dialect, seed);
  const { checkpointId } = await heldCheckpoint(page, dialect, seed, fixture, 'scrap');
  const checkpoint = await browserAction(page, 'quality:checkpoint_sync', { warehouse_id: seed.warehouse.id, checkpoint_id: checkpointId });
  assert.equal(checkpoint.status, 'ncr');

  const disposition = await browserAction(page, 'quality:disposition_request', {
    warehouse_id: seed.warehouse.id, checkpoint_id: checkpointId, disposition_type: 'scrap', quantity: 1,
    reason_code: 'IRREPARABLE_DEFECT', source_location_id: seed.source.locationId, destination_location_id: fixture.scrapLocationId,
  }, { user: 'inspector-scrap' });

  const stockBefore = Number(dialect.prepare('SELECT quantity FROM stock_quants WHERE company_id=? AND product_id=? AND location_id=?').get(seed.companyId, seed.productId, seed.source.locationId).quantity);

  await page.evaluate(() => window.switchPage('scrap_approval'));
  await page.waitForFunction((selector) => document.querySelectorAll(`${selector} [data-role="sc-open"]`).length > 0, { timeout: 15000 }, host);
  await clickStable(page, `${host} [data-role="sc-open"][data-disposition-id="${disposition.id}"]`);
  await page.waitForSelector(`${host} [data-role="sc-approve-form"]`, { timeout: 10000 });
  await page.type(`${host} [data-role="sc-approve-form"] [name="decision_notes"]`, 'Confirmed non-reworkable');
  await page.click(`${host} [data-role="sc-approve-form"] button[type="submit"]`);

  // Approving produces a canonical request; it does not post anything.
  await page.waitForSelector(`${host} [data-role="sc-canonical"]`, { timeout: 15000 });
  const canonicalPanel = await page.$eval(`${host} [data-role="sc-canonical"]`, (node) => node.textContent);
  assert.match(canonicalPanel, /stock:move:post/, 'the pending canonical action is named on screen');
  assert.equal(latinDigits(dialect.prepare('SELECT quantity FROM stock_quants WHERE company_id=? AND product_id=? AND location_id=?').get(seed.companyId, seed.productId, seed.source.locationId).quantity), String(stockBefore));

  await clickStable(page, `${host} [data-role="sc-request-canonical"]`);
  await page.waitForSelector(`${host} [data-role="sc-ack-form"]`, { timeout: 10000 });
  const pending = dialect.prepare('SELECT status,canonical_request_json FROM quality_disposition_requests WHERE id=?').get(disposition.id);
  assert.equal(pending.status, 'awaiting_canonical');
  assert.equal(Number(dialect.prepare('SELECT quantity FROM stock_quants WHERE company_id=? AND product_id=? AND location_id=?').get(seed.companyId, seed.productId, seed.source.locationId).quantity), stockBefore, 'requesting the scrap moved no stock');

  // A mismatched canonical move must be rejected before the real one is accepted.
  const request = JSON.parse(pending.canonical_request_json);
  const wrongMove = await browserAction(page, 'stock:move:post', { ...request, product_qty: Number(request.product_qty) + 1, idempotency_key: `${disposition.id}:wrong` }, { user: 'browser-inventory' });
  await page.type(`${host} [data-role="sc-ack-form"] [name="canonical_result_id"]`, wrongMove.id);
  await page.click(`${host} [data-role="sc-ack-form"] button[type="submit"]`);
  await page.waitForFunction((selector) => document.querySelector(selector)?.dataset.phase != null, { timeout: 10000 }, `${host} [data-role="sc-alert"]`);
  assert.match(await page.$eval(`${host} [data-role="sc-alert"]`, (node) => node.textContent), /does not match/i);
  assert.equal(dialect.prepare('SELECT status FROM quality_disposition_requests WHERE id=?').get(disposition.id).status, 'awaiting_canonical');

  // The matching canonical move is accepted, and only now does the stock actually leave.
  const move = await browserAction(page, 'stock:move:post', request, { user: 'browser-inventory' });
  assert.equal(move.state, 'done');
  await page.$eval(`${host} [data-role="sc-ack-form"] [name="canonical_result_id"]`, (input) => { input.value = ''; });
  await page.type(`${host} [data-role="sc-ack-form"] [name="canonical_result_id"]`, move.id);
  await page.click(`${host} [data-role="sc-ack-form"] button[type="submit"]`);

  await page.waitForSelector(`${host} [data-role="sc-completed"]`, { timeout: 10000 });
  const completed = dialect.prepare('SELECT status,canonical_result_id FROM quality_disposition_requests WHERE id=?').get(disposition.id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.canonical_result_id, move.id);
  assert.equal(dialect.prepare('SELECT status FROM quality_operational_checkpoints WHERE id=?').get(checkpointId).status, 'scrap');

  assert.equal(consoleErrors.filter((message) => !/403|409/.test(message)).length, 0, consoleErrors.join('\n'));
});
