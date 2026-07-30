// database/migrations/078_hse_and_safety_management.mjs — HSE, Safety, Permits & Incident Management Module Migration.

export const migration = {
  id: '078_hse_and_safety_management',
  description: 'Migration 078: HSE, Safety, Permits to Work (PTW) & Incident Management (Incidents, Investigations, CAPAs, Permits, Hazards)',

  async up(db) {
    // 1. HSE Incidents
    db.prepare(`
      CREATE TABLE IF NOT EXISTS hse_incidents (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        incident_number TEXT NOT NULL,
        incident_date TEXT NOT NULL,
        location TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'near_miss', -- injury, near_miss, environmental_spill, property_damage, fire
        severity TEXT NOT NULL DEFAULT 'minor', -- minor, major, critical, fatal
        title TEXT NOT NULL,
        description TEXT,
        reporter_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'reported', -- reported, investigating, resolved, closed
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_hse_incidents_company_severity
      ON hse_incidents(company_id, severity, status)
    `).run();

    // 2. Incident Investigations
    db.prepare(`
      CREATE TABLE IF NOT EXISTS hse_incident_investigations (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        incident_id TEXT NOT NULL REFERENCES hse_incidents(id) ON DELETE CASCADE,
        investigator_id TEXT NOT NULL,
        root_cause_analysis TEXT NOT NULL,
        immediate_action_taken TEXT,
        investigation_date TEXT NOT NULL DEFAULT (datetime('now')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 3. Corrective & Preventive Actions (CAPAs)
    db.prepare(`
      CREATE TABLE IF NOT EXISTS hse_corrective_actions (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        capa_number TEXT NOT NULL,
        incident_id TEXT REFERENCES hse_incidents(id) ON DELETE SET NULL,
        action_description TEXT NOT NULL,
        assigned_to TEXT NOT NULL,
        target_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open', -- open, in_progress, completed, verified
        completed_at TEXT,
        verified_by TEXT,
        verified_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 4. Safety Permits to Work (PTW)
    db.prepare(`
      CREATE TABLE IF NOT EXISTS hse_safety_permits (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        permit_number TEXT NOT NULL,
        permit_type TEXT NOT NULL DEFAULT 'hot_work', -- hot_work, confined_space, working_at_height, electrical, excavation
        location TEXT NOT NULL,
        work_description TEXT NOT NULL,
        contractor_id TEXT,
        valid_from TEXT NOT NULL,
        valid_until TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'requested', -- requested, approved, issued, expired, closed, revoked
        issuer_id TEXT,
        issued_at TEXT,
        closed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_hse_safety_permits_company_status
      ON hse_safety_permits(company_id, status)
    `).run();

    // 5. Permit Safety Checklists
    db.prepare(`
      CREATE TABLE IF NOT EXISTS hse_permit_checklists (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        permit_id TEXT NOT NULL REFERENCES hse_safety_permits(id) ON DELETE CASCADE,
        check_item TEXT NOT NULL,
        is_verified INTEGER NOT NULL DEFAULT 0,
        verified_by TEXT,
        verified_at TEXT
      )
    `).run();

    // 6. Safety Inspections
    db.prepare(`
      CREATE TABLE IF NOT EXISTS hse_safety_inspections (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        inspection_number TEXT NOT NULL,
        facility_location TEXT NOT NULL,
        inspector_id TEXT NOT NULL,
        inspection_date TEXT NOT NULL,
        passed_items INTEGER NOT NULL DEFAULT 0,
        failed_items INTEGER NOT NULL DEFAULT 0,
        compliance_score_pct REAL NOT NULL DEFAULT 100.0,
        summary TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 7. Hazard Reports
    db.prepare(`
      CREATE TABLE IF NOT EXISTS hse_hazard_reports (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        hazard_number TEXT NOT NULL,
        location TEXT NOT NULL,
        hazard_type TEXT NOT NULL DEFAULT 'unsafe_condition', -- unsafe_act, unsafe_condition
        description TEXT NOT NULL,
        reported_by TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'reported', -- reported, mitigated, closed
        mitigation_summary TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();
  },

  async down(db) {
    const tables = [
      'hse_hazard_reports',
      'hse_safety_inspections',
      'hse_permit_checklists',
      'hse_safety_permits',
      'hse_corrective_actions',
      'hse_incident_investigations',
      'hse_incidents'
    ];
    for (const table of tables) {
      db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
    }
  }
};
