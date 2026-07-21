import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert';
import { openMigrationDatabase, freshInstall } from '../../database/migration-runner/index.mjs';
import { mountApi } from '../../platform/api/index.mjs';

function tmpDb() {
  return path.join(os.tmpdir(), `octagon-api-test-${Date.now()}.db`);
}

async function setup() {
  const dbPath = tmpDb();
  await freshInstall({ dbPath });
  const dialect = openMigrationDatabase(dbPath);
  const api = mountApi({ dialect, prefix: '/api/v1' });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (!api.handle(req, res, url)) {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://localhost:${server.address().port}`;
  return { dialect, dbPath, server, baseUrl };
}

async function cleanup(dialect, dbPath, server) {
  server.close();
  dialect.close();
  fs.unlinkSync(dbPath);
}

function request(url, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers: { 'Content-Type': 'application/json', ...headers } }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch (e) { resolve({ status: res.statusCode, body: data }); } });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function testMetaEntities() {
  const { dialect, dbPath, server, baseUrl } = await setup();
  const res = await request(`${baseUrl}/api/v1/meta/entities`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.success);
  assert.ok(res.body.data.some((e) => e.id === 'product_category'));
  await cleanup(dialect, dbPath, server);
  console.log('PASS: metaEntities');
}

async function testGenericCrud() {
  const { dialect, dbPath, server, baseUrl } = await setup();
  const createRes = await request(`${baseUrl}/api/v1/x/product_category`, 'POST', { name: 'Cat A', code: 'A' }, { 'x-company': 'c1', 'x-user': 'u1' });
  assert.strictEqual(createRes.status, 201);
  const id = createRes.body.data.id;
  const listRes = await request(`${baseUrl}/api/v1/x/product_category?limit=10`, 'GET', null, { 'x-company': 'c1', 'x-user': 'u1' });
  assert.strictEqual(listRes.status, 200);
  assert.strictEqual(listRes.body.meta.total, 1);
  const readRes = await request(`${baseUrl}/api/v1/x/product_category/${id}`, 'GET', null, { 'x-company': 'c1', 'x-user': 'u1' });
  assert.strictEqual(readRes.body.data.name, 'Cat A');
  const patchRes = await request(`${baseUrl}/api/v1/x/product_category/${id}`, 'PATCH', { name: 'Cat B' }, { 'x-company': 'c1', 'x-user': 'u1' });
  assert.strictEqual(patchRes.body.data.name, 'Cat B');
  const delRes = await request(`${baseUrl}/api/v1/x/product_category/${id}`, 'DELETE', null, { 'x-company': 'c1', 'x-user': 'u1' });
  assert.strictEqual(delRes.body.data.removed, 1);
  await cleanup(dialect, dbPath, server);
  console.log('PASS: genericCrud');
}

async function testProtectedMutationDenied() {
  const { dialect, dbPath, server, baseUrl } = await setup();
  const res = await request(`${baseUrl}/api/v1/x/crm_lead`, 'POST', { name: 'Lead' }, { 'x-company': 'c1', 'x-user': 'u1' });
  assert.strictEqual(res.status, 403);
  assert.ok(!res.body.success);
  await cleanup(dialect, dbPath, server);
  console.log('PASS: protectedMutationDenied');
}

async function testActionEndpoint() {
  const { dialect, dbPath, server, baseUrl } = await setup();
  const res = await request(`${baseUrl}/api/v1/action/crm_lead:create`, 'POST', { data: { name: 'Via API' } }, { 'x-company': 'c1', 'x-user': 'u1', 'x-idempotency-key': 'api-1' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.status, 'draft');
  assert.ok(res.body.correlationId);
  await cleanup(dialect, dbPath, server);
  console.log('PASS: actionEndpoint');
}

async function testIdempotentCommand() {
  const { dialect, dbPath, server, baseUrl } = await setup();
  const r1 = await request(`${baseUrl}/api/v1/action/crm_lead:create`, 'POST', { data: { name: 'Idem' } }, { 'x-company': 'c1', 'x-user': 'u1', 'x-idempotency-key': 'idem-1' });
  const r2 = await request(`${baseUrl}/api/v1/action/crm_lead:create`, 'POST', { data: { name: 'Idem' } }, { 'x-company': 'c1', 'x-user': 'u1', 'x-idempotency-key': 'idem-1' });
  assert.deepStrictEqual(r1.body.data, r2.body.data);
  await cleanup(dialect, dbPath, server);
  console.log('PASS: idempotentCommand');
}

async function testUnknownRoute() {
  const { dialect, dbPath, server, baseUrl } = await setup();
  const res = await request(`${baseUrl}/api/v1/unknown/thing`);
  assert.strictEqual(res.status, 404);
  await cleanup(dialect, dbPath, server);
  console.log('PASS: unknownRoute');
}

async function main() {
  await testMetaEntities();
  await testGenericCrud();
  await testProtectedMutationDenied();
  await testActionEndpoint();
  await testIdempotentCommand();
  await testUnknownRoute();
  console.log('\nAll API tests passed.');
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exitCode = 1;
});
