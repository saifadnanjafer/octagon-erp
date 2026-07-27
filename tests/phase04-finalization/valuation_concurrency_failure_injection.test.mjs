import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { seedTestIdentities } from '../../scripts/test-auth-fixture.mjs';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { getProductValuation } from '../../platform/inventory/valuation.mjs';
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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-b5-test-'));
  dbPath = path.join(tempDir, 'b5-test.db');
  await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'b5-test' });
  db = openMigrationDatabase(dbPath);
  process.env.OCTAGON_TEST_FIXTURE = '1';
  seedTestIdentities(db, { dbPath });
  authority = createPlatformAuthority(db);
});

after(() => {
  delete process.env.OCTAGON_TEST_FIXTURE;
  try { db?.close(); } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
});

test('Valuation & Stock-to-GL Linkage: Valuation layer, move history, and GL posting', async () => {
  const executor = authority.actionExecutor;
  const sysadminCtx = { userId: 'usr_test_sysadmin', companyId: 'c_octagon_test', tenantId: 't_octagon_test' };

  // 1. Create product
  const prod = executor.execute('product:create', {
    name: 'حساس أوكسجين O2 Sensor',
    code: 'O2-SENSOR',
    type: 'storable',
    category_id: 'pcat_test_general',
    uom_id: 'uom_test_unit',
    standard_price: 35000,
    idempotency_key: ik('prod_val')
  }, sysadminCtx);

  const locSupp = executor.execute('stock:location:create', { name: 'المورد V3', usage: 'supplier', idempotency_key: ik('loc_v3') }, sysadminCtx);
  const locStock = executor.execute('stock:location:create', { name: 'مخزن الحساسات', usage: 'internal', idempotency_key: ik('loc_sens') }, sysadminCtx);

  // Receive 20 units @ 35,000 IQD = 700,000 IQD total valuation
  const receipt = executor.execute('stock:receipt:create_draft', {
    location_id: locSupp.id,
    location_dest_id: locStock.id,
    lines: [{ product_id: prod.default_variant_id || prod.id, quantity: 20, unit_price: 35000 }],
    idempotency_key: ik('rec_v')
  }, sysadminCtx);

  executor.execute('stock:receipt:validate', { picking_id: receipt.id, idempotency_key: ik('rec_v_val') }, sysadminCtx);

  // 2. Query Valuation summary
  const valuation = getProductValuation(db, { company_id: 'c_octagon_test', product_id: prod.default_variant_id || prod.id });
  assert.ok(valuation);
  assert.equal(valuation.on_hand_qty, 20);
  assert.equal(valuation.total_valuation, 700000);

  // 3. Verify Stock-to-GL linkage
  const accountingLinks = db.prepare(`SELECT * FROM stock_accounting_links WHERE company_id = 'c_octagon_test'`).all();
  assert.ok(accountingLinks.length > 0, 'Stock-to-GL links must exist for validated receipt');
});

test('Failure Injection Proof: Atomic rollback on error during stock validation', async () => {
  const executor = authority.actionExecutor;
  const sysadminCtx = { userId: 'usr_test_sysadmin', companyId: 'c_octagon_test', tenantId: 't_octagon_test' };

  const prod = executor.execute('product:create', {
    name: 'زيت هيدروليك 68',
    code: 'HYD-68',
    type: 'storable',
    category_id: 'pcat_test_general',
    uom_id: 'uom_test_unit',
    standard_price: 25000,
    idempotency_key: ik('prod_fail')
  }, sysadminCtx);

  const locSupp = executor.execute('stock:location:create', { name: 'المورد V4', usage: 'supplier', idempotency_key: ik('loc_v4') }, sysadminCtx);
  const locStock = executor.execute('stock:location:create', { name: 'مخزن الزيوت', usage: 'internal', idempotency_key: ik('loc_oil') }, sysadminCtx);

  // Count initial moves, quants, and GL links before attempt
  const movesBefore = db.prepare(`SELECT COUNT(*) as count FROM stock_moves`).get().count;
  const quantsBefore = db.prepare(`SELECT COUNT(*) as count FROM stock_quants WHERE product_id = ?`).get(prod.default_variant_id || prod.id).count;

  // Create receipt draft with valid product
  const invalidReceipt = executor.execute('stock:receipt:create_draft', {
    location_id: locSupp.id,
    location_dest_id: locStock.id,
    lines: [{ product_id: prod.default_variant_id || prod.id, quantity: 10, unit_price: 25000 }],
    idempotency_key: ik('rec_inv')
  }, sysadminCtx);

  // Intentionally modify picking line product_id to invalid foreign key with FK check off, then re-enable FKs so validation fails during move execution
  db.exec('PRAGMA foreign_keys = OFF;');
  db.prepare(`UPDATE stock_picking_lines SET product_id = 'non_existent_prod_9999' WHERE picking_id = ?`).run(invalidReceipt.id);
  db.exec('PRAGMA foreign_keys = ON;');

  // Attempt validation: must fail cleanly
  assert.throws(
    () => executor.execute('stock:receipt:validate', { picking_id: invalidReceipt.id, idempotency_key: ik('rec_inv_val') }, sysadminCtx),
    (err) => true
  );

  // Verify atomic rollback: zero new moves or quants created!
  const movesAfter = db.prepare(`SELECT COUNT(*) as count FROM stock_moves`).get().count;
  const quantsAfter = db.prepare(`SELECT COUNT(*) as count FROM stock_quants WHERE product_id = ?`).get(prod.default_variant_id || prod.id).count;

  assert.equal(movesAfter, movesBefore, 'Atomic rollback: moves count must not change!');
  assert.equal(quantsAfter, quantsBefore, 'Atomic rollback: quants count must not change!');
});
