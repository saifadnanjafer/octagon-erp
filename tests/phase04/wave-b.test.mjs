import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from '../phase02/harness.mjs';
import { products, uom } from '../../platform/commercial/index.mjs';
import { warehouses, ledger, valuation } from '../../platform/inventory/index.mjs';

async function setupDb() {
  const { dialect } = await setup('wave-b');
  return dialect;
}

test('Wave B: Warehouses & Automatic Location Hierarchy', async () => {
  const db = await setupDb();
  const wh = warehouses.createWarehouse(db, { name: 'Main Central Warehouse', code: 'WH01' });

  assert.ok(wh.id);
  assert.equal(wh.name, 'Main Central Warehouse');
  assert.equal(wh.code, 'WH01');
  assert.ok(wh.lot_stock_id);

  const locs = warehouses.getLocations(db, { warehouse_id: wh.id });
  assert.equal(locs.length, 4); // View, Stock, Input, Output
  const stockLoc = locs.find(l => l.name === 'Stock');
  assert.equal(stockLoc.complete_name, 'WH01/Stock');
});

test('Wave B: Stock Ledger Posting & Rebuildable Balances', async () => {
  const db = await setupDb();
  const wh = warehouses.createWarehouse(db, { name: 'Warehouse 1', code: 'WH1' });
  const supplierLoc = warehouses.createStockLocation(db, { name: 'Suppliers', usage: 'supplier' });
  const stockLocId = wh.lot_stock_id;

  const uomCat = uom.createUomCategory(db, { name: 'Units' });
  const unitUom = uom.createUom(db, { category_id: uomCat.id, name: 'Pcs' });

  const cat = products.createProductCategory(db, { name: 'Electronics', costing_method: 'avco' });
  const prod = products.createProductTemplate(db, { name: 'LED Monitor 27"', category_id: cat.id, uom_id: unitUom.id, sku: 'MON-27' });

  // Post receipt of 50 units @ $150
  const move1 = ledger.postStockMove(db, {
    reference: 'PO-0001',
    product_id: prod.default_variant_id,
    uom_id: unitUom.id,
    product_qty: 50,
    location_id: supplierLoc.id,
    location_dest_id: stockLocId,
    unit_cost: 150,
  });

  assert.equal(move1.state, 'done');

  let bal = ledger.getQuantBalance(db, { product_id: prod.default_variant_id, location_id: stockLocId });
  assert.equal(bal.onHand, 50);

  // Test rebuildable quants
  ledger.rebuildStockQuants(db);
  bal = ledger.getQuantBalance(db, { product_id: prod.default_variant_id, location_id: stockLocId });
  assert.equal(bal.onHand, 50);
});

test('Wave B: AVCO Valuation Recalculation', async () => {
  const db = await setupDb();
  const wh = warehouses.createWarehouse(db, { name: 'AVCO WH', code: 'AVWH' });
  const supplierLoc = warehouses.createStockLocation(db, { name: 'Suppliers', usage: 'supplier' });
  const stockLocId = wh.lot_stock_id;

  const uomCat = uom.createUomCategory(db, { name: 'Units' });
  const unitUom = uom.createUom(db, { category_id: uomCat.id, name: 'Pcs' });

  const cat = products.createProductCategory(db, { name: 'Raw Material', costing_method: 'avco' });
  const prod = products.createProductTemplate(db, { name: 'Steel Sheet 1mm', category_id: cat.id, uom_id: unitUom.id, sku: 'STL-1MM' });

  // 1. Receive 100 units @ 10,000 IQD -> Total 1,000,000 IQD, AVCO = 10,000
  ledger.postStockMove(db, { reference: 'REC-1', product_id: prod.default_variant_id, uom_id: unitUom.id, product_qty: 100, location_id: supplierLoc.id, location_dest_id: stockLocId, unit_cost: 10000 });

  let val = valuation.getProductValuation(db, { product_id: prod.default_variant_id });
  assert.equal(val.inventory_qty, 100);
  assert.equal(val.inventory_value, 1000000);
  assert.equal(val.unit_cost, 10000);

  // 2. Receive 100 units @ 20,000 IQD -> Total 3,000,000 IQD, New AVCO = 15,000
  ledger.postStockMove(db, { reference: 'REC-2', product_id: prod.default_variant_id, uom_id: unitUom.id, product_qty: 100, location_id: supplierLoc.id, location_dest_id: stockLocId, unit_cost: 20000 });

  val = valuation.getProductValuation(db, { product_id: prod.default_variant_id });
  assert.equal(val.inventory_qty, 200);
  assert.equal(val.inventory_value, 3000000);
  assert.equal(val.unit_cost, 15000);
});

test('Wave B: FIFO Layer Depletion', async () => {
  const db = await setupDb();
  const wh = warehouses.createWarehouse(db, { name: 'FIFO WH', code: 'FFWH' });
  const supplierLoc = warehouses.createStockLocation(db, { name: 'Suppliers', usage: 'supplier' });
  const customerLoc = warehouses.createStockLocation(db, { name: 'Customers', usage: 'customer' });
  const stockLocId = wh.lot_stock_id;

  const uomCat = uom.createUomCategory(db, { name: 'Units' });
  const unitUom = uom.createUom(db, { category_id: uomCat.id, name: 'Pcs' });

  const cat = products.createProductCategory(db, { name: 'Perishables', costing_method: 'fifo' });
  const prod = products.createProductTemplate(db, { name: 'Fresh Juice 1L', category_id: cat.id, uom_id: unitUom.id, sku: 'JUC-1L' });

  // Batch 1: 50 units @ $2.00
  ledger.postStockMove(db, { reference: 'REC-B1', product_id: prod.default_variant_id, uom_id: unitUom.id, product_qty: 50, location_id: supplierLoc.id, location_dest_id: stockLocId, unit_cost: 2.0 });

  // Batch 2: 50 units @ $3.00
  ledger.postStockMove(db, { reference: 'REC-B2', product_id: prod.default_variant_id, uom_id: unitUom.id, product_qty: 50, location_id: supplierLoc.id, location_dest_id: stockLocId, unit_cost: 3.0 });

  // Deliver 70 units -> Should deplete 50 units @ $2.00 ($100) + 20 units @ $3.00 ($60) = Total Cost $160
  ledger.postStockMove(db, { reference: 'DEL-1', product_id: prod.default_variant_id, uom_id: unitUom.id, product_qty: 70, location_id: stockLocId, location_dest_id: customerLoc.id, unit_cost: 0 });

  const val = valuation.getProductValuation(db, { product_id: prod.default_variant_id });
  assert.equal(val.inventory_qty, 30);
  assert.equal(val.inventory_value, 90); // 30 units remaining from Batch 2 @ $3.00 = $90
  assert.equal(val.unit_cost, 3.0);
});
