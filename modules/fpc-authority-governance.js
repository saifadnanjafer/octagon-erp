(function (root) {
  'use strict';

  // ---------------------------------------------------------------------
  // Authority Governance (`authority_governance`) — FP-2E.
  //
  // Governed READ projection over the canonical policy engine via the
  // governance query dispatch (/api/v1/policy/*): delegations, authority
  // limits, segregation-of-duties rules, and conflict/coverage reports.
  // Uses the governance wiring completed in 0c3c005 — no second engine.
  // ---------------------------------------------------------------------

  const PAGE_ID = 'authority_governance';
  const HOST_ID = 'pageAuthorityGovernance';
  const BODY_ID = 'authorityGovernanceBody';

  const state = {
    loading: false,
    error: null,
    activeTab: 'delegations',
    delegations: [],
    limits: [],
    sodRules: [],
    conflictReport: null,
  };

  function K() { return root.OctagonPageKit; }
  function body() { return document.getElementById(BODY_ID); }

  async function apiQuery(path) {
    const res = await fetch(`/api/v1/${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error.message || json.error);
    return json.data || [];
  }

  async function loadData() {
    state.loading = true;
    state.error = null;
    const kit = K();
    const b = body();
    if (b && kit) kit.renderState(b, kit.STATES.LOADING, { title: 'جاري تحميل حوكمة الصلاحيات...' });

    try {
      const [delegations, limits, sodRules, conflictReport] = await Promise.all([
        apiQuery('policy/delegations'),
        apiQuery('policy/authority-limits'),
        apiQuery('policy/sod-rules'),
        apiQuery('policy/conflict-report'),
      ]);
      state.delegations = delegations;
      state.limits = limits;
      state.sodRules = sodRules;
      state.conflictReport = conflictReport;
    } catch (err) {
      state.error = err.message || 'فشل تحميل بيانات الحوكمة';
    } finally {
      state.loading = false;
      render();
    }
  }

  function renderHeader() {
    const kit = K();
    return kit.renderHeader({
      title: 'حوكمة الصلاحيات والتفويض',
      subtitle: 'التفويضات، حدود الصلاحية، الفصل بين المهام، وتقارير التعارض — من محرك السياسات المرجعي',
      actionsHtml: '',
    });
  }

  function renderTabs() {
    const kit = K();
    const conflicts = state.conflictReport && Array.isArray(state.conflictReport.conflicts)
      ? state.conflictReport.conflicts.length : 0;
    return kit.renderTabStrip({
      tabs: [
        { id: 'delegations', label: 'التفويضات', badge: state.delegations.length },
        { id: 'limits', label: 'حدود الصلاحية', badge: state.limits.length },
        { id: 'sod', label: 'الفصل بين المهام', badge: state.sodRules.length },
        { id: 'conflicts', label: 'التعارضات', badge: conflicts },
      ],
      activeTab: state.activeTab,
      onSelect: 'OctagonAuthorityGovernance.switchTab',
    });
  }

  function renderDelegationsTab() {
    const kit = K();
    return kit.renderTable({
      columns: [
        { key: 'from', title: 'المُفوِّض', render: row => kit.bidi(row.from_user_id) },
        { key: 'to', title: 'المُفوَّض إليه', render: row => kit.bidi(row.to_user_id) },
        { key: 'scope', title: 'النطاق', render: row => kit.bidi(row.scope || row.permission || '—') },
        { key: 'company', title: 'الشركة', render: row => kit.bidi(row.company_id || 'الكل') },
        { key: 'valid', title: 'الصلاحية', render: row => kit.bidi(`${row.valid_from || '…'} → ${row.valid_until || 'مفتوحة'}`) },
        { key: 'status', title: 'الحالة', render: row => kit.renderStatusBadge(row.status || 'نشط', (row.status || 'active') === 'active' ? 'active' : 'inactive') },
      ],
      rows: state.delegations,
      emptyTitle: 'لا توجد تفويضات',
      emptySubtitle: 'لم يتم إنشاء أي تفويض صلاحية بعد',
    });
  }

  function renderLimitsTab() {
    const kit = K();
    return kit.renderTable({
      columns: [
        { key: 'permission', title: 'الصلاحية', render: row => kit.bidi(row.permission || row.permission_id || '—') },
        { key: 'role', title: 'الدور', render: row => kit.bidi(row.role_id || '—') },
        { key: 'max_amount', title: 'الحد الأقصى', render: row => row.max_amount == null ? '—' : kit.num(row.max_amount) },
        { key: 'company', title: 'الشركة', render: row => kit.bidi(row.company_id || 'الكل') },
        { key: 'status', title: 'الحالة', render: row => kit.renderStatusBadge(row.status || 'نشط', (row.status || 'active') === 'active' ? 'active' : 'inactive') },
      ],
      rows: state.limits,
      emptyTitle: 'لا توجد حدود صلاحية',
      emptySubtitle: 'لم يتم تعريف حدود مالية أو كمية بعد',
    });
  }

  function renderSodTab() {
    const kit = K();
    return kit.renderTable({
      columns: [
        { key: 'id', title: 'القاعدة', render: row => kit.bidi(row.id) },
        { key: 'first', title: 'الصلاحية الأولى', render: row => kit.bidi(row.permission_a || row.first_permission || '—') },
        { key: 'second', title: 'الصلاحية المتعارضة', render: row => kit.bidi(row.permission_b || row.second_permission || '—') },
        { key: 'severity', title: 'الخطورة', render: row => kit.renderStatusBadge(row.severity || 'عالية', row.severity === 'low' ? 'draft' : 'warning') },
      ],
      rows: state.sodRules,
      emptyTitle: 'لا توجد قواعد فصل مهام',
      emptySubtitle: 'لم يتم تسجيل قواعد فصل بين المهام بعد',
    });
  }

  function renderConflictsTab() {
    const kit = K();
    const report = state.conflictReport;
    if (!report) {
      return kit.renderState(body(), kit.STATES.NOT_AVAILABLE, {
        title: 'تقرير التعارضات غير متاح',
        subtitle: 'لم يُرجع محرك السياسات تقريراً',
      });
    }
    const conflicts = Array.isArray(report.conflicts) ? report.conflicts : [];
    if (!conflicts.length) {
      return `
        <div class="rounded-lg border border-emerald-300 bg-emerald-50 p-6 text-center">
          ${kit.renderStatusBadge('لا توجد تعارضات نشطة', 'active')}
          <p class="mt-2 text-sm text-slate-600">فحص محرك السياسات المرجعي لم يجد تعارضات فصل مهام قائمة.</p>
        </div>
      `;
    }
    return kit.renderTable({
      columns: [
        { key: 'user', title: 'المستخدم', render: row => kit.bidi(row.user_id || row.actor_id || '—') },
        { key: 'rule', title: 'القاعدة', render: row => kit.bidi(row.rule_id || '—') },
        { key: 'detail', title: 'التفصيل', render: row => kit.esc(row.detail || row.message || JSON.stringify(row)) },
      ],
      rows: conflicts,
      emptyTitle: 'لا توجد تعارضات',
    });
  }

  function render() {
    const kit = K();
    const b = body();
    if (!b || !kit) return;

    if (state.error) {
      kit.renderState(b, kit.STATES.BACKEND_FAILURE, {
        title: 'تعذر تحميل حوكمة الصلاحيات',
        subtitle: state.error,
        onRetry: 'OctagonAuthorityGovernance.reload()',
      });
      return;
    }

    let tabContent = '';
    if (state.activeTab === 'delegations') tabContent = renderDelegationsTab();
    else if (state.activeTab === 'limits') tabContent = renderLimitsTab();
    else if (state.activeTab === 'sod') tabContent = renderSodTab();
    else if (state.activeTab === 'conflicts') tabContent = renderConflictsTab();

    b.innerHTML = `
      ${renderHeader()}
      ${renderTabs()}
      <div class="mt-4">
        ${tabContent}
      </div>
    `;
  }

  function activate() {
    loadData();
  }

  root.OctagonPageKit.wirePage({
    pageId: PAGE_ID,
    sectionId: HOST_ID,
    navId: 'navAuthorityGovernance',
    activate,
  });

  root.OctagonAuthorityGovernance = {
    reload: loadData,
    switchTab: function (tabId) {
      state.activeTab = tabId;
      render();
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
