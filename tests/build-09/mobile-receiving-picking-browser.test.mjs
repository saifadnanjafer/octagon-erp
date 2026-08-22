import assert from 'node:assert/strict';
import test from 'node:test';
import { browserAction, openBuild09Browser } from './browser-harness.mjs';

// Real Chromium flow (BUILD-09R-2): drives the purpose-built Mobile Receiving and Mobile
// Picking workspaces (modules/build09-mobile-receiving.js, modules/build09-mobile-picking.js)
// through real clicks/typing/governed-lookup search - not page.evaluate(fetch(...)) - proving
// the step-by-step scanning UI actually renders and transitions, not just that the action
// contracts work (operational-browser-chromium.test.mjs already proves the contracts).
test('real Chromium drives the Mobile Receiving scanning workspace end to end', async (t) => {
  const { consoleErrors, dialect, page, seed } = await openBuild09Browser(t, { name: 'mobile-receiving-ui', initialPage: 'mobile_receiving' });
  const host = '[data-build09-page="mobile_receiving"]';

  await page.waitForSelector(`${host} [data-role="mr-start-form"]`, { timeout: 15000 });
  await page.type(`${host} [data-role="mr-start-form"] [name="reference"]`, 'PO-UI-TEST');
  await page.select(`${host} [data-role="mr-start-form"] [name="receipt_type"]`, 'purchase_order');
  await page.click(`${host} [data-role="mr-start-form"] button[type="submit"]`);

  await page.waitForSelector(`${host} [data-role="mr-reference-form"]`, { timeout: 10000 });
  const prefilled = await page.$eval(`${host} [data-role="mr-reference-form"] [name="reference"]`, (input) => input.value);
  assert.equal(prefilled, 'PO-UI-TEST');
  await page.click(`${host} [data-role="mr-reference-form"] button[type="submit"]`);

  await page.waitForSelector(`${host} [data-role="mr-scan-form"]`, { timeout: 10000 });
  await page.type(`${host} [data-role="mr-scan-form"] [name="barcode"]`, 'B09-BARCODE');
  await page.type(`${host} [data-lookup-resource="products"] .b09-lookup-query`, 'Browser Product');
  await page.waitForFunction((selector) => {
    const select = document.querySelector(selector);
    return select && select.options.length > 1;
  }, { timeout: 5000 }, `${host} [data-lookup-resource="products"] .b09-lookup-select`);
  await page.select(`${host} [data-lookup-resource="products"] .b09-lookup-select`, seed.productId);
  await page.type(`${host} [data-role="mr-scan-form"] [name="expected_quantity"]`, '8');
  await page.type(`${host} [data-role="mr-scan-form"] [name="quantity"]`, '8');
  await page.type(`${host} [data-role="mr-scan-form"] [name="lot_code"]`, 'B09-LOT-UI');
  await page.type(`${host} [data-lookup-resource="locations"] .b09-lookup-query`, 'Browser Putaway');
  await page.waitForFunction((selector) => {
    const select = document.querySelector(selector);
    return select && select.options.length > 1;
  }, { timeout: 5000 }, `${host} [data-lookup-resource="locations"] .b09-lookup-select`);
  await page.select(`${host} [data-lookup-resource="locations"] .b09-lookup-select`, seed.destination.locationId);
  await page.click(`${host} [data-role="mr-scan-form"] button[type="submit"]`);

  await page.waitForFunction((selector) => document.querySelector(selector)?.textContent.includes('B09-BARCODE'), { timeout: 10000 }, `${host} [data-role="mr-scan-list"]`);
  await page.click(`${host} [data-role="mr-goto-review"]`);

  await page.waitForSelector(`${host} [data-role="mr-post-form"]`, { timeout: 10000 });
  const lookups = await page.$$(`${host} [data-role="mr-post-form"] [data-lookup-resource="locations"]`);
  assert.equal(lookups.length, 2, 'review panel should offer source and destination location lookups');
  await page.type(`${host} [data-role="mr-post-form"] [data-lookup-resource="locations"]:nth-of-type(1) .b09-lookup-query`, 'Browser Pick');
  await page.waitForFunction((selector) => {
    const select = document.querySelector(selector);
    return select && select.options.length > 1;
  }, { timeout: 5000 }, `${host} [data-role="mr-post-form"] [data-lookup-resource="locations"]:nth-of-type(1) .b09-lookup-select`);
  await page.select(`${host} [data-role="mr-post-form"] [data-lookup-resource="locations"]:nth-of-type(1) .b09-lookup-select`, seed.source.locationId);
  await page.type(`${host} [data-role="mr-post-form"] [data-lookup-resource="locations"]:nth-of-type(2) .b09-lookup-query`, 'Browser Putaway');
  await page.waitForFunction((selector) => {
    const select = document.querySelector(selector);
    return select && select.options.length > 1;
  }, { timeout: 5000 }, `${host} [data-role="mr-post-form"] [data-lookup-resource="locations"]:nth-of-type(2) .b09-lookup-select`);
  await page.select(`${host} [data-role="mr-post-form"] [data-lookup-resource="locations"]:nth-of-type(2) .b09-lookup-select`, seed.destination.locationId);
  await page.type(`${host} [data-role="mr-post-form"] [name="picking_type_id"]`, 'incoming-browser-b09');
  await page.click(`${host} [data-role="mr-post-form"] button[type="submit"]`);

  await page.waitForSelector(`${host} [data-role="mr-acknowledge"]`, { timeout: 10000 });
  const session = dialect.prepare('SELECT status FROM wms_receiving_sessions WHERE reference=?').get('PO-UI-TEST');
  assert.equal(session.status, 'awaiting_canonical');
  const line = dialect.prepare('SELECT received_quantity, lot_id FROM wms_receiving_lines WHERE product_id=? ORDER BY created_at DESC LIMIT 1').get(seed.productId);
  assert.equal(Number(line.received_quantity), 8);

  // The linked canonical picking has not been validated yet (that is a separate Inventory
  // actor's step, proven by operational-browser-chromium.test.mjs) - acknowledging here
  // must fail cleanly through the UI's own guarded() error path, not throw.
  await page.click(`${host} [data-role="mr-acknowledge"]`);
  // .b09-status also matches the (hidden, display:none) generic workspace status paragraph
  // that ships in every host's markup - scope to the override's own body to avoid matching it.
  await page.waitForFunction((selector) => document.querySelector(selector)?.dataset.phase === 'failed', { timeout: 5000 }, `${host} [data-role="mr-body"] .b09-status`);
  assert.equal(consoleErrors.filter((message) => !message.includes('409 (Conflict)')).length, 0, consoleErrors.join('\n'));
});

test('real Chromium dispatches from Pick Task Queue then drives Mobile Picking to canonical completion', async (t) => {
  const { consoleErrors, dialect, page, seed, switchAuthenticatedUser } = await openBuild09Browser(t, { name: 'mobile-picking-ui', initialPage: 'pick_task_queue', extraModules: ['build09r-shared.js', 'build09-pick-task-queue-workspace.js'] });
  const scope = { warehouse_id: seed.warehouse.id };
  const host = '[data-build09-page="mobile_picking"]';
  const queue = '[data-build09-page="pick_task_queue"]';

  const task = await browserAction(page, 'wms:pick_task_create', { ...scope, picking_type: 'sales_delivery', source_document_id: 'sale-ui-test', source_line_id: 'line-ui-test', product_id: seed.productId, source_location_id: seed.source.locationId, staging_location_id: seed.staging.locationId, destination_location_id: seed.staging.locationId, quantity: 5, strategy: 'fifo', route_sequence: 10 });

  await page.evaluate(() => window.switchPage('pick_task_queue'));
  await page.waitForSelector(`${queue} [data-role="pd-select"]`, { timeout: 10000 });
  await page.click(`${queue} [data-role="pd-select"][data-task-id="${task.id}"]`);
  await page.type(`${queue} [data-role="pd-assign"] .b09-lookup-query`, 'browser-picker');
  await page.waitForFunction((selector) => document.querySelector(selector)?.options.length > 1, { timeout: 5000 }, `${queue} [data-role="pd-assign"] .b09-lookup-select`);
  await page.select(`${queue} [data-role="pd-assign"] .b09-lookup-select`, 'browser-picker');
  await page.click(`${queue} [data-role="pd-assign"] button[type="submit"]`);
  await page.waitForFunction((selector) => document.querySelector(selector)?.textContent.includes('browser-picker'), { timeout: 10000 }, `${queue} [data-role="pd-list"]`);
  await page.select(`${queue} [data-role="pd-filter"]`, 'assigned');
  await page.waitForSelector(`${queue} [data-role="pd-select"][data-task-id="${task.id}"]`, { timeout: 10000 });
  assert.equal(dialect.prepare('SELECT assigned_to,status FROM wms_pick_tasks_v2 WHERE id=?').get(task.id).assigned_to, 'browser-picker');
  await switchAuthenticatedUser('browser-picker');
  assert.equal(await page.evaluate(() => window.OctagonRuntimeContext.actorId), 'browser-picker');
  await page.evaluate(() => window.switchPage('mobile_picking'));
  await page.waitForFunction((selector) => document.querySelectorAll(`${selector} [data-role="pt-queue-list"] .b09r-queue-row`).length > 0, { timeout: 10000 }, host);
  await page.click(`${host} [data-role="pt-select"][data-task-id="${task.id}"]`);

  assert.equal(dialect.prepare('SELECT status,assigned_to FROM wms_pick_tasks_v2 WHERE id=?').get(task.id).assigned_to, 'browser-picker');

  await page.waitForSelector(`${host} [data-role="pt-source-form"]`, { timeout: 10000 });
  await page.type(`${host} [data-role="pt-source-form"] [name="barcode"]`, 'B-PICK');
  await page.click(`${host} [data-role="pt-source-form"] button[type="submit"]`);

  await page.waitForSelector(`${host} [data-role="pt-product-form"]`, { timeout: 10000 });
  await page.type(`${host} [data-role="pt-product-form"] [name="barcode"]`, 'B09-BARCODE');
  await page.click(`${host} [data-role="pt-product-form"] button[type="submit"]`);

  await page.waitForSelector(`${host} [data-role="pt-confirm-form"]`, { timeout: 10000 });
  await page.$eval(`${host} [data-role="pt-confirm-form"] [name="quantity"]`, (input) => { input.value = ''; });
  await page.type(`${host} [data-role="pt-confirm-form"] [name="quantity"]`, '5');
  await page.click(`${host} [data-role="pt-confirm-form"] button[type="submit"]`);

  await page.waitForSelector(`${host} [data-lookup-resource="locations"]`, { timeout: 10000 });
  await page.type(`${host} [data-lookup-resource="locations"] .b09-lookup-query`, 'Browser Staging');
  await page.waitForFunction((selector) => {
    const select = document.querySelector(selector);
    return select && select.options.length > 1;
  }, { timeout: 5000 }, `${host} [data-lookup-resource="locations"] .b09-lookup-select`);
  await page.select(`${host} [data-lookup-resource="locations"] .b09-lookup-select`, seed.staging.locationId);
  await page.click(`${host} [data-role="pt-stage"]`);

  await page.waitForSelector(`${host} [data-role="pt-request-post"]`, { timeout: 10000 });
  await page.click(`${host} [data-role="pt-request-post"]`);

  await page.waitForSelector(`${host} [data-role="pt-ack-form"]`, { timeout: 10000 });
  const pending = dialect.prepare('SELECT status,canonical_request_json FROM wms_pick_tasks_v2 WHERE id=?').get(task.id);
  assert.equal(pending.status, 'awaiting_canonical');
  const canonicalRequest = JSON.parse(pending.canonical_request_json);
  const move = await browserAction(page, 'stock:move:post', canonicalRequest, { user: 'browser-inventory' });
  assert.equal(move.state, 'done');

  await page.type(`${host} [data-role="pt-ack-form"] [name="canonical_result_id"]`, move.id);
  await page.click(`${host} [data-role="pt-ack-form"] button[type="submit"]`);

  await page.waitForFunction((selector) => document.querySelector(selector)?.textContent.includes('✓'), { timeout: 10000 }, `${host} .b09r-success`);
  assert.equal(dialect.prepare('SELECT status FROM wms_pick_tasks_v2 WHERE id=?').get(task.id).status, 'completed');
  await switchAuthenticatedUser('browser-manager');
  await page.evaluate(() => window.switchPage('pick_task_queue'));
  await page.select(`${queue} [data-role="pd-filter"]`, 'completed');
  await page.waitForFunction((selector) => document.querySelector(selector)?.textContent.includes('completed'), { timeout: 10000 }, `${queue} [data-role="pd-list"]`);
  assert.equal(consoleErrors.length, 0, consoleErrors.join('\n'));
});
