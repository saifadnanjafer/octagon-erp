import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { openMigrationDatabase, freshInstall } from '../../database/migration-runner/index.mjs';
import { createExecutionContext } from '../../platform/identity/context/index.mjs';
import { createSettingsRegistry } from '../../platform/kernel/settings/index.mjs';
import { createFeatureFlagRegistry } from '../../platform/governance/feature-flags/index.mjs';
import { createPermissionHook, PermissionDeniedError } from '../../platform/governance/permissions/index.mjs';
import { createJobRegistry } from '../../platform/kernel/jobs/index.mjs';
import { createHealthRegistry } from '../../platform/kernel/health/index.mjs';
import { createUserDirectory } from '../../platform/identity/users/index.mjs';
import { createMembershipDirectory } from '../../platform/organizations/memberships/index.mjs';
import { createRoleAdministration } from '../../platform/authorization/roles/index.mjs';

function tmpDb() {
  return path.join(os.tmpdir(), `octagon-control-test-${Date.now()}.db`);
}

/** Canonical user fixture (Phase 02 writers). Replaces the retired direct INSERT into platform_users. */
function seedUser(dialect, id, companyId = 'default') {
  createUserDirectory(dialect).create({ id, tenantId: 'default', login: id, name: 'User' });
  createMembershipDirectory(dialect).grant({ userId: id, companyId, isDefault: true });
  return id;
}

async function setup() {
  const dbPath = tmpDb();
  await freshInstall({ dbPath });
  const dialect = openMigrationDatabase(dbPath);
  return { dialect, dbPath };
}

async function cleanup(dialect, dbPath) {
  dialect.close();
  fs.unlinkSync(dbPath);
}

async function testExecutionContext() {
  const { dialect, dbPath } = await setup();
  const ctx = createExecutionContext(dialect, { companyId: 'default', userId: 'system', sourceChannel: 'test' });
  assert.strictEqual(ctx.companyId, 'default');
  assert.strictEqual(ctx.userId, 'system');
  assert.ok(ctx.correlationId);
  assert.throws(
    () => createExecutionContext(dialect, { companyId: 'unknown' }),
    /company not found/
  );
  await cleanup(dialect, dbPath);
  console.log('PASS: executionContext');
}

async function testSettingsRegistry() {
  const { dialect, dbPath } = await setup();
  const registry = createSettingsRegistry(dialect);
  registry.register({ key: 'tax_rate', module_id: 'platform_kernel', type: 'decimal', default_value: '0.15', scopes: ['company'] });
  const s = registry.get('tax_rate');
  assert.strictEqual(s.defaultValue, '0.15');
  assert.strictEqual(s.type, 'decimal');
  await cleanup(dialect, dbPath);
  console.log('PASS: settingsRegistry');
}

async function testFeatureFlagRegistry() {
  const { dialect, dbPath } = await setup();
  const registry = createFeatureFlagRegistry(dialect);
  registry.register({ key: 'new_ui', module_id: 'platform_kernel', enabled: true, scope: 'company' });
  assert.strictEqual(registry.isEnabled('new_ui', { companyId: 'default' }), true);
  assert.strictEqual(registry.isEnabled('new_ui', { companyId: 'unknown' }), false);
  assert.strictEqual(registry.isEnabled('missing'), false);
  await cleanup(dialect, dbPath);
  console.log('PASS: featureFlagRegistry');
}

async function testPermissionHookDenyByDefault() {
  const { dialect, dbPath } = await setup();
  const hook = createPermissionHook(dialect);
  // User 'system' is allowed bypass.
  hook.check({ resource: 'x', action: 'read', context: { userId: 'system', companyId: 'default' } });
  // Non-system user with no grants is denied.
  // Phase 02 cutover: platform_users is now a derived view; the canonical
  // writers are identity_users + organization_memberships. The assertion below
  // is unchanged — only the fixture moved to the canonical writer.
  seedUser(dialect, 'u1');
  assert.throws(
    () => hook.check({ resource: 'product_category', action: 'create', context: { userId: 'u1', companyId: 'default' } }),
    PermissionDeniedError
  );
  await cleanup(dialect, dbPath);
  console.log('PASS: permissionHookDenyByDefault');
}

async function testPermissionHookWithGrant() {
  const { dialect, dbPath } = await setup();
  const hook = createPermissionHook(dialect);
  // Phase 02 cutover: roles and grants now live in authorization_roles /
  // authorization_grants and are written through RoleAdministration.
  seedUser(dialect, 'u1');
  const roles = createRoleAdministration(dialect);
  roles.createRole({ id: 'role_default_manager', tenantId: 'default', name: 'manager', labelAr: 'مدير' });
  roles.setGrants('role_default_manager', [{ permission: 'product_category:create', scope: 'all' }]);
  roles.assign({ userId: 'u1', roleId: 'role_default_manager', companyId: 'default' });
  const result = hook.check({ resource: 'product_category', action: 'create', context: { userId: 'u1', companyId: 'default' } });
  assert.strictEqual(result.allowed, true);
  await cleanup(dialect, dbPath);
  console.log('PASS: permissionHookWithGrant');
}

async function testJobRegistry() {
  const { dialect, dbPath } = await setup();
  const registry = createJobRegistry(dialect);
  registry.register({ id: 'cleanup', module_id: 'platform_kernel', handler: 'platform.kernel.jobs.cleanup', schedule: '0 0 * * *' });
  const jobs = registry.list();
  assert.strictEqual(jobs.length, 1);
  registry.disable('cleanup');
  const enabled = registry.listEnabled();
  assert.strictEqual(enabled.length, 0);
  await cleanup(dialect, dbPath);
  console.log('PASS: jobRegistry');
}

async function testHealthRegistry() {
  const { dialect, dbPath } = await setup();
  const registry = createHealthRegistry(dialect);
  registry.register('db', 'Database', 'liveness', () => ({ connected: true }));
  const status = registry.checkAll();
  assert.strictEqual(status.ok, true);
  assert.strictEqual(status.checks.db.status, 'ok');
  await cleanup(dialect, dbPath);
  console.log('PASS: healthRegistry');
}

async function main() {
  await testExecutionContext();
  await testSettingsRegistry();
  await testFeatureFlagRegistry();
  await testPermissionHookDenyByDefault();
  await testPermissionHookWithGrant();
  await testJobRegistry();
  await testHealthRegistry();
  console.log('\nAll control-plane tests passed.');
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exitCode = 1;
});
