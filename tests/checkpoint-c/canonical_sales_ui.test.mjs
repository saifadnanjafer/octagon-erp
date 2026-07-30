// Checkpoint C1 — canonical Sales browser module contracts.
//
// These deterministic checks prove the visible module is mounted in the
// original shell, exposes every required Sales area, and uses only canonical
// query/action routes. Real Chromium proof is recorded separately.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const clientSource = fs.readFileSync(path.join(repo, 'services', 'canonicalClient.js'), 'utf8');
const moduleSource = fs.readFileSync(path.join(repo, 'modules', 'canonical-sales.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(repo, 'modules', 'canonical-sales.css'), 'utf8');
const htmlSource = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(repo, 'app.js'), 'utf8');
const legacyPackSource = fs.readFileSync(path.join(repo, 'modules', 'sales-commercial-pack.js'), 'utf8');

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
    async fetch(url, init) {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ success: true, data: [], correlationId: 'c1' }) };
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
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(clientSource, context);
  vm.runInContext(moduleSource, context);
  return { client: windowStub.CanonicalClient, mod: windowStub.CanonicalSales, calls, windowStub };
}

test('Sales workspace registers after the legacy Sales renderer', () => {
  const { mod, windowStub } = load();
  assert.ok(mod);
  assert.equal(typeof mod.activate, 'function');
  assert.equal(typeof mod.refresh, 'function');
  assert.equal(typeof windowStub.renderSalesCrmPage, 'function');
  assert.match(htmlSource, /sales-commercial-pack\.js[\s\S]*canonical-sales\.js/,
    'canonical Sales must load after legacy wrappers and become the final writer');
  assert.match(moduleSource, /getElementById\('pageSales'\)\s*\|\|/,
    'canonical Sales must replace the full original Sales page, not mount below a legacy pack');
  assert.match(moduleSource, /__canonicalSalesAuthorityActive\s*=\s*true/);
  assert.match(legacyPackSource, /__canonicalSalesAuthorityActive\s*===\s*true\)\s*return/,
    'delayed legacy Sales pack renders must retire once canonical Sales is active');
});

test('all required visible Sales areas are separate bilingual tabs', () => {
  const { mod } = load();
  const required = [
    'dashboard', 'leads', 'opportunities', 'pipeline', 'activities',
    'customer-360', 'crm-reports', 'crm-settings', 'quotations', 'orders',
    'reservations', 'deliveries', 'returns', 'invoice-requests',
    'balances', 'reports',
  ];
  assert.deepEqual(Array.from(mod.TABS, (tab) => tab.key), required);
  for (const tab of mod.TABS) {
    assert.ok(tab.label.ar.trim(), `${tab.key} missing Arabic label`);
    assert.ok(tab.label.en.trim(), `${tab.key} missing English label`);
  }
});

test('CRM reads target governed CRM query routes', async () => {
  const { client, calls } = load();
  const cases = [
    [() => client.crm.listLeads(), '/api/v1/crm/leads'],
    [() => client.crm.listOpportunities(), '/api/v1/crm/opportunities'],
    [() => client.crm.listActivities(), '/api/v1/crm/activities'],
    [() => client.crm.listPipelines(), '/api/v1/crm/pipelines'],
    [() => client.crm.listStages(), '/api/v1/crm/stages'],
    [() => client.crm.customer360('p1'), '/api/v1/crm/customer_360/p1'],
    [() => client.crm.listScoringRules(), '/api/v1/crm/scoring_rules'],
  ];
  for (const [invoke, expected] of cases) {
    calls.length = 0;
    await invoke();
    assert.equal(calls[0].url, expected);
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.credentials, 'same-origin');
  }
});

test('CRM lifecycle commands use Wave 1 action ids', async () => {
  const { client, calls } = load();
  const cases = [
    [() => client.crm.qualifyLead({ lead_id: 'l1' }), 'crm:lead:qualify'],
    [() => client.crm.convertLead({ lead_id: 'l1', party_id: 'p1' }), 'crm:lead:convert'],
    [() => client.crm.changeOpportunityStage({ opportunity_id: 'o1', stage_id: 's1' }), 'crm:opportunity:change_stage'],
    [() => client.crm.requestQuotation({ opportunity_id: 'o1' }), 'crm:opportunity:create_quotation'],
    [() => client.crm.createActivity({ activity_type: 'call', subject: 'Call', lead_id: 'l1' }), 'crm:activity:create'],
    [() => client.crm.completeActivity({ activity_id: 'a1' }), 'crm:activity:complete'],
  ];
  for (const [invoke, actionId] of cases) {
    calls.length = 0;
    await invoke();
    assert.equal(calls[0].url, `/api/v1/action/${actionId}`);
    assert.ok(JSON.parse(calls[0].init.body).idempotency_key);
  }
});

test('Sales reads target canonical query routes', async () => {
  const { client, calls } = load();
  const cases = [
    [() => client.sales.listLeads(), '/api/v1/sales/leads'],
    [() => client.sales.listOpportunities(), '/api/v1/sales/opportunities'],
    [() => client.sales.listOrders(), '/api/v1/sales/orders'],
    [() => client.sales.listReservations(), '/api/v1/sales/reservations'],
    [() => client.sales.listDeliveries(), '/api/v1/sales/deliveries'],
    [() => client.sales.listReturns(), '/api/v1/sales/returns'],
    [() => client.sales.listInvoiceRequests(), '/api/v1/sales/invoice-requests'],
    [() => client.sales.listCustomerBalances(), '/api/v1/sales/customer-balances'],
    [() => client.sales.listCommissions(), '/api/v1/sales/commissions'],
    [() => client.sales.listPriceLists(), '/api/v1/commercial/price-lists'],
  ];
  for (const [invoke, expected] of cases) {
    calls.length = 0;
    await invoke();
    assert.equal(calls[0].url, expected);
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.credentials, 'same-origin');
  }
});

test('Sales lifecycle commands use exact registered action ids', async () => {
  const { client, calls } = load();
  const cases = [
    [() => client.sales.createLead({ name: 'L' }), 'crm:lead:create'],
    [() => client.sales.convertLead({ id: 'l1' }), 'crm:lead:convert'],
    [() => client.sales.updateOpportunityStage({ id: 'o1' }), 'crm:opportunity:update_stage'],
    [() => client.sales.addOpportunityActivity({ id: 'o1' }), 'crm:opportunity:add_activity'],
    [() => client.sales.closeOpportunity({ id: 'o1' }), 'crm:opportunity:close'],
    [() => client.sales.createQuotation({}), 'sales:quotation:create'],
    [() => client.sales.submitQuotation({}), 'sales:quotation:submit'],
    [() => client.sales.approveQuotation({}), 'sales:quotation:approve'],
    [() => client.sales.reviseQuotation({}), 'sales:quotation:revise'],
    [() => client.sales.acceptQuotation({}), 'sales:quotation:accept'],
    [() => client.sales.confirmOrder({}), 'sales:order:confirm'],
    [() => client.sales.cancelOrder({}), 'sales:order:cancel'],
    [() => client.sales.reserveOrder({}), 'sales:order:reserve'],
    [() => client.sales.postDelivery({}), 'sales:delivery:post'],
    [() => client.sales.createReturn({}), 'sales:return:create'],
    [() => client.sales.createInvoiceRequest({}), 'sales:invoice_request:create'],
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

test('visible Sales writer has no legacy persistence fallback', () => {
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

test('module renders loading, empty, validation, authorization and server failure states', () => {
  assert.match(moduleSource, /cs-loading/);
  assert.match(moduleSource, /cs-empty/);
  assert.match(moduleSource, /isAuthorization/);
  assert.match(moduleSource, /data-cs-form="lead"/);
  assert.match(moduleSource, /data-cs-form="quotation"/);
  assert.match(moduleSource, /data-cs-form="activity"/);
  assert.match(moduleSource, /state\.error/);
});

test('CRM shell includes detail, Kanban, activities, Customer 360, reports, and settings', () => {
  for (const pattern of [
    /data-cs-lead=/,
    /data-cs-opportunity-detail=/,
    /cs-kanban/,
    /cs-calendar-grid/,
    /data-cs-customer-360/,
    /data-cs-crm-report/,
    /Scoring rules/,
  ]) {
    assert.match(moduleSource, pattern);
  }
});

test('visible Sales exposes follow-up, pricing, project, attachments, profitability, timeline, and governed delivery controls', () => {
  for (const pattern of [
    /data-cs-opportunity-activity/,
    /name="pricelist_id"/,
    /name="project_ref"/,
    /name="attachments"/,
    /row\.profitability/,
    /row\.timeline/,
    /data-cs-finance-link/,
    /sales\.postDelivery/,
    /customer-balances/,
  ]) {
    assert.match(moduleSource, pattern);
  }
  assert.doesNotMatch(moduleSource, /stock\.validatePicking/);
});

test('Sales stylesheet is scoped to the original Sales page and contains responsive gates', () => {
  const selectors = cssSource.split('}').map((part) => part.split('{')[0].trim()).filter(Boolean);
  for (const selector of selectors) {
    if (selector.startsWith('@') || selector.startsWith('/*')) continue;
    assert.ok(selector.includes('#pageSales'), `unscoped selector: ${selector}`);
  }
  assert.match(cssSource, /@media \(max-width: 1100px\)/);
  assert.match(cssSource, /@media \(max-width: 700px\)/);
  assert.match(cssSource, /\[dir="rtl"\]/);
  assert.match(cssSource, /\[dir="ltr"\]/);
});

test('legacy full-sync guard rejection is not misreported as a dead server', () => {
  assert.match(appSource, /_CANONICAL_AUTHORITY_REQUIRED\$/);
  assert.match(appSource, /canonical writer guard active/);
  assert.match(appSource, /res\.status === 409/);
});
