// 038_wms_operations_cycle_counts_landed_cost — Phase 04 Wave C
//
// Source composition:
// - MERGE-SALVAGE: Salvaged from VNext vnext/server/modules/inventory/
// - SPEC-IMPLEMENT: Built directly from Phase 04 Specification & Odoo 19 / ERPNext landed cost & WMS models
//
// What this migration does:
//   1. Stock Pickings & Types: stock_picking_types, stock_pickings, stock_packages
//   2. Cycle Counts & Adjustments: stock_inventory_counts, stock_inventory_count_lines
//   3. Landed Costs: landed_costs, landed_cost_lines

const MODULE_ID = 'stock_wms';

export const migration = {
  id: '038_wms_operations_cycle_counts_landed_cost',
  owner: MODULE_ID,
  version: '1.22.0',
  parent: '037_warehouse_stock_ledger_valuation',
  dependsOn: ['037_warehouse_stock_ledger_valuation'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  provenance: 'Phase 04 Wave C WMS Migration',

  up(db, { dialect }) {
    // 1. Stock Pickings & Types
    db.exec(`
      CREATE TABLE IF NOT EXISTS stock_picking_types (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        warehouse_id TEXT NOT NULL,
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        default_location_src_id TEXT DEFAULT NULL,
        default_location_dest_id TEXT DEFAULT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS stock_pickings (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        picking_type_id TEXT NOT NULL,
        reference TEXT NOT NULL,
        origin TEXT DEFAULT '',
        location_id TEXT NOT NULL,
        location_dest_id TEXT NOT NULL,
        partner_id TEXT DEFAULT NULL,
        state TEXT NOT NULL DEFAULT 'draft',
        scheduled_date TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (picking_type_id) REFERENCES stock_picking_types(id),
        FOREIGN KEY (location_id) REFERENCES stock_locations(id),
        FOREIGN KEY (location_dest_id) REFERENCES stock_locations(id)
      );

      CREATE TABLE IF NOT EXISTS stock_packages (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        name TEXT NOT NULL,
        package_type TEXT DEFAULT 'box',
        location_id TEXT DEFAULT NULL,
        created_at TEXT NOT NULL
      );
    `);

    // 2. Cycle Counts & Adjustments
    db.exec(`
      CREATE TABLE IF NOT EXISTS stock_inventory_counts (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        name TEXT NOT NULL,
        location_id TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'draft',
        count_date TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (location_id) REFERENCES stock_locations(id)
      );

      CREATE TABLE IF NOT EXISTS stock_inventory_count_lines (
        id TEXT PRIMARY KEY,
        count_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        theoretical_qty REAL NOT NULL DEFAULT 0.0,
        real_qty REAL NOT NULL DEFAULT 0.0,
        difference_qty REAL NOT NULL DEFAULT 0.0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (count_id) REFERENCES stock_inventory_counts(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES product_variants(id)
      );
    `);

    // 3. Landed Costs
    db.exec(`
      CREATE TABLE IF NOT EXISTS landed_costs (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        name TEXT NOT NULL,
        vendor_bill_id TEXT DEFAULT NULL,
        split_method TEXT NOT NULL DEFAULT 'by_quantity',
        state TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS landed_cost_lines (
        id TEXT PRIMARY KEY,
        landed_cost_id TEXT NOT NULL,
        cost_type TEXT NOT NULL DEFAULT 'freight',
        amount REAL NOT NULL DEFAULT 0.0,
        account_id TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY (landed_cost_id) REFERENCES landed_costs(id) ON DELETE CASCADE
      );
    `);
  },

  down(db, { dialect }) {
    db.exec(`
      DROP TABLE IF EXISTS landed_cost_lines;
      DROP TABLE IF EXISTS landed_costs;
      DROP TABLE IF EXISTS stock_inventory_count_lines;
      DROP TABLE IF EXISTS stock_inventory_counts;
      DROP TABLE IF EXISTS stock_packages;
      DROP TABLE IF EXISTS stock_pickings;
      DROP TABLE IF EXISTS stock_picking_types;
    `);
  }
};
