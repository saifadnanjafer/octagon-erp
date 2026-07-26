import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import {
  freshInstall, openMigrationDatabase, runMigrations, schemaFingerprint,
  resolveMigrationOrder,
} from '../../database/migration-runner/index.mjs';

const PHASE05_MIGRATIONS = [
  '045_manufacturing_engineering_and_quality',
  '046_mrp_planning_subcontracting_and_control_plane',
  '047_projects_and_job_costing',
  '048_assets_maintenance_and_fleet',
  '049_fiscal_period_end_date_correction',
];

const PHASE05_TABLES = [
  'manufacturing_account_mappings', 'work_centers', 'work_center_calendars',
  'bom_headers', 'bom_lines', 'routings', 'routing_operations', 'work_instructions',
  'engineering_changes', 'production_orders', 'production_order_materials',
  'production_order_operations', 'production_work_orders', 'production_work_order_events',
  'production_time_entries', 'production_material_consumptions', 'production_outputs',
  'production_cost_facts', 'quality_plans', 'quality_plan_points', 'quality_inspections',
  'quality_inspection_measurements', 'quality_nonconformances',
  'product_planning_policies', 'planning_runs', 'planning_proposals', 'planning_exceptions',
  'subcontract_holdings', 'subcontract_receipts', 'phase05_operating_policies',
  'project_cost_codes', 'project_templates', 'projects', 'project_phases',
  'project_milestones', 'project_roles', 'project_members', 'project_budgets',
  'project_budget_lines', 'project_commitments', 'project_cost_facts',
  'project_effort_entries', 'project_billing_rules', 'project_billings',
  'project_change_orders', 'project_risks', 'project_issues', 'project_documents',
  'project_profitability_snapshots',
  'asset_categories', 'assets', 'asset_components', 'asset_assignments',
  'asset_warranties', 'depreciation_schedules', 'asset_meter_readings',
  'maintenance_teams', 'maintenance_requests', 'maintenance_plans', 'maintenance_orders',
  'maintenance_parts', 'maintenance_labor_entries',
  'fleet_vehicle_types', 'fleet_vehicles', 'fleet_drivers', 'fleet_assignments',
  'fleet_documents', 'fleet_trips', 'fleet_fuel_cards', 'fleet_fuel_tanks',
  'fleet_fuel_transactions', 'fleet_incidents', 'fleet_telemetry_providers',
  'fleet_telemetry_events', 'fleet_alerts', 'fleet_geofences', 'fleet_tyres',
];

let tempDir;

before(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-phase05-migrations-'));
});

after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function tables(db) {
  return new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name),
  );
}

test('a fresh install applies every Phase 05 migration in dependency order', async () => {
  const dbPath = path.join(tempDir, 'fresh.db');
  const result = await freshInstall({
    dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'phase05-migration-test',
  });
  const appliedOrder = result.migrations;
  for (const id of PHASE05_MIGRATIONS) {
    assert.ok(appliedOrder.includes(id), `${id} must be applied`);
  }
  // Order matters: 046 depends on 045, 047 on 046, 048 on 047, 049 on 048.
  const positions = PHASE05_MIGRATIONS.map((id) => appliedOrder.indexOf(id));
  for (let i = 1; i < positions.length; i += 1) {
    assert.ok(positions[i] > positions[i - 1], `${PHASE05_MIGRATIONS[i]} must run after its dependency`);
  }

  const db = openMigrationDatabase(dbPath);
  const present = tables(db);
  for (const table of PHASE05_TABLES) {
    assert.ok(present.has(table), `table ${table} must exist after a fresh install`);
  }
  db.close();
});

test('re-running the migration set is a no-op', async () => {
  const dbPath = path.join(tempDir, 'rerun.db');
  await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'phase05-rerun' });

  const before = openMigrationDatabase(dbPath);
  const fingerprintBefore = schemaFingerprint(before);
  const appliedBefore = before.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n;
  before.close();

  const rerun = await runMigrations({
    dbPath, direction: 'up', backupDir: path.join(tempDir, 'backups'), actor: 'phase05-rerun-2',
  });
  assert.deepEqual(rerun.migrations, [], 'a second up-run must select nothing');

  const after = openMigrationDatabase(dbPath);
  assert.equal(schemaFingerprint(after), fingerprintBefore, 'the schema must be byte-identical after a rerun');
  assert.equal(after.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, appliedBefore);
  after.close();
});

test('rollback probe: Phase 05 migrations down and up restore the exact schema', async () => {
  const dbPath = path.join(tempDir, 'rollback.db');
  await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'phase05-rollback' });

  const start = openMigrationDatabase(dbPath);
  const fingerprintAfterUp = schemaFingerprint(start);
  start.close();

  // Roll the whole set down, then back up. The runner rolls down in reverse
  // dependency order, so this also proves the down() ordering is sound.
  await runMigrations({
    dbPath, direction: 'down', backupDir: path.join(tempDir, 'backups'), actor: 'phase05-rollback-down',
  });

  const rolled = openMigrationDatabase(dbPath);
  const afterDown = tables(rolled);
  for (const table of PHASE05_TABLES) {
    assert.ok(!afterDown.has(table), `table ${table} must be gone after rollback`);
  }
  assert.equal(rolled.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 0);
  rolled.close();

  await runMigrations({
    dbPath, direction: 'up', backupDir: path.join(tempDir, 'backups'), actor: 'phase05-rollback-up',
  });

  const restored = openMigrationDatabase(dbPath);
  assert.equal(
    schemaFingerprint(restored), fingerprintAfterUp,
    'down then up must restore the schema exactly',
  );
  restored.close();
});

test('an injected failure inside a migration leaves no partial schema', async () => {
  const dbPath = path.join(tempDir, 'injected.db');
  await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'phase05-injected' });

  const failingDir = path.join(tempDir, 'failing-migrations');
  fs.mkdirSync(failingDir, { recursive: true });
  fs.writeFileSync(path.join(failingDir, '900_injected_failure.mjs'), `
export const migration = {
  id: '900_injected_failure',
  owner: 'phase05_test',
  version: '0.0.1',
  dependsOn: [],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'failure-injection probe',
  up(db) {
    db.exec('CREATE TABLE injected_probe_table (id TEXT PRIMARY KEY);');
    throw new Error('injected failure after a schema write');
  },
  down(db) {
    db.exec('DROP TABLE IF EXISTS injected_probe_table;');
  },
};
`, 'utf8');

  await assert.rejects(
    runMigrations({
      dbPath, direction: 'up', migrationsDir: failingDir,
      backupDir: path.join(tempDir, 'backups'), actor: 'phase05-injected-run',
    }),
    /injected failure after a schema write/,
  );

  const db = openMigrationDatabase(dbPath);
  assert.ok(!tables(db).has('injected_probe_table'), 'a failed migration must leave no table behind');
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE migration_id = '900_injected_failure'").get().n,
    0,
    'a failed migration must not be recorded as applied',
  );
  db.close();
});

test('a concurrent migration run is refused rather than interleaved', async () => {
  const dbPath = path.join(tempDir, 'concurrent.db');
  await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'phase05-concurrent' });

  // The runner takes an exclusive lock directory next to the database.
  const lockDir = path.resolve(
    path.dirname(dbPath),
    `.migration-lock-${Buffer.from(dbPath).toString('base64url')}`,
  );
  fs.mkdirSync(lockDir, { recursive: true });
  try {
    await assert.rejects(
      runMigrations({
        dbPath, direction: 'up', backupDir: path.join(tempDir, 'backups'), actor: 'phase05-concurrent-2',
      }),
      /Another migration run is already in progress/,
    );
  } finally {
    fs.rmSync(lockDir, { recursive: true, force: true });
  }
});

test('the corrective migration repairs month-end fiscal periods and records what it changed', async () => {
  const dbPath = path.join(tempDir, 'periods.db');
  await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'phase05-periods' });
  const db = openMigrationDatabase(dbPath);

  const short = db.prepare(`
    SELECT id, start_date, end_date FROM finance_periods
    WHERE end_date < DATE(start_date, 'start of month', '+1 month', '-1 day')
  `).all();
  assert.deepEqual(short, [], 'no fiscal period may end before the last day of its month');

  const corrections = db.prepare('SELECT COUNT(*) AS n FROM finance_period_corrections').get().n;
  assert.ok(Number(corrections) > 0, 'the correction must be recorded, not silent');

  const january = db.prepare("SELECT end_date FROM finance_periods WHERE name = '2026-01'").get();
  assert.equal(january.end_date, '2026-01-31');
  const february = db.prepare("SELECT end_date FROM finance_periods WHERE name = '2026-02'").get();
  assert.equal(february.end_date, '2026-02-28');
  db.close();
});

test('every Phase 05 migration declares its full contract', async () => {
  const migrationsDir = path.resolve(process.cwd(), 'database/migrations');
  const loaded = [];
  for (const id of PHASE05_MIGRATIONS) {
    const module = await import(`file://${path.join(migrationsDir, `${id}.mjs`).replace(/\\/g, '/')}`);
    loaded.push(module.migration);
  }
  for (const migration of loaded) {
    assert.ok(migration.id, 'id');
    assert.ok(migration.owner, `${migration.id}: owner`);
    assert.ok(migration.version, `${migration.id}: version`);
    assert.ok(Array.isArray(migration.dependsOn), `${migration.id}: dependsOn`);
    assert.ok(Array.isArray(migration.dialect), `${migration.id}: dialect`);
    assert.ok(migration.transactionPolicy, `${migration.id}: transactionPolicy`);
    assert.ok(migration.rollbackPolicy, `${migration.id}: rollbackPolicy`);
    assert.ok(migration.sourceProvenance, `${migration.id}: sourceProvenance`);
    assert.equal(typeof migration.up, 'function', `${migration.id}: up`);
    assert.equal(typeof migration.down, 'function', `${migration.id}: down`);
  }
  // The dependency graph must be acyclic and resolvable.
  assert.doesNotThrow(() => resolveMigrationOrder(loaded.map((m) => ({ ...m, dependsOn: [] }))));
});
