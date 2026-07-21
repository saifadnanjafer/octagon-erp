import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { openMigrationDatabase, freshInstall } from '../../database/migration-runner/index.mjs';
import { createActionRegistry, createActionExecutor, ActionError } from '../../platform/kernel/actions/index.mjs';
import { createDocumentLifecycle, DocumentLifecycleError } from '../../platform/governance/document-state/index.mjs';
import { createRepository } from '../../platform/data/repositories/index.mjs';

function tmpDb() {
  return path.join(os.tmpdir(), `octagon-actions-test-${Date.now()}.db`);
}

async function setup() {
  const dbPath = tmpDb();
  await freshInstall({ dbPath });
  const dialect = openMigrationDatabase(dbPath);
  return { dialect, dbPath };
}

async function cleanup(dialect, dbPath) {
  dialect.close();
  fs.unlinkSync(dbPath);
}

async function testLifecycleDefinitionRegistration() {
  const { dialect, dbPath } = await setup();
  const lifecycle = createDocumentLifecycle(dialect);
  const result = lifecycle.registerStateDefinition('approval_request', {
    states: ['draft', 'submitted', 'approved', 'cancelled'],
    initial: 'draft',
    transitions: [
      { from: 'draft', to: 'submitted', action: 'submit' },
      { from: 'submitted', to: 'approved', action: 'approve' },
      { from: 'submitted', to: 'cancelled', action: 'cancel' },
    ],
  }, 'test-actor');
  assert.strictEqual(result.initial, 'draft');
  const def = lifecycle.getStateDefinition('approval_request');
  assert.strictEqual(def.initial, 'draft');
  await cleanup(dialect, dbPath);
  console.log('PASS: lifecycleDefinitionRegistration');
}

async function testInvalidLifecycleRejected() {
  const { dialect, dbPath } = await setup();
  const lifecycle = createDocumentLifecycle(dialect);
  assert.throws(
    () => lifecycle.registerStateDefinition('bad', { states: ['a', 'b'], initial: 'c' }),
    DocumentLifecycleError
  );
  await cleanup(dialect, dbPath);
  console.log('PASS: invalidLifecycleRejected');
}

async function testLifecycleTransition() {
  const { dialect, dbPath } = await setup();
  const lifecycle = createDocumentLifecycle(dialect);
  lifecycle.registerStateDefinition('approval_request', {
    states: ['draft', 'submitted', 'approved'],
    initial: 'draft',
    transitions: [
      { from: 'draft', to: 'submitted', action: 'submit' },
      { from: 'submitted', to: 'approved', action: 'approve' },
    ],
  }, 'test-actor');

  dialect.prepare(`
    INSERT INTO x_records (entity, id, company_id, data, created_at, updated_at, created_by, removed, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)
  `).run('approval_request', 'req_1', 'c1', JSON.stringify({ status: 'draft' }), new Date().toISOString(), new Date().toISOString(), 'u1');
  dialect.prepare('INSERT INTO x_doc_states (entity, record_id, state, version) VALUES (?, ?, ?, ?)').run('approval_request', 'req_1', 'draft', 1);

  const ctx = { companyId: 'c1', userId: 'u1' };
  const t1 = lifecycle.transition('approval_request', 'req_1', 'submit', {}, ctx);
  assert.strictEqual(t1.to, 'submitted');
  assert.strictEqual(t1.version, 2);
  const t2 = lifecycle.transition('approval_request', 'req_1', 'approve', {}, ctx);
  assert.strictEqual(t2.to, 'approved');
  assert.strictEqual(t2.version, 3);
  await cleanup(dialect, dbPath);
  console.log('PASS: lifecycleTransition');
}

async function testIllegalTransitionRejected() {
  const { dialect, dbPath } = await setup();
  const lifecycle = createDocumentLifecycle(dialect);
  lifecycle.registerStateDefinition('approval_request', {
    states: ['draft', 'submitted'],
    initial: 'draft',
    transitions: [{ from: 'draft', to: 'submitted', action: 'submit' }],
  }, 'test-actor');
  dialect.prepare(`
    INSERT INTO x_records (entity, id, company_id, data, created_at, updated_at, created_by, removed, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)
  `).run('approval_request', 'req_1', 'c1', JSON.stringify({ status: 'draft' }), new Date().toISOString(), new Date().toISOString(), 'u1');
  dialect.prepare('INSERT INTO x_doc_states (entity, record_id, state, version) VALUES (?, ?, ?, ?)').run('approval_request', 'req_1', 'draft', 1);
  assert.throws(
    () => lifecycle.transition('approval_request', 'req_1', 'approve', {}, { companyId: 'c1', userId: 'u1' }),
    (err) => err instanceof DocumentLifecycleError && err.code === 'ILLEGAL_TRANSITION'
  );
  await cleanup(dialect, dbPath);
  console.log('PASS: illegalTransitionRejected');
}

async function testStaleVersionRejected() {
  const { dialect, dbPath } = await setup();
  const lifecycle = createDocumentLifecycle(dialect);
  lifecycle.registerStateDefinition('approval_request', {
    states: ['draft', 'submitted'],
    initial: 'draft',
    transitions: [{ from: 'draft', to: 'submitted', action: 'submit' }],
  }, 'test-actor');
  dialect.prepare(`
    INSERT INTO x_records (entity, id, company_id, data, created_at, updated_at, created_by, removed, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)
  `).run('approval_request', 'req_1', 'c1', JSON.stringify({ status: 'draft' }), new Date().toISOString(), new Date().toISOString(), 'u1');
  dialect.prepare('INSERT INTO x_doc_states (entity, record_id, state, version) VALUES (?, ?, ?, ?)').run('approval_request', 'req_1', 'draft', 1);
  assert.throws(
    () => lifecycle.transition('approval_request', 'req_1', 'submit', { version: 99 }, { companyId: 'c1', userId: 'u1' }),
    (err) => err instanceof DocumentLifecycleError && err.code === 'STALE_VERSION'
  );
  await cleanup(dialect, dbPath);
  console.log('PASS: staleVersionRejected');
}

async function testTerminalStateBlocksGenericUpdate() {
  const { dialect, dbPath } = await setup();
  const lifecycle = createDocumentLifecycle(dialect);
  lifecycle.registerStateDefinition('approval_request', {
    states: ['draft', { name: 'posted', terminal: true }],
    initial: 'draft',
    transitions: [{ from: 'draft', to: 'posted', action: 'post' }],
  }, 'test-actor');

  dialect.prepare(`
    INSERT INTO x_records (entity, id, company_id, data, created_at, updated_at, created_by, removed, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)
  `).run('approval_request', 'req_1', 'c1', JSON.stringify({ status: 'draft' }), new Date().toISOString(), new Date().toISOString(), 'u1');
  dialect.prepare('INSERT INTO x_doc_states (entity, record_id, state, version) VALUES (?, ?, ?, ?)').run('approval_request', 'req_1', 'draft', 1);

  lifecycle.transition('approval_request', 'req_1', 'post', {}, { companyId: 'c1', userId: 'u1' });
  assert.strictEqual(lifecycle.isTerminalState('approval_request', 'req_1'), true);

  dialect.prepare(`
    INSERT INTO platform_entities (
      id, module_id, storage_owner, primary_key, label_ar, label_en, fields, relations,
      scope, lifecycle_policy, query_policy, action_policy, customization_policy, history_policy, api_exposed, migration_owner, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'approval_request', 'platform_kernel', 'platform.data.repositories', 'id', 'طلب اعتماد', 'Approval Request',
    '{}', '{}', 'company', 'generic', 'scoped', 'registered', 'metadata', 'audit', 1, 'platform.kernel',
    new Date().toISOString(), new Date().toISOString()
  );
  const repo = createRepository(dialect, 'approval_request');
  assert.throws(
    () => repo.update('req_1', { name: 'X' }, { companyId: 'c1', userId: 'u1' }),
    /نهائية/
  );
  await cleanup(dialect, dbPath);
  console.log('PASS: terminalStateBlocksGenericUpdate');
}

async function testActionRegistryAndExecution() {
  const { dialect, dbPath } = await setup();
  const registry = createActionRegistry(dialect);
  registry.register({
    id: 'test_domain:ping',
    module_id: 'platform_kernel',
    entity_id: 'product_category',
    kind: 'domain',
    transaction_owner: 'platform.kernel',
    input_schema: { required: ['message'] },
  }, 'test-actor');
  const executor = createActionExecutor(dialect);
  executor.registerHandler('test_domain:ping', ({ input, ctx }) => ({ pong: input.message, actor: ctx.userId }));
  const result = executor.execute('test_domain:ping', { message: 'hello', idempotency_key: 'k1' }, { companyId: 'c1', userId: 'u1' });
  assert.strictEqual(result.pong, 'hello');
  await cleanup(dialect, dbPath);
  console.log('PASS: actionRegistryAndExecution');
}

async function testIdempotencyKey() {
  const { dialect, dbPath } = await setup();
  const registry = createActionRegistry(dialect);
  registry.register({
    id: 'test_domain:ping',
    module_id: 'platform_kernel',
    entity_id: 'product_category',
    kind: 'domain',
    transaction_owner: 'platform.kernel',
    input_schema: { required: ['message'] },
  }, 'test-actor');
  const executor = createActionExecutor(dialect);
  executor.registerHandler('test_domain:ping', ({ input, ctx }) => ({ pong: input.message, actor: ctx.userId }));
  const r1 = executor.execute('test_domain:ping', { message: 'hello', idempotency_key: 'k1' }, { companyId: 'c1', userId: 'u1' });
  const r2 = executor.execute('test_domain:ping', { message: 'hello', idempotency_key: 'k1' }, { companyId: 'c1', userId: 'u1' });
  assert.deepStrictEqual(r1, r2);
  assert.throws(
    () => executor.execute('test_domain:ping', { message: 'different', idempotency_key: 'k1' }, { companyId: 'c1', userId: 'u1' }),
    (err) => err instanceof ActionError && err.code === 'IDEMPOTENCY_MISMATCH'
  );
  await cleanup(dialect, dbPath);
  console.log('PASS: idempotencyKey');
}

async function testCrmLeadLifecycleAction() {
  const { dialect, dbPath } = await setup();
  const executor = createActionExecutor(dialect);
  const ctx = { companyId: 'c1', userId: 'u1' };
  const created = executor.execute('crm_lead:create', { data: { name: 'Big Corp' }, idempotency_key: 'create1' }, ctx);
  assert.strictEqual(created.status, 'draft');
  const submitted = executor.execute('crm_lead:submit', { record_id: created.record_id, idempotency_key: 'submit1' }, ctx);
  assert.strictEqual(submitted.to, 'submitted');
  const approved = executor.execute('crm_lead:approve', { record_id: created.record_id, idempotency_key: 'approve1' }, ctx);
  assert.strictEqual(approved.to, 'approved');
  const cancelled = executor.execute('crm_lead:cancel', { record_id: created.record_id, idempotency_key: 'cancel1' }, ctx);
  assert.strictEqual(cancelled.to, 'cancelled');
  await cleanup(dialect, dbPath);
  console.log('PASS: crmLeadLifecycleAction');
}

async function testReverseVsCancel() {
  const { dialect, dbPath } = await setup();
  const executor = createActionExecutor(dialect);
  const ctx = { companyId: 'c1', userId: 'u1' };
  const created = executor.execute('crm_lead:create', { data: { name: 'Reverse Test' }, idempotency_key: 'r1' }, ctx);
  executor.execute('crm_lead:submit', { record_id: created.record_id, idempotency_key: 'r2' }, ctx);
  executor.execute('crm_lead:approve', { record_id: created.record_id, idempotency_key: 'r3' }, ctx);
  const reversed = executor.execute('crm_lead:reverse_approval', { record_id: created.record_id, idempotency_key: 'r4' }, ctx);
  assert.strictEqual(reversed.to, 'draft');
  const cancelled = executor.execute('crm_lead:cancel', { record_id: created.record_id, idempotency_key: 'r5' }, ctx);
  assert.strictEqual(cancelled.to, 'cancelled');
  await cleanup(dialect, dbPath);
  console.log('PASS: reverseVsCancel');
}

async function testAmendPreservesLineage() {
  const { dialect, dbPath } = await setup();
  const executor = createActionExecutor(dialect);
  const ctx = { companyId: 'c1', userId: 'u1' };
  const created = executor.execute('crm_lead:create', { data: { name: 'Original' }, idempotency_key: 'a1' }, ctx);
  executor.execute('crm_lead:submit', { record_id: created.record_id, idempotency_key: 'a2' }, ctx);
  executor.execute('crm_lead:approve', { record_id: created.record_id, idempotency_key: 'a3' }, ctx);
  const amended = executor.execute('crm_lead:amend', { record_id: created.record_id, idempotency_key: 'a4' }, ctx);
  assert.ok(amended.record_id !== created.record_id);
  assert.strictEqual(amended.amended_from, created.record_id);
  const row = dialect.prepare('SELECT data FROM x_records WHERE entity = ? AND id = ?').get('crm_lead', amended.record_id);
  const data = JSON.parse(row.data);
  assert.strictEqual(data.amended_from, created.record_id);
  assert.strictEqual(data.status, 'draft');
  await cleanup(dialect, dbPath);
  console.log('PASS: amendPreservesLineage');
}

async function testActionAuditAndOutbox() {
  const { dialect, dbPath } = await setup();
  const executor = createActionExecutor(dialect);
  const ctx = { companyId: 'c1', userId: 'u1' };
  const created = executor.execute('crm_lead:create', { data: { name: 'Audit' }, idempotency_key: 'audit1' }, ctx);
  const audit = dialect.prepare('SELECT COUNT(*) AS n FROM platform_audit_log WHERE action = ? AND resource_id = ?').get('action.execute.crm_lead:create', created.record_id).n;
  assert.ok(audit >= 1);
  const outbox = dialect.prepare('SELECT COUNT(*) AS n FROM platform_outbox WHERE aggregate_id = ?').get(`crm_lead:${created.record_id}`).n;
  assert.ok(outbox >= 1);
  await cleanup(dialect, dbPath);
  console.log('PASS: actionAuditAndOutbox');
}

async function testPreconditionDenial() {
  const { dialect, dbPath } = await setup();
  const registry = createActionRegistry(dialect);
  registry.register({
    id: 'test_domain:needs_record',
    module_id: 'platform_kernel',
    entity_id: 'product_category',
    kind: 'lifecycle_transition',
    transaction_owner: 'platform.kernel',
    preconditions: ['record_exists'],
  }, 'test-actor');
  const executor = createActionExecutor(dialect);
  assert.throws(
    () => executor.execute('test_domain:needs_record', { record_id: 'missing', idempotency_key: 'pre1' }, { companyId: 'c1', userId: 'u1' }),
    (err) => err instanceof ActionError && err.code === 'PRECONDITION_FAILED'
  );
  await cleanup(dialect, dbPath);
  console.log('PASS: preconditionDenial');
}

async function main() {
  await testLifecycleDefinitionRegistration();
  await testInvalidLifecycleRejected();
  await testLifecycleTransition();
  await testIllegalTransitionRejected();
  await testStaleVersionRejected();
  await testTerminalStateBlocksGenericUpdate();
  await testActionRegistryAndExecution();
  await testIdempotencyKey();
  await testCrmLeadLifecycleAction();
  await testReverseVsCancel();
  await testAmendPreservesLineage();
  await testActionAuditAndOutbox();
  await testPreconditionDenial();
  console.log('\nAll action/lifecycle tests passed.');
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exitCode = 1;
});
