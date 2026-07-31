(function (root) {
  'use strict';

  // ---------------------------------------------------------------------
  // Workflow Studio (`workflow_studio`) — FP-2E.
  //
  // Governed READ projection over the canonical workflow authority via
  // /api/v1/workflow/{definitions,instances}. No workflow node or page code
  // mutates protected tables directly.
  // ---------------------------------------------------------------------

  const PAGE_ID = 'workflow_studio';
  const HOST_ID = 'pageWorkflowStudio';
  const BODY_ID = 'workflowStudioBody';

  const state = {
    loading: false,
    error: null,
    activeTab: 'definitions',
    definitions: [],
    instances: [],
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
    if (b && kit) kit.renderState(b, kit.STATES.LOADING, { title: 'جاري تحميل استوديو سير العمل...' });

    try {
      const [definitions, instances] = await Promise.all([
        apiQuery('workflow/definitions'),
        apiQuery('workflow/instances'),
      ]);
      state.definitions = definitions;
      state.instances = instances;
    } catch (err) {
      state.error = err.message || 'فشل تحميل بيانات سير العمل';
    } finally {
      state.loading = false;
      render();
    }
  }

  function renderHeader() {
    const kit = K();
    return kit.renderHeader({
      title: 'استوديو سير العمل',
      subtitle: 'تعريفات سير العمل وإصداراتها وحالات التنفيذ — من سلطة سير العمل المرجعية',
      actionsHtml: '',
    });
  }

  function renderTabs() {
    const kit = K();
    return kit.renderTabStrip({
      tabs: [
        { id: 'definitions', label: 'التعريفات', badge: state.definitions.length },
        { id: 'instances', label: 'حالات التنفيذ', badge: state.instances.length },
      ],
      activeTab: state.activeTab,
      onSelect: 'OctagonWorkflowStudio.switchTab',
    });
  }

  function renderDefinitionsTab() {
    const kit = K();
    return kit.renderTable({
      columns: [
        { key: 'id', title: 'المعرف', render: row => kit.bidi(row.id) },
        { key: 'name', title: 'الاسم', render: row => kit.esc(row.label_ar || row.name) },
        { key: 'module', title: 'الوحدة', render: row => kit.bidi(row.module_id) },
        { key: 'entity', title: 'الكيان', render: row => kit.bidi(row.entity || '—') },
        { key: 'version', title: 'الإصدار النشط', render: row => row.active_version ? kit.num(row.active_version) : kit.renderStatusBadge('مسودة', 'draft') },
        { key: 'status', title: 'الحالة', render: row => kit.renderStatusBadge(row.status, row.status === 'active' ? 'active' : row.status === 'retired' ? 'inactive' : 'draft') },
      ],
      rows: state.definitions,
      emptyTitle: 'لا توجد تعريفات سير عمل',
      emptySubtitle: 'لم يتم تعريف أي سير عمل بعد',
    });
  }

  function renderInstancesTab() {
    const kit = K();
    return kit.renderTable({
      columns: [
        { key: 'id', title: 'المعرف', render: row => kit.bidi(row.id) },
        { key: 'definition', title: 'التعريف', render: row => kit.bidi(row.definition_id) },
        { key: 'entity', title: 'السجل', render: row => kit.bidi(`${row.entity || ''}${row.record_id ? ' / ' + row.record_id : ''}`) },
        { key: 'state', title: 'الحالة الحالية', render: row => kit.renderStatusBadge(row.state || row.status || '—', 'active') },
        { key: 'started', title: 'بدأت', render: row => kit.bidi(row.started_at || '—') },
      ],
      rows: state.instances,
      emptyTitle: 'لا توجد حالات تنفيذ',
      emptySubtitle: 'لم يبدأ أي تنفيذ سير عمل بعد',
    });
  }

  function render() {
    const kit = K();
    const b = body();
    if (!b || !kit) return;

    if (state.error) {
      kit.renderState(b, kit.STATES.BACKEND_FAILURE, {
        title: 'تعذر تحميل استوديو سير العمل',
        subtitle: state.error,
        onRetry: 'OctagonWorkflowStudio.reload()',
      });
      return;
    }

    let tabContent = '';
    if (state.activeTab === 'definitions') tabContent = renderDefinitionsTab();
    else if (state.activeTab === 'instances') tabContent = renderInstancesTab();

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
    navId: 'navWorkflowStudio',
    activate,
  });

  root.OctagonWorkflowStudio = {
    reload: loadData,
    switchTab: function (tabId) {
      state.activeTab = tabId;
      render();
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
