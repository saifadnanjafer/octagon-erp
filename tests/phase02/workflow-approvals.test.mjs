// Phase 02 Wave D — workflow definitions, durable runtime, approval policies,
// concurrency, worklists, automation, business calendars, and SLA.
// Packets 02.17 – 02.23. Disposable databases only.

import assert from 'node:assert';
import crypto from 'node:crypto';
import { setup, cleanup, run, seedOrg } from './harness.mjs';
import {
  createWorkflowRegistry, createWorkflowRuntime, WorkflowError, isFrozenEntity, compare, interpolate,
} from '../../platform/workflow/index.mjs';
import { createApprovalEngine, ApprovalError, payloadHash, BOXES } from '../../platform/approvals/index.mjs';
import { createAutomationEngine, AutomationError } from '../../platform/automation/index.mjs';
import { createBusinessCalendarService, createSlaClockService, SlaError } from '../../platform/sla/index.mjs';
import { createPermissionRegistry } from '../../platform/authorization/registry/index.mjs';
import { createPermissionEvaluator } from '../../platform/authorization/evaluator/index.mjs';
import { createRoleAdministration } from '../../platform/authorization/roles/index.mjs';
import { createPolicyEngine } from '../../platform/policies/index.mjs';
import { createMembershipDirectory } from '../../platform/organizations/memberships/index.mjs';
import { buildDecisionContext, stripUntrustedContext } from '../../platform/identity/context/index.mjs';
import { createActionRegistry, createActionExecutor } from '../../platform/kernel/actions/index.mjs';

const PERMS = [
  { id: 'crm:crm_lead:create', module_id: 'platform_kernel', kind: 'action', label_ar: 'إنشاء' },
  { id: 'crm:crm_lead:update', module_id: 'platform_kernel', kind: 'action', label_ar: 'تعديل' },
  { id: 'crm:crm_lead:touch', module_id: 'platform_kernel', kind: 'action', label_ar: 'تحديث' },
  { id: 'crm:crm_lead:fail', module_id: 'platform_kernel', kind: 'action', label_ar: 'فشل' },
  { id: 'crm:crm_lead:undo', module_id: 'platform_kernel', kind: 'action', label_ar: 'تراجع' },
  { id: 'finance:invoice:approve', module_id: 'platform_kernel', kind: 'action', label_ar: 'اعتماد' },
];

/** Register a domain action whose handler is a controllable test double. */
function registerAction(dialect, registry, executor, id, handler) {
  registry.register({
    id, module_id: 'platform_kernel', entity_id: 'crm_lead', kind: 'domain',
    transaction_owner: 'action', idempotency_policy: 'supported',
  });
  executor.registerHandler(id, handler);
}

function bootstrap(dialect, { now } = {}) {
  const org = seedOrg(dialect);
  const registry = createPermissionRegistry(dialect);
  registry.registerMany(PERMS);
  const policyEngine = createPolicyEngine(dialect, { now });
  const evaluator = createPermissionEvaluator(dialect, { permissionRegistry: registry, policyEngine });
  policyEngine.evaluator = evaluator;
  const roles = createRoleAdministration(dialect, { permissionRegistry: registry, evaluator });
  const memberships = createMembershipDirectory(dialect);
  const calendars = createBusinessCalendarService(dialect, { now });
  const approvals = createApprovalEngine(dialect, { evaluator, policyEngine, calendars, now });

  const actionRegistry = createActionRegistry(dialect);
  const actionExecutor = createActionExecutor(dialect);
  const calls = [];
  registerAction(dialect, actionRegistry, actionExecutor, 'crm:touch', ({ input }) => { calls.push(input); return { touched: input.record_id }; });
  registerAction(dialect, actionRegistry, actionExecutor, 'crm:fail', () => { throw new Error('action exploded'); });
  registerAction(dialect, actionRegistry, actionExecutor, 'crm:undo', ({ input }) => { calls.push({ undo: input.record_id }); return { undone: true }; });

  const wfRegistry = createWorkflowRegistry(dialect, { actionRegistry, permissionRegistry: registry, now });
  const runtime = createWorkflowRuntime(dialect, { registry: wfRegistry, actionExecutor, evaluator, approvals, calendars, now });
  const automation = createAutomationEngine(dialect, { actionExecutor, actionRegistry, evaluator, now });

  const ctxFor = (userId, request = {}) =>
    buildDecisionContext(dialect, { actorId: userId, actorType: 'user' }, stripUntrustedContext(request), { membershipDirectory: memberships });

  // Give the manager broad rights so workflow nodes are authorized by default.
  roles.createRole({ id: 'r_ops', tenantId: org.tenantA, name: 'ops' });
  roles.setGrants('r_ops', [{ permission: 'crm:*', scope: 'all' }, { permission: 'finance:*', scope: 'all' }]);
  roles.assign({ userId: org.userManager, roleId: 'r_ops', companyId: org.companyA1 });

  return { org, registry, evaluator, roles, memberships, calendars, approvals, actionRegistry, actionExecutor, wfRegistry, runtime, automation, policyEngine, ctxFor, calls };
}

function seedRecord(dialect, { entity = 'crm_lead', id, companyId, createdBy = 'u_manager', data = {} }) {
  const now = new Date().toISOString();
  dialect.prepare(`INSERT INTO x_records (entity, id, company_id, data, created_at, updated_at, created_by, removed, version) VALUES (?,?,?,?,?,?,?,0,1)`)
    .run(entity, id, companyId, JSON.stringify(data), now, now, createdBy);
  return id;
}

const SIMPLE_SPEC = {
  initialState: 'start',
  states: ['start', 'done'],
  transitions: [{ from: 'start', to: 'done' }],
  nodes: [
    { id: 'n1', type: 'action', actionId: 'crm:touch', requiredPermission: 'crm:crm_lead:touch', config: {} },
    { id: 'n2', type: 'action', actionId: 'crm:touch', requiredPermission: 'crm:crm_lead:touch', config: {} },
  ],
};

function defineSimpleWorkflow(wfRegistry, spec = SIMPLE_SPEC) {
  wfRegistry.define({ id: 'wf_lead', moduleId: 'platform_kernel', name: 'lead_flow', entity: 'crm_lead' });
  const { version } = wfRegistry.addVersion('wf_lead', spec);
  wfRegistry.activate('wf_lead', version);
  return version;
}

// --- 02.17 definition registry ----------------------------------------------

async function testInvalidDefinitionsRefused() {
  const { dialect, dbPath } = await setup();
  const { wfRegistry } = bootstrap(dialect);
  wfRegistry.define({ id: 'wf_x', moduleId: 'platform_kernel', name: 'x', entity: 'crm_lead' });

  // transition to an undeclared state
  let v = wfRegistry.validate('wf_x', { initialState: 'a', states: ['a'], transitions: [{ from: 'a', to: 'ghost' }], nodes: [] });
  assert.ok(v.problems.some((p) => p.code === 'TRANSITION_TO_UNDECLARED'));
  // unregistered action
  v = wfRegistry.validate('wf_x', { initialState: 'a', states: ['a', 'b'], transitions: [{ from: 'a', to: 'b' }], nodes: [{ id: 'n', type: 'action', actionId: 'ghost:action' }] });
  assert.ok(v.problems.some((p) => p.code === 'NODE_ACTION_NOT_REGISTERED'));
  // unsupported node type
  v = wfRegistry.validate('wf_x', { initialState: 'a', states: ['a', 'b'], transitions: [{ from: 'a', to: 'b' }], nodes: [{ id: 'n', type: 'sql' }] });
  assert.ok(v.problems.some((p) => p.code === 'NODE_TYPE_UNSUPPORTED'), 'there is no SQL node type');
  // duplicate node id
  v = wfRegistry.validate('wf_x', { initialState: 'a', states: ['a', 'b'], transitions: [{ from: 'a', to: 'b' }], nodes: [{ id: 'n', type: 'condition' }, { id: 'n', type: 'condition' }] });
  assert.ok(v.problems.some((p) => p.code === 'NODE_ID_DUPLICATE'));
  // no terminal state (a guaranteed hang)
  v = wfRegistry.validate('wf_x', { initialState: 'a', states: ['a', 'b'], transitions: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }], nodes: [] });
  assert.ok(v.problems.some((p) => p.code === 'STATE_GRAPH_HAS_NO_TERMINAL_STATE'));
  // addVersion refuses an invalid spec outright
  assert.throws(() => wfRegistry.addVersion('wf_x', { initialState: 'a', states: ['a'], transitions: [], nodes: [{ id: 'n', type: 'sql' }] }),
    (e) => e instanceof WorkflowError && e.code === 'WORKFLOW_INVALID');
  await cleanup(dialect, dbPath);
}

async function testFrozenEntityNodeRefused() {
  const { dialect, dbPath } = await setup();
  const { wfRegistry } = bootstrap(dialect);
  assert.strictEqual(isFrozenEntity('employees'), true);
  assert.strictEqual(isFrozenEntity('employee_advances'), true);
  assert.strictEqual(isFrozenEntity('timesheet'), true);
  assert.strictEqual(isFrozenEntity('attendance'), true);
  assert.strictEqual(isFrozenEntity('payroll_periods'), true);
  assert.strictEqual(isFrozenEntity('crm_lead'), false);

  wfRegistry.define({ id: 'wf_frozen', moduleId: 'platform_kernel', name: 'frozen', entity: 'crm_lead' });
  const v = wfRegistry.validate('wf_frozen', {
    initialState: 'a', states: ['a', 'b'], transitions: [{ from: 'a', to: 'b' }],
    nodes: [{ id: 'n', type: 'action', actionId: 'crm:touch', config: { entity: 'employees' } }],
  });
  assert.ok(v.problems.some((p) => p.code === 'NODE_TARGETS_FROZEN_ENTITY'), 'a workflow can never write the frozen payroll zone');
  await cleanup(dialect, dbPath);
}

async function testVersionActivationAndImmutability() {
  const { dialect, dbPath } = await setup();
  const { wfRegistry } = bootstrap(dialect);
  defineSimpleWorkflow(wfRegistry);
  assert.strictEqual(wfRegistry.activeVersion('wf_lead').version, 1);

  const { version: v2 } = wfRegistry.addVersion('wf_lead', { ...SIMPLE_SPEC, nodes: [SIMPLE_SPEC.nodes[0]] });
  assert.strictEqual(v2, 2);
  assert.strictEqual(wfRegistry.activeVersion('wf_lead').version, 1, 'a draft version does not become active by itself');
  wfRegistry.activate('wf_lead', 2);
  assert.strictEqual(wfRegistry.activeVersion('wf_lead').version, 2);
  // version 1 is still readable and unchanged — versions are immutable history
  assert.strictEqual(wfRegistry.getVersion('wf_lead', 1).nodes.length, 2);
  assert.strictEqual(wfRegistry.getVersion('wf_lead', 1).status, 'retired');

  wfRegistry.retire('wf_lead');
  assert.strictEqual(wfRegistry.get('wf_lead').status, 'retired');
  await cleanup(dialect, dbPath);
}

async function testCanvasCompatibility() {
  const { dialect, dbPath } = await setup();
  const { wfRegistry } = bootstrap(dialect);
  const canvas = {
    name: 'سير عمل العميل', active: true,
    trigger: { type: 'record', entity: 'crm_lead', event: 'created' },
    nodes: [
      { id: 'step_1', type: 'condition', label: 'تحقق', config: { path: 'record.status', operator: 'eq', value: 'new' } },
      { id: 'step_2', type: 'notify', label: 'إشعار', config: { user: 'u_manager', title: 'عميل جديد' } },
    ],
  };
  const adapted = wfRegistry.fromCanvas(canvas);
  assert.strictEqual(adapted.definition.entity, 'crm_lead');
  assert.strictEqual(adapted.spec.nodes[0].type, 'condition');
  assert.strictEqual(adapted.spec.nodes[1].type, 'notify');

  wfRegistry.define({ id: 'wf_canvas', ...adapted.definition });
  const { version } = wfRegistry.addVersion('wf_canvas', adapted.spec);
  wfRegistry.activate('wf_canvas', version);
  const roundTrip = wfRegistry.toCanvas('wf_canvas', version);
  assert.strictEqual(roundTrip.name, 'سير عمل العميل');
  assert.strictEqual(roundTrip.nodes.length, 2);
  assert.strictEqual(roundTrip.trigger.entity, 'crm_lead');
  await cleanup(dialect, dbPath);
}

// --- 02.18 durable runtime --------------------------------------------------

async function testInstanceRunsToCompletion() {
  const { dialect, dbPath } = await setup();
  const { org, wfRegistry, runtime, ctxFor, calls } = bootstrap(dialect);
  defineSimpleWorkflow(wfRegistry);
  seedRecord(dialect, { id: 'lead_1', companyId: org.companyA1 });
  const ctx = ctxFor(org.userManager);
  const instance = runtime.start({ definitionId: 'wf_lead', entity: 'crm_lead', recordId: 'lead_1', ctx });
  const { instance: finished } = runtime.run(instance.id, ctx);
  assert.strictEqual(finished.status, 'completed');
  assert.strictEqual(calls.length, 2, 'both action nodes executed exactly once');
  assert.strictEqual(runtime.steps(instance.id).filter((s) => s.status === 'done').length, 2);
  await cleanup(dialect, dbPath);
}

async function testIdempotentStartAndDuplicateDispatch() {
  const { dialect, dbPath } = await setup();
  const { org, wfRegistry, runtime, ctxFor } = bootstrap(dialect);
  defineSimpleWorkflow(wfRegistry);
  seedRecord(dialect, { id: 'lead_1', companyId: org.companyA1 });
  const ctx = ctxFor(org.userManager);

  const a = runtime.start({ definitionId: 'wf_lead', entity: 'crm_lead', recordId: 'lead_1', ctx, idempotencyKey: 'evt-1' });
  const b = runtime.start({ definitionId: 'wf_lead', entity: 'crm_lead', recordId: 'lead_1', ctx, idempotencyKey: 'evt-1' });
  assert.strictEqual(a.id, b.id, 'a duplicate trigger returns the same instance');
  assert.strictEqual(Number(dialect.prepare('SELECT COUNT(*) AS n FROM workflow_instances').get().n), 1);

  // Two workers dispatching the same step attempt: the second is refused.
  const lease = runtime.claim();
  runtime.step(a.id, lease.leaseId, ctx);
  dialect.prepare('UPDATE workflow_instances SET cursor = 0, attempts = 0 WHERE id = ?').run(a.id);
  assert.throws(() => runtime.step(a.id, lease.leaseId, ctx), (e) => e.code === 'DUPLICATE_DISPATCH');
  await cleanup(dialect, dbPath);
}

async function testLeaseExclusivityAndStaleLeaseRecovery() {
  const { dialect, dbPath } = await setup();
  const { org, wfRegistry, runtime, ctxFor } = bootstrap(dialect);
  defineSimpleWorkflow(wfRegistry);
  seedRecord(dialect, { id: 'lead_1', companyId: org.companyA1 });
  const ctx = ctxFor(org.userManager);
  const instance = runtime.start({ definitionId: 'wf_lead', entity: 'crm_lead', recordId: 'lead_1', ctx });

  const first = runtime.claim();
  assert.ok(first);
  const second = runtime.claim();
  assert.strictEqual(second, null, 'a leased instance cannot be claimed by a second worker');

  // a worker holding a stale lease is refused
  assert.throws(() => runtime.step(instance.id, 'lease_someone_else', ctx), (e) => e.code === 'STALE_LEASE');

  // the crashed worker's lease expires and the instance becomes claimable again
  dialect.prepare('UPDATE workflow_instances SET leased_until = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', instance.id);
  const recovered = runtime.recoverStaleLeases();
  assert.ok(recovered.includes(instance.id));
  const third = runtime.claim();
  assert.ok(third, 'after recovery the instance can be claimed again');
  assert.strictEqual(runtime.heartbeat(instance.id, third.leaseId), true);
  assert.strictEqual(runtime.heartbeat(instance.id, 'wrong-lease'), false);
  await cleanup(dialect, dbPath);
}

async function testWorkerCrashResumesAtCursor() {
  const { dialect, dbPath } = await setup();
  const { org, wfRegistry, runtime, ctxFor, calls } = bootstrap(dialect);
  defineSimpleWorkflow(wfRegistry, {
    ...SIMPLE_SPEC,
    nodes: [
      { id: 'n1', type: 'action', actionId: 'crm:touch', requiredPermission: 'crm:crm_lead:touch', config: {} },
      { id: 'n2', type: 'action', actionId: 'crm:touch', requiredPermission: 'crm:crm_lead:touch', config: {} },
      { id: 'n3', type: 'action', actionId: 'crm:touch', requiredPermission: 'crm:crm_lead:touch', config: {} },
    ],
  });
  seedRecord(dialect, { id: 'lead_1', companyId: org.companyA1 });
  const ctx = ctxFor(org.userManager);
  const instance = runtime.start({ definitionId: 'wf_lead', entity: 'crm_lead', recordId: 'lead_1', ctx });

  // Worker A executes one node, then "crashes" (lease abandoned).
  const leaseA = runtime.claim();
  runtime.step(instance.id, leaseA.leaseId, ctx);
  assert.strictEqual(calls.length, 1);
  dialect.prepare('UPDATE workflow_instances SET leased_until = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', instance.id);

  // Worker B picks it up and resumes exactly at the cursor — no replay of n1.
  runtime.recoverStaleLeases();
  const leaseB = runtime.claim();
  assert.strictEqual(runtime.get(instance.id).cursor, 1, 'the cursor records exactly where to resume');
  const { instance: finished } = runtime.run(instance.id, ctx);
  assert.strictEqual(finished.status, 'completed');
  assert.strictEqual(calls.length, 3, 'each node ran exactly once across the crash');
  await cleanup(dialect, dbPath);
}

async function testTimersWaitAndTimeout() {
  const { dialect, dbPath } = await setup();
  let clock = new Date('2026-07-21T09:00:00.000Z');
  const { org, wfRegistry, runtime, ctxFor } = bootstrap(dialect, { now: () => clock });
  defineSimpleWorkflow(wfRegistry, {
    ...SIMPLE_SPEC,
    nodes: [
      { id: 'w', type: 'wait', config: { minutes: 30 } },
      { id: 'n1', type: 'action', actionId: 'crm:touch', requiredPermission: 'crm:crm_lead:touch', config: {} },
    ],
  });
  seedRecord(dialect, { id: 'lead_1', companyId: org.companyA1 });
  const ctx = ctxFor(org.userManager);
  const instance = runtime.start({ definitionId: 'wf_lead', entity: 'crm_lead', recordId: 'lead_1', ctx });

  runtime.run(instance.id, ctx);
  assert.strictEqual(runtime.get(instance.id).status, 'waiting');
  assert.strictEqual(runtime.fireDueTimers().length, 0, 'the timer has not elapsed yet');

  clock = new Date('2026-07-21T09:31:00.000Z');
  const woken = runtime.fireDueTimers();
  assert.ok(woken.includes(instance.id), 'the timer survives a restart because it is a database row');
  assert.strictEqual(runtime.get(instance.id).status, 'running');
  const { instance: finished } = runtime.run(instance.id, ctx);
  assert.strictEqual(finished.status, 'completed');

  // timeout terminates an instance that overstays
  const timed = runtime.start({ definitionId: 'wf_lead', entity: 'crm_lead', recordId: 'lead_1', ctx, timeoutMinutes: 10 });
  clock = new Date('2026-07-21T10:00:00.000Z');
  runtime.fireDueTimers();
  const after = runtime.get(timed.id);
  assert.strictEqual(after.status, 'failed');
  assert.strictEqual(after.terminalResult.reason, 'TIMEOUT');
  await cleanup(dialect, dbPath);
}

async function testFailureRetryDeadLetterAndCompensation() {
  const { dialect, dbPath } = await setup();
  const { org, wfRegistry, runtime, ctxFor, calls } = bootstrap(dialect);
  defineSimpleWorkflow(wfRegistry, {
    ...SIMPLE_SPEC,
    nodes: [
      { id: 'n1', type: 'action', actionId: 'crm:touch', requiredPermission: 'crm:crm_lead:touch', compensateWith: 'crm:undo', config: {} },
      { id: 'n2', type: 'action', actionId: 'crm:fail', requiredPermission: 'crm:crm_lead:fail', config: {} },
    ],
  });
  seedRecord(dialect, { id: 'lead_1', companyId: org.companyA1 });
  const ctx = ctxFor(org.userManager);
  const instance = runtime.start({ definitionId: 'wf_lead', entity: 'crm_lead', recordId: 'lead_1', ctx });

  // retries with backoff, then dead-letters
  let state;
  for (let i = 0; i < 6; i++) {
    dialect.prepare('UPDATE workflow_instances SET next_attempt_at = NULL, status = ? WHERE id = ? AND status = ?').run('running', instance.id, 'waiting');
    state = runtime.run(instance.id, ctx).instance;
    if (state.status === 'dead') break;
  }
  assert.strictEqual(state.status, 'dead', 'after max attempts the instance is dead-lettered, not silently dropped');
  assert.ok(state.lastError.includes('action exploded'));
  assert.strictEqual(runtime.steps(instance.id).filter((s) => s.status === 'failed').length >= 1, true);
  // the completed step was compensated
  assert.ok(calls.some((c) => c.undo === 'lead_1'), 'the compensation boundary ran for the completed step');
  assert.strictEqual(runtime.steps(instance.id).some((s) => s.status === 'compensated'), true);
  await cleanup(dialect, dbPath);
}

async function testCancellationAndVersionPinning() {
  const { dialect, dbPath } = await setup();
  const { org, wfRegistry, runtime, ctxFor } = bootstrap(dialect);
  defineSimpleWorkflow(wfRegistry, { ...SIMPLE_SPEC, nodes: [{ id: 'w', type: 'wait', config: { minutes: 60 } }, ...SIMPLE_SPEC.nodes] });
  seedRecord(dialect, { id: 'lead_1', companyId: org.companyA1 });
  const ctx = ctxFor(org.userManager);
  const instance = runtime.start({ definitionId: 'wf_lead', entity: 'crm_lead', recordId: 'lead_1', ctx });
  runtime.run(instance.id, ctx);
  assert.strictEqual(runtime.get(instance.id).status, 'waiting');

  // deploy version 2 while an instance is in flight
  const { version: v2 } = wfRegistry.addVersion('wf_lead', { ...SIMPLE_SPEC, nodes: [SIMPLE_SPEC.nodes[0]] });
  wfRegistry.activate('wf_lead', v2);
  assert.strictEqual(runtime.get(instance.id).definitionVersion, 1, 'a running instance stays pinned to its version');
  assert.strictEqual(runtime.migrateRunningInstances('wf_lead', v2).reason, 'PINNED_BY_POLICY');

  // an explicit opt-in policy allows migration
  const { version: v3 } = wfRegistry.addVersion('wf_lead', { ...SIMPLE_SPEC, nodes: [SIMPLE_SPEC.nodes[0]], instanceMigrationPolicy: 'migrate_on_activate' });
  wfRegistry.activate('wf_lead', v3);
  assert.strictEqual(runtime.migrateRunningInstances('wf_lead', v3).migrated, 1);

  // cancellation is terminal and cancels pending timers
  runtime.cancel(instance.id, 'no longer needed', ctx);
  assert.strictEqual(runtime.get(instance.id).status, 'cancelled');
  assert.strictEqual(Number(dialect.prepare('SELECT COUNT(*) AS n FROM workflow_timers WHERE instance_id = ? AND cancelled_at IS NOT NULL').get(instance.id).n) >= 1, true);
  assert.strictEqual(runtime.fireDueTimers().length, 0);
  await cleanup(dialect, dbPath);
}

async function testWorkflowNodeIsPermissionChecked() {
  const { dialect, dbPath } = await setup();
  const { org, wfRegistry, runtime, ctxFor } = bootstrap(dialect);
  defineSimpleWorkflow(wfRegistry);
  seedRecord(dialect, { id: 'lead_1', companyId: org.companyA1 });
  // the clerk holds no crm grants
  const clerkCtx = ctxFor(org.userClerk);
  const instance = runtime.start({ definitionId: 'wf_lead', entity: 'crm_lead', recordId: 'lead_1', ctx: clerkCtx });
  const { instance: after } = runtime.run(instance.id, clerkCtx);
  assert.ok(['waiting', 'dead'].includes(after.status));
  assert.ok(String(after.lastError).includes('not authorized'), 'a workflow node gets no free pass');
  await cleanup(dialect, dbPath);
}

async function testNotifyGoesThroughOutbox() {
  const { dialect, dbPath } = await setup();
  const { org, wfRegistry, runtime, ctxFor } = bootstrap(dialect);
  defineSimpleWorkflow(wfRegistry, {
    ...SIMPLE_SPEC,
    nodes: [{ id: 'n', type: 'notify', config: { channel: 'inapp', to: 'u_manager', title: 'تنبيه' } }],
  });
  seedRecord(dialect, { id: 'lead_1', companyId: org.companyA1 });
  const ctx = ctxFor(org.userManager);
  const instance = runtime.start({ definitionId: 'wf_lead', entity: 'crm_lead', recordId: 'lead_1', ctx });
  runtime.run(instance.id, ctx);
  const outbox = dialect.prepare("SELECT * FROM platform_outbox WHERE event_type = 'workflow.notify'").all();
  assert.strictEqual(outbox.length, 1, 'a notification is queued, never sent inline');
  assert.strictEqual(outbox[0].status, 'pending');
  await cleanup(dialect, dbPath);
}

// --- 02.19 approval policies ------------------------------------------------

function seedApprovalRoles(roles, org) {
  for (const [id, name] of [['r_mgr', 'manager'], ['r_fin', 'finance'], ['r_cfo', 'cfo']]) {
    roles.createRole({ id, tenantId: org.tenantA, name });
    roles.setGrants(id, [{ permission: 'finance:invoice:approve', scope: 'company' }]);
  }
}

async function testSequentialChainAndSelfApproval() {
  const { dialect, dbPath } = await setup();
  const { org, approvals, roles } = bootstrap(dialect);
  seedApprovalRoles(roles, org);
  roles.assign({ userId: org.userManager, roleId: 'r_mgr', companyId: org.companyA1 });
  roles.assign({ userId: org.userOwner, roleId: 'r_fin', companyId: org.companyA1 });
  approvals.definePolicy({ id: 'ap1', moduleId: 'platform_kernel', entity: 'invoice', action: 'post', mode: 'sequential', chain: [['manager'], ['finance']] });

  const request = approvals.request({ entity: 'invoice', recordId: 'inv_1', action: 'post', payload: { total: 900 }, requesterId: org.userClerk, companyId: org.companyA1, tenantId: org.tenantA });
  assert.strictEqual(request.status, 'pending');
  assert.deepStrictEqual(request.currentRoles, ['manager']);

  // self-approval is refused
  assert.throws(() => approvals.decide({ requestId: request.id, deciderId: org.userClerk, decision: 'approve' }),
    (e) => e.code === 'APPROVAL_SELF_FORBIDDEN');
  // an actor without the step's role is refused
  assert.throws(() => approvals.decide({ requestId: request.id, deciderId: org.userOutsider, decision: 'approve' }),
    (e) => e.code === 'APPROVAL_NOT_AUTHORIZED');

  const afterStep1 = approvals.decide({ requestId: request.id, deciderId: org.userManager, decision: 'approve', comment: 'ok' });
  assert.strictEqual(afterStep1.status, 'pending');
  assert.deepStrictEqual(afterStep1.currentRoles, ['finance'], 'the chain advanced');

  const final = approvals.decide({ requestId: request.id, deciderId: org.userOwner, decision: 'approve' });
  assert.strictEqual(final.status, 'approved');
  const gate = approvals.isApproved({ requestId: request.id, entity: 'invoice', recordId: 'inv_1', action: 'post', companyId: org.companyA1, tenantId: org.tenantA, payload: { total: 900 } });
  assert.strictEqual(gate.approved, true);
  await cleanup(dialect, dbPath);
}

async function testDuplicateAndConcurrentDecisions() {
  const { dialect, dbPath } = await setup();
  const { org, approvals, roles } = bootstrap(dialect);
  seedApprovalRoles(roles, org);
  roles.assign({ userId: org.userManager, roleId: 'r_mgr', companyId: org.companyA1 });
  roles.assign({ userId: org.userOwner, roleId: 'r_mgr', companyId: org.companyA1 });
  approvals.definePolicy({ id: 'ap1', moduleId: 'platform_kernel', entity: 'invoice', action: 'post', mode: 'any_one_of', chain: [['manager']] });
  const request = approvals.request({ entity: 'invoice', recordId: 'inv_1', action: 'post', requesterId: org.userClerk, companyId: org.companyA1 });

  approvals.decide({ requestId: request.id, deciderId: org.userManager, decision: 'approve' });
  // the same decider cannot decide twice
  assert.throws(() => approvals.decide({ requestId: request.id, deciderId: org.userManager, decision: 'approve' }),
    (e) => e.code === 'APPROVAL_ALREADY_DECIDED');
  // a second approver racing on an already-completed request is refused
  assert.throws(() => approvals.decide({ requestId: request.id, deciderId: org.userOwner, decision: 'approve' }),
    (e) => e.code === 'APPROVAL_ALREADY_DECIDED');
  assert.strictEqual(Number(dialect.prepare('SELECT COUNT(*) AS n FROM approval_decisions WHERE request_id = ?').get(request.id).n), 1);
  await cleanup(dialect, dbPath);
}

async function testQuorumBoundary() {
  const { dialect, dbPath } = await setup();
  const { org, approvals, roles } = bootstrap(dialect);
  seedApprovalRoles(roles, org);
  for (const u of [org.userManager, org.userOwner, org.userOutsider]) {
    roles.assign({ userId: u, roleId: 'r_mgr', companyId: u === org.userOutsider ? org.companyA2 : org.companyA1 });
  }
  approvals.definePolicy({ id: 'ap1', moduleId: 'platform_kernel', entity: 'invoice', action: 'post', mode: 'quorum', quorum: 2, chain: [['manager']] });
  const request = approvals.request({ entity: 'invoice', recordId: 'inv_1', action: 'post', requesterId: org.userClerk, companyId: org.companyA1 });

  const one = approvals.decide({ requestId: request.id, deciderId: org.userManager, decision: 'approve' });
  assert.strictEqual(one.status, 'pending', 'one approval is below the quorum');
  const two = approvals.decide({ requestId: request.id, deciderId: org.userOwner, decision: 'approve' });
  assert.strictEqual(two.status, 'approved', 'the quorum boundary completes the request');
  await cleanup(dialect, dbPath);
}

async function testRejectReturnResubmitAndPayloadBinding() {
  const { dialect, dbPath } = await setup();
  const { org, approvals, roles } = bootstrap(dialect);
  seedApprovalRoles(roles, org);
  roles.assign({ userId: org.userManager, roleId: 'r_mgr', companyId: org.companyA1 });
  approvals.definePolicy({ id: 'ap1', moduleId: 'platform_kernel', entity: 'invoice', action: 'post', mode: 'sequential', chain: [['manager']], allowReturn: true });

  const returned = approvals.request({ entity: 'invoice', recordId: 'inv_1', action: 'post', payload: { total: 100 }, requesterId: org.userClerk, companyId: org.companyA1 });
  const afterReturn = approvals.decide({ requestId: returned.id, deciderId: org.userManager, decision: 'return', comment: 'يرجى التصحيح' });
  assert.strictEqual(afterReturn.status, 'returned');

  const rejected = approvals.request({ entity: 'invoice', recordId: 'inv_2', action: 'post', requesterId: org.userClerk, companyId: org.companyA1 });
  assert.strictEqual(approvals.decide({ requestId: rejected.id, deciderId: org.userManager, decision: 'reject' }).status, 'rejected');

  const withdrawn = approvals.request({ entity: 'invoice', recordId: 'inv_3', action: 'post', requesterId: org.userClerk, companyId: org.companyA1 });
  assert.throws(() => approvals.decide({ requestId: withdrawn.id, deciderId: org.userManager, decision: 'withdraw' }), (e) => e.code === 'APPROVAL_WITHDRAW_FORBIDDEN');
  assert.strictEqual(approvals.decide({ requestId: withdrawn.id, deciderId: org.userClerk, decision: 'withdraw' }).status, 'withdrawn');

  // payload binding: an approval for one payload cannot cover a mutated one
  const approved = approvals.request({ entity: 'invoice', recordId: 'inv_4', action: 'post', payload: { total: 100 }, requesterId: org.userClerk, companyId: org.companyA1 });
  approvals.decide({ requestId: approved.id, deciderId: org.userManager, decision: 'approve' });
  assert.strictEqual(approvals.isApproved({ requestId: approved.id, entity: 'invoice', recordId: 'inv_4', action: 'post', companyId: org.companyA1, payload: { total: 100 } }).approved, true);
  const tampered = approvals.isApproved({ requestId: approved.id, entity: 'invoice', recordId: 'inv_4', action: 'post', companyId: org.companyA1, payload: { total: 999999 } });
  assert.strictEqual(tampered.approved, false);
  assert.strictEqual(tampered.reasonCode, 'APPROVAL_PAYLOAD_MISMATCH');
  // and it cannot be reused for another record or company
  assert.strictEqual(approvals.isApproved({ requestId: approved.id, entity: 'invoice', recordId: 'inv_9', action: 'post', companyId: org.companyA1 }).reasonCode, 'APPROVAL_SUBJECT_MISMATCH');
  assert.strictEqual(approvals.isApproved({ requestId: approved.id, entity: 'invoice', recordId: 'inv_4', action: 'post', companyId: org.companyB1 }).reasonCode, 'APPROVAL_COMPANY_MISMATCH');
  await cleanup(dialect, dbPath);
}

async function testAuthorityRevokedMidProcessAndThresholdEscalation() {
  const { dialect, dbPath } = await setup();
  const { org, approvals, roles } = bootstrap(dialect);
  seedApprovalRoles(roles, org);
  roles.assign({ userId: org.userManager, roleId: 'r_mgr', companyId: org.companyA1 });
  roles.assign({ userId: org.userOwner, roleId: 'r_cfo', companyId: org.companyA1 });
  approvals.definePolicy({
    id: 'ap1', moduleId: 'platform_kernel', entity: 'invoice', action: 'post', mode: 'sequential',
    chain: [['manager']], amountThreshold: 1000, escalateRole: 'cfo',
  });

  // under the threshold: one step
  const small = approvals.request({ entity: 'invoice', recordId: 'inv_s', action: 'post', amount: 500, requesterId: org.userClerk, companyId: org.companyA1 });
  assert.strictEqual(small.chain.length, 1);
  // over the threshold: the CFO step is appended
  const big = approvals.request({ entity: 'invoice', recordId: 'inv_b', action: 'post', amount: 5000, requesterId: org.userClerk, companyId: org.companyA1 });
  assert.strictEqual(big.chain.length, 2);

  // authority revoked mid-process: the manager loses the role before deciding
  roles.unassign(org.userManager, 'r_mgr');
  assert.throws(() => approvals.decide({ requestId: big.id, deciderId: org.userManager, decision: 'approve' }),
    (e) => e.code === 'APPROVAL_NOT_AUTHORIZED', 'authority is re-derived at decision time');

  // a policy edit does not change an in-flight request's resolved chain
  approvals.definePolicy({ id: 'ap1', moduleId: 'platform_kernel', entity: 'invoice', action: 'post', mode: 'sequential', chain: [['manager'], ['finance'], ['cfo']], amountThreshold: 1000, escalateRole: 'cfo' });
  assert.strictEqual(approvals.get(big.id).chain.length, 2, 'the in-flight chain is pinned');
  await cleanup(dialect, dbPath);
}

async function testDelegatedApprovalAndLineage() {
  const { dialect, dbPath } = await setup();
  const { org, approvals, roles, policyEngine, ctxFor } = bootstrap(dialect);
  seedApprovalRoles(roles, org);
  roles.assign({ userId: org.userManager, roleId: 'r_mgr', companyId: org.companyA1 });
  approvals.definePolicy({ id: 'ap1', moduleId: 'platform_kernel', entity: 'invoice', action: 'post', mode: 'sequential', chain: [['manager']] });
  const request = approvals.request({ entity: 'invoice', recordId: 'inv_1', action: 'post', requesterId: org.userClerk, companyId: org.companyA1 });

  // the owner has no manager role, so cannot decide
  assert.throws(() => approvals.decide({ requestId: request.id, deciderId: org.userOwner, decision: 'approve' }), (e) => e.code === 'APPROVAL_NOT_AUTHORIZED');

  policyEngine.delegate({
    fromUserId: org.userManager, toUserId: org.userOwner, permissions: ['finance:invoice:approve'],
    companyId: org.companyA1, validFrom: '2026-01-01T00:00:00.000Z', validTo: '2027-01-01T00:00:00.000Z',
  }, org.userManager, ctxFor(org.userManager));

  const decided = approvals.decide({ requestId: request.id, deciderId: org.userOwner, decision: 'approve' });
  assert.strictEqual(decided.status, 'approved');
  const decision = decided.decisions[0];
  assert.strictEqual(decision.decider_id, org.userOwner);
  assert.strictEqual(decision.on_behalf_of, org.userManager, 'the audit lineage records who delegated');
  assert.ok(decision.delegation_id);
  await cleanup(dialect, dbPath);
}

async function testEscalationOnSlaBreach() {
  const { dialect, dbPath } = await setup();
  let clock = new Date('2026-07-21T09:00:00.000Z'); // a Tuesday, inside the default shift
  const { org, approvals, roles } = bootstrap(dialect, { now: () => clock });
  seedApprovalRoles(roles, org);
  roles.assign({ userId: org.userManager, roleId: 'r_mgr', companyId: org.companyA1 });
  roles.assign({ userId: org.userOwner, roleId: 'r_cfo', companyId: org.companyA1 });
  approvals.definePolicy({
    id: 'ap1', moduleId: 'platform_kernel', entity: 'invoice', action: 'post', mode: 'sequential',
    chain: [['manager']], escalateRole: 'cfo', escalationTimeoutMinutes: 60, calendarId: 'cal_default',
  });
  const request = approvals.request({ entity: 'invoice', recordId: 'inv_1', action: 'post', requesterId: org.userClerk, companyId: org.companyA1 });
  assert.strictEqual(approvals.escalateOverdue().length, 0);

  clock = new Date('2026-07-21T11:00:00.000Z');
  const escalated = approvals.escalateOverdue();
  assert.ok(escalated.includes(request.id));
  const after = approvals.get(request.id);
  assert.strictEqual(after.escalated, true);
  assert.deepStrictEqual(after.currentRoles, ['cfo']);
  assert.strictEqual(after.escalatedFromRole, 'manager');
  // now the CFO can decide and the manager cannot
  assert.throws(() => approvals.decide({ requestId: request.id, deciderId: org.userManager, decision: 'approve' }), (e) => e.code === 'APPROVAL_NOT_AUTHORIZED');
  assert.strictEqual(approvals.decide({ requestId: request.id, deciderId: org.userOwner, decision: 'approve' }).status, 'approved');
  await cleanup(dialect, dbPath);
}

// --- 02.20 worklists --------------------------------------------------------

async function testWorklistBoxesAndScope() {
  const { dialect, dbPath } = await setup();
  const { org, approvals, roles, ctxFor } = bootstrap(dialect);
  seedApprovalRoles(roles, org);
  roles.assign({ userId: org.userManager, roleId: 'r_mgr', companyId: org.companyA1 });
  approvals.definePolicy({ id: 'ap1', moduleId: 'platform_kernel', entity: 'invoice', action: 'post', mode: 'sequential', chain: [['manager']] });

  const mine = approvals.request({ entity: 'invoice', recordId: 'inv_1', action: 'post', requesterId: org.userClerk, companyId: org.companyA1, cc: [org.userOwner] });
  approvals.request({ entity: 'invoice', recordId: 'inv_2', action: 'post', requesterId: org.userOwner, companyId: org.companyA1 });
  // a request in ANOTHER company the clerk is not a member of
  approvals.request({ entity: 'invoice', recordId: 'inv_3', action: 'post', requesterId: org.userOutsider, companyId: org.companyA2 });

  const clerkCtx = ctxFor(org.userClerk);
  assert.deepStrictEqual(approvals.worklist('my', clerkCtx).map((r) => r.recordId), ['inv_1']);
  assert.strictEqual(approvals.worklist('todo', clerkCtx).length, 0, 'the clerk holds no approver role');

  const mgrCtx = ctxFor(org.userManager);
  const todo = approvals.worklist('todo', mgrCtx).map((r) => r.recordId).sort();
  assert.deepStrictEqual(todo, ['inv_1', 'inv_2'], 'both in-company requests await the manager');
  assert.ok(!todo.includes('inv_3'), 'a request in a non-member company never appears');

  const ownerCtx = ctxFor(org.userOwner);
  assert.deepStrictEqual(approvals.worklist('cc', ownerCtx).map((r) => r.recordId), ['inv_1']);

  approvals.decide({ requestId: mine.id, deciderId: org.userManager, decision: 'approve' });
  assert.deepStrictEqual(approvals.worklist('done', mgrCtx).map((r) => r.recordId), ['inv_1']);

  const counts = approvals.counts(mgrCtx);
  assert.strictEqual(Object.keys(counts).length, BOXES.length);
  assert.strictEqual(counts.todo, 1);
  assert.strictEqual(counts.done, 1);
  await cleanup(dialect, dbPath);
}

async function testDelegatedBoxIsDistinctFromTodo() {
  const { dialect, dbPath } = await setup();
  const { org, approvals, roles, policyEngine, ctxFor } = bootstrap(dialect);
  seedApprovalRoles(roles, org);
  roles.assign({ userId: org.userManager, roleId: 'r_mgr', companyId: org.companyA1 });
  approvals.definePolicy({ id: 'ap1', moduleId: 'platform_kernel', entity: 'invoice', action: 'post', mode: 'sequential', chain: [['manager']] });
  approvals.request({ entity: 'invoice', recordId: 'inv_1', action: 'post', requesterId: org.userClerk, companyId: org.companyA1 });
  policyEngine.delegate({
    fromUserId: org.userManager, toUserId: org.userOwner, permissions: ['finance:invoice:approve'],
    companyId: org.companyA1, validFrom: '2026-01-01T00:00:00.000Z', validTo: '2027-01-01T00:00:00.000Z',
  }, org.userManager, ctxFor(org.userManager));

  const ownerCtx = ctxFor(org.userOwner);
  assert.strictEqual(approvals.worklist('todo', ownerCtx).length, 0, 'todo is own-role only');
  assert.deepStrictEqual(approvals.worklist('delegated', ownerCtx).map((r) => r.recordId), ['inv_1']);
  assert.throws(() => approvals.worklist('nonsense', ownerCtx), (e) => e.code === 'WORKLIST_BOX_INVALID');
  await cleanup(dialect, dbPath);
}

async function testBulkDecisionAtomicity() {
  const { dialect, dbPath } = await setup();
  const { org, approvals, roles } = bootstrap(dialect);
  seedApprovalRoles(roles, org);
  roles.assign({ userId: org.userManager, roleId: 'r_mgr', companyId: org.companyA1 });
  approvals.definePolicy({ id: 'ap1', moduleId: 'platform_kernel', entity: 'invoice', action: 'post', mode: 'sequential', chain: [['manager']] });
  const a = approvals.request({ entity: 'invoice', recordId: 'inv_1', action: 'post', requesterId: org.userClerk, companyId: org.companyA1 });
  const b = approvals.request({ entity: 'invoice', recordId: 'inv_2', action: 'post', requesterId: org.userClerk, companyId: org.companyA1 });
  // one of the batch is the manager's OWN request, so maker≠checker fails it
  const c = approvals.request({ entity: 'invoice', recordId: 'inv_3', action: 'post', requesterId: org.userManager, companyId: org.companyA1 });

  assert.throws(() => approvals.bulkDecide({ requestIds: [a.id, b.id, c.id], deciderId: org.userManager, decision: 'approve' }),
    (e) => e.code === 'APPROVAL_BULK_FAILED');
  assert.strictEqual(approvals.get(a.id).status, 'pending', 'the batch was reverted');
  assert.strictEqual(approvals.get(b.id).status, 'pending');

  const ok = approvals.bulkDecide({ requestIds: [a.id, b.id], deciderId: org.userManager, decision: 'approve' });
  assert.strictEqual(ok.applied, 2);
  assert.strictEqual(approvals.get(a.id).status, 'approved');
  await cleanup(dialect, dbPath);
}

// --- 02.21 automation -------------------------------------------------------

async function testBoundaryCrossingPreventsReFiring() {
  const { dialect, dbPath } = await setup();
  const { org, automation, ctxFor, calls } = bootstrap(dialect);
  automation.defineRule({
    id: 'rule_won', moduleId: 'platform_kernel', name: 'on_won', entity: 'crm_lead',
    triggerKind: 'update', actionId: 'crm:touch',
    postcondition: { path: 'record.status', operator: 'eq', value: 'won' },
    triggerConfig: { requiredPermission: 'crm:crm_lead:touch' },
  });
  seedRecord(dialect, { id: 'lead_1', companyId: org.companyA1 });
  const ctx = ctxFor(org.userManager);

  // transition INTO won -> fires
  let r = automation.dispatch({ entity: 'crm_lead', recordId: 'lead_1', triggerKind: 'update', before: { status: 'new' }, after: { status: 'won' }, ctx });
  assert.strictEqual(r[0].outcome, 'executed');
  assert.strictEqual(calls.length, 1);

  // an unrelated edit while ALREADY won -> does not re-fire
  r = automation.dispatch({ entity: 'crm_lead', recordId: 'lead_1', triggerKind: 'update', before: { status: 'won' }, after: { status: 'won', note: 'x' }, ctx });
  assert.strictEqual(r[0].outcome, 'boundary_not_crossed');
  assert.strictEqual(calls.length, 1, 'the rule did not run a second time');

  // moving away and back -> fires again
  r = automation.dispatch({ entity: 'crm_lead', recordId: 'lead_1', triggerKind: 'update', before: { status: 'lost' }, after: { status: 'won' }, ctx });
  assert.strictEqual(r[0].outcome, 'executed');
  assert.strictEqual(calls.length, 2);
  await cleanup(dialect, dbPath);
}

async function testRecursionGuardRateLimitAndDuplicateEvent() {
  const { dialect, dbPath } = await setup();
  const { org, automation, ctxFor } = bootstrap(dialect);
  automation.defineRule({
    id: 'rule_loop', moduleId: 'platform_kernel', name: 'loop', entity: 'crm_lead',
    triggerKind: 'update', actionId: 'crm:touch', maxDepth: 3, rateLimitPerMinute: 2,
    triggerConfig: { requiredPermission: 'crm:crm_lead:touch' },
  });
  seedRecord(dialect, { id: 'lead_1', companyId: org.companyA1 });
  const ctx = ctxFor(org.userManager);

  // depth guard
  const deep = automation.dispatch({ entity: 'crm_lead', recordId: 'lead_1', triggerKind: 'update', after: {}, depth: 9, ctx });
  assert.strictEqual(deep[0].outcome, 'loop_blocked');

  // rate limit after 2 executions in the window
  assert.strictEqual(automation.dispatch({ entity: 'crm_lead', recordId: 'lead_1', triggerKind: 'update', after: {}, ctx })[0].outcome, 'executed');
  assert.strictEqual(automation.dispatch({ entity: 'crm_lead', recordId: 'lead_1', triggerKind: 'update', after: {}, ctx })[0].outcome, 'executed');
  assert.strictEqual(automation.dispatch({ entity: 'crm_lead', recordId: 'lead_1', triggerKind: 'update', after: {}, ctx })[0].outcome, 'rate_limited');

  // duplicate event key is suppressed
  automation.setEnabled('rule_loop', true);
  dialect.prepare('DELETE FROM automation_runs').run();
  const first = automation.dispatch({ entity: 'crm_lead', recordId: 'lead_1', triggerKind: 'update', after: {}, eventKey: 'evt-77', ctx });
  const second = automation.dispatch({ entity: 'crm_lead', recordId: 'lead_1', triggerKind: 'update', after: {}, eventKey: 'evt-77', ctx });
  assert.strictEqual(first[0].outcome, 'executed');
  assert.strictEqual(second[0].outcome, 'skipped');
  assert.strictEqual(second[0].reason, 'DUPLICATE_EVENT');
  await cleanup(dialect, dbPath);
}

async function testAutomationCannotBypassGovernance() {
  const { dialect, dbPath } = await setup();
  const { org, automation, ctxFor, calls } = bootstrap(dialect);
  // a rule cannot target a frozen entity, ever
  assert.throws(() => automation.defineRule({ id: 'r_frozen', moduleId: 'platform_kernel', name: 'f', entity: 'employees', triggerKind: 'update', actionId: 'crm:touch' }),
    (e) => e.code === 'RULE_TARGETS_FROZEN_ENTITY');
  // a rule cannot name an unregistered action
  assert.throws(() => automation.defineRule({ id: 'r_ghost', moduleId: 'platform_kernel', name: 'g', entity: 'crm_lead', triggerKind: 'update', actionId: 'ghost:action' }),
    (e) => e.code === 'RULE_ACTION_NOT_REGISTERED');

  automation.defineRule({
    id: 'rule_p', moduleId: 'platform_kernel', name: 'p', entity: 'crm_lead',
    triggerKind: 'update', actionId: 'crm:touch', triggerConfig: { requiredPermission: 'crm:crm_lead:touch' },
  });
  seedRecord(dialect, { id: 'lead_1', companyId: org.companyA1 });

  // the clerk holds no crm grants, so the rule cannot act under that identity
  const denied = automation.dispatch({ entity: 'crm_lead', recordId: 'lead_1', triggerKind: 'update', after: {}, ctx: ctxFor(org.userClerk) });
  assert.strictEqual(denied[0].outcome, 'failed');
  assert.strictEqual(denied[0].reason, 'NO_GRANT');
  assert.strictEqual(calls.length, 0, 'nothing ran');

  // disabling the rule stops it entirely
  automation.setEnabled('rule_p', false);
  assert.strictEqual(automation.dispatch({ entity: 'crm_lead', recordId: 'lead_1', triggerKind: 'update', after: {}, ctx: ctxFor(org.userManager) }).length, 0);
  await cleanup(dialect, dbPath);
}

async function testAutomationDryRunAndCrossTenantIsolation() {
  const { dialect, dbPath } = await setup();
  const { org, automation, ctxFor, calls } = bootstrap(dialect);
  automation.defineRule({
    id: 'rule_d', moduleId: 'platform_kernel', name: 'd', entity: 'crm_lead',
    triggerKind: 'update', actionId: 'crm:touch', actionInput: { note: 'lead {{record.id}}' },
    companyId: org.companyA1, triggerConfig: { requiredPermission: 'crm:crm_lead:touch' },
  });
  seedRecord(dialect, { id: 'lead_1', companyId: org.companyA1 });
  const ctx = ctxFor(org.userManager);

  const explained = automation.explain('rule_d', { entity: 'crm_lead', recordId: 'lead_1', after: { id: 'lead_1' }, ctx });
  assert.strictEqual(explained.outcome, 'dry_run');
  assert.strictEqual(explained.would.actionId, 'crm:touch');
  assert.strictEqual(explained.would.input.note, 'lead lead_1', 'the dry run shows the interpolated input');
  assert.strictEqual(calls.length, 0, 'a dry run changes nothing');

  // a company-scoped rule does not fire for another company's context
  const otherCtx = ctxFor(org.userOwner, { companyId: org.companyA2 });
  assert.strictEqual(automation.dispatch({ entity: 'crm_lead', recordId: 'lead_1', triggerKind: 'update', after: {}, ctx: otherCtx }).length, 0);
  await cleanup(dialect, dbPath);
}

// --- 02.23 business calendars and SLA ----------------------------------------

async function testBusinessTimeArithmetic() {
  const { dialect, dbPath } = await setup();
  const { calendars } = bootstrap(dialect);
  const cal = calendars.get('cal_default'); // Sun–Thu 08:00–16:00 Asia/Baghdad (+3)

  // 2026-07-21 is a Tuesday. 09:00 local = 06:00Z.
  const start = new Date('2026-07-21T06:00:00.000Z');
  assert.strictEqual(calendars.isWorkingTime(cal, start), true);
  // 22:00 local is outside every shift
  assert.strictEqual(calendars.isWorkingTime(cal, new Date('2026-07-21T19:00:00.000Z')), false);

  // 4 business hours from 09:00 local -> 13:00 local
  const plus4h = calendars.addBusinessMinutes(cal, start, 240);
  assert.strictEqual(plus4h.toISOString(), '2026-07-21T10:00:00.000Z');

  // 10 business hours crosses a night: 09:00 Tue + 10h = 08:00 Wed + 3h = 11:00 Wed
  const plus10h = calendars.addBusinessMinutes(cal, start, 600);
  assert.strictEqual(plus10h.toISOString().slice(0, 10), '2026-07-22');

  // a Thursday afternoon start skips Friday AND Saturday (both non-working)
  const thursday = new Date('2026-07-23T12:00:00.000Z'); // 15:00 local Thu
  const afterWeekend = calendars.addBusinessMinutes(cal, thursday, 120);
  assert.strictEqual(afterWeekend.toISOString().slice(0, 10), '2026-07-26', 'Friday and Saturday are skipped');

  // business minutes between two instants counts only working time
  assert.strictEqual(calendars.businessMinutesBetween(cal, start, plus4h), 240);
  // Tue 15:00→16:00 local (60m) + Wed 08:00→09:00 local (60m). The 16 overnight
  // hours in between are not working time and must not be counted.
  const overnight = calendars.businessMinutesBetween(cal, new Date('2026-07-21T12:00:00.000Z'), new Date('2026-07-22T06:00:00.000Z'));
  assert.strictEqual(overnight, 120, 'the overnight gap is excluded, both working tails are counted');
  await cleanup(dialect, dbPath);
}

async function testHolidaysAndSplitShifts() {
  const { dialect, dbPath } = await setup();
  const { calendars } = bootstrap(dialect);
  const cal = calendars.create({
    id: 'cal_split', name: 'split', timezone: 'Asia/Baghdad',
    shifts: [
      { weekday: 0, startMinute: 8 * 60, endMinute: 12 * 60 },
      { weekday: 0, startMinute: 14 * 60, endMinute: 18 * 60 },
      { weekday: 1, startMinute: 8 * 60, endMinute: 16 * 60 },
      { weekday: 2, startMinute: 8 * 60, endMinute: 16 * 60 },
    ],
    holidays: [{ date: '2026-07-27', labelAr: 'عطلة رسمية' }],
  });
  // Sunday 2026-07-26, 11:00 local (08:00Z): 2 business hours must jump the
  // 12:00–14:00 midday break.
  const start = new Date('2026-07-26T08:00:00.000Z');
  const result = calendars.addBusinessMinutes(cal, start, 120);
  assert.strictEqual(result.toISOString(), '2026-07-26T12:00:00.000Z', 'the split-shift break is skipped');

  // Monday 2026-07-27 is a holiday, so work resumes Tuesday
  const mondayStart = new Date('2026-07-26T14:00:00.000Z'); // 17:00 local Sunday
  const afterHoliday = calendars.addBusinessMinutes(cal, mondayStart, 120);
  assert.strictEqual(afterHoliday.toISOString().slice(0, 10), '2026-07-28', 'the holiday is skipped');

  assert.throws(() => calendars.create({ id: 'bad', name: 'bad', shifts: [{ weekday: 0, startMinute: 600, endMinute: 300 }] }),
    (e) => e.code === 'CALENDAR_SHIFT_INVALID');
  assert.throws(() => calendars.create({ id: 'tz', name: 'tz', timezone: 'Mars/Olympus' }), (e) => e.code === 'CALENDAR_TZ_UNSUPPORTED');
  await cleanup(dialect, dbPath);
}

async function testSlaClockPauseResumeAndCalendarSnapshot() {
  const { dialect, dbPath } = await setup();
  let clock = new Date('2026-07-21T06:00:00.000Z'); // Tue 09:00 local
  const { calendars } = bootstrap(dialect, { now: () => clock });
  const slaClocks = createSlaClockService(dialect, { calendars, now: () => clock });

  const started = slaClocks.start({ subjectKind: 'approval', subjectId: 'apr_1', calendarId: 'cal_default', targetMinutes: 240 });
  assert.strictEqual(started.dueAt, '2026-07-21T10:00:00.000Z');
  assert.strictEqual(slaClocks.remaining(started.id), 240);

  clock = new Date('2026-07-21T07:00:00.000Z'); // one business hour later
  assert.strictEqual(slaClocks.remaining(started.id), 180);

  // pause requires a reason and freezes the clock
  assert.throws(() => slaClocks.pause(started.id), (e) => e.code === 'SLA_PAUSE_REASON_REQUIRED');
  slaClocks.pause(started.id, 'awaiting customer');
  clock = new Date('2026-07-21T09:00:00.000Z'); // two more business hours pass
  assert.strictEqual(slaClocks.remaining(started.id), 180, 'a paused clock does not tick');
  const resumed = slaClocks.resume(started.id);
  assert.strictEqual(resumed.pausedTotalMinutes, 120);
  assert.strictEqual(resumed.dueAt, '2026-07-21T12:00:00.000Z', 'the due date moved by the paused business minutes');

  // editing the calendar AFTER the clock started does not move it
  calendars.addHoliday('cal_default', '2026-07-21', 'عطلة مفاجئة');
  assert.strictEqual(slaClocks.get(started.id).dueAt, '2026-07-21T12:00:00.000Z', 'the snapshot protects an in-flight clock');

  // breach detection
  clock = new Date('2026-07-22T09:00:00.000Z');
  assert.ok(slaClocks.remaining(started.id) < 0, 'a passed due date reports negative remaining');
  assert.ok(slaClocks.overdue({ subjectKind: 'approval' }).some((c) => c.id === started.id));
  assert.strictEqual(slaClocks.stop(started.id).breached, true);
  assert.strictEqual(slaClocks.overdue().length, 0, 'a stopped clock leaves the overdue feed');
  await cleanup(dialect, dbPath);
}

async function testSlaSurvivesLongRunningRestart() {
  const { dialect, dbPath } = await setup();
  let clock = new Date('2026-07-21T06:00:00.000Z');
  const { calendars } = bootstrap(dialect, { now: () => clock });
  const first = createSlaClockService(dialect, { calendars, now: () => clock });
  const started = first.start({ subjectKind: 'ticket', subjectId: 't1', calendarId: 'cal_default', targetMinutes: 480 });

  // "restart": a brand-new service instance over the same database
  clock = new Date('2026-07-22T06:00:00.000Z');
  const second = createSlaClockService(dialect, { calendars, now: () => clock });
  const reloaded = second.get(started.id);
  assert.strictEqual(reloaded.dueAt, started.dueAt, 'the clock is durable across a restart');
  assert.ok(second.overdue().some((c) => c.id === started.id));
  await cleanup(dialect, dbPath);
}

// --- runner -----------------------------------------------------------------

await run('Phase 02 / workflow, approvals, worklists, automation, SLA', [
  ['02.17 invalid definitions refused', testInvalidDefinitionsRefused],
  ['02.17 frozen-entity node refused', testFrozenEntityNodeRefused],
  ['02.17 version activation and immutability', testVersionActivationAndImmutability],
  ['02.17 existing canvas load/save compatibility', testCanvasCompatibility],
  ['02.18 instance runs to completion', testInstanceRunsToCompletion],
  ['02.18 idempotent start and duplicate dispatch', testIdempotentStartAndDuplicateDispatch],
  ['02.18 lease exclusivity and stale-lease recovery', testLeaseExclusivityAndStaleLeaseRecovery],
  ['02.18 worker crash resumes at the cursor', testWorkerCrashResumesAtCursor],
  ['02.18 durable timers: wait and timeout', testTimersWaitAndTimeout],
  ['02.18 failure, retry, dead-letter, compensation', testFailureRetryDeadLetterAndCompensation],
  ['02.18 cancellation and version pinning', testCancellationAndVersionPinning],
  ['02.18 workflow node is permission-checked', testWorkflowNodeIsPermissionChecked],
  ['02.18 notify leaves through the outbox', testNotifyGoesThroughOutbox],
  ['02.19 sequential chain and self-approval restriction', testSequentialChainAndSelfApproval],
  ['02.19 duplicate and concurrent decisions', testDuplicateAndConcurrentDecisions],
  ['02.19 quorum boundary', testQuorumBoundary],
  ['02.19 reject/return/withdraw and payload binding', testRejectReturnResubmitAndPayloadBinding],
  ['02.19 authority revoked mid-process, threshold escalation', testAuthorityRevokedMidProcessAndThresholdEscalation],
  ['02.19 delegated approval and audit lineage', testDelegatedApprovalAndLineage],
  ['02.19 escalation on SLA breach', testEscalationOnSlaBreach],
  ['02.20 worklist boxes and scope isolation', testWorklistBoxesAndScope],
  ['02.20 delegated box is distinct from todo', testDelegatedBoxIsDistinctFromTodo],
  ['02.20 bulk decision atomicity', testBulkDecisionAtomicity],
  ['02.21 boundary crossing prevents re-firing', testBoundaryCrossingPreventsReFiring],
  ['02.21 recursion guard, rate limit, duplicate event', testRecursionGuardRateLimitAndDuplicateEvent],
  ['02.21 automation cannot bypass governance', testAutomationCannotBypassGovernance],
  ['02.21 dry run and cross-scope isolation', testAutomationDryRunAndCrossTenantIsolation],
  ['02.23 business-time arithmetic', testBusinessTimeArithmetic],
  ['02.23 holidays and split shifts', testHolidaysAndSplitShifts],
  ['02.23 SLA pause/resume and calendar snapshot', testSlaClockPauseResumeAndCalendarSnapshot],
  ['02.23 SLA survives a restart', testSlaSurvivesLongRunningRestart],
]);
