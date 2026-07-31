(function (root) {
  'use strict';

  // ---------------------------------------------------------------------
  // Organization Center (`organization_center`) — FP-2D.
  //
  // Governed READ projection over the canonical organization authority via
  // /api/v1/control-plane/{companies,branches,data-scopes,localization}.
  // No second company/branch master is created here.
  // ---------------------------------------------------------------------

  const PAGE_ID = 'organization_center';
  const HOST_ID = 'pageOrganizationCenter';
  const BODY_ID = 'organizationCenterBody';

  const state = {
    loading: false,
    error: null,
    activeTab: 'companies',
    companies: [],
    branches: [],
    scopes: [],
    localization: [],
  };

  function K() { return root.OctagonPageKit; }
  function body() { return document.getElementById(BODY_ID); }

  async function apiQuery(resource) {
    const res = await fetch(`/api/v1/control-plane/${resource}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json.data || [];
  }

  async function loadData() {
    state.loading = true;
    state.error = null;
    const kit = K();
    const b = body();
    if (b && kit) kit.renderState(b, kit.STATES.LOADING, { title: 'جاري تحميل مركز المنظمة...' });

    try {
      const [companies, branches, scopes, localization] = await Promise.all([
        apiQuery('companies'),
        apiQuery('branches'),
        apiQuery('data-scopes'),
        apiQuery('localization'),
      ]);
      state.companies = companies;
      state.branches = branches;
      state.scopes = scopes;
      state.localization = localization;
    } catch (err) {
      state.error = err.message || 'فشل تحميل بيانات المنظمة';
    } finally {
      state.loading = false;
      render();
    }
  }

  function companyName(companyId) {
    const c = state.companies.find((row) => row.id === companyId);
    return c ? c.name : (companyId || '—');
  }

  function renderHeader() {
    const kit = K();
    return kit.renderHeader({
      title: 'مركز المنظمة',
      subtitle: 'الشركات، الفروع، نطاقات التشغيل، وحزم التوطين — من السلطة المرجعية للمنظمة',
      actionsHtml: '',
    });
  }

  function renderTabs() {
    const kit = K();
    return kit.renderTabStrip({
      tabs: [
        { id: 'companies', label: 'الشركات', badge: state.companies.length },
        { id: 'branches', label: 'الفروع', badge: state.branches.length },
        { id: 'scopes', label: 'نطاقات التشغيل', badge: state.scopes.length },
        { id: 'localization', label: 'التوطين', badge: state.localization.length },
      ],
      activeTab: state.activeTab,
      onSelect: 'OctagonOrganizationCenter.switchTab',
    });
  }

  function renderCompaniesTab() {
    const kit = K();
    return kit.renderTable({
      columns: [
        { key: 'id', title: 'المعرف', render: row => kit.bidi(row.id) },
        { key: 'name', title: 'اسم الشركة', render: row => kit.esc(row.name) },
        { key: 'status', title: 'الحالة', render: row => kit.renderStatusBadge(row.status, row.status === 'active' ? 'active' : 'inactive') },
        { key: 'fiscal', title: 'بداية السنة المالية (شهر)', render: row => kit.num(row.fiscal_year_start ?? 1) },
        { key: 'branches', title: 'الفروع', render: row => kit.num(state.branches.filter((b) => b.company_id === row.id).length) },
      ],
      rows: state.companies,
      emptyTitle: 'لا توجد شركات',
      emptySubtitle: 'لم يتم تسجيل أي شركة ضمن هذا المستأجر بعد',
    });
  }

  function renderBranchesTab() {
    const kit = K();
    return kit.renderTable({
      columns: [
        { key: 'id', title: 'المعرف', render: row => kit.bidi(row.id) },
        { key: 'name', title: 'اسم الفرع', render: row => kit.esc(row.name) },
        { key: 'company', title: 'الشركة', render: row => kit.esc(companyName(row.company_id)) },
        { key: 'status', title: 'الحالة', render: row => kit.renderStatusBadge(row.status, row.status === 'active' ? 'active' : 'inactive') },
      ],
      rows: state.branches,
      emptyTitle: 'لا توجد فروع',
      emptySubtitle: 'لم يتم تسجيل أي فرع بعد',
    });
  }

  function renderScopesTab() {
    const kit = K();
    return kit.renderTable({
      columns: [
        { key: 'kind', title: 'نوع النطاق', render: row => kit.bidi(row.kind) },
        { key: 'name', title: 'الاسم', render: row => kit.esc(row.name) },
        { key: 'company', title: 'الشركة', render: row => kit.esc(companyName(row.company_id)) },
        { key: 'status', title: 'الحالة', render: row => kit.renderStatusBadge(row.status, row.status === 'active' ? 'active' : 'inactive') },
      ],
      rows: state.scopes,
      emptyTitle: 'لا توجد نطاقات تشغيل',
      emptySubtitle: 'لم يتم تعريف مستودعات أو مراكز تكلفة أو نطاقات أخرى بعد',
    });
  }

  function renderLocalizationTab() {
    const kit = K();
    return kit.renderTable({
      columns: [
        { key: 'pack', title: 'حزمة التوطين', render: row => kit.bidi(row.pack_code) },
        { key: 'company', title: 'الشركة', render: row => kit.esc(companyName(row.company_id)) },
        { key: 'version', title: 'الإصدار', render: row => kit.bidi(row.version || '—') },
        { key: 'status', title: 'الحالة', render: row => kit.renderStatusBadge(row.status, row.status === 'active' ? 'active' : 'draft') },
        { key: 'legal', title: 'التحقق القانوني', render: row => kit.renderStatusBadge(row.legal_validation_status || 'غير مُقيَّم', row.legal_validation_status === 'validated' ? 'active' : 'warning') },
      ],
      rows: state.localization,
      emptyTitle: 'لا توجد حزم توطين',
      emptySubtitle: 'لم يتم تثبيت أي حزمة توطين مالية بعد',
    });
  }

  function render() {
    const kit = K();
    const b = body();
    if (!b || !kit) return;

    if (state.error) {
      kit.renderState(b, kit.STATES.BACKEND_FAILURE, {
        title: 'تعذر تحميل مركز المنظمة',
        subtitle: state.error,
        onRetry: 'OctagonOrganizationCenter.reload()',
      });
      return;
    }

    let tabContent = '';
    if (state.activeTab === 'companies') tabContent = renderCompaniesTab();
    else if (state.activeTab === 'branches') tabContent = renderBranchesTab();
    else if (state.activeTab === 'scopes') tabContent = renderScopesTab();
    else if (state.activeTab === 'localization') tabContent = renderLocalizationTab();

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
    navId: 'navOrganizationCenter',
    activate,
  });

  root.OctagonOrganizationCenter = {
    reload: loadData,
    switchTab: function (tabId) {
      state.activeTab = tabId;
      render();
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
