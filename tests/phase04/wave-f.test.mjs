import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from '../phase02/harness.mjs';
import { parties, products, uom } from '../../platform/commercial/index.mjs';
import { warehouses, ledger } from '../../platform/inventory/index.mjs';
import { openPosSession, processPosOrder, getPosOrder } from '../../platform/pos/session.mjs';
import { orders as salesOrders } from '../../platform/sales/index.mjs';
import { orders as purOrders } from '../../platform/procurement/index.mjs';

async function setupDb() {
  const { dialect } = await setup('wave-f');
  return dialect;
}

test('Wave F: POS Session, Order Processing & Inventory Deduction', async () => {
  const db = await setupDb();
  const wh = warehouses.createWarehouse(db, { name: 'Retail Store WH', code: 'POS1' });
  const customer = parties.createParty(db, { name: 'Walk-in Retail Customer' });

  const uomCat = uom.createUomCategory(db, { name: 'Units' });
  const unitUom = uom.createUom(db, { category_id: uomCat.id, name: 'Pcs' });

  const cat = products.createProductCategory(db, { name: 'Snacks' });
  const prod = products.createProductTemplate(db, { name: 'Organic Almonds 200g', category_id: cat.id, uom_id: unitUom.id, list_price: 6, standard_price: 3.5, sku: 'ALM-200G' });

  // Initial stock: 100 units on hand
  const supplierLoc = warehouses.createStockLocation(db, { name: 'Suppliers', usage: 'supplier' });
  ledger.postStockMove(db, { reference: 'INIT-POS', product_id: prod.default_variant_id, uom_id: unitUom.id, product_qty: 100, location_id: supplierLoc.id, location_dest_id: wh.lot_stock_id, unit_cost: 3.5 });

  // 1. Open POS Session
  const session = openPosSession(db, { user_id: 'cashier_01' });
  assert.equal(session.state, 'opened');

  // 2. Process POS Order (2 units @ $6.00 = $12.00)
  const posOrder = processPosOrder(db, {
    session_id: session.id,
    partner_id: customer.id,
    warehouse_id: wh.id,
    lines: [{ product_id: prod.default_variant_id, qty: 2, price_unit: 6.0 }],
    payments: [{ payment_method_id: 'cash', amount: 12.0 }],
  });

  assert.equal(posOrder.state, 'paid');
  assert.equal(posOrder.amount_total, 12.0);

  // 3. Verify stock deduction (100 - 2 = 98 remaining)
  const bal = ledger.getQuantBalance(db, { product_id: prod.default_variant_id, location_id: wh.lot_stock_id });
  assert.equal(bal.onHand, 98);
});

test('Wave F: Commercial Cutover Settings & CANONICAL_ONLY Default', async () => {
  const db = await setupDb();
  const settings = db.prepare(`SELECT * FROM commercial_cutover_settings`).all();

  assert.ok(settings.length >= 5);
  const salesSetting = settings.find(s => s.module_name === 'sales');
  assert.equal(salesSetting.state, 'CANONICAL_ONLY');
});
