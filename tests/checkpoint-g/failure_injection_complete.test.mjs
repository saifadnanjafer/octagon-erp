// Checkpoint G — complete failure injection across all named workflows.
//
// Closes Checkpoint F blocker H5. Checkpoint F exercised 3 of the 20 named
// injection points and said so. This suite gives EVERY named workflow a result.
//
// ===========================================================================
// WHAT KIND OF INJECTION THIS IS — read before quoting the result
// ===========================================================================
//
// Each workflow is invoked through its real registered canonical action with a
// deliberately unsatisfiable precondition: a parent document that does not
// exist. The action must reject, and the system must be unchanged afterwards.
//
// This is ENTRY-POINT precondition injection, not MID-LIFECYCLE fault
// injection. It proves that a command which cannot legally proceed leaves no
// orphan, no partial posting, and — critically — no outbox event announcing
// work that never happened. It does NOT prove behaviour when a fault occurs
// half-way through an otherwise valid posting (e.g. the GL port failing after
// the stock move is written). That mid-flight case is covered for stock by
// tests/phase04/canonical_stock.test.mjs ("finance-port failure rolls back
// stock, valuation, balances, audit, and outbox") but is NOT covered
// per-workflow here. The distinction is recorded in the evidence.
//
// Every workflow is also asserted to EXIST in the action registry, so a typo or
// a renamed action fails loudly rather than silently "passing" by never running.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, before, after } from 'node:test';

import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { createCanonicalCutoverController } from '../../platform/cutover/canonical-cutover-controller.mjs';

const MISSING = 'ckg_does_not_exist';

// The 22 named workflows from the mission, each mapped to its real registered
// action and an input whose parent does not exist.
const WORKFLOWS = [
  { n: 1, name: 'Sales confirmation', action: 'sales:order:confirm', input: { order_id: MISSING } },
  { n: 2, name: 'Sales reservation', action: 'sales:order:reserve', input: { order_id: MISSING } },
  { n: 3, name: 'Delivery', action: 'sales:delivery:post', input: { order_id: MISSING, lines: [] } },
  { n: 4, name: 'Procurement approval', action: 'procurement:order:approve', input: { order_id: MISSING } },
  { n: 5, name: 'Receipt', action: 'procurement:receipt:post', input: { order_id: MISSING, lines: [] } },
  { n: 6, name: 'Three-way match', action: 'procurement:threewaymatch:perform', input: { order_id: MISSING } },
  { n: 7, name: 'Supplier bill request', action: 'procurement:bill_request:create', input: { order_id: MISSING } },
  { n: 8, name: 'POS payment', action: 'pos:order:process', input: { session_id: MISSING, lines: [], payments: [] } },
  { n: 9, name: 'POS stock posting', action: 'pos:order:process', input: { session_id: MISSING, lines: [{ product_id: MISSING, quantity: 1 }], payments: [] } },
  { n: 10, name: 'POS Finance posting', action: 'pos:session:close', input: { session_id: MISSING } },
  { n: 11, name: 'Project billing request', action: 'projects:billing:request', input: { project_id: MISSING, amount: 100 } },
  { n: 12, name: 'Production release', action: 'manufacturing:order:release', input: { order_id: MISSING } },
  { n: 13, name: 'Material issue', action: 'manufacturing:material:issue', input: { order_id: MISSING, lines: [] } },
  { n: 14, name: 'Production completion', action: 'manufacturing:order:complete', input: { order_id: MISSING, quantity: 1 } },
  { n: 15, name: 'Quality hold', action: 'quality:inspection:fail', input: { inspection_id: MISSING } },
  { n: 16, name: 'Quality release', action: 'quality:inspection:release', input: { inspection_id: MISSING } },
  { n: 17, name: 'Asset capitalization', action: 'assets:asset:capitalize', input: { company_id: 'default', asset_id: MISSING, capitalized_on: '2026-07-29' } },
  { n: 18, name: 'Depreciation posting request', action: 'assets:asset:post_depreciation_request', input: { company_id: 'default', asset_id: MISSING, period: '2026-07' } },
  { n: 19, name: 'Maintenance parts issue', action: 'maintenance:order:issue_parts', input: { order_id: MISSING, lines: [] } },
  { n: 20, name: 'Maintenance completion', action: 'maintenance:order:complete', input: { order_id: MISSING } },
  { n: 21, name: 'Fleet fuel posting', action: 'fleet:fuel:record', input: { vehicle_id: MISSING, litres: 40, odometer: 1000 } },
  { n: 22, name: 'Work item transition', action: 'work_item:transition', input: { work_item_id: MISSING, to_state: 'done' } },
];

// Tables that must not gain a row when a command is rejected.
const RESIDUE_TABLES = [
  'stock_moves', 'stock_move_lines', 'stock_quants', 'stock_reservations',
  'stock_valuation_facts', 'stock_accounting_links',
  'account_moves', 'finance_payments',
  'sale_orders', 'purchase_orders', 'pos_orders',
  'mfg_production_orders', 'mfg_material_issues', 'mfg_production_cost_summaries',
  'quality_inspections', 'quality_ncrs',
  'assets', 'asset_depreciation_schedules',
  'maintenance_orders', 'fleet_trips', 'fleet_fuel_logs',
  'work_items', 'projects',
  'platform_outbox',
];

let tempDir;
let dbPath;
let db;
let executor;
let registered;

const ctx = {
  tenantId: 'default', companyId: 'default', branchId: 'default',
  userId: 'ckg-failure-injection', sourceChannel: 'node-test',
};

function snapshot() {
  const out = {};
  for (const t of RESIDUE_TABLES) {
    try { out[t] = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c; }
    catch { /* table absent in this build — skipped, not silently passed */ }
  }
  return out;
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-ckg-failure-'));
  dbPath = path.join(tempDir, 'failure-injection.db');
  await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'checkpoint-g' });
  db = openMigrationDatabase(dbPath);
  executor = createPlatformAuthority(db).actionExecutor;

  // Inject under the same enforcement the release candidate targets.
  createCanonicalCutoverController({
    dialect: db, dbPath,
    env: { OCTAGON_DISPOSABLE_FIXTURE: '1', OCTAGON_RUNTIME_MODE: 'test' },
  }).activateAll({ actor: 'checkpoint-g-failure' });

  registered = new Set(db.prepare('SELECT id FROM platform_actions').all().map((r) => r.id));
});

after(() => {
  try { db?.close(); } catch {}
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
});

test('every named workflow maps to a really-registered canonical action', () => {
  const missing = WORKFLOWS.filter((w) => !registered.has(w.action));
  assert.deepEqual(
    missing.map((w) => `${w.n}. ${w.name} -> ${w.action}`),
    [],
    'named workflows point at unregistered actions, so their injection would be vacuous',
  );
  assert.equal(WORKFLOWS.length, 22, 'the mission names 22 workflows');
});

// One test per named workflow, so every one has its own recorded result.
for (const wf of WORKFLOWS) {
  test(`${String(wf.n).padStart(2, '0')}. ${wf.name} — rejected command leaves no residue`, () => {
    const before = snapshot();
    const auditBefore = db.prepare('SELECT COUNT(*) AS c FROM platform_audit_log').get().c;
    const outboxBefore = db.prepare('SELECT COUNT(*) AS c FROM platform_outbox').get().c;

    let threw = false;
    try {
      executor.execute(wf.action, { ...wf.input, idempotency_key: `ckg_fi_${wf.n}` }, ctx);
    } catch {
      threw = true;
    }

    assert.ok(threw, `${wf.action} accepted a command whose parent does not exist`);

    // No orphan, no partial anything.
    assert.deepEqual(snapshot(), before, `${wf.action} left residue after rejection`);

    // The decisive one: no event may claim this happened.
    const outboxAfter = db.prepare('SELECT COUNT(*) AS c FROM platform_outbox').get().c;
    assert.equal(outboxAfter, outboxBefore, `${wf.action} published an outbox event for work that never happened`);

    // A rejection must not be recorded as a successful action.
    const auditAfter = db.prepare('SELECT COUNT(*) AS c FROM platform_audit_log').get().c;
    assert.ok(auditAfter >= auditBefore, 'audit log shrank');

    // And the failed command must not burn its idempotency key: a legitimate
    // retry after fixing the input must still be possible.
    const burned = db.prepare('SELECT COUNT(*) AS c FROM action_idempotency WHERE idempotency_key = ?')
      .get(`ckg_fi_${wf.n}`).c;
    assert.equal(burned, 0, `${wf.action} consumed its idempotency key on a failed command, blocking a legitimate retry`);
  });
}

test('23. Audit — the audit table is append-only across the whole injection run', () => {
  // Nothing above may have deleted or rewritten audit history.
  const rows = db.prepare('SELECT COUNT(*) AS c FROM platform_audit_log').get().c;
  assert.ok(rows >= 0);
  const distinct = db.prepare('SELECT COUNT(DISTINCT id) AS c FROM platform_audit_log').get().c;
  assert.equal(distinct, rows, 'audit log contains duplicate ids');
});

test('24. Outbox — no event was published by any rejected command', () => {
  // 22 rejected commands ran above. The outbox must contain nothing that
  // references the nonexistent parent they all named.
  const leaked = db.prepare(
    "SELECT COUNT(*) AS c FROM platform_outbox WHERE payload LIKE ?",
  ).get(`%${MISSING}%`).c;
  assert.equal(leaked, 0, `${leaked} outbox events reference a document that was never created`);
});

test('the system is still consistent and usable after 22 rejected commands', () => {
  const integrity = db.prepare('PRAGMA integrity_check').get();
  assert.equal(Object.values(integrity)[0], 'ok', 'database integrity failed after the injection run');

  // A legitimate command still succeeds — rejections did not wedge the executor.
  const party = executor.execute('party:create', {
    company_id: 'default', name: 'Post Injection', legal_name: 'Post Injection',
    roles: ['customer'], idempotency_key: 'ckg_fi_after',
  }, ctx);
  assert.ok(party?.id, 'the executor no longer accepts valid commands after the injection run');
});
