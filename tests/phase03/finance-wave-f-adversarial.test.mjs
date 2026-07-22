import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setup, cleanup, seedOrg } from '../phase02/harness.mjs';
import { createActionExecutor } from '../../platform/kernel/actions/index.mjs';
import { registerFinanceActions, seedChartOfAccounts, accountIdByCode } from '../../platform/finance/index.mjs';
import {
  createDocument, submitDocument, approveDocument, postDocument, verifyHashChain, setLockDate,
  createPayment, postPayment, allocatePayment,
  snapshotReport,
} from '../../platform/finance/engine.mjs';

const SUITE = 'finance-wave-f-adversarial';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function setupFinance() {
  const { dialect, dbPath } = await setup(SUITE);
  const org = seedOrg(dialect);
  seedChartOfAccounts(dialect, { companyId: org.companyA1, userId: 'u_owner' });
  const executor = createActionExecutor(dialect);
  registerFinanceActions(executor);
  return { dialect, dbPath, org, executor };
}

async function run() {
  const failures = [];
  const tests = [
    // --- Body-supplied authority override ---

    ['body-supplied company_id in the input payload cannot override the server-derived context', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctxA = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const expense = accountIdByCode(dialect, org.companyA1, '502000');
        // An attacker-controlled input tries to smuggle a different company_id
        // into the payload. Every engine function derives company scope
        // exclusively from ctx (server-side), never from `input`, so this must
        // have zero effect on which company the document is created in.
        const doc = createDocument(dialect, ctxA, {
          company_id: org.companyB1, // attempted override, must be ignored
          move_type: 'manual_entry', doc_date: '2026-04-01',
          lines: [{ account_id: expense, debit: 10, credit: 0 }, { account_id: cash, debit: 0, credit: 10 }],
        });
        const row = dialect.prepare('SELECT company_id FROM finance_documents WHERE id = ?').get(doc.id);
        assert.strictEqual(row.company_id, org.companyA1);
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['a hidden/unregistered permission cannot be smuggled through the action executor as a direct API call', async () => {
      const { dialect, dbPath, org, executor } = await setupFinance();
      try {
        assert.throws(() => executor.execute('finance_account:delete_forever', { id: 'x' }, { companyId: org.companyA1, userId: 'attacker' }), /.+/);
      } finally { await cleanup(dialect, dbPath); }
    }],

    // --- Cross-company / cross-tenant isolation ---

    ['cross-company report snapshot is not visible to a different company', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        seedChartOfAccounts(dialect, { companyId: org.companyB1, userId: 'u_beta' });
        const ctxA = { companyId: org.companyA1, userId: 'u_owner' };
        const ctxB = { companyId: org.companyB1, userId: 'u_beta' };
        const snap = snapshotReport(dialect, ctxA, { report_code: 'trial_balance', params: {} });
        const seenFromB = dialect.prepare('SELECT id FROM finance_report_snapshots WHERE id = ? AND company_id = ?').get(snap.id, org.companyB1);
        assert.strictEqual(seenFromB, undefined);
        const seenFromA = dialect.prepare('SELECT id FROM finance_report_snapshots WHERE id = ? AND company_id = ?').get(snap.id, org.companyA1);
        assert.ok(seenFromA);
      } finally { await cleanup(dialect, dbPath); }
    }],

    // --- Stale document version / double-transition ---

    ['a document cannot be submitted twice, approved twice, or posted twice (stale-state resubmission is rejected)', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const expense = accountIdByCode(dialect, org.companyA1, '502000');
        const doc = createDocument(dialect, ctx, { move_type: 'manual_entry', doc_date: '2026-04-01', lines: [{ account_id: expense, debit: 20, credit: 0 }, { account_id: cash, debit: 0, credit: 20 }] });
        submitDocument(dialect, ctx, { document_id: doc.id });
        assert.throws(() => submitDocument(dialect, ctx, { document_id: doc.id }), /draft/);
        approveDocument(dialect, ctx, { document_id: doc.id });
        assert.throws(() => approveDocument(dialect, ctx, { document_id: doc.id }), /submitted/);
        postDocument(dialect, ctx, { document_id: doc.id });
        assert.throws(() => postDocument(dialect, ctx, { document_id: doc.id }), /approved/);
      } finally { await cleanup(dialect, dbPath); }
    }],

    // --- Hash-chain tamper resistance ---

    ['direct tampering with a posted journal line or its hash is blocked at the database trigger level, not just detected after the fact', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const expense = accountIdByCode(dialect, org.companyA1, '502000');
        const doc = createDocument(dialect, ctx, { move_type: 'manual_entry', doc_date: '2026-04-01', lines: [{ account_id: expense, debit: 777, credit: 0 }, { account_id: cash, debit: 0, credit: 777 }] });
        submitDocument(dialect, ctx, { document_id: doc.id });
        approveDocument(dialect, ctx, { document_id: doc.id });
        postDocument(dialect, ctx, { document_id: doc.id });

        const line = dialect.prepare('SELECT id FROM finance_journal_lines WHERE document_id = ? LIMIT 1').get(doc.id);
        assert.throws(() => dialect.prepare('UPDATE finance_journal_lines SET debit = 999999 WHERE id = ?').run(line.id), /.+/);

        const entry = dialect.prepare('SELECT id FROM finance_journal_entries WHERE document_id = ?').get(doc.id);
        assert.throws(() => dialect.prepare("UPDATE finance_journal_entries SET hash = 'tampered' WHERE id = ?").run(entry.id), /.+/);

        const verify = verifyHashChain(dialect, ctx, {});
        assert.strictEqual(verify.ok, true); // untouched because the tamper attempts were rejected, not merely detected after landing
      } finally { await cleanup(dialect, dbPath); }
    }],

    // --- Period close vs posting race ---

    ['locking a period while a document is mid-lifecycle blocks the final post, protecting close integrity', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const expense = accountIdByCode(dialect, org.companyA1, '502000');
        const doc = createDocument(dialect, ctx, { move_type: 'manual_entry', doc_date: '2026-04-10', lines: [{ account_id: expense, debit: 30, credit: 0 }, { account_id: cash, debit: 0, credit: 30 }] });
        submitDocument(dialect, ctx, { document_id: doc.id });
        approveDocument(dialect, ctx, { document_id: doc.id });
        setLockDate(dialect, ctx, { module: 'gl', lock_date: '2026-04-30' }); // close overtakes the in-flight document
        assert.throws(() => postDocument(dialect, ctx, { document_id: doc.id }), /locked/);
      } finally { await cleanup(dialect, dbPath); }
    }],

    // --- Duplicate idempotency key through the action executor (not just the raw engine call) ---

    ['duplicate idempotency_key through the action executor replays the first result instead of creating a second payment', async () => {
      const { dialect, dbPath, org, executor } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        const input = { payment_type: 'receive', method: 'cash', amount: 44, cash_or_bank_account_id: cash, counter_account_id: receivable, partner_id: 'cust_dup', idempotency_key: 'action-exec-key-1' };
        const first = executor.execute('finance_payment:create', input, ctx);
        const second = executor.execute('finance_payment:create', input, ctx);
        assert.strictEqual(first.id, second.id);
        const count = dialect.prepare("SELECT COUNT(*) AS n FROM finance_payments WHERE company_id = ? AND idempotency_key = 'action-exec-key-1'").get(org.companyA1).n;
        assert.strictEqual(count, 1);
      } finally { await cleanup(dialect, dbPath); }
    }],

    // --- Concurrency at higher volume (journal numbering) ---

    ['ten concurrent postings still produce ten unique sequential entry numbers with an intact hash chain', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const expense = accountIdByCode(dialect, org.companyA1, '502000');
        const docs = [];
        for (let i = 0; i < 10; i++) {
          const d = createDocument(dialect, ctx, { move_type: 'manual_entry', doc_date: '2026-04-15', lines: [{ account_id: expense, debit: 1, credit: 0 }, { account_id: cash, debit: 0, credit: 1 }] });
          submitDocument(dialect, ctx, { document_id: d.id });
          approveDocument(dialect, ctx, { document_id: d.id });
          docs.push(d);
        }
        await Promise.all(docs.map(d => postDocument(dialect, ctx, { document_id: d.id })));
        const numbers = dialect.prepare('SELECT entry_number FROM finance_journal_entries WHERE company_id = ? ORDER BY entry_number').all(org.companyA1).map(r => r.entry_number);
        assert.strictEqual(new Set(numbers).size, 10); // no collisions
        assert.strictEqual(verifyHashChain(dialect, ctx, {}).ok, true);
      } finally { await cleanup(dialect, dbPath); }
    }],

    // --- Payroll/attendance non-interference (static guard, not just behavioral) ---

    ['finance engine source never references a payroll or attendance table (static regression guard)', () => {
      const engineSource = fs.readFileSync(path.join(__dirname, '../../platform/finance/engine.mjs'), 'utf8');
      const forbiddenPatterns = [/\bpayroll_/i, /\battendance_/i, /\btimesheet_/i, /FROM\s+employees\b/i, /INTO\s+employees\b/i];
      for (const pattern of forbiddenPatterns) {
        assert.ok(!pattern.test(engineSource), `finance/engine.mjs must never reference payroll/attendance/employee tables directly (matched ${pattern})`);
      }
    }],

    // --- Reconciliation race: two allocations trying to reconcile the same payment concurrently (extends Wave D's race test) ---

    ['reconciliation race: allocating and unallocating the same allocation concurrently cannot double-free the payment balance', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        const invoiceDoc = createDocument(dialect, ctx, { move_type: 'customer_invoice', doc_date: '2026-04-01', partner_id: 'cust_race2', lines: [{ account_id: receivable, debit: 500, credit: 0 }, { account_id: income, debit: 0, credit: 500 }] });
        submitDocument(dialect, ctx, { document_id: invoiceDoc.id });
        approveDocument(dialect, ctx, { document_id: invoiceDoc.id });
        postDocument(dialect, ctx, { document_id: invoiceDoc.id });
        const payment = createPayment(dialect, ctx, { payment_type: 'receive', method: 'cash', amount: 500, cash_or_bank_account_id: cash, counter_account_id: receivable, partner_id: 'cust_race2', idempotency_key: 'race2-pay' });
        postPayment(dialect, ctx, { payment_id: payment.id });
        const alloc = allocatePayment(dialect, ctx, { payment_id: payment.id, document_id: invoiceDoc.id, amount: 500 });
        const { unallocatePayment } = await import('../../platform/finance/engine.mjs');
        const results = await Promise.allSettled([
          Promise.resolve().then(() => unallocatePayment(dialect, ctx, { allocation_id: alloc.id })),
          Promise.resolve().then(() => unallocatePayment(dialect, ctx, { allocation_id: alloc.id })),
        ]);
        const fulfilled = results.filter(r => r.status === 'fulfilled');
        assert.strictEqual(fulfilled.length, 1, 'exactly one unallocation of the same allocation must succeed');
        const finalUnallocated = dialect.prepare('SELECT unallocated_amount FROM finance_payments WHERE id = ?').get(payment.id).unallocated_amount;
        assert.strictEqual(finalUnallocated, 500); // not double-credited back to 1000
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
