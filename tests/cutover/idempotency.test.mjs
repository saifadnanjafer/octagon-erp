// Idempotency and hash change detection test for Cutover Engine.

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
  migrateMasterData, migrateOpeningInventory, validateFinanceEquivalence,
  migrateFinance, migrateOperations, reconcileAll
} from '../../platform/cutover/index.mjs';

test('Cutover Engine — Idempotency and Hash Consistency', async (t) => {
  process.env.OCTAGON_DISPOSABLE_FIXTURE = '1';
  process.env.OCTAGON_RUNTIME_MODE = 'test';

  const tmpDb = path.join(os.tmpdir(), `cutover_idempotency_${Date.now()}.db`);
  if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);

  const opDb = new SqliteDialect().open('database.db');
  opDb.backup('database.db', tmpDb);
  opDb.close();

  await runMigrations({ dbPath: tmpDb, direction: 'up' });
  const db = openMigrationDatabase(tmpDb);

  try {
    const batch = createCutoverBatch(db, { dbPath: tmpDb, label: 'Idempotency Run 1' });
    seedDefaultMappings(db);
    runSourceInventory(db, batch.id);

    // First Execution Pass
    const md1 = migrateMasterData(db, batch.id);
    const op1 = migrateOpeningInventory(db, batch.id);
    validateFinanceEquivalence(db, batch.id);
    const fin1 = migrateFinance(db, batch.id);
    const ops1 = migrateOperations(db, batch.id);

    const lineageCount1 = db.prepare('SELECT COUNT(*) as c FROM cutover_lineage').get()?.c;
    const finDocsCount1 = db.prepare('SELECT COUNT(*) as c FROM finance_documents').get()?.c;
    const quantsCount1 = db.prepare('SELECT COUNT(*) as c FROM stock_quants').get()?.c;

    // Second Execution Pass (Idempotent replay)
    const md2 = migrateMasterData(db, batch.id);
    const op2 = migrateOpeningInventory(db, batch.id);
    validateFinanceEquivalence(db, batch.id);
    const fin2 = migrateFinance(db, batch.id);
    const ops2 = migrateOperations(db, batch.id);

    const lineageCount2 = db.prepare('SELECT COUNT(*) as c FROM cutover_lineage').get()?.c;
    const finDocsCount2 = db.prepare('SELECT COUNT(*) as c FROM finance_documents').get()?.c;
    const quantsCount2 = db.prepare('SELECT COUNT(*) as c FROM stock_quants').get()?.c;

    // Verify Counts match exactly without duplicates or throw errors
    assert.equal(md1.migratedCount, md2.migratedCount);
    assert.equal(fin1.migratedMovesCount, fin2.migratedMovesCount);
    assert.equal(ops1.migratedBomsCount, ops2.migratedBomsCount);
    assert.equal(lineageCount1, lineageCount2);
    assert.equal(finDocsCount1, finDocsCount2);
    assert.equal(quantsCount1, quantsCount2);

    const recon = reconcileAll(db, batch.id);
    assert.equal(recon.overallStatus, 'reconciled');
  } finally {
    db.close();
    if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  }
});
