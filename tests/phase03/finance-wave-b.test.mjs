import assert from 'node:assert';
import { setup, cleanup, seedOrg } from '../phase02/harness.mjs';
import { createActionExecutor } from '../../platform/kernel/actions/index.mjs';
import { registerFinanceActions, seedChartOfAccounts, accountIdByCode } from '../../platform/finance/index.mjs';
import {
  createDocument, submitDocument, approveDocument, cancelDocument, postDocument, reverseDocument,
  verifyHashChain, setLockDate, hardClosePeriod, reopenPeriod,
} from '../../platform/finance/engine.mjs';

const SUITE = 'finance-wave-b';

async function setupFinance() {
  const { dialect, dbPath } = await setup(SUITE);
  const org = seedOrg(dialect);
  seedChartOfAccounts(dialect, { companyId: org.companyA1, userId: 'u_owner' });
  const executor = createActionExecutor(dialect);
  registerFinanceActions(executor);
  return { dialect, dbPath, org, executor };
}

async function run() {
  let passed = 0;
  const failures = [];
  const tests = [
    ['migration 015 applied and lifecycle actions present', async () => {
      const { dialect, dbPath } = await setupFinance();
      try {
        const applied = dialect.prepare('SELECT 1 FROM schema_migrations WHERE migration_id = ?').get('015_finance_document_lifecycle');
        assert.ok(applied, 'migration 015 not applied');
        const actions = dialect.prepare("SELECT id FROM platform_actions WHERE module_id = 'finance_canonical' AND id LIKE 'finance_document:%' ORDER BY id").all();
        const ids = actions.map(r => r.id);
        for (const expected of ['finance_document:create', 'finance_document:submit', 'finance_document:approve', 'finance_document:cancel', 'finance_document:post', 'finance_document:reverse', 'finance_document:amend']) {
          assert.ok(ids.includes(expected), `missing action ${expected}`);
        }
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['document lifecycle via engine', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const expense = accountIdByCode(dialect, org.companyA1, '502000');
        const doc = createDocument(dialect, ctx, {
          move_type: 'manual_entry',
          doc_date: '2026-06-01',
          lines: [
            { account_id: expense, debit: 500, credit: 0 },
            { account_id: cash, debit: 0, credit: 500 },
          ],
        });
        assert.strictEqual(doc.state, 'draft');
        const submitted = submitDocument(dialect, ctx, { document_id: doc.id });
        assert.strictEqual(submitted.state, 'submitted');
        const approved = approveDocument(dialect, ctx, { document_id: doc.id });
        assert.strictEqual(approved.state, 'approved');
        const posted = postDocument(dialect, ctx, { document_id: doc.id });
        assert.strictEqual(posted.state, 'posted');
        assert.throws(
          () => cancelDocument(dialect, ctx, { document_id: doc.id }),
          /cancelled/
        );
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['post denied if document is not approved', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const expense = accountIdByCode(dialect, org.companyA1, '502000');
        const doc = createDocument(dialect, ctx, {
          move_type: 'manual_entry',
          doc_date: '2026-06-02',
          lines: [
            { account_id: expense, debit: 100, credit: 0 },
            { account_id: cash, debit: 0, credit: 100 },
          ],
        });
        assert.throws(
          () => postDocument(dialect, ctx, { document_id: doc.id }),
          /must be approved/
        );
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['document lifecycle via action executor', async () => {
      const { dialect, dbPath, org, executor } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const expense = accountIdByCode(dialect, org.companyA1, '502000');
        const created = executor.execute('finance_document:create', {
          move_type: 'manual_entry',
          doc_date: '2026-06-03',
          lines: [
            { account_id: expense, debit: 200, credit: 0 },
            { account_id: cash, debit: 0, credit: 200 },
          ],
          idempotency_key: 'doc-create-1',
        }, ctx);
        assert.strictEqual(created.state, 'draft');
        executor.execute('finance_document:submit', { document_id: created.id, idempotency_key: 'doc-submit-1' }, ctx);
        executor.execute('finance_document:approve', { document_id: created.id, idempotency_key: 'doc-approve-1' }, ctx);
        const posted = executor.execute('finance_document:post', { document_id: created.id, idempotency_key: 'doc-post-1' }, ctx);
        assert.strictEqual(posted.state, 'posted');
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['lock date prevents posting', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const expense = accountIdByCode(dialect, org.companyA1, '502000');
        setLockDate(dialect, ctx, { module: 'gl', lock_date: '2026-06-10' });
        const doc = createDocument(dialect, ctx, {
          move_type: 'manual_entry',
          doc_date: '2026-06-05',
          lines: [
            { account_id: expense, debit: 100, credit: 0 },
            { account_id: cash, debit: 0, credit: 100 },
          ],
        });
        submitDocument(dialect, ctx, { document_id: doc.id });
        approveDocument(dialect, ctx, { document_id: doc.id });
        assert.throws(
          () => postDocument(dialect, ctx, { document_id: doc.id }),
          /locked/
        );
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['reopen hard-closed period requires reason', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const period = dialect.prepare('SELECT id FROM finance_periods WHERE company_id = ? AND start_date <= ? AND end_date >= ?').get(org.companyA1, '2026-03-15', '2026-03-15');
        hardClosePeriod(dialect, ctx, { period_id: period.id });
        assert.throws(
          () => reopenPeriod(dialect, ctx, { period_id: period.id }),
          /reason/
        );
        const reopened = reopenPeriod(dialect, ctx, { period_id: period.id, reason: 'accountant correction' });
        assert.strictEqual(reopened.status, 'open');
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['cross-company document access denied', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctxA = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const expense = accountIdByCode(dialect, org.companyA1, '502000');
        const doc = createDocument(dialect, ctxA, {
          move_type: 'manual_entry',
          doc_date: '2026-06-04',
          lines: [
            { account_id: expense, debit: 100, credit: 0 },
            { account_id: cash, debit: 0, credit: 100 },
          ],
        });
        const ctxB = { companyId: org.companyB1, userId: 'u_beta' };
        assert.throws(
          () => submitDocument(dialect, ctxB, { document_id: doc.id }),
          /cross-company|not found/
        );
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['concurrent posting issues sequential numbers', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const expense = accountIdByCode(dialect, org.companyA1, '502000');
        const docs = [];
        for (let i = 0; i < 2; i++) {
          const doc = createDocument(dialect, ctx, {
            move_type: 'manual_entry',
            doc_date: '2026-06-06',
            lines: [
              { account_id: expense, debit: 50, credit: 0 },
              { account_id: cash, debit: 0, credit: 50 },
            ],
          });
          submitDocument(dialect, ctx, { document_id: doc.id });
          approveDocument(dialect, ctx, { document_id: doc.id });
          docs.push(doc);
        }
        await Promise.all(docs.map(d => postDocument(dialect, ctx, { document_id: d.id })));
        const entries = dialect.prepare("SELECT entry_number FROM finance_journal_entries WHERE company_id = ? ORDER BY entry_number").all(org.companyA1);
        assert.strictEqual(entries.length, 2);
        assert.ok(entries[0].entry_number.endsWith('00001'));
        assert.ok(entries[1].entry_number.endsWith('00002'));
        const verify = verifyHashChain(dialect, ctx, {});
        assert.strictEqual(verify.ok, true);
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['reversal preserves original immutability', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const expense = accountIdByCode(dialect, org.companyA1, '502000');
        const doc = createDocument(dialect, ctx, {
          move_type: 'manual_entry',
          doc_date: '2026-06-07',
          lines: [
            { account_id: expense, debit: 400, credit: 0 },
            { account_id: cash, debit: 0, credit: 400 },
          ],
        });
        submitDocument(dialect, ctx, { document_id: doc.id });
        approveDocument(dialect, ctx, { document_id: doc.id });
        postDocument(dialect, ctx, { document_id: doc.id });
        const before = dialect.prepare('SELECT state, doc_number FROM finance_documents WHERE id = ?').get(doc.id);
        reverseDocument(dialect, ctx, { document_id: doc.id, reason: 'error' });
        const after = dialect.prepare('SELECT state, doc_number FROM finance_documents WHERE id = ?').get(doc.id);
        assert.strictEqual(after.state, 'reversed');
        assert.strictEqual(after.doc_number, before.doc_number); // number preserved
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],
  ];

  console.log(`\n=== ${SUITE} ===`);
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
