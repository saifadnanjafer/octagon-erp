// 040_suppliers_procurement_threeway_match — Phase 04 Wave E
//
// Source composition:
// - MERGE-SALVAGE: Salvaged from VNext vnext/server/modules/procurement/ & vnext/server/modules/subcontracting/
// - SPEC-IMPLEMENT: Built directly from Phase 04 Specification & Odoo 19 / ERPNext buying models
//
// What this migration does:
//   1. Supplier Governance & Requisitions: supplier_qualifications, purchase_requisitions, purchase_requisition_lines
//   2. RFQs & Supplier Bids: purchase_rfqs, supplier_quotations
//   3. Purchase Orders & Three-Way Match: purchase_orders, purchase_order_lines, three_way_matches

const MODULE_ID = 'commercial_procurement';

export const migration = {
  id: '040_suppliers_procurement_threeway_match',
  owner: MODULE_ID,
  parent: '039_crm_sales_contracts_commissions',

  up(db, { dialect }) {
    // 1. Supplier Governance & Requisitions
    db.exec(`
      CREATE TABLE IF NOT EXISTS supplier_qualifications (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        supplier_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'approved',
        rating REAL NOT NULL DEFAULT 5.0,
        notes TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY (supplier_id) REFERENCES parties(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS purchase_requisitions (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        name TEXT NOT NULL,
        requested_by TEXT DEFAULT '',
        state TEXT NOT NULL DEFAULT 'draft',
        requisition_date TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS purchase_requisition_lines (
        id TEXT PRIMARY KEY,
        requisition_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        qty REAL NOT NULL DEFAULT 1.0,
        uom_id TEXT NOT NULL,
        estimated_unit_cost REAL NOT NULL DEFAULT 0.0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (requisition_id) REFERENCES purchase_requisitions(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES product_variants(id)
      );
    `);

    // 2. RFQs & Supplier Bids
    db.exec(`
      CREATE TABLE IF NOT EXISTS purchase_rfqs (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        name TEXT NOT NULL,
        requisition_id TEXT DEFAULT NULL,
        state TEXT NOT NULL DEFAULT 'draft',
        deadline TEXT DEFAULT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (requisition_id) REFERENCES purchase_requisitions(id)
      );

      CREATE TABLE IF NOT EXISTS supplier_quotations (
        id TEXT PRIMARY KEY,
        rfq_id TEXT NOT NULL,
        supplier_id TEXT NOT NULL,
        currency_id TEXT NOT NULL DEFAULT 'IQD',
        total_amount REAL NOT NULL DEFAULT 0.0,
        valid_until TEXT DEFAULT NULL,
        is_awarded INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (rfq_id) REFERENCES purchase_rfqs(id) ON DELETE CASCADE,
        FOREIGN KEY (supplier_id) REFERENCES parties(id)
      );
    `);

    // 3. Purchase Orders & Three-Way Match
    db.exec(`
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        name TEXT NOT NULL,
        supplier_id TEXT NOT NULL,
        rfq_id TEXT DEFAULT NULL,
        currency_id TEXT NOT NULL DEFAULT 'IQD',
        state TEXT NOT NULL DEFAULT 'draft',
        amount_untaxed REAL NOT NULL DEFAULT 0.0,
        amount_tax REAL NOT NULL DEFAULT 0.0,
        amount_total REAL NOT NULL DEFAULT 0.0,
        order_date TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (supplier_id) REFERENCES parties(id),
        FOREIGN KEY (rfq_id) REFERENCES purchase_rfqs(id)
      );

      CREATE TABLE IF NOT EXISTS purchase_order_lines (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        name TEXT NOT NULL,
        product_qty REAL NOT NULL DEFAULT 1.0,
        qty_received REAL NOT NULL DEFAULT 0.0,
        qty_billed REAL NOT NULL DEFAULT 0.0,
        product_uom TEXT NOT NULL,
        price_unit REAL NOT NULL DEFAULT 0.0,
        price_subtotal REAL NOT NULL DEFAULT 0.0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES product_variants(id)
      );

      CREATE TABLE IF NOT EXISTS three_way_matches (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        purchase_order_id TEXT NOT NULL,
        receipt_picking_id TEXT DEFAULT NULL,
        supplier_bill_id TEXT DEFAULT NULL,
        match_status TEXT NOT NULL DEFAULT 'pending',
        notes TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id)
      );
    `);
  },

  down(db, { dialect }) {
    db.exec(`
      DROP TABLE IF EXISTS three_way_matches;
      DROP TABLE IF EXISTS purchase_order_lines;
      DROP TABLE IF EXISTS purchase_orders;
      DROP TABLE IF EXISTS supplier_quotations;
      DROP TABLE IF EXISTS purchase_rfqs;
      DROP TABLE IF EXISTS purchase_requisition_lines;
      DROP TABLE IF EXISTS purchase_requisitions;
      DROP TABLE IF EXISTS supplier_qualifications;
    `);
  }
};
