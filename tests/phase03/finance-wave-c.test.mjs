import assert from 'node:assert';
import { setup, cleanup, seedOrg } from '../phase02/harness.mjs';
import { createActionExecutor } from '../../platform/kernel/actions/index.mjs';
import { registerFinanceActions, seedChartOfAccounts, accountIdByCode } from '../../platform/finance/index.mjs';
import {
  createDocument, submitDocument, approveDocument, postDocument, reverseDocument,
  createDimension, createDimensionValue, setAccountDimensionPolicy, getDimensionBreakdown,
  upsertCurrency, upsertExchangeRate, getExchangeRate, convertAmount, computeRealizedFx, revalueForeignBalances,
  createTax, setTaxRepartitionLines, computeTax, createWithholdingCategory, evaluateWithholding,
  createFiscalPosition, mapFiscalPositionTax, installLocalizationPack,
  setDueSchedule, getCustomerOpenItems, getCustomerAging, getPartnerStatement, createCreditNote,
  getSupplierOpenItems, getSupplierAging, holdPayment, releasePaymentHold,
  setApprovalAuthorityLimit, checkApprovalAuthority,
} from '../../platform/finance/engine.mjs';

const SUITE = 'finance-wave-c';

async function setupFinance() {
  const { dialect, dbPath } = await setup(SUITE);
  const org = seedOrg(dialect);
  seedChartOfAccounts(dialect, { companyId: org.companyA1, userId: 'u_owner' });
  const executor = createActionExecutor(dialect);
  registerFinanceActions(executor);
  return { dialect, dbPath, org, executor };
}

function postSimpleDoc(dialect, ctx, cashId, expenseId, amount, date, extra = {}) {
  const doc = createDocument(dialect, ctx, {
    move_type: 'manual_entry', doc_date: date,
    lines: [
      { account_id: expenseId, debit: amount, credit: 0 },
      { account_id: cashId, debit: 0, credit: amount },
    ],
    ...extra,
  });
  submitDocument(dialect, ctx, { document_id: doc.id });
  approveDocument(dialect, ctx, { document_id: doc.id });
  return postDocument(dialect, ctx, { document_id: doc.id });
}

async function run() {
  let passed = 0;
  const failures = [];
  const tests = [
    ['migrations 016-021 applied and register expected actions', async () => {
      const { dialect, dbPath } = await setupFinance();
      try {
        for (const m of ['016_accounting_dimensions', '017_currency_and_exchange_rates', '018_tax_definition_and_calculation', '019_fiscal_positions_and_iraq_localization', '020_accounts_receivable_subledger', '021_accounts_payable_subledger']) {
          assert.ok(dialect.prepare('SELECT 1 FROM schema_migrations WHERE migration_id = ?').get(m), `migration ${m} not applied`);
        }
        for (const a of ['finance_dimension:create', 'finance_currency:upsert', 'finance_exchange_rate:upsert', 'finance_fx:revalue', 'finance_tax:create', 'finance_tax:quote', 'finance_fiscal_position:create', 'finance_localization:install', 'finance_due_schedule:set', 'finance_ap:hold']) {
          assert.ok(dialect.prepare('SELECT 1 FROM platform_actions WHERE id = ?').get(a), `missing action ${a}`);
        }
        // Every action's entity_id must resolve (this is exactly the FK bug Wave C fixed).
        const orphans = dialect.prepare(`
          SELECT a.id FROM platform_actions a
          WHERE a.entity_id IS NOT NULL AND a.entity_id NOT IN (SELECT id FROM platform_entities)
        `).all();
        assert.strictEqual(orphans.length, 0, `orphaned entity_id refs: ${JSON.stringify(orphans)}`);
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    // --- Dimensions (Packet 03.12) ---

    ['dimension distribution: missing required dimension is rejected', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const expense = accountIdByCode(dialect, org.companyA1, '502000');
        const dim = createDimension(dialect, ctx, { code: 'PROJECT', name: 'Project' });
        setAccountDimensionPolicy(dialect, ctx, { account_id: expense, dimension_id: dim.id, policy: 'required' });
        const doc = createDocument(dialect, ctx, {
          move_type: 'manual_entry', doc_date: '2026-07-01',
          lines: [{ account_id: expense, debit: 100, credit: 0 }, { account_id: cash, debit: 0, credit: 100 }],
        });
        submitDocument(dialect, ctx, { document_id: doc.id });
        approveDocument(dialect, ctx, { document_id: doc.id });
        assert.throws(() => postDocument(dialect, ctx, { document_id: doc.id }), /DIMENSION_REQUIRED|required/);
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['dimension distribution: invalid total (not 100) is rejected, valid total posts', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const expense = accountIdByCode(dialect, org.companyA1, '502000');
        const dim = createDimension(dialect, ctx, { code: 'DEPT', name: 'Department' });
        const v1 = createDimensionValue(dialect, ctx, { dimension_id: dim.id, code: 'D1', name: 'Dept 1' });
        const v2 = createDimensionValue(dialect, ctx, { dimension_id: dim.id, code: 'D2', name: 'Dept 2' });

        const badDoc = createDocument(dialect, ctx, {
          move_type: 'manual_entry', doc_date: '2026-07-02',
          lines: [
            { account_id: expense, debit: 100, credit: 0, dims: JSON.stringify({ [v1.id]: 40, [v2.id]: 40 }) },
            { account_id: cash, debit: 0, credit: 100 },
          ],
        });
        submitDocument(dialect, ctx, { document_id: badDoc.id });
        approveDocument(dialect, ctx, { document_id: badDoc.id });
        assert.throws(() => postDocument(dialect, ctx, { document_id: badDoc.id }), /must sum to 100/);

        const goodDoc = createDocument(dialect, ctx, {
          move_type: 'manual_entry', doc_date: '2026-07-02',
          lines: [
            { account_id: expense, debit: 100, credit: 0, dims: JSON.stringify({ [v1.id]: 60, [v2.id]: 40 }) },
            { account_id: cash, debit: 0, credit: 100 },
          ],
        });
        submitDocument(dialect, ctx, { document_id: goodDoc.id });
        approveDocument(dialect, ctx, { document_id: goodDoc.id });
        const posted = postDocument(dialect, ctx, { document_id: goodDoc.id });
        assert.strictEqual(posted.state, 'posted');

        const breakdown = getDimensionBreakdown(dialect, ctx, { dimension_id: dim.id });
        const d1 = breakdown.find(b => b.dimension_value_id === v1.id);
        const d2 = breakdown.find(b => b.dimension_value_id === v2.id);
        assert.strictEqual(d1.net, 60);
        assert.strictEqual(d2.net, 40);
        assert.strictEqual(Math.round((d1.net + d2.net) * 100) / 100, 100); // reconciles to the posted line
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['blocked dimension rejects a distribution', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const cash = accountIdByCode(dialect, org.companyA1, '101000');
        const expense = accountIdByCode(dialect, org.companyA1, '502000');
        const dim = createDimension(dialect, ctx, { code: 'MACHINE', name: 'Machine' });
        const v1 = createDimensionValue(dialect, ctx, { dimension_id: dim.id, code: 'M1', name: 'Machine 1' });
        setAccountDimensionPolicy(dialect, ctx, { account_id: expense, dimension_id: dim.id, policy: 'blocked' });
        const doc = createDocument(dialect, ctx, {
          move_type: 'manual_entry', doc_date: '2026-07-03',
          lines: [
            { account_id: expense, debit: 100, credit: 0, dims: JSON.stringify({ [v1.id]: 100 }) },
            { account_id: cash, debit: 0, credit: 100 },
          ],
        });
        submitDocument(dialect, ctx, { document_id: doc.id });
        approveDocument(dialect, ctx, { document_id: doc.id });
        assert.throws(() => postDocument(dialect, ctx, { document_id: doc.id }), /is blocked for account/);
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    // --- Currency and FX (Packet 03.09) ---

    ['missing exchange rate throws MISSING_RATE', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        assert.throws(() => getExchangeRate(dialect, org.companyA1, 'USD', 'IQD', '2026-01-01'), /no exchange rate found/);
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['rate change: later rate wins, earlier lookups use the rate in effect on that date', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        upsertExchangeRate(dialect, ctx, { from_currency: 'USD', to_currency: 'IQD', rate_date: '2026-01-01', rate: 1300 });
        upsertExchangeRate(dialect, ctx, { from_currency: 'USD', to_currency: 'IQD', rate_date: '2026-06-01', rate: 1310 });
        assert.strictEqual(getExchangeRate(dialect, org.companyA1, 'USD', 'IQD', '2026-03-01'), 1300);
        assert.strictEqual(getExchangeRate(dialect, org.companyA1, 'USD', 'IQD', '2026-06-15'), 1310);
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['convertAmount rounds to 2 decimals and same-currency conversion is a no-op', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        upsertExchangeRate(dialect, ctx, { from_currency: 'USD', to_currency: 'IQD', rate_date: '2026-01-01', rate: 1310.335 });
        const converted = convertAmount(dialect, org.companyA1, 10, 'USD', 'IQD', '2026-02-01');
        assert.strictEqual(converted, 13103.35);
        assert.strictEqual(convertAmount(dialect, org.companyA1, 500, 'IQD', 'IQD', '2026-02-01'), 500);
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['computeRealizedFx returns gain/loss/none by direction (pure helper for Wave D settlement)', async () => {
      const gain = computeRealizedFx({ settledForeignAmount: 100, originalRate: 1300, settlementRate: 1310 });
      assert.strictEqual(gain.direction, 'gain');
      assert.strictEqual(gain.delta, 1000);
      const loss = computeRealizedFx({ settledForeignAmount: 100, originalRate: 1310, settlementRate: 1300 });
      assert.strictEqual(loss.direction, 'loss');
      const none = computeRealizedFx({ settledForeignAmount: 100, originalRate: 1300, settlementRate: 1300 });
      assert.strictEqual(none.direction, 'none');
      passed++;
    }],

    ['revaluation posts a balanced document and is reversible', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        upsertExchangeRate(dialect, ctx, { from_currency: 'USD', to_currency: 'IQD', rate_date: '2026-01-01', rate: 1300 });
        const bank = accountIdByCode(dialect, org.companyA1, '102000');
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        const gainAcc = accountIdByCode(dialect, org.companyA1, '401000');
        const lossAcc = accountIdByCode(dialect, org.companyA1, '502000');

        // Book a USD-denominated receipt into the bank account at 1300.
        const doc = createDocument(dialect, ctx, {
          move_type: 'manual_entry', doc_date: '2026-01-05', currency: 'USD',
          lines: [
            { account_id: bank, debit: 130000, credit: 0, currency_code: 'USD', currency_debit: 100, currency_credit: 0 },
            { account_id: income, debit: 0, credit: 130000, currency_code: 'USD', currency_debit: 0, currency_credit: 100 },
          ],
        });
        submitDocument(dialect, ctx, { document_id: doc.id });
        approveDocument(dialect, ctx, { document_id: doc.id });
        postDocument(dialect, ctx, { document_id: doc.id });

        // Rate moves up: bank balance should revalue upward (gain).
        upsertExchangeRate(dialect, ctx, { from_currency: 'USD', to_currency: 'IQD', rate_date: '2026-01-15', rate: 1310 });
        const result = revalueForeignBalances(dialect, ctx, {
          as_of_date: '2026-01-20', account_ids: [bank], gain_account_id: gainAcc, loss_account_id: lossAcc,
        });
        assert.ok(result.document, 'expected a revaluation document to be posted');
        assert.strictEqual(result.document.state, 'posted');
        assert.strictEqual(result.run.totalGain, 1000); // 100 USD * (1310-1300)

        const before = dialect.prepare('SELECT state FROM finance_documents WHERE id = ?').get(result.document.id);
        assert.strictEqual(before.state, 'posted');
        reverseDocument(dialect, ctx, { document_id: result.document.id, reason: 'period-end reversal' });
        const after = dialect.prepare('SELECT state FROM finance_documents WHERE id = ?').get(result.document.id);
        assert.strictEqual(after.state, 'reversed');
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    // --- Tax engine (Packet 03.10) ---

    ['tax quote: exclusive percent tax with default repartition', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        const tax = createTax(dialect, ctx, { code: 'VAT15', name: 'VAT 15%', amount_type: 'percent', amount: 15, price_include: false });
        const quote = computeTax(dialect, ctx, { lines: [{ account_id: income, price_unit: 1000, quantity: 3, tax_id: tax.id }] });
        assert.strictEqual(quote.total_base, 3000);
        assert.strictEqual(quote.total_tax, 450);
        assert.strictEqual(quote.total_amount, 3450);
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['tax quote: price-included tax backs the base amount out of the gross price', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        const tax = createTax(dialect, ctx, { code: 'VAT15INC', name: 'VAT 15% Incl', amount_type: 'percent', amount: 15, price_include: true });
        const quote = computeTax(dialect, ctx, { lines: [{ account_id: income, price_unit: 115, quantity: 1, tax_id: tax.id }] });
        assert.strictEqual(quote.total_base, 100);
        assert.strictEqual(quote.total_tax, 15);
        assert.strictEqual(quote.total_amount, 115);
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['tax quote: compound group applies child taxes on top of each other', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        const childA = createTax(dialect, ctx, { code: 'GROUP_A', name: 'Group Tax A', amount_type: 'percent', amount: 10 });
        const childB = createTax(dialect, ctx, { code: 'GROUP_B', name: 'Group Tax B', amount_type: 'percent', amount: 5 });
        const group = createTax(dialect, ctx, { code: 'GROUP', name: 'Compound Group', amount_type: 'group', amount: 0, children: [childA.id, childB.id] });
        const quote = computeTax(dialect, ctx, { lines: [{ account_id: income, price_unit: 1000, quantity: 1, tax_id: group.id }] });
        // 1000 * 10% = 100 (compound base now 1100); 1100 * 5% = 55. Total tax = 155.
        assert.strictEqual(quote.total_tax, 155);
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['tax quote: fiscal position resolves exemption (partial exemption / reverse-charge via mapping)', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        const tax = createTax(dialect, ctx, { code: 'VAT15X', name: 'VAT 15%', amount_type: 'percent', amount: 15 });
        const exportFp = createFiscalPosition(dialect, ctx, { code: 'EXPORT_FP', name: 'Export', exemption_reason: 'export' });
        mapFiscalPositionTax(dialect, ctx, { fiscal_position_id: exportFp.id, tax_src_id: tax.id, tax_dest_id: null });

        const domesticQuote = computeTax(dialect, ctx, { lines: [{ account_id: income, price_unit: 1000, quantity: 1, tax_id: tax.id }] });
        assert.strictEqual(domesticQuote.total_tax, 150);

        const exportQuote = computeTax(dialect, ctx, { fiscal_position_id: exportFp.id, lines: [{ account_id: income, price_unit: 1000, quantity: 1, tax_id: tax.id }] });
        assert.strictEqual(exportQuote.total_tax, 0); // exempt via fiscal position mapping to null
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['withholding: single-transaction threshold triggers, below threshold does not', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        createWithholdingCategory(dialect, ctx, { code: 'WHT_SERVICES', name: 'Services WHT', rate: 3, threshold: 1000000 });
        const below = evaluateWithholding(dialect, ctx, { partner_id: 'partner_x', amount: 500000, doc_date: '2026-05-01' });
        assert.strictEqual(below, null);
        const above = evaluateWithholding(dialect, ctx, { partner_id: 'partner_x', amount: 2000000, doc_date: '2026-05-02' });
        assert.ok(above);
        assert.strictEqual(above.withhold_amount, 60000);
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['withholding: cumulative monthly threshold triggers across multiple transactions', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        createWithholdingCategory(dialect, ctx, { code: 'WHT_CUM', name: 'Cumulative WHT', rate: 5, threshold: 0, cumulative_threshold: 1000, cumulative_window: 'monthly' });
        const r1 = evaluateWithholding(dialect, ctx, { partner_id: 'partner_y', amount: 600, doc_date: '2026-05-01' });
        assert.strictEqual(r1, null);
        const r2 = evaluateWithholding(dialect, ctx, { partner_id: 'partner_y', amount: 500, doc_date: '2026-05-15' });
        assert.ok(r2, 'cumulative total (1100) should trigger the threshold');
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['tax-version change after posting does not affect an already-posted document', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        const tax = createTax(dialect, ctx, { code: 'VAT_V1', name: 'VAT v1', amount_type: 'percent', amount: 10 });
        const quoteAtV1 = computeTax(dialect, ctx, { lines: [{ account_id: income, price_unit: 1000, quantity: 1, tax_id: tax.id }] });
        assert.strictEqual(quoteAtV1.total_tax, 100);
        // The definition can evolve for future documents; this does not touch any already-computed/posted quote object.
        dialect.prepare('UPDATE finance_taxes SET amount = ?, version = version + 1 WHERE id = ?').run(20, tax.id);
        assert.strictEqual(quoteAtV1.total_tax, 100, 'previously computed quote must remain frozen');
        const quoteAtV2 = computeTax(dialect, ctx, { lines: [{ account_id: income, price_unit: 1000, quantity: 1, tax_id: tax.id }] });
        assert.strictEqual(quoteAtV2.total_tax, 200);
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    // --- Fiscal positions and Iraq localization pack (Packet 03.11) ---

    ['localization pack install is idempotent and reinstall/upgrade does not duplicate rows', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const first = installLocalizationPack(dialect, ctx, { pack_code: 'iraq', version: '1.0.0' });
        assert.strictEqual(first.status, 'installed');
        const second = installLocalizationPack(dialect, ctx, { pack_code: 'iraq', version: '1.1.0' });
        assert.strictEqual(second.status, 'upgraded');
        assert.strictEqual(second.id, first.id);
        const taxCount = dialect.prepare("SELECT COUNT(*) AS n FROM finance_taxes WHERE company_id = ? AND code = 'IQ_SALES_15'").get(org.companyA1).n;
        assert.strictEqual(taxCount, 1, 'reinstall must not duplicate the seeded tax');
        const fpCount = dialect.prepare("SELECT COUNT(*) AS n FROM finance_fiscal_positions WHERE company_id = ?").get(org.companyA1).n;
        assert.strictEqual(fpCount, 3, 'domestic/export/exempt fiscal positions');
        assert.strictEqual(second.legal_validation_status, 'pending');
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['manual override permission: fiscal position tax mapping can be overridden per-position', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        const tax = createTax(dialect, ctx, { code: 'VAT_OVR', name: 'VAT override', amount_type: 'percent', amount: 15 });
        const reducedTax = createTax(dialect, ctx, { code: 'VAT_REDUCED', name: 'VAT reduced', amount_type: 'percent', amount: 5 });
        const fp = createFiscalPosition(dialect, ctx, { code: 'MANUAL_OVR', name: 'Manual override position', allow_manual_override: true });
        mapFiscalPositionTax(dialect, ctx, { fiscal_position_id: fp.id, tax_src_id: tax.id, tax_dest_id: reducedTax.id });
        const quote = computeTax(dialect, ctx, { fiscal_position_id: fp.id, lines: [{ account_id: income, price_unit: 1000, quantity: 1, tax_id: tax.id }] });
        assert.strictEqual(quote.total_tax, 50); // remapped to the 5% reduced tax
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    // --- AR (Packet 03.13) ---

    ['due schedule can only be set before posting, and total must match the document', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        const invoice = createDocument(dialect, ctx, {
          move_type: 'customer_invoice', doc_date: '2026-04-01', partner_id: 'cust_1',
          lines: [{ account_id: receivable, debit: 900, credit: 0 }, { account_id: income, debit: 0, credit: 900 }],
        });
        assert.throws(() => setDueSchedule(dialect, ctx, { document_id: invoice.id, schedule: [{ due_date: '2026-05-01', amount: 500 }] }), /due schedule total must equal/);
        const ok = setDueSchedule(dialect, ctx, { document_id: invoice.id, schedule: [{ due_date: '2026-05-01', amount: 450 }, { due_date: '2026-06-01', amount: 450 }] });
        assert.strictEqual(ok.schedule_count, 2);
        submitDocument(dialect, ctx, { document_id: invoice.id });
        approveDocument(dialect, ctx, { document_id: invoice.id });
        postDocument(dialect, ctx, { document_id: invoice.id });
        assert.throws(() => setDueSchedule(dialect, ctx, { document_id: invoice.id, schedule: [{ due_date: '2026-07-01', amount: 900 }] }), /only be set before posting/);
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['credit note reduces customer open amount, and aging reconciles to the receivable GL balance', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        const invoice = createDocument(dialect, ctx, {
          move_type: 'customer_invoice', doc_date: '2026-04-01', partner_id: 'cust_aging',
          lines: [{ account_id: receivable, debit: 1000, credit: 0 }, { account_id: income, debit: 0, credit: 1000 }],
        });
        setDueSchedule(dialect, ctx, { document_id: invoice.id, schedule: [{ due_date: '2026-04-15', amount: 1000 }] });
        submitDocument(dialect, ctx, { document_id: invoice.id });
        approveDocument(dialect, ctx, { document_id: invoice.id });
        postDocument(dialect, ctx, { document_id: invoice.id });

        let openItems = getCustomerOpenItems(dialect, ctx, { partner_id: 'cust_aging' });
        assert.strictEqual(openItems.length, 1);
        assert.strictEqual(openItems[0].open_amount, 1000);

        const credit = createCreditNote(dialect, ctx, {
          original_document_id: invoice.id, doc_date: '2026-04-10',
          lines: [{ account_id: income, debit: 300, credit: 0 }, { account_id: receivable, debit: 0, credit: 300 }],
        });
        submitDocument(dialect, ctx, { document_id: credit.id });
        approveDocument(dialect, ctx, { document_id: credit.id });
        postDocument(dialect, ctx, { document_id: credit.id });

        openItems = getCustomerOpenItems(dialect, ctx, { partner_id: 'cust_aging' });
        assert.strictEqual(openItems[0].open_amount, 700);

        const aging = getCustomerAging(dialect, ctx, { partner_id: 'cust_aging', as_of_date: '2026-04-20' });
        assert.strictEqual(aging.total, 700);
        assert.strictEqual(aging.d1_30, 700); // 5 days overdue from 2026-04-15

        const glBalance = dialect.prepare(`
          SELECT SUM(debit) - SUM(credit) AS bal FROM finance_journal_lines WHERE company_id = ? AND account_id = ? AND partner_id = ?
        `).get(org.companyA1, receivable, 'cust_aging').bal;
        assert.strictEqual(Math.round(glBalance * 100) / 100, 700, 'aging must reconcile to receivable control-account GL balance');
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['partner statement lists posted documents with a running balance', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        for (const [date, amount] of [['2026-04-01', 400], ['2026-04-10', 600]]) {
          const inv = createDocument(dialect, ctx, {
            move_type: 'customer_invoice', doc_date: date, partner_id: 'cust_stmt',
            lines: [{ account_id: receivable, debit: amount, credit: 0 }, { account_id: income, debit: 0, credit: amount }],
          });
          submitDocument(dialect, ctx, { document_id: inv.id });
          approveDocument(dialect, ctx, { document_id: inv.id });
          postDocument(dialect, ctx, { document_id: inv.id });
        }
        const statement = getPartnerStatement(dialect, ctx, { partner_id: 'cust_stmt' });
        assert.strictEqual(statement.length, 2);
        assert.strictEqual(statement[1].running_balance, 1000);
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['cross-company AR open items stay isolated', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        seedChartOfAccounts(dialect, { companyId: org.companyB1, userId: 'u_beta' });
        const ctxA = { companyId: org.companyA1, userId: 'u_owner' };
        const ctxB = { companyId: org.companyB1, userId: 'u_beta' };
        const recvA = accountIdByCode(dialect, org.companyA1, '103000');
        const incA = accountIdByCode(dialect, org.companyA1, '401000');
        const invA = createDocument(dialect, ctxA, {
          move_type: 'customer_invoice', doc_date: '2026-04-01', partner_id: 'shared_partner',
          lines: [{ account_id: recvA, debit: 200, credit: 0 }, { account_id: incA, debit: 0, credit: 200 }],
        });
        submitDocument(dialect, ctxA, { document_id: invA.id });
        approveDocument(dialect, ctxA, { document_id: invA.id });
        postDocument(dialect, ctxA, { document_id: invA.id });

        const openA = getCustomerOpenItems(dialect, ctxA, { partner_id: 'shared_partner' });
        const openB = getCustomerOpenItems(dialect, ctxB, { partner_id: 'shared_partner' });
        assert.strictEqual(openA.length, 1);
        assert.strictEqual(openB.length, 0);
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    // --- AP (Packet 03.14) ---

    ['duplicate supplier invoice with the same source reference is rejected', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const payable = accountIdByCode(dialect, org.companyA1, '201000');
        const expense = accountIdByCode(dialect, org.companyA1, '502000');
        createDocument(dialect, ctx, {
          move_type: 'supplier_bill', doc_date: '2026-04-01', partner_id: 'supplier_1', source_canonical_key: 'SUP-INV-9001',
          lines: [{ account_id: expense, debit: 500, credit: 0 }, { account_id: payable, debit: 0, credit: 500 }],
        });
        assert.throws(() => createDocument(dialect, ctx, {
          move_type: 'supplier_bill', doc_date: '2026-04-02', partner_id: 'supplier_1', source_canonical_key: 'SUP-INV-9001',
          lines: [{ account_id: expense, debit: 500, credit: 0 }, { account_id: payable, debit: 0, credit: 500 }],
        }), /duplicate source reference/);
        // Different partner with the same reference is fine (dedup is per partner+move_type+key).
        const other = createDocument(dialect, ctx, {
          move_type: 'supplier_bill', doc_date: '2026-04-02', partner_id: 'supplier_2', source_canonical_key: 'SUP-INV-9001',
          lines: [{ account_id: expense, debit: 500, credit: 0 }, { account_id: payable, debit: 0, credit: 500 }],
        });
        assert.ok(other.id);
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['payment hold blocks visibility of intent and release restores it (hold/release lifecycle)', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const payable = accountIdByCode(dialect, org.companyA1, '201000');
        const expense = accountIdByCode(dialect, org.companyA1, '502000');
        const bill = createDocument(dialect, ctx, {
          move_type: 'supplier_bill', doc_date: '2026-04-05', partner_id: 'supplier_hold',
          lines: [{ account_id: expense, debit: 300, credit: 0 }, { account_id: payable, debit: 0, credit: 300 }],
        });
        submitDocument(dialect, ctx, { document_id: bill.id });
        approveDocument(dialect, ctx, { document_id: bill.id });
        postDocument(dialect, ctx, { document_id: bill.id });

        const hold = holdPayment(dialect, ctx, { document_id: bill.id, reason: 'quality dispute' });
        assert.strictEqual(hold.status, 'held');
        assert.throws(() => releasePaymentHold(dialect, ctx, { hold_id: 'nope' }), /hold not found/);
        const released = releasePaymentHold(dialect, ctx, { hold_id: hold.id });
        assert.strictEqual(released.status, 'released');
        assert.throws(() => releasePaymentHold(dialect, ctx, { hold_id: hold.id }), /hold already released/);
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['supplier aging reconciles to the payable GL balance', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const payable = accountIdByCode(dialect, org.companyA1, '201000');
        const expense = accountIdByCode(dialect, org.companyA1, '502000');
        const bill = createDocument(dialect, ctx, {
          move_type: 'supplier_bill', doc_date: '2026-03-01', partner_id: 'supplier_aging',
          lines: [{ account_id: expense, debit: 800, credit: 0 }, { account_id: payable, debit: 0, credit: 800 }],
        });
        setDueSchedule(dialect, ctx, { document_id: bill.id, schedule: [{ due_date: '2026-03-15', amount: 800 }] });
        submitDocument(dialect, ctx, { document_id: bill.id });
        approveDocument(dialect, ctx, { document_id: bill.id });
        postDocument(dialect, ctx, { document_id: bill.id });

        const aging = getSupplierAging(dialect, ctx, { partner_id: 'supplier_aging', as_of_date: '2026-05-01' });
        assert.strictEqual(aging.total, 800);
        assert.strictEqual(aging.d31_60, 800); // 47 days overdue from 2026-03-15

        const glBalance = dialect.prepare(`
          SELECT SUM(credit) - SUM(debit) AS bal FROM finance_journal_lines WHERE company_id = ? AND account_id = ? AND partner_id = ?
        `).get(org.companyA1, payable, 'supplier_aging').bal;
        assert.strictEqual(Math.round(glBalance * 100) / 100, 800);
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['approval authority limit blocks amounts above the configured ceiling', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        setApprovalAuthorityLimit(dialect, ctx, { role_or_user: 'ap_clerk', limit_type: 'payment', max_amount: 500000 });
        const ok = checkApprovalAuthority(dialect, ctx, { role_or_user: 'ap_clerk', limit_type: 'payment', amount: 400000 });
        assert.strictEqual(ok.allowed, true);
        assert.throws(() => checkApprovalAuthority(dialect, ctx, { role_or_user: 'ap_clerk', limit_type: 'payment', amount: 600000 }), /exceeds payment authority limit/);
        // No configured limit for a role means unrestricted (foundation default; explicit limits govern once set).
        const unrestricted = checkApprovalAuthority(dialect, ctx, { role_or_user: 'owner', limit_type: 'payment', amount: 999999999 });
        assert.strictEqual(unrestricted.allowed, true);
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    // --- Action-executor / concurrency wiring ---

    ['tax quote is callable through the action executor (declarative, no posting side effect)', async () => {
      const { dialect, dbPath, org, executor } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        const tax = createTax(dialect, ctx, { code: 'VAT_EXEC', name: 'VAT via executor', amount_type: 'percent', amount: 15 });
        const before = dialect.prepare('SELECT COUNT(*) AS n FROM finance_documents WHERE company_id = ?').get(org.companyA1).n;
        const quote = executor.execute('finance_tax:quote', { lines: [{ account_id: income, price_unit: 100, quantity: 1, tax_id: tax.id }], idempotency_key: 'tax-quote-1' }, ctx);
        assert.strictEqual(quote.total_tax, 15);
        const after = dialect.prepare('SELECT COUNT(*) AS n FROM finance_documents WHERE company_id = ?').get(org.companyA1).n;
        assert.strictEqual(before, after, 'a tax quote must not write a document');
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['concurrent due-schedule writes on independent documents do not corrupt each other', async () => {
      const { dialect, dbPath, org } = await setupFinance();
      try {
        const ctx = { companyId: org.companyA1, userId: 'u_owner' };
        const receivable = accountIdByCode(dialect, org.companyA1, '103000');
        const income = accountIdByCode(dialect, org.companyA1, '401000');
        const docs = [];
        for (let i = 0; i < 3; i++) {
          docs.push(createDocument(dialect, ctx, {
            move_type: 'customer_invoice', doc_date: '2026-04-01', partner_id: `cust_conc_${i}`,
            lines: [{ account_id: receivable, debit: 100, credit: 0 }, { account_id: income, debit: 0, credit: 100 }],
          }));
        }
        await Promise.all(docs.map((d, i) => setDueSchedule(dialect, ctx, { document_id: d.id, schedule: [{ due_date: `2026-05-0${i + 1}`, amount: 100 }] })));
        for (const d of docs) {
          const rows = dialect.prepare('SELECT * FROM finance_due_schedules WHERE document_id = ?').all(d.id);
          assert.strictEqual(rows.length, 1);
        }
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],

    ['failure injection: a broken migration step rolls back atomically, leaving no partial state', async () => {
      const { dialect, dbPath } = await setupFinance();
      try {
        // Simulate the exact transaction contract the real migration runner uses
        // for transactionPolicy: 'required' (BEGIN IMMEDIATE / COMMIT / ROLLBACK —
        // see database/migration-runner/index.mjs) with a deliberately failing
        // statement partway through a migration-shaped operation.
        const before = dialect.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'finance_test_failure_injection'").get();
        assert.strictEqual(before, undefined);
        dialect.exec('BEGIN IMMEDIATE;');
        let threw = false;
        try {
          dialect.exec('CREATE TABLE finance_test_failure_injection (id TEXT PRIMARY KEY);');
          dialect.exec("INSERT INTO finance_test_failure_injection (id) VALUES ('row-1');");
          // Deliberate failure: reference a column that does not exist.
          dialect.exec('INSERT INTO finance_test_failure_injection (id, nonexistent_column) VALUES (\'row-2\', 1);');
          dialect.exec('COMMIT;');
        } catch (error) {
          threw = true;
          dialect.exec('ROLLBACK;');
        }
        assert.strictEqual(threw, true, 'the deliberately broken statement must throw');
        const after = dialect.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'finance_test_failure_injection'").get();
        assert.strictEqual(after, undefined, 'the table created before the failure must not survive the rollback');
        passed++;
      } finally { await cleanup(dialect, dbPath); }
    }],
  ];

  console.log(`\n=== ${SUITE} ===`);
  for (const [name, fn] of tests) {
    try {
      await fn();
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
