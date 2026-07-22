import crypto from 'node:crypto';
import { nextSeq } from '../records/sequences/index.mjs';

export class FinanceError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'FinanceError';
    this.code = code;
    this.details = details;
  }
}

const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense', 'receivable', 'payable', 'liquidity', 'off_balance'];
const JOURNAL_TYPES = ['sale', 'purchase', 'cash', 'bank', 'general', 'opening', 'period_close', 'tax_adjustment'];
const DOCUMENT_TYPES = ['manual_entry', 'customer_invoice', 'customer_credit_note', 'supplier_bill', 'supplier_credit_note', 'cash_receipt', 'cash_payment', 'opening_entry', 'period_close', 'tax_adjustment', 'source_post'];
const NORMAL_BALANCE = {
  asset: 'debit', liquidity: 'debit', receivable: 'debit', expense: 'debit', off_balance: 'debit',
  liability: 'credit', payable: 'credit', equity: 'credit', income: 'credit',
};

function context(ctx) {
  if (!ctx || !ctx.companyId) {
    throw new FinanceError('server-derived companyId is required', 'MISSING_CONTEXT');
  }
  return {
    tenantId: ctx.tenantId || null,
    companyId: ctx.companyId,
    branchId: ctx.branchId || null,
    userId: ctx.userId || 'system',
    now: ctx.now || new Date().toISOString(),
  };
}

function assertCompanyMatch(dialect, table, id, companyId) {
  const row = dialect.prepare(`SELECT company_id FROM ${table} WHERE id = ?`).get(id);
  if (!row) throw new FinanceError(`${table} ${id} not found`, 'NOT_FOUND');
  if (row.company_id !== companyId) throw new FinanceError('cross-company access denied', 'CROSS_COMPANY');
}

export function accountIdByCode(dialect, companyId, code) {
  const row = dialect.prepare('SELECT id FROM finance_accounts WHERE company_id = ? AND code = ?').get(companyId, code);
  if (!row) throw new FinanceError(`account ${code} not found`, 'ACCOUNT_NOT_FOUND');
  return row.id;
}

export function createAccount(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const code = String(input.code || '').trim();
  const name = String(input.name || '').trim();
  const nameAr = input.name_ar ? String(input.name_ar).trim() : name;
  if (!code) throw new FinanceError('account code is required', 'ACCOUNT_CODE_REQUIRED');
  if (!name) throw new FinanceError('account name is required', 'ACCOUNT_NAME_REQUIRED');
  const type = input.type;
  if (!ACCOUNT_TYPES.includes(type)) throw new FinanceError('invalid account type', 'ACCOUNT_TYPE_INVALID');
  const normalBalance = input.normal_balance || NORMAL_BALANCE[type];

  const dup = dialect.prepare('SELECT id FROM finance_accounts WHERE company_id = ? AND code = ?').get(companyId, code);
  if (dup) throw new FinanceError('duplicate account code in company', 'ACCOUNT_DUPLICATE');

  if (input.parent_id) {
    const parent = dialect.prepare('SELECT id FROM finance_accounts WHERE id = ? AND company_id = ?').get(input.parent_id, companyId);
    if (!parent) throw new FinanceError('parent account not found', 'ACCOUNT_PARENT_INVALID');
  }

  const id = input.id || `finacc_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_accounts (
      id, company_id, code, name, name_ar, type, parent_id, normal_balance, is_reconcilable,
      currency_restriction, is_active, is_control, tax_role, bank_role, cash_role,
      retained_earnings_role, localization_origin, created_at, updated_at, created_by, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, companyId, code, name, nameAr, type, input.parent_id || null, normalBalance,
    input.is_reconcilable ? 1 : 0, input.currency_restriction || null,
    input.is_active !== false ? 1 : 0, input.is_control ? 1 : 0,
    input.tax_role || null, input.bank_role || null, input.cash_role || null,
    input.retained_earnings_role ? 1 : 0, input.localization_origin || null,
    now, now, userId, userId
  );

  return { id, companyId, code, name, nameAr, type, normal_balance: normalBalance };
}

function wouldCreateCycle(dialect, companyId, accountId, newParentId) {
  if (!newParentId) return false;
  if (newParentId === accountId) return true;
  let current = newParentId;
  const visited = new Set();
  while (current) {
    if (current === accountId) return true;
    if (visited.has(current)) return true;
    visited.add(current);
    const row = dialect.prepare('SELECT parent_id FROM finance_accounts WHERE id = ? AND company_id = ?').get(current, companyId);
    if (!row) return false;
    current = row.parent_id;
  }
  return false;
}

export function updateAccount(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const accountId = input.account_id;
  const account = dialect.prepare('SELECT id FROM finance_accounts WHERE id = ? AND company_id = ?').get(accountId, companyId);
  if (!account) throw new FinanceError('account not found', 'ACCOUNT_NOT_FOUND');

  const updates = [];
  const params = [];
  if (input.name !== undefined) { updates.push('name = ?'); params.push(String(input.name).trim()); }
  if (input.name_ar !== undefined) { updates.push('name_ar = ?'); params.push(String(input.name_ar).trim()); }
  if (input.parent_id !== undefined) {
    const parentId = input.parent_id || null;
    if (parentId) {
      const parent = dialect.prepare('SELECT id FROM finance_accounts WHERE id = ? AND company_id = ?').get(parentId, companyId);
      if (!parent) throw new FinanceError('parent account not found', 'ACCOUNT_PARENT_INVALID');
      if (wouldCreateCycle(dialect, companyId, accountId, parentId)) throw new FinanceError('account hierarchy cycle', 'ACCOUNT_CYCLE');
    }
    updates.push('parent_id = ?'); params.push(parentId);
  }
  if (input.is_active !== undefined) { updates.push('is_active = ?'); params.push(input.is_active ? 1 : 0); }
  if (updates.length === 0) return dialect.prepare('SELECT * FROM finance_accounts WHERE id = ? AND company_id = ?').get(accountId, companyId);

  params.push(now, userId, accountId, companyId);
  dialect.prepare(`UPDATE finance_accounts SET ${updates.join(', ')}, updated_at = ?, updated_by = ? WHERE id = ? AND company_id = ?`).run(...params);
  return dialect.prepare('SELECT * FROM finance_accounts WHERE id = ? AND company_id = ?').get(accountId, companyId);
}

export function deactivateAccount(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const accountId = input.account_id;
  const account = dialect.prepare('SELECT id FROM finance_accounts WHERE id = ? AND company_id = ?').get(accountId, companyId);
  if (!account) throw new FinanceError('account not found', 'ACCOUNT_NOT_FOUND');
  // Prevent deactivation if used in posted lines (Wave A safety).
  const used = dialect.prepare('SELECT 1 FROM finance_journal_lines WHERE account_id = ? LIMIT 1').get(accountId);
  if (used) throw new FinanceError('cannot deactivate account used in posted entries', 'ACCOUNT_IN_USE');
  dialect.prepare('UPDATE finance_accounts SET is_active = 0, updated_at = ?, updated_by = ? WHERE id = ? AND company_id = ?').run(now, userId, accountId, companyId);
  return { id: accountId, is_active: 0 };
}

export function createJournal(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const code = String(input.code || '').trim();
  const name = String(input.name || '').trim();
  if (!code) throw new FinanceError('journal code is required', 'JOURNAL_CODE_REQUIRED');
  if (!name) throw new FinanceError('journal name is required', 'JOURNAL_NAME_REQUIRED');
  const type = input.type;
  if (!JOURNAL_TYPES.includes(type)) throw new FinanceError('invalid journal type', 'JOURNAL_TYPE_INVALID');

  const dup = dialect.prepare('SELECT id FROM finance_journals WHERE company_id = ? AND code = ?').get(companyId, code);
  if (dup) throw new FinanceError('duplicate journal code', 'JOURNAL_DUPLICATE');

  if (input.default_debit_account_id) assertCompanyMatch(dialect, 'finance_accounts', input.default_debit_account_id, companyId);
  if (input.default_credit_account_id) assertCompanyMatch(dialect, 'finance_accounts', input.default_credit_account_id, companyId);

  const id = input.id || `finjnl_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_journals (
      id, company_id, code, name, type, sequence_id, default_debit_account_id, default_credit_account_id,
      is_active, created_at, updated_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, companyId, code, name, type, input.sequence_id || null,
    input.default_debit_account_id || null, input.default_credit_account_id || null,
    1, now, now, userId
  );
  return { id, companyId, code, name, type };
}

export function getDocument(dialect, companyId, docId) {
  const doc = dialect.prepare('SELECT * FROM finance_documents WHERE id = ? AND company_id = ?').get(docId, companyId);
  if (!doc) return null;
  const lines = dialect.prepare('SELECT * FROM finance_document_lines WHERE document_id = ? ORDER BY id').all(docId);
  return { ...doc, lines };
}

export function createDocument(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const docId = input.id || `findoc_${crypto.randomUUID()}`;
  const docDate = input.doc_date || now.slice(0, 10);
  const moveType = input.move_type || 'manual_entry';
  if (!DOCUMENT_TYPES.includes(moveType)) throw new FinanceError('invalid document type', 'DOCUMENT_TYPE_INVALID');
  const currency = input.currency || 'IQD';
  if (input.journal_id) assertCompanyMatch(dialect, 'finance_journals', input.journal_id, companyId);

  dialect.prepare(`
    INSERT INTO finance_documents (
      id, company_id, journal_id, doc_number, move_type, partner_id, doc_date, post_date, currency, state,
      reversal_of_id, reversal_id, source_type, source_id, source_canonical_key, created_at, updated_at, created_by, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    docId, companyId, input.journal_id || null, null, moveType, input.partner_id || null,
    docDate, null, currency, 'draft', input.reversal_of_id || null, null,
    input.source_type || null, input.source_id || null, input.source_canonical_key || null,
    now, now, userId, userId
  );

  const lines = input.lines || [];
  if (!lines.length) throw new FinanceError('document must have at least one line', 'DOCUMENT_EMPTY');
  for (const line of lines) {
    const lineId = `findocl_${crypto.randomUUID()}`;
    const accountId = line.account_id;
    const acc = dialect.prepare('SELECT id FROM finance_accounts WHERE id = ? AND company_id = ? AND is_active = 1').get(accountId, companyId);
    if (!acc) throw new FinanceError(`account ${accountId} not found or inactive`, 'ACCOUNT_NOT_FOUND');
    dialect.prepare(`
      INSERT INTO finance_document_lines (
        id, document_id, company_id, account_id, debit, credit, currency_code, currency_debit, currency_credit,
        tax_refs, dims, partner_id, description, created_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      lineId, docId, companyId, accountId,
      Number(line.debit || 0), Number(line.credit || 0),
      line.currency_code || currency, Number(line.currency_debit || 0), Number(line.currency_credit || 0),
      line.tax_refs || null, line.dims || null,
      line.partner_id || input.partner_id || null, line.description || null,
      now, userId
    );
  }
  return getDocument(dialect, companyId, docId);
}

function validateDocumentBalanced(dialect, docId) {
  const lines = dialect.prepare('SELECT debit, credit, currency_code, currency_debit, currency_credit FROM finance_document_lines WHERE document_id = ?').all(docId);
  const totalDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.0001) {
    throw new FinanceError('document is not balanced', 'DOCUMENT_UNBALANCED');
  }
  const fx = {};
  for (const l of lines) {
    const code = l.currency_code || '';
    if (!code || code === 'IQD') continue;
    fx[code] = fx[code] || { debit: 0, credit: 0 };
    fx[code].debit += Number(l.currency_debit || 0);
    fx[code].credit += Number(l.currency_credit || 0);
  }
  for (const [code, t] of Object.entries(fx)) {
    if (Math.abs(t.debit - t.credit) > 0.0001) {
      throw new FinanceError(`foreign currency ${code} is not balanced`, 'DOCUMENT_FX_UNBALANCED');
    }
  }
  return { totalDebit, totalCredit };
}

function checkPeriodAndLock(dialect, companyId, docDate) {
  const period = dialect.prepare('SELECT id, status FROM finance_periods WHERE company_id = ? AND start_date <= ? AND end_date >= ?').get(companyId, docDate, docDate);
  if (!period) throw new FinanceError('no fiscal period exists for the document date', 'PERIOD_MISSING');
  if (period.status !== 'open') throw new FinanceError('period is closed or locked', 'PERIOD_CLOSED');
  const lock = dialect.prepare('SELECT lock_date FROM finance_locks WHERE company_id = ? AND module = ?').get(companyId, 'gl');
  if (lock && lock.lock_date >= docDate) throw new FinanceError('document date is locked', 'LOCK_DATE');
}

function sequenceTemplate(moveType) {
  const map = {
    manual_entry: 'JV-{YYYY}-{#####}',
    customer_invoice: 'INV-{YYYY}-{#####}',
    customer_credit_note: 'CN-{YYYY}-{#####}',
    supplier_bill: 'BILL-{YYYY}-{#####}',
    supplier_credit_note: 'DBN-{YYYY}-{#####}',
    cash_receipt: 'RCPT-{YYYY}-{#####}',
    cash_payment: 'PAY-{YYYY}-{#####}',
    opening_entry: 'OP-{YYYY}-{#####}',
    period_close: 'CLOSE-{YYYY}-{#####}',
    tax_adjustment: 'TAX-{YYYY}-{#####}',
    source_post: 'POST-{YYYY}-{#####}',
  };
  return map[moveType] || 'DOC-{YYYY}-{#####}';
}

function lastJournalEntryHash(dialect, companyId) {
  const row = dialect.prepare("SELECT hash FROM finance_journal_entries WHERE company_id = ? AND hash IS NOT NULL ORDER BY posting_date DESC, entry_number DESC LIMIT 1").get(companyId);
  return row ? row.hash : null;
}

export function buildHashInput({ docId, companyId, journalId, postingDate, prevHash, entryNumber, lines }) {
  const linesStr = JSON.stringify(lines.map(l => ({ account_id: l.account_id, debit: Number(l.debit || 0), credit: Number(l.credit || 0) })));
  return `entry|${docId}|${companyId}|${journalId || ''}|${postingDate}|${prevHash}|${entryNumber}|${linesStr}`;
}

export function postDocument(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const docId = input.document_id;
  const doc = getDocument(dialect, companyId, docId);
  if (!doc) throw new FinanceError('document not found', 'DOCUMENT_NOT_FOUND');
  if (!['draft', 'submitted', 'approved'].includes(doc.state)) {
    throw new FinanceError('document must be draft, submitted, or approved to post', 'DOCUMENT_STATE_INVALID');
  }

  checkPeriodAndLock(dialect, companyId, doc.doc_date);
  const { totalDebit, totalCredit } = validateDocumentBalanced(dialect, docId);

  const { formatted: entryNumber } = nextSeq(dialect, {
    scopeKey: `finance_documents:${doc.move_type}`,
    template: sequenceTemplate(doc.move_type),
    companyId,
  });

  const prevHash = lastJournalEntryHash(dialect, companyId) || '0'.repeat(64);
  const sortedLines = doc.lines.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const hashInput = buildHashInput({
    docId, companyId, journalId: doc.journal_id, postingDate: doc.doc_date, prevHash, entryNumber, lines: sortedLines,
  });
  const hash = crypto.createHash('sha256').update(hashInput).digest('hex');

  const entryId = `finje_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_journal_entries (
      id, document_id, company_id, journal_id, entry_number, posting_date, currency, total_debit, total_credit, hash, prev_hash, created_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entryId, docId, companyId, doc.journal_id, entryNumber, doc.doc_date, doc.currency,
    totalDebit, totalCredit, hash, prevHash, now, userId
  );

  const lineStmt = dialect.prepare(`
    INSERT INTO finance_journal_lines (
      id, journal_entry_id, company_id, document_id, document_line_id, account_id, posting_date, debit, credit,
      currency_code, currency_debit, currency_credit, dims, partner_id, description, created_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const l of doc.lines) {
    lineStmt.run(
      `finjll_${crypto.randomUUID()}`, entryId, companyId, docId, l.id,
      l.account_id, doc.doc_date, Number(l.debit || 0), Number(l.credit || 0),
      l.currency_code || doc.currency, Number(l.currency_debit || 0), Number(l.currency_credit || 0),
      l.dims || null, l.partner_id || doc.partner_id || null, l.description || null, now, userId
    );
  }

  dialect.prepare(`
    INSERT INTO finance_integrity_hashes (id, company_id, journal_entry_id, hash_input, hash, prev_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(`finhash_${crypto.randomUUID()}`, companyId, entryId, hashInput, hash, prevHash, now);

  dialect.prepare(`
    UPDATE finance_documents SET doc_number = ?, post_date = ?, state = 'posted', updated_at = ?, updated_by = ?
    WHERE id = ? AND company_id = ?
  `).run(entryNumber, now, now, userId, docId, companyId);

  return getDocument(dialect, companyId, docId);
}

export function reverseDocument(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const originalId = input.document_id;
  const original = getDocument(dialect, companyId, originalId);
  if (!original) throw new FinanceError('document not found', 'DOCUMENT_NOT_FOUND');
  if (original.state !== 'posted') throw new FinanceError('only posted documents can be reversed', 'DOCUMENT_NOT_POSTED');
  if (original.reversal_id) throw new FinanceError('document already has a reversal', 'DOCUMENT_ALREADY_REVERSED');

  checkPeriodAndLock(dialect, companyId, input.reverse_date || original.doc_date);

  const reversalLines = original.lines.map(l => ({
    account_id: l.account_id,
    debit: Number(l.credit || 0),
    credit: Number(l.debit || 0),
    currency_code: l.currency_code,
    currency_debit: Number(l.currency_credit || 0),
    currency_credit: Number(l.currency_debit || 0),
    dims: l.dims,
    partner_id: l.partner_id,
    description: `Reversal: ${l.description || ''}`,
  }));

  const reversalDoc = createDocument(dialect, ctx, {
    move_type: original.move_type,
    doc_date: input.reverse_date || original.doc_date,
    journal_id: original.journal_id,
    partner_id: original.partner_id,
    currency: original.currency,
    reversal_of_id: originalId,
    lines: reversalLines,
  });

  postDocument(dialect, ctx, { document_id: reversalDoc.id });

  dialect.prepare(`
    UPDATE finance_documents SET state = 'reversed', reversal_id = ?, updated_at = ?, updated_by = ? WHERE id = ? AND company_id = ?
  `).run(reversalDoc.id, now, userId, originalId, companyId);

  dialect.prepare(`
    INSERT INTO finance_reversal_links (id, company_id, original_document_id, reversal_document_id, reversal_type, reason, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(`finrev_${crypto.randomUUID()}`, companyId, originalId, reversalDoc.id, input.reversal_type || 'full', input.reason || null, now, userId);

  return { original: getDocument(dialect, companyId, originalId), reversal: getDocument(dialect, companyId, reversalDoc.id) };
}

export function amendDocument(dialect, ctx, input) {
  const { companyId } = context(ctx);
  const originalId = input.document_id;
  const original = getDocument(dialect, companyId, originalId);
  if (!original) throw new FinanceError('document not found', 'DOCUMENT_NOT_FOUND');
  if (!['posted', 'reversed'].includes(original.state)) {
    throw new FinanceError('amend requires posted or reversed document', 'DOCUMENT_STATE_INVALID');
  }
  return createDocument(dialect, ctx, {
    move_type: original.move_type,
    doc_date: input.doc_date || original.doc_date,
    journal_id: original.journal_id,
    partner_id: original.partner_id,
    currency: original.currency,
    source_type: 'amendment',
    source_id: originalId,
    lines: input.lines || original.lines,
  });
}

export function setPeriodStatus(dialect, ctx, input, status) {
  const { companyId, userId, now } = context(ctx);
  const periodId = input.period_id;
  const period = dialect.prepare('SELECT * FROM finance_periods WHERE id = ? AND company_id = ?').get(periodId, companyId);
  if (!period) throw new FinanceError('period not found', 'PERIOD_NOT_FOUND');
  dialect.prepare('UPDATE finance_periods SET status = ?, updated_at = ?, updated_by = ? WHERE id = ? AND company_id = ?').run(status, now, userId, periodId, companyId);
  return { id: periodId, status };
}

export function openPeriod(dialect, ctx, input) {
  return setPeriodStatus(dialect, ctx, input, 'open');
}

export function softClosePeriod(dialect, ctx, input) {
  return setPeriodStatus(dialect, ctx, input, 'soft_closed');
}

export function hardClosePeriod(dialect, ctx, input) {
  return setPeriodStatus(dialect, ctx, input, 'hard_closed');
}

export function reopenPeriod(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const periodId = input.period_id;
  const period = dialect.prepare('SELECT * FROM finance_periods WHERE id = ? AND company_id = ?').get(periodId, companyId);
  if (!period) throw new FinanceError('period not found', 'PERIOD_NOT_FOUND');
  if (period.status === 'hard_closed') {
    const reason = input.reason || '';
    if (!reason.trim()) throw new FinanceError('reason is required to reopen a hard-closed period', 'REOPEN_REASON_REQUIRED');
  }
  dialect.prepare('UPDATE finance_periods SET status = ?, updated_at = ?, updated_by = ? WHERE id = ? AND company_id = ?').run('open', now, userId, periodId, companyId);
  return { id: periodId, status: 'open' };
}

export function setLockDate(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const module = input.module || 'gl';
  dialect.prepare(`
    INSERT INTO finance_locks (id, company_id, module, lock_date, reason, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET lock_date = excluded.lock_date, reason = excluded.reason, created_at = excluded.created_at, created_by = excluded.created_by
  `).run(`finlock_${crypto.randomUUID()}_${module}`, companyId, module, input.lock_date, input.reason || null, now, userId);
  return { companyId, module, lock_date: input.lock_date };
}

export function verifyHashChain(dialect, ctx, input) {
  const { companyId } = context(ctx);
  const entries = dialect.prepare(`
    SELECT id, document_id, entry_number, posting_date, hash, prev_hash, total_debit, total_credit
    FROM finance_journal_entries
    WHERE company_id = ? AND hash IS NOT NULL
    ORDER BY posting_date, entry_number
  `).all(companyId);

  let expectedPrev = '0'.repeat(64);
  for (const entry of entries) {
    if (entry.prev_hash !== expectedPrev) {
      return { ok: false, error: `chain broken at ${entry.entry_number}`, entryId: entry.id };
    }
    const doc = dialect.prepare('SELECT move_type, journal_id FROM finance_documents WHERE id = ?').get(entry.document_id);
    const lines = dialect.prepare('SELECT account_id, debit, credit FROM finance_journal_lines WHERE journal_entry_id = ? ORDER BY document_line_id').all(entry.id);
    const hashInput = buildHashInput({
      docId: entry.document_id, companyId, journalId: doc.journal_id, postingDate: entry.posting_date,
      prevHash: entry.prev_hash, entryNumber: entry.entry_number, lines,
    });
    const computed = crypto.createHash('sha256').update(hashInput).digest('hex');
    if (computed !== entry.hash) {
      return { ok: false, error: `hash mismatch at ${entry.entry_number}`, entryId: entry.id };
    }
    expectedPrev = entry.hash;
  }
  return { ok: true, count: entries.length };
}

export function getTrialBalance(dialect, ctx, options = {}) {
  const { companyId } = context(ctx);
  let sql = `
    SELECT l.account_id, a.code, a.name, a.type, a.normal_balance,
           SUM(l.debit) AS total_debit, SUM(l.credit) AS total_credit
    FROM finance_journal_lines l
    JOIN finance_accounts a ON a.id = l.account_id AND a.company_id = l.company_id
    WHERE l.company_id = ?
  `;
  const params = [companyId];
  if (options.start_date) { sql += ' AND l.posting_date >= ?'; params.push(options.start_date); }
  if (options.end_date) { sql += ' AND l.posting_date <= ?'; params.push(options.end_date); }
  sql += ' GROUP BY l.account_id ORDER BY a.code';
  const rows = dialect.prepare(sql).all(...params);
  return rows.map(r => ({
    account_id: r.account_id,
    code: r.code,
    name: r.name,
    type: r.type,
    normal_balance: r.normal_balance,
    total_debit: r.total_debit,
    total_credit: r.total_credit,
    balance: Number(r.total_debit) - Number(r.total_credit),
  }));
}

export function getGeneralLedger(dialect, ctx, accountId, options = {}) {
  const { companyId } = context(ctx);
  const rows = dialect.prepare(`
    SELECT l.id, l.posting_date, d.doc_number, d.move_type, l.debit, l.credit, l.currency_code,
           l.currency_debit, l.currency_credit, l.partner_id, l.description
    FROM finance_journal_lines l
    JOIN finance_documents d ON d.id = l.document_id
    WHERE l.company_id = ? AND l.account_id = ?
      AND (?1 IS NULL OR l.posting_date >= ?1)
      AND (?2 IS NULL OR l.posting_date <= ?2)
    ORDER BY l.posting_date, l.id
  `).all(companyId, accountId, options.start_date || null, options.end_date || null);
  return rows;
}

export function seedChartOfAccounts(dialect, ctx, options = {}) {
  const { companyId } = context(ctx);
  const accounts = [
    { code: '100000', name: 'Assets / الأصول', type: 'asset' },
    { code: '101000', name: 'Cash / الصندوق', type: 'liquidity', parent_code: '100000' },
    { code: '102000', name: 'Bank / البنك', type: 'liquidity', parent_code: '100000' },
    { code: '103000', name: 'Receivables / المدينون', type: 'receivable', parent_code: '100000', is_reconcilable: true },
    { code: '104000', name: 'Stock Valuation / تقييم المخزون', type: 'asset', parent_code: '100000' },
    { code: '200000', name: 'Liabilities / الالتزامات', type: 'liability' },
    { code: '201000', name: 'Payables / الدائنون', type: 'payable', parent_code: '200000', is_reconcilable: true },
    { code: '202000', name: 'VAT Payable / ضريبة القيمة المضافة المستحقة', type: 'liability', parent_code: '200000' },
    { code: '300000', name: 'Equity / حقوق الملكية', type: 'equity' },
    { code: '301000', name: 'Retained Earnings / الأرباح المحتجزة', type: 'equity', parent_code: '300000' },
    { code: '400000', name: 'Income / الإيرادات', type: 'income' },
    { code: '401000', name: 'Sales / المبيعات', type: 'income', parent_code: '400000' },
    { code: '500000', name: 'Expenses / المصاريف', type: 'expense' },
    { code: '501000', name: 'Cost of Goods Sold / كلفة المبيعات', type: 'expense', parent_code: '500000' },
    { code: '502000', name: 'General Expenses / المصاريف العمومية', type: 'expense', parent_code: '500000' },
  ];

  const ids = {};
  for (const a of accounts) {
    const parentId = a.parent_code ? ids[a.parent_code] : null;
    const created = createAccount(dialect, ctx, { ...a, parent_id: parentId });
    ids[a.code] = created.id;
  }

  const journals = [
    { id: `jnl_${companyId}_general`, code: 'general', name: 'General Journal / يومنية عامة', type: 'general' },
    { id: `jnl_${companyId}_sales`, code: 'sales', name: 'Sales Journal / يومنية المبيعات', type: 'sale' },
    { id: `jnl_${companyId}_purchase`, code: 'purchase', name: 'Purchase Journal / يومنية المشتريات', type: 'purchase' },
    { id: `jnl_${companyId}_cash`, code: 'cash', name: 'Cash Journal / يومنية الصندوق', type: 'cash' },
    { id: `jnl_${companyId}_bank`, code: 'bank', name: 'Bank Journal / يومنية البنك', type: 'bank' },
  ];
  for (const j of journals) {
    createJournal(dialect, ctx, j);
  }

  // Seed fiscal year 2026 if not already present
  const yearId = `fy_${companyId}_2026`;
  const existingYear = dialect.prepare('SELECT id FROM finance_fiscal_years WHERE id = ?').get(yearId);
  if (!existingYear) {
    const now = ctx.now || new Date().toISOString();
    dialect.prepare(`
      INSERT INTO finance_fiscal_years (id, company_id, name, start_date, end_date, status, created_at, updated_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(yearId, companyId, '2026', '2026-01-01', '2026-12-31', 'open', now, now, ctx.userId || 'system');
    for (let m = 1; m <= 12; m++) {
      const ms = String(m).padStart(2, '0');
      const periodId = `period_${companyId}_2026_${ms}`;
      const end = new Date(2026, m, 0).toISOString().split('T')[0];
      dialect.prepare(`
        INSERT INTO finance_periods (id, company_id, fiscal_year_id, name, start_date, end_date, status, created_at, updated_at, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(periodId, companyId, yearId, `2026-${ms}`, `2026-${ms}-01`, end, 'open', now, now, ctx.userId || 'system');
    }
  }

  return { ids, journalPrefix: `jnl_${companyId}` };
}

export { ACCOUNT_TYPES, JOURNAL_TYPES, DOCUMENT_TYPES };
