import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { freshInstall, openMigrationDatabase, runMigrations } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { createApiHandler } from '../../platform/api/index.mjs';

function tempArea(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `octagon-b08-${name}-`));
  return { dir, dbPath: path.join(dir, 'contract.db'), backupDir: path.join(dir, 'backups') };
}

test('governed BUILD-08 actions are idempotent, audited, transactional and permission denied over HTTP', async (t) => {
  const area = tempArea('governance');
  await freshInstall({ dbPath: area.dbPath, backupDir: area.backupDir, actor: 'build08-governance' });
  const db = openMigrationDatabase(area.dbPath);
  t.after(() => { db.close(); fs.rmSync(area.dir, { recursive: true, force: true }); });
  const authority = createPlatformAuthority(db);
  const ctx = { companyId: 'company-a', tenantId: 'default', branchId: 'default', userId: 'planner', actorId: 'planner', actorType: 'user', correlationId: 'governance-contract' };
  const horizon = authority.forecastingService.createHorizon({ name: 'Governed horizon', startDate: '2027-01-01', endDate: '2027-02-28' }, ctx);
  const snapshot = authority.forecastingService.snapshotHistory({ horizonId: horizon.id, lines: [{ productId: 'p-1', bucketStart: '2026-12-01', quantity: 12, sourceReference: 'sale-1' }] }, ctx);
  const input = { horizonId: horizon.id, snapshotId: snapshot.id, name: 'Idempotent version', method: 'manual', parameters: { quantity: 12 }, idempotency_key: 'governed-version-create' };
  const first = authority.actionExecutor.execute('forecast:version_create', input, ctx);
  const replay = authority.actionExecutor.execute('forecast:version_create', input, ctx);
  assert.deepEqual(replay, first);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM forecast_versions WHERE name='Idempotent version'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM action_idempotency WHERE operation_type='forecast:version_create'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM platform_audit_log WHERE action='action.execute.forecast:version_create'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM platform_outbox WHERE event_type='action.execute'").get().count, 1);

  const before = db.prepare('SELECT COUNT(*) AS count FROM forecast_lines').get().count;
  assert.throws(() => authority.actionExecutor.execute('forecast:calculate', { version_id: 'missing', idempotency_key: 'failing-calculation' }, ctx), { code: 'FORECAST_NOT_FOUND' });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM forecast_lines').get().count, before, 'failed governed action rolls back domain writes');
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM action_idempotency WHERE idempotency_key='failing-calculation'").get().count, 0, 'failed action leaves no idempotency success');
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM platform_audit_log WHERE action='action.execute.forecast:calculate'").get().count, 0, 'failed action does not claim success audit');

  const api = createApiHandler({
    dialect: db,
    prefix: '/api/v1',
    actionExecutor: authority.actionExecutor,
    resolveContext: () => ctx,
    authorize: ({ permission }) => ({ allowed: permission !== 'platform:db:write', message: 'viewer role' })
  });
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, 'http://127.0.0.1');
    if (!api(req, res, requestUrl)) { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const queryResponse = await fetch(`${base}/api/v1/planning/forecasts`);
  assert.equal(queryResponse.status, 200, 'viewer retains scoped read access');
  const denied = await fetch(`${base}/api/v1/action/forecast:calculate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version_id: first.id, idempotency_key: 'viewer-write-denied' })
  });
  assert.equal(denied.status, 403);
  const deniedPayload = await denied.json();
  assert.equal(deniedPayload.success, false);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM action_idempotency WHERE idempotency_key='viewer-write-denied'").get().count, 0);
});

test('BUILD-08 migrations roll back three reversible slices on a disposable database and reapply cleanly', async (t) => {
  const area = tempArea('rollback');
  t.after(() => fs.rmSync(area.dir, { recursive: true, force: true }));
  const install = await freshInstall({ dbPath: area.dbPath, backupDir: area.backupDir, actor: 'build08-rollback' });
  assert.deepEqual(install.migrations.slice(-3), [
    '073_build08_planning_mps_sop',
    '074_build08_treasury_liquidity',
    '075_build08_intercompany_consolidation'
  ]);
  const rolledBack = await runMigrations({ dbPath: area.dbPath, direction: 'down', steps: 3, backupDir: area.backupDir, actor: 'build08-rollback' });
  assert.deepEqual(rolledBack.migrations, [
    '075_build08_intercompany_consolidation',
    '074_build08_treasury_liquidity',
    '073_build08_planning_mps_sop'
  ]);
  const afterDown = openMigrationDatabase(area.dbPath);
  assert.equal(afterDown.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE migration_id LIKE '07[3-5]_%'").get().count, 0);
  assert.equal(afterDown.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('forecast_versions','treasury_cash_positions','consolidation_groups_v2')").get().count, 0);
  afterDown.close();
  const reapplied = await runMigrations({ dbPath: area.dbPath, direction: 'up', backupDir: area.backupDir, actor: 'build08-reapply' });
  assert.deepEqual(reapplied.migrations, [
    '073_build08_planning_mps_sop',
    '074_build08_treasury_liquidity',
    '075_build08_intercompany_consolidation'
  ]);
  const afterUp = openMigrationDatabase(area.dbPath);
  assert.equal(afterUp.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE migration_id IN ('073_build08_planning_mps_sop','074_build08_treasury_liquidity','075_build08_intercompany_consolidation')").get().count, 3);
  assert.equal(afterUp.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('forecast_versions','treasury_cash_positions','consolidation_groups_v2')").get().count, 3);
  afterUp.close();
});
