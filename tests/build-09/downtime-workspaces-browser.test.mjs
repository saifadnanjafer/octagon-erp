import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductionOrder } from '../../platform/manufacturing/manufacturing-orders.mjs';
import { browserAction, clickStable, latinDigits, openBuild09Browser } from './browser-harness.mjs';

// BUILD-09R-2 Group F: real Chromium drives the Downtime Board and Operational Performance
// dashboard (modules/build09-downtime-workspace.js) through visible controls only.
//
// The dashboard assertion is the point of this group. downtime-performance.mjs returns null for
// availability / performance / quality rate / OEE whenever the evidence to compute them is
// absent. Rendering those nulls as 0% would invent a catastrophic reading out of missing data.
// This test asserts the page says "not available" for the unmeasurable rates while still showing
// the real numbers it does have - and then that a rate flips to a measured value once the
// evidence exists.

const DOWNTIME_MODULES = ['build09r-shared.js', 'build09-downtime-workspace.js'];

function seedWorkOrder(dialect, seed) {
  const stamp = new Date().toISOString();
  dialect.prepare(`INSERT INTO boms(id,company_id,code,product_id,name_en,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run('bom-b09r2-dt', seed.companyId, 'BOM-B09R2-DT', seed.productId, 'Group F BOM', 'planner-a', stamp, stamp);
  dialect.prepare(`INSERT INTO bom_versions(id,company_id,bom_id,revision,state,approved_by,approved_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`)
    .run('bomv-b09r2-dt', seed.companyId, 'bom-b09r2-dt', 1, 'approved', 'approver-b', stamp, stamp, stamp);
  const order = createProductionOrder(dialect, {
    company_id: seed.companyId, product_id: seed.productId, planned_quantity: 10, bom_version_id: 'bomv-b09r2-dt',
    warehouse_id: seed.warehouse.id, wip_location_id: seed.destination.locationId, finished_location_id: seed.staging.locationId, actor: 'planner-a',
  });
  dialect.prepare(`INSERT INTO work_centers(id,company_id,code,name_ar,name_en,warehouse_id,wip_location_id,capacity_per_hour,efficiency_percent,working_hours_per_day,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('wc-b09r2-dt', seed.companyId, 'WC-B09R2-DT', 'تجميع', 'Assembly', seed.warehouse.id, seed.destination.locationId, 12, 95, 8, 1, stamp, stamp);
  dialect.prepare(`INSERT INTO mfg_work_orders(id,company_id,production_order_id,operation_sequence,work_center_id,name,planned_setup_minutes,planned_run_minutes,quantity_to_produce,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('wo-b09r2-dt', seed.companyId, order.id, 10, 'wc-b09r2-dt', 'Assembly operation', 5, 60, 10, 'ready', stamp, stamp);
  dialect.prepare(`UPDATE mfg_production_orders SET state='released',updated_at=? WHERE id=?`).run(stamp, order.id);
  return { orderId: order.id, workOrderId: 'wo-b09r2-dt', workCenterId: 'wc-b09r2-dt' };
}

/** Drive a session all the way to running, which is the only state downtime can be logged against. */
async function runningSession(page, seed, workOrderId, key) {
  const session = await browserAction(page, 'shopfloor:session_open', { warehouse_id: seed.warehouse.id, work_order_id: workOrderId, operator_id: 'operator-a', idempotency_key: `dt-session-${key}` });
  await browserAction(page, 'shopfloor:operation_start', { warehouse_id: seed.warehouse.id, session_id: session.id });
  await browserAction(page, 'manufacturing:work_order:start', { work_order_id: workOrderId }, { user: 'mfg-controller' });
  await browserAction(page, 'shopfloor:operation_acknowledge', { warehouse_id: seed.warehouse.id, session_id: session.id });
  return session;
}

test('real Chromium logs and ends downtime on the live board', async (t) => {
  const { consoleErrors, dialect, page, seed } = await openBuild09Browser(t, { name: 'downtime-board-ui', initialPage: 'downtime_board', extraModules: DOWNTIME_MODULES });
  const host = '[data-build09-page="downtime_board"]';
  const fixture = seedWorkOrder(dialect, seed);
  const session = await runningSession(page, seed, fixture.workOrderId, 'board');

  await page.evaluate(() => window.switchPage('downtime_board'));
  await page.waitForSelector(`${host} [data-role="dt-start-form"]`, { timeout: 15000 });
  const before = await page.$eval(`${host} [data-role="dt-active"]`, (node) => node.textContent);
  assert.match(before, /Nothing is down|لا يوجد توقف/, 'the board honestly reports an idle state before anything breaks');

  await page.select(`${host} [data-role="dt-start-form"] [name="session_id"]`, session.id);
  await page.select(`${host} [data-role="dt-start-form"] [name="reason_category"]`, 'breakdown');
  await page.type(`${host} [data-role="dt-start-form"] [name="reason_code"]`, 'SPINDLE_FAULT');
  await page.type(`${host} [data-role="dt-start-form"] [name="asset_reference"]`, 'CNC-07');
  await page.click(`${host} [data-role="dt-start-form"] [name="maintenance_required"]`);
  await page.click(`${host} [data-role="dt-start-form"] button[type="submit"]`);

  await page.waitForSelector(`${host} [data-role="dt-live"]`, { timeout: 15000 });
  const event = dialect.prepare('SELECT * FROM mfg_downtime_events WHERE session_id=?').get(session.id);
  assert.equal(event.reason_code, 'SPINDLE_FAULT');
  assert.equal(event.reason_category, 'breakdown');
  assert.equal(event.asset_reference, 'CNC-07');
  assert.equal(event.status, 'maintenance_proposed');
  assert.equal(event.ends_at, null);

  const active = await page.$eval(`${host} [data-role="dt-active"]`, (node) => node.textContent);
  assert.match(active, /SPINDLE_FAULT/);
  assert.match(active, /CNC-07/);
  assert.match(active, new RegExp(fixture.workCenterId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the work centre is named on the board');
  // A proposed maintenance request has not been created - the board must say so.
  assert.match(active, /not created|لم تُنشأ/, 'the maintenance proposal is labelled as not created');
  assert.equal(JSON.parse(event.maintenance_request_json).createAuthorized, false);
  assert.equal(event.maintenance_request_id, null);

  // The live clock ticks the duration cell without repainting the board.
  const startedAt = await page.$eval(`${host} [data-role="dt-live"]`, (node) => node.dataset.startsAt);
  assert.equal(startedAt, event.starts_at, 'the ticking cell is anchored to the real event start');

  await clickStable(page, `${host} [data-role="dt-end"]`);
  await page.waitForFunction((selector) => /SPINDLE_FAULT/.test(document.querySelector(`${selector} [data-role="dt-history"]`)?.textContent || ''), { timeout: 15000 }, host);
  const ended = dialect.prepare('SELECT ends_at,duration_minutes,status,closed_by FROM mfg_downtime_events WHERE id=?').get(event.id);
  assert.ok(ended.ends_at, 'the event is closed with a real end time');
  assert.ok(Number(ended.duration_minutes) >= 0);
  assert.equal(ended.closed_by, 'browser-manager');
  assert.equal(await page.$(`${host} [data-role="dt-live"]`), null, 'no live clock remains once nothing is down');

  assert.equal(consoleErrors.filter((message) => !/403/.test(message)).length, 0, consoleErrors.join('\n'));
});

test('real Chromium reports unmeasurable performance rates as unavailable, never as zero', async (t) => {
  const { consoleErrors, dialect, page, seed } = await openBuild09Browser(t, { name: 'performance-ui', initialPage: 'operational_performance', extraModules: DOWNTIME_MODULES });
  const host = '[data-build09-page="operational_performance"]';
  const fixture = seedWorkOrder(dialect, seed);
  const session = await runningSession(page, seed, fixture.workOrderId, 'perf');

  // No planned window and no output yet: availability, performance and OEE are all uncomputable.
  await page.evaluate(() => window.switchPage('operational_performance'));
  await page.waitForSelector(`${host} [data-role="op-rates"]`, { timeout: 15000 });
  const readRates = () => page.$$eval(`${host} [data-role="op-rate"]`, (nodes) => nodes.map((node) => ({
    metric: node.dataset.metric,
    label: node.querySelector('.b09r-kpi-label').textContent.trim(),
    value: node.querySelector('.b09r-kpi-value').textContent.trim(),
    available: node.dataset.metricAvailable,
  })));
  const rates = await readRates();
  assert.deepEqual(rates.map((rate) => rate.metric), ['availability', 'performance', 'qualityRate', 'oee']);
  for (const rate of rates) {
    if (rate.available === 'false') {
      assert.match(rate.value, /not available|غير متاح/, `${rate.label} must say it is unavailable`);
      assert.doesNotMatch(latinDigits(rate.value), /0/, `${rate.label} must not render missing evidence as a zero`);
    }
  }
  assert.ok(rates.some((rate) => rate.available === 'false'), 'with no planned window, at least one rate is genuinely unmeasurable');

  const why = await page.$$eval(`${host} [data-role="op-rate"][data-metric-available="false"] .b09r-kpi-why`, (nodes) => nodes.map((node) => node.textContent.trim()));
  assert.ok(why.every((text) => text.length > 0), 'each unavailable rate explains what evidence it needs');

  // Record real output; the quality rate now has evidence and must become a measured number.
  await browserAction(page, 'shopfloor:operation_output', { warehouse_id: seed.warehouse.id, session_id: session.id, produced_quantity: 8, rejected_quantity: 2 });
  await page.evaluate(() => window.switchPage('operational_performance'));
  await page.waitForFunction(
    (selector) => document.querySelector(`${selector} [data-role="op-rate"][data-metric="qualityRate"]`)?.dataset.metricAvailable === 'true',
    { timeout: 15000 }, host,
  );
  const measured = await readRates();
  const qualityRate = measured.find((rate) => rate.metric === 'qualityRate');
  // 8 produced of 10 attempted is an 80% quality rate - the real computed figure, not a placeholder.
  assert.match(latinDigits(qualityRate.value), /80/, 'the quality rate renders the genuinely computed 80%');
  // Availability still has no planned window, so it must stay unavailable even now that
  // other rates can be computed - partial evidence must not backfill a missing metric.
  assert.equal(measured.find((rate) => rate.metric === 'availability').available, 'false');
  assert.equal(measured.find((rate) => rate.metric === 'oee').available, 'false', 'OEE needs all three inputs, so it stays unavailable');

  const throughput = await page.$eval(host, (node) => node.textContent);
  assert.match(latinDigits(throughput), /\b8\b/, 'throughput reflects the recorded output');

  assert.equal(consoleErrors.filter((message) => !/403/.test(message)).length, 0, consoleErrors.join('\n'));
});
