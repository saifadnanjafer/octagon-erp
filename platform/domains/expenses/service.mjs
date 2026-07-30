// platform/domains/expenses/service.mjs — Expenses and Business Travel Domain Services.

export function generateReportNumber(db, companyId) {
  const year = new Date().getFullYear();
  const prefix = `EXP-${year}-`;
  const countRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM expense_reports WHERE company_id = ? AND report_number LIKE ?
  `).get(companyId, `${prefix}%`);
  const seq = (countRow ? countRow.cnt : 0) + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function generateTravelRequestNumber(db, companyId) {
  const year = new Date().getFullYear();
  const prefix = `TRV-${year}-`;
  const countRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM travel_requests WHERE company_id = ? AND request_number LIKE ?
  `).get(companyId, `${prefix}%`);
  const seq = (countRow ? countRow.cnt : 0) + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function createCategory(db, { company_id, name, code, gl_account_code = null, tax_code = null, requires_receipt = 1, receipt_threshold_amount = 25.0 }) {
  const id = `expcat-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO expense_categories (id, company_id, name, code, gl_account_code, tax_code, requires_receipt, receipt_threshold_amount, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, company_id, name, code, gl_account_code, tax_code, requires_receipt, receipt_threshold_amount, now, now);
  return db.prepare('SELECT * FROM expense_categories WHERE id = ?').get(id);
}

export function createTravelRequest(db, { company_id, employee_id, title, destination, start_date, end_date, estimated_cost = 0, purpose = null }) {
  const id = `trv-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const reqNum = generateTravelRequestNumber(db, company_id);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO travel_requests (id, company_id, request_number, employee_id, title, destination, start_date, end_date, estimated_cost, purpose, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?)
  `).run(id, company_id, reqNum, employee_id, title, destination, start_date, end_date, estimated_cost, purpose, now, now);

  return db.prepare('SELECT * FROM travel_requests WHERE id = ?').get(id);
}

export function approveTravelRequest(db, { id, company_id, approved_by }) {
  const req = db.prepare('SELECT * FROM travel_requests WHERE id = ? AND company_id = ?').get(id, company_id);
  if (!req) throw new Error(`Travel request ${id} not found`);
  if (req.status !== 'requested') throw new Error(`Cannot approve travel request in status: ${req.status}`);

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE travel_requests
    SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ?
    WHERE id = ?
  `).run(approved_by, now, now, id);

  return db.prepare('SELECT * FROM travel_requests WHERE id = ?').get(id);
}

export function createExpenseReport(db, { company_id, employee_id, travel_request_id = null, title, currency = 'USD', notes = null }) {
  const id = `exprpt-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const reportNumber = generateReportNumber(db, company_id);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO expense_reports (id, company_id, report_number, employee_id, travel_request_id, title, currency, total_amount, reimbursable_amount, status, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0.0, 0.0, 'draft', ?, ?, ?)
  `).run(id, company_id, reportNumber, employee_id, travel_request_id, title, currency, notes, now, now);

  return db.prepare('SELECT * FROM expense_reports WHERE id = ?').get(id);
}

export function addExpenseLine(db, {
  company_id,
  expense_report_id,
  category_id,
  expense_date,
  merchant_name = null,
  amount,
  tax_amount = 0.0,
  receipt_attached = 0,
  is_billable = 0,
  customer_id = null,
  project_id = null,
  notes = null
}) {
  const report = db.prepare('SELECT * FROM expense_reports WHERE id = ? AND company_id = ?').get(expense_report_id, company_id);
  if (!report) throw new Error(`Expense report ${expense_report_id} not found`);
  if (report.status !== 'draft') throw new Error(`Cannot modify lines for report in status: ${report.status}`);

  const category = db.prepare('SELECT * FROM expense_categories WHERE id = ?').get(category_id);
  let policyViolation = 0;
  let violationReason = null;

  if (category) {
    if (category.requires_receipt && amount >= category.receipt_threshold_amount && !receipt_attached) {
      policyViolation = 1;
      violationReason = `Receipt required for amounts >= ${category.receipt_threshold_amount}`;
    }
  }

  const lineId = `expline-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO expense_lines (
      id, company_id, expense_report_id, category_id, expense_date, merchant_name,
      amount, tax_amount, receipt_attached, is_billable, customer_id, project_id,
      policy_violation_flag, policy_violation_reason, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(lineId, company_id, expense_report_id, category_id, expense_date, merchant_name, amount, tax_amount, receipt_attached, is_billable, customer_id, project_id, policyViolation, violationReason, notes, now, now);

  // Recalculate totals
  const totalRow = db.prepare(`
    SELECT SUM(amount) as total FROM expense_lines WHERE expense_report_id = ?
  `).get(expense_report_id);
  const newTotal = totalRow ? (totalRow.total || 0.0) : 0.0;

  db.prepare(`
    UPDATE expense_reports
    SET total_amount = ?, reimbursable_amount = ?, updated_at = ?
    WHERE id = ?
  `).run(newTotal, newTotal, now, expense_report_id);

  return db.prepare('SELECT * FROM expense_lines WHERE id = ?').get(lineId);
}

export function submitExpenseReport(db, { id, company_id, submitted_by }) {
  const report = db.prepare('SELECT * FROM expense_reports WHERE id = ? AND company_id = ?').get(id, company_id);
  if (!report) throw new Error(`Expense report ${id} not found`);
  if (report.status !== 'draft') throw new Error(`Report cannot be submitted from status: ${report.status}`);

  const linesCount = db.prepare('SELECT COUNT(*) as cnt FROM expense_lines WHERE expense_report_id = ?').get(id);
  if (!linesCount || linesCount.cnt === 0) throw new Error('Cannot submit an empty expense report');

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE expense_reports
    SET status = 'submitted', submitted_at = ?, updated_at = ?
    WHERE id = ?
  `).run(now, now, id);

  db.prepare(`
    INSERT INTO expense_audit_logs (id, company_id, expense_report_id, action, performed_by, comments, created_at)
    VALUES (?, ?, ?, 'submitted', ?, 'Report submitted for manager approval', ?)
  `).run(`audit-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`, company_id, id, submitted_by, now);

  return db.prepare('SELECT * FROM expense_reports WHERE id = ?').get(id);
}

export function approveExpenseReport(db, { id, company_id, approved_by, comments = null }) {
  const report = db.prepare('SELECT * FROM expense_reports WHERE id = ? AND company_id = ?').get(id, company_id);
  if (!report) throw new Error(`Expense report ${id} not found`);
  if (report.status !== 'submitted') throw new Error(`Report cannot be approved from status: ${report.status}`);

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE expense_reports
    SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ?
    WHERE id = ?
  `).run(approved_by, now, now, id);

  db.prepare(`
    INSERT INTO expense_audit_logs (id, company_id, expense_report_id, action, performed_by, comments, created_at)
    VALUES (?, ?, ?, 'approved', ?, ?, ?)
  `).run(`audit-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`, company_id, id, approved_by, comments || 'Report approved', now);

  return db.prepare('SELECT * FROM expense_reports WHERE id = ?').get(id);
}

export function payExpenseReport(db, { id, company_id, payment_reference, journal_entry_id = null, paid_by }) {
  const report = db.prepare('SELECT * FROM expense_reports WHERE id = ? AND company_id = ?').get(id, company_id);
  if (!report) throw new Error(`Expense report ${id} not found`);
  if (report.status !== 'approved') throw new Error(`Report must be approved before payment (status: ${report.status})`);

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE expense_reports
    SET status = 'paid', paid_at = ?, payment_reference = ?, journal_entry_id = ?, updated_at = ?
    WHERE id = ?
  `).run(now, payment_reference, journal_entry_id, now, id);

  db.prepare(`
    INSERT INTO expense_audit_logs (id, company_id, expense_report_id, action, performed_by, comments, created_at)
    VALUES (?, ?, ?, 'paid', ?, ?, ?)
  `).run(`audit-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`, company_id, id, paid_by, `Reimbursed via ${payment_reference}`, now);

  return db.prepare('SELECT * FROM expense_reports WHERE id = ?').get(id);
}
