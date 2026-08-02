import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openMigrationDatabase, freshInstall } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';

function tmpDb() {
  return path.join(os.tmpdir(), `octagon-b08-lifecycle-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

test('BUILD-08 Planning, Treasury, Intercompany & Consolidation Full Lifecycle', async () => {
  const dbPath = tmpDb();
  await freshInstall({ dbPath });
  const dialect = openMigrationDatabase(dbPath);
  const authority = createPlatformAuthority(dialect);

  const ctx = {
    userId: 'cfo-user-1',
    companyId: 'default',
    tenantId: 'default',
  };

  // 1. Planning & Budgeting Scenario Lifecycle
  const scenario = authority.planningBudgetService.createScenario({
    companyId: ctx.companyId,
    name: 'موازنة النمو الاستراتيجي 2026',
    fiscalYear: 2026,
    scenarioType: 'optimistic',
    notes: 'خطط التوسع لمبيعات الجملة',
    lines: [
      { accountId: 'acc_rev_sales', periodName: 'Q1', amount: 50000000, currency: 'IQD' },
      { accountId: 'acc_exp_marketing', periodName: 'Q1', amount: 10000000, currency: 'IQD' },
    ],
  }, ctx);

  assert.ok(scenario.id);
  assert.equal(scenario.status, 'draft');
  assert.equal(scenario.lines.length, 2);

  const activeScenario = authority.planningBudgetService.activateScenario(scenario.id, ctx);
  assert.equal(activeScenario.status, 'active');

  const varianceResult = authority.planningBudgetService.calculateVariance(scenario.id);
  assert.equal(varianceResult.scenarioId, scenario.id);
  assert.equal(varianceResult.lines.length, 2);

  // 2. Treasury Cash Flow Forecasting
  const tf1 = authority.treasuryCashForecastService.createManualForecast({
    companyId: ctx.companyId,
    forecastDate: '2026-09-15',
    direction: 'inflow',
    estimatedAmount: 25000000,
    currency: 'IQD',
    sourceType: 'ar_invoice',
    confidenceLevel: 'high',
    notes: 'تحصيل فاتورة العميل الرئيسي',
  }, ctx);

  const tf2 = authority.treasuryCashForecastService.createManualForecast({
    companyId: ctx.companyId,
    forecastDate: '2026-09-20',
    direction: 'outflow',
    estimatedAmount: 8000000,
    currency: 'IQD',
    sourceType: 'ap_invoice',
    confidenceLevel: 'high',
    notes: 'سداد المورد',
  }, ctx);

  assert.ok(tf1.id);
  assert.ok(tf2.id);

  const forecastSummary = authority.treasuryCashForecastService.generateForecast({
    companyId: ctx.companyId,
    forecastDate: '2026-09-01',
    daysAhead: 30,
  }, ctx);

  assert.equal(forecastSummary.totalInflow, 25000000);
  assert.equal(forecastSummary.totalOutflow, 8000000);
  assert.equal(forecastSummary.netCashPosition, 17000000);

  // 3. Intercompany Transactions & Elimination
  const ict = authority.intercompanyConsolidationService.createIntercompanyTransaction({
    sourceCompanyId: 'comp_baghdad',
    targetCompanyId: 'comp_basra',
    transactionType: 'transfer',
    amount: 15000000,
    currency: 'IQD',
    reference: 'تحويل سيولة تشغيلية للفرع الجنوبي',
  }, ctx);

  assert.ok(ict.id);
  assert.equal(ict.status, 'draft');

  const eliminatedTx = authority.intercompanyConsolidationService.eliminateTransaction(ict.id, ctx);
  assert.equal(eliminatedTx.status, 'eliminated');
  assert.ok(eliminatedTx.eliminationEntryId);

  // 4. Financial Consolidation Run
  const consRun = authority.intercompanyConsolidationService.runConsolidation({
    groupId: 'octagon_group_holding',
    fiscalPeriod: '2026-Q3',
  }, ctx);

  assert.ok(consRun.id);
  assert.equal(consRun.status, 'completed');

  dialect.close();
  fs.unlinkSync(dbPath);
});
