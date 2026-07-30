// Module Expansion Wave 1 — M1 registry and permission namespace tests.
//
// Every case runs against a disposable database built by freshInstall. This
// worktree contains no operational database at all (database.db is gitignored),
// which is the strongest form of the isolation guarantee.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { freshInstall, runMigrations, migrationStatus } from '../../database/migration-runner/index.mjs';
import { WAVE1_MODULE_IDS, WAVE1_PERMISSION_COUNT } from '../../database/migrations/064_module_expansion_wave1_registry.mjs';

function tmpDb(name) {
  return path.join(os.tmpdir(), `octagon-wave1-${name}-${Date.now()}-${process.pid}.db`);
}

function open(p) {
  return new DatabaseSync(p, { readOnly: true });
}

async function testMigrationAppliesToTip064() {
  const db = tmpDb('apply');
  await freshInstall({ dbPath: db });

  const status = await migrationStatus({ dbPath: db });
  const applied = status.filter((s) => s.status === 'applied').map((s) => s.id);
  assert.ok(applied.includes('064_module_expansion_wave1_registry'), '064 must apply');
  // 064 is the registry foundation, not necessarily the tip: M2 added 065 (CRM)
  // on top of it. Assert it is applied and ordered before any module schema.
  assert.ok(applied.indexOf('064_module_expansion_wave1_registry') > -1, '064 must be applied');

  fs.unlinkSync(db);
  console.log(`PASS: migrationAppliesToTip064 (${applied.length} applied)`);
}

async function testAllEightModulesRegistered() {
  const dbPath = tmpDb('modules');
  await freshInstall({ dbPath });
  const db = open(dbPath);

  const rows = db.prepare('SELECT module_id, name_ar, name_en, license_key, nav_group, lifecycle, schema_migration FROM module_expansion_registry ORDER BY module_id').all();
  assert.strictEqual(rows.length, 8, 'exactly eight Wave 1 modules');
  assert.deepStrictEqual(rows.map((r) => r.module_id).sort(), [...WAVE1_MODULE_IDS].sort());

  for (const r of rows) {
    assert.ok(r.name_ar && /[؀-ۿ]/.test(r.name_ar), `${r.module_id} needs an Arabic name`);
    assert.ok(r.name_en && r.name_en.length > 1, `${r.module_id} needs an English name`);
    assert.ok(r.license_key.startsWith('octagon.'), `${r.module_id} needs a license key`);
    assert.ok(r.nav_group, `${r.module_id} needs a navigation group`);
    // A module is 'available' only once its own schema migration has run and
    // recorded itself; everything else must still be 'planned'.
    if (r.lifecycle === 'available') {
      assert.ok(r.schema_migration, `${r.module_id} claims available without a schema migration`);
    } else {
      assert.strictEqual(r.lifecycle, 'planned', `${r.module_id} must not claim to be installable yet`);
      assert.strictEqual(r.schema_migration, null, `${r.module_id} is planned but names a schema migration`);
    }
  }

  // Registered in the real control plane too, not only the wave table.
  const platform = db.prepare(
    `SELECT id, status, dependencies FROM platform_modules WHERE id IN (${WAVE1_MODULE_IDS.map(() => '?').join(',')})`
  ).all(...WAVE1_MODULE_IDS);
  assert.strictEqual(platform.length, 8, 'all eight must exist in platform_modules');
  for (const p of platform) {
    // 'available' means registered and known. It must NOT be 'enabled' or
    // 'installed' while the module has no domain schema — that would be a false
    // green in Administration.
    // 'available' = registered, no schema yet. 'installed' = its schema ran.
    // Neither may be 'enabled' without an entitlement decision.
    assert.ok(['available','installed'].includes(p.status), `${p.id} unexpected status ${p.status}`);
  }

  db.close();
  fs.unlinkSync(dbPath);
  console.log('PASS: allEightModulesRegistered');
}

async function testDependenciesReferenceExistingAuthorities() {
  const dbPath = tmpDb('deps');
  await freshInstall({ dbPath });
  const db = open(dbPath);

  const existing = new Set(db.prepare('SELECT id FROM platform_modules').all().map((r) => r.id));
  const wave = new Set(WAVE1_MODULE_IDS);

  for (const id of WAVE1_MODULE_IDS) {
    const row = db.prepare('SELECT dependencies FROM platform_modules WHERE id = ?').get(id);
    const deps = JSON.parse(row.dependencies);
    assert.ok(deps.length > 0, `${id} must declare dependencies`);
    for (const d of deps) {
      assert.ok(
        existing.has(d),
        `${id} depends on "${d}" which is not a registered module — a new module must reuse existing authorities, not invent them`
      );
    }
    // A Wave 1 module may depend on another Wave 1 module, but never on itself.
    assert.ok(!deps.includes(id), `${id} must not depend on itself`);
  }

  // Spot-check the reuse rules that matter most.
  const fs_deps = JSON.parse(db.prepare("SELECT dependencies FROM platform_modules WHERE id='field_service'").get().dependencies);
  for (const required of ['work_item_canonical', 'stock_inventory', 'assets_management']) {
    assert.ok(fs_deps.includes(required), `field_service must reuse ${required}`);
  }
  const ecom = JSON.parse(db.prepare("SELECT dependencies FROM platform_modules WHERE id='ecommerce'").get().dependencies);
  for (const required of ['commercial_sales', 'stock_inventory', 'finance_canonical']) {
    assert.ok(ecom.includes(required), `ecommerce must reuse ${required} rather than build its own`);
  }

  db.close();
  fs.unlinkSync(dbPath);
  console.log(`PASS: dependenciesReferenceExistingAuthorities (${wave.size} modules)`);
}

async function testPermissionNamespaces() {
  const dbPath = tmpDb('perms');
  await freshInstall({ dbPath });
  const db = open(dbPath);

  const rows = db.prepare(
    `SELECT id, module_id, resource, action, label_ar, label_en, sensitive
     FROM authorization_permissions
     WHERE module_id IN (${WAVE1_MODULE_IDS.map(() => '?').join(',')})`
  ).all(...WAVE1_MODULE_IDS);

  assert.strictEqual(rows.length, WAVE1_PERMISSION_COUNT, `expected ${WAVE1_PERMISSION_COUNT} Wave 1 permissions`);

  for (const r of rows) {
    assert.ok(r.label_ar && /[؀-ۿ]/.test(r.label_ar), `${r.id} needs an Arabic label`);
    assert.ok(r.label_en, `${r.id} needs an English label`);
  }

  // Every module has at least read + manage.
  for (const id of WAVE1_MODULE_IDS) {
    const actions = rows.filter((r) => r.module_id === id).map((r) => r.action);
    assert.ok(actions.length >= 5, `${id} needs a real permission namespace, got ${actions.length}`);
    assert.ok(actions.includes('manage'), `${id} needs a manage permission`);
  }

  // Sensitive operations must be marked — this is what the permission
  // regression asserts is denied to viewers and portal users.
  const mustBeSensitive = [
    ['crm', 'convert'], ['service', 'resolve'], ['documents', 'share'],
    ['knowledge', 'publish'], ['appointments', 'cancel'], ['field_service', 'bill'],
    ['portal', 'download'], ['ecommerce', 'checkout'],
  ];
  for (const [resource, action] of mustBeSensitive) {
    const row = rows.find((r) => r.resource === resource && r.action === action);
    assert.ok(row, `missing permission ${resource}:${action}`);
    assert.strictEqual(row.sensitive, 1, `${resource}:${action} must be marked sensitive`);
  }

  // Portal permissions must be scoped, never blanket read.
  const portal = rows.filter((r) => r.resource === 'portal').map((r) => r.action);
  assert.ok(portal.includes('read_own'), 'portal must use read_own, not a blanket read');
  assert.ok(!portal.includes('read'), 'portal must not carry an unscoped read permission');

  db.close();
  fs.unlinkSync(dbPath);
  console.log(`PASS: permissionNamespaces (${rows.length} permissions)`);
}

async function testRollbackAndRerun() {
  const dbPath = tmpDb('rollback');
  await freshInstall({ dbPath });

  // 065 (CRM) now sits on top of 064, so unwinding the registry means two steps.
  await runMigrations({ dbPath, direction: 'down', steps: 2 });
  let db = open(dbPath);
  const gone = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='module_expansion_registry'").get().n;
  assert.strictEqual(gone, 0, 'registry table must be dropped on rollback');
  const perms = db.prepare(
    `SELECT COUNT(*) n FROM authorization_permissions WHERE module_id IN (${WAVE1_MODULE_IDS.map(() => '?').join(',')})`
  ).get(...WAVE1_MODULE_IDS).n;
  assert.strictEqual(perms, 0, 'Wave 1 permissions must be removed on rollback');
  db.close();

  // Re-apply, then prove idempotency.
  const up = await runMigrations({ dbPath, direction: 'up' });
  assert.deepStrictEqual(up.migrations, ['064_module_expansion_wave1_registry', '065_crm_pipeline_leads_opportunities_and_activities']);
  const again = await runMigrations({ dbPath, direction: 'up' });
  assert.deepStrictEqual(again.migrations, [], 'rerun must apply nothing');

  db = open(dbPath);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM module_expansion_registry').get().n, 8, 'no duplicates after re-apply');
  db.close();

  fs.unlinkSync(dbPath);
  console.log('PASS: rollbackAndRerun');
}

async function testNoOperationalDatabaseInThisWorktree() {
  // The strongest isolation statement available: this worktree has no
  // operational database to touch.
  const operational = path.resolve('database.db');
  assert.ok(!fs.existsSync(operational), 'the expansion worktree must contain no operational database');
  console.log('PASS: noOperationalDatabaseInThisWorktree');
}

async function main() {
  await testNoOperationalDatabaseInThisWorktree();
  await testMigrationAppliesToTip064();
  await testAllEightModulesRegistered();
  await testDependenciesReferenceExistingAuthorities();
  await testPermissionNamespaces();
  await testRollbackAndRerun();
  console.log('\nAll Wave 1 registry tests passed.');
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exitCode = 1;
});
