// Canonical Project domain — lifecycle, structure and governance.
//
//   draft → planned → approved → active → on_hold → completed → closed
//   (cancelled from any pre-completion state)
//
// The rule that shapes this file: a project has no tasks of its own. Project
// work is a canonical Phase 04 Work Item carrying `project_ref`. `createProjectWorkItem`
// is a thin convenience over the Work Item authority, not a second store.

import {
  createDomainError, domainGuards, makeId, nowIso, round2, round6,
} from '../kernel/domain/kit.mjs';
import { createWorkItem } from '../work_items/work_items.mjs';

export const ProjectError = createDomainError('ProjectError', 'PROJECT_ERROR');
const g = domainGuards(ProjectError);

const PRE_COMPLETION_STATES = ['draft', 'planned', 'approved', 'active', 'on_hold'];

export function createProject(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const name = g.requireText(payload.name, 'project name');
  const code = String(payload.code || '').trim() || g.nextReference(db, 'projects', companyId, 'PRJ', 'code');

  const duplicate = db.prepare('SELECT id FROM projects WHERE company_id = ? AND code = ?').get(companyId, code);
  if (duplicate) throw new ProjectError(`project code already exists: ${code}`, 'PROJECT_DUPLICATE', 409);

  if (payload.customer_party_id) g.scopedRow(db, 'parties', payload.customer_party_id, companyId, 'customer');
  if (payload.sale_order_id) g.scopedRow(db, 'sale_orders', payload.sale_order_id, companyId, 'sale order');
  if (payload.template_id) g.scopedRow(db, 'project_templates', payload.template_id, companyId, 'project template');

  const billingMethod = payload.billing_method || 'fixed_price';
  if (!['fixed_price', 'time_and_material', 'milestone', 'progress'].includes(billingMethod)) {
    throw new ProjectError(`unsupported billing_method: ${billingMethod}`, 'INPUT_INVALID');
  }

  const id = payload.id || makeId('prj');
  const now = nowIso();
  db.prepare(`
    INSERT INTO projects (
      id, company_id, branch_id, code, name, description, state, customer_party_id,
      sale_order_id, contract_ref, quotation_ref, template_id, manager_ref,
      dimension_value_id, currency, planned_start, planned_end, actual_start, actual_end,
      contract_value, retainage_percent, billing_method, percent_complete,
      approved_by, approved_at, closed_at, cancelled_reason,
      created_at, created_by, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL,
      ?, ?, ?, 0, NULL, NULL, NULL, NULL, ?, ?, ?, 1)
  `).run(
    id, companyId, payload.branch_id || null, code, name, payload.description || null,
    payload.customer_party_id || null, payload.sale_order_id || null,
    payload.contract_ref || null, payload.quotation_ref || null,
    payload.template_id || null, payload.manager_ref || null,
    payload.dimension_value_id || null, payload.currency || 'IQD',
    payload.planned_start || null, payload.planned_end || null,
    g.nonNegative(payload.contract_value, 'contract_value'),
    g.nonNegative(payload.retainage_percent, 'retainage_percent'),
    billingMethod, now, actor, now,
  );

  if (payload.template_id) {
    applyTemplateDefinition(db, {
      company_id: companyId, actor, actor_id: actor,
      project_id: id, template_id: payload.template_id,
    });
  }
  return getProject(db, id, companyId);
}

export function updateProject(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const project = g.scopedRow(db, 'projects', payload.project_id, companyId, 'project');
  if (['closed', 'cancelled'].includes(project.state)) {
    throw new ProjectError('a closed or cancelled project cannot be edited', 'PROJECT_STATE_INVALID');
  }
  const allowed = [
    'name', 'description', 'manager_ref', 'planned_start', 'planned_end',
    'contract_value', 'retainage_percent', 'billing_method', 'percent_complete',
    'customer_party_id', 'contract_ref', 'quotation_ref',
  ];
  const assignments = [];
  const params = [];
  for (const key of allowed) {
    if (payload[key] === undefined) continue;
    assignments.push(`${key} = ?`);
    params.push(payload[key]);
  }
  if (!assignments.length) return getProject(db, project.id, companyId);
  assignments.push('updated_at = ?', 'version = version + 1');
  params.push(nowIso(), project.id);
  db.prepare(`UPDATE projects SET ${assignments.join(', ')} WHERE id = ?`).run(...params);
  return getProject(db, project.id, companyId);
}

function transition(db, payload, allowedFrom, nextState, extra = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const project = g.scopedRow(db, 'projects', payload.project_id, companyId, 'project');
  g.assertState(project.state, allowedFrom, 'project', 'PROJECT_STATE_INVALID');
  const now = nowIso();
  const assignments = ['state = ?', 'updated_at = ?', 'version = version + 1'];
  const params = [nextState, now];
  for (const [column, value] of Object.entries(extra)) {
    assignments.splice(assignments.length - 1, 0, `${column} = ?`);
    params.splice(params.length, 0, typeof value === 'function' ? value(project, actor, now) : value);
  }
  params.push(project.id);
  db.prepare(`UPDATE projects SET ${assignments.join(', ')} WHERE id = ?`).run(...params);
  return getProject(db, project.id, companyId);
}

export function planProject(db, payload = {}) {
  return transition(db, payload, ['draft'], 'planned');
}

/**
 * Approval requires an approved budget when the company policy demands one.
 * The check reads the Control Plane rather than a constant, so a company that
 * runs projects without formal budgets is not blocked by another company's
 * policy.
 */
export function approveProject(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const project = g.scopedRow(db, 'projects', payload.project_id, companyId, 'project');
  g.assertState(project.state, ['draft', 'planned'], 'project', 'PROJECT_STATE_INVALID');

  if (payload.require_approved_budget) {
    const budget = db.prepare(
      "SELECT id FROM project_budgets WHERE project_id = ? AND status = 'approved' ORDER BY revision DESC LIMIT 1",
    ).get(project.id);
    if (!budget) {
      throw new ProjectError(
        'this project has no approved budget; approve the budget first',
        'PROJECT_BUDGET_NOT_APPROVED',
      );
    }
  }
  const now = nowIso();
  db.prepare(`
    UPDATE projects SET state = 'approved', approved_by = ?, approved_at = ?,
      updated_at = ?, version = version + 1 WHERE id = ?
  `).run(actor, now, now, project.id);
  return getProject(db, project.id, companyId);
}

export function activateProject(db, payload = {}) {
  return transition(db, payload, ['approved', 'on_hold'], 'active', {
    actual_start: (project) => project.actual_start || nowIso(),
  });
}

export function holdProject(db, payload = {}) {
  return transition(db, payload, ['active'], 'on_hold');
}

/**
 * A project cannot be completed while work is still open, because "completed"
 * is what stops further cost from being accepted against it.
 */
export function completeProject(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const project = g.scopedRow(db, 'projects', payload.project_id, companyId, 'project');
  g.assertState(project.state, ['active', 'on_hold'], 'project', 'PROJECT_STATE_INVALID');

  const openWorkItems = db.prepare(`
    SELECT COUNT(*) AS n FROM work_items
    WHERE company_id = ? AND project_ref = ? AND status NOT IN ('done', 'cancelled', 'archived')
  `).get(companyId, project.id).n;
  if (Number(openWorkItems) > 0 && !payload.force) {
    throw new ProjectError(
      `${openWorkItems} work item(s) are still open on this project`,
      'PROJECT_WORK_OPEN',
    );
  }
  const openProduction = db.prepare(`
    SELECT COUNT(*) AS n FROM production_orders
    WHERE company_id = ? AND project_id = ? AND state NOT IN ('completed', 'closed', 'cancelled')
  `).get(companyId, project.id).n;
  if (Number(openProduction) > 0 && !payload.force) {
    throw new ProjectError(
      `${openProduction} manufacturing order(s) are still open on this project`,
      'PROJECT_PRODUCTION_OPEN',
    );
  }

  const now = nowIso();
  db.prepare(`
    UPDATE projects SET state = 'completed', actual_end = COALESCE(actual_end, ?),
      percent_complete = 100, updated_at = ?, version = version + 1 WHERE id = ?
  `).run(now, now, project.id);
  return getProject(db, project.id, companyId);
}

/**
 * Closing is the financial statement that the job is finished. It refuses while
 * commitments are still open, because an open commitment is money the project
 * still expects to spend.
 */
export function closeProject(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const project = g.scopedRow(db, 'projects', payload.project_id, companyId, 'project');
  g.assertState(project.state, ['completed'], 'project', 'PROJECT_STATE_INVALID');
  const openCommitments = db.prepare(`
    SELECT COUNT(*) AS n FROM project_commitments
    WHERE project_id = ? AND status IN ('open', 'partially_released')
  `).get(project.id).n;
  if (Number(openCommitments) > 0 && !payload.force) {
    throw new ProjectError(
      `${openCommitments} commitment(s) are still open; release or cancel them before closing`,
      'PROJECT_COMMITMENTS_OPEN',
    );
  }
  const now = nowIso();
  db.prepare(`
    UPDATE projects SET state = 'closed', closed_at = ?, updated_at = ?, version = version + 1 WHERE id = ?
  `).run(now, now, project.id);
  return getProject(db, project.id, companyId);
}

export function cancelProject(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const project = g.scopedRow(db, 'projects', payload.project_id, companyId, 'project');
  g.assertState(project.state, PRE_COMPLETION_STATES, 'project', 'PROJECT_STATE_INVALID');
  const now = nowIso();
  db.prepare(`
    UPDATE projects SET state = 'cancelled', cancelled_reason = ?, updated_at = ?, version = version + 1
    WHERE id = ?
  `).run(payload.reason || 'cancelled by user', now, project.id);
  db.prepare("UPDATE project_commitments SET status = 'cancelled', updated_at = ? WHERE project_id = ? AND status IN ('open','partially_released')")
    .run(now, project.id);
  return getProject(db, project.id, companyId);
}

// --------------------------------------------------------------------------
// Structure
// --------------------------------------------------------------------------

export function createPhase(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const project = g.scopedRow(db, 'projects', payload.project_id, companyId, 'project');
  const name = g.requireText(payload.name, 'phase name');
  const sequence = Number(payload.sequence
    || (db.prepare('SELECT COALESCE(MAX(sequence), 0) AS s FROM project_phases WHERE project_id = ?').get(project.id).s + 10));
  const id = payload.id || makeId('prjph');
  db.prepare(`
    INSERT INTO project_phases (
      id, project_id, company_id, sequence, name, planned_start, planned_end,
      actual_start, actual_end, percent_complete, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, 'pending', ?)
  `).run(
    id, project.id, companyId, sequence, name,
    payload.planned_start || null, payload.planned_end || null, nowIso(),
  );
  return db.prepare('SELECT * FROM project_phases WHERE id = ?').get(id);
}

export function createMilestone(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const project = g.scopedRow(db, 'projects', payload.project_id, companyId, 'project');
  const name = g.requireText(payload.name, 'milestone name');
  if (payload.phase_id) g.scopedRow(db, 'project_phases', payload.phase_id, companyId, 'project phase');
  const sequence = Number(payload.sequence
    || (db.prepare('SELECT COALESCE(MAX(sequence), 0) AS s FROM project_milestones WHERE project_id = ?').get(project.id).s + 10));
  const id = payload.id || makeId('prjms');
  db.prepare(`
    INSERT INTO project_milestones (
      id, project_id, phase_id, company_id, sequence, name, due_date, achieved_at,
      billing_amount, billing_percent, is_billable, billed_document_id, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, 'pending', ?)
  `).run(
    id, project.id, payload.phase_id || null, companyId, sequence, name,
    payload.due_date || null, g.nonNegative(payload.billing_amount, 'billing_amount'),
    g.nonNegative(payload.billing_percent, 'billing_percent'),
    payload.is_billable ? 1 : 0, nowIso(),
  );
  return db.prepare('SELECT * FROM project_milestones WHERE id = ?').get(id);
}

export function achieveMilestone(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const milestone = g.scopedRow(db, 'project_milestones', payload.milestone_id, companyId, 'milestone');
  g.assertState(milestone.status, ['pending'], 'milestone', 'PROJECT_STATE_INVALID');
  db.prepare("UPDATE project_milestones SET status = 'achieved', achieved_at = ? WHERE id = ?")
    .run(payload.achieved_at || nowIso(), milestone.id);
  return db.prepare('SELECT * FROM project_milestones WHERE id = ?').get(milestone.id);
}

export function assignMember(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const project = g.scopedRow(db, 'projects', payload.project_id, companyId, 'project');
  const memberRef = g.requireText(payload.member_ref, 'member_ref');
  if (payload.role_id) g.scopedRow(db, 'project_roles', payload.role_id, companyId, 'project role');
  const id = payload.id || makeId('prjmem');
  db.prepare(`
    INSERT INTO project_members (
      id, project_id, company_id, member_ref, role_id, allocation_percent, joined_at, left_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(project_id, member_ref) DO UPDATE SET
      role_id = excluded.role_id,
      allocation_percent = excluded.allocation_percent,
      left_at = NULL
  `).run(
    id, project.id, companyId, memberRef, payload.role_id || null,
    g.positive(payload.allocation_percent || 100, 'allocation_percent'), nowIso(),
  );
  return db.prepare('SELECT * FROM project_members WHERE project_id = ? AND member_ref = ?').get(project.id, memberRef);
}

/**
 * Create project work as a canonical Work Item. This is the ONLY way project
 * work is created; there is no `project_tasks` table to fall back to.
 */
export function createProjectWorkItem(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const project = g.scopedRow(db, 'projects', payload.project_id, companyId, 'project');
  if (['closed', 'cancelled'].includes(project.state)) {
    throw new ProjectError('work cannot be added to a closed or cancelled project', 'PROJECT_STATE_INVALID');
  }
  return createWorkItem(db, {
    company_id: companyId,
    branch_id: project.branch_id || '*',
    title: g.requireText(payload.title, 'work item title'),
    description: payload.description || '',
    source_type: 'project',
    source_id: project.id,
    source_line_id: payload.phase_id || null,
    parent_id: payload.parent_id || null,
    status: payload.status || 'todo',
    stage: payload.stage || 'project',
    priority: payload.priority || 'medium',
    assigned_user_id: payload.assigned_user_id || null,
    assigned_team_id: payload.assigned_team_id || null,
    start_date: payload.start_date || null,
    due_date: payload.due_date || null,
    estimated_hours: Number(payload.estimated_hours || 0),
    checklist_json: payload.checklist || [],
    attachments_json: payload.attachments || [],
    project_ref: project.id,
    dependencies: payload.dependencies || [],
    watchers: payload.watchers || [],
    actor,
    created_by: actor,
  });
}

// --------------------------------------------------------------------------
// Templates
// --------------------------------------------------------------------------

export function createTemplate(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const name = g.requireText(payload.name, 'template name');
  const code = String(payload.code || '').trim() || g.nextReference(db, 'project_templates', companyId, 'TPL', 'code');
  const id = payload.id || makeId('prjtpl');
  db.prepare(`
    INSERT INTO project_templates (id, company_id, code, name, description, definition, is_active, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id, companyId, code, name, payload.description || null,
    JSON.stringify(payload.definition || { phases: [], milestones: [], work_items: [] }),
    nowIso(), actor,
  );
  return g.scopedRow(db, 'project_templates', id, companyId, 'project template');
}

export function applyTemplateDefinition(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const project = g.scopedRow(db, 'projects', payload.project_id, companyId, 'project');
  const template = g.scopedRow(db, 'project_templates', payload.template_id, companyId, 'project template');
  let definition;
  try {
    definition = JSON.parse(template.definition || '{}');
  } catch (_) {
    throw new ProjectError('project template definition is not valid JSON', 'TEMPLATE_INVALID');
  }

  const phaseIdByKey = new Map();
  for (const phase of definition.phases || []) {
    const created = createPhase(db, {
      company_id: companyId, actor, actor_id: actor,
      project_id: project.id, name: phase.name, sequence: phase.sequence,
      planned_start: phase.planned_start, planned_end: phase.planned_end,
    });
    if (phase.key) phaseIdByKey.set(phase.key, created.id);
  }
  for (const milestone of definition.milestones || []) {
    createMilestone(db, {
      company_id: companyId, actor, actor_id: actor,
      project_id: project.id, name: milestone.name, sequence: milestone.sequence,
      phase_id: milestone.phase_key ? phaseIdByKey.get(milestone.phase_key) : null,
      billing_amount: milestone.billing_amount, billing_percent: milestone.billing_percent,
      is_billable: milestone.is_billable,
    });
  }
  for (const item of definition.work_items || []) {
    createProjectWorkItem(db, {
      company_id: companyId, actor, actor_id: actor,
      project_id: project.id, title: item.title, description: item.description,
      phase_id: item.phase_key ? phaseIdByKey.get(item.phase_key) : null,
      estimated_hours: item.estimated_hours, priority: item.priority,
    });
  }
  db.prepare('UPDATE projects SET template_id = ?, updated_at = ? WHERE id = ?')
    .run(template.id, nowIso(), project.id);
  return getProject(db, project.id, companyId);
}

// --------------------------------------------------------------------------
// Change orders, risks, issues, documents
// --------------------------------------------------------------------------

export function createChangeOrder(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const project = g.scopedRow(db, 'projects', payload.project_id, companyId, 'project');
  const id = payload.id || makeId('prjco');
  const reference = payload.reference || g.nextReference(db, 'project_change_orders', companyId, 'CO');
  const now = nowIso();
  db.prepare(`
    INSERT INTO project_change_orders (
      id, project_id, company_id, reference, title, description, contract_value_delta,
      budget_delta, schedule_delta_days, status, requested_by, approved_by, approved_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, NULL, NULL, ?, ?)
  `).run(
    id, project.id, companyId, reference, g.requireText(payload.title, 'change order title'),
    payload.description || null, Number(payload.contract_value_delta || 0),
    Number(payload.budget_delta || 0), Number(payload.schedule_delta_days || 0),
    actor, now, now,
  );
  return g.scopedRow(db, 'project_change_orders', id, companyId, 'change order');
}

/**
 * Approving a change order moves the contract value. The budget delta is
 * deliberately NOT applied silently: a budget change is a budget revision, and
 * revisions carry their own approval.
 */
export function approveChangeOrder(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const changeOrder = g.scopedRow(db, 'project_change_orders', payload.change_order_id, companyId, 'change order');
  g.assertState(changeOrder.status, ['draft', 'submitted'], 'change order', 'PROJECT_STATE_INVALID');
  if (changeOrder.requested_by === actor && !payload.allow_self_approval) {
    throw new ProjectError(
      'a change order cannot be approved by the person who requested it',
      'SEGREGATION_OF_DUTIES', 403,
    );
  }
  const now = nowIso();
  db.prepare(`
    UPDATE project_change_orders SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ?
    WHERE id = ?
  `).run(actor, now, now, changeOrder.id);
  db.prepare(`
    UPDATE projects SET contract_value = MAX(0, contract_value + ?), updated_at = ?, version = version + 1
    WHERE id = ?
  `).run(Number(changeOrder.contract_value_delta || 0), now, changeOrder.project_id);
  return {
    ...g.scopedRow(db, 'project_change_orders', changeOrder.id, companyId, 'change order'),
    budget_revision_required: Number(changeOrder.budget_delta || 0) !== 0,
  };
}

export function recordRisk(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const project = g.scopedRow(db, 'projects', payload.project_id, companyId, 'project');
  const title = g.requireText(payload.title, 'risk title');
  let workItemId = null;
  if (payload.create_work_item) {
    workItemId = createProjectWorkItem(db, {
      company_id: companyId, actor, actor_id: actor,
      project_id: project.id, title: `Risk: ${title}`,
      description: payload.mitigation || payload.description || '',
      priority: payload.impact === 'high' ? 'high' : 'medium', stage: 'risk',
    }).id;
  }
  const id = payload.id || makeId('prjrsk');
  db.prepare(`
    INSERT INTO project_risks (
      id, project_id, company_id, title, description, likelihood, impact,
      mitigation, owner_ref, status, work_item_id, created_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)
  `).run(
    id, project.id, companyId, title, payload.description || null,
    payload.likelihood || 'medium', payload.impact || 'medium',
    payload.mitigation || null, payload.owner_ref || null, workItemId, nowIso(), actor,
  );
  return g.scopedRow(db, 'project_risks', id, companyId, 'project risk');
}

export function recordIssue(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const project = g.scopedRow(db, 'projects', payload.project_id, companyId, 'project');
  const title = g.requireText(payload.title, 'issue title');
  let workItemId = null;
  if (payload.create_work_item !== false) {
    workItemId = createProjectWorkItem(db, {
      company_id: companyId, actor, actor_id: actor,
      project_id: project.id, title: `Issue: ${title}`,
      description: payload.description || '',
      priority: payload.severity === 'critical' ? 'urgent' : 'high', stage: 'issue',
    }).id;
  }
  const id = payload.id || makeId('prjiss');
  db.prepare(`
    INSERT INTO project_issues (
      id, project_id, company_id, title, description, severity, status,
      work_item_id, raised_at, resolved_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, NULL, ?)
  `).run(
    id, project.id, companyId, title, payload.description || null,
    payload.severity || 'medium', workItemId, nowIso(), actor,
  );
  return g.scopedRow(db, 'project_issues', id, companyId, 'project issue');
}

export function attachDocument(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const project = g.scopedRow(db, 'projects', payload.project_id, companyId, 'project');
  const id = payload.id || makeId('prjdoc');
  db.prepare(`
    INSERT INTO project_documents (id, project_id, company_id, document_ref, document_type, title, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, project.id, companyId, g.requireText(payload.document_ref, 'document_ref'),
    payload.document_type || 'attachment', payload.title || null, nowIso(), actor,
  );
  return g.scopedRow(db, 'project_documents', id, companyId, 'project document');
}

// --------------------------------------------------------------------------
// Reads
// --------------------------------------------------------------------------

export function getProject(db, id, companyId) {
  const project = g.scopedRow(db, 'projects', id, companyId, 'project');
  const phases = db.prepare('SELECT * FROM project_phases WHERE project_id = ? ORDER BY sequence').all(id);
  const milestones = db.prepare('SELECT * FROM project_milestones WHERE project_id = ? ORDER BY sequence').all(id);
  const members = db.prepare('SELECT * FROM project_members WHERE project_id = ? AND left_at IS NULL').all(id);
  const workItems = db.prepare(`
    SELECT id, title, status, stage, priority, due_date, estimated_hours, actual_hours, progress
    FROM work_items WHERE company_id = ? AND project_ref = ? ORDER BY created_at
  `).all(companyId, id);
  const budget = db.prepare(
    "SELECT * FROM project_budgets WHERE project_id = ? AND status = 'approved' ORDER BY revision DESC LIMIT 1",
  ).get(id) || null;
  return { ...project, phases, milestones, members, work_items: workItems, approved_budget: budget };
}

export function listProjects(db, { company_id, state = null, customer_party_id = null, limit = 100 }) {
  let sql = 'SELECT * FROM projects WHERE company_id = ?';
  const params = [company_id];
  if (state) { sql += ' AND state = ?'; params.push(state); }
  if (customer_party_id) { sql += ' AND customer_party_id = ?'; params.push(customer_party_id); }
  sql += ` ORDER BY created_at DESC LIMIT ${Math.min(Number(limit) || 100, 500)}`;
  return db.prepare(sql).all(...params);
}

export { round2, round6 };
