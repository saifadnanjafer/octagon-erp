(function (root) {
  'use strict';

  // ---------------------------------------------------------------------
  // Data Import Center (`data_import_center`) — FP-2F.
  //
  // Governed READ projection over the canonical DataExchangeService import
  // store (import_jobs / import_rows) via /api/v1/control-plane/import-jobs
  // and /import-rows/<id>. Every import listed here executed through the
  // service's ActionExecutor path — row-level errors are first-class data.
  // ---------------------------------------------------------------------

  const PAGE_ID = 'data_import_center';
  const HOST_ID = 'pageDataImportCenter';
  const BODY_ID = 'dataImportCenterBody';

  const state = {
    loading: false,
    error: null,
    activeTab: 'jobs',
    jobs: [],
    rows: [],
    rowsJobId: null,
  };

  function K() { return root.OctagonPageKit; }
  function body() { return document.getElementById(BODY_ID); }

  async function apiQuery(path) {
    const res = await fetch(`/api/v1/control-plane/${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json.data || [];
  }

  async function loadData() {
    state.loading = true;
    state.error = null;
    const kit = K();
    const b = body();
    if (b && kit) kit.renderState(b, kit.STATES.LOADING, { title: 'جاري تحميل مركز استيراد البيانات...' });

    try {
      state.jobs = await apiQuery('import-jobs');
    } catch (err) {
      state.error = err.message || 'فشل تحميل مهام الاستيراد';
    } finally {
      state.loading = false;
      render();
    }
  }

  async function loadRows(jobId) {
    state.rowsJobId = jobId;
    state.activeTab = 'rows';
    state.rows = [];
    render();
    try {
      state.rows = await apiQuery(`import-rows/${encodeURIComponent(jobId)}`);
    } catch (err) {
      state.error = err.message || 'فشل تحميل صفوف الاستيراد';
    } finally {
      render();
    }
  }

  function renderHeader() {
    const kit = K();
    return kit.renderHeader({
      title: 'مركز استيراد البيانات',
      subtitle: 'مهام الاستيراد، نتائج الصفوف، والأخطاء على مستوى الصف — من خدمة تبادل البيانات المرجعية',
      actionsHtml: '',
    });
  }

  function renderTabs() {
    const kit = K();
    return kit.renderTabStrip({
      tabs: [
        { id: 'jobs', label: 'مهام الاستيراد', badge: state.jobs.length },
        { id: 'rows', label: state.rowsJobId ? 'صفوف المهمة' : 'صفوف المهمة (اختر مهمة)', badge: state.rows.length },
      ],
      activeTab: state.activeTab,
      onSelect: 'OctagonDataImportCenter.switchTab',
    });
  }

  function jobStatus(row) {
    if (row.status === 'completed' && Number(row.failed_rows) > 0) return { label: 'اكتمل بأخطاء', tone: 'warning' };
    if (row.status === 'completed') return { label: 'اكتمل', tone: 'active' };
    if (row.status === 'failed') return { label: 'فشل', tone: 'blocked' };
    return { label: row.status || 'قيد التنفيذ', tone: 'draft' };
  }

  function renderJobsTab() {
    const kit = K();
    return kit.renderTable({
      columns: [
        { key: 'entity', title: 'الكيان', render: row => kit.bidi(row.entity) },
        { key: 'action', title: 'الإجراء', render: row => kit.bidi(row.action_id || '—') },
        { key: 'mode', title: 'الوضع', render: row => kit.renderStatusBadge(row.mode === 'dry_run' ? 'تجريبي' : 'فعلي', row.mode === 'dry_run' ? 'draft' : 'warning') },
        { key: 'total', title: 'الصفوف', render: row => kit.num(row.total_rows ?? 0) },
        { key: 'ok', title: 'ناجحة', render: row => kit.num(row.ok_rows ?? 0) },
        { key: 'failed', title: 'فاشلة', render: row => kit.num(row.failed_rows ?? 0) },
        { key: 'status', title: 'الحالة', render: row => { const s = jobStatus(row); return kit.renderStatusBadge(s.label, s.tone); } },
        { key: 'created', title: 'أنشئت', render: row => kit.bidi(row.created_at || '—') },
        { key: 'rows', title: 'التفاصيل', render: row => `<button class="text-emerald-700 underline text-sm" onclick="OctagonDataImportCenter.showRows('${row.id}')">الصفوف</button>` },
      ],
      rows: state.jobs,
      emptyTitle: 'لا توجد مهام استيراد',
      emptySubtitle: 'لم يتم تشغيل أي استيراد عبر خدمة تبادل البيانات بعد',
    });
  }

  function renderRowsTab() {
    const kit = K();
    if (!state.rowsJobId) {
      return `
        <div class="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          اختر «الصفوف» بجانب أي مهمة لعرض نتائجها على مستوى الصف — لا يُسقط أي صف بصمت.
        </div>
      `;
    }
    return kit.renderTable({
      columns: [
        { key: 'row', title: 'رقم الصف', render: row => kit.num(row.row_number) },
        { key: 'status', title: 'الحالة', render: row => kit.renderStatusBadge(row.status === 'ok' ? 'ناجح' : 'فاشل', row.status === 'ok' ? 'active' : 'blocked') },
        { key: 'error', title: 'الخطأ', render: row => kit.esc(row.error || '—') },
        { key: 'record', title: 'السجل الناتج', render: row => kit.bidi(row.record_id || '—') },
      ],
      rows: state.rows,
      emptyTitle: 'لا توجد صفوف',
      emptySubtitle: 'هذه المهمة لا تحتوي صفوفاً مسجلة',
    });
  }

  function render() {
    const kit = K();
    const b = body();
    if (!b || !kit) return;

    if (state.error) {
      kit.renderState(b, kit.STATES.BACKEND_FAILURE, {
        title: 'تعذر تحميل مركز استيراد البيانات',
        subtitle: state.error,
        onRetry: 'OctagonDataImportCenter.reload()',
      });
      return;
    }

    let tabContent = '';
    if (state.activeTab === 'jobs') tabContent = renderJobsTab();
    else if (state.activeTab === 'rows') tabContent = renderRowsTab();

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
    navId: 'navDataImportCenter',
    activate,
  });

  root.OctagonDataImportCenter = {
    reload: loadData,
    showRows: loadRows,
    switchTab: function (tabId) {
      state.activeTab = tabId;
      render();
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
