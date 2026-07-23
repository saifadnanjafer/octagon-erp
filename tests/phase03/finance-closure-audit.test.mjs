import assert from 'node:assert';
import { setup, cleanup, seedOrg } from '../phase02/harness.mjs';
import { createActionExecutor } from '../../platform/kernel/actions/index.mjs';
import { createSettingsAuthority } from '../../platform/settings/index.mjs';
import { registerFinanceActions, seedChartOfAccounts, accountIdByCode } from '../../platform/finance/index.mjs';
import {
  createDocument, submitDocument, approveDocument, postDocument,
  createPayment, postPayment, allocatePayment, unallocatePayment,
  createCashbox, setApprovalAuthorityLimit,
} from '../../platform/finance/engine.mjs';

const SUITE = 'finance-closure-audit';

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

// Foreign-currency invoice booked at an explicit rate: local amounts on the
// lines, foreign amounts in the currency_* columns (the wave-c pattern).
function postFxInvoice(dialect, ctx, receivable, income, foreignAmount, rate, partnerId, date = '2026-04-01') {
  const local = Math.round(foreignAmount * rate * 100) / 100;
  const doc = createDocument(dialect, ctx, {
    move_type: 'customer_invoice', doc_date: date, currency: 'USD', partner_id: partnerId,
    lines: [
      { account_id: receivable, debit: local, credit: 0, currency_code: 'USD', currency_debit: foreignAmount, currency_credit: 0 },
      { account_id: income, debit: 0, credit: local, currency_code: 'USD', currency_debit: 0, currency_credit: foreignAmount },
    ],
  });
  submitDocument(dialect, ctx, { document_id: doc.id });
  approveDocument(dialect, ctx, { document_id: doc.id });
  return postDocument(dialect, ctx, { document_id: doc.id });
}

function accountBalance(dialect, accountId) {
  const row = dialect.prepare('SELECT COALESCE(SUM(debit - credit), 0) AS balance FROM finance_journal_lines WHERE account_id = ?').get(accountId);
  return Math.round(Number(row.balance) * 100) / 100;
}

// Persist a finance policy knob through the Phase 02 typed settings authority,
// exactly how the runtime bridge/admin console stores it (migration 008 store).
function setFinanceSetting(dialect, companyId, key, type, value) {
  const settings = createSettingsAuthority(dialect);
  if (!settings.definitions.get(key)) {
    settings.define({ key, module_id: 'finance_canonical', type, scopes: ['company', 'system'], overridable_scopes: { company: true } });
  }
  return settings.set(key, 'company', companyId, value, { actor: 'u_owner' });
}

async function run() {
  const failures = [];
  const tests = [
    // --- Cashbox max_balance enforcement (defect 2) ---

    ['cash receipt above the cashbox max_balance is rejected with CASHBOX_MAX_BALANCE_EXCEEDED', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        createCashbox(dialect, ctx, { name: 'Front desk', gl_account_id: cash, max_balance: 1000 });
        assert.throws(
          () => createPayment(dialect, ctx, { payment_type: 'receive', method: 'cash', amount: 1500, cash_or_bank_account_id: cash, counter_account_id: receivable, partner_id: 'cust_max', idempotency_key: 'cbox-over-1' }),
          (e) => e.code === 'CASHBOX_MAX_BALANCE_EXCEEDED'
        );
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['cash receipt within the cashbox max_balance succeeds and posts', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        createCashbox(dialect, ctx, { name: 'Front desk', gl_account_id: cash, max_balance: 1000 });
        const payment = createPayment(dialect, ctx, { payment_type: 'receive', method: 'cash', amount: 800, cash_or_bank_account_id: cash, counter_account_id: receivable, partner_id: 'cust_max', idempotency_key: 'cbox-ok-1' });
        postPayment(dialect, ctx, { payment_id: payment.id });
        assert.strictEqual(accountBalance(dialect, cash), 800);
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['two concurrent postings through the ActionExecutor cannot jointly breach max_balance (BEGIN IMMEDIATE atomicity)', async () => {
      const { dialect, dbPath, org, executor } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        createCashbox(dialect, ctx, { name: 'Front desk', gl_account_id: cash, max_balance: 1000 });
        // Each draft fits within the limit at creation time (no posted lines yet);
        // the posting-time re-check must stop the second one.
        const p1 = createPayment(dialect, ctx, { payment_type: 'receive', method: 'cash', amount: 700, cash_or_bank_account_id: cash, counter_account_id: receivable, partner_id: 'cust_race', idempotency_key: 'cbox-race-1' });
        const p2 = createPayment(dialect, ctx, { payment_type: 'receive', method: 'cash', amount: 700, cash_or_bank_account_id: cash, counter_account_id: receivable, partner_id: 'cust_race', idempotency_key: 'cbox-race-2' });
        const results = await Promise.allSettled([
          Promise.resolve().then(() => executor.execute('finance_payment:post', { payment_id: p1.id, idempotency_key: 'cbox-race-post-1' }, ctx)),
          Promise.resolve().then(() => executor.execute('finance_payment:post', { payment_id: p2.id, idempotency_key: 'cbox-race-post-2' }, ctx)),
        ]);
        const fulfilled = results.filter(r => r.status === 'fulfilled');
        const rejected = results.filter(r => r.status === 'rejected');
        assert.strictEqual(fulfilled.length, 1, 'exactly one of the two 700-against-1000 postings must succeed');
        assert.strictEqual(rejected.length, 1);
        assert.strictEqual(rejected[0].reason.code, 'CASHBOX_MAX_BALANCE_EXCEEDED');
        assert.ok(accountBalance(dialect, cash) <= 1000, 'cash balance must never exceed max_balance');
        assert.strictEqual(accountBalance(dialect, cash), 700);
      } finally { await cleanup(dialect, dbPath); }
    }],

    // --- Realized FX on settlement (defect 1) ---

    ['allocating a USD payment at a higher rate posts a balanced realized FX gain journal linked to the allocation', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const bank = accountIdByCode(dialect, org.companyA1, '102000');
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        const gainAcc = accountIdByCode(dialect, org.companyA1, '401000');
        const inv = postFxInvoice(dialect, ctx, receivable, income, 100, 1300, 'cust_fx_gain');
        const payment = createPayment(dialect, ctx, {
          payment_type: 'receive', method: 'bank', amount: 100, currency: 'USD', fx_rate: 1400, payment_date: '2026-04-05',
          cash_or_bank_account_id: bank, counter_account_id: receivable, partner_id: 'cust_fx_gain', idempotency_key: 'fx-gain-pay-1',
        });
        postPayment(dialect, ctx, { payment_id: payment.id });
        const alloc = allocatePayment(dialect, ctx, { payment_id: payment.id, document_id: inv.id, amount: 100, fx_gain_account_id: gainAcc });
        assert.strictEqual(alloc.fx_difference, 10000); // 100 USD * (1400 - 1300)
        assert.ok(alloc.fx_document_id, 'a realized FX journal document must be posted');
        const fxDoc = dialect.prepare('SELECT * FROM finance_documents WHERE id = ?').get(alloc.fx_document_id);
        assert.strictEqual(fxDoc.state, 'posted');
        assert.strictEqual(fxDoc.move_type, 'fx_revaluation');
        assert.strictEqual(fxDoc.source_type, 'realized_fx_allocation');
        assert.strictEqual(fxDoc.source_id, alloc.id, 'FX document must link back to the allocation');
        const totals = dialect.prepare('SELECT SUM(debit) d, SUM(credit) c FROM finance_journal_lines WHERE document_id = ?').get(fxDoc.id);
        assert.strictEqual(totals.d, 10000);
        assert.strictEqual(totals.c, 10000, 'realized FX journal must be balanced');
        // Receivable is fully cleared: 130000 booked - 140000 settled + 10000 gain.
        assert.strictEqual(accountBalance(dialect, receivable), 0);
        const stored = dialect.prepare('SELECT fx_difference FROM finance_payment_allocations WHERE id = ?').get(alloc.id);
        assert.strictEqual(stored.fx_difference, 10000);
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['allocating a USD payment at a lower rate posts a realized FX loss and clears the receivable', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const bank = accountIdByCode(dialect, org.companyA1, '102000');
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        const lossAcc = accountIdByCode(dialect, org.companyA1, '502000');
        const inv = postFxInvoice(dialect, ctx, receivable, income, 100, 1400, 'cust_fx_loss');
        const payment = createPayment(dialect, ctx, {
          payment_type: 'receive', method: 'bank', amount: 100, currency: 'USD', fx_rate: 1300, payment_date: '2026-04-05',
          cash_or_bank_account_id: bank, counter_account_id: receivable, partner_id: 'cust_fx_loss', idempotency_key: 'fx-loss-pay-1',
        });
        postPayment(dialect, ctx, { payment_id: payment.id });
        const alloc = allocatePayment(dialect, ctx, { payment_id: payment.id, document_id: inv.id, amount: 100, fx_loss_account_id: lossAcc });
        assert.strictEqual(alloc.fx_difference, -10000); // 100 USD * (1300 - 1400)
        const lossLine = dialect.prepare('SELECT debit FROM finance_journal_lines WHERE document_id = ? AND account_id = ?').get(alloc.fx_document_id, lossAcc);
        assert.strictEqual(lossLine.debit, 10000);
        assert.strictEqual(accountBalance(dialect, receivable), 0);
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['settlement at the booked rate computes no difference and posts no FX document', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const bank = accountIdByCode(dialect, org.companyA1, '102000');
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        const inv = postFxInvoice(dialect, ctx, receivable, income, 100, 1300, 'cust_fx_flat');
        const payment = createPayment(dialect, ctx, {
          payment_type: 'receive', method: 'bank', amount: 100, currency: 'USD', fx_rate: 1300, payment_date: '2026-04-05',
          cash_or_bank_account_id: bank, counter_account_id: receivable, partner_id: 'cust_fx_flat', idempotency_key: 'fx-flat-pay-1',
        });
        postPayment(dialect, ctx, { payment_id: payment.id });
        const alloc = allocatePayment(dialect, ctx, { payment_id: payment.id, document_id: inv.id, amount: 100 });
        assert.strictEqual(alloc.fx_difference, 0);
        assert.strictEqual(alloc.fx_document_id, null);
        const fxDocs = dialect.prepare("SELECT COUNT(*) AS n FROM finance_documents WHERE source_type = 'realized_fx_allocation'").get();
        assert.strictEqual(fxDocs.n, 0);
        assert.strictEqual(accountBalance(dialect, receivable), 0);
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['FX gain/loss account resolution falls back to the persisted company setting', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const bank = accountIdByCode(dialect, org.companyA1, '102000');
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        const gainAcc = accountIdByCode(dialect, org.companyA1, '401000');
        setFinanceSetting(dialect, org.companyA1, 'finance.fx_gain_account_id', 'string', gainAcc);
        const inv = postFxInvoice(dialect, ctx, receivable, income, 100, 1300, 'cust_fx_cfg');
        const payment = createPayment(dialect, ctx, {
          payment_type: 'receive', method: 'bank', amount: 100, currency: 'USD', fx_rate: 1400, payment_date: '2026-04-05',
          cash_or_bank_account_id: bank, counter_account_id: receivable, partner_id: 'cust_fx_cfg', idempotency_key: 'fx-cfg-pay-1',
        });
        postPayment(dialect, ctx, { payment_id: payment.id });
        const alloc = allocatePayment(dialect, ctx, { payment_id: payment.id, document_id: inv.id, amount: 100 });
        assert.strictEqual(alloc.fx_difference, 10000);
        assert.ok(alloc.fx_document_id, 'persisted FX gain account must be used without caller input');
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['unconfigured FX account fails with FX_ACCOUNT_NOT_CONFIGURED and rolls back atomically through the executor', async () => {
      const { dialect, dbPath, org, executor } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const bank = accountIdByCode(dialect, org.companyA1, '102000');
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        const inv = postFxInvoice(dialect, ctx, receivable, income, 100, 1300, 'cust_fx_nocfg');
        const payment = createPayment(dialect, ctx, {
          payment_type: 'receive', method: 'bank', amount: 100, currency: 'USD', fx_rate: 1400, payment_date: '2026-04-05',
          cash_or_bank_account_id: bank, counter_account_id: receivable, partner_id: 'cust_fx_nocfg', idempotency_key: 'fx-nocfg-pay-1',
        });
        postPayment(dialect, ctx, { payment_id: payment.id });
        assert.throws(
          () => executor.execute('finance_payment:allocate', { payment_id: payment.id, document_id: inv.id, amount: 100, idempotency_key: 'fx-nocfg-alloc-1' }, ctx),
          (e) => e.code === 'FX_ACCOUNT_NOT_CONFIGURED'
        );
        // Atomic rollback: no allocation row and the payment is still fully unallocated.
        const allocs = dialect.prepare('SELECT COUNT(*) AS n FROM finance_payment_allocations WHERE payment_id = ?').get(payment.id);
        assert.strictEqual(allocs.n, 0);
        const unallocated = dialect.prepare('SELECT unallocated_amount FROM finance_payments WHERE id = ?').get(payment.id);
        assert.strictEqual(unallocated.unallocated_amount, 100);
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['caller-supplied fx_difference remains an explicit override that skips the computed posting', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const bank = accountIdByCode(dialect, org.companyA1, '102000');
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        const inv = postFxInvoice(dialect, ctx, receivable, income, 100, 1300, 'cust_fx_override');
        const payment = createPayment(dialect, ctx, {
          payment_type: 'receive', method: 'bank', amount: 100, currency: 'USD', fx_rate: 1400, payment_date: '2026-04-05',
          cash_or_bank_account_id: bank, counter_account_id: receivable, partner_id: 'cust_fx_override', idempotency_key: 'fx-override-pay-1',
        });
        postPayment(dialect, ctx, { payment_id: payment.id });
        const alloc = allocatePayment(dialect, ctx, { payment_id: payment.id, document_id: inv.id, amount: 100, fx_difference: 42 });
        assert.strictEqual(alloc.fx_difference, 42);
        assert.strictEqual(alloc.fx_document_id, null);
        const fxDocs = dialect.prepare("SELECT COUNT(*) AS n FROM finance_documents WHERE source_type = 'realized_fx_allocation'").get();
        assert.strictEqual(fxDocs.n, 0);
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['unallocating a payment reverses the realized FX journal that was posted with the allocation', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const bank = accountIdByCode(dialect, org.companyA1, '102000');
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        const gainAcc = accountIdByCode(dialect, org.companyA1, '401000');
        const inv = postFxInvoice(dialect, ctx, receivable, income, 100, 1300, 'cust_fx_unalloc');
        const payment = createPayment(dialect, ctx, {
          payment_type: 'receive', method: 'bank', amount: 100, currency: 'USD', fx_rate: 1400, payment_date: '2026-04-05',
          cash_or_bank_account_id: bank, counter_account_id: receivable, partner_id: 'cust_fx_unalloc', idempotency_key: 'fx-unalloc-pay-1',
        });
        postPayment(dialect, ctx, { payment_id: payment.id });
        const alloc = allocatePayment(dialect, ctx, { payment_id: payment.id, document_id: inv.id, amount: 100, fx_gain_account_id: gainAcc });
        unallocatePayment(dialect, ctx, { allocation_id: alloc.id });
        const fxDoc = dialect.prepare('SELECT state FROM finance_documents WHERE id = ?').get(alloc.fx_document_id);
        assert.strictEqual(fxDoc.state, 'reversed');
        const unallocated = dialect.prepare('SELECT unallocated_amount FROM finance_payments WHERE id = ?').get(payment.id);
        assert.strictEqual(unallocated.unallocated_amount, 100);
      } finally { await cleanup(dialect, dbPath); }
    }],

    // --- Approval authority fail-closed policy (defect 3) ---

    ['fail-closed policy rejects document posting when no authority limit exists', async () => {
      const { dialect, dbPath, org, executor } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        setFinanceSetting(dialect, org.companyA1, 'finance.approval_authority.fail_closed', 'boolean', true);
        const doc = createDocument(dialect, ctx, {
          move_type: 'manual_entry', doc_date: '2026-04-01',
          lines: [{ account_id: cash, debit: 250, credit: 0 }, { account_id: income, debit: 0, credit: 250 }],
        });
        submitDocument(dialect, ctx, { document_id: doc.id });
        approveDocument(dialect, ctx, { document_id: doc.id });
        assert.throws(
          () => executor.execute('finance_document:post', { document_id: doc.id, idempotency_key: 'auth-post-missing-1' }, ctx),
          (e) => e.code === 'AUTHORITY_LIMIT_MISSING'
        );
        const state = dialect.prepare('SELECT state FROM finance_documents WHERE id = ?').get(doc.id);
        assert.strictEqual(state.state, 'approved', 'rejected posting must leave the document un-posted');
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['fail-closed policy rejects amounts above the configured limit and allows an explicitly approved amount', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        setFinanceSetting(dialect, org.companyA1, 'finance.approval_authority.fail_closed', 'boolean', true);
        setApprovalAuthorityLimit(dialect, ctx, { role_or_user: 'u_owner', limit_type: 'post', max_amount: 500 });
        const overDoc = createDocument(dialect, ctx, {
          move_type: 'manual_entry', doc_date: '2026-04-01',
          lines: [{ account_id: cash, debit: 600, credit: 0 }, { account_id: income, debit: 0, credit: 600 }],
        });
        submitDocument(dialect, ctx, { document_id: overDoc.id });
        approveDocument(dialect, ctx, { document_id: overDoc.id });
        assert.throws(
          () => postDocument(dialect, ctx, { document_id: overDoc.id }),
          (e) => e.code === 'AUTHORITY_LIMIT_EXCEEDED'
        );
        const okDoc = createDocument(dialect, ctx, {
          move_type: 'manual_entry', doc_date: '2026-04-01',
          lines: [{ account_id: cash, debit: 400, credit: 0 }, { account_id: income, debit: 0, credit: 400 }],
        });
        submitDocument(dialect, ctx, { document_id: okDoc.id });
        approveDocument(dialect, ctx, { document_id: okDoc.id });
        const posted = postDocument(dialect, ctx, { document_id: okDoc.id });
        assert.strictEqual(posted.state, 'posted');
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['fail-closed policy governs payment posting: missing payment limit rejects, configured limits allow', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        setFinanceSetting(dialect, org.companyA1, 'finance.approval_authority.fail_closed', 'boolean', true);
        const payment = createPayment(dialect, ctx, { payment_type: 'receive', method: 'cash', amount: 300, cash_or_bank_account_id: cash, counter_account_id: receivable, partner_id: 'cust_auth', idempotency_key: 'auth-pay-1' });
        assert.throws(
          () => postPayment(dialect, ctx, { payment_id: payment.id }),
          (e) => e.code === 'AUTHORITY_LIMIT_MISSING'
        );
        const stillDraft = dialect.prepare('SELECT status FROM finance_payments WHERE id = ?').get(payment.id);
        assert.strictEqual(stillDraft.status, 'draft');
        // Explicit approved policy: both the payment and the post limits cover the amount.
        setApprovalAuthorityLimit(dialect, ctx, { role_or_user: 'u_owner', limit_type: 'payment', max_amount: 1000 });
        setApprovalAuthorityLimit(dialect, ctx, { role_or_user: 'u_owner', limit_type: 'post', max_amount: 100000 });
        const posted = postPayment(dialect, ctx, { payment_id: payment.id });
        assert.strictEqual(posted.status, 'posted');
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['without the persisted fail-closed policy, posting needs no authority limit (legacy default preserved)', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        const doc = createDocument(dialect, ctx, {
          move_type: 'manual_entry', doc_date: '2026-04-01',
          lines: [{ account_id: cash, debit: 999999, credit: 0 }, { account_id: income, debit: 0, credit: 999999 }],
        });
        submitDocument(dialect, ctx, { document_id: doc.id });
        approveDocument(dialect, ctx, { document_id: doc.id });
        const posted = postDocument(dialect, ctx, { document_id: doc.id });
        assert.strictEqual(posted.state, 'posted');
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
