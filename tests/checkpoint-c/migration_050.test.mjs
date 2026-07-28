// Checkpoint C5 — migration 050 contract coverage. Disposable SQLite only.

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
import { migration as controlMigration } from '../../database/migrations/050_control_plane_module_management.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migrationsDir = path.join(repoRoot, 'database', 'migrations');
const actions = [
  'control:module:set_status',
  'control:feature:set',
  'control:module:assign',
  'control:license:set',
  'control:job:set',
  'control:test:ping',
];

function workspace(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, dbPath: path.join(dir, 'migration.db'), backupDir: path.join(dir, 'backups') };
}

test('migration 050 fresh install, rerun, provenance, control tables, test module, view, and actions are deterministic', async () => {
  const temp = workspace('octagon-c5-migration-fresh-');
  try {
    const first = await freshInstall({ dbPath: temp.dbPath, backupDir: temp.backupDir, actor: 'c5-migration' });
    assert.equal(first.executed.at(-1).id, controlMigration.id);
    assert.equal((await runMigrations({ dbPath: temp.dbPath, backupDir: temp.backupDir, actor: 'c5-rerun' })).executed.length, 0);
    const db = openMigrationDatabase(temp.dbPath);
    try {
      assert.match(
        db.prepare('SELECT source_provenance FROM schema_migrations WHERE migration_id=?').get(controlMigration.id).source_provenance,
        /VNext module lifecycle/,
      );
      for (const table of ['platform_module_assignments', 'platform_module_licenses', 'platform_backup_runs']) {
        assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?").get(table).n, 1);
      }
      assert.equal(db.prepare("SELECT status FROM platform_modules WHERE id='checkpoint_c_test_module'").get().status, 'enabled');
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM platform_views WHERE id='view_checkpoint_c_test_module'").get().n, 1);
      const marks = actions.map(() => '?').join(',');
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM platform_actions WHERE id IN (${marks})`).get(...actions).n, actions.length);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test('sequential upgrade from migration 049 applies only migration 050', async () => {
  const temp = workspace('octagon-c5-migration-upgrade-');
  const staged = path.join(temp.dir, 'database', 'migrations');
  fs.mkdirSync(staged, { recursive: true });
  try {
    for (const file of fs.readdirSync(migrationsDir).filter((name) => /^\d+_.+\.mjs$/.test(name) && Number.parseInt(name.slice(0, 3), 10) < 50)) {
      fs.copyFileSync(path.join(migrationsDir, file), path.join(staged, file));
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
    await runMigrations({ dbPath: temp.dbPath, migrationsDir: staged, backupDir: temp.backupDir, actor: 'c5-upgrade' });
    fs.copyFileSync(path.join(migrationsDir, '050_control_plane_module_management.mjs'), path.join(staged, '050_control_plane_module_management.mjs'));
    const result = await runMigrations({ dbPath: temp.dbPath, migrationsDir: staged, backupDir: temp.backupDir, actor: 'c5-upgrade' });
    assert.deepEqual(result.executed.map((row) => row.id), [controlMigration.id]);
    assert.equal((await migrationStatus({ dbPath: temp.dbPath, migrationsDir: staged })).every((row) => row.status === 'applied'), true);
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test('migration 050 down/up owns only its control tables, actions, view, and test module', async () => {
  const temp = workspace('octagon-c5-migration-rollback-');
  try {
    await freshInstall({ dbPath: temp.dbPath, backupDir: temp.backupDir, actor: 'c5-rollback' });
    const db = openMigrationDatabase(temp.dbPath);
    try {
      db.exec('BEGIN IMMEDIATE'); controlMigration.down(db); db.exec('COMMIT');
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='platform_module_licenses'").get().n, 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM platform_modules WHERE id='checkpoint_c_test_module'").get().n, 0);
      db.exec('BEGIN IMMEDIATE'); controlMigration.up(db); db.exec('COMMIT');
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='platform_module_licenses'").get().n, 1);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM platform_modules WHERE id='checkpoint_c_test_module'").get().n, 1);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test('injected control action-registry failure rolls every migration 050 owned fact back', async () => {
  const temp = workspace('octagon-c5-migration-failure-');
  try {
    await freshInstall({ dbPath: temp.dbPath, backupDir: temp.backupDir, actor: 'c5-failure' });
    const db = openMigrationDatabase(temp.dbPath);
    try {
      db.exec('BEGIN IMMEDIATE'); controlMigration.down(db); db.exec('COMMIT');
      db.exec(`
        CREATE TRIGGER checkpoint_c5_fail_registry BEFORE INSERT ON platform_actions
        WHEN NEW.id='control:license:set'
        BEGIN SELECT RAISE(ABORT,'injected Control Plane registry failure'); END;
      `);
      db.exec('BEGIN IMMEDIATE');
      assert.throws(() => controlMigration.up(db), /injected Control Plane registry failure/);
      db.exec('ROLLBACK');
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='platform_module_assignments'").get().n, 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM platform_modules WHERE id='checkpoint_c_test_module'").get().n, 0);
      const marks = actions.map(() => '?').join(',');
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM platform_actions WHERE id IN (${marks})`).get(...actions).n, 0);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});
