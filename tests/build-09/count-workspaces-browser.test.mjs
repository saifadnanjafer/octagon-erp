import assert from 'node:assert/strict';
import test from 'node:test';
import { browserAction, clickStable, latinDigits, openBuild09Browser } from './browser-harness.mjs';

// BUILD-09R-2 Group B: real Chromium drives Cycle Count Plans -> Count Session -> Variance
// Review (modules/build09-count-workspace.js) through visible controls only.
//
// Two invariants are asserted from the rendered DOM, not just from the database:
//   * a blind session must NOT render the theoretical quantity while counting - if it leaked,
//     the counter would be told the answer and the blind count would be worthless;
//   * the variance path proposes a canonical adjustment and never posts stock itself.

const COUNT_MODULES = ['build09r-shared.js', 'build09-count-workspace.js'];

// Asserting on raw ASCII would make every "quantity is hidden" check pass vacuously here, since
// the harness renders lang="ar" - latinDigits() folds the Arabic-Indic digits back first.
const latin = latinDigits;

test('real Chromium creates a blind count plan, starts a session, and hides the expected quantity', async (t) => {
  const { consoleErrors, dialect, page, seed } = await openBuild09Browser(t, { name: 'count-plans-ui', initialPage: 'cycle_count_plans', extraModules: COUNT_MODULES });
  const host = '[data-build09-page="cycle_count_plans"]';

  await page.waitForSelector(`${host} [data-role="cp-form"]`, { timeout: 15000 });
  await page.type(`${host} [data-role="cp-form"] [name="name"]`, 'PLAN-UI-BLIND');
  await page.select(`${host} [data-role="cp-form"] [name="count_scope"]`, 'location');
  await page.select(`${host} [data-role="cp-form"] [name="blind_count"]`, 'true');

  // The scope selector swaps to a governed location lookup when scope = location.
  await page.waitForSelector(`${host} [data-role="cp-selector"] [data-lookup-resource="locations"]`, { timeout: 5000 });
  await page.type(`${host} [data-role="cp-selector"] .b09-lookup-query`, 'Browser Pick');
  await page.waitForFunction((selector) => {
    const node = document.querySelector(selector);
    return node && node.options.length > 1;
  }, { timeout: 5000 }, `${host} [data-role="cp-selector"] .b09-lookup-select`);
  await page.select(`${host} [data-role="cp-selector"] .b09-lookup-select`, seed.source.locationId);
  await page.click(`${host} [data-role="cp-form"] button[type="submit"]`);

  await page.waitForFunction((selector) => document.querySelectorAll(`${selector} [data-role="cp-start"]`).length > 0, { timeout: 15000 }, host);
  const plan = dialect.prepare('SELECT * FROM wms_count_plans_v2 WHERE name=?').get('PLAN-UI-BLIND');
  assert.equal(plan.count_scope, 'location');
  assert.equal(plan.location_id, seed.source.locationId);
  assert.equal(Number(plan.blind_count), 1);

  await clickStable(page, `${host} [data-role="cp-start"][data-plan-id="${plan.id}"]`);
  await page.waitForSelector(`${host} [data-role="cp-started"]`, { timeout: 15000 });
  const countSession = dialect.prepare('SELECT * FROM wms_count_sessions_v2 WHERE plan_id=?').get(plan.id);
  assert.equal(countSession.status, 'counting');
  assert.equal(Number(countSession.blind_count), 1);
  const lines = dialect.prepare('SELECT * FROM wms_count_lines_v2 WHERE session_id=?').all(countSession.id);
  assert.equal(lines.length, 1, 'the seeded pick bin holds exactly one product line');
  assert.equal(Number(lines[0].theoretical_quantity), 20);

  // Now open the Count Session workspace and prove the blind rule holds in the rendered DOM.
  await page.evaluate(() => window.switchPage('count_session'));
  const sessionHost = '[data-build09-page="count_session"]';
  await page.waitForFunction((selector) => document.querySelectorAll(`${selector} [data-role="cs-open"]`).length > 0, { timeout: 15000 }, sessionHost);
  await clickStable(page, `${sessionHost} [data-role="cs-open"][data-session-id="${countSession.id}"]`);
  await page.waitForSelector(`${sessionHost} [data-role="cs-expected"]`, { timeout: 10000 });

  const expectedCell = latin(await page.$eval(`${sessionHost} [data-role="cs-expected"]`, (node) => node.textContent.trim()));
  assert.doesNotMatch(expectedCell, /20/, 'a blind count must not render the theoretical quantity while counting');
  assert.match(expectedCell, /أعمى|blind/, 'the expected cell states that the count is blind');
  const panelText = latin(await page.$eval(`${sessionHost} [data-role="cs-body"]`, (node) => node.textContent));
  assert.doesNotMatch(panelText, /\b20\b/, 'the theoretical quantity must not leak anywhere in the counting panel');

  assert.equal(consoleErrors.filter((message) => !/403/.test(message)).length, 0, consoleErrors.join('\n'));
});

test('real Chromium records a variance, hits the approval boundary, then proposes a canonical adjustment', async (t) => {
  const { consoleErrors, dialect, page, seed } = await openBuild09Browser(t, { name: 'count-variance-ui', initialPage: 'count_session', extraModules: COUNT_MODULES });
  const sessionHost = '[data-build09-page="count_session"]';
  const reviewHost = '[data-build09-page="variance_review"]';

  // Directed session so the counter can see the expected quantity they are counting against.
  const started = await browserAction(page, 'wms:count_session_start', { warehouse_id: seed.warehouse.id, location_id: seed.source.locationId, blind_count: false });
  assert.equal(started.lines.length, 1);

  await page.evaluate(() => window.switchPage('count_session'));
  await page.waitForFunction((selector) => document.querySelectorAll(`${selector} [data-role="cs-open"]`).length > 0, { timeout: 15000 }, sessionHost);
  await clickStable(page, `${sessionHost} [data-role="cs-open"][data-session-id="${started.id}"]`);
  await page.waitForSelector(`${sessionHost} [data-role="cs-line-form"]`, { timeout: 10000 });

  const directedExpected = latin(await page.$eval(`${sessionHost} [data-role="cs-expected"]`, (node) => node.textContent.trim()));
  assert.match(directedExpected, /20/, 'a directed count shows the expected quantity');

  // Count 17 against an expected 20 - a real -3 variance.
  await page.type(`${sessionHost} [data-role="cs-line-form"] [name="counted_quantity"]`, '17');
  await page.type(`${sessionHost} [data-role="cs-line-form"] [name="discrepancy_reason"]`, 'damaged in bin');
  await page.click(`${sessionHost} [data-role="cs-line-form"] button[type="submit"]`);

  await page.waitForFunction((selector) => !document.querySelector(`${selector} [data-role="cs-submit"]`)?.disabled, { timeout: 10000 }, sessionHost);
  await clickStable(page, `${sessionHost} [data-role="cs-submit"]`);
  await page.waitForFunction((selector) => /variance_review/.test(document.querySelector(`${selector} [data-role="cs-body"]`)?.textContent || ''), { timeout: 10000 }, sessionHost);

  const submitted = dialect.prepare('SELECT status,variance_count FROM wms_count_sessions_v2 WHERE id=?').get(started.id);
  assert.equal(submitted.status, 'variance_review');
  assert.equal(Number(submitted.variance_count), 1);
  const line = dialect.prepare('SELECT variance_quantity,tolerance_exceeded FROM wms_count_lines_v2 WHERE session_id=?').get(started.id);
  assert.equal(Number(line.variance_quantity), -3);
  assert.equal(Number(line.tolerance_exceeded), 1);

  await page.evaluate(() => window.switchPage('variance_review'));
  await page.waitForFunction((selector) => document.querySelectorAll(`${selector} [data-role="vr-open"]`).length > 0, { timeout: 15000 }, reviewHost);
  await clickStable(page, `${reviewHost} [data-role="vr-open"][data-session-id="${started.id}"]`);
  await page.waitForSelector(`${reviewHost} [data-role="vr-lines"]`, { timeout: 10000 });

  const varianceText = latin(await page.$eval(`${reviewHost} [data-role="vr-lines"]`, (node) => node.textContent));
  assert.match(varianceText, /-3/, 'the variance line shows the signed difference');
  assert.match(varianceText, /20/, 'the variance line shows the expected quantity');
  assert.match(varianceText, /17/, 'the variance line shows the counted quantity');

  // The same actor counted this line, so approval must be refused and shown as denied.
  await page.type(`${reviewHost} [data-role="vr-approve-form"] [name="reason"]`, 'accepted shrinkage');
  await page.click(`${reviewHost} [data-role="vr-approve-form"] button[type="submit"]`);
  await page.waitForFunction((selector) => document.querySelector(selector)?.dataset.phase === 'denied', { timeout: 10000 }, `${reviewHost} [data-role="vr-alert"]`);
  assert.match(await page.$eval(`${reviewHost} [data-role="vr-alert"]`, (node) => node.textContent), /maker-checker/i);
  assert.equal(dialect.prepare('SELECT status FROM wms_count_sessions_v2 WHERE id=?').get(started.id).status, 'variance_review');

  // A separate approver clears it; the UI then proposes - never posts - the canonical adjustment.
  await browserAction(page, 'wms:count_approve_variance', { warehouse_id: seed.warehouse.id, session_id: started.id, reason: 'accepted shrinkage' }, { user: 'count-supervisor' });
  await page.evaluate(() => window.switchPage('variance_review'));
  await page.waitForFunction((selector) => document.querySelectorAll(`${selector} [data-role="vr-open"]`).length > 0, { timeout: 15000 }, reviewHost);
  await clickStable(page, `${reviewHost} [data-role="vr-open"][data-session-id="${started.id}"]`);
  await page.waitForSelector(`${reviewHost} [data-role="vr-adjust"]`, { timeout: 10000 });
  await clickStable(page, `${reviewHost} [data-role="vr-adjust"]`);

  await page.waitForSelector(`${reviewHost} [data-role="vr-proposal"]`, { timeout: 10000 });
  const proposalText = await page.$eval(`${reviewHost} [data-role="vr-proposal"]`, (node) => node.textContent);
  assert.match(proposalText, /loss/, 'a -3 variance proposes a loss adjustment');

  const closed = dialect.prepare('SELECT status,adjustment_request_json FROM wms_count_sessions_v2 WHERE id=?').get(started.id);
  assert.equal(closed.status, 'awaiting_canonical');
  const payload = JSON.parse(closed.adjustment_request_json);
  assert.equal(payload.executionBoundary, 'REQUEST_ONLY');
  assert.equal(payload.inventoryWritten, false);
  assert.equal(payload.requests.length, 1);
  assert.equal(payload.requests[0].action, 'stock:move:post');
  // The decisive proof: the count proposed an adjustment and moved no stock of its own.
  const quant = dialect.prepare('SELECT quantity FROM stock_quants WHERE company_id=? AND product_id=? AND location_id=?').get(seed.companyId, seed.productId, seed.source.locationId);
  assert.equal(Number(quant.quantity), 20, 'requesting an adjustment must not change on-hand stock');

  assert.equal(consoleErrors.filter((message) => !/403/.test(message)).length, 0, consoleErrors.join('\n'));
});
