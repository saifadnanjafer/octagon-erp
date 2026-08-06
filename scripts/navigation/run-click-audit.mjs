#!/usr/bin/env node
/*
 * Navigation Recovery 1 — real Chromium navigation audit.
 *
 * Navigation is deliberately driven only with visible Puppeteer clicks.  The
 * login bridge is setup, not navigation; no switchPage call is made here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const reportPath = path.join(root, 'docs', 'navigation', 'NAVIGATION_FORENSIC_REPORT.json');
const baseUrl = process.env.NAV_AUDIT_URL || 'http://127.0.0.1:8091';
const itemLimit = Number(process.env.NAV_AUDIT_LIMIT || 0);
const itemOffset = Number(process.env.NAV_AUDIT_OFFSET || 0);
const outputPath = path.join(root, 'docs', 'autopilot', 'evidence', `NAVIGATION-RECOVERY-1-click-audit-${itemOffset || 'all'}.json`);
const reviewPassword = 'Octagon123!'; // disposable local review fixture only
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const selectorFor = (attribute, value) => `[${attribute}="${String(value).replaceAll('"', '\\"')}"]`;

async function authenticate(page) {
  const result = await page.evaluate(async (password) => {
    const login = await fetch('/api/auth/login', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'review.sysadmin', password })
    });
    const body = await login.json().catch(() => ({}));
    if (!login.ok || !body.authenticated) return { ok: false, status: login.status };
    await fetch('/api/auth/context', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId: 'c_alwarsha_demo', branchId: 'b_alwarsha_demo_main' })
    });
    localStorage.setItem('octagon_user_id', body.user?.id || 'usr_review_sysadmin');
    localStorage.setItem('pentagon_user_id', body.user?.id || 'usr_review_sysadmin');
    return { ok: true, status: login.status };
  }, reviewPassword);
  if (!result.ok) throw new Error(`review authentication failed (HTTP ${result.status})`);
}

async function clickVisible(page, selector, label) {
  const locator = page.locator(selector);
  await locator.wait({ state: 'visible', timeout: 2500 });
  await locator.click({ timeout: 2500 });
  await sleep(80);
  return label;
}

async function auditItem(page, item) {
  await clickVisible(page, `.module-domain-tab${selectorFor('data-nav-domain', item.topLevelSection)}`, `domain:${item.topLevelSection}`);
  const group = `[data-nav-group="${item.sidebarGroup}"]`;
  const isCollapsed = await page.$eval(group, element => element.classList.contains('collapsed'));
  if (isCollapsed) await clickVisible(page, `${group} .nav-group-toggle`, `group:${item.sidebarGroup}`);

  const nav = `${group} .nav-btn${selectorFor('data-page', item.id)}`;
  await clickVisible(page, nav, `page:${item.id}`);
  await sleep(220);
  return page.evaluate((pageId) => {
    const navButton = document.querySelector(`.nav-btn[data-page="${CSS.escape(pageId)}"]`);
    const activePage = document.querySelector('.page.page-active')
      || [...document.querySelectorAll('.page')].find(element => getComputedStyle(element).display !== 'none');
    const errorPanel = activePage?.textContent?.includes('تعذّر عرض هذه الصفحة') || false;
    return {
      activeNav: !!navButton?.classList.contains('active'),
      boundNavigation: navButton?.dataset.boundNav || null,
      activePageId: activePage?.id || null,
      activePageKey: activePage?.id || activePage?.dataset.page || null,
      activePageHasContent: Boolean(activePage?.textContent?.trim()),
      errorPanel
      ,build10Loaded: Boolean(window.Build10Engine)
      ,build10Hosts: [...document.querySelectorAll('[data-build10-page]')].map(element => ({ page: element.dataset.build10Page, active: element.classList.contains('page-active'), display: getComputedStyle(element).display }))
      ,build12Loaded: Boolean(window.Build12Engine)
      ,build12Hosts: [...document.querySelectorAll('.b12-page')].map(element => ({ page: element.dataset.build12Page, display: getComputedStyle(element).display }))
    };
  }, item.id);
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const consoleErrors = [];
const responses404 = [];
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('response', response => { if (response.status() === 404) responses404.push(new URL(response.url()).pathname); });

const startedAt = new Date().toISOString();
const items = [];
try {
  await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 60000 });
  await authenticate(page);
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => {
    const overlay = document.getElementById('loginOverlay') || document.querySelector('.login-overlay, #systemLoginOverlay');
    if (overlay) overlay.style.display = 'none';
  });

  const primaryItems = report.items.filter(item => item.visibleInPrimaryNavigation);
  const plannedItems = itemLimit > 0 ? primaryItems.slice(itemOffset, itemOffset + itemLimit) : primaryItems.slice(itemOffset);
  for (const item of plannedItems) {
    const beforeErrors = consoleErrors.length;
    const before404 = responses404.length;
    const started = Date.now();
    try {
      const terminal = await auditItem(page, item);
      items.push({ id: item.id, status: terminal.activeNav && terminal.activePageKey && terminal.activePageHasContent && !terminal.errorPanel ? 'PASS' : 'FAIL', terminal, durationMs: Date.now() - started, consoleErrors: consoleErrors.slice(beforeErrors), notFound: responses404.slice(before404) });
    } catch (error) {
      items.push({ id: item.id, status: 'FAIL', durationMs: Date.now() - started, error: String(error?.message || error), consoleErrors: consoleErrors.slice(beforeErrors), notFound: responses404.slice(before404) });
    }
  }
} finally {
  await browser.close();
}

const summary = {
  generatedAt: new Date().toISOString(), startedAt, baseUrl, method: 'authenticated Chromium visible clicks only; no direct switchPage calls',
  totals: { total: items.length, pass: items.filter(item => item.status === 'PASS').length, fail: items.filter(item => item.status === 'FAIL').length },
  globalConsoleErrors: consoleErrors,
  globalNotFound: responses404,
  items
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`Navigation click audit: ${summary.totals.pass}/${summary.totals.total} passed; ${summary.totals.fail} failed.`);
process.exitCode = summary.totals.fail ? 1 : 0;
