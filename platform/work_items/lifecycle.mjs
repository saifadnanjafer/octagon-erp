// Checkpoint C4 — governed Work Item lifecycle on the existing canonical table.

import crypto from 'node:crypto';
import {
  createWorkItem,
  deleteWorkItem,
  getWorkItem,
  listWorkItems,
  updateWorkItem,
} from './work_items.mjs';

const STAGES = new Set(['backlog', 'planned', 'in_progress', 'review', 'blocked', 'done', 'cancelled']);
const CLOSED = new Set(['done', 'cancelled', 'archived']);

function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function fail(message, code = 'WORK_ITEM_PRECONDITION_FAILED') {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 409;
  return error;
}

function json(value, fallback = []) {
  try {
    return (typeof value === 'string' ? JSON.parse(value) : value) ?? fallback;
  } catch (_) {
    return fallback;
  }
}

function recurrenceNext(rule, anchor = null) {
  const value = String(rule || '').trim().toLowerCase();
  if (!value || value === 'none') return null;
  const date = anchor ? new Date(anchor) : new Date();
  if (Number.isNaN(date.getTime())) return null;
  const interval = Math.max(1, Number(value.match(/interval[=:](\d+)/i)?.[1] || 1));
  if (value.includes('month')) date.setUTCMonth(date.getUTCMonth() + interval);
  else if (value.includes('week')) date.setUTCDate(date.getUTCDate() + (7 * interval));
  else date.setUTCDate(date.getUTCDate() + interval);
  return date.toISOString();
}

function assertDates(start, due) {
  if (start && due && Date.parse(due) < Date.parse(start)) {
    throw fail('Work Item due date cannot precede its start date', 'WORK_ITEM_DATE_RANGE_INVALID');
  }
}

function assertProgress(progress) {
  if (progress !== undefined && (Number(progress) < 0 || Number(progress) > 100)) {
    throw fail('Work Item progress must be between 0 and 100', 'WORK_ITEM_PROGRESS_INVALID');
  }
}

function scoped(db, id, companyId) {
  const item = getWorkItem(db, id);
  if (!item || item.company_id !== companyId) throw fail('Work Item not found in active company', 'WORK_ITEM_NOT_FOUND');
  return item;
}

function event(db, item, actor, type, details = {}) {
  db.prepare(`
    INSERT INTO work_item_events (
      id, company_id, work_item_id, event_type, from_status, to_status,
      from_stage, to_stage, details, actor_id, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    makeId('wievent'),
    item.company_id,
    item.id,
    type,
    details.from_status || null,
    details.to_status || null,
    details.from_stage || null,
    details.to_stage || null,
    JSON.stringify(details),
    actor || 'system',
    new Date().toISOString(),
  );
}

function enrich(db, item) {
  if (!item) return null;
  const now = Date.now();
  const lastActivity = Date.parse(item.inactivity_timestamp || item.updated_at || item.created_at);
  const inactivityAge = Math.max(0, now - lastActivity);
  const inactivityDays = Math.floor(inactivityAge / 86_400_000);
  const isClosed = CLOSED.has(item.status);
  return {
    ...item,
    checklist: json(item.checklist_json),
    attachments: json(item.attachments_json),
    comments: json(item.comments_json),
    events: db.prepare('SELECT * FROM work_item_events WHERE work_item_id = ? ORDER BY occurred_at, id')
      .all(item.id)
      .map((row) => ({ ...row, details: json(row.details, {}) })),
    inactivity_age_ms: inactivityAge,
    inactivity_days: inactivityDays,
    aging_days: Math.floor(Math.max(0, now - Date.parse(item.created_at)) / 86_400_000),
    is_overdue: Boolean(!isClosed && item.due_date && Date.parse(item.due_date) < now),
    sla_breached: Boolean(!isClosed && item.sla_due_at && Date.parse(item.sla_due_at) < now),
    visual_opacity: Math.max(0.35, 1 - (inactivityDays * 0.04)),
  };
}

function updateExtensionColumns(db, id, payload, existing = {}) {
  const fields = [];
  const values = [];
  for (const key of [
    'sales_ref',
    'procurement_ref',
    'quality_ref',
    'sla_policy',
    'sla_due_at',
    'sla_status',
    'sla_breached_at',
    'recurrence_next_at',
  ]) {
    if (payload[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(payload[key]);
    }
  }
  if (payload.stage !== undefined && payload.stage !== existing.stage) {
    fields.push('last_stage_moved_at = ?');
    values.push(new Date().toISOString());
  }
  if (fields.length) {
    values.push(id);
    db.prepare(`UPDATE work_items SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }
}

export function createWorkItemLifecycle(db, payload = {}) {
  if (payload.stage !== undefined && !STAGES.has(payload.stage)) {
    throw fail(`Unsupported Work Item stage: ${payload.stage}`, 'WORK_ITEM_STAGE_INVALID');
  }
  assertProgress(payload.progress);
  assertDates(payload.start_date, payload.due_date);
  const item = createWorkItem(db, payload);
  const recurrenceNextAt = recurrenceNext(payload.recurrence_rule, payload.due_date || payload.start_date || item.created_at);
  updateExtensionColumns(db, item.id, {
    sales_ref: payload.sales_ref ?? null,
    procurement_ref: payload.procurement_ref ?? null,
    quality_ref: payload.quality_ref ?? null,
    sla_policy: payload.sla_policy ?? null,
    sla_due_at: payload.sla_due_at ?? null,
    sla_status: payload.sla_due_at && Date.parse(payload.sla_due_at) < Date.now() ? 'breached' : 'on_track',
    recurrence_next_at: recurrenceNextAt,
    stage: item.stage,
  });
  const created = getWorkItem(db, item.id);
  event(db, created, payload.actor, 'created', {
    to_status: created.status,
    to_stage: created.stage,
    source_type: created.source_type,
    source_id: created.source_id,
  });
  return enrich(db, getWorkItem(db, item.id));
}

export function updateWorkItemLifecycle(db, payload = {}) {
  const existing = scoped(db, payload.id, payload.company_id);
  if (payload.stage !== undefined && !STAGES.has(payload.stage)) {
    throw fail(`Unsupported Work Item stage: ${payload.stage}`, 'WORK_ITEM_STAGE_INVALID');
  }
  assertProgress(payload.progress);
  assertDates(payload.start_date ?? existing.start_date, payload.due_date ?? existing.due_date);
  const updated = updateWorkItem(db, existing.id, payload);
  updateExtensionColumns(db, existing.id, payload, existing);
  const result = getWorkItem(db, existing.id);
  event(db, result, payload.actor, 'updated', {
    from_status: existing.status,
    to_status: result.status,
    from_stage: existing.stage,
    to_stage: result.stage,
  });
  return enrich(db, getWorkItem(db, existing.id));
}

export function assignWorkItem(db, payload = {}) {
  const existing = scoped(db, payload.id, payload.company_id);
  const result = updateWorkItemLifecycle(db, {
    company_id: payload.company_id,
    id: existing.id,
    expected_version: payload.expected_version,
    assigned_user_id: payload.assigned_user_id ?? existing.assigned_user_id,
    assigned_team_id: payload.assigned_team_id ?? existing.assigned_team_id,
    watchers: payload.watchers,
    actor: payload.actor,
  });
  event(db, result, payload.actor, 'assigned', {
    assigned_user_id: result.assigned_user_id,
    assigned_team_id: result.assigned_team_id,
  });
  return enrich(db, getWorkItem(db, existing.id));
}

function cycleCheck(db, itemId, blockerId) {
  const cycle = db.prepare(`
    WITH RECURSIVE chain(id) AS (
      SELECT blocker_work_item_id FROM work_item_dependencies WHERE work_item_id = ?
      UNION
      SELECT dependency.blocker_work_item_id
      FROM work_item_dependencies dependency
      JOIN chain ON dependency.work_item_id = chain.id
    )
    SELECT 1 AS found FROM chain WHERE id = ? LIMIT 1
  `).get(blockerId, itemId);
  if (cycle) throw fail('Work Item dependency cycle is not allowed', 'WORK_ITEM_DEPENDENCY_CYCLE');
}

export function addDependency(db, payload = {}) {
  const item = scoped(db, payload.id, payload.company_id);
  scoped(db, payload.blocker_work_item_id, payload.company_id);
  if (item.id === payload.blocker_work_item_id) {
    throw fail('Work Item cannot depend on itself', 'WORK_ITEM_DEPENDENCY_SELF');
  }
  cycleCheck(db, item.id, payload.blocker_work_item_id);
  const dependencies = [
    ...item.dependencies,
    {
      blocker_work_item_id: payload.blocker_work_item_id,
      dependency_type: payload.dependency_type || 'finish_to_start',
    },
  ].filter((dependency, index, rows) => (
    rows.findIndex((row) => row.blocker_work_item_id === dependency.blocker_work_item_id) === index
  ));
  const result = updateWorkItemLifecycle(db, {
    company_id: payload.company_id,
    id: item.id,
    expected_version: payload.expected_version,
    dependencies,
    actor: payload.actor,
  });
  event(db, result, payload.actor, 'dependency_added', {
    blocker_work_item_id: payload.blocker_work_item_id,
    dependency_type: payload.dependency_type || 'finish_to_start',
  });
  return enrich(db, getWorkItem(db, item.id));
}

export function addSubtask(db, payload = {}) {
  const parent = scoped(db, payload.parent_id, payload.company_id);
  return createWorkItemLifecycle(db, {
    ...payload,
    parent_id: parent.id,
    source_type: payload.source_type || parent.source_type,
    source_id: payload.source_id || parent.source_id,
    assigned_user_id: payload.assigned_user_id ?? parent.assigned_user_id,
    assigned_team_id: payload.assigned_team_id ?? parent.assigned_team_id,
    project_ref: payload.project_ref ?? parent.project_ref,
    sales_ref: payload.sales_ref ?? parent.sales_ref,
    procurement_ref: payload.procurement_ref ?? parent.procurement_ref,
    quality_ref: payload.quality_ref ?? parent.quality_ref,
    maintenance_ref: payload.maintenance_ref ?? parent.maintenance_ref,
  });
}

function assertCompletable(db, item) {
  const blockers = db.prepare(`
    SELECT blocker.title
    FROM work_item_dependencies dependency
    JOIN work_items blocker ON blocker.id = dependency.blocker_work_item_id
    WHERE dependency.work_item_id = ?
      AND blocker.status NOT IN ('done','cancelled','archived')
  `).all(item.id);
  if (blockers.length) {
    throw fail(`Work Item is blocked by incomplete dependencies: ${blockers.map((row) => row.title).join(', ')}`, 'WORK_ITEM_BLOCKED');
  }
  const subtasks = db.prepare(`
    SELECT title FROM work_items
    WHERE parent_id = ? AND status NOT IN ('done','cancelled','archived')
  `).all(item.id);
  if (subtasks.length) {
    throw fail(`Work Item has incomplete subtasks: ${subtasks.map((row) => row.title).join(', ')}`, 'WORK_ITEM_SUBTASKS_OPEN');
  }
}

export function completeWorkItem(db, payload = {}) {
  const item = scoped(db, payload.id, payload.company_id);
  assertCompletable(db, item);
  const completed = updateWorkItemLifecycle(db, {
    company_id: payload.company_id,
    id: item.id,
    expected_version: payload.expected_version,
    status: 'done',
    stage: 'done',
    progress: 100,
    actual_hours: payload.actual_hours ?? item.actual_hours,
    actor: payload.actor,
  });
  event(db, completed, payload.actor, 'completed', {
    from_status: item.status,
    to_status: 'done',
    from_stage: item.stage,
    to_stage: 'done',
  });
  const nextAt = recurrenceNext(item.recurrence_rule, item.due_date || item.start_date || item.updated_at);
  if (!nextAt) return { item: enrich(db, getWorkItem(db, item.id)), recurrence: null };
  const duration = item.start_date && item.due_date
    ? Math.max(0, Date.parse(item.due_date) - Date.parse(item.start_date))
    : 0;
  const recurrence = createWorkItemLifecycle(db, {
    company_id: item.company_id,
    branch_id: item.branch_id,
    title: item.title,
    description: item.description,
    source_type: item.source_type,
    source_id: item.source_id,
    source_line_id: item.source_line_id,
    parent_id: item.parent_id,
    priority: item.priority,
    importance: item.importance,
    assigned_user_id: item.assigned_user_id,
    assigned_team_id: item.assigned_team_id,
    start_date: nextAt,
    due_date: duration ? new Date(Date.parse(nextAt) + duration).toISOString() : nextAt,
    estimated_hours: item.estimated_hours,
    checklist_json: json(item.checklist_json),
    attachments_json: json(item.attachments_json),
    watchers: item.watchers,
    recurrence_rule: item.recurrence_rule,
    project_ref: item.project_ref,
    sales_ref: item.sales_ref,
    procurement_ref: item.procurement_ref,
    quality_ref: item.quality_ref,
    maintenance_ref: item.maintenance_ref,
    actor: payload.actor,
  });
  return { item: enrich(db, getWorkItem(db, item.id)), recurrence };
}

export function cancelWorkItem(db, payload = {}) {
  const item = scoped(db, payload.id, payload.company_id);
  const cancelled = updateWorkItemLifecycle(db, {
    company_id: payload.company_id,
    id: item.id,
    expected_version: payload.expected_version,
    status: 'cancelled',
    stage: 'cancelled',
    actor: payload.actor,
  });
  event(db, cancelled, payload.actor, 'cancelled', {
    from_status: item.status,
    to_status: 'cancelled',
    from_stage: item.stage,
    to_stage: 'cancelled',
    reason: payload.reason || null,
  });
  return enrich(db, getWorkItem(db, item.id));
}

export function transitionWorkItem(db, payload = {}) {
  const item = scoped(db, payload.id, payload.company_id);
  if (!STAGES.has(payload.stage)) throw fail(`Unsupported Work Item stage: ${payload.stage}`, 'WORK_ITEM_STAGE_INVALID');
  if (payload.stage === 'done') return completeWorkItem(db, payload);
  if (payload.stage === 'cancelled') return cancelWorkItem(db, payload);
  const status = {
    backlog: 'todo',
    planned: 'todo',
    in_progress: 'in_progress',
    review: 'waiting_approval',
    blocked: 'blocked',
  }[payload.stage];
  const result = updateWorkItemLifecycle(db, {
    company_id: payload.company_id,
    id: item.id,
    expected_version: payload.expected_version,
    stage: payload.stage,
    status,
    progress: payload.progress,
    actor: payload.actor,
  });
  event(db, result, payload.actor, 'transitioned', {
    from_status: item.status,
    to_status: result.status,
    from_stage: item.stage,
    to_stage: result.stage,
  });
  return enrich(db, getWorkItem(db, item.id));
}

export function archiveWorkItem(db, payload = {}) {
  const item = scoped(db, payload.id, payload.company_id);
  const archived = deleteWorkItem(db, item.id, payload.company_id);
  event(db, archived, payload.actor, 'archived', {
    from_status: item.status,
    to_status: 'archived',
    from_stage: item.stage,
    to_stage: item.stage,
  });
  return enrich(db, getWorkItem(db, item.id));
}

export function getWorkItemView(db, id, companyId) {
  return enrich(db, scoped(db, id, companyId));
}

export function listWorkItemViews(db, ctx = {}, query = {}) {
  let rows = listWorkItems(db, ctx, {
    source_type: query.source_type,
    status: query.status,
    assigned_user_id: query.assigned_user_id,
    search: query.search,
    limit: Math.min(Number(query.limit) || 500, 500),
  }).map((item) => enrich(db, item));
  if (query.stage) rows = rows.filter((row) => row.stage === query.stage);
  if (String(query.mine || '') === '1') {
    rows = rows.filter((row) => row.assigned_user_id === ctx.userId);
  }
  if (query.assigned_team_id) rows = rows.filter((row) => row.assigned_team_id === query.assigned_team_id);
  if (query.due_from) rows = rows.filter((row) => row.due_date && row.due_date >= query.due_from);
  if (query.due_to) rows = rows.filter((row) => row.due_date && row.due_date <= query.due_to);
  if (query.sla_status === 'breached') rows = rows.filter((row) => row.sla_breached);
  if (String(query.include_archived || '') !== '1') rows = rows.filter((row) => row.status !== 'archived');
  const sort = ['created_at', 'updated_at', 'due_date', 'priority', 'importance', 'stage', 'status'].includes(query.sort)
    ? query.sort
    : 'created_at';
  const direction = String(query.order || '').toLowerCase() === 'asc' ? 1 : -1;
  rows.sort((a, b) => String(a[sort] ?? '').localeCompare(String(b[sort] ?? '')) * direction);
  return rows;
}

export function workItemReport(db, ctx = {}, report = 'overdue') {
  const rows = listWorkItemViews(db, ctx, { include_archived: '0', limit: 500 });
  const open = rows.filter((row) => !CLOSED.has(row.status));
  if (report === 'employee' || report === 'workload') {
    const grouped = new Map();
    for (const row of open) {
      const key = row.assigned_user_id || 'unassigned';
      const value = grouped.get(key) || {
        employee: key,
        open: 0,
        overdue: 0,
        estimated_hours: 0,
        actual_hours: 0,
      };
      value.open += 1;
      value.overdue += row.is_overdue ? 1 : 0;
      value.estimated_hours += Number(row.estimated_hours || 0);
      value.actual_hours += Number(row.actual_hours || 0);
      grouped.set(key, value);
    }
    return [...grouped.values()];
  }
  if (report === 'completion') {
    const completed = rows.filter((row) => row.status === 'done').length;
    return [{
      total: rows.length,
      completed,
      cancelled: rows.filter((row) => row.status === 'cancelled').length,
      completion_rate: rows.length ? Number(((completed / rows.length) * 100).toFixed(2)) : 0,
    }];
  }
  if (report === 'sla') return open.filter((row) => row.sla_breached);
  if (report === 'inactive') return open.filter((row) => row.inactivity_days >= 7);
  if (report === 'dependencies') return open.filter((row) => row.dependencies.length);
  return open.filter((row) => row.is_overdue);
}
