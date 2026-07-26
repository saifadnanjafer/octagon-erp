import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { freshInstall } from '../../database/migration-runner/index.mjs';
import { runDisposableMigration } from '../../scripts/migrate_legacy_data.mjs';

const CUTOVER_DATE = '2026-07-24';

test('Opening Stock Cutover: fresh install seeds Opening Balance Equity and Opening Location', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-p04-open-test-'));
  const dbPath = path.join(tempDir, 'fresh.db');
  try {
    await freshInstall({
      dbPath,
      backupDir: path.join(tempDir, 'backups'),
      actor: 'test-agent',
    });
    const db = new DatabaseSync(dbPath);

    // Check CoA Opening Equity Account (390000)
    const equityAcc = db.prepare("SELECT * FROM finance_accounts WHERE code = '390000'").get();
    assert.ok(equityAcc, 'acc_390000 must exist');
    assert.equal(equityAcc.type, 'equity');

    // Check Opening Journal
    const journal = db.prepare("SELECT * FROM finance_journals WHERE type = 'opening' OR code = 'opening'").get();
    assert.ok(journal, 'jnl_opening must exist');

    // Check Virtual Location OPENING_BALANCE
    const loc = db.prepare("SELECT * FROM stock_locations WHERE id = 'loc_opening_balance'").get();
    assert.ok(loc, 'loc_opening_balance must exist');
    assert.equal(loc.usage, 'inventory');

    db.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Opening Stock Cutover: reconciles source snapshot (401 stock, 86 reserved, 1.963M valuation, diff 0 GL)', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-p04-open-legacy-test-'));
  const source = path.join(tempDir, 'source.db');
  const target = path.join(tempDir, 'target.db');
  try {
    await freshInstall({
      dbPath: source,
      backupDir: path.join(tempDir, 'backups'),
      actor: 'test-agent',
    });
    const db = new DatabaseSync(source);

    // Seed 8 materials matching verified legacy snapshot
    const materials = [
      { id: 'mat_acrylic', name: 'أكريليك', category: 'خام', unit: 'متر', stock: 45, cost: 15000, reservedQty: 12 },
      { id: 'mat_adhesive', name: 'غراء', category: 'خام', unit: 'علبة', stock: 18, cost: 3500, reservedQty: 2 },
      { id: 'mat_foam', name: 'فوم', category: 'خام', unit: 'متر', stock: 60, cost: 3000, reservedQty: 5 },
      { id: 'mat_led', name: 'LED', category: 'إلكترونيات', unit: 'قطعة', stock: 200, cost: 1500, reservedQty: 50 },
      { id: 'mat_mdf', name: 'خشب MDF', category: 'خام', unit: 'لوح', stock: 30, cost: 8000, reservedQty: 8 },
      { id: 'mat_paint', name: 'طلاء', category: 'خام', unit: 'لتر', stock: 25, cost: 5000, reservedQty: 4 },
      { id: 'mat_power', name: 'محول كهرباء', category: 'إلكترونيات', unit: 'قطعة', stock: 15, cost: 12000, reservedQty: 3 },
      { id: 'mat_vinyl', name: 'فينيل', category: 'خام', unit: 'رول', stock: 8, cost: 25000, reservedQty: 2 },
    ];

    const insertColl = db.prepare("INSERT INTO collections (collection, id, data) VALUES (?, ?, ?)");
    for (const mat of materials) {
      insertColl.run('omni.materials', mat.id, JSON.stringify(mat));
    }
    insertColl.run('finance.customers', 'cust_1', JSON.stringify({ id: 'cust_1', name: 'عميل افتتاحي' }));
    insertColl.run('omni.suppliers', 'sup_1', JSON.stringify({ id: 'sup_1', name: 'مورد افتتاحي' }));
    insertColl.run('omni.warehouses', 'WH_MAIN', JSON.stringify({ id: 'WH_MAIN', companyId: 'default', code: 'MAIN', nameAr: 'المخزن الرئيسي' }));
    insertColl.run('locations', 'LOC_MAIN_STOCK', JSON.stringify({ id: 'LOC_MAIN_STOCK', name: 'موقع المخزون الرئيسي', type: 'internal' }));

    db.close();

    const report = await runDisposableMigration({
      sourceDbPath: source,
      targetDbPath: target,
      cutoverDate: CUTOVER_DATE,
    });
    assert.equal(report.status, 'PASSED', JSON.stringify(report, null, 2));
    assert.equal(report.openQuarantine, 0, 'Open quarantine must be 0');

    const rec = report.reconciliation;
    assert.equal(rec.quantity.source, 401);
    assert.equal(rec.quantity.canonical, 401);
    assert.ok(rec.quantity.match);

    assert.equal(rec.reservations.source, 86);
    assert.equal(rec.reservations.canonical, 86);
    assert.ok(rec.reservations.match);

    assert.equal(rec.available.source, 315);
    assert.equal(rec.available.canonical, 315);
    assert.ok(rec.available.match);

    assert.equal(rec.valuation.source, 1963000);
    assert.equal(rec.valuation.canonical, 1963000);
    assert.ok(rec.valuation.match);

    assert.equal(rec.stockToGl.sourceStockValue, 1963000);
    assert.equal(rec.stockToGl.canonicalJournalDebit, 1963000);
    assert.equal(rec.stockToGl.canonicalJournalCredit, 1963000);
    assert.ok(rec.stockToGl.match);
    assert.deepEqual(rec.duplicates, {
      sourceMaterials: 8,
      batchLines: 8,
      stockMoves: 8,
      valuationFacts: 8,
      financeDocuments: 1,
      journalEntries: 1,
      match: true,
    });

    assert.ok(report.idempotentRerun, 'Re-run must be idempotent');

    const migrated = new DatabaseSync(target, { readOnly: true });
    const openingDocument = migrated.prepare(`
      SELECT id, state, move_type, doc_date, source_type
      FROM finance_documents
      WHERE source_type = 'opening_inventory_cutover'
    `).get();
    assert.ok(openingDocument, 'Canonical opening inventory document must exist');
    assert.equal(openingDocument.state, 'posted');
    assert.equal(openingDocument.move_type, 'opening_entry');
    assert.equal(openingDocument.doc_date, CUTOVER_DATE);
    assert.equal(
      migrated.prepare('SELECT COUNT(*) AS n FROM finance_document_lines WHERE document_id = ?').get(openingDocument.id).n,
      2,
    );
    const entry = migrated.prepare(`
      SELECT id, hash, total_debit, total_credit
      FROM finance_journal_entries
      WHERE document_id = ?
    `).get(openingDocument.id);
    assert.ok(entry?.hash, 'Phase 03 posting must create the chained journal hash');
    assert.equal(entry.total_debit, 1963000);
    assert.equal(entry.total_credit, 1963000);
    assert.equal(
      migrated.prepare('SELECT COUNT(*) AS n FROM finance_integrity_hashes WHERE journal_entry_id = ?').get(entry.id).n,
      1,
    );
    migrated.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Opening Stock Cutover: quarantines materials with non-positive cost', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-p04-open-invalid-cost-'));
  const source = path.join(tempDir, 'source.db');
  const target = path.join(tempDir, 'target.db');
  try {
    await freshInstall({
      dbPath: source,
      backupDir: path.join(tempDir, 'backups'),
      actor: 'test-agent',
    });
    const db = new DatabaseSync(source);

    const insertColl = db.prepare("INSERT INTO collections (collection, id, data) VALUES (?, ?, ?)");
    insertColl.run('omni.materials', 'mat_zero_cost', JSON.stringify({
      id: 'mat_zero_cost',
      name: 'مادة بدون سعر',
      stock: 10,
      cost: 0,
      reservedQty: 0,
    }));
    insertColl.run('omni.warehouses', 'WH_MAIN', JSON.stringify({ id: 'WH_MAIN', companyId: 'default', code: 'MAIN', nameAr: 'المخزن الرئيسي' }));
    insertColl.run('locations', 'LOC_MAIN_STOCK', JSON.stringify({ id: 'LOC_MAIN_STOCK', name: 'موقع المخزون الرئيسي', type: 'internal' }));

    db.close();

    const report = await runDisposableMigration({
      sourceDbPath: source,
      targetDbPath: target,
      cutoverDate: CUTOVER_DATE,
    });
    assert.equal(report.status, 'BLOCKED', 'Migration must be BLOCKED when malformed cost is present');
    assert.ok(report.openQuarantine >= 1, 'Quarantine must contain invalid cost record');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Opening Stock Cutover: fails closed before snapshot creation when cutover date is missing', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-p04-open-missing-date-'));
  const source = path.join(tempDir, 'source.db');
  const target = path.join(tempDir, 'target.db');
  try {
    await freshInstall({
      dbPath: source,
      backupDir: path.join(tempDir, 'backups'),
      actor: 'test-agent',
    });
    await assert.rejects(
      runDisposableMigration({ sourceDbPath: source, targetDbPath: target }),
      /OPENING_CUTOVER_DATE_REQUIRED/,
    );
    assert.equal(fs.existsSync(target), false, 'No disposable database may be created without an approved cutover date');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Opening Stock Cutover: consolidates committed WAL facts without opening the source through SQLite', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-p04-open-wal-'));
  const source = path.join(tempDir, 'source.db');
  const target = path.join(tempDir, 'target.db');
  let sourceDb;
  try {
    await freshInstall({
      dbPath: source,
      backupDir: path.join(tempDir, 'backups'),
      actor: 'test-agent',
    });
    sourceDb = new DatabaseSync(source);
    sourceDb.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;');
    const insertColl = sourceDb.prepare("INSERT INTO collections (collection, id, data) VALUES (?, ?, ?)");
    sourceDb.exec('BEGIN IMMEDIATE');
    insertColl.run('omni.materials', 'mat_wal_only', JSON.stringify({
      id: 'mat_wal_only',
      name: 'WAL material',
      category: 'Raw',
      unit: 'unit',
      stock: 4,
      cost: 1250,
      reservedQty: 1,
    }));
    insertColl.run('omni.warehouses', 'WH_WAL', JSON.stringify({
      id: 'WH_WAL',
      companyId: 'default',
      code: 'WAL',
      name: 'WAL Warehouse',
    }));
    insertColl.run('locations', 'LOC_WAL', JSON.stringify({
      id: 'LOC_WAL',
      name: 'WAL Stock',
      type: 'internal',
    }));
    sourceDb.exec('COMMIT');

    const walBefore = fs.readFileSync(`${source}-wal`);
    assert.ok(walBefore.length > 0, 'Fixture facts must remain in a non-empty WAL');

    const report = await runDisposableMigration({
      sourceDbPath: source,
      targetDbPath: target,
      cutoverDate: CUTOVER_DATE,
    });
    assert.equal(report.status, 'PASSED', JSON.stringify(report, null, 2));
    assert.equal(report.source.unchanged, true);
    assert.equal(report.source.sourceWalSha256, report.source.componentsAfter.wal.sha256);
    assert.deepEqual(fs.readFileSync(`${source}-wal`), walBefore);

    const migrated = new DatabaseSync(target, { readOnly: true });
    assert.equal(migrated.prepare("SELECT COUNT(*) AS n FROM product_variants WHERE id = 'mat_wal_only'").get().n, 1);
    assert.equal(migrated.prepare("SELECT quantity, reserved_quantity FROM stock_quants WHERE product_id = 'mat_wal_only'").get().quantity, 4);
    migrated.close();
  } finally {
    try { sourceDb?.close(); } catch (_) {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Opening Stock Cutover: rolls back every migrated fact when the accounting period is not open', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-p04-open-period-rollback-'));
  const source = path.join(tempDir, 'source.db');
  const target = path.join(tempDir, 'target.db');
  try {
    await freshInstall({
      dbPath: source,
      backupDir: path.join(tempDir, 'backups'),
      actor: 'test-agent',
    });
    const sourceDb = new DatabaseSync(source);
    const insertColl = sourceDb.prepare("INSERT INTO collections (collection, id, data) VALUES (?, ?, ?)");
    insertColl.run('omni.materials', 'mat_period_block', JSON.stringify({
      id: 'mat_period_block',
      name: 'Period block material',
      category: 'Raw',
      unit: 'unit',
      stock: 2,
      cost: 500,
      reservedQty: 0,
    }));
    insertColl.run('omni.warehouses', 'WH_PERIOD', JSON.stringify({
      id: 'WH_PERIOD',
      companyId: 'default',
      code: 'PERIOD',
      name: 'Period Warehouse',
    }));
    insertColl.run('locations', 'LOC_PERIOD', JSON.stringify({
      id: 'LOC_PERIOD',
      name: 'Period Stock',
      type: 'internal',
    }));
    sourceDb.prepare(`
      UPDATE finance_periods
      SET status = 'hard_closed'
      WHERE company_id = 'default' AND start_date <= ? AND end_date >= ?
    `).run(CUTOVER_DATE, CUTOVER_DATE);
    sourceDb.close();
    const sourceBefore = fs.readFileSync(source);

    await assert.rejects(
      runDisposableMigration({
        sourceDbPath: source,
        targetDbPath: target,
        cutoverDate: CUTOVER_DATE,
      }),
      /OPENING_CUTOVER_PERIOD_UNAVAILABLE/,
    );
    assert.deepEqual(fs.readFileSync(source), sourceBefore);

    const disposable = new DatabaseSync(target, { readOnly: true });
    assert.equal(disposable.prepare('SELECT COUNT(*) AS n FROM phase04_opening_stock_batches').get().n, 0);
    assert.equal(disposable.prepare("SELECT COUNT(*) AS n FROM stock_moves WHERE reference = 'OPENING-CUTOVER'").get().n, 0);
    assert.equal(disposable.prepare("SELECT COUNT(*) AS n FROM finance_documents WHERE source_type = 'opening_inventory_cutover'").get().n, 0);
    disposable.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
