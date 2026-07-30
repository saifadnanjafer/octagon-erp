// database/migrations/070_expenses_and_business_travel.mjs — Expenses and Business Travel Module Migration.

export const migration = {
  id: '070_expenses_and_business_travel',
  description: 'Migration 070: Expenses and Business Travel Management (Categories, Reports, Per-diems, Travel Requests, Approvals)',

  async up(db) {
    // 1. Expense Categories
    db.prepare(`
      CREATE TABLE IF NOT EXISTS expense_categories (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        gl_account_code TEXT,
        tax_code TEXT,
        requires_receipt INTEGER NOT NULL DEFAULT 1,
        receipt_threshold_amount REAL NOT NULL DEFAULT 25.0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_expense_categories_company
      ON expense_categories(company_id, is_active)
    `).run();

    // 2. Expense Policies
    db.prepare(`
      CREATE TABLE IF NOT EXISTS expense_policies (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        name TEXT NOT NULL,
        max_daily_limit REAL NOT NULL DEFAULT 500.0,
        max_single_line_limit REAL NOT NULL DEFAULT 200.0,
        receipt_required_above REAL NOT NULL DEFAULT 25.0,
        allow_cash_advances INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 3. Travel Requests
    db.prepare(`
      CREATE TABLE IF NOT EXISTS travel_requests (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        request_number TEXT NOT NULL,
        employee_id TEXT NOT NULL,
        title TEXT NOT NULL,
        destination TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        estimated_cost REAL NOT NULL DEFAULT 0.0,
        purpose TEXT,
        status TEXT NOT NULL DEFAULT 'requested', -- requested, approved, rejected, completed, cancelled
        approved_by TEXT,
        approved_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_travel_requests_company_status
      ON travel_requests(company_id, status)
    `).run();

    // 4. Travel Itineraries
    db.prepare(`
      CREATE TABLE IF NOT EXISTS travel_itineraries (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        travel_request_id TEXT NOT NULL REFERENCES travel_requests(id) ON DELETE CASCADE,
        type TEXT NOT NULL DEFAULT 'flight', -- flight, hotel, train, car_rental
        provider_name TEXT,
        confirmation_code TEXT,
        departure_time TEXT,
        arrival_time TEXT,
        cost REAL NOT NULL DEFAULT 0.0,
        currency TEXT NOT NULL DEFAULT 'USD',
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 5. Expense Reports
    db.prepare(`
      CREATE TABLE IF NOT EXISTS expense_reports (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        report_number TEXT NOT NULL,
        employee_id TEXT NOT NULL,
        travel_request_id TEXT REFERENCES travel_requests(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        total_amount REAL NOT NULL DEFAULT 0.0,
        reimbursable_amount REAL NOT NULL DEFAULT 0.0,
        advance_deducted REAL NOT NULL DEFAULT 0.0,
        status TEXT NOT NULL DEFAULT 'draft', -- draft, submitted, approved, rejected, paid, posted
        submitted_at TEXT,
        approved_by TEXT,
        approved_at TEXT,
        paid_at TEXT,
        payment_reference TEXT,
        journal_entry_id TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_expense_reports_company_status
      ON expense_reports(company_id, status)
    `).run();

    // 6. Expense Lines
    db.prepare(`
      CREATE TABLE IF NOT EXISTS expense_lines (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        expense_report_id TEXT NOT NULL REFERENCES expense_reports(id) ON DELETE CASCADE,
        category_id TEXT NOT NULL REFERENCES expense_categories(id),
        expense_date TEXT NOT NULL,
        merchant_name TEXT,
        amount REAL NOT NULL DEFAULT 0.0,
        tax_amount REAL NOT NULL DEFAULT 0.0,
        receipt_attached INTEGER NOT NULL DEFAULT 0,
        is_billable INTEGER NOT NULL DEFAULT 0,
        customer_id TEXT,
        project_id TEXT,
        policy_violation_flag INTEGER NOT NULL DEFAULT 0,
        policy_violation_reason TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 7. Expense Receipts
    db.prepare(`
      CREATE TABLE IF NOT EXISTS expense_receipts (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        expense_line_id TEXT NOT NULL REFERENCES expense_lines(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        mime_type TEXT,
        file_size INTEGER,
        ocr_extracted_data TEXT,
        uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 8. Expense Per Diems
    db.prepare(`
      CREATE TABLE IF NOT EXISTS expense_per_diems (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        destination_zone TEXT NOT NULL,
        daily_rate REAL NOT NULL DEFAULT 0.0,
        currency TEXT NOT NULL DEFAULT 'USD',
        effective_from TEXT NOT NULL,
        effective_to TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 9. Mileage Rates
    db.prepare(`
      CREATE TABLE IF NOT EXISTS expense_mileage_rates (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        vehicle_type TEXT NOT NULL DEFAULT 'car', -- car, motorcycle, truck
        rate_per_km REAL NOT NULL DEFAULT 0.50,
        currency TEXT NOT NULL DEFAULT 'USD',
        effective_year INTEGER NOT NULL DEFAULT 2026,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 10. Expense Advances
    db.prepare(`
      CREATE TABLE IF NOT EXISTS expense_advances (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        advance_number TEXT NOT NULL,
        employee_id TEXT NOT NULL,
        travel_request_id TEXT REFERENCES travel_requests(id) ON DELETE SET NULL,
        amount REAL NOT NULL DEFAULT 0.0,
        currency TEXT NOT NULL DEFAULT 'USD',
        status TEXT NOT NULL DEFAULT 'requested', -- requested, issued, settled, cancelled
        issued_at TEXT,
        payment_method TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 11. Expense Approval Rules
    db.prepare(`
      CREATE TABLE IF NOT EXISTS expense_approval_rules (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        name TEXT NOT NULL,
        min_amount REAL NOT NULL DEFAULT 0.0,
        max_amount REAL NOT NULL DEFAULT 10000.0,
        approver_role TEXT NOT NULL DEFAULT 'manager',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 12. Expense Audit Logs
    db.prepare(`
      CREATE TABLE IF NOT EXISTS expense_audit_logs (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        expense_report_id TEXT NOT NULL,
        action TEXT NOT NULL, -- submitted, approved, rejected, policy_overridden, paid
        performed_by TEXT NOT NULL,
        comments TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();
  },

  async down(db) {
    const tables = [
      'expense_audit_logs',
      'expense_approval_rules',
      'expense_advances',
      'expense_mileage_rates',
      'expense_per_diems',
      'expense_receipts',
      'expense_lines',
      'expense_reports',
      'travel_itineraries',
      'travel_requests',
      'expense_policies',
      'expense_categories'
    ];
    for (const table of tables) {
      db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
    }
  }
};
