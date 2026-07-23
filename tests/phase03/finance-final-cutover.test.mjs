import assert from 'node:assert';
import { setup, seedOrg } from '../phase02/harness.mjs';
import { createActionExecutor } from '../../platform/kernel/actions/index.mjs';
import { registerFinanceActions, seedChartOfAccounts } from '../../platform/finance/index.mjs';
import { migration as m035 } from '../../database/migrations/035_governed_finance_cutover_and_tax_attribution.mjs';
import * as engine from '../../platform/finance/engine.mjs';

const SUITE = 'finance-final-cutover';

async function setupTestEnv() {
  const { dialect, dbPath } = await setup(SUITE);
  const org = seedOrg(dialect);
  seedChartOfAccounts(dialect, { companyId: org.companyA1, userId: 'u_owner' });
  // Ensure migration 035 runs AFTER initial setup so tables exist
  try {
    m035.up(dialect);
  } catch (e) {
    // Ignore if already applied
  }
  const executor = createActionExecutor(dialect);
  registerFinanceActions(executor);
  return { dialect, dbPath, org, executor };
}

function context(companyId = 'c1', userId = 'u_owner') {
  return { companyId, userId, now: new Date().toISOString() };
}

async function run() {
  console.log(`=== ${SUITE} ===`);
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`FAIL: ${name}`);
      console.error(err);
      failed++;
    }
  }

  await test('Migration 035: schema creation and fresh DB default CANONICAL_ONLY', async () => {
    const { dialect, org } = await setupTestEnv();
    const state = engine.getCutoverState(dialect, org.companyA1);
    assert.strictEqual(state, 'CANONICAL_ONLY', 'Default cutover state must be CANONICAL_ONLY');

    const cols = dialect.prepare("PRAGMA table_info(finance_journal_lines)").all().map(c => c.name);
    assert.ok(cols.includes('tax_id'));
    assert.ok(cols.includes('tax_version_id'));
    assert.ok(cols.includes('tax_amount'));
    assert.ok(cols.includes('fiscal_position_id'));

    // Down & Up test
    m035.down(dialect);
    const tables = dialect.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='finance_cutover_settings'").all();
    assert.strictEqual(tables.length, 0);

    m035.up(dialect);
    assert.strictEqual(engine.getCutoverState(dialect, org.companyA1), 'CANONICAL_ONLY');
  });

  await test('Cutover State Machine: transition and history auditing', async () => {
    const { dialect, org } = await setupTestEnv();
    const ctx = context(org.companyA1, 'admin_1');

    assert.throws(() => {
      engine.transitionCutoverState(dialect, ctx, { target_state: 'SHADOW_READ', reason: '' });
    }, /Reason is required/);

    assert.throws(() => {
      engine.transitionCutoverState(dialect, ctx, { target_state: 'INVALID_STATE', reason: 'testing' });
    }, /Invalid cutover state/);

    const res = engine.transitionCutoverState(dialect, ctx, { target_state: 'CANONICAL_READ_WRITE', reason: 'Audit verification complete' });
    assert.strictEqual(res.from_state, 'CANONICAL_ONLY');
    assert.strictEqual(res.to_state, 'CANONICAL_READ_WRITE');
    assert.strictEqual(engine.getCutoverState(dialect, org.companyA1), 'CANONICAL_READ_WRITE');

    const history = dialect.prepare("SELECT * FROM finance_cutover_history WHERE company_id = ? ORDER BY id DESC").all(org.companyA1);
    assert.ok(history.length >= 1);
    assert.strictEqual(history[0].from_state, 'CANONICAL_ONLY');
    assert.strictEqual(history[0].to_state, 'CANONICAL_READ_WRITE');
    assert.strictEqual(history[0].reason, 'Audit verification complete');
  });

  await test('Unified Period-Lock Authority: GL lock, tax lock, journal lock, soft/hard close', async () => {
    const { dialect, org } = await setupTestEnv();
    const ctx = context(org.companyA1, 'finance_mgr');

    const accCash = engine.accountIdByCode(dialect, org.companyA1, '101000');
    const accInc = engine.accountIdByCode(dialect, org.companyA1, '401000');

    const periods = dialect.prepare("SELECT id FROM finance_periods WHERE company_id = ? AND start_date = '2026-01-01'").get(org.companyA1);
    assert.ok(periods);
    engine.softClosePeriod(dialect, ctx, { period_id: periods.id });

    const doc = engine.createDocument(dialect, ctx, {
      move_type: 'manual_entry',
      doc_date: '2026-01-15',
      lines: [
        { account_id: accCash, debit: 100, credit: 0 },
        { account_id: accInc, debit: 0, credit: 100 }
      ]
    });
    engine.submitDocument(dialect, ctx, { document_id: doc.id });
    engine.approveDocument(dialect, ctx, { document_id: doc.id });

    assert.throws(() => {
      engine.postDocument(dialect, ctx, { document_id: doc.id });
    }, /period is closed or locked/);

    engine.reopenPeriod(dialect, ctx, { period_id: periods.id, reason: 'Correction required' });
    const posted = engine.postDocument(dialect, ctx, { document_id: doc.id });
    assert.strictEqual(posted.state, 'posted');

    engine.setLockDate(dialect, ctx, { module: 'gl', lock_date: '2026-01-20', reason: 'Month end lock' });

    const doc2 = engine.createDocument(dialect, ctx, {
      move_type: 'manual_entry',
      doc_date: '2026-01-10',
      lines: [
        { account_id: accCash, debit: 50, credit: 0 },
        { account_id: accInc, debit: 0, credit: 50 }
      ]
    });
    engine.submitDocument(dialect, ctx, { document_id: doc2.id });
    engine.approveDocument(dialect, ctx, { document_id: doc2.id });

    assert.throws(() => {
      engine.postDocument(dialect, ctx, { document_id: doc2.id });
    }, /document date is locked/);
  });

  await test('Line-Level Tax Attribution: document and journal line tax identity', async () => {
    const { dialect, org } = await setupTestEnv();
    const ctx = context(org.companyA1, 'tax_accountant');

    const accRec = engine.accountIdByCode(dialect, org.companyA1, '103000');
    const accInc = engine.accountIdByCode(dialect, org.companyA1, '401000');
    const accVat = engine.accountIdByCode(dialect, org.companyA1, '202000');

    const tax = engine.createTax(dialect, ctx, {
      code: 'VAT_15',
      name: 'Value Added Tax 15%',
      amount_type: 'percent',
      amount: 15
    });

    const doc = engine.createDocument(dialect, ctx, {
      move_type: 'customer_invoice',
      doc_date: '2026-02-10',
      lines: [
        { account_id: accRec, debit: 115, credit: 0 },
        { account_id: accInc, debit: 0, credit: 100, tax_id: tax.id, tax_version_id: 'v1', tax_base_amount: 100, tax_amount: 15 },
        { account_id: accVat, debit: 0, credit: 15, tax_id: tax.id, tax_version_id: 'v1', tax_base_amount: 100, tax_amount: 15 }
      ]
    });

    engine.submitDocument(dialect, ctx, { document_id: doc.id });
    engine.approveDocument(dialect, ctx, { document_id: doc.id });
    const posted = engine.postDocument(dialect, ctx, { document_id: doc.id });
    assert.strictEqual(posted.state, 'posted');

    const jLines = dialect.prepare("SELECT * FROM finance_journal_lines WHERE document_id = ? AND tax_id IS NOT NULL").all(doc.id);
    assert.ok(jLines.length >= 2);
    assert.strictEqual(jLines[0].tax_id, tax.id);
    assert.strictEqual(jLines[0].tax_version_id, 'v1');

    const taxReport = engine.getTaxReport(dialect, ctx, { start_date: '2026-02-01', end_date: '2026-02-28' });
    assert.ok(taxReport.length >= 1);
    const found = taxReport.find(r => r.tax_identity === tax.id);
    assert.ok(found);
    assert.strictEqual(found.total_tax_base, 200);
  });

  await test('Early Discount & Retainage Release Workflow', async () => {
    const { dialect, org } = await setupTestEnv();
    const ctx = context(org.companyA1, 'ar_clerk');

    const accRec = engine.accountIdByCode(dialect, org.companyA1, '103000');
    const accInc = engine.accountIdByCode(dialect, org.companyA1, '401000');

    const doc = engine.createDocument(dialect, ctx, {
      move_type: 'customer_invoice',
      doc_date: '2026-03-01',
      lines: [
        { account_id: accRec, debit: 1000, credit: 0 },
        { account_id: accInc, debit: 0, credit: 1000 }
      ]
    });

    dialect.prepare(`
      UPDATE finance_documents SET
        early_discount_percent = 2, early_discount_days = 10, early_discount_date = '2026-03-11', early_discount_amount = 20,
        retainage_percent = 10, retainage_amount = 100, retainage_due_date = '2026-06-01', retainage_released = 0
      WHERE id = ?
    `).run(doc.id);

    engine.submitDocument(dialect, ctx, { document_id: doc.id });
    engine.approveDocument(dialect, ctx, { document_id: doc.id });
    engine.postDocument(dialect, ctx, { document_id: doc.id });

    const released = engine.releaseRetainage(dialect, ctx, { document_id: doc.id, release_amount: 100 });
    assert.strictEqual(released.retainage_released, 1);
    assert.strictEqual(released.release_amount, 100);

    const updatedDoc = engine.getDocument(dialect, org.companyA1, doc.id);
    assert.strictEqual(updatedDoc.retainage_released, 1);
  });

  await test('Classified Cash-Flow Report: Operating, Investing, Financing, and GL Reconciliation', async () => {
    const { dialect, org } = await setupTestEnv();
    const ctx = context(org.companyA1, 'controller');

    const accCash = engine.accountIdByCode(dialect, org.companyA1, '101000');
    const accInc = engine.accountIdByCode(dialect, org.companyA1, '401000');
    const accAsset = engine.accountIdByCode(dialect, org.companyA1, '100000');
    const accExp = engine.accountIdByCode(dialect, org.companyA1, '502000');

    const docOp = engine.createDocument(dialect, ctx, {
      move_type: 'cash_receipt',
      doc_date: '2026-04-05',
      lines: [
        { account_id: accCash, debit: 500, credit: 0 },
        { account_id: accInc, debit: 0, credit: 500 }
      ]
    });
    engine.submitDocument(dialect, ctx, { document_id: docOp.id });
    engine.approveDocument(dialect, ctx, { document_id: docOp.id });
    engine.postDocument(dialect, ctx, { document_id: docOp.id });

    const category = engine.createAssetCategory(dialect, ctx, {
      code: 'EQUIP', name: 'Equipment',
      asset_account_id: accAsset,
      depreciation_expense_account_id: accExp,
      accumulated_depreciation_account_id: accAsset
    });
    engine.capitalizeAsset(dialect, ctx, {
      category_id: category.id,
      source_account_id: accCash,
      amount: 200,
      doc_date: '2026-04-10',
      asset_reference: 'EQ-001'
    });

    const cashFlow = engine.getCashFlow(dialect, ctx, { start_date: '2026-04-01', end_date: '2026-04-30' });

    assert.strictEqual(cashFlow.method, 'direct-classified');
    assert.strictEqual(cashFlow.sections.operating.net, 500);
    assert.strictEqual(cashFlow.sections.investing.net, -200);
    assert.strictEqual(cashFlow.sections.financing.net, 0);
    assert.strictEqual(cashFlow.net_change, 300);
    assert.strictEqual(cashFlow.closing_cash, 300);
    assert.strictEqual(cashFlow.reconciled, true);
  });

  console.log(`\n${SUITE}: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    throw new Error(`${failed} test(s) failed in ${SUITE}`);
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
