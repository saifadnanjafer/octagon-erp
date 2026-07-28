// Checkpoint C5 — canonical Administration, module access, licensing and rollback.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { evaluateModuleAccess, handleControlPlaneQuery } from '../../platform/control_plane/index.mjs';

let temp;
let db;
let executor;
let n = 0;
const ctx = {
  tenantId: 'default',
  companyId: 'default',
  branchId: 'default',
  userId: 'system',
  actorType: 'user',
  sourceChannel: 'checkpoint-c5',
};
const execute = (actionId, input, key = `${actionId}_${Date.now()}_${++n}`) =>
  executor.execute(actionId, { ...input, idempotency_key: key }, ctx);

before(async () => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-c5-control-'));
  await freshInstall({ dbPath: path.join(temp, 'control.db'), backupDir: path.join(temp, 'backups'), actor: 'c5-control' });
  db = openMigrationDatabase(path.join(temp, 'control.db'));
  executor = createPlatformAuthority(db).actionExecutor;
});

after(() => {
  try { db?.close(); } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('all nineteen Administration resources read canonical scoped facts without secrets', () => {
  const resources = [
    'companies', 'branches', 'users', 'roles', 'permissions', 'data-scopes',
    'modules', 'feature-flags', 'packages', 'licensing', 'settings',
    'numbering-sequences', 'integrations', 'api-keys', 'jobs', 'audit',
    'health', 'backups', 'localization',
  ];
  for (const resource of resources) {
    const result = handleControlPlaneQuery({ dialect: db, ctx, resource });
    assert.equal(result.error, undefined, resource);
    assert.ok(Array.isArray(result.data), resource);
  }
  const keys = handleControlPlaneQuery({ dialect: db, ctx, resource: 'api-keys' }).data;
  assert.equal(keys.some((row) => Object.hasOwn(row, 'key_hash')), false);
});

test('module disable denies its action server-side and re-enable restores access', () => {
  assert.equal(execute('control:test:ping', {}).ok, true);
  execute('control:module:set_status', { module_id: 'checkpoint_c_test_module', enabled: false });
  assert.equal(evaluateModuleAccess(db, 'checkpoint_c_test_module', ctx).code, 'MODULE_NOT_ENABLED');
  assert.throws(() => execute('control:test:ping', {}), /MODULE_NOT_ENABLED/);
  execute('control:module:set_status', { module_id: 'checkpoint_c_test_module', enabled: true });
  assert.equal(execute('control:test:ping', {}).ok, true);
});

test('company and branch assignment is versioned and enforced with branch precedence', () => {
  let assigned = execute('control:module:assign', {
    module_id: 'checkpoint_c_test_module',
    scope_type: 'company',
    scope_id: 'default',
    enabled: true,
    navigation_visible: true,
    configuration_status: 'ready',
  });
  assert.equal(assigned.version, 1);
  assigned = execute('control:module:assign', {
    module_id: 'checkpoint_c_test_module',
    scope_type: 'branch',
    scope_id: 'default',
    enabled: false,
    navigation_visible: false,
    configuration_status: 'warning',
  });
  assert.equal(evaluateModuleAccess(db, 'checkpoint_c_test_module', ctx).code, 'MODULE_SCOPE_DENIED');
  assert.throws(() => execute('control:test:ping', {}), /MODULE_SCOPE_DENIED/);
  assigned = execute('control:module:assign', {
    module_id: 'checkpoint_c_test_module',
    scope_type: 'branch',
    scope_id: 'default',
    enabled: true,
    navigation_visible: true,
    configuration_status: 'ready',
  });
  assert.equal(assigned.version, 2);
});

test('license and package status is server-enforced and reversible', () => {
  let license = execute('control:license:set', {
    module_id: 'checkpoint_c_test_module',
    company_id: 'default',
    status: 'unlicensed',
    plan: 'none',
  });
  assert.equal(license.package_status, 'unlicensed');
  assert.throws(() => execute('control:test:ping', {}), /MODULE_UNLICENSED/);
  license = execute('control:license:set', {
    module_id: 'checkpoint_c_test_module',
    company_id: 'default',
    status: 'active',
    plan: 'octagon-enterprise',
    features: ['navigation', 'commands'],
  });
  assert.equal(license.version, 2);
  assert.equal(execute('control:test:ping', {}).ok, true);
});

test('feature and job toggles use explicit governed actions', () => {
  const flag = execute('control:feature:set', {
    key: 'checkpoint_c.test_feature',
    module_id: 'checkpoint_c_test_module',
    scope: 'company',
    enabled: true,
  });
  assert.equal(flag.enabled, 1);
  db.prepare(`
    INSERT INTO platform_jobs (id,module_id,name,schedule,handler,enabled,created_at,updated_at)
    VALUES ('checkpoint_c_job','platform_kernel','Checkpoint C Job','0 * * * *','checkpoint.run',1,?,?)
  `).run(new Date().toISOString(), new Date().toISOString());
  assert.equal(execute('control:job:set', { job_id: 'checkpoint_c_job', enabled: false }).enabled, 0);
});

test('dependency validation and kernel lockout fail closed', () => {
  assert.throws(
    () => execute('control:module:set_status', { module_id: 'platform_kernel', enabled: false }),
    /platform kernel cannot be disabled/,
  );
  db.prepare("UPDATE platform_modules SET status='installed' WHERE id='platform_kernel'").run();
  assert.throws(
    () => execute('control:module:set_status', { module_id: 'checkpoint_c_test_module', enabled: true }),
    /dependency platform_kernel is not enabled/,
  );
  db.prepare("UPDATE platform_modules SET status='enabled' WHERE id='platform_kernel'").run();
});

test('duplicate idempotency replays one result and a changed payload fails closed', () => {
  const key = `control_replay_${Date.now()}`;
  const first = execute('control:module:set_status', { module_id: 'checkpoint_c_test_module', enabled: true }, key);
  const second = execute('control:module:set_status', { module_id: 'checkpoint_c_test_module', enabled: true }, key);
  assert.deepEqual(second, first);
  assert.throws(
    () => execute('control:module:set_status', { module_id: 'checkpoint_c_test_module', enabled: false }, key),
    /idempotency key reused/,
  );
});

test('control mutation, audit, outbox and idempotency roll back together on injected failure', () => {
  const before = db.prepare("SELECT status FROM platform_modules WHERE id='checkpoint_c_test_module'").get().status;
  db.exec(`
    CREATE TRIGGER checkpoint_c5_outbox_fail BEFORE INSERT ON platform_outbox
    WHEN NEW.payload LIKE '%control:module:set_status%'
    BEGIN SELECT RAISE(ABORT,'checkpoint C5 outbox failure'); END;
  `);
  const key = `control_fail_${Date.now()}`;
  try {
    assert.throws(
      () => execute('control:module:set_status', { module_id: 'checkpoint_c_test_module', enabled: false }, key),
      /checkpoint C5 outbox failure/,
    );
  } finally {
    db.exec('DROP TRIGGER checkpoint_c5_outbox_fail');
  }
  assert.equal(db.prepare("SELECT status FROM platform_modules WHERE id='checkpoint_c_test_module'").get().status, before);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM action_idempotency WHERE idempotency_key=?").get(key).n, 0);
});
