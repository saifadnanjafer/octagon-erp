// Checkpoint C3 — migration 048 contract coverage. Disposable SQLite only.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { freshInstall, migrationStatus, openMigrationDatabase, runMigrations } from '../../database/migration-runner/index.mjs';
import { migration as posMigration } from '../../database/migrations/048_pos_atomic_workflows.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tables = ['pos_terminals', 'pos_refunds', 'pos_refund_lines', 'pos_session_events', 'pos_reconciliations'];
const actions = ['pos:terminal:configure', 'pos:payment_method:configure', 'pos:order:refund'];

function workspace(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, dbPath: path.join(dir, 'migration.db'), backupDir: path.join(dir, 'backups') };
}

test('migration 048 fresh install, rerun, provenance, schema, and registry are deterministic', async () => {
  const temp = workspace('octagon-c3-migration-fresh-');
  try {
    const first = await freshInstall({ dbPath: temp.dbPath, backupDir: temp.backupDir, actor: 'c3-migration' });
    assert.ok(
      first.executed.some((row) => row.id === posMigration.id),
      'fresh install must include migration 048 even when later migrations exist',
    );
    assert.equal((await runMigrations({ dbPath: temp.dbPath, backupDir: temp.backupDir, actor: 'c3-rerun' })).executed.length, 0);
    const db = openMigrationDatabase(temp.dbPath);
    try {
      assert.match(
        db.prepare('SELECT source_provenance FROM schema_migrations WHERE migration_id = ?').get(posMigration.id).source_provenance,
        /VNext POS/,
      );
      for (const table of tables) assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sqlite_master WHERE name = ?').get(table).n, 1);
      const orderColumns = db.prepare('PRAGMA table_info(pos_orders)').all().map((row) => row.name);
      for (const column of ['order_kind', 'original_order_id', 'warehouse_id', 'cashier_id', 'amount_untaxed', 'amount_tax', 'amount_discount', 'receipt_number', 'completed_at']) {
        assert.ok(orderColumns.includes(column), `pos_orders.${column} missing`);
      }
      const placeholders = actions.map(() => '?').join(',');
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS n FROM platform_actions WHERE id IN (${placeholders}) AND transaction_owner = 'platform_action_executor'`).get(...actions).n,
        actions.length,
      );
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test('sequential upgrade from migration 047 applies only migration 048', async () => {
  const temp = workspace('octagon-c3-migration-upgrade-');
  const migrationsDir = path.join(repoRoot, 'database', 'migrations');
  const oldMigrations = path.join(temp.dir, 'database', 'migrations');
  fs.mkdirSync(oldMigrations, { recursive: true });
  try {
    for (const file of fs.readdirSync(migrationsDir).filter((name) => /^\d+_.+\.mjs$/.test(name) && Number.parseInt(name.slice(0, 3), 10) < 48)) {
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
    await runMigrations({ dbPath: temp.dbPath, migrationsDir: oldMigrations, backupDir: temp.backupDir, actor: 'c3-upgrade' });
    fs.copyFileSync(
      path.join(migrationsDir, '048_pos_atomic_workflows.mjs'),
      path.join(oldMigrations, '048_pos_atomic_workflows.mjs'),
    );
    const result = await runMigrations({ dbPath: temp.dbPath, migrationsDir: oldMigrations, backupDir: temp.backupDir, actor: 'c3-upgrade' });
    assert.deepEqual(result.executed.map((row) => row.id), [posMigration.id]);
    assert.equal((await migrationStatus({ dbPath: temp.dbPath, migrationsDir: oldMigrations })).every((row) => row.status === 'applied'), true);
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test('migration 048 down/up owns only its tables and actions', async () => {
  const temp = workspace('octagon-c3-migration-rollback-');
  try {
    await freshInstall({ dbPath: temp.dbPath, backupDir: temp.backupDir, actor: 'c3-rollback' });
    const db = openMigrationDatabase(temp.dbPath);
    try {
      db.exec('BEGIN IMMEDIATE');
      posMigration.down(db);
      db.exec('COMMIT');
      for (const table of tables) assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sqlite_master WHERE name = ?').get(table).n, 0);
      db.exec('BEGIN IMMEDIATE');
      posMigration.up(db);
      db.exec('COMMIT');
      for (const table of tables) assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sqlite_master WHERE name = ?').get(table).n, 1);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test('injected POS action-registry failure rolls migration 048 owned state back', async () => {
  const temp = workspace('octagon-c3-migration-failure-');
  try {
    await freshInstall({ dbPath: temp.dbPath, backupDir: temp.backupDir, actor: 'c3-failure' });
    const db = openMigrationDatabase(temp.dbPath);
    try {
      db.exec('BEGIN IMMEDIATE');
      posMigration.down(db);
      db.exec('COMMIT');
      db.exec(`
        CREATE TRIGGER checkpoint_c3_fail_registry
        BEFORE INSERT ON platform_actions
        WHEN NEW.id = 'pos:order:refund'
        BEGIN SELECT RAISE(ABORT, 'injected POS registry failure'); END;
      `);
      db.exec('BEGIN IMMEDIATE');
      assert.throws(() => posMigration.up(db), /injected POS registry failure/);
      db.exec('ROLLBACK');
      for (const table of tables) assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sqlite_master WHERE name = ?').get(table).n, 0);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});
