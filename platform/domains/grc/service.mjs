// platform/domains/grc/service.mjs — Governance, Risk, Compliance & Internal Audit Domain Services.

export function generateRiskNumber(db, companyId) {
  const year = new Date().getFullYear();
  const prefix = `RSK-${year}-`;
  const countRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM grc_risk_registers WHERE company_id = ? AND risk_number LIKE ?
  `).get(companyId, `${prefix}%`);
  const seq = (countRow ? countRow.cnt : 0) + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function generateAuditNumber(db, companyId) {
  const year = new Date().getFullYear();
  const prefix = `AUD-${year}-`;
  const countRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM grc_internal_audits WHERE company_id = ? AND audit_number LIKE ?
  `).get(companyId, `${prefix}%`);
  const seq = (countRow ? countRow.cnt : 0) + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function generateFindingNumber(db, companyId) {
  const year = new Date().getFullYear();
  const prefix = `FND-${year}-`;
  const countRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM grc_audit_findings WHERE company_id = ? AND finding_number LIKE ?
  `).get(companyId, `${prefix}%`);
  const seq = (countRow ? countRow.cnt : 0) + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function calculateRiskLevel(score) {
  if (score >= 20) return 'critical';
  if (score >= 13) return 'high';
  if (score >= 5) return 'medium';
  return 'low';
}

export function createRisk(db, { company_id, title, category = 'operational', description = null, likelihood_rating = 3, impact_rating = 3, risk_owner_id }) {
  const id = `rsk-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const rskNum = generateRiskNumber(db, company_id);
  const score = likelihood_rating * impact_rating;
  const level = calculateRiskLevel(score);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO grc_risk_registers (id, company_id, risk_number, title, category, description, likelihood_rating, impact_rating, risk_score, risk_level, risk_owner_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
  `).run(id, company_id, rskNum, title, category, description, likelihood_rating, impact_rating, score, level, risk_owner_id, now, now);

  return db.prepare('SELECT * FROM grc_risk_registers WHERE id = ?').get(id);
}

export function addRiskMitigation(db, { company_id, risk_id, action_description, assigned_to, target_date }) {
  const rsk = db.prepare('SELECT * FROM grc_risk_registers WHERE id = ? AND company_id = ?').get(risk_id, company_id);
  if (!rsk) throw new Error(`Risk ${risk_id} not found`);

  const id = `mit-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO grc_risk_mitigations (id, company_id, risk_id, action_description, assigned_to, target_date, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'planned', ?)
  `).run(id, company_id, risk_id, action_description, assigned_to, target_date, now);

  return db.prepare('SELECT * FROM grc_risk_mitigations WHERE id = ?').get(id);
}

export function createComplianceFramework(db, { company_id, code, name, version = '1.0', governing_body = null, description = null }) {
  const id = `fw-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO grc_compliance_frameworks (id, company_id, code, name, version, governing_body, description, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, company_id, code, name, version, governing_body, description, now);

  return db.prepare('SELECT * FROM grc_compliance_frameworks WHERE id = ?').get(id);
}

export function createControl(db, { company_id, framework_id = null, control_code, title, control_type = 'detective', testing_frequency = 'quarterly', control_owner_id }) {
  const id = `ctrl-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO grc_compliance_controls (id, company_id, framework_id, control_code, title, control_type, testing_frequency, control_owner_id, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(id, company_id, framework_id, control_code, title, control_type, testing_frequency, control_owner_id, now);

  return db.prepare('SELECT * FROM grc_compliance_controls WHERE id = ?').get(id);
}

export function evaluateControl(db, { company_id, control_id, result = 'effective', evidence_notes = null, tester_id }) {
  const ctrl = db.prepare('SELECT * FROM grc_compliance_controls WHERE id = ? AND company_id = ?').get(control_id, company_id);
  if (!ctrl) throw new Error(`Control ${control_id} not found`);

  const id = `ctrleval-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const evalNum = `CTRL-EVAL-${Date.now()}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO grc_control_evaluations (id, company_id, evaluation_number, control_id, tester_id, test_date, result, evidence_notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, company_id, evalNum, control_id, tester_id, now, result, evidence_notes, now);

  return db.prepare('SELECT * FROM grc_control_evaluations WHERE id = ?').get(id);
}

export function createInternalAudit(db, { company_id, title, scope, lead_auditor_id, start_date, end_date }) {
  const id = `aud-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const audNum = generateAuditNumber(db, company_id);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO grc_internal_audits (id, company_id, audit_number, title, scope, lead_auditor_id, start_date, end_date, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?)
  `).run(id, company_id, audNum, title, scope, lead_auditor_id, start_date, end_date, now, now);

  return db.prepare('SELECT * FROM grc_internal_audits WHERE id = ?').get(id);
}

export function logAuditFinding(db, { company_id, audit_id, title, severity = 'medium', description, recommendation = null, action_plan = null, target_closure_date = null }) {
  const aud = db.prepare('SELECT * FROM grc_internal_audits WHERE id = ? AND company_id = ?').get(audit_id, company_id);
  if (!aud) throw new Error(`Audit ${audit_id} not found`);

  const id = `fnd-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const fndNum = generateFindingNumber(db, company_id);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO grc_audit_findings (id, company_id, finding_number, audit_id, title, severity, description, recommendation, action_plan, target_closure_date, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
  `).run(id, company_id, fndNum, audit_id, title, severity, description, recommendation, action_plan, target_closure_date, now, now);

  return db.prepare('SELECT * FROM grc_audit_findings WHERE id = ?').get(id);
}
