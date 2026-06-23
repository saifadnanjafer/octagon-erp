(function () {
  'use strict';

  const root = window;
  const services = root.PentagonServices || {};
  root.PentagonServices = services;

  const GROUPS = {
    'system.admin': { implies: ['workshop.manager', 'finance.manager'] },
    'workshop.manager': { implies: ['workshop.user'] },
    'finance.manager': { implies: ['finance.user'] },
    'workshop.user': { implies: [] },
    'finance.user': { implies: [] },
  };

  const MODEL_PERMISSIONS = {
    employees: { read: ['workshop.user'], create: ['workshop.manager'], update: ['workshop.manager'], delete: ['system.admin'] },
    'omni.materials': { read: ['workshop.user'], create: ['workshop.manager'], update: ['workshop.manager'], delete: ['system.admin'] },
    'omni.suppliers': { read: ['workshop.user'], create: ['workshop.manager'], update: ['workshop.manager'], delete: ['system.admin'] },
    'omni.machines': { read: ['workshop.user'], create: ['workshop.manager'], update: ['workshop.manager'], delete: ['system.admin'] },
    'omni.equipment': { read: ['workshop.user'], create: ['workshop.manager'], update: ['workshop.manager'], delete: ['system.admin'] },
    'finance.transactions': { read: ['finance.user'], create: ['finance.user'], update: ['finance.manager'], delete: ['system.admin'] },
    account_moves: { read: ['finance.user'], create: ['finance.user'], update: ['finance.manager'], delete: ['system.admin'] },
    account_payments: { read: ['finance.user'], create: ['finance.manager'], update: ['finance.manager'], delete: ['system.admin'] },
    account_partial_reconciles: { read: ['finance.user'], create: ['finance.manager'], update: ['finance.manager'], delete: ['system.admin'] },
    'finance.accounts': { read: ['finance.user'], create: ['system.admin'], update: ['system.admin'], delete: ['system.admin'] },
    'omni.banking': { read: ['finance.user'], create: ['finance.user'], update: ['finance.user'], delete: ['finance.manager'] },
    'omni.locationStock': { read: ['workshop.user'], create: ['workshop.manager'], update: ['workshop.manager'], delete: ['system.admin'] },
    journal_entries: { read: ['finance.user'], create: ['finance.user'], update: ['finance.manager'], delete: ['system.admin'] },
    stock_moves: { read: ['workshop.user'], create: ['workshop.manager'], update: ['workshop.manager'], delete: ['system.admin'] },
  };

  const ACTION_PERMISSIONS = {
    'banking.reconciliation.create': ['finance.user'],
    'banking.reconciliation.match': ['finance.user'],
    'banking.reconciliation.unmatch': ['finance.user'],
    'banking.reconciliation.finalize': ['finance.manager'],
    'banking.reconciliation.adjustment_request': ['finance.user'],
    'inventory.location.create': ['workshop.manager'],
    'inventory.location.transfer': ['workshop.user'],
    'inventory.location.adjust': ['workshop.manager'],
    'inventory.location.issue': ['workshop.user'],
    'inventory.location.receive': ['workshop.user'],
    'accounting.coa.create': ['finance.manager'],
    'accounting.coa.edit_safe': ['finance.manager'],
    'accounting.coa.edit_used': ['system.admin'],
    'accounting.coa.deactivate': ['finance.manager'],
    'accounting.coa.deactivate_used': ['system.admin'],
    'risk_compliance.write': ['workshop.manager', 'finance.manager'],
  };

  const ACTION_METADATA = {
    'banking.reconciliation.create': { page: 'banking', module: 'phase6a_core', riskLevel: 'medium', label: 'اضافة سطر كشف بنكي' },
    'banking.reconciliation.match': { page: 'banking', module: 'phase6a_core', riskLevel: 'medium', label: 'مطابقة سطر بنكي' },
    'banking.reconciliation.unmatch': { page: 'banking', module: 'phase6a_core', riskLevel: 'medium', label: 'الغاء مطابقة بنكية' },
    'banking.reconciliation.finalize': { page: 'banking', module: 'phase6a_core', riskLevel: 'high', approvalRequired: true, label: 'اعتماد تسوية بنكية نهائية' },
    'banking.reconciliation.adjustment_request': { page: 'banking', module: 'phase6a_core', riskLevel: 'high', approvalRequired: true, label: 'طلب تسوية فرق بنكي' },
    'banking.reconciliation.legacy_finance_movement': { page: 'banking', module: 'phase6a_core', riskLevel: 'critical', approvalRequired: true, label: 'انشاء حركة مالية مباشرة من البنك' },
    'inventory.location.create': { page: 'inventory', module: 'phase6a_core', riskLevel: 'medium', label: 'انشاء موقع تخزين' },
    'inventory.location.transfer': { page: 'inventory', module: 'phase6a_core', riskLevel: 'medium', label: 'تحويل مخزون بين مواقع' },
    'inventory.location.adjust': { page: 'inventory', module: 'phase6a_core', riskLevel: 'high', approvalRequired: true, label: 'تسوية كمية موقعية' },
    'inventory.location.issue': { page: 'inventory', module: 'phase6a_core', riskLevel: 'medium', label: 'صرف مخزون من موقع' },
    'inventory.location.receive': { page: 'inventory', module: 'phase6a_core', riskLevel: 'medium', label: 'استلام مخزون في موقع' },
    'inventory.location.negative_issue': { page: 'inventory', module: 'phase6a_core', riskLevel: 'critical', approvalRequired: true, label: 'صرف مخزون سالب' },
    'inventory.location.delete_with_stock': { page: 'inventory', module: 'phase6a_core', riskLevel: 'critical', label: 'حذف موقع عليه رصيد او حركة' },
    'accounting.coa.create': { page: 'admin_panel', module: 'phase6a_core', riskLevel: 'medium', label: 'انشاء حساب دليل حسابات' },
    'accounting.coa.edit_safe': { page: 'admin_panel', module: 'phase6a_core', riskLevel: 'medium', label: 'تعديل بيانات حساب غير مستخدم' },
    'accounting.coa.edit_used': { page: 'admin_panel', module: 'phase6a_core', riskLevel: 'critical', approvalRequired: true, label: 'تعديل حساب مستخدم في قيود' },
    'accounting.coa.deactivate': { page: 'admin_panel', module: 'phase6a_core', riskLevel: 'high', label: 'تعطيل حساب غير مستخدم' },
    'accounting.coa.deactivate_used': { page: 'admin_panel', module: 'phase6a_core', riskLevel: 'critical', approvalRequired: true, label: 'تعطيل حساب مستخدم' },
    'accounting.coa.delete_used': { page: 'admin_panel', module: 'phase6a_core', riskLevel: 'critical', label: 'حذف حساب مستخدم' },
    'finance.direct_posting.external': { page: 'finance', module: 'finance', riskLevel: 'critical', approvalRequired: true, label: 'ترحيل مالي مباشر من مصدر خارجي' },
    'risk_compliance.write': { page: 'risk_compliance', module: 'risk_compliance', riskLevel: 'high', label: 'كتابة سجل مخاطر او رقابة' },
    'risk_compliance.delete': { page: 'risk_compliance', module: 'risk_compliance', riskLevel: 'critical', label: 'حذف سجل مخاطر او رقابة' },
    'ai.high_risk_write': { page: 'intelligence', module: 'jarvis', riskLevel: 'critical', approvalRequired: true, label: 'كتابة عالية الخطورة عبر الذكاء' },
  };

  const SENSITIVE_FIELDS = {
    employees: {
      salary: ['workshop.manager', 'finance.user'],
      baseSalary: ['workshop.manager', 'finance.user'],
      nominalSalary: ['workshop.manager', 'finance.user'],
      prevAdvance: ['workshop.manager', 'finance.user'],
      advance: ['workshop.manager', 'finance.user'],
      bonus: ['workshop.manager', 'finance.user'],
      damage: ['workshop.manager', 'finance.user'],
      penalty: ['workshop.manager', 'finance.user'],
    },
    'finance.transactions': {
      amount: ['finance.user'],
    },
    journal_entries: {
      debit: ['finance.user'],
      credit: ['finance.user'],
    },
    account_moves: {
      debit: ['finance.user'],
      credit: ['finance.user'],
    }
  };
  
  const PAGE_PERMISSIONS = {
    finance: ['finance.user'],
    cashbox: ['finance.user'],
    expenses: ['finance.user'],
    income: ['finance.user'],
    customers: ['finance.user'],
    receipt: ['finance.user'],
    report: ['finance.user'],
    inventory: ['workshop.user'],
    employees: ['workshop.user'],
    workflow: ['workshop.user'],
    kanban: ['workshop.user'],
    machines: ['workshop.user'],
    equipment: ['workshop.user'],
    op_packs: ['workshop.user'],
    task_manager: ['workshop.user'],
    sop: ['workshop.user'],
    qc_center: ['workshop.user'],
    sales: ['workshop.user', 'finance.user'],
    command_center: ['workshop.manager', 'finance.manager'],
    analytics: ['workshop.manager', 'finance.manager'],
    nl_reports: ['workshop.manager', 'finance.manager'],
    intelligence: ['workshop.manager', 'finance.manager'],
    whatsapp: ['workshop.manager', 'finance.manager'],
    automation: ['system.admin'],
    tax_compliance: ['finance.manager', 'system.admin'],
    risk_compliance: ['workshop.manager', 'finance.manager'],
    banking: ['finance.user'],
    admin_panel: ['system.admin'],
    settings: ['system.admin'],
    customer_portal: [],
  };

  function expandGroups(groups) {
    const resolved = new Set(groups || []);
    let changed = true;
    while (changed) {
      changed = false;
      [...resolved].forEach(group => {
        (GROUPS[group]?.implies || []).forEach(implied => {
          if (!resolved.has(implied)) {
            resolved.add(implied);
            changed = true;
          }
        });
      });
    }
    return [...resolved];
  }

  const PermissionService = {
    groups: GROUPS,
    modelPermissions: MODEL_PERMISSIONS,
    actionPermissions: ACTION_PERMISSIONS,
    actionMetadata: ACTION_METADATA,
    pagePermissions: PAGE_PERMISSIONS,

    resolveGroups(user = root.PentagonAuth.getCurrentUser()) {
      return expandGroups(user?.groups || []);
    },

    checkPage(page, user = root.PentagonAuth.getCurrentUser()) {
      const userGroups = this.resolveGroups(user);
      if (root.OCTAGON_DEBUG_PERMISSIONS || root.PENTAGON_DEBUG_PERMISSIONS) {
        console.debug(`Permission: Checking page "${page}" for user "${user?.id}" with groups:`, userGroups);
      }
      if (userGroups.includes('system.admin')) return true;
      const allowedGroups = this.pagePermissions[page] || [];
      if (!allowedGroups.length) return true;
      const result = allowedGroups.some(group => userGroups.includes(group));
      if (root.OCTAGON_DEBUG_PERMISSIONS || root.PENTAGON_DEBUG_PERMISSIONS) {
        console.debug(`Permission: Page "${page}" access: ${result}`);
      }
      return result;
    },

    check(collection, action, user = root.PentagonAuth.getCurrentUser()) {
      const userGroups = this.resolveGroups(user);
      if (userGroups.includes('system.admin')) return true;
      const allowedGroups = this.modelPermissions[collection]?.[action] || [];
      if (!allowedGroups.length) return true;
      return allowedGroups.some(group => userGroups.includes(group));
    },

    checkAction(actionKey, context = {}, user = root.PentagonAuth.getCurrentUser()) {
      const explained = this.explainAction(actionKey, context, user);
      return explained.allowed === true;
    },

    explainAction(actionKey, context = {}, userOrRole = root.PentagonAuth.getCurrentUser()) {
      let user = userOrRole || {};
      if (typeof userOrRole === 'string') {
        user = { id: userOrRole, name: userOrRole, groups: [userOrRole] };
      }
      const mapped = Object.prototype.hasOwnProperty.call(this.actionPermissions, actionKey);
      const meta = { ...(this.actionMetadata[actionKey] || {}), ...(context?.riskLevel ? { riskLevel: context.riskLevel } : {}) };
      const riskLevel = meta.riskLevel || 'low';
      const highRisk = ['high', 'critical'].includes(riskLevel);
      const allowedGroups = mapped ? (this.actionPermissions[actionKey] || []) : [];
      const userGroups = this.resolveGroups(user);
      const systemAdmin = userGroups.includes('system.admin');
      const directAllowed = systemAdmin || (mapped && allowedGroups.some(group => userGroups.includes(group)));
      let outcome = directAllowed ? 'allowed' : 'blocked';
      let reason = directAllowed ? 'explicit_permission_match' : 'missing_required_permission';

      if (!mapped && highRisk) {
        outcome = meta.approvalRequired ? 'approval_required' : 'blocked';
        reason = meta.approvalRequired ? 'high_risk_unmapped_approval_required' : 'high_risk_unmapped_default_deny';
      } else if (!mapped) {
        outcome = 'allowed';
        reason = 'local_dev_unmapped_default_allow';
      } else if (!directAllowed && meta.approvalRequired) {
        outcome = 'approval_required';
        reason = 'approval_required_for_sensitive_action';
      }

      return {
        actionKey,
        label: meta.label || actionKey,
        page: meta.page || context?.page || '',
        module: meta.module || context?.module || '',
        mapped,
        allowedGroups,
        userId: user?.id || '',
        userName: user?.name || user?.id || '',
        userGroups,
        riskLevel,
        approvalRequired: !!meta.approvalRequired || outcome === 'approval_required',
        defaultPolicy: (!mapped && highRisk) ? 'deny_high_risk_unmapped' : (!mapped ? 'allow_local_dev_unmapped' : 'explicit'),
        outcome,
        allowed: outcome === 'allowed',
        reason,
      };
    },

    requireAction(actionKey, context = {}, user) {
      if (!this.checkAction(actionKey, context, user)) {
        throw new Error(`هذا الإجراء يحتاج صلاحية مدير. [${actionKey}]`);
      }
      return true;
    },

    checkField(collection, field, user = root.PentagonAuth.getCurrentUser()) {
      const userGroups = this.resolveGroups(user);
      if (userGroups.includes('system.admin')) return true;
      const allowedGroups = SENSITIVE_FIELDS[collection]?.[field] || [];
      if (!allowedGroups.length) return true; // Not sensitive
      return allowedGroups.some(group => userGroups.includes(group));
    },

    require(collection, action, user) {
      if (!this.check(collection, action, user)) {
        throw new Error(`⚠️ عذراً، لا تمتلك صلاحية [${action}] على [${collection}]`);
      }
      return true;
    },
  };

  root.PermissionService = PermissionService;
  services.permission = PermissionService;
})();
