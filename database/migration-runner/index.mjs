// Octagon canonical migration runner.
//
// Source composition:
// - VNext migration-runner.mjs (project-owned) used as the implementation base
//   for dependency ordering, checksums, backup/fingerprint, and transaction
//   per migration.
// - Hardened with: dialect abstraction, module ownership, actor/system identity,
//   provenance, rollback policy, and execution locking.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDialect, inferDialect } from '../dialects/index.mjs';
import { applyPreDownCompatibility } from './rollback-compatibility.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultMigrationsDir = path.resolve(here, '../migrations');

const MIGRATION_FILE_RE = /^\d+_.+\.mjs$/;

export class MigrationRunnerError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'MigrationRunnerError';
    this.code = code;
    this.details = details;
  }
}

export function openMigrationDatabase(dbPath, dialectName = null) {
  const dialect = createDialect(dialectName || inferDialect(dbPath));
  dialect.open(dbPath);

  dialect.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    migration_id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL,
    checksum TEXT NOT NULL,
    actor TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    source_provenance TEXT
  ) STRICT;`);

  return dialect;
}

export function schemaFingerprint(dialect) {
  const schema = dialect
    .prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name")
    .all();
  return crypto.createHash('sha256').update(JSON.stringify(schema)).digest('hex');
}

async function loadMigrations(migrationsDir) {
  const files = fs.readdirSync(migrationsDir).filter((name) => MIGRATION_FILE_RE.test(name)).sort();
  const results = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(migrationsDir, file)).href);
    const migration = mod.migration;
    if (!migration?.id || typeof migration.up !== 'function' || typeof migration.down !== 'function') {
      throw new MigrationRunnerError(`Invalid migration ${file}: migration must export { id, up(db), down(db) }`, 'INVALID_MIGRATION', { file });
    }
    const dependsOn = Array.isArray(migration.dependsOn) ? migration.dependsOn.map(String) : [];
    const owner = migration.owner || 'platform.kernel';
    const dialect = Array.isArray(migration.dialect) ? migration.dialect : ['sqlite'];
    const transactionPolicy = migration.transactionPolicy || 'required';
    const rollbackPolicy = migration.rollbackPolicy || 'reversible';
    const sourceProvenance = migration.sourceProvenance || null;
    const fileHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationsDir, file))).digest('hex');
    results.push({ ...migration, dependsOn, owner, dialect, transactionPolicy, rollbackPolicy, sourceProvenance, file, fileHash });
  }
  return results;
}

export function resolveMigrationOrder(migrations) {
  const byId = new Map(migrations.map((m) => [m.id, m]));
  for (const m of migrations) {
    for (const dep of m.dependsOn || []) {
      if (!byId.has(dep)) {
        throw new MigrationRunnerError(
          `Migration "${m.id}" declares dependsOn unknown migration "${dep}"`,
          'MISSING_DEPENDENCY',
          { migrationId: m.id, missingDependency: dep }
        );
      }
    }
  }

  const placed = new Set();
  const order = [];
  const remaining = migrations.slice();
  while (remaining.length) {
    let progressed = false;
    for (let i = 0; i < remaining.length; i++) {
      const m = remaining[i];
      if ((m.dependsOn || []).every((dep) => placed.has(dep))) {
        order.push(m);
        placed.add(m.id);
        remaining.splice(i, 1);
        progressed = true;
        break;
      }
    }
    if (!progressed) {
      const ids = remaining.map((m) => m.id);
      throw new MigrationRunnerError(
        `Migration dependency cycle detected among: ${ids.join(', ')}`,
        'DEPENDENCY_CYCLE',
        { cycleIds: ids }
      );
    }
  }
  return order;
}

function assertDialectSupport(migration, dialectName) {
  if (!migration.dialect.includes(dialectName)) {
    throw new MigrationRunnerError(
      `Migration "${migration.id}" does not support dialect "${dialectName}"`,
      'DIALECT_NOT_SUPPORTED',
      { migrationId: migration.id, dialect: dialectName, supported: migration.dialect }
    );
  }
}

export async function migrationStatus({ dbPath, migrationsDir = defaultMigrationsDir, dialectName = null }) {
  const dialect = openMigrationDatabase(dbPath, dialectName);
  try {
    const migrations = resolveMigrationOrder(await loadMigrations(migrationsDir));
    const applied = new Set(dialect.prepare('SELECT migration_id FROM schema_migrations').all().map((row) => row.migration_id));
    return migrations.map((migration) => ({
      id: migration.id,
      status: applied.has(migration.id) ? 'applied' : 'pending',
      owner: migration.owner,
      dialect: migration.dialect,
      rollbackPolicy: migration.rollbackPolicy,
      sourceProvenance: migration.sourceProvenance,
    }));
  } finally {
    dialect.close();
  }
}

export function backupBeforeMigration(dialect, dbPath, backupDir) {
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const nonce = crypto.randomBytes(6).toString('hex');
  const backupPath = path.join(backupDir, `pre-migration-${stamp}-${process.pid}-${nonce}.db`);
  dialect.backup(dbPath, backupPath);
  return backupPath;
}

/**
 * Filenames that identify the operational Octagon datastore. Rollback is
 * destructive and is refused against these outright.
 *
 * The guard is deliberately narrow: it blocks the `down` direction only. Forward
 * migration of the operational database remains possible, because that is a
 * legitimate owner-authorised action. Undoing migrations on live data is not.
 */
const OPERATIONAL_DB_BASENAMES = new Set(['database.db', 'database.json']);

export function isOperationalDatabasePath(dbPath) {
  return OPERATIONAL_DB_BASENAMES.has(path.basename(path.resolve(dbPath)));
}

function assertRollbackAllowed(dbPath) {
  if (isOperationalDatabasePath(dbPath)) {
    throw new MigrationRunnerError(
      `Refusing to roll back the operational database at "${dbPath}". ` +
        'Rollback is destructive and is only permitted against a disposable clone.',
      'OPERATIONAL_ROLLBACK_REFUSED',
      { dbPath }
    );
  }
}

/**
 * Decide which applied migrations a `down` run should unwind.
 *
 * Selection modes, most specific first:
 *   target  — unwind everything applied strictly AFTER `target`; tip becomes `target`
 *   steps   — unwind the N most recently ordered applied migrations
 *   neither — full-chain rollback (refused on populated data unless allowFullChain)
 *
 * `appliedInOrder` must be in forward dependency order; the caller reverses.
 */
export function resolveRollbackSelection({ appliedInOrder, target = null, steps = null, allowFullChain = false, isPopulated = false }) {
  if (target !== null && steps !== null) {
    throw new MigrationRunnerError('Specify either target or steps for rollback, not both', 'AMBIGUOUS_ROLLBACK_SELECTION', { target, steps });
  }

  if (target !== null) {
    const index = appliedInOrder.findIndex((migration) => migration.id === target);
    if (index === -1) {
      throw new MigrationRunnerError(
        `Rollback target "${target}" is not an applied migration`,
        'UNKNOWN_ROLLBACK_TARGET',
        { target, appliedTip: appliedInOrder.at(-1)?.id ?? null }
      );
    }
    return { selection: appliedInOrder.slice(index + 1), mode: 'target', resultingTip: target };
  }

  if (steps !== null) {
    const count = Number(steps);
    if (!Number.isInteger(count) || count < 1) {
      throw new MigrationRunnerError('Rollback steps must be a positive integer', 'INVALID_ROLLBACK_STEPS', { steps });
    }
    if (count > appliedInOrder.length) {
      throw new MigrationRunnerError(
        `Cannot roll back ${count} migrations; only ${appliedInOrder.length} are applied`,
        'ROLLBACK_STEPS_EXCEED_APPLIED',
        { steps: count, applied: appliedInOrder.length }
      );
    }
    const selection = appliedInOrder.slice(appliedInOrder.length - count);
    return { selection, mode: 'steps', resultingTip: appliedInOrder[appliedInOrder.length - count - 1]?.id ?? null };
  }

  // No target and no steps: this would unwind the entire chain.
  if (isPopulated && !allowFullChain) {
    throw new MigrationRunnerError(
      'Refusing full-chain rollback on a populated database. ' +
        'Pass an explicit target or steps, or set allowFullChain to confirm total teardown.',
      'FULL_CHAIN_ROLLBACK_REFUSED',
      { applied: appliedInOrder.length }
    );
  }
  return { selection: [...appliedInOrder], mode: 'full-chain', resultingTip: null };
}

/**
 * A database is "populated" when it carries business rows beyond the migration
 * bookkeeping table itself. Used to decide whether an unqualified full-chain
 * rollback is safe to perform without explicit confirmation.
 */
export function databaseIsPopulated(dialect) {
  const tables = dialect
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'")
    .all()
    .map((row) => row.name);
  for (const table of tables) {
    try {
      if (dialect.prepare(`SELECT 1 FROM "${table}" LIMIT 1`).get()) return true;
    } catch {
      // Unreadable table cannot prove emptiness; skip rather than assume.
    }
  }
  return false;
}

function acquireLockFile(lockPath) {
  try {
    fs.mkdirSync(lockPath, { recursive: false });
    return true;
  } catch (e) {
    if (e.code === 'EEXIST') return false;
    throw e;
  }
}

function releaseLockFile(lockPath) {
  try {
    fs.rmdirSync(lockPath);
  } catch (e) {
    // best-effort release
  }
}

export async function runMigrations({
  dbPath,
  direction = 'up',
  dryRun = false,
  migrationsDir = defaultMigrationsDir,
  backupDir,
  dialectName = null,
  actor = 'system',
  target = null,
  steps = null,
  allowFullChain = false,
}) {
  if (direction === 'down') assertRollbackAllowed(dbPath);
  const effectiveDialectName = dialectName || inferDialect(dbPath);
  const lockDir = path.resolve(path.dirname(dbPath), `.migration-lock-${Buffer.from(dbPath).toString('base64url')}`);
  if (!acquireLockFile(lockDir)) {
    throw new MigrationRunnerError('Another migration run is already in progress', 'CONCURRENT_RUN', { dbPath });
  }
  try {
    const dialect = openMigrationDatabase(dbPath, effectiveDialectName);
    try {
      const migrations = resolveMigrationOrder(await loadMigrations(migrationsDir));
      const appliedRows = dialect.prepare('SELECT migration_id FROM schema_migrations ORDER BY migration_id').all();
      const applied = new Set(appliedRows.map((row) => row.migration_id));
      let selected;
      let rollbackPlan = null;
      if (direction === 'up') {
        selected = migrations.filter((migration) => !applied.has(migration.id));
      } else {
        const appliedInOrder = migrations.filter((migration) => applied.has(migration.id));
        rollbackPlan = resolveRollbackSelection({
          appliedInOrder,
          target,
          steps,
          allowFullChain,
          isPopulated: databaseIsPopulated(dialect),
        });
        // Unwind newest-first so dependants are removed before their dependencies.
        selected = [...rollbackPlan.selection].reverse();
      }

      if (dryRun) {
        return {
          direction,
          dryRun,
          dialect: effectiveDialectName,
          migrations: selected.map((migration) => migration.id),
          backupPath: null,
          rollback: rollbackPlan ? { mode: rollbackPlan.mode, resultingTip: rollbackPlan.resultingTip } : null,
          status: migrations.map((migration) => ({ id: migration.id, status: applied.has(migration.id) ? 'applied' : 'pending' })),
        };
      }

      for (const migration of selected) {
        assertDialectSupport(migration, effectiveDialectName);
      }

      const effectiveBackupDir = backupDir || path.resolve(path.dirname(dbPath), '../migration-backups');
      const backupPath = selected.length ? backupBeforeMigration(dialect, dbPath, effectiveBackupDir) : null;
      const executed = [];
      const compatibilityApplied = [];

      // A rollback run is atomic as a whole: every step commits together or none
      // does. Without this an interrupted teardown leaves the database at neither
      // the original tip nor a clean lower tip.
      //
      // `defer_foreign_keys` postpones FK enforcement to the outermost COMMIT, so
      // tables may be dropped in any order within the run. This is the
      // dependency-safe strategy for teardown: by commit time both the parent and
      // its dependants are gone, including self-referencing parents.
      const outerTransaction = direction === 'down' && selected.length > 0;
      if (outerTransaction) {
        dialect.exec('BEGIN IMMEDIATE;');
        dialect.exec('PRAGMA defer_foreign_keys = ON;');
      }

      try {
      for (const migration of selected) {
        const start = Date.now();
        // Inside an outer transaction the individual migration must not open its
        // own; SQLite has no nested transactions and atomicity is already
        // guaranteed by the enclosing one.
        const runInsideTransaction = migration.transactionPolicy === 'required' && !outerTransaction;
        if (runInsideTransaction) dialect.exec('BEGIN IMMEDIATE;');
        try {
          const ctx = { actor, dialect: effectiveDialectName };
          if (direction === 'up') {
            migration.up(dialect, ctx);
            dialect.prepare('INSERT INTO schema_migrations (migration_id, applied_at, checksum, actor, duration_ms, source_provenance) VALUES (?, ?, ?, ?, ?, ?)').run(
              migration.id,
              new Date().toISOString(),
              migration.fileHash,
              actor,
              Date.now() - start,
              migration.sourceProvenance
            );
          } else {
            // Historical migrations are immutable. Where a recorded down() is
            // unsafe against populated data, the dependency resolution lives in
            // the runner-owned compatibility layer, not in the migration file.
            const compat = applyPreDownCompatibility(dialect, migration.id, effectiveDialectName);
            if (compat) compatibilityApplied.push(compat);
            if (!compat?.skipMigrationDown) migration.down(dialect, ctx);
            dialect.prepare('DELETE FROM schema_migrations WHERE migration_id = ?').run(migration.id);
          }
          if (runInsideTransaction) dialect.exec('COMMIT;');
          executed.push({ id: migration.id, durationMs: Date.now() - start });
        } catch (error) {
          if (runInsideTransaction) {
            try { dialect.exec('ROLLBACK;'); } catch (_) {}
          }
          throw new MigrationRunnerError(
            `Migration "${migration.id}" failed during ${direction}: ${error.message}`,
            'MIGRATION_FAILED',
            { migrationId: migration.id, direction, cause: error }
          );
        }
      }
      if (outerTransaction) dialect.exec('COMMIT;');
      } catch (error) {
        // Fail closed: discard every step of a failed rollback so the caller is
        // left with the database exactly as it was before the attempt.
        if (outerTransaction) {
          try { dialect.exec('ROLLBACK;'); } catch (_) {}
        }
        throw error;
      }

      const status = migrations.map((migration) => ({
        id: migration.id,
        status: dialect.prepare('SELECT 1 FROM schema_migrations WHERE migration_id = ?').get(migration.id) ? 'applied' : 'pending',
      }));
      return {
        direction,
        dryRun,
        dialect: effectiveDialectName,
        migrations: selected.map((m) => m.id),
        backupPath,
        executed,
        rollback: rollbackPlan ? { mode: rollbackPlan.mode, resultingTip: rollbackPlan.resultingTip } : null,
        compatibilityApplied,
        status,
      };
    } finally {
      dialect.close();
    }
  } finally {
    releaseLockFile(lockDir);
  }
}

export async function freshInstall({ dbPath, migrationsDir = defaultMigrationsDir, backupDir, dialectName = null, actor = 'system' }) {
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
  return runMigrations({ dbPath, direction: 'up', dryRun: false, migrationsDir, backupDir, dialectName, actor });
}

export { createDialect, inferDialect };
