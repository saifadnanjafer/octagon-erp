// Checkpoint C4 — migration 049 contract coverage. Disposable SQLite only.

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
import { migration as workItemMigration } from '../../database/migrations/049_work_item_operating_views.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migrationsDir = path.join(repoRoot, 'database', 'migrations');
const actions = [
  'work_item:assign',
  'work_item:transition',
  'work_item:add_subtask',
  'work_item:add_dependency',
  'work_item:complete',
  'work_item:cancel',
];

function workspace(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, dbPath: path.join(dir, 'migration.db'), backupDir: path.join(dir, 'backups') };
}

test('migration 049 fresh install, rerun, provenance, columns, events, and registry are deterministic', async () => {
  const temp = workspace('octagon-c4-migration-fresh-');
  try {
    const first = await freshInstall({ dbPath: temp.dbPath, backupDir: temp.backupDir, actor: 'c4-migration' });
    assert.ok(
      first.executed.some((row) => row.id === workItemMigration.id),
      'fresh install must include migration 049 even when later migrations exist',
    );
    assert.equal((await runMigrations({ dbPath: temp.dbPath, backupDir: temp.backupDir, actor: 'c4-rerun' })).executed.length, 0);
    const db = openMigrationDatabase(temp.dbPath);
    try {
      assert.match(
        db.prepare('SELECT source_provenance FROM schema_migrations WHERE migration_id = ?').get(workItemMigration.id).source_provenance,
        /VNext project task and SLA/,
      );
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='work_item_events'").get().n, 1);
      const columns = db.prepare('PRAGMA table_info(work_items)').all().map((row) => row.name);
      for (const column of ['sales_ref', 'procurement_ref', 'quality_ref', 'sla_policy', 'sla_status', 'last_stage_moved_at', 'recurrence_next_at']) {
        assert.ok(columns.includes(column), `work_items.${column} missing`);
      }
      const placeholders = actions.map(() => '?').join(',');
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS n FROM platform_actions WHERE id IN (${placeholders}) AND transaction_owner='platform_action_executor'`).get(...actions).n,
        actions.length,
      );
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test('sequential upgrade from migration 048 applies only migration 049', async () => {
  const temp = workspace('octagon-c4-migration-upgrade-');
  const stagedMigrations = path.join(temp.dir, 'database', 'migrations');
  fs.mkdirSync(stagedMigrations, { recursive: true });
  try {
    for (const file of fs.readdirSync(migrationsDir).filter((name) => /^\d+_.+\.mjs$/.test(name) && Number.parseInt(name.slice(0, 3), 10) < 49)) {
      fs.copyFileSync(path.join(migrationsDir, file), path.join(stagedMigrations, file));
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
    await runMigrations({ dbPath: temp.dbPath, migrationsDir: stagedMigrations, backupDir: temp.backupDir, actor: 'c4-upgrade' });
    fs.copyFileSync(
      path.join(migrationsDir, '049_work_item_operating_views.mjs'),
      path.join(stagedMigrations, '049_work_item_operating_views.mjs'),
    );
    const result = await runMigrations({ dbPath: temp.dbPath, migrationsDir: stagedMigrations, backupDir: temp.backupDir, actor: 'c4-upgrade' });
    assert.deepEqual(result.executed.map((row) => row.id), [workItemMigration.id]);
    assert.equal((await migrationStatus({ dbPath: temp.dbPath, migrationsDir: stagedMigrations })).every((row) => row.status === 'applied'), true);
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test('migration 049 down/up owns its table and actions', async () => {
  const temp = workspace('octagon-c4-migration-rollback-');
  try {
    await freshInstall({ dbPath: temp.dbPath, backupDir: temp.backupDir, actor: 'c4-rollback' });
    const db = openMigrationDatabase(temp.dbPath);
    try {
      db.exec('BEGIN IMMEDIATE');
      workItemMigration.down(db);
      db.exec('COMMIT');
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='work_item_events'").get().n, 0);
      const placeholders = actions.map(() => '?').join(',');
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM platform_actions WHERE id IN (${placeholders})`).get(...actions).n, 0);
      db.exec('BEGIN IMMEDIATE');
      workItemMigration.up(db);
      db.exec('COMMIT');
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='work_item_events'").get().n, 1);
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM platform_actions WHERE id IN (${placeholders})`).get(...actions).n, actions.length);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test('injected Work Item action-registry failure rolls migration 049 owned state back', async () => {
  const temp = workspace('octagon-c4-migration-failure-');
  try {
    await freshInstall({ dbPath: temp.dbPath, backupDir: temp.backupDir, actor: 'c4-failure' });
    const db = openMigrationDatabase(temp.dbPath);
    try {
      db.exec('BEGIN IMMEDIATE');
      workItemMigration.down(db);
      db.exec('COMMIT');
      db.exec(`
        CREATE TRIGGER checkpoint_c4_fail_registry
        BEFORE INSERT ON platform_actions
        WHEN NEW.id = 'work_item:complete'
        BEGIN SELECT RAISE(ABORT, 'injected Work Item registry failure'); END;
      `);
      db.exec('BEGIN IMMEDIATE');
      assert.throws(() => workItemMigration.up(db), /injected Work Item registry failure/);
      db.exec('ROLLBACK');
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='work_item_events'").get().n, 0);
      const placeholders = actions.map(() => '?').join(',');
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM platform_actions WHERE id IN (${placeholders})`).get(...actions).n, 0);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});
