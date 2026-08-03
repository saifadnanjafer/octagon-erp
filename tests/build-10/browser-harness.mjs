import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { createApiHandler } from '../../platform/api/index.mjs';
import * as deviceRegistry from '../../platform/iot/device-registry.mjs';
import * as gateways from '../../platform/iot/gateways.mjs';
import * as fleetMapping from '../../platform/iot/fleet-telematics-mapping.mjs';
import * as clientRegistry from '../../platform/offline/client-registry.mjs';
import * as kioskRegistry from '../../platform/kiosk/kiosk-registry.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');

function seedOperationalFacts(dialect, name) {
  const companyId = 'default';
  const stamp = new Date().toISOString();

  // Seed fleet vehicle
  dialect.prepare('INSERT INTO fleet_vehicles(id,company_id,vehicle_number,registration_number,name,license_plate,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('veh-browser-b10', companyId, 'VN-BROWSER-B10', 'REG-BROWSER-B10', 'Browser Telematics Van', 'BAGHDAD-B10', 'active', stamp, stamp);

  const ctx = { company_id: companyId, warehouse_id: 'wh-main', branch_id: 'branch-a', actor: 'browser-manager' };

  // Seed IoT device
  const device = deviceRegistry.enrollDevice(dialect, { ...ctx, device_code: 'DEV-BROWSER-1', name: 'Browser GPS Tracker 1', device_type: 'tracker' });
  deviceRegistry.updateDeviceStatus(dialect, { ...ctx, device_id: device.id, status: 'active', actor: 'browser-admin' });
  const mapInput = { ...ctx, vehicle_id: 'veh-browser-b10', tracker_device_id: device.id, odometer_offset_km: 12000 };
  fleetMapping.mapFleetDevice(dialect, mapInput, mapInput);

  // Seed Offline Client
  const client = clientRegistry.registerOfflineClient(dialect, { client_uuid: 'PWA-BROWSER-99', device_name: 'Browser PWA Scanner' }, ctx);

  // Seed Kiosk Device
  const kiosk = kioskRegistry.registerKiosk(dialect, { code: 'KIOSK-BROWSER-1', kiosk_type: 'warehouse', name: 'Browser Fleet Board Kiosk' }, ctx);

  return { companyId, vehicleId: 'veh-browser-b10', deviceId: device.id, clientId: client.id, kioskId: kiosk.id };
}

export async function openBuild10Browser(t, { name, initialPage }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `octagon-b10-browser-${name}-`));
  const dbPath = path.join(dir, 'browser.db');
  await freshInstall({ dbPath, backupDir: path.join(dir, 'backups'), actor: `build10-browser-${name}` });
  const dialect = openMigrationDatabase(dbPath);
  const seed = seedOperationalFacts(dialect, name);
  const authority = createPlatformAuthority(dialect);

  const contextFor = (req) => ({
    companyId: String(req.headers['x-company'] || seed.companyId),
    activeCompanyId: String(req.headers['x-company'] || seed.companyId),
    warehouseId: 'wh-main',
    tenantId: 'default',
    branchId: 'branch-a',
    userId: String(req.headers['x-user'] || 'browser-manager'),
    actorId: String(req.headers['x-user'] || 'browser-manager'),
    actorType: 'user',
    correlationId: `build10-${name}-${Date.now()}`,
  });

  const api = createApiHandler({
    dialect,
    prefix: '/api/v1',
    actionExecutor: authority.actionExecutor,
    resolveContext: contextFor,
    authorize: ({ ctx }) => ctx.userId === 'viewer-user' ? { allowed: false, statusCode: 403, message: 'Permission denied' } : { allowed: true },
  });

  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, 'http://127.0.0.1');
    if (requestUrl.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (api(req, res, requestUrl)) return;

    if (requestUrl.pathname === '/modules/build10-workspaces.js' || requestUrl.pathname === '/modules/build10-workspaces.css') {
      const file = requestUrl.pathname.endsWith('.js') ? 'build10-workspaces.js' : 'build10-workspaces.css';
      res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8' });
      res.end(fs.readFileSync(path.join(ROOT, 'modules', file)));
      return;
    }

    if (requestUrl.pathname === '/' || requestUrl.pathname === '/harness') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/modules/build10-workspaces.css"><style>body{margin:0;padding:24px;background:#020617;font-family:Arial,sans-serif}.page{display:none}.page-active{display:block}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden}</style></head><body><nav><button class="nav-btn" data-page="${initialPage}"></button></nav><main id="mainContent"></main><script>window.__octagonBootstrap={actor:{activeCompanyId:${JSON.stringify(seed.companyId)}},warehouseId:'wh-main',actions:[{id:'db_write',enabled:true}]};localStorage.setItem('octagon_active_warehouse_id','wh-main');window.switchPage=function(){};</script><script src="/modules/build10-workspaces.js"></script><script>document.addEventListener('DOMContentLoaded',()=>window.switchPage(${JSON.stringify(initialPage)}));</script></body></html>`);
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
  await page.waitForFunction((pageId) => document.querySelector(`[data-build10-page="${pageId}"]`)?.classList.contains('page-active'), {}, initialPage);
  t.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); dialect.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { authority, browser, consoleErrors, dialect, page, seed };
}

export async function browserAction(page, actionId, input, { user = 'browser-manager', company = 'default' } = {}) {
  return page.evaluate(async ({ actionId, input, user, company }) => {
    const response = await fetch(`/api/v1/action/${actionId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user': user, 'x-company': company },
      body: JSON.stringify({ idempotency_key: `${actionId}-${Date.now()}-${Math.random().toString(36).slice(2)}`, ...input })
    });
    const payload = await response.json();
    if (!response.ok || payload.success === false) throw new Error(`${actionId}: ${response.status} ${JSON.stringify(payload.error)}`);
    return payload.data;
  }, { actionId, input, user, company });
}

export async function browserQuery(page, domain, resource, options = {}) {
  return page.evaluate(async ({ domain, resource, options }) => {
    const response = await fetch(`/api/v1/${domain}/${resource}`, {
      headers: { 'x-user': options.user || 'browser-manager', 'x-company': options.company || 'default' }
    });
    const payload = await response.json();
    return { status: response.status, ...payload };
  }, { domain, resource, options });
}
