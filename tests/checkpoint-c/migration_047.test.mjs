// Checkpoint C2 — migration 047 contract coverage. Disposable SQLite only.

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
import { migration as procurementMigration } from '../../database/migrations/047_procurement_lifecycle_expansion.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migrationsDir = path.join(repoRoot, 'database', 'migrations');
const TABLES = [
  'purchase_requests',
  'purchase_request_lines',
  'purchase_rfq_lines',
  'purchase_rfq_suppliers',
  'supplier_quotation_lines',
  'purchase_commitments',
  'purchase_receipt_events',
  'purchase_quality_checks',
  'purchase_returns',
  'purchase_return_lines',
  'supplier_scorecards',
];
const ACTIONS = [
  'procurement:request:create',
  'procurement:request:submit',
  'procurement:request:approve',
  'procurement:requisition:approve',
  'procurement:supplier_quotation:record',
  'procurement:supplier_quotation:award',
  'procurement:order:approve',
  'procurement:receipt:post',
  'procurement:return:create',
  'procurement:score:record',
];

function workspace(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, dbPath: path.join(dir, 'migration.db'), backupDir: path.join(dir, 'backups') };
}

test('migration 047 fresh install and rerun are deterministic with registered actions', async () => {
  const temp = workspace('octagon-c2-migration-fresh-');
  try {
    const first = await freshInstall({ dbPath: temp.dbPath, backupDir: temp.backupDir, actor: 'c2-migration' });
    assert.ok(
      first.executed.some((row) => row.id === procurementMigration.id),
      'fresh install must include migration 047 even when later migrations exist',
    );
    const second = await runMigrations({ dbPath: temp.dbPath, backupDir: temp.backupDir, actor: 'c2-migration' });
    assert.equal(second.executed.length, 0);
    const db = openMigrationDatabase(temp.dbPath);
    try {
      const provenance = db.prepare('SELECT source_provenance FROM schema_migrations WHERE migration_id = ?').get(procurementMigration.id);
      assert.match(provenance.source_provenance, /VNext procurement/);
      for (const table of TABLES) {
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sqlite_master WHERE name = ?').get(table).n, 1);
      }
      const poColumns = db.prepare('PRAGMA table_info(purchase_orders)').all().map((row) => row.name);
      for (const column of ['selected_quotation_id', 'expected_date', 'quality_required', 'attachments', 'comments', 'approved_by', 'approved_at', 'commitment_amount', 'closed_at']) {
        assert.ok(poColumns.includes(column), `purchase_orders.${column} missing`);
      }
      const placeholders = ACTIONS.map(() => '?').join(',');
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS n FROM platform_actions WHERE id IN (${placeholders}) AND transaction_owner = 'platform_action_executor'`).get(...ACTIONS).n,
        ACTIONS.length,
      );
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test('sequential upgrade from 046 applies only migration 047', async () => {
  const temp = workspace('octagon-c2-migration-upgrade-');
  const oldMigrations = path.join(temp.dir, 'database', 'migrations');
  fs.mkdirSync(oldMigrations, { recursive: true });
  try {
    for (const file of fs.readdirSync(migrationsDir).filter((name) => /^\d+_.+\.mjs$/.test(name) && Number.parseInt(name.slice(0, 3), 10) < 47)) {
      fs.copyFileSync(path.join(migrationsDir, file), path.join(oldMigrations, file));
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
    await runMigrations({ dbPath: temp.dbPath, migrationsDir: oldMigrations, backupDir: temp.backupDir, actor: 'c2-upgrade' });
    fs.copyFileSync(
      path.join(migrationsDir, '047_procurement_lifecycle_expansion.mjs'),
      path.join(oldMigrations, '047_procurement_lifecycle_expansion.mjs'),
    );
    const result = await runMigrations({ dbPath: temp.dbPath, migrationsDir: oldMigrations, backupDir: temp.backupDir, actor: 'c2-upgrade' });
    assert.deepEqual(result.executed.map((row) => row.id), [procurementMigration.id]);
    assert.equal((await migrationStatus({ dbPath: temp.dbPath, migrationsDir: oldMigrations })).every((row) => row.status === 'applied'), true);
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test('migration 047 down/up drops and recreates owned tables and actions', async () => {
  const temp = workspace('octagon-c2-migration-rollback-');
  try {
    await freshInstall({ dbPath: temp.dbPath, backupDir: temp.backupDir, actor: 'c2-rollback' });
    const db = openMigrationDatabase(temp.dbPath);
    try {
      db.exec('BEGIN IMMEDIATE;');
      procurementMigration.down(db);
      db.exec('COMMIT;');
      for (const table of TABLES) assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sqlite_master WHERE name = ?').get(table).n, 0);
      const placeholders = ACTIONS.map(() => '?').join(',');
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM platform_actions WHERE id IN (${placeholders})`).get(...ACTIONS).n, 0);
      db.exec('BEGIN IMMEDIATE;');
      procurementMigration.up(db);
      db.exec('COMMIT;');
      for (const table of TABLES) assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sqlite_master WHERE name = ?').get(table).n, 1);
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM platform_actions WHERE id IN (${placeholders})`).get(...ACTIONS).n, ACTIONS.length);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test('injected registry failure rolls back all migration 047 owned state', async () => {
  const temp = workspace('octagon-c2-migration-failure-');
  try {
    await freshInstall({ dbPath: temp.dbPath, backupDir: temp.backupDir, actor: 'c2-failure' });
    const db = openMigrationDatabase(temp.dbPath);
    try {
      db.exec('BEGIN IMMEDIATE;');
      procurementMigration.down(db);
      db.exec('COMMIT;');
      db.exec(`
        CREATE TRIGGER checkpoint_c2_fail_registry
        BEFORE INSERT ON platform_actions
        WHEN NEW.id = 'procurement:return:create'
        BEGIN SELECT RAISE(ABORT, 'injected procurement registry failure'); END;
      `);
      db.exec('BEGIN IMMEDIATE;');
      assert.throws(() => procurementMigration.up(db), /injected procurement registry failure/);
      db.exec('ROLLBACK;');
      for (const table of TABLES) assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sqlite_master WHERE name = ?').get(table).n, 0);
      const placeholders = ACTIONS.map(() => '?').join(',');
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM platform_actions WHERE id IN (${placeholders})`).get(...ACTIONS).n, 0);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});
