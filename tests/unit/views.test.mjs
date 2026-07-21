import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { openMigrationDatabase, freshInstall } from '../../database/migration-runner/index.mjs';
import { createViewRegistry, ViewRegistryError } from '../../platform/kernel/views/index.mjs';

function tmpDb() {
  return path.join(os.tmpdir(), `octagon-views-test-${Date.now()}.db`);
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

async function testViewRegistration() {
  const { dialect, dbPath } = await setup();
  const registry = createViewRegistry(dialect);
  const view = registry.register({
    id: 'product_category_list',
    module_id: 'platform_kernel',
    entity_id: 'product_category',
    view_type: 'list',
    route: '/supply/product-categories',
    menu_location: 'supply:master',
    layout_schema: { columns: ['seq', 'name', 'status'] },
    localization_keys: { title: 'product_category_list_title' },
  }, 'test-actor');
  assert.strictEqual(view.layout_version, '1');
  const loaded = registry.get('product_category_list');
  assert.strictEqual(loaded.route, '/supply/product-categories');
  await cleanup(dialect, dbPath);
  console.log('PASS: viewRegistration');
}

async function testRouteConflict() {
  const { dialect, dbPath } = await setup();
  const registry = createViewRegistry(dialect);
  registry.register({
    id: 'page_a', module_id: 'platform_kernel', view_type: 'page', route: '/a', layout_schema: {},
  });
  assert.throws(
    () => registry.register({
      id: 'page_b', module_id: 'platform_kernel', view_type: 'page', route: '/a', layout_schema: {},
    }),
    (err) => err instanceof ViewRegistryError && err.code === 'ROUTE_CONFLICT'
  );
  await cleanup(dialect, dbPath);
  console.log('PASS: routeConflict');
}

async function testMenuOrder() {
  const { dialect, dbPath } = await setup();
  const registry = createViewRegistry(dialect);
  registry.register({ id: 'z', module_id: 'platform_kernel', view_type: 'page', menu_location: 'a:1', route: '/z', layout_schema: {} });
  registry.register({ id: 'a', module_id: 'platform_kernel', view_type: 'page', menu_location: 'a:1', route: '/a', layout_schema: {} });
  const menu = registry.listMenu();
  assert.strictEqual(menu[0].id, 'a');
  assert.strictEqual(menu[1].id, 'z');
  await cleanup(dialect, dbPath);
  console.log('PASS: menuOrder');
}

async function testDisabledModuleRouteRemoved() {
  const { dialect, dbPath } = await setup();
  const registry = createViewRegistry(dialect);
  dialect.prepare('INSERT INTO platform_modules (id, name, version, status, kind, owner, dependencies, optional_dependencies, capabilities, migrations, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    'disabled_mod', 'Disabled', '1.0.0', 'installed', 'standard', 'platform', '[]', '[]', '[]', '[]', '[]', new Date().toISOString(), new Date().toISOString()
  );
  assert.throws(
    () => registry.register({ id: 'dv', module_id: 'disabled_mod', view_type: 'page', route: '/dv', layout_schema: {} }),
    (err) => err instanceof ViewRegistryError && err.code === 'MODULE_NOT_ENABLED'
  );
  await cleanup(dialect, dbPath);
  console.log('PASS: disabledModuleRouteRemoved');
}

async function testVersionRollback() {
  const { dialect, dbPath } = await setup();
  const registry = createViewRegistry(dialect);
  registry.register({ id: 'v', module_id: 'platform_kernel', view_type: 'page', route: '/v', layout_schema: { a: 1 }, layout_version: '1' });
  registry.register({ id: 'v', module_id: 'platform_kernel', view_type: 'page', route: '/v', layout_schema: { a: 2 }, layout_version: '2' });
  const versions = registry.getVersions('v');
  assert.strictEqual(versions.length, 2);
  const rolled = registry.rollback('v', '1');
  assert.strictEqual(rolled.layout_version, '3'); // new version after rollback
  assert.strictEqual(rolled.layout_schema.a, 1);
  await cleanup(dialect, dbPath);
  console.log('PASS: versionRollback');
}

async function testPatchConflict() {
  const { dialect, dbPath } = await setup();
  const registry = createViewRegistry(dialect);
  registry.register({ id: 'p', module_id: 'platform_kernel', view_type: 'page', route: '/p', layout_schema: {}, extension_patches: [{ target: 'header', op: 'add' }] });
  assert.throws(
    () => registry.applyPatch('p', { extension_patches: [{ target: 'header', op: 'add' }] }),
    (err) => err instanceof ViewRegistryError && err.code === 'PATCH_CONFLICT'
  );
  await cleanup(dialect, dbPath);
  console.log('PASS: patchConflict');
}

async function testLocalizationKeyPresence() {
  const { dialect, dbPath } = await setup();
  const registry = createViewRegistry(dialect);
  registry.register({ id: 'l', module_id: 'platform_kernel', view_type: 'page', route: '/l', layout_schema: {}, localization_keys: { title: 'l_title' } });
  const loaded = registry.get('l');
  assert.strictEqual(loaded.localization_keys.title, 'l_title');
  await cleanup(dialect, dbPath);
  console.log('PASS: localizationKeyPresence');
}

async function main() {
  await testViewRegistration();
  await testRouteConflict();
  await testMenuOrder();
  await testDisabledModuleRouteRemoved();
  await testVersionRollback();
  await testPatchConflict();
  await testLocalizationKeyPresence();
  console.log('\nAll view registry tests passed.');
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exitCode = 1;
});
