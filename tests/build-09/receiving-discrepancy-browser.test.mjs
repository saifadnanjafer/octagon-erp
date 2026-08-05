import assert from 'node:assert/strict';
import test from 'node:test';
import { browserAction, openBuild09Browser } from './browser-harness.mjs';

const MODULES = ['build09r-shared.js', 'build09-receiving-discrepancy-workspace.js'];

test('real Chromium makes a receiving discrepancy visible and enforces its maker-checker decision', async (t) => {
  const { consoleErrors, dialect, page, seed } = await openBuild09Browser(t, { name: 'receiving-discrepancy-ui', initialPage: 'receiving_discrepancies', extraModules: MODULES });
  const session = await browserAction(page, 'wms:receiving_start', { warehouse_id: seed.warehouse.id, reference: 'DISC-UI-1', receipt_type: 'purchase_order' });
  await browserAction(page, 'wms:receiving_scan_reference', { warehouse_id: seed.warehouse.id, session_id: session.id, reference: 'DISC-UI-1' });
  await browserAction(page, 'wms:receiving_scan_product', { warehouse_id: seed.warehouse.id, session_id: session.id, product_id: seed.productId, quantity: 2, expected_quantity: 5, discrepancy_reason: 'Short delivery' });
  const discrepancy = dialect.prepare('SELECT * FROM wms_receiving_discrepancies WHERE session_id=?').get(session.id);
  const host = '[data-build09-page="receiving_discrepancies"]';
  await page.evaluate(() => window.switchPage('receiving_discrepancies'));
  await page.waitForSelector(`${host} [data-role="rd-select"]`, { timeout: 15000 });
  await page.click(`${host} [data-role="rd-select"][data-discrepancy-id="${discrepancy.id}"]`);
  await page.waitForSelector(`${host} [data-role="rd-decision-form"]`, { timeout: 10000 });
  assert.match(await page.$eval(`${host} [data-role="rd-detail"]`, (node) => node.textContent), /Short delivery/);
  await page.type(`${host} [data-role="rd-decision-form"] [name="reason"]`, 'Checked against delivery note');
  await page.click(`${host} [data-role="rd-decision-form"] button[type="submit"]`);
  await page.waitForSelector(`${host} [data-role="rd-alert"]`, { timeout: 10000 });
  assert.match(await page.$eval(`${host} [data-role="rd-alert"]`, (node) => node.textContent), /maker-checker/i);
  assert.equal(dialect.prepare('SELECT status FROM wms_receiving_discrepancies WHERE id=?').get(discrepancy.id).status, 'open');
  await browserAction(page, 'wms:receiving_discrepancy_approve', { warehouse_id: seed.warehouse.id, session_id: session.id, discrepancy_id: discrepancy.id, decision: 'approved', reason: 'Supervisor review' }, { user: 'receiving-supervisor' });
  await page.evaluate(() => window.switchPage('receiving_discrepancies'));
  await page.select(`${host} [data-role="rd-filter"]`, '');
  await page.waitForSelector(`${host} [data-role="rd-select"][data-discrepancy-id="${discrepancy.id}"]`, { timeout: 10000 });
  await page.click(`${host} [data-role="rd-select"][data-discrepancy-id="${discrepancy.id}"]`);
  await page.waitForFunction((selector) => !document.querySelector(selector), { timeout: 10000 }, `${host} [data-role="rd-decision-form"]`);
  assert.equal(dialect.prepare('SELECT status,approved_by FROM wms_receiving_discrepancies WHERE id=?').get(discrepancy.id).approved_by, 'receiving-supervisor');
  assert.equal(consoleErrors.filter((message) => !/403|409/.test(message)).length, 0, consoleErrors.join('\n'));
});
