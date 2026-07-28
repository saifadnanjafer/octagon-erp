// Checkpoint G — disposable backup and restore.
//
// Closes Checkpoint F blocker H2. Everything here runs on disposable databases
// created under the OS temp directory. No operational backup or restore is
// performed, and the cutover controller's own path guard would refuse the
// operational store even if this file tried.
//
// The proof is: stage real cross-domain facts, back the database up, hash the
// backup, restore it into a SECOND isolated path, and then show that the
// restored database is functionally the same system — same record counts, same
// source links, same audit and outbox chain, same cutover locks, migrations
// still reporting applied, and reads still working. Plus the negative: no
// session or credential material rode along in the backup.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, before, after } from 'node:test';

import {
  freshInstall,
  openMigrationDatabase,
  backupBeforeMigration,
  migrationStatus,
  schemaFingerprint,
} from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { products, uom } from '../../platform/commercial/index.mjs';
import { setApprovalAuthorityLimit } from '../../platform/finance/engine.mjs';
import { createCanonicalCutoverController } from '../../platform/cutover/canonical-cutover-controller.mjs';
import { createLegacyWriterRetirementGuard, RETIREMENT_LOCKS } from '../../platform/cutover/legacy-writer-retirement.mjs';

const DISPOSABLE_ENV = { OCTAGON_DISPOSABLE_FIXTURE: '1', OCTAGON_RUNTIME_MODE: 'test' };

let tempDir;
let sourcePath;
let restorePath;
let backupPath;
let backupSha256;
let manifest;
let seq = 0;

const ctx = {
  tenantId: 'default', companyId: 'default', branchId: 'default',
  userId: 'ckg-backup', sourceChannel: 'node-test',
};

const ik = (p) => `ckg_bk_${p}_${(seq += 1)}`;

// Counts that must survive the round trip unchanged.
const CRITICAL_TABLES = [
  'parties', 'party_roles', 'warehouses', 'stock_locations', 'stock_moves',
  'stock_quants', 'stock_valuation_facts', 'stock_accounting_links',
  'product_templates', 'product_variants', 'uoms', 'uom_categories',
  'work_items', 'assets', 'platform_audit_log', 'platform_outbox',
  'action_idempotency', 'authority_retirement_locks', 'canonical_cutover_attempts',
];

function counts(db) {
  const out = {};
  for (const t of CRITICAL_TABLES) {
    try { out[t] = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c; }
    catch (e) { out[t] = `MISSING(${e.message.slice(0, 40)})`; }
  }
  return out;
}

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

let sourceCounts;
let sourceFingerprint;

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-ckg-backup-'));
  sourcePath = path.join(tempDir, 'source-disposable.db');
  restorePath = path.join(tempDir, 'restored-disposable.db');

  await freshInstall({ dbPath: sourcePath, backupDir: path.join(tempDir, 'pre'), actor: 'checkpoint-g' });
  const db = openMigrationDatabase(sourcePath);
  const executor = createPlatformAuthority(db).actionExecutor;
  const execute = (a, i, k) => executor.execute(a, { ...i, idempotency_key: k }, ctx);

  setApprovalAuthorityLimit(db, ctx, {
    role_or_user: ctx.userId, limit_type: 'post', max_amount: 1_000_000_000, currency: 'IQD',
  });

  // Disposable canonical cutover, so the backup carries cutover state too.
  createCanonicalCutoverController({ dialect: db, dbPath: sourcePath, env: DISPOSABLE_ENV })
    .activateAll({ actor: 'checkpoint-g-backup' });

  // ---- representative cross-domain facts -------------------------------
  execute('party:create', {
    company_id: 'default', name: 'زبون النسخ الاحتياطي', legal_name: 'Backup Customer', roles: ['customer'],
  }, ik('customer'));
  execute('party:create', {
    company_id: 'default', name: 'مورد النسخ الاحتياطي', legal_name: 'Backup Supplier', roles: ['supplier'],
  }, ik('supplier'));

  const warehouse = execute('warehouse:create', { name: 'Backup WH', code: 'BKWH' }, ik('wh'));
  const supplierLoc = execute('stock:location:create', { name: 'Backup Supplier Loc', usage: 'supplier' }, ik('loc'));

  const uomCat = uom.createUomCategory(db, { name: 'Backup Units' });
  const unit = uom.createUom(db, { category_id: uomCat.id, name: 'Piece', symbol: 'pc' });
  const prodCat = products.createProductCategory(db, {
    company_id: 'default', name: 'Backup Parts', costing_method: 'avco',
    stock_account_id: 'acc_104000', stock_input_account_id: 'acc_201000',
    stock_output_account_id: 'acc_500000', expense_account_id: 'acc_501000',
  });
  const product = execute('product:template:create', {
    name: 'Backup Part', category_id: prodCat.id, uom_id: unit.id, sku: 'BK-PART-001',
  }, ik('product'));

  // Inventory + valuation + finance link in one governed posting.
  execute('stock:move:post', {
    reference: 'BK-RECEIPT', product_id: product.default_variant_id, uom_id: unit.id, product_qty: 12,
    location_id: supplierLoc.id, location_dest_id: warehouse.lot_stock_id, unit_cost: 30,
    source_document_type: 'inventory_adjustment', source_document_id: 'BK-OPEN', source_line_id: 'BK-OPEN-1',
  }, ik('receipt'));

  // Asset register.
  const cat = execute('assets:category:create', {
    company_id: 'default', code: 'BK-CAT', name: 'Backup Assets', name_en: 'Backup Assets',
    depreciation_method: 'straight_line', useful_life_months: 48,
  }, ik('assetcat'));
  execute('assets:asset:create', {
    company_id: 'default', category_id: cat.id, code: 'BK-AST-1',
    name: 'Backup Asset', name_en: 'Backup Asset', acquisition_cost: 5000,
    acquisition_date: '2026-01-01',
  }, ik('asset'));

  sourceCounts = counts(db);
  sourceFingerprint = schemaFingerprint(db);

  // ---- backup ----------------------------------------------------------
  backupPath = backupBeforeMigration(db, sourcePath, path.join(tempDir, 'backups'));
  db.close();

  backupSha256 = sha256File(backupPath);
  manifest = {
    createdAt: new Date().toISOString(),
    sourcePath, backupPath,
    bytes: fs.statSync(backupPath).size,
    sha256: backupSha256,
    schemaFingerprint: sourceFingerprint,
    counts: sourceCounts,
  };
  fs.writeFileSync(path.join(tempDir, 'backup-manifest.json'), JSON.stringify(manifest, null, 2));

  // ---- restore into a SECOND isolated path ------------------------------
  fs.copyFileSync(backupPath, restorePath);
});

after(() => {
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

test('the backup exists, is non-trivial, and hashes stably', () => {
  assert.ok(fs.existsSync(backupPath), 'no backup file was produced');
  assert.ok(manifest.bytes > 100_000, `backup suspiciously small: ${manifest.bytes} bytes`);
  assert.match(backupSha256, /^[0-9a-f]{64}$/);
  assert.equal(sha256File(backupPath), backupSha256, 'backup hash is not stable between reads');
});

test('the restored copy is byte-identical to the backup', () => {
  assert.equal(sha256File(restorePath), backupSha256, 'restore did not reproduce the backup bytes');
});

test('migrations report fully applied on the restored database', async () => {
  const status = await migrationStatus({ dbPath: restorePath });
  const applied = status.filter((m) => m.status === 'applied').length;
  const pending = status.filter((m) => m.status !== 'applied');
  assert.deepEqual(pending, [], `restored database has unapplied migrations: ${pending.map((m) => m.id).join(', ')}`);
  assert.ok(applied >= 62, `restored database reports only ${applied} applied migrations`);
});

test('the restored schema fingerprint matches the source', () => {
  const db = openMigrationDatabase(restorePath);
  try {
    assert.equal(schemaFingerprint(db), sourceFingerprint, 'restored schema differs from source');
  } finally { db.close(); }
});

test('every critical record count survives the round trip', () => {
  const db = openMigrationDatabase(restorePath);
  try {
    assert.deepEqual(counts(db), sourceCounts, 'record counts differ after restore');
  } finally { db.close(); }
});

test('cross-domain source links survive the round trip', () => {
  const db = openMigrationDatabase(restorePath);
  try {
    // A stock move must still carry its valuation and its finance link.
    const move = db.prepare("SELECT id FROM stock_moves WHERE reference = 'BK-RECEIPT'").get();
    assert.ok(move, 'the staged stock move is missing after restore');

    const valuation = db.prepare('SELECT COUNT(*) AS c FROM stock_valuation_facts WHERE stock_move_id = ?').get(move.id).c;
    assert.equal(valuation, 1, 'valuation fact lost its link to the stock move');

    const glLink = db.prepare('SELECT COUNT(*) AS c FROM stock_accounting_links WHERE stock_move_id = ?').get(move.id).c;
    assert.equal(glLink, 1, 'stock-to-GL link lost after restore');

    // The dual party roles must still hang off their party.
    const supplier = db.prepare("SELECT id FROM parties WHERE legal_name = 'Backup Supplier'").get();
    assert.ok(supplier, 'staged supplier missing after restore');
    const roles = db.prepare('SELECT role FROM party_roles WHERE party_id = ?').all(supplier.id).map((r) => r.role);
    assert.deepEqual(roles, ['supplier'], 'party roles lost after restore');
  } finally { db.close(); }
});

test('the audit and outbox chains survive the round trip', () => {
  const db = openMigrationDatabase(restorePath);
  try {
    assert.ok(counts(db).platform_audit_log > 0, 'restored database has an empty audit log');
    assert.ok(counts(db).platform_outbox > 0, 'restored database has an empty outbox');
    assert.equal(counts(db).platform_audit_log, sourceCounts.platform_audit_log, 'audit chain length changed');
    assert.equal(counts(db).platform_outbox, sourceCounts.platform_outbox, 'outbox state changed');
  } finally { db.close(); }
});

test('canonical cutover locks survive the round trip', () => {
  const db = openMigrationDatabase(restorePath);
  try {
    const guard = createLegacyWriterRetirementGuard(db);
    assert.equal(guard.cutoverEnabled(), true, 'cutover flag lost in restore');
    for (const domain of Object.keys(RETIREMENT_LOCKS)) {
      assert.equal(guard.enforced(domain), true, `${domain} lost enforcement after restore — restoring reopened a legacy back door`);
    }
  } finally { db.close(); }
});

test('representative reads work against the restored database', () => {
  const db = openMigrationDatabase(restorePath);
  try {
    const party = db.prepare("SELECT name, legal_name FROM parties WHERE legal_name = 'Backup Customer'").get();
    assert.ok(party, 'customer not readable after restore');
    assert.equal(party.name, 'زبون النسخ الاحتياطي', 'Arabic text corrupted by the backup/restore round trip');

    const assetCount = db.prepare('SELECT COUNT(*) AS c FROM assets').get().c;
    assert.ok(assetCount > 0, 'no asset readable after restore');

    const integrity = db.prepare('PRAGMA integrity_check').get();
    assert.equal(Object.values(integrity)[0], 'ok', 'restored database fails integrity check');
  } finally { db.close(); }
});

test('no session or credential material was copied into the backup', () => {
  const db = openMigrationDatabase(restorePath);
  try {
    // Sessions are runtime state. A backup that carries live sessions lets a
    // restore resurrect an authenticated session nobody re-authenticated.
    for (const table of ['platform_sessions', 'sessions']) {
      let rows = null;
      try { rows = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c; } catch { continue; }
      assert.equal(rows, 0, `${table} carries ${rows} live sessions into the backup`);
    }

    // Secret VALUES live in secret_values, keyed by reference — migration 008
    // is explicit that "a secret VALUE never lands in settings_values; only a
    // reference does". So the meaningful question is whether secret_values
    // rode along, not whether a column happens to be named "secret".
    //
    // (An earlier version of this test flagged platform_settings.secret and
    // identity_mfa_methods.secret by name. platform_settings.secret is a
    // one-character boolean flag marking a setting as secret-bearing, not a
    // secret. Name-matching was a false positive; this is the real check.)
    const secretValues = db.prepare('SELECT COUNT(*) AS c FROM secret_values').get().c;
    assert.equal(secretValues, 0, `backup carries ${secretValues} secret_values rows`);

    const mfaSecrets = db.prepare(
      "SELECT COUNT(*) AS c FROM identity_mfa_methods WHERE secret IS NOT NULL AND secret != ''",
    ).get().c;
    assert.equal(mfaSecrets, 0, `backup carries ${mfaSecrets} populated MFA secrets`);

    // And the flag column really is a flag, not a smuggled value.
    const oversized = db.prepare(
      'SELECT COUNT(*) AS c FROM platform_settings WHERE secret IS NOT NULL AND length(secret) > 1',
    ).get().c;
    assert.equal(oversized, 0, 'platform_settings.secret holds values longer than a flag — a secret may be stored inline');
  } finally { db.close(); }
});
