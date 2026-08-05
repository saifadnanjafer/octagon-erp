import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { createApiHandler } from '../../platform/api/index.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');

export async function openBuild11Browser(t, { name, initialPage }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `octagon-b11-browser-${name}-`));
  const dbPath = path.join(dir, 'browser.db');
  await freshInstall({ dbPath, backupDir: path.join(dir, 'backups'), actor: `build11-browser-${name}` });
  const dialect = openMigrationDatabase(dbPath);
  const authority = createPlatformAuthority(dialect);
  const contextFor = (req) => ({ tenantId: String(req.headers['x-tenant'] || 'default'), companyId: 'default', branchId: 'default', userId: String(req.headers['x-user'] || 'browser-platform'), actorId: String(req.headers['x-user'] || 'browser-platform'), actorType: 'user', correlationId: `build11-${name}-${Date.now()}` });
  const api = createApiHandler({ dialect, prefix: '/api/v1', actionExecutor: authority.actionExecutor, resolveContext: contextFor, authorize: ({ permission, ctx }) => permission === 'platform:saas:cross_tenant' ? { allowed: ctx.userId === 'platform-admin' || ctx.userId === 'browser-platform' } : { allowed: true } });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (api(req, res, url)) return;
    if (url.pathname === '/modules/build11-workspaces.js' || url.pathname === '/modules/build11-workspaces.css') {
      const file = url.pathname.endsWith('.js') ? 'build11-workspaces.js' : 'build11-workspaces.css';
      res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8' }); res.end(fs.readFileSync(path.join(ROOT, 'modules', file))); return;
    }
    if (url.pathname === '/' || url.pathname === '/harness') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/modules/build11-workspaces.css"></head><body><nav><button class="nav-btn" data-page="${initialPage}">${initialPage}</button></nav><main id="mainContent"></main><script>window.__octagonBootstrap={actor:{tenantId:'default'}};window.switchPage=function(){};</script><script src="/modules/build11-workspaces.js"></script><script>document.addEventListener('DOMContentLoaded',()=>window.switchPage(${JSON.stringify(initialPage)}));</script></body></html>`); return;
    }
    res.writeHead(404); res.end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const puppeteer = (await import('puppeteer')).default;
  const browser = await puppeteer.launch({ headless: 'new', userDataDir: path.join(dir, 'chromium-profile'), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage(); const consoleErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); }); page.on('pageerror', (error) => consoleErrors.push(error.message));
  await page.setViewport({ width: 1366, height: 900 }); await page.goto(`http://127.0.0.1:${server.address().port}/harness`, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector(`[data-build11-page="${initialPage}"] .b11-status[data-phase="ready"]`, { timeout: 30000 });
  t.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); dialect.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { browser, consoleErrors, dialect, page, authority };
}

export async function browserAction(page, actionId, input, { tenant = 'default' } = {}) {
  return page.evaluate(async ({ actionId, input, tenant }) => {
    const response = await fetch(`/api/v1/action/${actionId}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant': tenant, 'x-idempotency-key': `${actionId}-${Date.now()}-${Math.random()}` }, body: JSON.stringify({ idempotency_key: `${actionId}-${Date.now()}-${Math.random()}`, ...input }) });
    const payload = await response.json(); if (!response.ok || payload.success === false) throw new Error(`${actionId}: ${response.status} ${payload.error || ''}`); return payload.data;
  }, { actionId, input, tenant });
}

export async function browserQuery(page, resource, { tenant = 'default', user = 'browser-platform' } = {}) {
  return page.evaluate(async ({ resource, tenant, user }) => { const response = await fetch(`/api/v1/saas/${resource}`, { headers: { 'x-tenant': tenant, 'x-user': user } }); const payload = await response.json(); return { status: response.status, ...payload }; }, { resource, tenant, user });
}
