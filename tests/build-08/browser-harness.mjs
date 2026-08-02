import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { createApiHandler } from '../../platform/api/index.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');

export async function openBuild08Browser(t, { name, companyId = 'company-a', initialPage }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `octagon-b08-browser-${name}-`));
  const dbPath = path.join(dir, 'browser.db');
  await freshInstall({ dbPath, backupDir: path.join(dir, 'backups'), actor: `build08-browser-${name}` });
  const dialect = openMigrationDatabase(dbPath);
  const authority = createPlatformAuthority(dialect);
  const ctx = { companyId, activeCompanyId: companyId, tenantId: 'default', branchId: 'default', userId: 'browser-owner', actorId: 'browser-owner', actorType: 'user', correlationId: `build08-${name}` };
  const api = createApiHandler({ dialect, prefix: '/api/v1', actionExecutor: authority.actionExecutor, resolveContext: () => ctx, authorize: () => ({ allowed: true }) });

  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, 'http://127.0.0.1');
    if (requestUrl.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (api(req, res, requestUrl)) return;
    if (requestUrl.pathname === '/modules/build08-workspaces.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      res.end(fs.readFileSync(path.join(ROOT, 'modules/build08-workspaces.js')));
      return;
    }
    if (requestUrl.pathname === '/modules/build08-workspaces.css') {
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
      res.end(fs.readFileSync(path.join(ROOT, 'modules/build08-workspaces.css')));
      return;
    }
    const viewMatch = /^\/views\/([a-z0-9_]+)\.html$/.exec(requestUrl.pathname);
    if (viewMatch) {
      const file = path.join(ROOT, 'views', `${viewMatch[1]}.html`);
      if (fs.existsSync(file)) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(file));
        return;
      }
    }
    if (requestUrl.pathname === '/' || requestUrl.pathname === '/harness') {
      const view = fs.readFileSync(path.join(ROOT, 'views', `${initialPage}.html`), 'utf8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/modules/build08-workspaces.css"><style>body{margin:0;padding:24px;background:#020617;font-family:Arial,sans-serif}.page{display:none}.page-active{display:block}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden}</style></head><body><main id="mainContent">${view}</main><script>window.__octagonBootstrap={actor:{activeCompanyId:${JSON.stringify(companyId)}},actions:[{id:'db_write',enabled:true}]};window.switchPage=function(){};window.ensurePageTemplateLoaded=async function(page){if(document.querySelector('[data-build08-page="'+page+'"]'))return;const text=await fetch('/views/'+page+'.html').then(r=>r.text());document.getElementById('mainContent').insertAdjacentHTML('beforeend',text)};</script><script src="/modules/build08-workspaces.js"></script><script>document.addEventListener('DOMContentLoaded',()=>window.switchPage(${JSON.stringify(initialPage)}));</script></body></html>`);
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const puppeteer = (await import('puppeteer')).default;
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  await page.setViewport({ width: 1366, height: 900 });
  await page.goto(`http://127.0.0.1:${server.address().port}/harness`, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForFunction((pageId) => document.querySelector(`[data-build08-page="${pageId}"]`)?.classList.contains('page-active'), {}, initialPage);

  async function close() {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    dialect.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  t.after(close);
  return { authority, browser, consoleErrors, ctx, dialect, page, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

export async function browserAction(page, actionId, input) {
  return page.evaluate(async ({ actionId, input }) => {
    const response = await fetch(`/api/v1/action/${actionId}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idempotency_key: `${actionId}-${Date.now()}-${Math.random().toString(36).slice(2)}`, ...input }) });
    const payload = await response.json();
    if (!response.ok || payload.success === false) throw new Error(`${actionId}: ${JSON.stringify(payload.error)}`);
    return payload.data;
  }, { actionId, input });
}

export async function browserQuery(page, pathName) {
  return page.evaluate(async (pathName) => {
    const response = await fetch(`/api/v1/${pathName}`);
    const payload = await response.json();
    if (!response.ok || payload.success === false) throw new Error(`${pathName}: ${JSON.stringify(payload.error)}`);
    return payload.data;
  }, pathName);
}
