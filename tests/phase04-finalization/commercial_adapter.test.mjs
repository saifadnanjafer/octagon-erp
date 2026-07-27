// Commercial adapter contract tests — Phase 04 finalization Wave 2.
//
// Proves the strangler seam is safe in both positions:
//   - domain NOT cut over  -> legacy write runs, canonical is never called
//   - domain cut over      -> canonical runs, legacy is never called
//   - never both, and a canonical failure never falls back to a legacy write
//
// Also proves the legacy<->canonical field mapping never leaks governed
// quantities onto a product master record.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const servicesDir = path.join(here, '..', '..', 'services');
const clientSource = fs.readFileSync(path.join(servicesDir, 'canonicalClient.js'), 'utf8');
const adapterSource = fs.readFileSync(path.join(servicesDir, 'commercialAdapter.js'), 'utf8');

let calls;
let nextResponse;

function load({ commercialEnforced = false } = {}) {
  calls = [];
  nextResponse = {
    ok: true, status: 200,
    body: { success: true, data: { id: 'tmpl_1', default_variant_id: 'var_1', name: 'قطعة' }, correlationId: 'c' },
  };

  const listeners = {};
  const windowStub = {
    console: { warn() {}, error() {} },
    CustomEvent: class { constructor(t, i) { this.type = t; this.detail = i ? i.detail : null; } },
    dispatchEvent(e) { (listeners[e.type] || []).forEach((h) => h(e)); return true; },
    addEventListener(t, h) { (listeners[t] = listeners[t] || []).push(h); },
    removeEventListener() {},
    __octagonBootstrap: {
      cutover: { phase04: { enabled: true, domains: { COMMERCIAL: { enforced: commercialEnforced } } } },
    },
    async fetch(url, init) {
      calls.push({ url, init });
      const r = nextResponse;
      return { ok: r.ok, status: r.status, json: async () => r.body };
    },
  };

  const context = { window: windowStub };
  context.globalThis = context;
  context.fetch = windowStub.fetch;
  vm.createContext(context);
  vm.runInContext(clientSource, context);
  vm.runInContext(adapterSource, context);
  return { adapter: windowStub.CommercialAdapter, win: windowStub, context };
}

test('adapter registers on window and PentagonServices', () => {
  const { adapter, win } = load();
  assert.ok(adapter);
  assert.equal(win.PentagonServices.commercialAdapter, adapter);
});

test('domain not cut over: legacy write runs, canonical is never called', async () => {
  const { adapter } = load({ commercialEnforced: false });
  let legacyRan = 0;
  const outcome = await adapter.createMaterial(
    { name: 'مادة', stock: 5, cost: 10 },
    { legacyWrite: async () => { legacyRan += 1; return { id: 'mat_legacy' }; } },
  );
  assert.equal(legacyRan, 1);
  assert.equal(outcome.authority, 'legacy');
  assert.equal(outcome.material.id, 'mat_legacy');
  assert.equal(calls.length, 0, 'no canonical request may be issued while the domain is not cut over');
});

test('domain cut over: canonical runs, legacy is never called', async () => {
  const { adapter } = load({ commercialEnforced: true });
  let legacyRan = 0;
  const outcome = await adapter.createMaterial(
    { name: 'مادة', stock: 0, cost: 10, tracking: 'lot', costingMethod: 'fifo' },
    { legacyWrite: async () => { legacyRan += 1; return { id: 'mat_legacy' }; } },
  );
  assert.equal(legacyRan, 0, 'legacy writer must not run once the domain is cut over');
  assert.equal(outcome.authority, 'canonical');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/v1/action/product:template:create');
});

test('opening stock is posted as a separate governed stock move, not a product field', async () => {
  const { adapter } = load({ commercialEnforced: true });
  await adapter.createMaterial(
    { name: 'مادة', stock: 7, cost: 25 },
    {
      legacyWrite: async () => { throw new Error('must not run'); },
      uomId: 'uom_pc',
      openingSourceLocationId: 'loc_supplier',
      openingDestLocationId: 'loc_stock',
    },
  );

  assert.equal(calls.length, 2, 'product create then opening move');
  assert.equal(calls[0].url, '/api/v1/action/product:template:create');
  assert.equal(calls[1].url, '/api/v1/action/stock:move:post');

  const productBody = JSON.parse(calls[0].init.body);
  assert.equal(productBody.stock, undefined, 'governed quantity must never ride on a product create');
  assert.equal(productBody.reserved, undefined);
  assert.equal(productBody.movements, undefined);

  const moveBody = JSON.parse(calls[1].init.body);
  assert.equal(moveBody.product_qty, 7);
  assert.equal(moveBody.unit_cost, 25);
  assert.equal(moveBody.product_id, 'var_1');
  assert.equal(moveBody.source_document_type, 'inventory_adjustment');
});

test('zero opening stock posts no stock move', async () => {
  const { adapter } = load({ commercialEnforced: true });
  await adapter.createMaterial({ name: 'مادة', stock: 0 }, { legacyWrite: async () => ({}) });
  assert.equal(calls.length, 1, 'only the product create');
});

test('canonical failure does not fall back to a legacy write', async () => {
  const { adapter } = load({ commercialEnforced: true });
  let legacyRan = 0;
  nextResponse = { ok: false, status: 422, body: { success: false, error: 'VALIDATION_FAILED: sku already exists' } };
  await assert.rejects(
    () => adapter.createMaterial(
      { name: 'مادة' },
      { legacyWrite: async () => { legacyRan += 1; return {}; } },
    ),
    (err) => { assert.equal(err.code, 'VALIDATION_FAILED'); return true; },
  );
  assert.equal(legacyRan, 0, 'a failed canonical write must never be retried against the legacy authority');
});

test('material projection never carries governed quantities', () => {
  const { adapter } = load({ commercialEnforced: true });
  const projected = adapter._map.productToMaterialProjection(
    { id: 'tmpl_1', default_variant_id: 'var_1', name: 'قطعة', costing_method: 'fifo', standard_cost: 12 },
    { name: 'legacy', stock: 999, reserved: 50, unit: 'قطعة', category: 'عام' },
  );
  assert.equal(projected.stock, 0, 'balances come from canonical inventory queries, never a projection');
  assert.equal(projected.reserved, 0);
  // Realm-safe: the adapter runs inside a vm context, so arrays it creates do
  // not share the outer realm's Array prototype and strict deep-equality would
  // fail on prototype identity rather than on content.
  assert.equal(projected.movements.length, 0);
  assert.equal(projected.reservations.length, 0);
  assert.equal(projected.authority, 'canonical');
  assert.equal(projected.canonicalVariantId, 'var_1');
  assert.equal(projected.unit, 'قطعة', 'workshop vocabulary is preserved');
});

test('customer and supplier map to canonical parties with the right role', async () => {
  const { adapter } = load({ commercialEnforced: true });
  nextResponse = { ok: true, status: 200, body: { success: true, data: { id: 'party_1', name: 'زبون' } } };

  await adapter.createCustomer({ name: 'زبون' }, { legacyWrite: async () => ({}) });
  const customerRoles = JSON.parse(calls[0].init.body).roles;
  assert.ok(Array.isArray(customerRoles), 'roles must survive the forbidden-key strip');
  assert.deepStrictEqual([...customerRoles], ['customer']);

  calls = [];
  await adapter.createSupplier({ name: 'مورد' }, { legacyWrite: async () => ({}) });
  const supplierRoles = JSON.parse(calls[0].init.body).roles;
  assert.deepStrictEqual([...supplierRoles], ['supplier']);
});

test('party mapping carries governed identifiers when supplied', () => {
  const { adapter } = load({ commercialEnforced: true });
  const input = adapter._map.partyToCanonicalInput('supplier', {
    name: 'مورد', taxId: 'TAX-1', registrationNumber: 'REG-1', isCompany: true,
  });
  assert.equal(input.tax_id, 'TAX-1');
  assert.equal(input.registration_number, 'REG-1');
  assert.equal(input.is_company, 1);
  // Spread to the outer realm before comparing (vm-created array).
  assert.deepStrictEqual([...input.roles], ['supplier']);
});

test('tracking and costing values map to the canonical vocabulary', () => {
  const { adapter } = load();
  const input = adapter._map.materialToProductInput({ name: 'x', tracking: 'serial', costingMethod: 'lifo' });
  assert.equal(input.tracking, 'serial');
  assert.equal(input.costing_method, 'lifo');
  const fallback = adapter._map.materialToProductInput({ name: 'x', tracking: 'bogus', costingMethod: 'bogus' });
  assert.equal(fallback.tracking, 'none', 'unknown tracking falls back to none, never passed through');
  assert.equal(fallback.costing_method, 'avco');
});

test('canonicalActive reflects the server decision only', () => {
  assert.equal(load({ commercialEnforced: false }).adapter.canonicalActive(), false);
  assert.equal(load({ commercialEnforced: true }).adapter.canonicalActive(), true);
});

test('adapter is inert when the canonical client is absent', async () => {
  const { adapter, win } = load({ commercialEnforced: true });
  delete win.CanonicalClient;
  let legacyRan = 0;
  const outcome = await adapter.createMaterial({ name: 'x' }, { legacyWrite: async () => { legacyRan += 1; return { id: 'l' }; } });
  assert.equal(legacyRan, 1, 'with no canonical client the legacy path must still work');
  assert.equal(outcome.authority, 'legacy');
});

test('listMaterials returns the legacy array untouched when not cut over', async () => {
  const { adapter } = load({ commercialEnforced: false });
  const legacy = [{ id: 'm1', name: 'مادة', stock: 12 }];
  const result = await adapter.listMaterials({ legacyRead: async () => legacy });
  assert.equal(result.authority, 'legacy');
  assert.deepEqual(result.items, legacy);
  assert.equal(calls.length, 0);
});
