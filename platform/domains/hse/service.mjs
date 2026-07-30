// platform/domains/hse/service.mjs — HSE & Safety Management Domain Services.

export function generateIncidentNumber(db, companyId) {
  const year = new Date().getFullYear();
  const prefix = `INC-${year}-`;
  const countRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM hse_incidents WHERE company_id = ? AND incident_number LIKE ?
  `).get(companyId, `${prefix}%`);
  const seq = (countRow ? countRow.cnt : 0) + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function generatePermitNumber(db, companyId) {
  const year = new Date().getFullYear();
  const prefix = `PTW-${year}-`;
  const countRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM hse_safety_permits WHERE company_id = ? AND permit_number LIKE ?
  `).get(companyId, `${prefix}%`);
  const seq = (countRow ? countRow.cnt : 0) + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function generateCAPANumber(db, companyId) {
  const year = new Date().getFullYear();
  const prefix = `CAPA-${year}-`;
  const countRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM hse_corrective_actions WHERE company_id = ? AND capa_number LIKE ?
  `).get(companyId, `${prefix}%`);
  const seq = (countRow ? countRow.cnt : 0) + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function reportIncident(db, { company_id, incident_date, location, category = 'near_miss', severity = 'minor', title, description = null, reporter_id }) {
  const id = `inc-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const incNum = generateIncidentNumber(db, company_id);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO hse_incidents (id, company_id, incident_number, incident_date, location, category, severity, title, description, reporter_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reported', ?, ?)
  `).run(id, company_id, incNum, incident_date, location, category, severity, title, description, reporter_id, now, now);

  return db.prepare('SELECT * FROM hse_incidents WHERE id = ?').get(id);
}

export function investigateIncident(db, { company_id, incident_id, investigator_id, root_cause_analysis, immediate_action_taken = null }) {
  const inc = db.prepare('SELECT * FROM hse_incidents WHERE id = ? AND company_id = ?').get(incident_id, company_id);
  if (!inc) throw new Error(`Incident ${incident_id} not found`);

  const id = `inv-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO hse_incident_investigations (id, company_id, incident_id, investigator_id, root_cause_analysis, immediate_action_taken, investigation_date, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, company_id, incident_id, investigator_id, root_cause_analysis, immediate_action_taken, now, now);

  db.prepare(`UPDATE hse_incidents SET status = 'investigating', updated_at = ? WHERE id = ?`).run(now, incident_id);

  return db.prepare('SELECT * FROM hse_incident_investigations WHERE id = ?').get(id);
}

export function createCAPA(db, { company_id, incident_id = null, action_description, assigned_to, target_date }) {
  const id = `capa-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const capaNum = generateCAPANumber(db, company_id);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO hse_corrective_actions (id, company_id, capa_number, incident_id, action_description, assigned_to, target_date, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
  `).run(id, company_id, capaNum, incident_id, action_description, assigned_to, target_date, now, now);

  return db.prepare('SELECT * FROM hse_corrective_actions WHERE id = ?').get(id);
}

export function requestSafetyPermit(db, { company_id, permit_type = 'hot_work', location, work_description, contractor_id = null, valid_from, valid_until }) {
  const id = `ptw-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const ptwNum = generatePermitNumber(db, company_id);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO hse_safety_permits (id, company_id, permit_number, permit_type, location, work_description, contractor_id, valid_from, valid_until, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?)
  `).run(id, company_id, ptwNum, permit_type, location, work_description, contractor_id, valid_from, valid_until, now, now);

  return db.prepare('SELECT * FROM hse_safety_permits WHERE id = ?').get(id);
}

export function issueSafetyPermit(db, { id, company_id, issuer_id }) {
  const ptw = db.prepare('SELECT * FROM hse_safety_permits WHERE id = ? AND company_id = ?').get(id, company_id);
  if (!ptw) throw new Error(`Safety permit ${id} not found`);

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE hse_safety_permits SET status = 'issued', issuer_id = ?, issued_at = ?, updated_at = ? WHERE id = ?
  `).run(issuer_id, now, now, id);

  return db.prepare('SELECT * FROM hse_safety_permits WHERE id = ?').get(id);
}

export function recordSafetyInspection(db, { company_id, facility_location, inspector_id, inspection_date, passed_items, failed_items, summary = null }) {
  const total = passed_items + failed_items;
  const score = total > 0 ? (passed_items / total) * 100.0 : 100.0;
  const id = `insp-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const inspNum = `INSP-${Date.now()}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO hse_safety_inspections (id, company_id, inspection_number, facility_location, inspector_id, inspection_date, passed_items, failed_items, compliance_score_pct, summary, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, company_id, inspNum, facility_location, inspector_id, inspection_date, passed_items, failed_items, score, summary, now);

  return db.prepare('SELECT * FROM hse_safety_inspections WHERE id = ?').get(id);
}
