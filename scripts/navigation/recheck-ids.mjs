#!/usr/bin/env node
/*
 * Focused navigation re-check for a specific set of page ids.
 *
 * WHY: a full 231-page audit run that saturates the machine produces
 * activeNav=false failures that look identical to real navigation defects. The
 * ONLY honest way to tell them apart is to re-drive the same pages, with the
 * SAME method and the SAME settle time, on an unsaturated machine. Raising the
 * settle time here would manufacture a pass and is explicitly not done — see
 * the note in package.json about not "fixing" a starvation timeout by waiting
 * longer.
 *
 * Usage: node scripts/navigation/recheck-ids.mjs           (reads .failed-nav-ids.json)
 *        node scripts/navigation/recheck-ids.mjs a,b,c
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const report = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'navigation', 'NAVIGATION_FORENSIC_REPORT.json'), 'utf8'));
const baseUrl = process.env.NAV_AUDIT_URL || 'http://127.0.0.1:8091';
const reviewPassword = 'Octagon123!'; // disposable local review fixture only

const argIds = process.argv[2] ? process.argv[2].split(',').map((value) => value.trim()).filter(Boolean) : null;
const ids = argIds || JSON.parse(fs.readFileSync(path.join(root, '.failed-nav-ids.json'), 'utf8'));
const byId = new Map(report.items.map((item) => [item.id, item]));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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

// Identical to run-click-audit.mjs: same selectors, same 2500ms locator waits,
// same 80ms post-click pause, same 220ms terminal settle.
async function clickVisible(page, selector) {
  const locator = page.locator(selector);
  await locator.wait({ state: 'visible', timeout: 2500 });
  await locator.click({ timeout: 2500 });
  await sleep(80);
}

async function auditItem(page, item) {
  await clickVisible(page, `.module-domain-tab${selectorFor('data-nav-domain', item.topLevelSection)}`);
  const group = `[data-nav-group="${item.sidebarGroup}"]`;
  const isCollapsed = await page.$eval(group, (element) => element.classList.contains('collapsed'));
  if (isCollapsed) await clickVisible(page, `${group} .nav-group-toggle`);
  await clickVisible(page, `${group} .nav-btn${selectorFor('data-page', item.id)}`);
  // DIAGNOSTIC ONLY. Default stays at the audit's 220ms so a normal re-check is
  // a like-for-like comparison. NAV_SETTLE_MS exists to answer one question:
  // does the destination activate LATE (a latency problem) or NEVER (a
  // structural defect)? It must never be raised to make the real gate pass.
  await sleep(Number(process.env.NAV_SETTLE_MS || 220));
  return page.evaluate((pageId) => {
    const navButton = document.querySelector(`.nav-btn[data-page="${CSS.escape(pageId)}"]`);
    const activePage = document.querySelector('.page.page-active')
      || [...document.querySelectorAll('.page')].find((element) => getComputedStyle(element).display !== 'none');
    const errorPanel = activePage?.textContent?.includes('تعذّر عرض هذه الصفحة') || false;
    return {
      activeNav: !!navButton?.classList.contains('active'),
      activePageKey: activePage?.id || activePage?.dataset.page || null,
      activePageHasContent: Boolean(activePage?.textContent?.trim()),
      errorPanel,
    };
  }, item.id);
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const results = [];
try {
  await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 60000 });
  await authenticate(page);
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => {
    const overlay = document.getElementById('loginOverlay') || document.querySelector('.login-overlay, #systemLoginOverlay');
    if (overlay) overlay.style.display = 'none';
  });

  for (const id of ids) {
    const item = byId.get(id);
    if (!item) { results.push({ id, status: 'FAIL', error: 'not in registry' }); continue; }
    const started = Date.now();
    try {
      const terminal = await auditItem(page, item);
      const pass = terminal.activeNav && terminal.activePageKey && terminal.activePageHasContent && !terminal.errorPanel;
      results.push({ id, status: pass ? 'PASS' : 'FAIL', durationMs: Date.now() - started, terminal });
    } catch (error) {
      results.push({ id, status: 'FAIL', durationMs: Date.now() - started, error: String(error?.message || error) });
    }
  }
} finally {
  await browser.close();
}

const pass = results.filter((entry) => entry.status === 'PASS').length;
const durations = results.map((entry) => entry.durationMs || 0).sort((a, b) => a - b);
console.log(`Re-check: ${pass}/${results.length} passed.`);
console.log(`Median duration: ${durations[Math.floor(durations.length / 2)]}ms  max: ${durations[durations.length - 1]}ms`);
for (const entry of results.filter((r) => r.status === 'FAIL')) {
  console.log(`  FAIL ${entry.id} ${entry.durationMs || '?'}ms ${entry.error || JSON.stringify(entry.terminal)}`);
}
fs.writeFileSync(path.join(root, '.nav-recheck-result.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), pass, total: results.length, results }, null, 2)}\n`);
process.exitCode = pass === results.length ? 0 : 1;
