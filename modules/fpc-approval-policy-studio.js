(function (root) {
  'use strict';

  // ---------------------------------------------------------------------
  // Approval Policy Studio (`approval_policy_studio`) — FP-2E.
  //
  // Governed READ projection over the canonical approval engine via
  // /api/v1/approvals/{policies,worklist,counts}. Parallel/quorum fields are
  // shown only because the canonical backend stores them (approval_policies
  // .mode/.quorum) — never fabricated.
  // ---------------------------------------------------------------------

  const PAGE_ID = 'approval_policy_studio';
  const HOST_ID = 'pageApprovalPolicyStudio';
  const BODY_ID = 'approvalPolicyStudioBody';

  const state = {
    loading: false,
    error: null,
    activeTab: 'policies',
    policies: [],
    worklist: [],
    counts: null,
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
    if (b && kit) kit.renderState(b, kit.STATES.LOADING, { title: 'جاري تحميل استوديو سياسات الاعتماد...' });

    try {
      const [policies, worklist, counts] = await Promise.all([
        apiQuery('approvals/policies'),
        apiQuery('approvals/worklist'),
        apiQuery('approvals/counts'),
      ]);
      state.policies = policies;
      state.worklist = worklist;
      state.counts = counts;
    } catch (err) {
      state.error = err.message || 'فشل تحميل بيانات سياسات الاعتماد';
    } finally {
      state.loading = false;
      render();
    }
  }

  function renderHeader() {
    const kit = K();
    return kit.renderHeader({
      title: 'استوديو سياسات الاعتماد',
      subtitle: 'سياسات الاعتماد، قائمة الطلبات المعلقة، والأعداد الفعلية — من محرك الاعتمادات المرجعي',
      actionsHtml: '',
    });
  }

  function renderTabs() {
    const kit = K();
    return kit.renderTabStrip({
      tabs: [
        { id: 'policies', label: 'السياسات', badge: state.policies.length },
        { id: 'worklist', label: 'قائمة المهام', badge: state.worklist.length },
      ],
      activeTab: state.activeTab,
      onSelect: 'OctagonApprovalPolicyStudio.switchTab',
    });
  }

  function renderCounts() {
    const kit = K();
    if (!state.counts || typeof state.counts !== 'object') return '';
    const entries = Object.entries(state.counts).filter(([, v]) => typeof v === 'number');
    if (!entries.length) return '';
    return `
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        ${entries.map(([key, value]) => kit.renderKpiCard({
          title: key, value: kit.num(value), subtitle: '', status: value > 0 ? 'warning' : 'active',
        })).join('')}
      </div>
    `;
  }

  function renderPoliciesTab() {
    const kit = K();
    return `
      ${renderCounts()}
      ${kit.renderTable({
        columns: [
          { key: 'label', title: 'السياسة', render: row => kit.esc(row.label_ar || row.id) },
          { key: 'binding', title: 'الكيان / العملية', render: row => kit.bidi(`${row.entity || '*'} / ${row.action || '*'}`) },
          { key: 'module', title: 'الوحدة', render: row => kit.bidi(row.module_id) },
          { key: 'mode', title: 'النمط', render: row => kit.bidi(row.mode || 'sequential') },
          { key: 'quorum', title: 'النصاب', render: row => row.quorum == null ? '—' : kit.num(row.quorum) },
          { key: 'threshold', title: 'حد المبلغ', render: row => row.amount_threshold == null ? '—' : kit.num(row.amount_threshold) },
          { key: 'maker_checker', title: 'صانع/مدقق', render: row => kit.renderStatusBadge(row.maker_checker ? 'مفروض' : 'غير مفروض', row.maker_checker ? 'warning' : 'draft') },
          { key: 'status', title: 'الحالة', render: row => kit.renderStatusBadge(row.status, row.status === 'active' ? 'active' : row.status === 'retired' ? 'inactive' : 'draft') },
        ],
        rows: state.policies,
        emptyTitle: 'لا توجد سياسات اعتماد',
        emptySubtitle: 'لم يتم نشر أي سياسة اعتماد بعد',
      })}
    `;
  }

  function renderWorklistTab() {
    const kit = K();
    return kit.renderTable({
      columns: [
        { key: 'id', title: 'الطلب', render: row => kit.bidi(row.id || row.request_id || '—') },
        { key: 'subject', title: 'الموضوع', render: row => kit.esc(row.label_ar || row.summary || row.entity || '—') },
        { key: 'amount', title: 'المبلغ', render: row => row.amount == null ? '—' : kit.num(row.amount) },
        { key: 'requested_by', title: 'مقدم الطلب', render: row => kit.bidi(row.requested_by || row.requester_id || '—') },
        { key: 'status', title: 'الحالة', render: row => kit.renderStatusBadge(row.status || 'معلق', row.status === 'approved' ? 'active' : row.status === 'rejected' ? 'blocked' : 'warning') },
        { key: 'created', title: 'أنشئ', render: row => kit.bidi(row.created_at || '—') },
      ],
      rows: state.worklist,
      emptyTitle: 'قائمة المهام فارغة',
      emptySubtitle: 'لا توجد طلبات اعتماد معلقة بانتظارك',
    });
  }

  function render() {
    const kit = K();
    const b = body();
    if (!b || !kit) return;

    if (state.error) {
      kit.renderState(b, kit.STATES.BACKEND_FAILURE, {
        title: 'تعذر تحميل استوديو سياسات الاعتماد',
        subtitle: state.error,
        onRetry: 'OctagonApprovalPolicyStudio.reload()',
      });
      return;
    }

    let tabContent = '';
    if (state.activeTab === 'policies') tabContent = renderPoliciesTab();
    else if (state.activeTab === 'worklist') tabContent = renderWorklistTab();

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
    navId: 'navApprovalPolicyStudio',
    activate,
  });

  root.OctagonApprovalPolicyStudio = {
    reload: loadData,
    switchTab: function (tabId) {
      state.activeTab = tabId;
      render();
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
