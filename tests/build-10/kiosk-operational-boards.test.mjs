import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import * as kiosks from '../../platform/kiosk/kiosk-registry.mjs';
import * as boards from '../../platform/kiosk/operational-boards.mjs';

async function fixture(t) {
  const file = path.join(os.tmpdir(), `octagon-b10-kiosk-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  t.after(() => { try { fs.unlinkSync(file); } catch {} });
  await freshInstall({ dbPath: file });
  const db = openMigrationDatabase(file);
  t.after(() => db.close());
  const ctx = { company_id: 'company-a', branch_id: 'branch-a', actor: 'sys-admin' };
  return { db, ctx };
}

test('kiosk registration, restricted profiles, heartbeat and session logging', async (t) => {
  const { db, ctx } = await fixture(t);

  const ksk = kiosks.registerKiosk(db, { code: 'KSK-WH-01', name: 'Warehouse Receiving Terminal', kiosk_type: 'warehouse' }, ctx);
  assert.equal(ksk.code, 'KSK-WH-01');
  assert.equal(ksk.kioskType, 'warehouse');
  assert.equal(ksk.status, 'active');

  const hb = kiosks.recordKioskHeartbeat(db, { kiosk_id: ksk.id }, ctx);
  assert.ok(hb.lastHeartbeatAt);

  const sess = kiosks.startKioskSession(db, { kiosk_id: ksk.id, actor_id: 'wh-operator-1' }, ctx);
  assert.equal(sess.status, 'active');
  assert.equal(sess.kioskType, 'warehouse');

  const list = kiosks.listKiosks(db, { ...ctx, kiosk_type: 'warehouse' });
  assert.equal(list.length, 1);
});

test('operational boards configuration and read-only data query', async (t) => {
  const { db, ctx } = await fixture(t);

  const cfg = boards.upsertBoardConfig(db, { board_key: 'fleet_ops', title_ar: 'شاشة الأسطول المباشرة', title_en: 'Fleet Live Operations Board', auto_refresh_seconds: 10 }, ctx);
  assert.equal(cfg.boardKey, 'fleet_ops');
  assert.equal(cfg.autoRefreshSeconds, 10);
  assert.equal(cfg.isReadOnly, true);

  const data = boards.getBoardData(db, { company_id: 'company-a', board_key: 'fleet_ops' });
  assert.equal(data.boardKey, 'fleet_ops');
  assert.equal(data.titleEn, 'Fleet Live Operations Board');
  assert.equal(data.isReadOnly, true);
  assert.ok(Array.isArray(data.items));
});
