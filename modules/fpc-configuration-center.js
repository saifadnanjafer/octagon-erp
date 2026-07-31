(function (root) {
  'use strict';

  // ---------------------------------------------------------------------
  // Configuration Center (`configuration_center`) — FP-2F.
  //
  // Governed READ projection over the canonical settings/sequences/feature-
  // flag backend via /api/v1/control-plane/*. The settings resource excludes
  // secrets at SQL level (WHERE secret=0) — nothing here can render a secret.
  // ---------------------------------------------------------------------

  const PAGE_ID = 'configuration_center';
  const HOST_ID = 'pageConfigurationCenter';
  const BODY_ID = 'configurationCenterBody';

  const state = {
    loading: false,
    error: null,
    activeTab: 'settings',
    settings: [],
    sequences: [],
    featureFlags: [],
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
    if (b && kit) kit.renderState(b, kit.STATES.LOADING, { title: 'جاري تحميل مركز التهيئة...' });

    try {
      const [settings, sequences, featureFlags] = await Promise.all([
        apiQuery('settings'),
        apiQuery('numbering-sequences'),
        apiQuery('feature-flags'),
      ]);
      state.settings = settings;
      state.sequences = sequences;
      state.featureFlags = featureFlags;
    } catch (err) {
      state.error = err.message || 'فشل تحميل بيانات التهيئة';
    } finally {
      state.loading = false;
      render();
    }
  }

  function renderHeader() {
    const kit = K();
    return kit.renderHeader({
      title: 'مركز التهيئة والإعدادات',
      subtitle: 'إعدادات النظام (بلا أسرار)، تسلسلات الترقيم، وأعلام الميزات — من سجل التهيئة المرجعي',
      actionsHtml: '',
    });
  }

  function renderTabs() {
    const kit = K();
    return kit.renderTabStrip({
      tabs: [
        { id: 'settings', label: 'الإعدادات', badge: state.settings.length },
        { id: 'sequences', label: 'تسلسلات الترقيم', badge: state.sequences.length },
        { id: 'flags', label: 'أعلام الميزات', badge: state.featureFlags.length },
      ],
      activeTab: state.activeTab,
      onSelect: 'OctagonConfigurationCenter.switchTab',
    });
  }

  function renderSettingsTab() {
    const kit = K();
    return kit.renderTable({
      columns: [
        { key: 'module', title: 'الوحدة', render: row => kit.bidi(row.module_id) },
        { key: 'key', title: 'المفتاح', render: row => kit.bidi(row.key) },
        { key: 'type', title: 'النوع', render: row => kit.bidi(row.type || 'string') },
        { key: 'default', title: 'القيمة الافتراضية', render: row => kit.bidi(row.default_value == null ? '—' : String(row.default_value)) },
        { key: 'scopes', title: 'النطاقات', render: row => kit.bidi(row.scopes || 'system') },
        { key: 'restart', title: 'إعادة تشغيل', render: row => row.restart_required ? kit.renderStatusBadge('مطلوبة', 'warning') : '—' },
      ],
      rows: state.settings,
      emptyTitle: 'لا توجد إعدادات',
      emptySubtitle: 'سجل الإعدادات المرجعي فارغ (الأسرار مستبعدة تصميمياً)',
    });
  }

  function renderSequencesTab() {
    const kit = K();
    return kit.renderTable({
      columns: [
        { key: 'module', title: 'الوحدة', render: row => kit.bidi(row.module_id) },
        { key: 'scope', title: 'النطاق', render: row => kit.bidi(row.scope_key || '—') },
        { key: 'template', title: 'القالب', render: row => kit.bidi(row.template || '—') },
        { key: 'current', title: 'القيمة الحالية', render: row => kit.num(row.current_value ?? 0) },
        { key: 'reset', title: 'سياسة الإعادة', render: row => kit.bidi(row.reset_policy || '—') },
        { key: 'gap', title: 'سياسة الفجوات', render: row => kit.bidi(row.gap_policy || '—') },
      ],
      rows: state.sequences,
      emptyTitle: 'لا توجد تسلسلات ترقيم',
      emptySubtitle: 'لم يتم تعريف أي تسلسل ترقيم بعد',
    });
  }

  function renderFlagsTab() {
    const kit = K();
    return kit.renderTable({
      columns: [
        { key: 'key', title: 'العلم', render: row => kit.bidi(row.key) },
        { key: 'module', title: 'الوحدة', render: row => kit.bidi(row.module_id || '—') },
        { key: 'scope', title: 'النطاق', render: row => kit.bidi(row.scope || 'system') },
        { key: 'enabled', title: 'الحالة', render: row => kit.renderStatusBadge(row.enabled ? 'مفعّل' : 'معطّل', row.enabled ? 'active' : 'inactive') },
        { key: 'updated', title: 'آخر تحديث', render: row => kit.bidi(row.updated_at || '—') },
      ],
      rows: state.featureFlags,
      emptyTitle: 'لا توجد أعلام ميزات',
      emptySubtitle: 'لم يتم تعريف أي علم ميزة بعد',
    });
  }

  function render() {
    const kit = K();
    const b = body();
    if (!b || !kit) return;

    if (state.error) {
      kit.renderState(b, kit.STATES.BACKEND_FAILURE, {
        title: 'تعذر تحميل مركز التهيئة',
        subtitle: state.error,
        onRetry: 'OctagonConfigurationCenter.reload()',
      });
      return;
    }

    let tabContent = '';
    if (state.activeTab === 'settings') tabContent = renderSettingsTab();
    else if (state.activeTab === 'sequences') tabContent = renderSequencesTab();
    else if (state.activeTab === 'flags') tabContent = renderFlagsTab();

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
    navId: 'navConfigurationCenter',
    activate,
  });

  root.OctagonConfigurationCenter = {
    reload: loadData,
    switchTab: function (tabId) {
      state.activeTab = tabId;
      render();
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
