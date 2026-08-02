import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';

test('two synthetic trial balances map, translate, eliminate and publish isolated consolidated reports', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-b08-consolidation-'));
  const file = path.join(dir, 'consolidation.db');
  await freshInstall({ dbPath: file, backupDir: path.join(dir, 'backups'), actor: 'build-08-consolidation' });
  const db = openMigrationDatabase(file);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const authority = createPlatformAuthority(db);
  const ctx = { userId: 'group-controller', actorId: 'group-controller', companyId: 'holding-company' };

  const group = authority.consolidationService.createGroup({ name: 'Octagon Group', reportingCurrency: 'IQD' }, ctx);
  authority.consolidationService.addMember(group.id, { companyId: 'company-a', ownershipPercentage: 100, consolidationMethod: 'full', effectiveFrom: '2027-01-01' }, ctx);
  authority.consolidationService.addMember(group.id, { companyId: 'company-b', ownershipPercentage: 100, consolidationMethod: 'full', effectiveFrom: '2027-01-01' }, ctx);
  const mappings = [
    ['company-a', '1100', 'CASH', 'Cash', 'asset', false],
    ['company-a', '1300', 'IC-BAL', 'Intercompany balance', 'asset', true],
    ['company-a', '3000', 'EQUITY', 'Equity', 'equity', false],
    ['company-b', '1100', 'CASH', 'Cash', 'asset', false],
    ['company-b', '2100', 'IC-BAL', 'Intercompany balance', 'liability', true],
    ['company-b', '3000', 'EQUITY', 'Equity', 'equity', false],
  ];
  for (const [companyId, sourceAccountCode, targetAccountCode, targetAccountName, statementType, intercompanyFlag] of mappings) {
    authority.consolidationService.upsertMapping(group.id, { companyId, sourceAccountCode, targetAccountCode, targetAccountName, statementType, intercompanyFlag }, ctx);
  }
  const period = authority.consolidationService.createPeriod(group.id, {
    periodName: '2027-01', startDate: '2027-01-01', endDate: '2027-01-31',
    closingRates: { IQD: 1 }, averageRates: { IQD: 1 }, historicalRates: { IQD: 1 },
  }, ctx);

  authority.consolidationService.captureTrialBalance(period.id, {
    companyId: 'company-a', sourceCurrency: 'IQD', lines: [
      { accountCode: '1100', debit: 1000, credit: 0 },
      { accountCode: '1300', debit: 200, credit: 0, counterpartyCompanyId: 'company-b', reference: 'IC-1' },
      { accountCode: '3000', debit: 0, credit: 1200 },
    ],
  }, ctx);
  authority.consolidationService.captureTrialBalance(period.id, {
    companyId: 'company-b', sourceCurrency: 'IQD', lines: [
      { accountCode: '1100', debit: 800, credit: 0 },
      { accountCode: '2100', debit: 0, credit: 200, counterpartyCompanyId: 'company-a', reference: 'IC-1' },
      { accountCode: '3000', debit: 0, credit: 600 },
    ],
  }, ctx);

  const run = authority.consolidationService.calculateRun(group.id, period.id, ctx);
  assert.equal(run.validation.snapshots, 2);
  assert.equal(run.status, 'review');
  assert.equal(run.eliminations.length, 1);
  assert.equal(run.eliminations[0].reference, 'IC-1');
  authority.consolidationService.approveElimination(run.eliminations[0].id, { ...ctx, userId: 'consolidation-manager' });
  const adjustment = authority.consolidationService.addAdjustment(run.id, { targetAccountCode: 'CASH', debit: 10, credit: 0, reason: 'Approved consolidation-only rounding adjustment' }, ctx);
  authority.consolidationService.approveAdjustment(adjustment.id, { ...ctx, userId: 'consolidation-manager' });
  const locked = authority.consolidationService.finalize(run.id, { ...ctx, userId: 'group-cfo' });
  assert.equal(locked.status, 'locked');
  assert.equal(authority.consolidationService.getPeriod(period.id, ctx).status, 'locked');

  const reports = authority.consolidationService.reports(run.id, ctx);
  assert.equal(reports.status, 'locked');
  assert.ok(reports.trialBalance.some((line) => line.targetAccountCode === 'CASH'));
  assert.ok(reports.balanceSheet.lines.length >= 2);
  assert.equal(reports.eliminationReport.length, 1);
  assert.ok(reports.translationReport.length >= 2);
  assert.ok(reports.lineage.length >= 6);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM finance_journal_entries').get().count, 0, 'operational company ledger is untouched');
  assert.throws(() => authority.consolidationService.getRun(run.id, { ...ctx, companyId: 'company-a' }), { code: 'COMPANY_SCOPE_DENIED' });
});
