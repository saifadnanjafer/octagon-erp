#!/usr/bin/env node
// Throwaway diagnostic: dump the actual DOM around data-state attributes for
// one page, so the state-signal detector can be fixed against real markup
// instead of guesses.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const report = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'navigation', 'NAVIGATION_FORENSIC_REPORT.json'), 'utf8'));
const baseUrl = process.env.NAV_AUDIT_URL || 'http://127.0.0.1:8091';
const id = process.argv[2] || 'device_command_center';
const item = report.items.find((i) => i.id === id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const selectorFor = (a, v) => `[${a}="${String(v).replaceAll('"', '\\"')}"]`;

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

await page.locator(`.module-domain-tab${selectorFor('data-nav-domain', item.topLevelSection)}`).click({ timeout: 5000 });
await sleep(150);
const group = `[data-nav-group="${item.sidebarGroup}"]`;
if (await page.$eval(group, (el) => el.classList.contains('collapsed'))) {
  await page.locator(`${group} .nav-group-toggle`).click({ timeout: 5000 });
  await sleep(150);
}
await page.locator(`${group} .nav-btn${selectorFor('data-page', id)}`).click({ timeout: 5000 });
await sleep(1200);

const dump = await page.evaluate((pageId) => {
  const hostCandidates = [...document.querySelectorAll('.page')];
  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const host = hostCandidates.find((el) => el.classList.contains('page-active') && visible(el)) || hostCandidates.find(visible);
  if (!host) return { error: 'no host' };
  const nodes = [...host.querySelectorAll('[data-state], .spinner, .loading, .empty-state, .error-state')];
  return {
    hostTag: host.tagName, hostId: host.id, hostClasses: host.className,
    fullInnerText: host.innerText,
    nodeCount: nodes.length,
    nodes: nodes.slice(0, 12).map((n) => ({
      tag: n.tagName,
      class: n.className,
      dataState: n.getAttribute('data-state'),
      display: getComputedStyle(n).display,
      visibility: getComputedStyle(n).visibility,
      rect: (() => { const r = n.getBoundingClientRect(); return { w: r.width, h: r.height }; })(),
      textSample: (n.textContent || '').trim().slice(0, 60),
      outerHTMLSample: n.outerHTML.slice(0, 200),
    })),
  };
}, id);
console.log(JSON.stringify(dump, null, 2));
await browser.close();
