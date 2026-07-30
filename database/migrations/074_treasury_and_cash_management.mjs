// database/migrations/074_treasury_and_cash_management.mjs — Treasury, Banking & Cash Management Module Migration.

export const migration = {
  id: '074_treasury_and_cash_management',
  description: 'Migration 074: Treasury, Banking, Cash Management & Reconciliation (Bank Accounts, Statements, Reconciliations, Cash Transfers)',

  async up(db) {
    // 1. Bank Accounts
    db.prepare(`
      CREATE TABLE IF NOT EXISTS bank_accounts (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        account_number TEXT NOT NULL,
        iban TEXT,
        swift_code TEXT,
        bank_name TEXT NOT NULL,
        branch_name TEXT,
        currency TEXT NOT NULL DEFAULT 'USD',
        gl_account_code TEXT NOT NULL,
        current_balance REAL NOT NULL DEFAULT 0.0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_bank_accounts_company
      ON bank_accounts(company_id, account_number)
    `).run();

    // 2. Bank Statements
    db.prepare(`
      CREATE TABLE IF NOT EXISTS bank_statements (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        bank_account_id TEXT NOT NULL REFERENCES bank_accounts(id),
        statement_number TEXT NOT NULL,
        statement_date TEXT NOT NULL,
        starting_balance REAL NOT NULL DEFAULT 0.0,
        ending_balance REAL NOT NULL DEFAULT 0.0,
        status TEXT NOT NULL DEFAULT 'imported', -- imported, in_progress, reconciled
        reconciled_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_bank_statements_company_status
      ON bank_statements(company_id, status)
    `).run();

    // 3. Bank Statement Lines
    db.prepare(`
      CREATE TABLE IF NOT EXISTS bank_statement_lines (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        bank_statement_id TEXT NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
        transaction_date TEXT NOT NULL,
        reference_number TEXT,
        counterparty_name TEXT,
        description TEXT,
        amount REAL NOT NULL DEFAULT 0.0, -- Positive for inflow, negative for outflow
        matched_journal_entry_id TEXT,
        status TEXT NOT NULL DEFAULT 'unmatched', -- unmatched, matched, reconciled
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 4. Cash Reconciliations
    db.prepare(`
      CREATE TABLE IF NOT EXISTS cash_reconciliations (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        reconciliation_number TEXT NOT NULL,
        bank_statement_id TEXT NOT NULL REFERENCES bank_statements(id),
        reconciled_by TEXT NOT NULL,
        reconciled_amount REAL NOT NULL DEFAULT 0.0,
        discrepancy_amount REAL NOT NULL DEFAULT 0.0,
        status TEXT NOT NULL DEFAULT 'draft', -- draft, finalized
        notes TEXT,
        finalized_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 5. Cash Transfers
    db.prepare(`
      CREATE TABLE IF NOT EXISTS cash_transfers (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        transfer_number TEXT NOT NULL,
        from_bank_account_id TEXT NOT NULL REFERENCES bank_accounts(id),
        to_bank_account_id TEXT NOT NULL REFERENCES bank_accounts(id),
        amount REAL NOT NULL DEFAULT 0.0,
        currency TEXT NOT NULL DEFAULT 'USD',
        fx_rate REAL NOT NULL DEFAULT 1.0,
        converted_amount REAL NOT NULL DEFAULT 0.0,
        transfer_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'initiated', -- initiated, completed, cancelled
        initiated_by TEXT NOT NULL,
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 6. Petty Cash Funds
    db.prepare(`
      CREATE TABLE IF NOT EXISTS petty_cash_funds (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        fund_name TEXT NOT NULL,
        custodian_id TEXT NOT NULL,
        max_limit REAL NOT NULL DEFAULT 1000.0,
        current_balance REAL NOT NULL DEFAULT 1000.0,
        currency TEXT NOT NULL DEFAULT 'USD',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 7. Cash Flow Forecasts
    db.prepare(`
      CREATE TABLE IF NOT EXISTS cash_flow_forecasts (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        forecast_date TEXT NOT NULL,
        period_days INTEGER NOT NULL DEFAULT 30, -- 30, 60, 90 days
        projected_inflows REAL NOT NULL DEFAULT 0.0,
        projected_outflows REAL NOT NULL DEFAULT 0.0,
        net_cash_position REAL NOT NULL DEFAULT 0.0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();
  },

  async down(db) {
    const tables = [
      'cash_flow_forecasts',
      'petty_cash_funds',
      'cash_transfers',
      'cash_reconciliations',
      'bank_statement_lines',
      'bank_statements',
      'bank_accounts'
    ];
    for (const table of tables) {
      db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
    }
  }
};
