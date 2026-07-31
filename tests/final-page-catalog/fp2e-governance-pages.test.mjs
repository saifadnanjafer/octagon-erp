// tests/final-page-catalog/fp2e-governance-pages.test.mjs
//
// Tests for the FP-2E Control Plane pages:
//   authority_governance, workflow_studio, approval_policy_studio,
//   automation_rules.
//
// Each page is a governed READ projection over the governance namespaces wired
// in 0c3c005. Fixtures are seeded through the REAL engines and ActionExecutor
// (never direct table writes) against disposable databases.

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
import { registerGovernanceActions } from '../../platform/domains/governance-actions.mjs';
import { handleGovernanceQuery } from '../../platform/api/governance.mjs';

const COMPANY = 'company-alpha';
const USER = 'user-fp2e';

function tmpPath(name) {
  return path.join(os.tmpdir(), `octagon-fp2e-${name}-${Date.now()}-${process.pid}.db`);
}

async function setup(name) {
  const dbPath = tmpPath(name);
  await freshInstall({ dbPath });
  const db = openMigrationDatabase(dbPath);
  const workflowRegistry = createWorkflowRegistry(db, {});
  const workflowRuntime = createWorkflowRuntime(db, {});
  const policyEngine = createPolicyEngine(db, {});
  const approvalEngine = createApprovalEngine(db, { policyEngine });
  const automationEngine = createAutomationEngine(db, {});
  const engines = { workflowRegistry, workflowRuntime, policyEngine, approvalEngine, automationEngine };
  const executor = createActionExecutor(db);
  registerGovernanceActions(executor, engines);
  const ctx = { companyId: COMPANY, userId: USER, branchId: null };
  return { db, dbPath, engines, executor, ctx };
}

function seedUser(db, id, tenantId = 'default') {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO identity_users (id, tenant_id, login, name, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?)
  `).run(id, tenantId, id, id, now, now);
}

function query(env, namespace, resource, queryParams = {}, ctx = env.ctx) {
  return handleGovernanceQuery({
    dialect: env.db, ctx, deps: { ...env.engines, evaluator: null },
    namespace, resource, query: queryParams,
  });
}

function cleanup(env) {
  try { env.db.close(); } catch (_) {}
  for (const suffix of ['', '-wal', '-shm']) {
    try { if (fs.existsSync(env.dbPath + suffix)) fs.unlinkSync(env.dbPath + suffix); } catch (_) {}
  }
}

test('1. workflow studio: a definition created via the real executor is served with its active version', async () => {
  const env = await setup('wf-def');
  try {
    const def = env.executor.execute('workflow:define', {
      name: 'PR Approval', entity: 'purchase_requisition', idempotency_key: 'fp2e-wfdef-1',
    }, env.ctx);
    env.executor.execute('workflow:version:add', {
      definition_id: def.id, initial_state: 'draft',
      states: [{ id: 'draft', transitions: [] }, { id: 'done', terminal: true }],
      idempotency_key: 'fp2e-wfver-1',
    }, env.ctx);
    env.executor.execute('workflow:activate', { definition_id: def.id, version: 1, idempotency_key: 'fp2e-wfact-1' }, env.ctx);

    const res = query(env, 'workflow', 'definitions');
    const row = res.data.find((d) => d.id === def.id);
    assert.ok(row, 'definition missing from workflow/definitions');
    assert.equal(row.active_version, 1);
    assert.equal(row.status, 'active');
    assert.equal(row.module_id, 'platform_kernel', 'governance records must own a valid module id');
  } finally {
    cleanup(env);
  }
});

test('2. workflow studio: a started instance is served by workflow/instances', async () => {
  const env = await setup('wf-inst');
  try {
    const def = env.executor.execute('workflow:define', {
      name: 'Simple', entity: 'purchase_requisition', idempotency_key: 'fp2e-wfdef-2',
    }, env.ctx);
    env.executor.execute('workflow:version:add', {
      definition_id: def.id, initial_state: 'draft',
      states: [{ id: 'draft', transitions: [] }],
      idempotency_key: 'fp2e-wfver-2',
    }, env.ctx);
    env.executor.execute('workflow:activate', { definition_id: def.id, version: 1, idempotency_key: 'fp2e-wfact-2' }, env.ctx);
    const inst = env.executor.execute('workflow:instance:start', {
      definition_id: def.id, entity: 'purchase_requisition', record_id: 'pr-fp2e', idempotency_key: 'fp2e-wfinst-1',
    }, env.ctx);

    const res = query(env, 'workflow', 'instances', { definition_id: def.id });
    assert.ok(res.data.some((i) => i.id === inst.id), 'started instance missing from workflow/instances');
  } finally {
    cleanup(env);
  }
});

test('3. approval policy studio: a defined policy is served with its real mode/threshold fields', async () => {
  const env = await setup('ap-pol');
  try {
    env.executor.execute('approval:policy:define', {
      entity: 'purchase_requisition', action: 'approve', chain: ['workshop.manager'],
      mode: 'sequential', idempotency_key: 'fp2e-apol-1',
    }, env.ctx);

    const res = query(env, 'approvals', 'policies');
    assert.equal(res.data.length, 1);
    const row = res.data[0];
    assert.equal(row.entity, 'purchase_requisition');
    assert.equal(row.mode, 'sequential');
    assert.equal(row.module_id, 'platform_kernel');

    const counts = query(env, 'approvals', 'counts');
    assert.ok(counts.data && typeof counts.data === 'object', 'counts must be an object for the KPI strip');
  } finally {
    cleanup(env);
  }
});

test('4. automation rules: a defined rule is served with parsed trigger config and an honest empty run log', async () => {
  const env = await setup('auto-rule');
  try {
    env.engines.automationEngine.actions = { get: (id) => (id === 'workflow:define' ? {} : null) };
    const rule = env.executor.execute('automation:rule:define', {
      name: 'notify_on_pr', entity: 'purchase_requisition', trigger_kind: 'create',
      action_id: 'workflow:define', idempotency_key: 'fp2e-rule-1',
    }, env.ctx);

    const res = query(env, 'automation', 'rules');
    const row = res.data.find((r) => r.id === rule.id);
    assert.ok(row, 'rule missing from automation/rules');
    assert.ok(row.trigger_config && typeof row.trigger_config === 'object', 'trigger_config must be parsed, not a string');
    assert.equal(row.module_id, 'platform_kernel');

    const runs = query(env, 'automation', 'runs', { rule_id: rule.id });
    assert.deepEqual(runs.data, [], 'a rule that never ran must have an empty run log, not an error');
  } finally {
    cleanup(env);
  }
});

test('5. authority governance: a delegation created with real users is served to the delegator', async () => {
  const env = await setup('del-serve');
  try {
    seedUser(env.db, USER);
    seedUser(env.db, 'delegate-fp2e');
    const delegation = env.executor.execute('policy:delegate', {
      to_user_id: 'delegate-fp2e', permissions: ['governance:approval:decide'],
      valid_to: new Date(Date.now() + 86400000).toISOString(), idempotency_key: 'fp2e-del-1',
    }, env.ctx);

    const res = query(env, 'policy', 'delegations');
    assert.ok(res.data.some((d) => d.id === delegation.id && d.to_user_id === 'delegate-fp2e'),
      'delegation missing from policy/delegations for the delegator');
  } finally {
    cleanup(env);
  }
});

test('6. authority governance: sod-rules and conflict-report come from the real policy engine', async () => {
  const env = await setup('sod');
  try {
    const sod = query(env, 'policy', 'sod-rules');
    assert.ok(Array.isArray(sod.data), 'sod-rules must be a real array (possibly empty)');

    const conflicts = query(env, 'policy', 'conflict-report');
    assert.ok(conflicts.data && typeof conflicts.data === 'object', 'conflict-report must be a real report object');

    const limits = query(env, 'policy', 'authority-limits');
    assert.deepEqual(limits.data, [], 'no authority limits on a fresh install — honest empty state');
  } finally {
    cleanup(env);
  }
});

test('7. fresh install: every FP-2E page resource is an honest empty array, not fabricated data', async () => {
  const env = await setup('empty-all');
  try {
    assert.deepEqual(query(env, 'workflow', 'definitions').data, []);
    assert.deepEqual(query(env, 'approvals', 'policies').data, []);
    assert.deepEqual(query(env, 'automation', 'rules').data, []);
    assert.deepEqual(query(env, 'policy', 'authority-limits').data, []);
  } finally {
    cleanup(env);
  }
});
