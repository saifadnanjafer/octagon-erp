// Checkpoint C6 — migration 051 forward compatibility proof. Disposable SQLite only.

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
import { migration as policyMigration } from '../../database/migrations/051_checkpoint_c_control_entity_policy.mjs';
import { EntityRegistry } from '../../platform/kernel/entities/index.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migrationsDir = path.join(repoRoot, 'database', 'migrations');

function workspace(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    dir,
    dbPath: path.join(dir, 'migration.db'),
    backupDir: path.join(dir, 'backups'),
    staged: path.join(dir, 'database', 'migrations'),
  };
}

function stageThrough(target, maximum) {
  fs.mkdirSync(target, { recursive: true });
  for (const file of fs.readdirSync(migrationsDir).filter((name) =>
    /^\d+_.+\.mjs$/.test(name) && Number.parseInt(name.slice(0, 3), 10) <= maximum)) {
    fs.copyFileSync(path.join(migrationsDir, file), path.join(target, file));
  }
  for (const relative of [
    path.join('platform', 'server', 'governance-collections.mjs'),
    path.join('platform', 'identity', 'users', 'index.mjs'),
    path.join('platform', 'identity', 'passwords', 'index.mjs'),
    path.join('platform', 'kernel', 'entities', 'default-entities.json'),
  ]) {
    const stagedFile = path.join(path.dirname(path.dirname(target)), relative);
    fs.mkdirSync(path.dirname(stagedFile), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, relative), stagedFile);
  }
}

test('migration 051 fresh install and rerun preserve a readable complete entity registry', async () => {
  const temp = workspace('octagon-c6-policy-fresh-');
  try {
    const first = await freshInstall({
      dbPath: temp.dbPath,
      backupDir: temp.backupDir,
      actor: 'c6-policy-fresh',
    });
    assert.equal(first.executed.at(-1).id, policyMigration.id);
    assert.equal((await runMigrations({
      dbPath: temp.dbPath,
      backupDir: temp.backupDir,
      actor: 'c6-policy-rerun',
    })).executed.length, 0);
    const db = openMigrationDatabase(temp.dbPath);
    try {
      assert.equal(
        db.prepare("SELECT lifecycle_policy FROM platform_entities WHERE id='control_plane'").get().lifecycle_policy,
        'generic',
      );
      assert.ok(new EntityRegistry(db).list().some((entity) => entity.id === 'control_plane'));
      assert.match(
        db.prepare('SELECT source_provenance FROM schema_migrations WHERE migration_id=?').get(policyMigration.id).source_provenance,
        /Phase 01 entity descriptor/,
      );
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test('sequential upgrade from migration 050 applies only migration 051', async () => {
  const temp = workspace('octagon-c6-policy-upgrade-');
  try {
    stageThrough(temp.staged, 50);
    await runMigrations({
      dbPath: temp.dbPath,
      migrationsDir: temp.staged,
      backupDir: temp.backupDir,
      actor: 'c6-policy-base',
    });
    fs.copyFileSync(
      path.join(migrationsDir, '051_checkpoint_c_control_entity_policy.mjs'),
      path.join(temp.staged, '051_checkpoint_c_control_entity_policy.mjs'),
    );
    const result = await runMigrations({
      dbPath: temp.dbPath,
      migrationsDir: temp.staged,
      backupDir: temp.backupDir,
      actor: 'c6-policy-upgrade',
    });
    assert.deepEqual(result.executed.map((row) => row.id), [policyMigration.id]);
    assert.equal((await migrationStatus({
      dbPath: temp.dbPath,
      migrationsDir: temp.staged,
    })).every((row) => row.status === 'applied'), true);
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test('migration 051 down/up never restores the invalid lifecycle policy', async () => {
  const temp = workspace('octagon-c6-policy-down-');
  try {
    await freshInstall({
      dbPath: temp.dbPath,
      backupDir: temp.backupDir,
      actor: 'c6-policy-down',
    });
    const db = openMigrationDatabase(temp.dbPath);
    try {
      policyMigration.down(db);
      assert.equal(
        db.prepare("SELECT lifecycle_policy FROM platform_entities WHERE id='control_plane'").get().lifecycle_policy,
        'generic',
      );
      policyMigration.up(db);
      assert.ok(new EntityRegistry(db).list().some((entity) => entity.id === 'control_plane'));
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test('injected policy-update failure leaves migration 051 unapplied and migration 050 facts intact', async () => {
  const temp = workspace('octagon-c6-policy-failure-');
  try {
    stageThrough(temp.staged, 50);
    await runMigrations({
      dbPath: temp.dbPath,
      migrationsDir: temp.staged,
      backupDir: temp.backupDir,
      actor: 'c6-policy-failure-base',
    });
    fs.copyFileSync(
      path.join(migrationsDir, '051_checkpoint_c_control_entity_policy.mjs'),
      path.join(temp.staged, '051_checkpoint_c_control_entity_policy.mjs'),
    );
    const db = openMigrationDatabase(temp.dbPath);
    try {
      db.exec(`
        CREATE TRIGGER checkpoint_c6_fail_policy
        BEFORE UPDATE ON platform_entities
        WHEN OLD.id='control_plane'
        BEGIN SELECT RAISE(ABORT, 'injected entity policy failure'); END;
      `);
    } finally {
      db.close();
    }
    await assert.rejects(
      () => runMigrations({
        dbPath: temp.dbPath,
        migrationsDir: temp.staged,
        backupDir: temp.backupDir,
        actor: 'c6-policy-failure',
      }),
      /injected entity policy failure/,
    );
    const verify = openMigrationDatabase(temp.dbPath);
    try {
      assert.equal(
        verify.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE migration_id=?').get(policyMigration.id).n,
        0,
      );
      assert.equal(
        verify.prepare("SELECT lifecycle_policy FROM platform_entities WHERE id='control_plane'").get().lifecycle_policy,
        'governed',
      );
      assert.equal(
        verify.prepare("SELECT COUNT(*) AS n FROM platform_modules WHERE id='checkpoint_c_test_module'").get().n,
        1,
      );
    } finally {
      verify.close();
    }
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});
