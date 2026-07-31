(function (root) {
  'use strict';

  // ---------------------------------------------------------------------
  // Page 22 — Commercial Control Center (`commercial_control_center`).
  //
  // Governed READ surface over the canonical licensing/entitlement backend
  // (platform_module_licenses + module registry) via /api/v1/control-plane/*.
  //
  // No fake editions, no fabricated usage meters: every number on this page
  // comes from a real query. Allowances that have no backend source (storage,
  // AI quota, API rate) are shown explicitly as `not_supported` — never as
  // invented values. This is not a billing engine (prompt §33).
  // ---------------------------------------------------------------------

  const PAGE_ID = 'commercial_control_center';
  const HOST_ID = 'pageCommercialControlCenter';
  const BODY_ID = 'commercialControlCenterBody';

  const state = {
    loading: false,
    error: null,
    activeTab: 'overview',
    overview: null,
    modules: [],
    licensing: [],
  };

  function K() { return root.OctagonPageKit; }
  function host() { return document.getElementById(HOST_ID); }
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
    if (b && kit) kit.renderState(b, kit.STATES.LOADING, { title: 'جاري تحميل مركز التحكم التجاري والتراخيص...' });

    try {
      const [overview, modules, licensing] = await Promise.all([
        apiQuery('overview'),
        apiQuery('modules'),
        apiQuery('licensing'),
      ]);
      state.overview = Array.isArray(overview) ? (overview[0] || null) : overview;
      state.modules = modules;
      state.licensing = licensing;
    } catch (err) {
      state.error = err.message || 'فشل تحميل بيانات التراخيص والخدمات التجارية';
    } finally {
      state.loading = false;
      render();
    }
  }

  function licensedModuleIds() {
    return new Set(state.licensing.map((row) => row.module_id));
  }

  function moduleName(moduleId) {
    const mod = state.modules.find((row) => row.id === moduleId);
    return mod ? (mod.name || mod.id) : moduleId;
  }

  function renderHeader() {
    const kit = K();
    return kit.renderHeader({
      title: 'مركز التحكم التجاري والتراخيص',
      subtitle: 'استحقاقات التراخيص، حالة الوحدات، وحدود الاستخدام الفعلية — بيانات حقيقية من السجل المرجعي',
      actionsHtml: '',
    });
  }

  function renderTabs() {
    const kit = K();
    return kit.renderTabStrip({
      tabs: [
        { id: 'overview', label: 'نظرة عامة والاستخدام' },
        { id: 'entitlements', label: 'حقوق الاستخدام والتراخيص', badge: state.licensing.length },
        { id: 'unlicensed', label: 'وحدات بلا ترخيص', badge: state.modules.filter((m) => !licensedModuleIds().has(m.id)).length },
      ],
      activeTab: state.activeTab,
      onSelect: 'OctagonCommercialControlCenter.switchTab',
    });
  }

  function renderOverviewTab() {
    const kit = K();
    const ov = state.overview || {};
    const licensed = licensedModuleIds();
    const cards = [
      { title: 'الشركات', value: kit.num(ov.companies ?? 0), subtitle: 'شركة مسجلة ضمن المستأجر', status: 'active' },
      { title: 'الفروع', value: kit.num(ov.branches ?? 0), subtitle: 'فرع ضمن نطاق الشركات', status: 'active' },
      { title: 'المستخدمون (المقاعد المستهلكة)', value: kit.num(ov.users ?? 0), subtitle: 'مستخدم فعلي في سجل الهوية', status: 'active' },
      { title: 'الوحدات المرخصة', value: `${kit.num(licensed.size)} / ${kit.num(state.modules.length)}`, subtitle: 'وحدات لها سجل ترخيص فعال', status: licensed.size ? 'active' : 'warning' },
      { title: 'الوحدات المفعلة', value: kit.num(ov.enabled_modules ?? 0), subtitle: `غير السليمة: ${kit.num(ov.unhealthy_modules ?? 0)}`, status: ov.unhealthy_modules ? 'warning' : 'active' },
    ].map((card) => kit.renderKpiCard(card)).join('');

    // Prompt §33 lists storage / AI / API allowances. No canonical backend
    // meters exist for these yet — render them honestly as not_supported
    // instead of fabricating numbers.
    const unsupported = [
      'حدود التخزين (Storage Limits)',
      'حصص الذكاء الاصطناعي (AI Allowances)',
      'حدود واجهة البرمجة (API Limits)',
      'فترات السماح والتجارب (Grace / Trials)',
    ].map((label) => `
      <div class="flex items-center justify-between rounded-lg border border-dashed border-slate-300 px-4 py-3">
        <span class="text-sm text-slate-600">${label}</span>
        ${kit.renderStatusBadge('not_supported', 'draft')}
      </div>
    `).join('');

    return `
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        ${cards}
      </div>
      <div class="space-y-2">
        <h3 class="text-sm font-semibold text-slate-500">عدادات غير مدعومة خلفياً بعد</h3>
        ${unsupported}
      </div>
    `;
  }

  function renderEntitlementsTab() {
    const kit = K();
    return kit.renderTable({
      columns: [
        { key: 'module', title: 'الوحدة', render: row => kit.esc(moduleName(row.module_id)) },
        { key: 'module_id', title: 'معرف الوحدة', render: row => kit.bidi(row.module_id) },
        { key: 'company', title: 'الشركة', render: row => kit.bidi(row.company_id) },
        { key: 'plan', title: 'الباقة', render: row => kit.esc(row.plan || '—') },
        { key: 'seats', title: 'المقاعد', render: row => kit.num(row.seats ?? 0) },
        { key: 'valid', title: 'الصلاحية', render: row => kit.bidi(`${row.valid_from || '…'} → ${row.valid_until || 'مفتوحة'}`) },
        { key: 'status', title: 'الحالة', render: row => kit.renderStatusBadge(row.package_status || 'licensed', row.package_status === 'active' || !row.package_status ? 'active' : 'warning') },
      ],
      rows: state.licensing,
      emptyTitle: 'لا توجد تراخيص مسجلة',
      emptySubtitle: 'لم يتم إصدار أي ترخيص وحدات لهذه الشركات بعد',
    });
  }

  function renderUnlicensedTab() {
    const kit = K();
    const licensed = licensedModuleIds();
    const rows = state.modules.filter((mod) => !licensed.has(mod.id));
    return kit.renderTable({
      columns: [
        { key: 'id', title: 'معرف الوحدة', render: row => kit.bidi(row.id) },
        { key: 'name', title: 'اسم الوحدة', render: row => kit.esc(row.name || row.id) },
        { key: 'kind', title: 'النوع', render: row => kit.bidi(row.kind || '—') },
        { key: 'status', title: 'حالة التثبيت', render: row => kit.renderStatusBadge(row.status, row.status === 'enabled' ? 'active' : 'inactive') },
        { key: 'license', title: 'الترخيص', render: () => kit.renderStatusBadge('بلا ترخيص', 'warning') },
      ],
      rows,
      emptyTitle: 'كل الوحدات مرخصة',
      emptySubtitle: 'جميع الوحدات المسجلة تمتلك سجلات ترخيص فعالة',
    });
  }

  function render() {
    const kit = K();
    const b = body();
    if (!b || !kit) return;

    if (state.error) {
      kit.renderState(b, kit.STATES.BACKEND_FAILURE, {
        title: 'تعذر تحميل مركز التحكم التجاري',
        subtitle: state.error,
        onRetry: 'OctagonCommercialControlCenter.reload()',
      });
      return;
    }

    let tabContent = '';
    if (state.activeTab === 'overview') tabContent = renderOverviewTab();
    else if (state.activeTab === 'entitlements') tabContent = renderEntitlementsTab();
    else if (state.activeTab === 'unlicensed') tabContent = renderUnlicensedTab();

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

  // Mount into the original shell through the shared helper (the same literal
  // call enterprise_home/my_work/unified_inbox use): permission gate, async
  // template wait, page/nav activation, nav-group opening.
  root.OctagonPageKit.wirePage({
    pageId: PAGE_ID,
    sectionId: HOST_ID,
    navId: 'navCommercialControlCenter',
    activate,
  });

  root.OctagonCommercialControlCenter = {
    reload: loadData,
    switchTab: function (tabId) {
      state.activeTab = tabId;
      render();
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
