// tests/final-page-catalog/fp2g-audit-release.test.mjs
//
// Tests for the FP-2G Control Plane pages:
//   audit_security_center, release_health, release_upgrade_center,
//   and the integration_hub governed-section upgrade.
//
// All resources are read-only projections over existing control-plane
// resources. Audit facts are seeded through the real ConfigurationAuthority
// (which writes platform_audit_log through its own #audit path).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createConfigurationAuthority } from '../../platform/configuration/index.mjs';
import { handleControlPlaneQuery } from '../../platform/control_plane/index.mjs';

function tmpPath(name) {
  return path.join(os.tmpdir(), `octagon-fp2g-${name}-${Date.now()}-${process.pid}.db`);
}

async function setup(name) {
  const dbPath = tmpPath(name);
  await freshInstall({ dbPath });
  const db = openMigrationDatabase(dbPath);
  const ctx = { companyId: 'default', tenantId: 'default', userId: 'user-admin', now: new Date().toISOString() };
  return { db, dbPath, ctx };
}

function cleanup(env) {
  try { env.db.close(); } catch (_) {}
  for (const suffix of ['', '-wal', '-shm']) {
    try { if (fs.existsSync(env.dbPath + suffix)) fs.unlinkSync(env.dbPath + suffix); } catch (_) {}
  }
}

test('1. audit center: a mutation through a real authority appears in the audit resource', async () => {
  const env = await setup('audit-trail');
  try {
    const authority = createConfigurationAuthority(env.db, {});
    authority.defineCustomField({
      entity: 'x_party', field: 'audit_probe', dataType: 'string', labelAr: 'حقل اختبار',
      tenantId: 'default', companyId: 'default',
    }, 'user-admin');

    const res = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'audit' });
    const entry = res.data.find((a) => a.action === 'custom_field.define' && a.resource_id === 'x_party.audit_probe');
    assert.ok(entry, 'audit entry for the authority mutation is missing');
    assert.equal(entry.actor_id, 'user-admin');
    assert.equal(entry.result, 'success');
  } finally {
    cleanup(env);
  }
});

test('2. audit center: audit resource is read-only data (no mutation surface in the dispatch)', async () => {
  const env = await setup('audit-readonly');
  try {
    // The query dispatch only ever returns data; the audit resource has no
    // write path at all. Assert the shape and that unknown verbs 404.
    const res = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'audit' });
    assert.ok(Array.isArray(res.data));
    const unknown = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'audit/delete' });
    assert.equal(unknown.status, 404);
  } finally {
    cleanup(env);
  }
});

test('3. release health: health resource serves per-module real status, no unknown-as-green', async () => {
  const env = await setup('health');
  try {
    const res = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'health' });
    assert.ok(res.data.length > 0, 'health must cover the registered modules');
    const allowed = new Set(['healthy', 'warning', 'blocked']);
    for (const row of res.data) {
      assert.ok(row.module_id, 'health row without module id');
      assert.ok(allowed.has(row.status), `health status "${row.status}" is not a real measured state`);
      assert.ok(row.access_code, 'health row must carry the real access code');
    }
  } finally {
    cleanup(env);
  }
});

test('4. release health: backups resource is an honest empty array when nothing was backed up', async () => {
  const env = await setup('backups-empty');
  try {
    const res = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'backups' });
    assert.deepEqual(res.data, [], 'no backups on a fresh install — must not be dressed as green');
  } finally {
    cleanup(env);
  }
});

test('5. release upgrade: packages resource serves configuration packages with real status', async () => {
  const env = await setup('packages');
  try {
    const authority = createConfigurationAuthority(env.db, {});
    const pkg = authority.buildPackage({
      name: 'test-pack', version: '1.0.0',
      items: [{ kind: 'custom_field', key: 'x_party.pkg_field', payload: { entity: 'x_party', field: 'pkg_field', dataType: 'string', labelAr: 'حقل الحزمة' } }],
    }, 'user-admin');
    assert.ok(pkg.id);

    const res = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'packages' });
    const row = res.data.find((p) => p.id === pkg.id);
    assert.ok(row, 'built package missing from packages resource');
    assert.equal(row.name, 'test-pack');
  } finally {
    cleanup(env);
  }
});

test('6. integration hub upgrade: integrations, api-keys and jobs resources serve real scoped data', async () => {
  const env = await setup('hub-resources');
  try {
    const integrations = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'integrations' });
    const apiKeys = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'api-keys' });
    const jobs = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'jobs' });
    assert.ok(Array.isArray(integrations.data));
    assert.ok(Array.isArray(apiKeys.data));
    assert.ok(Array.isArray(jobs.data));
    // The three resources the governed section consumes must exist and be
    // honest: fresh install has no SSO providers and no API keys.
    assert.deepEqual(integrations.data, []);
    assert.deepEqual(apiKeys.data, []);
  } finally {
    cleanup(env);
  }
});
