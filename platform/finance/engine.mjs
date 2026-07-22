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
const DOCUMENT_TYPES = ['manual_entry', 'customer_invoice', 'customer_credit_note', 'supplier_bill', 'supplier_credit_note', 'cash_receipt', 'cash_payment', 'opening_entry', 'period_close', 'tax_adjustment', 'source_post', 'fx_revaluation'];
const TAX_AMOUNT_TYPES = ['percent', 'fixed', 'group'];
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

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
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
  if (input.source_canonical_key) {
    const dupDoc = dialect.prepare(`
      SELECT id FROM finance_documents WHERE company_id = ? AND partner_id = ? AND move_type = ? AND source_canonical_key = ? AND state != 'cancelled'
    `).get(companyId, input.partner_id || null, moveType, input.source_canonical_key);
    if (dupDoc) throw new FinanceError('duplicate source reference for this partner and document type', 'DUPLICATE_SOURCE_REFERENCE');
  }
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
    fx_revaluation: 'FX-{YYYY}-{#####}',
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
  if (!['approved'].includes(doc.state)) {
    throw new FinanceError('document must be approved to post', 'DOCUMENT_STATE_INVALID');
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
    validateDimensionDistribution(dialect, companyId, l.account_id, l.dims);
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

function transitionDocumentState(dialect, companyId, userId, now, docId, fromStates, toState) {
  const doc = getDocument(dialect, companyId, docId);
  if (!doc) throw new FinanceError('document not found', 'DOCUMENT_NOT_FOUND');
  if (!fromStates.includes(doc.state)) {
    throw new FinanceError(`document must be in ${fromStates.join('/')} state to ${toState}`, 'DOCUMENT_STATE_INVALID');
  }
  dialect.prepare('UPDATE finance_documents SET state = ?, updated_at = ?, updated_by = ? WHERE id = ? AND company_id = ?').run(toState, now, userId, docId, companyId);
  return getDocument(dialect, companyId, docId);
}

export function submitDocument(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  return transitionDocumentState(dialect, companyId, userId, now, input.document_id, ['draft'], 'submitted');
}

export function approveDocument(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  return transitionDocumentState(dialect, companyId, userId, now, input.document_id, ['submitted'], 'approved');
}

export function cancelDocument(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  return transitionDocumentState(dialect, companyId, userId, now, input.document_id, ['draft', 'submitted', 'approved'], 'cancelled');
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

  submitDocument(dialect, ctx, { document_id: reversalDoc.id });
  approveDocument(dialect, ctx, { document_id: reversalDoc.id });
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

export function validateDimensionDistribution(dialect, companyId, accountId, dimsJson) {
  const parsed = dimsJson ? (typeof dimsJson === 'string' ? JSON.parse(dimsJson) : dimsJson) : {};
  const dimSums = {};
  for (const [valId, percent] of Object.entries(parsed)) {
    const val = dialect.prepare('SELECT dimension_id FROM finance_dimension_values WHERE id = ? AND company_id = ?').get(valId, companyId);
    if (!val) throw new FinanceError(`dimension value not found: ${valId}`, 'DIMENSION_VALUE_INVALID');
    if (!dimSums[val.dimension_id]) dimSums[val.dimension_id] = 0;
    dimSums[val.dimension_id] += Number(percent) || 0;
  }
  for (const [dimId, sum] of Object.entries(dimSums)) {
    if (Math.abs(sum - 100) > 0.01) throw new FinanceError(`dimension ${dimId} distribution must sum to 100`, 'DIMENSION_SUM_INVALID');
  }
  const policies = dialect.prepare('SELECT dimension_id, policy FROM finance_account_dimension_policies WHERE account_id = ? AND company_id = ?').all(accountId, companyId);
  for (const pol of policies) {
    const has = dimSums[pol.dimension_id] !== undefined;
    if (pol.policy === 'required' && !has) throw new FinanceError(`dimension ${pol.dimension_id} is required for account ${accountId}`, 'DIMENSION_REQUIRED');
    if (pol.policy === 'blocked' && has) throw new FinanceError(`dimension ${pol.dimension_id} is blocked for account ${accountId}`, 'DIMENSION_BLOCKED');
  }
}

export function createDimension(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const code = String(input.code || '').trim();
  const name = String(input.name || '').trim();
  if (!code) throw new FinanceError('dimension code is required', 'DIMENSION_CODE_REQUIRED');
  if (!name) throw new FinanceError('dimension name is required', 'DIMENSION_NAME_REQUIRED');
  const dup = dialect.prepare('SELECT id FROM finance_dimensions WHERE company_id = ? AND code = ?').get(companyId, code);
  if (dup) throw new FinanceError('duplicate dimension code', 'DIMENSION_DUPLICATE');
  const id = input.id || `findim_${crypto.randomUUID()}`;
  dialect.prepare('INSERT INTO finance_dimensions (id, company_id, code, name, applies_to, is_active, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    id, companyId, code, name, input.applies_to || null, input.is_active !== false ? 1 : 0, now, userId
  );
  return { id, companyId, code, name };
}

export function createDimensionValue(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const dimensionId = input.dimension_id;
  const dim = dialect.prepare('SELECT id FROM finance_dimensions WHERE id = ? AND company_id = ?').get(dimensionId, companyId);
  if (!dim) throw new FinanceError('dimension not found', 'DIMENSION_NOT_FOUND');
  const code = String(input.code || '').trim();
  const name = String(input.name || '').trim();
  if (!code) throw new FinanceError('dimension value code is required', 'DIMENSION_VALUE_CODE_REQUIRED');
  if (!name) throw new FinanceError('dimension value name is required', 'DIMENSION_VALUE_NAME_REQUIRED');
  const dup = dialect.prepare('SELECT id FROM finance_dimension_values WHERE company_id = ? AND code = ?').get(companyId, code);
  if (dup) throw new FinanceError('duplicate dimension value code', 'DIMENSION_VALUE_DUPLICATE');
  const id = input.id || `findimv_${crypto.randomUUID()}`;
  dialect.prepare('INSERT INTO finance_dimension_values (id, dimension_id, company_id, code, name, is_active, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    id, dimensionId, companyId, code, name, input.is_active !== false ? 1 : 0, now, userId
  );
  return { id, companyId, dimensionId, code, name };
}

export function setAccountDimensionPolicy(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const accountId = input.account_id;
  const dimensionId = input.dimension_id;
  const policy = input.policy;
  if (!['required', 'optional', 'blocked'].includes(policy)) throw new FinanceError('policy must be required/optional/blocked', 'DIMENSION_POLICY_INVALID');
  assertCompanyMatch(dialect, 'finance_accounts', accountId, companyId);
  const dim = dialect.prepare('SELECT id FROM finance_dimensions WHERE id = ? AND company_id = ?').get(dimensionId, companyId);
  if (!dim) throw new FinanceError('dimension not found', 'DIMENSION_NOT_FOUND');
  const id = input.id || `findimpol_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_account_dimension_policies (id, company_id, account_id, dimension_id, policy, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET policy = excluded.policy, created_at = excluded.created_at, created_by = excluded.created_by
  `).run(id, companyId, accountId, dimensionId, policy, now, userId);
  return { id, accountId, dimensionId, policy };
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

// ---------------------------------------------------------------------------
// Wave C — Currency and exchange rates (Packet 03.09)
// ---------------------------------------------------------------------------

export function upsertCurrency(dialect, ctx, input) {
  const { userId, now } = context(ctx);
  const code = String(input.code || '').toUpperCase().trim();
  const name = String(input.name || '').trim();
  if (!code) throw new FinanceError('currency code is required', 'CURRENCY_CODE_REQUIRED');
  if (!name) throw new FinanceError('currency name is required', 'CURRENCY_NAME_REQUIRED');
  dialect.prepare(`
    INSERT INTO finance_currencies (code, name, name_ar, symbol, decimal_places, is_active, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET name = excluded.name, name_ar = excluded.name_ar, symbol = excluded.symbol,
      decimal_places = excluded.decimal_places, is_active = excluded.is_active
  `).run(code, name, input.name_ar || null, input.symbol || null, input.decimal_places ?? 2, input.is_active !== false ? 1 : 0, now, userId);
  return { code, name };
}

export function upsertExchangeRate(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const from = String(input.from_currency || '').toUpperCase();
  const to = String(input.to_currency || '').toUpperCase();
  const date = input.rate_date;
  const rateType = input.rate_type || 'spot';
  const rate = Number(input.rate);
  if (!from || !to) throw new FinanceError('from_currency and to_currency are required', 'CURRENCY_REQUIRED');
  if (!date) throw new FinanceError('rate_date is required', 'RATE_DATE_REQUIRED');
  if (!(rate > 0)) throw new FinanceError('rate must be positive', 'RATE_INVALID');
  if (!dialect.prepare('SELECT code FROM finance_currencies WHERE code = ?').get(from)) throw new FinanceError(`currency not found: ${from}`, 'CURRENCY_NOT_FOUND');
  if (!dialect.prepare('SELECT code FROM finance_currencies WHERE code = ?').get(to)) throw new FinanceError(`currency not found: ${to}`, 'CURRENCY_NOT_FOUND');
  const id = input.id || `finfx_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_exchange_rates (id, company_id, from_currency, to_currency, rate_date, rate, rate_type, source, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_id, from_currency, to_currency, rate_date, rate_type)
    DO UPDATE SET rate = excluded.rate, source = excluded.source, created_at = excluded.created_at, created_by = excluded.created_by
  `).run(id, companyId, from, to, date, rate, rateType, input.source || 'manual', now, userId);
  return { companyId, from_currency: from, to_currency: to, rate_date: date, rate, rate_type: rateType };
}

export function getExchangeRate(dialect, companyId, fromCurrency, toCurrency, date, rateType = 'spot') {
  if (fromCurrency === toCurrency) return 1;
  const row = dialect.prepare(`
    SELECT rate FROM finance_exchange_rates
    WHERE company_id = ? AND from_currency = ? AND to_currency = ? AND rate_type = ? AND rate_date <= ?
    ORDER BY rate_date DESC LIMIT 1
  `).get(companyId, fromCurrency, toCurrency, rateType, date);
  if (row) return Number(row.rate);
  const inv = dialect.prepare(`
    SELECT rate FROM finance_exchange_rates
    WHERE company_id = ? AND from_currency = ? AND to_currency = ? AND rate_type = ? AND rate_date <= ?
    ORDER BY rate_date DESC LIMIT 1
  `).get(companyId, toCurrency, fromCurrency, rateType, date);
  if (inv && Number(inv.rate) > 0) return 1 / Number(inv.rate);
  throw new FinanceError(`no exchange rate found for ${fromCurrency}->${toCurrency} on/before ${date}`, 'MISSING_RATE');
}

export function convertAmount(dialect, companyId, amount, fromCurrency, toCurrency, date, rateType = 'spot') {
  const rate = getExchangeRate(dialect, companyId, fromCurrency, toCurrency, date, rateType);
  return round2(Number(amount) * rate);
}

// Pure helper: computes realized FX gain/loss when a foreign-currency open item is
// settled at a different rate than it was booked. Wave D's payment engine calls
// this at allocation time; it performs no I/O so it is safe to unit test in isolation.
export function computeRealizedFx({ settledForeignAmount, originalRate, settlementRate }) {
  const bookedLocal = round2(Number(settledForeignAmount) * Number(originalRate));
  const settledLocal = round2(Number(settledForeignAmount) * Number(settlementRate));
  const delta = round2(settledLocal - bookedLocal);
  return { bookedLocal, settledLocal, delta, direction: delta > 0 ? 'gain' : delta < 0 ? 'loss' : 'none' };
}

export function revalueForeignBalances(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const asOfDate = input.as_of_date;
  if (!asOfDate) throw new FinanceError('as_of_date is required', 'REVALUATION_DATE_REQUIRED');
  const accountIds = Array.isArray(input.account_ids) ? input.account_ids : [];
  if (!accountIds.length) throw new FinanceError('account_ids is required', 'REVALUATION_ACCOUNTS_REQUIRED');
  assertCompanyMatch(dialect, 'finance_accounts', input.gain_account_id, companyId);
  assertCompanyMatch(dialect, 'finance_accounts', input.loss_account_id, companyId);

  const deltas = [];
  let totalGain = 0;
  let totalLoss = 0;
  for (const accountId of accountIds) {
    assertCompanyMatch(dialect, 'finance_accounts', accountId, companyId);
    const balances = dialect.prepare(`
      SELECT currency_code,
             SUM(currency_debit - currency_credit) AS foreign_balance,
             SUM(debit - credit) AS local_balance
      FROM finance_journal_lines
      WHERE company_id = ? AND account_id = ? AND posting_date <= ? AND currency_code IS NOT NULL AND currency_code != 'IQD'
      GROUP BY currency_code
      HAVING ABS(SUM(currency_debit - currency_credit)) > 0.0001
    `).all(companyId, accountId, asOfDate);

    for (const bal of balances) {
      const currentRate = getExchangeRate(dialect, companyId, bal.currency_code, 'IQD', asOfDate);
      const revaluedLocal = round2(Number(bal.foreign_balance) * currentRate);
      const delta = round2(revaluedLocal - Number(bal.local_balance));
      if (Math.abs(delta) < 0.005) continue;
      deltas.push({ account_id: accountId, delta, currency_code: bal.currency_code });
      if (delta > 0) totalGain += delta; else totalLoss += -delta;
    }
  }

  if (!deltas.length) {
    return { document: null, run: { totalGain: 0, totalLoss: 0, lines: [] } };
  }

  const docLines = deltas.map(d => d.delta > 0
    ? { account_id: d.account_id, debit: d.delta, credit: 0, description: `FX revaluation gain ${d.currency_code}` }
    : { account_id: d.account_id, debit: 0, credit: -d.delta, description: `FX revaluation loss ${d.currency_code}` });
  if (totalGain > 0) docLines.push({ account_id: input.gain_account_id, debit: 0, credit: round2(totalGain), description: 'Unrealized FX gain' });
  if (totalLoss > 0) docLines.push({ account_id: input.loss_account_id, debit: round2(totalLoss), credit: 0, description: 'Unrealized FX loss' });

  const doc = createDocument(dialect, ctx, { move_type: 'fx_revaluation', doc_date: asOfDate, lines: docLines });
  submitDocument(dialect, ctx, { document_id: doc.id });
  approveDocument(dialect, ctx, { document_id: doc.id });
  const posted = postDocument(dialect, ctx, { document_id: doc.id });

  const runId = `finfxrun_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_fx_revaluation_runs (id, company_id, as_of_date, document_id, gain_account_id, loss_account_id, total_gain, total_loss, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(runId, companyId, asOfDate, posted.id, input.gain_account_id, input.loss_account_id, round2(totalGain), round2(totalLoss), now, userId);

  return { document: posted, run: { id: runId, totalGain: round2(totalGain), totalLoss: round2(totalLoss), lines: deltas } };
}

// ---------------------------------------------------------------------------
// Wave C — Tax definition and calculation (Packet 03.10)
// ---------------------------------------------------------------------------

export function createTax(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const code = String(input.code || '').trim();
  const name = String(input.name || '').trim();
  if (!code) throw new FinanceError('tax code is required', 'TAX_CODE_REQUIRED');
  if (!name) throw new FinanceError('tax name is required', 'TAX_NAME_REQUIRED');
  const amountType = input.amount_type;
  if (!TAX_AMOUNT_TYPES.includes(amountType)) throw new FinanceError('invalid tax amount_type', 'TAX_TYPE_INVALID');
  const dup = dialect.prepare('SELECT id FROM finance_taxes WHERE company_id = ? AND code = ?').get(companyId, code);
  if (dup) throw new FinanceError('duplicate tax code', 'TAX_DUPLICATE');
  const id = input.id || `fintax_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_taxes (
      id, company_id, code, name, name_ar, amount_type, amount, price_include, is_withholding,
      is_reverse_charge, is_recoverable, rounding, version, is_active, created_at, updated_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, companyId, code, name, input.name_ar || name, amountType, Number(input.amount || 0),
    input.price_include ? 1 : 0, input.is_withholding ? 1 : 0, input.is_reverse_charge ? 1 : 0,
    input.is_recoverable !== false ? 1 : 0, input.rounding || 'line', 1,
    input.is_active !== false ? 1 : 0, now, now, userId
  );
  if (amountType === 'group' && Array.isArray(input.children)) {
    const insMember = dialect.prepare('INSERT INTO finance_tax_group_members (id, group_tax_id, child_tax_id, sequence, created_at) VALUES (?, ?, ?, ?, ?)');
    input.children.forEach((childId, idx) => insMember.run(`fintaxgm_${crypto.randomUUID()}`, id, childId, idx, now));
  }
  return { id, companyId, code, name, amount_type: amountType };
}

export function setTaxRepartitionLines(dialect, ctx, input) {
  const { companyId, now } = context(ctx);
  const taxId = input.tax_id;
  const tax = dialect.prepare('SELECT id FROM finance_taxes WHERE id = ? AND company_id = ?').get(taxId, companyId);
  if (!tax) throw new FinanceError('tax not found', 'TAX_NOT_FOUND');
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (!lines.length) throw new FinanceError('at least one repartition line is required', 'TAX_REPARTITION_EMPTY');
  dialect.prepare('DELETE FROM finance_tax_repartition_lines WHERE tax_id = ?').run(taxId);
  const ins = dialect.prepare('INSERT INTO finance_tax_repartition_lines (id, tax_id, repartition_type, factor_percent, account_id, tag_ids, sign, sequence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  lines.forEach((l, idx) => {
    if (!['base', 'tax'].includes(l.repartition_type)) throw new FinanceError('invalid repartition_type', 'TAX_REPARTITION_TYPE_INVALID');
    ins.run(`fintaxrl_${crypto.randomUUID()}`, taxId, l.repartition_type, Number(l.factor_percent ?? 100), l.account_id || null, l.tag_ids ? JSON.stringify(l.tag_ids) : null, l.sign ?? 1, l.sequence ?? idx, now);
  });
  return { tax_id: taxId, lines: lines.length };
}

export function computeTax(dialect, ctx, input) {
  const { companyId } = context(ctx);
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (!lines.length) throw new FinanceError('at least one line is required for tax computation', 'TAX_QUOTE_EMPTY');

  const fiscalTaxMap = {};
  const fiscalAccountMap = {};
  if (input.fiscal_position_id) {
    const fp = dialect.prepare('SELECT id FROM finance_fiscal_positions WHERE id = ? AND company_id = ?').get(input.fiscal_position_id, companyId);
    if (!fp) throw new FinanceError('fiscal position not found', 'FISCAL_POSITION_NOT_FOUND');
    for (const r of dialect.prepare('SELECT tax_src_id, tax_dest_id FROM finance_fiscal_position_tax_map WHERE fiscal_position_id = ?').all(input.fiscal_position_id)) {
      fiscalTaxMap[r.tax_src_id] = r.tax_dest_id;
    }
    for (const r of dialect.prepare('SELECT account_src_id, account_dest_id FROM finance_fiscal_position_account_map WHERE fiscal_position_id = ?').all(input.fiscal_position_id)) {
      fiscalAccountMap[r.account_src_id] = r.account_dest_id;
    }
  }

  const computedLines = [];
  let totalBase = 0;
  let totalTax = 0;

  for (const line of lines) {
    const resolvedAccountId = fiscalAccountMap[line.account_id] || line.account_id;
    let taxId = line.tax_id || null;
    if (input.fiscal_position_id && taxId && Object.prototype.hasOwnProperty.call(fiscalTaxMap, taxId)) {
      taxId = fiscalTaxMap[taxId]; // may resolve to null = exempt via fiscal position
    }
    const priceUnit = Number(line.price_unit || 0);
    const quantity = Number(line.quantity == null ? 1 : line.quantity);
    const gross = round2(priceUnit * quantity);

    if (!taxId) {
      totalBase += gross;
      computedLines.push({ account_id: resolvedAccountId, base_amount: gross, tax_amount: 0, repartition_type: 'base', factor_percent: 100, description: line.description || null });
      continue;
    }

    const tax = dialect.prepare('SELECT * FROM finance_taxes WHERE id = ?').get(taxId);
    if (!tax || !tax.is_active) throw new FinanceError(`tax not found or inactive: ${taxId}`, 'TAX_NOT_FOUND');

    const childTaxes = tax.amount_type === 'group'
      ? dialect.prepare(`SELECT t.* FROM finance_tax_group_members m JOIN finance_taxes t ON t.id = m.child_tax_id WHERE m.group_tax_id = ? ORDER BY m.sequence`).all(taxId)
      : [tax];

    let compoundBase = gross;
    let lineTaxTotal = 0;
    let finalBase = gross;
    for (const childTax of childTaxes) {
      let taxAmount = 0;
      let childBase = compoundBase;
      if (childTax.price_include) {
        if (childTax.amount_type === 'percent') {
          const newBase = round2(childBase / (1 + Number(childTax.amount) / 100));
          taxAmount = round2(childBase - newBase);
          childBase = newBase;
        } else if (childTax.amount_type === 'fixed') {
          taxAmount = round2(Number(childTax.amount) * quantity);
          childBase = round2(childBase - taxAmount);
        }
      } else if (childTax.amount_type === 'percent') {
        taxAmount = round2(childBase * (Number(childTax.amount) / 100));
      } else if (childTax.amount_type === 'fixed') {
        taxAmount = round2(Number(childTax.amount) * quantity);
      }
      lineTaxTotal += taxAmount;
      finalBase = childBase;
      compoundBase = round2(compoundBase + taxAmount); // compound: subsequent taxes apply on top

      const repartitions = dialect.prepare('SELECT * FROM finance_tax_repartition_lines WHERE tax_id = ? ORDER BY sequence').all(childTax.id);
      if (!repartitions.length) {
        computedLines.push({ account_id: resolvedAccountId, base_amount: childBase, tax_amount: taxAmount, repartition_type: 'tax', factor_percent: 100, tax_id: childTax.id, description: line.description || null });
      } else {
        for (const rep of repartitions) {
          const factor = Number(rep.factor_percent || 100);
          const repAccount = rep.account_id || resolvedAccountId;
          const amount = round2((rep.repartition_type === 'base' ? childBase : taxAmount) * (factor / 100));
          computedLines.push({
            account_id: repAccount, base_amount: rep.repartition_type === 'base' ? amount : 0,
            tax_amount: rep.repartition_type === 'tax' ? amount : 0, repartition_type: rep.repartition_type,
            factor_percent: factor, tag_ids: rep.tag_ids ? JSON.parse(rep.tag_ids) : null, sign: rep.sign,
            tax_id: childTax.id, description: line.description || null,
          });
        }
      }
    }
    totalBase += finalBase;
    totalTax += lineTaxTotal;
  }

  return { total_base: round2(totalBase), total_tax: round2(totalTax), total_amount: round2(totalBase + totalTax), lines: computedLines };
}

export function createWithholdingCategory(dialect, ctx, input) {
  const { companyId, now } = context(ctx);
  const code = String(input.code || '').trim();
  const name = String(input.name || '').trim();
  if (!code) throw new FinanceError('withholding category code is required', 'WITHHOLDING_CODE_REQUIRED');
  if (!name) throw new FinanceError('withholding category name is required', 'WITHHOLDING_NAME_REQUIRED');
  const id = input.id || `finwhc_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_withholding_categories (id, company_id, code, name, rate, threshold, cumulative_threshold, cumulative_window, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, companyId, code, name, Number(input.rate || 0), Number(input.threshold || 0), Number(input.cumulative_threshold || 0), input.cumulative_window || 'none', now);
  return { id, companyId, code, name };
}

export function evaluateWithholding(dialect, ctx, input) {
  const { companyId, now } = context(ctx);
  const partnerId = input.partner_id;
  const amount = Number(input.amount);
  const docDate = input.doc_date;
  if (!partnerId) throw new FinanceError('partner_id is required', 'WITHHOLDING_PARTNER_REQUIRED');
  if (!(amount > 0)) throw new FinanceError('amount must be positive', 'WITHHOLDING_AMOUNT_INVALID');
  const categories = dialect.prepare('SELECT * FROM finance_withholding_categories WHERE company_id = ?').all(companyId);

  for (const cat of categories) {
    let triggered = cat.threshold > 0 && amount >= cat.threshold;
    if (!triggered && cat.cumulative_threshold > 0 && cat.cumulative_window !== 'none') {
      const d = new Date(docDate);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const [startDate, endDate] = cat.cumulative_window === 'monthly'
        ? [`${year}-${month}-01`, `${year}-${month}-31`]
        : [`${year}-01-01`, `${year}-12-31`];
      const prev = dialect.prepare(`
        SELECT COALESCE(SUM(base_amount), 0) AS total FROM finance_withholding_certificates
        WHERE company_id = ? AND partner_id = ? AND withholding_category_id = ? AND doc_date >= ? AND doc_date <= ?
      `).get(companyId, partnerId, cat.id, startDate, endDate);
      if (Number(prev.total) + amount >= cat.cumulative_threshold) triggered = true;
    }
    const taxAmount = triggered ? round2(amount * (Number(cat.rate) / 100)) : 0;
    const certId = `finwhcert_${crypto.randomUUID()}`;
    dialect.prepare(`
      INSERT INTO finance_withholding_certificates (id, company_id, partner_id, withholding_category_id, base_amount, tax_amount, doc_date, reference_document_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(certId, companyId, partnerId, cat.id, amount, taxAmount, docDate, input.document_id || null, now);
    if (triggered) {
      return { certificate_id: certId, category_id: cat.id, category_name: cat.name, rate: cat.rate, withhold_amount: taxAmount };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Wave C — Fiscal positions and Iraq localization pack (Packet 03.11)
// ---------------------------------------------------------------------------

export function createFiscalPosition(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const code = String(input.code || '').trim();
  const name = String(input.name || '').trim();
  if (!code) throw new FinanceError('fiscal position code is required', 'FISCAL_POSITION_CODE_REQUIRED');
  if (!name) throw new FinanceError('fiscal position name is required', 'FISCAL_POSITION_NAME_REQUIRED');
  const dup = dialect.prepare('SELECT id FROM finance_fiscal_positions WHERE company_id = ? AND code = ?').get(companyId, code);
  if (dup) throw new FinanceError('duplicate fiscal position code', 'FISCAL_POSITION_DUPLICATE');
  const id = input.id || `finfp_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_fiscal_positions (id, company_id, code, name, name_ar, criteria, exemption_reason, allow_manual_override, is_active, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, companyId, code, name, input.name_ar || name, input.criteria ? JSON.stringify(input.criteria) : null, input.exemption_reason || null, input.allow_manual_override !== false ? 1 : 0, input.is_active !== false ? 1 : 0, now, userId);
  return { id, companyId, code, name };
}

export function mapFiscalPositionTax(dialect, ctx, input) {
  const { companyId, now } = context(ctx);
  const fp = dialect.prepare('SELECT id FROM finance_fiscal_positions WHERE id = ? AND company_id = ?').get(input.fiscal_position_id, companyId);
  if (!fp) throw new FinanceError('fiscal position not found', 'FISCAL_POSITION_NOT_FOUND');
  const id = input.id || `finfptm_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_fiscal_position_tax_map (id, fiscal_position_id, tax_src_id, tax_dest_id, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(fiscal_position_id, tax_src_id) DO UPDATE SET tax_dest_id = excluded.tax_dest_id
  `).run(id, input.fiscal_position_id, input.tax_src_id, input.tax_dest_id || null, now);
  return { fiscal_position_id: input.fiscal_position_id, tax_src_id: input.tax_src_id, tax_dest_id: input.tax_dest_id || null };
}

export function mapFiscalPositionAccount(dialect, ctx, input) {
  const { companyId, now } = context(ctx);
  const fp = dialect.prepare('SELECT id FROM finance_fiscal_positions WHERE id = ? AND company_id = ?').get(input.fiscal_position_id, companyId);
  if (!fp) throw new FinanceError('fiscal position not found', 'FISCAL_POSITION_NOT_FOUND');
  assertCompanyMatch(dialect, 'finance_accounts', input.account_src_id, companyId);
  assertCompanyMatch(dialect, 'finance_accounts', input.account_dest_id, companyId);
  const id = input.id || `finfpam_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_fiscal_position_account_map (id, fiscal_position_id, account_src_id, account_dest_id, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(fiscal_position_id, account_src_id) DO UPDATE SET account_dest_id = excluded.account_dest_id
  `).run(id, input.fiscal_position_id, input.account_src_id, input.account_dest_id, now);
  return { fiscal_position_id: input.fiscal_position_id, account_src_id: input.account_src_id, account_dest_id: input.account_dest_id };
}

// Idempotent installer: safe to call repeatedly (install then upgrade). All rates,
// forms, and statutory interpretations here are placeholders pending accountant/
// legal validation (legal_validation_status stays 'pending' until reviewed) —
// see the legal safety rule in docs/evidence/phase-03/donor-license-ledger.md.
export function installLocalizationPack(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const packCode = input.pack_code || 'iraq';
  const version = input.version || '1.0.0';
  const existing = dialect.prepare('SELECT * FROM finance_localization_packs WHERE company_id = ? AND pack_code = ?').get(companyId, packCode);

  if (packCode === 'iraq') {
    let salesTax = dialect.prepare('SELECT id FROM finance_taxes WHERE company_id = ? AND code = ?').get(companyId, 'IQ_SALES_15');
    if (!salesTax) {
      salesTax = createTax(dialect, ctx, { code: 'IQ_SALES_15', name: 'Iraq General Sales Tax (placeholder)', name_ar: 'ضريبة المبيعات العامة العراقية (مؤقتة)', amount_type: 'percent', amount: 15, price_include: false });
    }
    const positions = [
      { code: 'IQ_DOMESTIC', name: 'Domestic', name_ar: 'محلي' },
      { code: 'IQ_EXPORT', name: 'Export', name_ar: 'تصدير', exemption_reason: 'export' },
      { code: 'IQ_EXEMPT', name: 'Exempt', name_ar: 'معفى', exemption_reason: 'statutory exemption' },
    ];
    for (const p of positions) {
      let fp = dialect.prepare('SELECT id FROM finance_fiscal_positions WHERE company_id = ? AND code = ?').get(companyId, p.code);
      if (!fp) fp = createFiscalPosition(dialect, ctx, p);
      if (p.code !== 'IQ_DOMESTIC') {
        mapFiscalPositionTax(dialect, ctx, { fiscal_position_id: fp.id, tax_src_id: salesTax.id, tax_dest_id: null });
      }
    }
  }

  const id = existing ? existing.id : `finlocpack_${crypto.randomUUID()}`;
  const status = existing ? 'upgraded' : 'installed';
  dialect.prepare(`
    INSERT INTO finance_localization_packs (id, company_id, pack_code, version, status, installed_at, installed_by, legal_validation_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    ON CONFLICT(company_id, pack_code) DO UPDATE SET version = excluded.version, status = 'upgraded', installed_at = excluded.installed_at, installed_by = excluded.installed_by
  `).run(id, companyId, packCode, version, status, now, userId);

  return { id, companyId, pack_code: packCode, version, status, legal_validation_status: 'pending' };
}

// ---------------------------------------------------------------------------
// Wave C — Accounting dimensions report (Packet 03.12 completion)
// ---------------------------------------------------------------------------

export function getDimensionBreakdown(dialect, ctx, input = {}) {
  const { companyId } = context(ctx);
  const dimensionId = input.dimension_id || null;
  const startDate = input.start_date || null;
  const endDate = input.end_date || null;
  const rows = dialect.prepare(`
    SELECT l.debit, l.credit, l.dims
    FROM finance_journal_lines l
    WHERE l.company_id = ? AND l.dims IS NOT NULL
      AND (? IS NULL OR l.posting_date >= ?) AND (? IS NULL OR l.posting_date <= ?)
  `).all(companyId, startDate, startDate, endDate, endDate);

  const totals = {};
  for (const row of rows) {
    let parsed;
    try { parsed = JSON.parse(row.dims); } catch { continue; }
    for (const [valId, percent] of Object.entries(parsed)) {
      const val = dialect.prepare('SELECT dimension_id, code, name FROM finance_dimension_values WHERE id = ?').get(valId);
      if (!val || (dimensionId && val.dimension_id !== dimensionId)) continue;
      const share = Number(percent) / 100;
      const net = (Number(row.debit) - Number(row.credit)) * share;
      totals[valId] = totals[valId] || { dimension_value_id: valId, code: val.code, name: val.name, net: 0 };
      totals[valId].net += net;
    }
  }
  return Object.values(totals).map(t => ({ ...t, net: round2(t.net) }));
}

// ---------------------------------------------------------------------------
// Wave C — Accounts receivable subledger (Packet 03.13)
// ---------------------------------------------------------------------------

export function setDueSchedule(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const docId = input.document_id;
  const doc = getDocument(dialect, companyId, docId);
  if (!doc) throw new FinanceError('document not found', 'DOCUMENT_NOT_FOUND');
  if (doc.state !== 'draft') throw new FinanceError('due schedule can only be set before posting', 'DUE_SCHEDULE_LOCKED');
  const schedule = Array.isArray(input.schedule) ? input.schedule : [];
  if (!schedule.length) throw new FinanceError('schedule must have at least one entry', 'DUE_SCHEDULE_EMPTY');
  const totalDebit = doc.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const scheduleTotal = round2(schedule.reduce((s, e) => s + Number(e.amount || 0), 0));
  if (Math.abs(scheduleTotal - round2(totalDebit)) > 0.01) {
    throw new FinanceError('due schedule total must equal document total', 'DUE_SCHEDULE_MISMATCH');
  }
  dialect.prepare('DELETE FROM finance_due_schedules WHERE document_id = ?').run(docId);
  const ins = dialect.prepare(`
    INSERT INTO finance_due_schedules (id, company_id, document_id, partner_id, sequence, due_date, amount, currency, note, created_at, updated_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  schedule.forEach((entry, idx) => {
    ins.run(`findue_${crypto.randomUUID()}`, companyId, docId, doc.partner_id, idx + 1, entry.due_date, Number(entry.amount), doc.currency, entry.note || null, now, now, userId);
  });
  return { document_id: docId, schedule_count: schedule.length };
}

function creditNotesTotal(dialect, companyId, invoiceId) {
  const row = dialect.prepare(`
    SELECT COALESCE(SUM(d2.doc_total), 0) AS total FROM (
      SELECT d.id, SUM(l.debit) AS doc_total
      FROM finance_documents d JOIN finance_journal_lines l ON l.document_id = d.id
      WHERE d.company_id = ? AND d.source_type = 'credit_note_of' AND d.source_id = ? AND d.state = 'posted'
      GROUP BY d.id
    ) d2
  `).get(companyId, invoiceId);
  return round2(Number(row.total) || 0);
}

function openItemsFor(dialect, companyId, moveTypes, partnerId) {
  const params = [companyId, ...moveTypes];
  let sql = `
    SELECT d.id, d.doc_number, d.doc_date, d.partner_id, d.currency, d.move_type,
           (SELECT SUM(l.debit) FROM finance_journal_lines l WHERE l.document_id = d.id) AS total_debit,
           (SELECT SUM(l.credit) FROM finance_journal_lines l WHERE l.document_id = d.id) AS total_credit
    FROM finance_documents d
    WHERE d.company_id = ? AND d.state = 'posted' AND d.move_type IN (${moveTypes.map(() => '?').join(',')})
  `;
  if (partnerId) { sql += ' AND d.partner_id = ?'; params.push(partnerId); }
  const docs = dialect.prepare(sql).all(...params);
  return docs.map(d => {
    const total = round2(Math.max(Number(d.total_debit) || 0, Number(d.total_credit) || 0));
    const credits = creditNotesTotal(dialect, companyId, d.id);
    const schedule = dialect.prepare('SELECT due_date, amount FROM finance_due_schedules WHERE document_id = ? ORDER BY sequence').all(d.id);
    const open = round2(total - credits);
    return {
      document_id: d.id, doc_number: d.doc_number, doc_date: d.doc_date, partner_id: d.partner_id,
      currency: d.currency, total, credit_notes: credits, open_amount: open,
      due_date: schedule[0]?.due_date || d.doc_date, schedule,
    };
  }).filter(item => item.open_amount > 0.005);
}

export function getCustomerOpenItems(dialect, ctx, input = {}) {
  const { companyId } = context(ctx);
  return openItemsFor(dialect, companyId, ['customer_invoice'], input.partner_id);
}

function agingFor(items, asOfDate) {
  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  const asOf = new Date(asOfDate);
  for (const item of items) {
    const due = new Date(item.due_date);
    const daysOverdue = Math.floor((asOf - due) / 86400000);
    if (daysOverdue <= 0) buckets.current += item.open_amount;
    else if (daysOverdue <= 30) buckets.d1_30 += item.open_amount;
    else if (daysOverdue <= 60) buckets.d31_60 += item.open_amount;
    else if (daysOverdue <= 90) buckets.d61_90 += item.open_amount;
    else buckets.d90_plus += item.open_amount;
  }
  for (const k of Object.keys(buckets)) buckets[k] = round2(buckets[k]);
  buckets.total = round2(Object.values(buckets).reduce((s, v) => s + v, 0));
  return buckets;
}

export function getCustomerAging(dialect, ctx, input = {}) {
  const items = getCustomerOpenItems(dialect, ctx, input);
  return agingFor(items, input.as_of_date || new Date().toISOString().slice(0, 10));
}

export function getPartnerStatement(dialect, ctx, input) {
  const { companyId } = context(ctx);
  const startDate = input.start_date || null;
  const endDate = input.end_date || null;
  const rows = dialect.prepare(`
    SELECT d.id, d.doc_number, d.doc_date, d.move_type, d.currency, SUM(l.debit) AS total_debit, SUM(l.credit) AS total_credit
    FROM finance_documents d JOIN finance_journal_lines l ON l.document_id = d.id
    WHERE d.company_id = ? AND d.partner_id = ? AND d.state = 'posted'
      AND (? IS NULL OR d.doc_date >= ?) AND (? IS NULL OR d.doc_date <= ?)
    GROUP BY d.id
    ORDER BY d.doc_date, d.id
  `).all(companyId, input.partner_id, startDate, startDate, endDate, endDate);
  let running = 0;
  return rows.map(r => {
    const net = round2(Number(r.total_debit) || 0);
    running = round2(running + net);
    return { document_id: r.id, doc_number: r.doc_number, doc_date: r.doc_date, move_type: r.move_type, amount: net, running_balance: running };
  });
}

export function createCreditNote(dialect, ctx, input) {
  const { companyId } = context(ctx);
  const original = getDocument(dialect, companyId, input.original_document_id);
  if (!original) throw new FinanceError('original document not found', 'DOCUMENT_NOT_FOUND');
  if (original.state !== 'posted') throw new FinanceError('credit note requires a posted original document', 'DOCUMENT_NOT_POSTED');
  let moveType;
  if (original.move_type === 'customer_invoice') moveType = 'customer_credit_note';
  else if (original.move_type === 'supplier_bill') moveType = 'supplier_credit_note';
  else throw new FinanceError('credit notes only apply to invoices and bills', 'CREDIT_NOTE_INVALID_SOURCE');
  return createDocument(dialect, ctx, {
    move_type: moveType,
    doc_date: input.doc_date || original.doc_date,
    journal_id: original.journal_id,
    partner_id: original.partner_id,
    currency: original.currency,
    source_type: 'credit_note_of',
    source_id: original.id,
    lines: input.lines,
  });
}

// ---------------------------------------------------------------------------
// Wave C — Accounts payable subledger (Packet 03.14)
// ---------------------------------------------------------------------------

export function getSupplierOpenItems(dialect, ctx, input = {}) {
  const { companyId } = context(ctx);
  return openItemsFor(dialect, companyId, ['supplier_bill'], input.partner_id);
}

export function getSupplierAging(dialect, ctx, input = {}) {
  const items = getSupplierOpenItems(dialect, ctx, input);
  return agingFor(items, input.as_of_date || new Date().toISOString().slice(0, 10));
}

export function holdPayment(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  assertCompanyMatch(dialect, 'finance_documents', input.document_id, companyId);
  const reason = String(input.reason || '').trim();
  if (!reason) throw new FinanceError('hold reason is required', 'HOLD_REASON_REQUIRED');
  const id = `finhold_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_payment_holds (id, company_id, document_id, reason, held_by, held_at, status)
    VALUES (?, ?, ?, ?, ?, ?, 'held')
  `).run(id, companyId, input.document_id, reason, userId, now);
  return { id, document_id: input.document_id, status: 'held' };
}

export function releasePaymentHold(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const hold = dialect.prepare('SELECT * FROM finance_payment_holds WHERE id = ? AND company_id = ?').get(input.hold_id, companyId);
  if (!hold) throw new FinanceError('hold not found', 'HOLD_NOT_FOUND');
  if (hold.status !== 'held') throw new FinanceError('hold already released', 'HOLD_ALREADY_RELEASED');
  dialect.prepare('UPDATE finance_payment_holds SET status = ?, released_by = ?, released_at = ? WHERE id = ?').run('released', userId, now, input.hold_id);
  return { id: input.hold_id, status: 'released' };
}

export function isDocumentOnHold(dialect, companyId, documentId) {
  return !!dialect.prepare("SELECT 1 FROM finance_payment_holds WHERE company_id = ? AND document_id = ? AND status = 'held' LIMIT 1").get(companyId, documentId);
}

export function setApprovalAuthorityLimit(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const roleOrUser = String(input.role_or_user || '').trim();
  const limitType = input.limit_type;
  if (!roleOrUser) throw new FinanceError('role_or_user is required', 'AUTHORITY_ROLE_REQUIRED');
  if (!['post', 'payment'].includes(limitType)) throw new FinanceError('limit_type must be post or payment', 'AUTHORITY_LIMIT_TYPE_INVALID');
  const maxAmount = Number(input.max_amount);
  if (!(maxAmount >= 0)) throw new FinanceError('max_amount must be non-negative', 'AUTHORITY_LIMIT_INVALID');
  const id = input.id || `finauth_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_approval_authority_limits (id, company_id, role_or_user, limit_type, max_amount, currency, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_id, role_or_user, limit_type) DO UPDATE SET max_amount = excluded.max_amount, currency = excluded.currency
  `).run(id, companyId, roleOrUser, limitType, maxAmount, input.currency || 'IQD', now, userId);
  return { companyId, role_or_user: roleOrUser, limit_type: limitType, max_amount: maxAmount };
}

export function checkApprovalAuthority(dialect, ctx, input) {
  const { companyId } = context(ctx);
  const limit = dialect.prepare(`
    SELECT max_amount FROM finance_approval_authority_limits WHERE company_id = ? AND role_or_user = ? AND limit_type = ?
  `).get(companyId, input.role_or_user, input.limit_type);
  if (!limit) return { allowed: true, limit: null };
  const allowed = Number(input.amount) <= Number(limit.max_amount) + 0.0001;
  if (!allowed) throw new FinanceError(`amount exceeds ${input.limit_type} authority limit for ${input.role_or_user}`, 'AUTHORITY_LIMIT_EXCEEDED');
  return { allowed: true, limit: limit.max_amount };
}

export { ACCOUNT_TYPES, JOURNAL_TYPES, DOCUMENT_TYPES };
