import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { openMigrationDatabase, freshInstall } from '../../database/migration-runner/index.mjs';
import { ModuleRegistry, validateModuleManifest, resolveLoadOrder, ModuleRegistryError, discoverModules } from '../../platform/kernel/modules/index.mjs';

function tmpDb() {
  return path.join(os.tmpdir(), `octagon-modules-test-${Date.now()}.db`);
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

async function testManifestValidation() {
  assert.throws(() => validateModuleManifest(null), ModuleRegistryError);
  assert.throws(() => validateModuleManifest({ id: 'Bad' }), ModuleRegistryError);
  assert.throws(() => validateModuleManifest({ id: 'good', name: 'Good' }), ModuleRegistryError);
  assert.throws(() => validateModuleManifest({ id: 'good', name: 'Good', version: '1', kind: 'unknown' }), ModuleRegistryError);
  assert.strictEqual(validateModuleManifest({ id: 'good', name: 'Good', version: '1.0.0', owner: 'platform' }), true);
  console.log('PASS: manifestValidation');
}

async function testInstallAndEnable() {
  const { dialect, dbPath } = await setup();
  const registry = new ModuleRegistry(dialect);

  const core = { id: 'platform_kernel', name: 'Kernel', version: '1.0.0', kind: 'core', owner: 'platform' };
  const mod = { id: 'crm', name: 'CRM', version: '1.0.0', kind: 'standard', owner: 'modules/crm', dependencies: { required: ['platform_kernel'] } };

  registry.install(core, 'test-actor');
  registry.enable('platform_kernel', 'test-actor');
  registry.install(mod, 'test-actor');
  registry.enable('crm', 'test-actor');

  const enabled = registry.get('crm');
  assert.strictEqual(enabled.status, 'enabled');

  const audit = dialect.prepare('SELECT COUNT(*) AS n FROM platform_audit_log WHERE resource = ?').get('platform_modules').n;
  assert.ok(audit >= 4, 'expected audit rows for module lifecycle');

  await cleanup(dialect, dbPath);
  console.log('PASS: installAndEnable');
}

async function testDependencyBlock() {
  const { dialect, dbPath } = await setup();
  const registry = new ModuleRegistry(dialect);

  const core = { id: 'platform_kernel', name: 'Kernel', version: '1.0.0', kind: 'core', owner: 'platform' };
  registry.install(core, 'test-actor');
  registry.disable('platform_kernel', 'test-actor');

  const mod = { id: 'crm', name: 'CRM', version: '1.0.0', kind: 'standard', owner: 'modules/crm', dependencies: { required: ['platform_kernel'] } };
  assert.throws(() => registry.install(mod), (err) => err instanceof ModuleRegistryError && err.code === 'DEPENDENCY_NOT_ENABLED');

  await cleanup(dialect, dbPath);
  console.log('PASS: dependencyBlock');
}

async function testDisableAndUninstall() {
  const { dialect, dbPath } = await setup();
  const registry = new ModuleRegistry(dialect);

  const mod = { id: 'test_mod', name: 'Test Module', version: '1.0.0', kind: 'standard', owner: 'platform' };
  registry.install(mod, 'test-actor');
  registry.enable('test_mod', 'test-actor');

  registry.disable('test_mod', 'test-actor');
  assert.strictEqual(registry.get('test_mod').status, 'installed');

  const result = registry.uninstall('test_mod', 'test-actor');
  assert.strictEqual(result.uninstalled, true);
  assert.strictEqual(registry.get('test_mod'), null);

  await cleanup(dialect, dbPath);
  console.log('PASS: disableAndUninstall');
}

async function testUninstallWithDependents() {
  const { dialect, dbPath } = await setup();
  const registry = new ModuleRegistry(dialect);

  const core = { id: 'platform_kernel', name: 'Kernel', version: '1.0.0', kind: 'core', owner: 'platform' };
  const mod = { id: 'crm', name: 'CRM', version: '1.0.0', kind: 'standard', owner: 'modules/crm', dependencies: { required: ['platform_kernel'] } };
  registry.install(core, 'test-actor');
  registry.enable('platform_kernel', 'test-actor');
  registry.install(mod, 'test-actor');
  registry.enable('crm', 'test-actor');

  assert.throws(() => registry.uninstall('platform_kernel'), (err) => err instanceof ModuleRegistryError && err.code === 'DEPENDENT_MODULES_EXIST');

  await cleanup(dialect, dbPath);
  console.log('PASS: uninstallWithDependents');
}

async function testLoadOrder() {
  const registry = new Map();
  registry.set('platform_kernel', { id: 'platform_kernel', dependencies: { required: [] } });
  registry.set('products', { id: 'products', dependencies: { required: ['platform_kernel'] } });
  registry.set('inventory', { id: 'inventory', dependencies: { required: ['products'] } });
  registry.set('sales', { id: 'sales', dependencies: { required: ['products', 'inventory'] } });

  const order = resolveLoadOrder(registry);
  assert.deepStrictEqual(order, ['platform_kernel', 'products', 'inventory', 'sales']);
  console.log('PASS: loadOrder');
}

async function testLoadOrderCycle() {
  const registry = new Map();
  registry.set('a', { id: 'a', dependencies: { required: ['b'] } });
  registry.set('b', { id: 'b', dependencies: { required: ['a'] } });
  assert.throws(() => resolveLoadOrder(registry), (err) => err instanceof ModuleRegistryError && err.code === 'DEPENDENCY_CYCLE');
  console.log('PASS: loadOrderCycle');
}

async function testDiskDiscovery() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-modules-'));
  fs.mkdirSync(path.join(dir, 'good_mod'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'good_mod', 'manifest.json'), JSON.stringify({ id: 'good_mod', name: 'Good', version: '1.0.0', owner: 'platform' }));
  fs.mkdirSync(path.join(dir, 'Bad-Name'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Bad-Name', 'manifest.json'), JSON.stringify({ id: 'Bad-Name', name: 'Bad', version: '1.0.0', owner: 'platform' }));

  const { discovered, errors } = discoverModules(dir);
  assert.strictEqual(discovered.length, 1);
  assert.strictEqual(discovered[0].id, 'good_mod');
  assert.strictEqual(errors.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('PASS: diskDiscovery');
}

async function main() {
  await testManifestValidation();
  await testInstallAndEnable();
  await testDependencyBlock();
  await testDisableAndUninstall();
  await testUninstallWithDependents();
  await testLoadOrder();
  await testLoadOrderCycle();
  await testDiskDiscovery();
  console.log('\nAll module registry tests passed.');
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exitCode = 1;
});
