/**
 * Startup migration policy — the single authority deciding whether a process may
 * apply pending migrations automatically at boot.
 *
 * Why this exists
 * ---------------
 * On 2026-07-29 the Octagon server was started to verify an administrator
 * credential. Its boot path called `runMigrations({ direction: 'up' })`
 * unconditionally and silently migrated the OPERATIONAL database from tip 045 to
 * tip 062 — 17 migrations, ~85 new tables. No business data was lost and the
 * canonical cutover was not activated, but the schema of a live system changed
 * with no approval, no verified backup, and no staged rehearsal gate.
 *
 * The rule "do not apply migrations 046+ operationally" was unenforceable while
 * that code path existed: merely starting the application violated it. This
 * module makes the rule structural instead of aspirational.
 *
 * Design
 * ------
 * Classification is by database IDENTITY, not by environment variable alone. An
 * environment flag can be set by accident, by a stale shell, or by a test
 * harness; it must never be sufficient on its own to authorise migrating a
 * production store. Anything not provably disposable is treated as operational.
 *
 * Fail closed. `unknown` classification never auto-migrates.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Basenames that identify the live Octagon datastore. */
const OPERATIONAL_BASENAMES = new Set(['database.db', 'database.json']);

/** Marker table written into staged clones by the cutover snapshot tooling. */
const STAGED_FIXTURE_TABLE = 'cutover_staged_fixture';

export class StartupMigrationPolicyError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'StartupMigrationPolicyError';
    this.code = code;
    this.details = details;
  }
}

export const DATABASE_CLASS = Object.freeze({
  OPERATIONAL: 'operational',
  PRODUCTION: 'production',
  STAGED_CLONE: 'staged_clone',
  DISPOSABLE_FIXTURE: 'disposable_fixture',
  DEVELOPMENT: 'development',
  TEST: 'test',
  UNKNOWN: 'unknown',
});

function isTruthyFlag(value) {
  return value === '1' || value === 'true' || value === 'yes';
}

/** Does this database carry the staged-clone marker written by the snapshot tool? */
function hasStagedFixtureMarker(dbPath) {
  if (!fs.existsSync(dbPath)) return false;
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const table = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?")
        .get(STAGED_FIXTURE_TABLE);
      if (!table) return false;
      const row = db.prepare(`SELECT is_disposable FROM ${STAGED_FIXTURE_TABLE} WHERE id = 'staged'`).get();
      return Boolean(row && row.is_disposable === 1);
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

/**
 * Classify a database by identity.
 *
 * Precedence is deliberate: the operational basename check runs FIRST and is not
 * overridable by environment. A file called `database.db` sitting in a temp
 * directory is still treated as operational unless it carries a staged-fixture
 * marker proving otherwise — a copied production file in /tmp is exactly the
 * case that must not be auto-migrated.
 */
export function classifyDatabase(dbPath, env = process.env) {
  const resolved = path.resolve(dbPath);
  const base = path.basename(resolved);
  const nodeEnv = String(env.NODE_ENV || '').toLowerCase();
  const disposableFlag = isTruthyFlag(env.OCTAGON_DISPOSABLE_FIXTURE);

  if (OPERATIONAL_BASENAMES.has(base)) {
    // A staged clone may legitimately reuse the operational basename ONLY when it
    // proves disposability from its own contents.
    if (hasStagedFixtureMarker(resolved)) {
      return { class: DATABASE_CLASS.STAGED_CLONE, reason: 'operational basename with staged fixture marker', path: resolved };
    }
    return {
      class: nodeEnv === 'production' ? DATABASE_CLASS.PRODUCTION : DATABASE_CLASS.OPERATIONAL,
      reason: `operational basename "${base}"`,
      path: resolved,
    };
  }

  if (hasStagedFixtureMarker(resolved)) {
    return { class: DATABASE_CLASS.STAGED_CLONE, reason: 'staged fixture marker present', path: resolved };
  }

  if (nodeEnv === 'production') {
    return { class: DATABASE_CLASS.PRODUCTION, reason: 'NODE_ENV=production', path: resolved };
  }

  if (nodeEnv === 'test' || /(^|[-_.])test/i.test(base)) {
    return { class: DATABASE_CLASS.TEST, reason: 'test database identity', path: resolved };
  }

  if (disposableFlag && /disposable|fixture|scratch|tmp|temp/i.test(resolved)) {
    return { class: DATABASE_CLASS.DISPOSABLE_FIXTURE, reason: 'disposable flag with disposable path', path: resolved };
  }

  if (nodeEnv === 'development' || nodeEnv === 'dev') {
    return { class: DATABASE_CLASS.DEVELOPMENT, reason: 'NODE_ENV=development', path: resolved };
  }

  return { class: DATABASE_CLASS.UNKNOWN, reason: 'database identity could not be established', path: resolved };
}

/**
 * Decide whether startup may auto-apply pending migrations.
 *
 * Returns { autoMigrate, mode, classification, reason }.
 *   mode: 'apply'        — startup may migrate
 *         'status_only'  — startup may read status but must not write
 *         'refuse'       — startup must not proceed to writable business routes
 */
export function resolveStartupMigrationPolicy(dbPath, { env = process.env, pendingCount = 0 } = {}) {
  const classification = classifyDatabase(dbPath, env);

  switch (classification.class) {
    case DATABASE_CLASS.OPERATIONAL:
    case DATABASE_CLASS.PRODUCTION:
      // Never auto-apply. When nothing is pending, startup is a pure read and the
      // server runs normally.
      return pendingCount === 0
        ? { autoMigrate: false, mode: 'status_only', classification, reason: 'operational database already at repository tip' }
        : { autoMigrate: false, mode: 'refuse', classification, reason: 'operational database has pending migrations; explicit authorisation required' };

    case DATABASE_CLASS.STAGED_CLONE:
    case DATABASE_CLASS.DISPOSABLE_FIXTURE:
    case DATABASE_CLASS.TEST:
      return { autoMigrate: true, mode: 'apply', classification, reason: 'disposable database identity proven' };

    case DATABASE_CLASS.DEVELOPMENT:
      // Default to status-only. A dev database that is not provably disposable is
      // still somebody's real data.
      return isTruthyFlag(env.OCTAGON_DEV_AUTO_MIGRATE)
        ? { autoMigrate: true, mode: 'apply', classification, reason: 'development database with explicit opt-in' }
        : { autoMigrate: false, mode: 'status_only', classification, reason: 'development database defaults to status-only' };

    case DATABASE_CLASS.UNKNOWN:
    default:
      return { autoMigrate: false, mode: 'refuse', classification, reason: 'database identity unknown; failing closed' };
  }
}

/**
 * Enforcement entry point for the server bootstrap.
 *
 * Replaces a direct `runMigrations({ direction: 'up' })` call. Returns a
 * describable decision; throws when startup must not continue to writable
 * business routes.
 */
export async function enforceStartupMigrationPolicy(dbPath, { env = process.env, migrationStatus, runMigrations, actor = 'system' } = {}) {
  const status = await migrationStatus({ dbPath });
  const pending = status.filter((s) => s.status !== 'applied');
  const decision = resolveStartupMigrationPolicy(dbPath, { env, pendingCount: pending.length });

  const report = {
    databaseClass: decision.classification.class,
    classificationReason: decision.classification.reason,
    mode: decision.mode,
    reason: decision.reason,
    appliedTip: status.filter((s) => s.status === 'applied').at(-1)?.id ?? null,
    repositoryTip: status.at(-1)?.id ?? null,
    pendingCount: pending.length,
    pendingMigrations: pending.map((p) => p.id),
    migrationsApplied: [],
  };

  if (decision.mode === 'refuse') {
    throw new StartupMigrationPolicyError(
      pending.length
        ? `Refusing to start: ${pending.length} pending migration(s) on a ${decision.classification.class} database. ` +
            'Startup must not migrate operational data. Run the explicit, owner-authorised migration command after a ' +
            'verified backup and a staged rehearsal.'
        : `Refusing to start: ${decision.reason}.`,
      'OPERATIONAL_MIGRATION_AUTHORIZATION_REQUIRED',
      report
    );
  }

  if (decision.mode === 'apply' && pending.length) {
    const result = await runMigrations({ dbPath, direction: 'up', actor });
    report.migrationsApplied = result.migrations ?? [];
  }

  return report;
}
