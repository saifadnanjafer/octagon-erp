// Staged activation readiness assessment test for Cutover Engine.

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
  migrateFinance, migrateOperations, reconcileAll, assessStagedActivationReadiness,
  generateCutoverSummaryReport
} from '../../platform/cutover/index.mjs';

test('Cutover Engine — Staged Activation Readiness Evaluation', async (t) => {
  process.env.OCTAGON_DISPOSABLE_FIXTURE = '1';
  process.env.OCTAGON_RUNTIME_MODE = 'test';

  const tmpDb = path.join(os.tmpdir(), `cutover_readiness_${Date.now()}.db`);
  if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);

  const opDb = new SqliteDialect().open('database.db');
  opDb.backup('database.db', tmpDb);
  opDb.close();

  await runMigrations({ dbPath: tmpDb, direction: 'up' });
  const db = openMigrationDatabase(tmpDb);

  try {
    const batch = createCutoverBatch(db, { dbPath: tmpDb, label: 'Readiness Test Batch' });
    seedDefaultMappings(db);

    // Initial state: not ready
    let readiness = assessStagedActivationReadiness(db, batch.id, { dbPath: tmpDb });
    assert.equal(readiness.isReady, false);

    // Execute full cutover
    runSourceInventory(db, batch.id);
    migrateMasterData(db, batch.id);
    migrateOpeningInventory(db, batch.id);
    validateFinanceEquivalence(db, batch.id);
    migrateFinance(db, batch.id);
    migrateOperations(db, batch.id);
    reconcileAll(db, batch.id);

    // After full cutover: evaluates to ready
    readiness = assessStagedActivationReadiness(db, batch.id, { dbPath: tmpDb });
    assert.equal(readiness.isReady, true);
    assert.equal(readiness.readinessManifest.disposable, true);
    assert.equal(readiness.readinessManifest.sourceInventoryCount, 4067);

    // Generate summary report
    const summary = generateCutoverSummaryReport(db, batch.id, { dbPath: tmpDb });
    assert.ok(summary);
    assert.equal(summary.batch.id, batch.id);
    assert.equal(summary.reconciliation.overallStatus, 'reconciled');
    assert.equal(summary.readiness.isReady, true);
  } finally {
    db.close();
    if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  }
});
