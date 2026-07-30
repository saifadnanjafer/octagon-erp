// platform/domains/plm/service.mjs — PLM and Engineering Change Control Domain Services.

export function generateRevisionNumber(db, companyId) {
  const year = new Date().getFullYear();
  const prefix = `REV-${year}-`;
  const countRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM plm_engineering_revisions WHERE company_id = ? AND revision_number LIKE ?
  `).get(companyId, `${prefix}%`);
  const seq = (countRow ? countRow.cnt : 0) + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function generateECONumber(db, companyId) {
  const year = new Date().getFullYear();
  const prefix = `ECO-${year}-`;
  const countRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM plm_engineering_change_orders WHERE company_id = ? AND eco_number LIKE ?
  `).get(companyId, `${prefix}%`);
  const seq = (countRow ? countRow.cnt : 0) + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function createEngineeringRevision(db, { company_id, product_id, revision_code = 'Rev A', change_summary = null, released_by = null }) {
  const id = `rev-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const revNum = generateRevisionNumber(db, company_id);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO plm_engineering_revisions (id, company_id, revision_number, product_id, revision_code, change_summary, status, released_by, released_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
  `).run(id, company_id, revNum, product_id, revision_code, change_summary, released_by, now, now, now);

  return db.prepare('SELECT * FROM plm_engineering_revisions WHERE id = ?').get(id);
}

export function createECO(db, { company_id, title, change_type = 'design_update', priority = 'medium', change_reason = null, initiator_id }) {
  const id = `eco-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const ecoNum = generateECONumber(db, company_id);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO plm_engineering_change_orders (id, company_id, eco_number, title, change_type, priority, change_reason, status, initiator_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)
  `).run(id, company_id, ecoNum, title, change_type, priority, change_reason, initiator_id, now, now);

  return db.prepare('SELECT * FROM plm_engineering_change_orders WHERE id = ?').get(id);
}

export function addAffectedItemToECO(db, { company_id, eco_id, product_id, current_revision_code, new_revision_code, action_type = 'modify' }) {
  const eco = db.prepare('SELECT * FROM plm_engineering_change_orders WHERE id = ? AND company_id = ?').get(eco_id, company_id);
  if (!eco) throw new Error(`ECO ${eco_id} not found`);

  const id = `item-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO plm_eco_affected_items (id, company_id, eco_id, product_id, current_revision_code, new_revision_code, action_type, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, company_id, eco_id, product_id, current_revision_code, new_revision_code, action_type, now);

  return db.prepare('SELECT * FROM plm_eco_affected_items WHERE id = ?').get(id);
}

export function addECOApprovalRequirement(db, { company_id, eco_id, department, approver_id }) {
  const id = `appr-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  db.prepare(`
    INSERT INTO plm_eco_approvals (id, company_id, eco_id, department, approver_id, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `).run(id, company_id, eco_id, department, approver_id);

  return db.prepare('SELECT * FROM plm_eco_approvals WHERE id = ?').get(id);
}

export function approveECODepartment(db, { company_id, eco_id, department, approver_id, comments = null }) {
  const appr = db.prepare('SELECT * FROM plm_eco_approvals WHERE company_id = ? AND eco_id = ? AND department = ?').get(company_id, eco_id, department);
  if (!appr) throw new Error(`Approval requirement for department ${department} on ECO ${eco_id} not found`);

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE plm_eco_approvals SET status = 'approved', comments = ?, acted_at = ? WHERE id = ?
  `).run(comments, now, appr.id);

  // Check if all department approvals for this ECO are done
  const pending = db.prepare('SELECT COUNT(*) as cnt FROM plm_eco_approvals WHERE eco_id = ? AND status != \'approved\'').get(eco_id);
  if (!pending || pending.cnt === 0) {
    db.prepare(`
      UPDATE plm_engineering_change_orders SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?
    `).run(approver_id, now, now, eco_id);
  }

  return db.prepare('SELECT * FROM plm_engineering_change_orders WHERE id = ?').get(eco_id);
}

export function implementECO(db, { company_id, eco_id, implemented_by }) {
  const eco = db.prepare('SELECT * FROM plm_engineering_change_orders WHERE id = ? AND company_id = ?').get(eco_id, company_id);
  if (!eco) throw new Error(`ECO ${eco_id} not found`);
  if (eco.status !== 'approved') throw new Error(`ECO must be in 'approved' status before implementation (status: ${eco.status})`);

  const affectedItems = db.prepare('SELECT * FROM plm_eco_affected_items WHERE eco_id = ?').all(eco_id);
  const now = new Date().toISOString();

  for (const item of affectedItems) {
    // Supersede current revision
    db.prepare(`
      UPDATE plm_engineering_revisions SET status = 'superseded', updated_at = ? WHERE company_id = ? AND product_id = ? AND revision_code = ?
    `).run(now, company_id, item.product_id, item.current_revision_code);

    // Create new active revision
    createEngineeringRevision(db, {
      company_id,
      product_id: item.product_id,
      revision_code: item.new_revision_code,
      change_summary: `Created via ECO ${eco.eco_number}: ${eco.title}`,
      released_by: implemented_by
    });
  }

  db.prepare(`
    UPDATE plm_engineering_change_orders SET status = 'implemented', implemented_at = ?, updated_at = ? WHERE id = ?
  `).run(now, now, eco_id);

  return db.prepare('SELECT * FROM plm_engineering_change_orders WHERE id = ?').get(eco_id);
}
