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
const DOCUMENT_TYPES = ['manual_entry', 'customer_invoice', 'customer_credit_note', 'supplier_bill', 'supplier_credit_note', 'cash_receipt', 'cash_payment', 'opening_entry', 'period_close', 'tax_adjustment', 'source_post', 'fx_revaluation', 'internal_transfer', 'write_off'];
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
    internal_transfer: 'XFER-{YYYY}-{#####}',
    write_off: 'WO-{YYYY}-{#####}',
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
  // Sums every posted document that offsets this invoice/bill without a payment:
  // credit/debit notes (Wave C) and write-offs (Wave D, Packet 03.16). Both are
  // structured the same way (debit the offsetting account, credit the control
  // account for AR / the mirror for AP), so SUM(debit) is the correct offset
  // amount for either kind.
  const row = dialect.prepare(`
    SELECT COALESCE(SUM(d2.doc_total), 0) AS total FROM (
      SELECT d.id, SUM(l.debit) AS doc_total
      FROM finance_documents d JOIN finance_journal_lines l ON l.document_id = d.id
      WHERE d.company_id = ? AND d.source_type IN ('credit_note_of', 'write_off_of') AND d.source_id = ? AND d.state = 'posted'
      GROUP BY d.id
    ) d2
  `).get(companyId, invoiceId);
  return round2(Number(row.total) || 0);
}

function paymentAllocationsTotal(dialect, documentId) {
  // finance_payment_allocations is created in Wave D (migration 023); guard so
  // Wave C code paths keep working stand-alone (e.g. isolated migration tests).
  const hasTable = dialect.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'finance_payment_allocations'").get();
  if (!hasTable) return 0;
  const row = dialect.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM finance_payment_allocations WHERE document_id = ?').get(documentId);
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
    const allocated = paymentAllocationsTotal(dialect, d.id);
    const schedule = dialect.prepare('SELECT due_date, amount FROM finance_due_schedules WHERE document_id = ? ORDER BY sequence').all(d.id);
    const open = round2(total - credits - allocated);
    return {
      document_id: d.id, doc_number: d.doc_number, doc_date: d.doc_date, partner_id: d.partner_id,
      currency: d.currency, total, credit_notes: credits, allocated_amount: allocated, open_amount: open,
      due_date: schedule[0]?.due_date || d.doc_date, schedule,
    };
  }).filter(item => item.open_amount > 0.005);
}

export function getOpenAmountForDocument(dialect, ctx, documentId) {
  const { companyId } = context(ctx);
  const doc = getDocument(dialect, companyId, documentId);
  if (!doc) throw new FinanceError('document not found', 'DOCUMENT_NOT_FOUND');
  const isCustomer = doc.move_type === 'customer_invoice';
  const isSupplier = doc.move_type === 'supplier_bill';
  if (!isCustomer && !isSupplier) throw new FinanceError('document is not an AR/AP open item', 'DOCUMENT_NOT_OPEN_ITEM');
  const items = isCustomer ? getCustomerOpenItems(dialect, ctx, {}) : getSupplierOpenItems(dialect, ctx, {});
  const match = items.find(i => i.document_id === documentId);
  return match ? match.open_amount : 0;
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

// ---------------------------------------------------------------------------
// Wave D — Payment documents and methods (Packet 03.15)
// ---------------------------------------------------------------------------

export function createPayment(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const key = String(input.idempotency_key || '').trim();
  if (!key) throw new FinanceError('idempotency_key is required', 'PAYMENT_IDEMPOTENCY_KEY_REQUIRED');
  const existing = dialect.prepare('SELECT * FROM finance_payments WHERE company_id = ? AND idempotency_key = ?').get(companyId, key);
  if (existing) return { ...existing, replayed: true };

  const paymentType = input.payment_type;
  if (!['receive', 'pay', 'transfer'].includes(paymentType)) throw new FinanceError('invalid payment_type', 'PAYMENT_TYPE_INVALID');
  const method = input.method;
  if (!['cash', 'bank', 'clearing'].includes(method)) throw new FinanceError('unsupported payment method', 'PAYMENT_METHOD_UNSUPPORTED');
  const amount = round2(Number(input.amount));
  if (!(amount > 0)) throw new FinanceError('payment amount must be positive', 'PAYMENT_AMOUNT_INVALID');
  if (!input.counter_account_id) throw new FinanceError('counter_account_id is required', 'PAYMENT_COUNTER_ACCOUNT_REQUIRED');
  assertCompanyMatch(dialect, 'finance_accounts', input.cash_or_bank_account_id, companyId);
  assertCompanyMatch(dialect, 'finance_accounts', input.counter_account_id, companyId);
  const currency = input.currency || 'IQD';
  const fxRate = currency === 'IQD' ? 1 : Number(input.fx_rate);
  if (currency !== 'IQD' && !(fxRate > 0)) throw new FinanceError('foreign-currency payments require a positive fx_rate', 'PAYMENT_FX_RATE_REQUIRED');
  const feeAmount = round2(Number(input.fee_amount || 0));
  if (feeAmount > 0 && !input.fee_account_id) throw new FinanceError('fee_account_id is required when fee_amount is set', 'PAYMENT_FEE_ACCOUNT_REQUIRED');
  if (feeAmount > 0) assertCompanyMatch(dialect, 'finance_accounts', input.fee_account_id, companyId);

  const paymentDate = input.payment_date || now.slice(0, 10);
  const moveType = paymentType === 'receive' ? 'cash_receipt' : paymentType === 'pay' ? 'cash_payment' : 'internal_transfer';
  const localAmount = round2(amount * fxRate);
  const localFee = round2(feeAmount * fxRate);
  const fxLine = (accountId, debit, credit) => ({
    account_id: accountId, debit, credit, currency_code: currency,
    currency_debit: currency !== 'IQD' && debit > 0 ? amount : 0,
    currency_credit: currency !== 'IQD' && credit > 0 ? amount : 0,
  });

  const lines = [];
  if (paymentType === 'receive') {
    lines.push(fxLine(input.cash_or_bank_account_id, round2(localAmount - localFee), 0));
    if (feeAmount > 0) lines.push({ account_id: input.fee_account_id, debit: localFee, credit: 0 });
    lines.push({ ...fxLine(input.counter_account_id, 0, localAmount), partner_id: input.partner_id || null });
  } else if (paymentType === 'pay') {
    lines.push({ ...fxLine(input.counter_account_id, localAmount, 0), partner_id: input.partner_id || null });
    if (feeAmount > 0) lines.push({ account_id: input.fee_account_id, debit: localFee, credit: 0 });
    lines.push(fxLine(input.cash_or_bank_account_id, 0, round2(localAmount + localFee)));
  } else {
    lines.push(fxLine(input.counter_account_id, round2(localAmount - localFee), 0));
    if (feeAmount > 0) lines.push({ account_id: input.fee_account_id, debit: localFee, credit: 0 });
    lines.push(fxLine(input.cash_or_bank_account_id, 0, localAmount));
  }

  const doc = createDocument(dialect, ctx, { move_type: moveType, doc_date: paymentDate, currency, partner_id: input.partner_id || null, lines });

  const id = input.id || `finpay_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_payments (
      id, company_id, document_id, payment_type, method, partner_id, cash_or_bank_account_id, counter_account_id,
      amount, currency, fx_rate, fee_amount, fee_account_id, payment_date, status, idempotency_key, reference,
      provider_reference, unallocated_amount, created_at, updated_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, companyId, doc.id, paymentType, method, input.partner_id || null, input.cash_or_bank_account_id, input.counter_account_id,
    amount, currency, fxRate, feeAmount, input.fee_account_id || null, paymentDate, key, input.reference || null,
    input.provider_reference || null, amount, now, now, userId
  );

  return { id, companyId, document_id: doc.id, payment_type: paymentType, amount, currency, status: 'draft', idempotency_key: key };
}

export function postPayment(dialect, ctx, input) {
  const { companyId, now } = context(ctx);
  const payment = dialect.prepare('SELECT * FROM finance_payments WHERE id = ? AND company_id = ?').get(input.payment_id, companyId);
  if (!payment) throw new FinanceError('payment not found', 'PAYMENT_NOT_FOUND');
  if (payment.status !== 'draft') throw new FinanceError('only a draft payment can be posted', 'PAYMENT_STATE_INVALID');
  submitDocument(dialect, ctx, { document_id: payment.document_id });
  approveDocument(dialect, ctx, { document_id: payment.document_id });
  postDocument(dialect, ctx, { document_id: payment.document_id });
  dialect.prepare("UPDATE finance_payments SET status = 'posted', updated_at = ? WHERE id = ?").run(now, input.payment_id);
  return { id: input.payment_id, status: 'posted' };
}

export function reversePaymentAction(dialect, ctx, input) {
  const { companyId, now } = context(ctx);
  const payment = dialect.prepare('SELECT * FROM finance_payments WHERE id = ? AND company_id = ?').get(input.payment_id, companyId);
  if (!payment) throw new FinanceError('payment not found', 'PAYMENT_NOT_FOUND');
  if (payment.status !== 'posted') throw new FinanceError('only a posted payment can be reversed', 'PAYMENT_NOT_POSTED');
  if (round2(payment.unallocated_amount) !== round2(payment.amount)) {
    throw new FinanceError('unallocate this payment fully before reversing it', 'PAYMENT_HAS_ALLOCATIONS');
  }
  reverseDocument(dialect, ctx, { document_id: payment.document_id, reason: input.reason || 'payment reversal' });
  dialect.prepare("UPDATE finance_payments SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now, input.payment_id);
  return { id: input.payment_id, status: 'cancelled' };
}

// ---------------------------------------------------------------------------
// Wave D — Allocation, advances, refunds, write-offs (Packet 03.16)
// ---------------------------------------------------------------------------

export function allocatePayment(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const payment = dialect.prepare('SELECT * FROM finance_payments WHERE id = ? AND company_id = ?').get(input.payment_id, companyId);
  if (!payment) throw new FinanceError('payment not found', 'PAYMENT_NOT_FOUND');
  if (payment.status !== 'posted') throw new FinanceError('only a posted payment can be allocated', 'PAYMENT_NOT_POSTED');
  const amount = round2(Number(input.amount));
  if (!(amount > 0)) throw new FinanceError('allocation amount must be positive', 'ALLOCATION_AMOUNT_INVALID');
  const openAmount = getOpenAmountForDocument(dialect, ctx, input.document_id);
  if (amount > openAmount + 0.0001) throw new FinanceError('allocation exceeds open amount on the document', 'ALLOCATION_EXCEEDS_OPEN_ITEM');

  // Atomic check-and-decrement: the WHERE clause makes this safe even if two
  // allocations against the same payment are attempted back-to-back.
  const result = dialect.prepare(
    'UPDATE finance_payments SET unallocated_amount = unallocated_amount - ?, updated_at = ? WHERE id = ? AND unallocated_amount >= ?'
  ).run(amount, now, input.payment_id, amount);
  if (result.changes === 0) throw new FinanceError('allocation exceeds unallocated payment amount', 'ALLOCATION_EXCEEDS_PAYMENT');

  const id = `finpalloc_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_payment_allocations (id, company_id, payment_id, document_id, amount, currency, fx_difference, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, companyId, input.payment_id, input.document_id, amount, payment.currency, Number(input.fx_difference || 0), now, userId);
  return { id, payment_id: input.payment_id, document_id: input.document_id, amount };
}

export function unallocatePayment(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const alloc = dialect.prepare('SELECT * FROM finance_payment_allocations WHERE id = ? AND company_id = ?').get(input.allocation_id, companyId);
  if (!alloc) throw new FinanceError('allocation not found', 'ALLOCATION_NOT_FOUND');
  if (alloc.reversed_allocation_id) throw new FinanceError('this row is already a reversal', 'ALLOCATION_IS_A_REVERSAL');
  const alreadyReversed = dialect.prepare('SELECT 1 FROM finance_payment_allocations WHERE reversed_allocation_id = ?').get(alloc.id);
  if (alreadyReversed) throw new FinanceError('allocation already unallocated', 'ALLOCATION_ALREADY_REVERSED');
  const id = `finpalloc_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_payment_allocations (id, company_id, payment_id, document_id, amount, currency, fx_difference, reversed_allocation_id, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, companyId, alloc.payment_id, alloc.document_id, -alloc.amount, alloc.currency, -Number(alloc.fx_difference || 0), alloc.id, now, userId);
  dialect.prepare('UPDATE finance_payments SET unallocated_amount = unallocated_amount + ?, updated_at = ? WHERE id = ?').run(alloc.amount, now, alloc.payment_id);
  return { id, reversed_allocation_id: alloc.id, amount: -alloc.amount };
}

export function writeOffOpenItem(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const documentId = input.document_id;
  const openAmount = getOpenAmountForDocument(dialect, ctx, documentId);
  if (openAmount <= 0.005) throw new FinanceError('document has no remaining open amount to write off', 'WRITE_OFF_NO_OPEN_AMOUNT');
  const amount = input.amount != null ? round2(Number(input.amount)) : openAmount;
  if (amount > openAmount + 0.0001) throw new FinanceError('write-off amount exceeds open amount', 'WRITE_OFF_EXCEEDS_OPEN_AMOUNT');
  const reason = String(input.reason || '').trim();
  if (!reason) throw new FinanceError('write-off reason is required', 'WRITE_OFF_REASON_REQUIRED');
  assertCompanyMatch(dialect, 'finance_accounts', input.write_off_account_id, companyId);
  const original = getDocument(dialect, companyId, documentId);
  const isCustomer = original.move_type === 'customer_invoice';
  const controlLine = dialect.prepare(`
    SELECT l.account_id FROM finance_journal_lines l JOIN finance_accounts a ON a.id = l.account_id
    WHERE l.document_id = ? AND a.type IN ('receivable','payable') LIMIT 1
  `).get(documentId);
  if (!controlLine) throw new FinanceError('could not resolve the control account for this document', 'WRITE_OFF_CONTROL_NOT_FOUND');
  const lines = isCustomer
    ? [{ account_id: input.write_off_account_id, debit: amount, credit: 0 }, { account_id: controlLine.account_id, debit: 0, credit: amount, partner_id: original.partner_id }]
    : [{ account_id: controlLine.account_id, debit: amount, credit: 0, partner_id: original.partner_id }, { account_id: input.write_off_account_id, debit: 0, credit: amount }];
  const woDoc = createDocument(dialect, ctx, {
    move_type: 'write_off', doc_date: input.doc_date || now.slice(0, 10), partner_id: original.partner_id,
    currency: original.currency, source_type: 'write_off_of', source_id: documentId, lines,
  });
  submitDocument(dialect, ctx, { document_id: woDoc.id });
  approveDocument(dialect, ctx, { document_id: woDoc.id });
  const posted = postDocument(dialect, ctx, { document_id: woDoc.id });
  const id = `finwo_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_write_offs (id, company_id, document_id, write_off_document_id, amount, write_off_account_id, reason, approved_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, companyId, documentId, posted.id, amount, input.write_off_account_id, reason, userId, now);
  return { id, document_id: documentId, write_off_document_id: posted.id, amount };
}

// ---------------------------------------------------------------------------
// Wave D — Open-item reconciliation engine (Packet 03.17)
// ---------------------------------------------------------------------------

export function openReconciliationSession(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const targetType = input.target_type;
  if (!['ar', 'ap'].includes(targetType)) throw new FinanceError('target_type must be ar or ap', 'RECONCILIATION_TARGET_INVALID');
  const id = `finrecsess_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_reconciliation_sessions (id, company_id, target_type, partner_id, status, opened_by, created_at)
    VALUES (?, ?, ?, ?, 'open', ?, ?)
  `).run(id, companyId, targetType, input.partner_id || null, userId, now);
  return { id, companyId, target_type: targetType, partner_id: input.partner_id || null, status: 'open' };
}

export function suggestReconciliationCandidates(dialect, ctx, input) {
  const { companyId } = context(ctx);
  const session = dialect.prepare('SELECT * FROM finance_reconciliation_sessions WHERE id = ? AND company_id = ?').get(input.session_id, companyId);
  if (!session) throw new FinanceError('reconciliation session not found', 'RECONCILIATION_SESSION_NOT_FOUND');
  const openItems = session.target_type === 'ar'
    ? getCustomerOpenItems(dialect, ctx, { partner_id: session.partner_id })
    : getSupplierOpenItems(dialect, ctx, { partner_id: session.partner_id });
  const paymentType = session.target_type === 'ar' ? 'receive' : 'pay';
  let sql = "SELECT * FROM finance_payments WHERE company_id = ? AND status = 'posted' AND payment_type = ? AND unallocated_amount > 0.005";
  const params = [companyId, paymentType];
  if (session.partner_id) { sql += ' AND partner_id = ?'; params.push(session.partner_id); }
  const payments = dialect.prepare(sql).all(...params);
  const tolerance = Number(input.tolerance || 0);
  const suggestions = [];
  for (const item of openItems) {
    for (const payment of payments) {
      const diff = round2(Math.abs(item.open_amount - payment.unallocated_amount));
      if (diff < 0.005) {
        suggestions.push({ document_id: item.document_id, payment_id: payment.id, amount: item.open_amount, method: 'exact', confidence: 1 });
      } else if (tolerance > 0 && diff <= tolerance) {
        suggestions.push({ document_id: item.document_id, payment_id: payment.id, amount: round2(Math.min(item.open_amount, payment.unallocated_amount)), method: 'tolerance', confidence: round2(1 - diff / tolerance) });
      }
    }
  }
  return suggestions;
}

export function confirmReconciliationMatch(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const session = dialect.prepare('SELECT * FROM finance_reconciliation_sessions WHERE id = ? AND company_id = ?').get(input.session_id, companyId);
  if (!session) throw new FinanceError('reconciliation session not found', 'RECONCILIATION_SESSION_NOT_FOUND');
  if (session.status !== 'open') throw new FinanceError('reconciliation session is closed', 'RECONCILIATION_SESSION_CLOSED');
  const allocation = allocatePayment(dialect, ctx, { payment_id: input.payment_id, document_id: input.document_id, amount: input.amount });
  const id = `finrecmatch_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_reconciliation_matches (id, session_id, company_id, document_id, payment_id, allocation_id, amount, method, confidence, explain, status, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)
  `).run(id, input.session_id, companyId, input.document_id, input.payment_id, allocation.id, input.amount, input.method || 'manual', input.confidence ?? 1, input.explain || null, now, userId);
  return { id, session_id: input.session_id, allocation_id: allocation.id, amount: input.amount, status: 'confirmed' };
}

export function undoReconciliationMatch(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const match = dialect.prepare('SELECT * FROM finance_reconciliation_matches WHERE id = ? AND company_id = ?').get(input.match_id, companyId);
  if (!match) throw new FinanceError('reconciliation match not found', 'RECONCILIATION_MATCH_NOT_FOUND');
  if (match.status !== 'confirmed') throw new FinanceError('reconciliation match already undone', 'RECONCILIATION_MATCH_ALREADY_UNDONE');
  if (match.allocation_id) unallocatePayment(dialect, ctx, { allocation_id: match.allocation_id });
  dialect.prepare('UPDATE finance_reconciliation_matches SET status = ?, undone_at = ?, undone_by = ? WHERE id = ?').run('undone', now, userId, input.match_id);
  return { id: input.match_id, status: 'undone' };
}

export function closeReconciliationSession(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const session = dialect.prepare('SELECT * FROM finance_reconciliation_sessions WHERE id = ? AND company_id = ?').get(input.session_id, companyId);
  if (!session) throw new FinanceError('reconciliation session not found', 'RECONCILIATION_SESSION_NOT_FOUND');
  dialect.prepare('UPDATE finance_reconciliation_sessions SET status = ?, closed_by = ?, closed_at = ? WHERE id = ?').run('closed', userId, now, input.session_id);
  return { id: input.session_id, status: 'closed' };
}

// ---------------------------------------------------------------------------
// Wave D — Banking and statement import (Packet 03.18)
// ---------------------------------------------------------------------------

export function createBankAccount(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  assertCompanyMatch(dialect, 'finance_accounts', input.gl_account_id, companyId);
  const id = input.id || `finbank_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_bank_accounts (id, company_id, name, gl_account_id, currency, is_active, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, companyId, String(input.name || '').trim(), input.gl_account_id, input.currency || 'IQD', input.is_active !== false ? 1 : 0, now, userId);
  return { id, companyId, name: input.name };
}

export function createBankMatchRule(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const name = String(input.name || '').trim();
  if (!name) throw new FinanceError('match rule name is required', 'BANK_RULE_NAME_REQUIRED');
  if (input.target_account_id) assertCompanyMatch(dialect, 'finance_accounts', input.target_account_id, companyId);
  const id = input.id || `finbankrule_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_bank_match_rules (id, company_id, name, description_pattern, amount_tolerance, target_account_id, is_active, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, companyId, name, input.description_pattern || null, Number(input.amount_tolerance || 0), input.target_account_id || null, 1, now, userId);
  return { id, companyId, name };
}

function hashStatementLine(companyId, line) {
  return crypto.createHash('sha256').update(JSON.stringify([companyId, line.external_id || '', line.transaction_date, round2(line.amount), line.currency || 'IQD', line.description || ''])).digest('hex');
}

export function importBankStatement(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const bank = dialect.prepare('SELECT * FROM finance_bank_accounts WHERE id = ? AND company_id = ? AND is_active = 1').get(input.bank_account_id, companyId);
  if (!bank) throw new FinanceError('bank account not found or inactive', 'BANK_ACCOUNT_NOT_FOUND');
  const key = String(input.import_key || '').trim();
  if (!key) throw new FinanceError('import_key is required', 'IMPORT_KEY_REQUIRED');
  const existing = dialect.prepare('SELECT * FROM finance_bank_statement_batches WHERE company_id = ? AND import_key = ?').get(companyId, key);
  if (existing) {
    const lines = dialect.prepare('SELECT * FROM finance_bank_statement_lines WHERE statement_id = ? ORDER BY line_number').all(existing.id);
    return { ...existing, duplicate: true, lines };
  }
  const lines = Array.isArray(input.lines) ? input.lines : [];
  const statementId = input.id || `finstmt_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_bank_statement_batches (id, company_id, bank_account_id, statement_date, opening_balance, closing_balance, import_key, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(statementId, companyId, bank.id, input.statement_date || now.slice(0, 10), Number(input.opening_balance || 0), input.closing_balance == null ? null : Number(input.closing_balance), key, now, userId);
  const insertLine = dialect.prepare(`
    INSERT INTO finance_bank_statement_lines (id, statement_id, company_id, line_number, transaction_date, amount, currency, description, external_id, line_hash, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unmatched', ?)
  `);
  let number = 0;
  for (const line of lines) {
    number += 1;
    if (!line.transaction_date && !input.statement_date) throw new FinanceError('malformed statement line: missing transaction_date', 'BANK_LINE_MALFORMED');
    if (!Number.isFinite(Number(line.amount))) throw new FinanceError('malformed statement line: invalid amount', 'BANK_LINE_MALFORMED');
    const lineHash = hashStatementLine(companyId, line);
    const dup = dialect.prepare('SELECT 1 FROM finance_bank_statement_lines WHERE company_id = ? AND line_hash = ?').get(companyId, lineHash);
    if (dup) throw new FinanceError('duplicate statement line import', 'BANK_LINE_DUPLICATE');
    insertLine.run(line.id || `finstmtl_${crypto.randomUUID()}`, statementId, companyId, number, line.transaction_date || input.statement_date, Number(line.amount), line.currency || bank.currency, line.description || null, line.external_id || null, lineHash, now);
  }
  return { id: statementId, imported: lines.length, duplicate: false };
}

function activeReconciledLines(dialect, lineId) {
  return dialect.prepare("SELECT * FROM finance_bank_reconciliations WHERE statement_line_id = ? AND status = 'reconciled'").all(lineId);
}

export function matchBankStatementLine(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const line = dialect.prepare('SELECT * FROM finance_bank_statement_lines WHERE id = ? AND company_id = ?').get(input.line_id, companyId);
  if (!line) throw new FinanceError('statement line not found', 'BANK_LINE_NOT_FOUND');
  if (activeReconciledLines(dialect, line.id).length) throw new FinanceError('statement line is already reconciled', 'BANK_LINE_ALREADY_RECONCILED');
  const rule = input.rule_id ? dialect.prepare('SELECT * FROM finance_bank_match_rules WHERE id = ? AND company_id = ? AND is_active = 1').get(input.rule_id, companyId) : null;
  if (input.rule_id && !rule) throw new FinanceError('match rule not found', 'BANK_RULE_NOT_FOUND');
  const tolerance = Number(input.tolerance == null ? (rule?.amount_tolerance || 0) : input.tolerance);
  if (rule?.description_pattern && !String(line.description || '').toLowerCase().includes(String(rule.description_pattern).toLowerCase())) {
    return { matched: false, rule_id: rule.id, candidates: 0 };
  }
  const candidates = dialect.prepare("SELECT * FROM finance_payments WHERE company_id = ? AND status = 'posted' AND currency = ? ORDER BY payment_date, id").all(companyId, line.currency);
  const target = candidates.find(p => Math.abs(Number(p.amount) - Math.abs(Number(line.amount))) <= tolerance && (!input.payment_id || p.id === input.payment_id));
  if (!target) return { matched: false, candidates: candidates.length };
  const amount = round2(Math.min(Math.abs(Number(line.amount)), Number(target.amount)));
  const id = `finbankrec_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_bank_reconciliations (id, statement_line_id, company_id, target_type, target_id, amount, method, status, created_at, created_by)
    VALUES (?, ?, ?, 'payment', ?, ?, ?, 'reconciled', ?, ?)
  `).run(id, line.id, companyId, target.id, amount, tolerance ? 'tolerance' : 'exact', now, userId);
  dialect.prepare("UPDATE finance_bank_statement_lines SET status = 'reconciled' WHERE id = ?").run(line.id);
  return { matched: true, reconciliation_id: id, target_id: target.id, amount };
}

export function manualReconcileBankLine(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const line = dialect.prepare('SELECT * FROM finance_bank_statement_lines WHERE id = ? AND company_id = ?').get(input.line_id, companyId);
  if (!line) throw new FinanceError('statement line not found', 'BANK_LINE_NOT_FOUND');
  if (!['payment', 'document', 'difference'].includes(input.target_type)) throw new FinanceError('invalid reconciliation target_type', 'BANK_TARGET_TYPE_INVALID');
  if (activeReconciledLines(dialect, line.id).length) throw new FinanceError('statement line is already reconciled', 'BANK_LINE_ALREADY_RECONCILED');
  const amount = round2(input.amount != null ? Number(input.amount) : Math.abs(line.amount));
  if (!(amount > 0) || amount > Math.abs(line.amount) + 0.0001) throw new FinanceError('reconciliation amount exceeds statement line amount', 'BANK_RECONCILE_AMOUNT_INVALID');
  const id = `finbankrec_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_bank_reconciliations (id, statement_line_id, company_id, target_type, target_id, amount, method, status, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 'manual', 'reconciled', ?, ?)
  `).run(id, line.id, companyId, input.target_type, input.target_id, amount, now, userId);
  dialect.prepare("UPDATE finance_bank_statement_lines SET status = 'reconciled' WHERE id = ?").run(line.id);
  return { matched: true, reconciliation_id: id, target_id: input.target_id, amount };
}

export function recordBankDifference(dialect, ctx, input) {
  const { companyId } = context(ctx);
  const line = dialect.prepare('SELECT * FROM finance_bank_statement_lines WHERE id = ? AND company_id = ?').get(input.line_id, companyId);
  if (!line) throw new FinanceError('statement line not found', 'BANK_LINE_NOT_FOUND');
  const statement = dialect.prepare('SELECT * FROM finance_bank_statement_batches WHERE id = ?').get(line.statement_id);
  const bank = dialect.prepare('SELECT * FROM finance_bank_accounts WHERE id = ?').get(statement.bank_account_id);
  if (!input.account_id) throw new FinanceError('difference account_id is required', 'BANK_DIFFERENCE_ACCOUNT_REQUIRED');
  const amount = round2(Math.abs(line.amount));
  const bankDebit = Number(line.amount) >= 0 ? amount : 0;
  const bankCredit = Number(line.amount) < 0 ? amount : 0;
  const doc = createDocument(dialect, ctx, {
    move_type: 'manual_entry', doc_date: line.transaction_date, currency: line.currency,
    lines: [
      { account_id: bank.gl_account_id, debit: bankDebit, credit: bankCredit, description: 'Bank statement difference' },
      { account_id: input.account_id, debit: bankCredit, credit: bankDebit, description: input.reason || 'Bank difference' },
    ],
  });
  submitDocument(dialect, ctx, { document_id: doc.id });
  approveDocument(dialect, ctx, { document_id: doc.id });
  const posted = postDocument(dialect, ctx, { document_id: doc.id });
  const rec = manualReconcileBankLine(dialect, ctx, { line_id: line.id, target_type: 'difference', target_id: posted.id, amount });
  return { document_id: posted.id, ...rec };
}

export function unreconcileBankLine(dialect, ctx, input) {
  const { companyId } = context(ctx);
  const rec = dialect.prepare("SELECT * FROM finance_bank_reconciliations WHERE id = ? AND company_id = ? AND status = 'reconciled'").get(input.reconciliation_id, companyId);
  if (!rec) throw new FinanceError('active reconciliation not found', 'BANK_RECONCILIATION_NOT_FOUND');
  dialect.prepare("UPDATE finance_bank_reconciliations SET status = 'reversed' WHERE id = ?").run(rec.id);
  const stillReconciled = dialect.prepare("SELECT 1 FROM finance_bank_reconciliations WHERE statement_line_id = ? AND status = 'reconciled'").get(rec.statement_line_id);
  if (!stillReconciled) dialect.prepare("UPDATE finance_bank_statement_lines SET status = 'unmatched' WHERE id = ?").run(rec.statement_line_id);
  return { id: rec.id, status: 'reversed' };
}

// ---------------------------------------------------------------------------
// Wave D — Cashboxes, petty cash, and custody (Packet 03.19)
// ---------------------------------------------------------------------------

export function createCashbox(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  assertCompanyMatch(dialect, 'finance_accounts', input.gl_account_id, companyId);
  const name = String(input.name || '').trim();
  if (!name) throw new FinanceError('cashbox name is required', 'CASHBOX_NAME_REQUIRED');
  const id = input.id || `fincbox_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_cashboxes (id, company_id, branch_id, name, gl_account_id, custodian_user_id, currency, max_balance, is_active, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, companyId, input.branch_id || null, name, input.gl_account_id, input.custodian_user_id || null, input.currency || 'IQD', input.max_balance ?? null, 1, now, userId);
  return { id, companyId, name };
}

export function openCashShift(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const cashbox = dialect.prepare('SELECT * FROM finance_cashboxes WHERE id = ? AND company_id = ?').get(input.cashbox_id, companyId);
  if (!cashbox) throw new FinanceError('cashbox not found', 'CASHBOX_NOT_FOUND');
  const openShift = dialect.prepare("SELECT id FROM finance_cash_shifts WHERE cashbox_id = ? AND status = 'open'").get(input.cashbox_id);
  if (openShift) throw new FinanceError('cashbox already has an open shift', 'CASH_SHIFT_ALREADY_OPEN');
  const id = input.id || `fincshift_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_cash_shifts (id, company_id, cashbox_id, opened_by, opening_balance, status, opened_at)
    VALUES (?, ?, ?, ?, ?, 'open', ?)
  `).run(id, companyId, input.cashbox_id, userId, Number(input.opening_balance || 0), now);
  return { id, companyId, cashbox_id: input.cashbox_id, status: 'open' };
}

function expectedShiftBalance(dialect, shift) {
  const net = dialect.prepare(`
    SELECT COALESCE(SUM(l.debit - l.credit), 0) AS net FROM finance_journal_lines l
    JOIN finance_cashboxes c ON c.gl_account_id = l.account_id
    WHERE c.id = (SELECT cashbox_id FROM finance_cash_shifts WHERE id = ?) AND l.posting_date >= ?
  `).get(shift.id, shift.opened_at.slice(0, 10));
  return round2(Number(shift.opening_balance) + Number(net.net || 0));
}

export function recordCashCount(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const shift = dialect.prepare('SELECT * FROM finance_cash_shifts WHERE id = ? AND company_id = ?').get(input.shift_id, companyId);
  if (!shift) throw new FinanceError('cash shift not found', 'CASH_SHIFT_NOT_FOUND');
  if (shift.status !== 'open') throw new FinanceError('cash count requires an open shift', 'CASH_SHIFT_CLOSED');
  const expected = expectedShiftBalance(dialect, shift);
  const counted = round2(Number(input.counted_amount));
  const variance = round2(counted - expected);
  const id = `fincscount_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_cash_counts (id, shift_id, company_id, counted_amount, expected_amount, variance, counted_by, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.shift_id, companyId, counted, expected, variance, userId, input.note || null, now);
  return { id, shift_id: input.shift_id, expected_amount: expected, counted_amount: counted, variance };
}

export function closeCashShift(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const shift = dialect.prepare('SELECT * FROM finance_cash_shifts WHERE id = ? AND company_id = ?').get(input.shift_id, companyId);
  if (!shift) throw new FinanceError('cash shift not found', 'CASH_SHIFT_NOT_FOUND');
  if (shift.status !== 'open') throw new FinanceError('cash shift is already closed', 'CASH_SHIFT_ALREADY_CLOSED');
  const expected = expectedShiftBalance(dialect, shift);
  const actual = round2(Number(input.actual_closing_balance));
  const variance = round2(actual - expected);
  dialect.prepare(`
    UPDATE finance_cash_shifts SET status = 'closed', expected_closing_balance = ?, actual_closing_balance = ?, variance = ?, closed_at = ?, closed_by = ?
    WHERE id = ?
  `).run(expected, actual, variance, now, userId, input.shift_id);
  return { id: input.shift_id, status: 'closed', expected_closing_balance: expected, actual_closing_balance: actual, variance };
}

// ---------------------------------------------------------------------------
// Wave D — Payment terms, installments, retainage (Packet 03.20)
// ---------------------------------------------------------------------------

export function createPaymentTermTemplate(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const code = String(input.code || '').trim();
  const name = String(input.name || '').trim();
  if (!code) throw new FinanceError('payment term code is required', 'PAYMENT_TERM_CODE_REQUIRED');
  if (!name) throw new FinanceError('payment term name is required', 'PAYMENT_TERM_NAME_REQUIRED');
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (!lines.length) throw new FinanceError('at least one payment term line is required', 'PAYMENT_TERM_LINES_EMPTY');
  const percentSum = lines.filter(l => l.line_type === 'percent').reduce((s, l) => s + Number(l.value || 0), 0);
  const hasBalanceOrFixed = lines.some(l => l.line_type === 'balance' || l.line_type === 'fixed');
  if (!hasBalanceOrFixed && Math.abs(percentSum - 100) > 0.01) {
    throw new FinanceError('percent lines must sum to 100 unless a balance or fixed line is present', 'PAYMENT_TERM_LINES_INVALID');
  }
  const dup = dialect.prepare('SELECT id FROM finance_payment_term_templates WHERE company_id = ? AND code = ?').get(companyId, code);
  if (dup) throw new FinanceError('duplicate payment term code', 'PAYMENT_TERM_DUPLICATE');
  const id = input.id || `finterm_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_payment_term_templates (id, company_id, code, name, name_ar, early_discount_percent, early_discount_days, retainage_percent, is_active, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, companyId, code, name, input.name_ar || name, Number(input.early_discount_percent || 0), Number(input.early_discount_days || 0), Number(input.retainage_percent || 0), 1, now, userId);
  const insLine = dialect.prepare('INSERT INTO finance_payment_term_lines (id, template_id, sequence, line_type, value, due_rule, due_days, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  lines.forEach((l, idx) => {
    insLine.run(`fintermline_${crypto.randomUUID()}`, id, idx, l.line_type, Number(l.value || 0), l.due_rule || 'days_after_date', Number(l.due_days || 0), now);
  });
  return { id, companyId, code, name, line_count: lines.length };
}

function computeDueDate(docDate, rule, days) {
  const base = new Date(`${docDate}T00:00:00Z`);
  if (rule === 'days_after_date') {
    base.setUTCDate(base.getUTCDate() + days);
    return base.toISOString().slice(0, 10);
  }
  if (rule === 'days_after_month_end') {
    const monthEnd = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0));
    monthEnd.setUTCDate(monthEnd.getUTCDate() + days);
    return monthEnd.toISOString().slice(0, 10);
  }
  if (rule === 'fixed_day_next_month') {
    const next = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, Math.min(Math.max(days, 1), 28)));
    return next.toISOString().slice(0, 10);
  }
  return docDate;
}

export function generateDueScheduleFromTerm(dialect, ctx, input) {
  const { companyId } = context(ctx);
  const doc = getDocument(dialect, companyId, input.document_id);
  if (!doc) throw new FinanceError('document not found', 'DOCUMENT_NOT_FOUND');
  const template = dialect.prepare('SELECT * FROM finance_payment_term_templates WHERE id = ? AND company_id = ?').get(input.template_id, companyId);
  if (!template) throw new FinanceError('payment term template not found', 'PAYMENT_TERM_NOT_FOUND');
  const lines = dialect.prepare('SELECT * FROM finance_payment_term_lines WHERE template_id = ? ORDER BY sequence').all(input.template_id);
  const total = round2(doc.lines.reduce((s, l) => s + Number(l.debit || 0), 0));
  let allocated = 0;
  const schedule = lines.map((l, idx) => {
    let amount;
    if (idx === lines.length - 1) {
      amount = round2(total - allocated); // last line absorbs any rounding remainder so the schedule sums exactly.
    } else if (l.line_type === 'percent') {
      amount = round2(total * (Number(l.value) / 100));
    } else if (l.line_type === 'fixed') {
      amount = round2(Number(l.value));
    } else {
      amount = round2(total - allocated);
    }
    allocated = round2(allocated + amount);
    return { due_date: computeDueDate(doc.doc_date, l.due_rule, l.due_days), amount };
  });
  return setDueSchedule(dialect, ctx, { document_id: input.document_id, schedule });
}

// ---------------------------------------------------------------------------
// Wave D — Credit exposure and policy foundation (Packet 03.21)
// ---------------------------------------------------------------------------

export function setCreditProfile(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const partnerId = input.partner_id;
  if (!partnerId) throw new FinanceError('partner_id is required', 'CREDIT_PROFILE_PARTNER_REQUIRED');
  const id = input.id || `fincredit_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_credit_profiles (id, company_id, partner_id, credit_limit, overdue_grace_days, temporary_limit_override, temporary_limit_expires_at, include_guarantees, include_disputed, created_at, updated_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_id, partner_id) DO UPDATE SET credit_limit = excluded.credit_limit, overdue_grace_days = excluded.overdue_grace_days,
      temporary_limit_override = excluded.temporary_limit_override, temporary_limit_expires_at = excluded.temporary_limit_expires_at,
      include_guarantees = excluded.include_guarantees, include_disputed = excluded.include_disputed, updated_at = excluded.updated_at
  `).run(id, companyId, partnerId, Number(input.credit_limit || 0), Number(input.overdue_grace_days || 0), input.temporary_limit_override ?? null, input.temporary_limit_expires_at ?? null, Number(input.include_guarantees || 0), input.include_disputed ? 1 : 0, now, now, userId);
  return { id, companyId, partner_id: partnerId, credit_limit: Number(input.credit_limit || 0) };
}

export function holdCredit(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const reason = String(input.reason || '').trim();
  if (!reason) throw new FinanceError('credit hold reason is required', 'CREDIT_HOLD_REASON_REQUIRED');
  const id = `fincrhold_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_credit_holds (id, company_id, partner_id, reason, held_by, held_at, status)
    VALUES (?, ?, ?, ?, ?, ?, 'held')
  `).run(id, companyId, input.partner_id, reason, userId, now);
  return { id, partner_id: input.partner_id, status: 'held' };
}

export function releaseCreditHold(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const hold = dialect.prepare('SELECT * FROM finance_credit_holds WHERE id = ? AND company_id = ?').get(input.hold_id, companyId);
  if (!hold) throw new FinanceError('credit hold not found', 'CREDIT_HOLD_NOT_FOUND');
  if (hold.status !== 'held') throw new FinanceError('credit hold already released', 'CREDIT_HOLD_ALREADY_RELEASED');
  dialect.prepare('UPDATE finance_credit_holds SET status = ?, released_by = ?, released_at = ?, released_reason = ? WHERE id = ?').run('released', userId, now, input.released_reason || null, input.hold_id);
  return { id: input.hold_id, status: 'released' };
}

export function getCreditExposure(dialect, ctx, input) {
  const { companyId } = context(ctx);
  const partnerId = input.partner_id;
  const profile = dialect.prepare('SELECT * FROM finance_credit_profiles WHERE company_id = ? AND partner_id = ?').get(companyId, partnerId);
  const openItems = getCustomerOpenItems(dialect, ctx, { partner_id: partnerId });
  const openReceivables = round2(openItems.reduce((s, i) => s + i.open_amount, 0));
  const asOfDate = input.as_of_date || new Date().toISOString().slice(0, 10);
  const aging = getCustomerAging(dialect, ctx, { partner_id: partnerId, as_of_date: asOfDate });
  const graceDays = profile ? profile.overdue_grace_days : 0;
  const overdueBuckets = graceDays > 30 ? ['d61_90', 'd90_plus'] : graceDays > 0 ? ['d1_30', 'd31_60', 'd61_90', 'd90_plus'] : ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'];
  const overdueBalance = round2(overdueBuckets.reduce((s, k) => s + (aging[k] || 0), 0));
  const activeHold = dialect.prepare("SELECT * FROM finance_credit_holds WHERE company_id = ? AND partner_id = ? AND status = 'held'").get(companyId, partnerId);
  const nowIso = new Date().toISOString();
  const overrideActive = !!(profile && profile.temporary_limit_override != null && (!profile.temporary_limit_expires_at || profile.temporary_limit_expires_at > nowIso));
  const limit = overrideActive ? profile.temporary_limit_override : (profile ? profile.credit_limit : 0);
  const exposure = round2(openReceivables + (profile ? Number(profile.include_guarantees || 0) : 0));
  return {
    partner_id: partnerId,
    open_receivables: openReceivables,
    overdue_balance: overdueBalance,
    exposure,
    credit_limit: limit,
    available: round2(limit - exposure),
    is_over_limit: exposure > limit + 0.0001,
    is_held: !!activeHold,
    explain: { profile_found: !!profile, temporary_override_active: overrideActive, overdue_grace_days: graceDays, as_of_date: asOfDate },
  };
}

// ---------------------------------------------------------------------------
// Wave E — Budgeting foundation (Packet 03.22)
// ---------------------------------------------------------------------------

export function createBudget(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const code = String(input.code || '').trim();
  const name = String(input.name || '').trim();
  if (!code) throw new FinanceError('budget code is required', 'BUDGET_CODE_REQUIRED');
  if (!name) throw new FinanceError('budget name is required', 'BUDGET_NAME_REQUIRED');
  if (!input.fiscal_year_id) throw new FinanceError('fiscal_year_id is required', 'BUDGET_FISCAL_YEAR_REQUIRED');
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (!lines.length) throw new FinanceError('at least one budget line is required', 'BUDGET_LINES_EMPTY');
  const id = input.id || `finbudget_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_budgets (id, company_id, code, name, fiscal_year_id, version, parent_budget_id, status, threshold_warn_percent, threshold_block_percent, created_at, updated_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)
  `).run(id, companyId, code, name, input.fiscal_year_id, input.version || 1, input.parent_budget_id || null, Number(input.threshold_warn_percent ?? 80), input.threshold_block_percent ?? null, now, now, userId);
  insertBudgetLines(dialect, companyId, id, lines, now);
  return { id, companyId, code, name, status: 'draft', line_count: lines.length };
}

function insertBudgetLines(dialect, companyId, budgetId, lines, now) {
  const insLine = dialect.prepare('INSERT INTO finance_budget_lines (id, budget_id, company_id, account_id, dimension_value_id, period_id, amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const l of lines) {
    assertCompanyMatch(dialect, 'finance_accounts', l.account_id, companyId);
    insLine.run(`finbudgetl_${crypto.randomUUID()}`, budgetId, companyId, l.account_id, l.dimension_value_id || null, l.period_id, Number(l.amount || 0), now);
  }
}

export function updateBudgetLines(dialect, ctx, input) {
  const { companyId, now } = context(ctx);
  const budget = dialect.prepare('SELECT * FROM finance_budgets WHERE id = ? AND company_id = ?').get(input.budget_id, companyId);
  if (!budget) throw new FinanceError('budget not found', 'BUDGET_NOT_FOUND');
  if (budget.status !== 'draft') throw new FinanceError('only a draft budget version can be edited', 'BUDGET_VERSION_IMMUTABLE');
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (!lines.length) throw new FinanceError('at least one budget line is required', 'BUDGET_LINES_EMPTY');
  dialect.prepare('DELETE FROM finance_budget_lines WHERE budget_id = ?').run(input.budget_id);
  insertBudgetLines(dialect, companyId, input.budget_id, lines, now);
  return { id: input.budget_id, line_count: lines.length };
}

function transitionBudget(dialect, companyId, userId, now, budgetId, fromStates, toState, extra = {}) {
  const budget = dialect.prepare('SELECT * FROM finance_budgets WHERE id = ? AND company_id = ?').get(budgetId, companyId);
  if (!budget) throw new FinanceError('budget not found', 'BUDGET_NOT_FOUND');
  if (!fromStates.includes(budget.status)) throw new FinanceError(`budget must be in ${fromStates.join('/')} state to transition to ${toState}`, 'BUDGET_STATE_INVALID');
  const fields = ['status = ?', 'updated_at = ?'];
  const params = [toState, now];
  for (const [k, v] of Object.entries(extra)) { fields.push(`${k} = ?`); params.push(v); }
  params.push(budgetId, companyId);
  dialect.prepare(`UPDATE finance_budgets SET ${fields.join(', ')} WHERE id = ? AND company_id = ?`).run(...params);
  return { id: budgetId, status: toState };
}

export function submitBudget(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  return transitionBudget(dialect, companyId, userId, now, input.budget_id, ['draft'], 'submitted', { submitted_by: userId, submitted_at: now });
}

export function approveBudget(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  return transitionBudget(dialect, companyId, userId, now, input.budget_id, ['submitted'], 'approved', { approved_by: userId, approved_at: now });
}

export function rejectBudget(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  return transitionBudget(dialect, companyId, userId, now, input.budget_id, ['submitted'], 'rejected');
}

export function reviseBudget(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const original = dialect.prepare('SELECT * FROM finance_budgets WHERE id = ? AND company_id = ?').get(input.budget_id, companyId);
  if (!original) throw new FinanceError('budget not found', 'BUDGET_NOT_FOUND');
  if (original.status !== 'approved') throw new FinanceError('only an approved budget can be revised', 'BUDGET_REVISE_REQUIRES_APPROVED');
  const lines = Array.isArray(input.lines) ? input.lines : dialect.prepare('SELECT account_id, dimension_value_id, period_id, amount FROM finance_budget_lines WHERE budget_id = ?').all(original.id);
  return createBudget(dialect, ctx, {
    code: original.code, name: input.name || original.name, fiscal_year_id: original.fiscal_year_id,
    version: original.version + 1, parent_budget_id: original.id, lines,
    threshold_warn_percent: original.threshold_warn_percent, threshold_block_percent: original.threshold_block_percent,
  });
}

function actualForAccountPeriodDimension(dialect, companyId, accountId, startDate, endDate, dimensionValueId) {
  const rows = dialect.prepare(`
    SELECT debit, credit, dims FROM finance_journal_lines
    WHERE company_id = ? AND account_id = ? AND posting_date >= ? AND posting_date <= ?
  `).all(companyId, accountId, startDate, endDate);
  let net = 0;
  for (const row of rows) {
    let share = 1;
    if (dimensionValueId) {
      share = 0;
      if (row.dims) {
        try {
          const parsed = JSON.parse(row.dims);
          if (Object.prototype.hasOwnProperty.call(parsed, dimensionValueId)) share = Number(parsed[dimensionValueId]) / 100;
        } catch { /* malformed dims JSON contributes nothing to a dimension-scoped budget */ }
      }
    }
    net += (Number(row.debit) - Number(row.credit)) * share;
  }
  return net;
}

export function getBudgetVariance(dialect, ctx, input) {
  const { companyId } = context(ctx);
  const budget = dialect.prepare('SELECT * FROM finance_budgets WHERE id = ? AND company_id = ?').get(input.budget_id, companyId);
  if (!budget) throw new FinanceError('budget not found', 'BUDGET_NOT_FOUND');
  const lines = dialect.prepare('SELECT * FROM finance_budget_lines WHERE budget_id = ?').all(input.budget_id);
  return lines.map(l => {
    const period = dialect.prepare('SELECT start_date, end_date FROM finance_periods WHERE id = ?').get(l.period_id);
    const account = dialect.prepare('SELECT type, normal_balance FROM finance_accounts WHERE id = ?').get(l.account_id);
    const rawNet = actualForAccountPeriodDimension(dialect, companyId, l.account_id, period.start_date, period.end_date, l.dimension_value_id);
    const actual = round2(account.normal_balance === 'debit' ? rawNet : -rawNet);
    const variance = round2(actual - l.amount);
    const percentUsed = l.amount !== 0 ? round2((actual / l.amount) * 100) : null;
    return {
      budget_line_id: l.id, account_id: l.account_id, period_id: l.period_id, budgeted: l.amount, actual, variance,
      percent_used: percentUsed,
      over_warn_threshold: percentUsed != null && percentUsed >= budget.threshold_warn_percent,
      over_block_threshold: budget.threshold_block_percent != null && percentUsed != null && percentUsed >= budget.threshold_block_percent,
    };
  });
}

// ---------------------------------------------------------------------------
// Wave E — Expense claims and employee advances (Packet 03.23)
// ---------------------------------------------------------------------------

export function createExpenseClaim(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const employeeId = input.employee_id;
  if (!employeeId) throw new FinanceError('employee_id is required', 'EXPENSE_CLAIM_EMPLOYEE_REQUIRED');
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (!lines.length) throw new FinanceError('at least one expense line is required', 'EXPENSE_CLAIM_LINES_EMPTY');
  const id = input.id || `finexpclaim_${crypto.randomUUID()}`;
  const total = round2(lines.reduce((s, l) => s + Number(l.amount || 0) + Number(l.tax_amount || 0), 0));
  dialect.prepare(`
    INSERT INTO finance_expense_claims (id, company_id, employee_id, project_dimension_value_id, currency, total_amount, status, created_at, updated_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)
  `).run(id, companyId, employeeId, input.project_dimension_value_id || null, input.currency || 'IQD', total, now, now, userId);
  const insLine = dialect.prepare(`
    INSERT INTO finance_expense_claim_lines (id, claim_id, company_id, category, expense_account_id, amount, tax_id, tax_amount, expense_date, receipt_fingerprint, description, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const l of lines) {
    assertCompanyMatch(dialect, 'finance_accounts', l.expense_account_id, companyId);
    try {
      insLine.run(`finexpline_${crypto.randomUUID()}`, id, companyId, l.category || 'general', l.expense_account_id, Number(l.amount || 0), l.tax_id || null, Number(l.tax_amount || 0), l.expense_date || now.slice(0, 10), l.receipt_fingerprint || null, l.description || null, now);
    } catch (e) {
      if (String(e.message || '').includes('UNIQUE constraint')) throw new FinanceError('duplicate receipt for this employee', 'EXPENSE_CLAIM_DUPLICATE_RECEIPT');
      throw e;
    }
  }
  return { id, companyId, employee_id: employeeId, total_amount: total, status: 'draft', line_count: lines.length };
}

export function submitExpenseClaim(dialect, ctx, input) {
  const { companyId, now } = context(ctx);
  const claim = dialect.prepare('SELECT * FROM finance_expense_claims WHERE id = ? AND company_id = ?').get(input.claim_id, companyId);
  if (!claim) throw new FinanceError('expense claim not found', 'EXPENSE_CLAIM_NOT_FOUND');
  if (claim.status !== 'draft') throw new FinanceError('only a draft claim can be submitted', 'EXPENSE_CLAIM_STATE_INVALID');
  dialect.prepare("UPDATE finance_expense_claims SET status = 'submitted', submitted_at = ?, updated_at = ? WHERE id = ?").run(now, now, input.claim_id);
  return { id: input.claim_id, status: 'submitted' };
}

export function approveExpenseClaim(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const claim = dialect.prepare('SELECT * FROM finance_expense_claims WHERE id = ? AND company_id = ?').get(input.claim_id, companyId);
  if (!claim) throw new FinanceError('expense claim not found', 'EXPENSE_CLAIM_NOT_FOUND');
  if (claim.status !== 'submitted') throw new FinanceError('only a submitted claim can be approved', 'EXPENSE_CLAIM_STATE_INVALID');
  const lines = dialect.prepare('SELECT * FROM finance_expense_claim_lines WHERE claim_id = ?').all(input.claim_id);
  const overPolicy = lines.some(l => input.over_policy_line_ids?.includes(l.id));
  if (overPolicy && !String(input.override_reason || '').trim()) {
    throw new FinanceError('over-policy lines require an override_reason to approve', 'EXPENSE_CLAIM_OVER_POLICY_APPROVAL_REQUIRED');
  }
  if (!input.reimbursement_account_id) throw new FinanceError('reimbursement_account_id is required', 'EXPENSE_CLAIM_REIMBURSEMENT_ACCOUNT_REQUIRED');
  assertCompanyMatch(dialect, 'finance_accounts', input.reimbursement_account_id, companyId);
  const docLines = lines.map(l => ({
    account_id: l.expense_account_id, debit: round2(Number(l.amount) + Number(l.tax_amount)), credit: 0,
    dims: l.category === 'general' && !claim.project_dimension_value_id ? null : undefined,
    description: l.description || l.category,
  }));
  docLines.push({ account_id: input.reimbursement_account_id, debit: 0, credit: claim.total_amount, partner_id: claim.employee_id });
  const doc = createDocument(dialect, ctx, { move_type: 'manual_entry', doc_date: now.slice(0, 10), partner_id: claim.employee_id, currency: claim.currency, lines: docLines });
  submitDocument(dialect, ctx, { document_id: doc.id });
  approveDocument(dialect, ctx, { document_id: doc.id });
  const posted = postDocument(dialect, ctx, { document_id: doc.id });
  dialect.prepare("UPDATE finance_expense_claims SET status = 'approved', document_id = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?").run(posted.id, userId, now, now, input.claim_id);
  return { id: input.claim_id, status: 'approved', document_id: posted.id };
}

export function rejectExpenseClaim(dialect, ctx, input) {
  const { companyId, now } = context(ctx);
  const claim = dialect.prepare('SELECT * FROM finance_expense_claims WHERE id = ? AND company_id = ?').get(input.claim_id, companyId);
  if (!claim) throw new FinanceError('expense claim not found', 'EXPENSE_CLAIM_NOT_FOUND');
  if (claim.status !== 'submitted') throw new FinanceError('only a submitted claim can be rejected', 'EXPENSE_CLAIM_STATE_INVALID');
  const reason = String(input.reason || '').trim();
  if (!reason) throw new FinanceError('rejection reason is required', 'EXPENSE_CLAIM_REJECTION_REASON_REQUIRED');
  dialect.prepare("UPDATE finance_expense_claims SET status = 'rejected', rejection_reason = ?, updated_at = ? WHERE id = ?").run(reason, now, input.claim_id);
  return { id: input.claim_id, status: 'rejected' };
}

export function issueEmployeeAdvance(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  if (!input.employee_id) throw new FinanceError('employee_id is required', 'ADVANCE_EMPLOYEE_REQUIRED');
  const amount = round2(Number(input.amount));
  if (!(amount > 0)) throw new FinanceError('advance amount must be positive', 'ADVANCE_AMOUNT_INVALID');
  if (!input.control_account_id) throw new FinanceError('control_account_id is required', 'ADVANCE_CONTROL_ACCOUNT_REQUIRED');
  assertCompanyMatch(dialect, 'finance_accounts', input.control_account_id, companyId);
  assertCompanyMatch(dialect, 'finance_accounts', input.cash_or_bank_account_id, companyId);
  const doc = createDocument(dialect, ctx, {
    move_type: 'manual_entry', doc_date: input.issue_date || now.slice(0, 10), partner_id: input.employee_id, currency: input.currency || 'IQD',
    lines: [
      { account_id: input.control_account_id, debit: amount, credit: 0, partner_id: input.employee_id, description: 'Employee advance issued' },
      { account_id: input.cash_or_bank_account_id, debit: 0, credit: amount },
    ],
  });
  submitDocument(dialect, ctx, { document_id: doc.id });
  approveDocument(dialect, ctx, { document_id: doc.id });
  const posted = postDocument(dialect, ctx, { document_id: doc.id });
  const id = input.id || `finadv_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_employee_advances (id, company_id, employee_id, amount, applied_amount, currency, status, document_id, issued_at, created_at, updated_at, created_by)
    VALUES (?, ?, ?, ?, 0, ?, 'issued', ?, ?, ?, ?, ?)
  `).run(id, companyId, input.employee_id, amount, input.currency || 'IQD', posted.id, now, now, now, userId);
  return { id, companyId, employee_id: input.employee_id, amount, status: 'issued', document_id: posted.id };
}

export function settleAdvanceAgainstClaim(dialect, ctx, input) {
  const { companyId, now } = context(ctx);
  const advance = dialect.prepare('SELECT * FROM finance_employee_advances WHERE id = ? AND company_id = ?').get(input.advance_id, companyId);
  if (!advance) throw new FinanceError('advance not found', 'ADVANCE_NOT_FOUND');
  const claim = dialect.prepare('SELECT * FROM finance_expense_claims WHERE id = ? AND company_id = ?').get(input.claim_id, companyId);
  if (!claim) throw new FinanceError('expense claim not found', 'EXPENSE_CLAIM_NOT_FOUND');
  if (claim.status !== 'approved') throw new FinanceError('claim must be approved before advance settlement', 'ADVANCE_SETTLE_CLAIM_NOT_APPROVED');
  const remaining = round2(Number(advance.amount) - Number(advance.applied_amount));
  const amount = round2(input.amount != null ? Number(input.amount) : Math.min(remaining, claim.total_amount));
  if (amount <= 0 || amount > remaining + 0.0001) throw new FinanceError('settlement amount exceeds remaining advance balance', 'ADVANCE_SETTLE_EXCEEDS_REMAINING');
  const newApplied = round2(Number(advance.applied_amount) + amount);
  const status = newApplied >= round2(advance.amount) - 0.005 ? 'settled' : 'partially_settled';
  dialect.prepare('UPDATE finance_employee_advances SET applied_amount = ?, status = ?, updated_at = ? WHERE id = ?').run(newApplied, status, now, input.advance_id);
  return { id: input.advance_id, applied_amount: newApplied, status };
}

// ---------------------------------------------------------------------------
// Wave E — Canonical financial report queries (Packet 03.24)
// ---------------------------------------------------------------------------

export function getProfitAndLoss(dialect, ctx, options = {}) {
  const { companyId } = context(ctx);
  const startDate = options.start_date || null;
  const endDate = options.end_date || null;
  const rows = dialect.prepare(`
    SELECT l.account_id, a.code, a.name, a.type, SUM(l.debit) AS total_debit, SUM(l.credit) AS total_credit
    FROM finance_journal_lines l JOIN finance_accounts a ON a.id = l.account_id
    WHERE l.company_id = ? AND a.type IN ('income','expense')
      AND (? IS NULL OR l.posting_date >= ?) AND (? IS NULL OR l.posting_date <= ?)
    GROUP BY l.account_id ORDER BY a.code
  `).all(companyId, startDate, startDate, endDate, endDate);
  const withNet = rows.map(r => ({ ...r, net: round2(r.type === 'income' ? Number(r.total_credit) - Number(r.total_debit) : Number(r.total_debit) - Number(r.total_credit)) }));
  const income = round2(withNet.filter(r => r.type === 'income').reduce((s, r) => s + r.net, 0));
  const expense = round2(withNet.filter(r => r.type === 'expense').reduce((s, r) => s + r.net, 0));
  return { rows: withNet, totals: { income, expense, net_result: round2(income - expense) } };
}

export function getBalanceSheet(dialect, ctx, options = {}) {
  const { companyId } = context(ctx);
  const asOfDate = options.as_of_date || null;
  const rows = dialect.prepare(`
    SELECT l.account_id, a.code, a.name, a.type, SUM(l.debit - l.credit) AS balance
    FROM finance_journal_lines l JOIN finance_accounts a ON a.id = l.account_id
    WHERE l.company_id = ? AND (? IS NULL OR l.posting_date <= ?)
    GROUP BY l.account_id ORDER BY a.code
  `).all(companyId, asOfDate, asOfDate);
  const sum = types => round2(rows.filter(r => types.includes(r.type)).reduce((s, r) => s + Number(r.balance), 0));
  const assets = sum(['asset', 'receivable', 'liquidity']);
  const liabilities = round2(-sum(['liability', 'payable']));
  const equity = round2(-sum(['equity']));
  const currentResult = round2(-sum(['income']) - sum(['expense']));
  return {
    rows, totals: {
      assets, liabilities, equity, current_result: currentResult,
      liabilities_plus_equity: round2(liabilities + equity + currentResult),
      balanced: Math.abs(assets - liabilities - equity - currentResult) < 0.01,
    },
  };
}

export function getCashFlow(dialect, ctx, options = {}) {
  const { companyId } = context(ctx);
  const startDate = options.start_date || null;
  const endDate = options.end_date || null;
  const rows = dialect.prepare(`
    SELECT l.account_id, a.code, a.name, SUM(l.debit - l.credit) AS net_change
    FROM finance_journal_lines l JOIN finance_accounts a ON a.id = l.account_id
    WHERE l.company_id = ? AND a.type = 'liquidity'
      AND (? IS NULL OR l.posting_date >= ?) AND (? IS NULL OR l.posting_date <= ?)
    GROUP BY l.account_id ORDER BY a.code
  `).all(companyId, startDate, startDate, endDate, endDate);
  return { rows, net_change: round2(rows.reduce((s, r) => s + Number(r.net_change), 0)), method: 'indirect-ledger-derived' };
}

export function getPartnerLedger(dialect, ctx, options = {}) {
  const { companyId } = context(ctx);
  const startDate = options.start_date || null;
  const endDate = options.end_date || null;
  const partnerId = options.partner_id || null;
  const rows = dialect.prepare(`
    SELECT l.partner_id, d.id AS document_id, d.doc_number, d.doc_date, d.move_type, l.account_id, l.debit, l.credit, (l.debit - l.credit) AS net
    FROM finance_journal_lines l JOIN finance_documents d ON d.id = l.document_id
    WHERE l.company_id = ? AND l.partner_id IS NOT NULL
      AND (? IS NULL OR l.partner_id = ?)
      AND (? IS NULL OR d.doc_date >= ?) AND (? IS NULL OR d.doc_date <= ?)
    ORDER BY d.doc_date, d.doc_number, l.id
  `).all(companyId, partnerId, partnerId, startDate, startDate, endDate, endDate);
  return rows;
}

export function getTaxReport(dialect, ctx, options = {}) {
  const { companyId } = context(ctx);
  const startDate = options.start_date || null;
  const endDate = options.end_date || null;
  // Tax amounts are posted onto accounts flagged with a tax_role (Wave A schema);
  // grouping by that column reconciles the tax report to GL by construction
  // without needing a separate tax ledger.
  const rows = dialect.prepare(`
    SELECT a.tax_role, a.id AS account_id, a.code, a.name, SUM(l.debit) AS total_debit, SUM(l.credit) AS total_credit
    FROM finance_journal_lines l JOIN finance_accounts a ON a.id = l.account_id
    WHERE l.company_id = ? AND a.tax_role IS NOT NULL
      AND (? IS NULL OR l.posting_date >= ?) AND (? IS NULL OR l.posting_date <= ?)
    GROUP BY a.id ORDER BY a.code
  `).all(companyId, startDate, startDate, endDate, endDate);
  return rows.map(r => ({ ...r, net: round2(Number(r.total_credit) - Number(r.total_debit)) }));
}

export function getDimensionProfitLoss(dialect, ctx, options = {}) {
  const { companyId } = context(ctx);
  if (!options.dimension_id) throw new FinanceError('dimension_id is required', 'DIMENSION_PNL_DIMENSION_REQUIRED');
  const breakdown = getDimensionBreakdown(dialect, ctx, options);
  const withType = breakdown.map(b => {
    const line = dialect.prepare(`
      SELECT a.type FROM finance_journal_lines l JOIN finance_accounts a ON a.id = l.account_id
      WHERE l.company_id = ? AND l.dims LIKE '%' || ? || '%' AND a.type IN ('income','expense') LIMIT 1
    `).get(companyId, b.dimension_value_id);
    return { ...b, account_type: line?.type || null };
  });
  return { dimension_id: options.dimension_id, rows: withType, total: round2(withType.reduce((s, r) => s + r.net, 0)) };
}

export function getCurrencyRevaluationReport(dialect, ctx, options = {}) {
  const { companyId } = context(ctx);
  const asOfDate = options.as_of_date || null;
  return dialect.prepare(`
    SELECT * FROM finance_fx_revaluation_runs WHERE company_id = ? AND (? IS NULL OR as_of_date <= ?) ORDER BY as_of_date DESC
  `).all(companyId, asOfDate, asOfDate);
}

export function getBankCashReconciliationStatus(dialect, ctx) {
  const { companyId } = context(ctx);
  const bankLines = dialect.prepare(`
    SELECT status, COUNT(*) AS n FROM finance_bank_statement_lines WHERE company_id = ? GROUP BY status
  `).all(companyId);
  const cashShifts = dialect.prepare(`
    SELECT status, COUNT(*) AS n FROM finance_cash_shifts WHERE company_id = ? GROUP BY status
  `).all(companyId);
  return { bank_lines: bankLines, cash_shifts: cashShifts };
}

export function getPeriodCloseStatus(dialect, ctx) {
  const { companyId } = context(ctx);
  const periods = dialect.prepare('SELECT id, name, start_date, end_date, status FROM finance_periods WHERE company_id = ? ORDER BY start_date').all(companyId);
  const locks = dialect.prepare('SELECT module, lock_date FROM finance_locks WHERE company_id = ?').all(companyId);
  return { periods, locks };
}

const REPORT_HANDLERS = {
  trial_balance: (dialect, ctx, options) => getTrialBalance(dialect, ctx, options),
  general_ledger: (dialect, ctx, options) => getGeneralLedger(dialect, ctx, options.account_id, options),
  profit_loss: (dialect, ctx, options) => getProfitAndLoss(dialect, ctx, options),
  balance_sheet: (dialect, ctx, options) => getBalanceSheet(dialect, ctx, options),
  cash_flow: (dialect, ctx, options) => getCashFlow(dialect, ctx, options),
  ar_aging: (dialect, ctx, options) => getCustomerAging(dialect, ctx, options),
  ap_aging: (dialect, ctx, options) => getSupplierAging(dialect, ctx, options),
  partner_ledger: (dialect, ctx, options) => getPartnerLedger(dialect, ctx, options),
  tax_report: (dialect, ctx, options) => getTaxReport(dialect, ctx, options),
  dimension_pnl: (dialect, ctx, options) => getDimensionProfitLoss(dialect, ctx, options),
  currency_revaluation: (dialect, ctx, options) => getCurrencyRevaluationReport(dialect, ctx, options),
  bank_reconciliation_status: (dialect, ctx) => getBankCashReconciliationStatus(dialect, ctx),
  budget_vs_actual: (dialect, ctx, options) => getBudgetVariance(dialect, ctx, options),
  period_close_status: (dialect, ctx) => getPeriodCloseStatus(dialect, ctx),
};

export function runReport(dialect, ctx, input) {
  const { companyId } = context(ctx);
  const code = input.report_code;
  const def = dialect.prepare('SELECT * FROM finance_report_definitions WHERE code = ?').get(code);
  if (!def) throw new FinanceError(`unknown report_code: ${code}`, 'REPORT_NOT_FOUND');
  const handler = REPORT_HANDLERS[code];
  if (!handler) throw new FinanceError(`report handler not implemented for ${code}`, 'REPORT_NOT_IMPLEMENTED');
  return handler(dialect, ctx, input.params || {});
}

export function snapshotReport(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const data = runReport(dialect, ctx, input);
  const paramsJson = JSON.stringify(input.params || {});
  const paramsHash = crypto.createHash('sha256').update(`${input.report_code}|${paramsJson}`).digest('hex');
  const id = `finreportsnap_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_report_snapshots (id, company_id, report_code, params_hash, params_json, data_json, generated_at, generated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, companyId, input.report_code, paramsHash, paramsJson, JSON.stringify(data), now, userId);
  return { id, report_code: input.report_code, generated_at: now, data };
}

// ---------------------------------------------------------------------------
// Wave E — Asset-accounting interface for Phase 05 (Packet 03.26)
// ---------------------------------------------------------------------------

export function createAssetCategory(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const code = String(input.code || '').trim();
  const name = String(input.name || '').trim();
  if (!code) throw new FinanceError('asset category code is required', 'ASSET_CATEGORY_CODE_REQUIRED');
  if (!name) throw new FinanceError('asset category name is required', 'ASSET_CATEGORY_NAME_REQUIRED');
  for (const field of ['asset_account_id', 'depreciation_expense_account_id', 'accumulated_depreciation_account_id']) {
    if (!input[field]) throw new FinanceError(`${field} is required`, 'ASSET_CATEGORY_ACCOUNT_REQUIRED');
    assertCompanyMatch(dialect, 'finance_accounts', input[field], companyId);
  }
  const id = input.id || `finassetcat_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_asset_categories (id, company_id, code, name, asset_account_id, depreciation_expense_account_id, accumulated_depreciation_account_id, disposal_gain_account_id, disposal_loss_account_id, default_method, is_active, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, companyId, code, name, input.asset_account_id, input.depreciation_expense_account_id, input.accumulated_depreciation_account_id, input.disposal_gain_account_id || null, input.disposal_loss_account_id || null, input.default_method || 'straight_line', 1, now, userId);
  return { id, companyId, code, name };
}

function postAssetContract(dialect, ctx, moveType, categoryId, lines, extra = {}) {
  const { companyId } = context(ctx);
  const category = dialect.prepare('SELECT * FROM finance_asset_categories WHERE id = ? AND company_id = ?').get(categoryId, companyId);
  if (!category) throw new FinanceError('asset category not found', 'ASSET_CATEGORY_NOT_FOUND');
  const doc = createDocument(dialect, ctx, { move_type: moveType, doc_date: extra.doc_date || new Date().toISOString().slice(0, 10), lines, source_type: 'asset_event', source_canonical_key: extra.asset_reference ? `${moveType}:${extra.asset_reference}` : undefined });
  submitDocument(dialect, ctx, { document_id: doc.id });
  approveDocument(dialect, ctx, { document_id: doc.id });
  return { category, posted: postDocument(dialect, ctx, { document_id: doc.id }) };
}

export function capitalizeAsset(dialect, ctx, input) {
  const { companyId } = context(ctx);
  const category = dialect.prepare('SELECT * FROM finance_asset_categories WHERE id = ? AND company_id = ?').get(input.category_id, companyId);
  if (!category) throw new FinanceError('asset category not found', 'ASSET_CATEGORY_NOT_FOUND');
  if (!input.source_account_id) throw new FinanceError('source_account_id is required', 'ASSET_CAPITALIZE_SOURCE_REQUIRED');
  assertCompanyMatch(dialect, 'finance_accounts', input.source_account_id, companyId);
  const amount = round2(Number(input.amount));
  if (!(amount > 0)) throw new FinanceError('capitalization amount must be positive', 'ASSET_CAPITALIZE_AMOUNT_INVALID');
  const { posted } = postAssetContract(dialect, ctx, 'manual_entry', input.category_id, [
    { account_id: category.asset_account_id, debit: amount, credit: 0, description: `Asset capitalization ${input.asset_reference}` },
    { account_id: input.source_account_id, debit: 0, credit: amount },
  ], { doc_date: input.doc_date, asset_reference: input.asset_reference });
  return { document_id: posted.id, category_id: category.id, amount };
}

export function postAssetDepreciation(dialect, ctx, input) {
  const { companyId } = context(ctx);
  const category = dialect.prepare('SELECT * FROM finance_asset_categories WHERE id = ? AND company_id = ?').get(input.category_id, companyId);
  if (!category) throw new FinanceError('asset category not found', 'ASSET_CATEGORY_NOT_FOUND');
  const amount = round2(Number(input.amount));
  if (!(amount > 0)) throw new FinanceError('depreciation amount must be positive', 'ASSET_DEPRECIATION_AMOUNT_INVALID');
  const { posted } = postAssetContract(dialect, ctx, 'manual_entry', input.category_id, [
    { account_id: category.depreciation_expense_account_id, debit: amount, credit: 0, description: `Depreciation ${input.asset_reference}` },
    { account_id: category.accumulated_depreciation_account_id, debit: 0, credit: amount },
  ], { doc_date: input.doc_date, asset_reference: input.asset_reference });
  return { document_id: posted.id, category_id: input.category_id, amount };
}

export function disposeAsset(dialect, ctx, input) {
  const { companyId } = context(ctx);
  const category = dialect.prepare('SELECT * FROM finance_asset_categories WHERE id = ? AND company_id = ?').get(input.category_id, companyId);
  if (!category) throw new FinanceError('asset category not found', 'ASSET_CATEGORY_NOT_FOUND');
  if (!input.proceeds_account_id) throw new FinanceError('proceeds_account_id is required', 'ASSET_DISPOSE_PROCEEDS_ACCOUNT_REQUIRED');
  assertCompanyMatch(dialect, 'finance_accounts', input.proceeds_account_id, companyId);
  const netBookValue = round2(Number(input.net_book_value));
  const proceeds = round2(Number(input.proceeds));
  const gain = round2(Math.max(0, proceeds - netBookValue));
  const loss = round2(Math.max(0, netBookValue - proceeds));
  if (gain > 0 && !category.disposal_gain_account_id) throw new FinanceError('category has no disposal_gain_account_id configured', 'ASSET_DISPOSE_GAIN_ACCOUNT_MISSING');
  if (loss > 0 && !category.disposal_loss_account_id) throw new FinanceError('category has no disposal_loss_account_id configured', 'ASSET_DISPOSE_LOSS_ACCOUNT_MISSING');
  const lines = [
    { account_id: input.proceeds_account_id, debit: proceeds, credit: 0, description: `Asset disposal proceeds ${input.asset_reference}` },
    { account_id: category.asset_account_id, debit: 0, credit: netBookValue, description: `Asset disposal ${input.asset_reference}` },
  ];
  if (gain > 0) lines.push({ account_id: category.disposal_gain_account_id, debit: 0, credit: gain, description: 'Gain on disposal' });
  if (loss > 0) lines.push({ account_id: category.disposal_loss_account_id, debit: loss, credit: 0, description: 'Loss on disposal' });
  const { posted } = postAssetContract(dialect, ctx, 'manual_entry', input.category_id, lines, { doc_date: input.doc_date, asset_reference: input.asset_reference });
  return { document_id: posted.id, category_id: input.category_id, net_book_value: netBookValue, proceeds, gain, loss };
}

// ---------------------------------------------------------------------------
// Wave F — Legacy finance bridge and opening-balance migration (Packet 03.27)
// ---------------------------------------------------------------------------
//
// Every function below takes legacy records as plain JS input (arrays of
// objects). None of them reach into the live application store
// (PentagonDB / database.db) themselves — that keeps this code fully testable
// against synthetic fixtures. A future live run is: read
// PentagonDB.getCached().finance.accounts / .account_moves (read-only), then
// call migrateLegacyAccounts / migrateLegacyMoves with that data. That live
// read-and-call step has not been performed against production data; see
// docs/evidence/phase-03/legacy-migration-report.md.

const LEGACY_ACCOUNT_TYPE_MAP = {
  asset: 'asset', assets: 'asset',
  liability: 'liability', liabilities: 'liability',
  equity: 'equity',
  income: 'income', revenue: 'income',
  expense: 'expense', expenses: 'expense',
  receivable: 'receivable', receivables: 'receivable',
  payable: 'payable', payables: 'payable',
  cash: 'liquidity', bank: 'liquidity', liquidity: 'liquidity',
  off_balance: 'off_balance',
};

export function mapLegacyAccountType(legacyType) {
  const key = String(legacyType || '').trim().toLowerCase();
  return LEGACY_ACCOUNT_TYPE_MAP[key] || null;
}

function startMigrationRun(dialect, companyId, userId, now, runType, sourceCount) {
  const id = `finmigrun_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO finance_migration_runs (id, company_id, run_type, status, source_count, started_at, started_by, created_at)
    VALUES (?, ?, ?, 'running', ?, ?, ?, ?)
  `).run(id, companyId, runType, sourceCount, now, userId, now);
  return id;
}

function finishMigrationRun(dialect, runId, imported, skipped, quarantined, now) {
  dialect.prepare(`
    UPDATE finance_migration_runs SET status = 'completed', imported_count = ?, skipped_count = ?, quarantined_count = ?, completed_at = ? WHERE id = ?
  `).run(imported, skipped, quarantined, now, runId);
}

function quarantineRecord(dialect, companyId, runId, sourceSystem, sourceId, reason, rawData, now) {
  dialect.prepare(`
    INSERT INTO finance_migration_quarantine (id, company_id, migration_run_id, source_system, source_id, reason, raw_data_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(`finmigq_${crypto.randomUUID()}`, companyId, runId, sourceSystem, sourceId || null, reason, JSON.stringify(rawData), now);
}

function recordSourceMapping(dialect, companyId, runId, sourceSystem, sourceId, canonicalId, canonicalTable, now) {
  dialect.prepare(`
    INSERT INTO finance_migration_source_map (id, company_id, source_system, source_id, canonical_id, canonical_table, migration_run_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(`finmigmap_${crypto.randomUUID()}`, companyId, sourceSystem, sourceId, canonicalId, canonicalTable, runId, now);
}

export function getMigrationSourceMapping(dialect, ctx, input) {
  const { companyId } = context(ctx);
  return dialect.prepare('SELECT * FROM finance_migration_source_map WHERE company_id = ? AND source_system = ? AND source_id = ?').get(companyId, input.source_system, String(input.source_id));
}

export function migrateLegacyAccounts(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const records = Array.isArray(input.legacy_accounts) ? input.legacy_accounts : [];
  const runId = startMigrationRun(dialect, companyId, userId, now, 'accounts', records.length);
  let imported = 0;
  let skipped = 0;
  let quarantined = 0;
  // Two passes: create accounts without parent linkage first (so a child
  // referencing a not-yet-created legacy parent doesn't fail), then patch
  // parent_id once every account in this batch has a canonical mapping.
  const createdBySourceId = {};
  for (const rec of records) {
    const sourceId = String(rec.id ?? rec.code ?? '');
    const existing = sourceId ? getMigrationSourceMapping(dialect, ctx, { source_system: 'legacy_account', source_id: sourceId }) : null;
    if (existing) { skipped++; createdBySourceId[sourceId] = existing.canonical_id; continue; }
    const canonicalType = mapLegacyAccountType(rec.type);
    if (!rec.code || !rec.name || !canonicalType) {
      quarantineRecord(dialect, companyId, runId, 'legacy_account', sourceId, !canonicalType ? `unmappable account type: ${rec.type}` : 'missing code or name', rec, now);
      quarantined++;
      continue;
    }
    try {
      const created = createAccount(dialect, ctx, { code: rec.code, name: rec.name, name_ar: rec.name_ar, type: canonicalType, is_reconcilable: !!rec.is_reconcilable });
      recordSourceMapping(dialect, companyId, runId, 'legacy_account', sourceId, created.id, 'finance_accounts', now);
      createdBySourceId[sourceId] = created.id;
      imported++;
    } catch (e) {
      quarantineRecord(dialect, companyId, runId, 'legacy_account', sourceId, e.message || 'account creation failed', rec, now);
      quarantined++;
    }
  }
  for (const rec of records) {
    const sourceId = String(rec.id ?? rec.code ?? '');
    if (!rec.parent_id || !createdBySourceId[sourceId]) continue;
    const parentCanonicalId = createdBySourceId[String(rec.parent_id)];
    if (parentCanonicalId) {
      dialect.prepare('UPDATE finance_accounts SET parent_id = ? WHERE id = ? AND company_id = ?').run(parentCanonicalId, createdBySourceId[sourceId], companyId);
    }
  }
  finishMigrationRun(dialect, runId, imported, skipped, quarantined, now);
  return { run_id: runId, source_count: records.length, imported, skipped, quarantined };
}

export function migrateLegacyMoves(dialect, ctx, input) {
  const { companyId, userId, now } = context(ctx);
  const records = Array.isArray(input.legacy_moves) ? input.legacy_moves : [];
  const runId = startMigrationRun(dialect, companyId, userId, now, 'moves', records.length);
  let imported = 0;
  let skipped = 0;
  let quarantined = 0;
  for (const rec of records) {
    const sourceId = String(rec.id ?? '');
    const existing = sourceId ? getMigrationSourceMapping(dialect, ctx, { source_system: 'legacy_move', source_id: sourceId }) : null;
    if (existing) { skipped++; continue; }
    const lines = Array.isArray(rec.lines) ? rec.lines : [];
    if (!sourceId || !rec.date || !lines.length) {
      quarantineRecord(dialect, companyId, runId, 'legacy_move', sourceId, 'missing id, date, or lines', rec, now);
      quarantined++;
      continue;
    }
    let resolvedLines;
    try {
      resolvedLines = lines.map(l => {
        const mapping = getMigrationSourceMapping(dialect, ctx, { source_system: 'legacy_account', source_id: String(l.account_id) });
        if (!mapping) throw new Error(`legacy account ${l.account_id} was not migrated (import accounts first)`);
        return { account_id: mapping.canonical_id, debit: Number(l.debit || 0), credit: Number(l.credit || 0), partner_id: l.partner_id || null, description: l.description || null };
      });
      const totalDebit = round2(resolvedLines.reduce((s, l) => s + l.debit, 0));
      const totalCredit = round2(resolvedLines.reduce((s, l) => s + l.credit, 0));
      if (Math.abs(totalDebit - totalCredit) > 0.01) throw new Error(`unbalanced move: debit ${totalDebit} != credit ${totalCredit}`);
    } catch (e) {
      quarantineRecord(dialect, companyId, runId, 'legacy_move', sourceId, e.message, rec, now);
      quarantined++;
      continue;
    }
    try {
      const doc = createDocument(dialect, ctx, {
        move_type: 'manual_entry', doc_date: String(rec.date).slice(0, 10), currency: rec.currency || 'IQD',
        source_type: 'legacy_migration', source_id: sourceId, source_canonical_key: `legacy_move:${sourceId}`,
        lines: resolvedLines,
      });
      submitDocument(dialect, ctx, { document_id: doc.id });
      approveDocument(dialect, ctx, { document_id: doc.id });
      const posted = postDocument(dialect, ctx, { document_id: doc.id });
      recordSourceMapping(dialect, companyId, runId, 'legacy_move', sourceId, posted.id, 'finance_documents', now);
      imported++;
    } catch (e) {
      quarantineRecord(dialect, companyId, runId, 'legacy_move', sourceId, e.message || 'posting failed', rec, now);
      quarantined++;
    }
  }
  finishMigrationRun(dialect, runId, imported, skipped, quarantined, now);
  return { run_id: runId, source_count: records.length, imported, skipped, quarantined };
}

export function reconcileMigrationTrialBalance(dialect, ctx, input) {
  const canonical = getTrialBalance(dialect, ctx, {});
  const legacy = Array.isArray(input.legacy_trial_balance) ? input.legacy_trial_balance : [];
  const byCode = new Map(canonical.map(r => [r.code, r.balance]));
  const diffs = legacy.map(l => {
    const canonicalBalance = byCode.get(l.code) ?? 0;
    const diff = round2(Number(canonicalBalance) - Number(l.balance || 0));
    return { code: l.code, legacy_balance: Number(l.balance || 0), canonical_balance: round2(canonicalBalance), diff, reconciled: Math.abs(diff) < 0.01 };
  });
  return { rows: diffs, fully_reconciled: diffs.every(d => d.reconciled) };
}

export function getMigrationQuarantine(dialect, ctx, input) {
  const { companyId } = context(ctx);
  return dialect.prepare('SELECT * FROM finance_migration_quarantine WHERE company_id = ? AND migration_run_id = ? ORDER BY created_at').all(companyId, input.migration_run_id);
}

export function getMigrationRunStatus(dialect, ctx, input) {
  const { companyId } = context(ctx);
  return dialect.prepare('SELECT * FROM finance_migration_runs WHERE company_id = ? AND id = ?').get(companyId, input.migration_run_id);
}

export function rollbackMigrationRun(dialect, ctx, input) {
  const { companyId, now } = context(ctx);
  const run = dialect.prepare('SELECT * FROM finance_migration_runs WHERE id = ? AND company_id = ?').get(input.migration_run_id, companyId);
  if (!run) throw new FinanceError('migration run not found', 'MIGRATION_RUN_NOT_FOUND');
  if (run.status !== 'completed') throw new FinanceError('only a completed run can be rolled back', 'MIGRATION_RUN_NOT_COMPLETED');
  const mappings = dialect.prepare("SELECT * FROM finance_migration_source_map WHERE migration_run_id = ? AND canonical_table = 'finance_documents'").all(input.migration_run_id);
  let reversed = 0;
  for (const m of mappings) {
    const doc = dialect.prepare('SELECT state FROM finance_documents WHERE id = ?').get(m.canonical_id);
    if (doc && doc.state === 'posted') {
      reverseDocument(dialect, ctx, { document_id: m.canonical_id, reason: `rollback of migration run ${run.id}` });
      reversed++;
    }
  }
  dialect.prepare("UPDATE finance_migration_runs SET status = 'rolled_back', completed_at = ? WHERE id = ?").run(now, input.migration_run_id);
  return { run_id: input.migration_run_id, status: 'rolled_back', documents_reversed: reversed };
}

// ---------------------------------------------------------------------------
// Wave F — Cross-module accounting test adapters (Packet 03.28)
// ---------------------------------------------------------------------------

export function postSourceFact(dialect, ctx, input) {
  const { companyId } = context(ctx);
  const schema = dialect.prepare('SELECT * FROM finance_source_fact_schemas WHERE fact_type = ?').get(input.fact_type);
  if (!schema) throw new FinanceError(`unknown source fact_type: ${input.fact_type}`, 'SOURCE_FACT_TYPE_UNKNOWN');
  const required = JSON.parse(schema.required_fields);
  for (const field of required) {
    if (input[field] === undefined || input[field] === null) throw new FinanceError(`source fact missing required field: ${field}`, 'SOURCE_FACT_FIELD_MISSING');
  }
  if (!Array.isArray(input.lines) || !input.lines.length) throw new FinanceError('source fact must include at least one line', 'SOURCE_FACT_LINES_EMPTY');
  const doc = createDocument(dialect, ctx, {
    move_type: input.move_type || 'source_post',
    doc_date: input.doc_date,
    partner_id: input.partner_id || null,
    currency: input.currency || 'IQD',
    source_type: input.fact_type,
    source_id: String(input.source_id),
    source_canonical_key: `${input.fact_type}:${input.source_id}`,
    lines: input.lines,
  });
  submitDocument(dialect, ctx, { document_id: doc.id });
  approveDocument(dialect, ctx, { document_id: doc.id });
  const posted = postDocument(dialect, ctx, { document_id: doc.id });
  return { document_id: posted.id, fact_type: input.fact_type, source_id: String(input.source_id), schema_version: schema.schema_version };
}

export function reverseSourceFact(dialect, ctx, input) {
  return reverseDocument(dialect, ctx, { document_id: input.document_id, reason: input.reason || 'source fact reversal' });
}

export { ACCOUNT_TYPES, JOURNAL_TYPES, DOCUMENT_TYPES };
