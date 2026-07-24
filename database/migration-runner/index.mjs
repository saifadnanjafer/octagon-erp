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
}) {
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
      const selected = direction === 'up'
        ? migrations.filter((migration) => !applied.has(migration.id))
        : migrations.filter((migration) => applied.has(migration.id)).reverse();

      if (dryRun) {
        return {
          direction,
          dryRun,
          dialect: effectiveDialectName,
          migrations: selected.map((migration) => migration.id),
          backupPath: null,
          status: migrations.map((migration) => ({ id: migration.id, status: applied.has(migration.id) ? 'applied' : 'pending' })),
        };
      }

      for (const migration of selected) {
        assertDialectSupport(migration, effectiveDialectName);
      }

      const effectiveBackupDir = backupDir || path.resolve(path.dirname(dbPath), '../migration-backups');
      const backupPath = selected.length ? backupBeforeMigration(dialect, dbPath, effectiveBackupDir) : null;
      const executed = [];

      for (const migration of selected) {
        const start = Date.now();
        const runInsideTransaction = migration.transactionPolicy === 'required';
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
            migration.down(dialect, ctx);
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

      const status = migrations.map((migration) => ({
        id: migration.id,
        status: dialect.prepare('SELECT 1 FROM schema_migrations WHERE migration_id = ?').get(migration.id) ? 'applied' : 'pending',
      }));
      return { direction, dryRun, dialect: effectiveDialectName, migrations: selected.map((m) => m.id), backupPath, executed, status };
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
