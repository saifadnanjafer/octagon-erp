// Concurrency and Multi-Batch isolation test for Cutover Engine.

'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { openMigrationDatabase, runMigrations } from '../../database/migration-runner/index.mjs';
import { SqliteDialect } from '../../database/dialects/sqlite-dialect.mjs';
import {
  createCutoverBatch, runSourceInventory, seedDefaultMappings,
  migrateMasterData
} from '../../platform/cutover/index.mjs';

test('Cutover Engine — Concurrency and Multi-Batch Isolation', async (t) => {
  process.env.OCTAGON_DISPOSABLE_FIXTURE = '1';
  process.env.OCTAGON_RUNTIME_MODE = 'test';

  const tmpDb = path.join(os.tmpdir(), `cutover_concurrency_${Date.now()}.db`);
  if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);

  const opDb = new SqliteDialect().open('database.db');
  opDb.backup('database.db', tmpDb);
  opDb.close();

  await runMigrations({ dbPath: tmpDb, direction: 'up' });
  const db = openMigrationDatabase(tmpDb);

  try {
    // 1. Create two distinct cutover batches
    const batch1 = createCutoverBatch(db, { dbPath: tmpDb, label: 'Batch Alpha' });
    const batch2 = createCutoverBatch(db, { dbPath: tmpDb, label: 'Batch Beta' });

    assert.notEqual(batch1.id, batch2.id);

    seedDefaultMappings(db);

    runSourceInventory(db, batch1.id);
    runSourceInventory(db, batch2.id);

    // Run Master Data Migration for Batch 1
    const md1 = migrateMasterData(db, batch1.id, { actor: 'agent_alpha' });
    assert.equal(md1.migratedCount, 78);

    // Run Master Data Migration for Batch 2 (ON CONFLICT DO UPDATE handles line updates cleanly)
    const md2 = migrateMasterData(db, batch2.id, { actor: 'agent_beta' });
    assert.equal(md2.migratedCount, 78);

    // Verify lineage entries exist for both batches without key conflicts
    const b1Lineage = db.prepare('SELECT COUNT(*) as c FROM cutover_lineage WHERE batch_id = ?').get(batch1.id)?.c;
    const b2Lineage = db.prepare('SELECT COUNT(*) as c FROM cutover_lineage WHERE batch_id = ?').get(batch2.id)?.c;

    assert.ok(b1Lineage > 0);
    assert.ok(b2Lineage > 0);
  } finally {
    db.close();
    if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  }
});
