import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { seedTestIdentities } from '../../scripts/test-auth-fixture.mjs';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { convertUomQuantity } from '../../platform/commercial/uom.mjs';

let tempDir;
let dbPath;
let db;
let authority;
let ikCount = 0;
function ik(prefix = 'ik') {
  ikCount += 1;
  return `${prefix}_${Date.now()}_${ikCount}`;
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-uom-pcat-test-'));
  dbPath = path.join(tempDir, 'master-data.db');
  await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'uom-pcat-test' });
  db = openMigrationDatabase(dbPath);
  process.env.OCTAGON_TEST_FIXTURE = '1';
  seedTestIdentities(db, { dbPath });
  authority = createPlatformAuthority(db);
});

after(() => {
  delete process.env.OCTAGON_TEST_FIXTURE;
  try { db?.close(); } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
});

test('UOM Category Lifecycle: create, update, archive, restore', async () => {
  const executor = authority.actionExecutor;
  const sysadminCtx = { userId: 'usr_test_sysadmin', companyId: 'c_octagon_test', tenantId: 't_octagon_test' };

  // 1. Create
  const cat = executor.execute('uom_category:create', { name: 'فئة الحجم Volume', idempotency_key: ik('cat_c') }, sysadminCtx);
  assert.ok(cat.id);
  assert.equal(cat.name, 'فئة الحجم Volume');
  assert.equal(cat.is_active, 1);

  // 2. Update
  const updated = executor.execute('uom_category:update', { id: cat.id, name: 'فئة الحجم المعدلة', idempotency_key: ik('cat_u') }, sysadminCtx);
  assert.equal(updated.name, 'فئة الحجم المعدلة');

  // 3. Archive
  const archived = executor.execute('uom_category:archive', { id: cat.id, idempotency_key: ik('cat_a') }, sysadminCtx);
  assert.equal(archived.is_active, 0);

  // 4. Restore
  const restored = executor.execute('uom_category:restore', { id: cat.id, idempotency_key: ik('cat_r') }, sysadminCtx);
  assert.equal(restored.is_active, 1);
});

test('UOM Lifecycle & Conversion Rules: create reference and bigger units, test conversion', async () => {
  const executor = authority.actionExecutor;
  const sysadminCtx = { userId: 'usr_test_sysadmin', companyId: 'c_octagon_test', tenantId: 't_octagon_test' };

  const cat = executor.execute('uom_category:create', { name: 'الوزن Weight', idempotency_key: ik('uomcat') }, sysadminCtx);

  // Reference UOM: kg
  const uomKg = executor.execute('uom:create', {
    category_id: cat.id,
    name: 'كيلوغرام',
    symbol: 'kg',
    uom_type: 'reference',
    factor: 1.0,
    rounding: 0.001,
    idempotency_key: ik('uom_kg')
  }, sysadminCtx);
  assert.ok(uomKg.id);

  // Bigger UOM: Ton = 1000 kg
  const uomTon = executor.execute('uom:create', {
    category_id: cat.id,
    name: 'طن',
    symbol: 't',
    uom_type: 'bigger',
    factor: 1000.0,
    rounding: 0.001,
    idempotency_key: ik('uom_ton')
  }, sysadminCtx);
  assert.ok(uomTon.id);

  // Convert 2.5 Tons -> Kg = 2500 Kg
  const convertedKg = convertUomQuantity(db, { from_uom_id: uomTon.id, to_uom_id: uomKg.id, qty: 2.5 });
  assert.equal(convertedKg, 2500);

  // Convert 5000 Kg -> Tons = 5 Tons
  const convertedTon = convertUomQuantity(db, { from_uom_id: uomKg.id, to_uom_id: uomTon.id, qty: 5000 });
  assert.equal(convertedTon, 5);

  // Archive & Restore UOM
  const archivedUom = executor.execute('uom:archive', { id: uomTon.id, idempotency_key: ik('uom_arch') }, sysadminCtx);
  assert.equal(archivedUom.is_active, 0);

  const restoredUom = executor.execute('uom:restore', { id: uomTon.id, idempotency_key: ik('uom_rest') }, sysadminCtx);
  assert.equal(restoredUom.is_active, 1);
});

test('Product Category Lifecycle: create, update hierarchy, archive, restore', async () => {
  const executor = authority.actionExecutor;
  const sysadminCtx = { userId: 'usr_test_sysadmin', companyId: 'c_octagon_test', tenantId: 't_octagon_test' };

  // Parent Category
  const parent = executor.execute('product_category:create', {
    name: 'مواد عامة',
    name_ar: 'مواد عامة',
    name_en: 'General Materials',
    code: 'RAW',
    costing_method: 'avco',
    valuation_method: 'real_time',
    idempotency_key: ik('pcat_p')
  }, sysadminCtx);
  assert.ok(parent.id);

  // Child Category
  const child = executor.execute('product_category:create', {
    parent_id: parent.id,
    name: 'حديد وحديد تسليح',
    name_ar: 'حديد وحديد تسليح',
    name_en: 'Steel & Rebar',
    code: 'STEEL',
    idempotency_key: ik('pcat_c')
  }, sysadminCtx);
  assert.equal(child.parent_id, parent.id);

  // Update
  const updatedChild = executor.execute('product_category:update', {
    id: child.id,
    name: 'حديد تسليح عالي الجودة',
    idempotency_key: ik('pcat_u')
  }, sysadminCtx);
  assert.equal(updatedChild.name, 'حديد تسليح عالي الجودة');

  // Archive & Restore
  const archived = executor.execute('product_category:archive', { id: child.id, idempotency_key: ik('pcat_a') }, sysadminCtx);
  assert.equal(archived.is_active, 0);

  const restored = executor.execute('product_category:restore', { id: child.id, idempotency_key: ik('pcat_r') }, sysadminCtx);
  assert.equal(restored.is_active, 1);
});
