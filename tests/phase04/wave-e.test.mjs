import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from '../phase02/harness.mjs';
import { parties, products, uom } from '../../platform/commercial/index.mjs';
import { warehouses } from '../../platform/inventory/index.mjs';
import { governance, rfq, orders } from '../../platform/procurement/index.mjs';

async function setupDb() {
  const { dialect } = await setup('wave-e');
  return dialect;
}

test('Wave E: Supplier Qualification & Purchase Requisition', async () => {
  const db = await setupDb();
  const supplier = parties.createParty(db, { name: 'Baghdad Steel & Metal Co.', roles: ['supplier'] });

  const qual = governance.qualifySupplier(db, { supplier_id: supplier.id, rating: 4.8, notes: 'ISO 9001 Certified Supplier' });
  assert.equal(qual.status, 'approved');
  assert.equal(qual.rating, 4.8);

  const req = governance.createRequisition(db, {
    name: 'Q3 Workshop Rebar Supply',
    requested_by: 'Eng. Ahmed',
  });
  assert.equal(req.state, 'draft');
});

test('Wave E: RFQ, Supplier Bidding, and Contract Award', async () => {
  const db = await setupDb();
  const supp1 = parties.createParty(db, { name: 'Supplier A', roles: ['supplier'] });
  const supp2 = parties.createParty(db, { name: 'Supplier B', roles: ['supplier'] });
  const uomCat = uom.createUomCategory(db, { name: 'RFQ Units' });
  const unitUom = uom.createUom(db, { category_id: uomCat.id, name: 'RFQ Piece' });
  const category = products.createProductCategory(db, { name: 'RFQ Materials' });
  const product = products.createProductTemplate(db, {
    name: 'RFQ Material',
    category_id: category.id,
    uom_id: unitUom.id,
    sku: 'RFQ-MAT-001',
  });

  const rfqObj = rfq.createRfq(db, {
    company_id: '*',
    name: 'RFQ-2026-009',
    supplier_ids: [supp1.id, supp2.id],
    lines: [{ product_id: product.default_variant_id, quantity: 100, uom_id: unitUom.id }],
  });
  const quote1 = rfq.submitSupplierQuotation(db, {
    company_id: '*',
    rfq_id: rfqObj.id,
    supplier_id: supp1.id,
    lines: [{ rfq_line_id: rfqObj.lines[0].id, unit_price: 120 }],
  });
  const quote2 = rfq.submitSupplierQuotation(db, {
    company_id: '*',
    rfq_id: rfqObj.id,
    supplier_id: supp2.id,
    lines: [{ rfq_line_id: rfqObj.lines[0].id, unit_price: 105 }],
  });

  // Award lower bid (Supplier B)
  const awarded = rfq.awardSupplierQuotation(db, { company_id: '*', quotation_id: quote2.id });
  assert.equal(awarded.is_awarded, 1);
  assert.equal(awarded.supplier_id, supp2.id);
});

test('Wave E: unscoped direct purchase confirmation is rejected', async () => {
  const db = await setupDb();
  const supplier = parties.createParty(db, { name: 'Global Industrial Oils', roles: ['supplier'] });
  const wh = warehouses.createWarehouse(db, { name: 'Procurement WH', code: 'PRC1' });

  const uomCat = uom.createUomCategory(db, { name: 'Units' });
  const unitUom = uom.createUom(db, { category_id: uomCat.id, name: 'Pcs' });

  const cat = products.createProductCategory(db, { name: 'Fluids' });
  const prod = products.createProductTemplate(db, { name: 'Hydraulic Oil 68 20L', category_id: cat.id, uom_id: unitUom.id, standard_price: 65, sku: 'HYD-68-20L' });

  // 1. Create Purchase Order
  const po = orders.createPurchaseOrder(db, {
    supplier_id: supplier.id,
    lines: [{ product_id: prod.default_variant_id, product_qty: 100, price_unit: 65 }],
  });

  assert.equal(po.amount_total, 6500);

  assert.throws(
    () => orders.confirmPurchaseOrder(db, { order_id: po.id, warehouse_id: wh.id }),
    /Purchase order not found/,
  );
  assert.equal(orders.getPurchaseOrder(db, po.id).state, 'draft');
});
