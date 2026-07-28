// Checkpoint E3 — Assets, Capitalization, Straight-line Depreciation, and Asset Transfers.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, before, after } from 'node:test';

import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';

let tempDir;
let db;
let executor;
let ctx;
let ikCount = 0;

function ik(prefix) {
  ikCount += 1;
  return `${prefix}_${Date.now()}_${ikCount}`;
}

const execute = (actionId, input, key) => executor.execute(actionId, { ...input, idempotency_key: key }, ctx);

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-asset-test-'));
  const dbPath = path.join(tempDir, 'assets.db');
  await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'asset-test' });
  db = openMigrationDatabase(dbPath);

  const auth = createPlatformAuthority(db);
  executor = auth.actionExecutor;
  ctx = { tenantId: 'default', companyId: 'default', userId: 'usr_asset_mgr', roles: ['admin', 'asset_manager'] };
});

after(() => {
  try { db?.close(); } catch {}
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Asset registration, capitalization, depreciation calculation, and location transfer', () => {
  // 1. Create Asset Category
  const cat = execute('assets:category:create', {
    company_id: 'default',
    code: 'CAT-MACH',
    name: 'Machinery & Equipment',
    name_en: 'Machinery & Equipment',
    depreciation_method: 'straight_line',
    useful_life_months: 60
  }, ik('cat_create'));

  assert.equal(cat.name_en, 'Machinery & Equipment');

  // 2. Register Asset in draft state
  const asset = execute('assets:asset:create', {
    company_id: 'default',
    category_id: cat.id,
    name: 'CNC Milling Machine V3',
    name_en: 'CNC Milling Machine V3',
    purchase_value: 120000,
    acquisition_cost: 120000,
    salvage_value: 12000,
    location_id: 'loc_factory_floor'
  }, ik('asset_create'));

  assert.equal(asset.state, 'draft');
  assert.equal(asset.purchase_value, 120000);

  // 3. Capitalize Asset (creates depreciation schedules)
  const capAsset = execute('assets:asset:capitalize', {
    asset_id: asset.id,
    acquisition_date: '2026-01-01'
  }, ik('asset_cap'));

  assert.equal(capAsset.state, 'active');

  // Check schedules generated (60 months straight line: (120000 - 12000) / 60 = 1800 per month)
  const scheds = db.prepare(`SELECT * FROM asset_depreciation_schedules WHERE asset_id = ? ORDER BY period_number ASC`).all(asset.id);
  assert.equal(scheds.length, 60);
  assert.equal(scheds[0].depreciation_amount, 1800);

  // 4. Post Depreciation Entry
  const postRes = execute('assets:asset:post_depreciation_request', {
    schedule_id: scheds[0].id
  }, ik('asset_post_dep'));

  assert.equal(postRes.state, 'posted');
  assert.ok(postRes.journal_entry_id);

  // Verify updated asset accumulated depreciation and book value
  const updatedAsset = db.prepare(`SELECT * FROM assets WHERE id = ?`).get(asset.id);
  assert.equal(updatedAsset.accumulated_depreciation, 1800);
  assert.equal(updatedAsset.book_value, 118200);

  // 5. Asset Transfer
  const transfer = execute('assets:asset:transfer', {
    asset_id: asset.id,
    from_location_id: 'loc_factory_floor',
    to_location_id: 'loc_workshop_b',
    notes: 'Moved for secondary line expansion'
  }, ik('asset_transfer'));

  assert.equal(transfer.to_location_id, 'loc_workshop_b');
});
