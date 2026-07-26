// Shared fixture for the Phase 05 suites.
//
// Every suite builds a disposable database in the OS temp directory. The
// operational `database.db` is never opened, never migrated and never read by
// a SQLite driver during Phase 05 testing.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { products, uom } from '../../platform/commercial/index.mjs';
import {
  setApprovalAuthorityLimit, createAccount, createAssetCategory, seedChartOfAccounts,
} from '../../platform/finance/engine.mjs';

export const CTX = Object.freeze({
  tenantId: 'default',
  companyId: 'default',
  branchId: null,
  userId: 'phase05-test',
  sourceChannel: 'node-test',
});

export function approverCtx(userId = 'phase05-approver') {
  return { ...CTX, userId };
}

export async function buildFixture(label) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `octagon-phase05-${label}-`));
  const dbPath = path.join(tempDir, `${label}.db`);
  await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: `phase05-${label}` });
  const db = openMigrationDatabase(dbPath);
  const authority = createPlatformAuthority(db);
  const executor = authority.actionExecutor;

  const execute = (actionId, input, key, ctx = CTX) =>
    executor.execute(actionId, { ...input, idempotency_key: key }, ctx);

  for (const userId of [CTX.userId, 'phase05-approver']) {
    setApprovalAuthorityLimit(db, { ...CTX, userId: 'phase05-setup' }, {
      role_or_user: userId,
      limit_type: 'post',
      max_amount: 1_000_000_000,
      currency: 'IQD',
    });
  }

  return { tempDir, dbPath, db, authority, executor, execute };
}

export function teardown(fixture) {
  try {
    fixture?.db?.close();
  } finally {
    if (fixture?.tempDir) fs.rmSync(fixture.tempDir, { recursive: true, force: true });
  }
}

/**
 * Chart of accounts used by every Phase 05 posting path. Codes are explicit so
 * a reconciliation report can be read without cross-referencing ids.
 */
export function seedAccounts(db) {
  // Migration 014 already seeds the base chart for the default company on a
  // fresh install. Only seed it when it is genuinely absent.
  const seeded = db.prepare(
    'SELECT COUNT(*) AS n FROM finance_accounts WHERE company_id = ?',
  ).get(CTX.companyId).n;
  if (!Number(seeded)) seedChartOfAccounts(db, CTX, {});
  ensureFiscalPeriods(db, [2026, 2027, new Date().getUTCFullYear()]);

  const make = (code, name, type) => {
    const existing = db.prepare(
      'SELECT id FROM finance_accounts WHERE company_id = ? AND code = ?',
    ).get(CTX.companyId, code);
    if (existing) return existing.id;
    return createAccount(db, CTX, { code, name, type }).id;
  };
  return {
    inventory: make('104100', 'Raw Material Inventory', 'asset'),
    finishedGoods: make('104200', 'Finished Goods Inventory', 'asset'),
    stockInput: make('201100', 'Goods Received Not Invoiced', 'liability'),
    stockOutput: make('500100', 'Cost of Goods Sold', 'expense'),
    inventoryAdjustment: make('501100', 'Inventory Adjustment', 'expense'),
    wip: make('104300', 'Work In Progress', 'asset'),
    laborAbsorption: make('502100', 'Labour Absorption', 'expense'),
    overheadAbsorption: make('502200', 'Overhead Absorption', 'expense'),
    scrap: make('503100', 'Production Scrap', 'expense'),
    variance: make('503200', 'Production Variance', 'expense'),
    subcontractStock: make('104400', 'Goods at Subcontractor', 'asset'),
    subcontractExpense: make('504100', 'Subcontract Charges', 'expense'),
    assetGross: make('120100', 'Machinery at Cost', 'asset'),
    accumulatedDepreciation: make('120900', 'Accumulated Depreciation', 'asset'),
    depreciationExpense: make('505100', 'Depreciation Expense', 'expense'),
    disposalGain: make('420100', 'Gain on Disposal', 'income'),
    disposalLoss: make('506100', 'Loss on Disposal', 'expense'),
    assetClearing: make('201200', 'Asset Clearing', 'liability'),
    cash: make('101100', 'Cash', 'asset'),
    receivable: make('103100', 'Trade Receivable', 'receivable'),
    retainage: make('103200', 'Retainage Receivable', 'asset'),
    revenue: make('400100', 'Project Revenue', 'income'),
    projectLabour: make('507100', 'Project Labour Cost', 'expense'),
    payrollClearing: make('202100', 'Labour Clearing', 'liability'),
    expense: make('508100', 'General Project Expense', 'expense'),
    fuelExpense: make('509100', 'Fuel Expense', 'expense'),
  };
}

/**
 * Depreciation schedules are dated, so a suite that posts a 2026 period needs a
 * 2026 fiscal period to exist. Phase 03 seeds 2026 only when it also seeds the
 * chart, so a fresh install (which already has the chart from migration 014)
 * can be missing it. This creates the years the Phase 05 suites use.
 */
export function ensureFiscalPeriods(db, years) {
  const now = new Date().toISOString();
  for (const year of [...new Set(years)]) {
    const yearId = `fy_${CTX.companyId}_${year}`;
    const existingYear = db.prepare('SELECT id FROM finance_fiscal_years WHERE id = ?').get(yearId);
    if (!existingYear) {
      db.prepare(`
        INSERT INTO finance_fiscal_years (id, company_id, name, start_date, end_date, status, created_at, updated_at, created_by)
        VALUES (?, ?, ?, ?, ?, 'open', ?, ?, 'phase05-test')
      `).run(yearId, CTX.companyId, String(year), `${year}-01-01`, `${year}-12-31`, now, now);
    }
    // A year row can exist without its periods, so each month is checked
    // individually rather than assuming the year implies twelve periods.
    for (let month = 1; month <= 12; month += 1) {
      const mm = String(month).padStart(2, '0');
      const periodId = `period_${CTX.companyId}_${year}_${mm}`;
      if (db.prepare('SELECT id FROM finance_periods WHERE id = ?').get(periodId)) continue;
      const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
      db.prepare(`
        INSERT INTO finance_periods (id, company_id, fiscal_year_id, name, start_date, end_date, status, created_at, updated_at, created_by)
        VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, 'phase05-test')
      `).run(periodId, CTX.companyId, yearId, `${year}-${mm}`, `${year}-${mm}-01`, end, now, now);
    }
  }
}

/**
 * A product category whose accounts are mapped, so stock movements can post.
 */
export function seedProduct(db, execute, accounts, {
  name, sku, costingMethod = 'avco', unitId, categoryName, stockAccountId,
}) {
  const category = products.createProductCategory(db, {
    company_id: CTX.companyId,
    name: categoryName || `${name} category`,
    costing_method: costingMethod,
    stock_account_id: stockAccountId || accounts.inventory,
    stock_input_account_id: accounts.stockInput,
    stock_output_account_id: accounts.stockOutput,
    expense_account_id: accounts.inventoryAdjustment,
  });
  const template = execute('product:template:create', {
    name,
    category_id: category.id,
    uom_id: unitId,
    sku,
  }, `product-${sku}`);
  return { category, template, variantId: template.default_variant_id };
}

export function seedUnit(db, label = 'Phase 05 Units') {
  const category = uom.createUomCategory(db, { name: `${label} category` });
  return uom.createUom(db, { category_id: category.id, name: 'Piece', symbol: 'pc' });
}

export function seedFinanceAssetCategory(db, accounts) {
  return createAssetCategory(db, CTX, {
    code: 'MACH',
    name: 'Machinery',
    asset_account_id: accounts.assetGross,
    depreciation_expense_account_id: accounts.depreciationExpense,
    accumulated_depreciation_account_id: accounts.accumulatedDepreciation,
    disposal_gain_account_id: accounts.disposalGain,
    disposal_loss_account_id: accounts.disposalLoss,
  });
}

/**
 * Receive opening stock so a manufacturing order has something to consume.
 */
export function receiveStock(execute, { warehouse, supplierLocation, productId, unitId, quantity, unitCost, key }) {
  return execute('stock:move:post', {
    reference: `OPENING-${key}`,
    product_id: productId,
    uom_id: unitId,
    product_qty: quantity,
    location_id: supplierLocation.id,
    location_dest_id: warehouse.lot_stock_id,
    unit_cost: unitCost,
    source_document_type: 'inventory_adjustment',
    source_document_id: `OPENING-${key}`,
    source_line_id: `OPENING-${key}-1`,
  }, `stock-receipt-${key}`);
}

/** Balance of one account, taken from posted journal lines. */
export function accountBalance(db, accountId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(debit), 0) AS debit, COALESCE(SUM(credit), 0) AS credit
    FROM finance_journal_lines WHERE company_id = ? AND account_id = ?
  `).get(CTX.companyId, accountId);
  return Math.round((Number(row.debit) - Number(row.credit)) * 100) / 100;
}

/** Every posted journal entry must balance; this is asserted after each suite. */
export function unbalancedEntries(db) {
  return db.prepare(`
    SELECT e.id, e.entry_number, e.total_debit, e.total_credit
    FROM finance_journal_entries e
    WHERE e.company_id = ? AND ABS(e.total_debit - e.total_credit) > 0.005
  `).all(CTX.companyId);
}
