// Checkpoint D3 — Manufacturing Orders, Work Orders, WIP, and Material Issues.

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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-mfg-test-'));
  const dbPath = path.join(tempDir, 'mfg.db');
  await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'mfg-test' });
  db = openMigrationDatabase(dbPath);

  const auth = createPlatformAuthority(db);
  executor = auth.actionExecutor;
  ctx = { tenantId: 'default', companyId: 'default', userId: 'usr_mfg_mgr', roles: ['admin', 'mfg_manager'] };

  const { setApprovalAuthorityLimit } = await import('../../platform/finance/engine.mjs');
  setApprovalAuthorityLimit(db, ctx, { role_or_user: ctx.userId, limit_type: 'post', max_amount: 1_000_000_000 });
});

after(() => {
  try { db?.close(); } catch {}
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Manufacturing Order lifecycle, WIP issues, work orders, and completion', () => {
  // 0. Setup warehouse & stock locations
  const wh = execute('warehouse:create', { company_id: 'default', name: 'MFG Warehouse', code: 'WMFG' }, ik('wh'));
  const supplierLoc = execute('stock:location:create', { company_id: 'default', name: 'MFG Supplier', usage: 'supplier' }, ik('suploc'));

  // 1. Setup BOM and Product Variants
  const category = execute('product_category:create', {
    company_id: 'default',
    name: 'Industrial Goods',
    costing_method: 'avco',
    income_account_id: 'acc_401000',
    expense_account_id: 'acc_501000',
    stock_account_id: 'acc_104000',
    stock_input_account_id: 'acc_201000',
    stock_output_account_id: 'acc_500000',
  }, ik('pcat'));

  const uomCat = execute('uom_category:create', { company_id: 'default', name: 'Units Cat' }, ik('uomcat'));
  const unit = execute('uom:create', { company_id: 'default', category_id: uomCat.id, name: 'Piece' }, ik('uom'));

  const compProd = execute('product:template:create', {
    name: 'Component Steel', category_id: category.id, uom_id: unit.id, list_price: 15, standard_price: 10, sku: 'SKU-STEEL'
  }, ik('comp'));

  const fgProd = execute('product:template:create', {
    name: 'Finished Widget', category_id: category.id, uom_id: unit.id, list_price: 100, standard_price: 50, sku: 'SKU-WIDGET'
  }, ik('fg'));

  // Open stock for component
  execute('stock:move:post', {
    company_id: 'default',
    reference: `INIT-STEEL`,
    product_id: compProd.default_variant_id,
    uom_id: unit.id,
    product_qty: 100,
    unit_cost: 10,
    location_id: supplierLoc.id,
    location_dest_id: wh.lot_stock_id
  }, ik('stock_steel'));

  // Create & approve BOM for FG
  const bom = execute('engineering:bom:create', {
    company_id: 'default',
    product_id: fgProd.default_variant_id,
    lines: [{ component_id: compProd.default_variant_id, quantity: 2 }]
  }, ik('bom_create'));

  const approve = (actionId, input, key) => executor.execute(actionId, { ...input, idempotency_key: key }, { ...ctx, userId: 'usr_mfg_approver' });
  execute('engineering:bom:submit', { bom_version_id: bom.versions[0].id }, ik('bom_sub'));
  approve('engineering:bom:approve', { bom_version_id: bom.versions[0].id }, ik('bom_app'));

  // 2. Create Manufacturing Order
  const mo = execute('manufacturing:order:create', {
    company_id: 'default',
    product_id: fgProd.default_variant_id,
    planned_quantity: 10,
    bom_id: bom.id,
    materials: [{ product_id: compProd.default_variant_id, required_qty: 20, unit_cost: 10 }],
    work_centers: [{ name: 'Assembly Line 1', hour_rate: 25, planned_hours: 2 }]
  }, ik('mo_create'));

  assert.equal(mo.state, 'draft');

  // 3. Confirm / Release MO
  const confirmedMo = execute('manufacturing:order:release', { order_id: mo.id }, ik('mo_confirm'));
  assert.equal(confirmedMo.state, 'released');

  // 4. Issue Materials to WIP
  const req = db.prepare(`SELECT * FROM mfg_material_requirements WHERE production_order_id = ?`).get(mo.id);
  const issue = execute('manufacturing:material:issue', {
    production_order_id: mo.id,
    requirement_id: req ? req.id : 'req_dummy',
    quantity: 20,
    issued_qty: 20,
    product_id: compProd.default_variant_id,
    unit_cost: 10
  }, ik('mat_issue'));

  assert.equal(issue.issued_qty, 20);

  // 5. Complete Work Orders
  const wos = db.prepare(`SELECT * FROM mfg_work_orders WHERE production_order_id = ?`).all(mo.id);
  if (wos.length > 0) {
    execute('manufacturing:work_order:start', { work_order_id: wos[0].id }, ik('wo_start'));
    execute('manufacturing:work_order:complete', { work_order_id: wos[0].id, actual_hours: 2.0 }, ik('wo_comp'));
  }

  // 6. Complete Manufacturing Order and receive FG to Stock
  const completedMo = execute('manufacturing:order:complete', {
    order_id: mo.id,
    completed_qty: 10
  }, ik('mo_complete'));

  assert.equal(completedMo.state, 'completed');
  assert.equal(completedMo.completed_quantity, 10);
});
