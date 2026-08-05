import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { createApiHandler } from '../../platform/api/index.mjs';
import { createPermissionEvaluator } from '../../platform/authorization/evaluator/index.mjs';
import { createStockLocation, createWarehouse } from '../../platform/inventory/warehouses.mjs';
import { postStockMove } from '../../platform/inventory/ledger.mjs';
import * as topology from '../../platform/wms/topology.mjs';
import { products } from '../../platform/commercial/index.mjs';
import { setApprovalAuthorityLimit } from '../../platform/finance/engine.mjs';
import * as putaway from '../../platform/wms/putaway.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');

function seedOperationalFacts(dialect, name) {
  const companyId = 'default';
  const warehouse = createWarehouse(dialect, { company_id: companyId, name: `Browser DC ${name}`, code: `B${name.slice(0, 4).toUpperCase()}` });
  const stamp = new Date().toISOString();
  dialect.prepare('INSERT INTO warehouse_branch_scopes(warehouse_id,company_id,branch_id,created_at) VALUES(?,?,?,?)').run(warehouse.id, companyId, 'branch-a', stamp);
  const category = products.createProductCategory(dialect, { company_id: companyId, name: 'Browser Valued Goods', costing_method: 'avco', stock_account_id: 'acc_104000', stock_input_account_id: 'acc_201000', stock_output_account_id: 'acc_500000', expense_account_id: 'acc_501000' });
  dialect.prepare('INSERT INTO product_templates(id,company_id,name,code,type,category_id,uom_id,purchase_uom_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run('tmpl-browser-b09', companyId, 'Browser Product', 'B09-P', 'storable', category.id, 'unit', 'unit', stamp);
  setApprovalAuthorityLimit(dialect, { companyId, branchId: 'branch-a', userId: 'browser-inventory' }, { role_or_user: 'browser-inventory', limit_type: 'post', max_amount: 1_000_000_000, currency: 'IQD' });
  dialect.prepare('INSERT INTO product_variants(id,template_id,company_id,sku,name,barcode,created_at) VALUES(?,?,?,?,?,?,?)').run('product-browser-b09', 'tmpl-browser-b09', companyId, 'B09-SKU', 'Browser Product', 'B09-BARCODE', stamp);
  dialect.prepare('INSERT INTO stock_picking_types(id,company_id,warehouse_id,name,code,created_at) VALUES(?,?,?,?,?,?)').run('incoming-browser-b09', companyId, warehouse.id, 'Browser Receipts', 'incoming', stamp);
  const ctx = { company_id: companyId, warehouse_id: warehouse.id, branch_id: 'branch-a', actor: 'browser-manager' };
  const storageZone = topology.createZone(dialect, { ...ctx, code: 'B-STO', name: 'Browser Storage', zone_type: 'storage' });
  const source = topology.createLocation(dialect, { ...ctx, zone_id: storageZone.id, parent_id: warehouse.lot_stock_id, name: 'Browser Pick Bin', location_code: 'B-PICK', barcode: 'B-PICK', location_type: 'bin', capacity_units: 100 });
  const destination = topology.createLocation(dialect, { ...ctx, zone_id: storageZone.id, parent_id: warehouse.lot_stock_id, name: 'Browser Putaway Bin', location_code: 'B-PUT', barcode: 'B-PUT', location_type: 'bin', capacity_units: 100 });
  const staging = topology.createLocation(dialect, { ...ctx, zone_id: storageZone.id, parent_id: warehouse.output_location_id, name: 'Browser Staging', location_code: 'B-STAGE', barcode: 'B-STAGE', location_type: 'staging', capacity_units: 100 });
  const supplier = createStockLocation(dialect, { company_id: companyId, warehouse_id: warehouse.id, parent_id: warehouse.view_location_id, name: 'Synthetic Supplier', usage: 'supplier' });
  postStockMove(dialect, { company_id: companyId, branch_id: 'branch-a', reference: 'B09-BROWSER-SEED-PICK', product_id: 'product-browser-b09', uom_id: 'unit', product_qty: 20, location_id: supplier.id, location_dest_id: source.locationId, unit_cost: 10, idempotency_key: `browser-pick-${name}` });
  const rule = putaway.createPutawayRule(dialect, { ...ctx, name: 'Browser fixed putaway', rule_type: 'product', product_id: 'product-browser-b09', destination_location_id: destination.locationId, priority: 1 });
  return { companyId, warehouse, source, destination, staging, supplier, productId: 'product-browser-b09', rule };
}

// BUILD-09R-2 group workspaces ship as their own modules; a test opts in by naming them in
// `extraModules` so the harness only loads what the page under test actually needs.
const BASE_MODULES = ['octagon-api-client.js', 'octagon-runtime-context.js', 'octagon-governed-lookups.js', 'octagon-scope-selector.js', 'build09-action-forms.js', 'build09-workspaces.js', 'build09-mobile-receiving.js', 'build09-mobile-picking.js'];

export async function openBuild09Browser(t, { name, initialPage, extraModules = [], user = 'browser-manager' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `octagon-b09-browser-${name}-`));
  const dbPath = path.join(dir, 'browser.db');
  await freshInstall({ dbPath, backupDir: path.join(dir, 'backups'), actor: `build09-browser-${name}` });
  const dialect = openMigrationDatabase(dbPath);
  const seed = seedOperationalFacts(dialect, name);
  const authority = createPlatformAuthority(dialect);
  const permissionEvaluator = createPermissionEvaluator(dialect);
  const contextFor = (req) => ({
    companyId: String(req.headers['x-company'] || seed.companyId), activeCompanyId: String(req.headers['x-company'] || seed.companyId),
    warehouseId: String(req.headers['x-warehouse'] || seed.warehouse.id), tenantId: 'default', branchId: 'branch-a',
    userId: String(req.headers['x-user'] || user), actorId: String(req.headers['x-user'] || user),
    actorType: 'user', correlationId: `build09-${name}-${Date.now()}`,
  });
  const api = createApiHandler({
    dialect, prefix: '/api/v1', actionExecutor: authority.actionExecutor, resolveContext: contextFor, permissionEvaluator,
    authorize: ({ ctx }) => ctx.userId === 'viewer-user' ? { allowed: false, statusCode: 403, message: 'Permission denied' } : { allowed: true },
  });

  const pageScripts = [...BASE_MODULES, ...extraModules];
  const STATIC_MODULES = [...pageScripts, 'build09-workspaces.css'];
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, 'http://127.0.0.1');
    if (requestUrl.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (requestUrl.pathname === '/api/auth/options' && req.method === 'GET') {
      const users = dialect.prepare(`SELECT id, login, name, locale FROM identity_users WHERE status = 'active' ORDER BY name, login`).all()
        .map((user) => ({ id: user.id, login: user.login, name: user.name, displayName: user.name, locale: user.locale || 'ar' }));
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ success: true, users })); return;
    }
    if (api(req, res, requestUrl)) return;
    const staticName = requestUrl.pathname.startsWith('/modules/') ? requestUrl.pathname.slice('/modules/'.length) : null;
    if (staticName && STATIC_MODULES.includes(staticName)) {
      res.writeHead(200, { 'content-type': staticName.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8' });
      res.end(fs.readFileSync(path.join(ROOT, 'modules', staticName))); return;
    }
    if (requestUrl.pathname === '/' || requestUrl.pathname === '/harness') {
      const scripts = pageScripts.map((file) => `<script src="/modules/${file}"></script>`).join('');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/modules/build09-workspaces.css"><style>body{margin:0;padding:24px;background:#020617;font-family:Arial,sans-serif}.page{display:none}.page-active{display:block}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden}</style></head><body><nav><button class="nav-btn" data-page="${initialPage}"></button></nav><main id="mainContent"></main><script>window.switchPage=function(){};</script>${scripts}<script>document.addEventListener('DOMContentLoaded',()=>window.switchPage(${JSON.stringify(initialPage)}));</script></body></html>`);
      return;
    }
    res.writeHead(404); res.end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const puppeteer = (await import('puppeteer')).default;
  const browser = await puppeteer.launch({ headless: 'new', userDataDir: path.join(dir, 'chromium-profile'), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage(); const consoleErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  await page.setViewport({ width: 1366, height: 900 });
  await page.goto(`http://127.0.0.1:${server.address().port}/harness`, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForFunction((pageId) => document.querySelector(`[data-build09-page="${pageId}"]`)?.classList.contains('page-active'), {}, initialPage);
  t.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); dialect.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { authority, browser, consoleErrors, dialect, page, seed };
}

export async function browserAction(page, actionId, input, { user = 'browser-manager', company = 'default', warehouse } = {}) {
  return page.evaluate(async ({ actionId, input, user, company, warehouse }) => {
    const response = await fetch(`/api/v1/action/${actionId}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user': user, 'x-company': company, 'x-warehouse': warehouse || '' }, body: JSON.stringify({ idempotency_key: `${actionId}-${Date.now()}-${Math.random().toString(36).slice(2)}`, ...input }) });
    const payload = await response.json(); if (!response.ok || payload.success === false) throw new Error(`${actionId}: ${response.status} ${JSON.stringify(payload.error)}`); return payload.data;
  }, { actionId, input, user, company, warehouse });
}

export async function browserQuery(page, resource, options = {}) {
  return page.evaluate(async ({ resource, options }) => {
    const response = await fetch(`/api/v1/wms/${resource}`, { headers: { 'x-user': options.user || 'browser-manager', 'x-company': options.company || 'default', 'x-warehouse': options.warehouse || '' } });
    const payload = await response.json(); return { status: response.status, ...payload };
  }, { resource, options });
}
