// database/migrations/077_grc_and_internal_audit.mjs — Governance, Risk, Compliance & Internal Audit Module Migration.

export const migration = {
  id: '077_grc_and_internal_audit',
  description: 'Migration 077: GRC & Internal Audit (Risk Registers, Mitigations, Controls, Control Testing, Internal Audits, Audit Findings)',

  async up(db) {
    // 1. Risk Registers
    db.prepare(`
      CREATE TABLE IF NOT EXISTS grc_risk_registers (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        risk_number TEXT NOT NULL,
        title TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'operational', -- operational, financial, compliance, strategic, IT
        description TEXT,
        likelihood_rating INTEGER NOT NULL DEFAULT 3, -- 1 (Rare) to 5 (Almost Certain)
        impact_rating INTEGER NOT NULL DEFAULT 3, -- 1 (Insignificant) to 5 (Catastrophic)
        risk_score INTEGER NOT NULL DEFAULT 9, -- likelihood * impact (1-25)
        risk_level TEXT NOT NULL DEFAULT 'medium', -- low (1-4), medium (5-12), high (13-19), critical (20-25)
        risk_owner_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open', -- open, mitigated, accepted, closed
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_grc_risk_registers_company_level
      ON grc_risk_registers(company_id, risk_level, status)
    `).run();

    // 2. Risk Mitigations
    db.prepare(`
      CREATE TABLE IF NOT EXISTS grc_risk_mitigations (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        risk_id TEXT NOT NULL REFERENCES grc_risk_registers(id) ON DELETE CASCADE,
        action_description TEXT NOT NULL,
        assigned_to TEXT NOT NULL,
        target_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'planned', -- planned, in_progress, completed
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 3. Compliance Frameworks
    db.prepare(`
      CREATE TABLE IF NOT EXISTS grc_compliance_frameworks (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        version TEXT NOT NULL DEFAULT '1.0',
        governing_body TEXT,
        description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 4. Compliance Controls
    db.prepare(`
      CREATE TABLE IF NOT EXISTS grc_compliance_controls (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        framework_id TEXT REFERENCES grc_compliance_frameworks(id) ON DELETE CASCADE,
        control_code TEXT NOT NULL,
        title TEXT NOT NULL,
        control_type TEXT NOT NULL DEFAULT 'detective', -- preventive, detective, corrective
        testing_frequency TEXT NOT NULL DEFAULT 'quarterly', -- monthly, quarterly, annual
        control_owner_id TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 5. Control Evaluations
    db.prepare(`
      CREATE TABLE IF NOT EXISTS grc_control_evaluations (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        evaluation_number TEXT NOT NULL,
        control_id TEXT NOT NULL REFERENCES grc_compliance_controls(id) ON DELETE CASCADE,
        tester_id TEXT NOT NULL,
        test_date TEXT NOT NULL,
        result TEXT NOT NULL DEFAULT 'effective', -- effective, partially_effective, ineffective
        evidence_notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 6. Internal Audits
    db.prepare(`
      CREATE TABLE IF NOT EXISTS grc_internal_audits (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        audit_number TEXT NOT NULL,
        title TEXT NOT NULL,
        scope TEXT NOT NULL,
        lead_auditor_id TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'planned', -- planned, field_work, reporting, completed
        executive_summary TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_grc_internal_audits_company_status
      ON grc_internal_audits(company_id, status)
    `).run();

    // 7. Audit Findings
    db.prepare(`
      CREATE TABLE IF NOT EXISTS grc_audit_findings (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        finding_number TEXT NOT NULL,
        audit_id TEXT NOT NULL REFERENCES grc_internal_audits(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'medium', -- low, medium, high, critical
        description TEXT NOT NULL,
        recommendation TEXT,
        action_plan TEXT,
        target_closure_date TEXT,
        status TEXT NOT NULL DEFAULT 'open', -- open, remediated, closed
        closed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();
  },

  async down(db) {
    const tables = [
      'grc_audit_findings',
      'grc_internal_audits',
      'grc_control_evaluations',
      'grc_compliance_controls',
      'grc_compliance_frameworks',
      'grc_risk_mitigations',
      'grc_risk_registers'
    ];
    for (const table of tables) {
      db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
    }
  }
};
