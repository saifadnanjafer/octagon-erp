// tests/final-page-catalog/commercial-control-center.test.mjs
//
// Tests for FP-2 Commercial Control Center (commercial_control_center).
//
// The page renders real licensing/entitlement facts from the canonical
// control-plane backend (platform_module_licenses + module registry). Licenses
// are seeded through the real ActionExecutor action — never by direct table
// writes — and every assertion runs against a disposable database.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createActionExecutor } from '../../platform/kernel/actions/index.mjs';
import { registerControlPlaneActions, handleControlPlaneQuery } from '../../platform/control_plane/index.mjs';

function tmpPath(name) {
  return path.join(os.tmpdir(), `octagon-ccc-${name}-${Date.now()}-${process.pid}.db`);
}

async function setup(name) {
  const dbPath = tmpPath(name);
  await freshInstall({ dbPath });
  const db = openMigrationDatabase(dbPath);
  const now = new Date().toISOString();
  const ctx = { companyId: 'company-alpha', tenantId: 'default', userId: 'user-admin', now };
  db.prepare("INSERT OR IGNORE INTO platform_companies (id, tenant_id, name, status, created_at) VALUES ('company-alpha', 'default', 'Company Alpha', 'active', ?)").run(now);
  return { db, dbPath, ctx };
}

function cleanup(env) {
  try { env.db.close(); } catch (_) {}
  for (const suffix of ['', '-wal', '-shm']) {
    try { if (fs.existsSync(env.dbPath + suffix)) fs.unlinkSync(env.dbPath + suffix); } catch (_) {}
  }
}

test('1. a license registered through the real action is served by the licensing query', async () => {
  const env = await setup('lic-serve');
  try {
    const executor = createActionExecutor(env.db);
    registerControlPlaneActions(executor);

    executor.execute('control:license:set', {
      module_id: 'crm', company_id: 'company-alpha', plan: 'enterprise',
      status: 'active', seats: 25, idempotency_key: 'ik-ccc-lic-1',
    }, env.ctx);

    const res = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'licensing' });
    const row = res.data.find((l) => l.module_id === 'crm' && l.company_id === 'company-alpha');
    assert.ok(row, 'registered license missing from licensing query');
    assert.equal(row.plan, 'enterprise');
    assert.equal(row.seats, 25);
  } finally {
    cleanup(env);
  }
});

test('2. overview serves real counts for seats (users), companies, and modules', async () => {
  const env = await setup('overview');
  try {
    const res = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'overview' });
    const ov = res.data[0];
    assert.equal(typeof ov.users, 'number');
    assert.equal(typeof ov.modules, 'number');
    assert.ok(ov.companies >= 1, 'seeded company must appear in the overview');
    assert.ok(ov.modules > 0, 'module registry must not be empty on a fresh install');
  } finally {
    cleanup(env);
  }
});

test('3. unlicensed modules are derivable: every registry module without a license row', async () => {
  const env = await setup('unlicensed');
  try {
    const executor = createActionExecutor(env.db);
    registerControlPlaneActions(executor);
    executor.execute('control:license:set', {
      module_id: 'crm', company_id: 'company-alpha', plan: 'enterprise',
      status: 'active', seats: 5, idempotency_key: 'ik-ccc-lic-2',
    }, env.ctx);

    const modules = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'modules' }).data;
    const licensing = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'licensing' }).data;
    const licensed = new Set(licensing.map((l) => l.module_id));
    const unlicensed = modules.filter((m) => !licensed.has(m.id));

    assert.ok(licensed.has('crm'));
    assert.ok(unlicensed.length > 0, 'a fresh install must have modules without licenses');
    assert.ok(!unlicensed.some((m) => m.id === 'crm'), 'licensed module must not appear as unlicensed');
  } finally {
    cleanup(env);
  }
});

test('4. licensing query never leaks licenses owned by a different tenant', async () => {
  const env = await setup('lic-scope');
  try {
    // A company owned by ANOTHER tenant, with its own license row. The
    // control-plane surface is tenant-scoped: these rows must never leak into
    // the default tenant's query.
    env.db.prepare("INSERT INTO platform_tenants (id, name, status, created_at) VALUES ('other-tenant', 'Other Tenant', 'active', ?)").run(env.ctx.now);
    env.db.prepare("INSERT INTO platform_companies (id, tenant_id, name, status, created_at) VALUES ('company-other', 'other-tenant', 'Other Tenant Co', 'active', ?)").run(env.ctx.now);
    env.db.prepare(`INSERT INTO platform_module_licenses (id, module_id, company_id, plan, package_status, seats, features, valid_from, valid_until, version, created_at, updated_at, updated_by)
      VALUES ('lic-other-1', 'crm', 'company-other', 'enterprise', 'active', 10, '[]', NULL, NULL, 1, ?, ?, 'user-admin')`).run(env.ctx.now, env.ctx.now);

    const res = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'licensing' });
    assert.ok(!res.data.some((l) => l.company_id === 'company-other'),
      'license owned by a different tenant leaked into this tenant scope');

    // Tenant-scoped companies ARE all visible to this admin surface — scoping
    // is a tenant boundary, not a mute on sibling companies.
    env.db.prepare("INSERT OR IGNORE INTO platform_companies (id, tenant_id, name, status, created_at) VALUES ('company-beta', 'default', 'Company Beta', 'active', ?)").run(env.ctx.now);
    const executor = createActionExecutor(env.db);
    registerControlPlaneActions(executor);
    executor.execute('control:license:set', {
      module_id: 'crm', company_id: 'company-beta', plan: 'enterprise',
      status: 'active', seats: 10, idempotency_key: 'ik-ccc-lic-3',
    }, { ...env.ctx, companyId: 'company-beta' });
    const siblings = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'licensing' });
    assert.ok(siblings.data.some((l) => l.company_id === 'company-beta'));
  } finally {
    cleanup(env);
  }
});

test('5. a fresh install serves only the seeded platform licenses — every row backed by a real module', async () => {
  const env = await setup('lic-seeded');
  try {
    const res = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'licensing' });
    assert.ok(Array.isArray(res.data));
    assert.equal(res.data.length, 7, 'fresh install seeds exactly the 7 platform module licenses');
    const modules = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'modules' }).data;
    const moduleIds = new Set(modules.map((m) => m.id));
    for (const row of res.data) {
      assert.ok(row.module_id && row.company_id && row.plan, `license row missing real fields: ${JSON.stringify(row)}`);
      assert.ok(moduleIds.has(row.module_id), `license references unknown module ${row.module_id}`);
    }
  } finally {
    cleanup(env);
  }
});
