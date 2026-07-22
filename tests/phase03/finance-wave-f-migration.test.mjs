import assert from 'node:assert';
import { setup, cleanup, seedOrg } from '../phase02/harness.mjs';
import { registerFinanceActions, seedChartOfAccounts, accountIdByCode } from '../../platform/finance/index.mjs';
import {
  mapLegacyAccountType, migrateLegacyAccounts, migrateLegacyMoves, reconcileMigrationTrialBalance,
  getMigrationQuarantine, getMigrationRunStatus, rollbackMigrationRun, getMigrationSourceMapping,
  getTrialBalance, postSourceFact, reverseSourceFact,
} from '../../platform/finance/engine.mjs';

const SUITE = 'finance-wave-f-migration';

function seedFiscalYearOnly(dialect, companyId) {
  // Legacy account/move migration tests intentionally do NOT call
  // seedChartOfAccounts — the whole point is to prove the migration itself
  // builds the chart of accounts from synthetic legacy fixtures. Posting still
  // requires an open fiscal period to exist (Packet 03.27 lists "fiscal
  // years/periods" as its own migration class, sequenced before moves in any
  // real run), so this seeds only that, not the demo chart of accounts.
  const now = new Date().toISOString();
  const yearId = `fy_${companyId}_2026`;
  dialect.prepare(`
    INSERT INTO finance_fiscal_years (id, company_id, name, start_date, end_date, status, created_at, updated_at, created_by)
    VALUES (?, ?, '2026', '2026-01-01', '2026-12-31', 'open', ?, ?, 'system')
  `).run(yearId, companyId, now, now);
  for (let m = 1; m <= 12; m++) {
    const ms = String(m).padStart(2, '0');
    const end = new Date(2026, m, 0).toISOString().split('T')[0];
    dialect.prepare(`
      INSERT INTO finance_periods (id, company_id, fiscal_year_id, name, start_date, end_date, status, created_at, updated_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, 'system')
    `).run(`period_${companyId}_2026_${ms}`, companyId, yearId, `2026-${ms}`, `2026-${ms}-01`, end, now, now);
  }
}

async function setupEmptyFinance() {
  const { dialect, dbPath } = await setup(SUITE);
  const org = seedOrg(dialect);
  seedFiscalYearOnly(dialect, org.companyA1);
  return { dialect, dbPath, org };
}

async function setupSeededFinance() {
  const { dialect, dbPath } = await setup(SUITE);
  const org = seedOrg(dialect);
  seedChartOfAccounts(dialect, { companyId: org.companyA1, userId: 'u_owner' });
  return { dialect, dbPath, org };
}

async function run() {
  const failures = [];
  const tests = [
    // --- Legacy account/opening-balance migration (Packet 03.27) ---

    ['legacy account type mapping covers common legacy vocabulary and rejects the unknown', () => {
      assert.strictEqual(mapLegacyAccountType('Asset'), 'asset');
      assert.strictEqual(mapLegacyAccountType('revenue'), 'income');
      assert.strictEqual(mapLegacyAccountType('bank'), 'liquidity');
      assert.strictEqual(mapLegacyAccountType('nonsense_legacy_type'), null);
    }],

    ['valid legacy accounts import; unmappable type and missing name are quarantined, not silently dropped', async () => {
      const { dialect, dbPath, org } = await setupEmptyFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const result = migrateLegacyAccounts(dialect, ctx, {
          legacy_accounts: [
            { id: 'L-CASH', code: '10100', name: 'Cash on hand', type: 'cash' },
            { id: 'L-AR', code: '10300', name: 'Accounts Receivable', type: 'receivable' },
            { id: 'L-BAD-TYPE', code: '99999', name: 'Mystery account', type: 'not_a_real_type' },
            { id: 'L-NO-NAME', code: '99998', type: 'asset' },
          ],
        });
        assert.strictEqual(result.imported, 2);
        assert.strictEqual(result.quarantined, 2);
        const run = getMigrationRunStatus(dialect, ctx, { migration_run_id: result.run_id });
        assert.strictEqual(run.status, 'completed');
        const quarantine = getMigrationQuarantine(dialect, ctx, { migration_run_id: result.run_id });
        assert.strictEqual(quarantine.length, 2);
        assert.ok(quarantine.some(q => q.source_id === 'L-BAD-TYPE' && q.reason.includes('unmappable')));
        const cashAccount = accountIdByCode(dialect, org.companyA1, '10100');
        assert.ok(cashAccount);
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['re-running the same account import is idempotent (source map prevents duplicates)', async () => {
      const { dialect, dbPath, org } = await setupEmptyFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const legacy_accounts = [{ id: 'L-1', code: '20100', name: 'Legacy Payables', type: 'payable' }];
        const first = migrateLegacyAccounts(dialect, ctx, { legacy_accounts });
        const second = migrateLegacyAccounts(dialect, ctx, { legacy_accounts });
        assert.strictEqual(first.imported, 1);
        assert.strictEqual(second.imported, 0);
        assert.strictEqual(second.skipped, 1);
        const count = dialect.prepare("SELECT COUNT(*) AS n FROM finance_accounts WHERE company_id = ? AND code = '20100'").get(org.companyA1).n;
        assert.strictEqual(count, 1);
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['legacy parent/child account hierarchy is preserved through migration', async () => {
      const { dialect, dbPath, org } = await setupEmptyFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        migrateLegacyAccounts(dialect, ctx, {
          legacy_accounts: [
            { id: 'L-PARENT', code: '30000', name: 'Equity', type: 'equity' },
            { id: 'L-CHILD', code: '30100', name: 'Retained Earnings', type: 'equity', parent_id: 'L-PARENT' },
          ],
        });
        const parentId = accountIdByCode(dialect, org.companyA1, '30000');
        const childId = accountIdByCode(dialect, org.companyA1, '30100');
        const childRow = dialect.prepare('SELECT parent_id FROM finance_accounts WHERE id = ?').get(childId);
        assert.strictEqual(childRow.parent_id, parentId);
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['legacy moves migrate as balanced posted documents; unbalanced and account-not-migrated moves are quarantined', async () => {
      const { dialect, dbPath, org } = await setupEmptyFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        migrateLegacyAccounts(dialect, ctx, {
          legacy_accounts: [
            { id: 'L-CASH', code: '10100', name: 'Cash', type: 'cash' },
            { id: 'L-EXP', code: '50100', name: 'Office Expense', type: 'expense' },
          ],
        });
        const result = migrateLegacyMoves(dialect, ctx, {
          legacy_moves: [
            { id: 'M-1', date: '2026-01-15', lines: [{ account_id: 'L-EXP', debit: 100, credit: 0 }, { account_id: 'L-CASH', debit: 0, credit: 100 }] },
            { id: 'M-2-UNBALANCED', date: '2026-01-16', lines: [{ account_id: 'L-EXP', debit: 100, credit: 0 }, { account_id: 'L-CASH', debit: 0, credit: 90 }] },
            { id: 'M-3-MISSING-ACCOUNT', date: '2026-01-17', lines: [{ account_id: 'L-NEVER-MIGRATED', debit: 50, credit: 0 }, { account_id: 'L-CASH', debit: 0, credit: 50 }] },
          ],
        });
        assert.strictEqual(result.imported, 1);
        assert.strictEqual(result.quarantined, 2);
        const mapping = getMigrationSourceMapping(dialect, ctx, { source_system: 'legacy_move', source_id: 'M-1' });
        assert.ok(mapping);
        const doc = dialect.prepare('SELECT state FROM finance_documents WHERE id = ?').get(mapping.canonical_id);
        assert.strictEqual(doc.state, 'posted');
        const quarantine = getMigrationQuarantine(dialect, ctx, { migration_run_id: result.run_id });
        assert.ok(quarantine.some(q => q.source_id === 'M-2-UNBALANCED' && q.reason.includes('unbalanced')));
        assert.ok(quarantine.some(q => q.source_id === 'M-3-MISSING-ACCOUNT' && q.reason.includes('not migrated')));
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['re-running the same move import is idempotent (duplicate source reference is skipped, not re-posted)', async () => {
      const { dialect, dbPath, org } = await setupEmptyFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        migrateLegacyAccounts(dialect, ctx, { legacy_accounts: [{ id: 'L-CASH', code: '10100', name: 'Cash', type: 'cash' }, { id: 'L-EXP', code: '50100', name: 'Expense', type: 'expense' }] });
        const legacy_moves = [{ id: 'M-DUP', date: '2026-01-20', lines: [{ account_id: 'L-EXP', debit: 25, credit: 0 }, { account_id: 'L-CASH', debit: 0, credit: 25 }] }];
        const first = migrateLegacyMoves(dialect, ctx, { legacy_moves });
        const second = migrateLegacyMoves(dialect, ctx, { legacy_moves });
        assert.strictEqual(first.imported, 1);
        assert.strictEqual(second.imported, 0);
        assert.strictEqual(second.skipped, 1);
        const postedCount = dialect.prepare("SELECT COUNT(*) AS n FROM finance_documents WHERE company_id = ? AND source_type = 'legacy_migration' AND source_id = 'M-DUP'").get(org.companyA1).n;
        assert.strictEqual(postedCount, 1);
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['migration reconciles to the legacy trial balance; a genuine mismatch is reported, not hidden', async () => {
      const { dialect, dbPath, org } = await setupEmptyFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        migrateLegacyAccounts(dialect, ctx, { legacy_accounts: [{ id: 'L-CASH', code: '10100', name: 'Cash', type: 'cash' }, { id: 'L-EXP', code: '50100', name: 'Expense', type: 'expense' }] });
        migrateLegacyMoves(dialect, ctx, { legacy_moves: [{ id: 'M-REC', date: '2026-01-10', lines: [{ account_id: 'L-EXP', debit: 400, credit: 0 }, { account_id: 'L-CASH', debit: 0, credit: 400 }] }] });
        const good = reconcileMigrationTrialBalance(dialect, ctx, { legacy_trial_balance: [{ code: '10100', balance: -400 }, { code: '50100', balance: 400 }] });
        assert.strictEqual(good.fully_reconciled, true);
        const bad = reconcileMigrationTrialBalance(dialect, ctx, { legacy_trial_balance: [{ code: '10100', balance: -350 }, { code: '50100', balance: 400 }] });
        assert.strictEqual(bad.fully_reconciled, false);
        assert.strictEqual(bad.rows.find(r => r.code === '10100').reconciled, false);
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['migration run rollback reverses every posted document from that run', async () => {
      const { dialect, dbPath, org } = await setupEmptyFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        migrateLegacyAccounts(dialect, ctx, { legacy_accounts: [{ id: 'L-CASH', code: '10100', name: 'Cash', type: 'cash' }, { id: 'L-EXP', code: '50100', name: 'Expense', type: 'expense' }] });
        const moveResult = migrateLegacyMoves(dialect, ctx, { legacy_moves: [{ id: 'M-RB', date: '2026-01-05', lines: [{ account_id: 'L-EXP', debit: 60, credit: 0 }, { account_id: 'L-CASH', debit: 0, credit: 60 }] }] });
        const rollback = rollbackMigrationRun(dialect, ctx, { migration_run_id: moveResult.run_id });
        assert.strictEqual(rollback.documents_reversed, 1);
        const mapping = getMigrationSourceMapping(dialect, ctx, { source_system: 'legacy_move', source_id: 'M-RB' });
        const doc = dialect.prepare('SELECT state FROM finance_documents WHERE id = ?').get(mapping.canonical_id);
        assert.strictEqual(doc.state, 'reversed');
        assert.throws(() => rollbackMigrationRun(dialect, ctx, { migration_run_id: moveResult.run_id }), /only a completed run can be rolled back/);
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['migrated data stays company-isolated', async () => {
      const { dialect, dbPath, org } = await setupEmptyFinance();
      try {
        const ctxA = { companyId: org.companyA1, userId: 'u_owner' };
        const ctxB = { companyId: org.companyB1, userId: 'u_beta' };
        migrateLegacyAccounts(dialect, ctxA, { legacy_accounts: [{ id: 'L-ISO', code: '77777', name: 'Isolated Account', type: 'asset' }] });
        const seenInA = accountIdByCode(dialect, org.companyA1, '77777');
        assert.ok(seenInA);
        assert.throws(() => accountIdByCode(dialect, org.companyB1, '77777'), /not found/);
      } finally { await cleanup(dialect, dbPath); }
    }],

    // --- Cross-module accounting test adapters (Packet 03.28) ---

    ['source fact adapter validates the registered schema and rejects an unknown fact_type', async () => {
      const { dialect, dbPath, org } = await setupSeededFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        assert.throws(() => postSourceFact(dialect, ctx, { fact_type: 'not_a_registered_fact', source_id: 'X-1', doc_date: '2026-02-01', lines: [] }), /unknown source fact_type/);
        assert.throws(() => postSourceFact(dialect, ctx, { fact_type: 'sales_invoice_posting', source_id: 'SO-1', lines: [{ account_id: receivable, debit: 100, credit: 0 }, { account_id: income, debit: 0, credit: 100 }] }), /missing required field: doc_date/);
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['source fact posts through the one existing posting authority and is idempotent by source reference', async () => {
      const { dialect, dbPath, org } = await setupSeededFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        const fact = { fact_type: 'sales_invoice_posting', source_id: 'SO-42', doc_date: '2026-02-01', partner_id: 'cust_src', lines: [{ account_id: receivable, debit: 500, credit: 0 }, { account_id: income, debit: 0, credit: 500 }] };
        const posted = postSourceFact(dialect, ctx, fact);
        assert.strictEqual(dialect.prepare('SELECT state FROM finance_documents WHERE id = ?').get(posted.document_id).state, 'posted');
        assert.throws(() => postSourceFact(dialect, ctx, fact), /duplicate source reference/);
        const reversed = reverseSourceFact(dialect, ctx, { document_id: posted.document_id, reason: 'sales order cancelled' });
        assert.strictEqual(reversed.original.state, 'reversed');
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['source fact respects period locks and permission-derived company scope like every other document', async () => {
      const { dialect, dbPath, org } = await setupSeededFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const assetAcc = accountIdByCode(dialect, org.companyA1, '104000');
        const { setLockDate } = await import('../../platform/finance/engine.mjs');
        setLockDate(dialect, ctx, { module: 'gl', lock_date: '2026-02-15' });
        assert.throws(() => postSourceFact(dialect, ctx, { fact_type: 'stock_receipt_posting', source_id: 'GRN-1', doc_date: '2026-02-01', lines: [{ account_id: assetAcc, debit: 100, credit: 0 }, { account_id: assetAcc, debit: 0, credit: 100 }] }), /locked/);
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
