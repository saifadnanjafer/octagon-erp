import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { openMigrationDatabase, freshInstall } from '../../database/migration-runner/index.mjs';
import { createEventRegistry, EventRegistryError, validatePayload } from '../../platform/events/index.mjs';
import { createOutboxDispatcher, OutboxError } from '../../platform/outbox/index.mjs';

function tmpDb() {
  return path.join(os.tmpdir(), `octagon-events-test-${Date.now()}.db`);
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

async function testEventRegistration() {
  const { dialect, dbPath } = await setup();
  const registry = createEventRegistry(dialect);
  registry.register({
    id: 'product.created',
    event_type: 'product.created',
    module_id: 'platform_kernel',
    aggregate_entity: 'product',
    payload_schema: { required: ['sku'] },
  }, 'test-actor');
  const event = registry.get('product.created');
  assert.strictEqual(event.delivery_guarantee, 'at-least-once');
  assert.strictEqual(event.company_scoped, true);
  await cleanup(dialect, dbPath);
  console.log('PASS: eventRegistration');
}

async function testPayloadSchemaValidation() {
  const { dialect, dbPath } = await setup();
  const registry = createEventRegistry(dialect);
  registry.register({
    id: 'product.created',
    event_type: 'product.created',
    module_id: 'platform_kernel',
    payload_schema: { required: ['sku'] },
  });
  const event = registry.get('product.created');
  assert.throws(
    () => validatePayload(event, {}),
    /missing required/
  );
  await cleanup(dialect, dbPath);
  console.log('PASS: payloadSchemaValidation');
}

async function testOutboxDispatch() {
  const { dialect, dbPath } = await setup();
  const dispatcher = createOutboxDispatcher(dialect);
  const received = [];
  dispatcher.registerConsumer('product.created', (event) => received.push(event.payload.sku));
  dialect.prepare(`
    INSERT INTO platform_outbox (id, event_type, schema_version, module_id, aggregate_id, tenant_id, company_id, actor_id, correlation_id, payload, created_at, scheduled_at, attempts, max_attempts, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'evt-1', 'product.created', '1.0.0', 'platform_kernel', 'product:1', null, 'c1', 'u1', 'corr-1',
    JSON.stringify({ sku: 'P001' }), new Date().toISOString(), new Date().toISOString(), 0, 3, 'pending'
  );
  const summary = dispatcher.dispatch();
  assert.strictEqual(summary.delivered, 1);
  assert.deepStrictEqual(received, ['P001']);
  await cleanup(dialect, dbPath);
  console.log('PASS: outboxDispatch');
}

async function testOutboxRetryAndDeadLetter() {
  const { dialect, dbPath } = await setup();
  const dispatcher = createOutboxDispatcher(dialect, { maxAttempts: 2 });
  dispatcher.registerConsumer('product.created', () => { throw new Error('consumer failure'); });
  dialect.prepare(`
    INSERT INTO platform_outbox (id, event_type, schema_version, module_id, aggregate_id, tenant_id, company_id, actor_id, correlation_id, payload, created_at, scheduled_at, attempts, max_attempts, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'evt-1', 'product.created', '1.0.0', 'platform_kernel', 'product:1', null, 'c1', 'u1', 'corr-1',
    JSON.stringify({ sku: 'P001' }), new Date().toISOString(), new Date().toISOString(), 0, 2, 'pending'
  );
  dispatcher.dispatch();
  dispatcher.dispatch();
  const row = dispatcher.dialect.prepare('SELECT status FROM platform_outbox WHERE id = ?').get('evt-1');
  assert.strictEqual(row.status, 'dead');
  const dead = dispatcher.getDeadLetters();
  assert.strictEqual(dead.length, 1);
  await cleanup(dialect, dbPath);
  console.log('PASS: outboxRetryAndDeadLetter');
}

async function testOutboxReplay() {
  const { dialect, dbPath } = await setup();
  const dispatcher = createOutboxDispatcher(dialect);
  let calls = 0;
  dispatcher.registerConsumer('product.created', () => { calls += 1; });
  dialect.prepare(`
    INSERT INTO platform_outbox (id, event_type, schema_version, module_id, aggregate_id, tenant_id, company_id, actor_id, correlation_id, payload, created_at, scheduled_at, attempts, max_attempts, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'evt-1', 'product.created', '1.0.0', 'platform_kernel', 'product:1', null, 'c1', 'u1', 'corr-1',
    JSON.stringify({ sku: 'P001' }), new Date().toISOString(), new Date().toISOString(), 0, 3, 'pending'
  );
  dispatcher.dispatch();
  assert.strictEqual(calls, 1);
  dispatcher.replay('evt-1');
  assert.strictEqual(calls, 2);
  await cleanup(dialect, dbPath);
  console.log('PASS: outboxReplay');
}

async function testOutboxNoConsumerNoop() {
  const { dialect, dbPath } = await setup();
  const dispatcher = createOutboxDispatcher(dialect);
  dialect.prepare(`
    INSERT INTO platform_outbox (id, event_type, schema_version, module_id, aggregate_id, tenant_id, company_id, actor_id, correlation_id, payload, created_at, scheduled_at, attempts, max_attempts, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'evt-1', 'product.created', '1.0.0', 'platform_kernel', 'product:1', null, 'c1', 'u1', 'corr-1',
    JSON.stringify({ sku: 'P001' }), new Date().toISOString(), new Date().toISOString(), 0, 3, 'pending'
  );
  const summary = dispatcher.dispatch();
  assert.strictEqual(summary.delivered, 1);
  await cleanup(dialect, dbPath);
  console.log('PASS: outboxNoConsumerNoop');
}

async function main() {
  await testEventRegistration();
  await testPayloadSchemaValidation();
  await testOutboxDispatch();
  await testOutboxRetryAndDeadLetter();
  await testOutboxReplay();
  await testOutboxNoConsumerNoop();
  console.log('\nAll event/outbox tests passed.');
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exitCode = 1;
});
