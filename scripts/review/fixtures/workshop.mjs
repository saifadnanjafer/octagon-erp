// Review Freeze — disposable Al-Warsha workshop job fixtures.
//
// Fictional demo rows against the canonical Work Item authority (see
// database/migrations/042_canonical_work_item_and_authority_retirement.mjs
// for `work_items`). There is no dedicated "workshop_jobs" table: the real
// business models workshop jobs as canonical work items with
// source_type='work_order', which the Al-Warsha terminology overlay
// (database/migrations/089_build12_ai_people_marketing_events_pack.mjs,
// pack_profile_al_warsha.terminology_overlay: {"work_order":"Workshop Job", ...})
// relabels as "Workshop Job" in the UI. `status`/`stage` have no CHECK
// constraint in the DDL, so this fixture uses the same literal values the
// live queries already filter on (see platform/workshop/command-center-catalog.mjs
// and platform/workshop/my-work.mjs: 'blocked', 'quality_hold', 'waiting_approval',
// sla_status='breached', etc.) so each row lands in the right board/queue.
//
// Never real data, never written outside a disposable review database. All
// invented ids are prefixed `rev_` and every insert is idempotent via
// ON CONFLICT(id) DO NOTHING.
//
// Attribution: jobs are assigned to the disposable review identities from
// scripts/review/roles.mjs (usr_review_<role_key>) — assigned_user_id has no
// FK constraint on work_items, so referencing them here is safe regardless
// of fixture run order.

'use strict';

const WORKSHOP_MANAGER = 'usr_review_workshop_manager';
const PRODUCTION_OPERATOR = 'usr_review_production_operator';
const QUALITY_REVIEWER = 'usr_review_quality_reviewer';
const OPS_COORDINATOR = 'usr_review_ops_coordinator';

const DAY_MS = 86400000;

/**
 * @returns {Promise<{summary: object}>}
 */
export async function seedWorkshopFixtures(dialect, { tenantId, companyId, branchId, now } = {}) {
  const ts = now || new Date().toISOString();
  const nowMs = Date.parse(ts);
  const iso = (offsetDays) => new Date(nowMs + offsetDays * DAY_MS).toISOString();

  // One row per Al-Warsha job-board state. `stage` mirrors `status` for the
  // states with no dedicated status literal in the live queries, so both
  // status-based and stage-based board filters pick the row up.
  const JOBS = [
    {
      id: 'rev_wsjob_new_01', status: 'todo', stage: 'backlog', priority: 'medium', slaStatus: 'on_track',
      due: iso(10), assignee: WORKSHOP_MANAGER,
      title: '[DEMO] New Custom Gate Fabrication Job',
      description: '[DEMO] Fictional review fixture - newly opened workshop job, not yet scheduled.',
    },
    {
      id: 'rev_wsjob_due_today_01', status: 'in_progress', stage: 'production', priority: 'high', slaStatus: 'on_track',
      due: iso(0), assignee: PRODUCTION_OPERATOR,
      title: '[DEMO] Due-Today Balcony Railing Job',
      description: '[DEMO] Fictional review fixture - workshop job due today.',
    },
    {
      id: 'rev_wsjob_overdue_01', status: 'in_progress', stage: 'production', priority: 'urgent', slaStatus: 'breached',
      due: iso(-3), assignee: PRODUCTION_OPERATOR,
      title: '[DEMO] Overdue Custom Gate Job',
      description: '[DEMO] Fictional review fixture - workshop job past its due date.',
    },
    {
      id: 'rev_wsjob_blocked_01', status: 'blocked', stage: 'blocked', priority: 'high', slaStatus: 'breached',
      due: iso(2), assignee: OPS_COORDINATOR,
      title: '[DEMO] Blocked Staircase Job (Awaiting Client Decision)',
      description: '[DEMO] Fictional review fixture - workshop job blocked pending an external decision.',
    },
    {
      id: 'rev_wsjob_design_approval_01', status: 'waiting_approval', stage: 'design_approval', priority: 'medium', slaStatus: 'on_track',
      due: iso(5), assignee: WORKSHOP_MANAGER,
      title: '[DEMO] Design-Approval-Pending Window Grille Job',
      description: '[DEMO] Fictional review fixture - workshop job awaiting design approval before production.',
    },
    {
      id: 'rev_wsjob_material_shortage_01', status: 'short', stage: 'material_shortage', priority: 'high', slaStatus: 'breached',
      due: iso(1), assignee: OPS_COORDINATOR,
      title: '[DEMO] Material-Shortage Fence Panel Job',
      description: '[DEMO] Fictional review fixture - workshop job stalled on a raw-material shortage.',
    },
    {
      id: 'rev_wsjob_active_production_01', status: 'in_progress', stage: 'production', priority: 'medium', slaStatus: 'on_track',
      due: iso(4), assignee: PRODUCTION_OPERATOR,
      title: '[DEMO] Active-Production Handrail Job',
      description: '[DEMO] Fictional review fixture - workshop job currently on the shop floor.',
    },
    {
      id: 'rev_wsjob_quality_hold_01', status: 'quality_hold', stage: 'quality_hold', priority: 'high', slaStatus: 'breached',
      due: iso(1), assignee: QUALITY_REVIEWER,
      title: '[DEMO] Quality-Hold Security Door Job',
      description: '[DEMO] Fictional review fixture - workshop job held pending a quality disposition.',
    },
    {
      id: 'rev_wsjob_rework_01', status: 'rework', stage: 'rework', priority: 'high', slaStatus: 'on_track',
      due: iso(2), assignee: QUALITY_REVIEWER,
      title: '[DEMO] Rework Canopy Frame Job',
      description: '[DEMO] Fictional review fixture - workshop job returned from quality for rework.',
    },
    {
      id: 'rev_wsjob_ready_for_delivery_01', status: 'ready_for_delivery', stage: 'ready_for_delivery', priority: 'medium', slaStatus: 'on_track',
      due: iso(-1), assignee: OPS_COORDINATOR,
      title: '[DEMO] Ready-for-Delivery Pergola Job',
      description: '[DEMO] Fictional review fixture - workshop job finished and staged for delivery.',
    },
    {
      id: 'rev_wsjob_completed_01', status: 'done', stage: 'done', priority: 'low', slaStatus: 'on_track',
      due: iso(-6), assignee: WORKSHOP_MANAGER,
      title: '[DEMO] Completed Balcony Grille Job',
      description: '[DEMO] Fictional review fixture - workshop job delivered and closed out.',
    },
  ];

  const insertJob = dialect.prepare(`
    INSERT INTO work_items (
      id, company_id, branch_id, title, description, source_type,
      status, stage, priority, importance, assigned_user_id, due_date,
      completed_at, progress, sla_status, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'work_order', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);

  for (const job of JOBS) {
    const completed = job.status === 'done';
    insertJob.run(
      job.id, companyId, branchId, job.title, job.description,
      job.status, job.stage, job.priority, job.status === 'blocked' || job.status === 'quality_hold' ? 4 : 3,
      job.assignee, job.due, completed ? ts : null, completed ? 1.0 : job.status === 'ready_for_delivery' ? 0.95 : 0.0,
      job.slaStatus, ts, ts,
    );
  }

  return {
    summary: {
      jobsCreated: JOBS.length,
      statuses: JOBS.map((job) => job.status),
      table: 'work_items (source_type=work_order)',
      tenantId, companyId, branchId,
    },
  };
}

export default seedWorkshopFixtures;
