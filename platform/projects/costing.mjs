// Project budgets, commitments and job costing.
//
// **Rule Zero surface.** Project labour cost is computed from
// `project_effort_entries` and a configured rate. It does not read `employees`,
// `payroll_*`, or any attendance/timesheet collection, and `assertNotFrozen`
// fails the call closed if a caller ever tries to point it at one.
//
// Every actual cost recorded here has already been posted by a canonical
// engine: stock issues by the Phase 04 stock engine, expenses and labour
// absorption by the Phase 03 finance pipeline, manufacturing by the Phase 05
// manufacturing commands. `project_cost_facts` is the project-dimension view of
// those postings — it is not a second ledger and it never posts on its own.

import {
  createDomainError, domainGuards, makeId, nowIso, today, round2, round6,
  assertNotFrozen,
} from '../kernel/domain/kit.mjs';
import { postSourceFact } from '../finance/engine.mjs';
import { executeStockOperation } from '../inventory/operations.mjs';

export const ProjectCostError = createDomainError('ProjectCostError', 'PROJECT_COST_ERROR');
const g = domainGuards(ProjectCostError);

const COSTABLE_STATES = ['approved', 'active', 'on_hold'];

function assertCostable(project) {
  g.assertState(project.state, COSTABLE_STATES, 'project', 'PROJECT_STATE_INVALID');
}

function recordCostFact(db, {
  companyId, projectId, phaseId = null, costCodeId = null, workItemId = null,
  costType, amount, quantity = 0, currency = 'IQD', financeDocumentId = null,
  stockMoveId = null, productionOrderId = null, sourceReference = null, actor,
  occurredAt = null,
}) {
  const id = makeId('prjcf');
  const now = nowIso();
  db.prepare(`
    INSERT INTO project_cost_facts (
      id, project_id, company_id, phase_id, cost_code_id, work_item_id, cost_type,
      amount, quantity, currency, finance_document_id, stock_move_id,
      production_order_id, source_reference, occurred_at, created_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, projectId, companyId, phaseId, costCodeId, workItemId, costType,
    round2(amount), Number(quantity) || 0, currency, financeDocumentId,
    stockMoveId, productionOrderId, sourceReference, occurredAt || now, now, actor,
  );
  return id;
}

export { recordCostFact };

// --------------------------------------------------------------------------
// Cost codes
// --------------------------------------------------------------------------

export function createCostCode(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  g.requireActor(payload);
  const code = g.requireText(payload.code, 'cost code');
  const name = g.requireText(payload.name, 'cost code name');
  const id = payload.id || makeId('prjcc');
  db.prepare(`
    INSERT INTO project_cost_codes (id, company_id, code, name, cost_type, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(company_id, code) DO UPDATE SET name = excluded.name, cost_type = excluded.cost_type
  `).run(id, companyId, code, name, payload.cost_type || 'other', nowIso());
  return db.prepare('SELECT * FROM project_cost_codes WHERE company_id = ? AND code = ?').get(companyId, code);
}

// --------------------------------------------------------------------------
// Budgets
// --------------------------------------------------------------------------

export function createBudget(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const project = g.scopedRow(db, 'projects', payload.project_id, companyId, 'project');
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  if (!lines.length) throw new ProjectCostError('a budget requires at least one line', 'INPUT_MISSING_FIELD');

  const revision = Number(payload.revision
    || db.prepare('SELECT COALESCE(MAX(revision), 0) AS r FROM project_budgets WHERE project_id = ?').get(project.id).r) + (payload.revision ? 0 : 1);
  const id = payload.id || makeId('prjbud');
  const now = nowIso();
  const total = round2(lines.reduce((sum, line) => sum + g.nonNegative(line.amount, 'budget line amount'), 0));

  db.prepare(`
    INSERT INTO project_budgets (
      id, project_id, company_id, revision, revision_of_id, status, total_amount,
      currency, approved_by, approved_at, created_at, created_by, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, NULL, NULL, ?, ?, ?)
  `).run(
    id, project.id, companyId, revision, payload.revision_of_id || null,
    total, payload.currency || project.currency || 'IQD', now, actor, now,
  );

  const insertLine = db.prepare(`
    INSERT INTO project_budget_lines (
      id, budget_id, company_id, cost_code_id, phase_id, description, cost_type,
      amount, quantity, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const line of lines) {
    if (line.cost_code_id) g.scopedRow(db, 'project_cost_codes', line.cost_code_id, companyId, 'cost code');
    if (line.phase_id) g.scopedRow(db, 'project_phases', line.phase_id, companyId, 'project phase');
    insertLine.run(
      makeId('prjbl'), id, companyId, line.cost_code_id || null, line.phase_id || null,
      line.description || null, line.cost_type || 'other',
      g.nonNegative(line.amount, 'budget line amount'), Number(line.quantity || 0), now,
    );
  }
  return getBudget(db, id, companyId);
}

export function approveBudget(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const budget = g.scopedRow(db, 'project_budgets', payload.budget_id, companyId, 'project budget');
  g.assertState(budget.status, ['draft', 'submitted'], 'project budget', 'PROJECT_STATE_INVALID');
  if (budget.created_by === actor && !payload.allow_self_approval) {
    throw new ProjectCostError(
      'a budget cannot be approved by the person who created it',
      'SEGREGATION_OF_DUTIES', 403,
    );
  }
  const now = nowIso();
  db.prepare(`
    UPDATE project_budgets SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ?
    WHERE id = ?
  `).run(actor, now, now, budget.id);
  // Only one approved revision at a time: approving a revision supersedes the
  // previous one so "the budget" is never ambiguous.
  db.prepare(`
    UPDATE project_budgets SET status = 'superseded', updated_at = ?
    WHERE project_id = ? AND id != ? AND status = 'approved'
  `).run(now, budget.project_id, budget.id);
  return getBudget(db, budget.id, companyId);
}

export function reviseBudget(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const source = g.scopedRow(db, 'project_budgets', payload.budget_id, companyId, 'project budget');
  const existingLines = db.prepare('SELECT * FROM project_budget_lines WHERE budget_id = ?').all(source.id);
  const lines = payload.lines || existingLines.map((line) => ({
    cost_code_id: line.cost_code_id,
    phase_id: line.phase_id,
    description: line.description,
    cost_type: line.cost_type,
    amount: line.amount,
    quantity: line.quantity,
  }));
  return createBudget(db, {
    company_id: companyId, actor, actor_id: actor,
    project_id: source.project_id,
    revision_of_id: source.id,
    currency: source.currency,
    lines,
  });
}

export function getBudget(db, id, companyId) {
  const budget = g.scopedRow(db, 'project_budgets', id, companyId, 'project budget');
  const lines = db.prepare('SELECT * FROM project_budget_lines WHERE budget_id = ? ORDER BY created_at, id').all(id);
  return { ...budget, lines };
}

export function approvedBudget(db, companyId, projectId) {
  const budget = db.prepare(
    "SELECT * FROM project_budgets WHERE project_id = ? AND company_id = ? AND status = 'approved' ORDER BY revision DESC LIMIT 1",
  ).get(projectId, companyId);
  if (!budget) return null;
  return getBudget(db, budget.id, companyId);
}

// --------------------------------------------------------------------------
// Commitments
// --------------------------------------------------------------------------

/**
 * A commitment is money the project has promised but not yet spent — a raised
 * requisition, a placed purchase order, a released manufacturing order. Budget
 * control compares budget against (actual + committed), which is the only
 * comparison that catches an overrun before the invoice arrives.
 */
export function recordCommitment(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const project = g.scopedRow(db, 'projects', payload.project_id, companyId, 'project');
  assertCostable(project);
  const amount = g.positive(payload.amount, 'commitment amount');
  const commitmentType = payload.commitment_type || 'other';
  if (!['purchase_requisition', 'purchase_order', 'subcontract', 'manufacturing_order', 'other'].includes(commitmentType)) {
    throw new ProjectCostError(`unsupported commitment_type: ${commitmentType}`, 'INPUT_INVALID');
  }

  if (payload.enforce_budget) {
    const control = budgetControl(db, companyId, project.id);
    if (control.budget_amount > 0 && round2(control.actual_cost + control.open_commitments + amount) > control.budget_amount) {
      throw new ProjectCostError(
        `commitment of ${amount} would exceed the approved budget (${control.budget_amount}); `
        + `actual ${control.actual_cost}, committed ${control.open_commitments}`,
        'PROJECT_BUDGET_EXCEEDED',
      );
    }
  }

  const id = payload.id || makeId('prjcom');
  const now = nowIso();
  db.prepare(`
    INSERT INTO project_commitments (
      id, project_id, company_id, commitment_type, source_document_type,
      source_document_id, cost_code_id, amount, released_amount, currency,
      status, created_at, created_by, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'open', ?, ?, ?)
  `).run(
    id, project.id, companyId, commitmentType, payload.source_document_type || null,
    payload.source_document_id || null, payload.cost_code_id || null, amount,
    payload.currency || project.currency || 'IQD', now, actor, now,
  );
  return g.scopedRow(db, 'project_commitments', id, companyId, 'commitment');
}

export function releaseCommitment(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const commitment = g.scopedRow(db, 'project_commitments', payload.commitment_id, companyId, 'commitment');
  if (['released', 'cancelled'].includes(commitment.status)) {
    throw new ProjectCostError('this commitment is already closed', 'PROJECT_STATE_INVALID');
  }
  const outstanding = round2(Number(commitment.amount) - Number(commitment.released_amount));
  const releasing = payload.amount === undefined ? outstanding : g.positive(payload.amount, 'release amount');
  if (releasing - outstanding > 0.005) {
    throw new ProjectCostError(
      `cannot release ${releasing}; only ${outstanding} is outstanding on this commitment`,
      'PROJECT_COMMITMENT_EXCEEDED',
    );
  }
  const released = round2(Number(commitment.released_amount) + releasing);
  const status = released >= Number(commitment.amount) - 0.005 ? 'released' : 'partially_released';
  db.prepare('UPDATE project_commitments SET released_amount = ?, status = ?, updated_at = ? WHERE id = ?')
    .run(released, status, nowIso(), commitment.id);
  return g.scopedRow(db, 'project_commitments', commitment.id, companyId, 'commitment');
}

// --------------------------------------------------------------------------
// Actual cost
// --------------------------------------------------------------------------

/**
 * Record project effort and its labour cost.
 *
 * The rate comes from (in order): an explicit rate on the call → the member's
 * project role standard cost → fail closed. It NEVER comes from payroll.
 */
export function recordEffort(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  // Rule Zero: this path must never be pointed at a frozen collection.
  assertNotFrozen(payload.source_collection);
  const project = g.scopedRow(db, 'projects', payload.project_id, companyId, 'project');
  assertCostable(project);
  const hours = g.positive(payload.hours, 'hours');
  const memberRef = g.requireText(payload.member_ref || actor, 'member_ref');

  let roleId = payload.role_id || null;
  if (!roleId) {
    roleId = db.prepare('SELECT role_id FROM project_members WHERE project_id = ? AND member_ref = ?')
      .get(project.id, memberRef)?.role_id || null;
  }
  const role = roleId ? g.scopedRow(db, 'project_roles', roleId, companyId, 'project role') : null;

  let costRate = payload.cost_rate_per_hour;
  if (costRate === undefined || costRate === null) {
    if (!role) {
      throw new ProjectCostError(
        'cost_rate_per_hour is required when the member has no project role with a standard rate '
        + '(project labour cost never reads payroll data)',
        'PROJECT_RATE_REQUIRED',
      );
    }
    costRate = Number(role.standard_cost_per_hour);
  }
  costRate = g.nonNegative(costRate, 'cost_rate_per_hour');
  const billRate = g.nonNegative(
    payload.bill_rate_per_hour ?? role?.standard_bill_per_hour ?? 0,
    'bill_rate_per_hour',
  );
  const amount = round2(hours * costRate);

  let financeDocumentId = null;
  if (amount > 0 && payload.labor_cost_account_id && payload.labor_absorption_account_id) {
    const posted = postSourceFact(db, g.financeContext(payload), {
      fact_type: 'project_cost_posting',
      source_id: `${project.id}:effort:${memberRef}:${payload.effort_date || today()}:${hours}`,
      doc_date: payload.effort_date || today(),
      currency: payload.currency || project.currency || 'IQD',
      lines: [
        { account_id: payload.labor_cost_account_id, debit: amount, credit: 0, description: `project_labor:${project.code}` },
        { account_id: payload.labor_absorption_account_id, debit: 0, credit: amount, description: `project_labor:${project.code}` },
      ],
    });
    financeDocumentId = posted.document_id;
  }

  const costFactId = recordCostFact(db, {
    companyId, projectId: project.id, phaseId: payload.phase_id || null,
    costCodeId: payload.cost_code_id || null, workItemId: payload.work_item_id || null,
    costType: 'labor', amount, quantity: hours,
    currency: payload.currency || project.currency || 'IQD',
    financeDocumentId, sourceReference: memberRef, actor,
    occurredAt: payload.effort_date || nowIso(),
  });

  const id = payload.id || makeId('prjeff');
  db.prepare(`
    INSERT INTO project_effort_entries (
      id, project_id, company_id, work_item_id, phase_id, member_ref, role_id,
      effort_date, hours, cost_rate_per_hour, bill_rate_per_hour, currency,
      is_billable, billed_document_id, cost_fact_id, source, recorded_by, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
  `).run(
    id, project.id, companyId, payload.work_item_id || null, payload.phase_id || null,
    memberRef, roleId, payload.effort_date || today(), hours, costRate, billRate,
    payload.currency || project.currency || 'IQD',
    payload.is_billable === false ? 0 : 1, costFactId,
    payload.source || 'project_entry', actor, nowIso(),
  );

  return {
    id, project_id: project.id, hours, cost_rate_per_hour: costRate,
    bill_rate_per_hour: billRate, amount, cost_fact_id: costFactId,
    finance_document_id: financeDocumentId,
    payroll_touched: false,
  };
}

/**
 * A project expense. If both accounts are supplied the expense is posted
 * through the Phase 03 pipeline; otherwise it is recorded as a cost fact with
 * an explicit `finance_document_id` of null, which the reconciliation report
 * lists as unposted rather than treating as posted.
 */
export function recordExpense(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const project = g.scopedRow(db, 'projects', payload.project_id, companyId, 'project');
  assertCostable(project);
  const amount = g.positive(payload.amount, 'expense amount');

  let financeDocumentId = null;
  if (payload.expense_account_id && payload.credit_account_id) {
    const posted = postSourceFact(db, g.financeContext(payload), {
      fact_type: 'project_cost_posting',
      source_id: `${project.id}:expense:${payload.reference || makeId('exp')}`,
      doc_date: payload.doc_date || today(),
      currency: payload.currency || project.currency || 'IQD',
      partner_id: payload.partner_id || null,
      lines: [
        { account_id: payload.expense_account_id, debit: amount, credit: 0, description: `project_expense:${project.code}` },
        { account_id: payload.credit_account_id, debit: 0, credit: amount, description: `project_expense:${project.code}` },
      ],
    });
    financeDocumentId = posted.document_id;
  }

  const costFactId = recordCostFact(db, {
    companyId, projectId: project.id, phaseId: payload.phase_id || null,
    costCodeId: payload.cost_code_id || null,
    costType: payload.cost_type || 'expense', amount, quantity: Number(payload.quantity || 0),
    currency: payload.currency || project.currency || 'IQD',
    financeDocumentId, sourceReference: payload.reference || null, actor,
    occurredAt: payload.doc_date || nowIso(),
  });
  return { cost_fact_id: costFactId, amount, finance_document_id: financeDocumentId, posted: Boolean(financeDocumentId) };
}

/**
 * Issue stock to a project. The movement is a canonical Phase 04 stock move to
 * a project-consumption location; the project only records the resulting cost.
 */
export function issueMaterialToProject(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const project = g.scopedRow(db, 'projects', payload.project_id, companyId, 'project');
  assertCostable(project);
  const quantity = g.positive(payload.quantity, 'quantity');

  const warehouseId = payload.warehouse_id
    || db.prepare('SELECT id FROM warehouses WHERE company_id = ? AND is_active = 1 ORDER BY created_at LIMIT 1').get(companyId)?.id;
  if (!warehouseId) throw new ProjectCostError('a warehouse is required to issue project material', 'INPUT_MISSING_FIELD');
  const warehouse = g.scopedRow(db, 'warehouses', warehouseId, companyId, 'warehouse');

  const destination = payload.location_dest_id || ensureProjectConsumptionLocation(db, companyId, warehouseId).id;
  const uomId = payload.uom_id
    || db.prepare('SELECT t.uom_id FROM product_templates t JOIN product_variants v ON v.template_id = t.id WHERE v.id = ?').get(payload.product_id)?.uom_id;
  if (!uomId) throw new ProjectCostError('a unit of measure is required to issue material', 'INPUT_MISSING_FIELD');

  const move = executeStockOperation(db, {
    company_id: companyId,
    branch_id: project.branch_id || null,
    actor,
    tenant_id: payload.tenant_id || null,
    reference: `${project.code}/MAT`,
    product_id: payload.product_id,
    uom_id: uomId,
    product_qty: quantity,
    location_id: payload.location_id || warehouse.lot_stock_id,
    location_dest_id: destination,
    source_document_type: 'project',
    source_document_id: project.id,
    source_line_id: payload.cost_code_id || null,
    idempotency_key: payload.stock_idempotency_key || `project-material:${project.id}:${payload.product_id}:${makeId('n')}`,
  });

  const value = Math.abs(Number(move.total_value || 0));
  const costFactId = recordCostFact(db, {
    companyId, projectId: project.id, phaseId: payload.phase_id || null,
    costCodeId: payload.cost_code_id || null, costType: 'material',
    amount: value, quantity, currency: payload.currency || project.currency || 'IQD',
    financeDocumentId: move.accounting?.finance_document_id || null,
    stockMoveId: move.id, sourceReference: move.reference, actor,
  });
  return {
    cost_fact_id: costFactId,
    stock_move_id: move.id,
    quantity,
    value: round2(value),
    finance_document_id: move.accounting?.finance_document_id || null,
  };
}

/**
 * Project consumption location.
 *
 * Deliberately NOT the manufacturing `production` location. Sharing it would
 * route project material into the manufacturing WIP account, which then breaks
 * the manufacturing WIP-to-GL reconciliation with value that never belonged to
 * a manufacturing order. `consumption` is a distinct non-internal usage, so the
 * Phase 04 stock port posts Dr <product category expense account> / Cr Inventory
 * — the correct treatment for material consumed into a project — and the project
 * dimension is carried by `project_cost_facts`.
 */
export function ensureProjectConsumptionLocation(db, companyId, warehouseId) {
  const existing = db.prepare(`
    SELECT * FROM stock_locations
    WHERE company_id = ? AND warehouse_id = ? AND usage = 'consumption'
      AND name = 'Project Consumption'
    ORDER BY created_at LIMIT 1
  `).get(companyId, warehouseId);
  if (existing) return existing;

  const warehouse = g.scopedRow(db, 'warehouses', warehouseId, companyId, 'warehouse');
  const id = makeId('loc_prj');
  db.prepare(`
    INSERT INTO stock_locations (
      id, company_id, warehouse_id, parent_id, name, complete_name, usage, is_scrap, created_at
    ) VALUES (?, ?, ?, ?, 'Project Consumption', ?, 'consumption', 0, ?)
  `).run(id, companyId, warehouseId, warehouse.view_location_id, `${warehouse.code}/ProjectConsumption`, nowIso());
  return db.prepare('SELECT * FROM stock_locations WHERE id = ?').get(id);
}

/**
 * Pull manufacturing cost into the project view. Manufacturing already posted
 * it; this records the project dimension of the same facts so job costing sees
 * production without double-counting the GL.
 */
export function absorbManufacturingCost(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const project = g.scopedRow(db, 'projects', payload.project_id, companyId, 'project');
  const order = g.scopedRow(db, 'production_orders', payload.production_order_id, companyId, 'manufacturing order');
  if (order.project_id !== project.id) {
    throw new ProjectCostError('this manufacturing order does not belong to the project', 'PROJECT_LINK_MISMATCH');
  }
  const already = db.prepare(
    'SELECT COUNT(*) AS n FROM project_cost_facts WHERE project_id = ? AND production_order_id = ?',
  ).get(project.id, order.id).n;
  if (Number(already) > 0 && !payload.allow_repeat) {
    throw new ProjectCostError(
      'this manufacturing order has already been absorbed into the project cost',
      'PROJECT_COST_DUPLICATE', 409,
    );
  }
  const capitalised = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS amount FROM production_cost_facts
    WHERE company_id = ? AND order_id = ? AND cost_type = 'finished_goods'
  `).get(companyId, order.id).amount;
  const amount = round2(capitalised);
  if (!(amount > 0)) {
    throw new ProjectCostError('this manufacturing order has capitalised no value yet', 'MANUFACTURING_WIP_EMPTY');
  }
  const costFactId = recordCostFact(db, {
    companyId, projectId: project.id, costType: 'manufacturing', amount,
    quantity: Number(order.completed_quantity), currency: project.currency || 'IQD',
    productionOrderId: order.id, sourceReference: order.reference, actor,
    financeDocumentId: null,
  });
  return { cost_fact_id: costFactId, production_order_id: order.id, amount, gl_already_posted_by: 'manufacturing' };
}

// --------------------------------------------------------------------------
// Budget control
// --------------------------------------------------------------------------

export function budgetControl(db, companyId, projectId) {
  const budget = approvedBudget(db, companyId, projectId);
  const actual = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS amount FROM project_cost_facts
    WHERE company_id = ? AND project_id = ? AND cost_type != 'revenue'
  `).get(companyId, projectId).amount;
  const commitments = db.prepare(`
    SELECT COALESCE(SUM(amount - released_amount), 0) AS amount FROM project_commitments
    WHERE company_id = ? AND project_id = ? AND status IN ('open', 'partially_released')
  `).get(companyId, projectId).amount;
  return {
    budget_id: budget?.id || null,
    budget_amount: round2(budget?.total_amount || 0),
    actual_cost: round2(actual),
    open_commitments: round2(commitments),
    remaining: round2(Number(budget?.total_amount || 0) - Number(actual) - Number(commitments)),
  };
}

export { round2, round6 };
