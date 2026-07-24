// 044_opening_stock_cutover_and_equity_coa — Phase 04.6 Opening Cutover Foundation
//
// What this migration does:
//   1. Seeds Opening Balance Equity account (code 390000) under finance_accounts.
//   2. Seeds Opening Stock virtual location (code OPENING_BALANCE) under stock_locations.
//   3. Seeds Opening Journal (code opening) under finance_journals.
//   4. Creates opening stock cutover tracking tables:
//      - phase04_opening_stock_batches
//      - phase04_opening_stock_lines
//      - phase04_opening_stock_reservations

const MODULE_ID = 'stock_inventory';

export const migration = {
  id: '044_opening_stock_cutover_and_equity_coa',
  owner: MODULE_ID,
  version: '1.44.0',
  dependsOn: ['043_phase04_canonical_registry_and_lineage'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'SPEC-IMPLEMENT for Phase 04.6 Opening Balance Cutover',

  up(dialect) {
    const now = new Date().toISOString();

    // 1. Opening Balance Equity Account
    dialect.exec(`
      INSERT OR IGNORE INTO finance_accounts (
        id, company_id, code, name, type, parent_id, normal_balance, is_reconcilable, is_active, created_at, updated_at, created_by
      ) VALUES (
        'acc_390000', 'default', '390000', 'Opening Balance Equity / حقوق الملكية الافتتاحية', 'equity', 'acc_300000', 'credit', 0, 1, '${now}', '${now}', 'migration:044'
      );
    `);

    // 2. Opening Journal
    dialect.exec(`
      INSERT OR IGNORE INTO finance_journals (
        id, company_id, code, name, type, default_debit_account_id, default_credit_account_id, is_active, created_at, updated_at, created_by
      ) VALUES (
        'jnl_opening', 'default', 'opening', 'Opening Journal / يومية افتتاحية', 'opening', 'acc_104000', 'acc_390000', 1, '${now}', '${now}', 'migration:044'
      );
    `);

    // 3. Opening Virtual Location
    dialect.exec(`
      INSERT OR IGNORE INTO stock_locations (
        id, company_id, warehouse_id, parent_id, name, complete_name, usage, is_scrap, created_at
      ) VALUES (
        'loc_opening_balance', '*', NULL, NULL, 'Opening Stock Cutover / رصيد افتتاحي', 'Virtual Locations / Opening Stock Cutover', 'inventory', 0, '${now}'
      );
    `);

    // 4. Opening Stock Tracking Tables
    dialect.exec(`
      CREATE TABLE IF NOT EXISTS phase04_opening_stock_batches (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        source_db_hash TEXT NOT NULL,
        source_db_path TEXT NOT NULL,
        snapshot_timestamp TEXT NOT NULL,
        cutover_timestamp TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('draft', 'completed', 'rolled_back', 'failed')),
        total_materials INTEGER NOT NULL DEFAULT 0,
        total_on_hand_qty REAL NOT NULL DEFAULT 0.0,
        total_reserved_qty REAL NOT NULL DEFAULT 0.0,
        total_available_qty REAL NOT NULL DEFAULT 0.0,
        total_valuation_value REAL NOT NULL DEFAULT 0.0,
        inventory_journal_entry_id TEXT,
        actor_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        completed_at TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS phase04_opening_stock_lines (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL REFERENCES phase04_opening_stock_batches(id),
        company_id TEXT NOT NULL,
        warehouse_id TEXT NOT NULL,
        location_id TEXT NOT NULL,
        legacy_material_id TEXT NOT NULL,
        product_template_id TEXT NOT NULL,
        product_variant_id TEXT NOT NULL,
        on_hand_qty REAL NOT NULL,
        reserved_qty REAL NOT NULL,
        available_qty REAL NOT NULL,
        unit_cost REAL NOT NULL,
        total_value REAL NOT NULL,
        stock_move_id TEXT,
        valuation_fact_id TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS phase04_opening_stock_reservations (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL REFERENCES phase04_opening_stock_batches(id),
        company_id TEXT NOT NULL,
        legacy_material_id TEXT NOT NULL,
        product_variant_id TEXT NOT NULL,
        reservation_id TEXT NOT NULL,
        reserved_qty REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'reserved_unallocated',
        created_at TEXT NOT NULL
      ) STRICT;
    `);
  },

  down(dialect) {
    dialect.exec(`
      DROP TABLE IF EXISTS phase04_opening_stock_reservations;
      DROP TABLE IF EXISTS phase04_opening_stock_lines;
      DROP TABLE IF EXISTS phase04_opening_stock_batches;
      DELETE FROM stock_locations WHERE id = 'loc_opening_balance';
      DELETE FROM finance_journals WHERE id = 'jnl_opening';
      DELETE FROM finance_accounts WHERE id = 'acc_390000';
    `);
  }
};
