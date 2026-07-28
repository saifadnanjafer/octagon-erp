// Checkpoint C3 — canonical POS browser module contracts.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const clientSource = fs.readFileSync(path.join(repo, 'services', 'canonicalClient.js'), 'utf8');
const moduleSource = fs.readFileSync(path.join(repo, 'modules', 'canonical-pos.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(repo, 'modules', 'canonical-pos.css'), 'utf8');
const htmlSource = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
const legacySource = fs.readFileSync(path.join(repo, 'modules', 'pos.js'), 'utf8');
const deepeningSource = fs.readFileSync(path.join(repo, 'modules', 'pos-deepening.js'), 'utf8');

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
    open() { return null; },
    async fetch(url, init) {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ success: true, data: [], correlationId: 'c3' }) };
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
    setInterval: () => 1,
    clearInterval() {},
    getComputedStyle: () => ({ display: 'none' }),
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(clientSource, context);
  vm.runInContext(moduleSource, context);
  return { client: windowStub.CanonicalClient, mod: windowStub.CanonicalPOS, calls, windowStub };
}

test('canonical POS owns the original page after both legacy POS renderers', () => {
  const { mod, windowStub } = load();
  assert.ok(mod);
  assert.equal(typeof mod.activate, 'function');
  assert.equal(windowStub.__canonicalPosAuthorityActive, true);
  assert.match(htmlSource, /modules\/pos\.js[\s\S]*modules\/pos-deepening\.js[\s\S]*modules\/canonical-pos\.js/);
  assert.match(moduleSource, /getElementById\('pagePOS'\)\s*\|\|/);
  assert.match(legacySource, /__canonicalPosAuthorityActive\s*===\s*true\)\s*return/);
  assert.match(deepeningSource, /__canonicalPosAuthorityActive\s*===\s*true/);
  assert.match(htmlSource, /id="navPOSDeepening"[^>]*hidden/);
});

test('visible POS workspace exposes all required bilingual operating areas', () => {
  const { mod } = load();
  const required = ['dashboard', 'sessions', 'catalogue', 'cart', 'sales', 'receipts', 'returns', 'reconciliation', 'audit', 'reports'];
  assert.deepEqual(Array.from(mod.TABS, (tab) => tab.key), required);
  for (const tab of mod.TABS) {
    assert.ok(tab.label.ar.trim(), `${tab.key} missing Arabic label`);
    assert.ok(tab.label.en.trim(), `${tab.key} missing English label`);
  }
  for (const pattern of [
    /barcode/i, /split payment/i, /cashbox/i, /receipt/i, /refund/i,
    /expected/i, /counted/i, /variance/i, /Audit & outbox/i,
    /Cart → payment → stock → tax\/finance → cashbox → audit → outbox → commit/,
  ]) assert.match(moduleSource, pattern);
});

test('POS reads target canonical query routes', async () => {
  const { client, calls } = load();
  const cases = [
    [() => client.pos.listOrders(), '/api/v1/pos/orders'],
    [() => client.pos.getOrder('order-1'), '/api/v1/pos/orders/order-1'],
    [() => client.pos.listSessions(), '/api/v1/pos/sessions'],
    [() => client.pos.getSession('session-1'), '/api/v1/pos/sessions/session-1'],
    [() => client.pos.listTerminals(), '/api/v1/pos/terminals'],
    [() => client.pos.listPaymentMethods(), '/api/v1/pos/payment-methods'],
    [() => client.pos.listRefunds(), '/api/v1/pos/refunds'],
    [() => client.pos.listReconciliations(), '/api/v1/pos/reconciliations'],
    [() => client.pos.listAuditOutbox(), '/api/v1/pos/audit-outbox'],
    [() => client.pos.report('daily-sales'), '/api/v1/pos/reports?report=daily-sales'],
  ];
  for (const [invoke, expected] of cases) {
    calls.length = 0;
    await invoke();
    assert.equal(calls[0].url, expected);
    assert.equal(calls[0].init.method, 'GET');
  }
});

test('POS commands use exact registered action ids with idempotency', async () => {
  const { client, calls } = load();
  const cases = [
    [() => client.pos.configureTerminal({}), 'pos:terminal:configure'],
    [() => client.pos.configurePaymentMethod({}), 'pos:payment_method:configure'],
    [() => client.pos.openSession({}), 'pos:session:open'],
    [() => client.pos.processOrder({}), 'pos:order:process'],
    [() => client.pos.refundOrder({}), 'pos:order:refund'],
    [() => client.pos.closeSession({}), 'pos:session:close'],
  ];
  for (const [invoke, actionId] of cases) {
    calls.length = 0;
    await invoke();
    assert.equal(calls[0].url, `/api/v1/action/${actionId}`);
    assert.equal(calls[0].init.method, 'POST');
    assert.ok(JSON.parse(calls[0].init.body).idempotency_key);
  }
  calls.length = 0;
  await client.pos.processOrder({ session_id: 'pos-business-session', actor: 'spoofed' });
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.session_id, 'pos-business-session');
  assert.equal(body.actor, undefined, 'actor identity must still be stripped');
});

test('visible POS writer has no legacy persistence or direct ledger fallback', () => {
  for (const forbidden of [
    /\bsaveData\s*\(/,
    /\blocalStorage\.setItem\s*\(/,
    /\brecordStockMovement\s*\(/,
    /\baddFinanceTransaction\s*\(/,
    /\bfetch\s*\(/,
  ]) assert.ok(!forbidden.test(moduleSource), `legacy/direct write fallback found: ${forbidden}`);
  assert.match(moduleSource, /CanonicalClient/);
  assert.match(moduleSource, /ActionExecutor/);
  assert.match(moduleSource, /pos\.processOrder/);
  assert.match(moduleSource, /pos\.refundOrder/);
  assert.match(moduleSource, /pos\.closeSession/);
  assert.match(moduleSource, /isAuthorization/);
});

test('POS stylesheet remains page-scoped with responsive RTL and LTR support', () => {
  const selectors = cssSource.split('}').map((part) => part.split('{')[0].trim()).filter(Boolean);
  for (const selector of selectors) {
    if (selector.startsWith('@') || selector.startsWith('/*')) continue;
    assert.ok(selector.includes('#pagePOS'), `unscoped selector: ${selector}`);
  }
  assert.match(cssSource, /@media\(max-width:1100px\)/);
  assert.match(cssSource, /@media\(max-width:760px\)/);
  assert.match(cssSource, /\[dir="rtl"\]/);
  assert.match(cssSource, /\[dir="ltr"\]/);
});
