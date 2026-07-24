// 036_party_product_uom_pricing_foundation — Phase 04 Wave A
//
// Source composition:
// - MERGE-SALVAGE: Salvaged from VNext vnext/server/modules/{products,pricing}/
// - SPEC-IMPLEMENT: Built directly from Phase 04 Specification & Odoo 19 / AureusERP / ERPNext models
//
// What this migration does:
//   1. Shared Party Identity: parties, party_roles, contacts, addresses
//   2. Units of Measure: uom_categories, uoms
//   3. Product Master: product_categories, product_templates, product_variants, product_barcodes
//   4. Pricing: price_lists, price_list_items

const MODULE_ID = 'commercial_master';

export const migration = {
  id: '036_party_product_uom_pricing_foundation',
  owner: MODULE_ID,
  version: '1.22.0',
  parent: '035_governed_finance_cutover_and_tax_attribution',
  dependsOn: ['035_governed_finance_cutover_and_tax_attribution'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Phase 04 Wave A Commercial Master Migration',

  up(db, { dialect }) {
    // 1. Shared Party Identity
    db.exec(`
      CREATE TABLE IF NOT EXISTS parties (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        is_company INTEGER NOT NULL DEFAULT 0,
        name TEXT NOT NULL,
        legal_name TEXT DEFAULT '',
        tax_id TEXT DEFAULT '',
        registration_number TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS party_roles (
        id TEXT PRIMARY KEY,
        party_id TEXT NOT NULL,
        role TEXT NOT NULL,
        company_id TEXT NOT NULL DEFAULT '*',
        created_at TEXT NOT NULL,
        FOREIGN KEY (party_id) REFERENCES parties(id) ON DELETE CASCADE,
        UNIQUE(party_id, role, company_id)
      );

      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        party_id TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        job_title TEXT DEFAULT '',
        is_primary INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (party_id) REFERENCES parties(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS addresses (
        id TEXT PRIMARY KEY,
        party_id TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'billing',
        street TEXT DEFAULT '',
        city TEXT DEFAULT '',
        state TEXT DEFAULT '',
        country TEXT DEFAULT '',
        postal_code TEXT DEFAULT '',
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (party_id) REFERENCES parties(id) ON DELETE CASCADE
      );
    `);

    // 2. Units of Measure
    db.exec(`
      CREATE TABLE IF NOT EXISTS uom_categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS uoms (
        id TEXT PRIMARY KEY,
        category_id TEXT NOT NULL,
        name TEXT NOT NULL,
        symbol TEXT DEFAULT '',
        uom_type TEXT NOT NULL DEFAULT 'reference',
        factor REAL NOT NULL DEFAULT 1.0,
        rounding REAL NOT NULL DEFAULT 0.001,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        FOREIGN KEY (category_id) REFERENCES uom_categories(id) ON DELETE CASCADE
      );
    `);

    // 3. Product Master
    db.exec(`
      CREATE TABLE IF NOT EXISTS product_categories (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        parent_id TEXT DEFAULT NULL,
        name TEXT NOT NULL,
        code TEXT DEFAULT '',
        costing_method TEXT NOT NULL DEFAULT 'avco',
        valuation_method TEXT NOT NULL DEFAULT 'real_time',
        income_account_id TEXT DEFAULT '',
        expense_account_id TEXT DEFAULT '',
        stock_account_id TEXT DEFAULT '',
        stock_input_account_id TEXT DEFAULT '',
        stock_output_account_id TEXT DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS product_templates (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        name TEXT NOT NULL,
        code TEXT DEFAULT '',
        type TEXT NOT NULL DEFAULT 'storable',
        category_id TEXT DEFAULT '',
        uom_id TEXT DEFAULT '',
        purchase_uom_id TEXT DEFAULT '',
        list_price REAL NOT NULL DEFAULT 0.0,
        standard_price REAL NOT NULL DEFAULT 0.0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS product_variants (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL,
        company_id TEXT NOT NULL DEFAULT '*',
        sku TEXT NOT NULL,
        name TEXT NOT NULL,
        variant_attributes TEXT DEFAULT '{}',
        list_price_extra REAL NOT NULL DEFAULT 0.0,
        standard_price REAL NOT NULL DEFAULT 0.0,
        barcode TEXT DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        FOREIGN KEY (template_id) REFERENCES product_templates(id) ON DELETE CASCADE,
        UNIQUE(company_id, sku)
      );

      CREATE TABLE IF NOT EXISTS product_barcodes (
        id TEXT PRIMARY KEY,
        variant_id TEXT NOT NULL,
        barcode TEXT NOT NULL,
        barcode_type TEXT NOT NULL DEFAULT 'ean13',
        is_primary INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE,
        UNIQUE(barcode)
      );
    `);

    // 4. Pricing
    db.exec(`
      CREATE TABLE IF NOT EXISTS price_lists (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        name TEXT NOT NULL,
        currency_id TEXT NOT NULL DEFAULT 'IQD',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS price_list_items (
        id TEXT PRIMARY KEY,
        price_list_id TEXT NOT NULL,
        applied_on TEXT NOT NULL DEFAULT 'all',
        category_id TEXT DEFAULT NULL,
        template_id TEXT DEFAULT NULL,
        variant_id TEXT DEFAULT NULL,
        min_quantity REAL NOT NULL DEFAULT 0.0,
        price_discount REAL NOT NULL DEFAULT 0.0,
        fixed_price REAL DEFAULT NULL,
        valid_from TEXT DEFAULT NULL,
        valid_to TEXT DEFAULT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (price_list_id) REFERENCES price_lists(id) ON DELETE CASCADE
      );
    `);
  },

  down(db, { dialect }) {
    db.exec(`
      DROP TABLE IF EXISTS price_list_items;
      DROP TABLE IF EXISTS price_lists;
      DROP TABLE IF EXISTS product_barcodes;
      DROP TABLE IF EXISTS product_variants;
      DROP TABLE IF EXISTS product_templates;
      DROP TABLE IF EXISTS product_categories;
      DROP TABLE IF EXISTS uoms;
      DROP TABLE IF EXISTS uom_categories;
      DROP TABLE IF EXISTS addresses;
      DROP TABLE IF EXISTS contacts;
      DROP TABLE IF EXISTS party_roles;
      DROP TABLE IF EXISTS parties;
    `);
  }
};
