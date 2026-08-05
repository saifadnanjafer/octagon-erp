import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createProductionOrder } from '../../platform/manufacturing/manufacturing-orders.mjs';
import { postStockMove } from '../../platform/inventory/ledger.mjs';
import { openBuild09Browser, browserAction, clickStable } from './browser-harness.mjs';

function seedProduction(dialect, seed) {
  const stamp = new Date().toISOString();
  dialect.prepare(`INSERT INTO boms(id,company_id,code,product_id,name_en,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run('bom-b09-material-browser', seed.companyId, 'BOM-B09-MAT', seed.productId, 'Material browser BOM', 'planner-a', stamp, stamp);
  dialect.prepare(`INSERT INTO bom_versions(id,company_id,bom_id,revision,state,approved_by,approved_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`)
    .run('bomv-b09-material-browser', seed.companyId, 'bom-b09-material-browser', 1, 'approved', 'approver-b', stamp, stamp, stamp);
  const order = createProductionOrder(dialect, {
    company_id: seed.companyId, product_id: seed.productId, planned_quantity: 10,
    bom_version_id: 'bomv-b09-material-browser', warehouse_id: seed.warehouse.id,
    wip_location_id: seed.destination.locationId, finished_location_id: seed.staging.locationId, actor: 'planner-a',
  });
  dialect.prepare(`INSERT INTO work_centers(id,company_id,code,name_ar,name_en,warehouse_id,wip_location_id,capacity_per_hour,efficiency_percent,working_hours_per_day,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('wc-b09-material-browser', seed.companyId, 'WC-B09-MAT', 'تجميع', 'Assembly', seed.warehouse.id, seed.destination.locationId, 12, 95, 8, 1, stamp, stamp);
  dialect.prepare(`INSERT INTO mfg_work_orders(id,company_id,production_order_id,operation_sequence,work_center_id,name,planned_setup_minutes,planned_run_minutes,quantity_to_produce,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('wo-b09-material-browser', seed.companyId, order.id, 10, 'wc-b09-material-browser', 'Assembly operation', 5, 60, 10, 'ready', stamp, stamp);
  dialect.prepare(`INSERT INTO mfg_material_requirements(id,company_id,production_order_id,component_id,required_quantity,warehouse_id,location_id,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run('mreq-b09-material-browser', seed.companyId, order.id, seed.productId, 10, seed.warehouse.id, seed.source.locationId, 'pending', stamp, stamp);
  dialect.prepare(`UPDATE mfg_production_orders SET state='released',planned_start_date=?,planned_end_date=?,updated_at=? WHERE id=?`)
    .run('2026-08-03T08:00:00.000Z', '2026-08-03T09:00:00.000Z', stamp, order.id);
  return { orderId: order.id, workOrderId: 'wo-b09-material-browser' };
}

async function lookup(page, resource, name, query, id) {
  const root = `[data-role="pmr-create"] [data-lookup-resource="${resource}"]:has(select[name="${name}"])`;
  await page.type(`${root} .b09-lookup-query`, query);
  await page.waitForFunction((selector, value) => [...document.querySelector(selector).options].some((option) => option.value === value), {}, `${root} .b09-lookup-select`, id);
  await page.select(`${root} .b09-lookup-select`, id);
}

async function waitRow(dialect, predicate, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const rows = dialect.prepare('SELECT * FROM mfg_material_flow_requests ORDER BY created_at DESC').all();
    const row = rows.find(predicate);
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('timed out waiting for material-flow row');
}

async function openPage(page, pageId) {
  await page.evaluate((id) => window.switchPage(id), pageId);
  await page.waitForFunction((id) => document.querySelector(`[data-build09-page="${id}"]`)?.classList.contains('page-active'), {}, pageId);
}

async function selectRow(page, prefix, id) {
  await clickStable(page, `[data-role="${prefix}-select"][data-id="${id}"]`);
}

async function requestAndAcknowledge({ dialect, page, prefix, requestId }) {
  await selectRow(page, prefix, requestId);
  await clickStable(page, `[data-role="${prefix}-request"][data-id="${requestId}"]`);
  const pending = await waitRow(dialect, (row) => row.id === requestId && row.status === 'awaiting_canonical');
  const move = postStockMove(dialect, JSON.parse(pending.canonical_request_json));
  await page.waitForSelector(`[data-role="${prefix}-ack"][data-id="${requestId}"] input[name="canonical_result_id"]`, { visible: true });
  await page.type(`[data-role="${prefix}-ack"][data-id="${requestId}"] input[name="canonical_result_id"]`, move.id);
  await clickStable(page, `[data-role="${prefix}-ack"][data-id="${requestId}"] button[type="submit"]`);
  await waitRow(dialect, (row) => row.id === requestId && row.status === 'completed');
  return move;
}

test('consolidated Chromium proves governed production issue return and receipt lifecycle', { timeout: 120000 }, async (t) => {
  const harness = await openBuild09Browser(t, {
    name: 'production-materials', initialPage: 'production_material_requests',
    extraModules: ['build09r-shared.js', 'build09-production-material-workspaces.js'],
  });
  const { consoleErrors, dialect, page, seed, switchAuthenticatedUser } = harness;
  const fixture = seedProduction(dialect, seed);
  const initialMoves = dialect.prepare('SELECT COUNT(*) count FROM stock_moves').get().count;

  await lookup(page, 'productionOrders', 'production_order_id', 'MO-', fixture.orderId);
  await lookup(page, 'workOrders', 'work_order_id', 'Assembly', fixture.workOrderId);
  await lookup(page, 'products', 'product_id', 'Browser Product', seed.productId);
  await lookup(page, 'locations', 'source_location_id', 'Browser Pick', seed.source.locationId);
  await lookup(page, 'locations', 'destination_location_id', 'Browser Putaway', seed.destination.locationId);
  await page.type('[data-role="pmr-create"] input[name="requested_quantity"]', '6');
  await page.select('[data-role="pmr-create"] select[name="request_type"]', 'issue');
  await clickStable(page, '[data-role="pmr-create"] button[type="submit"]');
  const issue = await waitRow(dialect, (row) => row.request_type === 'issue' && row.requested_by === 'browser-manager');

  const readable = await page.$eval('[data-role="pmr-body"]', (node) => node.innerText);
  for (const expected of ['Browser Product', 'Assembly', 'Browser Pick Bin']) assert.match(readable, new RegExp(expected));
  assert.doesNotMatch(readable, /\{\s*"|raw json/i);
  await selectRow(page, 'pmr', issue.id);
  await clickStable(page, `[data-role="pmr-check"][data-id="${issue.id}"]`);
  const checked = await waitRow(dialect, (row) => row.id === issue.id && row.status === 'availability_checked');
  assert.equal(Number(checked.available_quantity), 20);
  assert.equal(Number(checked.shortage_quantity), 0);

  await clickStable(page, `[data-role="pmr-approve"][data-id="${issue.id}"]`);
  await page.waitForSelector('[data-role="pmr-alert"][data-phase="denied"]', { visible: true });
  assert.equal(dialect.prepare('SELECT status FROM mfg_material_flow_requests WHERE id=?').get(issue.id).status, 'availability_checked');

  await switchAuthenticatedUser('browser-picker');
  await selectRow(page, 'pmr', issue.id);
  await clickStable(page, `[data-role="pmr-approve"][data-id="${issue.id}"]`);
  await waitRow(dialect, (row) => row.id === issue.id && row.status === 'task_created' && row.approved_by === 'browser-picker');
  assert.equal(dialect.prepare('SELECT COUNT(*) count FROM stock_moves').get().count, initialMoves, 'approval must not write Inventory');

  await openPage(page, 'production_issue_return');
  const issueMove = await requestAndAcknowledge({ dialect, page, prefix: 'pmi', requestId: issue.id });

  const returnRequest = await browserAction(page, 'shopfloor:material_request', {
    warehouse_id: seed.warehouse.id,
    production_order_id: fixture.orderId, work_order_id: fixture.workOrderId, request_type: 'return',
    product_id: seed.productId, requested_quantity: 2, source_location_id: seed.destination.locationId,
    destination_location_id: seed.source.locationId,
  }, { user: 'browser-manager', warehouse: seed.warehouse.id });
  await browserAction(page, 'shopfloor:material_availability', { warehouse_id: seed.warehouse.id, request_id: returnRequest.id }, { user: 'browser-manager', warehouse: seed.warehouse.id });
  await browserAction(page, 'shopfloor:material_approve', { warehouse_id: seed.warehouse.id, request_id: returnRequest.id }, { user: 'browser-picker', warehouse: seed.warehouse.id });
  await openPage(page, 'production_issue_return');
  const returnMove = await requestAndAcknowledge({ dialect, page, prefix: 'pmi', requestId: returnRequest.id });

  await switchAuthenticatedUser('browser-manager');
  await lookup(page, 'productionOrders', 'production_order_id', 'MO-', fixture.orderId);
  await lookup(page, 'workOrders', 'work_order_id', 'Assembly', fixture.workOrderId);
  await lookup(page, 'products', 'product_id', 'Browser Product', seed.productId);
  await lookup(page, 'locations', 'source_location_id', 'Browser Putaway', seed.destination.locationId);
  await lookup(page, 'locations', 'destination_location_id', 'Browser Staging', seed.staging.locationId);
  await page.type('[data-role="pmr-create"] input[name="requested_quantity"]', '3');
  await page.select('[data-role="pmr-create"] select[name="request_type"]', 'production_receipt');
  await clickStable(page, '[data-role="pmr-create"] button[type="submit"]');
  const receipt = await waitRow(dialect, (row) => row.request_type === 'production_receipt' && row.requested_by === 'browser-manager');
  await browserAction(page, 'shopfloor:material_availability', { warehouse_id: seed.warehouse.id, request_id: receipt.id }, { user: 'browser-manager', warehouse: seed.warehouse.id });
  await browserAction(page, 'shopfloor:material_approve', { warehouse_id: seed.warehouse.id, request_id: receipt.id }, { user: 'browser-picker', warehouse: seed.warehouse.id });

  // The actual material-flow contract has no mandatory Quality gate. Prove that boundary,
  // then complete Quality through its registered canonical authority before posting Inventory.
  const pendingQuality = dialect.prepare("SELECT state FROM quality_inspections WHERE source_id=?").get(fixture.workOrderId);
  assert.equal(pendingQuality, undefined, 'material-flow must not fabricate a Quality inspection');
  const plan = await browserAction(page, 'quality:plan:create', { name: 'Receipt acceptance', code: 'QP-RECEIPT-MAT' }, { user: 'browser-manager', warehouse: seed.warehouse.id });
  const inspection = await browserAction(page, 'quality:inspection:create', {
    plan_id: plan.id, inspection_type: 'final', source_type: 'work_order', source_id: fixture.workOrderId,
    product_id: seed.productId, sample_size: 3,
  }, { user: 'browser-manager', warehouse: seed.warehouse.id });
  await browserAction(page, 'quality:inspection:record_results', { inspection_id: inspection.id, pass_fail: 'pass', notes: 'Canonical Quality acceptance' }, { user: 'browser-manager', warehouse: seed.warehouse.id });
  assert.equal(dialect.prepare('SELECT state FROM quality_inspections WHERE id=?').get(inspection.id).state, 'pass');

  await switchAuthenticatedUser('browser-picker');
  await openPage(page, 'production_receipt');
  const receiptText = await page.$eval('[data-role="prc-body"]', (node) => node.innerText);
  for (const expected of ['Browser Product', 'Browser Staging', 'الجودة']) assert.match(receiptText, new RegExp(expected, 'i'));
  const receiptMove = await requestAndAcknowledge({ dialect, page, prefix: 'prc', requestId: receipt.id });
  await page.waitForSelector(`[data-role="prc-reference"]`, { visible: true });
  assert.match(await page.$eval('[data-role="prc-reference"]', (node) => node.innerText), new RegExp(receiptMove.id));
  await clickStable(page, '[data-role="prc-trace"]');
  await page.waitForFunction(() => document.querySelector('[data-build09-page="lot_serial_traceability"]')?.classList.contains('page-active'));

  await assert.rejects(() => browserAction(page, 'shopfloor:material_request', {
    warehouse_id: seed.warehouse.id,
    production_order_id: fixture.orderId, request_type: 'issue', product_id: seed.productId, requested_quantity: 1,
    source_location_id: seed.source.locationId, destination_location_id: seed.destination.locationId,
  }, { user: 'viewer-user', warehouse: seed.warehouse.id }), /403|Permission denied/);
  await assert.rejects(() => browserAction(page, 'shopfloor:material_request', {
    warehouse_id: seed.warehouse.id,
    production_order_id: fixture.orderId, request_type: 'issue', product_id: seed.productId, requested_quantity: 1,
    source_location_id: seed.source.locationId, destination_location_id: seed.destination.locationId,
  }, { user: 'browser-manager', company: 'outside-company', warehouse: seed.warehouse.id }), /403|scope|outside/i);
  await assert.rejects(() => browserAction(page, 'shopfloor:material_request', {
    warehouse_id: 'outside-warehouse',
    production_order_id: fixture.orderId, request_type: 'issue', product_id: seed.productId, requested_quantity: 1,
    source_location_id: seed.source.locationId, destination_location_id: seed.destination.locationId,
  }, { user: 'browser-manager', warehouse: 'outside-warehouse' }), /403|scope|outside/i);

  assert.equal(dialect.prepare('SELECT COUNT(*) count FROM stock_moves').get().count, initialMoves + 3);
  assert.deepEqual(
    dialect.prepare('SELECT id FROM stock_moves WHERE id IN (?,?,?) ORDER BY id').all(issueMove.id, returnMove.id, receiptMove.id).map((row) => row.id).sort(),
    [issueMove.id, returnMove.id, receiptMove.id].sort(),
  );
  const source = fs.readFileSync(new URL('../../modules/build09-production-material-workspaces.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /stock:move:post|INSERT\s+INTO\s+stock_|UPDATE\s+stock_/i, 'browser workspace must not bypass canonical Inventory');
  assert.doesNotMatch(source, /placeholder|coming soon|TODO/i);
  assert.equal(consoleErrors.filter((message) => !/403|Permission denied/i.test(message)).length, 0, consoleErrors.join('\n'));
});
