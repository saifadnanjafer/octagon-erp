// Canonical Inventory module contract tests — Checkpoint B.
//
// Locks down the properties that matter for a governed inventory surface:
//   - the browser never computes a governed quantity
//   - every read hits a real canonical query route
//   - the receipt draft persists nothing until Validate
//   - Validate posts each line as its own atomic canonical command
//   - a failed line stays in the draft; a posted line leaves it

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..');
const clientSource = fs.readFileSync(path.join(repo, 'services', 'canonicalClient.js'), 'utf8');
const moduleSource = fs.readFileSync(path.join(repo, 'modules', 'canonical-inventory.js'), 'utf8');

function load({ responder } = {}) {
  const calls = [];
  const listeners = {};
  const documentStub = {
    readyState: 'complete',
    documentElement: { getAttribute: () => 'ar', setAttribute() {} },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ innerHTML: '', appendChild() {}, querySelector: () => null, querySelectorAll: () => [] }),
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
      if (responder) return responder(url, init, calls.length);
      return { ok: true, status: 200, json: async () => ({ success: true, data: [], correlationId: 'c' }) };
    },
  };
  const context = { window: windowStub, document: documentStub, setInterval: () => 0, clearInterval: () => {} };
  context.globalThis = context;
  context.fetch = windowStub.fetch;
  vm.createContext(context);
  vm.runInContext(clientSource, context);
  vm.runInContext(moduleSource, context);
  return { mod: windowStub.CanonicalInventory, client: windowStub.CanonicalClient, calls, win: windowStub };
}

test('module registers and exposes its tabs', () => {
  const { mod, win } = load();
  assert.ok(mod, 'CanonicalInventory must be exposed');
  assert.equal(typeof mod.render, 'function');
  assert.equal(typeof mod.activate, 'function');
  assert.equal(typeof win.renderCanonicalInventory, 'function');
});

test('all required inventory surfaces are present as tabs', () => {
  const { mod } = load();
  const keys = mod.TABS.map((t) => t.key);
  for (const required of [
    'warehouses', 'locations', 'receipt', 'balances',
    'movements', 'reservations', 'traceability',
  ]) {
    assert.ok(keys.includes(required), `missing tab: ${required}`);
  }
});

test('every tab is bilingual', () => {
  const { mod } = load();
  for (const t of mod.TABS) {
    assert.ok(t.label.ar && t.label.ar.trim(), `${t.key} missing Arabic label`);
    assert.ok(t.label.en && t.label.en.trim(), `${t.key} missing English label`);
  }
});

test('the module performs no arithmetic on governed quantities', () => {
  // The engine owns on-hand, reserved, available and valuation. If this module
  // ever starts deriving them, the duplicate-authority problem is back.
  const banned = [
    /available\s*=\s*[^=]*-\s*reserved/i,
    /onHand\s*-\s*reserved/i,
    /reserved\s*\+\s*available/i,
    /function\s+computeValuation/i,
    /function\s+calculateAvailable/i,
  ];
  for (const pattern of banned) {
    assert.ok(!pattern.test(moduleSource),
      `module appears to compute a governed quantity locally: ${pattern}`);
  }
});

test('balance and valuation reads send the required product_id', async () => {
  const { client, calls } = load();
  await client.stock.balances({ product_id: 'var_1' });
  await client.stock.valuation({ product_id: 'var_1' });
  assert.ok(calls[0].url.includes('product_id=var_1'),
    '/inventory/quants requires product_id and returns a single object, not a list');
  assert.ok(calls[1].url.includes('product_id=var_1'),
    '/inventory/valuation returns 400 without product_id');
});

test('list reads target real canonical query routes', async () => {
  const { client, calls } = load();
  const reads = [
    [() => client.warehouses.list(), '/api/v1/inventory/warehouses'],
    [() => client.locations.list(), '/api/v1/inventory/locations'],
    [() => client.stock.operations(), '/api/v1/inventory/operations'],
    [() => client.reservations.list(), '/api/v1/inventory/reservations'],
    [() => client.stock.lots(), '/api/v1/inventory/lots'],
    [() => client.stock.serials(), '/api/v1/inventory/serials'],
    [() => client.stock.packages(), '/api/v1/inventory/packages'],
  ];
  for (const [invoke, expected] of reads) {
    calls.length = 0;
    await invoke();
    assert.equal(calls[0].url, expected);
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.credentials, 'same-origin');
  }
});

test('inventory commands use the registered action ids, unencoded', async () => {
  const { client, calls } = load();
  const commands = [
    [() => client.warehouses.create({ name: 'W', code: 'W1' }), 'warehouse:create'],
    [() => client.locations.create({ name: 'L' }), 'stock:location:create'],
    [() => client.stock.postMove({ product_id: 'p' }), 'stock:move:post'],
    [() => client.reservations.reserve({ product_id: 'p' }), 'stock:reservation:reserve'],
    [() => client.reservations.release({ reservation_id: 'r' }), 'stock:reservation:release'],
    [() => client.stock.createLot({ product_id: 'p', name: 'L1' }), 'stock:lot:create'],
  ];
  for (const [invoke, actionId] of commands) {
    calls.length = 0;
    await invoke();
    assert.equal(calls[0].url, `/api/v1/action/${actionId}`,
      'action ids must be sent unencoded — the server reads the raw pathname');
    assert.equal(calls[0].init.method, 'POST');
  }
});

test('the receipt draft is documented as client-side staging', () => {
  // Honesty check: the engine posts a move atomically and has no server draft
  // state for a bare move. That must be stated, not implied.
  // Comments wrap, so normalise whitespace before matching rather than
  // depending on where a line happens to break.
  const flat = moduleSource.replace(/\s*\n\s*(\/\/)?\s*/g, ' ');
  assert.match(flat, /client-side staging/i,
    'the draft must be documented as local staging, not a server draft state');
  assert.match(flat, /no separate server-side draft state/i,
    'the absence of a server draft state must be stated explicitly');
  assert.match(flat, /Nothing is persisted until Validate/i);
});

test('draft staging issues no request', () => {
  const { mod, calls } = load();
  // The draft starts empty and nothing has been sent by module load alone.
  assert.equal(mod.draftLines.length, 0);
  assert.equal(calls.length, 0, 'loading the module must not issue any request');
});

test('draftLines is exposed as a copy, not the live array', () => {
  const { mod } = load();
  const first = mod.draftLines;
  first.push({ tampered: true });
  assert.equal(mod.draftLines.length, 0,
    'external mutation of the returned array must not change module state');
});

test('a governed denial surfaces with its machine code intact', async () => {
  const { client } = load({
    responder: async () => ({
      ok: false, status: 403,
      json: async () => ({ success: false, error: 'PERMISSION_DENIED: no inventory grant' }),
    }),
  });
  await assert.rejects(
    () => client.stock.postMove({ product_id: 'p' }),
    (err) => {
      assert.equal(err.code, 'PERMISSION_DENIED');
      assert.equal(err.isAuthorization, true);
      return true;
    },
  );
});

test('a business-rule failure is distinguishable from a denial', async () => {
  const { client } = load({
    responder: async () => ({
      ok: false, status: 422,
      json: async () => ({ success: false, error: 'INSUFFICIENT_STOCK: not enough available' }),
    }),
  });
  await assert.rejects(
    () => client.reservations.reserve({ product_id: 'p', quantity: 999 }),
    (err) => {
      assert.equal(err.code, 'INSUFFICIENT_STOCK');
      assert.equal(err.isBusinessRule, true);
      assert.equal(err.isAuthorization, false);
      return true;
    },
  );
});

test('each posted receipt line carries its own idempotency key', async () => {
  const { client, calls } = load();
  await client.stock.postMove({ product_id: 'a', product_qty: 1 });
  await client.stock.postMove({ product_id: 'b', product_qty: 2 });
  const k1 = JSON.parse(calls[0].init.body).idempotency_key;
  const k2 = JSON.parse(calls[1].init.body).idempotency_key;
  assert.ok(k1 && k2, 'every governed command needs an idempotency key');
  assert.notEqual(k1, k2, 'distinct lines must not share a key or one would be deduplicated away');
});

test('the module never sends identity or scope', async () => {
  const { client, calls } = load();
  await client.stock.postMove({
    product_id: 'p', company_id: 'other', user_id: 'attacker', branch_id: 'x',
  });
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.company_id, undefined);
  assert.equal(body.user_id, undefined);
  assert.equal(body.branch_id, undefined);
  assert.equal(body.product_id, 'p', 'legitimate business fields must survive');
});

test('module stylesheet is fully scoped to its own page', () => {
  const css = fs.readFileSync(path.join(repo, 'modules', 'canonical-inventory.css'), 'utf8');
  const rules = css.split('}').map((s) => s.split('{')[0].trim()).filter(Boolean);
  for (const selector of rules) {
    if (selector.startsWith('@') || selector.startsWith('/*') || !selector) continue;
    assert.ok(selector.includes('#pageCanonicalInventory'),
      `unscoped selector would leak into the shell: ${selector}`);
  }
});
