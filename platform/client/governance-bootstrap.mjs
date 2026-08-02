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
  { id: 'mdg_center', route: '/mdg_center', labelAr: 'مركز حوكمة البيانات الأساسية MDG', group: 'governance', permission: 'platform:page:mdg_center' },
  { id: 'duplicate_candidates', route: '/duplicate_candidates', labelAr: 'طابور مرشحات السجلات المكررة', group: 'governance', permission: 'platform:page:duplicate_candidates' },
  { id: 'merge_review', route: '/merge_review', labelAr: 'مساحة مراجعة واعتماد الدمج', group: 'governance', permission: 'platform:page:merge_review' },
  { id: 'dq_dashboard', route: '/dq_dashboard', labelAr: 'لوحة قياس جودة البيانات DQM', group: 'governance', permission: 'platform:page:dq_dashboard' },
  { id: 'dq_exceptions', route: '/dq_exceptions', labelAr: 'إدارة استثناءات وأخطاء الجودة', group: 'governance', permission: 'platform:page:dq_exceptions' },
  { id: 'service_contracts', route: '/service_contracts', labelAr: 'Service contracts', group: 'commercial', permission: 'platform:page:service_contracts' },
  { id: 'entitlements', route: '/entitlements', labelAr: 'Entitlements', group: 'commercial', permission: 'platform:page:entitlements' },
  { id: 'electronic_signatures', route: '/electronic_signatures', labelAr: 'Electronic signatures', group: 'governance', permission: 'platform:page:electronic_signatures' },
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

    const grantedPages = [];
    const deniedPages = [];
    for (const page of pages) {
      const decision = this.evaluator.evaluate({ permission: page.permission, ctx });
      if (decision.allowed) {
        grantedPages.push(page);
      } else {
        deniedPages.push({ id: page.id, permission: page.permission, reason: decision.reasonCode });
      }
    }

    const grantedActions = [];
    for (const actionId of actions) {
      const decision = this.evaluator.evaluate({ permission: actionId, ctx });
      if (decision.allowed) {
        grantedActions.push(actionId);
      }
    }

    let unreadCount = 0;
    if (this.notifications) {
      try {
        unreadCount = this.notifications.getUnreadCount(ctx);
      } catch {
        unreadCount = 0;
      }
    }

    let pendingApprovalsCount = 0;
    if (this.approvals) {
      try {
        pendingApprovalsCount = this.approvals.getPendingCount(ctx);
      } catch {
        pendingApprovalsCount = 0;
      }
    }

    let activeCompany = null;
    let availableCompanies = [];
    if (this.memberships) {
      try {
        const userMems = this.memberships.listUserMemberships(ctx.userId);
        availableCompanies = userMems
          .filter(m => m.status === 'active')
          .map(m => ({ companyId: m.companyId, isDefault: m.companyId === ctx.companyId }));
        activeCompany = ctx.companyId;
      } catch {
        activeCompany = ctx.companyId;
      }
    }

    let moduleSettings = {};
    if (this.settings && settingsModule) {
      try {
        moduleSettings = this.settings.listEffective({ moduleId: settingsModule, scope: 'company', scopeId: ctx.companyId });
      } catch {
        moduleSettings = {};
      }
    }

    return {
      success: true,
      context: {
        actorId: ctx.actorId,
        actorType: ctx.actorType,
        userId: ctx.userId,
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        branchId: ctx.branchId,
        correlationId: ctx.correlationId,
      },
      user: {
        id: ctx.userId,
        activeCompany,
        availableCompanies,
      },
      navigation: {
        grantedPages,
        deniedPagesCount: deniedPages.length,
      },
      permissions: {
        actions: grantedActions,
      },
      counters: {
        unreadNotifications: unreadCount,
        pendingApprovals: pendingApprovalsCount,
      },
      settings: moduleSettings,
      meta: {
        builtAt: new Date().toISOString(),
      },
    };
  }
}

export function createGovernanceBootstrap(deps) {
  return new GovernanceBootstrap(deps);
}
