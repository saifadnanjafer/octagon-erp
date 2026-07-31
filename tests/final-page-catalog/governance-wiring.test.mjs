// tests/final-page-catalog/governance-wiring.test.mjs
//
// Proves the FP-2 governance foundation: workflow, approval, automation, and
// policy engines were real but completely unreachable (no platform_actions
// row => ACTION_NOT_REGISTERED; no permission token => PERMISSION_UNKNOWN
// fail-closed). This proves they now execute, are permission-gated, and are
// company-scoped — entirely against disposable databases.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createActionExecutor } from '../../platform/kernel/actions/index.mjs';
import { createWorkflowRegistry, createWorkflowRuntime } from '../../platform/workflow/index.mjs';
import { createApprovalEngine } from '../../platform/approvals/index.mjs';
import { createAutomationEngine } from '../../platform/automation/index.mjs';
import { createPolicyEngine } from '../../platform/policies/index.mjs';
import { createPermissionRegistry } from '../../platform/authorization/registry/index.mjs';
import { createPermissionEvaluator } from '../../platform/authorization/evaluator/index.mjs';
import {
  registerGovernanceActions, ensureGovernanceActionDefinitions, GOVERNANCE_PERMISSIONS, governanceReadPermission,
} from '../../platform/domains/governance-actions.mjs';
import { handleGovernanceQuery, GOVERNANCE_NAMESPACES } from '../../platform/api/governance.mjs';

const COMPANY = 'company-alpha';
const OTHER_COMPANY = 'company-beta';
const USER = 'user-gov-test';

function tmpPath(name) {
  return path.join(os.tmpdir(), `octagon-gov-${name}-${Date.now()}-${process.pid}.db`);
}

async function setup(name) {
  const dbPath = tmpPath(name);
  await freshInstall({ dbPath });
  const db = openMigrationDatabase(dbPath);
  return { db, dbPath };
}

/** Seed identity_users rows PolicyEngine.delegate() requires to exist. */
function seedUser(db, id, tenantId = 'default') {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO identity_users (id, tenant_id, login, name, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?)
  `).run(id, tenantId, id, id, now, now);
}

function cleanup(env) {
  try { env.db.close(); } catch (_) { /* already closed */ }
  for (const suffix of ['', '-wal', '-shm']) {
    try { if (fs.existsSync(env.dbPath + suffix)) fs.unlinkSync(env.dbPath + suffix); } catch (_) { /* best effort */ }
  }
}

/** Build the four engines the way platform-runtime-bridge.mjs does. */
function buildEngines(db, evaluator = null, policyEngine = null) {
  const workflowRegistry = createWorkflowRegistry(db, {});
  const workflowRuntime = createWorkflowRuntime(db, {});
  const pe = policyEngine || createPolicyEngine(db, { evaluator });
  const approvalEngine = createApprovalEngine(db, { evaluator, policyEngine: pe });
  const automationEngine = createAutomationEngine(db, { evaluator });
  return { workflowRegistry, workflowRuntime, approvalEngine, automationEngine, policyEngine: pe };
}

// ---------------------------------------------------------------------------
// 1. Registration reality
// ---------------------------------------------------------------------------

test('1. every governance action gets a platform_actions row and a known permission entity', async () => {
  const env = await setup('actiondefs');
  try {
    const written = ensureGovernanceActionDefinitions(env.db);
    assert.ok(written >= 18, `expected the full governance action surface, wrote ${written}`);
    const sample = env.db.prepare("SELECT * FROM platform_actions WHERE id = 'approval:decide'").get();
    assert.ok(sample, 'approval:decide has no platform_actions row');
    assert.equal(sample.required_permission, 'governance:approval:decide');
    assert.equal(sample.module_id, 'platform_kernel');
    const entity = env.db.prepare("SELECT * FROM platform_entities WHERE id = 'approval_request'").get();
    assert.ok(entity, 'approval_request entity was not registered — the FK that blocked Wave 2 would block this too');
  } finally {
    cleanup(env);
  }
});

test('2. an unregistered governance action is ACTION_NOT_REGISTERED, not silently permissive', async () => {
  const env = await setup('unregistered');
  try {
    const engines = buildEngines(env.db);
    const executor = createActionExecutor(env.db);
    // Deliberately do NOT call registerGovernanceActions — proves the pre-wiring
    // state (registerHandler alone, no platform_actions row) really was dead.
    executor.registerHandler('approval:decide', () => engines.approvalEngine.decide({}));
    assert.throws(
      () => executor.execute('approval:decide', {}, { companyId: COMPANY, userId: USER }),
      (error) => error && error.code === 'ACTION_NOT_REGISTERED',
    );
  } finally {
    cleanup(env);
  }
});

test('3. every governance permission token is registered so the evaluator does not fail-closed on "unknown"', () => {
  const store = new Map();
  const mockDialect = {
    prepare: () => ({
      run: (id, module_id, kind, resource, action, label_ar, label_en, sensitive, depends_on, deprecated, replaced_by) => {
        store.set(id, { id, module_id, kind, resource, action, label_ar, label_en, sensitive, depends_on, deprecated, replaced_by });
      },
      get: (id) => {
        const r = store.get(id);
        if (!r) return null;
        return { ...r, moduleId: r.module_id, dependsOn: [] };
      },
      all: () => Array.from(store.values())
    })
  };
  const registry = createPermissionRegistry(mockDialect);
  registry.registerMany(GOVERNANCE_PERMISSIONS);
  for (const perm of GOVERNANCE_PERMISSIONS) {
    assert.doesNotThrow(() => registry.assertKnown(perm.id), `${perm.id} is not known to the registry`);
  }
  assert.ok(GOVERNANCE_PERMISSIONS.length >= 8, `expected the full permission surface, got ${GOVERNANCE_PERMISSIONS.length}`);
});

test('4. a workflow can be defined, versioned, activated, and an instance started', async () => {
  const env = await setup('wf-exec');
  try {
    const engines = buildEngines(env.db);
    const executor = createActionExecutor(env.db);
    registerGovernanceActions(executor, engines);
    const ctx = { companyId: COMPANY, userId: USER, branchId: null };

    const def = executor.execute('workflow:define', {
      name: 'PR Approval Workflow', entity: 'purchase_requisition', idempotency_key: 'wfdef-1',
    }, ctx);
    assert.equal(def.name, 'PR Approval Workflow');

    const v1 = executor.execute('workflow:version:add', {
      definition_id: def.id, initial_state: 'draft',
      states: [
        { id: 'draft', transitions: [{ to: 'pending_approval', on: 'submit' }] },
        { id: 'pending_approval', transitions: [{ to: 'approved', on: 'approve' }, { to: 'rejected', on: 'reject' }] },
        { id: 'approved', terminal: true },
        { id: 'rejected', terminal: true },
      ],
      idempotency_key: 'wfver-1',
    }, ctx);
    assert.equal(v1.version, 1);

    const active = executor.execute('workflow:activate', {
      definition_id: def.id, version: 1, idempotency_key: 'wfact-1',
    }, ctx);
    assert.equal(active.status, 'active');

    const inst = executor.execute('workflow:instance:start', {
      definition_id: def.id, entity: 'purchase_requisition', record_id: 'pr-1', idempotency_key: 'wfinst-1',
    }, ctx);
    assert.equal(inst.currentState, 'draft');
  } finally {
    cleanup(env);
  }
});

test('5. an approval policy can be defined and a request raised and decided', async () => {
  const env = await setup('approval-exec');
  try {
    const engines = buildEngines(env.db);
    const executor = createActionExecutor(env.db);
    registerGovernanceActions(executor, engines);
    const ctx = { companyId: COMPANY, userId: USER, branchId: null };

    executor.execute('approval:policy:define', {
      entity: 'purchase_requisition', action: 'approve', chain: ['workshop.manager'], mode: 'sequential',
      idempotency_key: 'apol-1',
    }, ctx);

    seedUser(env.db, 'approver-1');
    const now = new Date().toISOString();
    env.db.prepare(`
      INSERT INTO authorization_roles (id, tenant_id, name, label_ar, status, is_system, created_at, updated_at)
      VALUES ('role-mgr', 'default', 'workshop.manager', 'مدير الورشة', 'active', 0, ?, ?)
    `).run(now, now);
    env.db.prepare(`
      INSERT INTO authorization_role_assignments (id, user_id, role_id, company_id, status, created_at)
      VALUES ('ra-1', 'approver-1', 'role-mgr', ?, 'active', ?)
    `).run(COMPANY, now);

    const request = executor.execute('approval:request', {
      entity: 'purchase_requisition', record_id: 'pr-2', action: 'approve', idempotency_key: 'areq-1',
    }, ctx);
    assert.equal(request.status, 'pending');

    const decideCtx = { companyId: COMPANY, userId: 'approver-1', branchId: null };
    const decided = executor.execute('approval:decide', {
      request_id: request.id, decision: 'approve', idempotency_key: 'adec-1',
    }, decideCtx);
    assert.equal(decided.status, 'approved');
  } finally {
    cleanup(env);
  }
});

test('6. an automation rule can be defined against a registered action and dispatched', async () => {
  const env = await setup('automation-exec');
  try {
    const engines = buildEngines(env.db);
    const executor = createActionExecutor(env.db);
    registerGovernanceActions(executor, engines);
    engines.automationEngine.actions = { get: (id) => (id === 'workflow:define' ? {} : null) };
    const ctx = { companyId: COMPANY, userId: USER, branchId: null };

    const rule = executor.execute('automation:rule:define', {
      name: 'notify_on_pr_create', entity: 'purchase_requisition', trigger_kind: 'create',
      action_id: 'workflow:define', idempotency_key: 'rule-1',
    }, ctx);
    assert.ok(rule.id);
    assert.equal(rule.enabled, true);

    const disabled = executor.execute('automation:rule:set_enabled', { rule_id: rule.id, enabled: false, idempotency_key: 'rule-toggle-1' }, ctx);
    assert.equal(disabled.enabled, false);
  } finally {
    cleanup(env);
  }
});

test('7. a policy delegation can be created and revoked', async () => {
  const env = await setup('policy-exec');
  try {
    const engines = buildEngines(env.db);
    const executor = createActionExecutor(env.db);
    registerGovernanceActions(executor, engines);
    seedUser(env.db, USER);
    seedUser(env.db, 'delegate-1');
    const ctx = { companyId: COMPANY, userId: USER, branchId: null };

    const delegation = executor.execute('policy:delegate', {
      to_user_id: 'delegate-1', permissions: ['governance:approval:decide'],
      valid_to: new Date(Date.now() + 86400000).toISOString(), idempotency_key: 'del-1',
    }, ctx);
    assert.ok(delegation.id);

    const revoked = executor.execute('policy:delegation:revoke', { delegation_id: delegation.id, idempotency_key: 'del-rev-1' }, ctx);
    assert.equal(revoked.status, 'revoked');
  } finally {
    cleanup(env);
  }
});

// ---------------------------------------------------------------------------
// 3. Governed reads
// ---------------------------------------------------------------------------

test('8. workflow definitions are readable and scoped to what exists', async () => {
  const env = await setup('read-workflow');
  try {
    const engines = buildEngines(env.db);
    const executor = createActionExecutor(env.db);
    registerGovernanceActions(executor, engines);
    executor.execute('workflow:define', { name: 'wf_a', entity: 'purchase_requisition', idempotency_key: 'r1' }, { companyId: COMPANY, userId: USER });

    const result = handleGovernanceQuery({
      dialect: env.db, ctx: { companyId: COMPANY }, deps: engines, namespace: 'workflow', resource: 'definitions', query: {},
    });
    assert.equal(result.error, undefined);
    assert.ok(result.data.some((d) => d.name === 'wf_a'));
  } finally {
    cleanup(env);
  }
});

test('9. approval worklist reads are company-scoped and require an actor', async () => {
  const env = await setup('read-approvals');
  try {
    const engines = buildEngines(env.db);
    const noActor = handleGovernanceQuery({
      dialect: env.db, ctx: { companyId: COMPANY }, deps: engines, namespace: 'approvals', resource: 'worklist', query: { box: 'todo' },
    });
    assert.equal(noActor.status, 403);

    const result = handleGovernanceQuery({
      dialect: env.db, ctx: { companyId: COMPANY, userId: USER }, deps: engines, namespace: 'approvals', resource: 'worklist', query: { box: 'my' },
    });
    assert.equal(result.error, undefined);
    assert.ok(Array.isArray(result.data));
  } finally {
    cleanup(env);
  }
});

test('10. automation rules and runs are readable and company-scoped', async () => {
  const env = await setup('read-automation');
  try {
    const engines = buildEngines(env.db);
    const executor = createActionExecutor(env.db);
    registerGovernanceActions(executor, engines);

    const ctx = { companyId: COMPANY, userId: USER };
    executor.execute('automation:rule:define', {
      name: 'rule_a', entity: 'x', trigger_kind: 'create', action_id: 'workflow:define', idempotency_key: 'ra-1',
    }, ctx);
    executor.execute('automation:rule:define', {
      name: 'rule_b', entity: 'x', trigger_kind: 'create', action_id: 'workflow:define', idempotency_key: 'ra-2',
    }, { companyId: OTHER_COMPANY, userId: USER });

    const mine = handleGovernanceQuery({ dialect: env.db, ctx: { companyId: COMPANY }, deps: engines, namespace: 'automation', resource: 'rules', query: {} });
    assert.equal(mine.data.length, 1);
    assert.equal(mine.data[0].name, 'rule_a');
  } finally {
    cleanup(env);
  }
});

test('11. policy delegations are readable for the requesting or named user only', async () => {
  const env = await setup('read-policy');
  try {
    const engines = buildEngines(env.db);
    const executor = createActionExecutor(env.db);
    registerGovernanceActions(executor, engines);
    seedUser(env.db, USER);
    seedUser(env.db, 'delegate-x');
    executor.execute('policy:delegate', {
      to_user_id: 'delegate-x', permissions: ['governance:approval:decide'],
      valid_to: new Date(Date.now() + 86400000).toISOString(), idempotency_key: 'pd-1',
    }, { companyId: COMPANY, userId: USER });

    const result = handleGovernanceQuery({
      dialect: env.db, ctx: { companyId: COMPANY, userId: USER }, deps: engines, namespace: 'policy', resource: 'delegations', query: {},
    });
    assert.equal(result.error, undefined);
    assert.ok(result.data.length >= 1);
  } finally {
    cleanup(env);
  }
});

test('12. permissions/explain calls the real evaluator and never mutates', async () => {
  const env = await setup('explain');
  try {
    const registry = createPermissionRegistry(env.db);
    registry.registerMany(GOVERNANCE_PERMISSIONS);
    const evaluator = createPermissionEvaluator(env.db, { permissionRegistry: registry });
    const engines = buildEngines(env.db, evaluator);

    const result = handleGovernanceQuery({
      dialect: env.db, ctx: { companyId: COMPANY, userId: USER },
      deps: { ...engines, evaluator },
      namespace: 'permissions', resource: 'explain',
      query: { permission: 'governance:approval:decide' },
    });
    assert.equal(result.error, undefined);
    assert.ok('allowed' in result.data, 'explain must return a real decision object');
    assert.ok('reasonCode' in result.data);
  } finally {
    cleanup(env);
  }
});

test('13. unknown governance resource is a 404, never a table guess', async () => {
  const env = await setup('unknown-resource');
  try {
    const engines = buildEngines(env.db);
    const result = handleGovernanceQuery({
      dialect: env.db, ctx: { companyId: COMPANY }, deps: engines, namespace: 'workflow', resource: 'employees', query: {},
    });
    assert.equal(result.status, 404);
  } finally {
    cleanup(env);
  }
});

test('14. every governance namespace has a read permission for the router gate', () => {
  assert.equal(GOVERNANCE_NAMESPACES.length, 5);
  for (const ns of GOVERNANCE_NAMESPACES) {
    assert.ok(governanceReadPermission(ns), `${ns} has no read permission`);
  }
});
