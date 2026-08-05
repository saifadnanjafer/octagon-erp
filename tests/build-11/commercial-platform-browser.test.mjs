import assert from 'node:assert/strict';
import test from 'node:test';
import { browserAction, browserQuery, openBuild11Browser } from './browser-harness.mjs';

test('BUILD-11 Chromium tenant, quota, billing, and safe marketplace flow', async (t) => {
  const { consoleErrors, dialect, page } = await openBuild11Browser(t, { name: 'lifecycle', initialPage: 'tenant_directory' });
  await page.type('[data-build11-form="tenant-create"] input[name="tenant_id"]', 'tenant_browser');
  await page.type('[data-build11-form="tenant-create"] input[name="name"]', 'Browser Tenant');
  await page.click('[data-build11-action="tenant-create"]');
  await page.waitForFunction(() => document.querySelector('[data-role="status"]')?.dataset.phase === 'ready');
  const created = dialect.prepare('SELECT lifecycle_state FROM saas_tenant_profiles WHERE tenant_id=?').get('tenant_browser');
  assert.equal(created.lifecycle_state, 'draft');
  await browserAction(page, 'saas:tenant_provision', { tenant_id: 'tenant_browser' });
  assert.equal(dialect.prepare('SELECT lifecycle_state FROM saas_tenant_profiles WHERE tenant_id=?').get('tenant_browser').lifecycle_state, 'trial');

  await page.evaluate(() => { document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr'; window.switchPage('usage_and_quotas'); });
  await page.waitForSelector('[data-build11-page="usage_and_quotas"] .b11-status[data-phase="ready"]');
  await browserAction(page, 'saas:usage_record', { tenant_id: 'default', metric: 'api_calls', quantity: 1, unit: 'calls', source: 'chromium', idempotency_key: 'browser-usage-1' });
  await page.evaluate(() => window.Build11Engine.activate('usage_and_quotas'));
  await page.waitForFunction(() => document.querySelector('[data-build11-page="usage_and_quotas"] tbody tr'));
  assert.equal(await page.$eval('html', (node) => node.dir), 'ltr');

  const invalid = await browserAction(page, 'saas:package_validate', { manifest: { package_id: 'browser_bad', publisher: 'unknown', name: 'Bad', version: '1.0.0', compatibility_range: '*', manifest_version: '1', provenance: 'untrusted', contributions: [{ type: 'arbitrary_code', source: 'eval()' }] } });
  assert.ok(invalid.findings.length > 0);
  const safe = await browserAction(page, 'saas:package_validate', { manifest: { package_id: 'browser_safe', publisher: 'curated', name: 'Safe Overlay', version: '1.0.0', compatibility_range: '*', manifest_version: '1', provenance: 'curated', checksum: 'sha256:browser', signature: 'signed:browser', permissions_requested: [], contributions: [{ type: 'terminology_overlay', capability: 'module:core' }] } });
  assert.deepEqual(safe.findings, []);
  await browserAction(page, 'saas:package_approve', { package_id: 'browser_safe' });
  const staged = await browserAction(page, 'saas:package_stage', { package_id: 'browser_safe', tenant_id: 'default' });
  await browserAction(page, 'saas:package_enable', { installation_id: staged.id });
  const installation = await browserQuery(page, 'extension-installations');
  assert.equal(installation.data[0].state, 'enabled');
  assert.equal(consoleErrors.length, 0, consoleErrors.join('\n'));
});

test('BUILD-11 Chromium displays honest isolation denial and responsive workspace', async (t) => {
  const { consoleErrors, page } = await openBuild11Browser(t, { name: 'isolation', initialPage: 'tenant_detail' });
  await page.evaluate(() => window.Build11Engine.activate('tenant_detail'));
  await page.waitForSelector('[data-build11-page="tenant_detail"] .b11-status');
  const denied = await browserQuery(page, 'tenant/tenant_browser_missing', { tenant: 'default', user: 'tenant-admin' });
  assert.equal(denied.status, 403);
  await page.setViewport({ width: 390, height: 844 });
  assert.equal(await page.$eval('.b11-table-wrap', (node) => getComputedStyle(node).overflowX), 'auto');
  assert.equal(consoleErrors.filter((message) => !message.includes('403 (Forbidden)')).length, 0, consoleErrors.join('\n'));
});
