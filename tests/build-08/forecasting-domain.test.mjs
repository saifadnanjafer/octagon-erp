import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';

const dbPath = () => path.join(os.tmpdir(), `octagon-b08-forecast-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

test('sales history becomes calculated, overridden, immutable published forecast with accuracy', async (t) => {
  const file = dbPath();
  t.after(() => { try { fs.unlinkSync(file); } catch {} });
  await freshInstall({ dbPath: file });
  const db = openMigrationDatabase(file);
  t.after(() => db.close());
  const authority = createPlatformAuthority(db);
  const ctx = { userId: 'planner-1', actorId: 'planner-1', companyId: 'company-a', tenantId: 'default' };

  const horizon = authority.forecastingService.createHorizon({
    name: 'FY27 weekly plan', bucketType: 'week', startDate: '2027-01-01', endDate: '2027-03-31',
    frozenUntil: '2027-01-14', planningFenceUntil: '2027-02-01',
  }, ctx);
  assert.equal(horizon.companyId, 'company-a');

  const sales = [10, 20, 30, 40].map((quantity, index) => ({
    productId: 'product-a', bucketStart: `2026-12-${String(1 + index * 7).padStart(2, '0')}`,
    quantity, sourceType: 'sales_history', sourceReference: `sale-${index + 1}`,
  }));
  const snapshot = authority.forecastingService.snapshotHistory({
    horizonId: horizon.id, sourceCutoff: '2026-12-31', idempotencyKey: 'history-company-a-dec', lines: sales,
  }, ctx);
  const repeated = authority.forecastingService.snapshotHistory({
    horizonId: horizon.id, sourceCutoff: '2026-12-31', idempotencyKey: 'history-company-a-dec', lines: sales,
  }, ctx);
  assert.equal(repeated.id, snapshot.id, 'snapshot action is idempotent');
  assert.equal(snapshot.status, 'sealed');

  const version = authority.forecastingService.createVersion({
    horizonId: horizon.id, snapshotId: snapshot.id, name: 'January consensus',
    method: 'moving_average', parameters: { window: 3, targetBucket: '2027-01-08' },
    assumptions: ['approved price list', 'no exceptional closure'],
  }, ctx);
  const calculated = authority.forecastingService.calculate(version.id, ctx);
  assert.equal(calculated.status, 'calculated');
  assert.equal(calculated.lines[0].baselineQuantity, 30);

  const override = authority.forecastingService.submitOverride({
    versionId: version.id, lineId: calculated.lines[0].id, quantity: 36,
    reason: 'Signed customer framework call-off',
  }, ctx);
  assert.equal(override.status, 'pending');
  const approved = authority.forecastingService.approveOverride(override.id, { ...ctx, userId: 'planning-manager' });
  assert.equal(approved.status, 'approved');

  const published = authority.forecastingService.publish(version.id, { ...ctx, userId: 'planning-manager' });
  assert.equal(published.status, 'published');
  assert.equal(published.lines[0].approvedQuantity, 36);
  assert.match(published.immutableDigest, /^[a-f0-9]{64}$/);
  assert.throws(() => authority.forecastingService.calculate(version.id, ctx), { code: 'FORECAST_IMMUTABLE' });

  const metrics = authority.forecastingService.recordActuals(version.id, [{ lineId: published.lines[0].id, quantity: 30 }], ctx);
  assert.equal(metrics.mae, 6);
  assert.equal(metrics.mape, 20);
  assert.equal(metrics.bias, 6);
  assert.throws(() => authority.forecastingService.getVersion(version.id, { ...ctx, companyId: 'company-b' }), { code: 'COMPANY_SCOPE_DENIED' });
});

test('weighted moving average and exponential smoothing calculations are deterministic', async (t) => {
  const file = dbPath();
  t.after(() => { try { fs.unlinkSync(file); } catch {} });
  await freshInstall({ dbPath: file });
  const db = openMigrationDatabase(file);
  t.after(() => db.close());
  const authority = createPlatformAuthority(db);
  const ctx = { userId: 'planner-2', actorId: 'planner-2', companyId: 'company-a' };
  const horizon = authority.forecastingService.createHorizon({ name: 'Methods', startDate: '2027-01-01', endDate: '2027-02-01' }, ctx);
  const snapshot = authority.forecastingService.snapshotHistory({ horizonId: horizon.id, lines: [10, 20, 30, 40].map((quantity, i) => ({ productId: 'p', bucketStart: `2026-0${i + 1}-01`, quantity, sourceReference: `s${i}` })) }, ctx);

  const weighted = authority.forecastingService.createVersion({ horizonId: horizon.id, snapshotId: snapshot.id, name: 'Weighted', method: 'weighted_moving_average', parameters: { weights: [1, 2, 3] } }, ctx);
  assert.equal(authority.forecastingService.calculate(weighted.id, ctx).lines[0].baselineQuantity, 33.3333);

  const smoothed = authority.forecastingService.createVersion({ horizonId: horizon.id, snapshotId: snapshot.id, name: 'Smoothed', method: 'exponential_smoothing', parameters: { alpha: 0.5 } }, ctx);
  assert.equal(authority.forecastingService.calculate(smoothed.id, ctx).lines[0].baselineQuantity, 31.25);
  const invalid = authority.forecastingService.createVersion({ horizonId: horizon.id, snapshotId: snapshot.id, name: 'Invalid Alpha', method: 'exponential_smoothing', parameters: { alpha: 1.5 } }, ctx);
  assert.throws(() => authority.forecastingService.calculate(invalid.id, ctx), { code: 'INVALID_SMOOTHING_ALPHA' });
});
