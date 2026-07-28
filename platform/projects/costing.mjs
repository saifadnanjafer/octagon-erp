// Project costing and profitability — Checkpoint D1.
//
// Everything in this file is DERIVED at query time from canonical source
// facts. No total computed here is written back as an independent authority:
//
//   material cost      <- stock_moves (via project_cost_links)
//   procurement cost   <- purchase order lines (via project_cost_links)
//   subcontract cost   <- project_commitments of source_type 'subcontract'
//   labor cost         <- project_effort_entries (entry_type 'labor')
//   machine cost       <- project_effort_entries (entry_type 'machine')
//   overhead           <- project_cost_links of source_authority 'finance_document'
//   revenue            <- project_billing_requests in state invoiced/approved
//
// If a source fact is reversed, the derived figure changes on the next read.
// That is the point: there is nothing to keep in sync.

'use strict';

import { fail } from './errors.mjs';
import { getProject } from './projects.mjs';
import { effectiveBudget } from './budget.mjs';

function round(value) {
  return Number(Number(value || 0).toFixed(4));
}

/**
 * Material and procurement cost attributed to a project through the
 * link-only attribution table. Amounts are read from the SOURCE fact.
 */
function linkedStockCost(db, companyId, projectId) {
  return db.prepare(`
    SELECT COALESCE(SUM(ABS(m.total_value)), 0) AS total
    FROM project_cost_links l
    JOIN stock_moves m ON m.id = l.source_id
    WHERE l.company_id = ? AND l.project_id = ?
      AND l.source_authority = 'stock_move'
      AND m.state = 'done'
  `).get(companyId, projectId).total;
}

function linkedFinanceCost(db, companyId, projectId) {
  // Overheads and other finance-sourced project costs. Guarded so the
  // derivation still works on installs where the finance document table has
  // not yet been provisioned.
  const hasTable = db.prepare(
    "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='finance_document_lines'",
  ).get().c;
  if (!hasTable) return 0;
  // finance_documents carries no total column; the authoritative amount is
  // the sum of its posted debit lines.
  return db.prepare(`
    SELECT COALESCE(SUM(fl.debit), 0) AS total
    FROM project_cost_links l
    JOIN finance_documents d ON d.id = l.source_id
    JOIN finance_document_lines fl ON fl.document_id = d.id
    WHERE l.company_id = ? AND l.project_id = ?
      AND l.source_authority = 'finance_document'
      AND d.state = 'posted'
  `).get(companyId, projectId).total;
}

function effortCost(db, companyId, projectId, entryType) {
  return db.prepare(`
    SELECT COALESCE(SUM(total_cost), 0) AS total, COALESCE(SUM(hours), 0) AS hours
    FROM project_effort_entries
    WHERE company_id = ? AND project_id = ? AND entry_type = ?
  `).get(companyId, projectId, entryType);
}

export function projectCostBreakdown(db, ctx = {}, projectId) {
  const companyId = ctx.companyId;
  const project = getProject(db, projectId, companyId);

  const labor = effortCost(db, companyId, project.id, 'labor');
  const machine = effortCost(db, companyId, project.id, 'machine');
  const material = linkedStockCost(db, companyId, project.id);
  const overhead = linkedFinanceCost(db, companyId, project.id);

  const subcontract = db.prepare(`
    SELECT COALESCE(SUM(released_amount), 0) AS total
    FROM project_commitments
    WHERE company_id = ? AND project_id = ? AND source_type = 'subcontract'
  `).get(companyId, project.id).total;

  const procurement = db.prepare(`
    SELECT COALESCE(SUM(released_amount), 0) AS total
    FROM project_commitments
    WHERE company_id = ? AND project_id = ? AND source_type = 'purchase_order'
  `).get(companyId, project.id).total;

  const actual = round(
    Number(material) + Number(procurement) + Number(subcontract)
    + Number(labor.total) + Number(machine.total) + Number(overhead),
  );

  return {
    project_id: project.id,
    project_number: project.project_number,
    material_cost: round(material),
    procurement_cost: round(procurement),
    subcontract_cost: round(subcontract),
    labor_cost: round(labor.total),
    labor_hours: round(labor.hours),
    machine_cost: round(machine.total),
    machine_hours: round(machine.hours),
    overhead_cost: round(overhead),
    actual_cost: actual,
    derived: true,
    derivation_note: 'computed from canonical source facts at read time; not stored',
  };
}

export function projectBudgetVsActual(db, ctx = {}, projectId) {
  const companyId = ctx.companyId;
  const project = getProject(db, projectId, companyId);

  const rows = db.prepare(`
    SELECT c.id AS cost_code_id, c.code, c.name, c.cost_type,
           b.approved_amount, b.revised_amount, b.state, b.revision_no
    FROM project_cost_codes c
    LEFT JOIN project_budget_lines b ON b.cost_code_id = c.id
    WHERE c.project_id = ?
    ORDER BY c.code
  `).all(project.id);

  const commitmentByCode = new Map(
    db.prepare(`
      SELECT cost_code_id,
             COALESCE(SUM(amount - released_amount), 0) AS open_committed,
             COALESCE(SUM(released_amount), 0) AS released
      FROM project_commitments
      WHERE project_id = ? AND state IN ('open','partially_released','released')
      GROUP BY cost_code_id
    `).all(project.id).map((row) => [row.cost_code_id, row]),
  );

  const effortByCode = new Map(
    db.prepare(`
      SELECT cost_code_id, COALESCE(SUM(total_cost), 0) AS actual
      FROM project_effort_entries
      WHERE project_id = ? AND cost_code_id IS NOT NULL
      GROUP BY cost_code_id
    `).all(project.id).map((row) => [row.cost_code_id, row.actual]),
  );

  const materialByCode = new Map(
    db.prepare(`
      SELECT l.cost_code_id, COALESCE(SUM(ABS(m.total_value)), 0) AS actual
      FROM project_cost_links l
      JOIN stock_moves m ON m.id = l.source_id
      WHERE l.project_id = ? AND l.source_authority = 'stock_move'
        AND m.state = 'done' AND l.cost_code_id IS NOT NULL
      GROUP BY l.cost_code_id
    `).all(project.id).map((row) => [row.cost_code_id, row.actual]),
  );

  const lines = rows.map((row) => {
    const budget = effectiveBudget(row.state ? row : null);
    const commitment = commitmentByCode.get(row.cost_code_id) || { open_committed: 0, released: 0 };
    const actual = round(
      Number(effortByCode.get(row.cost_code_id) || 0)
      + Number(materialByCode.get(row.cost_code_id) || 0)
      + Number(commitment.released || 0),
    );
    return {
      cost_code_id: row.cost_code_id,
      code: row.code,
      name: row.name,
      cost_type: row.cost_type,
      budget_state: row.state || 'unbudgeted',
      revision_no: row.revision_no || 0,
      approved_amount: round(row.approved_amount || 0),
      revised_amount: round(row.revised_amount || 0),
      effective_budget: round(budget),
      open_committed: round(commitment.open_committed),
      actual_cost: actual,
      variance: round(budget - actual - Number(commitment.open_committed)),
      over_budget: actual + Number(commitment.open_committed) > budget,
    };
  });

  return {
    project_id: project.id,
    project_number: project.project_number,
    lines,
    totals: {
      effective_budget: round(lines.reduce((s, l) => s + l.effective_budget, 0)),
      open_committed: round(lines.reduce((s, l) => s + l.open_committed, 0)),
      actual_cost: round(lines.reduce((s, l) => s + l.actual_cost, 0)),
      variance: round(lines.reduce((s, l) => s + l.variance, 0)),
    },
  };
}

export function projectProfitability(db, ctx = {}, projectId) {
  const companyId = ctx.companyId;
  const project = getProject(db, projectId, companyId);
  const cost = projectCostBreakdown(db, ctx, project.id);

  const billing = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN state = 'invoiced' THEN net_amount ELSE 0 END), 0) AS invoiced,
      COALESCE(SUM(CASE WHEN state = 'approved' THEN net_amount ELSE 0 END), 0) AS approved,
      COALESCE(SUM(CASE WHEN state IN ('approved','invoiced') THEN retention_amount ELSE 0 END), 0) AS retained
    FROM project_billing_requests
    WHERE company_id = ? AND project_id = ?
  `).get(companyId, project.id);

  const recognisedRevenue = round(Number(billing.invoiced) + Number(billing.approved));
  const margin = round(recognisedRevenue - cost.actual_cost);

  return {
    project_id: project.id,
    project_number: project.project_number,
    project_name: project.name,
    status: project.status,
    billing_method: project.billing_method,
    contract_value: round(project.contract_value),
    invoiced_revenue: round(billing.invoiced),
    approved_not_invoiced: round(billing.approved),
    retention_held: round(billing.retained),
    recognised_revenue: recognisedRevenue,
    ...cost,
    margin,
    margin_percent: recognisedRevenue > 0 ? round((margin / recognisedRevenue) * 100) : 0,
    cost_to_contract_percent: Number(project.contract_value) > 0
      ? round((cost.actual_cost / Number(project.contract_value)) * 100)
      : 0,
  };
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export function projectReport(db, ctx = {}, report = 'profitability', query = {}) {
  const companyId = ctx.companyId;
  const projects = db.prepare(
    'SELECT id FROM projects WHERE company_id = ? AND status != ? ORDER BY created_at DESC LIMIT 200',
  ).all(companyId, 'archived');

  switch (report) {
    case 'profitability':
      return projects.map((row) => projectProfitability(db, ctx, row.id));

    case 'budget_vs_actual':
      return projects.map((row) => {
        const detail = projectBudgetVsActual(db, ctx, row.id);
        return { project_id: detail.project_id, project_number: detail.project_number, ...detail.totals };
      });

    case 'commitments':
      return db.prepare(`
        SELECT cm.*, p.project_number, p.name AS project_name, cc.code AS cost_code, cc.name AS cost_code_name
        FROM project_commitments cm
        JOIN projects p ON p.id = cm.project_id
        JOIN project_cost_codes cc ON cc.id = cm.cost_code_id
        WHERE cm.company_id = ? ORDER BY cm.created_at DESC LIMIT 300
      `).all(companyId);

    case 'cost_by_code':
      return projects.flatMap((row) => projectBudgetVsActual(db, ctx, row.id).lines);

    case 'milestones':
      return db.prepare(`
        SELECT m.*, p.project_number, p.name AS project_name
        FROM project_milestones m
        JOIN projects p ON p.id = m.project_id
        WHERE m.company_id = ? ORDER BY m.due_date IS NULL, m.due_date LIMIT 300
      `).all(companyId);

    case 'risks':
      return db.prepare(`
        SELECT r.*, p.project_number, p.name AS project_name
        FROM project_risks r
        JOIN projects p ON p.id = r.project_id
        WHERE r.company_id = ? AND r.state = 'open'
        ORDER BY r.severity DESC LIMIT 300
      `).all(companyId);

    case 'overdue_work': {
      const today = new Date().toISOString().slice(0, 10);
      return db.prepare(`
        SELECT w.id, w.title, w.status, w.due_date, w.assigned_user_id,
               p.project_number, p.name AS project_name
        FROM work_items w
        JOIN projects p ON p.id = w.project_ref
        WHERE w.company_id = ? AND w.due_date IS NOT NULL AND w.due_date < ?
          AND w.status NOT IN ('done','cancelled')
        ORDER BY w.due_date LIMIT 300
      `).all(companyId, today);
    }

    case 'revenue':
      return db.prepare(`
        SELECT b.*, p.project_number, p.name AS project_name
        FROM project_billing_requests b
        JOIN projects p ON p.id = b.project_id
        WHERE b.company_id = ? ORDER BY b.created_at DESC LIMIT 300
      `).all(companyId);

    default:
      fail(`unknown project report: ${report}`, 'PROJECT_REPORT_UNKNOWN', 400);
      return [];
  }
}
