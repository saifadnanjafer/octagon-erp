import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from '../phase02/harness.mjs';
import { parties, uom, products, pricing } from '../../platform/commercial/index.mjs';

async function setupDb() {
  const { dialect } = await setup('wave-a');
  return dialect;
}

test('Wave A: Shared Party Identity', async () => {
  const db = await setupDb();
  const party = parties.createParty(db, {
    name: 'Al-Mansour Trading Co.',
    is_company: 1,
    tax_id: 'IQ-10029384',
    roles: ['customer', 'supplier'],
    contacts: [{ name: 'Ali Hassan', email: 'ali@mansour.iq', is_primary: 1 }],
    addresses: [{ type: 'billing', street: 'Karrada St.', city: 'Baghdad', country: 'Iraq' }],
  });

  assert.ok(party.id);
  assert.equal(party.name, 'Al-Mansour Trading Co.');
  assert.deepEqual(party.roles, ['customer', 'supplier']);
  assert.equal(party.contacts.length, 1);
  assert.equal(party.addresses.length, 1);

  const customerList = parties.getParties(db, { role: 'customer' });
  assert.equal(customerList.length, 1);
  assert.equal(customerList[0].name, 'Al-Mansour Trading Co.');
});

test('Wave A: Units of Measure & Conversions', async () => {
  const db = await setupDb();
  const cat = uom.createUomCategory(db, { name: 'Weight' });
  const kg = uom.createUom(db, { category_id: cat.id, name: 'kg', symbol: 'kg', uom_type: 'reference' });
  const g = uom.createUom(db, { category_id: cat.id, name: 'g', symbol: 'g', uom_type: 'smaller', factor: 1000 });
  const ton = uom.createUom(db, { category_id: cat.id, name: 'ton', symbol: 't', uom_type: 'bigger', factor: 1000 });

  // 1.5 kg to grams
  const grams = uom.convertUomQuantity(db, { from_uom_id: kg.id, to_uom_id: g.id, qty: 1.5 });
  assert.equal(grams, 1500);

  // 2500 g to kg
  const kgs = uom.convertUomQuantity(db, { from_uom_id: g.id, to_uom_id: kg.id, qty: 2500 });
  assert.equal(kgs, 2.5);

  // Cross-category error check
  const volCat = uom.createUomCategory(db, { name: 'Volume' });
  const liter = uom.createUom(db, { category_id: volCat.id, name: 'Liter', uom_type: 'reference' });

  assert.throws(() => {
    uom.convertUomQuantity(db, { from_uom_id: kg.id, to_uom_id: liter.id, qty: 10 });
  }, /different UOM categories/);
});

test('Wave A: Product Master & Barcodes', async () => {
  const db = await setupDb();
  const cat = products.createProductCategory(db, { name: 'Lubricants', costing_method: 'avco' });
  const tmpl = products.createProductTemplate(db, {
    name: 'Engine Oil 5W30',
    category_id: cat.id,
    list_price: 12000,
    standard_price: 8000,
    barcode: '6291002938412',
    sku: 'OIL-5W30-1L',
  });

  assert.ok(tmpl.id);
  const found = products.getProductByBarcode(db, { barcode: '6291002938412' });
  assert.ok(found);
  assert.equal(found.name, 'Engine Oil 5W30');
  assert.equal(found.sku, 'OIL-5W30-1L');

  // Duplicate barcode rejection
  assert.throws(() => {
    products.createProductVariant(db, {
      template_id: tmpl.id,
      sku: 'OIL-5W30-2L',
      name: 'Engine Oil 5W30 2L',
      barcode: '6291002938412',
    });
  }, /Barcode already in use/);
});

test('Wave A: Pricing Rules & Discount Calculation', async () => {
  const db = await setupDb();
  const cat = products.createProductCategory(db, { name: 'Filters' });
  const tmpl = products.createProductTemplate(db, {
    name: 'Oil Filter Standard',
    category_id: cat.id,
    list_price: 5000,
    sku: 'FLT-STD',
  });

  const defaultVariantId = tmpl.default_variant_id;
  const pricelist = pricing.createPricelist(db, { name: 'Wholesale Tier 1' });

  // Bulk rule: 10% discount for min_qty 10
  pricing.createPricelistItem(db, {
    price_list_id: pricelist.id,
    applied_on: 'all',
    min_quantity: 10,
    price_discount: 10,
  });

  // Base price calculation (qty 1) -> 5000
  const quote1 = pricing.calculateUnitPrice(db, { price_list_id: pricelist.id, variant_id: defaultVariantId, qty: 1 });
  assert.equal(quote1.unitPrice, 5000);

  // Bulk calculation (qty 10) -> 4500 (10% off)
  const quote10 = pricing.calculateUnitPrice(db, { price_list_id: pricelist.id, variant_id: defaultVariantId, qty: 10 });
  assert.equal(quote10.unitPrice, 4500);
  assert.equal(quote10.discount, 10);
});
