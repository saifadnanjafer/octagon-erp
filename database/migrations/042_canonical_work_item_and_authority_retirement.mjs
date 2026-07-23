// 042_canonical_work_item_and_authority_retirement — Phase 04.5 Remediation
//
// What this migration does:
//   1. Canonical Work Item foundation: `work_items` table supporting tasks, Kanban cards, work orders,
//      helpdesk assignments, QC rework, maintenance actions, and mobile tasks under ONE authority.
//   2. Canonical Stock Reservation Ledger: `stock_reservations` table supporting reservation, partial reservation,
//      release, expiration, reallocation, and consumption across warehouses and locations.
//   3. Authority Retirement Governance: `authority_retirement_locks` table to record retired legacy writer flags.

const MODULE_ID = 'work_item_canonical';

export const migration = {
  id: '042_canonical_work_item_and_authority_retirement',
  owner: MODULE_ID,
  version: '1.22.0',
  parent: '041_pos_foundation_and_commercial_cutover',
  dependsOn: ['041_pos_foundation_and_commercial_cutover'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  provenance: 'Phase 04.5 Canonical Work Item and Reservation Remediation Migration',

  up(db, { dialect }) {
    // 1. Canonical Work Items Table
    db.exec(`
      CREATE TABLE IF NOT EXISTS work_items (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        branch_id TEXT DEFAULT '*',
        department_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
        source_type TEXT NOT NULL DEFAULT 'task',
        source_id TEXT,
        source_line_id TEXT,
        parent_id TEXT,
        status TEXT NOT NULL DEFAULT 'todo',
        stage TEXT NOT NULL DEFAULT 'backlog',
        priority TEXT NOT NULL DEFAULT 'medium',
        importance INTEGER DEFAULT 3,
        assigned_user_id TEXT,
        assigned_team_id TEXT,
        start_date TEXT,
        due_date TEXT,
        completed_at TEXT,
        progress REAL DEFAULT 0.0,
        estimated_hours REAL DEFAULT 0.0,
        actual_hours REAL DEFAULT 0.0,
        inactivity_timestamp TEXT,
        sla_due_at TEXT,
        checklist_json TEXT,
        attachments_json TEXT,
        comments_json TEXT,
        project_ref TEXT,
        work_order_ref TEXT,
        helpdesk_ref TEXT,
        qc_ref TEXT,
        maintenance_ref TEXT,
        version INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_work_items_company_status ON work_items(company_id, status);
      CREATE INDEX IF NOT EXISTS idx_work_items_assigned ON work_items(assigned_user_id);
      CREATE INDEX IF NOT EXISTS idx_work_items_source ON work_items(source_type, source_id);
    `);

    // 2. Canonical Stock Reservation Ledger
    db.exec(`
      CREATE TABLE IF NOT EXISTS stock_reservations (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        branch_id TEXT DEFAULT '*',
        warehouse_id TEXT NOT NULL,
        location_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        variant_id TEXT,
        lot_id TEXT,
        package_id TEXT,
        source_document_type TEXT NOT NULL,
        source_document_id TEXT NOT NULL,
        source_line_id TEXT,
        quantity REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'reserved',
        priority INTEGER DEFAULT 10,
        expires_at TEXT,
        version INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_reservations_product_loc ON stock_reservations(product_id, warehouse_id, location_id);
      CREATE INDEX IF NOT EXISTS idx_reservations_source ON stock_reservations(source_document_type, source_document_id);
    `);

    // 3. Authority Retirement Governance Locks
    db.exec(`
      CREATE TABLE IF NOT EXISTS authority_retirement_locks (
        id TEXT PRIMARY KEY,
        authority_key TEXT UNIQUE NOT NULL,
        canonical_target TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'RETIRED',
        retired_at TEXT NOT NULL,
        reason TEXT NOT NULL
      );
    `);
  },

  down(db) {
    db.exec(`
      DROP TABLE IF EXISTS authority_retirement_locks;
      DROP TABLE IF EXISTS stock_reservations;
      DROP TABLE IF EXISTS work_items;
    `);
  }
};
