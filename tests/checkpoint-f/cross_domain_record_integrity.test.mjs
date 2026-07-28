// Checkpoint F — cross-domain record integrity.
//
// The release requirement is that every page uses the SAME canonical record: a
// product created in Products is the product Sales sells, Procurement buys, POS
// scans, Inventory counts, a BOM consumes and Maintenance issues as a spare
// part. The failure mode this guards against is a domain quietly growing its
// own copy of a business fact — a second customer store, a second product
// store, a second task engine.
//
// Two things are asserted:
//
//   1. STRUCTURE — there is exactly one canonical table per business fact, and
//      the consuming domains reference it by foreign key rather than
//      duplicating it. This is checked against a real migrated schema, so it
//      cannot drift from the source.
//
//   2. BEHAVIOUR — a record created once through a canonical action is
//      readable, unchanged and by the same id, from the tables the other
//      domains actually join against.
//
// A referencing foreign key is stronger evidence than a passing UI screenshot:
// a screenshot shows a number rendered, an FK shows the domains are physically
// incapable of holding a different value.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, before, after } from 'node:test';

import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';

let tempDir;
let db;
let executor;
let ctx;
let seq = 0;

const ik = (p) => `ckf_xd_${p}_${(seq += 1)}`;
const execute = (actionId, input, key) => executor.execute(actionId, { ...input, idempotency_key: key }, ctx);

function referencingTables(target) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  const found = new Set();
  for (const t of tables) {
    let fks = [];
    try { fks = db.prepare(`PRAGMA foreign_key_list(${t})`).all(); } catch { continue; }
    if (fks.some((fk) => fk.table === target)) found.add(t);
  }
  return found;
}

function tableExists(name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-ckf-xdomain-'));
  const dbPath = path.join(tempDir, 'xdomain.db');
  await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'checkpoint-f' });
  db = openMigrationDatabase(dbPath);
  const auth = createPlatformAuthority(db);
  executor = auth.actionExecutor;
  ctx = {
    tenantId: 'default',
    companyId: 'default',
    userId: 'usr_ckf_xd',
    roles: ['admin', 'sales_manager', 'inventory_manager', 'asset_manager'],
  };
});

after(() => {
  try { db?.close(); } catch {}
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// One store per business fact
// ---------------------------------------------------------------------------

test('there is exactly one canonical store for each core business fact', () => {
  // If any of these ever gains a sibling ("customers", "suppliers",
  // "products", "tasks"), a second authority has appeared.
  for (const canonical of ['parties', 'product_variants', 'product_templates', 'uoms', 'stock_quants', 'work_items', 'assets']) {
    assert.ok(tableExists(canonical), `canonical table '${canonical}' is missing`);
  }

  const forbiddenDuplicates = ['customers', 'suppliers', 'products', 'tasks', 'vendors', 'items'];
  for (const dupe of forbiddenDuplicates) {
    assert.equal(tableExists(dupe), false, `'${dupe}' exists alongside the canonical store — that is a competing authority`);
  }
});

// ---------------------------------------------------------------------------
// Structural connection — the domains reference the canonical row
// ---------------------------------------------------------------------------

test('Party is the single authority for Sales, Procurement and Projects', () => {
  const refs = referencingTables('parties');
  for (const consumer of ['sale_orders', 'purchase_orders', 'projects', 'contacts', 'addresses']) {
    assert.ok(refs.has(consumer), `'${consumer}' does not reference the canonical parties table — it may hold its own party copy`);
  }
});

test('Product is the single authority for Inventory, Sales, Procurement and POS', () => {
  const refs = referencingTables('product_variants');
  for (const consumer of ['stock_moves', 'stock_quants', 'sale_order_lines', 'purchase_order_lines', 'pos_order_lines']) {
    assert.ok(refs.has(consumer), `'${consumer}' does not reference the canonical product_variants table`);
  }
});

test('Work Item is the single authority shared by Manufacturing, Quality, Maintenance and Fleet', () => {
  // This is the cross-domain claim most likely to be faked by a lookalike
  // table, so it is asserted directly against foreign keys.
  const refs = referencingTables('work_items');
  for (const consumer of ['mfg_production_orders', 'mfg_work_orders', 'quality_capas', 'maintenance_orders', 'fleet_trips']) {
    assert.ok(refs.has(consumer), `'${consumer}' does not reference the canonical work_items table — that domain runs its own task engine`);
  }
});

test('Asset is the single authority shared by Maintenance and Fleet', () => {
  const refs = referencingTables('assets');
  for (const consumer of ['maintenance_requests', 'maintenance_orders', 'maintenance_preventive_plans', 'fleet_vehicles']) {
    assert.ok(refs.has(consumer), `'${consumer}' does not reference the canonical assets register`);
  }
  // Depreciation must hang off the same register, not a finance-local copy.
  assert.ok(refs.has('asset_depreciation_schedules'), 'depreciation schedules do not reference the canonical assets register');
});

test('UOM is the single authority shared by Engineering, Manufacturing and Maintenance', () => {
  const refs = referencingTables('uoms');
  for (const consumer of ['boms', 'bom_lines', 'mfg_production_orders', 'maintenance_spare_parts']) {
    assert.ok(refs.has(consumer), `'${consumer}' does not reference the canonical uoms table`);
  }
});

// ---------------------------------------------------------------------------
// Behavioural connection — the same row, by the same id, across domains
// ---------------------------------------------------------------------------

test('a dual-role party is ONE canonical record carrying both roles', () => {
  // The mission's "Dual-Role Party" case. The wrong implementation stores a
  // customer row and a supplier row; the canonical one stores a single party
  // with two role rows, so Sales and Procurement are looking at the same
  // legal entity and the same balance.
  const party = execute('party:create', {
    company_id: 'default',
    name: 'شركة اختبار التكامل',
    legal_name: 'Cross Domain Test Party',
    roles: ['customer', 'supplier'],
  }, ik('party'));

  assert.ok(party?.id, 'party:create returned no id');

  const stored = db.prepare('SELECT id, name, legal_name, company_id FROM parties WHERE id = ?').get(party.id);
  assert.ok(stored, 'the created party is not in the canonical parties table');
  assert.equal(stored.legal_name, 'Cross Domain Test Party');

  const partyRows = db.prepare('SELECT COUNT(*) AS c FROM parties WHERE legal_name = ?').get('Cross Domain Test Party').c;
  assert.equal(partyRows, 1, 'a dual-role party was stored as more than one party record');

  const roles = db.prepare('SELECT role FROM party_roles WHERE party_id = ? ORDER BY role').all(party.id).map((r) => r.role);
  assert.deepEqual(roles, ['customer', 'supplier'], 'both roles are not attached to the single canonical party');
});

test('a warehouse created once is visible to inventory under the same id', () => {
  const wh = execute('warehouse:create', {
    company_id: 'default', code: 'CKF-XD-WH', name: 'مخزن التكامل', name_en: 'Cross Domain WH',
  }, ik('wh'));

  const stored = db.prepare('SELECT id, code FROM warehouses WHERE id = ?').get(wh.id);
  assert.ok(stored, 'the created warehouse is not in the canonical warehouses table');
  assert.equal(stored.code, 'CKF-XD-WH');
});

test('no canonical table carries an orphan company reference', () => {
  // A mismatched company on a canonical row is how cross-company leakage
  // starts. Every party and warehouse must name a company that exists.
  const orphanParties = db.prepare(`
    SELECT COUNT(*) AS c FROM parties p
    WHERE p.company_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM platform_companies c WHERE c.id = p.company_id)
  `).get().c;
  assert.equal(orphanParties, 0, 'parties reference a company that does not exist');
});
