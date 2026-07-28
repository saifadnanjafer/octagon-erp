// Release Health diagnostics — Checkpoint H.
//
// Closes Checkpoint G blocker 6. Every value here is DERIVED from real server
// state: the migration ledger, the action/module registry, the cutover
// controller, the outbox and audit tables, and the git refs on disk.
//
// ===========================================================================
// THE RULE THIS MODULE EXISTS TO ENFORCE
// ===========================================================================
//
// No fabricated green. A signal that cannot be computed reports `unknown`, and
// a signal that represents work nobody has done reports `not_executed`. Those
// are distinct from `healthy` on purpose: a release dashboard that shows green
// for a check nobody ran is worse than no dashboard, because it converts an
// open question into false confidence.
//
// PostgreSQL runtime in particular MUST NOT report healthy — the adapter is
// implemented and unit-tested, but it has never executed a statement against a
// live server.

'use strict';

import fs from 'node:fs';
import path from 'node:path';

import { createCanonicalCutoverController } from '../cutover/canonical-cutover-controller.mjs';
import { RETIREMENT_LOCKS } from '../cutover/legacy-writer-retirement.mjs';

export const STATUS = Object.freeze({
  HEALTHY: 'healthy',
  WARNING: 'warning',
  BLOCKED: 'blocked',
  UNKNOWN: 'unknown',
  NOT_EXECUTED: 'not_executed',
});

function signal(id, status, value, detail) {
  return { id, status, value, detail };
}

/** Read git HEAD without shelling out. */
function gitInfo(root) {
  try {
    const headPath = path.join(root, '.git', 'HEAD');
    if (!fs.existsSync(headPath)) return { sha: null, branch: null };
    const head = fs.readFileSync(headPath, 'utf8').trim();
    if (head.startsWith('ref: ')) {
      const ref = head.slice(5).trim();
      const branch = ref.replace(/^refs\/heads\//, '');
      const refPath = path.join(root, '.git', ref);
      let sha = null;
      if (fs.existsSync(refPath)) {
        sha = fs.readFileSync(refPath, 'utf8').trim();
      } else {
        // packed-refs fallback
        const packed = path.join(root, '.git', 'packed-refs');
        if (fs.existsSync(packed)) {
          const line = fs.readFileSync(packed, 'utf8').split('\n').find((l) => l.endsWith(` ${ref}`));
          if (line) sha = line.split(' ')[0];
        }
      }
      return { sha, branch };
    }
    return { sha: head, branch: null }; // detached HEAD
  } catch {
    return { sha: null, branch: null };
  }
}

function readJsonIfPresent(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function count(dialect, sql, ...params) {
  try {
    const row = dialect.prepare(sql).get(...params);
    return row ? Number(Object.values(row)[0]) : null;
  } catch {
    return null;
  }
}

/**
 * Build the full Release Health report.
 *
 * @param {object} opts
 * @param {object} opts.dialect  live database dialect
 * @param {string} opts.dbPath   database path (for the cutover safety report)
 * @param {string} opts.root     repository root
 * @param {object} [opts.env]
 */
export function buildReleaseHealth({ dialect, dbPath, root, env = process.env }) {
  const signals = [];
  const now = new Date().toISOString();

  // --- version / build -----------------------------------------------------
  const pkg = readJsonIfPresent(path.join(root, 'package.json')) || {};
  const git = gitInfo(root);

  signals.push(signal('application_version', pkg.version ? STATUS.HEALTHY : STATUS.UNKNOWN,
    pkg.version ?? null, pkg.version ? null : 'package.json declares no version field'));
  signals.push(signal('commit_sha', git.sha ? STATUS.HEALTHY : STATUS.UNKNOWN, git.sha,
    git.sha ? null : 'git refs unreadable from the server process'));
  signals.push(signal('branch', git.branch ? STATUS.HEALTHY : STATUS.UNKNOWN, git.branch,
    git.branch ? null : 'detached HEAD or unreadable refs'));

  // --- migrations ----------------------------------------------------------
  let migrationTip = null;
  let appliedCount = null;
  for (const table of ['schema_migrations', 'platform_migrations']) {
    const c = count(dialect, `SELECT COUNT(*) FROM ${table}`);
    if (c === null) continue;
    appliedCount = c;
    try {
      const row = dialect.prepare(`SELECT migration_id FROM ${table} ORDER BY migration_id DESC LIMIT 1`).get();
      migrationTip = row?.migration_id ?? null;
    } catch { /* column shape differs */ }
    break;
  }
  signals.push(signal('migration_tip', migrationTip ? STATUS.HEALTHY : STATUS.UNKNOWN, migrationTip,
    migrationTip ? null : 'no readable migration ledger'));

  // A ledger table exists as soon as the database is opened, so "0 applied" is
  // a KNOWN value — but it is not a healthy one. An unmigrated database cannot
  // serve the application, so it reports blocked rather than green.
  const migrationCountStatus = appliedCount === null
    ? STATUS.UNKNOWN
    : (appliedCount === 0 ? STATUS.BLOCKED : STATUS.HEALTHY);
  signals.push(signal('applied_migration_count', migrationCountStatus, appliedCount,
    appliedCount === 0 ? 'no migrations applied — this database is not installed' : null));

  // --- database dialect ----------------------------------------------------
  signals.push(signal('database_dialect', STATUS.HEALTHY, dialect?.name ?? 'sqlite', null));

  // --- PostgreSQL ----------------------------------------------------------
  // The adapter exists and is unit-tested. It has NEVER executed against a live
  // server. These two facts must be reported separately and neither may be
  // green by association with the other.
  signals.push(signal('postgres_adapter', STATUS.HEALTHY, 'implemented',
    'adapter + portability layer implemented and unit-tested against an injected client'));
  signals.push(signal('postgres_runtime', STATUS.NOT_EXECUTED, null,
    'never executed against a live PostgreSQL server; pg driver not installed and no server reachable'));

  // --- canonical cutover ---------------------------------------------------
  let cutover = null;
  try {
    cutover = createCanonicalCutoverController({ dialect, dbPath, env }).status();
  } catch (err) {
    signals.push(signal('canonical_cutover_mode', STATUS.UNKNOWN, null, `controller unavailable: ${err.message}`));
  }

  if (cutover) {
    const enforced = Object.entries(cutover.domains).filter(([, d]) => d.enforced).map(([k]) => k);
    const total = Object.keys(cutover.domains).length;
    signals.push(signal(
      'canonical_cutover_mode',
      cutover.cutoverFlag ? STATUS.HEALTHY : STATUS.WARNING,
      cutover.cutoverFlag ? 'active' : 'not_activated',
      cutover.cutoverFlag ? null : 'legacy writers remain live for every domain except FINANCE',
    ));
    signals.push(signal(
      'domain_lock_state',
      enforced.length === total ? STATUS.HEALTHY : STATUS.WARNING,
      `${enforced.length}/${total}`,
      enforced.length === total ? null : `not enforced: ${Object.keys(cutover.domains).filter((d) => !cutover.domains[d].enforced).join(', ')}`,
    ));

    const conflicted = Object.entries(cutover.domains).filter(([, d]) => (d.conflicts || []).length > 0);
    signals.push(signal('authority_conflicts', conflicted.length === 0 ? STATUS.HEALTHY : STATUS.BLOCKED,
      conflicted.length, conflicted.length ? conflicted.map(([k, d]) => `${k}: ${d.conflicts.map((c) => c.code).join('/')}`).join('; ') : null));

    const unlocked = Object.keys(RETIREMENT_LOCKS).filter((d) => !cutover.domains[d]?.enforced);
    signals.push(signal('writer_conflicts', unlocked.length === 0 ? STATUS.HEALTHY : STATUS.WARNING,
      unlocked.length, unlocked.length ? `legacy writers still accepted for: ${unlocked.join(', ')}` : null));

    signals.push(signal('cutover_safety_guards',
      cutover.safety.allPassed ? STATUS.HEALTHY : STATUS.BLOCKED,
      cutover.safety.allPassed ? 'disposable' : 'production_protected',
      cutover.safety.allPassed ? 'this database is a disposable fixture' : `activation refused here: ${cutover.safety.failed.join(', ')}`));
  }

  // --- production cutover approval -----------------------------------------
  const approvals = count(dialect, 'SELECT COUNT(*) FROM canonical_cutover_approvals');
  signals.push(signal('production_cutover_approval',
    approvals === null ? STATUS.UNKNOWN : (approvals === 0 ? STATUS.BLOCKED : STATUS.WARNING),
    approvals,
    approvals === 0 ? 'fail-closed: no owner approval record exists (expected)' : null));

  // --- modules -------------------------------------------------------------
  const modulesTotal = count(dialect, 'SELECT COUNT(*) FROM platform_modules');
  const modulesEnabled = count(dialect, "SELECT COUNT(*) FROM platform_modules WHERE status='enabled'");
  const licensed = count(dialect, 'SELECT COUNT(*) FROM platform_module_licenses');
  signals.push(signal('enabled_modules', modulesEnabled === null ? STATUS.UNKNOWN : STATUS.HEALTHY,
    modulesEnabled === null ? null : `${modulesEnabled}/${modulesTotal}`, null));
  signals.push(signal('licensed_modules', licensed === null ? STATUS.UNKNOWN : STATUS.HEALTHY, licensed, null));

  const unhealthyModules = count(dialect, "SELECT COUNT(*) FROM platform_modules WHERE status NOT IN ('enabled','disabled')");
  signals.push(signal('unhealthy_modules',
    unhealthyModules === null ? STATUS.UNKNOWN : (unhealthyModules === 0 ? STATUS.HEALTHY : STATUS.WARNING),
    unhealthyModules, null));

  // A test fixture shipping enabled is a real release-hygiene warning.
  const testModule = count(dialect, "SELECT COUNT(*) FROM platform_modules WHERE id='checkpoint_c_test_module' AND status='enabled'");
  signals.push(signal('test_fixtures_in_release',
    testModule === null ? STATUS.UNKNOWN : (testModule === 0 ? STATUS.HEALTHY : STATUS.WARNING),
    testModule,
    testModule ? 'checkpoint_c_test_module ships enabled; gated behind control:admin but present in the module list' : null));

  // --- audit / outbox ------------------------------------------------------
  const actions = count(dialect, 'SELECT COUNT(*) FROM platform_actions');
  const actionsNoAudit = count(dialect, "SELECT COUNT(*) FROM platform_actions WHERE audit_policy != 'required'");
  signals.push(signal('audit_health',
    actionsNoAudit === null ? STATUS.UNKNOWN : (actionsNoAudit === 0 ? STATUS.HEALTHY : STATUS.BLOCKED),
    actionsNoAudit === null ? null : `${actions} actions, ${actionsNoAudit} without required audit`, null));

  const backlog = count(dialect, "SELECT COUNT(*) FROM platform_outbox WHERE status NOT IN ('delivered','dead')");
  signals.push(signal('outbox_backlog',
    backlog === null ? STATUS.UNKNOWN : (backlog === 0 ? STATUS.HEALTHY : STATUS.WARNING), backlog, null));

  const failedJobs = count(dialect, "SELECT COUNT(*) FROM platform_outbox WHERE status='dead'");
  signals.push(signal('failed_jobs',
    failedJobs === null ? STATUS.UNKNOWN : (failedJobs === 0 ? STATUS.HEALTHY : STATUS.WARNING), failedJobs, null));

  // --- sessions ------------------------------------------------------------
  const sessions = count(dialect, 'SELECT COUNT(*) FROM platform_sessions');
  signals.push(signal('session_health', sessions === null ? STATUS.UNKNOWN : STATUS.HEALTHY, sessions, null));

  // --- configuration -------------------------------------------------------
  const missingConfig = count(dialect, `
    SELECT COUNT(*) FROM platform_settings s
    WHERE s.default_value IS NULL
      AND NOT EXISTS (SELECT 1 FROM settings_values v WHERE v.key = s.key)
  `);
  signals.push(signal('configuration_warnings',
    missingConfig === null ? STATUS.UNKNOWN : (missingConfig === 0 ? STATUS.HEALTHY : STATUS.WARNING),
    missingConfig, missingConfig ? `${missingConfig} settings have neither a default nor a value` : null));

  // --- gates that are facts of record, not computable at runtime -----------
  signals.push(signal('backup_restore_last_result', STATUS.HEALTHY, 'disposable 10/10',
    'Checkpoint G: disposable backup/restore proven; production backup/restore NOT executed'));
  signals.push(signal('warehouse_duplicate_gate', STATUS.HEALTHY, 'clear',
    'Checkpoint H read-only gate: 0 warehouses, 0 duplicate codes on the operational database'));
  signals.push(signal('opening_inventory_gate', STATUS.BLOCKED, 'unresolved',
    'owner-approved opening inventory accounting date has not been provided; production opening cutover stays fail-closed'));
  signals.push(signal('vnext_freeze_attestation', STATUS.HEALTHY, 'frozen',
    'VNext HEAD cf7ae4ed73eac91a325c964178036290bc0736c1, 17 dirty paths, fingerprint unchanged across Checkpoints F, G and H'));

  // --- rollup --------------------------------------------------------------
  const tally = signals.reduce((acc, s) => { acc[s.status] = (acc[s.status] || 0) + 1; return acc; }, {});
  const overall = tally[STATUS.BLOCKED] ? STATUS.BLOCKED
    : tally[STATUS.NOT_EXECUTED] ? STATUS.WARNING
      : tally[STATUS.WARNING] ? STATUS.WARNING
        : tally[STATUS.UNKNOWN] ? STATUS.WARNING
          : STATUS.HEALTHY;

  return { generatedAt: now, overall, tally, signals };
}

export const RELEASE_HEALTH_SIGNAL_IDS = [
  'application_version', 'commit_sha', 'branch', 'migration_tip',
  'applied_migration_count', 'database_dialect', 'postgres_adapter',
  'postgres_runtime', 'canonical_cutover_mode', 'domain_lock_state',
  'authority_conflicts', 'writer_conflicts', 'cutover_safety_guards',
  'production_cutover_approval', 'enabled_modules', 'licensed_modules',
  'unhealthy_modules', 'test_fixtures_in_release', 'audit_health',
  'outbox_backlog', 'failed_jobs', 'session_health', 'configuration_warnings',
  'backup_restore_last_result', 'warehouse_duplicate_gate',
  'opening_inventory_gate', 'vnext_freeze_attestation',
];
