import assert from 'node:assert';
import { setup, cleanup, seedOrg } from '../phase02/harness.mjs';
import { createActionExecutor } from '../../platform/kernel/actions/index.mjs';
import { registerFinanceActions, seedChartOfAccounts, accountIdByCode } from '../../platform/finance/index.mjs';
import {
  createDocument, submitDocument, approveDocument, postDocument,
  createPayment, postPayment, reversePaymentAction,
  allocatePayment, unallocatePayment, writeOffOpenItem,
  openReconciliationSession, suggestReconciliationCandidates, confirmReconciliationMatch, undoReconciliationMatch, closeReconciliationSession,
  createBankAccount, createBankMatchRule, importBankStatement, matchBankStatementLine, manualReconcileBankLine, recordBankDifference, unreconcileBankLine,
  createCashbox, openCashShift, recordCashCount, closeCashShift,
  createPaymentTermTemplate, generateDueScheduleFromTerm,
  setCreditProfile, holdCredit, releaseCreditHold, getCreditExposure,
  getCustomerOpenItems, getCustomerAging,
} from '../../platform/finance/engine.mjs';

const SUITE = 'finance-wave-d';

async function setupFinance() {
  const { dialect, dbPath } = await setup(SUITE);
  const org = seedOrg(dialect);
  seedChartOfAccounts(dialect, { companyId: org.companyA1, userId: 'u_owner' });
  const executor = createActionExecutor(dialect);
  registerFinanceActions(executor);
  return { dialect, dbPath, org, executor };
}

function postInvoice(dialect, ctx, receivable, income, amount, partnerId, date = '2026-04-01') {
  const doc = createDocument(dialect, ctx, {
    move_type: 'customer_invoice', doc_date: date, partner_id: partnerId,
    lines: [{ account_id: receivable, debit: amount, credit: 0 }, { account_id: income, debit: 0, credit: amount }],
  });
  submitDocument(dialect, ctx, { document_id: doc.id });
  approveDocument(dialect, ctx, { document_id: doc.id });
  return postDocument(dialect, ctx, { document_id: doc.id });
}

function postBill(dialect, ctx, payable, expense, amount, partnerId, date = '2026-04-01') {
  const doc = createDocument(dialect, ctx, {
    move_type: 'supplier_bill', doc_date: date, partner_id: partnerId,
    lines: [{ account_id: expense, debit: amount, credit: 0 }, { account_id: payable, debit: 0, credit: amount }],
  });
  submitDocument(dialect, ctx, { document_id: doc.id });
  approveDocument(dialect, ctx, { document_id: doc.id });
  return postDocument(dialect, ctx, { document_id: doc.id });
}

async function run() {
  const failures = [];
  const tests = [
    // --- Payment documents (Packet 03.15) ---

    ['payment creation is idempotent by key (duplicate reference is a replay, not a new row)', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        const p1 = createPayment(dialect, ctx, { payment_type: 'receive', method: 'cash', amount: 500, cash_or_bank_account_id: cash, counter_account_id: receivable, partner_id: 'cust_pay', idempotency_key: 'pay-key-1' });
        const p2 = createPayment(dialect, ctx, { payment_type: 'receive', method: 'cash', amount: 500, cash_or_bank_account_id: cash, counter_account_id: receivable, partner_id: 'cust_pay', idempotency_key: 'pay-key-1' });
        assert.strictEqual(p2.replayed, true);
        assert.strictEqual(p2.id, p1.id);
        const count = dialect.prepare('SELECT COUNT(*) AS n FROM finance_payments WHERE company_id = ?').get(org.companyA1).n;
        assert.strictEqual(count, 1);
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['unsupported payment method is rejected', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        assert.throws(() => createPayment(dialect, ctx, { payment_type: 'receive', method: 'crypto', amount: 100, cash_or_bank_account_id: cash, counter_account_id: receivable, idempotency_key: 'bad-method' }), /unsupported payment method/);
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['cross-currency payment posts balanced local and foreign totals', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const bank = accountIdByCode(dialect, org.companyA1, '102000');
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        const payment = createPayment(dialect, ctx, {
          payment_type: 'receive', method: 'bank', amount: 100, currency: 'USD', fx_rate: 1300,
          cash_or_bank_account_id: bank, counter_account_id: receivable, partner_id: 'cust_fx', idempotency_key: 'fx-pay-1',
        });
        postPayment(dialect, ctx, { payment_id: payment.id });
        const lines = dialect.prepare('SELECT SUM(debit) d, SUM(credit) c FROM finance_journal_lines WHERE document_id = ?').get(payment.document_id);
        assert.strictEqual(lines.d, 130000);
        assert.strictEqual(lines.c, 130000);
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['fee posting reduces net cash received without breaking balance', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        const feeAcc = accountIdByCode(dialect, org.companyA1, '502000');
        const payment = createPayment(dialect, ctx, {
          payment_type: 'receive', method: 'bank', amount: 1000, fee_amount: 20, fee_account_id: feeAcc,
          cash_or_bank_account_id: cash, counter_account_id: receivable, partner_id: 'cust_fee', idempotency_key: 'fee-pay-1',
        });
        postPayment(dialect, ctx, { payment_id: payment.id });
        const cashLine = dialect.prepare('SELECT debit FROM finance_journal_lines WHERE document_id = ? AND account_id = ?').get(payment.document_id, cash);
        assert.strictEqual(cashLine.debit, 980);
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['internal transfer clears between two cash/bank accounts', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const bank = accountIdByCode(dialect, org.companyA1, '102000');
        const payment = createPayment(dialect, ctx, {
          payment_type: 'transfer', method: 'clearing', amount: 300,
          cash_or_bank_account_id: cash, counter_account_id: bank, idempotency_key: 'xfer-1',
        });
        const posted = postPayment(dialect, ctx, { payment_id: payment.id });
        assert.strictEqual(posted.status, 'posted');
        const doc = dialect.prepare('SELECT move_type, state FROM finance_documents WHERE id = ?').get(payment.document_id);
        assert.strictEqual(doc.move_type, 'internal_transfer');
        assert.strictEqual(doc.state, 'posted');
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['payment reversal requires full unallocation first, then reverses cleanly', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        const invoice = postInvoice(dialect, ctx, receivable, income, 400, 'cust_rev');
        const payment = createPayment(dialect, ctx, { payment_type: 'receive', method: 'cash', amount: 400, cash_or_bank_account_id: cash, counter_account_id: receivable, partner_id: 'cust_rev', idempotency_key: 'rev-pay-1' });
        postPayment(dialect, ctx, { payment_id: payment.id });
        const alloc = allocatePayment(dialect, ctx, { payment_id: payment.id, document_id: invoice.id, amount: 400 });
        assert.throws(() => reversePaymentAction(dialect, ctx, { payment_id: payment.id }), /unallocate this payment fully/);
        unallocatePayment(dialect, ctx, { allocation_id: alloc.id });
        const reversed = reversePaymentAction(dialect, ctx, { payment_id: payment.id });
        assert.strictEqual(reversed.status, 'cancelled');
      } finally { await cleanup(dialect, dbPath); }
    }],

    // --- Allocation, advances, refunds, write-offs (Packet 03.16) ---

    ['over-allocation is denied atomically; partial allocation leaves a correct unallocated balance', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        const invoice = postInvoice(dialect, ctx, receivable, income, 1000, 'cust_alloc');
        const payment = createPayment(dialect, ctx, { payment_type: 'receive', method: 'cash', amount: 600, cash_or_bank_account_id: cash, counter_account_id: receivable, partner_id: 'cust_alloc', idempotency_key: 'alloc-pay-1' });
        postPayment(dialect, ctx, { payment_id: payment.id });
        assert.throws(() => allocatePayment(dialect, ctx, { payment_id: payment.id, document_id: invoice.id, amount: 700 }), /exceeds unallocated payment amount/);
        allocatePayment(dialect, ctx, { payment_id: payment.id, document_id: invoice.id, amount: 600 });
        const row = dialect.prepare('SELECT unallocated_amount FROM finance_payments WHERE id = ?').get(payment.id);
        assert.strictEqual(row.unallocated_amount, 0);
        const open = getCustomerOpenItems(dialect, ctx, { partner_id: 'cust_alloc' });
        assert.strictEqual(open[0].open_amount, 400);
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['unallocate/reallocate preserves lineage and restores balances (advance-then-apply)', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        const invoice = postInvoice(dialect, ctx, receivable, income, 500, 'cust_adv');
        // Advance received before allocation (unapplied credit).
        const payment = createPayment(dialect, ctx, { payment_type: 'receive', method: 'cash', amount: 500, cash_or_bank_account_id: cash, counter_account_id: receivable, partner_id: 'cust_adv', idempotency_key: 'adv-pay-1' });
        postPayment(dialect, ctx, { payment_id: payment.id });
        assert.strictEqual(dialect.prepare('SELECT unallocated_amount FROM finance_payments WHERE id = ?').get(payment.id).unallocated_amount, 500);
        const alloc = allocatePayment(dialect, ctx, { payment_id: payment.id, document_id: invoice.id, amount: 500 });
        unallocatePayment(dialect, ctx, { allocation_id: alloc.id });
        assert.strictEqual(dialect.prepare('SELECT unallocated_amount FROM finance_payments WHERE id = ?').get(payment.id).unallocated_amount, 500);
        assert.throws(() => unallocatePayment(dialect, ctx, { allocation_id: alloc.id }), /already unallocated/);
        allocatePayment(dialect, ctx, { payment_id: payment.id, document_id: invoice.id, amount: 500 });
        const allocRows = dialect.prepare('SELECT COUNT(*) AS n FROM finance_payment_allocations WHERE payment_id = ?').get(payment.id).n;
        assert.strictEqual(allocRows, 3); // original + reversal + reallocation, full lineage preserved
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['write-off requires approval fields and posts a balancing document', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        const expense = accountIdByCode(dialect, org.companyA1, '502000');
        const invoice = postInvoice(dialect, ctx, receivable, income, 50, 'cust_wo');
        assert.throws(() => writeOffOpenItem(dialect, ctx, { document_id: invoice.id, write_off_account_id: expense, reason: '' }), /reason is required/);
        const wo = writeOffOpenItem(dialect, ctx, { document_id: invoice.id, write_off_account_id: expense, reason: 'uncollectible - small balance' });
        assert.ok(wo.write_off_document_id);
        const open = getCustomerOpenItems(dialect, ctx, { partner_id: 'cust_wo' });
        assert.strictEqual(open.length, 0);
      } finally { await cleanup(dialect, dbPath); }
    }],

    // --- Open-item reconciliation engine (Packet 03.17) ---

    ['reconciliation session: exact match suggestion, confirm, and undo', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        const invoice = postInvoice(dialect, ctx, receivable, income, 750, 'cust_recon');
        const payment = createPayment(dialect, ctx, { payment_type: 'receive', method: 'cash', amount: 750, cash_or_bank_account_id: cash, counter_account_id: receivable, partner_id: 'cust_recon', idempotency_key: 'recon-pay-1' });
        postPayment(dialect, ctx, { payment_id: payment.id });

        const session = openReconciliationSession(dialect, ctx, { target_type: 'ar', partner_id: 'cust_recon' });
        const suggestions = suggestReconciliationCandidates(dialect, ctx, { session_id: session.id });
        assert.strictEqual(suggestions.length, 1);
        assert.strictEqual(suggestions[0].method, 'exact');
        const match = confirmReconciliationMatch(dialect, ctx, { session_id: session.id, document_id: invoice.id, payment_id: payment.id, amount: 750, method: 'exact' });
        assert.strictEqual(getCustomerOpenItems(dialect, ctx, { partner_id: 'cust_recon' }).length, 0);
        undoReconciliationMatch(dialect, ctx, { match_id: match.id });
        assert.strictEqual(getCustomerOpenItems(dialect, ctx, { partner_id: 'cust_recon' })[0].open_amount, 750);
        assert.throws(() => undoReconciliationMatch(dialect, ctx, { match_id: match.id }), /already undone/);
        closeReconciliationSession(dialect, ctx, { session_id: session.id });
        assert.throws(() => confirmReconciliationMatch(dialect, ctx, { session_id: session.id, document_id: invoice.id, payment_id: payment.id, amount: 750 }), /session is closed/);
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['aging reconciles to GL after reconciliation-session allocation (full payment cycle)', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        const invoice = postInvoice(dialect, ctx, receivable, income, 300, 'cust_full', '2026-04-01');
        const payment = createPayment(dialect, ctx, { payment_type: 'receive', method: 'cash', amount: 300, cash_or_bank_account_id: cash, counter_account_id: receivable, partner_id: 'cust_full', idempotency_key: 'full-pay-1' });
        postPayment(dialect, ctx, { payment_id: payment.id });
        allocatePayment(dialect, ctx, { payment_id: payment.id, document_id: invoice.id, amount: 300 });
        const aging = getCustomerAging(dialect, ctx, { partner_id: 'cust_full', as_of_date: '2026-04-20' });
        assert.strictEqual(aging.total, 0);
      } finally { await cleanup(dialect, dbPath); }
    }],

    // --- Banking and statement import (Packet 03.18) ---

    ['repeated import of the same batch is a no-op; duplicate line within a new import is rejected', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const bankGl = accountIdByCode(dialect, org.companyA1, '102000');
        const bankAcc = createBankAccount(dialect, ctx, { name: 'Main Bank', gl_account_id: bankGl });
        const line = { transaction_date: '2026-04-01', amount: 500, description: 'Wire from customer', external_id: 'EXT-1' };
        const first = importBankStatement(dialect, ctx, { bank_account_id: bankAcc.id, import_key: 'BATCH-1', statement_date: '2026-04-01', lines: [line] });
        assert.strictEqual(first.duplicate, false);
        assert.strictEqual(first.imported, 1);
        const repeat = importBankStatement(dialect, ctx, { bank_account_id: bankAcc.id, import_key: 'BATCH-1', statement_date: '2026-04-01', lines: [line] });
        assert.strictEqual(repeat.duplicate, true);
        assert.throws(() => importBankStatement(dialect, ctx, { bank_account_id: bankAcc.id, import_key: 'BATCH-2', statement_date: '2026-04-01', lines: [line] }), /duplicate statement line import/);
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['malformed statement line (bad amount) is rejected', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const bankGl = accountIdByCode(dialect, org.companyA1, '102000');
        const bankAcc = createBankAccount(dialect, ctx, { name: 'Main Bank', gl_account_id: bankGl });
        assert.throws(() => importBankStatement(dialect, ctx, { bank_account_id: bankAcc.id, import_key: 'BATCH-BAD', statement_date: '2026-04-01', lines: [{ transaction_date: '2026-04-01', amount: 'not-a-number' }] }), /malformed statement line/);
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['auto-match by amount within tolerance, then unmatch restores the line', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const bankGlAcc = accountIdByCode(dialect, org.companyA1, '102000');
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        const payment = createPayment(dialect, ctx, { payment_type: 'receive', method: 'bank', amount: 998, cash_or_bank_account_id: cash, counter_account_id: receivable, partner_id: 'cust_bank', idempotency_key: 'bank-pay-1' });
        postPayment(dialect, ctx, { payment_id: payment.id });
        const bankAcc = createBankAccount(dialect, ctx, { name: 'Main Bank', gl_account_id: bankGlAcc });
        const rule = createBankMatchRule(dialect, ctx, { name: 'Tolerance rule', amount_tolerance: 5 });
        const stmt = importBankStatement(dialect, ctx, { bank_account_id: bankAcc.id, import_key: 'BATCH-MATCH', statement_date: '2026-04-01', lines: [{ transaction_date: '2026-04-01', amount: 1000, description: 'Customer wire' }] });
        const lineId = dialect.prepare('SELECT id FROM finance_bank_statement_lines WHERE statement_id = ?').get(stmt.id).id;
        const matched = matchBankStatementLine(dialect, ctx, { line_id: lineId, rule_id: rule.id });
        assert.strictEqual(matched.matched, true);
        assert.throws(() => manualReconcileBankLine(dialect, ctx, { line_id: lineId, target_type: 'payment', target_id: payment.id }), /already reconciled/);
        const unrec = unreconcileBankLine(dialect, ctx, { reconciliation_id: matched.reconciliation_id });
        assert.strictEqual(unrec.status, 'reversed');
        const lineStatus = dialect.prepare('SELECT status FROM finance_bank_statement_lines WHERE id = ?').get(lineId).status;
        assert.strictEqual(lineStatus, 'unmatched');
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['bank difference posts an adjustment document and reconciles the line', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const bankGlAcc = accountIdByCode(dialect, org.companyA1, '102000');
        const expense = accountIdByCode(dialect, org.companyA1, '502000');
        const bankAcc = createBankAccount(dialect, ctx, { name: 'Main Bank', gl_account_id: bankGlAcc });
        const stmt = importBankStatement(dialect, ctx, { bank_account_id: bankAcc.id, import_key: 'BATCH-DIFF', statement_date: '2026-04-01', lines: [{ transaction_date: '2026-04-01', amount: -15, description: 'Bank service charge' }] });
        const lineId = dialect.prepare('SELECT id FROM finance_bank_statement_lines WHERE statement_id = ?').get(stmt.id).id;
        const result = recordBankDifference(dialect, ctx, { line_id: lineId, account_id: expense, reason: 'Monthly service fee' });
        assert.ok(result.document_id);
        const doc = dialect.prepare('SELECT state FROM finance_documents WHERE id = ?').get(result.document_id);
        assert.strictEqual(doc.state, 'posted');
      } finally { await cleanup(dialect, dbPath); }
    }],

    // --- Cashboxes, petty cash, and custody (Packet 03.19) ---

    ['only one open shift per cashbox is allowed; count and close reconcile against GL activity', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        const cashbox = createCashbox(dialect, ctx, { name: 'Front desk', gl_account_id: cash });
        const shift = openCashShift(dialect, ctx, { cashbox_id: cashbox.id, opening_balance: 100 });
        assert.throws(() => openCashShift(dialect, ctx, { cashbox_id: cashbox.id, opening_balance: 50 }), /already has an open shift/);

        const payment = createPayment(dialect, ctx, { payment_type: 'receive', method: 'cash', amount: 250, cash_or_bank_account_id: cash, counter_account_id: receivable, partner_id: 'cust_cash', idempotency_key: 'cash-pay-1' });
        postPayment(dialect, ctx, { payment_id: payment.id });

        const count = recordCashCount(dialect, ctx, { shift_id: shift.id, counted_amount: 350 });
        assert.strictEqual(count.expected_amount, 350);
        assert.strictEqual(count.variance, 0);

        const closed = closeCashShift(dialect, ctx, { shift_id: shift.id, actual_closing_balance: 345 });
        assert.strictEqual(closed.variance, -5);
        assert.throws(() => recordCashCount(dialect, ctx, { shift_id: shift.id, counted_amount: 345 }), /requires an open shift/);
        assert.throws(() => closeCashShift(dialect, ctx, { shift_id: shift.id, actual_closing_balance: 345 }), /already closed/);

        const reopened = openCashShift(dialect, ctx, { cashbox_id: cashbox.id, opening_balance: 345 });
        assert.strictEqual(reopened.status, 'open');
      } finally { await cleanup(dialect, dbPath); }
    }],

    // --- Payment terms, installments, retainage (Packet 03.20) ---

    ['payment term schedule rounds to the exact document total across installments', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        const term = createPaymentTermTemplate(dialect, ctx, {
          code: 'NET_3WAY', name: '1/3 upfront, 1/3 30d, balance 60d',
          lines: [
            { line_type: 'percent', value: 33.33, due_rule: 'days_after_date', due_days: 0 },
            { line_type: 'percent', value: 33.33, due_rule: 'days_after_date', due_days: 30 },
            { line_type: 'balance', due_rule: 'days_after_date', due_days: 60 },
          ],
        });
        const invoiceDoc = createDocument(dialect, ctx, {
          move_type: 'customer_invoice', doc_date: '2026-04-01', partner_id: 'cust_terms',
          lines: [{ account_id: receivable, debit: 1000, credit: 0 }, { account_id: income, debit: 0, credit: 1000 }],
        });
        const result = generateDueScheduleFromTerm(dialect, ctx, { document_id: invoiceDoc.id, template_id: term.id });
        assert.strictEqual(result.schedule_count, 3);
        const rows = dialect.prepare('SELECT amount FROM finance_due_schedules WHERE document_id = ? ORDER BY sequence').all(invoiceDoc.id);
        const total = rows.reduce((s, r) => s + r.amount, 0);
        assert.strictEqual(Math.round(total * 100) / 100, 1000); // rounds to the exact total, no leftover cent
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['month-end due rule computes the correct calendar date', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        const term = createPaymentTermTemplate(dialect, ctx, {
          code: 'EOM_15', name: 'End of month + 15 days',
          lines: [{ line_type: 'balance', due_rule: 'days_after_month_end', due_days: 15 }],
        });
        const invoiceDoc = createDocument(dialect, ctx, {
          move_type: 'customer_invoice', doc_date: '2026-02-10', partner_id: 'cust_eom',
          lines: [{ account_id: receivable, debit: 500, credit: 0 }, { account_id: income, debit: 0, credit: 500 }],
        });
        generateDueScheduleFromTerm(dialect, ctx, { document_id: invoiceDoc.id, template_id: term.id });
        const row = dialect.prepare('SELECT due_date FROM finance_due_schedules WHERE document_id = ?').get(invoiceDoc.id);
        assert.strictEqual(row.due_date, '2026-03-15'); // Feb 2026 has 28 days; +15 days = Mar 15
      } finally { await cleanup(dialect, dbPath); }
    }],

    // --- Credit exposure and policy foundation (Packet 03.21) ---

    ['credit exposure reflects open receivables against the configured limit, and expired override is ignored', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        postInvoice(dialect, ctx, receivable, income, 8000, 'cust_credit');
        setCreditProfile(dialect, ctx, { partner_id: 'cust_credit', credit_limit: 5000 });
        const exposure = getCreditExposure(dialect, ctx, { partner_id: 'cust_credit' });
        assert.strictEqual(exposure.exposure, 8000);
        assert.strictEqual(exposure.is_over_limit, true);
        assert.strictEqual(exposure.available, -3000);

        setCreditProfile(dialect, ctx, { partner_id: 'cust_credit', credit_limit: 5000, temporary_limit_override: 10000, temporary_limit_expires_at: '2020-01-01T00:00:00.000Z' });
        const expiredExposure = getCreditExposure(dialect, ctx, { partner_id: 'cust_credit' });
        assert.strictEqual(expiredExposure.credit_limit, 5000); // expired override must be ignored
        assert.strictEqual(expiredExposure.explain.temporary_override_active, false);
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['credit hold/release lifecycle and payment releasing exposure', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        const invoice = postInvoice(dialect, ctx, receivable, income, 1200, 'cust_hold');
        const hold = holdCredit(dialect, ctx, { partner_id: 'cust_hold', reason: 'overdue balance' });
        assert.strictEqual(getCreditExposure(dialect, ctx, { partner_id: 'cust_hold' }).is_held, true);
        const payment = createPayment(dialect, ctx, { payment_type: 'receive', method: 'cash', amount: 1200, cash_or_bank_account_id: cash, counter_account_id: receivable, partner_id: 'cust_hold', idempotency_key: 'hold-pay-1' });
        postPayment(dialect, ctx, { payment_id: payment.id });
        allocatePayment(dialect, ctx, { payment_id: payment.id, document_id: invoice.id, amount: 1200 });
        assert.strictEqual(getCreditExposure(dialect, ctx, { partner_id: 'cust_hold' }).exposure, 0);
        releaseCreditHold(dialect, ctx, { hold_id: hold.id, released_reason: 'balance cleared' });
        assert.strictEqual(getCreditExposure(dialect, ctx, { partner_id: 'cust_hold' }).is_held, false);
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['cross-company credit profiles stay isolated', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        seedChartOfAccounts(dialect, { companyId: org.companyB1, userId: 'u_beta' });
        const ctxA = { companyId: org.companyA1, userId: 'u_owner' };
        const ctxB = { companyId: org.companyB1, userId: 'u_beta' };
        setCreditProfile(dialect, ctxA, { partner_id: 'shared_partner_credit', credit_limit: 9999 });
        const exposureB = getCreditExposure(dialect, ctxB, { partner_id: 'shared_partner_credit' });
        assert.strictEqual(exposureB.credit_limit, 0); // no profile visible in company B
      } finally { await cleanup(dialect, dbPath); }
    }],

    // --- Concurrency ---

    ['concurrent allocation attempts against the same payment cannot over-allocate', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        const invA = postInvoice(dialect, ctx, receivable, income, 300, 'cust_race_a');
        const invB = postInvoice(dialect, ctx, receivable, income, 300, 'cust_race_b');
        const payment = createPayment(dialect, ctx, { payment_type: 'receive', method: 'cash', amount: 500, cash_or_bank_account_id: cash, counter_account_id: receivable, partner_id: 'cust_race_a', idempotency_key: 'race-pay-1' });
        postPayment(dialect, ctx, { payment_id: payment.id });
        const results = await Promise.allSettled([
          Promise.resolve().then(() => allocatePayment(dialect, ctx, { payment_id: payment.id, document_id: invA.id, amount: 300 })),
          Promise.resolve().then(() => allocatePayment(dialect, ctx, { payment_id: payment.id, document_id: invB.id, amount: 300 })),
        ]);
        const fulfilled = results.filter(r => r.status === 'fulfilled');
        assert.strictEqual(fulfilled.length, 1, 'exactly one of the two 300-against-500 allocations must succeed');
        const finalUnallocated = dialect.prepare('SELECT unallocated_amount FROM finance_payments WHERE id = ?').get(payment.id).unallocated_amount;
        assert.ok(finalUnallocated >= 0, 'unallocated amount must never go negative');
      } finally { await cleanup(dialect, dbPath); }
    }],
  ];

  console.log(`\n=== ${SUITE} ===`);
  let passed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      passed++;
      console.log(`PASS: ${name}`);
    } catch (error) {
      failures.push({ name, error });
      console.error(`FAIL: ${name}\n      ${error?.stack || error}`);
    }
  }
  console.log(`\n${SUITE}: ${passed}/${tests.length} passed`);
  if (failures.length) {
    process.exitCode = 1;
    throw new Error(`${failures.length} test(s) failed in ${SUITE}`);
  }
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
