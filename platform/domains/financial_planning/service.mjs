// platform/domains/financial_planning/service.mjs — Budgeting & Financial Planning Domain Services.

export function generateBudgetNumber(db, companyId) {
  const year = new Date().getFullYear();
  const prefix = `BDG-${year}-`;
  const countRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM fiscal_budgets WHERE company_id = ? AND budget_number LIKE ?
  `).get(companyId, `${prefix}%`);
  const seq = (countRow ? countRow.cnt : 0) + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function generateForecastNumber(db, companyId) {
  const year = new Date().getFullYear();
  const prefix = `FCST-${year}-`;
  const countRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM financial_forecasts WHERE company_id = ? AND forecast_number LIKE ?
  `).get(companyId, `${prefix}%`);
  const seq = (countRow ? countRow.cnt : 0) + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function generateReallocationNumber(db, companyId) {
  const year = new Date().getFullYear();
  const prefix = `REAL-${year}-`;
  const countRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM budget_reallocations WHERE company_id = ? AND reallocation_number LIKE ?
  `).get(companyId, `${prefix}%`);
  const seq = (countRow ? countRow.cnt : 0) + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function createCostCenter(db, { company_id, code, name, parent_cost_center_id = null, manager_id = null }) {
  const id = `cc-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO cost_centers (id, company_id, code, name, parent_cost_center_id, manager_id, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, company_id, code, name, parent_cost_center_id, manager_id, now, now);

  return db.prepare('SELECT * FROM cost_centers WHERE id = ?').get(id);
}

export function createFiscalBudget(db, { company_id, fiscal_year = 2026, title, currency = 'USD' }) {
  const id = `bdg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const bdgNum = generateBudgetNumber(db, company_id);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO fiscal_budgets (id, company_id, budget_number, fiscal_year, title, currency, total_budgeted_amount, total_committed_amount, total_actual_amount, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 0.0, 0.0, 0.0, 'draft', ?, ?)
  `).run(id, company_id, bdgNum, fiscal_year, title, currency, now, now);

  return db.prepare('SELECT * FROM fiscal_budgets WHERE id = ?').get(id);
}

export function addBudgetLine(db, { company_id, budget_id, cost_center_id = null, gl_account_code, period_month, budgeted_amount, notes = null }) {
  const bdg = db.prepare('SELECT * FROM fiscal_budgets WHERE id = ? AND company_id = ?').get(budget_id, company_id);
  if (!bdg) throw new Error(`Budget ${budget_id} not found`);
  if (bdg.status !== 'draft') throw new Error(`Cannot modify lines on budget in status: ${bdg.status}`);

  const id = `bdgline-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO budget_lines (id, company_id, budget_id, cost_center_id, gl_account_code, period_month, budgeted_amount, committed_amount, actual_amount, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0.0, 0.0, ?, ?, ?)
  `).run(id, company_id, budget_id, cost_center_id, gl_account_code, period_month, budgeted_amount, notes, now, now);

  // Recalculate total budgeted amount
  const totalRow = db.prepare('SELECT SUM(budgeted_amount) as total FROM budget_lines WHERE budget_id = ?').get(budget_id);
  db.prepare('UPDATE fiscal_budgets SET total_budgeted_amount = ?, updated_at = ? WHERE id = ?').run(totalRow ? totalRow.total : 0.0, now, budget_id);

  return db.prepare('SELECT * FROM budget_lines WHERE id = ?').get(id);
}

export function approveFiscalBudget(db, { id, company_id, approved_by }) {
  const bdg = db.prepare('SELECT * FROM fiscal_budgets WHERE id = ? AND company_id = ?').get(id, company_id);
  if (!bdg) throw new Error(`Budget ${id} not found`);

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE fiscal_budgets SET status = 'active', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?
  `).run(approved_by, now, now, id);

  return db.prepare('SELECT * FROM fiscal_budgets WHERE id = ?').get(id);
}

export function commitBudgetAmount(db, { company_id, budget_line_id, source_document_type, source_document_id, amount }) {
  const line = db.prepare('SELECT * FROM budget_lines WHERE id = ? AND company_id = ?').get(budget_line_id, company_id);
  if (!line) throw new Error(`Budget line ${budget_line_id} not found`);

  const available = line.budgeted_amount - (line.committed_amount + line.actual_amount);
  if (available < amount) {
    throw new Error(`Insufficient budget available on line ${budget_line_id}. Available: ${available}, Requested: ${amount}`);
  }

  const id = `commit-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO budget_commitments (id, company_id, budget_line_id, source_document_type, source_document_id, amount, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'committed', ?)
  `).run(id, company_id, budget_line_id, source_document_type, source_document_id, amount, now);

  db.prepare(`
    UPDATE budget_lines SET committed_amount = committed_amount + ?, updated_at = ? WHERE id = ?
  `).run(amount, now, budget_line_id);

  db.prepare(`
    UPDATE fiscal_budgets SET total_committed_amount = total_committed_amount + ?, updated_at = ? WHERE id = ?
  `).run(amount, now, line.budget_id);

  return db.prepare('SELECT * FROM budget_commitments WHERE id = ?').get(id);
}

export function reallocateBudget(db, { company_id, from_budget_line_id, to_budget_line_id, amount, reason = null, requested_by = 'system-user' }) {
  const fromLine = db.prepare('SELECT * FROM budget_lines WHERE id = ? AND company_id = ?').get(from_budget_line_id, company_id);
  const toLine = db.prepare('SELECT * FROM budget_lines WHERE id = ? AND company_id = ?').get(to_budget_line_id, company_id);

  if (!fromLine || !toLine) throw new Error('Source or destination budget line not found');

  const available = fromLine.budgeted_amount - (fromLine.committed_amount + fromLine.actual_amount);
  if (available < amount) {
    throw new Error(`Cannot reallocate. Source line available budget: ${available}, requested transfer: ${amount}`);
  }

  const id = `real-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const realNum = generateReallocationNumber(db, company_id);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO budget_reallocations (id, company_id, reallocation_number, from_budget_line_id, to_budget_line_id, amount, reason, status, requested_by, approved_by, approved_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, company_id, realNum, from_budget_line_id, to_budget_line_id, amount, reason, 'approved', requested_by, 'cfo-admin', now, now, now);

  db.prepare(`UPDATE budget_lines SET budgeted_amount = budgeted_amount - ?, updated_at = ? WHERE id = ?`).run(amount, now, from_budget_line_id);
  db.prepare(`UPDATE budget_lines SET budgeted_amount = budgeted_amount + ?, updated_at = ? WHERE id = ?`).run(amount, now, to_budget_line_id);

  return db.prepare('SELECT * FROM budget_reallocations WHERE id = ?').get(id);
}

export function createFinancialForecast(db, { company_id, title, scenario = 'baseline', period_start, period_end }) {
  const id = `fcst-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const fcstNum = generateForecastNumber(db, company_id);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO financial_forecasts (id, company_id, forecast_number, title, scenario, period_start, period_end, projected_revenue, projected_expense, projected_net_income, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0.0, 0.0, 0.0, 'draft', ?, ?)
  `).run(id, company_id, fcstNum, title, scenario, period_start, period_end, now, now);

  return db.prepare('SELECT * FROM financial_forecasts WHERE id = ?').get(id);
}
