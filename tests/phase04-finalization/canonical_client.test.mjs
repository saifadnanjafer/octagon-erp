// Canonical client layer contract tests — Phase 04 finalization Wave 1.
//
// These are deterministic contract tests over the browser client. They prove
// the transport rules the Phase 04 gate depends on:
//   - identity/scope fields are never transmitted
//   - session cookie is the only identity carrier
//   - idempotency + correlation are always present on commands
//   - the canonical envelope is unwrapped and errors are typed, not swallowed
//   - governed denials keep their machine code
//   - the server cutover decision outranks client flags
//   - failures fail closed (never a silent legacy write)
//
// They do NOT prove browser behavior. Real Chromium acceptance is a separate
// suite (Wave 7).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { beforeEach, test } from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientSource = fs.readFileSync(path.join(here, '..', '..', 'services', 'canonicalClient.js'), 'utf8');

let calls;
let nextResponse;
let sandbox;
// The client resolves the global `fetch` at call time (same pattern as
// services/financeService.js), so a test that wants to simulate a transport
// failure must replace the VM global, not window.fetch.
let vmContext;

/** Build a fresh browser-like sandbox with a recording fetch. */
function loadClient({ bootstrap = undefined, flags = undefined, localStorage = undefined } = {}) {
  calls = [];
  nextResponse = { ok: true, status: 200, body: { success: true, data: { ok: true }, meta: null, correlationId: 'srv-corr' } };

  const listeners = {};
  const windowStub = {
    console: { warn() {}, error() {} },
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init ? init.detail : null; }
    },
    dispatchEvent(event) {
      (listeners[event.type] || []).forEach((h) => h(event));
      return true;
    },
    addEventListener(type, handler) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(handler);
    },
    removeEventListener(type, handler) {
      listeners[type] = (listeners[type] || []).filter((h) => h !== handler);
    },
    async fetch(url, init) {
      calls.push({ url, init });
      const r = nextResponse;
      return {
        ok: r.ok,
        status: r.status,
        json: async () => r.body,
      };
    },
  };
  if (bootstrap !== undefined) windowStub.__octagonBootstrap = bootstrap;
  if (flags !== undefined) windowStub.OCTAGON_FEATURE_FLAGS = flags;
  if (localStorage !== undefined) windowStub.localStorage = localStorage;

  const context = { window: windowStub };
  context.globalThis = context;
  context.fetch = windowStub.fetch;
  vm.createContext(context);
  vm.runInContext(clientSource, context);
  sandbox = windowStub;
  vmContext = context;
  return windowStub.CanonicalClient;
}

beforeEach(() => { loadClient(); });

test('client registers on window and PentagonServices', () => {
  const client = loadClient();
  assert.ok(client, 'CanonicalClient must be exposed');
  assert.equal(sandbox.PentagonServices.canonicalClient, client);
});

test('commands never transmit identity or scope fields', async () => {
  const client = loadClient();
  await client.parties.create({
    name: 'Acme',
    // every one of these must be stripped
    user_id: 'attacker',
    userId: 'attacker',
    company_id: 'other-company',
    companyId: 'other-company',
    branch_id: 'other-branch',
    tenant_id: 'other-tenant',
    role: 'owner',
    permissions: ['*'],
    session_id: 'forged',
    approved_by: 'forged-approver',
    posting_status: 'posted',
    valuation: 999999,
    tax_result: 0,
    account_mapping: 'acc_999999',
  });

  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.name, 'Acme', 'legitimate business field must survive');
  for (const forbidden of [
    'user_id', 'userId', 'company_id', 'companyId', 'branch_id', 'tenant_id',
    'role', 'permissions', 'session_id', 'approved_by', 'posting_status',
    'valuation', 'tax_result', 'account_mapping',
  ]) {
    assert.equal(body[forbidden], undefined, `${forbidden} must never be sent`);
  }
});

test('session cookie is the only identity carrier', async () => {
  const client = loadClient();
  await client.products.list({ limit: 10 });
  const { init } = calls[0];
  assert.equal(init.credentials, 'same-origin', 'must send the session cookie');
  const headerNames = Object.keys(init.headers).map((h) => h.toLowerCase());
  assert.ok(!headerNames.includes('authorization'), 'must not send a bearer token');
  assert.ok(!headerNames.some((h) => h === 'x-user' || h === 'x-company' || h === 'x-branch'),
    'must not send spoofable identity headers');
});

test('every command carries an idempotency key and correlation id', async () => {
  const client = loadClient();
  await client.stock.postMove({ reference: 'RCPT-1', product_qty: 3 });
  const { init, url } = calls[0];
  assert.equal(url, '/api/v1/action/stock%3Amove%3Apost');
  assert.ok(init.headers['x-idempotency-key'], 'idempotency header required');
  assert.ok(init.headers['x-correlation-id'], 'correlation header required');
  const body = JSON.parse(init.body);
  assert.equal(body.idempotency_key, init.headers['x-idempotency-key'],
    'body key and header key must agree so a retry is deduplicated');
});

test('a caller-supplied idempotency key is honoured for safe retries', async () => {
  const client = loadClient();
  await client.stock.postMove({ reference: 'RCPT-2' }, { idempotencyKey: 'stable-key-1' });
  await client.stock.postMove({ reference: 'RCPT-2' }, { idempotencyKey: 'stable-key-1' });
  assert.equal(JSON.parse(calls[0].init.body).idempotency_key, 'stable-key-1');
  assert.equal(JSON.parse(calls[1].init.body).idempotency_key, 'stable-key-1');
});

test('envelope is unwrapped to data', async () => {
  const client = loadClient();
  nextResponse = {
    ok: true, status: 200,
    body: { success: true, data: [{ id: 'p1' }], meta: { total: 1 }, correlationId: 'c1' },
  };
  const rows = await client.products.list();
  assert.deepEqual(rows, [{ id: 'p1' }]);
});

test('queryWithMeta exposes pagination metadata', async () => {
  const client = loadClient();
  nextResponse = {
    ok: true, status: 200,
    body: { success: true, data: [], meta: { total: 42 }, correlationId: 'c2' },
  };
  const result = await client.queryWithMeta('/commercial/products', { limit: 10 });
  assert.equal(result.meta.total, 42);
  assert.equal(result.correlationId, 'c2');
});

test('governed denial preserves the machine code and maps to authorization', async () => {
  const client = loadClient();
  nextResponse = {
    ok: false, status: 403,
    body: { success: false, error: 'PERMISSION_DENIED: stock write requires inventory grant', correlationId: 'c3' },
  };
  await assert.rejects(
    () => client.stock.postMove({ reference: 'NOPE' }),
    (err) => {
      assert.equal(err.name, 'CanonicalError');
      assert.equal(err.code, 'PERMISSION_DENIED');
      assert.equal(err.status, 403);
      assert.equal(err.isAuthorization, true);
      assert.equal(err.message, 'stock write requires inventory grant');
      assert.equal(err.correlationId, 'c3');
      return true;
    },
  );
});

test('business-rule denial (422) is distinguishable from authorization', async () => {
  const client = loadClient();
  nextResponse = {
    ok: false, status: 422,
    body: { success: false, error: 'OPENING_CUTOVER_DATE_REQUIRED: approved opening date missing' },
  };
  await assert.rejects(
    () => client.stock.postMove({ reference: 'X' }),
    (err) => {
      assert.equal(err.code, 'OPENING_CUTOVER_DATE_REQUIRED');
      assert.equal(err.isBusinessRule, true);
      assert.equal(err.isAuthorization, false);
      return true;
    },
  );
});

test('success:false with HTTP 200 is still treated as failure', async () => {
  const client = loadClient();
  nextResponse = { ok: true, status: 200, body: { success: false, error: 'INTERNAL: bad state' } };
  await assert.rejects(() => client.parties.create({ name: 'x' }), /bad state/);
});

test('network failure fails closed as a typed error, never a silent fallback', async () => {
  const client = loadClient();
  vmContext.fetch = async () => { throw new Error('connection refused'); };
  await assert.rejects(
    () => client.stock.postMove({ reference: 'X' }),
    (err) => {
      assert.equal(err.name, 'CanonicalError');
      assert.match(err.message, /unreachable/);
      return true;
    },
  );
});

test('optimistic concurrency version is sent as If-Match', async () => {
  const client = loadClient();
  await client.workItems.update({ id: 'wi1', title: 'new' }, { expectVersion: 7 });
  assert.equal(calls[0].init.headers['if-match'], '7');
});

test('conflict maps to isConflict', async () => {
  const client = loadClient();
  nextResponse = { ok: false, status: 409, body: { success: false, error: 'VERSION_CONFLICT: record changed' } };
  await assert.rejects(
    () => client.workItems.update({ id: 'wi1' }, { expectVersion: 1 }),
    (err) => { assert.equal(err.isConflict, true); return true; },
  );
});

test('server cutover decision outranks client flags', () => {
  const client = loadClient({
    bootstrap: { cutover: { phase04: { enabled: true, domains: { INVENTORY: { enforced: false } } } } },
    flags: { FF_CANONICAL_INVENTORY: true },
    localStorage: { getItem: () => '1' },
  });
  assert.equal(client.isCanonical('INVENTORY'), false,
    'a client flag must not be able to claim a domain is cut over');
});

test('client flag applies only when the server has no opinion', () => {
  const client = loadClient({ flags: { FF_CANONICAL_SALES: true } });
  assert.equal(client.isCanonical('SALES'), true);
  assert.equal(client.isCanonical('POS'), false, 'unset domain defaults to not cut over');
});

test('cutover defaults to false with no bootstrap, no flags, no storage', () => {
  const client = loadClient();
  for (const domain of client.PHASE04_DOMAINS) {
    assert.equal(client.isCanonical(domain), false, `${domain} must default to not cut over`);
  }
});

test('cutoverStatus reports every phase 04 domain', () => {
  const client = loadClient({
    bootstrap: {
      cutover: {
        finance: { enforced: true },
        phase04: { enabled: true, canonicalAuthority: 'platform.commercial', domains: { POS: { enforced: true, lock: { status: 'RETIRED' } } } },
      },
    },
  });
  const status = client.cutoverStatus();
  assert.equal(status.enabled, true);
  assert.equal(status.financeEnforced, true);
  assert.equal(status.domains.POS.enforced, true);
  assert.equal(status.domains.POS.lock.status, 'RETIRED');
  assert.equal(status.domains.INVENTORY.enforced, false);
  assert.equal(Object.keys(status.domains).length, 6);
});

test('successful command emits a UI refresh event with its domain', async () => {
  const client = loadClient();
  const seen = [];
  client.onChanged((e) => seen.push(e.detail));
  await client.reservations.reserve({ product_id: 'p1', quantity: 2 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].domain, 'INVENTORY');
  assert.equal(seen[0].actionId, 'stock:reservation:reserve');
});

test('failed command emits no refresh event', async () => {
  const client = loadClient();
  const seen = [];
  client.onChanged((e) => seen.push(e.detail));
  nextResponse = { ok: false, status: 422, body: { success: false, error: 'INSUFFICIENT_STOCK: no' } };
  await assert.rejects(() => client.reservations.reserve({ product_id: 'p1', quantity: 99 }));
  assert.equal(seen.length, 0, 'a rejected write must not tell the UI something changed');
});

test('shadow comparison reports drift without writing', () => {
  const client = loadClient();
  const match = client.shadowCompare('on_hand', 10, 10);
  assert.equal(match.match, true);
  assert.equal(match.delta, 0);

  const drift = client.shadowCompare('on_hand', 10, 7);
  assert.equal(drift.match, false);
  assert.equal(drift.delta, 3);
  assert.equal(calls.length, 0, 'shadow comparison must never issue a request');
});

test('shadow comparison honours a numeric tolerance', () => {
  const client = loadClient();
  assert.equal(client.shadowCompare('valuation', 100.004, 100.0, { tolerance: 0.01 }).match, true);
  assert.equal(client.shadowCompare('valuation', 100.5, 100.0, { tolerance: 0.01 }).match, false);
});

test('query strings drop empty values and encode the rest', () => {
  const client = loadClient();
  const qs = client._internal.buildQueryString({ a: 1, b: '', c: null, d: undefined, e: 'x y' });
  assert.equal(qs, '?a=1&e=x%20y');
});

test('read paths issue GET and carry no body', async () => {
  const client = loadClient();
  await client.stock.balances({ product_id: 'p1' });
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[0].url, '/api/v1/inventory/quants?product_id=p1');
});

test('every phase 04 domain namespace is present with its canonical actions', () => {
  const client = loadClient();
  const expected = {
    parties: ['create'],
    products: ['createTemplate', 'createVariant'],
    uoms: ['create'],
    warehouses: ['create'],
    locations: ['create'],
    stock: ['postMove', 'rebuildQuants', 'createLot', 'createSerial', 'createPackage', 'validatePicking'],
    reservations: ['reserve', 'release', 'consume', 'expire', 'reallocate', 'reverse'],
    sales: ['createQuotation', 'confirmOrder', 'createInvoiceRequest'],
    procurement: ['createOrder', 'confirmOrder', 'threeWayMatch', 'createBillRequest'],
    pos: ['openSession', 'closeSession', 'processOrder'],
    workItems: ['create', 'update', 'approve', 'remove'],
  };
  for (const [ns, methods] of Object.entries(expected)) {
    assert.ok(client[ns], `namespace ${ns} must exist`);
    for (const m of methods) {
      assert.equal(typeof client[ns][m], 'function', `${ns}.${m} must be a function`);
    }
  }
});

test('action ids match the registered canonical action surface', async () => {
  const client = loadClient();
  const cases = [
    [() => client.parties.create({}), 'party:create'],
    [() => client.products.createTemplate({}), 'product:template:create'],
    [() => client.uoms.create({}), 'uom:create'],
    [() => client.warehouses.create({}), 'warehouse:create'],
    [() => client.locations.create({}), 'stock:location:create'],
    [() => client.stock.postMove({}), 'stock:move:post'],
    [() => client.stock.validatePicking({}), 'wms:picking:validate'],
    [() => client.reservations.consume({}), 'stock:reservation:consume'],
    [() => client.sales.confirmOrder({}), 'sales:order:confirm'],
    [() => client.procurement.threeWayMatch({}), 'procurement:threewaymatch:perform'],
    [() => client.pos.processOrder({}), 'pos:order:process'],
    [() => client.workItems.approve({}), 'work_item:approve'],
  ];
  for (const [invoke, actionId] of cases) {
    calls = [];
    await invoke();
    assert.equal(
      decodeURIComponent(calls[0].url),
      `/api/v1/action/${actionId}`,
      `expected action id ${actionId}`,
    );
  }
});
