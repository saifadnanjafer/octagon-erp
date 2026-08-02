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
  return path.join(os.tmpdir(), `octagon-b06-browser-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

test('BUILD-06 Commercial Operations HTTP & Page Endpoints Integration', async () => {
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
      userId: 'b06-browser-test-user',
      actorType: 'user',
      correlationId: 'b06-browser-correlation',
      idempotencyKey: req.headers['x-idempotency-key'] ? String(req.headers['x-idempotency-key']) : null,
      sourceChannel: 'http-test',
    }),
    authorize: () => ({ allowed: true }),
  });

  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, 'http://127.0.0.1');
    
    // Serve HTML view routes
    const pageRoutes = {
      '/rma_inspections': 'views/rma_inspections.html',
      '/credit_collections': 'views/credit_collections.html',
      '/sales_commissions': 'views/sales_commissions.html',
      '/document_templates': 'views/document_templates.html',
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
    // 1. Verify HTML Page Delivery for all 4 BUILD-06 commercial pages
    for (const pagePath of ['/rma_inspections', '/credit_collections', '/sales_commissions', '/document_templates']) {
      const res = await fetch(`${baseUrl}${pagePath}`);
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.ok(text.includes('<!DOCTYPE html>') || text.includes('<div') || text.includes('h1') || text.includes('header'));
    }

    // 2. Direct Service Integration Verifications over Authority
    const rmaInspection = authority.rmaService.getInspection('non_existent');
    assert.equal(rmaInspection, undefined);

    const docTemplate = authority.documentTemplateService.createTemplate({
      name: 'قالب إيصال الدفع البنكي',
      companyId: 'default',
      docType: 'pdf',
      bodyHtml: '<div>إيصال دفع بنكي بقيمة {{amount}} IQD</div>',
    });
    assert.ok(docTemplate.id);

    const rendered = authority.documentTemplateService.renderDocument(docTemplate.id, { amount: 500000 });
    assert.ok(rendered.content.includes('500000 IQD'));

  } finally {
    server.close();
    dialect.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  }
});
