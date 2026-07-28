// Checkpoint C authenticated Chromium acceptance.
//
// Current implemented chapters: C1 Sales, C2 Procurement, and C3 POS.
// The same runner is extended by later C2-C6 chapters so one final trace
// proves the complete visible expansion without double-counting earlier runs.
//
// Prerequisite:
//   PORT=8097 node scripts/preview-authenticated-server.mjs
//   BASE_URL=http://127.0.0.1:8097 node scripts/checkpoint-c-browser-acceptance.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:8097';
const password = 'OctagonTest!2026#Disposable';
const companyId = 'c_octagon_test';
const branchId = 'b_octagon_test';
const runId = `checkpoint-c-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const traceDir = path.join(repoRoot, 'test-artifacts', runId);
const screenshotRoot = path.join(repoRoot, 'docs', 'evidence', 'visible-expansion', 'screenshots-c');
fs.mkdirSync(traceDir, { recursive: true });
fs.mkdirSync(path.join(screenshotRoot, 'sales'), { recursive: true });
fs.mkdirSync(path.join(screenshotRoot, 'procurement'), { recursive: true });
fs.mkdirSync(path.join(screenshotRoot, 'pos'), { recursive: true });

const results = [];
const screenshots = [];
const browserErrors = [];

function record(name, status, detail = '') {
  results.push({ name, status, detail });
  console.log(`${status.padEnd(4)} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function screenshot(page, name, chapter = 'sales') {
  await page.waitForFunction(() => !document.querySelector('#toastContainer .toast'), { timeout: 10000 });
  const target = path.join(screenshotRoot, chapter, `${name}.png`);
  await page.screenshot({ path: target, fullPage: false });
  screenshots.push(path.relative(repoRoot, target).replace(/\\/g, '/'));
  return target;
}

async function login(page, userId) {
  return page.evaluate(async ({ userId, password, companyId, branchId }) => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, password }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      await fetch('/api/auth/context', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, branchId }),
      });
      localStorage.setItem('octagon_user_id', body.user?.id || userId);
      localStorage.setItem('pentagon_user_id', body.user?.id || userId);
    }
    return { status: response.status, authenticated: !!body.authenticated, user: body.user?.id || null };
  }, { userId, password, companyId, branchId });
}

async function dismissLegacyGate(page) {
  await page.evaluate(() => {
    localStorage.setItem('octagon_user_id', localStorage.getItem('octagon_user_id') || 'system_admin');
    localStorage.setItem('octagon-sidebar-collapsed', '0');
    const overlay = document.getElementById('loginOverlay')
      || document.querySelector('.login-overlay, #systemLoginOverlay');
    if (overlay) overlay.style.display = 'none';
  });
}

async function openSales(page) {
  await page.evaluate(async () => {
    if (typeof window.switchPage === 'function') await window.switchPage('sales');
  });
  await page.waitForSelector('[data-cs-workspace]', { visible: true, timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('[data-cs-workspace] .cs-loading'), { timeout: 30000 });
}

async function openProcurement(page) {
  await page.evaluate(async () => {
    if (typeof window.switchPage === 'function') await window.switchPage('procurement');
  });
  await page.waitForSelector('[data-cp-workspace]', { visible: true, timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('[data-cp-workspace] .cp-loading'), { timeout: 30000 });
}

async function openPos(page) {
  await page.evaluate(async () => {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
    if (typeof window.switchPage === 'function') await window.switchPage('pos');
  });
  await page.waitForSelector('.cpos-shell', { visible: true, timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('.cpos-shell .cpos-loading'), { timeout: 30000 });
}

async function clickPosTab(page, tab) {
  await page.waitForFunction(() => window.CanonicalPOS && !window.CanonicalPOS.state.loading, { timeout: 30000 });
  await page.evaluate((key) => document.querySelector(`[data-cpos-tab="${key}"]`)?.click(), tab);
  await page.waitForFunction((key) =>
    document.querySelector(`[data-cpos-tab="${key}"]`)?.classList.contains('active'), {}, tab);
}

async function poll(page, fn, { timeout = 30000, interval = 350, args = [] } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const result = await page.evaluate(fn, ...args);
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`poll timed out after ${timeout}ms`);
}

async function seedCatalog(page) {
  return page.evaluate(async () => {
    const c = window.CanonicalClient;
    const suffix = Date.now().toString(36).slice(-7);
    const action = (id, input) => c.action(id, input, { domain: id.startsWith('stock') || id.startsWith('warehouse') ? 'INVENTORY' : 'COMMERCIAL' });
    const financeAction = (id, input) => c.action(id, input, { domain: 'FINANCE' });
    const accounts = await c.query('/finance/accounts');
    const ensureAccount = async (spec) => {
      const existing = accounts.find((row) => row.code === spec.code);
      if (existing) return existing;
      const created = await financeAction('finance_account:create', spec);
      accounts.push(created);
      return created;
    };
    // The test company is intentionally empty. Seed only the six accounts the
    // disposable product/stock/sales chain needs, through the governed Finance
    // actions; reuse fixture chart rows when present and never write directly.
    const cash = await ensureAccount({
      code: '101000', name: 'C3 Test Cash', type: 'asset',
    });
    const receivable = await ensureAccount({
      code: '103000', name: 'C1 Test Receivable', type: 'receivable', is_reconcilable: true,
    });
    const card = await ensureAccount({
      code: '102000', name: 'C3 Test Card Clearing', type: 'asset',
    });
    const stock = await ensureAccount({
      code: '104000', name: 'C1 Test Stock Valuation', type: 'asset',
    });
    const stockInput = await ensureAccount({
      code: '201000', name: 'C1 Test Stock Input', type: 'liability',
    });
    const income = await ensureAccount({
      code: '401000', name: 'C1 Test Sales Income', type: 'income',
    });
    const stockOutput = await ensureAccount({
      code: '500000', name: 'C1 Test Stock Output', type: 'expense',
    });
    const expense = await ensureAccount({
      code: '501000', name: 'C1 Test Cost of Goods', type: 'expense',
    });
    await financeAction('finance_authority_limit:set', {
      role_or_user: 'usr_test_sysadmin',
      limit_type: 'post',
      max_amount: 1000000000,
      currency: 'IQD',
    });
    const warehouse = await c.warehouses.create({ name: `C1 Browser Warehouse ${suffix}`, code: `000-C1-${suffix}` });
    const supplier = await c.locations.create({ name: `C1 Supplier Location ${suffix}`, usage: 'supplier' });
    const customer = await c.parties.create({ name: `C1 Browser Customer ${suffix}`, roles: ['customer'] });
    const category = await action('uom_category:create', { name: `C1 Units ${suffix}` });
    const uom = await c.uoms.create({ category_id: category.id, name: `Piece ${suffix}`, ratio: 1, uom_type: 'reference' });
    const productCategory = await action('product_category:create', {
      name: `C1 Goods ${suffix}`,
      code: `C1G-${suffix}`,
      costing_method: 'avco',
      income_account_id: income.id,
      expense_account_id: expense.id,
      stock_account_id: stock.id,
      stock_input_account_id: stockInput.id,
      stock_output_account_id: stockOutput.id,
    });
    const product = await c.products.createTemplate({
      name: `C1 Browser Product ${suffix}`,
      category_id: productCategory.id,
      uom_id: uom.id,
      list_price: 125,
      standard_price: 55,
      sku: `C1-${suffix}`,
    });
    await c.stock.postMove({
      reference: `C1-OPEN-${suffix}`,
      product_id: product.default_variant_id,
      uom_id: uom.id,
      product_qty: 10,
      location_id: supplier.id,
      location_dest_id: warehouse.lot_stock_id,
      unit_cost: 55,
      source_document_type: 'inventory_adjustment',
      source_document_id: `C1-OPEN-${suffix}`,
    });
    return {
      suffix,
      accountIds: {
        cash: cash.id,
        receivable: receivable.id,
        card: card.id,
        stock: stock.id,
        stockInput: stockInput.id,
        income: income.id,
        stockOutput: stockOutput.id,
        expense: expense.id,
      },
      warehouseId: warehouse.id,
      customerId: customer.id,
      productId: product.default_variant_id,
      uomId: uom.id,
      leadName: `C1 Browser Lead ${suffix}`,
      quotationNote: `C1 browser quotation ${suffix}`,
    };
  });
}

async function seedProcurementSuppliers(page) {
  return page.evaluate(async () => {
    const suffix = Date.now().toString(36).slice(-7);
    const supplierA = await window.CanonicalClient.parties.create({
      name: `C2 Browser Supplier A ${suffix}`,
      roles: ['supplier'],
    });
    const supplierB = await window.CanonicalClient.parties.create({
      name: `C2 Browser Supplier B ${suffix}`,
      roles: ['supplier'],
    });
    return {
      suffix,
      supplierAId: supplierA.id,
      supplierBId: supplierB.id,
      requestName: `C2 Browser Request ${suffix}`,
      rfqName: `C2 Browser RFQ ${suffix}`,
    };
  });
}

async function clickTab(page, tab) {
  await page.waitForFunction(() => window.CanonicalSales && !window.CanonicalSales.state.busy, { timeout: 30000 });
  await page.evaluate((key) => document.querySelector(`[data-cs-tab="${key}"]`)?.click(), tab);
  await page.waitForFunction((key) =>
    document.querySelector(`[data-cs-tab="${key}"]`)?.classList.contains('active'), {}, tab);
}

async function clickRowAction(page, actionName, id) {
  const selector = `[data-cs-action-row="${actionName}"][data-cs-id="${id}"]`;
  await page.waitForFunction(() => window.CanonicalSales && !window.CanonicalSales.state.busy, { timeout: 30000 });
  await page.waitForSelector(selector, { visible: true, timeout: 30000 });
  const started = await page.evaluate(({ actionName, id }) => {
    const button = document.querySelector(`[data-cs-action-row="${actionName}"][data-cs-id="${id}"]`);
    if (!button) return false;
    button.click();
    return window.CanonicalSales.state.busy;
  }, { actionName, id });
  if (!started) throw new Error(`Sales row action did not start: ${actionName} ${id}`);
  await page.waitForFunction(() => window.CanonicalSales && !window.CanonicalSales.state.busy, { timeout: 30000 });
  const actionError = await page.evaluate(() => window.CanonicalSales.state.error || null);
  if (actionError) throw new Error(`Sales row action failed (${actionName}): ${actionError}`);
}

async function clickProcurementTab(page, tab) {
  await page.waitForFunction(() => window.CanonicalProcurement && !window.CanonicalProcurement.state.busy, { timeout: 30000 });
  await page.evaluate((key) => document.querySelector(`[data-cp-tab="${key}"]`)?.click(), tab);
  await page.waitForFunction((key) =>
    document.querySelector(`[data-cp-tab="${key}"]`)?.classList.contains('active'), {}, tab);
}

async function clickProcurementRowAction(page, actionName, id) {
  const selector = `[data-cp-row-action="${actionName}"][data-cp-id="${id}"]`;
  await page.waitForFunction(() => window.CanonicalProcurement && !window.CanonicalProcurement.state.busy, { timeout: 30000 });
  await page.waitForSelector(selector, { visible: true, timeout: 30000 });
  const started = await page.evaluate(({ actionName, id }) => {
    const button = document.querySelector(`[data-cp-row-action="${actionName}"][data-cp-id="${id}"]`);
    if (!button) return false;
    button.click();
    return window.CanonicalProcurement.state.busy;
  }, { actionName, id });
  if (!started) throw new Error(`Procurement row action did not start: ${actionName} ${id}`);
  await page.waitForFunction(() => window.CanonicalProcurement && !window.CanonicalProcurement.state.busy, { timeout: 30000 });
  const actionError = await page.evaluate(() => window.CanonicalProcurement.state.error || null);
  if (actionError) throw new Error(`Procurement row action failed (${actionName}): ${actionError}`);
}

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const chromiumVersion = await browser.version();
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', (request) => browserErrors.push(`request: ${request.url()} ${request.failure()?.errorText || ''}`));

  let fixture = null;
  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    const admin = await login(page, 'test.sysadmin');
    record('C1 admin authenticates', admin.authenticated ? 'PASS' : 'FAIL', `HTTP ${admin.status}`);
    await page.reload({ waitUntil: 'networkidle2' });
    await dismissLegacyGate(page);
    await openSales(page);
    browserErrors.length = 0;

    const tabs = await page.$$eval('[data-cs-tab]', (nodes) => nodes.map((node) => node.dataset.csTab));
    record('C1 Sales exposes 11 required areas', tabs.length === 11 ? 'PASS' : 'FAIL', tabs.join(','));
    await screenshot(page, 'c1-01-sales-dashboard-ar-desktop');

    fixture = await seedCatalog(page);
    record('C1 disposable canonical catalog seeded', 'PASS', `${fixture.customerId}, ${fixture.productId}, ${fixture.warehouseId}`);
    await page.evaluate(() => window.CanonicalSales.refresh());
    await page.waitForFunction(() => !document.querySelector('[data-cs-workspace] .cs-loading'));

    await clickTab(page, 'leads');
    await page.type('[data-cs-form="lead"] [name="name"]', fixture.leadName);
    await page.$eval('[data-cs-form="lead"] [name="expected_revenue"]', (input) => { input.value = '1000'; });
    await page.$eval('[data-cs-form="lead"] [name="probability"]', (input) => { input.value = '45'; });
    await page.evaluate(() => document.querySelector('[data-cs-form="lead"]')?.requestSubmit());
    const leadId = await poll(page, async (name) => {
      const rows = await window.CanonicalClient.sales.listLeads();
      return rows.find((row) => row.name === name)?.id || null;
    }, { args: [fixture.leadName] });
    record('C1 visible lead creation', 'PASS', leadId);

    await page.waitForSelector(`[data-cs-convert-lead="${leadId}"]`, { visible: true });
    await page.click(`[data-cs-convert-lead="${leadId}"]`);
    const opportunityId = await poll(page, async (sourceLeadId) => {
      const rows = await window.CanonicalClient.sales.listOpportunities();
      return rows.find((row) => row.lead_id === sourceLeadId)?.id || null;
    }, { args: [leadId] });
    record('C1 visible lead to opportunity conversion', 'PASS', opportunityId);
    await screenshot(page, 'c1-02-lead-converted-ar');

    await clickTab(page, 'opportunities');
    await page.waitForSelector(`[data-cs-opportunity="${opportunityId}"][data-cs-stage="negotiation"]`, { visible: true });
    await page.click(`[data-cs-opportunity="${opportunityId}"][data-cs-stage="negotiation"]`);
    await poll(page, async (id) => {
      const row = await window.CanonicalClient.sales.getOpportunity(id);
      return row.stage === 'negotiation';
    }, { args: [opportunityId] });
    record('C1 visible opportunity stage transition', 'PASS', 'negotiation');
    const activityAnswers = ['Browser follow-up', '2030-01-15'];
    const activityDialogHandler = async (dialog) => dialog.accept(activityAnswers.shift() || '');
    page.on('dialog', activityDialogHandler);
    await page.waitForFunction((id) => !window.CanonicalSales.state.busy
      && document.querySelector(`[data-cs-opportunity-activity="${id}"]`), {}, opportunityId);
    await page.evaluate((id) => document.querySelector(`[data-cs-opportunity-activity="${id}"]`)?.click(), opportunityId);
    await poll(page, async (id) => {
      const row = await window.CanonicalClient.sales.getOpportunity(id);
      return row.activities.some((activity) => activity.summary === 'Browser follow-up');
    }, { args: [opportunityId] });
    page.off('dialog', activityDialogHandler);
    record('C1 visible opportunity follow-up activity', 'PASS', opportunityId);

    await clickTab(page, 'quotations');
    await page.select('[data-cs-warehouse]', fixture.warehouseId);
    await page.select('[data-cs-form="quotation"] [name="partner_id"]', fixture.customerId);
    await page.select('[data-cs-form="quotation"] [name="product_id"]', fixture.productId);
    await page.$eval('[data-cs-form="quotation"] [name="quantity"]', (input) => { input.value = '2'; });
    await page.$eval('[data-cs-form="quotation"] [name="price_unit"]', (input) => { input.value = '125'; });
    await page.$eval('[data-cs-form="quotation"] [name="discount"]', (input) => { input.value = '5'; });
    await page.$eval('[data-cs-form="quotation"] [name="project_ref"]', (input) => { input.value = 'PRJ-C1-BROWSER'; });
    await page.$eval('[data-cs-form="quotation"] [name="attachments"]', (input) => { input.value = 'proposal.pdf, https://example.test/scope'; });
    await page.$eval('[data-cs-form="quotation"] [name="notes"]', (input, note) => { input.value = note; }, fixture.quotationNote);
    await page.evaluate(() => document.querySelector('[data-cs-form="quotation"]')?.requestSubmit());
    const orderId = await poll(page, async (note) => {
      const rows = await window.CanonicalClient.sales.listOrders();
      return rows.find((row) => row.notes === note)?.id || null;
    }, { args: [fixture.quotationNote] });
    await page.waitForFunction(() => !window.CanonicalSales.state.busy, { timeout: 30000 });
    record('C1 visible quotation creation', 'PASS', orderId);
    const orderMetadata = await page.evaluate((id) => window.CanonicalClient.sales.getOrder(id), orderId);
    if (orderMetadata.project_ref !== 'PRJ-C1-BROWSER' || orderMetadata.attachments.length !== 2 || !orderMetadata.profitability) {
      throw new Error('Visible quotation metadata did not round-trip through canonical Sales');
    }
    record('C1 project, attachments, and profitability detail', 'PASS', orderId);

    await clickRowAction(page, 'submit-quotation', orderId);
    await poll(page, async (id) => (await window.CanonicalClient.sales.getOrder(id)).quotation_state === 'sent',
      { args: [orderId] });
    await clickRowAction(page, 'approve-quotation', orderId);
    await poll(page, async (id) => (await window.CanonicalClient.sales.getOrder(id)).quotation_state === 'approved',
      { args: [orderId] });
    await clickRowAction(page, 'accept-quotation', orderId);
    await poll(page, async (id) => (await window.CanonicalClient.sales.getOrder(id)).quotation_state === 'accepted',
      { args: [orderId] });
    record('C1 visible submit/approve/accept lifecycle', 'PASS', orderId);

    await clickRowAction(page, 'confirm-order', orderId);
    await poll(page, async (id) => (await window.CanonicalClient.sales.getOrder(id)).state === 'sale',
      { args: [orderId] });
    record('C1 visible atomic confirmation and reservation', 'PASS', orderId);

    await clickTab(page, 'orders');
    page.once('dialog', (dialog) => dialog.accept(dialog.defaultValue()));
    await clickRowAction(page, 'deliver-order', orderId);
    await poll(page, async (id) => {
      const rows = await window.CanonicalClient.sales.listDeliveries({ sale_order_id: id });
      return rows.some((row) => row.state === 'done');
    }, { args: [orderId] });
    record('C1 visible delivery through canonical Inventory', 'PASS', orderId);

    await clickRowAction(page, 'invoice-order', orderId);
    await poll(page, async (id) => {
      const rows = await window.CanonicalClient.sales.listInvoiceRequests({ sale_order_id: id });
      return rows.some((row) => row.status === 'posted');
    }, { args: [orderId] });
    record('C1 visible invoice request through canonical Finance', 'PASS', orderId);

    page.once('dialog', (dialog) => dialog.accept('1'));
    await clickRowAction(page, 'return-order', orderId);
    await poll(page, async (id) => {
      const rows = await window.CanonicalClient.sales.listReturns({ sale_order_id: id });
      return rows.some((row) => row.state === 'done');
    }, { args: [orderId] });
    record('C1 visible customer return and credit-note consequence', 'PASS', orderId);
    await page.waitForFunction(() => !window.CanonicalSales.state.busy);
    await page.evaluate((id) => document.querySelector(`[data-cs-order="${id}"]`)?.click(), orderId);
    await page.waitForSelector('.cs-drawer', { visible: true });
    await page.$eval('.cs-drawer', (drawer) => drawer.scrollIntoView({ block: 'start' }));
    await screenshot(page, 'c1-03-order-delivered-invoiced-returned-ar');

    await clickTab(page, 'reports');
    await page.click('[data-cs-report="margin"]');
    await page.waitForFunction(() => !document.querySelector('[data-cs-workspace] .cs-loading'));
    record('C1 canonical Sales reports render', 'PASS', 'margin');
    await screenshot(page, 'c1-04-sales-report-margin-ar');

    await page.evaluate(() => {
      document.documentElement.lang = 'en';
      document.documentElement.dir = 'ltr';
      window.CanonicalSales.activate();
    });
    await page.waitForFunction(() => !document.querySelector('[data-cs-workspace] .cs-loading'));
    await screenshot(page, 'c1-05-sales-dashboard-en-ltr');
    const direction = await page.$eval('[data-cs-workspace]', (node) => ({
      dir: document.documentElement.dir,
      text: node.textContent.includes('Sales Dashboard'),
    }));
    record('C1 English LTR surface', direction.dir === 'ltr' && direction.text ? 'PASS' : 'FAIL', JSON.stringify(direction));

    await page.setViewport({ width: 768, height: 1024, deviceScaleFactor: 1 });
    await screenshot(page, 'c1-06-sales-tablet-768');
    await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 1 });
    await screenshot(page, 'c1-07-sales-mobile-375');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2);
    record('C1 mobile has no page-level horizontal overflow', overflow ? 'PASS' : 'FAIL');

    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    const salesUser = await login(page, 'test.sales');
    await page.reload({ waitUntil: 'networkidle2' });
    await dismissLegacyGate(page);
    await openSales(page);
    await clickTab(page, 'leads');
    const operationalLeadName = `C1 Sales Role ${Date.now().toString(36)}`;
    await page.type('[data-cs-form="lead"] [name="name"]', operationalLeadName);
    await page.evaluate(() => document.querySelector('[data-cs-form="lead"]')?.requestSubmit());
    await poll(page, async (name) =>
      (await window.CanonicalClient.sales.listLeads()).some((row) => row.name === name),
    { args: [operationalLeadName] });
    record('C1 operational Sales role mutation succeeds', salesUser.authenticated ? 'PASS' : 'FAIL');

    const viewer = await login(page, 'test.viewer');
    await page.reload({ waitUntil: 'networkidle2' });
    await dismissLegacyGate(page);
    await openSales(page);
    await clickTab(page, 'leads');
    await page.type('[data-cs-form="lead"] [name="name"]', `C1 Viewer Denied ${Date.now().toString(36)}`);
    await page.evaluate(() => document.querySelector('[data-cs-form="lead"]')?.requestSubmit());
    await page.waitForSelector('.cs-error', { visible: true, timeout: 30000 });
    const denial = await page.$eval('.cs-error', (node) => node.textContent);
    record('C1 restricted viewer mutation denied server-side', /not authorized|صلاحية|PERMISSION_DENIED/i.test(denial) ? 'PASS' : 'FAIL', denial.replace(/\s+/g, ' ').trim());
    await screenshot(page, 'c1-08-viewer-server-denial');

    const relevantErrors = browserErrors.filter((entry) =>
      !/favicon\.ico|ERR_ABORTED|Failed to load resource|403 \(Forbidden\)|PERMISSION_DENIED/i.test(entry));
    record('C1 browser runtime has no unexpected errors', relevantErrors.length ? 'FAIL' : 'PASS',
      relevantErrors.slice(0, 5).join(' | '));

    // C2 — Procurement. Reuse the disposable canonical product/warehouse
    // created above, but execute the procurement lifecycle only through the
    // visible original-shell workspace.
    const c2Admin = await login(page, 'test.sysadmin');
    record('C2 admin authenticates', c2Admin.authenticated ? 'PASS' : 'FAIL', `HTTP ${c2Admin.status}`);
    await page.reload({ waitUntil: 'networkidle2' });
    await dismissLegacyGate(page);
    await openProcurement(page);
    browserErrors.length = 0;

    const procurementTabs = await page.$$eval('[data-cp-tab]', (nodes) => nodes.map((node) => node.dataset.cpTab));
    const requiredProcurementTabs = [
      'dashboard', 'requests', 'requisitions', 'rfqs', 'supplier-quotations',
      'comparison', 'orders', 'receipts', 'three-way-match', 'bill-requests',
      'returns', 'supplier-performance',
    ];
    record('C2 Procurement exposes 12 required areas', requiredProcurementTabs.every((tab) => procurementTabs.includes(tab)) ? 'PASS' : 'FAIL', procurementTabs.join(','));
    await screenshot(page, 'c2-01-procurement-dashboard-ar-desktop', 'procurement');

    const procurementFixture = await seedProcurementSuppliers(page);
    fixture.procurement = procurementFixture;
    record('C2 disposable canonical suppliers seeded', 'PASS', `${procurementFixture.supplierAId}, ${procurementFixture.supplierBId}`);
    await page.evaluate(() => window.CanonicalProcurement.refresh());
    await page.waitForFunction(() => !document.querySelector('[data-cp-workspace] .cp-loading'));

    await clickProcurementTab(page, 'requests');
    await page.type('[data-cp-form="request"] [name="name"]', procurementFixture.requestName);
    await page.select('[data-cp-form="request"] [name="product_id"]', fixture.productId);
    await page.$eval('[data-cp-form="request"] [name="quantity"]', (input) => { input.value = '3'; });
    await page.$eval('[data-cp-form="request"] [name="estimated_unit_cost"]', (input) => { input.value = '60'; });
    await page.$eval('[data-cp-form="request"] [name="needed_by"]', (input) => { input.value = '2030-01-31'; });
    await page.select('[data-cp-form="request"] [name="quality_required"]', '1');
    await page.$eval('[data-cp-form="request"] [name="attachments"]', (input) => { input.value = 'c2-request.pdf'; });
    await page.$eval('[data-cp-form="request"] [name="comments"]', (input) => { input.value = 'Checkpoint C2 browser demand'; });
    await page.evaluate(() => document.querySelector('[data-cp-form="request"]')?.requestSubmit());
    const requestId = await poll(page, async (name) => {
      const rows = await window.CanonicalClient.procurement.listRequests();
      return rows.find((row) => row.name === name)?.id || null;
    }, { args: [procurementFixture.requestName] });
    await page.waitForFunction(() => !window.CanonicalProcurement.state.busy);
    record('C2 visible purchase request creation', 'PASS', requestId);
    await screenshot(page, 'c2-02-purchase-request-ar', 'procurement');

    await clickProcurementRowAction(page, 'submit-request', requestId);
    await poll(page, async (id) => (await window.CanonicalClient.procurement.getRequest(id)).state === 'submitted', { args: [requestId] });
    await clickProcurementRowAction(page, 'approve-request', requestId);
    const requisitionId = await poll(page, async (id) => {
      const request = await window.CanonicalClient.procurement.getRequest(id);
      return request.state === 'converted' ? request.requisition_id : null;
    }, { args: [requestId] });
    record('C2 visible request approval and requisition conversion', 'PASS', requisitionId);

    await clickProcurementTab(page, 'requisitions');
    await clickProcurementRowAction(page, 'approve-requisition', requisitionId);
    await poll(page, async (id) => (await window.CanonicalClient.procurement.getRequisition(id)).state === 'approved', { args: [requisitionId] });
    record('C2 visible requisition approval', 'PASS', requisitionId);

    await clickProcurementTab(page, 'rfqs');
    await page.select('[data-cp-form="rfq"] [name="requisition_id"]', requisitionId);
    await page.type('[data-cp-form="rfq"] [name="name"]', procurementFixture.rfqName);
    await page.$eval('[data-cp-form="rfq"] [name="deadline"]', (input) => { input.value = '2030-01-15'; });
    await page.select('[data-cp-form="rfq"] [name="supplier_ids"]', procurementFixture.supplierAId, procurementFixture.supplierBId);
    await page.$eval('[data-cp-form="rfq"] [name="comments"]', (input) => { input.value = 'Compare price, tax, and delivery'; });
    await page.evaluate(() => document.querySelector('[data-cp-form="rfq"]')?.requestSubmit());
    const rfqId = await poll(page, async (name) => {
      const rows = await window.CanonicalClient.procurement.listRfqs();
      return rows.find((row) => row.name === name)?.id || null;
    }, { args: [procurementFixture.rfqName] });
    await page.waitForFunction(() => !window.CanonicalProcurement.state.busy);
    record('C2 visible multi-supplier RFQ issue', 'PASS', rfqId);

    const fillSupplierQuotation = async (supplierId, unitPrice, tax, leadDays, deliveryDate, attachment) => {
      await clickProcurementTab(page, 'supplier-quotations');
      await page.select('[data-cp-form="supplier-quotation"] [name="rfq_id"]', rfqId);
      await page.select('[data-cp-form="supplier-quotation"] [name="supplier_id"]', supplierId);
      await page.$eval('[data-cp-form="supplier-quotation"] [name="unit_price"]', (input, value) => { input.value = value; }, String(unitPrice));
      await page.$eval('[data-cp-form="supplier-quotation"] [name="tax_amount"]', (input, value) => { input.value = value; }, String(tax));
      await page.$eval('[data-cp-form="supplier-quotation"] [name="lead_time_days"]', (input, value) => { input.value = value; }, String(leadDays));
      await page.$eval('[data-cp-form="supplier-quotation"] [name="delivery_date"]', (input, value) => { input.value = value; }, deliveryDate);
      await page.$eval('[data-cp-form="supplier-quotation"] [name="attachments"]', (input, value) => { input.value = value; }, attachment);
      await page.evaluate(() => document.querySelector('[data-cp-form="supplier-quotation"]')?.requestSubmit());
      const quotationId = await poll(page, async ({ rfqId: expectedRfq, supplierId: expectedSupplier }) => {
        const rows = await window.CanonicalClient.procurement.listSupplierQuotations();
        return rows.find((row) => row.rfq_id === expectedRfq && row.supplier_id === expectedSupplier)?.id || null;
      }, { args: [{ rfqId, supplierId }] });
      await page.waitForFunction(() => !window.CanonicalProcurement.state.busy);
      return quotationId;
    };

    const quoteAId = await fillSupplierQuotation(procurementFixture.supplierAId, 58, 3, 7, '2030-01-20', 'quote-a.pdf');
    const quoteBId = await fillSupplierQuotation(procurementFixture.supplierBId, 63, 1, 4, '2030-01-18', 'quote-b.pdf');
    record('C2 visible multiple supplier quotations', 'PASS', `${quoteAId}, ${quoteBId}`);

    await clickProcurementTab(page, 'comparison');
    await page.select('[data-cp-comparison-rfq]', rfqId);
    await screenshot(page, 'c2-03-supplier-comparison-ar', 'procurement');
    await clickProcurementRowAction(page, 'award-quotation', quoteAId);
    await poll(page, async (id) => (await window.CanonicalClient.procurement.getSupplierQuotation(id)).state === 'awarded', { args: [quoteAId] });
    record('C2 visible line/price/tax/delivery comparison and supplier award', 'PASS', quoteAId);

    await clickProcurementTab(page, 'supplier-quotations');
    await page.waitForSelector(`[data-cp-quote-to-order="${quoteAId}"]`, { visible: true, timeout: 30000 });
    await page.click(`[data-cp-quote-to-order="${quoteAId}"]`);
    const purchaseOrderId = await poll(page, async (quotationId) => {
      const rows = await window.CanonicalClient.procurement.listOrders();
      return rows.find((row) => row.selected_quotation_id === quotationId)?.id || null;
    }, { args: [quoteAId] });
    await page.waitForFunction(() => !window.CanonicalProcurement.state.busy);
    const inheritedQuality = await page.evaluate((id) => window.CanonicalClient.procurement.getOrder(id), purchaseOrderId);
    record('C2 visible awarded quotation to quality-controlled PO', inheritedQuality.quality_required ? 'PASS' : 'FAIL', purchaseOrderId);

    await clickProcurementTab(page, 'orders');
    await page.select('[data-cp-warehouse]', fixture.warehouseId);
    await clickProcurementRowAction(page, 'approve-order', purchaseOrderId);
    await poll(page, async (id) => (await window.CanonicalClient.procurement.getOrder(id)).state === 'approved', { args: [purchaseOrderId] });
    record('C2 visible PO approval and commitment', 'PASS', purchaseOrderId);
    await clickProcurementRowAction(page, 'confirm-order', purchaseOrderId);
    await poll(page, async (id) => (await window.CanonicalClient.procurement.getOrder(id)).state === 'purchase', { args: [purchaseOrderId] });
    record('C2 visible PO confirmation and canonical receipt demand', 'PASS', purchaseOrderId);

    page.once('dialog', (dialog) => dialog.accept(dialog.defaultValue()));
    await clickProcurementRowAction(page, 'receive-order', purchaseOrderId);
    await poll(page, async (id) => {
      const rows = await window.CanonicalClient.procurement.listReceipts({ purchase_order_id: id });
      return rows.some((row) => row.state === 'received');
    }, { args: [purchaseOrderId] });
    const qualityCount = await page.evaluate(async (id) =>
      (await window.CanonicalClient.procurement.listQualityChecks({ purchase_order_id: id })).length,
    purchaseOrderId);
    record('C2 visible receipt through canonical Inventory with quality check', qualityCount > 0 ? 'PASS' : 'FAIL', String(qualityCount));

    page.once('dialog', (dialog) => dialog.accept(`C2-SUP-${Date.now().toString(36)}`));
    await clickProcurementRowAction(page, 'match-order', purchaseOrderId);
    await poll(page, async (id) => {
      const rows = await window.CanonicalClient.procurement.listMatches({ purchase_order_id: id });
      return rows.some((row) => row.match_status === 'matched');
    }, { args: [purchaseOrderId] });
    record('C2 visible clean three-way match', 'PASS', purchaseOrderId);

    await clickProcurementRowAction(page, 'bill-order', purchaseOrderId);
    await poll(page, async (id) => {
      const rows = await window.CanonicalClient.procurement.listBillRequests();
      return rows.some((row) => row.source_document_id === id && row.status === 'posted');
    }, { args: [purchaseOrderId] });
    record('C2 visible supplier bill request through canonical Finance', 'PASS', purchaseOrderId);

    page.once('dialog', (dialog) => dialog.accept('1'));
    await clickProcurementRowAction(page, 'return-order', purchaseOrderId);
    await poll(page, async (id) => {
      const rows = await window.CanonicalClient.procurement.listReturns({ purchase_order_id: id });
      return rows.some((row) => row.state === 'done');
    }, { args: [purchaseOrderId] });
    record('C2 visible supplier return and debit-note consequence', 'PASS', purchaseOrderId);

    page.once('dialog', (dialog) => dialog.accept('95'));
    await clickProcurementRowAction(page, 'score-order', purchaseOrderId);
    await poll(page, async (id) => {
      const rows = await window.CanonicalClient.procurement.listSupplierPerformance();
      return rows.some((row) => row.purchase_order_id === id);
    }, { args: [purchaseOrderId] });
    record('C2 visible supplier performance score', 'PASS', purchaseOrderId);
    await page.evaluate((id) => document.querySelector(`[data-cp-order="${id}"]`)?.click(), purchaseOrderId);
    await page.waitForFunction(() => window.CanonicalProcurement.state.selectedOrderId !== null);
    await screenshot(page, 'c2-04-purchase-order-received-matched-billed-ar', 'procurement');

    await clickProcurementTab(page, 'receipts');
    await screenshot(page, 'c2-05-receipt-quality-ar', 'procurement');
    await clickProcurementTab(page, 'three-way-match');
    await screenshot(page, 'c2-06-three-way-match-ar', 'procurement');
    await clickProcurementTab(page, 'bill-requests');
    await screenshot(page, 'c2-07-supplier-bill-request-ar', 'procurement');
    await clickProcurementTab(page, 'supplier-performance');
    await screenshot(page, 'c2-08-supplier-performance-ar', 'procurement');

    await page.evaluate(() => {
      document.documentElement.lang = 'en';
      document.documentElement.dir = 'ltr';
      window.CanonicalProcurement.activate();
    });
    await page.waitForFunction(() => !document.querySelector('[data-cp-workspace] .cp-loading'));
    const procurementDirection = await page.$eval('[data-cp-workspace]', (node) => ({
      dir: document.documentElement.dir,
      text: node.textContent.includes('Procurement'),
    }));
    record('C2 English LTR surface', procurementDirection.dir === 'ltr' && procurementDirection.text ? 'PASS' : 'FAIL', JSON.stringify(procurementDirection));
    await screenshot(page, 'c2-09-procurement-en-ltr', 'procurement');

    await page.setViewport({ width: 768, height: 1024, deviceScaleFactor: 1 });
    await screenshot(page, 'c2-10-procurement-tablet-768', 'procurement');
    await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 1 });
    await screenshot(page, 'c2-11-procurement-mobile-375', 'procurement');
    const procurementOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2);
    record('C2 mobile has no page-level horizontal overflow', procurementOverflow ? 'PASS' : 'FAIL');

    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    const procurementUser = await login(page, 'test.procurement');
    await page.reload({ waitUntil: 'networkidle2' });
    await dismissLegacyGate(page);
    await openProcurement(page);
    await clickProcurementTab(page, 'requests');
    const roleRequestName = `C2 Procurement Role ${Date.now().toString(36)}`;
    await page.type('[data-cp-form="request"] [name="name"]', roleRequestName);
    await page.select('[data-cp-form="request"] [name="product_id"]', fixture.productId);
    await page.evaluate(() => document.querySelector('[data-cp-form="request"]')?.requestSubmit());
    await poll(page, async (name) =>
      (await window.CanonicalClient.procurement.listRequests()).some((row) => row.name === name),
    { args: [roleRequestName] });
    record('C2 operational Procurement role mutation succeeds', procurementUser.authenticated ? 'PASS' : 'FAIL');

    const procurementViewer = await login(page, 'test.viewer');
    await page.reload({ waitUntil: 'networkidle2' });
    await dismissLegacyGate(page);
    await openProcurement(page);
    await clickProcurementTab(page, 'requests');
    await page.type('[data-cp-form="request"] [name="name"]', `C2 Viewer Denied ${Date.now().toString(36)}`);
    await page.select('[data-cp-form="request"] [name="product_id"]', fixture.productId);
    await page.evaluate(() => document.querySelector('[data-cp-form="request"]')?.requestSubmit());
    await page.waitForSelector('.cp-error', { visible: true, timeout: 30000 });
    const procurementDenial = await page.$eval('.cp-error', (node) => node.textContent);
    record('C2 restricted viewer mutation denied server-side', /not authorized|صلاحية|PERMISSION_DENIED/i.test(procurementDenial) ? 'PASS' : 'FAIL', procurementDenial.replace(/\s+/g, ' ').trim());
    await screenshot(page, 'c2-12-viewer-server-denial', 'procurement');

    const c2RelevantErrors = browserErrors.filter((entry) =>
      !/favicon\.ico|ERR_ABORTED|Failed to load resource|403 \(Forbidden\)|PERMISSION_DENIED/i.test(entry));
    record('C2 browser runtime has no unexpected errors', c2RelevantErrors.length ? 'FAIL' : 'PASS',
      c2RelevantErrors.slice(0, 5).join(' | '));

    // ------------------------------------------------------------------
    // C3 — Canonical POS visible acceptance
    // ------------------------------------------------------------------
    browserErrors.length = 0;
    const posAdmin = await login(page, 'test.sysadmin');
    await page.reload({ waitUntil: 'networkidle2' });
    await dismissLegacyGate(page);
    await openPos(page);
    record('C3 admin authenticates', posAdmin.authenticated ? 'PASS' : 'FAIL', `HTTP ${posAdmin.status}`);
    const posTabs = await page.$$eval('[data-cpos-tab]', (nodes) => nodes.map((node) => node.dataset.cposTab));
    record('C3 POS exposes 10 complete operating areas', posTabs.length === 10 ? 'PASS' : 'FAIL', posTabs.join(','));
    const legacyPosHidden = await page.$eval('#navPOSDeepening', (node) => node.hidden || getComputedStyle(node).display === 'none');
    record('C3 duplicate legacy POS navigation retired', legacyPosHidden ? 'PASS' : 'FAIL');
    await screenshot(page, 'c3-01-pos-dashboard-ar-desktop', 'pos');

    await page.evaluate(async ({ cardAccountId }) => {
      const configured = await window.CanonicalClient.pos.listPaymentMethods();
      if (!configured.some((row) => row.payment_method_id === 'card')) {
        await window.CanonicalClient.pos.configurePaymentMethod({
          payment_method_id: 'card',
          gl_account_id: cardAccountId,
        });
      }
    }, { cardAccountId: fixture.accountIds.card });
    await clickPosTab(page, 'sessions');
    const terminalName = `C3 Browser Terminal ${Date.now().toString(36)}`;
    await page.$eval('[data-cpos-form="terminal"] [name="name"]', (input) => { input.value = ''; });
    await page.type('[data-cpos-form="terminal"] [name="name"]', terminalName);
    await page.select('[data-cpos-form="terminal"] [name="warehouse_id"]', fixture.warehouseId);
    await page.select('[data-cpos-form="terminal"] [name="cash_account_id"]', fixture.accountIds.cash);
    await page.evaluate(() => document.querySelector('[data-cpos-form="terminal"]')?.requestSubmit());
    const terminalId = await poll(page, async (name) =>
      (await window.CanonicalClient.pos.listTerminals()).find((row) => row.name === name)?.id || null,
    { args: [terminalName] });
    await page.waitForFunction(() => window.CanonicalPOS && !window.CanonicalPOS.state.loading);
    record('C3 visible terminal and canonical cashbox configuration', 'PASS', terminalId);

    await page.select('[data-cpos-form="open-session"] [name="terminal_id"]', terminalId);
    await page.$eval('[data-cpos-form="open-session"] [name="opening_cash"]', (input) => { input.value = '50'; });
    await page.evaluate(() => document.querySelector('[data-cpos-form="open-session"]')?.requestSubmit());
    const adminSessionId = await poll(page, async (terminal) =>
      (await window.CanonicalClient.pos.listSessions()).find((row) => row.terminal_id === terminal && row.state === 'opened')?.id || null,
    { args: [terminalId] });
    await page.waitForFunction(() => window.CanonicalPOS && !window.CanonicalPOS.state.loading);
    record('C3 visible cashier session opens with opening cash', 'PASS', adminSessionId);
    await screenshot(page, 'c3-02-session-open-cashbox-ar', 'pos');

    await clickPosTab(page, 'catalogue');
    await page.type('[data-cpos-search]', fixture.suffix);
    const visibleProducts = await page.$$eval('.cpos-product:not([hidden])', (nodes) => nodes.length);
    record('C3 visible catalogue search, barcode foundation, and availability', visibleProducts > 0 ? 'PASS' : 'FAIL', String(visibleProducts));
    await screenshot(page, 'c3-03-catalogue-availability-ar', 'pos');

    await clickPosTab(page, 'cart');
    await page.select('[data-cpos-form="sale"] [name="partner_id"]', fixture.customerId);
    await page.select('[data-cpos-form="sale"] [name="product_id"]', fixture.productId);
    await page.$eval('[data-cpos-form="sale"] [name="qty"]', (input) => { input.value = '1'; });
    await page.$eval('[data-cpos-form="sale"] [name="cash_amount"]', (input) => { input.value = '50'; });
    await page.$eval('[data-cpos-form="sale"] [name="card_amount"]', (input) => { input.value = '75'; });
    await page.evaluate(() => document.querySelector('[data-cpos-form="sale"]')?.requestSubmit());
    const posOrderId = await poll(page, async ({ sessionId, productId }) => {
      const rows = await window.CanonicalClient.pos.listOrders();
      for (const row of rows.filter((item) => item.session_id === sessionId && item.order_kind === 'sale')) {
        const detail = await window.CanonicalClient.pos.getOrder(row.id);
        if (detail.lines.some((line) => line.product_id === productId)) return row.id;
      }
      return null;
    }, { args: [{ sessionId: adminSessionId, productId: fixture.productId }] });
    const posOrder = await page.evaluate((id) => window.CanonicalClient.pos.getOrder(id), posOrderId);
    const posPaymentMethods = posOrder.payments.map((payment) => payment.payment_method_id).sort().join(',');
    record('C3 visible split cash/card sale commits atomically', posPaymentMethods === 'card,cash' ? 'PASS' : 'FAIL', `${posOrder.receipt_number} · ${posPaymentMethods}`);
    await screenshot(page, 'c3-04-split-payment-sale-ar', 'pos');

    await clickPosTab(page, 'receipts');
    await page.waitForSelector(`[data-cpos-receipt="${posOrderId}"]`, { visible: true, timeout: 30000 });
    record('C3 fiscal receipt visible and printable', 'PASS', posOrder.receipt_number);
    await screenshot(page, 'c3-05-fiscal-receipt-register-ar', 'pos');

    await clickPosTab(page, 'returns');
    await page.select('[data-cpos-form="refund"] [name="original_order_id"]', posOrderId);
    await page.$eval('[data-cpos-form="refund"] [name="original_order_line_id"]', (input, value) => { input.value = value; }, posOrder.lines[0].id);
    await page.$eval('[data-cpos-form="refund"] [name="qty"]', (input) => { input.value = '1'; });
    await page.select('[data-cpos-form="refund"] [name="payment_method_id"]', 'card');
    await page.$eval('[data-cpos-form="refund"] [name="amount"]', (input) => { input.value = '125'; });
    await page.$eval('[data-cpos-form="refund"] [name="reason"]', (input) => { input.value = 'C3 browser customer return'; });
    await page.evaluate(() => document.querySelector('[data-cpos-form="refund"]')?.requestSubmit());
    const refundOrderId = await poll(page, async (originalId) =>
      (await window.CanonicalClient.pos.listRefunds()).find((row) => row.original_order_id === originalId)?.refund_order_id || null,
    { args: [posOrderId] });
    await page.waitForFunction(() => window.CanonicalPOS && !window.CanonicalPOS.state.loading);
    record('C3 visible return restores stock and posts card refund', 'PASS', refundOrderId);
    await screenshot(page, 'c3-06-return-refund-ar', 'pos');

    await clickPosTab(page, 'sessions');
    await page.$eval('[data-cpos-form="close-session"] [name="counted_amount"]', (input) => { input.value = '100'; });
    await page.evaluate(() => document.querySelector('[data-cpos-form="close-session"]')?.requestSubmit());
    const adminReconciliation = await poll(page, async (sessionId) =>
      (await window.CanonicalClient.pos.listReconciliations()).find((row) => row.session_id === sessionId) || null,
    { args: [adminSessionId] });
    record('C3 visible cash count, expected balance, variance, and close',
      Number(adminReconciliation.variance) === 0 ? 'PASS' : 'FAIL',
      `${adminReconciliation.expected_amount}/${adminReconciliation.counted_amount}/${adminReconciliation.variance}`);
    await clickPosTab(page, 'reconciliation');
    await screenshot(page, 'c3-07-session-reconciliation-ar', 'pos');
    await clickPosTab(page, 'audit');
    const auditCounts = await page.evaluate(() => ({
      audit: window.CanonicalPOS.state.rows.audit.length,
      outbox: window.CanonicalPOS.state.rows.outbox.length,
    }));
    record('C3 visible audit and outbox evidence', auditCounts.audit > 0 && auditCounts.outbox > 0 ? 'PASS' : 'FAIL', JSON.stringify(auditCounts));
    await screenshot(page, 'c3-08-audit-outbox-ar', 'pos');

    await page.evaluate(() => {
      document.documentElement.lang = 'en';
      document.documentElement.dir = 'ltr';
      window.CanonicalPOS.activate();
    });
    await page.waitForFunction(() => window.CanonicalPOS && !window.CanonicalPOS.state.loading);
    const posDirection = await page.$eval('.cpos-shell', (node) => ({
      dir: node.dir,
      text: node.textContent.includes('Canonical Point of Sale'),
    }));
    record('C3 English LTR surface', posDirection.dir === 'ltr' && posDirection.text ? 'PASS' : 'FAIL', JSON.stringify(posDirection));
    await screenshot(page, 'c3-09-pos-en-ltr', 'pos');
    await page.setViewport({ width: 768, height: 1024, deviceScaleFactor: 1 });
    await screenshot(page, 'c3-10-pos-tablet-768', 'pos');
    await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 1 });
    await screenshot(page, 'c3-11-pos-mobile-375', 'pos');
    const posOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2);
    record('C3 mobile has no page-level horizontal overflow', posOverflow ? 'PASS' : 'FAIL');

    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    const posUser = await login(page, 'test.pos');
    await page.reload({ waitUntil: 'networkidle2' });
    await dismissLegacyGate(page);
    await openPos(page);
    await clickPosTab(page, 'sessions');
    await page.select('[data-cpos-form="open-session"] [name="terminal_id"]', terminalId);
    await page.$eval('[data-cpos-form="open-session"] [name="opening_cash"]', (input) => { input.value = '0'; });
    await page.evaluate(() => document.querySelector('[data-cpos-form="open-session"]')?.requestSubmit());
    const roleSessionId = await poll(page, async (terminal) =>
      (await window.CanonicalClient.pos.listSessions()).find((row) => row.terminal_id === terminal && row.state === 'opened')?.id || null,
    { args: [terminalId] });
    await clickPosTab(page, 'cart');
    await page.select('[data-cpos-form="sale"] [name="partner_id"]', fixture.customerId);
    await page.select('[data-cpos-form="sale"] [name="product_id"]', fixture.productId);
    await page.$eval('[data-cpos-form="sale"] [name="cash_amount"]', (input) => { input.value = '125'; });
    await page.evaluate(() => document.querySelector('[data-cpos-form="sale"]')?.requestSubmit());
    await poll(page, async (sessionId) =>
      (await window.CanonicalClient.pos.listOrders()).some((row) => row.session_id === sessionId && row.state === 'paid'),
    { args: [roleSessionId] });
    await clickPosTab(page, 'sessions');
    await page.$eval('[data-cpos-form="close-session"] [name="counted_amount"]', (input) => { input.value = '125'; });
    await page.evaluate(() => document.querySelector('[data-cpos-form="close-session"]')?.requestSubmit());
    await poll(page, async (sessionId) =>
      (await window.CanonicalClient.pos.listReconciliations()).some((row) => row.session_id === sessionId),
    { args: [roleSessionId] });
    record('C3 operational POS role can open, sell, and reconcile', posUser.authenticated ? 'PASS' : 'FAIL', roleSessionId);

    const posViewer = await login(page, 'test.viewer');
    await page.reload({ waitUntil: 'networkidle2' });
    await dismissLegacyGate(page);
    await openPos(page);
    await clickPosTab(page, 'sessions');
    await page.select('[data-cpos-form="open-session"] [name="terminal_id"]', terminalId);
    await page.evaluate(() => document.querySelector('[data-cpos-form="open-session"]')?.requestSubmit());
    await page.waitForSelector('.cpos-error', { visible: true, timeout: 30000 });
    const posDenial = await page.$eval('.cpos-error', (node) => node.textContent);
    record('C3 restricted viewer mutation denied server-side',
      /not authorized|صلاحية|PERMISSION_DENIED/i.test(posDenial) ? 'PASS' : 'FAIL',
      posDenial.replace(/\s+/g, ' ').trim());
    await screenshot(page, 'c3-12-viewer-server-denial', 'pos');

    const c3RelevantErrors = browserErrors.filter((entry) =>
      !/favicon\.ico|ERR_ABORTED|Failed to load resource|403 \(Forbidden\)|PERMISSION_DENIED/i.test(entry));
    record('C3 browser runtime has no unexpected errors', c3RelevantErrors.length ? 'FAIL' : 'PASS',
      c3RelevantErrors.slice(0, 5).join(' | '));
  } finally {
    const trace = {
      runId,
      baseUrl,
      chromiumVersion,
      completedAt: new Date().toISOString(),
      fixture,
      results,
      screenshots,
      browserErrors,
    };
    fs.writeFileSync(path.join(traceDir, 'checkpoint-c-browser-results.json'), JSON.stringify(trace, null, 2));
    await browser.close();
    console.log(`TRACE ${path.relative(repoRoot, traceDir).replace(/\\/g, '/')}`);
    console.log(`CHROMIUM ${chromiumVersion}`);
    console.log(`RESULT ${results.filter((row) => row.status === 'PASS').length}/${results.length} PASS`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
