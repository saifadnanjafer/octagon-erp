import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from '../phase02/harness.mjs';
import { products, uom } from '../../platform/commercial/index.mjs';
import { warehouses, ledger, valuation } from '../../platform/inventory/index.mjs';
import { operations, counts, landedCost } from '../../platform/wms/index.mjs';

async function setupDb() {
  const { dialect } = await setup('wave-c');
  return dialect;
}

test('Wave C: WMS Stock Pickings & Validation Workflow', async () => {
  const db = await setupDb();
  const wh = warehouses.createWarehouse(db, { name: 'Main WMS WH', code: 'WMS1' });
  const supplierLoc = warehouses.createStockLocation(db, { name: 'Vendor Loc', usage: 'supplier' });

  const uomCat = uom.createUomCategory(db, { name: 'Units' });
  const unitUom = uom.createUom(db, { category_id: uomCat.id, name: 'Pcs' });

  const cat = products.createProductCategory(db, { name: 'Parts' });
  const prod = products.createProductTemplate(db, { name: 'Brake Disc 320mm', category_id: cat.id, uom_id: unitUom.id, sku: 'BD-320' });

  // Create picking type
  const pickingTypeId = 'pt_in_01';
  db.prepare(`
    INSERT INTO stock_picking_types (id, company_id, warehouse_id, name, code, created_at)
    VALUES (?, '*', ?, 'Incoming Receipts', 'incoming', ?)
  `).run(pickingTypeId, wh.id, new Date().toISOString());

  // Create picking draft
  const picking = operations.createPicking(db, {
    picking_type_id: pickingTypeId,
    reference: 'WH/IN/00001',
    location_id: supplierLoc.id,
    location_dest_id: wh.lot_stock_id,
  });

  assert.equal(picking.state, 'draft');

  // Validate picking with 25 units @ $45
  const validated = operations.validatePicking(db, {
    picking_id: picking.id,
    moves: [{ product_id: prod.default_variant_id, uom_id: unitUom.id, product_qty: 25, unit_cost: 45 }],
  });

  assert.equal(validated.state, 'done');

  const bal = ledger.getQuantBalance(db, { product_id: prod.default_variant_id, location_id: wh.lot_stock_id });
  assert.equal(bal.onHand, 25);
});

test('Wave C: Cycle Count & Stock Adjustment', async () => {
  const db = await setupDb();
  const wh = warehouses.createWarehouse(db, { name: 'Count WH', code: 'CNWH' });

  const uomCat = uom.createUomCategory(db, { name: 'Units' });
  const unitUom = uom.createUom(db, { category_id: uomCat.id, name: 'Pcs' });

  const cat = products.createProductCategory(db, { name: 'Hardware' });
  const prod = products.createProductTemplate(db, { name: 'M8 Bolt 50mm', category_id: cat.id, uom_id: unitUom.id, sku: 'M8-50', standard_price: 0.5 });

  // Initial stock: 100 units on hand
  const supplierLoc = warehouses.createStockLocation(db, { name: 'Vendors', usage: 'supplier' });
  ledger.postStockMove(db, { reference: 'INIT', product_id: prod.default_variant_id, uom_id: unitUom.id, product_qty: 100, location_id: supplierLoc.id, location_dest_id: wh.lot_stock_id, unit_cost: 0.5 });

  // Create cycle count: physical count found 95 units (-5 discrepancy)
  const cc = counts.createCycleCount(db, { name: 'Q3 Physical Audit', location_id: wh.lot_stock_id });
  counts.recordCountLine(db, { count_id: cc.id, product_id: prod.default_variant_id, real_qty: 95 });

  // Post cycle count adjustment move
  counts.postCycleCount(db, { count_id: cc.id, uom_id: unitUom.id });

  const bal = ledger.getQuantBalance(db, { product_id: prod.default_variant_id, location_id: wh.lot_stock_id });
  assert.equal(bal.onHand, 95);
});

test('Wave C: Landed Cost Allocation & Unit Cost Adjustment', async () => {
  const db = await setupDb();
  const wh = warehouses.createWarehouse(db, { name: 'Landed Cost WH', code: 'LCWH' });
  const supplierLoc = warehouses.createStockLocation(db, { name: 'Suppliers', usage: 'supplier' });

  const uomCat = uom.createUomCategory(db, { name: 'Units' });
  const unitUom = uom.createUom(db, { category_id: uomCat.id, name: 'Pcs' });

  const cat = products.createProductCategory(db, { name: 'Imported Goods', costing_method: 'avco' });
  const prod = products.createProductTemplate(db, { name: 'Hydraulic Pump', category_id: cat.id, uom_id: unitUom.id, sku: 'HYD-PMP', standard_price: 1000 });

  // 1. Initial purchase: 10 units @ $1,000 = $10,000
  ledger.postStockMove(db, { reference: 'PO-IMP-1', product_id: prod.default_variant_id, uom_id: unitUom.id, product_qty: 10, location_id: supplierLoc.id, location_dest_id: wh.lot_stock_id, unit_cost: 1000 });

  // 2. Freight & Customs Landed Cost: $2,000 ($200 per unit added)
  const lc = landedCost.createLandedCost(db, {
    name: 'Freight & Customs Shipment #88',
    cost_lines: [
      { cost_type: 'freight', amount: 1500 },
      { cost_type: 'customs', amount: 500 },
    ],
  });

  landedCost.postLandedCost(db, { landed_cost_id: lc.id, product_ids: [prod.default_variant_id] });

  const val = valuation.getProductValuation(db, { product_id: prod.default_variant_id });
  assert.equal(val.inventory_value, 12000); // $10,000 initial + $2,000 freight
  assert.equal(val.unit_cost, 1200); // $1,200 total unit cost
});
