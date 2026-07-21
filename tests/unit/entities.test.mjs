import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { openMigrationDatabase, freshInstall } from '../../database/migration-runner/index.mjs';
import { EntityRegistry, EntityDescriptorError } from '../../platform/kernel/entities/index.mjs';
import { normalizeDescriptor } from '../../platform/kernel/entities/schemas/entity-descriptor.mjs';

function tmpDb() {
  return path.join(os.tmpdir(), `octagon-entities-test-${Date.now()}.db`);
}

async function setup() {
  const dbPath = tmpDb();
  await freshInstall({ dbPath });
  const dialect = openMigrationDatabase(dbPath);
  const registry = new EntityRegistry(dialect);
  return { dialect, dbPath, registry };
}

async function cleanup(dialect, dbPath) {
  dialect.close();
  fs.unlinkSync(dbPath);
}

async function testDescriptorValidation() {
  assert.throws(() => normalizeDescriptor(null), EntityDescriptorError);
  assert.throws(() => normalizeDescriptor({ id: 'Bad' }), EntityDescriptorError);
  assert.throws(() => normalizeDescriptor({ id: 'good', module_id: 'mod', storage_owner: 'x', primary_key: 'id', label_ar: 'x', lifecycle_policy: 'unknown' }), EntityDescriptorError);
  assert.throws(() => normalizeDescriptor({ id: 'good', module_id: 'mod', storage_owner: 'x', primary_key: 'id', label_ar: 'x', fields: { 'bad field': { type: 'text' } } }), EntityDescriptorError);
  assert.strictEqual(normalizeDescriptor({ id: 'good', module_id: 'mod', storage_owner: 'x', primary_key: 'id', label_ar: 'x' }).id, 'good');
  console.log('PASS: descriptorValidation');
}

async function testReservedEntityName() {
  const { dialect, dbPath, registry } = await setup();
  assert.throws(
    () => registry.register({ id: 'audit', module_id: 'platform_kernel', storage_owner: 'x', primary_key: 'id', label_ar: 'x' }),
    /reserved/
  );
  await cleanup(dialect, dbPath);
  console.log('PASS: reservedEntityName');
}

async function testDuplicateEntity() {
  const { dialect, dbPath, registry } = await setup();
  const descriptor = { id: 'test_master', module_id: 'platform_kernel', storage_owner: 'x', primary_key: 'id', label_ar: 'x', lifecycle_policy: 'generic' };
  registry.register(descriptor, 'test-actor');
  const second = registry.register(descriptor, 'test-actor');
  assert.strictEqual(second.id, 'test_master');
  await cleanup(dialect, dbPath);
  console.log('PASS: duplicateEntityUpsert');
}

async function testModuleMustBeEnabled() {
  const { dialect, dbPath, registry } = await setup();
  assert.throws(
    () => registry.register({ id: 'orphan', module_id: 'not_installed', storage_owner: 'x', primary_key: 'id', label_ar: 'x' }),
    /not installed/
  );
  await cleanup(dialect, dbPath);
  console.log('PASS: moduleMustBeEnabled');
}

async function testDefaultEntitiesSeeded() {
  const { dialect, dbPath, registry } = await setup();
  const all = registry.list();
  assert.ok(all.some((e) => e.id === 'product_category'));
  assert.ok(all.some((e) => e.id === 'crm_lead'));
  const pc = registry.get('product_category');
  assert.strictEqual(pc.lifecycle_policy, 'generic');
  assert.strictEqual(pc.scope, 'company');
  await cleanup(dialect, dbPath);
  console.log('PASS: defaultEntitiesSeeded');
}

async function testRelationValidation() {
  const { dialect, dbPath, registry } = await setup();
  assert.throws(
    () => registry.register({
      id: 'bad_relation', module_id: 'platform_kernel', storage_owner: 'x', primary_key: 'id', label_ar: 'x',
      relations: { category: { type: 'unknown', target: 'product_category', foreign_key: 'category_id' } }
    }),
    /unsupported type/
  );
  await cleanup(dialect, dbPath);
  console.log('PASS: relationValidation');
}

async function testUnregisterEntity() {
  const { dialect, dbPath, registry } = await setup();
  registry.register({ id: 'temp', module_id: 'platform_kernel', storage_owner: 'x', primary_key: 'id', label_ar: 'x', lifecycle_policy: 'generic' }, 'test-actor');
  const removed = registry.unregister('temp', 'test-actor');
  assert.strictEqual(removed.unregistered, true);
  assert.strictEqual(registry.get('temp'), null);
  await cleanup(dialect, dbPath);
  console.log('PASS: unregisterEntity');
}

async function testAuditWritten() {
  const { dialect, dbPath, registry } = await setup();
  registry.register({ id: 'audited', module_id: 'platform_kernel', storage_owner: 'x', primary_key: 'id', label_ar: 'x', lifecycle_policy: 'generic' }, 'test-actor');
  const rows = dialect.prepare('SELECT COUNT(*) AS n FROM platform_audit_log WHERE resource = ? AND resource_id = ?').get('platform_entities', 'audited').n;
  assert.ok(rows >= 1, 'expected audit log rows for entity registration');
  await cleanup(dialect, dbPath);
  console.log('PASS: auditWritten');
}

async function main() {
  await testDescriptorValidation();
  await testReservedEntityName();
  await testDuplicateEntity();
  await testModuleMustBeEnabled();
  await testDefaultEntitiesSeeded();
  await testRelationValidation();
  await testUnregisterEntity();
  await testAuditWritten();
  console.log('\nAll entity registry tests passed.');
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exitCode = 1;
});
