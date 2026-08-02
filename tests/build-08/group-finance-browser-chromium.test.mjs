import assert from 'node:assert/strict';
import test from 'node:test';
import { browserAction, browserQuery, openBuild08Browser } from './browser-harness.mjs';

test('real Chromium completes liquidity alert, intercompany mismatch and isolated consolidation report', async (t) => {
  const fixture = await openBuild08Browser(t, { name: 'group-finance', companyId: 'company-a', initialPage: 'treasury_cash_position' });
  const { authority, consoleErrors, ctx, dialect, page } = fixture;
  authority.consolidationService.createGroup({ name: 'Other company group', reportingCurrency: 'IQD' }, { ...ctx, companyId: 'company-z' });

  const position = await browserAction(page, 'treasury:position_capture', {
    asOfDate: '2027-01-01', reportingCurrency: 'IQD', idempotencyKey: 'browser-position',
    accounts: [{ accountId: 'bank-a', accountType: 'bank', currency: 'IQD', balance: 1000 }]
  });
  const liquidity = await browserAction(page, 'treasury:liquidity_generate', {
    positionId: position.id, name: 'Browser liquidity', startDate: '2027-01-01', endDate: '2027-01-02',
    minimumCashThreshold: 900, idempotencyKey: 'browser-liquidity',
    flows: [{ date: '2027-01-02', direction: 'outflow', amount: 700, sourceType: 'ap_invoice', currency: 'IQD', counterpartyId: 'supplier-a' }]
  });
  assert.equal(liquidity.buckets.at(-1).closingCash, 300);
  const alerts = await browserQuery(page, 'treasury/alerts');
  assert.ok(alerts.length > 0);
  await browserAction(page, 'treasury:alert_acknowledge', { alert_id: alerts[0].id });
  const proposal = await browserAction(page, 'treasury:proposal_create', { proposalType: 'funding', sourceAlertId: alerts[0].id, amount: 1000, currency: 'IQD', requestedDate: '2027-01-02', rationale: 'Browser liquidity buffer' });
  assert.equal((await browserAction(page, 'treasury:proposal_approve', { proposal_id: proposal.id })).paymentExecuted, false);

  const relationship = await browserAction(page, 'intercompany:relationship_create', {
    companyBId: 'company-b', relationshipType: 'subsidiary', allowedTypes: ['sale_purchase'],
    dueToAccountA: 'A-DUE-TO', dueFromAccountA: 'A-DUE-FROM', dueToAccountB: 'B-DUE-TO', dueFromAccountB: 'B-DUE-FROM'
  });
  const operation = await browserAction(page, 'intercompany:operation_create', {
    relationshipId: relationship.id, sourceCompanyId: 'company-a', targetCompanyId: 'company-b',
    transactionType: 'sale_purchase', sourceDocumentType: 'sales_order', sourceDocumentId: 'SO-BROWSER',
    reciprocalDocumentType: 'purchase_order', reciprocalDocumentId: 'PO-BROWSER', reference: 'IC-BROWSER',
    amount: 200, reciprocalAmount: 190, currency: 'IQD', idempotencyKey: 'browser-intercompany'
  });
  assert.equal(operation.mismatches[0].differenceAmount, 10);

  const group = await browserAction(page, 'consolidation:group_create', { name: 'Browser group', reportingCurrency: 'IQD' });
  for (const companyId of ['company-a', 'company-b']) await browserAction(page, 'consolidation:member_add', { group_id: group.id, companyId, ownershipPercentage: 100, consolidationMethod: 'full', effectiveFrom: '2027-01-01' });
  const mappings = [
    ['company-a', '1100', 'CASH', 'Cash', 'asset', false], ['company-a', '1300', 'IC', 'Intercompany', 'asset', true], ['company-a', '3000', 'EQUITY', 'Equity', 'equity', false],
    ['company-b', '1100', 'CASH', 'Cash', 'asset', false], ['company-b', '2100', 'IC', 'Intercompany', 'liability', true], ['company-b', '3000', 'EQUITY', 'Equity', 'equity', false]
  ];
  for (const [companyId, sourceAccountCode, targetAccountCode, targetAccountName, statementType, intercompanyFlag] of mappings) {
    await browserAction(page, 'consolidation:mapping_upsert', { group_id: group.id, companyId, sourceAccountCode, targetAccountCode, targetAccountName, statementType, intercompanyFlag });
  }
  const period = await browserAction(page, 'consolidation:period_create', { group_id: group.id, periodName: '2027-01', startDate: '2027-01-01', endDate: '2027-01-31', closingRates: { IQD: 1 }, averageRates: { IQD: 1 }, historicalRates: { IQD: 1 } });
  await browserAction(page, 'consolidation:snapshot_capture', { period_id: period.id, companyId: 'company-a', sourceCurrency: 'IQD', lines: [{ accountCode: '1100', debit: 1000, credit: 0 }, { accountCode: '1300', debit: 200, credit: 0, counterpartyCompanyId: 'company-b', reference: 'IC-BROWSER' }, { accountCode: '3000', debit: 0, credit: 1200 }] });
  await browserAction(page, 'consolidation:snapshot_capture', { period_id: period.id, companyId: 'company-b', sourceCurrency: 'IQD', lines: [{ accountCode: '1100', debit: 800, credit: 0 }, { accountCode: '2100', debit: 0, credit: 200, counterpartyCompanyId: 'company-a', reference: 'IC-BROWSER' }, { accountCode: '3000', debit: 0, credit: 600 }] });
  const run = await browserAction(page, 'consolidation:run_calculate', { group_id: group.id, period_id: period.id });
  await browserAction(page, 'consolidation:elimination_approve', { elimination_id: run.eliminations[0].id });
  assert.equal((await browserAction(page, 'consolidation:finalize', { run_id: run.id })).status, 'locked');
  assert.ok((await browserQuery(page, `consolidation/balances?run_id=${run.id}`)).length >= 2);
  assert.ok((await browserQuery(page, `consolidation/lineage?run_id=${run.id}`)).length >= 6);
  assert.equal(dialect.prepare('SELECT COUNT(*) AS count FROM finance_journal_entries').get().count, 0);

  await page.evaluate(async () => { await window.ensurePageTemplateLoaded('consolidated_reports'); window.switchPage('consolidated_reports'); });
  await page.waitForFunction(() => document.querySelector('[data-build08-page="consolidated_reports"] tbody tr[data-record-id]'));
  assert.equal((await browserQuery(page, 'consolidation/groups')).length, 1, 'other-company group is hidden');
  await page.evaluate(async () => { await window.ensurePageTemplateLoaded('consolidation_runs'); window.__BUILD08_FORCE_READ_ONLY__ = true; window.switchPage('consolidation_runs'); });
  assert.ok(await page.$eval('[data-build08-page="consolidation_runs"] [data-action-id]', (button) => button.disabled));
  assert.equal(consoleErrors.length, 0, consoleErrors.join('\n'));
});
