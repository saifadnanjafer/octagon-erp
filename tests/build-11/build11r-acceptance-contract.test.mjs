import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const workspace = fs.readFileSync('modules/build11-workspaces.js', 'utf8');
const authority = fs.readFileSync('platform/build11/index.mjs', 'utf8');
const migration = fs.readFileSync('database/migrations/087_build11_commercial_platform.mjs', 'utf8');
const permissions = fs.readFileSync('services/permissionService.js', 'utf8');
const pages = ['saas_overview', 'tenant_directory', 'tenant_detail', 'commercial_plans', 'subscriptions', 'entitlements', 'seats_and_limits', 'usage_and_quotas', 'billing_simulator', 'extension_marketplace', 'extension_installations'];
const rendererNames = ['renderSaasOverview', 'renderTenantDirectory', 'renderTenantDetail', 'renderCommercialPlans', 'renderSubscriptions', 'renderEntitlements', 'renderSeatsAndLimits', 'renderUsageAndQuotas', 'renderBillingSimulator', 'renderExtensionMarketplace', 'renderExtensionInstallations'];

test('BUILD-11R registers eleven distinct purpose-built renderer functions', () => {
  const registry = workspace.match(/const RENDERERS = \{([\s\S]*?)\};/)?.[1] || '';
  assert.equal(rendererNames.length, pages.length);
  for (const renderer of rendererNames) assert.match(workspace, new RegExp(`function ${renderer}\\b`));
  for (const page of pages) assert.match(registry, new RegExp(`${page}:`));
  assert.equal(new Set(rendererNames).size, pages.length);
});

test('BUILD-11R normal UI uses guided fields and never exposes raw manifest authority input', () => {
  assert.doesNotMatch(workspace, /<textarea|Manifest JSON|name=["']manifest["']/i);
  for (const field of ['package_id', 'publisher', 'name', 'version', 'compatibility_range', 'manifest_version', 'provenance', 'checksum', 'signature', 'permissions_requested', 'contribution_type', 'dependencies']) assert.match(workspace, new RegExp(`['"]${field}['"]`));
  assert.match(workspace, /package-validate/);
  assert.match(authority, /UNSAFE_EXECUTION_DECLARATION/);
});

test('BUILD-11R visible actions are registered and permission-governed', () => {
  const visibleActions = ['saas:tenant_create', 'saas:tenant_provision', 'saas:tenant_transition', 'saas:plan_publish', 'saas:subscription_create', 'saas:subscription_transition', 'saas:seat_assign', 'saas:usage_record', 'saas:usage_reconcile', 'saas:invoice_simulate', 'saas:invoice_issue', 'saas:payment_simulate', 'saas:package_validate', 'saas:package_approve', 'saas:package_stage', 'saas:package_enable', 'saas:package_disable', 'saas:package_rollback'];
  for (const action of visibleActions) {
    assert.match(authority, new RegExp(`register\\('${action.replace(':', '\\:')}`), `${action} must have an executable handler`);
    assert.match(migration, new RegExp(`\\['${action.replace(':', '\\:')}`), `${action} must declare a server permission`);
  }
  for (const page of pages) assert.match(permissions, new RegExp(`\\b${page}:`));
});

test('BUILD-11R metric selection is governed by the registered metric set', () => {
  assert.match(workspace, /const REGISTERED_METRICS = \[/);
  assert.match(workspace, /select\('metric'/);
  assert.doesNotMatch(workspace, /<input[^>]+name=["']metric["']/i);
  const metricValues = [...workspace.matchAll(/'([a-z][a-z0-9_]+)'/g)].map((match) => match[1]);
  for (const metric of ['api_calls', 'full_user', 'storage_bytes', 'companies', 'reports']) assert.ok(metricValues.includes(metric));
  for (const metric of ['api_calls', 'full_user', 'storage_bytes', 'companies', 'reports']) assert.match(authority, new RegExp(`['"]${metric}['"]`));
});

test('BUILD-11R retains explicit simulation and safety boundaries', () => {
  assert.match(workspace, /SIMULATION — NO EXTERNAL CHARGE — NO GL POSTING/);
  assert.match(migration, /NO GL POSTING/);
  assert.match(authority, /SAFE_CONTRIBUTIONS/);
  assert.match(authority, /SUBSCRIPTION_STATE_BLOCKED/);
});
