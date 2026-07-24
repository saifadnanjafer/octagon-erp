import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from '../phase02/harness.mjs';
import { parties, products, uom } from '../../platform/commercial/index.mjs';
import { warehouses } from '../../platform/inventory/index.mjs';
import { crm, orders } from '../../platform/sales/index.mjs';

async function setupDb() {
  const { dialect } = await setup('wave-d');
  return dialect;
}

test('Wave D: CRM Lead Lifecycle & Stage Progression', async () => {
  const db = await setupDb();
  const customer = parties.createParty(db, { name: 'Basra Industrial Co.' });

  const lead = crm.createLead(db, {
    name: 'Heavy Equipment Supply Deal',
    partner_id: customer.id,
    expected_revenue: 50000,
    probability: 20,
  });

  assert.equal(lead.stage, 'new');
  assert.equal(lead.expected_revenue, 50000);

  const updated = crm.updateLeadStage(db, { id: lead.id, stage: 'proposition' });
  assert.equal(updated.stage, 'proposition');
});

test('Wave D: Quotation, Pricing Integration, and Order Totals', async () => {
  const db = await setupDb();
  const customer = parties.createParty(db, { name: 'Titan Contractors' });

  const uomCat = uom.createUomCategory(db, { name: 'Units' });
  const unitUom = uom.createUom(db, { category_id: uomCat.id, name: 'Pcs' });

  const cat = products.createProductCategory(db, { name: 'Machinery' });
  const prod = products.createProductTemplate(db, { name: 'Generator 50kVA', category_id: cat.id, uom_id: unitUom.id, list_price: 15000, sku: 'GEN-50' });

  const quote = orders.createQuotation(db, {
    partner_id: customer.id,
    lines: [
      { product_id: prod.default_variant_id, product_uom_qty: 2, price_unit: 15000 },
    ],
  });

  assert.equal(quote.state, 'draft');
  assert.equal(quote.amount_untaxed, 30000);
  assert.equal(quote.amount_total, 30000);
});

test('Wave D: unscoped direct order confirmation is rejected', async () => {
  const db = await setupDb();
  const customer = parties.createParty(db, { name: 'Sumer Logistics' });
  const wh = warehouses.createWarehouse(db, { name: 'Sales WH', code: 'SLS1' });

  const uomCat = uom.createUomCategory(db, { name: 'Units' });
  const unitUom = uom.createUom(db, { category_id: uomCat.id, name: 'Pcs' });

  const cat = products.createProductCategory(db, { name: 'Tires' });
  const prod = products.createProductTemplate(db, { name: 'Truck Tire 295/80', category_id: cat.id, uom_id: unitUom.id, list_price: 400, sku: 'TRK-295' });

  const quote = orders.createQuotation(db, {
    partner_id: customer.id,
    lines: [{ product_id: prod.default_variant_id, product_uom_qty: 10, price_unit: 400 }],
  });

  assert.throws(
    () => orders.confirmSalesOrder(db, { order_id: quote.id, warehouse_id: wh.id }),
    /Sale order not found/,
  );
  assert.equal(orders.getSaleOrder(db, quote.id).state, 'draft');
});
