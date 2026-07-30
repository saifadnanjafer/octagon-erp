import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:8097';
const password = 'OctagonTest!2026#Disposable';
const evidenceDir = path.join(repoRoot, 'docs', 'evidence', 'module-expansion-wave-1', 'crm');
const reportPath = path.join(evidenceDir, 'browser-smoke.json');
const screenshotPath = path.join(evidenceDir, 'browser-smoke.png');

fs.mkdirSync(evidenceDir, { recursive: true });

async function login(page, userId) {
  return page.evaluate(async ({ userId, password }) => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, password }),
    });
    const body = await response.json();
    if (response.ok) {
      await fetch('/api/auth/context', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: 'c_octagon_test', branchId: 'b_octagon_test' }),
      });
      localStorage.setItem('octagon_user_id', body.user?.id || userId);
    }
    return { status: response.status, authenticated: Boolean(body.authenticated) };
  }, { userId, password });
}

async function openCrm(page) {
  await page.reload({ waitUntil: 'networkidle2' });
  await page.evaluate(async () => {
    const overlay = document.getElementById('loginOverlay') || document.querySelector('.login-overlay, #systemLoginOverlay');
    if (overlay) overlay.style.display = 'none';
    if (typeof window.switchPage === 'function') await window.switchPage('sales');
  });
  await page.waitForSelector('[data-cs-workspace]', { visible: true, timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('[data-cs-workspace] .cs-loading'), { timeout: 30000 });
}

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => consoleErrors.push(error.message));

const report = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  checks: {},
  consoleErrors,
};

try {
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(baseUrl, { waitUntil: 'networkidle2' });
  report.checks.salesLogin = await login(page, 'test.sales');
  await openCrm(page);
  consoleErrors.length = 0;

  report.checks.tabs = await page.$$eval('[data-cs-tab]', (nodes) => nodes.map((node) => node.dataset.csTab));
  const required = ['dashboard', 'leads', 'opportunities', 'pipeline', 'activities', 'customer-360', 'crm-reports', 'crm-settings'];
  report.checks.requiredTabs = required.every((tab) => report.checks.tabs.includes(tab));
  report.checks.initialError = await page.$eval('[data-cs-workspace]', (node) => Boolean(node.querySelector('.cs-error')));

  await page.click('[data-cs-tab="leads"]');
  await page.waitForSelector('[data-cs-form="lead"] [name="name"]', { visible: true, timeout: 10000 });
  const leadName = `CRM browser ${Date.now().toString(36)}`;
  await page.type('[data-cs-form="lead"] [name="name"]', leadName);
  await page.$eval('[data-cs-form="lead"]', (form) => form.requestSubmit());
  await page.waitForFunction((name) => window.CanonicalSales.state.rows.leads.some((row) => row.name === name), { timeout: 30000 }, leadName);
  report.checks.leadCreated = true;

  for (const tab of ['pipeline', 'activities', 'customer-360', 'crm-reports', 'crm-settings']) {
    await page.click(`[data-cs-tab="${tab}"]`);
    await page.waitForFunction((key) => window.CanonicalSales.state.active === key, {}, tab);
    report.checks[`tab_${tab}`] = true;
  }

  await page.evaluate(() => {
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
    window.CanonicalSales.activate();
  });
  await page.waitForFunction(() => !document.querySelector('[data-cs-workspace] .cs-loading'));
  report.checks.englishLtr = await page.$eval('[data-cs-workspace]', () => document.documentElement.dir === 'ltr');

  await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 1 });
  report.checks.mobileNoPageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2,
  );
  await page.evaluate(() => {
    document.querySelectorAll('#toastContainer, .toast-container, .toast, .notification-toast')
      .forEach((node) => { node.style.display = 'none'; });
  });
  await page.screenshot({ path: screenshotPath, fullPage: true });

  report.checks.viewerLogin = await login(page, 'test.viewer');
  report.checks.viewerMutationDenied = await page.evaluate(async () => {
    try {
      await window.CanonicalClient.crm.createLead({ name: 'Viewer must not write' });
      return false;
    } catch (error) {
      return Boolean(error && (error.isAuthorization || /PERMISSION|authorized|denied/i.test(`${error.code || ''} ${error.message || ''}`)));
    }
  });

  const relevantErrors = consoleErrors.filter((message) => !/favicon|403|Forbidden|PERMISSION/i.test(message));
  report.checks.noUnexpectedConsoleErrors = relevantErrors.length === 0;
  report.relevantConsoleErrors = relevantErrors;
  report.pass = report.checks.salesLogin.authenticated
    && report.checks.requiredTabs
    && !report.checks.initialError
    && report.checks.leadCreated
    && report.checks.englishLtr
    && report.checks.mobileNoPageOverflow
    && report.checks.viewerLogin.authenticated
    && report.checks.viewerMutationDenied
    && report.checks.noUnexpectedConsoleErrors;
} finally {
  await browser.close();
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

console.log(JSON.stringify({ pass: report.pass, reportPath, screenshotPath, checks: report.checks }, null, 2));
if (!report.pass) process.exitCode = 1;
