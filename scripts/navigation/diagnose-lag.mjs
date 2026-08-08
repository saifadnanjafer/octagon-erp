#!/usr/bin/env node
/*
 * Diagnostic for the post-fix navigation lag. Answers one question: after
 * clicking a nav entry, WHAT is the DOM actually doing at 220ms vs later?
 *
 * Not a gate. Throwaway instrumentation kept in-tree because the finding it
 * produced is worth reproducing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const report = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'navigation', 'NAVIGATION_FORENSIC_REPORT.json'), 'utf8'));
const baseUrl = process.env.NAV_AUDIT_URL || 'http://127.0.0.1:8091';
const ids = (process.argv[2] || 'finance,documents,my_work').split(',');
const byId = new Map(report.items.map((item) => [item.id, item]));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const selectorFor = (attribute, value) => `[${attribute}="${String(value).replaceAll('"', '\\"')}"]`;

function snapshot(pageId) {
  const pages = [...document.querySelectorAll('.page')];
  const visible = pages.filter((element) => getComputedStyle(element).display !== 'none');
  const navButton = document.querySelector(`.nav-btn[data-page="${CSS.escape(pageId)}"]`);
  return {
    currentPage: window.currentPage,
    totalPages: pages.length,
    visibleCount: visible.length,
    visibleIds: visible.slice(0, 6).map((element) => element.id || element.dataset.page),
    pageActiveCount: pages.filter((element) => element.classList.contains('page-active')).length,
    pageActiveIds: pages.filter((element) => element.classList.contains('page-active')).map((element) => element.id || element.dataset.page),
    navActive: !!navButton?.classList.contains('active'),
    inlineDisplayCount: pages.filter((element) => element.style.display).length,
  };
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 60000 });
await page.evaluate(async (password) => {
  const login = await fetch('/api/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 'review.sysadmin', password }) });
  const body = await login.json().catch(() => ({}));
  await fetch('/api/auth/context', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId: 'c_alwarsha_demo', branchId: 'b_alwarsha_demo_main' }) });
  localStorage.setItem('octagon_user_id', body.user?.id || 'usr_review_sysadmin');
  localStorage.setItem('pentagon_user_id', body.user?.id || 'usr_review_sysadmin');
}, 'Octagon123!');
await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
await page.evaluate(() => { const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none'; });

console.log(`baseline (before any nav): ${JSON.stringify(await page.evaluate(snapshot, 'home'))}`);
for (const id of ids) {
  const item = byId.get(id);
  if (!item) { console.log(`skip ${id}`); continue; }
  const locator = (selector) => page.locator(selector);
  await locator(`.module-domain-tab${selectorFor('data-nav-domain', item.topLevelSection)}`).click({ timeout: 5000 });
  await sleep(80);
  const group = `[data-nav-group="${item.sidebarGroup}"]`;
  if (await page.$eval(group, (element) => element.classList.contains('collapsed'))) {
    await locator(`${group} .nav-group-toggle`).click({ timeout: 5000 });
    await sleep(80);
  }
  const started = Date.now();
  await locator(`${group} .nav-btn${selectorFor('data-page', id)}`).click({ timeout: 5000 });
  const marks = {};
  for (const delay of [220, 600, 1200, 2500]) {
    while (Date.now() - started < delay) await sleep(25);
    marks[delay] = await page.evaluate(snapshot, id);
  }
  console.log(`\n=== ${id}`);
  for (const [delay, snap] of Object.entries(marks)) {
    console.log(`  @${delay}ms navActive=${snap.navActive} currentPage=${snap.currentPage} visible=${snap.visibleCount} pageActive=${snap.pageActiveCount} [${snap.pageActiveIds.join(',')}] inlineDisplay=${snap.inlineDisplayCount} visibleIds=[${snap.visibleIds.join(',')}]`);
  }
}
await browser.close();
