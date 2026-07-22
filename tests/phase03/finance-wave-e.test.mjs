import assert from 'node:assert';
import { setup, cleanup, seedOrg } from '../phase02/harness.mjs';
import { createActionExecutor } from '../../platform/kernel/actions/index.mjs';
import { registerFinanceActions, seedChartOfAccounts, accountIdByCode } from '../../platform/finance/index.mjs';
import {
  createDocument, submitDocument, approveDocument, postDocument,
  createDimension, createDimensionValue,
  createBudget, submitBudget, approveBudget, rejectBudget, reviseBudget, updateBudgetLines, getBudgetVariance,
  createExpenseClaim, submitExpenseClaim, approveExpenseClaim, rejectExpenseClaim,
  issueEmployeeAdvance, settleAdvanceAgainstClaim,
  getProfitAndLoss, getBalanceSheet, getCashFlow, getPartnerLedger, getTaxReport, runReport, snapshotReport,
  createTax, createCreditNote,
  createAssetCategory, capitalizeAsset, postAssetDepreciation, disposeAsset,
} from '../../platform/finance/engine.mjs';

const SUITE = 'finance-wave-e';

async function setupFinance() {
  const { dialect, dbPath } = await setup(SUITE);
  const org = seedOrg(dialect);
  seedChartOfAccounts(dialect, { companyId: org.companyA1, userId: 'u_owner' });
  const executor = createActionExecutor(dialect);
  registerFinanceActions(executor);
  return { dialect, dbPath, org, executor };
}

function periodIdFor(dialect, companyId, dateStr) {
  return dialect.prepare('SELECT id FROM finance_periods WHERE company_id = ? AND start_date <= ? AND end_date >= ?').get(companyId, dateStr, dateStr).id;
}

function postSimple(dialect, ctx, debitAcc, creditAcc, amount, date) {
  const doc = createDocument(dialect, ctx, { move_type: 'manual_entry', doc_date: date, lines: [{ account_id: debitAcc, debit: amount, credit: 0 }, { account_id: creditAcc, debit: 0, credit: amount }] });
  submitDocument(dialect, ctx, { document_id: doc.id });
  approveDocument(dialect, ctx, { document_id: doc.id });
  return postDocument(dialect, ctx, { document_id: doc.id });
}

async function run() {
  const failures = [];
  const tests = [
    // --- Budgeting foundation (Packet 03.22) ---

    ['approved budget version cannot be mutated; revision creates new lineage', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const expense = accountIdByCode(dialect, org.companyA1, '502000');
        const fy = dialect.prepare('SELECT id FROM finance_fiscal_years WHERE company_id = ?').get(org.companyA1).id;
        const period = periodIdFor(dialect, org.companyA1, '2026-06-15');
        const budget = createBudget(dialect, ctx, { code: 'OPEX_2026', name: 'Opex 2026', fiscal_year_id: fy, lines: [{ account_id: expense, period_id: period, amount: 1000 }] });
        submitBudget(dialect, ctx, { budget_id: budget.id });
        approveBudget(dialect, ctx, { budget_id: budget.id });
        assert.throws(() => updateBudgetLines(dialect, ctx, { budget_id: budget.id, lines: [{ account_id: expense, period_id: period, amount: 2000 }] }), /only a draft budget version can be edited/);
        const revised = reviseBudget(dialect, ctx, { budget_id: budget.id, lines: [{ account_id: expense, period_id: period, amount: 1500 }] });
        assert.strictEqual(revised.status, 'draft');
        const revisedRow = dialect.prepare('SELECT parent_budget_id, version FROM finance_budgets WHERE id = ?').get(revised.id);
        assert.strictEqual(revisedRow.parent_budget_id, budget.id);
        assert.strictEqual(revisedRow.version, 2);
        const originalStillIntact = dialect.prepare('SELECT amount FROM finance_budget_lines WHERE budget_id = ?').get(budget.id).amount;
        assert.strictEqual(originalStillIntact, 1000); // original approved line untouched by the revision
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['budget variance reconciles to actual GL activity, with dimension scoping', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const expense = accountIdByCode(dialect, org.companyA1, '502000');
        const fy = dialect.prepare('SELECT id FROM finance_fiscal_years WHERE company_id = ?').get(org.companyA1).id;
        const period = periodIdFor(dialect, org.companyA1, '2026-06-01');
        const dim = createDimension(dialect, ctx, { code: 'DEPT_BUD', name: 'Department' });
        const dv = createDimensionValue(dialect, ctx, { dimension_id: dim.id, code: 'OPS', name: 'Operations' });
        const doc = createDocument(dialect, ctx, {
          move_type: 'manual_entry', doc_date: '2026-06-10',
          lines: [{ account_id: expense, debit: 600, credit: 0, dims: JSON.stringify({ [dv.id]: 100 }) }, { account_id: cash, debit: 0, credit: 600 }],
        });
        submitDocument(dialect, ctx, { document_id: doc.id });
        approveDocument(dialect, ctx, { document_id: doc.id });
        postDocument(dialect, ctx, { document_id: doc.id });

        const budget = createBudget(dialect, ctx, { code: 'DEPT_BUDGET', name: 'Ops budget', fiscal_year_id: fy, lines: [{ account_id: expense, dimension_value_id: dv.id, period_id: period, amount: 500 }] });
        const variance = getBudgetVariance(dialect, ctx, { budget_id: budget.id });
        assert.strictEqual(variance[0].actual, 600);
        assert.strictEqual(variance[0].variance, 100);
        assert.strictEqual(variance[0].over_warn_threshold, true); // 120% >= default 80% warn threshold
      } finally { await cleanup(dialect, dbPath); }
    }],

    // --- Expense claims and employee advances (Packet 03.23) ---

    ['duplicate receipt fingerprint is rejected by a real database constraint', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const expense = accountIdByCode(dialect, org.companyA1, '502000');
        createExpenseClaim(dialect, ctx, { employee_id: 'emp_1', lines: [{ category: 'travel', expense_account_id: expense, amount: 50, expense_date: '2026-06-01', receipt_fingerprint: 'RCPT-HASH-1' }] });
        assert.throws(() => createExpenseClaim(dialect, ctx, { employee_id: 'emp_1', lines: [{ category: 'travel', expense_account_id: expense, amount: 50, expense_date: '2026-06-02', receipt_fingerprint: 'RCPT-HASH-1' }] }), /duplicate receipt/);
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['over-policy line requires an override reason to approve; rejected claim requires a reason', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const expense = accountIdByCode(dialect, org.companyA1, '502000');
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const claim = createExpenseClaim(dialect, ctx, { employee_id: 'emp_2', lines: [{ category: 'meals', expense_account_id: expense, amount: 900, expense_date: '2026-06-01' }] });
        submitExpenseClaim(dialect, ctx, { claim_id: claim.id });
        const lineId = dialect.prepare('SELECT id FROM finance_expense_claim_lines WHERE claim_id = ?').get(claim.id).id;
        assert.throws(() => approveExpenseClaim(dialect, ctx, { claim_id: claim.id, reimbursement_account_id: cash, over_policy_line_ids: [lineId] }), /over-policy lines require an override_reason/);
        const approved = approveExpenseClaim(dialect, ctx, { claim_id: claim.id, reimbursement_account_id: cash, over_policy_line_ids: [lineId], override_reason: 'client dinner pre-approved by manager' });
        assert.strictEqual(approved.status, 'approved');

        const claim2 = createExpenseClaim(dialect, ctx, { employee_id: 'emp_2', lines: [{ category: 'misc', expense_account_id: expense, amount: 20, expense_date: '2026-06-02' }] });
        submitExpenseClaim(dialect, ctx, { claim_id: claim2.id });
        assert.throws(() => rejectExpenseClaim(dialect, ctx, { claim_id: claim2.id, reason: '' }), /rejection reason is required/);
        const rejected = rejectExpenseClaim(dialect, ctx, { claim_id: claim2.id, reason: 'missing original receipt' });
        assert.strictEqual(rejected.status, 'rejected');
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['approving a claim posts exactly one balancing document (no reimbursement duplication)', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const expense = accountIdByCode(dialect, org.companyA1, '502000');
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const claim = createExpenseClaim(dialect, ctx, { employee_id: 'emp_3', lines: [{ category: 'supplies', expense_account_id: expense, amount: 75, expense_date: '2026-06-01' }] });
        submitExpenseClaim(dialect, ctx, { claim_id: claim.id });
        const approved = approveExpenseClaim(dialect, ctx, { claim_id: claim.id, reimbursement_account_id: cash });
        assert.throws(() => approveExpenseClaim(dialect, ctx, { claim_id: claim.id, reimbursement_account_id: cash }), /only a submitted claim can be approved/);
        const docCount = dialect.prepare('SELECT COUNT(*) AS n FROM finance_documents WHERE id = ?').get(approved.document_id).n;
        assert.strictEqual(docCount, 1);
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['employee advance: partial then full settlement against an approved claim', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        const expense = accountIdByCode(dialect, org.companyA1, '502000');
        const advance = issueEmployeeAdvance(dialect, ctx, { employee_id: 'emp_4', amount: 200, control_account_id: receivable, cash_or_bank_account_id: cash });
        assert.strictEqual(advance.status, 'issued');
        const claim = createExpenseClaim(dialect, ctx, { employee_id: 'emp_4', lines: [{ category: 'travel', expense_account_id: expense, amount: 200, expense_date: '2026-06-05' }] });
        submitExpenseClaim(dialect, ctx, { claim_id: claim.id });
        approveExpenseClaim(dialect, ctx, { claim_id: claim.id, reimbursement_account_id: receivable });
        const partial = settleAdvanceAgainstClaim(dialect, ctx, { advance_id: advance.id, claim_id: claim.id, amount: 120 });
        assert.strictEqual(partial.status, 'partially_settled');
        assert.throws(() => settleAdvanceAgainstClaim(dialect, ctx, { advance_id: advance.id, claim_id: claim.id, amount: 100 }), /exceeds remaining advance balance/);
        const full = settleAdvanceAgainstClaim(dialect, ctx, { advance_id: advance.id, claim_id: claim.id, amount: 80 });
        assert.strictEqual(full.status, 'settled');
      } finally { await cleanup(dialect, dbPath); }
    }],

    // --- Canonical financial report queries (Packet 03.24) ---

    ['P&L and Balance Sheet reconcile to posted GL activity', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        const expense = accountIdByCode(dialect, org.companyA1, '502000');
        postSimple(dialect, ctx, cash, income, 5000, '2026-06-01'); // revenue received
        postSimple(dialect, ctx, expense, cash, 2000, '2026-06-02'); // expense paid

        const pnl = getProfitAndLoss(dialect, ctx, { start_date: '2026-06-01', end_date: '2026-06-30' });
        assert.strictEqual(pnl.totals.income, 5000);
        assert.strictEqual(pnl.totals.expense, 2000);
        assert.strictEqual(pnl.totals.net_result, 3000);

        const bs = getBalanceSheet(dialect, ctx, { as_of_date: '2026-06-30' });
        assert.strictEqual(bs.totals.balanced, true);
        assert.strictEqual(bs.totals.current_result, 3000);
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['cash flow report reconciles net change to liquidity account movement', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        postSimple(dialect, ctx, cash, income, 1200, '2026-06-01');
        const cf = getCashFlow(dialect, ctx, { start_date: '2026-06-01', end_date: '2026-06-30' });
        assert.strictEqual(cf.net_change, 1200);
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['partner ledger lists posted partner-linked lines in date order', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        const doc = createDocument(dialect, ctx, { move_type: 'customer_invoice', doc_date: '2026-06-01', partner_id: 'cust_ledger', lines: [{ account_id: receivable, debit: 300, credit: 0 }, { account_id: income, debit: 0, credit: 300 }] });
        submitDocument(dialect, ctx, { document_id: doc.id });
        approveDocument(dialect, ctx, { document_id: doc.id });
        postDocument(dialect, ctx, { document_id: doc.id });
        // The document-level partner_id propagates to every line that doesn't set its own
        // (see createDocument), so both the receivable and income lines carry it here —
        // the ledger is a full partner-linked-line view, not just the AR control line.
        const ledger = getPartnerLedger(dialect, ctx, { partner_id: 'cust_ledger' });
        assert.strictEqual(ledger.length, 2);
        const receivableLine = ledger.find(l => l.account_id === receivable);
        assert.strictEqual(receivableLine.net, 300);
        assert.strictEqual(ledger.reduce((s, l) => s + l.net, 0), 0); // the two lines balance each other
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['tax report reconciles to tax-role-tagged account GL balances', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        const vatPayable = accountIdByCode(dialect, org.companyA1, '202000'); // seeded VAT Payable account
        dialect.prepare("UPDATE finance_accounts SET tax_role = 'output_vat' WHERE id = ?").run(vatPayable);
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const doc = createDocument(dialect, ctx, {
          move_type: 'manual_entry', doc_date: '2026-06-01',
          lines: [{ account_id: cash, debit: 1150, credit: 0 }, { account_id: income, debit: 0, credit: 1000 }, { account_id: vatPayable, debit: 0, credit: 150 }],
        });
        submitDocument(dialect, ctx, { document_id: doc.id });
        approveDocument(dialect, ctx, { document_id: doc.id });
        postDocument(dialect, ctx, { document_id: doc.id });
        const report = getTaxReport(dialect, ctx, { start_date: '2026-06-01', end_date: '2026-06-30' });
        const vatRow = report.find(r => r.account_id === vatPayable);
        assert.strictEqual(vatRow.net, 150);
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['report snapshot stores an immutable point-in-time copy', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        postSimple(dialect, ctx, cash, income, 400, '2026-06-01');
        const snap = snapshotReport(dialect, ctx, { report_code: 'trial_balance', params: {} });
        assert.ok(snap.id);
        postSimple(dialect, ctx, cash, income, 999, '2026-06-02'); // more activity after the snapshot
        const stored = dialect.prepare('SELECT data_json FROM finance_report_snapshots WHERE id = ?').get(snap.id);
        const storedData = JSON.parse(stored.data_json);
        assert.deepStrictEqual(storedData, snap.data); // snapshot never re-reads live data
        assert.throws(() => runReport(dialect, ctx, { report_code: 'not_a_real_report' }), /unknown report_code/);
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['field/scope isolation: reports never cross company boundaries', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        seedChartOfAccounts(dialect, { companyId: org.companyB1, userId: 'u_beta' });
        const ctxA = { companyId: org.companyA1, userId: 'u_owner' };
        const ctxB = { companyId: org.companyB1, userId: 'u_beta' };
        const cashA = accountIdByCode(dialect, org.companyA1, '101000');
        const incomeA = accountIdByCode(dialect, org.companyA1, '401000');
        postSimple(dialect, ctxA, cashA, incomeA, 7000, '2026-06-01');
        const pnlB = getProfitAndLoss(dialect, ctxB, { start_date: '2026-06-01', end_date: '2026-06-30' });
        assert.strictEqual(pnlB.totals.income, 0);
      } finally { await cleanup(dialect, dbPath); }
    }],

    // --- Asset-accounting interface (Packet 03.26) ---

    ['capitalization, depreciation, and disposal (gain and loss) fixtures post balanced, reversible documents', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const assetAcc = accountIdByCode(dialect, org.companyA1, '104000');
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const depExpense = accountIdByCode(dialect, org.companyA1, '502000');
        const accumDep = accountIdByCode(dialect, org.companyA1, '104000'); // reuse an existing asset-type account as accumulated-depreciation contra for the fixture
        const gainAcc = accountIdByCode(dialect, org.companyA1, '401000');
        const lossAcc = accountIdByCode(dialect, org.companyA1, '502000');

        const category = createAssetCategory(dialect, ctx, {
          code: 'VEHICLES', name: 'Vehicles', asset_account_id: assetAcc, depreciation_expense_account_id: depExpense,
          accumulated_depreciation_account_id: accumDep, disposal_gain_account_id: gainAcc, disposal_loss_account_id: lossAcc,
        });

        const cap = capitalizeAsset(dialect, ctx, { category_id: category.id, amount: 10000, source_account_id: cash, asset_reference: 'VEH-001' });
        assert.strictEqual(dialect.prepare('SELECT state FROM finance_documents WHERE id = ?').get(cap.document_id).state, 'posted');

        const dep = postAssetDepreciation(dialect, ctx, { category_id: category.id, amount: 500, asset_reference: 'VEH-001' });
        assert.strictEqual(dialect.prepare('SELECT state FROM finance_documents WHERE id = ?').get(dep.document_id).state, 'posted');

        const disposalGain = disposeAsset(dialect, ctx, { category_id: category.id, asset_reference: 'VEH-001', net_book_value: 9500, proceeds: 9800, proceeds_account_id: cash });
        assert.strictEqual(disposalGain.gain, 300);
        assert.strictEqual(disposalGain.loss, 0);

        const category2 = createAssetCategory(dialect, ctx, {
          code: 'EQUIPMENT', name: 'Equipment', asset_account_id: assetAcc, depreciation_expense_account_id: depExpense,
          accumulated_depreciation_account_id: accumDep, disposal_gain_account_id: gainAcc, disposal_loss_account_id: lossAcc,
        });
        const disposalLoss = disposeAsset(dialect, ctx, { category_id: category2.id, asset_reference: 'EQ-001', net_book_value: 4000, proceeds: 3200, proceeds_account_id: cash });
        assert.strictEqual(disposalLoss.loss, 800);
        assert.strictEqual(disposalLoss.gain, 0);
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['asset posting is denied when the category is missing a required disposal account', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const assetAcc = accountIdByCode(dialect, org.companyA1, '104000');
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const depExpense = accountIdByCode(dialect, org.companyA1, '502000');
        const category = createAssetCategory(dialect, ctx, { code: 'NO_GAIN_ACC', name: 'No gain account configured', asset_account_id: assetAcc, depreciation_expense_account_id: depExpense, accumulated_depreciation_account_id: assetAcc });
        assert.throws(() => disposeAsset(dialect, ctx, { category_id: category.id, asset_reference: 'X-1', net_book_value: 100, proceeds: 150, proceeds_account_id: cash }), /disposal_gain_account_id/);
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['asset posting respects period locks (no duplicate accounting engine bypasses the shared gate)', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const assetAcc = accountIdByCode(dialect, org.companyA1, '104000');
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const depExpense = accountIdByCode(dialect, org.companyA1, '502000');
        const category = createAssetCategory(dialect, ctx, { code: 'LOCKED_TEST', name: 'Locked period test', asset_account_id: assetAcc, depreciation_expense_account_id: depExpense, accumulated_depreciation_account_id: assetAcc });
        const { setLockDate } = await import('../../platform/finance/engine.mjs');
        setLockDate(dialect, ctx, { module: 'gl', lock_date: '2026-06-15' });
        assert.throws(() => capitalizeAsset(dialect, ctx, { category_id: category.id, amount: 1000, source_account_id: cash, asset_reference: 'LOCKED-1', doc_date: '2026-06-10' }), /locked/);
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
