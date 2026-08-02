import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createWarehouse } from '../../platform/inventory/warehouses.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { handleBuild09Query } from '../../platform/api/build09.mjs';

async function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-b09-governance-'));
  const dbPath = path.join(dir, 'wms.db');
  await freshInstall({ dbPath, backupDir: path.join(dir, 'backups') });
  const db = openMigrationDatabase(dbPath);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const warehouse = createWarehouse(db, { company_id: 'company-a', name: 'Governed DC', code: 'GDC' });
  const authority = createPlatformAuthority(db);
  const ctx = { companyId: 'company-a', tenantId: 'default', branchId: 'branch-a', userId: 'wms-manager', actorId: 'wms-manager', actorType: 'user', correlationId: 'build09-governance' };
  return { db, warehouse, authority, ctx };
}

test('WMS actions use the platform transaction, idempotency, audit and outbox authority', async (t) => {
  const { db, warehouse, authority, ctx } = await setup(t);
  const input = { warehouse_id: warehouse.id, code: 'RCV', name: 'Receiving', zone_type: 'receiving', idempotency_key: 'zone-receiving-a' };
  const first = authority.actionExecutor.execute('wms:zone_create', input, ctx);
  const replay = authority.actionExecutor.execute('wms:zone_create', input, ctx);
  assert.deepEqual(replay, first);
  assert.equal(first.companyId, 'company-a');
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM wms_zones WHERE code='RCV'`).get().count, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM action_idempotency WHERE operation_type='wms:zone_create'`).get().count, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM platform_audit_log WHERE action='action.execute.wms:zone_create'`).get().count, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM platform_outbox WHERE event_type='action.execute'`).get().count, 1);
  assert.throws(() => authority.actionExecutor.execute('wms:zone_create', { ...input, company_id: 'company-b', idempotency_key: 'spoofed-company' }, ctx), (error) => error.code === 'UNTRUSTED_ACTION_SCOPE');
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM wms_zones WHERE company_id='company-b'`).get().count, 0);
});

test('WMS API queries are permission-wired and preserve company and warehouse scope', async (t) => {
  const { db, warehouse, authority, ctx } = await setup(t);
  authority.actionExecutor.execute('wms:zone_create', { warehouse_id: warehouse.id, code: 'STG', name: 'Staging', zone_type: 'staging', idempotency_key: 'zone-staging-a' }, ctx);
  const result = handleBuild09Query({ dialect: db, ctx, resource: 'zones', query: { warehouse_id: warehouse.id } });
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].companyId, 'company-a');
  const missingWarehouse = handleBuild09Query({ dialect: db, ctx, resource: 'zones', query: {} });
  assert.equal(missingWarehouse.status, 422);
  const wrongCompany = handleBuild09Query({ dialect: db, ctx: { ...ctx, companyId: 'company-b' }, resource: 'zones', query: { warehouse_id: warehouse.id } });
  assert.equal(wrongCompany.status, 403);
  const apiSource = fs.readFileSync(path.join(process.cwd(), 'platform', 'api', 'index.mjs'), 'utf8');
  assert.match(apiSource, /namespace === 'wms'[\s\S]{0,180}requirePermission\('wms:topology:view'\)/);
});
