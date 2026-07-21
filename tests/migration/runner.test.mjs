import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { migrationStatus, runMigrations, freshInstall, resolveMigrationOrder, MigrationRunnerError } from '../../database/migration-runner/index.mjs';

function tmpDb(name) {
  return path.join(os.tmpdir(), `octagon-test-${name}-${Date.now()}.db`);
}

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `octagon-migrations-${prefix}-`));
}

async function testFreshInstall() {
  const db = tmpDb('fresh');
  const result = await freshInstall({ dbPath: db });
  assert.strictEqual(result.direction, 'up');
  assert.strictEqual(result.dialect, 'sqlite');
  assert.ok(result.migrations.length >= 1);
  assert.deepStrictEqual(result.status.every((s) => s.status === 'applied'), true);
  assert.ok(fs.existsSync(db));
  fs.unlinkSync(db);
  console.log('PASS: freshInstall');
}

async function testStatusAndReRun() {
  const db = tmpDb('status');
  await freshInstall({ dbPath: db });
  const status = await migrationStatus({ dbPath: db });
  assert.ok(status.some((s) => s.id === '001_platform_kernel_bootstrap'));
  const rerun = await runMigrations({ dbPath: db, direction: 'up' });
  assert.deepStrictEqual(rerun.migrations, []);
  fs.unlinkSync(db);
  console.log('PASS: statusAndReRun');
}

async function testDependencyOrder() {
  const migrations = [
    { id: '001_a', dependsOn: [], file: '001_a.mjs' },
    { id: '002_b', dependsOn: ['001_a'], file: '002_b.mjs' },
    { id: '003_c', dependsOn: ['002_b'], file: '003_c.mjs' },
  ];
  const order = resolveMigrationOrder(migrations);
  assert.deepStrictEqual(order.map((m) => m.id), ['001_a', '002_b', '003_c']);
  console.log('PASS: dependencyOrder');
}

async function testDependencyCycleDetection() {
  const migrations = [
    { id: '001_a', dependsOn: ['003_c'], file: '001_a.mjs' },
    { id: '002_b', dependsOn: ['001_a'], file: '002_b.mjs' },
    { id: '003_c', dependsOn: ['002_b'], file: '003_c.mjs' },
  ];
  assert.throws(() => resolveMigrationOrder(migrations), MigrationRunnerError);
  console.log('PASS: dependencyCycleDetection');
}

async function testMissingDependency() {
  const migrations = [
    { id: '001_a', dependsOn: ['999_missing'], file: '001_a.mjs' },
  ];
  assert.throws(
    () => resolveMigrationOrder(migrations),
    (err) => err instanceof MigrationRunnerError && err.code === 'MISSING_DEPENDENCY'
  );
  console.log('PASS: missingDependency');
}

async function testDownRollback() {
  const db = tmpDb('rollback');
  await freshInstall({ dbPath: db });
  const down = await runMigrations({ dbPath: db, direction: 'down' });
  assert.ok(down.migrations.length >= 1);
  assert.ok(down.migrations.includes('001_platform_kernel_bootstrap'));
  const status = await migrationStatus({ dbPath: db });
  assert.deepStrictEqual(status.every((s) => s.status === 'pending'), true);
  fs.unlinkSync(db);
  console.log('PASS: downRollback');
}

async function testConcurrentRunLock() {
  const db = tmpDb('concurrent');
  const dir = tmpDir('concurrent');
  fs.writeFileSync(path.join(dir, '001_slow.mjs'), `
    export const migration = {
      id: '001_slow',
      up(db) {
        db.exec('CREATE TABLE slow_test (id TEXT PRIMARY KEY) STRICT;');
        const start = Date.now();
        while (Date.now() - start < 500) {}
      },
      down(db) { db.exec('DROP TABLE slow_test;'); }
    };
  `);
  const p1 = runMigrations({ dbPath: db, migrationsDir: dir, direction: 'up' });
  const p2 = runMigrations({ dbPath: db, migrationsDir: dir, direction: 'up' });
  const results = await Promise.allSettled([p1, p2]);
  const oneRejected = results.some((r) => r.status === 'rejected');
  assert.ok(oneRejected, 'Expected one concurrent run to be rejected');
  fs.rmSync(db, { force: true });
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('PASS: concurrentRunLock');
}

async function testPostgresDialectStub() {
  const { createDialect } = await import('../../database/dialects/index.mjs');
  const dialect = createDialect('postgres');
  assert.throws(() => dialect.open(), /PostgreSQL dialect is not yet configured/);
  console.log('PASS: postgresDialectStub');
}

async function main() {
  await testFreshInstall();
  await testStatusAndReRun();
  await testDependencyOrder();
  await testDependencyCycleDetection();
  await testMissingDependency();
  await testDownRollback();
  await testConcurrentRunLock();
  await testPostgresDialectStub();
  console.log('\nAll migration runner tests passed.');
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exitCode = 1;
});
