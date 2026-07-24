import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { freshInstall } from '../../database/migration-runner/index.mjs';
import { runDisposableMigration } from '../../scripts/migrate_legacy_data.mjs';

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

    const report = await runDisposableMigration({ sourceDbPath: source, targetDbPath: target });
    assert.equal(report.status, 'PASSED', 'Migration status must be PASSED');
    assert.equal(report.openQuarantine, 0, 'Open quarantine must be 0');

    const rec = report.reconciliation;
    assert.equal(rec.quantity.source, 401);
    assert.equal(rec.quantity.canonical, 401);
    assert.ok(rec.quantity.match);

    assert.equal(rec.reservations.source, 86);
    assert.equal(rec.reservations.canonical, 86);
    assert.ok(rec.reservations.match);

    assert.equal(rec.valuation.source, 1963000);
    assert.equal(rec.valuation.canonical, 1963000);
    assert.ok(rec.valuation.match);

    assert.equal(rec.stockToGl.sourceStockValue, 1963000);
    assert.equal(rec.stockToGl.canonicalJournalDebit, 1963000);
    assert.ok(rec.stockToGl.match);

    assert.ok(report.idempotentRerun, 'Re-run must be idempotent');
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

    const report = await runDisposableMigration({ sourceDbPath: source, targetDbPath: target });
    assert.equal(report.status, 'BLOCKED', 'Migration must be BLOCKED when malformed cost is present');
    assert.ok(report.openQuarantine >= 1, 'Quarantine must contain invalid cost record');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
