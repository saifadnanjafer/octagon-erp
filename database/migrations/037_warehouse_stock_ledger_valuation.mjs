// 037_warehouse_stock_ledger_valuation — Phase 04 Wave B
//
// Source composition:
// - MERGE-SALVAGE: Salvaged from VNext vnext/server/modules/inventory/
// - SPEC-IMPLEMENT: Built directly from Phase 04 Specification & Odoo 19 / ERPNext stock ledger models
//
// What this migration does:
//   1. Warehouses & Locations: warehouses, stock_locations
//   2. Stock Ledger & Balances: stock_moves, stock_quants, stock_valuation_layers

const MODULE_ID = 'stock_inventory';

export const migration = {
  id: '037_warehouse_stock_ledger_valuation',
  owner: MODULE_ID,
  version: '1.22.0',
  parent: '036_party_product_uom_pricing_foundation',
  dependsOn: ['036_party_product_uom_pricing_foundation'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Phase 04 Wave B Inventory Migration',

  up(db, { dialect }) {
    // 1. Warehouses & Locations
    db.exec(`
      CREATE TABLE IF NOT EXISTS warehouses (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        view_location_id TEXT DEFAULT NULL,
        lot_stock_id TEXT DEFAULT NULL,
        input_location_id TEXT DEFAULT NULL,
        output_location_id TEXT DEFAULT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS stock_locations (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        warehouse_id TEXT DEFAULT NULL,
        parent_id TEXT DEFAULT NULL,
        name TEXT NOT NULL,
        complete_name TEXT NOT NULL,
        usage TEXT NOT NULL DEFAULT 'internal',
        is_scrap INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE SET NULL
      );
    `);

    // 2. Stock Ledger & Valuation
    db.exec(`
      CREATE TABLE IF NOT EXISTS stock_moves (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        reference TEXT NOT NULL,
        product_id TEXT NOT NULL,
        uom_id TEXT NOT NULL,
        product_qty REAL NOT NULL,
        location_id TEXT NOT NULL,
        location_dest_id TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'draft',
        unit_cost REAL NOT NULL DEFAULT 0.0,
        total_value REAL NOT NULL DEFAULT 0.0,
        move_date TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (product_id) REFERENCES product_variants(id),
        FOREIGN KEY (location_id) REFERENCES stock_locations(id),
        FOREIGN KEY (location_dest_id) REFERENCES stock_locations(id)
      );

      CREATE TABLE IF NOT EXISTS stock_quants (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        product_id TEXT NOT NULL,
        location_id TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 0.0,
        reserved_quantity REAL NOT NULL DEFAULT 0.0,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (product_id) REFERENCES product_variants(id) ON DELETE CASCADE,
        FOREIGN KEY (location_id) REFERENCES stock_locations(id) ON DELETE CASCADE,
        UNIQUE(company_id, product_id, location_id)
      );

      CREATE TABLE IF NOT EXISTS stock_valuation_layers (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        product_id TEXT NOT NULL,
        stock_move_id TEXT NOT NULL,
        quantity REAL NOT NULL,
        unit_cost REAL NOT NULL,
        value REAL NOT NULL,
        remaining_qty REAL NOT NULL,
        remaining_value REAL NOT NULL,
        costing_method TEXT NOT NULL DEFAULT 'avco',
        account_move_id TEXT DEFAULT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (product_id) REFERENCES product_variants(id) ON DELETE CASCADE,
        FOREIGN KEY (stock_move_id) REFERENCES stock_moves(id) ON DELETE CASCADE
      );
    `);
  },

  down(db, { dialect }) {
    db.exec(`
      DROP TABLE IF EXISTS stock_valuation_layers;
      DROP TABLE IF EXISTS stock_quants;
      DROP TABLE IF EXISTS stock_moves;
      DROP TABLE IF EXISTS stock_locations;
      DROP TABLE IF EXISTS warehouses;
    `);
  }
};
