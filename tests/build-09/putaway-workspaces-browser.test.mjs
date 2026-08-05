import assert from 'node:assert/strict';
import test from 'node:test';
import { browserAction, clickStable, openBuild09Browser } from './browser-harness.mjs';

// BUILD-09R-2 Group H: real Chromium drives Putaway Task Queue and Replenishment Proposals
// (modules/build09-putaway-workspace.js) through visible controls only.
//
// Two invariants are asserted from the database, not just from the DOM:
//   * neither workspace ever posts stock itself - a task only reaches "completed" after a real
//     stock:move:post is fed back through the acknowledgement form;
//   * replenishment approval is maker-checker - the same actor who triggered the calculation is
//     refused when approving their own proposal.

const PUTAWAY_MODULES = ['build09r-shared.js', 'build09-putaway-workspace.js'];

const pick = async (page, host, formRole, resource, name, query, value) => {
  const wrapper = `${host} [data-role="${formRole}"] [data-lookup-resource="${resource}"]:has([name="${name}"])`;
  await page.type(`${wrapper} .b09-lookup-query`, query);
  await page.waitForFunction((selector) => {
    const node = document.querySelector(selector);
    return node && node.options.length > 1;
  }, { timeout: 8000 }, `${wrapper} .b09-lookup-select`);
  await page.select(`${wrapper} .b09-lookup-select`, value);
};

test('real Chromium requests a putaway recommendation, accepts it, and scans the task to completion', async (t) => {
  const { consoleErrors, dialect, page, seed } = await openBuild09Browser(t, { name: 'putaway-queue-ui', initialPage: 'putaway_task_queue', extraModules: PUTAWAY_MODULES });
  const host = '[data-build09-page="putaway_task_queue"]';

  await page.waitForSelector(`${host} [data-role="pwq-request-form"]`, { timeout: 15000 });
  await pick(page, host, 'pwq-request-form', 'products', 'product_id', 'Browser Product', seed.productId);
  await pick(page, host, 'pwq-request-form', 'locations', 'source_location_id', 'Browser Pick', seed.source.locationId);
  await page.type(`${host} [data-role="pwq-request-form"] [name="quantity"]`, '12');
  await page.click(`${host} [data-role="pwq-request-form"] button[type="submit"]`);

  await page.waitForSelector(`${host} [data-role="pwq-detail"]`, { timeout: 15000 });
  const recommendation = dialect.prepare('SELECT * FROM wms_putaway_recommendations WHERE product_id=? ORDER BY created_at DESC LIMIT 1').get(seed.productId);
  assert.equal(recommendation.status, 'suggested');
  assert.equal(Number(recommendation.quantity), 12);
  const line = dialect.prepare('SELECT * FROM wms_putaway_recommendation_lines WHERE recommendation_id=?').get(recommendation.id);
  // The harness seeds a fixed rule pinning this exact product to the destination bin, so the
  // recommendation must resolve there, not to some other capacity-eligible location.
  assert.equal(line.destination_location_id, seed.destination.locationId);

  await clickStable(page, `${host} [data-role="pwq-accept"]`);
  await page.waitForFunction((selector) => document.querySelectorAll(`${selector} [data-role="pwq-task"]`).length > 0, { timeout: 15000 }, host);
  assert.equal(dialect.prepare('SELECT status FROM wms_putaway_recommendations WHERE id=?').get(recommendation.id).status, 'task_created');
  const task = dialect.prepare(`SELECT * FROM wms_warehouse_tasks WHERE source_record_type='putaway_recommendation' AND source_record_id=?`).get(recommendation.id);
  assert.equal(task.status, 'ready');

  const stockBefore = dialect.prepare('SELECT quantity FROM stock_quants WHERE company_id=? AND product_id=? AND location_id=?').get(seed.companyId, seed.productId, seed.destination.locationId);
  assert.equal(stockBefore, undefined, 'the putaway destination starts empty');

  await page.type(`${host} [data-role="pwq-scan-source-form"] [name="barcode"]`, 'B-PICK');
  await page.click(`${host} [data-role="pwq-scan-source-form"] button[type="submit"]`);
  await page.waitForFunction((selector) => document.querySelector(selector) === null, { timeout: 10000 }, `${host} [data-role="pwq-scan-source-form"]`);
  assert.equal(dialect.prepare('SELECT status FROM wms_warehouse_tasks WHERE id=?').get(task.id).status, 'source_scanned');

  await page.type(`${host} [data-role="pwq-scan-dest-form"] [name="barcode"]`, 'B-PUT');
  await page.click(`${host} [data-role="pwq-scan-dest-form"] button[type="submit"]`);
  await page.waitForFunction((selector) => document.querySelector(selector) === null, { timeout: 10000 }, `${host} [data-role="pwq-scan-dest-form"]`);
  assert.equal(dialect.prepare('SELECT status FROM wms_warehouse_tasks WHERE id=?').get(task.id).status, 'destination_scanned');

  await clickStable(page, `${host} [data-role="pwq-request-canonical"]`);
  await page.waitForSelector(`${host} [data-role="pwq-ack-form"]`, { timeout: 10000 });
  assert.equal(dialect.prepare('SELECT status FROM wms_warehouse_tasks WHERE id=?').get(task.id).status, 'awaiting_canonical');
  assert.equal(dialect.prepare('SELECT quantity FROM stock_quants WHERE company_id=? AND product_id=? AND location_id=?').get(seed.companyId, seed.productId, seed.destination.locationId), undefined, 'requesting the canonical move must not itself move stock');

  const request = JSON.parse(dialect.prepare('SELECT canonical_request_json FROM wms_warehouse_tasks WHERE id=?').get(task.id).canonical_request_json);
  const move = await browserAction(page, 'stock:move:post', { ...request }, { user: 'browser-inventory' });
  assert.equal(move.state, 'done');

  await page.type(`${host} [data-role="pwq-ack-form"] [name="canonical_result_id"]`, move.id);
  await page.click(`${host} [data-role="pwq-ack-form"] button[type="submit"]`);
  await page.waitForFunction((selector) => document.querySelectorAll(`${selector} [data-role="pwq-task-completed"]`).length > 0, { timeout: 10000 }, host);

  assert.equal(dialect.prepare('SELECT status,canonical_result_id FROM wms_warehouse_tasks WHERE id=?').get(task.id).canonical_result_id, move.id);
  assert.equal(dialect.prepare('SELECT status FROM wms_putaway_recommendations WHERE id=?').get(recommendation.id).status, 'completed');
  assert.equal(Number(dialect.prepare('SELECT quantity FROM stock_quants WHERE company_id=? AND product_id=? AND location_id=?').get(seed.companyId, seed.productId, seed.destination.locationId).quantity), 12);

  assert.equal(consoleErrors.filter((message) => !/403|409/.test(message)).length, 0, consoleErrors.join('\n'));
});

test('real Chromium calculates a replenishment proposal, refuses self-approval, then scans the task to completion', async (t) => {
  const { consoleErrors, dialect, page, seed } = await openBuild09Browser(t, { name: 'replenishment-ui', initialPage: 'replenishment_rules', extraModules: PUTAWAY_MODULES });
  const rulesHost = '[data-build09-page="replenishment_rules"]';
  const proposalsHost = '[data-build09-page="replenishment_proposals"]';

  await page.waitForSelector(`${rulesHost} [data-role="rpr-create-form"]`, { timeout: 15000 });
  await pick(page, rulesHost, 'rpr-create-form', 'products', 'product_id', 'Browser Product', seed.productId);
  // Restocking the empty putaway bin from the pick bin, which the harness seeded with 20 units.
  await pick(page, rulesHost, 'rpr-create-form', 'locations', 'source_location_id', 'Browser Pick', seed.source.locationId);
  await pick(page, rulesHost, 'rpr-create-form', 'locations', 'destination_location_id', 'Browser Putaway', seed.destination.locationId);
  await page.type(`${rulesHost} [data-role="rpr-create-form"] [name="reorder_point"]`, '5');
  await page.type(`${rulesHost} [data-role="rpr-create-form"] [name="target_quantity"]`, '15');
  await page.type(`${rulesHost} [data-role="rpr-create-form"] [name="maximum_quantity"]`, '15');
  await page.click(`${rulesHost} [data-role="rpr-create-form"] button[type="submit"]`);
  await page.waitForFunction((selector) => document.querySelectorAll(`${selector} [data-role="rpr-row"], ${selector} [data-role="rpr-alert"]`).length > 0, { timeout: 15000 }, rulesHost);
  const ruleAlert = await page.$eval(`${rulesHost} [data-role="rpr-alert"]`, (node) => node.textContent).catch(() => null);
  assert.equal(ruleAlert, null, ruleAlert || 'replenishment-rule creation did not render a row');
  const rule = dialect.prepare('SELECT * FROM wms_replenishment_rules_v2 WHERE product_id=? ORDER BY created_at DESC LIMIT 1').get(seed.productId);
  assert.equal(Number(rule.target_quantity), 15);

  await page.evaluate(() => window.switchPage('replenishment_proposals'));
  await page.waitForSelector(`${proposalsHost} [data-role="rpp-calculate-form"]`, { timeout: 15000 });
  await page.click(`${proposalsHost} [data-role="rpp-calculate-form"] button[type="submit"]`);
  await page.waitForFunction((selector) => document.querySelectorAll(`${selector} [data-role="rpp-select"]`).length > 0, { timeout: 15000 }, proposalsHost);

  const proposal = dialect.prepare('SELECT * FROM wms_replenishment_proposals_v2 WHERE rule_id=? ORDER BY created_at DESC LIMIT 1').get(rule.id);
  assert.equal(proposal.status, 'proposed');
  assert.equal(Number(proposal.proposed_quantity), 15, 'the pick bin can fully cover the 15-unit shortfall');
  assert.equal(Number(proposal.shortage_quantity), 0);

  await clickStable(page, `${proposalsHost} [data-role="rpp-select"][data-proposal-id="${proposal.id}"]`);
  await page.waitForSelector(`${proposalsHost} [data-role="rpp-detail"]`, { timeout: 10000 });

  // Maker-checker: the browser session's own actor calculated this proposal, so approving it here
  // must be refused - approval has to come from a genuinely separate identity.
  await clickStable(page, `${proposalsHost} [data-role="rpp-approve"]`);
  await page.waitForFunction((selector) => document.querySelector(selector)?.dataset.phase === 'denied', { timeout: 10000 }, `${proposalsHost} [data-role="rpp-alert"]`);
  assert.match(await page.$eval(`${proposalsHost} [data-role="rpp-alert"]`, (node) => node.textContent), /maker-checker/i);
  assert.equal(dialect.prepare('SELECT status FROM wms_replenishment_proposals_v2 WHERE id=?').get(proposal.id).status, 'proposed');

  const approved = await browserAction(page, 'wms:replenishment_approve', { warehouse_id: seed.warehouse.id, proposal_id: proposal.id }, { user: 'replenishment-supervisor' });
  // Approval creates the warehouse task in the same call, so the proposal's resting status is
  // already 'task_created' by the time the response comes back - 'approved' is only transient.
  assert.equal(approved.proposal.status, 'task_created');
  assert.equal(approved.inventoryWritten, false);

  // The workspace kept this proposal selected across the earlier click, so re-entering the page
  // re-renders the detail panel already open - clicking the row again would toggle it closed.
  await page.evaluate(() => window.switchPage('replenishment_proposals'));
  await page.waitForFunction((selector) => document.querySelectorAll(`${selector} [data-role="rpp-task"]`).length > 0, { timeout: 15000 }, proposalsHost);
  const task = dialect.prepare(`SELECT * FROM wms_warehouse_tasks WHERE source_record_type='replenishment_proposal' AND source_record_id=?`).get(proposal.id);
  assert.equal(task.status, 'ready');
  assert.equal(task.source_location_id, seed.source.locationId);
  assert.equal(task.destination_location_id, seed.destination.locationId);

  await page.type(`${proposalsHost} [data-role="rpp-scan-source-form"] [name="barcode"]`, 'B-PICK');
  await page.click(`${proposalsHost} [data-role="rpp-scan-source-form"] button[type="submit"]`);
  await page.waitForFunction((selector) => document.querySelector(selector) === null, { timeout: 10000 }, `${proposalsHost} [data-role="rpp-scan-source-form"]`);

  await page.type(`${proposalsHost} [data-role="rpp-scan-dest-form"] [name="barcode"]`, 'B-PUT');
  await page.click(`${proposalsHost} [data-role="rpp-scan-dest-form"] button[type="submit"]`);
  await page.waitForFunction((selector) => document.querySelector(selector) === null, { timeout: 10000 }, `${proposalsHost} [data-role="rpp-scan-dest-form"]`);

  await clickStable(page, `${proposalsHost} [data-role="rpp-request-canonical"]`);
  await page.waitForSelector(`${proposalsHost} [data-role="rpp-ack-form"]`, { timeout: 10000 });
  assert.equal(dialect.prepare('SELECT status FROM wms_warehouse_tasks WHERE id=?').get(task.id).status, 'awaiting_canonical');

  const request = JSON.parse(dialect.prepare('SELECT canonical_request_json FROM wms_warehouse_tasks WHERE id=?').get(task.id).canonical_request_json);
  const move = await browserAction(page, 'stock:move:post', { ...request }, { user: 'browser-inventory' });
  assert.equal(move.state, 'done');

  await page.type(`${proposalsHost} [data-role="rpp-ack-form"] [name="canonical_result_id"]`, move.id);
  await page.click(`${proposalsHost} [data-role="rpp-ack-form"] button[type="submit"]`);
  await page.waitForFunction((selector) => document.querySelectorAll(`${selector} [data-role="rpp-task-completed"]`).length > 0, { timeout: 10000 }, proposalsHost);

  assert.equal(dialect.prepare('SELECT status FROM wms_replenishment_proposals_v2 WHERE id=?').get(proposal.id).status, 'completed');
  assert.equal(Number(dialect.prepare('SELECT quantity FROM stock_quants WHERE company_id=? AND product_id=? AND location_id=?').get(seed.companyId, seed.productId, seed.destination.locationId).quantity), 15);

  assert.equal(consoleErrors.filter((message) => !/403|409/.test(message)).length, 0, consoleErrors.join('\n'));
});
