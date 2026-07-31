// tests/final-page-catalog/fp2d-centers.test.mjs
//
// Tests for the FP-2D Control Plane centers:
//   organization_center, identity_center, permission_center.
//
// All three pages are governed READ projections over existing control-plane
// resources. These tests prove the resources the pages consume serve real,
// correctly-scoped data from a disposable database — no fabricated fixtures.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { handleControlPlaneQuery } from '../../platform/control_plane/index.mjs';

function tmpPath(name) {
  return path.join(os.tmpdir(), `octagon-fp2d-${name}-${Date.now()}-${process.pid}.db`);
}

async function setup(name) {
  const dbPath = tmpPath(name);
  await freshInstall({ dbPath });
  const db = openMigrationDatabase(dbPath);
  const now = new Date().toISOString();
  const ctx = { companyId: 'default', tenantId: 'default', userId: 'user-admin', now };
  return { db, dbPath, ctx };
}

function cleanup(env) {
  try { env.db.close(); } catch (_) {}
  for (const suffix of ['', '-wal', '-shm']) {
    try { if (fs.existsSync(env.dbPath + suffix)) fs.unlinkSync(env.dbPath + suffix); } catch (_) {}
  }
}

// --------------------------------------------------------------------------
// organization_center
// --------------------------------------------------------------------------

test('1. organization: companies resource serves the seeded default company with real fields', async () => {
  const env = await setup('org-companies');
  try {
    const res = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'companies' });
    assert.ok(res.data.some((c) => c.id === 'default' && c.name === 'Default Company' && c.status === 'active'));
  } finally {
    cleanup(env);
  }
});

test('2. organization: a branch created under a company is served, and only within tenant scope', async () => {
  const env = await setup('org-branches');
  try {
    env.db.prepare("INSERT INTO platform_branches (id, company_id, name, status, created_at) VALUES ('br-1', 'default', 'Main Branch', 'active', ?)").run(env.ctx.now);
    env.db.prepare("INSERT INTO platform_tenants (id, name, status, created_at) VALUES ('other-tenant', 'Other', 'active', ?)").run(env.ctx.now);
    env.db.prepare("INSERT INTO platform_companies (id, tenant_id, name, status, created_at) VALUES ('co-other', 'other-tenant', 'Other Co', 'active', ?)").run(env.ctx.now);
    env.db.prepare("INSERT INTO platform_branches (id, company_id, name, status, created_at) VALUES ('br-other', 'co-other', 'Other Branch', 'active', ?)").run(env.ctx.now);

    const res = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'branches' });
    assert.ok(res.data.some((b) => b.id === 'br-1' && b.company_id === 'default'));
    assert.ok(!res.data.some((b) => b.id === 'br-other'), 'branch of another tenant leaked');
  } finally {
    cleanup(env);
  }
});

test('3. organization: data-scopes and localization are honest empty arrays on a fresh install', async () => {
  const env = await setup('org-empty');
  try {
    const scopes = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'data-scopes' });
    const loc = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'localization' });
    assert.deepEqual(scopes.data, []);
    assert.deepEqual(loc.data, []);
  } finally {
    cleanup(env);
  }
});

// --------------------------------------------------------------------------
// identity_center
// --------------------------------------------------------------------------

test('4. identity: users resource serves the seeded owner without any secret fields', async () => {
  const env = await setup('id-users');
  try {
    const res = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'users' });
    assert.equal(res.data.length, 1);
    const owner = res.data[0];
    assert.ok(owner.login && owner.status);
    // The projection must never carry credentials or tokens.
    for (const key of Object.keys(owner)) {
      assert.ok(!/password|hash|secret|token|recovery/i.test(key), `secret-like field leaked: ${key}`);
    }
  } finally {
    cleanup(env);
  }
});

test('5. identity: api-keys and integrations are honest empty arrays on a fresh install', async () => {
  const env = await setup('id-empty');
  try {
    const keys = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'api-keys' });
    const sso = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'integrations' });
    assert.deepEqual(keys.data, []);
    assert.deepEqual(sso.data, []);
  } finally {
    cleanup(env);
  }
});

// --------------------------------------------------------------------------
// permission_center
// --------------------------------------------------------------------------

test('6. permission center: roles resource serves the seeded system role with a grant count', async () => {
  const env = await setup('pc-roles');
  try {
    const res = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'roles' });
    assert.ok(res.data.length >= 1);
    const role = res.data[0];
    assert.ok(role.name && typeof role.grant_count === 'number');
  } finally {
    cleanup(env);
  }
});

test('7. permission center: permissions resource serves the registered registry (156+ entries)', async () => {
  const env = await setup('pc-perms');
  try {
    const res = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'permissions' });
    assert.ok(res.data.length >= 156, `expected the registered permission registry, got ${res.data.length}`);
    for (const row of res.data.slice(0, 50)) {
      assert.ok(row.id && row.module_id && row.kind, `permission row missing real fields: ${JSON.stringify(row)}`);
    }
  } finally {
    cleanup(env);
  }
});

test('8. permission center: every served permission references a real registered module', async () => {
  const env = await setup('pc-perm-modules');
  try {
    const perms = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'permissions' }).data;
    const modules = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'modules' }).data;
    const moduleIds = new Set(modules.map((m) => m.id));
    const dangling = perms.filter((p) => !moduleIds.has(p.module_id));
    assert.deepEqual(dangling.map((p) => p.id), [], `permissions reference unknown modules: ${dangling.map((p) => p.module_id).join(', ')}`);
  } finally {
    cleanup(env);
  }
});
