// Checkpoint C2 — canonical Procurement browser module contracts.
//
// These deterministic checks prove the visible module owns the original
// Procurement page, exposes the required procure-to-pay areas, and routes
// reads and commands only through the canonical client.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const clientSource = fs.readFileSync(path.join(repo, 'services', 'canonicalClient.js'), 'utf8');
const moduleSource = fs.readFileSync(path.join(repo, 'modules', 'canonical-procurement.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(repo, 'modules', 'canonical-procurement.css'), 'utf8');
const htmlSource = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
const legacySource = fs.readFileSync(path.join(repo, 'modules', 'procurement.js'), 'utf8');

function load() {
  const calls = [];
  const documentStub = {
    documentElement: { lang: 'ar', dir: 'rtl' },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const windowStub = {
    document: documentStub,
    console: { warn() {}, error() {}, log() {} },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    CustomEvent: class {},
    prompt() { return null; },
    async fetch(url, init) {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ success: true, data: [], correlationId: 'c2' }) };
    },
  };
  const context = {
    window: windowStub,
    document: documentStub,
    fetch: windowStub.fetch,
    FormData: class {},
    Intl,
    Date,
    setTimeout,
    clearTimeout,
    getComputedStyle: () => ({ display: 'none' }),
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(clientSource, context);
  vm.runInContext(moduleSource, context);
  return { client: windowStub.CanonicalClient, mod: windowStub.CanonicalProcurement, calls, windowStub };
}

test('Procurement workspace registers after the legacy Procurement renderer', () => {
  const { mod, windowStub } = load();
  assert.ok(mod);
  assert.equal(typeof mod.activate, 'function');
  assert.equal(typeof mod.refresh, 'function');
  assert.equal(typeof windowStub.renderProcurement, 'function');
  assert.match(htmlSource, /modules\/procurement\.js[\s\S]*modules\/canonical-procurement\.js/,
    'canonical Procurement must load after the legacy renderer');
  assert.match(moduleSource, /getElementById\('pageProcurement'\)\s*\|\|/);
  assert.match(moduleSource, /__canonicalProcurementAuthorityActive\s*=\s*true/);
  assert.match(legacySource, /__canonicalProcurementAuthorityActive\s*===\s*true\)\s*return/);
});

test('all required visible Procurement areas are separate bilingual tabs', () => {
  const { mod } = load();
  const required = [
    'dashboard', 'requests', 'requisitions', 'rfqs', 'supplier-quotations',
    'comparison', 'orders', 'receipts', 'three-way-match', 'bill-requests',
    'returns', 'supplier-performance',
  ];
  assert.deepEqual(Array.from(mod.TABS, (tab) => tab.key).slice(0, required.length), required);
  assert.equal(mod.TABS.at(-1).key, 'reports');
  for (const tab of mod.TABS) {
    assert.ok(tab.label.ar.trim(), `${tab.key} missing Arabic label`);
    assert.ok(tab.label.en.trim(), `${tab.key} missing English label`);
  }
});

test('Procurement reads target canonical query routes', async () => {
  const { client, calls } = load();
  const cases = [
    [() => client.procurement.listRequests(), '/api/v1/procurement/requests'],
    [() => client.procurement.listRequisitions(), '/api/v1/procurement/requisitions'],
    [() => client.procurement.listRfqs(), '/api/v1/procurement/rfqs'],
    [() => client.procurement.listSupplierQuotations(), '/api/v1/procurement/supplier-quotations'],
    [() => client.procurement.compareSupplierQuotations('rfq-1'), '/api/v1/procurement/comparison?rfq_id=rfq-1'],
    [() => client.procurement.listOrders(), '/api/v1/procurement/orders'],
    [() => client.procurement.listReceipts(), '/api/v1/procurement/receipts'],
    [() => client.procurement.listQualityChecks(), '/api/v1/procurement/quality-checks'],
    [() => client.procurement.listMatches(), '/api/v1/procurement/matches'],
    [() => client.procurement.listMismatches(), '/api/v1/procurement/mismatch-worklist'],
    [() => client.procurement.listBillRequests(), '/api/v1/procurement/bill-requests'],
    [() => client.procurement.listReturns(), '/api/v1/procurement/returns'],
    [() => client.procurement.listSupplierPerformance(), '/api/v1/procurement/supplier-performance'],
  ];
  for (const [invoke, expected] of cases) {
    calls.length = 0;
    await invoke();
    assert.equal(calls[0].url, expected);
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.credentials, 'same-origin');
  }
});

test('Procurement lifecycle commands use exact registered action ids', async () => {
  const { client, calls } = load();
  const cases = [
    [() => client.procurement.createRequest({}), 'procurement:request:create'],
    [() => client.procurement.submitRequest({}), 'procurement:request:submit'],
    [() => client.procurement.approveRequest({}), 'procurement:request:approve'],
    [() => client.procurement.approveRequisition({}), 'procurement:requisition:approve'],
    [() => client.procurement.createRfq({}), 'procurement:rfq:create'],
    [() => client.procurement.recordSupplierQuotation({}), 'procurement:supplier_quotation:record'],
    [() => client.procurement.awardSupplierQuotation({}), 'procurement:supplier_quotation:award'],
    [() => client.procurement.createOrder({}), 'procurement:order:create'],
    [() => client.procurement.approveOrder({}), 'procurement:order:approve'],
    [() => client.procurement.confirmOrder({}), 'procurement:order:confirm'],
    [() => client.procurement.postReceipt({}), 'procurement:receipt:post'],
    [() => client.procurement.threeWayMatch({}), 'procurement:threewaymatch:perform'],
    [() => client.procurement.createBillRequest({}), 'procurement:bill_request:create'],
    [() => client.procurement.createReturn({}), 'procurement:return:create'],
    [() => client.procurement.recordSupplierScore({}), 'procurement:score:record'],
  ];
  for (const [invoke, actionId] of cases) {
    calls.length = 0;
    await invoke();
    assert.equal(calls[0].url, `/api/v1/action/${actionId}`);
    assert.equal(calls[0].init.method, 'POST');
    assert.ok(JSON.parse(calls[0].init.body).idempotency_key,
      `${actionId} must carry an idempotency key`);
  }
});

test('visible Procurement writer has no legacy persistence fallback', () => {
  for (const forbidden of [
    /\bsaveData\s*\(/,
    /\bRepo\.(save|remove)\s*\(/,
    /\blocalStorage\.setItem\s*\(/,
    /\bStateService\.(save|mutate)\s*\(/,
  ]) {
    assert.ok(!forbidden.test(moduleSource), `legacy write fallback found: ${forbidden}`);
  }
  assert.match(moduleSource, /CanonicalClient/);
  assert.match(moduleSource, /ActionExecutor/);
});

test('visible Procurement exposes governed comparison, receipt, match, return, score and Finance links', () => {
  for (const pattern of [
    /data-cp-form="request"/,
    /data-cp-form="rfq"/,
    /data-cp-form="supplier-quotation"/,
    /award-quotation/,
    /receive-order/,
    /match-order/,
    /bill-order/,
    /return-order/,
    /score-order/,
    /procurement\.postReceipt/,
    /procurement\.threeWayMatch/,
    /procurement\.recordSupplierScore/,
    /data-cp-finance-link/,
  ]) {
    assert.match(moduleSource, pattern);
  }
  assert.doesNotMatch(moduleSource, /stock\.validatePicking/);
  assert.match(moduleSource, /cp-loading/);
  assert.match(moduleSource, /cp-empty/);
  assert.match(moduleSource, /isAuthorization/);
  assert.match(moduleSource, /state\.error/);
});

test('Procurement stylesheet is scoped and contains responsive RTL/LTR gates', () => {
  const selectors = cssSource.split('}').map((part) => part.split('{')[0].trim()).filter(Boolean);
  for (const selector of selectors) {
    if (selector.startsWith('@') || selector.startsWith('/*')) continue;
    assert.ok(selector.includes('#pageProcurement'), `unscoped selector: ${selector}`);
  }
  assert.match(cssSource, /@media \(max-width: 1100px\)/);
  assert.match(cssSource, /@media \(max-width: 700px\)/);
  assert.match(cssSource, /\[dir="rtl"\]/);
  assert.match(cssSource, /\[dir="ltr"\]/);
});
