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
import { migration as consolidationMigration } from '../../database/migrations/043_phase04_canonical_registry_and_lineage.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migrationsDir = path.join(repoRoot, 'database', 'migrations');

function tempWorkspace(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    dir,
    dbPath: path.join(dir, 'migration.db'),
    backupDir: path.join(dir, 'backups'),
  };
}

test('migration 043 fresh install and rerun are deterministic and carry provenance', async () => {
  const temp = tempWorkspace('octagon-phase04-migration-fresh-');
  try {
    const first = await freshInstall({
      dbPath: temp.dbPath,
      backupDir: temp.backupDir,
      actor: 'phase04-migration-test',
    });
    assert.equal(first.executed.at(-1).id, consolidationMigration.id);
    const second = await runMigrations({
      dbPath: temp.dbPath,
      backupDir: temp.backupDir,
      actor: 'phase04-migration-test',
    });
    assert.equal(second.executed.length, 0);
    const db = openMigrationDatabase(temp.dbPath);
    try {
      const provenance = db.prepare(`
        SELECT migration_id, source_provenance
        FROM schema_migrations
        WHERE migration_id >= '036' AND migration_id <= '043_phase04_canonical_registry_and_lineage'
        ORDER BY migration_id
      `).all();
      assert.equal(provenance.length, 8);
      assert.equal(provenance.every((row) => Boolean(row.source_provenance)), true);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM platform_actions WHERE transaction_owner = 'platform_action_executor'").get().n, 42);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test('parallel disposable installs use collision-safe backup paths', async () => {
  const temp = tempWorkspace('octagon-phase04-migration-parallel-');
  try {
    const dbPathA = path.join(temp.dir, 'parallel-a.db');
    const dbPathB = path.join(temp.dir, 'parallel-b.db');
    const [first, second] = await Promise.all([
      freshInstall({
        dbPath: dbPathA,
        backupDir: temp.backupDir,
        actor: 'phase04-parallel-a',
      }),
      freshInstall({
        dbPath: dbPathB,
        backupDir: temp.backupDir,
        actor: 'phase04-parallel-b',
      }),
    ]);
    assert.notEqual(first.backupPath, second.backupPath);
    assert.equal(fs.existsSync(first.backupPath), true);
    assert.equal(fs.existsSync(second.backupPath), true);
    assert.equal(first.executed.length, 43);
    assert.equal(second.executed.length, 43);
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test('sequential upgrade from 042 applies only the 043 consolidation migration', async () => {
  const temp = tempWorkspace('octagon-phase04-migration-upgrade-');
  const oldMigrations = path.join(temp.dir, 'database', 'migrations');
  fs.mkdirSync(oldMigrations, { recursive: true });
  try {
    for (const file of fs.readdirSync(migrationsDir).filter((name) => /^\d+_.+\.mjs$/.test(name) && !name.startsWith('043_'))) {
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
    await runMigrations({
      dbPath: temp.dbPath,
      migrationsDir: oldMigrations,
      backupDir: temp.backupDir,
      actor: 'phase04-upgrade-test',
    });
    const upgrade = await runMigrations({
      dbPath: temp.dbPath,
      migrationsDir,
      backupDir: temp.backupDir,
      actor: 'phase04-upgrade-test',
    });
    assert.deepEqual(upgrade.executed.map((row) => row.id), [consolidationMigration.id]);
    const status = await migrationStatus({ dbPath: temp.dbPath, migrationsDir });
    assert.equal(status.every((row) => row.status === 'applied'), true);
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test('migration 043 down/up rollback is safe on a disposable database', async () => {
  const temp = tempWorkspace('octagon-phase04-migration-rollback-');
  try {
    await freshInstall({ dbPath: temp.dbPath, backupDir: temp.backupDir, actor: 'phase04-rollback-test' });
    const db = openMigrationDatabase(temp.dbPath);
    try {
      db.exec('BEGIN IMMEDIATE;');
      consolidationMigration.down(db, { dialect: 'sqlite' });
      db.exec('COMMIT;');
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'stock_valuation_facts'").get().n, 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM platform_actions WHERE transaction_owner = 'platform_action_executor'").get().n, 0);

      db.exec('BEGIN IMMEDIATE;');
      consolidationMigration.up(db, { dialect: 'sqlite' });
      db.exec('COMMIT;');
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'stock_valuation_facts'").get().n, 1);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM platform_actions WHERE transaction_owner = 'platform_action_executor'").get().n, 42);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test('injected registry failure rolls back every migration 043 effect', async () => {
  const temp = tempWorkspace('octagon-phase04-migration-failure-');
  try {
    await freshInstall({ dbPath: temp.dbPath, backupDir: temp.backupDir, actor: 'phase04-failure-test' });
    const db = openMigrationDatabase(temp.dbPath);
    try {
      db.exec('BEGIN IMMEDIATE;');
      consolidationMigration.down(db, { dialect: 'sqlite' });
      db.exec('COMMIT;');
      db.exec(`
        CREATE TRIGGER phase04_fail_action_registry
        BEFORE INSERT ON platform_actions
        WHEN NEW.transaction_owner = 'platform_action_executor'
        BEGIN
          SELECT RAISE(ABORT, 'injected migration registry failure');
        END;
      `);

      db.exec('BEGIN IMMEDIATE;');
      assert.throws(
        () => consolidationMigration.up(db, { dialect: 'sqlite' }),
        /injected migration registry failure/,
      );
      db.exec('ROLLBACK;');
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'stock_valuation_facts'").get().n, 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM platform_modules WHERE owner = 'octagon'").get().n, 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM platform_actions WHERE transaction_owner = 'platform_action_executor'").get().n, 0);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});
