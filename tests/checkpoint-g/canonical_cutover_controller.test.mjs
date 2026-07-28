// Checkpoint G — canonical cutover controller and disposable rehearsal.
//
// Closes Checkpoint F blocker C1: canonical authority was registered for every
// domain but enforced for exactly one, and there was no safe mechanism to
// change that.
//
// The tests are ordered as a rehearsal:
//   1. the safety guards refuse activation when any guard fails;
//   2. status and dry run report the true (un-enforced) baseline;
//   3. activation on a proven-disposable database locks every eligible domain;
//   4. the guard the SERVER consults then reports every domain enforced;
//   5. every legacy collection resolves to a now-enforced authority — i.e. the
//      legacy generic writers fail closed;
//   6. activation is idempotent, rollback works, and attempts are audited.
//
// WHAT STEP 4-5 PROVE, PRECISELY. `server.js` decides whether to refuse a
// legacy write with:
//     canonicalAuthorityEnforced(authority)
//       = authority.domain === 'FINANCE'
//         || legacyWriterRetirement.enforced(authority.domain) === true
// where legacyWriterRetirement is createLegacyWriterRetirementGuard(db). These
// tests call that same constructor against the same database, so a true result
// here is the same decision the server would make. This is decision-layer
// proof, not HTTP-transport proof — the HTTP round trip is asserted separately
// by the legacy writer retirement suite.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test, before, after } from 'node:test';

import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createLegacyWriterRetirementGuard, RETIREMENT_LOCKS } from '../../platform/cutover/legacy-writer-retirement.mjs';
import {
  createCanonicalCutoverController,
  assessDatabasePath,
  assessSafetyGuards,
  cutoverDomains,
} from '../../platform/cutover/canonical-cutover-controller.mjs';

const require = createRequire(import.meta.url);
const { canonicalAuthorityForCollection } = require('../../platform/cutover/canonical-authority-map.js');

const DISPOSABLE_ENV = {
  OCTAGON_DISPOSABLE_FIXTURE: '1',
  OCTAGON_RUNTIME_MODE: 'test',
};

let tempDir;
let dbPath;
let db;
let controller;

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-ckg-cutover-'));
  dbPath = path.join(tempDir, 'cutover-rehearsal.db');
  await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'checkpoint-g' });
  db = openMigrationDatabase(dbPath);
  controller = createCanonicalCutoverController({ dialect: db, dbPath, env: DISPOSABLE_ENV });
});

after(() => {
  try { db?.close(); } catch {}
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. Safety guards
// ---------------------------------------------------------------------------

test('the operational database path is refused outright', () => {
  for (const operational of [
    'C:/Users/Zahraa dlbooz/Downloads/odoo-19.0/octagon-erp/database.db',
    '/srv/octagon/database.db',
    './database.json',
  ]) {
    const a = assessDatabasePath(operational);
    assert.equal(a.disposable, false, `${operational} was judged disposable`);
    assert.equal(a.reason, 'OPERATIONAL_DATABASE_PATH');
  }
});

test('a path that cannot be proven disposable fails closed', () => {
  const a = assessDatabasePath('/var/lib/octagon/production-store.sqlite');
  assert.equal(a.disposable, false);
  assert.equal(a.reason, 'NOT_PROVABLY_DISPOSABLE');
});

test('each safety guard independently blocks activation', () => {
  const cases = [
    { env: { OCTAGON_RUNTIME_MODE: 'test' }, missing: 'disposable_fixture_flag' },
    { env: { OCTAGON_DISPOSABLE_FIXTURE: '1', OCTAGON_RUNTIME_MODE: 'production' }, missing: 'non_production_runtime' },
  ];

  for (const { env, missing } of cases) {
    const s = assessSafetyGuards({ dbPath, env });
    assert.equal(s.allPassed, false, `guards passed with ${missing} unsatisfied`);
    assert.ok(s.failed.includes(missing), `expected ${missing} to fail, got ${s.failed.join(',')}`);
  }

  // Third guard: correct env but an operational path.
  const s3 = assessSafetyGuards({ dbPath: '/srv/octagon/database.db', env: DISPOSABLE_ENV });
  assert.equal(s3.allPassed, false);
  assert.ok(s3.failed.includes('disposable_database_path'));
});

test('activation is refused when the guards fail, and the refusal is audited', () => {
  const unsafe = createCanonicalCutoverController({
    dialect: db, dbPath, env: { OCTAGON_RUNTIME_MODE: 'production' },
  });

  assert.throws(
    () => unsafe.activateDomain('SALES', { actor: 'guard-test' }),
    (err) => err.code === 'CUTOVER_NOT_DISPOSABLE',
    'activation proceeded with failing safety guards',
  );

  const refusals = unsafe.attempts(20).filter((a) => a.result === 'REFUSED');
  assert.ok(refusals.length > 0, 'a refused activation left no audit record');

  // The refusal must not have locked anything.
  const guard = createLegacyWriterRetirementGuard(db);
  assert.equal(guard.enforced('SALES'), false, 'a refused activation still enforced the domain');
});

// ---------------------------------------------------------------------------
// 2. Baseline
// ---------------------------------------------------------------------------

test('status reports the true un-enforced baseline before cutover', () => {
  const s = controller.status();
  assert.equal(s.cutoverFlag, false, 'fresh install already had the cutover flag enabled');
  for (const domain of cutoverDomains()) {
    assert.equal(s.domains[domain].enforced, false, `${domain} enforced before cutover`);
  }
  assert.equal(s.domains.FINANCE.enforced, true, 'FINANCE should already be enforced');
});

test('dry run lists every eligible domain and changes nothing', () => {
  const plan = controller.dryRun();
  assert.equal(plan.mode, 'dry_run');
  assert.deepEqual(plan.blocked, [], `domains blocked from cutover: ${JSON.stringify(plan.blocked)}`);
  assert.deepEqual(
    plan.wouldActivate.slice().sort(),
    cutoverDomains().slice().sort(),
    'dry run does not plan to activate every domain',
  );

  // Still nothing enforced.
  assert.equal(controller.flagEnabled(), false, 'dry run enabled the cutover flag');
});

test('every domain resolves to a registered, enabled canonical target with actions', () => {
  for (const domain of cutoverDomains()) {
    const a = controller.assessDomain(domain);
    assert.deepEqual(a.conflicts, [], `${domain} has conflicts: ${JSON.stringify(a.conflicts)}`);
    assert.ok(a.registeredActions > 0, `${domain} canonical target ${a.canonicalTarget} registers no actions`);
  }
});

// ---------------------------------------------------------------------------
// 3-5. Rehearsal
// ---------------------------------------------------------------------------

test('activateAll locks every eligible domain on the disposable database', () => {
  const result = controller.activateAll({ actor: 'checkpoint-g', reason: 'Checkpoint G disposable rehearsal' });

  assert.deepEqual(result.blocked, [], `domains blocked during activation: ${JSON.stringify(result.blocked)}`);
  assert.deepEqual(
    result.activated.slice().sort(),
    cutoverDomains().slice().sort(),
    'not every domain was activated',
  );
  assert.equal(controller.flagEnabled(), true, 'cutover flag was not enabled by activation');
});

test('the guard the SERVER consults now reports every domain enforced', () => {
  // Same constructor server.js uses, same database.
  const guard = createLegacyWriterRetirementGuard(db);
  assert.equal(guard.cutoverEnabled(), true);

  for (const domain of Object.keys(RETIREMENT_LOCKS)) {
    assert.equal(guard.enforced(domain), true, `${domain} is NOT enforced after cutover — a competing writer remains`);
  }
});

test('every governed legacy collection now maps to an enforced authority', () => {
  // The legacy generic writers refuse a collection when
  // canonicalAuthorityForCollection(col) resolves AND that domain is enforced.
  // Together with the previous test this is the fail-closed proof at the
  // decision layer.
  const guard = createLegacyWriterRetirementGuard(db);
  const governed = [
    'customers', 'suppliers', 'omni.materials', 'contacts',
    'quants', 'stock_moves', 'warehouses', 'locations', 'transfers',
    'salesOrders', 'omni.crm', 'leads',
    'purchaseOrders',
    'posOrders',
    'tasks', 'omni.kanban.cards',
    'omni.projects', 'omni.boms', 'omni.routings',
    'omni.workOrders', 'omni.productionOrders',
    'omni.quality', 'omni.assets', 'omni.maintenance',
    'omni.fleet', 'omni.vehicles',
    'account_moves', 'finance.accounts',
  ];

  const stillWritable = [];
  for (const col of governed) {
    const authority = canonicalAuthorityForCollection(col);
    if (!authority) { stillWritable.push(`${col} (no authority)`); continue; }
    const enforced = authority.domain === 'FINANCE' || guard.enforced(authority.domain);
    if (!enforced) stillWritable.push(`${col} -> ${authority.domain} (not enforced)`);
  }

  assert.deepEqual(stillWritable, [], `legacy generic writers still accept: ${stillWritable.join(', ')}`);
});

test('the frozen zone is NOT captured by the cutover', () => {
  // Cutting over must never start refusing payroll/attendance/timesheet or the
  // workshop job-order chain — those legacy writers are the running business.
  for (const frozen of [
    'employees', 'employee_advances', 'employee_payroll_closings',
    'payroll_payments', 'payroll_periods', 'omni.employeeAttendance',
    'omni.workshopAdvances', 'omni.workshopTimesheetCases', 'omni.jobOrders',
  ]) {
    assert.equal(
      canonicalAuthorityForCollection(frozen),
      null,
      `frozen-zone path '${frozen}' became governed by the cutover`,
    );
  }
});

// ---------------------------------------------------------------------------
// 6. Idempotency, persistence, rollback, audit
// ---------------------------------------------------------------------------

test('re-activating an already-locked domain is idempotent', () => {
  const before = db.prepare('SELECT COUNT(*) AS c FROM authority_retirement_locks').get().c;
  controller.activateDomain('SALES', { actor: 'checkpoint-g' });
  const after = db.prepare('SELECT COUNT(*) AS c FROM authority_retirement_locks').get().c;
  assert.equal(after, before, 're-activation created a duplicate lock row');
});

test('cutover state persists across a reopened database handle', () => {
  db.close();
  db = openMigrationDatabase(dbPath);
  const guard = createLegacyWriterRetirementGuard(db);
  assert.equal(guard.cutoverEnabled(), true, 'cutover flag did not persist');
  for (const domain of Object.keys(RETIREMENT_LOCKS)) {
    assert.equal(guard.enforced(domain), true, `${domain} lock did not persist across reopen`);
  }
  controller = createCanonicalCutoverController({ dialect: db, dbPath, env: DISPOSABLE_ENV });
});

test('re-running migrations leaves the locks and canonical records valid', async () => {
  const { runMigrations } = await import('../../database/migration-runner/index.mjs');
  db.close();
  const result = await runMigrations({ dbPath, direction: 'up', actor: 'checkpoint-g-rerun' });
  assert.deepEqual(result.executed, [], 'a rerun re-executed migrations');

  db = openMigrationDatabase(dbPath);
  const guard = createLegacyWriterRetirementGuard(db);
  for (const domain of Object.keys(RETIREMENT_LOCKS)) {
    assert.equal(guard.enforced(domain), true, `${domain} lost enforcement after a migration rerun`);
  }
  controller = createCanonicalCutoverController({ dialect: db, dbPath, env: DISPOSABLE_ENV });
});

test('rollback of a disposable attempt reopens exactly one domain', () => {
  const rolled = controller.rollbackAttempt('FLEET', { actor: 'checkpoint-g' });
  assert.equal(rolled.enforced, false, 'FLEET remained enforced after rollback');

  const guard = createLegacyWriterRetirementGuard(db);
  assert.equal(guard.enforced('FLEET'), false);
  // Every other domain is untouched.
  for (const domain of Object.keys(RETIREMENT_LOCKS).filter((d) => d !== 'FLEET')) {
    assert.equal(guard.enforced(domain), true, `rollback of FLEET also released ${domain}`);
  }

  // Restore for any later reader.
  controller.activateDomain('FLEET', { actor: 'checkpoint-g' });
  assert.equal(createLegacyWriterRetirementGuard(db).enforced('FLEET'), true);
});

test('every activation attempt is recorded with actor and result', () => {
  const rows = controller.attempts(200);
  assert.ok(rows.length > 0, 'no cutover attempts were audited');

  const results = new Set(rows.map((r) => r.result));
  assert.ok(results.has('ACTIVATED'), 'no ACTIVATED attempt recorded');
  assert.ok(results.has('REFUSED'), 'no REFUSED attempt recorded — guard refusals are not auditable');
  assert.ok(results.has('ROLLED_BACK'), 'no ROLLED_BACK attempt recorded');

  for (const r of rows) {
    assert.ok(r.actor && r.actor !== 'unknown', `attempt ${r.id} has no actor`);
    assert.equal(r.mode, 'disposable', `attempt ${r.id} was not recorded as disposable`);
  }
});

test('production activation remains fail-closed — no approval fact exists', () => {
  const approvals = db.prepare('SELECT COUNT(*) AS c FROM canonical_cutover_approvals').get().c;
  assert.equal(approvals, 0, 'a production cutover approval record exists — production activation is no longer fail-closed');
});
