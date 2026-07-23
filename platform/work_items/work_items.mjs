import crypto from 'node:crypto';

function makeId(prefix = 'wi') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function createWorkItem(db, payload = {}) {
  const {
    company_id = '*',
    branch_id = '*',
    department_id = null,
    title,
    description = '',
    source_type = 'task',
    source_id = null,
    source_line_id = null,
    parent_id = null,
    status = 'todo',
    stage = 'backlog',
    priority = 'medium',
    importance = 3,
    assigned_user_id = null,
    assigned_team_id = null,
    start_date = null,
    due_date = null,
    progress = 0.0,
    estimated_hours = 0.0,
    actual_hours = 0.0,
    checklist_json = '[]',
    attachments_json = '[]',
    comments_json = '[]',
    project_ref = null,
    work_order_ref = null,
    helpdesk_ref = null,
    qc_ref = null,
    maintenance_ref = null,
  } = payload;

  if (!title) throw new Error('title is required for Work Item');

  const id = payload.id || makeId('wi');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO work_items (
      id, company_id, branch_id, department_id, title, description,
      source_type, source_id, source_line_id, parent_id, status, stage,
      priority, importance, assigned_user_id, assigned_team_id, start_date, due_date,
      progress, estimated_hours, actual_hours, inactivity_timestamp, sla_due_at,
      checklist_json, attachments_json, comments_json, project_ref, work_order_ref,
      helpdesk_ref, qc_ref, maintenance_ref, version, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, 1, ?, ?
    )
  `).run(
    id, company_id, branch_id, department_id, title, description,
    source_type, source_id, source_line_id, parent_id, status, stage,
    priority, Number(importance) || 3, assigned_user_id, assigned_team_id, start_date, due_date,
    Number(progress) || 0.0, Number(estimated_hours) || 0.0, Number(actual_hours) || 0.0, now, null,
    typeof checklist_json === 'string' ? checklist_json : JSON.stringify(checklist_json),
    typeof attachments_json === 'string' ? attachments_json : JSON.stringify(attachments_json),
    typeof comments_json === 'string' ? comments_json : JSON.stringify(comments_json),
    project_ref, work_order_ref, helpdesk_ref, qc_ref, maintenance_ref, now, now
  );

  return getWorkItem(db, id);
}

export function updateWorkItem(db, id, payload = {}) {
  const existing = getWorkItem(db, id);
  if (!existing) throw new Error(`Work Item not found: ${id}`);

  const now = new Date().toISOString();
  const fields = [];
  const params = [];

  const allowed = [
    'title', 'description', 'status', 'stage', 'priority', 'importance',
    'assigned_user_id', 'assigned_team_id', 'start_date', 'due_date',
    'progress', 'estimated_hours', 'actual_hours', 'checklist_json',
    'attachments_json', 'comments_json', 'project_ref', 'work_order_ref',
    'helpdesk_ref', 'qc_ref', 'maintenance_ref'
  ];

  for (const key of allowed) {
    if (payload[key] !== undefined) {
      fields.push(`${key} = ?`);
      let val = payload[key];
      if (['checklist_json', 'attachments_json', 'comments_json'].includes(key) && typeof val !== 'string') {
        val = JSON.stringify(val);
      }
      params.push(val);
    }
  }

  if (payload.status === 'done' && existing.status !== 'done') {
    fields.push('completed_at = ?');
    params.push(now);
  }

  if (fields.length === 0) return existing;

  fields.push('updated_at = ?');
  params.push(now);
  fields.push('inactivity_timestamp = ?');
  params.push(now);
  fields.push('version = version + 1');

  params.push(id);

  db.prepare(`UPDATE work_items SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getWorkItem(db, id);
}

export function getWorkItem(db, id) {
  return db.prepare('SELECT * FROM work_items WHERE id = ?').get(id) || null;
}

export function listWorkItems(db, ctx = {}, query = {}) {
  const companyId = ctx.companyId || query.company_id || '*';
  const sourceType = query.source_type || null;
  const status = query.status || null;
  const assignedUser = query.assigned_user_id || null;
  const search = query.search || null;

  let sql = 'SELECT * FROM work_items WHERE 1=1';
  const params = [];

  if (companyId !== '*') {
    sql += " AND (company_id = ? OR company_id = '*')";
    params.push(companyId);
  }

  if (sourceType) {
    sql += ' AND source_type = ?';
    params.push(sourceType);
  }

  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }

  if (assignedUser) {
    sql += ' AND assigned_user_id = ?';
    params.push(assignedUser);
  }

  if (search) {
    sql += ' AND (title LIKE ? OR description LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  sql += ' ORDER BY created_at DESC';
  const limit = Math.min(Number(query.limit) || 100, 500);
  sql += ` LIMIT ${limit}`;

  return db.prepare(sql).all(...params);
}

export function deleteWorkItem(db, id) {
  const item = getWorkItem(db, id);
  if (!item) return null;
  db.prepare('DELETE FROM work_items WHERE id = ?').run(id);
  return item;
}
