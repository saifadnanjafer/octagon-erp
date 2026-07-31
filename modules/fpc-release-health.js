(function (root) {
  'use strict';

  // ---------------------------------------------------------------------
  // Release Health (`release_health`) — FP-2G.
  //
  // Governed READ projection over the canonical health/backup/job resources
  // via /api/v1/control-plane/*. Unknown stays unknown — nothing here renders
  // an unmeasured signal as green.
  // ---------------------------------------------------------------------

  const PAGE_ID = 'release_health';
  const HOST_ID = 'pageReleaseHealth';
  const BODY_ID = 'releaseHealthBody';

  const state = {
    loading: false,
    error: null,
    activeTab: 'health',
    health: [],
    backups: [],
    jobs: [],
    jobQueue: null,
    overview: null,
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
    if (b && kit) kit.renderState(b, kit.STATES.LOADING, { title: 'جاري تحميل صحة الإصدار...' });

    try {
      const [health, backups, jobs, jobQueue, overview] = await Promise.all([
        apiQuery('health'),
        apiQuery('backups'),
        apiQuery('jobs'),
        apiQuery('job-queue'),
        apiQuery('overview'),
      ]);
      state.health = health;
      state.backups = backups;
      state.jobs = jobs;
      state.jobQueue = jobQueue;
      state.overview = Array.isArray(overview) ? (overview[0] || null) : overview;
    } catch (err) {
      state.error = err.message || 'فشل تحميل بيانات صحة الإصدار';
    } finally {
      state.loading = false;
      render();
    }
  }

  function renderHeader() {
    const kit = K();
    return kit.renderHeader({
      title: 'صحة الإصدار',
      subtitle: 'صحة الوحدات، النسخ الاحتياطية، والمهام الخلفية — المجهول يبقى مجهولاً',
      actionsHtml: '',
    });
  }

  function renderTabs() {
    const kit = K();
    const unhealthy = state.health.filter((h) => h.status !== 'healthy').length;
    return kit.renderTabStrip({
      tabs: [
        { id: 'health', label: 'صحة الوحدات', badge: unhealthy || state.health.length },
        { id: 'backups', label: 'النسخ الاحتياطية', badge: state.backups.length },
        { id: 'jobs', label: 'المهام الخلفية', badge: state.jobs.length },
        { id: 'queue', label: 'طابور المهام', badge: (state.jobQueue?.deadLetters || []).length },
      ],
      activeTab: state.activeTab,
      onSelect: 'OctagonReleaseHealth.switchTab',
    });
  }

  function healthTone(status) {
    if (status === 'healthy') return 'active';
    if (status === 'warning') return 'warning';
    return 'blocked';
  }

  function renderHealthTab() {
    const kit = K();
    const ov = state.overview || {};
    const kpis = [
      { title: 'الوحدات المفعلة', value: kit.num(ov.enabled_modules ?? 0), subtitle: `من أصل ${kit.num(ov.modules ?? 0)}`, status: 'active' },
      { title: 'وحدات غير سليمة', value: kit.num(ov.unhealthy_modules ?? 0), subtitle: 'تحتاج مراجعة', status: ov.unhealthy_modules ? 'warning' : 'active' },
      { title: 'نسخ احتياطية موثقة', value: kit.num(state.backups.filter((b) => b.verified_at).length), subtitle: `من أصل ${kit.num(state.backups.length)}`, status: state.backups.some((b) => b.verified_at) ? 'active' : 'warning' },
    ].map((c) => kit.renderKpiCard(c)).join('');

    return `
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">${kpis}</div>
      ${kit.renderTable({
        columns: [
          { key: 'module', title: 'الوحدة', render: row => kit.bidi(row.module_id) },
          { key: 'status', title: 'الصحة', render: row => kit.renderStatusBadge(row.status || 'unknown', healthTone(row.status)) },
          { key: 'access', title: 'رمز الوصول', render: row => kit.bidi(row.access_code || '—') },
          { key: 'missing', title: 'تهيئة ناقصة', render: row => kit.num(row.missing_configuration ?? 0) },
        ],
        rows: state.health,
        emptyTitle: 'لا توجد بيانات صحة',
        emptySubtitle: 'معلومات صحة الوحدات غير متاحة بعد',
      })}
    `;
  }

  function renderBackupsTab() {
    const kit = K();
    return kit.renderTable({
      columns: [
        { key: 'id', title: 'المعرف', render: row => kit.bidi(row.id) },
        { key: 'type', title: 'النوع', render: row => kit.bidi(row.backup_type || '—') },
        { key: 'status', title: 'الحالة', render: row => kit.renderStatusBadge(row.status || 'unknown', row.status === 'completed' ? 'active' : row.status === 'failed' ? 'blocked' : 'draft') },
        { key: 'bytes', title: 'الحجم', render: row => row.bytes == null ? '—' : kit.num(row.bytes) },
        { key: 'verified', title: 'التحقق', render: row => row.verified_at ? kit.renderStatusBadge('موثقة', 'active') : kit.renderStatusBadge('غير موثقة', 'warning') },
        { key: 'completed', title: 'اكتملت', render: row => kit.bidi(row.completed_at || '—') },
      ],
      rows: state.backups,
      emptyTitle: 'لا توجد نسخ احتياطية مسجلة',
      emptySubtitle: 'لم تُسجل أي عملية نسخ احتياطي بعد — هذه حقيقة تشغيلية يجب الانتباه لها',
    });
  }

  function renderJobsTab() {
    const kit = K();
    return kit.renderTable({
      columns: [
        { key: 'module', title: 'الوحدة', render: row => kit.bidi(row.module_id) },
        { key: 'name', title: 'المهمة', render: row => kit.esc(row.name) },
        { key: 'schedule', title: 'الجدولة', render: row => kit.bidi(row.schedule || '—') },
        { key: 'enabled', title: 'الحالة', render: row => kit.renderStatusBadge(row.enabled ? 'مفعّلة' : 'معطّلة', row.enabled ? 'active' : 'inactive') },
        { key: 'leased', title: 'مؤجرة حتى', render: row => kit.bidi(row.leased_until || '—') },
      ],
      rows: state.jobs,
      emptyTitle: 'لا توجد مهام خلفية',
      emptySubtitle: 'لم تُسجل أي مهمة خلفية بعد',
    });
  }

  function renderJobQueueTab() {
    const kit = K();
    const q = state.jobQueue || {};
    const counts = Array.isArray(q.counts) ? q.counts : [];
    const byStatus = {};
    counts.forEach((row) => { byStatus[row.status] = row.n; });
    const kpis = [
      { title: 'قيد الانتظار', value: kit.num(byStatus.queued || 0), subtitle: 'jobs queued', status: 'active' },
      { title: 'قيد التنفيذ', value: kit.num(byStatus.running || 0), subtitle: 'jobs running', status: 'active' },
      { title: 'فشلت وتُعاد المحاولة', value: kit.num(byStatus.failed || 0), subtitle: 'jobs failed (retrying)', status: byStatus.failed ? 'warning' : 'active' },
      { title: 'ميتة نهائياً', value: kit.num(byStatus.dead || 0), subtitle: 'dead letters', status: byStatus.dead ? 'blocked' : 'active' },
    ].map((c) => kit.renderKpiCard(c)).join('');

    return `
      <div class="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">${kpis}</div>
      ${kit.renderTable({
        columns: [
          { key: 'id', title: 'المعرف', render: row => kit.bidi(row.id) },
          { key: 'kind', title: 'النوع', render: row => kit.bidi(row.kind) },
          { key: 'attempts', title: 'المحاولات', render: row => kit.num(row.attempts) },
          { key: 'error', title: 'آخر خطأ', render: row => kit.esc(row.last_error || '—') },
          { key: 'created', title: 'أُنشئت', render: row => kit.bidi(row.created_at || '—') },
        ],
        rows: q.deadLetters || [],
        emptyTitle: 'لا توجد مهام ميتة',
        emptySubtitle: 'طابور المهام الخلفي سليم — لا توجد مهام تجاوزت عدد محاولاتها القصوى',
      })}
    `;
  }

  function render() {
    const kit = K();
    const b = body();
    if (!b || !kit) return;

    if (state.error) {
      kit.renderState(b, kit.STATES.BACKEND_FAILURE, {
        title: 'تعذر تحميل صحة الإصدار',
        subtitle: state.error,
        onRetry: 'OctagonReleaseHealth.reload()',
      });
      return;
    }

    let tabContent = '';
    if (state.activeTab === 'health') tabContent = renderHealthTab();
    else if (state.activeTab === 'backups') tabContent = renderBackupsTab();
    else if (state.activeTab === 'jobs') tabContent = renderJobsTab();
    else if (state.activeTab === 'queue') tabContent = renderJobQueueTab();

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
    navId: 'navReleaseHealth',
    activate,
  });

  root.OctagonReleaseHealth = {
    reload: loadData,
    switchTab: function (tabId) {
      state.activeTab = tabId;
      render();
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
