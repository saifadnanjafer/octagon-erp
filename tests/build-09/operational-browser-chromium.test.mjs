import assert from 'node:assert/strict';
import test from 'node:test';
import { browserAction, browserQuery, openBuild09Browser } from './browser-harness.mjs';

test('real Chromium completes mobile receipt, canonical receipt, scanned putaway, and canonical transfer', async (t) => {
  const { consoleErrors, dialect, page, seed } = await openBuild09Browser(t, { name: 'inbound', initialPage: 'mobile_receiving' });
  const scope = { warehouse_id: seed.warehouse.id };
  const receipt = await browserAction(page, 'wms:receiving_start', { ...scope, receipt_type: 'purchase_order', reference: 'PO-BROWSER-09', source_document_id: 'po-browser-09', expected_line_count: 1, over_receipt_tolerance: 5 });
  await browserAction(page, 'wms:receiving_scan_reference', { ...scope, session_id: receipt.id, reference: 'PO-BROWSER-09' });
  const scanned = await browserAction(page, 'wms:receiving_scan_product', { ...scope, session_id: receipt.id, product_id: seed.productId, barcode: 'B09-BARCODE', uom_id: 'unit', expected_quantity: 8, quantity: 8, lot_code: 'B09-LOT-1', manufacture_date: '2026-08-01', expiry_date: '2027-08-01', destination_location_id: seed.warehouse.input_location_id });
  assert.equal(scanned.session.status, 'scanning');
  assert.equal((await browserAction(page, 'wms:receiving_review', { ...scope, session_id: receipt.id }, { user: 'browser-reviewer' })).status, 'ready');

  const picking = await browserAction(page, 'wms:picking:create', { picking_type_id: 'incoming-browser-b09', reference: 'PO-BROWSER-09', location_id: seed.supplier.id, location_dest_id: seed.warehouse.input_location_id });
  const pendingReceipt = await browserAction(page, 'wms:receiving_request_post', { ...scope, session_id: receipt.id, picking_id: picking.id }, { user: 'browser-reviewer' });
  assert.equal(pendingReceipt.inventoryWritten, false);
  const postedReceipt = await browserAction(page, 'wms:picking:validate', { picking_id: picking.id, moves: [{ product_id: seed.productId, uom_id: 'unit', product_qty: 8, unit_cost: 10 }] }, { user: 'browser-inventory' });
  assert.equal(postedReceipt.state, 'done');
  assert.equal((await browserAction(page, 'wms:receiving_acknowledge_post', { ...scope, session_id: receipt.id }, { user: 'browser-reviewer' })).status, 'putaway_pending');

  const recommendation = await browserAction(page, 'wms:putaway_recommend', { ...scope, product_id: seed.productId, quantity: 8, source_location_id: seed.warehouse.input_location_id, quality_status: 'released' });
  const accepted = await browserAction(page, 'wms:putaway_accept', { ...scope, recommendation_id: recommendation.id, assigned_to: 'browser-putaway' });
  const task = accepted.tasks[0];
  await browserAction(page, 'wms:task_scan_source', { ...scope, task_id: task.id, barcode: seed.warehouse.input_location_id }, { user: 'browser-putaway' });
  await browserAction(page, 'wms:task_scan_destination', { ...scope, task_id: task.id, barcode: 'B-PUT' }, { user: 'browser-putaway' });
  const pendingMove = await browserAction(page, 'wms:task_request_canonical', { ...scope, task_id: task.id }, { user: 'browser-putaway' });
  assert.equal(pendingMove.canonicalRequest.uom_id, 'unit');
  const canonicalMove = await browserAction(page, 'stock:move:post', pendingMove.canonicalRequest, { user: 'browser-inventory' });
  assert.equal(canonicalMove.state, 'done');
  assert.equal((await browserAction(page, 'wms:task_acknowledge_canonical', { ...scope, task_id: task.id, canonical_result_id: canonicalMove.id }, { user: 'browser-putaway' })).status, 'completed');
  assert.equal((await browserAction(page, 'wms:receiving_complete', { ...scope, session_id: receipt.id }, { user: 'browser-reviewer' })).status, 'completed');
  assert.equal(dialect.prepare('SELECT quantity FROM stock_quants WHERE company_id=? AND product_id=? AND location_id=?').get(seed.companyId, seed.productId, seed.destination.locationId).quantity, 8);

  await page.evaluate(() => window.switchPage('putaway_task_queue'));
  await page.waitForFunction(() => document.querySelector('[data-build09-page="putaway_task_queue"] tbody tr[data-record-id]'));
  await page.setViewport({ width: 390, height: 844 });
  assert.equal(await page.$eval('[data-build09-page="putaway_task_queue"] .b09-table td', (element) => getComputedStyle(element).display), 'grid');
  assert.equal(consoleErrors.length, 0, consoleErrors.join('\n'));
  assert.equal((await browserQuery(page, 'putaway-queue', { user: 'viewer-user', warehouse: seed.warehouse.id })).status, 403);
  assert.equal((await browserQuery(page, 'putaway-queue', { company: 'company-b', warehouse: seed.warehouse.id })).status, 403);
  assert.equal(consoleErrors.filter((message) => !message.includes('403 (Forbidden)')).length, 0, consoleErrors.join('\n'));
});

test('real Chromium completes wave release, mobile scans, short pick, staging, canonical moves, and wave completion', async (t) => {
  const { consoleErrors, dialect, page, seed } = await openBuild09Browser(t, { name: 'outbound', initialPage: 'wave_planning' });
  const scope = { warehouse_id: seed.warehouse.id };
  const createTask = (key, quantity, sequence) => browserAction(page, 'wms:pick_task_create', { ...scope, picking_type: 'sales_delivery', source_document_id: `sale-${key}`, source_line_id: `line-${key}`, product_id: seed.productId, source_location_id: seed.source.locationId, staging_location_id: seed.staging.locationId, destination_location_id: seed.staging.locationId, quantity, strategy: 'fifo', route_sequence: sequence });
  const first = await createTask('browser-a', 6, 10); const second = await createTask('browser-b', 4, 20);
  const wave = await browserAction(page, 'wms:wave_create', { ...scope, name: 'Browser outbound wave', wave_type: 'batch', grouping_strategy: 'route', staging_location_id: seed.staging.locationId, operator_id: 'browser-picker', criteria: { picking_type: 'sales_delivery' } });
  assert.equal((await browserAction(page, 'wms:wave_calculate', { ...scope, wave_id: wave.id })).taskCount, 2);
  await browserAction(page, 'wms:wave_review', { ...scope, wave_id: wave.id }, { user: 'browser-supervisor' });
  assert.equal((await browserAction(page, 'wms:wave_release', { ...scope, wave_id: wave.id }, { user: 'browser-manager-2' })).status, 'released');

  async function completePick(task, quantity, shortReason = null) {
    await browserAction(page, 'wms:pick_scan_source', { ...scope, task_id: task.id, barcode: 'B-PICK' }, { user: 'browser-picker' });
    await browserAction(page, 'wms:pick_scan_product', { ...scope, task_id: task.id, barcode: 'B09-BARCODE' }, { user: 'browser-picker' });
    const picked = await browserAction(page, 'wms:pick_confirm', { ...scope, task_id: task.id, quantity, short_reason: shortReason }, { user: 'browser-picker' });
    await browserAction(page, 'wms:pick_stage', { ...scope, task_id: task.id, staging_location_id: seed.staging.locationId }, { user: 'browser-picker' });
    const pending = await browserAction(page, 'wms:pick_request_post', { ...scope, task_id: task.id }, { user: 'browser-picker' });
    assert.equal(pending.canonicalRequest.uom_id, 'unit');
    const move = await browserAction(page, 'stock:move:post', pending.canonicalRequest, { user: 'browser-inventory' });
    const completed = await browserAction(page, 'wms:pick_acknowledge_post', { ...scope, task_id: task.id, canonical_result_id: move.id }, { user: 'browser-picker' });
    return { picked, completed };
  }
  const short = await completePick(first, 5, 'One unit damaged at the pick face');
  assert.equal(short.picked.shortQuantity, 1); assert.equal(short.completed.status, 'completed');
  assert.equal((await completePick(second, 4)).completed.status, 'completed');
  assert.equal((await browserAction(page, 'wms:wave_complete', { ...scope, wave_id: wave.id }, { user: 'browser-manager-2' })).status, 'completed');
  assert.equal(dialect.prepare('SELECT quantity FROM stock_quants WHERE company_id=? AND product_id=? AND location_id=?').get(seed.companyId, seed.productId, seed.staging.locationId).quantity, 9);

  await page.evaluate(() => { document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr'; window.switchPage('wave_execution'); });
  await page.waitForFunction(() => document.querySelector('[data-build09-page="wave_execution"] tbody tr[data-record-id]'));
  assert.equal(await page.$eval('html', (element) => element.dir), 'ltr');
  await page.evaluate(() => { window.__BUILD09_FORCE_READ_ONLY__ = true; window.OctagonBuild09.renderPage('wave_execution'); });
  assert.ok(await page.$eval('[data-build09-page="wave_execution"] [data-action]', (button) => button.disabled));
  assert.equal(consoleErrors.length, 0, consoleErrors.join('\n'));
});
