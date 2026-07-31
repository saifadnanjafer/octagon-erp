// tests/final-page-catalog/fp2f-configuration-import.test.mjs
//
// Tests for the FP-2F Control Plane pages:
//   configuration_center, data_import_center.
//
// configuration_center projects the settings/sequences/feature-flags read
// surface. data_import_center projects the canonical DataExchangeService
// import store — the fixture import below runs through the real service in
// dry_run mode (no ActionExecutor writes), exactly like a real import.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createDataExchangeService } from '../../platform/data-exchange/index.mjs';
import { handleControlPlaneQuery } from '../../platform/control_plane/index.mjs';

function tmpPath(name) {
  return path.join(os.tmpdir(), `octagon-fp2f-${name}-${Date.now()}-${process.pid}.db`);
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

test('1. configuration: settings resource serves the seeded setting and never a secret', async () => {
  const env = await setup('settings');
  try {
    const res = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'settings' });
    assert.ok(Array.isArray(res.data));
    assert.ok(res.data.length >= 1, 'fresh install seeds at least one non-secret setting');
    for (const row of res.data) {
      assert.ok(!/secret|password|token/i.test(row.key), `secret-like setting leaked: ${row.key}`);
    }
  } finally {
    cleanup(env);
  }
});

test('2. configuration: numbering-sequences and feature-flags are honest real data', async () => {
  const env = await setup('sequences-flags');
  try {
    const seq = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'numbering-sequences' });
    assert.deepEqual(seq.data, [], 'no sequences on a fresh install — honest empty state');

    const flags = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'feature-flags' });
    assert.ok(flags.data.length >= 1, 'fresh install seeds at least one feature flag');
    assert.ok(flags.data.every((f) => f.key), 'every flag has a real key');
  } finally {
    cleanup(env);
  }
});

test('3. import center: a real dry-run import through DataExchangeService is served by import-jobs', async () => {
  const env = await setup('import-jobs');
  try {
    const svc = createDataExchangeService(env.db, {});
    const job = svc.import({
      entity: 'x_party', actionId: 'noop',
      rows: [{ name: 'A' }, { name: 'B' }],
      mode: 'dry_run',
      ctx: { actorId: 'user-admin', activeCompanyId: 'default' },
    });
    assert.equal(job.status, 'completed');

    const res = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'import-jobs' });
    const row = res.data.find((j) => j.id === job.id);
    assert.ok(row, 'dry-run import missing from import-jobs resource');
    assert.equal(row.mode, 'dry_run');
    assert.equal(row.total_rows, 2);
    assert.equal(row.ok_rows, 2);
    assert.equal(row.failed_rows, 0);
  } finally {
    cleanup(env);
  }
});

test('4. import center: import-rows serves row-level results, and a failing row is never silently dropped', async () => {
  const env = await setup('import-rows');
  try {
    const svc = createDataExchangeService(env.db, {
      configuration: {
        // A real validator that rejects the second row, proving row errors
        // surface as data instead of vanishing.
        validateCustomValues: (entity, payload) => payload.name === 'bad'
          ? { ok: false, errors: [{ messageAr: 'صف مرفوض' }] }
          : { ok: true, errors: [] },
      },
    });
    const job = svc.import({
      entity: 'x_party', actionId: 'noop',
      rows: [{ name: 'good' }, { name: 'bad' }],
      mode: 'dry_run',
      ctx: { actorId: 'user-admin', activeCompanyId: 'default' },
    });
    assert.equal(job.okRows, 1);
    assert.equal(job.failedRows, 1);

    const res = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'import-rows', recordId: job.id });
    assert.equal(res.data.length, 2, 'both rows must be visible — no silent row drop');
    const failed = res.data.find((r) => r.status === 'failed');
    assert.ok(failed, 'failed row missing from import-rows');
    assert.match(failed.error, /صف مرفوض/);
  } finally {
    cleanup(env);
  }
});

test('5. import center: import-jobs is an honest empty array on a fresh install', async () => {
  const env = await setup('import-empty');
  try {
    const res = handleControlPlaneQuery({ dialect: env.db, ctx: env.ctx, resource: 'import-jobs' });
    assert.deepEqual(res.data, []);
  } finally {
    cleanup(env);
  }
});
