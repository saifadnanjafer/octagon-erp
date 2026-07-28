// Project budget, commitments, and governance records — Checkpoint D1.
//
// Budget authority rules enforced here:
//   - A cost code belongs to exactly one project.
//   - A budget line is draft until approved; only an approved line can be
//     revised, and every revision bumps revision_no (no silent overwrite).
//   - Commitments are recorded against an APPROVED budget line. Recording a
//     commitment against an unapproved budget is a governed denial, so the
//     "committed" figure can never outrun an authority that never existed.
//   - An approved change order revises the budget through the same governed
//     revision path rather than mutating approved amounts directly.

'use strict';

import { fail, requireFields } from './errors.mjs';
import { getProject, makeId } from './projects.mjs';

const COST_TYPES = new Set(['material', 'labor', 'machine', 'subcontract', 'overhead', 'other']);

function now() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Cost codes
// ---------------------------------------------------------------------------

export function createCostCode(db, input = {}) {
  requireFields(input, ['project_id', 'code', 'name']);
  const companyId = input.company_id;
  const project = getProject(db, input.project_id, companyId);
  const costType = String(input.cost_type || 'material');
  if (!COST_TYPES.has(costType)) {
    fail(`unsupported cost type: ${costType}`, 'PROJECT_COST_TYPE_INVALID', 400);
  }
  const existing = db.prepare('SELECT id FROM project_cost_codes WHERE project_id = ? AND code = ?')
    .get(project.id, String(input.code));
  if (existing) fail(`cost code ${input.code} already exists on this project`, 'PROJECT_COST_CODE_DUPLICATE', 409);

  const id = makeId('prjcc');
  const stamp = now();
  db.prepare(`
    INSERT INTO project_cost_codes (id, company_id, project_id, code, name, cost_type, account_id, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, companyId, project.id, String(input.code), String(input.name), costType, input.account_id || null, stamp, stamp);
  return db.prepare('SELECT * FROM project_cost_codes WHERE id = ?').get(id);
}

function getCostCode(db, costCodeId, projectId) {
  const row = db.prepare('SELECT * FROM project_cost_codes WHERE id = ? AND project_id = ?').get(costCodeId, projectId);
  if (!row) fail('cost code not found on this project', 'PROJECT_COST_CODE_NOT_FOUND', 404);
  return row;
}

// ---------------------------------------------------------------------------
// Budget lines
// ---------------------------------------------------------------------------

export function setBudgetLine(db, input = {}) {
  requireFields(input, ['project_id', 'cost_code_id', 'amount']);
  const companyId = input.company_id;
  const project = getProject(db, input.project_id, companyId);
  const costCode = getCostCode(db, input.cost_code_id, project.id);
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    fail('budget amount must be a non-negative number', 'PROJECT_BUDGET_AMOUNT_INVALID', 400);
  }

  const existing = db.prepare('SELECT * FROM project_budget_lines WHERE project_id = ? AND cost_code_id = ?')
    .get(project.id, costCode.id);
  const stamp = now();

  if (!existing) {
    const id = makeId('prjbl');
    db.prepare(`
      INSERT INTO project_budget_lines (
        id, company_id, project_id, cost_code_id, approved_amount, revised_amount,
        state, revision_no, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'draft', 0, ?, ?, ?)
    `).run(id, companyId, project.id, costCode.id, amount, amount, String(input.notes || ''), stamp, stamp);
    return db.prepare('SELECT * FROM project_budget_lines WHERE id = ?').get(id);
  }

  // Once approved, the amount may only move through the governed revision
  // path so the approved baseline stays auditable.
  if (existing.state !== 'draft') {
    fail(
      'an approved budget line must be changed through projects:budget:revise',
      'PROJECT_BUDGET_ALREADY_APPROVED',
      409,
    );
  }
  db.prepare(`
    UPDATE project_budget_lines SET approved_amount = ?, revised_amount = ?, notes = ?, updated_at = ?
    WHERE id = ?
  `).run(amount, amount, String(input.notes ?? existing.notes), stamp, existing.id);
  return db.prepare('SELECT * FROM project_budget_lines WHERE id = ?').get(existing.id);
}

export function approveBudget(db, input = {}) {
  requireFields(input, ['project_id']);
  const companyId = input.company_id;
  const project = getProject(db, input.project_id, companyId);
  const lines = db.prepare("SELECT * FROM project_budget_lines WHERE project_id = ? AND state = 'draft'").all(project.id);
  if (!lines.length) {
    fail('no draft budget lines to approve on this project', 'PROJECT_BUDGET_NOTHING_TO_APPROVE', 409);
  }
  const stamp = now();
  const update = db.prepare(`
    UPDATE project_budget_lines
    SET state = 'approved', approved_by = ?, approved_at = ?, updated_at = ?
    WHERE id = ?
  `);
  for (const line of lines) update.run(input.actor || null, stamp, stamp, line.id);
  return {
    project_id: project.id,
    approved_lines: lines.length,
    approved_total: lines.reduce((sum, line) => sum + Number(line.approved_amount || 0), 0),
  };
}

export function reviseBudget(db, input = {}) {
  requireFields(input, ['project_id', 'cost_code_id', 'amount']);
  const companyId = input.company_id;
  const project = getProject(db, input.project_id, companyId);
  const costCode = getCostCode(db, input.cost_code_id, project.id);
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    fail('revised budget amount must be a non-negative number', 'PROJECT_BUDGET_AMOUNT_INVALID', 400);
  }
  const line = db.prepare('SELECT * FROM project_budget_lines WHERE project_id = ? AND cost_code_id = ?')
    .get(project.id, costCode.id);
  if (!line) fail('budget line not found for this cost code', 'PROJECT_BUDGET_LINE_NOT_FOUND', 404);
  if (line.state === 'draft') {
    fail('a draft budget line must be approved before it can be revised', 'PROJECT_BUDGET_NOT_APPROVED', 409);
  }

  // A revision may not fall below what is already committed — that would
  // create a budget that cannot honour its own commitments.
  const committed = db.prepare(`
    SELECT COALESCE(SUM(amount - released_amount), 0) AS c
    FROM project_commitments
    WHERE project_id = ? AND cost_code_id = ? AND state IN ('open','partially_released')
  `).get(project.id, costCode.id).c;
  if (amount < committed) {
    fail(
      `revised budget ${amount} is below open commitments ${committed} on cost code ${costCode.code}`,
      'PROJECT_BUDGET_BELOW_COMMITMENTS',
      409,
    );
  }

  const stamp = now();
  db.prepare(`
    UPDATE project_budget_lines
    SET revised_amount = ?, state = 'revised', revision_no = revision_no + 1, notes = ?, updated_at = ?
    WHERE id = ?
  `).run(amount, String(input.notes ?? line.notes), stamp, line.id);
  return db.prepare('SELECT * FROM project_budget_lines WHERE id = ?').get(line.id);
}

function effectiveBudget(line) {
  if (!line) return 0;
  return line.state === 'revised' ? Number(line.revised_amount || 0) : Number(line.approved_amount || 0);
}

// ---------------------------------------------------------------------------
// Commitments
// ---------------------------------------------------------------------------

export function recordCommitment(db, input = {}) {
  requireFields(input, ['project_id', 'cost_code_id', 'amount']);
  const companyId = input.company_id;
  const project = getProject(db, input.project_id, companyId);
  const costCode = getCostCode(db, input.cost_code_id, project.id);
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    fail('commitment amount must be a positive number', 'PROJECT_COMMITMENT_AMOUNT_INVALID', 400);
  }

  const line = db.prepare('SELECT * FROM project_budget_lines WHERE project_id = ? AND cost_code_id = ?')
    .get(project.id, costCode.id);
  if (!line || line.state === 'draft') {
    fail(
      'commitments require an approved budget line on this cost code',
      'PROJECT_BUDGET_NOT_APPROVED',
      409,
    );
  }

  const sourceType = String(input.source_type || 'manual');
  if (!['purchase_order', 'subcontract', 'manual', 'production_order'].includes(sourceType)) {
    fail(`unsupported commitment source: ${sourceType}`, 'PROJECT_COMMITMENT_SOURCE_INVALID', 400);
  }

  const id = makeId('prjcm');
  const stamp = now();
  db.prepare(`
    INSERT INTO project_commitments (
      id, company_id, project_id, cost_code_id, source_type, source_id,
      description, amount, released_amount, state, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0.0, 'open', ?, ?, ?)
  `).run(
    id, companyId, project.id, costCode.id, sourceType, input.source_id || null,
    String(input.description || ''), amount, input.actor || null, stamp, stamp,
  );

  const openCommitted = db.prepare(`
    SELECT COALESCE(SUM(amount - released_amount), 0) AS c
    FROM project_commitments
    WHERE project_id = ? AND cost_code_id = ? AND state IN ('open','partially_released')
  `).get(project.id, costCode.id).c;

  return {
    ...db.prepare('SELECT * FROM project_commitments WHERE id = ?').get(id),
    budget_amount: effectiveBudget(line),
    open_committed: openCommitted,
    // Reported, not blocked: exceeding budget is a management signal that the
    // Projects reports surface, and blocking it here would stall legitimate
    // change-order-driven work.
    over_budget: openCommitted > effectiveBudget(line),
  };
}

export function releaseCommitment(db, input = {}) {
  requireFields(input, ['commitment_id']);
  const companyId = input.company_id;
  const commitment = db.prepare('SELECT * FROM project_commitments WHERE id = ? AND company_id = ?')
    .get(input.commitment_id, companyId);
  if (!commitment) fail('commitment not found', 'PROJECT_COMMITMENT_NOT_FOUND', 404);
  if (commitment.state === 'released' || commitment.state === 'cancelled') {
    fail(`commitment is already ${commitment.state}`, 'PROJECT_COMMITMENT_CLOSED', 409);
  }

  const outstanding = Number(commitment.amount) - Number(commitment.released_amount);
  const requested = input.amount !== undefined ? Number(input.amount) : outstanding;
  if (!Number.isFinite(requested) || requested <= 0) {
    fail('release amount must be a positive number', 'PROJECT_COMMITMENT_AMOUNT_INVALID', 400);
  }
  if (requested > outstanding + 1e-9) {
    fail(
      `release ${requested} exceeds the outstanding commitment ${outstanding}`,
      'PROJECT_COMMITMENT_OVER_RELEASE',
      409,
    );
  }

  const released = Number(commitment.released_amount) + requested;
  const state = released >= Number(commitment.amount) - 1e-9 ? 'released' : 'partially_released';
  db.prepare('UPDATE project_commitments SET released_amount = ?, state = ?, updated_at = ? WHERE id = ?')
    .run(released, state, now(), commitment.id);
  return db.prepare('SELECT * FROM project_commitments WHERE id = ?').get(commitment.id);
}

// ---------------------------------------------------------------------------
// Change orders
// ---------------------------------------------------------------------------

function nextChangeNumber(db, projectId) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM project_change_orders WHERE project_id = ?').get(projectId).c;
  return `CO-${String(count + 1).padStart(4, '0')}`;
}

export function createChangeOrder(db, input = {}) {
  requireFields(input, ['project_id', 'title']);
  const companyId = input.company_id;
  const project = getProject(db, input.project_id, companyId);
  const id = makeId('prjco');
  const stamp = now();
  db.prepare(`
    INSERT INTO project_change_orders (
      id, company_id, project_id, change_number, title, description,
      cost_impact, revenue_impact, schedule_impact_days, state,
      requested_by, attachments, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?, ?)
  `).run(
    id, companyId, project.id, nextChangeNumber(db, project.id),
    String(input.title), String(input.description || ''),
    Number(input.cost_impact || 0), Number(input.revenue_impact || 0),
    Number(input.schedule_impact_days || 0), input.actor || null,
    JSON.stringify(Array.isArray(input.attachments) ? input.attachments : []),
    stamp, stamp,
  );
  return db.prepare('SELECT * FROM project_change_orders WHERE id = ?').get(id);
}

export function approveChangeOrder(db, input = {}) {
  requireFields(input, ['change_order_id']);
  const companyId = input.company_id;
  const co = db.prepare('SELECT * FROM project_change_orders WHERE id = ? AND company_id = ?')
    .get(input.change_order_id, companyId);
  if (!co) fail('change order not found', 'PROJECT_CHANGE_ORDER_NOT_FOUND', 404);
  if (co.state !== 'submitted' && co.state !== 'draft') {
    fail(`change order is already ${co.state}`, 'PROJECT_CHANGE_ORDER_CLOSED', 409);
  }
  const project = getProject(db, co.project_id, companyId);
  const stamp = now();

  db.prepare(`
    UPDATE project_change_orders
    SET state = 'approved', decided_by = ?, decided_at = ?, decision_reason = ?, updated_at = ?
    WHERE id = ?
  `).run(input.actor || null, stamp, String(input.reason || ''), stamp, co.id);

  // An approved change order with a revenue impact adjusts the contract
  // value; the cost impact is applied to a nominated cost code through the
  // governed revision path, never by writing approved_amount directly.
  if (Number(co.revenue_impact) !== 0) {
    db.prepare('UPDATE projects SET contract_value = contract_value + ?, version = version + 1, updated_at = ? WHERE id = ?')
      .run(Number(co.revenue_impact), stamp, project.id);
  }
  let revisedLine = null;
  if (Number(co.cost_impact) !== 0 && input.cost_code_id) {
    const costCode = getCostCode(db, input.cost_code_id, project.id);
    const line = db.prepare('SELECT * FROM project_budget_lines WHERE project_id = ? AND cost_code_id = ?')
      .get(project.id, costCode.id);
    if (line && line.state !== 'draft') {
      revisedLine = reviseBudget(db, {
        company_id: companyId,
        project_id: project.id,
        cost_code_id: costCode.id,
        amount: effectiveBudget(line) + Number(co.cost_impact),
        notes: `Change order ${co.change_number}`,
        actor: input.actor,
      });
    }
  }
  return {
    ...db.prepare('SELECT * FROM project_change_orders WHERE id = ?').get(co.id),
    revised_budget_line: revisedLine,
  };
}

export function rejectChangeOrder(db, input = {}) {
  requireFields(input, ['change_order_id']);
  const companyId = input.company_id;
  const co = db.prepare('SELECT * FROM project_change_orders WHERE id = ? AND company_id = ?')
    .get(input.change_order_id, companyId);
  if (!co) fail('change order not found', 'PROJECT_CHANGE_ORDER_NOT_FOUND', 404);
  if (co.state !== 'submitted' && co.state !== 'draft') {
    fail(`change order is already ${co.state}`, 'PROJECT_CHANGE_ORDER_CLOSED', 409);
  }
  const stamp = now();
  db.prepare(`
    UPDATE project_change_orders
    SET state = 'rejected', decided_by = ?, decided_at = ?, decision_reason = ?, updated_at = ?
    WHERE id = ?
  `).run(input.actor || null, stamp, String(input.reason || ''), stamp, co.id);
  return db.prepare('SELECT * FROM project_change_orders WHERE id = ?').get(co.id);
}

// ---------------------------------------------------------------------------
// Risks and issues
// ---------------------------------------------------------------------------

export function createRisk(db, input = {}) {
  requireFields(input, ['project_id', 'title']);
  const companyId = input.company_id;
  const project = getProject(db, input.project_id, companyId);
  const probability = Number(input.probability || 3);
  const impact = Number(input.impact || 3);
  if (probability < 1 || probability > 5 || impact < 1 || impact > 5) {
    fail('risk probability and impact must be between 1 and 5', 'PROJECT_RISK_SCORE_INVALID', 400);
  }
  const id = makeId('prjrk');
  const stamp = now();
  db.prepare(`
    INSERT INTO project_risks (
      id, company_id, project_id, title, description, category,
      probability, impact, severity, mitigation, owner_user_id, state, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
  `).run(
    id, companyId, project.id, String(input.title), String(input.description || ''),
    String(input.category || 'general'), probability, impact, probability * impact,
    String(input.mitigation || ''), input.owner_user_id || null, stamp, stamp,
  );
  return db.prepare('SELECT * FROM project_risks WHERE id = ?').get(id);
}

export function updateRisk(db, input = {}) {
  requireFields(input, ['risk_id']);
  const companyId = input.company_id;
  const risk = db.prepare('SELECT * FROM project_risks WHERE id = ? AND company_id = ?').get(input.risk_id, companyId);
  if (!risk) fail('risk not found', 'PROJECT_RISK_NOT_FOUND', 404);
  const probability = input.probability !== undefined ? Number(input.probability) : risk.probability;
  const impact = input.impact !== undefined ? Number(input.impact) : risk.impact;
  if (probability < 1 || probability > 5 || impact < 1 || impact > 5) {
    fail('risk probability and impact must be between 1 and 5', 'PROJECT_RISK_SCORE_INVALID', 400);
  }
  const state = input.state !== undefined ? String(input.state) : risk.state;
  if (!['open', 'mitigated', 'accepted', 'closed'].includes(state)) {
    fail(`unsupported risk state: ${state}`, 'PROJECT_RISK_STATE_INVALID', 400);
  }
  db.prepare(`
    UPDATE project_risks SET
      title = ?, description = ?, category = ?, probability = ?, impact = ?,
      severity = ?, mitigation = ?, owner_user_id = ?, state = ?, updated_at = ?
    WHERE id = ?
  `).run(
    input.title !== undefined ? String(input.title) : risk.title,
    input.description !== undefined ? String(input.description) : risk.description,
    input.category !== undefined ? String(input.category) : risk.category,
    probability, impact, probability * impact,
    input.mitigation !== undefined ? String(input.mitigation) : risk.mitigation,
    input.owner_user_id !== undefined ? input.owner_user_id : risk.owner_user_id,
    state, now(), risk.id,
  );
  return db.prepare('SELECT * FROM project_risks WHERE id = ?').get(risk.id);
}

export function createIssue(db, input = {}) {
  requireFields(input, ['project_id', 'title']);
  const companyId = input.company_id;
  const project = getProject(db, input.project_id, companyId);
  const severity = String(input.severity || 'medium');
  if (!['low', 'medium', 'high', 'critical'].includes(severity)) {
    fail(`unsupported issue severity: ${severity}`, 'PROJECT_ISSUE_SEVERITY_INVALID', 400);
  }
  const id = makeId('prjis');
  const stamp = now();
  db.prepare(`
    INSERT INTO project_issues (
      id, company_id, project_id, title, description, severity, raised_by,
      assigned_user_id, work_item_id, state, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
  `).run(
    id, companyId, project.id, String(input.title), String(input.description || ''),
    severity, input.actor || null, input.assigned_user_id || null,
    input.work_item_id || null, stamp, stamp,
  );
  return db.prepare('SELECT * FROM project_issues WHERE id = ?').get(id);
}

export function resolveIssue(db, input = {}) {
  requireFields(input, ['issue_id']);
  const companyId = input.company_id;
  const issue = db.prepare('SELECT * FROM project_issues WHERE id = ? AND company_id = ?').get(input.issue_id, companyId);
  if (!issue) fail('issue not found', 'PROJECT_ISSUE_NOT_FOUND', 404);
  if (issue.state === 'resolved' || issue.state === 'closed') {
    fail(`issue is already ${issue.state}`, 'PROJECT_ISSUE_CLOSED', 409);
  }
  const stamp = now();
  db.prepare(`
    UPDATE project_issues SET state = 'resolved', resolution = ?, resolved_at = ?, updated_at = ?
    WHERE id = ?
  `).run(String(input.resolution || ''), stamp, stamp, issue.id);
  return db.prepare('SELECT * FROM project_issues WHERE id = ?').get(issue.id);
}

export { effectiveBudget };
