import assert from 'node:assert/strict';
import test from 'node:test';
import { WORKSHOP_DRILLDOWNS } from '../../platform/workshop/drilldown-catalog.mjs';
import { buildWorkshopDrilldown } from '../../platform/workshop/drilldowns.mjs';
import { openWorkshopFixture, insertWorkItem } from './fixture.mjs';

const allowAll = () => true;

test('every Command Center KPI has a bounded executable drilldown against the installed schema', async (t) => {
  const { dialect, ctx } = await openWorkshopFixture(t, 'drilldown-schema');
  dialect.prepare(`INSERT INTO warehouses(id,company_id,name,code,is_active,created_at)
    VALUES(?,?,?,?,1,?)`).run('wh-main', 'default', 'Main Warehouse', 'MAIN', new Date().toISOString());
  for (const metricId of Object.keys(WORKSHOP_DRILLDOWNS)) {
    const result = buildWorkshopDrilldown({ dialect, ctx, query: { metric_id: metricId }, can: allowAll });
    assert.equal(result.error, undefined, `${metricId}: ${result.error}`);
    assert.equal(result.data.metricId, metricId);
    assert.equal(result.meta.bounded, true);
    assert.ok(result.meta.limit <= 50);
  }
});

test('work drilldown returns normalized canonical rows in priority order', async (t) => {
  const { dialect, ctx } = await openWorkshopFixture(t, 'drilldown-rows');
  insertWorkItem(dialect, { id: 'normal-later', title: 'Normal later', priority: 'medium', dueDate: '2030-01-02T00:00:00.000Z' });
  insertWorkItem(dialect, { id: 'urgent-first', title: 'Urgent first', priority: 'urgent', dueDate: '2030-01-03T00:00:00.000Z' });
  const result = buildWorkshopDrilldown({ dialect, ctx, query: { metric_id: 'today_open_work' }, can: allowAll });
  assert.deepEqual(result.data.rows.map((row) => row.id), ['urgent-first', 'normal-later']);
  assert.equal(result.data.rows[0].target, 'task_manager');
  assert.equal(result.data.rows[0].status, 'todo');
  assert.equal(result.data.rows[0].ownerId, 'operator-a');
  assert.equal(result.meta.total, 2);
});

test('actor-specific drilldown never returns another user assignment', async (t) => {
  const { dialect, ctx } = await openWorkshopFixture(t, 'drilldown-actor');
  insertWorkItem(dialect, { id: 'mine', assignedUserId: 'operator-a' });
  insertWorkItem(dialect, { id: 'not-mine', assignedUserId: 'operator-b' });
  const result = buildWorkshopDrilldown({ dialect, ctx, query: { metric_id: 'mine_assigned' }, can: allowAll });
  assert.deepEqual(result.data.rows.map((row) => row.id), ['mine']);
  assert.equal(result.data.scope.actorId, 'operator-a');
});

test('company scope is mandatory and cross-company records are excluded', async (t) => {
  const { dialect, ctx } = await openWorkshopFixture(t, 'drilldown-company');
  insertWorkItem(dialect, { id: 'active-company', companyId: 'default' });
  insertWorkItem(dialect, { id: 'foreign-company', companyId: 'foreign' });
  const scoped = buildWorkshopDrilldown({ dialect, ctx, query: { metric_id: 'today_open_work' }, can: allowAll });
  assert.deepEqual(scoped.data.rows.map((row) => row.id), ['active-company']);
  const missing = buildWorkshopDrilldown({ dialect, ctx: { ...ctx, companyId: '', activeCompanyId: '' }, query: { metric_id: 'today_open_work' }, can: allowAll });
  assert.equal(missing.status, 403);
  assert.match(missing.error, /company scope/i);
});

test('warehouse-scoped drilldown rejects a warehouse outside the active company', async (t) => {
  const { dialect, ctx } = await openWorkshopFixture(t, 'drilldown-warehouse');
  const result = buildWorkshopDrilldown({
    dialect, ctx: { ...ctx, warehouseId: 'foreign-warehouse' },
    query: { metric_id: 'queue_picking' }, can: allowAll,
  });
  assert.equal(result.status, 403);
  assert.match(result.error, /warehouse/i);
});

test('metric permission is enforced before query execution', async (t) => {
  const { dialect, ctx } = await openWorkshopFixture(t, 'drilldown-permission');
  dialect.exec('DROP TABLE iot_device_alerts');
  const result = buildWorkshopDrilldown({
    dialect, ctx, query: { metric_id: 'health_devices' },
    can: (permission) => permission !== 'iot:telemetry:view',
  });
  assert.equal(result.status, 403);
  assert.match(result.error, /permission denied/i);
});

test('unknown metric is rejected without accepting raw table or SQL input', async (t) => {
  const { dialect, ctx } = await openWorkshopFixture(t, 'drilldown-unknown');
  const result = buildWorkshopDrilldown({
    dialect, ctx,
    query: { metric_id: 'not_registered', table: 'users', sql: 'SELECT * FROM users' },
    can: allowAll,
  });
  assert.equal(result.status, 404);
  assert.match(result.error, /unknown command-center metric/i);
});

test('requested limits are clamped to one through fifty records', async (t) => {
  const { dialect, ctx } = await openWorkshopFixture(t, 'drilldown-limits');
  for (let index = 0; index < 60; index += 1) insertWorkItem(dialect, { id: `bounded-${index}` });
  const high = buildWorkshopDrilldown({ dialect, ctx, query: { metric_id: 'today_open_work', limit: 5000 }, can: allowAll });
  const low = buildWorkshopDrilldown({ dialect, ctx, query: { metric_id: 'today_open_work', limit: -10 }, can: allowAll });
  assert.equal(high.meta.limit, 50);
  assert.equal(high.data.rows.length, 50);
  assert.equal(low.meta.limit, 1);
  assert.equal(low.data.rows.length, 1);
});

test('drilldowns are read-only and report a stable generation timestamp', async (t) => {
  const { dialect, ctx } = await openWorkshopFixture(t, 'drilldown-readonly');
  insertWorkItem(dialect, { id: 'read-only-row' });
  const before = dialect.prepare('SELECT total_changes() value').get().value;
  const result = buildWorkshopDrilldown({
    dialect, ctx, query: { metric_id: 'today_open_work' }, can: allowAll,
    now: () => new Date('2026-08-05T08:00:00.000Z'),
  });
  const after = dialect.prepare('SELECT total_changes() value').get().value;
  assert.equal(before, after);
  assert.equal(result.data.generatedAt, '2026-08-05T08:00:00.000Z');
  assert.equal(result.meta.generated_at, result.data.generatedAt);
});

test('catalog is immutable and every definition has a canonical target and permission', () => {
  assert.ok(Object.isFrozen(WORKSHOP_DRILLDOWNS));
  assert.equal(Object.keys(WORKSHOP_DRILLDOWNS).length, 18);
  for (const [metricId, definition] of Object.entries(WORKSHOP_DRILLDOWNS)) {
    assert.ok(Object.isFrozen(definition), metricId);
    assert.equal(definition.id, metricId);
    assert.ok(definition.permission.includes(':'));
    assert.ok(definition.target.length > 0);
    assert.match(definition.sql, /^\s*SELECT/i);
    assert.doesNotMatch(definition.sql, /\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/i);
  }
});
