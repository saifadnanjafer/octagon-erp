// Canonical Operations console contract tests — visible expansion Wave 1.
//
// The console is a thin surface: it must not invent action ids, must not
// compute governed values, and must route every read/write through
// CanonicalClient. These tests lock that down.
//
// They do NOT prove the page renders — that is browser work, recorded in
// docs/evidence/visible-expansion/VISIBLE_UI_ACCEPTANCE_MATRIX.md.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..');
const clientSource = fs.readFileSync(path.join(repo, 'services', 'canonicalClient.js'), 'utf8');
const consoleSource = fs.readFileSync(path.join(repo, 'modules', 'canonical-console.js'), 'utf8');

/** Minimal DOM good enough for the module's top-level wiring to run. */
function load() {
  const calls = [];
  const listeners = {};
  const noopEl = {
    innerHTML: '', className: '', style: {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    setAttribute() {}, getAttribute() { return null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; }, addEventListener() {}, appendChild() {},
  };
  const documentStub = {
    readyState: 'complete',
    documentElement: { getAttribute: () => 'ar', setAttribute() {} },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ ...noopEl }),
    addEventListener(type, handler) { (listeners[type] = listeners[type] || []).push(handler); },
  };
  const windowStub = {
    document: documentStub,
    console: { warn() {}, error() {}, log() {} },
    CustomEvent: class { constructor(t, i) { this.type = t; this.detail = i ? i.detail : null; } },
    dispatchEvent() { return true; },
    addEventListener() {},
    removeEventListener() {},
    setInterval: () => 0,
    clearInterval: () => {},
    async fetch(url, init) {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ success: true, data: [], correlationId: 'c' }) };
    },
  };
  const context = { window: windowStub, document: documentStub, setInterval: () => 0, clearInterval: () => {} };
  context.globalThis = context;
  context.fetch = windowStub.fetch;
  vm.createContext(context);
  vm.runInContext(clientSource, context);
  vm.runInContext(consoleSource, context);
  return { mod: windowStub.CanonicalConsole, client: windowStub.CanonicalClient, calls, win: windowStub };
}

test('console module registers and exposes its domains', () => {
  const { mod } = load();
  assert.ok(mod, 'CanonicalConsole must be exposed on window');
  assert.equal(typeof mod.render, 'function');
  assert.ok(Array.isArray(mod.DOMAINS));
});

test('all eight required visible domains are present', () => {
  const { mod } = load();
  const keys = mod.DOMAINS.map((d) => d.key);
  for (const required of [
    'products', 'parties', 'inventory', 'warehouses',
    'sales', 'procurement', 'pos', 'work_items',
  ]) {
    assert.ok(keys.includes(required), `missing required domain: ${required}`);
  }
  assert.equal(mod.DOMAINS.length, 8);
});

test('every domain is bilingual', () => {
  const { mod } = load();
  for (const d of mod.DOMAINS) {
    assert.ok(d.label.ar && d.label.ar.trim(), `${d.key} missing Arabic label`);
    assert.ok(d.label.en && d.label.en.trim(), `${d.key} missing English label`);
    for (const col of d.columns) {
      assert.ok(col.label.ar && col.label.en, `${d.key}.${col.key} column not bilingual`);
    }
    if (d.create) {
      assert.ok(d.create.label.ar && d.create.label.en, `${d.key} create label not bilingual`);
      for (const f of d.create.fields) {
        assert.ok(f.label.ar && f.label.en, `${d.key}.${f.key} field not bilingual`);
      }
    }
  }
});

test('every create action id exists on the canonical client surface', async () => {
  const { mod, client, calls } = load();
  // The registered Phase 04 action surface, from platform/** source.
  const REGISTERED = new Set([
    'party:create', 'product:template:create', 'product:variant:create', 'uom:create',
    'warehouse:create', 'stock:location:create', 'stock:move:post', 'stock:quants:rebuild',
    'stock:lot:create', 'stock:serial:create', 'stock:package:create',
    'stock:reservation:reserve', 'stock:reservation:release', 'stock:reservation:consume',
    'stock:reservation:expire', 'stock:reservation:reallocate', 'stock:reservation:reverse',
    'wms:picking:validate',
    'sales:quotation:create', 'sales:order:confirm', 'sales:invoice_request:create',
    'procurement:order:create', 'procurement:order:confirm',
    'procurement:threewaymatch:perform', 'procurement:bill_request:create',
    'pos:session:open', 'pos:session:close', 'pos:order:process',
    'work_item:create', 'work_item:update', 'work_item:approve', 'work_item:delete',
  ]);

  for (const d of mod.DOMAINS) {
    if (!d.create) continue;
    assert.ok(REGISTERED.has(d.create.actionId),
      `${d.key} declares unregistered action id: ${d.create.actionId}`);

    // And the declared id must be the one actually sent on the wire.
    calls.length = 0;
    await d.create.submit(client, { name: 'x', title: 'x', code: 'C', roles: 'customer' });
    assert.equal(calls.length, 1, `${d.key} create must issue exactly one request`);
    assert.equal(
      decodeURIComponent(calls[0].url),
      `/api/v1/action/${d.create.actionId}`,
      `${d.key} sends a different action than it declares`,
    );
  }
});

test('every domain load issues a GET against a canonical query route', async () => {
  const { mod, client, calls } = load();
  for (const d of mod.DOMAINS) {
    calls.length = 0;
    await d.load(client);
    assert.equal(calls.length, 1, `${d.key} load must issue exactly one request`);
    assert.equal(calls[0].init.method, 'GET', `${d.key} load must be a read`);
    assert.ok(calls[0].url.startsWith('/api/v1/'), `${d.key} must query the canonical API`);
    assert.equal(calls[0].init.credentials, 'same-origin', `${d.key} must send the session cookie`);
  }
});

test('inventory balances are read-only — no create path on governed quantities', () => {
  const { mod } = load();
  const inventory = mod.DOMAINS.find((d) => d.key === 'inventory');
  assert.equal(inventory.create, undefined,
    'the console must not offer a direct create/edit for stock balances');
  assert.ok(inventory.note && inventory.note.ar && inventory.note.en,
    'the read-only nature of balances must be stated to the user in both languages');
});

test('sales, procurement and pos are read surfaces in this wave', () => {
  const { mod } = load();
  for (const key of ['sales', 'procurement', 'pos']) {
    const d = mod.DOMAINS.find((x) => x.key === key);
    assert.equal(d.create, undefined,
      `${key} must not expose a create until its full lifecycle workflow is built`);
  }
});

test('each domain declares the phase 04 cutover domain it belongs to', () => {
  const { mod, client } = load();
  const valid = new Set(client.PHASE04_DOMAINS);
  for (const d of mod.DOMAINS) {
    assert.ok(valid.has(d.cutoverDomain),
      `${d.key} declares unknown cutover domain: ${d.cutoverDomain}`);
  }
});

test('each domain declares a permission key for the page-level gate', () => {
  const { mod } = load();
  for (const d of mod.DOMAINS) {
    assert.ok(typeof d.permission === 'string' && d.permission.length,
      `${d.key} must declare a permission key`);
  }
});

test('the console holds no governed computation', () => {
  // Guard against drift: the console must never start computing balances,
  // availability, valuation or posting effects locally.
  const banned = [
    /available\s*=\s*.*-\s*reserved/i,
    /function\s+computeValuation/i,
    /function\s+calculateAvailable/i,
    /onHand\s*-\s*reserved/i,
  ];
  for (const pattern of banned) {
    assert.ok(!pattern.test(consoleSource),
      `console appears to compute a governed value locally: ${pattern}`);
  }
});
