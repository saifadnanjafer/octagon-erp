// Focused tests for the Checkpoint I rollback remediation.
//
// Defect being covered (found during Checkpoint I4 against a realistic clone):
//   1. `down` unwound the entire chain with no way to name a target.
//   2. The teardown was not atomic — it dropped 214 tables, failed at 014, and
//      left the database at neither the original tip nor a clean lower tip.
//   3. 014_finance_canonical_schema_and_coa.down() dropped finance_accounts
//      while its self-referencing parent_id rows were still populated.
//
// Every test builds its own disposable database. None of them touch the
// operational store.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import {
  migrationStatus,
  runMigrations,
  freshInstall,
  resolveRollbackSelection,
  isOperationalDatabasePath,
  MigrationRunnerError,
} from '../../database/migration-runner/index.mjs';

function tmpDb(name) {
  return path.join(os.tmpdir(), `octagon-rollback-${name}-${Date.now()}-${Math.floor(process.hrtime()[1])}.db`);
}

function appliedIds(status) {
  return status.filter((s) => s.status === 'applied').map((s) => s.id);
}

function tip(status) {
  const ids = appliedIds(status);
  return ids[ids.length - 1] ?? null;
}

/** Build a throwaway migrations directory whose Nth down() throws on demand. */
function writeFixtureMigrations({ failingDownId = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-rbfixture-'));
  const specs = [
    { id: '001_alpha', table: 'rb_alpha' },
    { id: '002_beta', table: 'rb_beta' },
    { id: '003_gamma', table: 'rb_gamma' },
  ];
  let previous = null;
  for (const spec of specs) {
    const failing = spec.id === failingDownId;
    const body = `
export const migration = {
  id: '${spec.id}',
  owner: 'test.fixture',
  dependsOn: ${previous ? `['${previous}']` : '[]'},
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  up(dialect) {
    dialect.exec('CREATE TABLE IF NOT EXISTS ${spec.table} (id TEXT PRIMARY KEY, note TEXT);');
    dialect.prepare('INSERT OR IGNORE INTO ${spec.table} (id, note) VALUES (?, ?)').run('seed-1', 'populated');
  },
  down(dialect) {
    ${failing ? `throw new Error('deliberate fixture failure in ${spec.id}.down');` : ''}
    dialect.exec('DROP TABLE IF EXISTS ${spec.table};');
  }
};
`;
    fs.writeFileSync(path.join(dir, `${spec.id}.mjs`), body, 'utf8');
    previous = spec.id;
  }
  return { dir, specs };
}

function snapshotSchema(dbPath) {
  // Read the schema through a fresh connection so we compare committed state.
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
  const applied = db.prepare('SELECT migration_id FROM schema_migrations ORDER BY migration_id').all().map((r) => r.migration_id);
  db.close();
  return { tables, applied };
}

// ---------------------------------------------------------------------------

async function testRollbackToTarget() {
  const db = tmpDb('target');
  await freshInstall({ dbPath: db });
  const before = await migrationStatus({ dbPath: db });
  assert.ok(appliedIds(before).length > 20, 'expected a full chain to be applied');

  const result = await runMigrations({
    dbPath: db,
    direction: 'down',
    target: '013_governance_collection_cutover',
  });

  assert.strictEqual(result.rollback.mode, 'target');
  assert.strictEqual(result.rollback.resultingTip, '013_governance_collection_cutover');

  const after = await migrationStatus({ dbPath: db });
  assert.strictEqual(tip(after), '013_governance_collection_cutover', 'tip must be exactly the requested target');

  // Everything at or below the target survives; everything above is gone.
  assert.ok(appliedIds(after).includes('001_platform_kernel_bootstrap'));
  assert.ok(!appliedIds(after).includes('014_finance_canonical_schema_and_coa'));
  assert.ok(!appliedIds(after).includes('062_warehouse_code_uniqueness'));

  fs.unlinkSync(db);
  console.log('PASS: rollbackToTarget');
}

async function testMigration014ForeignKeyDependency() {
  const db = tmpDb('fk014');
  await freshInstall({ dbPath: db });

  // Confirm the hazard is genuinely present before proving it is handled:
  // a populated chart of accounts with self-referencing parent_id rows.
  const probe = new DatabaseSync(db, { readOnly: true });
  const total = probe.prepare('SELECT COUNT(*) n FROM finance_accounts').get().n;
  const selfRef = probe.prepare("SELECT COUNT(*) n FROM finance_accounts WHERE parent_id IS NOT NULL AND parent_id <> ''").get().n;
  probe.close();
  assert.ok(total > 0, 'fixture must have a populated chart of accounts');
  assert.ok(selfRef > 0, 'fixture must have self-referencing parent_id rows (the original failure condition)');

  // Rolling back to 013 forces 014.down() to run against that populated table.
  await runMigrations({ dbPath: db, direction: 'down', target: '013_governance_collection_cutover' });

  const after = snapshotSchema(db);
  assert.ok(!after.applied.includes('014_finance_canonical_schema_and_coa'), '014 must be unwound');
  assert.ok(!after.tables.includes('finance_accounts'), 'finance_accounts must be dropped');
  assert.ok(!after.tables.includes('finance_journals'), 'finance_journals must be dropped');

  fs.unlinkSync(db);
  console.log(`PASS: migration014ForeignKeyDependency (${total} accounts, ${selfRef} self-referencing)`);
}

async function testSuccessfulRollbackOnPopulatedClone() {
  const db = tmpDb('populated');
  const { dir } = writeFixtureMigrations();
  await runMigrations({ dbPath: db, direction: 'up', migrationsDir: dir });

  const before = snapshotSchema(db);
  assert.deepStrictEqual(before.applied, ['001_alpha', '002_beta', '003_gamma']);
  assert.ok(before.tables.includes('rb_alpha') && before.tables.includes('rb_gamma'));

  const result = await runMigrations({ dbPath: db, direction: 'down', migrationsDir: dir, steps: 2 });
  assert.strictEqual(result.rollback.mode, 'steps');
  assert.strictEqual(result.rollback.resultingTip, '001_alpha');

  const after = snapshotSchema(db);
  assert.deepStrictEqual(after.applied, ['001_alpha']);
  assert.ok(after.tables.includes('rb_alpha'), 'surviving migration keeps its table');
  assert.ok(!after.tables.includes('rb_beta'), 'rolled-back migration drops its table');
  assert.ok(!after.tables.includes('rb_gamma'), 'rolled-back migration drops its table');

  fs.unlinkSync(db);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('PASS: successfulRollbackOnPopulatedClone');
}

async function testFailedRollbackIsAtomic() {
  const db = tmpDb('atomic');
  // 002_beta.down() throws. Rolling back all three must leave NOTHING changed —
  // not even 003_gamma, which would otherwise have been unwound first.
  const { dir } = writeFixtureMigrations({ failingDownId: '002_beta' });
  await runMigrations({ dbPath: db, direction: 'up', migrationsDir: dir });

  const before = snapshotSchema(db);

  await assert.rejects(
    () => runMigrations({ dbPath: db, direction: 'down', migrationsDir: dir, allowFullChain: true }),
    (err) => err instanceof MigrationRunnerError && err.code === 'MIGRATION_FAILED',
    'a failing down() must surface as MIGRATION_FAILED'
  );

  const after = snapshotSchema(db);
  assert.deepStrictEqual(after.applied, before.applied, 'schema_migrations must be unchanged after a failed rollback');
  assert.deepStrictEqual(after.tables, before.tables, 'no table may be dropped by a failed rollback');
  assert.ok(after.tables.includes('rb_gamma'), 'the step that ran before the failure must be rolled back too');

  fs.unlinkSync(db);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('PASS: failedRollbackIsAtomic');
}

async function testFullChainRefusedOnPopulatedData() {
  const db = tmpDb('refuse');
  const { dir } = writeFixtureMigrations();
  await runMigrations({ dbPath: db, direction: 'up', migrationsDir: dir });

  await assert.rejects(
    () => runMigrations({ dbPath: db, direction: 'down', migrationsDir: dir }),
    (err) => err instanceof MigrationRunnerError && err.code === 'FULL_CHAIN_ROLLBACK_REFUSED',
    'unqualified full-chain rollback on populated data must be refused'
  );

  // The refusal must not have changed anything.
  const after = snapshotSchema(db);
  assert.deepStrictEqual(after.applied, ['001_alpha', '002_beta', '003_gamma']);

  // ...and the same call succeeds once the caller confirms explicitly.
  const forced = await runMigrations({ dbPath: db, direction: 'down', migrationsDir: dir, allowFullChain: true });
  assert.strictEqual(forced.rollback.mode, 'full-chain');
  assert.deepStrictEqual(snapshotSchema(db).applied, []);

  fs.unlinkSync(db);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('PASS: fullChainRefusedOnPopulatedData');
}

async function testIdempotentRerun() {
  const db = tmpDb('idempotent');
  const { dir } = writeFixtureMigrations();
  await runMigrations({ dbPath: db, direction: 'up', migrationsDir: dir });

  // Rolling back to the same target twice must be a no-op the second time.
  const first = await runMigrations({ dbPath: db, direction: 'down', migrationsDir: dir, target: '001_alpha' });
  assert.deepStrictEqual(first.migrations, ['003_gamma', '002_beta'], 'unwinds newest-first');

  const second = await runMigrations({ dbPath: db, direction: 'down', migrationsDir: dir, target: '001_alpha' });
  assert.deepStrictEqual(second.migrations, [], 'second rollback to the same target does nothing');
  assert.deepStrictEqual(snapshotSchema(db).applied, ['001_alpha']);

  // Forward re-run remains idempotent and restores the chain.
  const up = await runMigrations({ dbPath: db, direction: 'up', migrationsDir: dir });
  assert.deepStrictEqual(up.migrations, ['002_beta', '003_gamma']);
  const upAgain = await runMigrations({ dbPath: db, direction: 'up', migrationsDir: dir });
  assert.deepStrictEqual(upAgain.migrations, [], 'forward re-run must stay idempotent');

  fs.unlinkSync(db);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('PASS: idempotentRerun');
}

async function testOperationalDatabaseRollbackRefused() {
  // Path classification is by basename, so this asserts the guard without
  // creating, opening, reading or touching any operational file.
  assert.ok(isOperationalDatabasePath('C:/anywhere/database.db'));
  assert.ok(isOperationalDatabasePath('/var/octagon/database.json'));
  assert.ok(!isOperationalDatabasePath('/tmp/staged-disposable.db'));
  assert.ok(!isOperationalDatabasePath('/tmp/database-test-migrations.db'));

  // The refusal must fire before the file is opened: this path does not exist,
  // and the call must still reject with the guard's code rather than ENOENT.
  await assert.rejects(
    () => runMigrations({ dbPath: path.join(os.tmpdir(), 'nonexistent-dir-xyz', 'database.db'), direction: 'down' }),
    (err) => err instanceof MigrationRunnerError && err.code === 'OPERATIONAL_ROLLBACK_REFUSED',
    'rollback against an operational database path must be refused before opening it'
  );

  // Forward migration is deliberately NOT blocked by this guard.
  assert.doesNotThrow(() => {
    resolveRollbackSelection({ appliedInOrder: [{ id: 'a' }], target: 'a' });
  });

  console.log('PASS: operationalDatabaseRollbackRefused');
}

async function testRollbackSelectionEdgeCases() {
  const applied = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  assert.throws(
    () => resolveRollbackSelection({ appliedInOrder: applied, target: 'a', steps: 1 }),
    (err) => err.code === 'AMBIGUOUS_ROLLBACK_SELECTION'
  );
  assert.throws(
    () => resolveRollbackSelection({ appliedInOrder: applied, target: 'zzz' }),
    (err) => err.code === 'UNKNOWN_ROLLBACK_TARGET'
  );
  assert.throws(
    () => resolveRollbackSelection({ appliedInOrder: applied, steps: 0 }),
    (err) => err.code === 'INVALID_ROLLBACK_STEPS'
  );
  assert.throws(
    () => resolveRollbackSelection({ appliedInOrder: applied, steps: 99 }),
    (err) => err.code === 'ROLLBACK_STEPS_EXCEED_APPLIED'
  );

  // Target selection is exclusive of the target itself.
  const byTarget = resolveRollbackSelection({ appliedInOrder: applied, target: 'b' });
  assert.deepStrictEqual(byTarget.selection.map((m) => m.id), ['c']);
  assert.strictEqual(byTarget.resultingTip, 'b');

  // An empty database may be fully rolled back without confirmation.
  const empty = resolveRollbackSelection({ appliedInOrder: applied, isPopulated: false });
  assert.strictEqual(empty.mode, 'full-chain');

  console.log('PASS: rollbackSelectionEdgeCases');
}

async function main() {
  await testRollbackSelectionEdgeCases();
  await testOperationalDatabaseRollbackRefused();
  await testSuccessfulRollbackOnPopulatedClone();
  await testFailedRollbackIsAtomic();
  await testFullChainRefusedOnPopulatedData();
  await testIdempotentRerun();
  await testRollbackToTarget();
  await testMigration014ForeignKeyDependency();
  console.log('\nAll rollback remediation tests passed.');
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exitCode = 1;
});
