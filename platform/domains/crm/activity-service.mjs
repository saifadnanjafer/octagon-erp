// CRM Activity service, and the bridge to canonical Work Items.
//
// A CRM Activity is a lightweight reminder: call them Thursday, send the
// drawing. It deliberately does NOT model assignment chains, dependencies,
// SLAs or shop-floor execution — that is what canonical Work Items are for.
//
// When an activity needs real execution it creates ONE Work Item and holds a
// reference. From that point the Work Item is authoritative for execution
// state; CRM derives its view from the link rather than keeping a competing
// status field it would have to keep in sync.

import { CRM_ERRORS, fail } from './errors.mjs';
import { newId, now, scopeOf, writeAudit, emitEvent } from './shared.mjs';

export const ACTIVITY_TYPES = Object.freeze(['call', 'meeting', 'email', 'visit', 'follow_up', 'task', 'note', 'reminder']);
const CLOSED = new Set(['completed', 'cancelled']);

export function getActivity(db, id) {
  const a = db.prepare('SELECT * FROM crm_activities WHERE id = ?').get(id);
  if (!a) fail(CRM_ERRORS.ACTIVITY_NOT_FOUND, `unknown activity ${id}`, { activityId: id });
  return a;
}

/** Overdue is DERIVED, never stored — a stored flag goes stale the moment the clock moves. */
export function decorate(activity, at = new Date()) {
  const overdue = Boolean(activity.due_at) && !CLOSED.has(activity.state) && Date.parse(activity.due_at) < at.getTime();
  return { ...activity, overdue };
}

export function scheduleActivity(db, input) {
  const { companyId, branchId, actor } = scopeOf(input);
  if (!input.summary || !String(input.summary).trim()) fail(CRM_ERRORS.VALIDATION_FAILED, 'activity summary is required', { field: 'summary' });
  const type = input.activity_type ?? 'call';
  if (!ACTIVITY_TYPES.includes(type)) fail(CRM_ERRORS.VALIDATION_FAILED, `unknown activity type ${type}`, { allowed: ACTIVITY_TYPES });

  // Migration 066 unified the Activity authority: crm_activities.lead_id is now
  // nullable and a subject_type CHECK enforces exactly one PRIMARY subject
  // (lead, opportunity, or party). The caller supplies exactly one of the three
  // reference fields; an opportunity that came from a Lead conversion still gets
  // its source lead_id resolved and stored for lineage, but the primary subject
  // (and what the CHECK constraint validates against) is the opportunity.
  const suppliedSubjects = ['lead_id', 'opportunity_id', 'party_id'].filter((f) => input[f]);
  if (suppliedSubjects.length === 0) {
    fail(CRM_ERRORS.VALIDATION_FAILED, 'an activity must reference exactly one of lead, opportunity or party', {});
  }
  if (suppliedSubjects.length > 1) {
    fail(CRM_ERRORS.VALIDATION_FAILED, 'an activity must reference exactly one of lead, opportunity or party, not several', { supplied: suppliedSubjects });
  }

  let subjectType;
  let leadId = null;
  let opportunityId = null;
  let partyId = null;
  if (input.opportunity_id) {
    subjectType = 'opportunity';
    opportunityId = input.opportunity_id;
    const opp = db.prepare('SELECT lead_id FROM crm_opportunities WHERE id = ?').get(input.opportunity_id);
    if (!opp) fail(CRM_ERRORS.OPPORTUNITY_NOT_FOUND, `unknown opportunity ${input.opportunity_id}`, { opportunityId: input.opportunity_id });
    leadId = opp.lead_id ?? null; // lineage only, not the primary subject
  } else if (input.lead_id) {
    subjectType = 'lead';
    leadId = input.lead_id;
  } else {
    subjectType = 'party';
    partyId = input.party_id;
  }

  const id = newId('act');
  const ts = now();
  db.prepare(`
    INSERT INTO crm_activities (
      id, company_id, subject_type, lead_id, opportunity_id, party_id, activity_type, summary, detail,
      due_at, due_date, assigned_user_id, state, priority, done, created_at, created_by, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'planned', ?, 0, ?, ?, ?)
  `).run(
    id, companyId, subjectType, leadId, opportunityId, partyId,
    type, input.summary, input.detail ?? '',
    input.due_at ?? null, input.due_at ? String(input.due_at).slice(0, 10) : null,
    input.assigned_user_id ?? actor, input.priority ?? 'normal', ts, actor, ts
  );

  // Keep the lead's next-activity marker current so list views can sort on it.
  if (leadId && input.due_at) {
    db.prepare('UPDATE crm_leads SET next_activity_at = ? WHERE id = ? AND (next_activity_at IS NULL OR next_activity_at > ?)')
      .run(input.due_at, leadId, input.due_at);
  }

  const activity = getActivity(db, id);
  writeAudit(db, { companyId, branchId, actor, action: 'crm.activity.schedule', resource: 'crm_activity', resourceId: id, after: activity });
  return { activity: decorate(activity) };
}

export function updateActivity(db, input) {
  const { companyId, branchId, actor } = scopeOf(input);
  const a = getActivity(db, input.activity_id);
  if (CLOSED.has(a.state)) fail(CRM_ERRORS.ACTIVITY_ALREADY_CLOSED, `activity is ${a.state}`, { activityId: a.id, state: a.state });

  const sets = [];
  const vals = [];
  for (const f of ['summary', 'detail', 'priority', 'due_at']) {
    if (input[f] === undefined) continue;
    sets.push(`${f} = ?`); vals.push(input[f]);
  }
  if (input.activity_type !== undefined) {
    if (!ACTIVITY_TYPES.includes(input.activity_type)) fail(CRM_ERRORS.VALIDATION_FAILED, `unknown activity type ${input.activity_type}`, { allowed: ACTIVITY_TYPES });
    sets.push('activity_type = ?'); vals.push(input.activity_type);
  }
  if (!sets.length) return { activity: decorate(a) };

  sets.push('updated_at = ?'); vals.push(now());
  db.prepare(`UPDATE crm_activities SET ${sets.join(', ')} WHERE id = ?`).run(...vals, a.id);
  const after = getActivity(db, a.id);
  writeAudit(db, { companyId, branchId, actor, action: 'crm.activity.update', resource: 'crm_activity', resourceId: a.id, before: a, after });
  return { activity: decorate(after) };
}

export function assignActivity(db, input) {
  const { companyId, branchId, actor } = scopeOf(input);
  const a = getActivity(db, input.activity_id);
  if (CLOSED.has(a.state)) fail(CRM_ERRORS.ACTIVITY_ALREADY_CLOSED, `activity is ${a.state}`, { activityId: a.id });
  db.prepare('UPDATE crm_activities SET assigned_user_id = ?, updated_at = ? WHERE id = ?').run(input.assigned_user_id, now(), a.id);
  const after = getActivity(db, a.id);
  writeAudit(db, { companyId, branchId, actor, action: 'crm.activity.assign', resource: 'crm_activity', resourceId: a.id, before: a, after });
  return { activity: decorate(after) };
}

export function completeActivity(db, input) {
  const { companyId, branchId, actor } = scopeOf(input);
  const a = getActivity(db, input.activity_id);
  if (a.state === 'completed') return { activity: decorate(a), changed: false }; // idempotent
  if (a.state === 'cancelled') fail(CRM_ERRORS.ACTIVITY_ALREADY_CLOSED, 'a cancelled activity cannot be completed', { activityId: a.id });

  const ts = now();
  db.prepare("UPDATE crm_activities SET state='completed', done=1, completed_at=?, completed_by=?, outcome=?, updated_at=? WHERE id=?")
    .run(ts, actor, input.outcome ?? '', ts, a.id);

  if (a.lead_id) db.prepare('UPDATE crm_leads SET last_interaction_at = ? WHERE id = ?').run(ts, a.lead_id);

  const after = getActivity(db, a.id);
  writeAudit(db, { companyId, branchId, actor, action: 'crm.activity.complete', resource: 'crm_activity', resourceId: a.id, before: a, after });
  emitEvent(db, { companyId, actor, eventType: 'crm.activity.completed', aggregateId: a.id, payload: { leadId: a.lead_id, opportunityId: a.opportunity_id, workItemId: a.work_item_id } });
  return { activity: decorate(after), changed: true };
}

/**
 * Cancel an activity.
 *
 * A linked Work Item is deliberately NOT deleted: it may already carry real
 * execution facts, and CRM does not own its lifecycle.
 */
export function cancelActivity(db, input) {
  const { companyId, branchId, actor } = scopeOf(input);
  const a = getActivity(db, input.activity_id);
  if (a.state === 'cancelled') return { activity: decorate(a), changed: false };
  if (a.state === 'completed') fail(CRM_ERRORS.ACTIVITY_ALREADY_CLOSED, 'a completed activity cannot be cancelled', { activityId: a.id });

  const ts = now();
  db.prepare("UPDATE crm_activities SET state='cancelled', cancelled_at=?, updated_at=? WHERE id=?").run(ts, ts, a.id);
  const after = getActivity(db, a.id);
  writeAudit(db, { companyId, branchId, actor, action: 'crm.activity.cancel', resource: 'crm_activity', resourceId: a.id, before: a, after, reason: input.reason ?? null });
  return { activity: decorate(after), changed: true, workItemRetained: Boolean(a.work_item_id) };
}

export function reopenActivity(db, input) {
  const { companyId, branchId, actor } = scopeOf(input);
  const a = getActivity(db, input.activity_id);
  if (!CLOSED.has(a.state)) return { activity: decorate(a), changed: false };
  const ts = now();
  db.prepare("UPDATE crm_activities SET state='planned', done=0, completed_at=NULL, completed_by=NULL, cancelled_at=NULL, updated_at=? WHERE id=?")
    .run(ts, a.id);
  const after = getActivity(db, a.id);
  writeAudit(db, { companyId, branchId, actor, action: 'crm.activity.reopen', resource: 'crm_activity', resourceId: a.id, before: a, after });
  return { activity: decorate(after), changed: true };
}

// --- canonical Work Item bridge -------------------------------------------

/**
 * Create ONE canonical Work Item for this activity.
 *
 * Replay returns the existing Work Item rather than creating a second. The
 * `source_type`/`source_id` columns on `work_items` are the canonical way to
 * point back at the originating record, so no bridge table is needed.
 */
export function createWorkItemFromActivity(db, input) {
  const { companyId, branchId, actor } = scopeOf(input);
  const a = getActivity(db, input.activity_id);

  if (a.work_item_id) {
    const existing = db.prepare('SELECT * FROM work_items WHERE id = ?').get(a.work_item_id);
    // Replay is a no-op that returns what already exists.
    return { activity: decorate(a), workItem: existing, created: false, replayed: true };
  }

  const workItemId = newId('wi');
  const ts = now();
  db.prepare(`
    INSERT INTO work_items (
      id, company_id, branch_id, title, description, source_type, source_id,
      status, stage, priority, assigned_user_id, due_date, progress, version, created_at, updated_at
    ) VALUES (?,?,?,?,?, 'crm_activity', ?, 'open', 'todo', ?, ?, ?, 0, 1, ?, ?)
  `).run(
    workItemId, companyId, a.company_id === companyId ? (branchId ?? null) : null,
    a.summary, a.detail ?? '', a.id,
    a.priority ?? 'normal', a.assigned_user_id ?? actor,
    a.due_at ? String(a.due_at).slice(0, 10) : null, ts, ts
  );

  db.prepare('UPDATE crm_activities SET work_item_id = ?, state = ?, updated_at = ? WHERE id = ?')
    .run(workItemId, a.state === 'planned' ? 'in_progress' : a.state, ts, a.id);

  const after = getActivity(db, a.id);
  const workItem = db.prepare('SELECT * FROM work_items WHERE id = ?').get(workItemId);
  writeAudit(db, { companyId, branchId, actor, action: 'crm.activity.create_work_item', resource: 'crm_activity', resourceId: a.id, before: { work_item_id: null }, after: { work_item_id: workItemId } });
  emitEvent(db, { companyId, actor, eventType: 'crm.activity.work_item_created', aggregateId: a.id, payload: { workItemId, activityId: a.id } });
  return { activity: decorate(after), workItem, created: true, replayed: false };
}

/** Link an activity to a Work Item that already exists. */
export function linkWorkItem(db, input) {
  const { companyId, branchId, actor } = scopeOf(input);
  const a = getActivity(db, input.activity_id);
  const wi = db.prepare('SELECT * FROM work_items WHERE id = ?').get(input.work_item_id);
  if (!wi) fail(CRM_ERRORS.VALIDATION_FAILED, `unknown work item ${input.work_item_id}`, { workItemId: input.work_item_id });
  if (a.work_item_id === wi.id) return { activity: decorate(a), linked: false, replayed: true };
  if (a.work_item_id) {
    fail(CRM_ERRORS.WORK_ITEM_ALREADY_LINKED, 'activity already links a different work item', {
      activityId: a.id, existing: a.work_item_id, attempted: wi.id,
    });
  }

  db.prepare('UPDATE crm_activities SET work_item_id = ?, updated_at = ? WHERE id = ?').run(wi.id, now(), a.id);
  const after = getActivity(db, a.id);
  writeAudit(db, { companyId, branchId, actor, action: 'crm.activity.link_work_item', resource: 'crm_activity', resourceId: a.id, after: { work_item_id: wi.id } });
  return { activity: decorate(after), linked: true, replayed: false };
}

/**
 * Governed event handler: the Work Item finished, so reflect it on the activity.
 *
 * CRM does not poll or copy Work Item status into an authoritative field — it
 * reacts to the event and marks its own reminder done.
 */
export function onWorkItemCompleted(db, { workItemId, actor, companyId }) {
  const a = db.prepare("SELECT * FROM crm_activities WHERE work_item_id = ? AND state NOT IN ('completed','cancelled')").get(workItemId);
  if (!a) return { updated: false };
  const ts = now();
  db.prepare("UPDATE crm_activities SET state='completed', done=1, completed_at=?, completed_by=?, outcome=?, updated_at=? WHERE id=?")
    .run(ts, actor ?? 'system', 'closed by linked work item', ts, a.id);
  writeAudit(db, { companyId: companyId ?? a.company_id, actor: actor ?? 'system', action: 'crm.activity.closed_by_work_item', resource: 'crm_activity', resourceId: a.id, after: { work_item_id: workItemId } });
  return { updated: true, activityId: a.id };
}

// --- views -----------------------------------------------------------------

export function listActivities(db, { companyId, assignedUserId = null, view = 'all', at = new Date(), limit = 100, offset = 0 }) {
  const clauses = ['company_id = ?'];
  const params = [companyId];
  if (assignedUserId) { clauses.push('assigned_user_id = ?'); params.push(assignedUserId); }

  const today = at.toISOString().slice(0, 10);
  switch (view) {
    case 'today': clauses.push("substr(COALESCE(due_at, due_date, ''), 1, 10) = ?"); params.push(today); break;
    case 'overdue': clauses.push("state NOT IN ('completed','cancelled') AND due_at IS NOT NULL AND due_at < ?"); params.push(at.toISOString()); break;
    case 'upcoming': clauses.push("state NOT IN ('completed','cancelled') AND due_at IS NOT NULL AND due_at >= ?"); params.push(at.toISOString()); break;
    case 'completed': clauses.push("state = 'completed'"); break;
    case 'open': clauses.push("state NOT IN ('completed','cancelled')"); break;
    default: break;
  }

  const rows = db.prepare(
    `SELECT * FROM crm_activities WHERE ${clauses.join(' AND ')} ORDER BY COALESCE(due_at, created_at) ASC, id ASC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) n FROM crm_activities WHERE ${clauses.join(' AND ')}`).get(...params).n;

  return { items: rows.map((r) => decorate(r, at)), total, limit, offset, view };
}
