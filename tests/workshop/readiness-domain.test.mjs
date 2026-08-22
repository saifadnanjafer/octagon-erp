import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWorkshopReadiness } from '../../platform/workshop/readiness.mjs';
import { READINESS_CATEGORIES, READINESS_STATES } from '../../platform/workshop/readiness-catalog.mjs';
import { openWorkshopFixture } from './fixture.mjs';

const allowAll = () => true;
const expectedCategories = ['organization','users','products','warehouse','production','quality','delivery','maintenance_fleet','devices','governance'];

test('readiness wizard exposes exactly the ten required setup categories', async (t) => {
  const { dialect, ctx } = await openWorkshopFixture(t, 'readiness-categories');
  const result = buildWorkshopReadiness({ dialect, ctx, can: allowAll });
  assert.deepEqual(result.data.categories.map((category) => category.id), expectedCategories);
  assert.equal(result.meta.total, 10);
  assert.ok(result.meta.checks >= 30);
});

test('every readiness check uses a declared non-binary state and canonical target', async (t) => {
  const { dialect, ctx } = await openWorkshopFixture(t, 'readiness-states');
  const result = buildWorkshopReadiness({ dialect, ctx, can: allowAll });
  const checks = result.data.categories.flatMap((category) => category.checks);
  assert.ok(checks.every((check) => READINESS_STATES.includes(check.state)));
  assert.ok(checks.every((check) => typeof check.target === 'string' && check.target.length > 0));
  assert.ok(result.data.categories.every((category) => READINESS_STATES.includes(category.state)));
});

test('readiness formula is transparent and counts only evaluable mandatory checks', async (t) => {
  const { dialect, ctx } = await openWorkshopFixture(t, 'readiness-formula');
  const result = buildWorkshopReadiness({ dialect, ctx, can: allowAll });
  const formula = result.data.formula;
  assert.equal(formula.denominator, formula.passed + formula.failed);
  assert.equal(formula.percentage, formula.denominator ? Math.round((formula.passed / formula.denominator) * 100) : 0);
  assert.match(formula.expression, /mandatory READY/);
  assert.deepEqual(formula.exclusions, ['OPTIONAL','PERMISSION_DENIED','NOT_SUPPORTED']);
});

test('permission-denied checks do not leak values and are excluded from denominator', async (t) => {
  const { dialect, ctx } = await openWorkshopFixture(t, 'readiness-permission');
  const deniedPermission = 'identity:role:read';
  const result = buildWorkshopReadiness({ dialect, ctx, can: (permission) => permission !== deniedPermission });
  const denied = result.data.categories.flatMap((category) => category.checks).filter((check) => check.permission === deniedPermission);
  assert.ok(denied.length >= 2);
  assert.ok(denied.every((check) => check.state === 'PERMISSION_DENIED'));
  assert.ok(denied.every((check) => check.value === null));
  assert.equal(result.data.formula.excludedPermission, denied.filter((check) => check.mandatory).length);
});

test('readiness wizard performs zero database mutations', async (t) => {
  const { dialect, ctx } = await openWorkshopFixture(t, 'readiness-readonly');
  const beforeChanges = dialect.prepare('SELECT total_changes() value').get().value;
  const beforeMigrations = dialect.prepare('SELECT COUNT(*) value FROM schema_migrations').get().value;
  const result = buildWorkshopReadiness({ dialect, ctx, can: allowAll });
  const afterChanges = dialect.prepare('SELECT total_changes() value').get().value;
  const afterMigrations = dialect.prepare('SELECT COUNT(*) value FROM schema_migrations').get().value;
  assert.equal(result.data.mutationPolicy, 'READ_ONLY_ZERO_MUTATION');
  assert.equal(afterChanges, beforeChanges);
  assert.equal(afterMigrations, beforeMigrations);
});

test('missing company scope stops readiness evaluation', async (t) => {
  const { dialect, ctx } = await openWorkshopFixture(t, 'readiness-scope');
  const result = buildWorkshopReadiness({ dialect, ctx: { ...ctx, companyId: '', activeCompanyId: '' }, can: allowAll });
  assert.equal(result.status, 403);
  assert.match(result.error, /company scope/i);
});

test('catalog declares all checks as immutable definitions', () => {
  assert.ok(Object.isFrozen(READINESS_CATEGORIES));
  for (const category of READINESS_CATEGORIES) {
    assert.ok(category.checks.length >= 3);
    assert.ok(category.checks.every((check) => Object.isFrozen(check)));
  }
});

