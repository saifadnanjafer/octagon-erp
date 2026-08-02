// Octagon shell governance bootstrap — Phase 02 packet 02.31.
//
// This is the ONE payload the existing Octagon shell (index.html + app.js) asks
// for after login. It is assembled entirely from the canonical evaluator, so the
// client and the server can never disagree about what is permitted.
//
// Source composition:
// - Octagon index.html / app.js grouped Arabic sidebar and page map (PRESERVE:
//   the shell is not replaced; it is fed).
// - RuoYi RUOYI_UI_ROOT/src/directives/permission (MIT reference, behavior only):
//   the client asks the server which buttons exist and renders accordingly.
// - VNext governance clients (project-owned) for the payload shape.
//
// Invariants (§ 9.5, § 56):
//   - this payload NEVER carries a permission token the actor does not hold, and
//     never carries a raw secret
//   - hiding is presentation; the server denies the same call independently
//   - Arabic/RTL identity is preserved: `locale`/`direction` come from the user

'use strict';

export class BootstrapError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'BootstrapError';
    this.code = code;
  }
}

/**
 * The Octagon page catalogue, expressed as (id, permission) pairs. Groups mirror
 * the existing Arabic sidebar so the shell renders unchanged.
 */
export const DEFAULT_PAGE_CATALOGUE = Object.freeze([
  { id: 'home', route: '/', labelAr: 'الرئيسية', group: 'general', permission: 'platform:page:home' },
  { id: 'approvals', route: '/approvals', labelAr: 'مركز الموافقات', group: 'governance', permission: 'platform:page:approvals' },
  { id: 'inbox', route: '/inbox', labelAr: 'صندوق الوارد', group: 'governance', permission: 'platform:page:inbox' },
  { id: 'workflows', route: '/workflows', labelAr: 'سير العمل', group: 'governance', permission: 'platform:page:workflows' },
  { id: 'users', route: '/users', labelAr: 'المستخدمون والأدوار', group: 'admin', permission: 'platform:page:users' },
  { id: 'settings', route: '/settings', labelAr: 'الإعدادات', group: 'admin', permission: 'platform:page:settings' },
  { id: 'security', route: '/security', labelAr: 'الأمن والتدقيق', group: 'admin', permission: 'platform:page:security' },
  { id: 'canonical_console', route: '/canonical_console', labelAr: 'لوحة العمليات القانونية', group: 'governance', permission: 'platform:page:canonical_console' },
  { id: 'canonical_inventory', route: '/canonical_inventory', labelAr: 'المخزون والمستودعات', group: 'operations', permission: 'platform:page:canonical_inventory' },
  { id: 'products', route: '/products', labelAr: 'المنتجات والمواد', group: 'master_data', permission: 'platform:page:products' },
  { id: 'parties', route: '/parties', labelAr: 'العملاء والموردون', group: 'master_data', permission: 'platform:page:parties' },
  { id: 'warehouses', route: '/warehouses', labelAr: 'المستودعات والمواقع', group: 'operations', permission: 'platform:page:warehouses' },
  { id: 'locations', route: '/locations', labelAr: 'المواقع المخزنية', group: 'operations', permission: 'platform:page:locations' },
  { id: 'notifications', route: '/notifications', labelAr: 'مركز الإشعارات والتنبيهات', group: 'governance', permission: 'platform:page:notifications' },
  { id: 'scheduled_reports', route: '/scheduled_reports', labelAr: 'التقارير المجدولة', group: 'governance', permission: 'platform:page:scheduled_reports' },
  { id: 'saved_views', route: '/saved_views', labelAr: 'المشاهدات المحفوظة والبحث', group: 'governance', permission: 'platform:page:saved_views' },
  { id: 'collaboration_lineage', route: '/collaboration_lineage', labelAr: 'سجل المحادثات وتتبع السلسلة', group: 'governance', permission: 'platform:page:collaboration_lineage' },
  { id: 'rma_inspections', route: '/rma_inspections', labelAr: 'إدارة المرتجعات والضمان RMA', group: 'commercial', permission: 'platform:page:rma_inspections' },
  { id: 'credit_collections', route: '/credit_collections', labelAr: 'الائتمان والتحصيل', group: 'commercial', permission: 'platform:page:credit_collections' },
  { id: 'sales_commissions', route: '/sales_commissions', labelAr: 'عمولات المبيعات', group: 'commercial', permission: 'platform:page:sales_commissions' },
  { id: 'document_templates', route: '/document_templates', labelAr: 'قوالب المستندات والطباعة', group: 'commercial', permission: 'platform:page:document_templates' },
]);

export class GovernanceBootstrap {
  /**
   * @param {object} deps `{ evaluator, routeCoverage, settings, notifications, approvals, membershipDirectory }`
   */
  constructor(deps = {}) {
    this.evaluator = deps.evaluator;
    this.routeCoverage = deps.routeCoverage || null;
    this.settings = deps.settings || null;
    this.notifications = deps.notifications || null;
    this.approvals = deps.approvals || null;
    this.memberships = deps.membershipDirectory || null;
    this.dialect = deps.dialect || null;
    if (!this.evaluator) throw new BootstrapError('evaluator is required', 'EVALUATOR_REQUIRED');
  }

  /**
   * Build the full client payload for a verified DecisionContext.
   * `pages`/`actions` default to the Octagon catalogue but a caller may pass a
   * module-specific set.
   */
  build(ctx, { pages = DEFAULT_PAGE_CATALOGUE, actions = [], settingsModule = null } = {}) {
    if (!ctx?.actorId) throw new BootstrapError('a verified context is required', 'NO_CONTEXT');

    const visiblePages = [];
    for (const page of pages) {
      const decision = this.evaluator.evaluate({ permission: page.permission, ctx });
      if (decision.allowed) {
        visiblePages.push({ id: page.id, route: page.route, labelAr: page.labelAr, group: page.group });
      }
    }

    const actionMetadata = actions.map((action) => {
      const decision = this.evaluator.evaluate({ permission: action.permission, ctx, entity: action.entity || null });
      return {
        id: action.id,
        entity: action.entity || null,
        enabled: decision.allowed,
        requiresApproval: decision.requiredApproval,
        // A denial reason is a stable code, never a permission token the actor
        // does not hold and never an internal message.
        reasonCode: decision.allowed ? null : decision.reasonCode,
      };
    });

    // Field metadata so generated forms disable rather than silently drop.
    const fieldMetadata = {};
    const roleIds = this.evaluator.effectiveRoleIds(ctx);
    for (const entity of [...new Set(actions.map((a) => a.entity).filter(Boolean))]) {
      const partition = this.evaluator.fieldPartition(entity, roleIds);
      fieldMetadata[entity] = { hidden: partition.hidden, masked: partition.masked, readOnly: partition.denyWrite };
    }

    const locale = ctx.locale || 'ar';
    return {
      version: '2.0.0',
      generatedAt: new Date().toISOString(),
      actor: {
        id: ctx.actorId,
        type: ctx.actorType,
        isOwner: !!ctx.isOwner,
        locale,
        direction: locale === 'ar' ? 'rtl' : 'ltr',
      },
      impersonation: ctx.actorType === 'impersonated'
        ? { active: true, by: ctx.impersonatorId, bannerAr: 'أنت تعمل بالنيابة عن مستخدم آخر' }
        : { active: false },
      scope: {
        tenantId: ctx.tenantId,
        activeCompanyId: ctx.activeCompanyId,
        companyMemberships: this.#companyOptions(ctx),
        activeBranchId: ctx.activeBranchId,
        branchMemberships: ctx.branchMemberships || [],
        operatingScopes: (ctx.operatingScopes || []).map((s) => ({ id: s.id, kind: s.kind, name: s.name })),
      },
      navigation: {
        pages: visiblePages,
        groups: [...new Set(visiblePages.map((p) => p.group))],
        hiddenPageCount: pages.length - visiblePages.length,
      },
      actions: actionMetadata,
      fields: fieldMetadata,
      counters: this.#counters(ctx),
      settings: this.#clientSettings(ctx, settingsModule),
      delegations: (ctx.delegations || []).map((d) => ({ id: d.id, fromUserId: d.fromUserId })),
    };
  }

  #companyOptions(ctx) {
    const ids = ctx.companyMemberships || [];
    if (!this.dialect || !ids.length) return ids.map((id) => ({ id, name: id }));
    const placeholders = ids.map(() => '?').join(',');
    return this.dialect.prepare(`SELECT id, name FROM platform_companies WHERE id IN (${placeholders})`).all(...ids)
      .map((c) => ({ id: c.id, name: c.name }));
  }

  #counters(ctx) {
    const counters = {};
    try { if (this.notifications) counters.unreadNotifications = this.notifications.unreadCount(ctx); } catch { counters.unreadNotifications = 0; }
    try { if (this.approvals) counters.pendingApprovals = this.approvals.worklist('todo', ctx, { limit: 500 }).length; } catch { counters.pendingApprovals = 0; }
    return counters;
  }

  /**
   * Client-visible settings only. A secret-typed setting is returned with a null
   * value and a `secret: true` marker so the UI renders a masked control.
   */
  #clientSettings(ctx, moduleId) {
    if (!this.settings) return {};
    try {
      const all = this.settings.effectiveAll(ctx, { moduleId });
      const out = {};
      for (const [key, value] of Object.entries(all)) {
        out[key] = value.secret ? { key, value: null, secret: true } : { key, value: value.value, source: value.source };
      }
      return out;
    } catch {
      return {};
    }
  }

  /**
   * Deep-link check: the shell calls this before routing so a pasted URL to a
   * forbidden page lands on a denial screen rather than a half-rendered page.
   * The server still enforces independently on every subsequent API call.
   */
  canOpen(ctx, pageId, { pages = DEFAULT_PAGE_CATALOGUE } = {}) {
    const page = pages.find((p) => p.id === pageId || p.route === pageId);
    if (!page) return { allowed: false, reasonCode: 'PAGE_UNKNOWN' };
    const decision = this.evaluator.evaluate({ permission: page.permission, ctx });
    return {
      allowed: decision.allowed,
      reasonCode: decision.allowed ? null : decision.reasonCode,
      messageAr: decision.allowed ? null : decision.message,
    };
  }

  /**
   * Switching the active company re-derives the whole payload from memberships;
   * the client cannot assert a company it is not a member of.
   */
  switchCompany(actorId, companyId, { buildContext }) {
    if (!this.memberships) throw new BootstrapError('membershipDirectory is required', 'MEMBERSHIPS_REQUIRED');
    const scope = this.memberships.resolveActiveScope(actorId, { requestedCompanyId: companyId });
    const freshCtx = buildContext({ requestedCompanyId: scope.companyId });
    return this.build(freshCtx);
  }
}

export function createGovernanceBootstrap(deps) { return new GovernanceBootstrap(deps); }
