import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { seedTestIdentities } from '../../scripts/test-auth-fixture.mjs';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { getProducts } from '../../platform/commercial/products.mjs';

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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-prod-mat-test-'));
  dbPath = path.join(tempDir, 'prod-mat.db');
  await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'prod-mat-test' });
  db = openMigrationDatabase(dbPath);
  process.env.OCTAGON_TEST_FIXTURE = '1';
  seedTestIdentities(db, { dbPath });
  authority = createPlatformAuthority(db);
});

after(() => {
  delete process.env.OCTAGON_TEST_FIXTURE;
  try { db?.close(); } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
});

test('Product & Material Lifecycle: create, search, update, archive, restore', async () => {
  const executor = authority.actionExecutor;
  const sysadminCtx = { userId: 'usr_test_sysadmin', companyId: 'c_octagon_test', tenantId: 't_octagon_test' };

  // 1. Create Storable Product
  const prod = executor.execute('product:create', {
    name: 'أنبوب بلاستيكي 2 إنش',
    name_ar: 'أنبوب بلاستيكي 2 إنش',
    name_en: 'Plastic Pipe 2 Inch',
    code: 'PIPE-02',
    sku: 'PIPE-02',
    type: 'storable',
    category_id: 'pcat_test_general',
    uom_id: 'uom_test_unit',
    list_price: 15000,
    standard_price: 10000,
    tracking_type: 'lot',
    idempotency_key: ik('prod_c1')
  }, sysadminCtx);
  assert.ok(prod.id);

  // 2. Query product list with search
  const prods = getProducts(db, { company_id: 'c_octagon_test', search: 'PIPE-02' });
  assert.equal(prods.length, 1);
  assert.equal(prods[0].name_ar, 'أنبوب بلاستيكي 2 إنش');
  assert.equal(prods[0].tracking_type, 'lot');

  // 3. Update Product
  const updated = executor.execute('product:update', {
    id: prod.id,
    name: 'أنبوب بلاستيكي 2 إنش مقوى',
    name_ar: 'أنبوب بلاستيكي 2 إنش مقوى',
    standard_price: 12000,
    idempotency_key: ik('prod_u1')
  }, sysadminCtx);
  assert.equal(updated.name_ar, 'أنبوب بلاستيكي 2 إنش مقوى');
  assert.equal(updated.standard_price, 12000);

  // 4. Archive Product
  const archived = executor.execute('product:archive', { id: prod.id, idempotency_key: ik('prod_a1') }, sysadminCtx);
  assert.equal(archived.is_active, 0);

  // Active query excludes archived
  const activeProds = getProducts(db, { company_id: 'c_octagon_test', include_archived: false });
  assert.ok(!activeProds.some(p => p.id === prod.id));

  // 5. Restore Product
  const restored = executor.execute('product:restore', { id: prod.id, idempotency_key: ik('prod_r1') }, sysadminCtx);
  assert.equal(restored.is_active, 1);
});
