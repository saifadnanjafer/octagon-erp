import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { seedTestIdentities } from '../../scripts/test-auth-fixture.mjs';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { getQuantBalance } from '../../platform/inventory/ledger.mjs';

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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-wms-wf-test-'));
  dbPath = path.join(tempDir, 'wms-wf.db');
  await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'wms-wf-test' });
  db = openMigrationDatabase(dbPath);
  process.env.OCTAGON_TEST_FIXTURE = '1';
  seedTestIdentities(db, { dbPath });
  authority = createPlatformAuthority(db);
});

after(() => {
  delete process.env.OCTAGON_TEST_FIXTURE;
  try { db?.close(); } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
});

test('Stock Internal Transfer: Move stock between internal locations', async () => {
  const executor = authority.actionExecutor;
  const sysadminCtx = { userId: 'usr_test_sysadmin', companyId: 'c_octagon_test', tenantId: 't_octagon_test' };

  // 1. Create product and receipt (50 units into Loc A)
  const prod = executor.execute('product:create', {
    name: 'زيت محرك 5W30',
    code: 'OIL-5W30',
    type: 'storable',
    category_id: 'pcat_test_general',
    uom_id: 'uom_test_unit',
    standard_price: 15000,
    idempotency_key: ik('prod_t')
  }, sysadminCtx);

  const locSupp = executor.execute('stock:location:create', { name: 'المورد Vendor', usage: 'supplier', idempotency_key: ik('loc_s1') }, sysadminCtx);
  const locA = executor.execute('stock:location:create', { name: 'مخزن A', usage: 'internal', idempotency_key: ik('loc_a') }, sysadminCtx);
  const locB = executor.execute('stock:location:create', { name: 'مخزن B', usage: 'internal', idempotency_key: ik('loc_b') }, sysadminCtx);

  // Receive 50 units into Loc A
  const receipt = executor.execute('stock:receipt:create_draft', {
    location_id: locSupp.id,
    location_dest_id: locA.id,
    lines: [{ product_id: prod.default_variant_id || prod.id, quantity: 50, unit_price: 15000 }],
    idempotency_key: ik('rec_t')
  }, sysadminCtx);
  executor.execute('stock:receipt:validate', { picking_id: receipt.id, idempotency_key: ik('rec_val') }, sysadminCtx);

  assert.equal(getQuantBalance(db, { company_id: 'c_octagon_test', product_id: prod.default_variant_id || prod.id, location_id: locA.id }).quantity, 50);

  // 2. Transfer 20 units Loc A -> Loc B
  const transfer = executor.execute('stock:transfer:create_draft', {
    location_id: locA.id,
    location_dest_id: locB.id,
    lines: [{ product_id: prod.default_variant_id || prod.id, quantity: 20, unit_price: 15000 }],
    idempotency_key: ik('trans_d')
  }, sysadminCtx);

  executor.execute('stock:transfer:validate', { picking_id: transfer.id, idempotency_key: ik('trans_val') }, sysadminCtx);

  // Verify balances: Loc A has 30, Loc B has 20
  assert.equal(getQuantBalance(db, { company_id: 'c_octagon_test', product_id: prod.default_variant_id || prod.id, location_id: locA.id }).quantity, 30);
  assert.equal(getQuantBalance(db, { company_id: 'c_octagon_test', product_id: prod.default_variant_id || prod.id, location_id: locB.id }).quantity, 20);
});

test('Stock Reservation & Delivery: Reserve, consume on delivery to customer', async () => {
  const executor = authority.actionExecutor;
  const sysadminCtx = { userId: 'usr_test_sysadmin', companyId: 'c_octagon_test', tenantId: 't_octagon_test' };

  const prod = executor.execute('product:create', {
    name: 'فلتر هواء سوناتا',
    code: 'FILTER-SONATA',
    type: 'storable',
    category_id: 'pcat_test_general',
    uom_id: 'uom_test_unit',
    standard_price: 8000,
    idempotency_key: ik('prod_del')
  }, sysadminCtx);

  const whRes = executor.execute('warehouse:create', { name: 'مستودع الحجز', code: 'WHRES', idempotency_key: ik('wh_res') }, sysadminCtx);
  const locSupp = executor.execute('stock:location:create', { name: 'المورد V2', usage: 'supplier', warehouse_id: whRes.id, idempotency_key: ik('loc_vs') }, sysadminCtx);
  const locStock = executor.execute('stock:location:create', { name: 'مخزن الورشة الرئيسي', usage: 'internal', warehouse_id: whRes.id, idempotency_key: ik('loc_stk') }, sysadminCtx);
  const locCust = executor.execute('stock:location:create', { name: 'العميل Customer', usage: 'customer', warehouse_id: whRes.id, idempotency_key: ik('loc_cst') }, sysadminCtx);

  // Stock 100 units
  const receipt = executor.execute('stock:receipt:create_draft', {
    location_id: locSupp.id,
    location_dest_id: locStock.id,
    lines: [{ product_id: prod.default_variant_id || prod.id, quantity: 100, unit_price: 8000 }],
    idempotency_key: ik('rec_del')
  }, sysadminCtx);
  executor.execute('stock:receipt:validate', { picking_id: receipt.id, idempotency_key: ik('rec_del_val') }, sysadminCtx);

  // 1. Reserve 15 units for sales order
  const reservation = executor.execute('stock:reservation:reserve', {
    source_document_type: 'sale_order',
    source_document_id: 'so_test_1001',
    warehouse_id: whRes.id,
    product_id: prod.default_variant_id || prod.id,
    location_id: locStock.id,
    quantity: 15,
    idempotency_key: ik('res_15')
  }, sysadminCtx);
  assert.ok(reservation.id);

  // Verify reservation active
  const bal = getQuantBalance(db, { company_id: 'c_octagon_test', product_id: prod.default_variant_id || prod.id, location_id: locStock.id });
  assert.equal(bal.quantity, 100);
  assert.equal(bal.reserved_quantity, 15);
  assert.equal(bal.available_quantity, 85);

  // 2. Delivery to customer consuming reservation
  const delivery = executor.execute('stock:delivery:create_draft', {
    location_id: locStock.id,
    location_dest_id: locCust.id,
    lines: [{ product_id: prod.default_variant_id || prod.id, quantity: 15, unit_price: 8000 }],
    idempotency_key: ik('del_d')
  }, sysadminCtx);
  executor.execute('stock:delivery:validate', { picking_id: delivery.id, idempotency_key: ik('del_val') }, sysadminCtx);

  // Verify stock post-delivery: LocStock has 85 remaining
  const postBal = getQuantBalance(db, { company_id: 'c_octagon_test', product_id: prod.default_variant_id || prod.id, location_id: locStock.id });
  assert.equal(postBal.quantity, 85);
});

test('Lots, Serials, Packages & Replenishment Proposals', async () => {
  const executor = authority.actionExecutor;
  const sysadminCtx = { userId: 'usr_test_sysadmin', companyId: 'c_octagon_test', tenantId: 't_octagon_test' };

  const prod = executor.execute('product:create', {
    name: 'شمعة احتراق بوش Bosch Spark Plug',
    code: 'BOSCH-SP',
    type: 'storable',
    category_id: 'pcat_test_general',
    uom_id: 'uom_test_unit',
    tracking_type: 'serial',
    idempotency_key: ik('prod_sp')
  }, sysadminCtx);

  // 1. Create Lot & Serial
  const lot = executor.execute('stock:lot:create', {
    product_id: prod.default_variant_id || prod.id,
    lot_number: 'LOT-2026-07A',
    idempotency_key: ik('lot_1')
  }, sysadminCtx);
  assert.ok(lot.id);

  const serial = executor.execute('stock:serial:create', {
    product_id: prod.default_variant_id || prod.id,
    serial_number: 'SN-BOSCH-90001',
    lot_id: lot.id,
    idempotency_key: ik('ser_1')
  }, sysadminCtx);
  assert.ok(serial.id);

  // 2. Create Package
  const pkg = executor.execute('stock:package:create', {
    name: 'BOX-2026-01',
    package_type: 'pallet',
    idempotency_key: ik('pkg_1')
  }, sysadminCtx);
  assert.ok(pkg.id);

  // 3. Replenishment Proposal
  const prop = executor.execute('replenishment:proposal:create', {
    product_id: prod.default_variant_id || prod.id,
    min_qty: 10,
    target_qty: 100,
    idempotency_key: ik('repl_c')
  }, sysadminCtx);
  assert.equal(prop.status, 'proposed');

  const approvedProp = executor.execute('replenishment:proposal:approve', {
    proposal_id: prop.id,
    idempotency_key: ik('repl_a')
  }, sysadminCtx);
  assert.equal(approvedProp.status, 'approved');
});
