// Phase 05 Control Plane.
//
// Two server-side gates, both enforced before a domain handler runs:
//
//   1. Module gate — `platform_feature_flags` row per Phase 05 domain. A
//      disabled or unlicensed module denies its actions on the server. The
//      browser may also hide the tab, but hiding is never the enforcement.
//   2. Operating policy — company-scoped rows in `phase05_operating_policies`
//      (approval requirements, tolerances, backflush default, reservation and
//      costing policy, quality-hold policy).
//
// Neither gate is readable from, or writable by, the client payload.

import { registerDomainHandler } from '../kernel/actions/domain-handler.mjs';

export class ControlPlaneError extends Error {
  constructor(message, code = 'MODULE_DISABLED', statusCode = 403) {
    super(message);
    this.name = 'ControlPlaneError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export const PHASE05_MODULE_FLAGS = Object.freeze({
  manufacturing: 'phase05.manufacturing.enabled',
  quality: 'phase05.quality.enabled',
  planning: 'phase05.planning.enabled',
  projects: 'phase05.projects.enabled',
  assets: 'phase05.assets.enabled',
  maintenance: 'phase05.maintenance.enabled',
  fleet: 'phase05.fleet.enabled',
});

function flagTableExists(db) {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'platform_feature_flags'",
  ).get());
}

/**
 * A flag that does not exist is treated as enabled: a database migrated only up
 * to Phase 04 must keep working. A flag that exists and is off is a hard deny.
 */
export function isModuleEnabled(db, flagKey) {
  if (!flagTableExists(db)) return true;
  const row = db.prepare('SELECT enabled FROM platform_feature_flags WHERE key = ?').get(flagKey);
  if (!row) return true;
  return Number(row.enabled) === 1;
}

export function assertModuleEnabled(db, flagKey, label) {
  if (isModuleEnabled(db, flagKey)) return true;
  throw new ControlPlaneError(
    `${label} is disabled for this deployment (${flagKey})`,
    'MODULE_DISABLED',
    403,
  );
}

export function setModuleEnabled(db, payload = {}) {
  const flagKey = payload.flag_key;
  if (!Object.values(PHASE05_MODULE_FLAGS).includes(flagKey)) {
    throw new ControlPlaneError(`unknown Phase 05 module flag: ${flagKey}`, 'INPUT_INVALID', 400);
  }
  const enabled = payload.enabled ? 1 : 0;
  const changed = db.prepare(
    'UPDATE platform_feature_flags SET enabled = ?, updated_at = ? WHERE key = ?',
  ).run(enabled, new Date().toISOString(), flagKey);
  if (!changed.changes) {
    throw new ControlPlaneError(`feature flag not installed: ${flagKey}`, 'RECORD_NOT_FOUND', 404);
  }
  return { flag_key: flagKey, enabled: Boolean(enabled) };
}

export function getPolicy(db, companyId, key, fallback = null) {
  const exists = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'phase05_operating_policies'",
  ).get();
  if (!exists) return fallback;
  const row = db.prepare(
    'SELECT policy_value FROM phase05_operating_policies WHERE company_id = ? AND policy_key = ?',
  ).get(companyId, key);
  return row ? row.policy_value : fallback;
}

export function getPolicyNumber(db, companyId, key, fallback = 0) {
  const value = Number(getPolicy(db, companyId, key, fallback));
  return Number.isFinite(value) ? value : fallback;
}

export function getPolicyBoolean(db, companyId, key, fallback = false) {
  const value = getPolicy(db, companyId, key, fallback ? '1' : '0');
  return value === '1' || value === 'true';
}

export function setPolicy(db, payload = {}) {
  const companyId = payload.company_id;
  const actor = payload.actor || payload.actor_id;
  if (!companyId || companyId === '*') {
    throw new ControlPlaneError('an active company scope is required', 'COMPANY_SCOPE_REQUIRED', 403);
  }
  const key = String(payload.policy_key || '').trim();
  if (!key) throw new ControlPlaneError('policy_key is required', 'INPUT_MISSING_FIELD', 400);
  db.prepare(`
    INSERT INTO phase05_operating_policies (company_id, policy_key, policy_value, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(company_id, policy_key) DO UPDATE SET
      policy_value = excluded.policy_value,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `).run(companyId, key, String(payload.policy_value), new Date().toISOString(), actor || 'system');
  return { company_id: companyId, policy_key: key, policy_value: String(payload.policy_value) };
}

export function listPolicies(db, companyId) {
  return db.prepare(
    'SELECT policy_key, policy_value, updated_at, updated_by FROM phase05_operating_policies WHERE company_id = ? ORDER BY policy_key',
  ).all(companyId);
}

export function listModuleStates(db) {
  if (!flagTableExists(db)) return [];
  const keys = Object.values(PHASE05_MODULE_FLAGS);
  return db.prepare(`
    SELECT key, module_id, enabled FROM platform_feature_flags
    WHERE key IN (${keys.map(() => '?').join(',')}) ORDER BY key
  `).all(...keys).map((row) => ({ ...row, enabled: Number(row.enabled) === 1 }));
}

/**
 * Register a Phase 05 domain handler behind its module gate. Identical to
 * `registerDomainHandler` except the flag is checked first, so a disabled
 * module cannot be reached through the HTTP action route, the API families, or
 * an internal caller.
 */
export function registerGatedHandler(actionExecutor, actionId, handler, flagKey, label) {
  registerDomainHandler(actionExecutor, actionId, (db, scopedInput) => {
    assertModuleEnabled(db, flagKey, label);
    return handler(db, scopedInput);
  });
}
