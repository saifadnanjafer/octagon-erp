// Canonical Projects register — Checkpoint D1.
//
// Authority boundaries:
//   - Project TASKS are canonical work_items (source_type 'project',
//     project_ref = project id). This module never creates a second task
//     table or a second task lifecycle.
//   - Party/customer references resolve against the canonical `parties`
//     authority; contracts and sale orders are referenced, never copied.
//   - Nothing here reads or writes payroll, attendance, or timesheet tables.

'use strict';

import crypto from 'node:crypto';
import { createWorkItemLifecycle } from '../work_items/lifecycle.mjs';
import { ProjectError, fail, requireFields } from './errors.mjs';

const BILLING_METHODS = new Set(['fixed_price', 'milestone', 'time_and_material']);
const PROJECT_STATUSES = new Set(['draft', 'active', 'on_hold', 'completed', 'cancelled', 'archived']);

// Status transitions are governed: a cancelled or archived project is
// terminal, and completion requires having been active.
const STATUS_TRANSITIONS = {
  draft: ['active', 'cancelled'],
  active: ['on_hold', 'completed', 'cancelled'],
  on_hold: ['active', 'cancelled'],
  completed: ['archived'],
  cancelled: ['archived'],
  archived: [],
};

export function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function now() {
  return new Date().toISOString();
}

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed === null ? fallback : parsed;
  } catch (_) {
    return fallback;
  }
}

export function getProject(db, projectId, companyId) {
  const row = db.prepare('SELECT * FROM projects WHERE id = ? AND company_id = ?').get(projectId, companyId);
  if (!row) fail(`project not found: ${projectId}`, 'PROJECT_NOT_FOUND', 404);
  return row;
}

function assertMutable(project) {
  if (project.status === 'archived') {
    fail('an archived project cannot be modified', 'PROJECT_ARCHIVED', 409);
  }
}

function nextProjectNumber(db, companyId) {
  // Deterministic, gap-tolerant sequence scoped per company.
  const row = db.prepare(`
    SELECT project_number FROM projects
    WHERE company_id = ? AND project_number LIKE 'PRJ-%'
    ORDER BY project_number DESC LIMIT 1
  `).get(companyId);
  const last = row ? Number.parseInt(String(row.project_number).slice(4), 10) : 0;
  const next = Number.isFinite(last) ? last + 1 : 1;
  return `PRJ-${String(next).padStart(5, '0')}`;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export function createProject(db, input = {}) {
  requireFields(input, ['name']);
  const companyId = input.company_id;
  const billingMethod = String(input.billing_method || 'fixed_price');
  if (!BILLING_METHODS.has(billingMethod)) {
    fail(`unsupported billing method: ${billingMethod}`, 'BILLING_METHOD_INVALID', 400);
  }

  if (input.party_id) {
    const party = db.prepare('SELECT id FROM parties WHERE id = ? AND company_id = ?').get(input.party_id, companyId);
    if (!party) fail('project customer must be a canonical party in the active company', 'PARTY_NOT_FOUND', 404);
  }
  if (input.sale_order_id) {
    const order = db.prepare('SELECT id FROM sale_orders WHERE id = ? AND company_id = ?').get(input.sale_order_id, companyId);
    if (!order) fail('linked sale order not found in the active company', 'SALE_ORDER_NOT_FOUND', 404);
  }
  if (input.start_date && input.end_date && String(input.end_date) < String(input.start_date)) {
    fail('project end date cannot precede the start date', 'PROJECT_DATES_INVALID', 400);
  }

  const id = makeId('prj');
  const stamp = now();
  const projectNumber = input.project_number || nextProjectNumber(db, companyId);

  db.prepare(`
    INSERT INTO projects (
      id, company_id, branch_id, project_number, name, description, party_id,
      contract_id, sale_order_id, template_id, manager_user_id, team,
      start_date, end_date, status, billing_method, contract_value,
      retention_percent, currency_code, cost_center_id, analytic_dimension,
      documents, version, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).run(
    id, companyId, input.branch_id || null, projectNumber,
    String(input.name), String(input.description || ''),
    input.party_id || null, input.contract_id || null, input.sale_order_id || null,
    input.template_id || null, input.manager_user_id || null,
    JSON.stringify(Array.isArray(input.team) ? input.team : []),
    input.start_date || null, input.end_date || null,
    billingMethod,
    Number(input.contract_value || 0),
    Number(input.retention_percent || 0),
    String(input.currency_code || 'IQD'),
    input.cost_center_id || null,
    JSON.stringify(parseJson(input.analytic_dimension, {})),
    JSON.stringify(Array.isArray(input.documents) ? input.documents : []),
    input.actor || null, stamp, stamp,
  );

  if (input.template_id) {
    applyTemplate(db, { company_id: companyId, project_id: id, template_id: input.template_id, actor: input.actor });
  }
  return readProject(db, id, companyId);
}

export function updateProject(db, input = {}) {
  requireFields(input, ['project_id']);
  const companyId = input.company_id;
  const project = getProject(db, input.project_id, companyId);
  assertMutable(project);

  if (input.billing_method !== undefined && !BILLING_METHODS.has(String(input.billing_method))) {
    fail(`unsupported billing method: ${input.billing_method}`, 'BILLING_METHOD_INVALID', 400);
  }
  const startDate = input.start_date !== undefined ? input.start_date : project.start_date;
  const endDate = input.end_date !== undefined ? input.end_date : project.end_date;
  if (startDate && endDate && String(endDate) < String(startDate)) {
    fail('project end date cannot precede the start date', 'PROJECT_DATES_INVALID', 400);
  }

  const fields = {
    name: input.name !== undefined ? String(input.name) : project.name,
    description: input.description !== undefined ? String(input.description) : project.description,
    party_id: input.party_id !== undefined ? input.party_id : project.party_id,
    contract_id: input.contract_id !== undefined ? input.contract_id : project.contract_id,
    sale_order_id: input.sale_order_id !== undefined ? input.sale_order_id : project.sale_order_id,
    manager_user_id: input.manager_user_id !== undefined ? input.manager_user_id : project.manager_user_id,
    team: JSON.stringify(input.team !== undefined ? input.team : parseJson(project.team, [])),
    start_date: startDate,
    end_date: endDate,
    billing_method: input.billing_method !== undefined ? String(input.billing_method) : project.billing_method,
    contract_value: input.contract_value !== undefined ? Number(input.contract_value) : project.contract_value,
    retention_percent: input.retention_percent !== undefined ? Number(input.retention_percent) : project.retention_percent,
    cost_center_id: input.cost_center_id !== undefined ? input.cost_center_id : project.cost_center_id,
    analytic_dimension: JSON.stringify(input.analytic_dimension !== undefined
      ? parseJson(input.analytic_dimension, {})
      : parseJson(project.analytic_dimension, {})),
    documents: JSON.stringify(input.documents !== undefined
      ? (Array.isArray(input.documents) ? input.documents : [])
      : parseJson(project.documents, [])),
  };

  db.prepare(`
    UPDATE projects SET
      name = ?, description = ?, party_id = ?, contract_id = ?, sale_order_id = ?,
      manager_user_id = ?, team = ?, start_date = ?, end_date = ?, billing_method = ?,
      contract_value = ?, retention_percent = ?, cost_center_id = ?,
      analytic_dimension = ?, documents = ?, version = version + 1, updated_at = ?
    WHERE id = ? AND company_id = ?
  `).run(
    fields.name, fields.description, fields.party_id, fields.contract_id, fields.sale_order_id,
    fields.manager_user_id, fields.team, fields.start_date, fields.end_date, fields.billing_method,
    fields.contract_value, fields.retention_percent, fields.cost_center_id,
    fields.analytic_dimension, fields.documents, now(), project.id, companyId,
  );
  return readProject(db, project.id, companyId);
}

export function setProjectStatus(db, input = {}) {
  requireFields(input, ['project_id', 'status']);
  const companyId = input.company_id;
  const project = getProject(db, input.project_id, companyId);
  const target = String(input.status);
  if (!PROJECT_STATUSES.has(target)) {
    fail(`unsupported project status: ${target}`, 'PROJECT_STATUS_INVALID', 400);
  }
  if (target === project.status) return readProject(db, project.id, companyId);

  const allowed = STATUS_TRANSITIONS[project.status] || [];
  if (!allowed.includes(target)) {
    fail(
      `project cannot move from ${project.status} to ${target}`,
      'PROJECT_TRANSITION_INVALID',
      409,
    );
  }

  // Completing a project with unresolved critical issues is a governed denial,
  // not a silent pass.
  if (target === 'completed') {
    const open = db.prepare(`
      SELECT COUNT(*) AS c FROM project_issues
      WHERE project_id = ? AND severity = 'critical' AND state NOT IN ('resolved','closed')
    `).get(project.id).c;
    if (open > 0) {
      fail(`project has ${open} unresolved critical issue(s)`, 'PROJECT_HAS_OPEN_CRITICAL_ISSUES', 409);
    }
  }

  db.prepare('UPDATE projects SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND company_id = ?')
    .run(target, now(), project.id, companyId);
  return readProject(db, project.id, companyId);
}

export function archiveProject(db, input = {}) {
  return setProjectStatus(db, { ...input, status: 'archived' });
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export function createTemplate(db, input = {}) {
  requireFields(input, ['name']);
  const companyId = input.company_id;
  const id = makeId('prjtpl');
  const stamp = now();
  const code = String(input.code || `TPL-${String(input.name).slice(0, 12).toUpperCase().replace(/[^A-Z0-9]/g, '-')}`);
  const method = String(input.default_billing_method || 'fixed_price');
  if (!BILLING_METHODS.has(method)) {
    fail(`unsupported billing method: ${method}`, 'BILLING_METHOD_INVALID', 400);
  }
  db.prepare(`
    INSERT INTO project_templates (
      id, company_id, code, name, description, default_billing_method,
      phases, milestones, cost_codes, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id, companyId, code, String(input.name), String(input.description || ''), method,
    JSON.stringify(Array.isArray(input.phases) ? input.phases : []),
    JSON.stringify(Array.isArray(input.milestones) ? input.milestones : []),
    JSON.stringify(Array.isArray(input.cost_codes) ? input.cost_codes : []),
    stamp, stamp,
  );
  return db.prepare('SELECT * FROM project_templates WHERE id = ?').get(id);
}

export function applyTemplate(db, input = {}) {
  requireFields(input, ['project_id', 'template_id']);
  const companyId = input.company_id;
  const project = getProject(db, input.project_id, companyId);
  assertMutable(project);
  const template = db.prepare('SELECT * FROM project_templates WHERE id = ? AND company_id IN (?, ?)')
    .get(input.template_id, companyId, '*');
  if (!template) fail('project template not found', 'PROJECT_TEMPLATE_NOT_FOUND', 404);

  const stamp = now();
  const phases = parseJson(template.phases, []);
  const milestones = parseJson(template.milestones, []);
  const costCodes = parseJson(template.cost_codes, []);

  const insertPhase = db.prepare(`
    INSERT INTO project_phases (
      id, company_id, project_id, parent_phase_id, wbs_code, sequence, name,
      description, planned_start, planned_end, weight, progress, status, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, NULL, NULL, ?, 0.0, 'planned', ?, ?)
  `);
  const phaseIdByKey = new Map();
  phases.forEach((phase, index) => {
    const phaseId = makeId('prjph');
    const wbs = String(phase.wbs_code || `${index + 1}`);
    insertPhase.run(
      phaseId, companyId, project.id, wbs, Number(phase.sequence || (index + 1) * 10),
      String(phase.name || `Phase ${index + 1}`), String(phase.description || ''),
      Number(phase.weight || 1), stamp, stamp,
    );
    phaseIdByKey.set(String(phase.key || phase.name || wbs), phaseId);
  });

  const insertMilestone = db.prepare(`
    INSERT INTO project_milestones (
      id, company_id, project_id, phase_id, name, description, due_date,
      billing_amount, billing_percent, is_billable, deliverables, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `);
  for (const milestone of milestones) {
    insertMilestone.run(
      makeId('prjms'), companyId, project.id,
      phaseIdByKey.get(String(milestone.phase_key || '')) || null,
      String(milestone.name || 'Milestone'), String(milestone.description || ''),
      milestone.due_date || null,
      Number(milestone.billing_amount || 0), Number(milestone.billing_percent || 0),
      milestone.is_billable ? 1 : 0,
      JSON.stringify(Array.isArray(milestone.deliverables) ? milestone.deliverables : []),
      stamp, stamp,
    );
  }

  const insertCostCode = db.prepare(`
    INSERT INTO project_cost_codes (id, company_id, project_id, code, name, cost_type, account_id, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(project_id, code) DO NOTHING
  `);
  for (const costCode of costCodes) {
    insertCostCode.run(
      makeId('prjcc'), companyId, project.id,
      String(costCode.code || 'GEN'), String(costCode.name || 'General'),
      String(costCode.cost_type || 'other'), costCode.account_id || null, stamp, stamp,
    );
  }

  db.prepare('UPDATE projects SET template_id = ?, version = version + 1, updated_at = ? WHERE id = ?')
    .run(template.id, stamp, project.id);
  return readProject(db, project.id, companyId);
}

// ---------------------------------------------------------------------------
// Phases / WBS
// ---------------------------------------------------------------------------

export function createPhase(db, input = {}) {
  requireFields(input, ['project_id', 'name']);
  const companyId = input.company_id;
  const project = getProject(db, input.project_id, companyId);
  assertMutable(project);

  if (input.parent_phase_id) {
    const parent = db.prepare('SELECT id FROM project_phases WHERE id = ? AND project_id = ?')
      .get(input.parent_phase_id, project.id);
    if (!parent) fail('parent phase not found on this project', 'PROJECT_PHASE_NOT_FOUND', 404);
  }
  if (input.planned_start && input.planned_end && String(input.planned_end) < String(input.planned_start)) {
    fail('phase end cannot precede phase start', 'PROJECT_PHASE_DATES_INVALID', 400);
  }

  const id = makeId('prjph');
  const stamp = now();
  const seq = Number(input.sequence
    || (db.prepare('SELECT COALESCE(MAX(sequence),0) AS s FROM project_phases WHERE project_id = ?').get(project.id).s + 10));
  db.prepare(`
    INSERT INTO project_phases (
      id, company_id, project_id, parent_phase_id, wbs_code, sequence, name, description,
      planned_start, planned_end, weight, progress, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.0, 'planned', ?, ?)
  `).run(
    id, companyId, project.id, input.parent_phase_id || null,
    String(input.wbs_code || ''), seq, String(input.name), String(input.description || ''),
    input.planned_start || null, input.planned_end || null, Number(input.weight || 1), stamp, stamp,
  );
  return db.prepare('SELECT * FROM project_phases WHERE id = ?').get(id);
}

export function updatePhase(db, input = {}) {
  requireFields(input, ['phase_id']);
  const companyId = input.company_id;
  const phase = db.prepare('SELECT * FROM project_phases WHERE id = ? AND company_id = ?').get(input.phase_id, companyId);
  if (!phase) fail('phase not found', 'PROJECT_PHASE_NOT_FOUND', 404);
  assertMutable(getProject(db, phase.project_id, companyId));

  const progress = input.progress !== undefined ? Number(input.progress) : phase.progress;
  if (progress < 0 || progress > 100) fail('phase progress must be between 0 and 100', 'PROJECT_PROGRESS_INVALID', 400);
  const status = input.status !== undefined ? String(input.status) : phase.status;
  if (!['planned', 'in_progress', 'completed', 'cancelled'].includes(status)) {
    fail(`unsupported phase status: ${status}`, 'PROJECT_PHASE_STATUS_INVALID', 400);
  }

  db.prepare(`
    UPDATE project_phases SET
      name = ?, description = ?, planned_start = ?, planned_end = ?,
      actual_start = ?, actual_end = ?, weight = ?, progress = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).run(
    input.name !== undefined ? String(input.name) : phase.name,
    input.description !== undefined ? String(input.description) : phase.description,
    input.planned_start !== undefined ? input.planned_start : phase.planned_start,
    input.planned_end !== undefined ? input.planned_end : phase.planned_end,
    input.actual_start !== undefined ? input.actual_start : phase.actual_start,
    input.actual_end !== undefined ? input.actual_end : phase.actual_end,
    input.weight !== undefined ? Number(input.weight) : phase.weight,
    progress, status, now(), phase.id,
  );
  return db.prepare('SELECT * FROM project_phases WHERE id = ?').get(phase.id);
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

export function createMilestone(db, input = {}) {
  requireFields(input, ['project_id', 'name']);
  const companyId = input.company_id;
  const project = getProject(db, input.project_id, companyId);
  assertMutable(project);
  if (input.phase_id) {
    const phase = db.prepare('SELECT id FROM project_phases WHERE id = ? AND project_id = ?').get(input.phase_id, project.id);
    if (!phase) fail('milestone phase not found on this project', 'PROJECT_PHASE_NOT_FOUND', 404);
  }

  const id = makeId('prjms');
  const stamp = now();
  db.prepare(`
    INSERT INTO project_milestones (
      id, company_id, project_id, phase_id, name, description, due_date,
      billing_amount, billing_percent, is_billable, deliverables, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(
    id, companyId, project.id, input.phase_id || null, String(input.name),
    String(input.description || ''), input.due_date || null,
    Number(input.billing_amount || 0), Number(input.billing_percent || 0),
    input.is_billable ? 1 : 0,
    JSON.stringify(Array.isArray(input.deliverables) ? input.deliverables : []),
    stamp, stamp,
  );
  return db.prepare('SELECT * FROM project_milestones WHERE id = ?').get(id);
}

export function achieveMilestone(db, input = {}) {
  requireFields(input, ['milestone_id']);
  const companyId = input.company_id;
  const milestone = db.prepare('SELECT * FROM project_milestones WHERE id = ? AND company_id = ?')
    .get(input.milestone_id, companyId);
  if (!milestone) fail('milestone not found', 'PROJECT_MILESTONE_NOT_FOUND', 404);
  if (milestone.status === 'achieved') {
    fail('milestone is already achieved', 'PROJECT_MILESTONE_ALREADY_ACHIEVED', 409);
  }
  if (milestone.status === 'cancelled') {
    fail('a cancelled milestone cannot be achieved', 'PROJECT_MILESTONE_CANCELLED', 409);
  }
  const project = getProject(db, milestone.project_id, companyId);
  if (project.status !== 'active') {
    fail('milestones can only be achieved on an active project', 'PROJECT_NOT_ACTIVE', 409);
  }

  db.prepare(`
    UPDATE project_milestones
    SET status = 'achieved', achieved_at = ?, achieved_by = ?, updated_at = ?
    WHERE id = ?
  `).run(now(), input.actor || null, now(), milestone.id);
  return db.prepare('SELECT * FROM project_milestones WHERE id = ?').get(milestone.id);
}

// ---------------------------------------------------------------------------
// Project tasks — delegated to the canonical Work Item authority
// ---------------------------------------------------------------------------

export function createProjectTask(db, input = {}) {
  requireFields(input, ['project_id', 'title']);
  const companyId = input.company_id;
  const project = getProject(db, input.project_id, companyId);
  assertMutable(project);
  if (input.phase_id) {
    const phase = db.prepare('SELECT id FROM project_phases WHERE id = ? AND project_id = ?').get(input.phase_id, project.id);
    if (!phase) fail('task phase not found on this project', 'PROJECT_PHASE_NOT_FOUND', 404);
  }

  // Canonical Work Item authority owns the task record and its lifecycle.
  return createWorkItemLifecycle(db, {
    company_id: companyId,
    branch_id: input.branch_id || project.branch_id || null,
    title: String(input.title),
    description: String(input.description || ''),
    source_type: 'project',
    source_id: project.id,
    source_line_id: input.phase_id || null,
    project_ref: project.id,
    priority: input.priority || 'medium',
    assigned_user_id: input.assigned_user_id || null,
    start_date: input.start_date || null,
    due_date: input.due_date || null,
    estimated_hours: Number(input.estimated_hours || 0),
    actor: input.actor || null,
  });
}

export function listProjectTasks(db, projectId, companyId) {
  return db.prepare(`
    SELECT * FROM work_items
    WHERE company_id = ? AND project_ref = ?
    ORDER BY created_at DESC
  `).all(companyId, projectId);
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

export function readProject(db, projectId, companyId) {
  const project = getProject(db, projectId, companyId);
  return {
    ...project,
    team: parseJson(project.team, []),
    analytic_dimension: parseJson(project.analytic_dimension, {}),
    documents: parseJson(project.documents, []),
    phases: db.prepare('SELECT * FROM project_phases WHERE project_id = ? ORDER BY sequence, created_at').all(project.id),
    milestones: db.prepare('SELECT * FROM project_milestones WHERE project_id = ? ORDER BY due_date, created_at').all(project.id),
    cost_codes: db.prepare('SELECT * FROM project_cost_codes WHERE project_id = ? ORDER BY code').all(project.id),
    task_count: db.prepare('SELECT COUNT(*) AS c FROM work_items WHERE company_id = ? AND project_ref = ?')
      .get(companyId, project.id).c,
  };
}

export function listProjects(db, ctx = {}, query = {}) {
  const companyId = ctx.companyId;
  const filters = ['company_id = ?'];
  const params = [companyId];
  if (query.status) { filters.push('status = ?'); params.push(String(query.status)); }
  if (query.party_id) { filters.push('party_id = ?'); params.push(String(query.party_id)); }
  if (query.manager_user_id) { filters.push('manager_user_id = ?'); params.push(String(query.manager_user_id)); }
  const limit = Math.min(Number(query.limit || 200), 500);
  const rows = db.prepare(
    `SELECT * FROM projects WHERE ${filters.join(' AND ')} ORDER BY created_at DESC LIMIT ?`,
  ).all(...params, limit);
  return rows.map((row) => ({
    ...row,
    team: parseJson(row.team, []),
    analytic_dimension: parseJson(row.analytic_dimension, {}),
    documents: parseJson(row.documents, []),
  }));
}

export { ProjectError };
