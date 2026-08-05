import assert from 'node:assert/strict';
import test from 'node:test';
import { READINESS_CATEGORIES } from '../../platform/workshop/readiness-catalog.mjs';
import { READINESS_GUIDANCE, buildReadinessActionPlan, guidanceFor } from '../../platform/workshop/readiness-guidance.mjs';
import { buildWorkshopReadiness } from '../../platform/workshop/readiness.mjs';
import { openWorkshopFixture } from './fixture.mjs';

const allowAll = () => true;

function check(id, state, overrides = {}) {
  return {
    id,
    label: id.replaceAll('_', ' '),
    state,
    mandatory: true,
    target: 'canonical_target',
    ...overrides,
  };
}

function categories(...checks) {
  return [{ id: 'sample', checks }];
}

test('guidance catalog covers every declared readiness check exactly once', () => {
  const declared = READINESS_CATEGORIES.flatMap((category) => category.checks.map((item) => item.id)).sort();
  const guided = Object.keys(READINESS_GUIDANCE).sort();
  assert.deepEqual(guided, declared);
  assert.equal(new Set(guided).size, guided.length);
});

test('every guidance entry contains a responsible role, risk, outcome, steps, and evidence', () => {
  const allowedRisks = new Set(['critical', 'high', 'medium', 'low']);
  for (const [id, item] of Object.entries(READINESS_GUIDANCE)) {
    assert.ok(Object.isFrozen(item), id);
    assert.ok(item.ownerRole.length >= 3, id);
    assert.ok(allowedRisks.has(item.risk), id);
    assert.ok(item.outcome.endsWith('.'), id);
    assert.ok(item.steps.length >= 3, id);
    assert.ok(item.steps.every((step) => step.endsWith('.')), id);
    assert.ok(item.evidence.length >= 2, id);
    assert.ok(Object.isFrozen(item.steps), id);
    assert.ok(Object.isFrozen(item.evidence), id);
    assert.ok(Object.isFrozen(item.dependsOn), id);
  }
});

test('all prerequisite references point to another declared readiness check', () => {
  const ids = new Set(Object.keys(READINESS_GUIDANCE));
  for (const [id, item] of Object.entries(READINESS_GUIDANCE)) {
    for (const dependency of item.dependsOn) {
      assert.ok(ids.has(dependency), `${id} references unknown prerequisite ${dependency}`);
      assert.notEqual(dependency, id, `${id} cannot depend on itself`);
    }
  }
});

test('READY, PERMISSION_DENIED, and NOT_SUPPORTED checks are never actionable', () => {
  for (const state of ['READY', 'PERMISSION_DENIED', 'NOT_SUPPORTED']) {
    const result = guidanceFor(check('active_company', state));
    assert.equal(result.actionable, false, state);
    assert.equal(result.currentState, state);
  }
});

test('WARNING, MISSING, BLOCKED, and OPTIONAL checks expose canonical setup guidance', () => {
  for (const state of ['WARNING', 'MISSING', 'BLOCKED', 'OPTIONAL']) {
    const result = guidanceFor(check('stock_locations', state, { target: 'zone_bin_management' }));
    assert.equal(result.actionable, true, state);
    assert.equal(result.target, 'zone_bin_management');
    assert.equal(result.ownerRole, 'Warehouse Supervisor');
    assert.ok(result.steps.length >= 3);
  }
});

test('unknown check identifiers return no invented guidance', () => {
  assert.equal(guidanceFor(check('unknown_check', 'MISSING')), null);
});

test('action plan excludes ready and permission-hidden checks', () => {
  const plan = buildReadinessActionPlan(categories(
    check('active_company', 'READY'),
    check('company_modules', 'MISSING'),
    check('identities', 'PERMISSION_DENIED'),
  ));
  assert.deepEqual(plan.actions.map((action) => action.checkId), ['company_modules']);
  assert.equal(plan.summary.total, 1);
});

test('unresolved prerequisites prevent premature setup actions', () => {
  const plan = buildReadinessActionPlan(categories(
    check('active_company', 'MISSING'),
    check('active_warehouse', 'MISSING'),
    check('stock_locations', 'MISSING'),
  ));
  const warehouse = plan.actions.find((action) => action.checkId === 'active_warehouse');
  const locations = plan.actions.find((action) => action.checkId === 'stock_locations');
  assert.deepEqual(warehouse.unresolvedPrerequisites, ['active_company']);
  assert.equal(warehouse.executionState, 'WAITING_FOR_PREREQUISITE');
  assert.deepEqual(locations.unresolvedPrerequisites, ['active_warehouse']);
  assert.equal(locations.executionState, 'WAITING_FOR_PREREQUISITE');
});

test('resolved prerequisites allow the next setup action', () => {
  const plan = buildReadinessActionPlan(categories(
    check('active_company', 'READY'),
    check('active_warehouse', 'MISSING'),
  ));
  assert.deepEqual(plan.actions[0].unresolvedPrerequisites, []);
  assert.equal(plan.actions[0].executionState, 'READY_TO_CONFIGURE');
});

test('mandatory work sorts before optional work regardless of risk', () => {
  const plan = buildReadinessActionPlan(categories(
    check('preventive_plans', 'OPTIONAL', { mandatory: false }),
    check('company_modules', 'WARNING', { mandatory: true }),
  ));
  assert.deepEqual(plan.actions.map((action) => action.checkId), ['company_modules', 'preventive_plans']);
});

test('blocked work sorts before missing and warning work', () => {
  const plan = buildReadinessActionPlan(categories(
    check('company_modules', 'WARNING'),
    check('active_company', 'BLOCKED'),
    check('assets', 'MISSING'),
  ));
  assert.deepEqual(plan.actions.map((action) => action.state), ['BLOCKED', 'MISSING', 'WARNING']);
});

test('risk breaks ties after mandatory and state severity', () => {
  const plan = buildReadinessActionPlan(categories(
    check('preventive_plans', 'WARNING'),
    check('active_company', 'WARNING'),
    check('quality_plans', 'WARNING'),
  ));
  assert.deepEqual(plan.actions.map((action) => action.risk), ['critical', 'high', 'medium']);
});

test('action plan summary reconciles with its action rows', () => {
  const plan = buildReadinessActionPlan(categories(
    check('active_company', 'BLOCKED'),
    check('active_warehouse', 'MISSING'),
    check('assets', 'WARNING'),
    check('preventive_plans', 'OPTIONAL', { mandatory: false }),
  ));
  assert.equal(plan.summary.total, plan.actions.length);
  assert.equal(plan.summary.critical, plan.actions.filter((action) => action.risk === 'critical').length);
  assert.equal(plan.summary.mandatory, plan.actions.filter((action) => action.mandatory).length);
  assert.equal(plan.summary.readyToConfigure, plan.actions.filter((action) => action.executionState === 'READY_TO_CONFIGURE').length);
  assert.equal(plan.summary.waitingForPrerequisite, plan.actions.filter((action) => action.executionState === 'WAITING_FOR_PREREQUISITE').length);
  assert.equal(plan.summary.readyToConfigure + plan.summary.waitingForPrerequisite, plan.summary.total);
});

test('live readiness response enriches every check and exposes a reconciled action plan', async (t) => {
  const { dialect, ctx } = await openWorkshopFixture(t, 'readiness-guidance');
  const result = buildWorkshopReadiness({ dialect, ctx, can: allowAll });
  const checks = result.data.categories.flatMap((category) => category.checks);
  assert.ok(checks.every((item) => item.guidance));
  assert.ok(checks.every((item) => item.guidance.currentState === item.state));
  assert.equal(result.data.actionPlan.summary.total, result.data.actionPlan.actions.length);
  assert.match(result.data.actionPlan.ordering, /mandatory/);
});

test('guidance enrichment remains read-only', async (t) => {
  const { dialect, ctx } = await openWorkshopFixture(t, 'readiness-guidance-readonly');
  const before = dialect.prepare('SELECT total_changes() value').get().value;
  buildWorkshopReadiness({ dialect, ctx, can: allowAll });
  const after = dialect.prepare('SELECT total_changes() value').get().value;
  assert.equal(after, before);
});

test('action rows carry complete handoff material for the responsible operator', () => {
  const plan = buildReadinessActionPlan(categories(
    check('approved_boms', 'WARNING'),
    check('quality_plans', 'MISSING'),
  ));
  for (const action of plan.actions) {
    assert.ok(action.checkId);
    assert.ok(action.categoryId);
    assert.ok(action.ownerRole);
    assert.ok(action.outcome);
    assert.ok(action.target);
    assert.ok(action.steps.length >= 3);
    assert.ok(action.evidence.length >= 2);
    assert.ok(Array.isArray(action.prerequisites));
    assert.ok(Array.isArray(action.unresolvedPrerequisites));
    assert.ok(['READY_TO_CONFIGURE', 'WAITING_FOR_PREREQUISITE'].includes(action.executionState));
  }
});

test('action planning is deterministic and does not mutate input categories', () => {
  const input = categories(
    check('assets', 'WARNING'),
    check('active_company', 'BLOCKED'),
    check('quality_plans', 'MISSING'),
  );
  const snapshot = structuredClone(input);
  const first = buildReadinessActionPlan(input);
  const second = buildReadinessActionPlan(input);
  assert.deepEqual(first, second);
  assert.deepEqual(input, snapshot);
});
