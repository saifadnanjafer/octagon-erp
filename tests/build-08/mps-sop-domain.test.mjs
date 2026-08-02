import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';

const tempDb = () => path.join(os.tmpdir(), `octagon-b08-mps-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

async function preparedAuthority(t) {
  const file = tempDb();
  t.after(() => { try { fs.unlinkSync(file); } catch {} });
  await freshInstall({ dbPath: file });
  const db = openMigrationDatabase(file);
  t.after(() => db.close());
  const authority = createPlatformAuthority(db);
  const ctx = { userId: 'planner', actorId: 'planner', companyId: 'company-a' };
  const horizon = authority.forecastingService.createHorizon({ name: 'MPS', startDate: '2027-01-01', endDate: '2027-03-31', frozenUntil: '2027-01-14', planningFenceUntil: '2027-02-01' }, ctx);
  const snapshot = authority.forecastingService.snapshotHistory({ horizonId: horizon.id, lines: [{ productId: 'make-item', bucketStart: '2026-12-01', quantity: 100, sourceReference: 'sale-history' }, { productId: 'buy-item', bucketStart: '2026-12-01', quantity: 50, sourceReference: 'sale-history-2' }] }, ctx);
  const version = authority.forecastingService.createVersion({ horizonId: horizon.id, snapshotId: snapshot.id, name: 'Consensus', method: 'manual', parameters: { quantity: 100, targetBucket: '2027-01-08' } }, ctx);
  authority.forecastingService.calculate(version.id, ctx);
  authority.forecastingService.publish(version.id, ctx);
  return { authority, ctx, horizon, version };
}

test('published forecast becomes MPS net requirements and governed supply proposals', async (t) => {
  const { authority, ctx, horizon, version } = await preparedAuthority(t);
  const run = authority.masterProductionScheduleService.run({
    horizonId: horizon.id, forecastVersionId: version.id, idempotencyKey: 'mps-company-a-jan',
    facts: [
      { productId: 'make-item', bucketStart: '*', beginningInventory: 20, confirmedDemand: 80, safetyStock: 10, scheduledReceipts: 5, openProduction: 10, capacityPerUnit: 2, capacityAvailable: 120, supplyType: 'production' },
      { productId: 'buy-item', bucketStart: '*', beginningInventory: 90, confirmedDemand: 20, safetyStock: 5, openProcurement: 15, capacityAvailable: 1000, supplyType: 'procurement' },
    ],
  }, ctx);
  assert.equal(run.lines.length, 2);
  const make = run.lines.find((line) => line.productId === 'make-item');
  assert.equal(make.grossRequirement, 110);
  assert.equal(make.netRequirement, 75);
  assert.equal(make.projectedAvailable, -65);
  assert.equal(make.warningCode, 'FROZEN_ZONE_SHORTAGE');
  assert.equal(run.proposals.length, 1);
  assert.equal(run.proposals[0].proposalType, 'production');

  const repeated = authority.masterProductionScheduleService.run({ horizonId: horizon.id, forecastVersionId: version.id, idempotencyKey: 'mps-company-a-jan' }, ctx);
  assert.equal(repeated.id, run.id);
  const approved = authority.masterProductionScheduleService.approveProposal(run.proposals[0].id, { reason: 'Capacity plan accepted' }, { ...ctx, userId: 'supply-manager' });
  assert.equal(approved.status, 'approved');
  const request = authority.masterProductionScheduleService.requestCanonicalRelease(approved.id, { ...ctx, userId: 'supply-manager' });
  assert.equal(request.status, 'release_requested');
  assert.equal(request.canonicalAction, 'manufacturing:production_order_create');
  assert.equal(request.canonicalWriterExecuted, false, 'planning never posts production orders');
  assert.equal(request.boundary, 'REQUEST_ONLY');
  assert.throws(() => authority.masterProductionScheduleService.getRun(run.id, { ...ctx, companyId: 'company-b' }), { code: 'COMPANY_SCOPE_DENIED' });
});

test('S&OP scenario exposes supply, capacity and financial gaps through review and publication', async (t) => {
  const { authority, ctx } = await preparedAuthority(t);
  const cycle = authority.salesOperationsPlanningService.createCycle({ name: 'Q1 executive S&OP', periodStart: '2027-01-01', periodEnd: '2027-03-31' }, ctx);
  const scenario = authority.salesOperationsPlanningService.addScenario(cycle.id, {
    name: 'Growth case', demandQuantity: 1000, supplyQuantity: 850, inventoryProjection: 120,
    capacityRequired: 1800, capacityAvailable: 1500, revenueProjection: 250000000, costProjection: 175000000,
    actualDemand: 980, actualSupply: 820, assumptions: ['stable FX'],
    resolutions: [{ action: 'approve overtime capacity proposal', owner: 'operations' }],
  }, ctx);
  assert.deepEqual(scenario.gaps.map((gap) => gap.code), ['SUPPLY_GAP', 'CAPACITY_GAP']);
  assert.equal(scenario.projectedMargin, 75000000);
  assert.equal(scenario.demandVariance, -20);
  assert.equal(scenario.supplyVariance, -30);
  const reviewed = authority.salesOperationsPlanningService.review(cycle.id, { decision: 'approve', notes: 'Executive committee accepted the growth case' }, { ...ctx, userId: 'ceo' });
  assert.equal(reviewed.status, 'approved');
  const published = authority.salesOperationsPlanningService.publish(cycle.id, scenario.id, { ...ctx, userId: 'ceo' });
  assert.equal(published.status, 'published');
  assert.equal(published.scenarios[0].selected, true);
  assert.throws(() => authority.salesOperationsPlanningService.addScenario(cycle.id, { name: 'late edit' }, ctx), { code: 'SOP_CYCLE_IMMUTABLE' });
});
