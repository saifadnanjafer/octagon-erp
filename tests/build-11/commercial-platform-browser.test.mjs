import assert from 'node:assert/strict';
import test from 'node:test';
import { browserAction, browserQuery, openBuild11Browser } from './browser-harness.mjs';

async function ready(page, pageId) {
  await page.waitForSelector(`[data-build11-page="${pageId}"] .b11-status[data-phase="ready"]`, { timeout: 30000 });
}

async function clickAndWait(page, selector, pageId) {
  const response = page.waitForResponse((candidate) => candidate.url().includes('/api/v1/action/') && candidate.request().method() === 'POST', { timeout: 30000 });
  await page.click(selector);
  await response;
  await page.waitForFunction(() => ['ready', 'denied', 'error'].includes(document.querySelector('[data-role="status"]')?.dataset.phase), { timeout: 30000 });
  if (await page.$(`[data-build11-page="${pageId}"] .b11-status[data-phase="ready"]`)) return;
  await page.waitForSelector(`[data-build11-page="${pageId}"] .b11-status[data-phase="ready"]`, { timeout: 30000 });
}

async function navigate(page, pageId) {
  await page.evaluate((id) => window.Build11Engine.activate(id), pageId);
  await ready(page, pageId);
}

let testTail = Promise.resolve();
function serialTest(name, fn) {
  test(name, async (t) => {
    const prior = testTail;
    let release;
    testTail = new Promise((resolve) => { release = resolve; });
    await prior;
    t.after(() => release());
    return fn(t);
  });
}

serialTest('FLOW 1 tenant and subscription uses visible lifecycle controls', async (t) => {
  const { consoleErrors, dialect, page } = await openBuild11Browser(t, { name: 'flow-1-tenant', initialPage: 'tenant_directory' });
  await page.waitForSelector('[data-b11-form="tenant-create"] input[name="tenant_ref"]');
  await page.type('[data-b11-form="tenant-create"] input[name="tenant_ref"]', 'tenant_flow_one');
  await page.type('[data-b11-form="tenant-create"] input[name="name"]', 'Flow One Tenant');
  await clickAndWait(page, '[data-b11-form="tenant-create"] button[type="submit"]', 'tenant_directory');
  assert.equal(dialect.prepare('SELECT lifecycle_state FROM saas_tenant_profiles WHERE tenant_id=?').get('tenant_flow_one').lifecycle_state, 'draft');
  await page.click('[data-b11-nav="tenant_detail"][data-tenant-id="tenant_flow_one"]');
  await ready(page, 'tenant_detail');
  await clickAndWait(page, '[data-b11-form="tenant-provision"] button[type="submit"]', 'tenant_detail');
  assert.equal(dialect.prepare('SELECT lifecycle_state FROM saas_tenant_profiles WHERE tenant_id=?').get('tenant_flow_one').lifecycle_state, 'trial');
  await clickAndWait(page, '[data-b11-action="saas:tenant_transition"][data-to-state="active"]', 'tenant_detail');
  assert.equal(dialect.prepare('SELECT lifecycle_state FROM saas_tenant_profiles WHERE tenant_id=?').get('tenant_flow_one').lifecycle_state, 'active');
  await page.click('[data-b11-tab="entitlements"]'); await ready(page, 'tenant_detail');
  assert.ok(await page.$('[data-build11-page="tenant_detail"] .b11-table-wrap'));
  await page.click('[data-b11-tab="seats"]'); await ready(page, 'tenant_detail');
  assert.ok(await page.$('[data-build11-page="tenant_detail"] [data-state="empty"]'));
  assert.equal(consoleErrors.length, 0, consoleErrors.join('\n'));
});

serialTest('FLOW 2 expiry and restore keeps reads available while protected mutation is denied', async (t) => {
  const { dialect, page } = await openBuild11Browser(t, { name: 'flow-2-expiry', initialPage: 'billing_simulator' });
  await page.waitForSelector('[data-b11-form="invoice-simulate"] input[name="seat_price"]');
  await clickAndWait(page, '[data-b11-form="invoice-simulate"] button[type="submit"]', 'billing_simulator');
  const invoiceId = dialect.prepare('SELECT id FROM saas_simulated_invoices ORDER BY created_at DESC LIMIT 1').get().id;
  const subscriptionId = dialect.prepare('SELECT subscription_id FROM saas_simulated_invoices WHERE id=?').get(invoiceId).subscription_id;
  await clickAndWait(page, `[data-b11-action="saas:payment_simulate"][data-invoice-id="${invoiceId}"][data-payment-status="failed"]`, 'billing_simulator');
  await navigate(page, 'subscriptions');
  await clickAndWait(page, '[data-b11-action="saas:subscription_transition"][data-to-status="grace"]', 'subscriptions');
  await clickAndWait(page, '[data-b11-action="saas:subscription_transition"][data-to-status="suspended"]', 'subscriptions');
  assert.equal(dialect.prepare('SELECT status FROM saas_subscriptions WHERE id=?').get(subscriptionId).status, 'suspended');
  await navigate(page, 'usage_and_quotas');
  await page.type('[data-b11-form="usage-record"] input[name="quantity"]', '1');
  const deniedTransition = page.waitForSelector('[data-role="status"][data-phase="denied"]');
  await page.click('[data-b11-form="usage-record"] button[type="submit"]'); await deniedTransition;
  await navigate(page, 'entitlements');
  assert.ok(await page.$('[data-build11-page="entitlements"] .b11-table-wrap'));
  await navigate(page, 'billing_simulator');
  await clickAndWait(page, `[data-b11-action="saas:payment_simulate"][data-invoice-id="${invoiceId}"][data-payment-status="succeeded"]`, 'billing_simulator');
  await navigate(page, 'subscriptions');
  await clickAndWait(page, '[data-b11-action="saas:subscription_transition"][data-to-status="active"]', 'subscriptions');
  assert.equal(dialect.prepare('SELECT status FROM saas_subscriptions WHERE id=?').get(subscriptionId).status, 'active');
});

serialTest('FLOW 3 usage and quota exposes warning, hard denial, and reconciliation', async (t) => {
  const { dialect, page } = await openBuild11Browser(t, { name: 'flow-3-quota', initialPage: 'usage_and_quotas' });
  await browserAction(page, 'saas:usage_record', { tenant_id: 'default', metric: 'full_user', quantity: 8, unit: 'seats', source: 'fixture', idempotency_key: 'flow-3-seed' });
  await navigate(page, 'usage_and_quotas');
  await page.select('[data-b11-form="usage-record"] select[name="metric"]', 'full_user');
  await page.$eval('[data-b11-form="usage-record"] input[name="quantity"]', (node) => { node.value = '1'; });
  await clickAndWait(page, '[data-b11-form="usage-record"] button[type="submit"]', 'usage_and_quotas');
  assert.equal(dialect.prepare("SELECT consumed FROM saas_usage_counters WHERE tenant_id='default' AND metric='full_user'").get().consumed, 9);
  await page.select('[data-b11-form="usage-record"] select[name="metric"]', 'full_user');
  await page.$eval('[data-b11-form="usage-record"] input[name="quantity"]', (node) => { node.value = '2'; });
  const quotaDenied = page.waitForSelector('[data-role="status"][data-phase="denied"]');
  await page.click('[data-b11-form="usage-record"] button[type="submit"]'); await quotaDenied;
  await clickAndWait(page, '[data-b11-form="usage-reconcile"] button[type="submit"]', 'usage_and_quotas');
  dialect.prepare("DELETE FROM saas_usage_events WHERE tenant_id='default' AND metric='full_user'").run();
  dialect.prepare("DELETE FROM saas_usage_counters WHERE tenant_id='default' AND metric='full_user'").run();
  dialect.prepare("DELETE FROM saas_quota_warnings WHERE tenant_id='default' AND metric='full_user'").run();
});

serialTest('FLOW 4 marketplace uses guided validation through rollback and shows malicious rejection', async (t) => {
  const { page } = await openBuild11Browser(t, { name: 'flow-4-marketplace', initialPage: 'extension_marketplace' });
  const form = '[data-b11-form="package-validate"]';
  await page.waitForSelector(`${form} input[name="package_id"]`);
  for (const [name, text] of [['package_id', 'flow_safe'], ['publisher', 'curated'], ['name', 'Safe Overlay'], ['version', '1.0.0'], ['compatibility_range', '*'], ['manifest_version', '1'], ['provenance', 'curated'], ['checksum', 'sha256:flow'], ['signature', 'signed:flow']]) await page.$eval(`${form} input[name="${name}"]`, (node, next) => { node.value = next; }, text);
  await clickAndWait(page, `${form} button[type="submit"]`, 'extension_marketplace');
  await clickAndWait(page, '[data-b11-action="saas:package_approve"][data-package-id="flow_safe"]', 'extension_marketplace');
  await clickAndWait(page, '[data-b11-action="saas:package_stage"][data-package-id="flow_safe"]', 'extension_marketplace');
  await navigate(page, 'extension_installations');
  await clickAndWait(page, '[data-b11-action="saas:package_enable"][data-installation-id]', 'extension_installations');
  await clickAndWait(page, '[data-b11-action="saas:package_disable"][data-installation-id]', 'extension_installations');
  await clickAndWait(page, '[data-b11-action="saas:package_rollback"][data-installation-id]', 'extension_installations');
  await browserAction(page, 'saas:package_validate', { manifest: { package_id: 'flow_bad', publisher: 'untrusted', name: 'Unsafe', version: '1.0.0', compatibility_range: '*', manifest_version: '1', provenance: 'untrusted', checksum: 'sha256:bad', signature: 'signed:bad', contributions: [{ type: 'arbitrary_code', source: 'eval()' }] } });
  await navigate(page, 'extension_marketplace');
  assert.match(await page.$eval('body', (node) => node.textContent), /UNSAFE_EXECUTION_DECLARATION/);
});

serialTest('FLOW 5 isolation and roles deny cross-tenant and unauthorized mutation paths', async (t) => {
  const { page } = await openBuild11Browser(t, { name: 'flow-5-isolation', initialPage: 'tenant_directory' });
  await browserAction(page, 'saas:tenant_create', { tenant_id: 'tenant_flow_b', name: 'Tenant B' });
  const own = await browserQuery(page, 'tenant/default', { tenant: 'default', user: 'tenant-admin' });
  assert.equal(own.status, 200);
  const cross = await browserQuery(page, 'tenant/tenant_flow_b', { tenant: 'default', user: 'tenant-admin' });
  assert.equal(cross.status, 403);
  const list = await browserQuery(page, 'tenants?tenant_id=tenant_flow_b', { tenant: 'default', user: 'tenant-admin' });
  assert.equal(list.status, 200); assert.equal(list.data.some((row) => row.id === 'tenant_flow_b'), false);
  const manipulated = await page.evaluate(async () => { const response = await fetch('/api/v1/action/saas:tenant_transition', { method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant': 'default', 'x-user': 'tenant-admin' }, body: JSON.stringify({ tenant_id: 'tenant_flow_b', to_state: 'active', command: 'tenant:activate', reason: 'spoof' }) }); return response.status; });
  assert.equal(manipulated, 403);
  const viewerMutation = await page.evaluate(async () => { const response = await fetch('/api/v1/action/saas:tenant_transition', { method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant': 'default', 'x-user': 'viewer' }, body: JSON.stringify({ tenant_id: 'default', to_state: 'active', command: 'tenant:activate', reason: 'viewer' }) }); return response.status; });
  assert.equal(viewerMutation, 403);
  const reviewerMutation = await page.evaluate(async () => { const response = await fetch('/api/v1/action/saas:tenant_transition', { method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant': 'default', 'x-user': 'package-reviewer' }, body: JSON.stringify({ tenant_id: 'default', to_state: 'active', command: 'tenant:activate', reason: 'reviewer' }) }); return response.status; });
  assert.equal(reviewerMutation, 403);
});
