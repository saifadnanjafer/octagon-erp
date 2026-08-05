import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductionOrder } from '../../platform/manufacturing/manufacturing-orders.mjs';
import { browserAction, clickStable, latinDigits, openBuild09Browser } from './browser-harness.mjs';

// BUILD-09R-2 Group D: real Chromium drives the Shop-Floor Terminal and the Work-Center Queue
// (modules/build09-shopfloor-workspace.js) through visible controls only.
//
// The central assertion is the canonical boundary: pressing Start must NOT make the terminal
// claim the operation is running. platform/manufacturing/shopfloor.mjs only records a request;
// the session sits in awaiting_canonical until canonical Manufacturing actually starts the work
// order and the operator acknowledges it. A terminal that optimistically showed "running" would
// tell the shop floor a machine is live when it is not.

const SHOPFLOOR_MODULES = ['build09r-shared.js', 'build09-shopfloor-workspace.js'];

function seedWorkOrders(dialect, seed, count = 1) {
  const stamp = new Date().toISOString();
  dialect.prepare(`INSERT INTO boms(id,company_id,code,product_id,name_en,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run('bom-b09r2-sf', seed.companyId, 'BOM-B09R2-SF', seed.productId, 'Group D BOM', 'planner-a', stamp, stamp);
  dialect.prepare(`INSERT INTO bom_versions(id,company_id,bom_id,revision,state,approved_by,approved_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`)
    .run('bomv-b09r2-sf', seed.companyId, 'bom-b09r2-sf', 1, 'approved', 'approver-b', stamp, stamp, stamp);
  const order = createProductionOrder(dialect, {
    company_id: seed.companyId, product_id: seed.productId, planned_quantity: 10, bom_version_id: 'bomv-b09r2-sf',
    warehouse_id: seed.warehouse.id, wip_location_id: seed.destination.locationId, finished_location_id: seed.staging.locationId, actor: 'planner-a',
  });
  dialect.prepare(`INSERT INTO work_centers(id,company_id,code,name_ar,name_en,warehouse_id,wip_location_id,capacity_per_hour,efficiency_percent,working_hours_per_day,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('wc-b09r2-sf', seed.companyId, 'WC-B09R2-SF', 'تجميع', 'Assembly', seed.warehouse.id, seed.destination.locationId, 12, 95, 8, 1, stamp, stamp);
  const workOrders = [];
  for (let index = 0; index < count; index += 1) {
    const id = `wo-b09r2-sf-${index}`;
    dialect.prepare(`INSERT INTO mfg_work_orders(id,company_id,production_order_id,operation_sequence,work_center_id,name,planned_setup_minutes,planned_run_minutes,quantity_to_produce,state,planned_start_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, seed.companyId, order.id, 10 + index, 'wc-b09r2-sf', `Assembly operation ${index}`, 5, 60, 10, 'ready', `2026-08-0${3 + index}T08:00:00.000Z`, stamp, stamp);
    workOrders.push(id);
  }
  dialect.prepare(`UPDATE mfg_production_orders SET state='released',planned_start_date=?,planned_end_date=?,updated_at=? WHERE id=?`)
    .run('2026-08-03T08:00:00.000Z', '2026-08-03T09:00:00.000Z', stamp, order.id);
  return { orderId: order.id, workCenterId: 'wc-b09r2-sf', workOrders };
}

test('real Chromium runs the shop-floor terminal and never claims a transition Manufacturing has not made', async (t) => {
  const { consoleErrors, dialect, page, seed } = await openBuild09Browser(t, { name: 'shopfloor-terminal-ui', initialPage: 'shopfloor_terminal', extraModules: SHOPFLOOR_MODULES });
  const host = '[data-build09-page="shopfloor_terminal"]';
  const fixture = seedWorkOrders(dialect, seed);
  const opened = await browserAction(page, 'shopfloor:session_open', { warehouse_id: seed.warehouse.id, work_order_id: fixture.workOrders[0], operator_id: 'operator-a', shift_code: 'A', instructions: 'Torque to 42Nm' });
  assert.equal(opened.status, 'assigned');

  await page.evaluate(() => window.switchPage('shopfloor_terminal'));
  await page.waitForFunction((selector) => document.querySelectorAll(`${selector} [data-role="sf-open"]`).length > 0, { timeout: 15000 }, host);
  await clickStable(page, `${host} [data-role="sf-open"][data-session-id="${opened.id}"]`);

  await page.waitForSelector(`${host} [data-role="sf-active"]`, { timeout: 10000 });
  assert.equal(await page.$eval(`${host} [data-role="sf-operator"]`, (node) => node.textContent.trim()), 'operator-a');
  assert.match(await page.$eval(`${host} [data-role="sf-instructions"]`, (node) => node.textContent), /Torque to 42Nm/);

  // Start is a REQUEST. The terminal must show the waiting state, not "running".
  await clickStable(page, `${host} [data-role="sf-start"]`);
  await page.waitForSelector(`${host} [data-role="sf-awaiting"]`, { timeout: 10000 });
  const awaiting = await page.$eval(`${host} [data-role="sf-awaiting"]`, (node) => node.textContent);
  assert.match(awaiting, /manufacturing:work_order:start/, 'the pending canonical action is named on screen');
  assert.equal(dialect.prepare('SELECT status FROM mfg_shopfloor_sessions WHERE id=?').get(opened.id).status, 'awaiting_canonical');
  assert.equal(dialect.prepare('SELECT state FROM mfg_work_orders WHERE id=?').get(fixture.workOrders[0]).state, 'ready', 'the terminal did not move the canonical work order itself');
  // No output pad while awaiting canonical - the operation is not running yet.
  assert.equal(await page.$(`${host} [data-role="sf-output-form"]`), null);

  // Canonical Manufacturing does its half, then the operator acknowledges from the terminal.
  await browserAction(page, 'manufacturing:work_order:start', { work_order_id: fixture.workOrders[0] }, { user: 'mfg-controller' });
  await clickStable(page, `${host} [data-role="sf-acknowledge"]`);
  await page.waitForSelector(`${host} [data-role="sf-output-form"]`, { timeout: 10000 });
  assert.equal(dialect.prepare('SELECT status FROM mfg_shopfloor_sessions WHERE id=?').get(opened.id).status, 'running');

  // The elapsed clock only exists once the operation actually started.
  const elapsed = await page.$eval(`${host} [data-role="sf-elapsed"]`, (node) => node.textContent.trim());
  assert.doesNotMatch(elapsed, /not started|لم تبدأ/, 'a running operation shows a real elapsed time');

  // The pads are pre-filled with 0; type() inserts at the caret, so "4" into "0" yields "40"
  // unless the field is cleared first - and 40 produced against a planned 10 is a legitimate
  // overproduction refusal, not the quantity this test means to record.
  for (const name of ['produced_quantity', 'rejected_quantity']) {
    await page.$eval(`${host} [data-role="sf-output-form"] [name="${name}"]`, (input) => { input.value = ''; });
  }
  await page.type(`${host} [data-role="sf-output-form"] [name="produced_quantity"]`, '4');
  await page.type(`${host} [data-role="sf-output-form"] [name="rejected_quantity"]`, '1');
  await page.click(`${host} [data-role="sf-output-form"] button[type="submit"]`);
  // Wait on the produced counter specifically - a loose /4/ over the whole panel also matches
  // the "Torque to 42Nm" instructions, which would hide a failed submit.
  await page.waitForFunction(
    (selector) => String(document.querySelector(`${selector} [data-role="sf-produced"]`)?.textContent ?? '').replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660)).trim() === '4',
    { timeout: 10000 }, host,
  );
  assert.equal(latinDigits(await page.$eval(`${host} [data-role="sf-rejected"]`, (node) => node.textContent)), '1');
  const afterOutput = dialect.prepare('SELECT produced_quantity,rejected_quantity FROM mfg_shopfloor_sessions WHERE id=?').get(opened.id);
  assert.equal(Number(afterOutput.produced_quantity), 4);
  assert.equal(Number(afterOutput.rejected_quantity), 1);

  // Pause is also request-only.
  await clickStable(page, `${host} [data-role="sf-pause"]`);
  await page.waitForSelector(`${host} [data-role="sf-awaiting"]`, { timeout: 10000 });
  assert.equal(dialect.prepare('SELECT status FROM mfg_shopfloor_sessions WHERE id=?').get(opened.id).status, 'awaiting_canonical');
  assert.equal(dialect.prepare('SELECT state FROM mfg_work_orders WHERE id=?').get(fixture.workOrders[0]).state, 'in_progress', 'pausing the terminal did not pause the canonical work order');

  assert.equal(consoleErrors.filter((message) => !/403/.test(message)).length, 0, consoleErrors.join('\n'));
});

test('real Chromium ranks the work-centre queue and assigns an operator', async (t) => {
  const { consoleErrors, dialect, page, seed } = await openBuild09Browser(t, { name: 'workcenter-queue-ui', initialPage: 'workcenter_queue', extraModules: SHOPFLOOR_MODULES });
  const host = '[data-build09-page="workcenter_queue"]';
  const fixture = seedWorkOrders(dialect, seed, 2);

  // Open the later-planned operation first, so a correct queue must re-order by planned start
  // rather than by creation order.
  const second = await browserAction(page, 'shopfloor:session_open', { warehouse_id: seed.warehouse.id, work_order_id: fixture.workOrders[1] });
  const first = await browserAction(page, 'shopfloor:session_open', { warehouse_id: seed.warehouse.id, work_order_id: fixture.workOrders[0], quality_checkpoint_required: true });

  await page.evaluate(() => window.switchPage('workcenter_queue'));
  await page.waitForFunction((selector) => document.querySelectorAll(`${selector} [data-role="wq-select"]`).length === 2, { timeout: 15000 }, host);

  const centres = await page.$$eval(`${host} [data-role="wq-centre"]`, (nodes) => nodes.map((node) => node.dataset.workCenter));
  assert.deepEqual(centres, [fixture.workCenterId], 'both operations group under their one work centre');

  const order = await page.$$eval(`${host} [data-role="wq-select"]`, (nodes) => nodes.map((node) => node.dataset.sessionId));
  assert.deepEqual(order, [first.id, second.id], 'the queue ranks by planned start, not by creation order');

  const firstRow = await page.$eval(`${host} [data-role="wq-select"][data-session-id="${first.id}"]`, (node) => node.textContent);
  assert.match(firstRow, /checkpoint required|يلزم فحص/, 'a session needing a quality checkpoint is flagged in the queue');

  await clickStable(page, `${host} [data-role="wq-select"][data-session-id="${second.id}"]`);
  await page.waitForSelector(`${host} [data-role="wq-assign-form"]`, { timeout: 10000 });
  await page.type(`${host} [data-role="wq-assign-form"] [name="operator_id"]`, 'operator-b');
  await page.type(`${host} [data-role="wq-assign-form"] [name="shift_code"]`, 'B');
  await page.click(`${host} [data-role="wq-assign-form"] button[type="submit"]`);

  await page.waitForFunction((selector, sessionId) => /operator-b/.test(document.querySelector(`${selector} [data-role="wq-select"][data-session-id="${sessionId}"]`)?.textContent || ''), { timeout: 10000 }, host, second.id);
  const assigned = dialect.prepare('SELECT operator_id,shift_code,status,assigned_by FROM mfg_shopfloor_sessions WHERE id=?').get(second.id);
  assert.equal(assigned.operator_id, 'operator-b');
  assert.equal(assigned.shift_code, 'B');
  assert.equal(assigned.status, 'assigned');
  assert.equal(assigned.assigned_by, 'browser-manager');

  assert.equal(consoleErrors.filter((message) => !/403/.test(message)).length, 0, consoleErrors.join('\n'));
});
