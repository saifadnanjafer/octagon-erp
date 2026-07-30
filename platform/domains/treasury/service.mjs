// platform/domains/treasury/service.mjs — Treasury, Banking & Cash Management Domain Services.

export function generateStatementNumber(db, companyId) {
  const year = new Date().getFullYear();
  const prefix = `STMT-${year}-`;
  const countRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM bank_statements WHERE company_id = ? AND statement_number LIKE ?
  `).get(companyId, `${prefix}%`);
  const seq = (countRow ? countRow.cnt : 0) + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function generateTransferNumber(db, companyId) {
  const year = new Date().getFullYear();
  const prefix = `TRF-${year}-`;
  const countRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM cash_transfers WHERE company_id = ? AND transfer_number LIKE ?
  `).get(companyId, `${prefix}%`);
  const seq = (countRow ? countRow.cnt : 0) + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function generateReconciliationNumber(db, companyId) {
  const year = new Date().getFullYear();
  const prefix = `REC-${year}-`;
  const countRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM cash_reconciliations WHERE company_id = ? AND reconciliation_number LIKE ?
  `).get(companyId, `${prefix}%`);
  const seq = (countRow ? countRow.cnt : 0) + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function createBankAccount(db, { company_id, account_number, iban = null, swift_code = null, bank_name, branch_name = null, currency = 'USD', gl_account_code, initial_balance = 0.0 }) {
  const id = `bnk-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO bank_accounts (id, company_id, account_number, iban, swift_code, bank_name, branch_name, currency, gl_account_code, current_balance, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, company_id, account_number, iban, swift_code, bank_name, branch_name, currency, gl_account_code, initial_balance, now, now);

  return db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(id);
}

export function importBankStatement(db, { company_id, bank_account_id, statement_date, starting_balance, ending_balance }) {
  const bnk = db.prepare('SELECT * FROM bank_accounts WHERE id = ? AND company_id = ?').get(bank_account_id, company_id);
  if (!bnk) throw new Error(`Bank account ${bank_account_id} not found`);

  const id = `stmt-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const stmtNum = generateStatementNumber(db, company_id);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO bank_statements (id, company_id, bank_account_id, statement_number, statement_date, starting_balance, ending_balance, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'imported', ?, ?)
  `).run(id, company_id, bank_account_id, stmtNum, statement_date, starting_balance, ending_balance, now, now);

  return db.prepare('SELECT * FROM bank_statements WHERE id = ?').get(id);
}

export function addStatementLine(db, { company_id, bank_statement_id, transaction_date, reference_number = null, counterparty_name = null, description = null, amount }) {
  const stmt = db.prepare('SELECT * FROM bank_statements WHERE id = ? AND company_id = ?').get(bank_statement_id, company_id);
  if (!stmt) throw new Error(`Bank statement ${bank_statement_id} not found`);

  const id = `stmtline-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO bank_statement_lines (id, company_id, bank_statement_id, transaction_date, reference_number, counterparty_name, description, amount, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unmatched', ?)
  `).run(id, company_id, bank_statement_id, transaction_date, reference_number, counterparty_name, description, amount, now);

  return db.prepare('SELECT * FROM bank_statement_lines WHERE id = ?').get(id);
}

export function matchStatementLine(db, { company_id, statement_line_id, matched_journal_entry_id }) {
  const line = db.prepare('SELECT * FROM bank_statement_lines WHERE id = ? AND company_id = ?').get(statement_line_id, company_id);
  if (!line) throw new Error(`Statement line ${statement_line_id} not found`);

  db.prepare(`
    UPDATE bank_statement_lines SET matched_journal_entry_id = ?, status = 'matched' WHERE id = ?
  `).run(matched_journal_entry_id, statement_line_id);

  // Update statement status to in_progress
  db.prepare(`UPDATE bank_statements SET status = 'in_progress', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), line.bank_statement_id);

  return db.prepare('SELECT * FROM bank_statement_lines WHERE id = ?').get(statement_line_id);
}

export function finalizeReconciliation(db, { company_id, bank_statement_id, reconciled_by, notes = null }) {
  const stmt = db.prepare('SELECT * FROM bank_statements WHERE id = ? AND company_id = ?').get(bank_statement_id, company_id);
  if (!stmt) throw new Error(`Statement ${bank_statement_id} not found`);

  const lines = db.prepare('SELECT * FROM bank_statement_lines WHERE bank_statement_id = ?').all(bank_statement_id);
  const unmatched = lines.filter(l => l.status === 'unmatched');
  if (unmatched.length > 0) {
    throw new Error(`Cannot finalize reconciliation. ${unmatched.length} statement line(s) remain unmatched.`);
  }

  const id = `rec-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const recNum = generateReconciliationNumber(db, company_id);
  const now = new Date().toISOString();

  let matchedSum = 0.0;
  for (const l of lines) {
    matchedSum += l.amount;
  }

  db.prepare(`
    INSERT INTO cash_reconciliations (id, company_id, reconciliation_number, bank_statement_id, reconciled_by, reconciled_amount, discrepancy_amount, status, notes, finalized_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 0.0, 'finalized', ?, ?, ?, ?)
  `).run(id, company_id, recNum, bank_statement_id, reconciled_by, matchedSum, notes, now, now, now);

  db.prepare(`UPDATE bank_statements SET status = 'reconciled', reconciled_at = ?, updated_at = ? WHERE id = ?`).run(now, now, bank_statement_id);
  db.prepare(`UPDATE bank_statement_lines SET status = 'reconciled' WHERE bank_statement_id = ?`).run(bank_statement_id);

  return db.prepare('SELECT * FROM cash_reconciliations WHERE id = ?').get(id);
}

export function executeCashTransfer(db, { company_id, from_bank_account_id, to_bank_account_id, amount, fx_rate = 1.0, transfer_date, initiated_by }) {
  const fromAcc = db.prepare('SELECT * FROM bank_accounts WHERE id = ? AND company_id = ?').get(from_bank_account_id, company_id);
  const toAcc = db.prepare('SELECT * FROM bank_accounts WHERE id = ? AND company_id = ?').get(to_bank_account_id, company_id);

  if (!fromAcc || !toAcc) throw new Error('Source or destination bank account not found');
  if (fromAcc.current_balance < amount) {
    throw new Error(`Insufficient funds in bank account ${from_bank_account_id}. Balance: ${fromAcc.current_balance}, Requested transfer: ${amount}`);
  }

  const convertedAmount = amount * fx_rate;
  const id = `trf-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const trfNum = generateTransferNumber(db, company_id);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO cash_transfers (id, company_id, transfer_number, from_bank_account_id, to_bank_account_id, amount, currency, fx_rate, converted_amount, transfer_date, status, initiated_by, completed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?)
  `).run(id, company_id, trfNum, from_bank_account_id, to_bank_account_id, amount, fromAcc.currency, fx_rate, convertedAmount, transfer_date, initiated_by, now, now, now);

  // Update bank balances
  db.prepare(`UPDATE bank_accounts SET current_balance = current_balance - ?, updated_at = ? WHERE id = ?`).run(amount, now, from_bank_account_id);
  db.prepare(`UPDATE bank_accounts SET current_balance = current_balance + ?, updated_at = ? WHERE id = ?`).run(convertedAmount, now, to_bank_account_id);

  return db.prepare('SELECT * FROM cash_transfers WHERE id = ?').get(id);
}
