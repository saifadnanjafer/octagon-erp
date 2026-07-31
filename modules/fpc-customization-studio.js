(function (root) {
  'use strict';

  // ---------------------------------------------------------------------
  // Page 16 — Customization Studio (`customization_studio`).
  //
  // Governed READ surface over the canonical ConfigurationAuthority tables
  // (platform/configuration/index.mjs) via /api/v1/control-plane/*.
  //
  // No fake arrays, no local mutations: there is currently no registered
  // ActionExecutor action for custom-field/view-schema/saved-view writes, so
  // this page renders real data only. Mutation buttons stay absent until a
  // canonical action is wired (tracked in unresolved-risks).
  // ---------------------------------------------------------------------

  const PAGE_ID = 'customization_studio';
  const HOST_ID = 'pageCustomizationStudio';
  const BODY_ID = 'customizationStudioBody';

  const state = {
    loading: false,
    error: null,
    activeTab: 'fields',
    customFields: [],
    viewSchemas: [],
    savedViews: [],
    packages: [],
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
    if (b && kit) kit.renderState(b, kit.STATES.LOADING, { title: 'جاري تحميل استوديو التخصيص...' });

    try {
      const [customFields, viewSchemas, savedViews, packages] = await Promise.all([
        apiQuery('custom-fields'),
        apiQuery('view-schemas'),
        apiQuery('saved-views'),
        apiQuery('packages'),
      ]);
      state.customFields = customFields;
      state.viewSchemas = viewSchemas;
      state.savedViews = savedViews;
      state.packages = packages;
    } catch (err) {
      state.error = err.message || 'فشل تحميل بيانات التخصيص';
    } finally {
      state.loading = false;
      render();
    }
  }

  function renderHeader() {
    const kit = K();
    return kit.renderHeader({
      title: 'استوديو التخصيص والتصميم',
      subtitle: 'الحقول المخصصة، مخططات العرض، العروض المحفوظة، وحزم التهيئة — قراءة محكومة من السلطة المرجعية',
      actionsHtml: '',
    });
  }

  function renderTabs() {
    const kit = K();
    return kit.renderTabStrip({
      tabs: [
        { id: 'fields', label: 'الحقول المخصصة', badge: state.customFields.length },
        { id: 'layouts', label: 'مخططات العرض', badge: state.viewSchemas.length },
        { id: 'views', label: 'العروض المحفوظة', badge: state.savedViews.length },
        { id: 'packages', label: 'حزم التهيئة', badge: state.packages.length },
      ],
      activeTab: state.activeTab,
      onSelect: 'OctagonCustomizationStudio.switchTab',
    });
  }

  function renderFieldsTab() {
    const kit = K();
    return kit.renderTable({
      columns: [
        { key: 'entity', title: 'الكيان', render: row => kit.bidi(row.entity) },
        { key: 'field', title: 'معرف الحقل', render: row => kit.bidi(row.field) },
        { key: 'label', title: 'اسم الحقل', render: row => kit.esc(row.label_ar || row.label_en || row.field) },
        { key: 'type', title: 'نوع البيانات', render: row => kit.bidi(row.data_type) },
        { key: 'required', title: 'إلزامي', render: row => kit.renderStatusBadge(row.required ? 'إلزامي' : 'اختياري', row.required ? 'warning' : 'draft') },
        { key: 'scope', title: 'النطاق', render: row => kit.bidi(row.company_id || row.tenant_id || '*') },
      ],
      rows: state.customFields,
      emptyTitle: 'لا توجد حقول مخصصة',
      emptySubtitle: 'لم يتم تعريف أي حقل مخصص بعد عبر سلطة التهيئة المرجعية',
    });
  }

  function renderLayoutsTab() {
    const kit = K();
    return kit.renderTable({
      columns: [
        { key: 'entity', title: 'الكيان', render: row => kit.bidi(row.entity) },
        { key: 'kind', title: 'نوع المخطط', render: row => kit.bidi(row.kind) },
        { key: 'name', title: 'اسم المخطط', render: row => kit.esc(row.name) },
        { key: 'version', title: 'الإصدار', render: row => kit.num(row.version) },
        { key: 'status', title: 'الحالة', render: row => kit.renderStatusBadge(row.status === 'active' ? 'نشط' : row.status, row.status === 'active' ? 'active' : 'inactive') },
      ],
      rows: state.viewSchemas,
      emptyTitle: 'لا توجد مخططات عرض مخصصة',
      emptySubtitle: 'لم يتم تعريف أي مخطط عرض (نموذج/قائمة) بعد',
    });
  }

  function renderViewsTab() {
    const kit = K();
    return kit.renderTable({
      columns: [
        { key: 'entity', title: 'الكيان/الصفحة', render: row => kit.bidi(row.entity) },
        { key: 'name', title: 'عنوان العرض المحفوظ', render: row => kit.esc(row.name) },
        { key: 'owner', title: 'المالك', render: row => kit.bidi(row.owner_id || '—') },
        { key: 'shared', title: 'المشاركة', render: row => kit.renderStatusBadge(row.shared ? 'مشترك' : 'خاص', row.shared ? 'active' : 'draft') },
      ],
      rows: state.savedViews,
      emptyTitle: 'لا توجد عروض محفوظة',
      emptySubtitle: 'لم يتم حفظ أي عرض مخصص بعد',
    });
  }

  function renderPackagesTab() {
    const kit = K();
    return kit.renderTable({
      columns: [
        { key: 'name', title: 'اسم الحزمة', render: row => kit.esc(row.name) },
        { key: 'version', title: 'الإصدار', render: row => kit.bidi(row.version || '—') },
        { key: 'status', title: 'الحالة', render: row => kit.renderStatusBadge(row.status, row.status === 'applied' ? 'active' : row.status === 'failed' ? 'blocked' : 'draft') },
        { key: 'created_at', title: 'تاريخ الإنشاء', render: row => kit.bidi(row.created_at || '—') },
        { key: 'applied_at', title: 'تاريخ التطبيق', render: row => kit.bidi(row.applied_at || '—') },
      ],
      rows: state.packages,
      emptyTitle: 'لا توجد حزم تهيئة',
      emptySubtitle: 'لم يتم بناء أو تطبيق أي حزمة تهيئة بعد',
    });
  }

  function render() {
    const kit = K();
    const b = body();
    if (!b || !kit) return;

    if (state.error) {
      kit.renderState(b, kit.STATES.BACKEND_FAILURE, {
        title: 'تعذر تحميل استوديو التخصيص',
        subtitle: state.error,
        onRetry: 'OctagonCustomizationStudio.reload()',
      });
      return;
    }

    let tabContent = '';
    if (state.activeTab === 'fields') tabContent = renderFieldsTab();
    else if (state.activeTab === 'layouts') tabContent = renderLayoutsTab();
    else if (state.activeTab === 'views') tabContent = renderViewsTab();
    else if (state.activeTab === 'packages') tabContent = renderPackagesTab();

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
    navId: 'navCustomizationStudio',
    activate,
  });

  root.OctagonCustomizationStudio = {
    reload: loadData,
    switchTab: function (tabId) {
      state.activeTab = tabId;
      render();
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
