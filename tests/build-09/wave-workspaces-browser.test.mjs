import assert from 'node:assert/strict';
import test from 'node:test';
import { browserAction, clickStable, openBuild09Browser } from './browser-harness.mjs';

// BUILD-09R-2 Group A: real Chromium drives the purpose-built Wave Planning and Wave Execution
// workspaces (modules/build09-wave-workspace.js) through visible controls only - checkbox
// selection from the real pick-task pool, the grouping-rule form, calculate, the maker-checker
// refusal, then release and progress monitoring on the execution board.
//
// The refusal step matters as much as the happy path: platform/wms/waves.mjs forbids the wave's
// creator from reviewing it, and this asserts the workspace surfaces that as a readable denied
// panel rather than swallowing the 403 or leaving a spinner up.

const WAVE_MODULES = ['build09r-shared.js', 'build09-wave-workspace.js'];

async function seedPickTasks(page, seed, count) {
  const tasks = [];
  for (let index = 0; index < count; index += 1) {
    tasks.push(await browserAction(page, 'wms:pick_task_create', {
      warehouse_id: seed.warehouse.id, picking_type: 'sales_delivery',
      source_document_id: `sale-wave-${index}`, source_line_id: `line-wave-${index}`,
      product_id: seed.productId, source_location_id: seed.source.locationId,
      staging_location_id: seed.staging.locationId, destination_location_id: seed.staging.locationId,
      quantity: 2, strategy: 'fifo', route_sequence: 10 + index,
    }));
  }
  return tasks;
}

test('real Chromium plans a wave from the task pool and honours the wave maker-checker rule', async (t) => {
  const { consoleErrors, dialect, page, seed } = await openBuild09Browser(t, { name: 'wave-planning-ui', initialPage: 'wave_planning', extraModules: WAVE_MODULES });
  const host = '[data-build09-page="wave_planning"]';
  const tasks = await seedPickTasks(page, seed, 3);

  // Re-enter the page so the pool reflects the freshly created tasks.
  await page.evaluate(() => window.switchPage('wave_planning'));
  await page.waitForFunction((selector) => document.querySelectorAll(`${selector} [data-role="wp-toggle"]`).length === 3, { timeout: 15000 }, host);

  // Select two of the three tasks via real checkbox clicks - the third must stay out of the wave.
  await page.click(`${host} [data-role="wp-toggle"][data-task-id="${tasks[0].id}"]`);
  await page.click(`${host} [data-role="wp-toggle"][data-task-id="${tasks[1].id}"]`);
  await page.waitForFunction((selector) => document.querySelectorAll(`${selector} .b09r-pool-selected`).length === 2, { timeout: 5000 }, host);

  await page.type(`${host} [data-role="wp-rule-form"] [name="name"]`, 'WAVE-UI-01');
  await page.select(`${host} [data-role="wp-rule-form"] [name="wave_type"]`, 'batch');
  await page.select(`${host} [data-role="wp-rule-form"] [name="grouping_strategy"]`, 'zone');
  await page.$eval(`${host} [data-role="wp-rule-form"] [name="priority"]`, (input) => { input.value = ''; });
  await page.type(`${host} [data-role="wp-rule-form"] [name="priority"]`, '20');
  await page.type(`${host} [data-role="wp-rule-form"] [name="operator_id"]`, 'picker-team-a');

  // Governed lookup, not a free-text id box: search the server, then choose a returned row.
  await page.type(`${host} [data-lookup-resource="locations"] .b09-lookup-query`, 'Browser Staging');
  await page.waitForFunction((selector) => {
    const node = document.querySelector(selector);
    return node && node.options.length > 1;
  }, { timeout: 5000 }, `${host} [data-lookup-resource="locations"] .b09-lookup-select`);
  await page.select(`${host} [data-lookup-resource="locations"] .b09-lookup-select`, seed.staging.locationId);

  await page.click(`${host} [data-role="wp-rule-form"] button[type="submit"]`);

  await page.waitForSelector(`${host} [data-role="wp-review"]`, { timeout: 15000 });
  const wave = dialect.prepare('SELECT * FROM wms_pick_waves WHERE name=?').get('WAVE-UI-01');
  assert.equal(wave.status, 'calculated');
  assert.equal(wave.wave_type, 'batch');
  assert.equal(wave.grouping_strategy, 'zone');
  assert.equal(Number(wave.priority), 20);
  assert.equal(wave.operator_id, 'picker-team-a');
  assert.equal(wave.staging_location_id, seed.staging.locationId);
  assert.equal(Number(wave.task_count), 2, 'only the two selected pick tasks belong to the wave');
  const waved = dialect.prepare('SELECT pick_task_id FROM wms_pick_wave_tasks WHERE wave_id=?').all(wave.id).map((row) => row.pick_task_id);
  assert.deepEqual(waved.sort(), [tasks[0].id, tasks[1].id].sort());

  // The planner who created the wave may not review it. Clicking review must render an honest
  // denied panel - proving governance reaches the operator instead of failing silently.
  await clickStable(page, `${host} [data-role="wp-review"]`);
  await page.waitForFunction((selector) => document.querySelector(selector)?.dataset.phase === 'denied', { timeout: 10000 }, `${host} [data-role="wp-alert"]`);
  const deniedText = await page.$eval(`${host} [data-role="wp-alert"]`, (node) => node.textContent);
  assert.match(deniedText, /maker-checker/i);
  assert.equal(dialect.prepare('SELECT status FROM wms_pick_waves WHERE id=?').get(wave.id).status, 'calculated');

  assert.equal(consoleErrors.filter((message) => !/403/.test(message)).length, 0, consoleErrors.join('\n'));
});

test('real Chromium releases a reviewed wave and shows live execution progress', async (t) => {
  const { consoleErrors, dialect, page, seed } = await openBuild09Browser(t, { name: 'wave-execution-ui', initialPage: 'wave_planning', extraModules: WAVE_MODULES });
  const planningHost = '[data-build09-page="wave_planning"]';
  const host = '[data-build09-page="wave_execution"]';
  const tasks = await seedPickTasks(page, seed, 2);

  await page.evaluate(() => window.switchPage('wave_planning'));
  await page.waitForFunction((selector) => document.querySelectorAll(`${selector} [data-role="wp-toggle"]`).length === 2, { timeout: 15000 }, planningHost);
  await clickStable(page, `${planningHost} [data-role="wp-select-all"]`);
  await page.type(`${planningHost} [data-role="wp-rule-form"] [name="name"]`, 'WAVE-UI-EXEC');
  await page.click(`${planningHost} [data-role="wp-rule-form"] button[type="submit"]`);
  await page.waitForSelector(`${planningHost} [data-role="wp-review"]`, { timeout: 15000 });

  const wave = dialect.prepare('SELECT * FROM wms_pick_waves WHERE name=?').get('WAVE-UI-EXEC');
  assert.equal(Number(wave.task_count), 2);
  // A separate approver reviews it - the release step below is then driven from the UI by the
  // original planner, which the domain permits (reviewer !== releaser).
  await browserAction(page, 'wms:wave_review', { warehouse_id: seed.warehouse.id, wave_id: wave.id }, { user: 'wave-supervisor' });

  await page.evaluate(() => window.switchPage('wave_execution'));
  await page.waitForFunction((selector) => document.querySelectorAll(`${selector} [data-role="we-select"]`).length > 0, { timeout: 15000 }, host);
  await clickStable(page, `${host} [data-role="we-select"][data-wave-id="${wave.id}"]`);

  await page.waitForSelector(`${host} [data-role="we-release"]`, { timeout: 10000 });
  await clickStable(page, `${host} [data-role="we-release"]`);

  await page.waitForFunction((selector) => /released/.test(document.querySelector(`${selector} [data-role="we-list"]`)?.textContent || ''), { timeout: 15000 }, host);
  const released = dialect.prepare('SELECT status,released_by,reviewed_by FROM wms_pick_waves WHERE id=?').get(wave.id);
  assert.equal(released.status, 'released');
  assert.equal(released.reviewed_by, 'wave-supervisor');
  assert.equal(released.released_by, 'browser-manager');
  // Releasing a wave materialises canonical warehouse tasks - the wave never posts stock itself.
  const warehouseTasks = dialect.prepare(`SELECT canonical_action,status FROM wms_warehouse_tasks WHERE source_record_type='pick_task' AND source_record_id IN (${tasks.map(() => '?').join(',')})`).all(...tasks.map((task) => task.id));
  assert.equal(warehouseTasks.length, 2);
  assert.ok(warehouseTasks.every((row) => row.canonical_action === 'stock:move:post'));

  // The detail panel stays open across the release re-render; the board must keep rendering the
  // real progress model from the reloaded wave, not a static sample row.
  await page.waitForSelector(`${host} [data-role="we-tasks"]`, { timeout: 10000 });
  const detail = await page.$eval(`${host} [data-role="we-tasks"]`, (node) => node.textContent);
  for (const task of tasks) assert.match(detail, new RegExp(task.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const progress = await page.$eval(`${host} [data-role="we-tasks"]`, (node) => node.closest('.b09r-panel').querySelector('.b09r-progress').getAttribute('aria-valuenow'));
  assert.equal(progress, '0', 'nothing is picked yet, so completion must honestly read 0%');

  assert.equal(consoleErrors.filter((message) => !/403/.test(message)).length, 0, consoleErrors.join('\n'));
});
