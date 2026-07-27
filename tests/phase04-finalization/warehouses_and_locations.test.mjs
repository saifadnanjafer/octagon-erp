import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { seedTestIdentities } from '../../scripts/test-auth-fixture.mjs';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { getWarehouses, getLocations } from '../../platform/inventory/warehouses.mjs';

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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-wh-loc-test-'));
  dbPath = path.join(tempDir, 'wh-loc.db');
  await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'wh-loc-test' });
  db = openMigrationDatabase(dbPath);
  process.env.OCTAGON_TEST_FIXTURE = '1';
  seedTestIdentities(db, { dbPath });
  authority = createPlatformAuthority(db);
});

after(() => {
  delete process.env.OCTAGON_TEST_FIXTURE;
  try { db?.close(); } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
});

test('Warehouses & Stock Locations Lifecycle: create warehouse, create location hierarchy, move location', async () => {
  const executor = authority.actionExecutor;
  const sysadminCtx = { userId: 'usr_test_sysadmin', companyId: 'c_octagon_test', tenantId: 't_octagon_test' };

  // 1. Create Warehouse
  const wh = executor.execute('warehouse:create', {
    name: 'مستودع الكرادة الرئيسي',
    code: 'WH-KARRADA',
    warehouse_type: 'physical',
    is_default: 1,
    idempotency_key: ik('wh_c')
  }, sysadminCtx);
  assert.ok(wh.id);
  assert.equal(wh.code, 'WH-KARRADA');

  // 2. Query Warehouses
  const warehouses = getWarehouses(db, { company_id: 'c_octagon_test' });
  assert.ok(warehouses.some(w => w.id === wh.id));

  // 3. Create Root View Location for Warehouse
  const rootLoc = executor.execute('stock:location:create', {
    name: 'WH-KARRADA-VIEW',
    usage: 'view',
    warehouse_id: wh.id,
    idempotency_key: ik('loc_c1')
  }, sysadminCtx);
  assert.ok(rootLoc.id);

  // 4. Create Stock Sub-Location (Internal)
  const stockLoc = executor.execute('stock:location:create', {
    name: 'Stock Area A',
    usage: 'internal',
    parent_id: rootLoc.id,
    warehouse_id: wh.id,
    idempotency_key: ik('loc_c2')
  }, sysadminCtx);
  assert.ok(stockLoc.id);
  assert.equal(stockLoc.parent_id, rootLoc.id);

  // 5. Create Shelf Bin Location under Stock Area A
  const binLoc = executor.execute('stock:location:create', {
    name: 'Bin A-01',
    usage: 'internal',
    parent_id: stockLoc.id,
    warehouse_id: wh.id,
    idempotency_key: ik('loc_c3')
  }, sysadminCtx);
  assert.equal(binLoc.parent_id, stockLoc.id);

  // 6. Query Locations
  const locs = getLocations(db, { company_id: 'c_octagon_test', warehouse_id: wh.id });
  assert.ok(locs.length >= 3);

  // 7. Move Location (stock:location:move) to root view
  const moved = executor.execute('stock:location:move', {
    id: binLoc.id,
    parent_id: rootLoc.id,
    idempotency_key: ik('loc_m1')
  }, sysadminCtx);
  assert.equal(moved.parent_id, rootLoc.id);

  // 8. Update Warehouse
  const updatedWh = executor.execute('warehouse:update', {
    id: wh.id,
    name: 'مستودع الكرادة المتطور',
    idempotency_key: ik('wh_u')
  }, sysadminCtx);
  assert.equal(updatedWh.name, 'مستودع الكرادة المتطور');
});
