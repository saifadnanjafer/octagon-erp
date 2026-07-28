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
import {
  PHASE04_RETIREMENT_LOCKS,
  createLegacyWriterRetirementGuard,
} from '../../platform/cutover/legacy-writer-retirement.mjs';
import { stageMigrationTree } from './migration-fixture.mjs';

async function withFreshDatabase(name, callback) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `octagon-phase04-${name}-`));
  const dbPath = path.join(tempDir, 'test.db');
  let db;
  try {
    const migrationsDir = stageMigrationTree(tempDir, 'phase04-tree', 44);
    const migrationResult = await freshInstall({
      dbPath,
      migrationsDir,
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
    assert.ok(result.executed.some((row) => row.id === '044_opening_stock_cutover_and_equity_coa'));
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE migration_id <= '044_opening_stock_cutover_and_equity_coa'").get().n,
      44,
    );
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
        AND module_id IN (
          'commercial_core', 'stock_inventory', 'stock_wms',
          'commercial_sales', 'commercial_procurement',
          'commercial_cutover', 'work_item_canonical'
        )
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
        AND module_id IN (
          'commercial_core', 'stock_inventory', 'stock_wms',
          'commercial_sales', 'commercial_procurement',
          'commercial_cutover', 'work_item_canonical'
        )
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

test('Phase 04 legacy writers retire only when both the global flag and exact domain lock are active', async () => {
  await withFreshDatabase('writer-retirement', (db) => {
    const guard = createLegacyWriterRetirementGuard(db);
    assert.equal(guard.cutoverEnabled(), false);
    for (const domain of Object.keys(PHASE04_RETIREMENT_LOCKS)) {
      assert.equal(guard.enforced(domain), false);
    }

    db.prepare(`
      UPDATE platform_feature_flags
      SET enabled = 1, updated_at = ?
      WHERE key = 'phase04.canonical_cutover'
    `).run(new Date().toISOString());
    assert.equal(guard.cutoverEnabled(), true);
    assert.equal(guard.enforced('INVENTORY'), false, 'Flag alone must never retire a writer');

    const inventoryLock = PHASE04_RETIREMENT_LOCKS.INVENTORY;
    db.prepare(`
      INSERT INTO authority_retirement_locks (
        id, authority_key, canonical_target, status, retired_at, reason
      ) VALUES (?, ?, ?, 'RETIRED', ?, ?)
    `).run(
      'retire_inventory_test',
      inventoryLock.authorityKey,
      inventoryLock.canonicalTarget,
      new Date().toISOString(),
      'disposable test proof',
    );
    assert.equal(guard.enforced('INVENTORY'), true);
    assert.equal(guard.enforced('SALES'), false, 'A lock must not retire a different domain');

    db.prepare(`
      UPDATE authority_retirement_locks
      SET canonical_target = 'wrong_target'
      WHERE authority_key = ?
    `).run(inventoryLock.authorityKey);
    assert.equal(guard.enforced('INVENTORY'), false, 'Wrong canonical target must fail closed');
  });
});
