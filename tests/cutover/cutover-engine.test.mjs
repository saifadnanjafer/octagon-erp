// Full pipeline integration test for Cutover Engine.

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
  migrateFinance, migrateOperations, reconcileAll, assessStagedActivationReadiness
} from '../../platform/cutover/index.mjs';

test('Cutover Engine — Full Pipeline Execution on Staged Disposable Clone', async (t) => {
  process.env.OCTAGON_DISPOSABLE_FIXTURE = '1';
  process.env.OCTAGON_RUNTIME_MODE = 'test';

  const tmpDb = path.join(os.tmpdir(), `cutover_engine_${Date.now()}.db`);
  if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);

  const opDb = new SqliteDialect().open('database.db');
  opDb.backup('database.db', tmpDb);
  opDb.close();

  await runMigrations({ dbPath: tmpDb, direction: 'up' });
  const db = openMigrationDatabase(tmpDb);

  try {
    // 1. Create Batch
    const batch = createCutoverBatch(db, { dbPath: tmpDb, label: 'Cutover Test Batch' });
    assert.ok(batch.id.startsWith('cut_batch_'));
    assert.equal(batch.state, 'draft');

    // 2. Seed Mappings
    const mappings = seedDefaultMappings(db);
    assert.equal(mappings.length, 10);

    // 3. Source Inventory
    const inv = runSourceInventory(db, batch.id);
    assert.equal(inv.totalRows, 4067);
    assert.equal(inv.frozenCount, 961);
    assert.equal(inv.nonBusinessCount, 1233);
    assert.equal(inv.candidateCount, 1873);

    // 4. Master Data Migration
    const md = migrateMasterData(db, batch.id);
    assert.equal(md.domain, 'MASTER_DATA');
    assert.equal(md.migratedCount, 78);
    assert.equal(md.quarantinedCount, 2);

    // 5. Opening Inventory Migration
    const opInv = migrateOpeningInventory(db, batch.id);
    assert.equal(opInv.domain, 'INVENTORY');
    assert.equal(opInv.onHand, 401);
    assert.equal(opInv.reserved, 86);
    assert.equal(opInv.available, 315);
    assert.equal(opInv.aggregateValue, 1963000);
    assert.equal(opInv.accountingGateStatus, 'pending_owner_approval');

    // 6. Finance Equivalence Validation
    const finEq = validateFinanceEquivalence(db, batch.id);
    assert.equal(finEq.status, 'exact');
    assert.equal(finEq.exactMatches, 568);
    assert.equal(finEq.materialMismatches, 0);

    // 7. Finance Migration
    const fin = migrateFinance(db, batch.id);
    assert.equal(fin.domain, 'FINANCE');
    assert.equal(fin.migratedMovesCount, 568);

    // 8. Operations Migration
    const ops = migrateOperations(db, batch.id);
    assert.equal(ops.domain, 'OPERATIONS');
    assert.equal(ops.migratedBomsCount, 7);
    assert.equal(ops.migratedRoutingsCount, 7);
    assert.equal(ops.migratedQcPlansCount, 7);
    assert.equal(ops.migratedQcInspectionsCount, 3);
    assert.equal(ops.quarantinedCount, 3);

    // 9. Reconciliation
    const recon = reconcileAll(db, batch.id);
    assert.equal(recon.overallStatus, 'reconciled');

    // 10. Staged Activation Readiness
    const readiness = assessStagedActivationReadiness(db, batch.id, { dbPath: tmpDb });
    assert.equal(readiness.isReady, true);
    assert.equal(readiness.readinessManifest.masterDataState, 'reconciled');
    assert.equal(readiness.readinessManifest.inventoryState, 'reconciled');
    assert.equal(readiness.readinessManifest.financeState, 'reconciled');
    assert.equal(readiness.readinessManifest.operationsState, 'reconciled');
  } finally {
    db.close();
    if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  }
});
