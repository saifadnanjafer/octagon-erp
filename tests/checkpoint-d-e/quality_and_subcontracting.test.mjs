// Checkpoint E2 — Quality Management, Non-Conformance (NCR), CAPA, and Subcontracting.

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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-qc-sub-test-'));
  const dbPath = path.join(tempDir, 'qc_sub.db');
  await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'qc-test' });
  db = openMigrationDatabase(dbPath);

  const auth = createPlatformAuthority(db);
  executor = auth.actionExecutor;
  ctx = { tenantId: 'default', companyId: 'default', userId: 'usr_qc_mgr', roles: ['admin', 'qc_manager'] };
});

after(() => {
  try { db?.close(); } catch {}
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Quality Inspection Plan, Result Recording, NCR and CAPA creation', () => {
  // 0. Create Product Category & Product Variant
  const cat = execute('product_category:create', { company_id: 'default', name: 'Raw Metal Category', code: 'CAT-METAL' }, ik('pcat'));
  const uomCat = execute('uom_category:create', { company_id: 'default', name: 'Units Cat' }, ik('uomcat'));
  const unit = execute('uom:create', { company_id: 'default', category_id: uomCat.id, name: 'Piece' }, ik('uom'));
  const prod = execute('product:template:create', {
    name: 'Raw Bracket', category_id: cat.id, uom_id: unit.id, list_price: 20, standard_price: 10, sku: 'SKU-BRACKET'
  }, ik('ptpl'));

  // 1. Create Quality Plan
  const plan = execute('quality:plan:create', {
    company_id: 'default',
    name: 'Incoming Electronics Inspection Plan',
    code: 'QP-ELEC-01',
    category: 'general'
  }, ik('qp_create'));

  assert.ok(plan.id);

  // 2. Create Quality Inspection
  const insp = execute('quality:inspection:create', {
    company_id: 'default',
    plan_id: plan.id,
    inspection_type: 'incoming',
    source_type: 'purchase_receipt',
    source_id: 'PO-9901',
    product_id: prod.default_variant_id,
    sample_size: 10
  }, ik('insp_create'));

  assert.equal(insp.state, 'pending');

  // 3. Record Inspection Results
  const recorded = execute('quality:inspection:record_results', {
    company_id: 'default',
    inspection_id: insp.id,
    pass_fail: 'fail',
    result_value: 'Scratched surface',
    notes: '5 of 10 items scratched'
  }, ik('insp_record'));

  assert.equal(recorded.overall_result, 'fail');

  // 4. Raise Non-Conformance Report (NCR)
  const ncr = execute('quality:ncr:create', {
    company_id: 'default',
    inspection_id: insp.id,
    title: 'Visual Defect on Electronics Batch',
    description: 'Minor scratches detected on casing surface'
  }, ik('ncr_raise'));

  assert.equal(ncr.state, 'open');
  assert.ok(ncr.ncr_number.startsWith('NCR-'));

  // 5. Raise Corrective & Preventive Action (CAPA)
  const capa = execute('quality:capa:create', {
    company_id: 'default',
    ncr_id: ncr.id,
    title: 'Supplier Packaging Protective Foam Upgrade',
    corrective_action: 'Replace soft plastic wraps with molded foam blocks',
    assigned_to: 'usr_qc_mgr'
  }, ik('capa_raise'));

  assert.equal(capa.state, 'open');
  assert.ok(capa.capa_number.startsWith('CAPA-'));

  // Verify work_items integration for CAPA
  const wi = db.prepare(`SELECT * FROM work_items WHERE id = ?`).get(capa.work_item_id);
  assert.ok(wi);
  assert.equal(wi.source_type, 'capa_action');
});

test('Subcontracting Order, Supplier-Held Stock dispatch, and Subcontract Receipt', () => {
  // 0. Setup Category, Products, Supplier Party
  const cat = execute('product_category:create', { company_id: 'default', name: 'Subcontract Services', code: 'CAT-SUBC' }, ik('scat'));
  const uomCat = execute('uom_category:create', { company_id: 'default', name: 'Units Cat 2' }, ik('uomcat2'));
  const unit = execute('uom:create', { company_id: 'default', category_id: uomCat.id, name: 'Piece 2' }, ik('uom2'));
  const serviceProd = execute('product:template:create', {
    name: 'Plating Service', type: 'service', category_id: cat.id, uom_id: unit.id, list_price: 10, standard_price: 5, sku: 'SKU-PLATING-SVC'
  }, ik('svc_prod'));
  const rawMetal = execute('product:template:create', {
    name: 'Unplated Metal', category_id: cat.id, uom_id: unit.id, list_price: 15, standard_price: 8, sku: 'SKU-UNPLATED'
  }, ik('raw_prod'));

  const supplier = execute('party:create', {
    company_id: 'default', name: 'External Plating Co', is_supplier: 1, roles: ['supplier']
  }, ik('party_sup'));

  // Create & Approve BOM for Service Product
  const bom = execute('engineering:bom:create', {
    company_id: 'default',
    product_id: serviceProd.default_variant_id,
    lines: [{ component_id: rawMetal.default_variant_id, quantity: 1 }]
  }, ik('sub_bom'));
  execute('engineering:bom:submit', { bom_version_id: bom.versions[0].id }, ik('sub_bom_sub'));
  const approve = (actionId, input, key) => executor.execute(actionId, { ...input, idempotency_key: key }, { ...ctx, userId: 'usr_qc_approver' });
  approve('engineering:bom:approve', { bom_version_id: bom.versions[0].id }, ik('sub_bom_app'));

  // Create Manufacturing Order for Subcontracting
  const mo = execute('manufacturing:order:create', {
    company_id: 'default',
    product_id: serviceProd.default_variant_id,
    planned_quantity: 100
  }, ik('mfg_sub_mo'));

  // 1. Create Subcontract Order
  const subOrder = execute('manufacturing:subcontract:create', {
    company_id: 'default',
    production_order_id: mo.id,
    supplier_id: supplier.id,
    service_product_id: serviceProd.default_variant_id,
    quantity: 100,
    unit_cost: 4.50
  }, ik('sub_create'));

  assert.equal(subOrder.state, 'draft');

  // 2. Dispatch supplier-held raw components
  const dispatch = execute('manufacturing:subcontract:dispatch_components', {
    subcontract_order_id: subOrder.id,
    product_id: rawMetal.default_variant_id,
    dispatched_qty: 100,
    src_location_id: 'loc_stock'
  }, ik('sub_dispatch'));

  assert.equal(dispatch.dispatched_qty, 100);

  // Verify supplier-held stock ledger
  const held = db.prepare(`SELECT * FROM mfg_supplier_held_stock WHERE supplier_id = ?`).get(supplier.id);
  assert.ok(held);
  assert.equal(held.dispatched_quantity, 100);

  // 3. Receive finished subcontracted products
  const received = execute('manufacturing:subcontract:receive_goods', {
    subcontract_order_id: subOrder.id,
    quantity: 100,
    dest_location_id: 'loc_stock'
  }, ik('sub_receive'));

  assert.equal(received.state, 'received');
  assert.equal(received.received_quantity, 100);
});
