import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';

test('AR/AP facts produce liquidity breach, governed funding proposal and facility boundary', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-b08-treasury-'));
  const file = path.join(dir, 'treasury.db');
  await freshInstall({ dbPath: file, backupDir: path.join(dir, 'backups'), actor: 'build-08-treasury' });
  const db = openMigrationDatabase(file);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const authority = createPlatformAuthority(db);
  const ctx = { userId: 'treasurer', actorId: 'treasurer', companyId: 'company-a' };

  const position = authority.treasuryLiquidityService.capturePosition({
    asOfDate: '2027-01-01', reportingCurrency: 'IQD', pendingReceipts: 200, pendingPayments: 300,
    overdueAr: 150, overdueAp: 275, idempotencyKey: 'position-company-a-jan-1',
    accounts: [
      { accountId: 'bank-iqd', accountType: 'bank', currency: 'IQD', balance: 1000 },
      { accountId: 'restricted-iqd', accountType: 'restricted', currency: 'IQD', balance: 200 },
      { accountId: 'bank-usd', accountType: 'bank', currency: 'USD', balance: 1, fxRate: 1300 },
    ],
  }, ctx);
  assert.equal(position.totalCash, 2500);
  assert.equal(position.restrictedCash, 200);
  assert.equal(position.availableCash, 2300);

  const forecast = authority.treasuryLiquidityService.generateForecast({
    positionId: position.id, name: 'January daily liquidity', grain: 'daily',
    startDate: '2027-01-01', endDate: '2027-01-03', minimumCashThreshold: 1200,
    idempotencyKey: 'liquidity-company-a-jan',
    flows: [
      { date: '2027-01-01', direction: 'inflow', amount: 300, sourceType: 'ar_invoice', currency: 'IQD', counterpartyId: 'customer-a' },
      { date: '2027-01-02', direction: 'outflow', amount: 1900, sourceType: 'ap_invoice', currency: 'IQD', counterpartyId: 'supplier-a' },
      { date: '2027-01-03', direction: 'outflow', amount: 1000, sourceType: 'ap_invoice', currency: 'USD', counterpartyId: 'supplier-usd' },
    ],
  }, ctx);
  assert.equal(forecast.buckets.length, 3);
  assert.equal(forecast.buckets[1].closingCash, 900);
  assert.equal(forecast.buckets[1].availableCash, 700);
  const alerts = authority.treasuryLiquidityService.listAlerts({}, ctx);
  assert.ok(alerts.some((alert) => alert.alertType === 'minimum_cash_breach'));

  const breach = alerts.find((alert) => alert.alertType === 'minimum_cash_breach');
  const acknowledged = authority.treasuryLiquidityService.acknowledgeAlert(breach.id, ctx);
  assert.equal(acknowledged.status, 'acknowledged');
  const proposal = authority.treasuryLiquidityService.createProposal({ proposalType: 'funding', sourceAlertId: breach.id, amount: 2000, currency: 'IQD', requestedDate: '2027-01-02', rationale: 'Restore minimum liquidity buffer' }, ctx);
  const approved = authority.treasuryLiquidityService.approveProposal(proposal.id, { ...ctx, userId: 'cfo' });
  assert.equal(approved.status, 'approved');
  assert.equal(approved.bankContacted, false);
  assert.equal(approved.paymentExecuted, false);
  const release = authority.treasuryLiquidityService.requestCanonicalRelease(proposal.id, { ...ctx, userId: 'cfo' });
  assert.equal(release.canonicalAction, 'finance:funding_request_release');
  assert.equal(release.executionBoundary, 'REQUEST_ONLY');

  const facility = authority.treasuryLiquidityService.createFacility({ lenderPartyId: 'bank-a', name: 'Working capital revolver', facilityType: 'revolver', currency: 'IQD', limitAmount: 10000, interestRate: 7.5, startDate: '2027-01-01', endDate: '2027-12-31' }, ctx);
  const utilization = authority.treasuryLiquidityService.proposeUtilization(facility.id, { amount: 2000, reason: 'Approved liquidity gap' }, ctx);
  const utilizationApproval = authority.treasuryLiquidityService.approveUtilization(utilization.id, { ...ctx, userId: 'cfo' });
  assert.equal(utilizationApproval.status, 'approved');
  assert.equal(utilizationApproval.cashReceived, false);
  assert.equal(authority.treasuryLiquidityService.getFacility(facility.id, ctx).availableAmount, 8000);

  const lc = authority.treasuryLiquidityService.registerInstrument({ instrumentType: 'letter_of_credit', reference: 'LC-2027-001', bankPartyId: 'bank-a', beneficiaryPartyId: 'supplier-a', amount: 5000, currency: 'USD', expiryDate: '2027-06-30', terms: { incoterm: 'CIF' } }, ctx);
  assert.equal(lc.status, 'draft');
  assert.equal(lc.providerActivated, false);
  assert.throws(() => authority.treasuryLiquidityService.getPosition(position.id, { ...ctx, companyId: 'company-b' }), { code: 'COMPANY_SCOPE_DENIED' });
});
