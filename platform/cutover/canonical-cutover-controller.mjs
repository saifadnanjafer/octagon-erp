// Canonical cutover controller — Checkpoint G.
//
// Checkpoint F proved that canonical authority was *registered* for every
// domain but *enforced* for exactly one (FINANCE). Turning enforcement on was
// impossible to do safely because there was no controller: no readiness
// assessment, no dry run, no conflict report, no attempt record, no rollback,
// and no approval fact. The only lever was hand-editing a feature flag and
// inserting lock rows, which is precisely the kind of change nobody should make
// by hand against a live workshop.
//
// This controller supplies the missing governance. It does NOT decide to cut
// over — the owner does. What it does is make the decision reviewable,
// rehearsable and reversible.
//
// ===========================================================================
// SAFETY — three independent guards, no bypass
// ===========================================================================
//
// Activation mutates enforcement for a whole business domain. On the
// operational database that would immediately break every legacy UI write the
// running workshop depends on. So activation requires ALL THREE of:
//
//   1. OCTAGON_DISPOSABLE_FIXTURE=1        — explicit disposable-fixture flag
//   2. OCTAGON_RUNTIME_MODE !== 'production' — non-production runtime mode
//   3. a database path that PROVES it is disposable — under the OS temp
//      directory, or a basename matching the disposable naming convention.
//      Any path resolving to the operational store is rejected outright.
//
// There is deliberately no force flag, no bypass argument, and no silent
// fallback. If a guard cannot be evaluated, it fails closed. Production
// activation additionally requires an owner-level permission and a stored
// server-side approval fact, and is NOT performed by this checkpoint.

'use strict';

import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import { RETIREMENT_LOCKS } from './legacy-writer-retirement.mjs';

export class CutoverError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'CutoverError';
    this.code = code;
    this.details = details;
  }
}

export const CUTOVER_FLAG_KEY = 'phase04.canonical_cutover';

// FINANCE is enforced unconditionally in server.js and owns no retirement lock.
export const FINANCE_DOMAIN = 'FINANCE';

export function cutoverDomains() {
  return Object.keys(RETIREMENT_LOCKS);
}

// ---------------------------------------------------------------------------
// Guard 3 — database path identity
// ---------------------------------------------------------------------------

// Basenames that identify the operational store. A path resolving to any of
// these is refused regardless of the other guards.
const OPERATIONAL_BASENAMES = new Set([
  'database.db',
  'database.json',
  'database.db-wal',
  'database.db-shm',
]);

const DISPOSABLE_NAME_PATTERN = /(^|[-_.])(tmp|temp|test|disposable|fixture|rehearsal|rc)([-_.]|$)/i;

export function assessDatabasePath(dbPath) {
  if (!dbPath || typeof dbPath !== 'string') {
    return { disposable: false, reason: 'DB_PATH_UNKNOWN' };
  }

  const resolved = path.resolve(dbPath);
  const base = path.basename(resolved);

  if (OPERATIONAL_BASENAMES.has(base)) {
    return { disposable: false, reason: 'OPERATIONAL_DATABASE_PATH', resolved };
  }

  const tmp = path.resolve(os.tmpdir());
  const underTmp = resolved.toLowerCase().startsWith(tmp.toLowerCase() + path.sep);
  if (underTmp) return { disposable: true, reason: 'UNDER_OS_TMPDIR', resolved };

  if (DISPOSABLE_NAME_PATTERN.test(base)) {
    return { disposable: true, reason: 'DISPOSABLE_NAME_CONVENTION', resolved };
  }

  // Fail closed: a path we cannot prove disposable is treated as operational.
  return { disposable: false, reason: 'NOT_PROVABLY_DISPOSABLE', resolved };
}

export function assessSafetyGuards({ dbPath, env = process.env } = {}) {
  const fixtureFlag = String(env.OCTAGON_DISPOSABLE_FIXTURE || '') === '1';
  const runtimeMode = String(env.OCTAGON_RUNTIME_MODE || 'production').toLowerCase();
  const nonProduction = runtimeMode !== 'production';
  const pathAssessment = assessDatabasePath(dbPath);

  const guards = [
    { id: 'disposable_fixture_flag', passed: fixtureFlag, detail: 'OCTAGON_DISPOSABLE_FIXTURE=1 required' },
    { id: 'non_production_runtime', passed: nonProduction, detail: `OCTAGON_RUNTIME_MODE='${runtimeMode}' must not be 'production'` },
    { id: 'disposable_database_path', passed: pathAssessment.disposable, detail: pathAssessment.reason },
  ];

  return {
    allPassed: guards.every((g) => g.passed),
    guards,
    failed: guards.filter((g) => !g.passed).map((g) => g.id),
    pathAssessment,
  };
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export function createCanonicalCutoverController({ dialect, dbPath, env = process.env, now = () => new Date().toISOString() }) {
  if (!dialect || typeof dialect.prepare !== 'function') {
    throw new CutoverError('cutover controller requires a database dialect', 'DIALECT_REQUIRED');
  }

  const stamp = () => now();

  function flagEnabled() {
    try {
      const row = dialect.prepare(`SELECT enabled FROM platform_feature_flags WHERE key = ?`).get(CUTOVER_FLAG_KEY);
      return row?.enabled === 1;
    } catch (_) {
      return false;
    }
  }

  function lockRow(domain) {
    const expected = RETIREMENT_LOCKS[domain];
    if (!expected) return null;
    try {
      return dialect.prepare(`
        SELECT authority_key, canonical_target, status, retired_at, reason
        FROM authority_retirement_locks WHERE authority_key = ?
      `).get(expected.authorityKey) || null;
    } catch (_) {
      return null;
    }
  }

  function domainEnforced(domain) {
    if (domain === FINANCE_DOMAIN) return true;
    if (!flagEnabled()) return false;
    const expected = RETIREMENT_LOCKS[domain];
    if (!expected) return false;
    const lock = lockRow(domain);
    return lock?.status === 'RETIRED' && lock.canonical_target === expected.canonicalTarget;
  }

  // -------------------------------------------------------------------------
  // Readiness / conflicts
  // -------------------------------------------------------------------------

  // A domain is only eligible if its canonical target module is actually
  // registered and enabled. Locking a domain onto a module that does not exist
  // would fail every legacy write with no canonical replacement available —
  // the worst possible outcome.
  function assessDomain(domain) {
    const expected = RETIREMENT_LOCKS[domain];
    const conflicts = [];

    if (!expected) {
      return { domain, eligible: false, conflicts: [{ code: 'UNKNOWN_DOMAIN', detail: domain }], enforced: false };
    }

    let moduleRow = null;
    try {
      moduleRow = dialect.prepare('SELECT id, status FROM platform_modules WHERE id = ?').get(expected.canonicalTarget) || null;
    } catch (_) { /* table missing -> conflict below */ }

    if (!moduleRow) {
      conflicts.push({ code: 'CANONICAL_TARGET_MISSING', detail: expected.canonicalTarget });
    } else if (moduleRow.status !== 'enabled') {
      conflicts.push({ code: 'CANONICAL_TARGET_NOT_ENABLED', detail: `${expected.canonicalTarget} status=${moduleRow.status}` });
    }

    let actionCount = 0;
    try {
      actionCount = dialect.prepare('SELECT COUNT(*) AS c FROM platform_actions WHERE module_id = ?').get(expected.canonicalTarget)?.c || 0;
    } catch (_) { /* ignore */ }

    if (actionCount === 0) {
      conflicts.push({ code: 'NO_CANONICAL_ACTIONS', detail: `${expected.canonicalTarget} registers no actions` });
    }

    const lock = lockRow(domain);
    if (lock && lock.canonical_target !== expected.canonicalTarget) {
      conflicts.push({ code: 'LOCK_TARGET_MISMATCH', detail: `lock targets ${lock.canonical_target}, expected ${expected.canonicalTarget}` });
    }

    return {
      domain,
      canonicalTarget: expected.canonicalTarget,
      authorityKey: expected.authorityKey,
      registeredActions: actionCount,
      lock,
      enforced: domainEnforced(domain),
      conflicts,
      eligible: conflicts.length === 0,
    };
  }

  function status() {
    const domains = {};
    for (const domain of cutoverDomains()) domains[domain] = assessDomain(domain);
    const finance = { domain: FINANCE_DOMAIN, enforced: true, eligible: true, conflicts: [], lock: null, note: 'enforced unconditionally since Phase 03; owns no retirement lock' };

    const all = [...Object.values(domains), finance];
    return {
      cutoverFlag: flagEnabled(),
      safety: assessSafetyGuards({ dbPath, env }),
      domains: { ...domains, [FINANCE_DOMAIN]: finance },
      summary: {
        total: all.length,
        enforced: all.filter((d) => d.enforced).length,
        eligible: all.filter((d) => d.eligible).length,
        withConflicts: all.filter((d) => d.conflicts.length > 0).length,
      },
    };
  }

  function dryRun() {
    const s = status();
    const wouldActivate = [];
    const blocked = [];
    for (const domain of cutoverDomains()) {
      const d = s.domains[domain];
      if (d.enforced) continue;
      if (d.eligible) wouldActivate.push(domain);
      else blocked.push({ domain, conflicts: d.conflicts });
    }
    return {
      mode: 'dry_run',
      safety: s.safety,
      cutoverFlag: s.cutoverFlag,
      wouldActivate,
      blocked,
      alreadyEnforced: [FINANCE_DOMAIN, ...cutoverDomains().filter((d) => s.domains[d].enforced)],
    };
  }

  // -------------------------------------------------------------------------
  // Attempts
  // -------------------------------------------------------------------------

  function recordAttempt({ domain, action, result, detail, actor }) {
    const id = `cta_${crypto.randomBytes(8).toString('hex')}`;
    dialect.prepare(`
      INSERT INTO canonical_cutover_attempts (id, domain, action, result, detail, actor, mode, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, domain || '*', action, result, JSON.stringify(detail || {}), actor || 'unknown', 'disposable', stamp());
    return id;
  }

  function attempts(limit = 50) {
    return dialect.prepare('SELECT * FROM canonical_cutover_attempts ORDER BY created_at DESC, id DESC LIMIT ?').all(limit);
  }

  // -------------------------------------------------------------------------
  // Activation — guarded
  // -------------------------------------------------------------------------

  function requireDisposable(action, domain, actor) {
    const safety = assessSafetyGuards({ dbPath, env });
    if (!safety.allPassed) {
      recordAttempt({ domain, action, result: 'REFUSED', detail: { failedGuards: safety.failed, guards: safety.guards }, actor });
      throw new CutoverError(
        `canonical cutover refused: disposable safety guards not satisfied (${safety.failed.join(', ')})`,
        'CUTOVER_NOT_DISPOSABLE',
        { failed: safety.failed, guards: safety.guards },
      );
    }
    return safety;
  }

  function enableFlag(actor) {
    const existing = dialect.prepare('SELECT key FROM platform_feature_flags WHERE key = ?').get(CUTOVER_FLAG_KEY);
    if (existing) {
      dialect.prepare('UPDATE platform_feature_flags SET enabled = 1, updated_at = ? WHERE key = ?').run(stamp(), CUTOVER_FLAG_KEY);
    } else {
      dialect.prepare(`
        INSERT INTO platform_feature_flags (key, module_id, scope, enabled, audit_policy, created_at, updated_at)
        VALUES (?, 'platform_kernel', 'global', 1, 'required', ?, ?)
      `).run(CUTOVER_FLAG_KEY, stamp(), stamp());
    }
    recordAttempt({ domain: '*', action: 'enable_flag', result: 'OK', detail: { key: CUTOVER_FLAG_KEY }, actor });
  }

  function activateDomain(domain, { actor = 'cutover-controller', reason = 'Checkpoint G disposable rehearsal' } = {}) {
    requireDisposable('activate_domain', domain, actor);

    const assessment = assessDomain(domain);
    if (!assessment.eligible) {
      recordAttempt({ domain, action: 'activate_domain', result: 'BLOCKED', detail: { conflicts: assessment.conflicts }, actor });
      throw new CutoverError(`domain ${domain} is not eligible for cutover`, 'DOMAIN_NOT_ELIGIBLE', { conflicts: assessment.conflicts });
    }

    if (!flagEnabled()) enableFlag(actor);

    const expected = RETIREMENT_LOCKS[domain];
    const at = stamp();
    dialect.prepare(`
      INSERT INTO authority_retirement_locks (id, authority_key, canonical_target, status, retired_at, reason)
      VALUES (?, ?, ?, 'RETIRED', ?, ?)
      ON CONFLICT(authority_key) DO UPDATE SET
        canonical_target = excluded.canonical_target,
        status = 'RETIRED',
        retired_at = excluded.retired_at,
        reason = excluded.reason
    `).run(`arl_${domain.toLowerCase()}`, expected.authorityKey, expected.canonicalTarget, at, reason);

    const attemptId = recordAttempt({
      domain, action: 'activate_domain', result: 'ACTIVATED',
      detail: { authorityKey: expected.authorityKey, canonicalTarget: expected.canonicalTarget }, actor,
    });

    return { domain, attemptId, enforced: domainEnforced(domain), lock: lockRow(domain) };
  }

  function activateAll(options = {}) {
    requireDisposable('activate_all', '*', options.actor);
    const plan = dryRun();
    const activated = [];
    const blocked = [...plan.blocked];
    for (const domain of plan.wouldActivate) {
      try {
        activated.push(activateDomain(domain, options));
      } catch (err) {
        blocked.push({ domain, conflicts: [{ code: err.code, detail: err.message }] });
      }
    }
    return { activated: activated.map((a) => a.domain), blocked, status: status() };
  }

  // Rollback of an uncommitted/rehearsal activation. Disposable-only, same
  // guards: reverting enforcement on a live database would silently reopen a
  // legacy back door, which is exactly as dangerous as opening one.
  function rollbackAttempt(domain, { actor = 'cutover-controller' } = {}) {
    requireDisposable('rollback_attempt', domain, actor);
    const expected = RETIREMENT_LOCKS[domain];
    if (!expected) throw new CutoverError(`unknown domain ${domain}`, 'UNKNOWN_DOMAIN');

    dialect.prepare('DELETE FROM authority_retirement_locks WHERE authority_key = ?').run(expected.authorityKey);
    recordAttempt({ domain, action: 'rollback_attempt', result: 'ROLLED_BACK', detail: { authorityKey: expected.authorityKey }, actor });
    return { domain, enforced: domainEnforced(domain) };
  }

  return {
    status,
    dryRun,
    assessDomain,
    validateDomain: assessDomain,
    activateDomain,
    activateAll,
    rollbackAttempt,
    attempts,
    domainEnforced,
    flagEnabled,
    safety: () => assessSafetyGuards({ dbPath, env }),
  };
}
