// database/migrations/076_plm_and_engineering_change_control.mjs — PLM and Engineering Change Control Module Migration.

export const migration = {
  id: '076_plm_and_engineering_change_control',
  description: 'Migration 076: PLM & Engineering Change Control (Revisions, ECOs, Affected Items, Approvals, CAD Attachments)',

  async up(db) {
    // 1. Engineering Revisions
    db.prepare(`
      CREATE TABLE IF NOT EXISTS plm_engineering_revisions (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        revision_number TEXT NOT NULL,
        product_id TEXT NOT NULL,
        revision_code TEXT NOT NULL DEFAULT 'Rev A',
        change_summary TEXT,
        status TEXT NOT NULL DEFAULT 'active', -- draft, active, superseded, archived
        released_by TEXT,
        released_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_plm_engineering_revisions_product
      ON plm_engineering_revisions(company_id, product_id, revision_code)
    `).run();

    // 2. Engineering Change Orders (ECOs)
    db.prepare(`
      CREATE TABLE IF NOT EXISTS plm_engineering_change_orders (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        eco_number TEXT NOT NULL,
        title TEXT NOT NULL,
        change_type TEXT NOT NULL DEFAULT 'design_update', -- design_update, material_substitution, cost_reduction, safety
        priority TEXT NOT NULL DEFAULT 'medium', -- low, medium, high, critical
        change_reason TEXT,
        status TEXT NOT NULL DEFAULT 'draft', -- draft, in_review, approved, implemented, rejected
        initiator_id TEXT NOT NULL,
        approved_by TEXT,
        approved_at TEXT,
        implemented_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_plm_ecos_company_status
      ON plm_engineering_change_orders(company_id, status)
    `).run();

    // 3. ECO Affected Items
    db.prepare(`
      CREATE TABLE IF NOT EXISTS plm_eco_affected_items (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        eco_id TEXT NOT NULL REFERENCES plm_engineering_change_orders(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL,
        current_revision_code TEXT NOT NULL,
        new_revision_code TEXT NOT NULL,
        action_type TEXT NOT NULL DEFAULT 'modify', -- add, modify, obsolete
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 4. ECO Approvals
    db.prepare(`
      CREATE TABLE IF NOT EXISTS plm_eco_approvals (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        eco_id TEXT NOT NULL REFERENCES plm_engineering_change_orders(id) ON DELETE CASCADE,
        department TEXT NOT NULL, -- engineering, quality, production, supply_chain
        approver_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected
        comments TEXT,
        acted_at TEXT
      )
    `).run();

    // 5. CAD & Technical Documents
    db.prepare(`
      CREATE TABLE IF NOT EXISTS plm_cad_documents (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        revision_id TEXT NOT NULL REFERENCES plm_engineering_revisions(id) ON DELETE CASCADE,
        document_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_format TEXT NOT NULL DEFAULT 'STEP', -- STEP, IGES, DWG, PDF
        file_size INTEGER,
        uploaded_by TEXT NOT NULL,
        uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();
  },

  async down(db) {
    const tables = [
      'plm_cad_documents',
      'plm_eco_approvals',
      'plm_eco_affected_items',
      'plm_engineering_change_orders',
      'plm_engineering_revisions'
    ];
    for (const table of tables) {
      db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
    }
  }
};
