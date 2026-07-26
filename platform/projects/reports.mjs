// Project reporting and profitability.
//
// Profitability is a derived query, never a stored duplicate. The one stored
// artefact is `project_profitability_snapshots`, and it is explicitly a
// point-in-time record with its own timestamp — a snapshot is evidence of what
// the numbers were, not a second source of what they are.

import {
  createDomainError, domainGuards, makeId, nowIso, round2,
} from '../kernel/domain/kit.mjs';

export const ProjectReportError = createDomainError('ProjectReportError', 'PROJECT_REPORT_ERROR');
const g = domainGuards(ProjectReportError);

function costTotals(db, companyId, projectId) {
  const rows = db.prepare(`
    SELECT cost_type, COALESCE(SUM(amount), 0) AS amount, COALESCE(SUM(quantity), 0) AS quantity
    FROM project_cost_facts WHERE company_id = ? AND project_id = ?
    GROUP BY cost_type
  `).all(companyId, projectId);
  const byType = {};
  let cost = 0;
  let revenue = 0;
  for (const row of rows) {
    byType[row.cost_type] = round2(row.amount);
    if (row.cost_type === 'revenue') revenue = round2(revenue + Number(row.amount));
    else cost = round2(cost + Number(row.amount));
  }
  return { byType, actual_cost: cost, recognised_revenue: revenue };
}

export function budgetVersusActual(db, { company_id, project_id }) {
  const project = g.scopedRow(db, 'projects', project_id, company_id, 'project');
  const budget = db.prepare(
    "SELECT * FROM project_budgets WHERE project_id = ? AND status = 'approved' ORDER BY revision DESC LIMIT 1",
  ).get(project.id);
  const budgetLines = budget
    ? db.prepare('SELECT cost_type, COALESCE(SUM(amount), 0) AS amount FROM project_budget_lines WHERE budget_id = ? GROUP BY cost_type').all(budget.id)
    : [];
  const budgetByType = Object.fromEntries(budgetLines.map((row) => [row.cost_type, round2(row.amount)]));
  const totals = costTotals(db, company_id, project.id);

  const types = [...new Set([...Object.keys(budgetByType), ...Object.keys(totals.byType)])]
    .filter((type) => type !== 'revenue');
  return {
    project_id: project.id,
    project_code: project.code,
    budget_revision: budget?.revision || null,
    budget_total: round2(budget?.total_amount || 0),
    actual_total: totals.actual_cost,
    variance_total: round2(Number(budget?.total_amount || 0) - totals.actual_cost),
    lines: types.map((type) => ({
      cost_type: type,
      budget: budgetByType[type] || 0,
      actual: totals.byType[type] || 0,
      variance: round2((budgetByType[type] || 0) - (totals.byType[type] || 0)),
    })),
  };
}

export function commitmentReport(db, { company_id, project_id = null }) {
  let sql = `
    SELECT c.*, p.code AS project_code
    FROM project_commitments c JOIN projects p ON p.id = c.project_id
    WHERE c.company_id = ?
  `;
  const params = [company_id];
  if (project_id) { sql += ' AND c.project_id = ?'; params.push(project_id); }
  sql += ' ORDER BY c.created_at DESC';
  return db.prepare(sql).all(...params).map((row) => ({
    ...row,
    outstanding_amount: round2(Number(row.amount) - Number(row.released_amount)),
  }));
}

export function billedVersusUnbilled(db, { company_id, project_id }) {
  const project = g.scopedRow(db, 'projects', project_id, company_id, 'project');
  const billed = round2(db.prepare(
    "SELECT COALESCE(SUM(amount), 0) AS amount FROM project_billings WHERE project_id = ? AND status = 'posted'",
  ).get(project.id).amount);
  const retainage = round2(db.prepare(
    "SELECT COALESCE(SUM(retainage_amount), 0) AS amount FROM project_billings WHERE project_id = ? AND status = 'posted'",
  ).get(project.id).amount);
  const unbilledEffort = db.prepare(`
    SELECT COALESCE(SUM(hours * bill_rate_per_hour), 0) AS amount, COALESCE(SUM(hours), 0) AS hours
    FROM project_effort_entries
    WHERE project_id = ? AND company_id = ? AND is_billable = 1 AND billed_document_id IS NULL
  `).get(project.id, company_id);
  return {
    project_id: project.id,
    contract_value: round2(project.contract_value),
    billed_amount: billed,
    retainage_withheld: retainage,
    remaining_contract: round2(Number(project.contract_value) - billed),
    unbilled_effort_hours: round2(unbilledEffort.hours),
    unbilled_effort_amount: round2(unbilledEffort.amount),
  };
}

export function costBreakdown(db, { company_id, project_id }) {
  const totals = costTotals(db, company_id, project_id);
  const byPhase = db.prepare(`
    SELECT COALESCE(f.phase_id, 'unassigned') AS phase_id, ph.name AS phase_name,
           COALESCE(SUM(f.amount), 0) AS amount
    FROM project_cost_facts f
    LEFT JOIN project_phases ph ON ph.id = f.phase_id
    WHERE f.company_id = ? AND f.project_id = ? AND f.cost_type != 'revenue'
    GROUP BY f.phase_id ORDER BY amount DESC
  `).all(company_id, project_id);
  const byCostCode = db.prepare(`
    SELECT COALESCE(f.cost_code_id, 'unassigned') AS cost_code_id, cc.code, cc.name,
           COALESCE(SUM(f.amount), 0) AS amount
    FROM project_cost_facts f
    LEFT JOIN project_cost_codes cc ON cc.id = f.cost_code_id
    WHERE f.company_id = ? AND f.project_id = ? AND f.cost_type != 'revenue'
    GROUP BY f.cost_code_id ORDER BY amount DESC
  `).all(company_id, project_id);
  return {
    by_type: totals.byType,
    actual_cost: totals.actual_cost,
    by_phase: byPhase.map((row) => ({ ...row, amount: round2(row.amount) })),
    by_cost_code: byCostCode.map((row) => ({ ...row, amount: round2(row.amount) })),
  };
}

/**
 * Profitability and forecast at completion.
 *
 * FAC uses the classic earned-value form: budget ÷ cost-performance-index,
 * where CPI = earned value ÷ actual cost. When percent complete is zero (no
 * earned value yet) CPI is undefined, so FAC falls back to the budget rather
 * than reporting a fabricated number.
 */
export function profitability(db, { company_id, project_id }) {
  const project = g.scopedRow(db, 'projects', project_id, company_id, 'project');
  const totals = costTotals(db, company_id, project.id);
  const control = db.prepare(`
    SELECT COALESCE(SUM(amount - released_amount), 0) AS amount FROM project_commitments
    WHERE company_id = ? AND project_id = ? AND status IN ('open', 'partially_released')
  `).get(company_id, project.id).amount;
  const budget = db.prepare(
    "SELECT total_amount FROM project_budgets WHERE project_id = ? AND status = 'approved' ORDER BY revision DESC LIMIT 1",
  ).get(project.id);
  const billed = round2(db.prepare(
    "SELECT COALESCE(SUM(amount), 0) AS amount FROM project_billings WHERE project_id = ? AND status = 'posted'",
  ).get(project.id).amount);

  const budgetAmount = round2(budget?.total_amount || 0);
  const percentComplete = Number(project.percent_complete || 0);
  const earnedValue = round2(budgetAmount * (percentComplete / 100));
  const cpi = totals.actual_cost > 0 && earnedValue > 0
    ? earnedValue / totals.actual_cost
    : null;
  const forecastAtCompletion = cpi ? round2(budgetAmount / cpi) : budgetAmount;

  const margin = round2(Number(project.contract_value) - totals.actual_cost);
  return {
    project_id: project.id,
    project_code: project.code,
    state: project.state,
    currency: project.currency,
    contract_value: round2(project.contract_value),
    budget_amount: budgetAmount,
    actual_cost: totals.actual_cost,
    cost_by_type: totals.byType,
    open_commitments: round2(control),
    billed_amount: billed,
    unbilled_amount: round2(Number(project.contract_value) - billed),
    recognised_revenue: totals.recognised_revenue,
    percent_complete: percentComplete,
    earned_value: earnedValue,
    cost_performance_index: cpi === null ? null : round2(cpi),
    forecast_at_completion: forecastAtCompletion,
    forecast_variance: round2(budgetAmount - forecastAtCompletion),
    margin_amount: margin,
    margin_percent: Number(project.contract_value) > 0
      ? round2((margin / Number(project.contract_value)) * 100)
      : null,
  };
}

export function snapshotProfitability(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const report = profitability(db, { company_id: companyId, project_id: payload.project_id });
  const id = makeId('prjsnap');
  db.prepare(`
    INSERT INTO project_profitability_snapshots (
      id, project_id, company_id, snapshot_at, budget_amount, committed_amount,
      actual_cost, billed_amount, unbilled_amount, contract_value, percent_complete,
      forecast_at_completion, margin_amount, margin_percent, currency, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, payload.project_id, companyId, nowIso(), report.budget_amount,
    report.open_commitments, report.actual_cost, report.billed_amount,
    report.unbilled_amount, report.contract_value, report.percent_complete,
    report.forecast_at_completion, report.margin_amount, report.margin_percent,
    report.currency, actor,
  );
  return { snapshot_id: id, ...report };
}

export function milestoneStatus(db, { company_id, project_id = null }) {
  let sql = `
    SELECT m.*, p.code AS project_code FROM project_milestones m
    JOIN projects p ON p.id = m.project_id WHERE m.company_id = ?
  `;
  const params = [company_id];
  if (project_id) { sql += ' AND m.project_id = ?'; params.push(project_id); }
  sql += ' ORDER BY m.due_date IS NULL, m.due_date, m.sequence';
  const now = nowIso();
  return db.prepare(sql).all(...params).map((row) => ({
    ...row,
    overdue: row.status === 'pending' && row.due_date ? row.due_date < now : false,
  }));
}

export function overdueWorkItems(db, { company_id, project_id = null }) {
  let sql = `
    SELECT id, title, status, priority, due_date, assigned_user_id, project_ref
    FROM work_items
    WHERE company_id = ? AND project_ref IS NOT NULL
      AND due_date IS NOT NULL AND due_date < ?
      AND status NOT IN ('done', 'cancelled', 'archived')
  `;
  const params = [company_id, nowIso()];
  if (project_id) { sql += ' AND project_ref = ?'; params.push(project_id); }
  sql += ' ORDER BY due_date';
  return db.prepare(sql).all(...params);
}

/**
 * Project cash flow: money billed versus money actually received, taken from
 * the canonical payment allocations rather than from a project-side estimate.
 */
export function projectCashFlow(db, { company_id, project_id }) {
  const project = g.scopedRow(db, 'projects', project_id, company_id, 'project');
  const billings = db.prepare(
    "SELECT finance_document_id, amount, retainage_amount, billed_at FROM project_billings WHERE project_id = ? AND status = 'posted'",
  ).all(project.id);
  const documentIds = billings.map((row) => row.finance_document_id).filter(Boolean);

  let received = 0;
  if (documentIds.length) {
    const hasAllocations = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'finance_payment_allocations'",
    ).get();
    if (hasAllocations) {
      const placeholders = documentIds.map(() => '?').join(',');
      received = round2(db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS amount FROM finance_payment_allocations
        WHERE document_id IN (${placeholders})
      `).get(...documentIds).amount);
    }
  }

  const billed = round2(billings.reduce((sum, row) => sum + Number(row.amount), 0));
  const withheld = round2(billings.reduce((sum, row) => sum + Number(row.retainage_amount), 0));
  const spent = round2(db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS amount FROM project_cost_facts
    WHERE company_id = ? AND project_id = ? AND cost_type != 'revenue'
  `).get(company_id, project.id).amount);

  return {
    project_id: project.id,
    billed_amount: billed,
    retainage_withheld: withheld,
    cash_received: received,
    outstanding_receivable: round2(billed - withheld - received),
    cost_incurred: spent,
    net_cash_position: round2(received - spent),
    billing_events: billings.length,
  };
}

export function portfolioSummary(db, { company_id }) {
  return db.prepare(`
    SELECT p.id, p.code, p.name, p.state, p.contract_value, p.percent_complete,
      COALESCE((SELECT SUM(f.amount) FROM project_cost_facts f
                WHERE f.project_id = p.id AND f.cost_type != 'revenue'), 0) AS actual_cost,
      COALESCE((SELECT SUM(b.amount) FROM project_billings b
                WHERE b.project_id = p.id AND b.status = 'posted'), 0) AS billed_amount
    FROM projects p WHERE p.company_id = ?
    ORDER BY p.created_at DESC
  `).all(company_id).map((row) => ({
    ...row,
    actual_cost: round2(row.actual_cost),
    billed_amount: round2(row.billed_amount),
    margin_amount: round2(Number(row.contract_value) - Number(row.actual_cost)),
  }));
}
