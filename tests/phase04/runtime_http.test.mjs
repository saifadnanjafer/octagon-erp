import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { createApiHandler } from '../../platform/api/index.mjs';

test('raw Node HTTP exposes scoped Phase 04 queries and governed actions', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-phase04-http-'));
  const dbPath = path.join(tempDir, 'http.db');
  let db;
  let server;
  try {
    await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'phase04-http-test' });
    db = openMigrationDatabase(dbPath);
    const authority = createPlatformAuthority(db);
    const handler = createApiHandler({
      dialect: db,
      prefix: '/api/v1',
      actionExecutor: authority.actionExecutor,
      resolveContext: (req) => {
        if (req.headers['x-test-auth'] === 'none') return null;
        return {
          tenantId: 'default',
          companyId: 'default',
          branchId: 'default',
          userId: 'phase04-http-test',
          actorType: 'user',
          correlationId: String(req.headers['x-correlation-id'] || 'phase04-http-correlation'),
          idempotencyKey: req.headers['x-idempotency-key'] ? String(req.headers['x-idempotency-key']) : null,
          sourceChannel: 'http-test',
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

    const unauthenticated = await request('/api/v1/commercial/parties', {
      headers: { 'x-test-auth': 'none' },
    });
    assert.equal(unauthenticated.status, 401);

    const denied = await request('/api/v1/commercial/parties', {
      headers: { 'x-test-deny': 'platform:db:read' },
    });
    assert.equal(denied.status, 403);

    const spoof = await request('/api/v1/action/party:create', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-idempotency-key': 'http-party-spoof',
      },
      body: JSON.stringify({ name: 'Spoofed HTTP Party', company_id: 'other-company' }),
    });
    assert.equal(spoof.status, 403);
    assert.match(spoof.body.error, /UNTRUSTED_ACTION_SCOPE/);

    const created = await request('/api/v1/action/party:create', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-idempotency-key': 'http-party-create',
        'x-correlation-id': 'corr-http-party',
      },
      body: JSON.stringify({ name: 'HTTP Canonical Party', roles: ['customer'] }),
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.success, true);
    assert.equal(created.body.data.company_id, 'default');
    assert.equal(created.body.correlationId, 'corr-http-party');

    const parties = await request('/api/v1/commercial/parties?company_id=other-company');
    assert.equal(parties.status, 200);
    assert.equal(parties.body.data.length, 1);
    assert.equal(parties.body.data[0].company_id, 'default');

    for (const route of [
      '/api/v1/commercial/products',
      '/api/v1/commercial/uoms',
      '/api/v1/inventory/warehouses',
      '/api/v1/inventory/locations',
      '/api/v1/inventory/operations',
      '/api/v1/inventory/reservations',
      '/api/v1/inventory/lots',
      '/api/v1/inventory/serials',
      '/api/v1/inventory/packages',
      '/api/v1/sales/orders',
      '/api/v1/procurement/orders',
      '/api/v1/pos/orders',
      '/api/v1/work-items/items',
    ]) {
      const response = await request(route);
      assert.equal(response.status, 200, `${route} must be mounted`);
      assert.equal(response.body.success, true, `${route} must use the standard envelope`);
    }
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    try { db?.close(); } catch (_) {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
