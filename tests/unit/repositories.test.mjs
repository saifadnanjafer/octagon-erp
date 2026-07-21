import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { openMigrationDatabase, freshInstall } from '../../database/migration-runner/index.mjs';
import { EntityRegistry } from '../../platform/kernel/entities/index.mjs';
import { createRepository, RepositoryError, MAX_LIMIT } from '../../platform/data/repositories/index.mjs';
import { createLegacyAdapter } from '../../platform/data/repositories/legacy-adapter.mjs';

function tmpDb() {
  return path.join(os.tmpdir(), `octagon-repos-test-${Date.now()}.db`);
}

function tmpLegacyFile() {
  return path.join(os.tmpdir(), `octagon-legacy-test-${Date.now()}.json`);
}

async function setup() {
  const dbPath = tmpDb();
  await freshInstall({ dbPath });
  const dialect = openMigrationDatabase(dbPath);
  return { dialect, dbPath };
}

async function cleanup(dialect, dbPath, legacyPath) {
  dialect.close();
  fs.unlinkSync(dbPath);
  if (legacyPath && fs.existsSync(legacyPath)) fs.unlinkSync(legacyPath);
}

async function testGenericMasterCrud() {
  const { dialect, dbPath } = await setup();
  const repo = createRepository(dialect, 'product_category');
  const ctx = { companyId: 'comp-1', userId: 'u1' };

  const created = repo.create({ name: 'Electronics', code: 'ELEC', description: 'Devices' }, ctx);
  assert.ok(created.id);
  assert.strictEqual(created.name, 'Electronics');
  assert.ok(created.seq.startsWith('CAT-'));
  assert.strictEqual(created.company_id, 'comp-1');

  const read = repo.read(created.id, ctx);
  assert.strictEqual(read.name, 'Electronics');

  const updated = repo.update(created.id, { name: 'Gadgets', version: created.version }, ctx);
  assert.strictEqual(updated.name, 'Gadgets');
  assert.strictEqual(updated.version, 2);

  const list = repo.list({}, ctx);
  assert.strictEqual(list.items.length, 1);
  assert.strictEqual(list.meta.total, 1);

  const deleted = repo.delete(created.id, ctx);
  assert.strictEqual(deleted.id, created.id);
  assert.strictEqual(repo.read(created.id, ctx), null);

  await cleanup(dialect, dbPath);
  console.log('PASS: genericMasterCrud');
}

async function testProtectedEntityMutationDenied() {
  const { dialect, dbPath } = await setup();
  const repo = createRepository(dialect, 'crm_lead');
  const ctx = { companyId: 'comp-1', userId: 'u1' };

  assert.throws(
    () => repo.create({ name: 'Lead' }, ctx),
    (err) => err instanceof RepositoryError && err.code === 'PROTECTED_ENTITY_MUTATION'
  );
  assert.throws(
    () => repo.update('x', { name: 'Y' }, ctx),
    (err) => err instanceof RepositoryError && err.code === 'PROTECTED_ENTITY_MUTATION'
  );
  assert.throws(
    () => repo.delete('x', ctx),
    (err) => err instanceof RepositoryError && err.code === 'PROTECTED_ENTITY_MUTATION'
  );

  await cleanup(dialect, dbPath);
  console.log('PASS: protectedEntityMutationDenied');
}

async function testScopeIsolation() {
  const { dialect, dbPath } = await setup();
  const repo = createRepository(dialect, 'product_category');
  repo.create({ name: 'A' }, { companyId: 'c1', userId: 'u1' });
  repo.create({ name: 'B' }, { companyId: 'c2', userId: 'u2' });

  const c1List = repo.list({}, { companyId: 'c1', userId: 'u1' });
  assert.strictEqual(c1List.items.length, 1);
  assert.strictEqual(c1List.items[0].name, 'A');

  await cleanup(dialect, dbPath);
  console.log('PASS: scopeIsolation');
}

async function testFilterPaginationAndSort() {
  const { dialect, dbPath } = await setup();
  const repo = createRepository(dialect, 'product_category');
  const ctx = { companyId: 'comp-1', userId: 'u1' };
  for (let i = 1; i <= 5; i += 1) {
    repo.create({ name: `Cat ${i}`, status: i % 2 === 0 ? 'active' : 'inactive' }, ctx);
  }

  const page = repo.list({ page: 1, limit: 2, sort: 'name' }, ctx);
  assert.strictEqual(page.items.length, 2);
  assert.strictEqual(page.meta.total, 5);
  assert.strictEqual(page.items[0].name, 'Cat 1');

  const filtered = repo.list({ filter: { status: 'active' } }, ctx);
  assert.strictEqual(filtered.items.length, 2);

  const sortedDesc = repo.list({ sort: '-name' }, ctx);
  assert.strictEqual(sortedDesc.items[0].name, 'Cat 5');

  await cleanup(dialect, dbPath);
  console.log('PASS: filterPaginationAndSort');
}

async function testSummary() {
  const { dialect, dbPath } = await setup();
  const repo = createRepository(dialect, 'product_category');
  const ctx = { companyId: 'comp-1', userId: 'u1' };
  repo.create({ name: 'A', status: 'active' }, ctx);
  repo.create({ name: 'B', status: 'inactive' }, ctx);
  repo.create({ name: 'C', status: 'active' }, ctx);

  const summary = repo.summary(ctx);
  assert.strictEqual(summary.total, 3);
  assert.strictEqual(summary.by_status.active, 2);
  assert.strictEqual(summary.by_status.inactive, 1);

  await cleanup(dialect, dbPath);
  console.log('PASS: summary');
}

async function testRelationExpand() {
  const { dialect, dbPath } = await setup();
  const catRepo = createRepository(dialect, 'product_category');
  const prodRepo = createRepository(dialect, 'product');
  const ctx = { companyId: 'comp-1', userId: 'u1' };

  const cat = catRepo.create({ name: 'Components' }, ctx);
  const prod = prodRepo.create({ name: 'Resistor', category_id: cat.id }, ctx);
  const expanded = prodRepo.readWithRelations(prod.id, ['category'], ctx);
  assert.ok(expanded.category);
  assert.strictEqual(expanded.category.id, cat.id);

  await cleanup(dialect, dbPath);
  console.log('PASS: relationExpand');
}

async function testConcurrentUpdateVersion() {
  const { dialect, dbPath } = await setup();
  const repo = createRepository(dialect, 'product_category');
  const ctx = { companyId: 'comp-1', userId: 'u1' };
  const created = repo.create({ name: 'V1' }, ctx);

  assert.throws(
    () => repo.update(created.id, { name: 'V2', version: 99 }, ctx),
    (err) => err instanceof RepositoryError && err.code === 'STALE_VERSION'
  );

  await cleanup(dialect, dbPath);
  console.log('PASS: concurrentUpdateVersion');
}

async function testAuditHistory() {
  const { dialect, dbPath } = await setup();
  const repo = createRepository(dialect, 'product_category');
  const ctx = { companyId: 'comp-1', userId: 'u1' };
  const created = repo.create({ name: 'Audit' }, ctx);
  repo.update(created.id, { name: 'Audit Updated' }, ctx);
  repo.delete(created.id, ctx);

  const history = repo.history(created.id);
  assert.ok(history.length >= 3, `expected at least 3 history entries, got ${history.length}`);
  const actions = history.map((h) => h.action);
  assert.ok(actions.includes('create'));
  assert.ok(actions.includes('update'));
  assert.ok(actions.includes('delete'));

  await cleanup(dialect, dbPath);
  console.log('PASS: auditHistory');
}

async function testWriteGuards() {
  const { dialect, dbPath } = await setup();
  const registry = new EntityRegistry(dialect);
  registry.register({ id: 'guarded', module_id: 'platform_kernel', storage_owner: 'x', primary_key: 'id', label_ar: 'x', lifecycle_policy: 'generic' }, 'test-actor');
  const repo = createRepository(dialect, 'guarded');
  repo.registerGuard((entity, id, action) => {
    if (action === 'delete') return 'cannot delete guarded records';
    return null;
  });
  const ctx = { companyId: 'comp-1', userId: 'u1' };
  const created = repo.create({ name: 'G' }, ctx);
  assert.throws(
    () => repo.delete(created.id, ctx),
    /cannot delete guarded records/
  );
  await cleanup(dialect, dbPath);
  console.log('PASS: writeGuards');
}

async function testLegacyAdapterReadOnly() {
  const { dialect, dbPath } = await setup();
  const legacyPath = tmpLegacyFile();
  fs.writeFileSync(legacyPath, JSON.stringify({ customers: [{ id: 'c1', name: 'Ahmad', is_active: true }, { id: 'c2', name: 'Sara', is_active: false }] }));
  const adapter = createLegacyAdapter(legacyPath, 'customers');
  const records = adapter.list();
  assert.strictEqual(records.length, 2);
  assert.strictEqual(records[0].name, 'Ahmad');
  assert.strictEqual(records[1].removed, 1);
  assert.throws(() => adapter.create({ id: 'c3', name: 'X' }), /read-only/);
  await cleanup(dialect, dbPath, legacyPath);
  console.log('PASS: legacyAdapterReadOnly');
}

async function testMaxLimitEnforced() {
  const { dialect, dbPath } = await setup();
  const repo = createRepository(dialect, 'product_category');
  const ctx = { companyId: 'comp-1', userId: 'u1' };
  for (let i = 0; i < MAX_LIMIT + 5; i += 1) {
    repo.create({ name: `Item ${i}` }, ctx);
  }
  const page = repo.list({ limit: 9999 }, ctx);
  assert.strictEqual(page.items.length, MAX_LIMIT);
  await cleanup(dialect, dbPath);
  console.log('PASS: maxLimitEnforced');
}

async function main() {
  await testGenericMasterCrud();
  await testProtectedEntityMutationDenied();
  await testScopeIsolation();
  await testFilterPaginationAndSort();
  await testSummary();
  await testRelationExpand();
  await testConcurrentUpdateVersion();
  await testAuditHistory();
  await testWriteGuards();
  await testLegacyAdapterReadOnly();
  await testMaxLimitEnforced();
  console.log('\nAll repository tests passed.');
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exitCode = 1;
});
