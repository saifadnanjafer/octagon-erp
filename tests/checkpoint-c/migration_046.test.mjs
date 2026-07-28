// Checkpoint C — migration 046 contract coverage.
//
// Disposable databases only (os.tmpdir()); the operational database is never
// opened. Mirrors the phase04 migration contract suite.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  freshInstall,
  migrationStatus,
  openMigrationDatabase,
  runMigrations,
} from '../../database/migration-runner/index.mjs';
import { migration as salesLifecycleMigration } from '../../database/migrations/046_sales_lifecycle_expansion.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migrationsDir = path.join(repoRoot, 'database', 'migrations');

const NEW_TABLES = [
  'crm_opportunities',
  'crm_opportunity_activities',
  'sale_delivery_events',
  'sale_returns',
  'sale_return_lines',
  'sales_commission_rules',
];

const NEW_ACTION_IDS = [
  'crm:lead:convert',
  'crm:opportunity:update_stage',
  'crm:opportunity:add_activity',
  'crm:opportunity:close',
  'sales:quotation:submit',
  'sales:quotation:approve',
  'sales:quotation:revise',
  'sales:quotation:accept',
  'sales:order:cancel',
  'sales:order:reserve',
  'sales:delivery:post',
  'sales:return:create',
  'sales:commission:accrue',
  'sales:commission:approve',
  'sales:commission:mark_paid',
];

function tempWorkspace(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    dir,
    dbPath: path.join(dir, 'migration.db'),
    backupDir: path.join(dir, 'backups'),
  };
}

test('migration 046 fresh install and rerun are deterministic and carry provenance', async () => {
  const temp = tempWorkspace('octagon-checkpoint-c-migration-fresh-');
  try {
    const first = await freshInstall({
      dbPath: temp.dbPath,
      backupDir: temp.backupDir,
      actor: 'checkpoint-c-migration-test',
    });
    assert.ok(
      first.executed.some((row) => row.id === salesLifecycleMigration.id),
      'fresh install must include migration 046 even when later migrations exist',
    );
    const second = await runMigrations({
      dbPath: temp.dbPath,
      backupDir: temp.backupDir,
      actor: 'checkpoint-c-migration-test',
    });
    assert.equal(second.executed.length, 0);
    const db = openMigrationDatabase(temp.dbPath);
    try {
      const provenance = db.prepare(`
        SELECT migration_id, source_provenance FROM schema_migrations WHERE migration_id = ?
      `).get(salesLifecycleMigration.id);
      assert.ok(provenance);
      assert.match(provenance.source_provenance, /VNext sales engine/);

      for (const table of NEW_TABLES) {
        assert.equal(
          db.prepare('SELECT COUNT(*) AS n FROM sqlite_master WHERE name = ?').get(table).n,
          1,
          `table ${table} must exist`,
        );
      }
      const orderColumns = db.prepare('PRAGMA table_info(sale_orders)').all().map((c) => c.name);
      for (const column of ['revision_no', 'quotation_state', 'validity_date', 'approved_by', 'approved_at', 'accepted_at', 'superseded_by', 'cancelled_at', 'source_opportunity_id', 'discount_total', 'tax_total', 'notes', 'attachments', 'project_ref']) {
        assert.ok(orderColumns.includes(column), `sale_orders.${column} must exist`);
      }
      const lineColumns = db.prepare('PRAGMA table_info(sale_order_lines)').all().map((c) => c.name);
      assert.ok(lineColumns.includes('tax_amount'));
      const commissionColumns = db.prepare('PRAGMA table_info(sales_commission_events)').all().map((c) => c.name);
      for (const column of ['basis_amount', 'rate', 'approved_by', 'approved_at', 'paid_by', 'paid_at']) {
        assert.ok(commissionColumns.includes(column), `sales_commission_events.${column} must exist`);
      }

      const placeholders = NEW_ACTION_IDS.map(() => '?').join(',');
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS n FROM platform_actions WHERE id IN (${placeholders}) AND transaction_owner = 'platform_action_executor'`).get(...NEW_ACTION_IDS).n,
        NEW_ACTION_IDS.length,
      );
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS n FROM platform_entities WHERE id IN ('commercial_crm_opportunity', 'sale_delivery', 'sale_return', 'sales_commission_event')`).get().n,
        4,
      );
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test('sequential upgrade from 045 applies only migration 046', async () => {
  const temp = tempWorkspace('octagon-checkpoint-c-migration-upgrade-');
  const oldMigrations = path.join(temp.dir, 'database', 'migrations');
  const targetMigrations = path.join(temp.dir, 'database', 'target-migrations');
  fs.mkdirSync(oldMigrations, { recursive: true });
  fs.mkdirSync(targetMigrations, { recursive: true });
  try {
    for (const file of fs.readdirSync(migrationsDir).filter((name) => /^\d+_.+\.mjs$/.test(name))) {
      const number = Number(file.slice(0, 3));
      if (number <= 45) fs.copyFileSync(path.join(migrationsDir, file), path.join(oldMigrations, file));
      if (number <= 46) fs.copyFileSync(path.join(migrationsDir, file), path.join(targetMigrations, file));
    }
    for (const relative of [
      path.join('platform', 'server', 'governance-collections.mjs'),
      path.join('platform', 'identity', 'users', 'index.mjs'),
      path.join('platform', 'identity', 'passwords', 'index.mjs'),
      path.join('platform', 'kernel', 'entities', 'default-entities.json'),
    ]) {
      const target = path.join(temp.dir, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(repoRoot, relative), target);
    }
    await runMigrations({
      dbPath: temp.dbPath,
      migrationsDir: oldMigrations,
      backupDir: temp.backupDir,
      actor: 'checkpoint-c-upgrade-test',
    });
    const upgrade = await runMigrations({
      dbPath: temp.dbPath,
      migrationsDir: targetMigrations,
      backupDir: temp.backupDir,
      actor: 'checkpoint-c-upgrade-test',
    });
    assert.deepEqual(upgrade.executed.map((row) => row.id), [salesLifecycleMigration.id]);
    const status = await migrationStatus({ dbPath: temp.dbPath, migrationsDir: targetMigrations });
    assert.equal(status.every((row) => row.status === 'applied'), true);
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test('migration 046 down/up rollback is safe on a disposable database', async () => {
  const temp = tempWorkspace('octagon-checkpoint-c-migration-rollback-');
  try {
    await freshInstall({ dbPath: temp.dbPath, backupDir: temp.backupDir, actor: 'checkpoint-c-rollback-test' });
    const db = openMigrationDatabase(temp.dbPath);
    try {
      db.exec('BEGIN IMMEDIATE;');
      salesLifecycleMigration.down(db, { dialect: 'sqlite' });
      db.exec('COMMIT;');
      for (const table of NEW_TABLES) {
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sqlite_master WHERE name = ?').get(table).n, 0, `table ${table} must be dropped`);
      }
      const orderColumns = db.prepare('PRAGMA table_info(sale_orders)').all().map((c) => c.name);
      assert.equal(orderColumns.includes('revision_no'), false);
      assert.equal(orderColumns.includes('quotation_state'), false);
      const placeholders = NEW_ACTION_IDS.map(() => '?').join(',');
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS n FROM platform_actions WHERE id IN (${placeholders})`).get(...NEW_ACTION_IDS).n,
        0,
      );

      db.exec('BEGIN IMMEDIATE;');
      salesLifecycleMigration.up(db, { dialect: 'sqlite' });
      db.exec('COMMIT;');
      for (const table of NEW_TABLES) {
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sqlite_master WHERE name = ?').get(table).n, 1, `table ${table} must be recreated`);
      }
      const restoredColumns = db.prepare('PRAGMA table_info(sale_orders)').all().map((c) => c.name);
      assert.equal(restoredColumns.includes('revision_no'), true);
      assert.equal(restoredColumns.includes('quotation_state'), true);
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS n FROM platform_actions WHERE id IN (${placeholders})`).get(...NEW_ACTION_IDS).n,
        NEW_ACTION_IDS.length,
      );
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test('injected registry failure rolls back every migration 046 effect', async () => {
  const temp = tempWorkspace('octagon-checkpoint-c-migration-failure-');
  try {
    await freshInstall({ dbPath: temp.dbPath, backupDir: temp.backupDir, actor: 'checkpoint-c-failure-test' });
    const db = openMigrationDatabase(temp.dbPath);
    try {
      db.exec('BEGIN IMMEDIATE;');
      salesLifecycleMigration.down(db, { dialect: 'sqlite' });
      db.exec('COMMIT;');
      db.exec(`
        CREATE TRIGGER checkpoint_c_fail_action_registry
        BEFORE INSERT ON platform_actions
        WHEN NEW.id LIKE 'sales:commission:%'
        BEGIN
          SELECT RAISE(ABORT, 'injected migration registry failure');
        END;
      `);

      db.exec('BEGIN IMMEDIATE;');
      assert.throws(
        () => salesLifecycleMigration.up(db, { dialect: 'sqlite' }),
        /injected migration registry failure/,
      );
      db.exec('ROLLBACK;');

      for (const table of NEW_TABLES) {
        assert.equal(
          db.prepare('SELECT COUNT(*) AS n FROM sqlite_master WHERE name = ?').get(table).n,
          0,
          `table ${table} must be absent after rollback`,
        );
      }
      const orderColumns = db.prepare('PRAGMA table_info(sale_orders)').all().map((c) => c.name);
      assert.equal(orderColumns.includes('revision_no'), false);
      const placeholders = NEW_ACTION_IDS.map(() => '?').join(',');
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS n FROM platform_actions WHERE id IN (${placeholders})`).get(...NEW_ACTION_IDS).n,
        0,
      );
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});
