import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import * as clients from '../../platform/offline/client-registry.mjs';
import * as sync from '../../platform/offline/sync-engine.mjs';
import * as conflicts from '../../platform/offline/conflict-resolution.mjs';

async function fixture(t) {
  const file = path.join(os.tmpdir(), `octagon-b10-offline-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  t.after(() => { try { fs.unlinkSync(file); } catch {} });
  await freshInstall({ dbPath: file });
  const db = openMigrationDatabase(file);
  t.after(() => db.close());
  const ctx = { company_id: 'company-a', branch_id: 'branch-a', actor: 'field-user-1', user_id: 'field-user-1' };
  return { db, ctx };
}

test('offline client registration, trust state and revocation', async (t) => {
  const { db, ctx } = await fixture(t);

  const reg = clients.registerOfflineClient(db, { client_uuid: 'uuid-pwa-001', device_name: 'Warehouse Tablet' }, ctx);
  assert.equal(reg.deviceTrustState, 'trusted');

  const revoked = clients.revokeOfflineClient(db, { client_id: reg.id }, ctx);
  assert.equal(revoked.deviceTrustState, 'revoked');

  assert.throws(() => clients.getClientScope(db, reg.id, 'company-a'), (err) => err.code === 'CLIENT_UNTRUSTED');
});

test('disallowed offline actions fail closed during queuing', async (t) => {
  const { db, ctx } = await fixture(t);
  const reg = clients.registerOfflineClient(db, { client_uuid: 'uuid-pwa-002' }, ctx);

  assert.throws(() => sync.queueOfflineCommand(db, { client_id: reg.id, action_name: 'finance:post_gl', payload: {} }, ctx),
    (err) => err.code === 'OFFLINE_ACTION_DISALLOWED');
});

test('batch sync push, ID remapping and conflict detection', async (t) => {
  const { db, ctx } = await fixture(t);
  const reg = clients.registerOfflineClient(db, { client_uuid: 'uuid-pwa-003' }, ctx);

  const batch = [
    { action_name: 'work_item:status_update', local_temp_id: 'tmp-item-1', payload: { item_id: 'item-1', status: 'in_progress' } },
    { action_name: 'warehouse:scan_capture', local_temp_id: 'tmp-scan-1', payload: { barcode: 'BC123' } },
    { action_name: 'work_item:status_update', local_temp_id: 'tmp-item-2', payload: { item_id: 'item-2', status: 'completed' }, simulate_conflict: true }
  ];

  const res = sync.pushOfflineSync(db, { client_id: reg.id, commands: batch }, ctx);
  assert.equal(res.pushedCount, 3);
  assert.equal(res.acceptedCount, 2);
  assert.equal(res.conflictCount, 1);
  assert.ok(res.idMap['tmp-item-1']);

  const cList = conflicts.listConflicts(db, { ...ctx, client_id: reg.id });
  assert.equal(cList.length, 1);
  assert.equal(cList[0].status, 'open');

  const resolved = conflicts.resolveConflict(db, { conflict_id: cList[0].id, resolution_strategy: 'manual_review' }, ctx);
  assert.equal(resolved.status, 'resolved');
});
