// database/migrations/071_advanced_procurement_and_supplier_portal.mjs — Advanced Procurement and Supplier Portal Module Migration.

function addColumnIfNotExists(db, table, columnDef) {
  const colName = columnDef.trim().split(/\s+/)[0];
  const info = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!info.some(c => c.name === colName)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`).run();
  }
}

export const migration = {
  id: '071_advanced_procurement_and_supplier_portal',
  description: 'Migration 071: Advanced Procurement & Supplier Portal (Requisitions, RFQs, Supplier Bids, Evaluations, Portal Access)',

  async up(db) {
    // 1. Supplier Qualifications
    db.prepare(`
      CREATE TABLE IF NOT EXISTS supplier_qualifications (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        supplier_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        rating REAL NOT NULL DEFAULT 5.0,
        notes TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    addColumnIfNotExists(db, 'supplier_qualifications', "qualification_type TEXT DEFAULT 'general'");
    addColumnIfNotExists(db, 'supplier_qualifications', 'verified_by TEXT');
    addColumnIfNotExists(db, 'supplier_qualifications', 'verified_at TEXT');
    addColumnIfNotExists(db, 'supplier_qualifications', 'expiry_date TEXT');
    addColumnIfNotExists(db, 'supplier_qualifications', 'document_url TEXT');
    addColumnIfNotExists(db, 'supplier_qualifications', "updated_at TEXT DEFAULT (datetime('now'))");

    // 2. Supplier Evaluations
    db.prepare(`
      CREATE TABLE IF NOT EXISTS supplier_evaluations (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        supplier_id TEXT NOT NULL,
        evaluation_period TEXT NOT NULL,
        quality_score REAL NOT NULL DEFAULT 0.0,
        delivery_score REAL NOT NULL DEFAULT 0.0,
        price_competitiveness_score REAL NOT NULL DEFAULT 0.0,
        overall_rating REAL NOT NULL DEFAULT 0.0,
        evaluator_id TEXT NOT NULL,
        comments TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 3. Purchase Requisitions (Forward migration enhancement)
    db.prepare(`
      CREATE TABLE IF NOT EXISTS purchase_requisitions (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        name TEXT NOT NULL,
        requested_by TEXT DEFAULT '',
        state TEXT NOT NULL DEFAULT 'draft',
        requisition_date TEXT NOT NULL DEFAULT (datetime('now')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    addColumnIfNotExists(db, 'purchase_requisitions', "requisition_number TEXT DEFAULT ''");
    addColumnIfNotExists(db, 'purchase_requisitions', "requester_id TEXT DEFAULT ''");
    addColumnIfNotExists(db, 'purchase_requisitions', 'department_id TEXT');
    addColumnIfNotExists(db, 'purchase_requisitions', "title TEXT DEFAULT ''");
    addColumnIfNotExists(db, 'purchase_requisitions', 'justification TEXT');
    addColumnIfNotExists(db, 'purchase_requisitions', 'total_estimated_cost REAL DEFAULT 0.0');
    addColumnIfNotExists(db, 'purchase_requisitions', "status TEXT DEFAULT 'draft'");
    addColumnIfNotExists(db, 'purchase_requisitions', 'approved_by TEXT');
    addColumnIfNotExists(db, 'purchase_requisitions', 'approved_at TEXT');
    addColumnIfNotExists(db, 'purchase_requisitions', "updated_at TEXT DEFAULT (datetime('now'))");

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_purchase_requisitions_company_status
      ON purchase_requisitions(company_id, status)
    `).run();

    // 4. Purchase Requisition Lines
    db.prepare(`
      CREATE TABLE IF NOT EXISTS purchase_requisition_lines (
        id TEXT PRIMARY KEY,
        requisition_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        qty REAL NOT NULL DEFAULT 1.0,
        uom_id TEXT NOT NULL DEFAULT 'uom-unit',
        estimated_unit_cost REAL NOT NULL DEFAULT 0.0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    addColumnIfNotExists(db, 'purchase_requisition_lines', "company_id TEXT DEFAULT '*'");
    addColumnIfNotExists(db, 'purchase_requisition_lines', 'quantity REAL DEFAULT 1.0');
    addColumnIfNotExists(db, 'purchase_requisition_lines', 'required_date TEXT');
    addColumnIfNotExists(db, 'purchase_requisition_lines', 'notes TEXT');

    // 5. RFQ Headers
    db.prepare(`
      CREATE TABLE IF NOT EXISTS rfq_headers (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        rfq_number TEXT NOT NULL,
        requisition_id TEXT REFERENCES purchase_requisitions(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        bid_submission_deadline TEXT NOT NULL,
        delivery_location TEXT,
        terms_and_conditions TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        published_at TEXT,
        awarded_bid_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_rfq_headers_company_status
      ON rfq_headers(company_id, status)
    `).run();

    // 6. RFQ Invited Suppliers
    db.prepare(`
      CREATE TABLE IF NOT EXISTS rfq_suppliers (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        rfq_id TEXT NOT NULL REFERENCES rfq_headers(id) ON DELETE CASCADE,
        supplier_id TEXT NOT NULL,
        invitation_status TEXT NOT NULL DEFAULT 'invited',
        invited_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 7. Supplier Bids
    db.prepare(`
      CREATE TABLE IF NOT EXISTS supplier_bids (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        bid_number TEXT NOT NULL,
        rfq_id TEXT NOT NULL REFERENCES rfq_headers(id) ON DELETE CASCADE,
        supplier_id TEXT NOT NULL,
        total_bid_amount REAL NOT NULL DEFAULT 0.0,
        currency TEXT NOT NULL DEFAULT 'USD',
        delivery_lead_time_days INTEGER NOT NULL DEFAULT 7,
        validity_end_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'submitted',
        submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
        evaluated_score REAL,
        evaluation_notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 8. Supplier Bid Lines
    db.prepare(`
      CREATE TABLE IF NOT EXISTS supplier_bid_lines (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        bid_id TEXT NOT NULL REFERENCES supplier_bids(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 1.0,
        unit_price REAL NOT NULL DEFAULT 0.0,
        total_line_amount REAL NOT NULL DEFAULT 0.0,
        delivery_date TEXT,
        specifications_match INTEGER NOT NULL DEFAULT 1,
        notes TEXT
      )
    `).run();

    // 9. Procurement Framework Contracts
    db.prepare(`
      CREATE TABLE IF NOT EXISTS procurement_contracts (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        contract_number TEXT NOT NULL,
        supplier_id TEXT NOT NULL,
        title TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        max_value REAL NOT NULL DEFAULT 0.0,
        spent_value REAL NOT NULL DEFAULT 0.0,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 10. Supplier Portal Access
    db.prepare(`
      CREATE TABLE IF NOT EXISTS supplier_portal_access (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        supplier_id TEXT NOT NULL,
        portal_user_email TEXT NOT NULL,
        access_token_hash TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        last_login_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 11. Vendor Non-Conformances (NCRs)
    db.prepare(`
      CREATE TABLE IF NOT EXISTS vendor_non_conformances (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        ncr_number TEXT NOT NULL,
        supplier_id TEXT NOT NULL,
        po_id TEXT,
        defect_description TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'minor',
        status TEXT NOT NULL DEFAULT 'open',
        resolution_action TEXT,
        cost_impact REAL NOT NULL DEFAULT 0.0,
        issued_at TEXT NOT NULL DEFAULT (datetime('now')),
        closed_at TEXT
      )
    `).run();
  },

  async down(db) {
    const tables = [
      'vendor_non_conformances',
      'supplier_portal_access',
      'procurement_contracts',
      'supplier_bid_lines',
      'supplier_bids',
      'rfq_suppliers',
      'rfq_headers',
      'supplier_evaluations'
    ];
    for (const table of tables) {
      db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
    }
  }
};
