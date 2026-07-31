// tests/final-page-catalog/module-pack-center.test.mjs
//
// Tests for FP-2 Module & Pack Center (module_pack_center).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createActionExecutor } from '../../platform/kernel/actions/index.mjs';
import { registerControlPlaneActions, handleControlPlaneQuery, evaluateModuleAccess } from '../../platform/control_plane/index.mjs';

function tmpPath(name) {
  return path.join(os.tmpdir(), `octagon-mpc-${name}-${Date.now()}-${process.pid}.db`);
}

async function setup(name) {
  const dbPath = tmpPath(name);
  await freshInstall({ dbPath });
  const db = openMigrationDatabase(dbPath);
  return { db, dbPath };
}

function cleanup(env) {
  try { env.db.close(); } catch (_) {}
  for (const suffix of ['', '-wal', '-shm']) {
    try { if (fs.existsSync(env.dbPath + suffix)) fs.unlinkSync(env.dbPath + suffix); } catch (_) {}
  }
}

test('1. control:module:set_status enables and disables an installed module', async () => {
  const env = await setup('mod-status');
  try {
    const executor = createActionExecutor(env.db);
    registerControlPlaneActions(executor);
    const ctx = { companyId: 'company-alpha', tenantId: 'default', userId: 'user-admin', now: new Date().toISOString() };

    // Enable crm module
    const enabledRes = executor.execute('control:module:set_status', {
      module_id: 'crm',
      enabled: true,
      idempotency_key: 'ik-mod-crm-enable-1',
    }, ctx);
    assert.equal(enabledRes.status, 'enabled');

    const accessAfterEnable = evaluateModuleAccess(env.db, 'crm', ctx);
    assert.equal(accessAfterEnable.allowed, true);

    // Disable crm module
    const disabledRes = executor.execute('control:module:set_status', {
      module_id: 'crm',
      enabled: false,
      idempotency_key: 'ik-mod-crm-disable-1',
    }, ctx);
    assert.equal(disabledRes.status, 'installed');

    const accessAfterDisable = evaluateModuleAccess(env.db, 'crm', ctx);
    assert.equal(accessAfterDisable.allowed, false);
  } finally {
    cleanup(env);
  }
});

test('2. control:feature:set defines and toggles feature flags', async () => {
  const env = await setup('feature-set');
  try {
    const executor = createActionExecutor(env.db);
    registerControlPlaneActions(executor);
    const ctx = { companyId: 'company-alpha', tenantId: 'default', userId: 'user-admin', now: new Date().toISOString() };

    const flagRes = executor.execute('control:feature:set', {
      key: 'ff_advanced_crm_analytics',
      module_id: 'crm',
      enabled: true,
      idempotency_key: 'ik-ff-crm-1',
    }, ctx);
    assert.equal(flagRes.key, 'ff_advanced_crm_analytics');
    assert.equal(flagRes.enabled, 1);

    const queryRes = handleControlPlaneQuery({ dialect: env.db, ctx, resource: 'feature-flags' });
    assert.ok(queryRes.data.some((f) => f.key === 'ff_advanced_crm_analytics' && f.enabled === 1));
  } finally {
    cleanup(env);
  }
});

test('3. control:license:set registers module licenses and handleControlPlaneQuery surfaces them', async () => {
  const env = await setup('mod-lic');
  try {
    const executor = createActionExecutor(env.db);
    registerControlPlaneActions(executor);
    const ctx = { companyId: 'company-alpha', tenantId: 'default', userId: 'user-admin', now: new Date().toISOString() };

    // Seed company
    env.db.prepare("INSERT OR IGNORE INTO platform_companies (id, tenant_id, name, status, created_at) VALUES ('company-alpha', 'default', 'Company Alpha', 'active', ?)").run(ctx.now);

    const lic = executor.execute('control:license:set', {
      module_id: 'crm',
      company_id: 'company-alpha',
      plan: 'enterprise',
      status: 'active',
      seats: 25,
      idempotency_key: 'ik-lic-crm-1',
    }, ctx);
    assert.equal(lic.module_id, 'crm');
    assert.equal(lic.package_status, 'active');

    const queryRes = handleControlPlaneQuery({ dialect: env.db, ctx, resource: 'licensing' });
    assert.ok(queryRes.data.some((l) => l.module_id === 'crm' && l.seats === 25));
  } finally {
    cleanup(env);
  }
});

test('4. control-plane query overview and modules return complete system inventory', async () => {
  const env = await setup('cp-query');
  try {
    const ctx = { companyId: 'company-alpha', tenantId: 'default', userId: 'user-admin', now: new Date().toISOString() };
    env.db.prepare("INSERT OR IGNORE INTO platform_companies (id, tenant_id, name, status, created_at) VALUES ('company-alpha', 'default', 'Company Alpha', 'active', ?)").run(ctx.now);

    const modulesQuery = handleControlPlaneQuery({ dialect: env.db, ctx, resource: 'modules' });
    assert.ok(Array.isArray(modulesQuery.data));
    assert.ok(modulesQuery.data.length > 0);
    assert.ok(modulesQuery.data.some((m) => m.id === 'platform_kernel'));

    const overviewQuery = handleControlPlaneQuery({ dialect: env.db, ctx, resource: 'overview' });
    assert.ok(overviewQuery.data[0].modules > 0);
  } finally {
    cleanup(env);
  }
});
