import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { createApiHandler } from '../../platform/api/index.mjs';

function tmpDb() {
  return path.join(os.tmpdir(), `octagon-b05-browser-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

test('BUILD-05 Platform Services HTTP & Page Endpoints Integration', async () => {
  const dbPath = tmpDb();
  await freshInstall({ dbPath });
  const dialect = openMigrationDatabase(dbPath);
  const authority = createPlatformAuthority(dialect);

  const apiHandler = createApiHandler({
    dialect,
    prefix: '/api/v1',
    actionExecutor: authority.actionExecutor,
    resolveContext: (req) => ({
      tenantId: 'default',
      companyId: 'default',
      branchId: 'default',
      userId: 'b05-browser-test-user',
      actorType: 'user',
      correlationId: 'b05-browser-correlation',
      idempotencyKey: req.headers['x-idempotency-key'] ? String(req.headers['x-idempotency-key']) : null,
      sourceChannel: 'http-test',
    }),
    authorize: () => ({ allowed: true }),
  });

  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, 'http://127.0.0.1');
    
    // Serve HTML view routes
    const pageRoutes = {
      '/notifications': 'views/notifications.html',
      '/scheduled_reports': 'views/scheduled_reports.html',
      '/saved_views': 'views/saved_views.html',
      '/collaboration_lineage': 'views/collaboration_lineage.html',
    };

    if (pageRoutes[requestUrl.pathname]) {
      const htmlPath = path.resolve(pageRoutes[requestUrl.pathname]);
      if (fs.existsSync(htmlPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(htmlPath, 'utf8'));
        return;
      }
    }

    if (apiHandler(req, res, requestUrl)) return;

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'not found' }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Verify HTML Page Delivery for all 4 BUILD-05 pages
    for (const pagePath of ['/notifications', '/scheduled_reports', '/saved_views', '/collaboration_lineage']) {
      const res = await fetch(`${baseUrl}${pagePath}`);
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.ok(text.includes('<!DOCTYPE html>') || text.includes('<div') || text.includes('h1') || text.includes('header'));
    }

    // 2. Verify Governed HTTP API Executions for Platform Actions
    const partyRes = await fetch(`${baseUrl}/api/v1/action/party:create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-idempotency-key': `idem_b05_http_${Date.now()}_1`,
      },
      body: JSON.stringify({
        name: 'شريك منصة تواصل جديد',
        roles: ['customer'],
      }),
    });
    assert.equal(partyRes.status, 200);
    const partyBody = await partyRes.json();
    assert.equal(partyBody.success, true);
    assert.ok(partyBody.data.id);

  } finally {
    server.close();
    dialect.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  }
});
