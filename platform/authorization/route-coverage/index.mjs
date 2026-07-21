// Route, menu, and page authorization coverage — Phase 02 packet 02.10.
//
// Source composition:
// - Phase 01 platform/api/index.mjs and platform/kernel/views/index.mjs (CONSUME).
// - VNext acl-engine.js requirePermission() route guard (project-owned,
//   MERGE-REFACTOR): 401 vs 403 separation and Arabic denial text preserved.
// - RuoYi RUOYI_UI_ROOT/src/directives/permission/ (MIT reference, behavior
//   only): the client asks the server which buttons exist; the client never
//   decides. Menu tokens are the SAME tokens the server enforces.
// - Frappe submit/cancel rights (SPEC-IMPLEMENT — FRAPPE_ROOT absent).
//
// Invariant (§ 9.5): hiding a menu entry is presentation, never protection.
// `clientMetadata()` and `authorizeRoute()` derive from the SAME evaluator call,
// so a hidden button that is called directly still hits a server denial.

'use strict';

import crypto from 'node:crypto';
import { AuthorizationError } from '../evaluator/index.mjs';

export class RouteCoverageError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'RouteCoverageError';
    this.code = code;
    this.details = details;
  }
}

export class RouteCoverageRegistry {
  constructor(dialect, deps = {}) {
    this.dialect = dialect;
    this.evaluator = deps.evaluator || null;
    this.registry = deps.permissionRegistry || null;
  }

  #now() { return new Date().toISOString(); }

  /**
   * Register a route→permission mapping. A route declared `public` MUST carry a
   * written rationale; that makes every unauthenticated surface reviewable.
   */
  register({ method, route, moduleId, permission = null, isPublic = false, rationale = null }) {
    if (isPublic && !rationale) {
      throw new RouteCoverageError('a public route requires an explicit rationale', 'PUBLIC_ROUTE_NEEDS_RATIONALE', { method, route });
    }
    if (!isPublic && !permission) {
      throw new RouteCoverageError('a protected route requires a permission', 'ROUTE_NEEDS_PERMISSION', { method, route });
    }
    if (permission && this.registry) this.registry.assertKnown(permission);
    this.dialect.prepare(`
      INSERT INTO authorization_route_coverage (id, method, route, module_id, permission, public, rationale, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(method, route) DO UPDATE SET module_id=excluded.module_id, permission=excluded.permission,
        public=excluded.public, rationale=excluded.rationale
    `).run(`rt_${crypto.randomUUID()}`, String(method).toUpperCase(), route, moduleId, permission, isPublic ? 1 : 0, rationale, this.#now());
    return this.get(method, route);
  }

  get(method, route) {
    const r = this.dialect.prepare('SELECT * FROM authorization_route_coverage WHERE method = ? AND route = ?').get(String(method).toUpperCase(), route);
    if (!r) return null;
    return { method: r.method, route: r.route, moduleId: r.module_id, permission: r.permission, public: r.public === 1, rationale: r.rationale };
  }

  /**
   * The ONLY route entry point. An unmapped route is DENIED — a missing mapping
   * can never be an accidental open door (§ 9.1 fail closed).
   */
  authorizeRoute({ method, route, ctx, entity = null, recordId = null, fields = null, amount = null }) {
    const mapping = this.get(method, route);
    if (!mapping) {
      throw new AuthorizationError({
        permission: `${String(method).toUpperCase()} ${route}`,
        reasonCode: 'ROUTE_NOT_COVERED',
        decisionId: `dec_${crypto.randomUUID()}`,
        matchedGrants: [], matchedDenies: [], effectiveScopes: [], maskedFields: [],
        requiredApproval: false, policyReferences: [], auditClassification: 'security',
        allowed: false,
        message: 'ليس لديك صلاحية تنفيذ هذا الإجراء',
      });
    }
    if (mapping.public) return { allowed: true, reasonCode: 'PUBLIC_ROUTE', public: true, decisionId: `dec_${crypto.randomUUID()}`, maskedFields: [], effectiveScopes: [] };
    if (!this.evaluator) throw new RouteCoverageError('evaluator is required to authorize a protected route', 'EVALUATOR_REQUIRED');
    return this.evaluator.require({ permission: mapping.permission, ctx, entity, recordId, fields, amount });
  }

  /**
   * Client bootstrap metadata: menus, pages, and actions the actor may see.
   * Derived from the same evaluator, so UI and server can never diverge.
   */
  clientMetadata(ctx, { pages = [], actions = [] } = {}) {
    if (!this.evaluator) throw new RouteCoverageError('evaluator is required', 'EVALUATOR_REQUIRED');
    const visiblePages = [];
    for (const page of pages) {
      const d = this.evaluator.evaluate({ permission: page.permission, ctx });
      if (d.allowed) visiblePages.push({ id: page.id, labelAr: page.labelAr, route: page.route, group: page.group || null });
    }
    const enabledActions = [];
    for (const action of actions) {
      const d = this.evaluator.evaluate({ permission: action.permission, ctx, entity: action.entity || null });
      enabledActions.push({
        id: action.id,
        permission: action.permission,
        enabled: d.allowed,
        requiresApproval: d.requiredApproval,
        reasonCode: d.allowed ? null : d.reasonCode,
      });
    }
    return {
      actorId: ctx.actorId,
      actorType: ctx.actorType,
      locale: ctx.locale || 'ar',
      direction: (ctx.locale || 'ar') === 'ar' ? 'rtl' : 'ltr',
      tenantId: ctx.tenantId,
      activeCompanyId: ctx.activeCompanyId,
      companyMemberships: ctx.companyMemberships,
      activeBranchId: ctx.activeBranchId,
      branchMemberships: ctx.branchMemberships,
      impersonation: ctx.actorType === 'impersonated' ? { active: true, by: ctx.impersonatorId } : { active: false },
      pages: visiblePages,
      actions: enabledActions,
      // The client is told what is hidden ONLY as a count, never as a list of
      // permission tokens it does not hold.
      hiddenPageCount: pages.length - visiblePages.length,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Coverage report for the closure gate: any protected surface without a mapping. */
  coverageReport(declaredRoutes = []) {
    const mapped = this.dialect.prepare('SELECT method, route, permission, public, module_id, rationale FROM authorization_route_coverage').all();
    const key = (m, r) => `${String(m).toUpperCase()} ${r}`;
    const mappedKeys = new Set(mapped.map((m) => key(m.method, m.route)));
    const unmapped = declaredRoutes.filter((r) => !mappedKeys.has(key(r.method, r.route)));
    const publicRoutes = mapped.filter((m) => m.public === 1);
    const orphanPermissions = this.registry
      ? mapped.filter((m) => m.permission && !this.registry.get(m.permission)).map((m) => key(m.method, m.route))
      : [];
    return {
      totalMapped: mapped.length,
      totalDeclared: declaredRoutes.length,
      unmapped,
      publicRoutes: publicRoutes.map((m) => ({ route: key(m.method, m.route), rationale: m.rationale })),
      orphanPermissions,
      complete: unmapped.length === 0 && orphanPermissions.length === 0,
    };
  }
}

export function createRouteCoverageRegistry(dialect, deps) { return new RouteCoverageRegistry(dialect, deps); }
