// Checkpoint F — canonical authority coverage and registry integrity.
//
// Checkpoint D/E delivered seven new business domains with a real canonical
// backend, but nothing asserted that those domains were also *claimed* by the
// legacy-writer strangler. They were not. The result was a domain that looked
// canonical (registered actions, audit, outbox, idempotency) while its legacy
// collections stayed freely writable through POST /api/collection and POST
// /api/record — a competing writer for a canonical fact, which is exactly what
// the release architecture forbids.
//
// These tests close that hole permanently: a future domain cannot ship without
// an authority entry and a retirement lock, because this suite fails.
//
// NOTE ON SCOPE — presence in the authority map is not the same as enforcement.
// These tests assert *coverage and lockability*, which is what code can
// guarantee. Actual enforcement additionally requires the owner-run cutover
// (phase04.canonical_cutover + RETIRED locks) and is asserted, honestly, as
// currently-not-enforced by `records the true enforcement state` below. When
// the owner runs the cutover that test is the one that must be updated.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test, before, after } from 'node:test';

import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import {
  createLegacyWriterRetirementGuard,
  RETIREMENT_LOCKS,
} from '../../platform/cutover/legacy-writer-retirement.mjs';

const require = createRequire(import.meta.url);
const {
  CANONICAL_AUTHORITY_COLLECTIONS,
  canonicalAuthorityForCollection,
} = require('../../platform/cutover/canonical-authority-map.js');

// Every module that owns business facts, and the authority domain that must
// claim its legacy collections. platform_kernel owns no business facts.
const MODULE_TO_AUTHORITY = {
  finance_canonical: 'FINANCE',
  commercial_core: 'COMMERCIAL',
  stock_inventory: 'INVENTORY',
  stock_wms: 'INVENTORY',
  commercial_sales: 'SALES',
  commercial_procurement: 'PROCUREMENT',
  commercial_cutover: 'POS',
  work_item_canonical: 'WORK_ITEM',
  operations_projects: 'PROJECT',
  operations_engineering: 'ENGINEERING',
  operations_mrp: 'ENGINEERING',
  operations_manufacturing: 'MANUFACTURING',
  operations_quality: 'QUALITY',
  assets_management: 'ASSET',
  operations_maintenance: 'MAINTENANCE',
  fleet_telematics: 'FLEET',
};

// Modules that legitimately own no legacy business collection.
const AUTHORITY_EXEMPT_MODULES = new Set([
  'platform_kernel',
  'checkpoint_c_test_module',
]);

// The frozen zone. No canonical authority may claim these paths, because
// claiming them is the first step toward writing them.
const FROZEN_PATHS = [
  'employees',
  'employee_advances',
  'employee_payroll_closings',
  'payroll_payments',
  'payroll_periods',
  'omni.employeeAttendance',
  'omni.workshopAdvances',
  'omni.workshopTimesheetCases',
  'omni.jobOrders',
];

let tempDir;
let db;

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-checkpoint-f-'));
  const dbPath = path.join(tempDir, 'coverage.db');
  await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'checkpoint-f' });
  db = openMigrationDatabase(dbPath);
});

after(() => {
  try { db?.close(); } catch {}
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
});

test('every registered business module is claimed by a canonical authority', () => {
  const modules = db.prepare('SELECT id FROM platform_modules').all().map((r) => r.id);
  assert.ok(modules.length > 0, 'fresh install registered no modules');

  const domains = new Set(CANONICAL_AUTHORITY_COLLECTIONS.map((a) => a.domain));
  const unclaimed = [];

  for (const moduleId of modules) {
    if (AUTHORITY_EXEMPT_MODULES.has(moduleId)) continue;
    const expected = MODULE_TO_AUTHORITY[moduleId];
    // A module nobody mapped is itself the failure: it means a domain shipped
    // and this test was never taught about it.
    assert.ok(expected, `module '${moduleId}' has no declared canonical authority domain`);
    if (!domains.has(expected)) unclaimed.push(`${moduleId} -> ${expected}`);
  }

  assert.deepEqual(unclaimed, [], `modules whose authority domain is missing from the authority map: ${unclaimed.join(', ')}`);
});

test('every canonical authority domain except FINANCE is lockable', () => {
  // FINANCE is enforced unconditionally in server.js and needs no lock row.
  const missing = CANONICAL_AUTHORITY_COLLECTIONS
    .map((a) => a.domain)
    .filter((d) => d !== 'FINANCE')
    .filter((d) => !RETIREMENT_LOCKS[d]);

  assert.deepEqual(missing, [], `authority domains with no retirement lock definition (they could never be retired): ${missing.join(', ')}`);
});

test('the Checkpoint D/E legacy collections resolve to their canonical authority', () => {
  const expectations = {
    'omni.projects': 'PROJECT',
    'omni.boms': 'ENGINEERING',
    'omni.routings': 'ENGINEERING',
    'omni.workOrders': 'MANUFACTURING',
    'omni.productionOrders': 'MANUFACTURING',
    'omni.quality': 'QUALITY',
    'omni.assets': 'ASSET',
    'omni.maintenance': 'MAINTENANCE',
    'omni.fleet': 'FLEET',
    'omni.vehicles': 'FLEET',
  };

  for (const [collection, domain] of Object.entries(expectations)) {
    const authority = canonicalAuthorityForCollection(collection);
    assert.ok(authority, `'${collection}' is claimed by no canonical authority — legacy writes to it are unguarded`);
    assert.equal(authority.domain, domain, `'${collection}' resolved to ${authority.domain}, expected ${domain}`);
  }
});

test('no canonical authority claims a frozen-zone path', () => {
  for (const frozen of FROZEN_PATHS) {
    const authority = canonicalAuthorityForCollection(frozen);
    assert.equal(
      authority,
      null,
      `frozen-zone path '${frozen}' is claimed by ${authority?.domain} — payroll, attendance, timesheet and the workshop job-order chain must stay outside canonical retirement`,
    );
  }
});

test('authority matchers are mutually exclusive', () => {
  // find() returns the first match, so an overlap would silently hand a
  // collection to the wrong authority.
  const allPaths = CANONICAL_AUTHORITY_COLLECTIONS.flatMap((a) => a.paths.map((p) => [p, a.domain]));
  for (const [p, declaredDomain] of allPaths) {
    const resolved = canonicalAuthorityForCollection(p);
    assert.equal(
      resolved?.domain,
      declaredDomain,
      `path '${p}' is declared under ${declaredDomain} but resolves to ${resolved?.domain} — matcher overlap`,
    );
  }
});

test('every registered action has a unique id', () => {
  const dupes = db.prepare('SELECT id, COUNT(*) c FROM platform_actions GROUP BY id HAVING c > 1').all();
  assert.deepEqual(dupes, [], `duplicate action ids: ${dupes.map((d) => d.id).join(', ')}`);
});

test('no entity is owned by more than one module', () => {
  const dupes = db.prepare(`
    SELECT id, COUNT(DISTINCT module_id) m FROM platform_entities GROUP BY id HAVING m > 1
  `).all();
  assert.deepEqual(dupes, [], `entities with competing module ownership: ${dupes.map((d) => d.id).join(', ')}`);
});

test('every governed action writes audit and outbox evidence and is idempotent', () => {
  const noAudit = db.prepare("SELECT id FROM platform_actions WHERE audit_policy != 'required'").all();
  assert.deepEqual(noAudit, [], `actions without required audit: ${noAudit.map((r) => r.id).join(', ')}`);

  const noIdempotency = db.prepare("SELECT id FROM platform_actions WHERE idempotency_policy = 'none'").all();
  assert.deepEqual(noIdempotency, [], `actions with no idempotency policy: ${noIdempotency.map((r) => r.id).join(', ')}`);
});

test('records the true enforcement state of the legacy writer retirement', () => {
  const guard = createLegacyWriterRetirementGuard(db);
  const status = guard.status();

  // Every domain the strangler knows about must be reportable — that is what
  // release health reads.
  assert.deepEqual(
    Object.keys(status).sort(),
    Object.keys(RETIREMENT_LOCKS).sort(),
    'guard.status() does not report every lockable domain',
  );

  // Honest baseline: on a fresh install the cutover has NOT been run, so no
  // domain is enforced and every legacy writer is still live. This is an
  // owner-gated operational step, not a code defect — but it is the reason
  // Checkpoint F cannot certify "no competing writer".
  assert.equal(guard.cutoverEnabled(), false, 'fresh install unexpectedly has phase04.canonical_cutover enabled');
  for (const [domain, state] of Object.entries(status)) {
    assert.equal(state.enforced, false, `${domain} reported as enforced on a fresh install`);
  }
});
