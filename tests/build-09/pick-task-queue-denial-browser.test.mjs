import assert from 'node:assert/strict';
import test from 'node:test';
import { browserAction, openBuild09Browser } from './browser-harness.mjs';

const MODULES = ['build09r-shared.js', 'build09-pick-task-queue-workspace.js'];

test('authenticated viewer sees the scoped pick queue but server denies visible assignment', async (t) => {
  const { consoleErrors, dialect, page, seed } = await openBuild09Browser(t, { name: 'pick-queue-viewer', initialPage: 'pick_task_queue', extraModules: MODULES, user: 'viewer-user' });
  const task = await browserAction(page, 'wms:pick_task_create', { warehouse_id: seed.warehouse.id, picking_type: 'sales_delivery', source_document_id: 'viewer-sale', source_line_id: 'viewer-line', product_id: seed.productId, source_location_id: seed.source.locationId, staging_location_id: seed.staging.locationId, destination_location_id: seed.staging.locationId, quantity: 1 }, { user: 'browser-manager' });
  const host = '[data-build09-page="pick_task_queue"]';
  await page.evaluate(() => window.switchPage('pick_task_queue'));
  await page.waitForSelector(`${host} [data-role="pd-select"][data-task-id="${task.id}"]`, { timeout: 10000 });
  await page.click(`${host} [data-role="pd-select"][data-task-id="${task.id}"]`);
  assert.equal(await page.$(`${host} [data-role="pd-assign"]`), null, 'viewer has no mutation form or raw-id fallback');
  await assert.rejects(browserAction(page, 'wms:pick_task_assign', { warehouse_id: seed.warehouse.id, task_id: task.id, assigned_to: 'browser-picker' }, { user: 'viewer-user' }), /Permission denied/);
  assert.equal(dialect.prepare('SELECT assigned_to,status FROM wms_pick_tasks_v2 WHERE id=?').get(task.id).assigned_to, null);
  assert.equal(consoleErrors.filter((message) => !/403|Permission denied/i.test(message)).length, 0, consoleErrors.join('\n'));
});
