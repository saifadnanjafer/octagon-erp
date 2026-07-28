// Checkpoint H — Release Health diagnostics.
//
// Closes Checkpoint G blocker 6.
//
// The point of these tests is not that the report renders. It is that the
// report cannot LIE. The failure mode a release dashboard has is showing green
// for something nobody checked, which converts an open question into false
// confidence. So the assertions here are mostly negative: PostgreSQL runtime
// must never be healthy, the opening-inventory gate must stay blocked, an
// un-activated cutover must not read as healthy, and a signal that cannot be
// computed must say `unknown` rather than defaulting to green.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, before, after } from 'node:test';

import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createCanonicalCutoverController } from '../../platform/cutover/canonical-cutover-controller.mjs';
import { buildReleaseHealth, STATUS, RELEASE_HEALTH_SIGNAL_IDS } from '../../platform/operations/release-health.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DISPOSABLE_ENV = { OCTAGON_DISPOSABLE_FIXTURE: '1', OCTAGON_RUNTIME_MODE: 'test' };

let tempDir;
let dbPath;
let db;

const byId = (report, id) => report.signals.find((s) => s.id === id);

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-ckh-health-'));
  dbPath = path.join(tempDir, 'health.db');
  await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'checkpoint-h' });
  db = openMigrationDatabase(dbPath);
});

after(() => {
  try { db?.close(); } catch {}
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
});

test('every declared signal is present in the report', () => {
  const report = buildReleaseHealth({ dialect: db, dbPath, root: ROOT, env: DISPOSABLE_ENV });
  const ids = report.signals.map((s) => s.id);
  const missing = RELEASE_HEALTH_SIGNAL_IDS.filter((id) => !ids.includes(id));
  assert.deepEqual(missing, [], `signals declared but not reported: ${missing.join(', ')}`);
  assert.equal(ids.length, new Set(ids).size, 'a signal is reported twice');
});

test('every signal carries an explicit status from the allowed set', () => {
  const report = buildReleaseHealth({ dialect: db, dbPath, root: ROOT, env: DISPOSABLE_ENV });
  const allowed = new Set(Object.values(STATUS));
  for (const s of report.signals) {
    assert.ok(allowed.has(s.status), `signal ${s.id} has invalid status '${s.status}'`);
  }
});

test('PostgreSQL runtime is NEVER reported healthy', () => {
  // The single most important negative assertion in this suite.
  const report = buildReleaseHealth({ dialect: db, dbPath, root: ROOT, env: DISPOSABLE_ENV });
  const runtime = byId(report, 'postgres_runtime');
  assert.equal(runtime.status, STATUS.NOT_EXECUTED,
    'PostgreSQL runtime reported as something other than not_executed');
  assert.notEqual(runtime.status, STATUS.HEALTHY);
  assert.match(runtime.detail, /never executed/i);

  // And it must not inherit green from the adapter being implemented.
  const adapter = byId(report, 'postgres_adapter');
  assert.equal(adapter.status, STATUS.HEALTHY);
  assert.notEqual(adapter.status, runtime.status, 'adapter and runtime collapsed into one signal');
});

test('the opening-inventory gate stays blocked', () => {
  const report = buildReleaseHealth({ dialect: db, dbPath, root: ROOT, env: DISPOSABLE_ENV });
  const gate = byId(report, 'opening_inventory_gate');
  assert.equal(gate.status, STATUS.BLOCKED, 'the opening-inventory gate is not reported as blocked');
  assert.equal(gate.value, 'unresolved');
});

test('production cutover approval is reported as blocked while no approval exists', () => {
  const report = buildReleaseHealth({ dialect: db, dbPath, root: ROOT, env: DISPOSABLE_ENV });
  const approval = byId(report, 'production_cutover_approval');
  assert.equal(approval.value, 0, 'an approval record exists on a fresh install');
  assert.equal(approval.status, STATUS.BLOCKED, 'fail-closed production gate not reported as blocked');
});

test('an un-activated cutover reports warning, not healthy', () => {
  const report = buildReleaseHealth({ dialect: db, dbPath, root: ROOT, env: DISPOSABLE_ENV });
  const mode = byId(report, 'canonical_cutover_mode');
  assert.equal(mode.value, 'not_activated');
  assert.equal(mode.status, STATUS.WARNING, 'a database with live legacy writers reported healthy');
  assert.match(mode.detail, /legacy writers remain live/i);

  // FINANCE is enforced unconditionally since Phase 03, so the floor is 1/14,
  // not 0/14 — the other thirteen are what the cutover controls.
  const locks = byId(report, 'domain_lock_state');
  assert.equal(locks.status, STATUS.WARNING);
  const [enforcedBefore, totalBefore] = locks.value.split('/').map(Number);
  assert.equal(enforcedBefore, 1, `expected only FINANCE enforced, got ${locks.value}`);
  assert.ok(totalBefore > 1);

  const writers = byId(report, 'writer_conflicts');
  assert.equal(writers.status, STATUS.WARNING);
  assert.ok(writers.value > 0, 'writer conflicts reported as zero while nothing is enforced');
});

test('after cutover the same signals flip to healthy — the report tracks reality', () => {
  createCanonicalCutoverController({ dialect: db, dbPath, env: DISPOSABLE_ENV })
    .activateAll({ actor: 'checkpoint-h-health' });

  const report = buildReleaseHealth({ dialect: db, dbPath, root: ROOT, env: DISPOSABLE_ENV });
  assert.equal(byId(report, 'canonical_cutover_mode').value, 'active');
  assert.equal(byId(report, 'canonical_cutover_mode').status, STATUS.HEALTHY);

  const locks = byId(report, 'domain_lock_state');
  assert.equal(locks.status, STATUS.HEALTHY, `domain locks not healthy after cutover: ${locks.value}`);
  const [enforced, total] = locks.value.split('/').map(Number);
  assert.equal(enforced, total, `only ${enforced}/${total} domains enforced`);

  assert.equal(byId(report, 'writer_conflicts').value, 0, 'writer conflicts remain after full cutover');
  assert.equal(byId(report, 'authority_conflicts').status, STATUS.HEALTHY);

  // Still must not go green on the things nobody proved.
  assert.equal(byId(report, 'postgres_runtime').status, STATUS.NOT_EXECUTED);
  assert.equal(byId(report, 'opening_inventory_gate').status, STATUS.BLOCKED);
});

test('build metadata is read from real git refs, not invented', () => {
  const report = buildReleaseHealth({ dialect: db, dbPath, root: ROOT, env: DISPOSABLE_ENV });
  const sha = byId(report, 'commit_sha');
  if (sha.status === STATUS.HEALTHY) {
    assert.match(sha.value, /^[0-9a-f]{40}$/, `commit sha is not a real sha: ${sha.value}`);
  } else {
    assert.equal(sha.status, STATUS.UNKNOWN, 'unreadable git refs must be unknown, not healthy');
  }

  const branch = byId(report, 'branch');
  assert.ok([STATUS.HEALTHY, STATUS.UNKNOWN].includes(branch.status));
});

test('audit health reflects the real registry', () => {
  const report = buildReleaseHealth({ dialect: db, dbPath, root: ROOT, env: DISPOSABLE_ENV });
  const audit = byId(report, 'audit_health');
  assert.equal(audit.status, STATUS.HEALTHY);
  assert.match(audit.value, /^\d+ actions, 0 without required audit$/, `unexpected audit value: ${audit.value}`);
});

test('the shipped test fixture is surfaced as a warning, not hidden', () => {
  const report = buildReleaseHealth({ dialect: db, dbPath, root: ROOT, env: DISPOSABLE_ENV });
  const fixture = byId(report, 'test_fixtures_in_release');
  assert.equal(fixture.value, 1, 'checkpoint_c_test_module is no longer enabled — update this expectation');
  assert.equal(fixture.status, STATUS.WARNING, 'a test fixture shipping enabled was not surfaced as a warning');
});

test('a signal that cannot be computed reports unknown rather than green', () => {
  // Simulate an unreadable ledger by pointing at a database with no tables.
  const emptyPath = path.join(tempDir, 'empty.db');
  fs.writeFileSync(emptyPath, '');
  const empty = openMigrationDatabase(emptyPath);
  try {
    const report = buildReleaseHealth({ dialect: empty, dbPath: emptyPath, root: ROOT, env: DISPOSABLE_ENV });
    // Signals with no readable source must be unknown.
    for (const id of ['migration_tip', 'enabled_modules', 'session_health']) {
      const s = byId(report, id);
      assert.equal(s.status, STATUS.UNKNOWN, `${id} reported '${s.status}' against an empty database instead of unknown`);
    }
    // The ledger table is created on open, so the count is KNOWN to be 0 — but
    // an unmigrated database must never read as healthy.
    const applied = byId(report, 'applied_migration_count');
    assert.equal(applied.value, 0);
    assert.equal(applied.status, STATUS.BLOCKED,
      `an unmigrated database reported applied_migration_count as '${applied.status}'`);
    assert.notEqual(report.overall, STATUS.HEALTHY, 'an unreadable database rolled up to healthy');
  } finally {
    empty.close();
  }
});

test('the overall rollup is blocked when any signal is blocked', () => {
  const report = buildReleaseHealth({ dialect: db, dbPath, root: ROOT, env: DISPOSABLE_ENV });
  const blocked = report.signals.filter((s) => s.status === STATUS.BLOCKED);
  assert.ok(blocked.length > 0, 'expected at least the opening-inventory gate to be blocked');
  assert.equal(report.overall, STATUS.BLOCKED,
    `rollup is '${report.overall}' despite ${blocked.length} blocked signals: ${blocked.map((s) => s.id).join(', ')}`);
});
