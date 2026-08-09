#!/usr/bin/env node
/*
 * Page Consolidation & Functional Depth — live per-page runtime inspection.
 *
 * WHY THIS EXISTS
 * ---------------
 * `docs/review/UI_UX_AUDIT_MATRIX.md` says of itself: "this file cannot be
 * scored by static analysis, it has no browser and does not observe rendered
 * UI". `docs/review/PAGE_INVENTORY.json` likewise records `canonicalApi: "not
 * discoverable via static analysis"` for most pages. Every qualitative field
 * the functional ledger needs — is this page usable, what can a user actually
 * DO here, does it dead-end, does it leak raw IDs — is a property of the
 * RENDERED page, not of the source file.
 *
 * This script closes that gap: it drives the real application in real Chromium
 * through the same visible-click navigation the click audit uses (no direct
 * switchPage calls), and records what each page actually renders and actually
 * requests. Its output is evidence, not opinion — every ledger field derived
 * from it is traceable to a measured value here.
 *
 * Output: docs/product/PAGE_RUNTIME_INSPECTION.json
 *
 * Precondition: a review server listening (npm run review:setup once, then
 * `PORT=8091 npm run review:start`) — same precondition as test:navigation.
 *
 * Read-only: navigates and observes. It clicks navigation entries only; it
 * never clicks a page's own action buttons, so it cannot mutate business data.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const reportPath = path.join(root, 'docs', 'navigation', 'NAVIGATION_FORENSIC_REPORT.json');
const outputPath = path.join(root, 'docs', 'product', 'PAGE_RUNTIME_INSPECTION.json');
const baseUrl = process.env.NAV_AUDIT_URL || 'http://127.0.0.1:8091';
const itemLimit = Number(process.env.INSPECT_LIMIT || 0);
const itemOffset = Number(process.env.INSPECT_OFFSET || 0);
const reviewPassword = 'Octagon123!'; // disposable local review fixture only

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
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

async function clickVisible(page, selector) {
  const locator = page.locator(selector);
  await locator.wait({ state: 'visible', timeout: 2500 });
  await locator.click({ timeout: 2500 });
  await sleep(80);
}

// Wait for the destination to actually activate instead of sleeping a fixed
// interval — these pages hydrate by fetching views/<id>.html, so activation
// lands anywhere from ~100ms to ~1200ms depending on machine load. Observing a
// half-rendered page would understate its controls and rows and produce a
// falsely THIN classification.
async function waitForActivation(page, pageId, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const ready = await page.evaluate((id) => {
      const navButton = document.querySelector(`.nav-btn[data-page="${CSS.escape(id)}"]`);
      if (!navButton?.classList.contains('active')) return false;
      const active = document.querySelector('.page.page-active');
      return Boolean(active && active.textContent && active.textContent.trim());
    }, pageId).catch(() => false);
    if (ready) return true;
    await sleep(60);
  }
  return false;
}

async function navigateTo(page, item) {
  await clickVisible(page, `.module-domain-tab${selectorFor('data-nav-domain', item.topLevelSection)}`);
  const group = `[data-nav-group="${item.sidebarGroup}"]`;
  const isCollapsed = await page.$eval(group, (element) => element.classList.contains('collapsed'));
  if (isCollapsed) await clickVisible(page, `${group} .nav-group-toggle`);
  await clickVisible(page, `${group} .nav-btn${selectorFor('data-page', item.id)}`);
  const activated = await waitForActivation(page, item.id);
  // Data usually lands after first paint; give async table/list population a
  // bounded chance so row counts reflect a loaded page rather than a skeleton.
  await sleep(activated ? 450 : 250);
  return activated;
}

/*
 * Everything below runs in the page. It observes only the currently active
 * page host so that a stale/hidden sibling workspace cannot contribute
 * controls or rows to another page's measurements.
 */
function inspectActivePage() {
  const visible = (element) => {
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const hostCandidates = [...document.querySelectorAll('.page')];
  const host = hostCandidates.find((element) => element.classList.contains('page-active') && visible(element))
    || hostCandidates.find((element) => visible(element))
    || null;
  if (!host) return { resolved: false };

  const text = (host.innerText || '').trim();
  const controls = [...host.querySelectorAll('button, [role="button"], a.btn, .btn, [onclick]')].filter(visible);
  const controlLabels = [...new Set(controls
    .map((element) => (element.innerText || element.getAttribute('aria-label') || element.title || '').trim())
    .filter((label) => label && label.length <= 60))];

  const inputs = [...host.querySelectorAll('input, textarea, select')].filter(visible);
  const searchInputs = inputs.filter((element) => (
    element.type === 'search'
    || /search|بحث|filter|فلتر|بحث/i.test(`${element.placeholder || ''} ${element.id || ''} ${element.name || ''} ${element.className || ''}`)
  ));
  const selects = inputs.filter((element) => element.tagName === 'SELECT');
  const dateInputs = inputs.filter((element) => element.type === 'date' || element.type === 'month');

  const tables = [...host.querySelectorAll('table')].filter(visible);
  const tableRows = tables.reduce((sum, table) => sum + table.querySelectorAll('tbody tr').length, 0);
  const tableColumns = tables.length ? tables[0].querySelectorAll('thead th').length : 0;
  // Card/list surfaces that are not <table> — many workspaces render lists as
  // repeated card divs, and counting only <table> would score them as empty.
  const listItems = [...host.querySelectorAll('[data-row], [data-id], .list-item, .card-row, li')].filter(visible).length;

  const headings = [...host.querySelectorAll('h1, h2, h3')].filter(visible).map((element) => element.innerText.trim()).filter(Boolean);

  const lower = text.toLowerCase();
  const has = (patterns) => patterns.some((pattern) => pattern.test(text));
  const stateSignals = {
    loading: has([/جارٍ التحميل|جاري التحميل/, /loading/i]) || !!host.querySelector('.spinner, .loading, [data-state="loading"]'),
    empty: has([/لا توجد|لا يوجد|فارغ/, /no data|no records|empty|nothing/i]) || !!host.querySelector('[data-state="empty"], .empty-state'),
    error: has([/تعذّر|خطأ|فشل/, /error|failed/i]) || !!host.querySelector('[data-state="error"], .error-state'),
    denied: has([/ليس لديك صلاحية|غير مصرح/, /denied|forbidden|not authorized/i]) || !!host.querySelector('[data-state="denied"]'),
  };

  // Cross-page links: what this page can hand off TO. Both the declarative
  // data-page form and the inline switchPage('x') form are in use.
  const linkTargets = new Set();
  host.querySelectorAll('[data-page]').forEach((element) => linkTargets.add(element.getAttribute('data-page')));
  [...host.querySelectorAll('[onclick]')].forEach((element) => {
    const match = /switchPage\(\s*['"]([a-zA-Z0-9_]+)['"]/.exec(element.getAttribute('onclick') || '');
    if (match) linkTargets.add(match[1]);
  });

  // Raw-identifier and raw-JSON exposure (spec section 25: "no normal-user raw
  // IDs / raw JSON"). Deliberately narrow patterns to avoid flagging ordinary
  // reference numbers like INV-2026-0001, which are legitimate business refs.
  const rawIdMatches = (text.match(/\b[a-z][a-z0-9]*_[0-9a-f]{8,}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g) || []);
  const rawJson = /^\s*[[{][\s\S]{40,}[\]}]\s*$/.test(text) || /"[a-zA-Z_]+"\s*:\s*("|\d|\[|\{)/.test(text);

  const arabicChars = (text.match(/[؀-ۿ]/g) || []).length;
  const latinChars = (text.match(/[A-Za-z]/g) || []).length;

  return {
    resolved: true,
    hostId: host.id || null,
    hostDataPage: host.dataset.page || host.dataset.build10Page || host.dataset.build11Page || host.dataset.build12Page || null,
    headings,
    title: headings[0] || null,
    textLength: text.length,
    controlCount: controls.length,
    controlLabels: controlLabels.slice(0, 40),
    inputCount: inputs.length,
    selectCount: selects.length,
    searchInputCount: searchInputs.length,
    dateInputCount: dateInputs.length,
    tableCount: tables.length,
    tableRows,
    tableColumns,
    listItems,
    stateSignals,
    linkTargets: [...linkTargets],
    rawIdCount: rawIdMatches.length,
    rawIdSamples: [...new Set(rawIdMatches)].slice(0, 3),
    rawJson,
    arabicChars,
    latinChars,
  };
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

const consoleErrors = [];
const pageErrors = [];
const networkLog = [];
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));
page.on('response', (response) => {
  const status = response.status();
  if (status < 400) return;
  const url = new URL(response.url());
  networkLog.push({ status, path: url.pathname, method: response.request().method() });
});

const startedAt = new Date().toISOString();
const results = [];
try {
  await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 60000 });
  await authenticate(page);
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => {
    const overlay = document.getElementById('loginOverlay') || document.querySelector('.login-overlay, #systemLoginOverlay');
    if (overlay) overlay.style.display = 'none';
  });

  const primaryItems = report.items.filter((item) => item.visibleInPrimaryNavigation);
  const planned = itemLimit > 0
    ? primaryItems.slice(itemOffset, itemOffset + itemLimit)
    : primaryItems.slice(itemOffset);

  let index = 0;
  for (const item of planned) {
    index += 1;
    const beforeConsole = consoleErrors.length;
    const beforePageErrors = pageErrors.length;
    const beforeNetwork = networkLog.length;
    const started = Date.now();
    let observation = null;
    let error = null;
    let activated = false;
    try {
      activated = await navigateTo(page, item);
      observation = await page.evaluate(inspectActivePage);
    } catch (navigationError) {
      error = String(navigationError?.message || navigationError);
    }
    results.push({
      id: item.id,
      labelEn: item.labelEn,
      labelAr: item.labelAr,
      domain: item.topLevelSection,
      sidebarGroup: item.sidebarGroup,
      rendererType: item.rendererType,
      rendererSource: item.rendererSource,
      requiredPermission: item.requiredPermission,
      durationMs: Date.now() - started,
      error,
      // Distinguishes "the destination never activated" from "it activated and
      // simply has little on it" — without this, a navigation failure and a
      // genuinely thin page look identical in the ledger.
      activated,
      observation,
      consoleErrors: consoleErrors.slice(beforeConsole),
      pageErrors: pageErrors.slice(beforePageErrors),
      failedRequests: networkLog.slice(beforeNetwork),
    });
    if (index % 20 === 0) console.log(`  inspected ${index}/${planned.length}…`);
  }
} finally {
  await browser.close();
}

// A partial run (INSPECT_OFFSET/INSPECT_LIMIT, or a re-check of specific pages)
// MERGES into any existing output rather than overwriting it. Without this, a
// one-page targeted re-check after a full run silently discards the other 230
// results — which is exactly the mistake this comment exists to prevent from
// recurring. Merge is keyed by page id and ordered by the canonical primary
// navigation order, not by run order, so the file stays stable across partial
// re-runs.
const existing = fs.existsSync(outputPath) ? JSON.parse(fs.readFileSync(outputPath, 'utf8')) : null;
const merged = new Map((existing?.pages || []).map((entry) => [entry.id, entry]));
for (const entry of results) merged.set(entry.id, entry);
const allPrimaryIds = report.items.filter((item) => item.visibleInPrimaryNavigation).map((item) => item.id);
const orderedPages = allPrimaryIds.map((id) => merged.get(id)).filter(Boolean);

const summary = {
  generatedAt: new Date().toISOString(),
  startedAt,
  baseUrl,
  method: 'authenticated Chromium; visible navigation clicks only; page action buttons never clicked (read-only observation)',
  totals: {
    total: orderedPages.length,
    resolved: orderedPages.filter((entry) => entry.observation?.resolved).length,
    unresolved: orderedPages.filter((entry) => !entry.observation?.resolved).length,
  },
  pages: orderedPages,
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(`Runtime inspection: ${summary.totals.resolved}/${summary.totals.total} pages observed (this run: ${results.length}) -> ${path.relative(root, outputPath)}`);
