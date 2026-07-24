import crypto from 'node:crypto';

function makeId(prefix = 'wi') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

const WORK_ITEM_STATUSES = new Set(['todo', 'in_progress', 'blocked', 'waiting_approval', 'done', 'cancelled', 'archived']);
const WORK_ITEM_PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);

function assertScopedWorkItem(db, id, companyId) {
  const item = db.prepare('SELECT id FROM work_items WHERE id = ? AND company_id = ?').get(id, companyId);
  if (!item) throw new Error(`Work Item is outside the active company: ${id}`);
}

function replaceDependencies(db, itemId, companyId, dependencies = []) {
  db.prepare('DELETE FROM work_item_dependencies WHERE work_item_id = ?').run(itemId);
  const insert = db.prepare(`
    INSERT INTO work_item_dependencies (
      work_item_id, blocker_work_item_id, dependency_type, created_at
    ) VALUES (?, ?, ?, ?)
  `);
  for (const dependency of dependencies) {
    const blockerId = typeof dependency === 'string' ? dependency : dependency.blocker_work_item_id;
    if (!blockerId || blockerId === itemId) throw new Error('Work Item dependency must reference another item');
    assertScopedWorkItem(db, blockerId, companyId);
    insert.run(itemId, blockerId, typeof dependency === 'string' ? 'blocks' : dependency.dependency_type || 'blocks', new Date().toISOString());
  }
}

function replaceWatchers(db, itemId, watchers = []) {
  db.prepare('DELETE FROM work_item_watchers WHERE work_item_id = ?').run(itemId);
  const insert = db.prepare(`
    INSERT INTO work_item_watchers (work_item_id, user_id, created_at)
    VALUES (?, ?, ?)
  `);
  for (const userId of [...new Set(watchers.filter(Boolean).map(String))]) {
    insert.run(itemId, userId, new Date().toISOString());
  }
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
    dependencies = [],
    watchers = [],
    approvals = [],
    recurrence_rule = null,
    transparency_projection = {},
  } = payload;

  if (!title) throw new Error('title is required for Work Item');
  if (!company_id || company_id === '*') throw new Error('Work Item requires an explicit company scope');
  if (!WORK_ITEM_STATUSES.has(status)) throw new Error(`Unsupported Work Item status: ${status}`);
  if (!WORK_ITEM_PRIORITIES.has(priority)) throw new Error(`Unsupported Work Item priority: ${priority}`);
  if (Number(importance) < 1 || Number(importance) > 5) throw new Error('Work Item importance must be between 1 and 5');
  if (parent_id) assertScopedWorkItem(db, parent_id, company_id);

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

  const stableSourceKey = source_id
    ? [source_type, source_id, source_line_id || ''].map(String).join(':')
    : null;
  db.prepare(`
    INSERT INTO work_item_governance (
      work_item_id, company_id, stable_source_key, recurrence_rule,
      transparency_projection, archived_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
  `).run(
    id,
    company_id,
    stableSourceKey,
    recurrence_rule,
    JSON.stringify(transparency_projection || {}),
    now,
    now,
  );
  replaceDependencies(db, id, company_id, dependencies);
  replaceWatchers(db, id, watchers);
  const insertApproval = db.prepare(`
    INSERT INTO work_item_approvals (
      id, work_item_id, company_id, requested_by, approver_id,
      status, reason, requested_at, decided_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, NULL)
  `);
  for (const approval of approvals) {
    insertApproval.run(
      makeId('wiapproval'),
      id,
      company_id,
      payload.actor || payload.created_by || 'system',
      approval.approver_id || null,
      approval.reason || null,
      now,
    );
  }

  return getWorkItem(db, id);
}

export function updateWorkItem(db, id, payload = {}) {
  const existing = getWorkItem(db, id);
  if (!existing) throw new Error(`Work Item not found: ${id}`);
  if (payload.company_id && existing.company_id !== payload.company_id) {
    throw new Error('Work Item is outside the active company');
  }
  if (payload.expected_version !== undefined && Number(payload.expected_version) !== Number(existing.version)) {
    throw new Error(`Work Item version conflict: expected ${payload.expected_version}, actual ${existing.version}`);
  }
  if (payload.status !== undefined && !WORK_ITEM_STATUSES.has(payload.status)) {
    throw new Error(`Unsupported Work Item status: ${payload.status}`);
  }
  if (payload.priority !== undefined && !WORK_ITEM_PRIORITIES.has(payload.priority)) {
    throw new Error(`Unsupported Work Item priority: ${payload.priority}`);
  }
  if (payload.importance !== undefined && (Number(payload.importance) < 1 || Number(payload.importance) > 5)) {
    throw new Error('Work Item importance must be between 1 and 5');
  }

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

  if (fields.length) {
    fields.push('updated_at = ?');
    params.push(now);
    fields.push('inactivity_timestamp = ?');
    params.push(now);
    fields.push('version = version + 1');
    params.push(id);
    db.prepare(`UPDATE work_items SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  }
  if (payload.dependencies !== undefined) replaceDependencies(db, id, existing.company_id, payload.dependencies);
  if (payload.watchers !== undefined) replaceWatchers(db, id, payload.watchers);
  if (payload.recurrence_rule !== undefined || payload.transparency_projection !== undefined) {
    db.prepare(`
      UPDATE work_item_governance
      SET recurrence_rule = COALESCE(?, recurrence_rule),
          transparency_projection = COALESCE(?, transparency_projection),
          updated_at = ?
      WHERE work_item_id = ?
    `).run(
      payload.recurrence_rule ?? null,
      payload.transparency_projection === undefined ? null : JSON.stringify(payload.transparency_projection),
      now,
      id,
    );
  }
  const ancillaryChanged = payload.dependencies !== undefined
    || payload.watchers !== undefined
    || payload.recurrence_rule !== undefined
    || payload.transparency_projection !== undefined;
  if (!fields.length && ancillaryChanged) {
    db.prepare(`
      UPDATE work_items
      SET updated_at = ?, inactivity_timestamp = ?, version = version + 1
      WHERE id = ?
    `).run(now, now, id);
  }
  return getWorkItem(db, id);
}

export function getWorkItem(db, id) {
  const item = db.prepare(`
    SELECT item.*, governance.stable_source_key, governance.recurrence_rule,
           governance.transparency_projection, governance.archived_at
    FROM work_items item
    LEFT JOIN work_item_governance governance ON governance.work_item_id = item.id
    WHERE item.id = ?
  `).get(id);
  if (!item) return null;
  const dependencies = db.prepare(`
    SELECT blocker_work_item_id, dependency_type
    FROM work_item_dependencies WHERE work_item_id = ? ORDER BY blocker_work_item_id
  `).all(id);
  const blockers = db.prepare(`
    SELECT work_item_id, dependency_type
    FROM work_item_dependencies WHERE blocker_work_item_id = ? ORDER BY work_item_id
  `).all(id);
  const watchers = db.prepare(`
    SELECT user_id FROM work_item_watchers WHERE work_item_id = ? ORDER BY user_id
  `).all(id).map((row) => row.user_id);
  const approvals = db.prepare(`
    SELECT * FROM work_item_approvals WHERE work_item_id = ? ORDER BY requested_at, id
  `).all(id);
  const subtasks = db.prepare(`
    SELECT id, title, status, progress FROM work_items WHERE parent_id = ? ORDER BY created_at, id
  `).all(id);
  const lastActivity = item.inactivity_timestamp || item.updated_at || item.created_at;
  const inactivityAgeMs = Math.max(0, Date.now() - Date.parse(lastActivity));
  return {
    ...item,
    transparency_projection: JSON.parse(item.transparency_projection || '{}'),
    dependencies,
    blockers,
    watchers,
    approvals,
    subtasks,
    inactivity_age_ms: inactivityAgeMs,
  };
}

export function listWorkItems(db, ctx = {}, query = {}) {
  const companyId = ctx.companyId || null;
  if (!companyId) throw new Error('an active company scope is required');
  const sourceType = query.source_type || null;
  const status = query.status || null;
  const assignedUser = query.assigned_user_id || null;
  const search = query.search || null;

  let sql = 'SELECT * FROM work_items WHERE 1=1';
  const params = [];

  sql += ' AND company_id = ?';
  params.push(companyId);

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

  return db.prepare(sql).all(...params).map((row) => getWorkItem(db, row.id));
}

export function deleteWorkItem(db, id, companyId = null) {
  const item = getWorkItem(db, id);
  if (!item || (companyId && item.company_id !== companyId)) return null;
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE work_items
    SET status = 'archived', updated_at = ?, inactivity_timestamp = ?,
        version = version + 1
    WHERE id = ?
  `).run(now, now, id);
  db.prepare(`
    UPDATE work_item_governance SET archived_at = ?, updated_at = ?
    WHERE work_item_id = ?
  `).run(now, now, id);
  return getWorkItem(db, id);
}

export function decideWorkItemApproval(db, payload) {
  if (!['approved', 'rejected'].includes(payload.decision)) {
    throw new Error('Work Item approval decision must be approved or rejected');
  }
  const approval = db.prepare(`
    SELECT approval.*, item.company_id
    FROM work_item_approvals approval
    JOIN work_items item ON item.id = approval.work_item_id
    WHERE approval.id = ? AND item.company_id = ?
  `).get(payload.approval_id, payload.company_id);
  if (!approval) throw new Error('Work Item approval not found in active company');
  if (approval.status !== 'pending') throw new Error('Work Item approval is already decided');
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE work_item_approvals
    SET status = ?, approver_id = ?, reason = COALESCE(?, reason), decided_at = ?
    WHERE id = ?
  `).run(payload.decision, payload.actor, payload.reason || null, now, approval.id);
  db.prepare(`
    UPDATE work_items SET status = ?, updated_at = ?, version = version + 1
    WHERE id = ?
  `).run(payload.decision === 'approved' ? 'in_progress' : 'blocked', now, approval.work_item_id);
  return getWorkItem(db, approval.work_item_id);
}
