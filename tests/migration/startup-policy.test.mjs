// Startup migration policy — regression tests for the 2026-07-29 operational
// auto-migration incident.
//
// The incident: starting the Octagon server called runMigrations({direction:'up'})
// unconditionally and migrated the OPERATIONAL database from tip 045 to 062.
// These tests exist so that cannot happen silently again.
//
// No operational database is opened, read, or written by this file. Every case
// uses a disposable database under the OS temp directory.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { migrationStatus, runMigrations, freshInstall } from '../../database/migration-runner/index.mjs';
import {
  classifyDatabase,
  resolveStartupMigrationPolicy,
  enforceStartupMigrationPolicy,
  StartupMigrationPolicyError,
  DATABASE_CLASS,
} from '../../database/migration-runner/startup-policy.mjs';

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `octagon-startup-${prefix}-`));
}

/** Minimal fixture migrations so tests do not depend on the 62-migration chain. */
function writeFixtureMigrations(count = 3) {
  const dir = tmpDir('migs');
  let previous = null;
  for (let i = 1; i <= count; i++) {
    const id = `${String(i).padStart(3, '0')}_fixture_${i}`;
    fs.writeFileSync(
      path.join(dir, `${id}.mjs`),
      `export const migration = {
  id: '${id}',
  owner: 'test.fixture',
  dependsOn: ${previous ? `['${previous}']` : '[]'},
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  up(d) { d.exec('CREATE TABLE IF NOT EXISTS fx_${i} (id TEXT PRIMARY KEY);'); },
  down(d) { d.exec('DROP TABLE IF EXISTS fx_${i};'); }
};`,
      'utf8'
    );
    previous = id;
  }
  return dir;
}

function markStaged(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE IF NOT EXISTS cutover_staged_fixture (
    id TEXT PRIMARY KEY, is_disposable INTEGER NOT NULL, source_label TEXT,
    created_at TEXT NOT NULL, source_db_sha256 TEXT, note TEXT);`);
  db.prepare(
    `INSERT OR REPLACE INTO cutover_staged_fixture (id, is_disposable, source_label, created_at)
     VALUES ('staged', 1, 'test', '2026-07-30T00:00:00.000Z')`
  ).run();
  db.close();
}

function fileHash(p) {
  return fs.existsSync(p) ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') : null;
}

// ---------------------------------------------------------------------------

async function testOperationalAtTipStartsWithoutWriting() {
  const dir = tmpDir('op-current');
  const db = path.join(dir, 'database.db'); // operational basename
  const migs = writeFixtureMigrations();
  await runMigrations({ dbPath: db, direction: 'up', migrationsDir: migs });

  const before = fs.readFileSync(db);
  const report = await enforceStartupMigrationPolicy(db, {
    env: {},
    migrationStatus: (o) => migrationStatus({ ...o, migrationsDir: migs }),
    runMigrations: (o) => runMigrations({ ...o, migrationsDir: migs }),
  });

  assert.strictEqual(report.databaseClass, DATABASE_CLASS.OPERATIONAL);
  assert.strictEqual(report.mode, 'status_only');
  assert.strictEqual(report.pendingCount, 0);
  assert.deepStrictEqual(report.migrationsApplied, [], 'no migration may run at startup');
  assert.deepStrictEqual(fs.readFileSync(db), before, 'database must be byte-identical after startup');

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(migs, { recursive: true, force: true });
  console.log('PASS: operationalAtTipStartsWithoutWriting');
}

async function testOperationalBehindRefusesAndChangesNothing() {
  const dir = tmpDir('op-behind');
  const build = path.join(dir, 'build.db');
  const db = path.join(dir, 'database.db');
  const migs = writeFixtureMigrations();

  // Build under a neutral name: the I1B rollback guard (correctly) refuses `down`
  // against an operational basename, so the "behind" state is produced first and
  // only then given the operational identity.
  await runMigrations({ dbPath: build, direction: 'up', migrationsDir: migs });
  await runMigrations({ dbPath: build, direction: 'down', migrationsDir: migs, steps: 2 });
  fs.renameSync(build, db);

  const beforeHash = fileHash(db);
  const beforeApplied = (await migrationStatus({ dbPath: db, migrationsDir: migs }))
    .filter((s) => s.status === 'applied').map((s) => s.id);
  assert.strictEqual(beforeApplied.length, 1, 'fixture must leave migrations pending');

  // Owner decision 2026-07-30: a behind-tip operational database enters
  // health-only mode rather than refusing to boot. The safety property is
  // unchanged — zero migrations run and the database is untouched — but the
  // administrator can still reach diagnostics.
  const report = await enforceStartupMigrationPolicy(db, {
    env: {},
    migrationStatus: (o) => migrationStatus({ ...o, migrationsDir: migs }),
    runMigrations: (o) => runMigrations({ ...o, migrationsDir: migs }),
  });

  assert.strictEqual(report.healthOnly, true, 'operational database with pending migrations must enter health-only mode');
  assert.strictEqual(report.mode, 'health_only');
  assert.strictEqual(report.pendingCount, 2);
  assert.strictEqual(report.restartRequiredAfterResolution, true);
  assert.deepStrictEqual(report.migrationsApplied, [], 'health-only must apply zero migrations');

  assert.strictEqual(fileHash(db), beforeHash, 'health-only startup must not modify the database');
  const afterApplied = (await migrationStatus({ dbPath: db, migrationsDir: migs }))
    .filter((s) => s.status === 'applied').map((s) => s.id);
  assert.deepStrictEqual(afterApplied, beforeApplied, 'migration ledger must be unchanged');

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(migs, { recursive: true, force: true });
  console.log('PASS: operationalBehindEntersHealthOnlyAndChangesNothing');
}

async function testDisposableAutoMigrates() {
  const dir = tmpDir('disposable');
  const db = path.join(dir, 'staged-disposable.db');
  const migs = writeFixtureMigrations();
  fs.writeFileSync(db, ''); // create so the marker can be written
  fs.rmSync(db);
  await runMigrations({ dbPath: db, direction: 'up', migrationsDir: migs, steps: null });
  await runMigrations({ dbPath: db, direction: 'down', migrationsDir: migs, steps: 2 });
  markStaged(db);

  const report = await enforceStartupMigrationPolicy(db, {
    env: { OCTAGON_DISPOSABLE_FIXTURE: '1' },
    migrationStatus: (o) => migrationStatus({ ...o, migrationsDir: migs }),
    runMigrations: (o) => runMigrations({ ...o, migrationsDir: migs }),
  });

  assert.strictEqual(report.databaseClass, DATABASE_CLASS.STAGED_CLONE);
  assert.strictEqual(report.mode, 'apply');
  assert.strictEqual(report.migrationsApplied.length, 2, 'disposable fixtures still auto-migrate');

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(migs, { recursive: true, force: true });
  console.log('PASS: disposableAutoMigrates');
}

async function testUnknownIdentityRefuses() {
  const dir = tmpDir('unknown');
  const db = path.join(dir, 'someapp.db');
  const migs = writeFixtureMigrations();
  await runMigrations({ dbPath: db, direction: 'up', migrationsDir: migs });
  await runMigrations({ dbPath: db, direction: 'down', migrationsDir: migs, steps: 1 });

  const c = classifyDatabase(db, {});
  assert.strictEqual(c.class, DATABASE_CLASS.UNKNOWN);

  await assert.rejects(
    () =>
      enforceStartupMigrationPolicy(db, {
        env: {},
        migrationStatus: (o) => migrationStatus({ ...o, migrationsDir: migs }),
        runMigrations: (o) => runMigrations({ ...o, migrationsDir: migs }),
      }),
    (err) => err.code === 'OPERATIONAL_MIGRATION_AUTHORIZATION_REQUIRED',
    'unknown database identity must fail closed'
  );

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(migs, { recursive: true, force: true });
  console.log('PASS: unknownIdentityRefuses');
}

async function testEnvironmentVariableAloneCannotAuthorise() {
  const dir = tmpDir('env-only');
  const db = path.join(dir, 'database.db'); // operational basename, temp directory

  // Every flag an over-eager caller might set. None may promote an operational
  // database to auto-migrating.
  const hostileEnv = {
    OCTAGON_DISPOSABLE_FIXTURE: '1',
    NODE_ENV: 'development',
    OCTAGON_DEV_AUTO_MIGRATE: '1',
  };

  const c = classifyDatabase(db, hostileEnv);
  assert.strictEqual(c.class, DATABASE_CLASS.OPERATIONAL, 'operational basename wins over every environment flag');

  const decision = resolveStartupMigrationPolicy(db, { env: hostileEnv, pendingCount: 5 });
  // The safety property is autoMigrate=false. The mode is health_only since the
  // owner chose a restricted diagnostic runtime over a hard stop.
  assert.strictEqual(decision.autoMigrate, false, 'no environment flag may enable auto-migration on an operational database');
  assert.strictEqual(decision.mode, 'health_only');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('PASS: environmentVariableAloneCannotAuthorise');
}

async function testOperationalBasenameInTempIsStillOperational() {
  const dir = tmpDir('temp-op');
  const db = path.join(dir, 'database.db');
  // A production file copied to /tmp is the exact case that must not auto-migrate.
  assert.strictEqual(classifyDatabase(db, { OCTAGON_DISPOSABLE_FIXTURE: '1' }).class, DATABASE_CLASS.OPERATIONAL);

  // ...unless it proves disposability from its own contents.
  const marked = path.join(dir, 'database.db');
  markStaged(marked);
  assert.strictEqual(classifyDatabase(marked, {}).class, DATABASE_CLASS.STAGED_CLONE);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('PASS: operationalBasenameInTempIsStillOperational');
}

async function testProductionClassification() {
  const dir = tmpDir('prod');
  const db = path.join(dir, 'anything.db');
  assert.strictEqual(classifyDatabase(db, { NODE_ENV: 'production' }).class, DATABASE_CLASS.PRODUCTION);
  const decision = resolveStartupMigrationPolicy(db, { env: { NODE_ENV: 'production' }, pendingCount: 3 });
  assert.strictEqual(decision.autoMigrate, false, 'production must never auto-migrate');
  assert.strictEqual(decision.mode, 'health_only');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('PASS: productionClassification');
}

async function testDevelopmentDefaultsToStatusOnly() {
  const dir = tmpDir('dev');
  const db = path.join(dir, 'devdata.db');
  const off = resolveStartupMigrationPolicy(db, { env: { NODE_ENV: 'development' }, pendingCount: 2 });
  assert.strictEqual(off.autoMigrate, false, 'development defaults to status-only');
  assert.strictEqual(off.mode, 'status_only');

  const on = resolveStartupMigrationPolicy(db, {
    env: { NODE_ENV: 'development', OCTAGON_DEV_AUTO_MIGRATE: '1' },
    pendingCount: 2,
  });
  assert.strictEqual(on.autoMigrate, true, 'explicit dev opt-in is honoured');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('PASS: developmentDefaultsToStatusOnly');
}

async function testServerBootstrapUsesPolicyAuthority() {
  // The incident was caused by server.js calling runMigrations directly. Assert
  // the bootstrap now goes through the policy authority and no longer contains an
  // unguarded up-migration call.
  const server = fs.readFileSync(path.resolve('server.js'), 'utf8');

  assert.ok(
    server.includes('enforceStartupMigrationPolicy'),
    'server bootstrap must call the startup migration policy authority'
  );

  // Strip comments before scanning: the incident write-up in server.js quotes the
  // old call verbatim, and a prose mention is not a call site.
  // Normalise line endings first: with CRLF, `//.*$` cannot match because `.`
  // stops at the \r and `$` never lands, so comments survive stripping and the
  // incident write-up quoting the old call is mistaken for a real call site.
  const code = server
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
    .join('\n');

  const unguarded = code.match(/runMigrations\(\s*\{[^}]*direction:\s*'up'[^}]*\}\s*\)/g) || [];
  assert.strictEqual(
    unguarded.length,
    0,
    `server.js must not call runMigrations({direction:'up'}) directly; found ${unguarded.length}`
  );

  // Documentation must match behaviour — the old comment claimed a bounded suite.
  assert.ok(
    !/apply the canonical migration suite \(001[–-]012\)/.test(server),
    'stale comment claiming a bounded 001-012 suite must not remain'
  );

  console.log('PASS: serverBootstrapUsesPolicyAuthority');
}

async function testRealChainOperationalRefusalAtTip045Shape() {
  // Reproduce the incident shape with the REAL migration chain on a disposable
  // database that carries the operational basename: a database behind the
  // repository tip must refuse rather than migrate.
  const dir = tmpDir('real-chain');
  const build = path.join(dir, 'build.db');
  const db = path.join(dir, 'database.db');
  await freshInstall({ dbPath: build });
  await runMigrations({ dbPath: build, direction: 'down', steps: 17 });
  fs.renameSync(build, db);

  const status = await migrationStatus({ dbPath: db });
  const pending = status.filter((s) => s.status !== 'applied');
  assert.strictEqual(pending.length, 17, 'fixture must be 17 migrations behind, as the operational database was');

  const beforeHash = fileHash(db);
  const report = await enforceStartupMigrationPolicy(db, { env: {}, migrationStatus, runMigrations });

  // The incident scenario: before the fix this silently migrated. Now it enters
  // health-only mode and applies nothing.
  assert.strictEqual(report.healthOnly, true, 'the exact incident scenario must enter health-only mode');
  assert.strictEqual(report.pendingCount, 17);
  assert.deepStrictEqual(report.migrationsApplied, [], 'zero migrations may be applied');
  assert.strictEqual(fileHash(db), beforeHash, 'health-only startup must leave the database untouched');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('PASS: realChainOperationalRefusalAtTip045Shape (17 pending, refused, unchanged)');
}

async function main() {
  await testOperationalAtTipStartsWithoutWriting();
  await testOperationalBehindRefusesAndChangesNothing();
  await testDisposableAutoMigrates();
  await testUnknownIdentityRefuses();
  await testEnvironmentVariableAloneCannotAuthorise();
  await testOperationalBasenameInTempIsStillOperational();
  await testProductionClassification();
  await testDevelopmentDefaultsToStatusOnly();
  await testServerBootstrapUsesPolicyAuthority();
  await testRealChainOperationalRefusalAtTip045Shape();
  console.log('\nAll startup migration policy tests passed.');
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exitCode = 1;
});
