import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createApiHandler } from '../../platform/api/index.mjs';
import { createPickTask } from '../../platform/wms/picking.mjs';
import { openPilot, seedPilotWorkshop } from './pilot-fixture.mjs';
import { PILOT_ACTORS } from './pilot-actors.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');

const ACTOR_PERMISSIONS = Object.freeze({
  supervisor: new Set(['*']),
  operator: new Set([
    'platform:db:read','platform:db:write','wms:topology:view','wms:locations:view','wms:picking:view',
    'wms:receiving:view','wms:cycle_count:view','wms:picking:assign','shopfloor:terminal:view','shopfloor:material:view',
  ]),
  finance: new Set(['platform:db:read']),
});

function actorFor(key) {
  if (key === 'supervisor') return PILOT_ACTORS.supervisor;
  if (key === 'finance') return PILOT_ACTORS.financeUser;
  return PILOT_ACTORS.warehouseOperator;
}

function harnessHtml(seed, pickTaskId) {
  const command = fs.readFileSync(path.join(ROOT, 'views', 'workshop_command_center.html'), 'utf8');
  const myWork = fs.readFileSync(path.join(ROOT, 'views', 'my_work.html'), 'utf8');
  const readiness = fs.readFileSync(path.join(ROOT, 'views', 'workshop_readiness.html'), 'utf8');
  return `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
    <link rel="stylesheet" href="/modules/workshop-operations.css"><style>
    body{margin:0;background:#071522;color:#eef6ff;font-family:Arial,sans-serif}.harness-shell{display:grid;grid-template-columns:230px 1fr;min-height:100vh}.harness-nav{padding:20px;background:#0b1c2b}.harness-nav button,.harness-nav select{width:100%;margin:0 0 8px;padding:10px}.harness-main{padding:24px}.page{display:none}.page.page-active{display:block}.canonical-target{display:none;padding:30px;border:1px solid #31516a;border-radius:16px}.canonical-target.page-active{display:block}@media(max-width:720px){.harness-shell{grid-template-columns:1fr}.harness-nav{display:flex;gap:6px;overflow:auto}.harness-nav button,.harness-nav select{min-width:160px}}
    </style></head><body><div class="harness-shell"><aside class="harness-nav">
      <label>Signed-in role<select id="roleSwitcher"><option value="supervisor">Supervisor</option><option value="operator">Warehouse Operator</option><option value="finance">Finance User</option></select></label>
      <button class="nav-btn" data-page="workshop_command_center">Command Center</button>
      <button class="nav-btn" data-page="my_work">My Work</button>
      <button class="nav-btn" data-page="workshop_readiness">Readiness</button>
    </aside><main class="harness-main">${command}${myWork}${readiness}<section class="canonical-target" id="canonicalTarget"><h1 id="canonicalTargetTitle"></h1><p>Canonical workspace deep link reached.</p></section></main></div>
    <script>
      window.__seed=${JSON.stringify({ companyId: seed.companyId, warehouseId: seed.warehouse.id, productId: seed.productId, pickTaskId })};
      window.__actors=${JSON.stringify({ supervisor: PILOT_ACTORS.supervisor.id, operator: PILOT_ACTORS.warehouseOperator.id, finance: PILOT_ACTORS.financeUser.id })};
      window.__role='supervisor';window.__currentPage='';
      window.OctagonRuntimeContext={companyId:window.__seed.companyId,activeCompanyId:window.__seed.companyId,branchId:'branch-pilot',warehouseId:window.__seed.warehouseId,userId:window.__actors.supervisor,actorId:window.__actors.supervisor,locale:'en',direction:'ltr',ready:Promise.resolve()};
      async function apiRequest(path,options={}){const response=await fetch(path,{...options,credentials:'same-origin',headers:{Accept:'application/json','Content-Type':'application/json','X-Pilot-Role':window.__role,...(options.headers||{})}});const body=await response.json();if(!response.ok||body.success===false){const error=new Error(body.error||('HTTP '+response.status));error.status=response.status;error.code=body.code;throw error;}return body.data===undefined?body:body.data;}
      window.OctagonApiClient={get:(path)=>apiRequest(path),post:(path,input)=>apiRequest(path,{method:'POST',body:JSON.stringify(input||{})})};
      window.switchPage=function(page){document.querySelectorAll('.page,.canonical-target').forEach(node=>node.classList.remove('page-active'));const ids={workshop_command_center:'pageWorkshopCommandCenter',my_work:'pageMyWork',workshop_readiness:'pageWorkshopReadiness'};const target=document.getElementById(ids[page]||'canonicalTarget');if(target)target.classList.add('page-active');if(!ids[page])document.getElementById('canonicalTargetTitle').textContent=page;window.__currentPage=page;if(page==='workshop_command_center'&&window.renderWorkshopCommandCenter)window.renderWorkshopCommandCenter();if(page==='my_work'&&window.renderMyWork)window.renderMyWork();if(page==='workshop_readiness'&&window.renderWorkshopReadiness)window.renderWorkshopReadiness();};
      window.switchRole=function(role){window.__role=role;const actor=window.__actors[role];window.OctagonRuntimeContext.userId=actor;window.OctagonRuntimeContext.actorId=actor;document.querySelectorAll('[data-page]').forEach(button=>{const page=button.dataset.page;button.hidden=(page==='workshop_readiness'&&role!=='supervisor')||(page==='workshop_command_center'&&role==='finance');});document.getElementById('roleSwitcher').value=role;};
      document.getElementById('roleSwitcher').addEventListener('change',event=>window.switchRole(event.target.value));document.querySelectorAll('[data-page]').forEach(button=>button.addEventListener('click',()=>window.switchPage(button.dataset.page)));
    </script>
    <script src="/modules/workshop-shell.js"></script><script src="/modules/workshop-command-center.js"></script><script src="/modules/workshop-my-work.js"></script><script src="/modules/workshop-readiness.js"></script>
    <script>window.switchRole('supervisor');window.switchPage('workshop_command_center');</script></body></html>`;
}

export async function openWorkshopBrowser(t, { name = 'browser', width = 1280, height = 900 } = {}) {
  const pilot = await openPilot(t, `browser-${name}`);
  const seed = seedPilotWorkshop(pilot);
  const stamp = new Date().toISOString();
  pilot.db.prepare(`INSERT INTO work_items(id,company_id,branch_id,title,source_type,status,stage,priority,assigned_user_id,due_date,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run('browser-supervisor-work', seed.companyId, 'branch-pilot', 'Approve today production plan', 'approval', 'review', 'waiting', 'high', PILOT_ACTORS.supervisor.id, stamp, stamp, stamp);
  pilot.db.prepare(`INSERT INTO work_items(id,company_id,branch_id,title,source_type,status,stage,priority,assigned_user_id,due_date,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run('browser-finance-work', seed.companyId, 'branch-pilot', 'Review customer invoice', 'finance_review', 'todo', 'backlog', 'medium', PILOT_ACTORS.financeUser.id, stamp, stamp, stamp);
  const pick = createPickTask(pilot.db, {
    company_id: seed.companyId, branch_id: 'branch-pilot', warehouse_id: seed.warehouse.id,
    actor: PILOT_ACTORS.supervisor.id, picking_type: 'internal_transfer', source_document_id: 'browser-pilot-transfer',
    source_line_id: 'browser-pilot-line', product_id: seed.productId, source_location_id: seed.component.locationId,
    staging_location_id: seed.wip.locationId, destination_location_id: seed.wip.locationId, quantity: 2,
    strategy: 'fifo', assigned_to: PILOT_ACTORS.warehouseOperator.id, idempotency_key: 'browser-pilot-pick',
  });

  const resolveContext = (req) => {
    const role = String(req.headers['x-pilot-role'] || 'operator'); const actor = actorFor(role);
    return { ...pilot.contexts[role === 'operator' ? 'warehouseOperator' : role === 'finance' ? 'financeUser' : 'supervisor'], correlationId: `workshop-browser-${name}-${Date.now()}`, pilotRole: role, actorId: actor.id, userId: actor.id };
  };
  const authorize = ({ permission, ctx }) => {
    const grants = ACTOR_PERMISSIONS[ctx.pilotRole] || new Set();
    const allowed = grants.has('*') || grants.has(permission);
    return allowed ? { allowed: true } : { allowed: false, statusCode: 403, message: `Permission denied: ${permission}` };
  };
  const api = createApiHandler({ dialect: pilot.db, prefix: '/api/v1', actionExecutor: pilot.executor, resolveContext, authorize });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (api(req, res, url)) return;
    if (url.pathname === '/harness' || url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(harnessHtml(seed, pick.id)); return; }
    if (url.pathname.startsWith('/modules/')) {
      const file = path.basename(url.pathname); const full = path.join(ROOT, 'modules', file);
      if (fs.existsSync(full)) { res.writeHead(200, { 'content-type': file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8' }); res.end(fs.readFileSync(full)); return; }
    }
    res.writeHead(404); res.end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.default.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  });
  const page = await browser.newPage(); await page.setViewport({ width, height, deviceScaleFactor: 1 });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  await page.goto(`${baseUrl}/harness`, { waitUntil: 'networkidle0' });
  return { ...pilot, seed, pick, server, browser, page, baseUrl };
}
