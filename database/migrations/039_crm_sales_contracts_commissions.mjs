// 039_crm_sales_contracts_commissions — Phase 04 Wave D
//
// Source composition:
// - MERGE-SALVAGE: Salvaged from VNext vnext/server/modules/sales/ & vnext/server/modules/campaign/
// - SPEC-IMPLEMENT: Built directly from Phase 04 Specification & Odoo 19 / ERPNext selling & CRM models
//
// What this migration does:
//   1. CRM Leads & Activities: crm_leads, crm_activities
//   2. Sales Orders & Lines: sale_orders, sale_order_lines
//   3. Contracts & Commissions: sale_contracts, sales_commission_events

const MODULE_ID = 'commercial_sales';

export const migration = {
  id: '039_crm_sales_contracts_commissions',
  owner: MODULE_ID,
  version: '1.22.0',
  parent: '038_wms_operations_cycle_counts_landed_cost',
  dependsOn: ['038_wms_operations_cycle_counts_landed_cost'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Phase 04 Wave D Sales Migration',

  up(db, { dialect }) {
    // 1. CRM
    db.exec(`
      CREATE TABLE IF NOT EXISTS crm_leads (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        name TEXT NOT NULL,
        partner_id TEXT DEFAULT NULL,
        contact_name TEXT DEFAULT '',
        email TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        stage TEXT NOT NULL DEFAULT 'new',
        expected_revenue REAL NOT NULL DEFAULT 0.0,
        probability REAL NOT NULL DEFAULT 10.0,
        salesperson_id TEXT DEFAULT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (partner_id) REFERENCES parties(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS crm_activities (
        id TEXT PRIMARY KEY,
        lead_id TEXT NOT NULL,
        activity_type TEXT NOT NULL DEFAULT 'note',
        summary TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        due_date TEXT DEFAULT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (lead_id) REFERENCES crm_leads(id) ON DELETE CASCADE
      );
    `);

    // 2. Sales Orders & Lines
    db.exec(`
      CREATE TABLE IF NOT EXISTS sale_orders (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        name TEXT NOT NULL,
        partner_id TEXT NOT NULL,
        pricelist_id TEXT DEFAULT NULL,
        currency_id TEXT NOT NULL DEFAULT 'IQD',
        state TEXT NOT NULL DEFAULT 'draft',
        amount_untaxed REAL NOT NULL DEFAULT 0.0,
        amount_tax REAL NOT NULL DEFAULT 0.0,
        amount_total REAL NOT NULL DEFAULT 0.0,
        order_date TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (partner_id) REFERENCES parties(id),
        FOREIGN KEY (pricelist_id) REFERENCES price_lists(id)
      );

      CREATE TABLE IF NOT EXISTS sale_order_lines (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        name TEXT NOT NULL,
        product_uom_qty REAL NOT NULL DEFAULT 1.0,
        qty_delivered REAL NOT NULL DEFAULT 0.0,
        qty_invoiced REAL NOT NULL DEFAULT 0.0,
        product_uom TEXT NOT NULL,
        price_unit REAL NOT NULL DEFAULT 0.0,
        discount REAL NOT NULL DEFAULT 0.0,
        price_subtotal REAL NOT NULL DEFAULT 0.0,
        price_total REAL NOT NULL DEFAULT 0.0,
        tax_id TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY (order_id) REFERENCES sale_orders(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES product_variants(id)
      );
    `);

    // 3. Contracts & Commissions
    db.exec(`
      CREATE TABLE IF NOT EXISTS sale_contracts (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        name TEXT NOT NULL,
        partner_id TEXT NOT NULL,
        sale_order_id TEXT DEFAULT NULL,
        state TEXT NOT NULL DEFAULT 'draft',
        start_date TEXT NOT NULL,
        end_date TEXT DEFAULT NULL,
        recurring_amount REAL NOT NULL DEFAULT 0.0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (partner_id) REFERENCES parties(id),
        FOREIGN KEY (sale_order_id) REFERENCES sale_orders(id)
      );

      CREATE TABLE IF NOT EXISTS sales_commission_events (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        salesperson_id TEXT NOT NULL,
        sale_order_id TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0.0,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        FOREIGN KEY (sale_order_id) REFERENCES sale_orders(id)
      );
    `);
  },

  down(db, { dialect }) {
    db.exec(`
      DROP TABLE IF EXISTS sales_commission_events;
      DROP TABLE IF EXISTS sale_contracts;
      DROP TABLE IF EXISTS sale_order_lines;
      DROP TABLE IF EXISTS sale_orders;
      DROP TABLE IF EXISTS crm_activities;
      DROP TABLE IF EXISTS crm_leads;
    `);
  }
};
