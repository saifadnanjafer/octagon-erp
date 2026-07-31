(function (root) {
  'use strict';

  // ---------------------------------------------------------------------
  // Audit & Security Center (`audit_security_center`) — FP-2G.
  //
  // Read-only projection over the canonical platform_audit_log via
  // /api/v1/control-plane/audit. Audit is append-only: this page offers no
  // update/delete actions of any kind.
  // ---------------------------------------------------------------------

  const PAGE_ID = 'audit_security_center';
  const HOST_ID = 'pageAuditSecurityCenter';
  const BODY_ID = 'auditSecurityCenterBody';

  const state = {
    loading: false,
    error: null,
    entries: [],
    filter: 'all',
  };

  function K() { return root.OctagonPageKit; }
  function body() { return document.getElementById(BODY_ID); }

  async function loadData() {
    state.loading = true;
    state.error = null;
    const kit = K();
    const b = body();
    if (b && kit) kit.renderState(b, kit.STATES.LOADING, { title: 'جاري تحميل سجل التدقيق...' });

    try {
      const res = await fetch('/api/v1/control-plane/audit');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      state.entries = json.data || [];
    } catch (err) {
      state.error = err.message || 'فشل تحميل سجل التدقيق';
    } finally {
      state.loading = false;
      render();
    }
  }

  const FILTERS = [
    { id: 'all', label: 'الكل' },
    { id: 'failures', label: 'الفشل فقط' },
    { id: 'governance', label: 'الحوكمة' },
    { id: 'configuration', label: 'التهيئة' },
    { id: 'modules', label: 'الوحدات' },
  ];

  function matchesFilter(row, filter = state.filter) {
    if (filter === 'all') return true;
    if (filter === 'failures') return row.result && row.result !== 'success';
    if (filter === 'governance') return /workflow|approval|delegation|policy|automation/i.test(row.action || '');
    if (filter === 'configuration') return /configuration|setting|feature/i.test(row.action || row.resource || '');
    if (filter === 'modules') return /module|license|pack/i.test(row.action || row.resource || '');
    return true;
  }

  function renderHeader() {
    const kit = K();
    return kit.renderHeader({
      title: 'مركز التدقيق والأمن',
      subtitle: 'سجل التدقيق المرجعي — قراءة فقط، لا يقبل أي تعديل أو حذف',
      actionsHtml: '',
    });
  }

  function renderFilters() {
    const kit = K();
    return kit.renderTabStrip({
      tabs: FILTERS.map((f) => ({
        id: f.id,
        label: f.label,
        badge: state.entries.filter((r) => matchesFilter(r, f.id)).length,
      })),
      activeTab: state.filter,
      onSelect: 'OctagonAuditSecurityCenter.setFilter',
    });
  }

  function renderTable() {
    const kit = K();
    const rows = state.entries.filter(matchesFilter);
    return kit.renderTable({
      columns: [
        { key: 'time', title: 'الوقت', render: row => kit.bidi(row.occurred_at || '—') },
        { key: 'actor', title: 'الفاعل', render: row => kit.bidi(row.actor_id || 'system') },
        { key: 'action', title: 'الإجراء', render: row => kit.bidi(row.action) },
        { key: 'resource', title: 'المورد', render: row => kit.bidi(`${row.resource || ''}${row.resource_id ? ' / ' + row.resource_id : ''}`) },
        { key: 'company', title: 'الشركة', render: row => kit.bidi(row.company_id || '—') },
        { key: 'result', title: 'النتيجة', render: row => kit.renderStatusBadge(row.result || 'success', row.result === 'success' || !row.result ? 'active' : 'blocked') },
        { key: 'failure', title: 'رمز الفشل', render: row => kit.bidi(row.failure_code || '—') },
      ],
      rows,
      emptyTitle: 'لا توجد قيود تدقيق',
      emptySubtitle: 'سجل التدقيق فارغ ضمن هذا النطاق',
    });
  }

  function render() {
    const kit = K();
    const b = body();
    if (!b || !kit) return;

    if (state.error) {
      kit.renderState(b, kit.STATES.BACKEND_FAILURE, {
        title: 'تعذر تحميل سجل التدقيق',
        subtitle: state.error,
        onRetry: 'OctagonAuditSecurityCenter.reload()',
      });
      return;
    }

    b.innerHTML = `
      ${renderHeader()}
      ${renderFilters()}
      <div class="mt-4">
        ${renderTable()}
      </div>
    `;
  }

  function activate() {
    loadData();
  }

  root.OctagonPageKit.wirePage({
    pageId: PAGE_ID,
    sectionId: HOST_ID,
    navId: 'navAuditSecurityCenter',
    activate,
  });

  root.OctagonAuditSecurityCenter = {
    reload: loadData,
    setFilter: function (filterId) {
      state.filter = filterId;
      render();
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
