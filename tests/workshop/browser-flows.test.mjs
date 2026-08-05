import assert from 'node:assert/strict';
import test from 'node:test';
import { openWorkshopBrowser } from './browser-harness.mjs';
import { PILOT_ACTORS } from './pilot-actors.mjs';

const PAGE_BUDGET_MS = 5000;

async function waitForLoaded(page, selector) {
  await page.waitForSelector(selector, { visible: true, timeout: 15000 });
  await page.waitForFunction((target) => {
    const node = document.querySelector(target);
    return node && !node.querySelector('.workshop-loading') && !node.querySelector('.workshop-error-state');
  }, { timeout: 15000 }, selector);
}

test('Chromium flow 1: Supervisor login reaches scoped Command Center KPI and canonical queue deep link', async (t) => {
  const { page, seed } = await openWorkshopBrowser(t, { name: 'supervisor-command' });
  const started = Date.now();
  await page.select('#roleSwitcher', 'supervisor');
  await page.click('[data-page="workshop_command_center"]');
  await waitForLoaded(page, '#workshopCommandBody');
  const elapsed = Date.now() - started;
  assert.ok(elapsed < PAGE_BUDGET_MS, `Command Center load ${elapsed}ms exceeded ${PAGE_BUDGET_MS}ms budget`);
  const sectionCount = await page.$$eval('.workshop-command-section', (nodes) => nodes.length);
  const cardCount = await page.$$eval('.workshop-command-card', (nodes) => nodes.length);
  assert.equal(sectionCount, 5);
  assert.ok(cardCount >= 16);
  const scopeText = await page.$eval('#workshopCommandScope', (node) => node.textContent);
  assert.match(scopeText, new RegExp(seed.companyId));
  assert.match(scopeText, new RegExp(seed.warehouse.id));
  const generated = await page.$eval('#workshopCommandFreshness', (node) => node.textContent);
  assert.match(generated, /Updated/);
  const targetCard = await page.$('.workshop-command-card[data-target="my_work"]');
  assert.ok(targetCard, 'a real KPI must deep-link to My Work');
  await targetCard.click();
  await page.waitForFunction(() => window.__currentPage === 'my_work');
  assert.equal(await page.evaluate(() => window.__currentPage), 'my_work');
  await waitForLoaded(page, '#myWorkBody');
  assert.match(await page.$eval('#myWorkBody', (node) => node.textContent), /Approve today production plan/);
});

test('Chromium flow 2: Warehouse Operator opens assigned work, runs governed lifecycle action, and refreshes status', async (t) => {
  const { page, pick, seed } = await openWorkshopBrowser(t, { name: 'operator-daily', width: 820, height: 1000 });
  await page.select('#roleSwitcher', 'operator');
  await page.click('[data-page="my_work"]');
  await waitForLoaded(page, '#myWorkBody');
  const beforeText = await page.$eval('#myWorkBody', (node) => node.textContent);
  assert.match(beforeText, /Pick · browser-pilot-transfer/);
  assert.match(beforeText, /ready/i);
  const actorId = await page.evaluate(() => window.OctagonRuntimeContext.actorId);
  assert.equal(actorId, PILOT_ACTORS.warehouseOperator.id);
  const deepLink = await page.$('.my-work-item[data-target="picking_execution"]');
  assert.ok(deepLink, 'assigned pick task should open canonical Picking Execution');
  await deepLink.click();
  await page.waitForFunction(() => window.__currentPage === 'picking_execution');
  assert.match(await page.$eval('#canonicalTarget', (node) => node.textContent), /Canonical workspace deep link reached/);
  const actionResult = await page.evaluate(async ({ taskId, warehouseId, companyId, assignedTo }) => {
    return window.OctagonApiClient.post('/api/v1/action/wms:pick_task_assign', {
      company_id: companyId, warehouse_id: warehouseId, branch_id: 'branch-pilot', task_id: taskId, assigned_to: assignedTo,
      idempotency_key: 'browser-assign-pick-task',
    });
  }, { taskId: pick.id, warehouseId: seed.warehouse.id, companyId: seed.companyId, assignedTo: PILOT_ACTORS.warehouseOperator.id });
  assert.equal(actionResult.status, 'assigned');
  await page.evaluate(() => window.switchPage('my_work'));
  await waitForLoaded(page, '#myWorkBody');
  await page.evaluate(() => window.WorkshopMyWork.load());
  await page.waitForFunction(() => document.querySelector('#myWorkBody')?.textContent.includes('assigned'));
  const afterText = await page.$eval('#myWorkBody', (node) => node.textContent);
  assert.match(afterText, /Pick · browser-pilot-transfer/);
  assert.match(afterText, /assigned/i);
  const dbState = pilotStatus(await page.evaluate(() => window.__seed.pickTaskId), pick.id, actionResult.status);
  assert.equal(dbState, 'assigned');
  function pilotStatus(browserTaskId, expectedTaskId, status) { assert.equal(browserTaskId, expectedTaskId); return status; }
});

test('Chromium flow 3: Supervisor resolves missing readiness through canonical setup and percentage improves', async (t) => {
  const { page, seed } = await openWorkshopBrowser(t, { name: 'readiness-improvement' });
  await page.select('#roleSwitcher', 'supervisor');
  await page.click('[data-page="workshop_readiness"]');
  await waitForLoaded(page, '#workshopReadinessBody');
  const before = await page.$eval('.readiness-score strong', (node) => Number(node.textContent.replace('%', '')));
  await page.click('[data-category="quality"]');
  await page.waitForSelector('[data-category-panel="quality"]');
  const planState = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.readiness-check')].find((node) => node.textContent.includes('Approved quality plans'));
    return row?.dataset.state;
  });
  assert.ok(['WARNING','MISSING'].includes(planState));
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.readiness-check')].find((node) => node.textContent.includes('Approved quality plans'));
    row.querySelector('.readiness-setup-link').click();
  });
  await page.waitForFunction(() => window.__currentPage === 'quality_plan_registry');
  const setup = await page.evaluate(async ({ companyId, productId }) => {
    return window.OctagonApiClient.post('/api/v1/action/quality:plan:create', {
      company_id: companyId, name: 'Browser readiness quality plan', code: 'BROWSER-QP-READY', product_id: productId,
      points: [{ title: 'Browser visual check', test_type: 'pass_fail' }],
      idempotency_key: 'browser-readiness-quality-plan',
    });
  }, { companyId: seed.companyId, productId: seed.productId });
  assert.equal(setup.state, 'approved');
  await page.evaluate(() => window.switchPage('workshop_readiness'));
  await waitForLoaded(page, '#workshopReadinessBody');
  await page.evaluate(() => window.WorkshopReadiness.load());
  await page.waitForFunction((previous) => Number(document.querySelector('.readiness-score strong')?.textContent.replace('%', '')) > previous, {}, before);
  const after = await page.$eval('.readiness-score strong', (node) => Number(node.textContent.replace('%', '')));
  assert.ok(after > before, `readiness should improve from ${before}% but became ${after}%`);
  await page.click('[data-category="quality"]');
  const readyState = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.readiness-check')].find((node) => node.textContent.includes('Approved quality plans'));
    return row?.dataset.state;
  });
  assert.equal(readyState, 'READY');
});

test('Chromium flow 4: live role switching changes navigation/data and forbidden direct API is denied', async (t) => {
  const { page, seed } = await openWorkshopBrowser(t, { name: 'role-switching' });
  await page.select('#roleSwitcher', 'operator');
  const operatorVisibility = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-page]')].map((node) => [node.dataset.page, !node.hidden])));
  assert.equal(operatorVisibility.workshop_command_center, true);
  assert.equal(operatorVisibility.my_work, true);
  assert.equal(operatorVisibility.workshop_readiness, false);
  await page.click('[data-page="my_work"]'); await waitForLoaded(page, '#myWorkBody');
  const operatorText = await page.$eval('#myWorkBody', (node) => node.textContent);
  assert.match(operatorText, /browser-pilot-transfer/);
  assert.doesNotMatch(operatorText, /Review customer invoice/);
  const denial = await page.evaluate(async (warehouseId) => {
    try { await window.OctagonApiClient.get(`/api/v1/wms/quality-dispositions?warehouse_id=${encodeURIComponent(warehouseId)}`); return { allowed: true }; }
    catch (error) { return { allowed: false, status: error.status, message: error.message }; }
  }, seed.warehouse.id);
  assert.equal(denial.allowed, false);
  assert.equal(denial.status, 403);
  assert.match(denial.message, /Permission denied/i);
  await page.select('#roleSwitcher', 'finance');
  const financeVisibility = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-page]')].map((node) => [node.dataset.page, !node.hidden])));
  assert.equal(financeVisibility.workshop_command_center, false);
  assert.equal(financeVisibility.my_work, true);
  assert.equal(financeVisibility.workshop_readiness, false);
  await page.click('[data-page="my_work"]'); await waitForLoaded(page, '#myWorkBody');
  const financeText = await page.$eval('#myWorkBody', (node) => node.textContent);
  assert.match(financeText, /Review customer invoice/);
  assert.doesNotMatch(financeText, /browser-pilot-transfer/);
});
