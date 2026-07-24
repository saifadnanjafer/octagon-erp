import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  freshInstall,
  openMigrationDatabase,
} from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';

async function withFreshDatabase(name, callback) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `octagon-phase04-${name}-`));
  const dbPath = path.join(tempDir, 'test.db');
  let db;
  try {
    const migrationResult = await freshInstall({
      dbPath,
      backupDir: path.join(tempDir, 'backups'),
      actor: `phase04-${name}`,
    });
    db = openMigrationDatabase(dbPath);
    await callback(db, migrationResult);
  } finally {
    try { db?.close(); } catch { /* already closed */ }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test('Phase 04 remediation fresh install applies every migration without swallowing failures', async () => {
  await withFreshDatabase('fresh-install', (db, result) => {
    assert.equal(result.executed.length, 43);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 43);
    assert.equal(db.prepare(`
      SELECT COUNT(*) AS n
      FROM platform_modules
      WHERE id IN (
        'commercial_core', 'stock_inventory', 'stock_wms',
        'commercial_sales', 'commercial_procurement',
        'commercial_cutover', 'work_item_canonical'
      )
    `).get().n, 7);
    assert.equal(db.prepare(`
      SELECT COUNT(*) AS n
      FROM platform_entities
      WHERE module_id IN (
        'commercial_core', 'stock_inventory', 'stock_wms',
        'commercial_sales', 'commercial_procurement',
        'commercial_cutover', 'work_item_canonical'
      )
    `).get().n, 25);
    assert.equal(db.prepare(`
      SELECT COUNT(*) AS n
      FROM platform_actions
      WHERE transaction_owner = 'platform_action_executor'
    `).get().n, 42);
  });
});

test('Phase 04 action registry is backed by live Action Executor handlers', async () => {
  await withFreshDatabase('action-registry', (db) => {
    const authority = createPlatformAuthority(db);
    const registered = db.prepare(`
      SELECT id
      FROM platform_actions
      WHERE transaction_owner = 'platform_action_executor'
      ORDER BY id
    `).all().map((row) => row.id);
    assert.equal(registered.length, 42);
    for (const actionCode of registered) {
      assert.equal(
        authority.actionExecutor.handlers.has(actionCode),
        true,
        `missing handler for ${actionCode}`,
      );
    }
  });
});

test('Phase 04 canonical cutover remains fail-closed until legacy reconciliation passes', async () => {
  await withFreshDatabase('cutover-guard', (db) => {
    const flag = db.prepare(`
      SELECT enabled, audit_policy
      FROM platform_feature_flags
      WHERE key = 'phase04.canonical_cutover'
    `).get();
    assert.ok(flag);
    assert.equal(flag.enabled, 0);
    assert.equal(flag.audit_policy, 'required');
  });
});
