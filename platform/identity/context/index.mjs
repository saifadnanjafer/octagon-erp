// Execution context and canonical DecisionContext.
//
// Phase 01 origin: derive tenant/company/branch/user from trusted server state.
// Phase 02 packet 02.01 EXTENDS this module in place (no second context
// authority) with the DecisionContext of § 14: memberships, roles, delegated
// authority, module/feature state, operating scopes, and correlation.
//
// Source composition:
// - Phase 01 platform/identity/context/index.mjs (EXTEND — this file).
// - VNext r3-infra.js company-scope derivation (project-owned, MERGE-REFACTOR).
// - VNext acl-engine.js resolveRequestUser (project-owned): its "header fallback
//   is strictly denied unless it comes through a validated session context.
//   There is NO localhost/loopback bypass" rule is adopted verbatim as policy.
// - RuoYi tenant package (MIT reference) for tenant/company/branch vocabulary.
//
// Invariants (§ 8.1, § 9.6, § 14):
//   - every field is server-derived; a request body may REQUEST an active
//     company/branch and nothing else
//   - there is no header-, IP-, or environment-based actor path

'use strict';

export class ContextError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ContextError';
    this.code = code;
  }
}

/** Fields a request body is NEVER allowed to influence. Enforced by stripUntrustedContext(). */
export const UNTRUSTED_CONTEXT_FIELDS = Object.freeze([
  'actorId', 'actorType', 'userId', 'tenantId', 'tenant_id', 'roles', 'role',
  'grants', 'scopes', 'permissions', 'delegations', 'approved', 'approvedBy',
  'companyMemberships', 'branchMemberships', 'isOwner', 'bypass',
]);

/**
 * Remove every identity/authority assertion from a caller-supplied object.
 * Only `companyId`/`branchId` survive, and even those are treated as a *request*
 * that must be validated against membership.
 */
export function stripUntrustedContext(body = {}) {
  const requested = {};
  if (body && typeof body === 'object') {
    if (body.companyId) requested.requestedCompanyId = String(body.companyId);
    if (body.company_id) requested.requestedCompanyId = String(body.company_id);
    if (body.branchId) requested.requestedBranchId = String(body.branchId);
    if (body.branch_id) requested.requestedBranchId = String(body.branch_id);
    if (body.correlationId) requested.correlationId = String(body.correlationId);
  }
  return requested;
}

// ---------------------------------------------------------------------------
// Phase 01 surface — preserved exactly so Phase 01 callers and tests keep working
// ---------------------------------------------------------------------------

export function resolveServerScope(dialect, { tenantId, companyId, branchId, userId }) {
  if (tenantId) {
    const tenant = dialect.prepare('SELECT id FROM platform_tenants WHERE id = ? AND status = ?').get(tenantId, 'active');
    if (!tenant) throw new ContextError('tenant not found or inactive', 'TENANT_INVALID');
  }
  if (companyId) {
    const company = dialect.prepare('SELECT tenant_id FROM platform_companies WHERE id = ? AND status = ?').get(companyId, 'active');
    if (!company) throw new ContextError('company not found or inactive', 'COMPANY_INVALID');
    if (tenantId && company.tenant_id !== tenantId) throw new ContextError('company does not belong to tenant', 'COMPANY_TENANT_MISMATCH');
  }
  if (branchId) {
    const branch = dialect.prepare('SELECT company_id FROM platform_branches WHERE id = ? AND status = ?').get(branchId, 'active');
    if (!branch) throw new ContextError('branch not found or inactive', 'BRANCH_INVALID');
    if (companyId && branch.company_id !== companyId) throw new ContextError('branch does not belong to company', 'BRANCH_COMPANY_MISMATCH');
  }
  if (userId && userId !== 'system') {
    const user = dialect.prepare('SELECT tenant_id, status FROM identity_users WHERE id = ?').get(userId);
    if (!user || user.status !== 'active') throw new ContextError('user not found or inactive', 'USER_INVALID');
    if (tenantId && user.tenant_id !== tenantId) throw new ContextError('user does not belong to tenant', 'USER_TENANT_MISMATCH');
    if (companyId) {
      // Membership is the authority — not a denormalized column on the user row.
      const member = dialect.prepare(`
        SELECT 1 FROM organization_memberships
        WHERE user_id = ? AND company_id = ? AND status = 'active'
      `).get(userId, companyId);
      if (!member) throw new ContextError('user does not belong to company', 'USER_COMPANY_MISMATCH');
    }
    if (branchId) {
      const branchMember = dialect.prepare(`
        SELECT 1 FROM organization_memberships
        WHERE user_id = ? AND branch_id = ? AND status = 'active'
      `).get(userId, branchId);
      const branchless = dialect.prepare(`
        SELECT 1 FROM organization_memberships
        WHERE user_id = ? AND company_id = ? AND branch_id IS NULL AND status = 'active'
      `).get(userId, companyId);
      if (!branchMember && !branchless) throw new ContextError('user does not belong to branch', 'USER_BRANCH_MISMATCH');
    }
  }
  return { tenantId, companyId, branchId, userId };
}

export function buildExecutionContext({
  dialect,
  tenantId,
  companyId,
  branchId,
  userId,
  actorType = 'user',
  roles = [],
  correlationId,
  sourceChannel = 'system',
} = {}) {
  if (!dialect) throw new ContextError('dialect is required', 'DIALECT_REQUIRED');
  const resolved = resolveServerScope(dialect, { tenantId, companyId, branchId, userId });
  return {
    tenantId: resolved.tenantId || null,
    companyId: resolved.companyId || null,
    branchId: resolved.branchId || null,
    userId: resolved.userId || 'system',
    actorType: actorType || 'user',
    roles: Array.isArray(roles) ? roles : [],
    correlationId: correlationId || `corr_${Math.random().toString(36).slice(2)}`,
    sourceChannel,
    now: new Date().toISOString(),
  };
}

export function createExecutionContext(dialect, params) {
  return buildExecutionContext({ dialect, ...params });
}

// ---------------------------------------------------------------------------
// Phase 02 — canonical DecisionContext (§ 14)
// ---------------------------------------------------------------------------

function activeRolesFor(dialect, actorId, companyId, actorType = 'user') {
  // authorization_role_assignments arrives with migration 007; before that the
  // context simply carries no roles, which is the deny-by-default position.
  try {
    return dialect.prepare(`
      SELECT DISTINCT role_id FROM authorization_role_assignments
      WHERE user_id = ? AND status = 'active' AND actor_type = ?
        AND (company_id IS NULL OR company_id = ?)
    `).all(actorId, actorType, companyId).map((r) => r.role_id);
  } catch {
    return [];
  }
}

function activeDelegationsFor(dialect, userId, nowIso) {
  try {
    return dialect.prepare(`
      SELECT id, from_user_id, permissions, company_id, max_amount
      FROM policy_delegations
      WHERE to_user_id = ? AND status = 'active' AND valid_from <= ? AND valid_to > ?
    `).all(userId, nowIso, nowIso).map((r) => ({
      id: r.id, fromUserId: r.from_user_id, permissions: JSON.parse(r.permissions || '[]'),
      companyId: r.company_id, maxAmount: r.max_amount,
    }));
  } catch {
    return [];
  }
}

function enabledModules(dialect) {
  try {
    return dialect.prepare("SELECT id FROM platform_modules WHERE status = 'enabled'").all().map((r) => r.id);
  } catch {
    return [];
  }
}

/**
 * Build the canonical DecisionContext from an ALREADY-VERIFIED actor.
 *
 * @param {object} dialect
 * @param {object} actor output of a verified authentication step:
 *        `{ actorId, actorType:'user'|'impersonated'|'service', sessionId?, apiKeyId?, tenantId, scopes? }`
 * @param {object} request caller-supplied, already passed through stripUntrustedContext()
 * @param {object} deps `{ membershipDirectory }`
 */
export function buildDecisionContext(dialect, actor, request = {}, deps = {}) {
  if (!dialect) throw new ContextError('dialect is required', 'DIALECT_REQUIRED');
  if (!actor || !actor.actorId) throw new ContextError('no verified actor', 'NO_CONTEXT');
  const now = new Date();
  const nowIso = now.toISOString();
  const correlationId = request.correlationId || `corr_${Math.random().toString(36).slice(2)}`;

  if (actor.actorType === 'service') {
    // A service identity has no membership graph: its scope is exactly what the
    // API key was issued for. It cannot widen it via the request body.
    return Object.freeze({
      actorId: actor.actorId,
      actorType: 'service',
      sessionId: null,
      serviceIdentityId: actor.actorId,
      apiKeyId: actor.apiKeyId || null,
      tenantId: actor.tenantId,
      isOwner: false,
      companyMemberships: actor.companyId ? [actor.companyId] : [],
      activeCompanyId: actor.companyId || null,
      branchMemberships: [],
      activeBranchId: null,
      departmentId: null,
      operatingScopes: [],
      // A service identity IS a first-class grantee (migration 011). Its
      // effective authority is `role grants ∩ API key scopes` — the key can only
      // ever narrow what the service account was granted, never widen it.
      roles: activeRolesFor(dialect, actor.actorId, actor.companyId || null, 'service'),
      apiKeyScopes: actor.scopes || [],
      delegations: [],
      enabledModules: enabledModules(dialect),
      mfaSatisfied: true,
      correlationId,
      sourceChannel: request.sourceChannel || 'api',
      now: nowIso,
      // Phase 01 compatibility aliases so existing callers keep working.
      userId: actor.actorId,
      companyId: actor.companyId || null,
      branchId: null,
    });
  }

  const user = dialect.prepare('SELECT tenant_id, status, is_owner, locale FROM identity_users WHERE id = ?').get(actor.actorId);
  if (!user) throw new ContextError('user not found', 'USER_INVALID');
  if (user.status !== 'active') throw new ContextError('user is not active', 'USER_INACTIVE');
  if (actor.tenantId && actor.tenantId !== user.tenant_id) throw new ContextError('actor tenant mismatch', 'TENANT_MISMATCH');

  const memberships = deps.membershipDirectory;
  if (!memberships) throw new ContextError('membershipDirectory is required to build a user context', 'MEMBERSHIP_DIRECTORY_REQUIRED');
  const scope = memberships.resolveActiveScope(actor.actorId, {
    requestedCompanyId: request.requestedCompanyId || null,
    requestedBranchId: request.requestedBranchId || null,
  }, now);

  return Object.freeze({
    actorId: actor.actorId,
    actorType: actor.actorType === 'impersonated' ? 'impersonated' : 'user',
    impersonatorId: actor.impersonatorId || null,
    sessionId: actor.sessionId || null,
    serviceIdentityId: null,
    apiKeyId: null,
    tenantId: user.tenant_id,
    isOwner: user.is_owner === 1,
    locale: user.locale || 'ar',
    membershipId: scope.membershipId,
    companyMemberships: scope.companyMemberships,
    activeCompanyId: scope.companyId,
    branchMemberships: scope.branchMemberships,
    activeBranchId: scope.branchId,
    departmentId: scope.departmentId,
    operatingScopes: memberships.operatingScopes(actor.actorId, now),
    roles: activeRolesFor(dialect, actor.actorId, scope.companyId, 'user'),
    apiKeyScopes: [],
    delegations: activeDelegationsFor(dialect, actor.actorId, nowIso),
    enabledModules: enabledModules(dialect),
    mfaSatisfied: !!actor.mfaSatisfied,
    correlationId,
    sourceChannel: request.sourceChannel || 'ui',
    now: nowIso,
    // Phase 01 compatibility aliases.
    userId: actor.actorId,
    companyId: scope.companyId,
    branchId: scope.branchId,
  });
}

/** Internal/system context for migrations, jobs, and seeding. Never reachable from HTTP. */
export function systemContext(dialect, { companyId = null, tenantId = null, sourceChannel = 'system' } = {}) {
  return Object.freeze({
    actorId: 'system', actorType: 'system', userId: 'system', sessionId: null, serviceIdentityId: null,
    apiKeyId: null, tenantId, isOwner: true,
    activeCompanyId: companyId, companyId, activeBranchId: null, branchId: null,
    companyMemberships: companyId ? [companyId] : [], branchMemberships: [], operatingScopes: [],
    roles: [], apiKeyScopes: [], delegations: [], enabledModules: enabledModules(dialect),
    mfaSatisfied: true,
    correlationId: `sys_${Math.random().toString(36).slice(2)}`, sourceChannel, now: new Date().toISOString(),
  });
}
