import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { seedTestIdentities } from '../../scripts/test-auth-fixture.mjs';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';

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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-receipt-test-'));
  dbPath = path.join(tempDir, 'receipt-test.db');
  await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'receipt-test' });
  db = openMigrationDatabase(dbPath);
  process.env.OCTAGON_TEST_FIXTURE = '1';
  seedTestIdentities(db, { dbPath });
  authority = createPlatformAuthority(db);
});

after(() => {
  delete process.env.OCTAGON_TEST_FIXTURE;
  try { db?.close(); } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
});

test('Stock Receipt Lifecycle: Draft -> Validate -> Stock Move -> Quant Update -> Valuation -> Outbox Event', async () => {
  const executor = authority.actionExecutor;
  const sysadminCtx = { userId: 'usr_test_sysadmin', companyId: 'c_octagon_test', tenantId: 't_octagon_test' };

  // 1. Create Product for Receipt
  const prod = executor.execute('product:create', {
    name: 'صاج حديد 4 ملم',
    code: 'STEEL-SHEET-04',
    sku: 'STEEL-SHEET-04',
    type: 'storable',
    category_id: 'pcat_test_general',
    uom_id: 'uom_test_unit',
    standard_price: 45000,
    idempotency_key: ik('prod_r')
  }, sysadminCtx);

  // 2. Create Stock Locations (Supplier Location -> Warehouse Stock Location)
  const supplierLoc = executor.execute('stock:location:create', {
    name: 'المورد الرئيسي Vendor',
    usage: 'supplier',
    idempotency_key: ik('loc_supp')
  }, sysadminCtx);

  const warehouseLoc = executor.execute('stock:location:create', {
    name: 'مخزن قطع الغيار',
    usage: 'internal',
    idempotency_key: ik('loc_wh')
  }, sysadminCtx);

  // 3. Create Receipt Draft
  const receipt = executor.execute('stock:receipt:create_draft', {
    location_id: supplierLoc.id,
    location_dest_id: warehouseLoc.id,
    lines: [
      { product_id: prod.default_variant_id || prod.id, quantity: 100, unit_price: 45000 }
    ],
    idempotency_key: ik('rec_draft')
  }, sysadminCtx);

  assert.ok(receipt.id);
  assert.equal(receipt.state, 'draft');
  assert.equal(receipt.lines.length, 1);

  // 4. Validate Receipt
  const valKey = ik('rec_validate');
  const validated = executor.execute('stock:receipt:validate', {
    picking_id: receipt.id,
    idempotency_key: valKey
  }, sysadminCtx);

  assert.equal(validated.state, 'done');

  // Verify stock quants balance updated
  const quant = db.prepare(`SELECT * FROM stock_quants WHERE product_id = ? AND location_id = ?`).get(prod.default_variant_id || prod.id, warehouseLoc.id);
  assert.ok(quant, 'Quant must be created');
  assert.equal(quant.quantity, 100, 'Quant balance must equal 100');

  // Verify outbox event written
  const outbox = db.prepare(`SELECT * FROM platform_outbox WHERE event_type = 'stock.receipt.validated' ORDER BY created_at DESC LIMIT 1`).get();
  assert.ok(outbox, 'Outbox event must be written');

  // 5. Idempotency Proof: repeating validation with same idempotency key returns exact result without duplicating quant
  const replayed = executor.execute('stock:receipt:validate', {
    picking_id: receipt.id,
    idempotency_key: valKey
  }, sysadminCtx);

  assert.equal(replayed.state, 'done');

  const quantReplay = db.prepare(`SELECT * FROM stock_quants WHERE product_id = ? AND location_id = ?`).get(prod.default_variant_id || prod.id, warehouseLoc.id);
  assert.equal(quantReplay.quantity, 100, 'Quant balance must remain 100, no double posting!');
});
