import assert from 'node:assert';
import fs from 'node:fs';
import { setup, cleanup, seedOrg } from '../phase02/harness.mjs';
import { createActionExecutor } from '../../platform/kernel/actions/index.mjs';
import { registerFinanceActions, seedChartOfAccounts, accountIdByCode } from '../../platform/finance/index.mjs';
import { migration as financeMigration } from '../../database/migrations/014_finance_canonical_schema_and_coa.mjs';
import { migration as documentLifecycleMigration } from '../../database/migrations/015_finance_document_lifecycle.mjs';
import { migration as dimensionsMigration } from '../../database/migrations/016_accounting_dimensions.mjs';
import { migration as currencyMigration } from '../../database/migrations/017_currency_and_exchange_rates.mjs';
import { migration as taxMigration } from '../../database/migrations/018_tax_definition_and_calculation.mjs';
import { migration as fiscalPositionMigration } from '../../database/migrations/019_fiscal_positions_and_iraq_localization.mjs';
import { migration as arMigration } from '../../database/migrations/020_accounts_receivable_subledger.mjs';
import { migration as apMigration } from '../../database/migrations/021_accounts_payable_subledger.mjs';
import {
  createAccount, updateAccount, createDocument, submitDocument, approveDocument, cancelDocument, postDocument, reverseDocument,
  getTrialBalance, getGeneralLedger, hardClosePeriod, reopenPeriod, verifyHashChain,
  createJournal,
} from '../../platform/finance/engine.mjs';

const SUITE = 'finance-wave-a';

function createAndApproveDocument(dialect, ctx, input) {
  const doc = createDocument(dialect, ctx, input);
  submitDocument(dialect, ctx, { document_id: doc.id });
  approveDocument(dialect, ctx, { document_id: doc.id });
  return doc;
}

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
    ['migration 014 applied and module enabled', async () => {
      const { dialect, dbPath } = await setupFinance();
      try {
        const applied = dialect.prepare('SELECT 1 FROM schema_migrations WHERE migration_id = ?').get('014_finance_canonical_schema_and_coa');
        assert.ok(applied, 'migration 014 not applied');
        const moduleRow = dialect.prepare('SELECT status FROM platform_modules WHERE id = ?').get('finance_canonical');
        assert.strictEqual(moduleRow.status, 'enabled');
        const actions = dialect.prepare('SELECT COUNT(*) AS n FROM platform_actions WHERE module_id = ?').get('finance_canonical');
        assert.ok(actions.n >= 10, 'finance actions missing');
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['duplicate account code rejected', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        assert.throws(
          () => createAccount(dialect, ctx, { code: '101000', name: 'Duplicate Cash', type: 'liquidity' }),
          /duplicate/
        );
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['invalid account type rejected', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        assert.throws(
          () => createAccount(dialect, ctx, { code: '999', name: 'Bad', type: 'notatype' }),
          /invalid account type/
        );
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['account hierarchy cycle rejected', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const a = createAccount(dialect, ctx, { code: 'CYCLE_A', name: 'A', type: 'asset' });
        const b = createAccount(dialect, ctx, { code: 'CYCLE_B', name: 'B', type: 'asset', parent_id: a.id });
        const c = createAccount(dialect, ctx, { code: 'CYCLE_C', name: 'C', type: 'asset', parent_id: b.id });
        assert.throws(
          () => updateAccount(dialect, ctx, { account_id: a.id, parent_id: c.id }),
          /cycle/
        );
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['cross-company account access denied', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const cashA1 = accountIdByCode(dialect, org.companyA1, '101000');
        assert.ok(cashA1);
        const cashA2 = dialect.prepare('SELECT id FROM finance_accounts WHERE company_id = ? AND code = ?').get(org.companyA2, '101000');
        assert.strictEqual(cashA2, undefined);
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['unbalanced document rejected', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const expense = accountIdByCode(dialect, org.companyA1, '502000');
        const doc = createAndApproveDocument(dialect, ctx, {
          move_type: 'manual_entry',
          doc_date: '2026-03-15',
          lines: [
            { account_id: expense, debit: 1000, credit: 0 },
            { account_id: cash, debit: 0, credit: 500 },
          ],
        });
        assert.throws(
          () => postDocument(dialect, ctx, { document_id: doc.id }),
          /not balanced/
        );
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['post document assigns sequence and hash', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const expense = accountIdByCode(dialect, org.companyA1, '502000');
        const doc = createAndApproveDocument(dialect, ctx, {
          move_type: 'manual_entry',
          doc_date: '2026-03-15',
          lines: [
            { account_id: expense, debit: 1000, credit: 0, description: 'Expense' },
            { account_id: cash, debit: 0, credit: 1000, description: 'Cash paid' },
          ],
        });
        const posted = postDocument(dialect, ctx, { document_id: doc.id });
        assert.ok(posted.doc_number, 'doc_number not assigned');
        assert.ok(posted.doc_number.startsWith('JV-'), 'unexpected number prefix');
        assert.strictEqual(posted.state, 'posted');
        const entry = dialect.prepare('SELECT entry_number, hash, prev_hash FROM finance_journal_entries WHERE document_id = ?').get(posted.id);
        assert.ok(entry.hash, 'hash not set');
        assert.ok(entry.prev_hash, 'prev_hash not set');
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['trial balance reconciles after posting', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const expense = accountIdByCode(dialect, org.companyA1, '502000');
        const doc = createAndApproveDocument(dialect, ctx, {
          move_type: 'manual_entry',
          doc_date: '2026-03-15',
          lines: [
            { account_id: expense, debit: 2500, credit: 0 },
            { account_id: cash, debit: 0, credit: 2500 },
          ],
        });
        postDocument(dialect, ctx, { document_id: doc.id });
        const tb = getTrialBalance(dialect, ctx);
        const expenseRow = tb.find(r => r.account_id === expense);
        const cashRow = tb.find(r => r.account_id === cash);
        assert.strictEqual(expenseRow.total_debit, 2500);
        assert.strictEqual(cashRow.total_credit, 2500);
        const totalDebit = tb.reduce((s, r) => s + r.total_debit, 0);
        const totalCredit = tb.reduce((s, r) => s + r.total_credit, 0);
        assert.strictEqual(totalDebit, totalCredit);
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['reversal creates linked document and net-zero trial balance', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const expense = accountIdByCode(dialect, org.companyA1, '502000');
        const doc = createAndApproveDocument(dialect, ctx, {
          move_type: 'manual_entry',
          doc_date: '2026-03-15',
          lines: [
            { account_id: expense, debit: 800, credit: 0 },
            { account_id: cash, debit: 0, credit: 800 },
          ],
        });
        postDocument(dialect, ctx, { document_id: doc.id });
        const result = reverseDocument(dialect, ctx, { document_id: doc.id, reason: 'correction' });
        assert.strictEqual(result.original.state, 'reversed');
        assert.ok(result.original.reversal_id);
        assert.strictEqual(result.reversal.state, 'posted');
        const tb = getTrialBalance(dialect, ctx);
        const totalDebit = tb.reduce((s, r) => s + r.total_debit, 0);
        const totalCredit = tb.reduce((s, r) => s + r.total_credit, 0);
        assert.strictEqual(totalDebit, totalCredit);
        const netExpense = tb.find(r => r.account_id === expense);
        assert.ok(Math.abs(netExpense.balance) < 0.01, 'expense balance not net-zero after reversal');
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['period lock prevents posting', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const expense = accountIdByCode(dialect, org.companyA1, '502000');
        const period = dialect.prepare('SELECT id FROM finance_periods WHERE company_id = ? AND start_date <= ? AND end_date >= ?').get(org.companyA1, '2026-03-15', '2026-03-15');
        hardClosePeriod(dialect, ctx, { period_id: period.id });
        const doc = createAndApproveDocument(dialect, ctx, {
          move_type: 'manual_entry',
          doc_date: '2026-03-15',
          lines: [
            { account_id: expense, debit: 100, credit: 0 },
            { account_id: cash, debit: 0, credit: 100 },
          ],
        });
        assert.throws(
          () => postDocument(dialect, ctx, { document_id: doc.id }),
          /period is closed/
        );
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['append-only GL trigger blocks direct mutation', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const expense = accountIdByCode(dialect, org.companyA1, '502000');
        const doc = createAndApproveDocument(dialect, ctx, {
          move_type: 'manual_entry',
          doc_date: '2026-04-10',
          lines: [
            { account_id: expense, debit: 300, credit: 0 },
            { account_id: cash, debit: 0, credit: 300 },
          ],
        });
        postDocument(dialect, ctx, { document_id: doc.id });
        const line = dialect.prepare('SELECT id FROM finance_journal_lines WHERE company_id = ? LIMIT 1').get(org.companyA1);
        assert.throws(
          () => dialect.exec(`UPDATE finance_journal_lines SET debit = 999 WHERE id = '${line.id}'`),
          /append-only/
        );
        assert.throws(
          () => dialect.exec(`DELETE FROM finance_journal_lines WHERE id = '${line.id}'`),
          /append-only/
        );
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['action executor registers and runs finance_account:create', async () => {
      const { dialect, dbPath, org, executor } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const result = executor.execute('finance_account:create', {
          code: '700_EXEC',
          name: 'Executor Test Account',
          type: 'expense',
          idempotency_key: 'exec-create-1',
        }, ctx);
        assert.ok(result.id);
        const row = dialect.prepare('SELECT code FROM finance_accounts WHERE id = ?').get(result.id);
        assert.strictEqual(row.code, '700_EXEC');
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['hash chain verifies after multiple postings', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const expense = accountIdByCode(dialect, org.companyA1, '502000');
        for (const amount of [100, 200, 300]) {
          const doc = createAndApproveDocument(dialect, ctx, {
            move_type: 'manual_entry',
            doc_date: '2026-05-01',
            lines: [
              { account_id: expense, debit: amount, credit: 0 },
              { account_id: cash, debit: 0, credit: amount },
            ],
          });
          postDocument(dialect, ctx, { document_id: doc.id });
        }
        const verify = verifyHashChain(dialect, ctx, {});
        assert.strictEqual(verify.ok, true);
        assert.strictEqual(verify.count, 3);
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['migration rollback removes finance tables', async () => {
      const { dialect, dbPath } = await setupFinance();
      try {
        // Roll back the full finance_canonical dependency chain in reverse order
        // (021 -> ... -> 014), mirroring how the migration runner unwinds dependents
        // before their dependencies. Calling only 014's down() in isolation would
        // leave behind every table introduced by 015-021.
        for (const m of [apMigration, arMigration, fiscalPositionMigration, taxMigration, currencyMigration, dimensionsMigration, documentLifecycleMigration, financeMigration]) {
          m.down(dialect);
        }
        const tables = dialect.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'finance_%'").all();
        assert.strictEqual(tables.length, 0, 'finance tables remain after rollback');
        const moduleRow = dialect.prepare('SELECT id FROM platform_modules WHERE id = ?').get('finance_canonical');
        assert.strictEqual(moduleRow, undefined, 'finance_canonical module remains after rollback');
        const actionRows = dialect.prepare('SELECT id FROM platform_actions WHERE module_id = ?').all('finance_canonical');
        assert.strictEqual(actionRows.length, 0, 'finance actions remain after rollback');
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
