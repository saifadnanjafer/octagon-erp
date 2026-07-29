/**
 * Health-only startup mode.
 *
 * When an operational database has pending migrations, Octagon must not migrate
 * it automatically (see the 2026-07-29 auto-migration incident) and must not run
 * business logic against a schema the code does not expect. The owner chose a
 * restricted diagnostic runtime over a hard process stop, so the administrator
 * can still authenticate and read migration readiness.
 *
 * This is NOT degraded normal operation. It is an isolated diagnostic state:
 *   - default deny; every route is allowed explicitly or refused
 *   - refusal happens before any domain handler executes
 *   - no business read, no business mutation, no cutover action
 *   - anonymous callers learn only that the system is blocked, never why
 *   - leaving the state requires a clean process restart
 */

export const HEALTH_ONLY_DENIAL_CODE = 'SYSTEM_HEALTH_ONLY_MODE';

/**
 * Routes reachable while health-only mode is active.
 *
 * Deliberately minimal. Each entry states why it must exist — anything that
 * cannot justify itself does not belong here.
 */
const ALLOWED_EXACT = new Map([
  ['GET /api/auth/session', 'identify the current session so the screen can render'],
  ['POST /api/auth/login', 'the administrator must be able to authenticate'],
  ['POST /api/auth/logout', 'the administrator must be able to end the session'],
  ['GET /api/release/health', 'the diagnostic payload this mode exists to expose'],
  ['GET /api/migration/readiness', 'migration tip, pending list, and authorization state'],
  ['GET /api/system/mode', 'unauthenticated availability probe (non-sensitive)'],
]);

/** Static assets required to render the login form and the blocked screen. */
const ALLOWED_STATIC = new Set([
  '/',
  '/index.html',
  '/health-only.html',
  '/style.css',
  '/ui-contrast-fix.css',
  '/themes.css',
  '/manifest.json',
  '/favicon.ico',
]);

/** Static asset prefixes required by the blocked screen only. */
const ALLOWED_STATIC_PREFIXES = ['/assets/health-only/'];

/** Endpoints that require owner/system-admin authority, not merely a session. */
const REQUIRES_ADMIN = new Set(['GET /api/release/health', 'GET /api/migration/readiness']);

/**
 * Process-wide health-only state. Set once during bootstrap and never cleared at
 * runtime: recovering from a blocked state requires a clean restart so a
 * half-migrated process can never quietly become a normal one.
 */
let state = {
  active: false,
  reason: null,
  databaseClass: null,
  appliedTip: null,
  repositoryTip: null,
  pendingCount: 0,
  pendingMigrations: [],
  enteredAt: null,
};

export function activateHealthOnlyMode(details = {}) {
  state = {
    active: true,
    reason: details.reason ?? 'pending migrations require authorization',
    databaseClass: details.databaseClass ?? null,
    appliedTip: details.appliedTip ?? null,
    repositoryTip: details.repositoryTip ?? null,
    pendingCount: details.pendingCount ?? 0,
    pendingMigrations: Array.isArray(details.pendingMigrations) ? [...details.pendingMigrations] : [],
    enteredAt: details.enteredAt ?? null,
  };
  return getHealthOnlyState();
}

export function getHealthOnlyState() {
  return { ...state, pendingMigrations: [...state.pendingMigrations] };
}

export function isHealthOnlyActive() {
  return state.active === true;
}

/** Test-only reset. Never called by the server. */
export function __resetHealthOnlyModeForTests() {
  state = {
    active: false, reason: null, databaseClass: null, appliedTip: null,
    repositoryTip: null, pendingCount: 0, pendingMigrations: [], enteredAt: null,
  };
}

function isAdminIdentity(identity) {
  if (!identity) return false;
  return identity.isOwner === true || identity.is_owner === 1 || identity.isSystemAdmin === true;
}

/**
 * Decide whether a request may proceed while health-only mode is active.
 *
 * @returns {{allowed: boolean, code?: string, status?: number, reason?: string, requiresAdmin?: boolean}}
 */
export function evaluateHealthOnlyRequest(method, pathname, identity = null) {
  if (!state.active) return { allowed: true };

  const key = `${String(method || 'GET').toUpperCase()} ${pathname}`;

  if (ALLOWED_EXACT.has(key)) {
    if (REQUIRES_ADMIN.has(key) && !isAdminIdentity(identity)) {
      return {
        allowed: false,
        status: 403,
        code: 'HEALTH_ONLY_ADMIN_REQUIRED',
        reason: 'diagnostics require owner or system administrator authority',
      };
    }
    return { allowed: true, requiresAdmin: REQUIRES_ADMIN.has(key) };
  }

  const isRead = String(method || 'GET').toUpperCase() === 'GET';
  if (isRead && (ALLOWED_STATIC.has(pathname) || ALLOWED_STATIC_PREFIXES.some((p) => pathname.startsWith(p)))) {
    return { allowed: true };
  }

  return {
    allowed: false,
    status: 503,
    code: HEALTH_ONLY_DENIAL_CODE,
    reason: 'Octagon is in health-only mode pending an authorized database migration',
  };
}

/**
 * Body for a denied request.
 *
 * Anonymous callers receive availability only. Migration IDs, tips, counts and
 * database classification are diagnostics and are withheld until the caller has
 * proven administrative authority.
 */
export function healthOnlyDenialBody(identity = null) {
  const base = {
    ok: false,
    error: 'System is in health-only mode',
    code: HEALTH_ONLY_DENIAL_CODE,
    mode: 'health_only',
    releaseHealthRoute: '/api/release/health',
  };

  if (!isAdminIdentity(identity)) return base;

  return {
    ...base,
    reason: state.reason,
    databaseClass: state.databaseClass,
    currentMigrationTip: state.appliedTip,
    targetMigrationTip: state.repositoryTip,
    pendingMigrationCount: state.pendingCount,
    pendingMigrations: state.pendingMigrations,
    restartRequiredAfterResolution: true,
  };
}

/** Non-sensitive availability payload for unauthenticated callers. */
export function publicModePayload() {
  return state.active
    ? { ok: true, mode: 'health_only', available: false, message: 'System maintenance authorization required' }
    : { ok: true, mode: 'normal', available: true };
}

/** Full readiness payload — administrator only; callers must enforce that. */
export function migrationReadinessPayload(extra = {}) {
  return {
    ok: true,
    mode: state.active ? 'health_only' : 'normal',
    healthOnly: state.active,
    reason: state.reason,
    databaseClass: state.databaseClass,
    currentMigrationTip: state.appliedTip,
    repositoryMigrationTip: state.repositoryTip,
    pendingMigrationCount: state.pendingCount,
    pendingMigrations: state.pendingMigrations,
    automaticStartupMigration: 'disabled',
    operationalMigrationAuthorization: 'required',
    restartRequiredAfterResolution: true,
    enteredAt: state.enteredAt,
    ...extra,
  };
}
