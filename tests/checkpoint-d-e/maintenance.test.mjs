// Checkpoint E4 — Maintenance Requests, Preventive Plans, Maintenance Work Orders, and Spare Parts Integration.

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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-maint-test-'));
  const dbPath = path.join(tempDir, 'maint.db');
  await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'maint-test' });
  db = openMigrationDatabase(dbPath);

  const auth = createPlatformAuthority(db);
  executor = auth.actionExecutor;
  ctx = { tenantId: 'default', companyId: 'default', userId: 'usr_maint_tech', roles: ['admin', 'maintenance_tech'] };
});

after(() => {
  try { db?.close(); } catch {}
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Maintenance Request, Preventive Plan, Order Execution, and Spare Part Issue', () => {
  // 0. Create Asset Category & Asset
  const cat = execute('assets:category:create', {
    company_id: 'default',
    code: 'CAT-MAINT',
    name: 'Industrial Machinery',
    name_en: 'Industrial Machinery'
  }, ik('maint_asset_cat'));

  const asset = execute('assets:asset:create', {
    company_id: 'default',
    category_id: cat.id,
    name: 'CNC Milling Machine V3 Asset',
    name_en: 'CNC Milling Machine V3 Asset',
    acquisition_cost: 120000
  }, ik('maint_asset'));

  // 1. Create Maintenance Request (Corrective)
  const req = execute('maintenance:request:create', {
    company_id: 'default',
    asset_id: asset.id,
    request_type: 'corrective',
    priority: 'high',
    title: 'Spindle Bearing Overheating',
    description: 'Abnormal noise and temperature spike on Main Spindle'
  }, ik('req_create'));

  assert.equal(req.state, 'submitted');
  assert.ok(req.request_number.startsWith('MR-'));

  // 2. Create Preventive Plan
  const plan = execute('maintenance:plan:create', {
    company_id: 'default',
    asset_id: asset.id,
    title: 'Quarterly Spindle Lubrication & Calibration',
    name: 'Quarterly Spindle Lubrication & Calibration',
    interval_days: 90
  }, ik('plan_create'));

  assert.equal(plan.title, 'Quarterly Spindle Lubrication & Calibration');

  // 3. Create Maintenance Work Order
  const order = execute('maintenance:order:create', {
    company_id: 'default',
    request_id: req.id,
    asset_id: asset.id,
    order_type: 'corrective',
    title: 'Replace Spindle Bearing Assembly'
  }, ik('order_create'));

  assert.equal(order.state, 'draft');
  assert.ok(order.order_number.startsWith('MO-'));

  // Verify work_items integration
  const wi = db.prepare(`SELECT * FROM work_items WHERE id = ?`).get(order.work_item_id);
  assert.ok(wi);
  assert.equal(wi.source_type, 'maintenance_order');

  // Create spare bearing product
  const pcat = execute('product_category:create', { company_id: 'default', name: 'Spare Parts', code: 'CAT-SPARE' }, ik('pcat_maint'));
  const uomCat = execute('uom_category:create', { company_id: 'default', name: 'Units Cat Maint' }, ik('uomcat_maint'));
  const unit = execute('uom:create', { company_id: 'default', category_id: uomCat.id, name: 'Piece Maint' }, ik('uom_maint'));
  const bearingProd = execute('product:template:create', {
    name: 'Bearing 6205', category_id: pcat.id, uom_id: unit.id, list_price: 60, standard_price: 45, sku: 'SKU-BEARING-6205'
  }, ik('bearing_prod'));

  // 4. Issue Spare Parts
  const partIssue = execute('maintenance:order:issue_parts', {
    order_id: order.id,
    maintenance_order_id: order.id,
    product_id: bearingProd.default_variant_id,
    issued_qty: 2,
    unit_cost: 45,
    src_location_id: 'loc_stock'
  }, ik('part_issue'));

  assert.equal(partIssue.issued_qty, 2);

  // Verify spare part logged
  const part = db.prepare(`SELECT * FROM maintenance_spare_parts WHERE maintenance_order_id = ?`).get(order.id);
  assert.ok(part);
  assert.equal(part.total_cost, 90);

  // 5. Complete Maintenance Order
  const completedOrder = execute('maintenance:order:complete', {
    order_id: order.id,
    labor_cost: 150,
    completion_notes: 'Spindle bearings replaced, thermal test passed.'
  }, ik('order_complete'));

  assert.equal(completedOrder.state, 'completed');
  assert.equal(completedOrder.parts_cost, 90);
  assert.equal(completedOrder.total_cost, 240);
});
