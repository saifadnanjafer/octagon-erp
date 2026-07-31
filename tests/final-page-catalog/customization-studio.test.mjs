// tests/final-page-catalog/customization-studio.test.mjs
//
// Tests for FP-2 Customization Studio (customization_studio).
//
// The page is a governed READ surface over the canonical ConfigurationAuthority
// (platform/configuration/index.mjs) through handleControlPlaneQuery. Every
// fixture below is seeded through that real authority against a disposable
// database — no fabricated rows, no direct table writes from the test.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createConfigurationAuthority } from '../../platform/configuration/index.mjs';
import { handleControlPlaneQuery } from '../../platform/control_plane/index.mjs';

function tmpPath(name) {
  return path.join(os.tmpdir(), `octagon-cs-${name}-${Date.now()}-${process.pid}.db`);
}

async function setup(name) {
  const dbPath = tmpPath(name);
  await freshInstall({ dbPath });
  const db = openMigrationDatabase(dbPath);
  const now = new Date().toISOString();
  const ctx = { companyId: 'company-alpha', tenantId: 'default', userId: 'user-admin', now };
  db.prepare("INSERT OR IGNORE INTO platform_companies (id, tenant_id, name, status, created_at) VALUES ('company-alpha', 'default', 'Company Alpha', 'active', ?)").run(now);
  const authority = createConfigurationAuthority(db, {});
  return { db, dbPath, ctx, authority };
}

function cleanup(env) {
  try { env.db.close(); } catch (_) {}
  for (const suffix of ['', '-wal', '-shm']) {
    try { if (fs.existsSync(env.dbPath + suffix)) fs.unlinkSync(env.dbPath + suffix); } catch (_) {}
  }
}

test('1. custom-fields query is a real empty array on a fresh install (honest empty state)', async () => {
  const env = await setup('cf-empty');
  try {
    const res = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'custom-fields' });
    assert.ok(Array.isArray(res.data));
    assert.equal(res.data.length, 0);
  } finally {
    cleanup(env);
  }
});

test('2. a custom field defined through the ConfigurationAuthority is served by the control-plane query', async () => {
  const env = await setup('cf-defined');
  try {
    env.authority.defineCustomField({
      entity: 'x_party', field: 'tax_no', dataType: 'string', labelAr: 'الرقم الضريبي',
      tenantId: 'default', companyId: 'company-alpha',
    }, 'user-admin');

    const res = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'custom-fields' });
    const row = res.data.find((r) => r.entity === 'x_party' && r.field === 'tax_no');
    assert.ok(row, 'defined custom field missing from control-plane query');
    assert.equal(row.data_type, 'string');
    assert.equal(row.label_ar, 'الرقم الضريبي');
  } finally {
    cleanup(env);
  }
});

test('3. view-schemas query serves schemas defined through the authority', async () => {
  const env = await setup('vs-defined');
  try {
    env.authority.defineViewSchema({
      entity: 'x_party', kind: 'form', name: 'standard', schema: { sections: [] },
      tenantId: 'default', companyId: 'company-alpha',
    }, 'user-admin');

    const res = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'view-schemas' });
    const row = res.data.find((r) => r.entity === 'x_party' && r.kind === 'form' && r.name === 'standard');
    assert.ok(row, 'defined view schema missing from control-plane query');
    assert.equal(row.version, 1);
    assert.equal(row.status, 'active');
  } finally {
    cleanup(env);
  }
});

test('4. saved-views query serves views saved through the authority', async () => {
  const env = await setup('sv-defined');
  try {
    env.authority.saveView({
      entity: 'x_party', name: 'Active parties', ownerId: 'user-admin',
      filters: { status: { op: 'eq', value: 'active' } },
    }, 'user-admin');

    const res = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'saved-views' });
    const row = res.data.find((r) => r.entity === 'x_party' && r.name === 'Active parties');
    assert.ok(row, 'saved view missing from control-plane query');
    assert.equal(row.owner_id, 'user-admin');
  } finally {
    cleanup(env);
  }
});

test('5. out-of-scope company rows are invisible to the querying company scope', async () => {
  const env = await setup('cf-scope');
  try {
    // company-beta is NOT registered in this tenant scope — its rows must not leak.
    env.authority.defineCustomField({
      entity: 'x_party', field: 'beta_only', dataType: 'string', labelAr: 'حقل شركة أخرى',
      tenantId: 'default', companyId: 'company-beta',
    }, 'user-admin');
    env.authority.defineCustomField({
      entity: 'x_party', field: 'global_field', dataType: 'string', labelAr: 'حقل عام',
      tenantId: null, companyId: null,
    }, 'user-admin');

    const res = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'custom-fields' });
    assert.ok(!res.data.some((r) => r.field === 'beta_only'), 'out-of-scope company field leaked');
    assert.ok(res.data.some((r) => r.field === 'global_field'), 'global (null-scope) field must be visible');
  } finally {
    cleanup(env);
  }
});

test('6. unknown control-plane resources still fail loudly with 404', async () => {
  const env = await setup('unknown');
  try {
    const res = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'definitely-not-a-resource' });
    assert.equal(res.status, 404);
    assert.ok(res.error);
  } finally {
    cleanup(env);
  }
});
