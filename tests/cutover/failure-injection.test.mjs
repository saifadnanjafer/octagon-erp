// Failure injection and safety guard testing for Cutover Engine.

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
  validateFinanceEquivalence, migrateFinance, assessStagedActivationReadiness
} from '../../platform/cutover/index.mjs';
import { assessSafetyGuards } from '../../platform/cutover/canonical-cutover-controller.mjs';
import { createStagedTestClone, disposeStagedTestClone, operationalHash } from './_staged-clone.mjs';

test('Cutover Engine — Failure Injection & Operational Safety Guards', async (t) => {
  process.env.OCTAGON_DISPOSABLE_FIXTURE = '1';
  process.env.OCTAGON_RUNTIME_MODE = 'test';

  // Read-only WAL-consistent snapshot. Opening the operational database
  // read-write here used to toggle journal mode and rewrite its header.
  const operationalBefore = operationalHash();
  const tmpDb = await createStagedTestClone('cutover_failure');

  await runMigrations({ dbPath: tmpDb, direction: 'up' });
  const db = openMigrationDatabase(tmpDb);

  try {
    // 1. Test Operational Safety Guard: Refuse database.db directly
    const guardRes = assessSafetyGuards({ dbPath: 'database.db' });
    assert.equal(guardRes.allPassed, false);
    assert.ok(guardRes.guards.some(g => g.id === 'disposable_database_path' && !g.passed));

    // 2. Test Unbalanced Account Move Quarantine / Equivalence Rejection
    const batch = createCutoverBatch(db, { dbPath: tmpDb, label: 'Failure Test Batch' });
    seedDefaultMappings(db);

    // Corrupt an account move in the staged clone to make debit != credit
    const move = db.prepare('SELECT id, data FROM collections WHERE collection = \'account_moves\' LIMIT 1').get();
    if (move) {
      const data = JSON.parse(move.data);
      if (data.line_ids && data.line_ids.length > 0) {
        data.line_ids[0].debit += 50000; // Inject balance corruption
        db.prepare('UPDATE collections SET data = ? WHERE collection = \'account_moves\' AND id = ?')
          .run(JSON.stringify(data), move.id);
      }
    }

    // Equivalence validation should detect material mismatch and return blocked
    const finEq = validateFinanceEquivalence(db, batch.id);
    assert.equal(finEq.status, 'blocked');
    assert.ok(finEq.materialMismatches > 0);

    // Finance migration must refuse execution when equivalence validation fails
    assert.throws(() => {
      migrateFinance(db, batch.id);
    }, /Finance migration refused/);

    // Staged activation readiness must evaluate to isReady = false
    const readiness = assessStagedActivationReadiness(db, batch.id, { dbPath: tmpDb });
    assert.equal(readiness.isReady, false);
  } finally {
    db.close();
    disposeStagedTestClone(tmpDb);
    // The operational database must be byte-identical after this test.
    assert.equal(operationalHash(), operationalBefore,
      'cutover test mutated the operational database');
  }
});
