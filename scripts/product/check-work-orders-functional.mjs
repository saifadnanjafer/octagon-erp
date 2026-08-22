#!/usr/bin/env node
// Disposable-review acceptance for the legacy Workshop Work Orders surface.
// It intentionally uses visible navigation and controls, then reloads to prove
// the fictional record survives the client/server persistence boundary.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const baseUrl = process.env.NAV_AUDIT_URL || 'http://127.0.0.1:8091';
const password = 'Octagon123!'; // review fixture only
const title = `Review Work Order ${Date.now()}`;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
let stage = 'launch';
let creationProbe = null;

async function authenticate(page) {
  const result = await page.evaluate(async (reviewPassword) => {
    const login = await fetch('/api/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 'review.sysadmin', password: reviewPassword }) });
    const body = await login.json().catch(() => ({}));
    if (!login.ok || !body.authenticated) return { ok: false, status: login.status };
    const context = await fetch('/api/auth/context', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId: 'c_alwarsha_demo', branchId: 'b_alwarsha_demo_main' }) });
    localStorage.setItem('octagon_user_id', body.user?.id || 'usr_review_sysadmin');
    localStorage.setItem('pentagon_user_id', body.user?.id || 'usr_review_sysadmin');
    return { ok: true, contextStatus: context.status };
  }, password);
  const sessionCookie = (await page.cookies()).find((cookie) => cookie.name === 'octagon_session');
  if (!result.ok || result.contextStatus !== 200 || !sessionCookie) {
    throw new Error(`review authentication failed (login ${result.status || 'unknown'}, context ${result.contextStatus || 'unknown'}, session cookie ${sessionCookie ? 'present' : 'missing'})`);
  }
}

async function assertAuthenticated(page, checkpoint) {
  const session = await page.evaluate(async () => {
    const response = await fetch('/api/auth/session', { credentials: 'same-origin' });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  });
  if (session.status !== 200 || !session.body?.authenticated) {
    throw new Error(`review session was not authenticated at ${checkpoint}: HTTP ${session.status}`);
  }
  const data = await page.evaluate(async () => {
    const response = await fetch('/api/db', { credentials: 'same-origin' });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  });
  if (data.status !== 200 || !Array.isArray(data.body?.employees) || data.body.employees.length === 0) {
    throw new Error(`review data was not readable at ${checkpoint}: HTTP ${data.status}, employees ${Array.isArray(data.body?.employees) ? data.body.employees.length : 'missing'}, top-level keys ${Object.keys(data.body || {}).sort().join(',') || 'none'}`);
  }
}

async function clickVisible(page, selector) {
  const locator = page.locator(selector);
  await locator.wait({ state: 'visible', timeout: 5000 });
  await locator.click({ timeout: 5000 });
}

async function openWorkOrders(page) {
  await clickVisible(page, '.module-domain-tab[data-nav-domain="ops"]');
  const group = '[data-nav-group="ops_production"]';
  if (await page.$eval(group, node => node.classList.contains('collapsed'))) await clickVisible(page, `${group} .nav-group-toggle`);
  await clickVisible(page, `${group} .nav-btn[data-page="work_orders"]`);
  await page.waitForSelector('#workOrdersBody [data-jarvis-action="work_orders.open_wizard"]', { visible: true, timeout: 15000 });
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const browserErrors = [];
try {
  const page = await browser.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') browserErrors.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${String(error?.message || error)}`));
  await page.setViewport({ width: 1440, height: 900 });
  stage = 'initial-page-load';
  await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 60000 });
  stage = 'initial-authentication';
  await authenticate(page);
  stage = 'initial-reload';
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => { const overlay = document.getElementById('loginOverlay') || document.querySelector('.login-overlay, #systemLoginOverlay'); if (overlay) overlay.style.display = 'none'; });
  stage = 'initial-data-hydration';
  await page.waitForFunction(() => window.__dataLoadComplete === true, { timeout: 20000 });
  await assertAuthenticated(page, stage);

  stage = 'open-work-orders';
  await openWorkOrders(page);
  stage = 'open-work-order-wizard';
  await page.click('#workOrdersBody [data-jarvis-action="work_orders.open_wizard"]');
  await page.waitForSelector('#woWizTitle', { visible: true, timeout: 10000 });
  stage = 'create-fictional-order';
  const customerId = await page.$eval('#woWizCustomer', (select) => select.querySelector('option[value]:not([value=""])')?.value || '');
  if (!customerId) throw new Error('disposable review fixture did not expose a selectable workshop customer');
  await page.select('#woWizCustomer', customerId);
  await page.type('#woWizTitle', title);
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    window.__workOrdersReviewRequests = [];
    window.fetch = async (...args) => {
      const url = String(args[0]);
      const method = args[1]?.method || 'GET';
      try {
        const response = await originalFetch(...args);
        window.__workOrdersReviewRequests.push({ url, method, status: response.status });
        return response;
      } catch (error) {
        window.__workOrdersReviewRequests.push({ url, method, error: String(error?.message || error) });
        throw error;
      }
    };
  });
  await page.click('#workOrdersBody [data-jarvis-action="work_orders.submit_wizard"]');
  await sleep(700);
  const created = await page.evaluate((expected) => {
    const orders = window.OctagonWorkOrders?.list() || [];
    return {
      exists: orders.some(order => order.title === expected),
      apiPresent: Boolean(window.OctagonWorkOrders),
      count: orders.length,
      saveDataType: typeof window.saveData,
      dataLoadComplete: window.__dataLoadComplete === true,
      requests: window.__workOrdersReviewRequests || [],
      body: document.querySelector('#workOrdersBody')?.innerText.slice(0, 500) || '',
    };
  }, title);
  creationProbe = created;
  if (!created.exists) throw new Error(`fictional order was not created: ${JSON.stringify(created)}`);
  const successfulPersistenceWrites = created.requests.filter((request) =>
    request.url === '/api/db' && request.method === 'POST' && request.status >= 200 && request.status < 300,
  );
  if (!successfulPersistenceWrites.length) {
    throw new Error(`fictional order was created in the active client state, but no successful full-state persistence write was observed: ${JSON.stringify(created.requests)}`);
  }
  await sleep(250);

  stage = 'persistence-reload';
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  stage = 'persistence-authentication';
  await authenticate(page);
  stage = 'persistence-context-reload';
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => { const overlay = document.getElementById('loginOverlay') || document.querySelector('.login-overlay, #systemLoginOverlay'); if (overlay) overlay.style.display = 'none'; });
  stage = 'persistence-data-hydration';
  await page.waitForFunction(() => window.__dataLoadComplete === true, { timeout: 20000 });
  await assertAuthenticated(page, stage);
  stage = 'verify-persisted-order';
  await openWorkOrders(page);
  await page.waitForFunction((expected) => document.querySelector('#workOrdersBody')?.textContent.includes(expected), { timeout: 15000 }, title);
  fs.writeFileSync(
    path.join(process.cwd(), '.review-data', 'work-orders-functional-result.json'),
    JSON.stringify({ acceptedAt: new Date().toISOString(), baseUrl, title, persistenceWrites: successfulPersistenceWrites, stage: 'accepted' }, null, 2) + '\n',
  );
  console.log(`Work Orders functional acceptance passed: persisted fictional review job "${title}".`);
} catch (error) {
  fs.writeFileSync(
    path.join(process.cwd(), '.review-data', 'work-orders-functional-result.json'),
    JSON.stringify({ failedAt: new Date().toISOString(), baseUrl, title, stage, creationProbe, browserErrors, error: error instanceof Error ? error.message : String(error) }, null, 2) + '\n',
  );
  throw error;
} finally {
  await browser.close();
}
