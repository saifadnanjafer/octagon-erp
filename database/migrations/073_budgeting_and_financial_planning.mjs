// database/migrations/073_budgeting_and_financial_planning.mjs — Budgeting, Forecasting & Financial Planning Module Migration.

export const migration = {
  id: '073_budgeting_and_financial_planning',
  description: 'Migration 073: Budgeting, Forecasting & Financial Planning (Fiscal Budgets, Cost Centers, Financial Forecasts, Reallocations, Commitments)',

  async up(db) {
    // 1. Cost Centers
    db.prepare(`
      CREATE TABLE IF NOT EXISTS cost_centers (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        parent_cost_center_id TEXT REFERENCES cost_centers(id),
        manager_id TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_cost_centers_company
      ON cost_centers(company_id, code)
    `).run();

    // 2. Fiscal Budgets
    db.prepare(`
      CREATE TABLE IF NOT EXISTS fiscal_budgets (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        budget_number TEXT NOT NULL,
        fiscal_year INTEGER NOT NULL DEFAULT 2026,
        title TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        total_budgeted_amount REAL NOT NULL DEFAULT 0.0,
        total_committed_amount REAL NOT NULL DEFAULT 0.0,
        total_actual_amount REAL NOT NULL DEFAULT 0.0,
        status TEXT NOT NULL DEFAULT 'draft', -- draft, submitted, approved, active, closed
        approved_by TEXT,
        approved_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_fiscal_budgets_company_year
      ON fiscal_budgets(company_id, fiscal_year, status)
    `).run();

    // 3. Budget Lines
    db.prepare(`
      CREATE TABLE IF NOT EXISTS budget_lines (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        budget_id TEXT NOT NULL REFERENCES fiscal_budgets(id) ON DELETE CASCADE,
        cost_center_id TEXT REFERENCES cost_centers(id),
        gl_account_code TEXT NOT NULL,
        period_month INTEGER NOT NULL, -- 1 to 12
        budgeted_amount REAL NOT NULL DEFAULT 0.0,
        committed_amount REAL NOT NULL DEFAULT 0.0,
        actual_amount REAL NOT NULL DEFAULT 0.0,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 4. Financial Forecasts
    db.prepare(`
      CREATE TABLE IF NOT EXISTS financial_forecasts (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        forecast_number TEXT NOT NULL,
        title TEXT NOT NULL,
        scenario TEXT NOT NULL DEFAULT 'baseline', -- baseline, optimistic, conservative
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        projected_revenue REAL NOT NULL DEFAULT 0.0,
        projected_expense REAL NOT NULL DEFAULT 0.0,
        projected_net_income REAL NOT NULL DEFAULT 0.0,
        status TEXT NOT NULL DEFAULT 'draft', -- draft, published, archived
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 5. Financial Forecast Lines
    db.prepare(`
      CREATE TABLE IF NOT EXISTS financial_forecast_lines (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        forecast_id TEXT NOT NULL REFERENCES financial_forecasts(id) ON DELETE CASCADE,
        category TEXT NOT NULL, -- revenue, opex, capex
        gl_account_code TEXT,
        projected_amount REAL NOT NULL DEFAULT 0.0,
        assumptions TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 6. Budget Reallocations
    db.prepare(`
      CREATE TABLE IF NOT EXISTS budget_reallocations (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        reallocation_number TEXT NOT NULL,
        from_budget_line_id TEXT NOT NULL REFERENCES budget_lines(id),
        to_budget_line_id TEXT NOT NULL REFERENCES budget_lines(id),
        amount REAL NOT NULL DEFAULT 0.0,
        reason TEXT,
        status TEXT NOT NULL DEFAULT 'requested', -- requested, approved, rejected
        requested_by TEXT NOT NULL,
        approved_by TEXT,
        approved_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 7. Budget Commitments (Encumbrances)
    db.prepare(`
      CREATE TABLE IF NOT EXISTS budget_commitments (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        budget_line_id TEXT NOT NULL REFERENCES budget_lines(id) ON DELETE CASCADE,
        source_document_type TEXT NOT NULL, -- purchase_order, contract, requisition
        source_document_id TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0.0,
        status TEXT NOT NULL DEFAULT 'committed', -- committed, released, liquidated
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 8. Financial Scenarios
    db.prepare(`
      CREATE TABLE IF NOT EXISTS financial_scenarios (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        name TEXT NOT NULL,
        revenue_growth_rate_pct REAL NOT NULL DEFAULT 5.0,
        inflation_rate_pct REAL NOT NULL DEFAULT 3.0,
        fx_rate_usd_iqd REAL NOT NULL DEFAULT 1310.0,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();
  },

  async down(db) {
    const tables = [
      'financial_scenarios',
      'budget_commitments',
      'budget_reallocations',
      'financial_forecast_lines',
      'financial_forecasts',
      'budget_lines',
      'fiscal_budgets',
      'cost_centers'
    ];
    for (const table of tables) {
      db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
    }
  }
};
