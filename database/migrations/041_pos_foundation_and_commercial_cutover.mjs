// 041_pos_foundation_and_commercial_cutover — Phase 04 Wave F
//
// Source composition:
// - MERGE-SALVAGE: Salvaged from VNext vnext/server/modules/pos/
// - SPEC-IMPLEMENT: Built directly from Phase 04 Specification & POS shared engine
//
// What this migration does:
//   1. POS Shared Engine: pos_sessions, pos_orders, pos_order_lines, pos_payments
//   2. Commercial Cutover Governance: commercial_cutover_settings, commercial_cutover_history

const MODULE_ID = 'commercial_cutover';

export const migration = {
  id: '041_pos_foundation_and_commercial_cutover',
  owner: MODULE_ID,
  version: '1.22.0',
  parent: '040_suppliers_procurement_threeway_match',
  dependsOn: ['040_suppliers_procurement_threeway_match'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Phase 04 Wave F POS & Cutover Migration',

  up(db, { dialect }) {
    // 1. POS Shared Engine
    db.exec(`
      CREATE TABLE IF NOT EXISTS pos_sessions (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        name TEXT NOT NULL,
        user_id TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'opened',
        start_at TEXT NOT NULL,
        stop_at TEXT DEFAULT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pos_orders (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        session_id TEXT NOT NULL,
        name TEXT NOT NULL,
        partner_id TEXT DEFAULT NULL,
        amount_total REAL NOT NULL DEFAULT 0.0,
        state TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES pos_sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS pos_order_lines (
        id TEXT PRIMARY KEY,
        pos_order_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        qty REAL NOT NULL DEFAULT 1.0,
        price_unit REAL NOT NULL DEFAULT 0.0,
        discount REAL NOT NULL DEFAULT 0.0,
        price_subtotal REAL NOT NULL DEFAULT 0.0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (pos_order_id) REFERENCES pos_orders(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES product_variants(id)
      );

      CREATE TABLE IF NOT EXISTS pos_payments (
        id TEXT PRIMARY KEY,
        pos_order_id TEXT NOT NULL,
        payment_method_id TEXT NOT NULL DEFAULT 'cash',
        amount REAL NOT NULL DEFAULT 0.0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (pos_order_id) REFERENCES pos_orders(id) ON DELETE CASCADE
      );
    `);

    // 2. Commercial Cutover Governance
    db.exec(`
      CREATE TABLE IF NOT EXISTS commercial_cutover_settings (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        module_name TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'CANONICAL_ONLY',
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, module_name)
      );

      CREATE TABLE IF NOT EXISTS commercial_cutover_history (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        module_name TEXT NOT NULL,
        from_state TEXT NOT NULL,
        to_state TEXT NOT NULL,
        actor TEXT NOT NULL DEFAULT 'system',
        reason TEXT DEFAULT '',
        created_at TEXT NOT NULL
      );
    `);

    // Seed default CANONICAL_ONLY cutover state for fresh databases
    const modules = ['inventory', 'sales', 'procurement', 'crm', 'pos'];
    const now = new Date().toISOString();

    for (const mod of modules) {
      db.exec(`
        INSERT OR IGNORE INTO commercial_cutover_settings (id, company_id, module_name, state, updated_at)
        VALUES ('ccs_${mod}_default', '*', '${mod}', 'CANONICAL_ONLY', '${now}');
      `);
    }
  },

  down(db, { dialect }) {
    db.exec(`
      DROP TABLE IF EXISTS commercial_cutover_history;
      DROP TABLE IF EXISTS commercial_cutover_settings;
      DROP TABLE IF EXISTS pos_payments;
      DROP TABLE IF EXISTS pos_order_lines;
      DROP TABLE IF EXISTS pos_orders;
      DROP TABLE IF EXISTS pos_sessions;
    `);
  }
};
