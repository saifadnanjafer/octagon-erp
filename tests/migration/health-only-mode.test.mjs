// Health-only mode — owner-selected behaviour for an operational database with
// pending migrations (Checkpoint I1D-5).
//
// Instead of refusing to boot, Octagon starts a restricted diagnostic runtime:
// the administrator can authenticate and read migration readiness, and every
// business route is closed. This file proves the allowlist is default-deny, that
// diagnostics are withheld from anonymous and non-admin callers, and that the
// mode cannot be cleared without a process restart.
//
// No operational database is opened. All database work uses disposable files.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { migrationStatus, runMigrations, freshInstall } from '../../database/migration-runner/index.mjs';
import { enforceStartupMigrationPolicy, resolveStartupMigrationPolicy } from '../../database/migration-runner/startup-policy.mjs';
import {
  activateHealthOnlyMode,
  isHealthOnlyActive,
  evaluateHealthOnlyRequest,
  healthOnlyDenialBody,
  publicModePayload,
  migrationReadinessPayload,
  getHealthOnlyState,
  __resetHealthOnlyModeForTests,
  HEALTH_ONLY_DENIAL_CODE,
} from '../../platform/operations/health-only-mode.mjs';

const OWNER = { id: 'system_admin', login: 'system_admin', isOwner: true };
const RESTRICTED = { id: 'viewer_user', login: 'viewer_user', isOwner: false };
const ANON = null;

function tmpDir(p) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `octagon-honly-${p}-`));
}

function activateForTests(pending = ['061_x', '062_y']) {
  activateHealthOnlyMode({
    reason: 'pending migrations require authorization',
    databaseClass: 'operational',
    appliedTip: '060_prev',
    repositoryTip: pending[pending.length - 1],
    pendingCount: pending.length,
    pendingMigrations: pending,
    enteredAt: '2026-07-30T00:00:00.000Z',
  });
}

// ---------------------------------------------------------------------------

async function testInactiveByDefaultAllowsEverything() {
  __resetHealthOnlyModeForTests();
  assert.strictEqual(isHealthOnlyActive(), false);
  for (const [m, p] of [['GET', '/api/inventory/items'], ['POST', '/api/db'], ['GET', '/anything']]) {
    assert.strictEqual(evaluateHealthOnlyRequest(m, p, ANON).allowed, true, `${m} ${p} must pass when inactive`);
  }
  console.log('PASS: inactiveByDefaultAllowsEverything');
}

async function testAllowlistedRoutes() {
  __resetHealthOnlyModeForTests();
  activateForTests();

  const allowedForAnyone = [
    ['GET', '/api/auth/session'],
    ['POST', '/api/auth/login'],
    ['POST', '/api/auth/logout'],
    ['GET', '/'],
    ['GET', '/index.html'],
    ['GET', '/health-only.html'],
    ['GET', '/style.css'],
  ];
  for (const [m, p] of allowedForAnyone) {
    const v = evaluateHealthOnlyRequest(m, p, ANON);
    assert.strictEqual(v.allowed, true, `${m} ${p} must be allowed`);
  }

  // Diagnostics require administrative authority.
  for (const [m, p] of [['GET', '/api/release/health'], ['GET', '/api/migration/readiness']]) {
    assert.strictEqual(evaluateHealthOnlyRequest(m, p, OWNER).allowed, true, `${m} ${p} allowed for owner`);
    const anon = evaluateHealthOnlyRequest(m, p, ANON);
    assert.strictEqual(anon.allowed, false, `${m} ${p} denied for anonymous`);
    assert.strictEqual(anon.code, 'HEALTH_ONLY_ADMIN_REQUIRED');
    const restricted = evaluateHealthOnlyRequest(m, p, RESTRICTED);
    assert.strictEqual(restricted.allowed, false, `${m} ${p} denied for restricted user`);
  }

  console.log('PASS: allowlistedRoutes');
}

async function testBusinessRoutesDeniedDefaultDeny() {
  __resetHealthOnlyModeForTests();
  activateForTests();

  const denied = [
    ['GET', '/api/inventory/items'],
    ['POST', '/api/inventory/receipt'],
    ['GET', '/api/finance/accounts'],
    ['POST', '/api/finance/post'],
    ['POST', '/api/db'],                     // generic legacy writer
    ['POST', '/api/collection/products'],    // generic legacy writer
    ['POST', '/api/record'],                 // generic legacy writer
    ['POST', '/api/actions/execute'],        // canonical action execution
    ['POST', '/api/cutover/activate'],       // cutover action
    ['GET', '/api/projects'],
    ['GET', '/api/payroll/periods'],
    ['GET', '/some/unknown/route'],          // fall-through must deny, not allow
    ['PUT', '/api/auth/login'],              // right path, wrong method
  ];

  for (const [m, p] of denied) {
    const v = evaluateHealthOnlyRequest(m, p, OWNER);
    assert.strictEqual(v.allowed, false, `${m} ${p} must be denied even for the owner`);
    assert.strictEqual(v.code, HEALTH_ONLY_DENIAL_CODE, `${m} ${p} must use the stable denial code`);
    assert.strictEqual(v.status, 503);
  }

  console.log(`PASS: businessRoutesDeniedDefaultDeny (${denied.length} routes)`);
}

async function testOwnerCannotMutateInHealthOnlyMode() {
  __resetHealthOnlyModeForTests();
  activateForTests();
  // Authority does not grant business access in this mode.
  for (const [m, p] of [['POST', '/api/db'], ['POST', '/api/actions/execute'], ['POST', '/api/inventory/adjust']]) {
    assert.strictEqual(evaluateHealthOnlyRequest(m, p, OWNER).allowed, false, `owner must not mutate via ${m} ${p}`);
  }
  console.log('PASS: ownerCannotMutateInHealthOnlyMode');
}

async function testAnonymousLearnsNothingSensitive() {
  __resetHealthOnlyModeForTests();
  activateForTests(['061_secret_name', '062_other']);

  const body = healthOnlyDenialBody(ANON);
  const serialised = JSON.stringify(body);

  assert.strictEqual(body.code, HEALTH_ONLY_DENIAL_CODE);
  assert.strictEqual(body.mode, 'health_only');
  for (const leak of ['061_secret_name', '062_other', 'operational', 'currentMigrationTip', 'pendingMigrations', 'database.db']) {
    assert.ok(!serialised.includes(leak), `anonymous denial body must not leak "${leak}"`);
  }

  const pub = publicModePayload();
  const pubSerialised = JSON.stringify(pub);
  assert.strictEqual(pub.available, false);
  for (const leak of ['061_secret_name', 'operational', 'tip']) {
    assert.ok(!pubSerialised.includes(leak), `public payload must not leak "${leak}"`);
  }

  console.log('PASS: anonymousLearnsNothingSensitive');
}

async function testRestrictedUserTreatedAsNonAdmin() {
  __resetHealthOnlyModeForTests();
  activateForTests(['062_y']);
  const body = healthOnlyDenialBody(RESTRICTED);
  assert.ok(!JSON.stringify(body).includes('062_y'), 'restricted user must not receive migration IDs');
  assert.strictEqual(body.currentMigrationTip, undefined);
  console.log('PASS: restrictedUserTreatedAsNonAdmin');
}

async function testAdminReceivesDiagnostics() {
  __resetHealthOnlyModeForTests();
  activateForTests(['061_a', '062_b']);

  const body = healthOnlyDenialBody(OWNER);
  assert.strictEqual(body.currentMigrationTip, '060_prev');
  assert.strictEqual(body.targetMigrationTip, '062_b');
  assert.strictEqual(body.pendingMigrationCount, 2);
  assert.deepStrictEqual(body.pendingMigrations, ['061_a', '062_b']);
  assert.strictEqual(body.restartRequiredAfterResolution, true);

  const readiness = migrationReadinessPayload();
  assert.strictEqual(readiness.healthOnly, true);
  assert.strictEqual(readiness.automaticStartupMigration, 'disabled');
  assert.strictEqual(readiness.operationalMigrationAuthorization, 'required');

  // Diagnostics must never carry credential material.
  const s = JSON.stringify({ body, readiness });
  for (const forbidden of ['password', 'hash', 'salt', 'token', 'cookie', 'secret']) {
    assert.ok(!s.toLowerCase().includes(forbidden), `diagnostics must not contain "${forbidden}"`);
  }

  console.log('PASS: adminReceivesDiagnostics');
}

async function testRestartRequiredToLeaveMode() {
  __resetHealthOnlyModeForTests();
  activateForTests();
  assert.strictEqual(isHealthOnlyActive(), true);

  // There is deliberately no runtime "clear" export. The only public mutator
  // activates the mode; leaving it requires a fresh process.
  const mod = await import('../../platform/operations/health-only-mode.mjs');
  const clearing = Object.keys(mod).filter((k) => /deactivate|clear|disable|exit/i.test(k) && !/ForTests$/.test(k));
  assert.deepStrictEqual(clearing, [], `health-only mode must not expose a runtime clear: found ${clearing.join(', ')}`);

  assert.strictEqual(isHealthOnlyActive(), true, 'mode must still be active');
  assert.strictEqual(getHealthOnlyState().pendingCount, 2);

  console.log('PASS: restartRequiredToLeaveMode');
}

async function testStartupPolicyYieldsHealthOnlyForOperationalBehind() {
  const dir = tmpDir('policy');
  const build = path.join(dir, 'build.db');
  const db = path.join(dir, 'database.db');
  await freshInstall({ dbPath: build });
  await runMigrations({ dbPath: build, direction: 'down', steps: 5 });
  fs.renameSync(build, db);

  const decision = resolveStartupMigrationPolicy(db, { env: {}, pendingCount: 5 });
  assert.strictEqual(decision.mode, 'health_only', 'operational behind tip must enter health-only, not refuse');
  assert.strictEqual(decision.autoMigrate, false, 'health-only must never migrate');

  const before = fs.readFileSync(db);
  const report = await enforceStartupMigrationPolicy(db, { env: {}, migrationStatus, runMigrations });
  assert.strictEqual(report.healthOnly, true);
  assert.strictEqual(report.restartRequiredAfterResolution, true);
  assert.strictEqual(report.pendingCount, 5);
  assert.deepStrictEqual(report.migrationsApplied, [], 'health-only must apply zero migrations');
  assert.deepStrictEqual(fs.readFileSync(db), before, 'health-only startup must not modify the database');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('PASS: startupPolicyYieldsHealthOnlyForOperationalBehind (5 pending, 0 applied, unchanged)');
}

async function testOperationalAtTipStaysNormal() {
  const dir = tmpDir('normal');
  const db = path.join(dir, 'database.db');
  await freshInstall({ dbPath: db });

  const report = await enforceStartupMigrationPolicy(db, { env: {}, migrationStatus, runMigrations });
  assert.notStrictEqual(report.healthOnly, true, 'a current operational database must start normally');
  assert.strictEqual(report.mode, 'status_only');
  assert.strictEqual(report.pendingCount, 0);
  assert.deepStrictEqual(report.migrationsApplied, []);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('PASS: operationalAtTipStaysNormal');
}

async function testUnknownIdentityStillRefusesRatherThanHealthOnly() {
  const dir = tmpDir('unknown');
  const db = path.join(dir, 'mystery.db');
  const decision = resolveStartupMigrationPolicy(db, { env: {}, pendingCount: 3 });
  assert.strictEqual(decision.mode, 'refuse', 'an unclassifiable database must not even reach diagnostics');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('PASS: unknownIdentityStillRefusesRatherThanHealthOnly');
}

async function testServerWiresGateBeforeDomainHandlers() {
  const server = fs.readFileSync(path.resolve('server.js'), 'utf8');

  assert.ok(server.includes('isHealthOnlyActive()'), 'server must consult health-only state');
  assert.ok(server.includes('evaluateHealthOnlyRequest'), 'server must evaluate the allowlist');

  // The gate must precede the first domain handler. jarvisSecurity.handle is the
  // earliest one in the pipeline.
  const gateIdx = server.indexOf('octagonHealthOnly.isHealthOnlyActive()');
  const firstDomainIdx = server.indexOf('jarvisSecurity.handle(req, res, requestUrl)');
  assert.ok(gateIdx > -1 && firstDomainIdx > -1, 'both markers must exist');
  assert.ok(gateIdx < firstDomainIdx, 'health-only gate must run before the first domain handler');

  console.log('PASS: serverWiresGateBeforeDomainHandlers');
}

async function main() {
  await testInactiveByDefaultAllowsEverything();
  await testAllowlistedRoutes();
  await testBusinessRoutesDeniedDefaultDeny();
  await testOwnerCannotMutateInHealthOnlyMode();
  await testAnonymousLearnsNothingSensitive();
  await testRestrictedUserTreatedAsNonAdmin();
  await testAdminReceivesDiagnostics();
  await testRestartRequiredToLeaveMode();
  await testStartupPolicyYieldsHealthOnlyForOperationalBehind();
  await testOperationalAtTipStaysNormal();
  await testUnknownIdentityStillRefusesRatherThanHealthOnly();
  await testServerWiresGateBeforeDomainHandlers();
  console.log('\nAll health-only mode tests passed.');
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exitCode = 1;
});
