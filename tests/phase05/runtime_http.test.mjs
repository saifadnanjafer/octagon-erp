import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { createApiHandler } from '../../platform/api/index.mjs';
import { products, uom } from '../../platform/commercial/index.mjs';
import { setApprovalAuthorityLimit, createAccount } from '../../platform/finance/engine.mjs';

const CTX = {
  tenantId: 'default',
  companyId: 'default',
  branchId: null,
  userId: 'phase05-http-test',
  actorType: 'user',
  sourceChannel: 'http-test',
};

test('the Phase 05 API families are served by the real Node HTTP runtime', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-phase05-http-'));
  const dbPath = path.join(tempDir, 'http.db');
  let db;
  let server;
  try {
    await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'phase05-http-test' });
    db = openMigrationDatabase(dbPath);
    const authority = createPlatformAuthority(db);
    setApprovalAuthorityLimit(db, CTX, {
      role_or_user: CTX.userId, limit_type: 'post', max_amount: 1_000_000_000, currency: 'IQD',
    });

    const handler = createApiHandler({
      dialect: db,
      prefix: '/api/v1',
      actionExecutor: authority.actionExecutor,
      resolveContext: (req) => {
        if (req.headers['x-test-auth'] === 'none') return null;
        return {
          ...CTX,
          companyId: req.headers['x-test-company'] ? String(req.headers['x-test-company']) : CTX.companyId,
          correlationId: String(req.headers['x-correlation-id'] || 'phase05-http-correlation'),
          idempotencyKey: req.headers['x-idempotency-key'] ? String(req.headers['x-idempotency-key']) : null,
        };
      },
      authorize: ({ permission, req }) => (
        req.headers['x-test-deny'] === permission
          ? { allowed: false, statusCode: 403, message: 'test permission denied' }
          : { allowed: true }
      ),
    });

    server = http.createServer((req, res) => {
      const requestUrl = new URL(req.url, 'http://127.0.0.1');
      if (!handler(req, res, requestUrl)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'not found' }));
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const request = async (pathname, options = {}) => {
      const response = await fetch(`${base}${pathname}`, options);
      return { status: response.status, body: await response.json() };
    };
    const post = (actionId, payload, key, headers = {}) => request(`/api/v1/action/${actionId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-idempotency-key': key, ...headers },
      body: JSON.stringify(payload),
    });

    // --- authentication and authorization -------------------------------
    assert.equal((await request('/api/v1/manufacturing/orders', { headers: { 'x-test-auth': 'none' } })).status, 401);
    assert.equal((await request('/api/v1/projects', { headers: { 'x-test-deny': 'platform:db:read' } })).status, 403);
    assert.equal((await post('manufacturing:order:create', {}, 'deny-key', { 'x-test-deny': 'manufacturing:order:write' })).status, 403);

    // --- scope spoofing ---------------------------------------------------
    const spoof = await post('manufacturing:work_center:create', {
      code: 'SPOOF', name: 'Spoofed', company_id: 'other-company',
    }, 'spoof-key');
    assert.equal(spoof.status, 403);
    assert.match(spoof.body.error, /company scope must come from the verified session/);

    // --- set up master data over HTTP ------------------------------------
    const unitCategory = uom.createUomCategory(db, { name: 'HTTP units' });
    const unit = uom.createUom(db, { category_id: unitCategory.id, name: 'Piece', symbol: 'pc' });
    const wip = createAccount(db, CTX, { code: '104300', name: 'WIP', type: 'asset' });
    const labour = createAccount(db, CTX, { code: '502100', name: 'Labour absorption', type: 'expense' });
    const productCategory = products.createProductCategory(db, {
      company_id: 'default', name: 'HTTP parts', costing_method: 'avco',
      stock_account_id: db.prepare("SELECT id FROM finance_accounts WHERE company_id='default' AND code='104000'").get().id,
      stock_input_account_id: db.prepare("SELECT id FROM finance_accounts WHERE company_id='default' AND code='201000'").get().id,
      stock_output_account_id: db.prepare("SELECT id FROM finance_accounts WHERE company_id='default' AND code='501000'").get().id,
      expense_account_id: db.prepare("SELECT id FROM finance_accounts WHERE company_id='default' AND code='502000'").get().id,
    });

    const mapping = await post('manufacturing:account_mapping:set', {
      wip_account_id: wip.id, labor_absorption_account_id: labour.id,
    }, 'http-mapping');
    assert.equal(mapping.status, 200);
    assert.equal(mapping.body.success, true);

    const workCenter = await post('manufacturing:work_center:create', {
      code: 'WC-HTTP', name: 'HTTP bay', labor_cost_per_hour: 10,
    }, 'http-wc');
    assert.equal(workCenter.status, 200);
    assert.equal(workCenter.body.correlationId, 'phase05-http-correlation');

    const product = authority.actionExecutor.execute('product:template:create', {
      name: 'HTTP widget', category_id: productCategory.id, uom_id: unit.id,
      sku: 'HTTP-1', idempotency_key: 'http-product',
    }, CTX);

    // --- governed write over HTTP ----------------------------------------
    const project = await post('project:create', {
      name: 'HTTP project', contract_value: 1000,
    }, 'http-project');
    assert.equal(project.status, 200);
    assert.ok(project.body.data.id);

    // --- read families ----------------------------------------------------
    const families = [
      '/api/v1/manufacturing/orders',
      '/api/v1/manufacturing/plan',
      '/api/v1/manufacturing/shortages',
      '/api/v1/manufacturing/wip',
      '/api/v1/manufacturing/status-summary',
      '/api/v1/manufacturing/work-center-loading',
      '/api/v1/boms',
      '/api/v1/routings',
      '/api/v1/work-centers',
      '/api/v1/planning/worklist',
      '/api/v1/planning/runs',
      '/api/v1/quality/plans',
      '/api/v1/quality/inspections',
      '/api/v1/quality/pass-rate',
      '/api/v1/projects',
      '/api/v1/projects/portfolio',
      '/api/v1/assets',
      '/api/v1/assets/register',
      '/api/v1/assets/reconciliation',
      '/api/v1/maintenance/orders',
      '/api/v1/maintenance/due',
      '/api/v1/maintenance/reliability',
      '/api/v1/fleet/vehicles',
      '/api/v1/fleet/cost-per-km',
      '/api/v1/fleet/expiries',
      '/api/v1/phase05/status',
    ];
    for (const pathname of families) {
      const response = await request(pathname);
      assert.equal(response.status, 200, `${pathname} must be served`);
      assert.equal(response.body.success, true, `${pathname} must succeed`);
      assert.notEqual(response.body.data, undefined, `${pathname} must return data`);
    }

    // --- a single record and a nested report ------------------------------
    const projectDetail = await request(`/api/v1/projects/${project.body.data.id}`);
    assert.equal(projectDetail.status, 200);
    assert.equal(projectDetail.body.data.id, project.body.data.id);

    const profitability = await request(`/api/v1/projects/${project.body.data.id}/profitability`);
    assert.equal(profitability.status, 200);
    assert.equal(profitability.body.data.contract_value, 1000);

    const workCenters = await request('/api/v1/work-centers');
    assert.equal(workCenters.body.data.length, 1);
    assert.equal(workCenters.body.data[0].code, 'WC-HTTP');

    // --- company isolation over HTTP --------------------------------------
    const otherCompany = await request('/api/v1/work-centers', {
      headers: { 'x-test-company': 'company-b' },
    });
    assert.equal(otherCompany.status, 200);
    assert.deepEqual(otherCompany.body.data, [], 'another company must see none of this company\'s records');

    // --- unknown resources fail cleanly -----------------------------------
    const unknown = await request('/api/v1/manufacturing/not-a-report');
    assert.equal(unknown.status, 404);
    assert.match(unknown.body.error, /unknown manufacturing resource/);

    // --- business denials surface as 4xx with their code ------------------
    const badRelease = await post('manufacturing:order:release', {
      order_id: 'does-not-exist',
    }, 'http-bad-release');
    assert.ok(badRelease.status >= 400 && badRelease.status < 500, 'a business denial must not be a 500');
    assert.match(badRelease.body.error, /RECORD_NOT_FOUND/);

    // --- idempotency over the HTTP header ---------------------------------
    const firstProject = await post('project:create', { name: 'Idempotent project' }, 'http-idem');
    const replayProject = await post('project:create', { name: 'Idempotent project' }, 'http-idem');
    assert.equal(firstProject.body.data.id, replayProject.body.data.id, 'the header key must replay, not duplicate');
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM projects WHERE name = 'Idempotent project'").get().n,
      1,
    );
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    db?.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
