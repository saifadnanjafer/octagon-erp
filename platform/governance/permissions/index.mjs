// Phase 01 permission hook — now a COMPATIBILITY SHIM over the canonical
// Phase 02 evaluator (packets 02.07 and 02.32).
//
// Phase 01 shipped a standalone deny-by-default hook reading platform_users.roles
// and platform_acl_grants. Phase 02 makes platform/authorization/evaluator the
// single decision point. Rather than leave two engines alive (§ 68 forbids
// "preserve both legacy and new ACL as indefinite authorities"), this module
// keeps its Phase 01 export signature and delegates every decision downward.
//
//   createPermissionHook(dialect).check({ resource, action, context, requirePermission })
//
// Cutover record (docs/evidence/phase-02/legacy-authority-cutover.md, row "grants"):
//   Legacy reader:   this module + platform_acl_grants
//   Legacy writer:   platform_acl_grants  (RETIRED — migration 007 mirrored it once)
//   New canonical:   authorization_grants / authorization_role_assignments
//   Adapter expiry:  removed when no caller passes a Phase 01 `{userId, companyId}`
//                    context; tracked as deferred item P02-D1.
//
// DELIBERATE DIFFERENCE FROM THE CANONICAL PATH: this shim does not attach the
// permission registry, so a legacy token that was never registered is decided by
// grants alone. That is still deny-by-default (no grant ⇒ denied) — it is NOT a
// fail-open. New code calls the evaluator directly and therefore also gets the
// stricter PERMISSION_UNKNOWN rule.

'use strict';

import { createPermissionEvaluator } from '../../authorization/evaluator/index.mjs';

export class PermissionDeniedError extends Error {
  constructor(message, code = 'PERMISSION_DENIED') {
    super(message);
    this.name = 'PermissionDeniedError';
    this.code = code;
    this.statusCode = 403;
  }
}

/** Normalize a Phase 01 `{userId, companyId}` context into a DecisionContext shape. */
function adaptContext(context) {
  if (!context || !(context.userId || context.actorId)) return null;
  const actorId = context.actorId || context.userId;
  if (context.actorType && context.activeCompanyId !== undefined) return context; // already canonical
  const companyId = context.companyId || context.activeCompanyId || null;
  return {
    ...context,
    actorId,
    userId: actorId,
    actorType: actorId === 'system' ? 'system' : (context.actorType || 'user'),
    tenantId: context.tenantId || null,
    activeCompanyId: companyId,
    companyId,
    activeBranchId: context.branchId || null,
    companyMemberships: companyId ? [companyId] : [],
    branchMemberships: [],
    operatingScopes: [],
    delegations: [],
    apiKeyScopes: [],
    enabledModules: [],
    correlationId: context.correlationId || null,
    sourceChannel: context.sourceChannel || 'legacy-hook',
    now: context.now || new Date().toISOString(),
  };
}

export class PermissionHook {
  constructor(dialect) {
    if (!dialect || typeof dialect.prepare !== 'function') throw new Error('dialect required');
    this.dialect = dialect;
    // No permission registry attached — see the deliberate-difference note above.
    this.evaluator = createPermissionEvaluator(dialect, { permissionRegistry: null });
    this.policies = new Map();
  }

  /** Phase 01 API kept: a per-(resource,action) extra predicate. */
  registerPolicy(resource, action, checkFn) {
    const key = `${resource}:${action}`;
    if (!this.policies.has(key)) this.policies.set(key, []);
    this.policies.get(key).push(checkFn);
    return this;
  }

  /** Phase 01 API kept: does a role hold a permission? Now reads the canonical grants. */
  hasGrant(role, perm) {
    const row = this.dialect.prepare(`
      SELECT 1 FROM authorization_grants g
      JOIN authorization_roles r ON r.id = g.role_id AND r.status = 'active'
      WHERE r.name = ? AND g.permission = ? AND g.effect = 'allow'
    `).get(role, perm);
    return !!row;
  }

  check({ resource, action, context, requirePermission = null }) {
    const ctx = adaptContext(context);
    if (!ctx) throw new PermissionDeniedError('no server context', 'NO_CONTEXT');
    if (ctx.actorType === 'system') return { allowed: true };

    const user = this.dialect.prepare('SELECT status FROM identity_users WHERE id = ?').get(ctx.actorId);
    if (!user || user.status !== 'active') throw new PermissionDeniedError('user not found or inactive', 'USER_INVALID');
    if (ctx.activeCompanyId) {
      const member = this.dialect.prepare("SELECT 1 FROM organization_memberships WHERE user_id = ? AND company_id = ? AND status = 'active'")
        .get(ctx.actorId, ctx.activeCompanyId);
      if (!member) throw new PermissionDeniedError('user not found or inactive', 'USER_INVALID');
    }

    const permission = requirePermission || `${resource}:${action}`;
    const decision = this.evaluator.evaluate({ permission, ctx });
    if (!decision.allowed) throw new PermissionDeniedError(`permission denied: ${permission}`, 'PERMISSION_DENIED');

    for (const fn of this.policies.get(`${resource}:${action}`) || []) {
      const result = fn(ctx);
      if (result) throw new PermissionDeniedError(result, 'POLICY_DENIED');
    }
    return { allowed: true, decisionId: decision.decisionId };
  }
}

export function createPermissionHook(dialect) {
  return new PermissionHook(dialect);
}
