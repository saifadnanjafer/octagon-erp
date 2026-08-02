import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { handleBuild08Query } from '../../platform/api/build08.mjs';

test('planning actions are registered and read queries stay company scoped', async (t) => {
  const file = path.join(os.tmpdir(), `octagon-b08-query-${Date.now()}.db`);
  t.after(() => { try { fs.unlinkSync(file); } catch {} });
  await freshInstall({ dbPath: file });
  const db = openMigrationDatabase(file);
  t.after(() => db.close());
  const authority = createPlatformAuthority(db);
  const ctx = { userId: 'planner', actorId: 'planner', companyId: 'company-a' };
  const expected = ['forecast:history_snapshot', 'forecast:version_create', 'forecast:calculate', 'forecast:override_approve', 'forecast:publish', 'mps:run', 'mps:proposal_approve', 'mps:proposal_release_request', 'sop:cycle_create', 'sop:scenario_create', 'sop:review_approve', 'sop:publish'];
  const registered = new Set(db.prepare("SELECT id FROM platform_actions WHERE id LIKE 'forecast:%' OR id LIKE 'mps:%' OR id LIKE 'sop:%'").all().map((row) => row.id));
  for (const action of expected) assert.ok(registered.has(action), `${action} is registered`);

  const horizon = authority.forecastingService.createHorizon({ name: 'API horizon', startDate: '2027-01-01', endDate: '2027-12-31' }, ctx);
  authority.forecastingService.createHorizon({ companyId: 'company-b', name: 'Hidden horizon', startDate: '2027-01-01', endDate: '2027-12-31' }, { ...ctx, companyId: 'company-b' });
  const result = handleBuild08Query({ dialect: db, ctx, namespace: 'planning', resource: 'horizons', query: {} });
  assert.equal(result.meta.total, 1);
  assert.equal(result.data[0].id, horizon.id);
  assert.equal(result.data[0].companyId, 'company-a');
  assert.deepEqual(handleBuild08Query({ dialect: db, ctx: {}, namespace: 'planning', resource: 'horizons' }), { error: 'company scope is required', status: 403 });
});
