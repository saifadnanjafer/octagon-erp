// Disposable legacy commercial compatibility fixtures.
//
// Supplier Portal and Sales Price Lists are established Workshop surfaces that
// still read the browser application's full-state `omni.*` collections rather
// than a canonical domain (see BUILD13_FEATURE_GAP_REGISTER GAP-004). A fresh
// review database seeds the canonical tables but leaves those legacy
// collections empty, so both pages render an honest empty state and score THIN
// for want of a record rather than for want of an implementation.
//
// This seeds the smallest fictional set that exercises each page's real
// derivation: one material below its minimum stock (Supplier Portal derives its
// RFQ signal from exactly that condition), one material comfortably above it as
// a negative control, two registered suppliers, and one open purchase order for
// the follow-up panel. Every record is explicitly marked as a disposable review
// fixture and is never operational truth.

'use strict';

const MATERIALS = [
  // [id, name, stock, minStock, unit, price] — the first is deliberately below
  // its minimum so the shortage derivation has something real to find.
  ['mat_review_steel_tube_40', 'أنبوب حديد مربع 40 ملم', 4, 25, 'عدد', 12500],
  ['mat_review_gate_hinge', 'طقم مفصلات بوابة ثقيل', 60, 10, 'طقم', 22000],
];

const SUPPLIERS = [
  ['sup_review_metals', 'مورد مراجعة — معادن وأنابيب', 'review.metals@review.invalid'],
  ['sup_review_hardware', 'مورد مراجعة — عدة وأدوات', 'review.hardware@review.invalid'],
];

export function seedLegacyCommercialFixtures(dialect, { tenantId, companyId, branchId, now } = {}) {
  const timestamp = now || new Date().toISOString();
  const upsert = dialect.prepare(`
    INSERT INTO collections (collection, id, data) VALUES (?, ?, ?)
    ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data
  `);
  const upsertMeta = dialect.prepare(`
    INSERT INTO metadata (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  const scope = { tenantId, companyId, branchId, source: 'disposable-review-fixture' };

  for (const [id, name, stock, minStock, unit, price] of MATERIALS) {
    upsert.run('omni.materials', id, JSON.stringify({
      id, name, stock, minStock, unit, price,
      is_active: true, createdAt: timestamp, updatedAt: timestamp, ...scope,
    }));
  }

  for (const [id, name, email] of SUPPLIERS) {
    upsert.run('omni.suppliers', id, JSON.stringify({
      id, name, email, phone: '', address: '',
      is_active: true, createdAt: timestamp, updatedAt: timestamp, ...scope,
    }));
  }

  const poId = 'po_review_steel_tube_01';
  const expected = new Date(Date.parse(timestamp) + 7 * 86400000).toISOString().slice(0, 10);
  upsert.run('omni.purchaseOrders', poId, JSON.stringify({
    id: poId,
    reference: 'REV-PO-0001',
    supplierId: SUPPLIERS[0][0],
    supplierName: SUPPLIERS[0][1],
    status: 'open',
    date: timestamp.slice(0, 10),
    expectedDate: expected,
    total: 312500,
    lines: [{ materialId: MATERIALS[0][0], name: MATERIALS[0][1], qty: 25, price: 12500 }],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...scope,
  }));

  // `omni.priceLists` is an object ({lists, items}), not an array, so the server's
  // collection extractor stores it as a metadata blob rather than per-id rows.
  // Seed one wholesale list carrying one priced line for the low-stock material,
  // so Sales Price Lists is not THIN purely for want of a record. Its create /
  // lookup / persist path is exercised separately through the page itself.
  const priceListId = 'spl_review_wholesale_01';
  upsertMeta.run('omni.priceLists', JSON.stringify({
    lists: [{
      id: priceListId,
      name: 'قائمة أسعار المراجعة — جملة',
      type: 'wholesale',
      customerId: '',
      active: true,
      createdAt: timestamp,
      ...scope,
    }],
    items: [{
      id: 'spli_review_wholesale_line_01',
      listId: priceListId,
      materialId: MATERIALS[0][0],
      materialName: MATERIALS[0][1],
      price: 13750,
      minQty: 1,
      createdAt: timestamp,
      ...scope,
    }],
  }));

  return {
    summary: {
      priceLists: 1,
      priceListItems: 1,
      materialsCreated: MATERIALS.length,
      materialsBelowMinimum: 1,
      suppliersCreated: SUPPLIERS.length,
      openPurchaseOrders: 1,
      collections: ['omni.materials', 'omni.suppliers', 'omni.purchaseOrders'],
      metadata: ['omni.priceLists'],
      tenantId,
      companyId,
      branchId,
    },
  };
}

export default seedLegacyCommercialFixtures;
