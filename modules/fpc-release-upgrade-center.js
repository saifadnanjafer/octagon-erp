(function (root) {
  'use strict';

  // ---------------------------------------------------------------------
  // Release & Upgrade Center (`release_upgrade_center`) — FP-2G.
  //
  // Governed READ projection over configuration packages and backup runs via
  // /api/v1/control-plane/{packages,backups}. Production execution remains
  // blocked: this page offers no apply/rollback action — only the real state.
  // ---------------------------------------------------------------------

  const PAGE_ID = 'release_upgrade_center';
  const HOST_ID = 'pageReleaseUpgradeCenter';
  const BODY_ID = 'releaseUpgradeCenterBody';

  const state = {
    loading: false,
    error: null,
    activeTab: 'packages',
    packages: [],
    backups: [],
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
    if (b && kit) kit.renderState(b, kit.STATES.LOADING, { title: 'جاري تحميل مركز الإصدار والترقية...' });

    try {
      const [packages, backups] = await Promise.all([
        apiQuery('packages'),
        apiQuery('backups'),
      ]);
      state.packages = packages;
      state.backups = backups;
    } catch (err) {
      state.error = err.message || 'فشل تحميل بيانات الإصدار والترقية';
    } finally {
      state.loading = false;
      render();
    }
  }

  function renderHeader() {
    const kit = K();
    return kit.renderHeader({
      title: 'مركز الإصدار والترقية',
      subtitle: 'حزم التهيئة ونقاط الاستعادة — التنفيذ الإنتاجي مقيد بصلاحية المالك الصريحة',
      actionsHtml: '',
    });
  }

  function renderTabs() {
    const kit = K();
    return kit.renderTabStrip({
      tabs: [
        { id: 'packages', label: 'حزم التهيئة', badge: state.packages.length },
        { id: 'backups', label: 'نقاط الاستعادة', badge: state.backups.length },
      ],
      activeTab: state.activeTab,
      onSelect: 'OctagonReleaseUpgradeCenter.switchTab',
    });
  }

  function renderNotice() {
    return `
      <div class="rounded-lg border border-amber-300 bg-amber-50 p-4 mb-4 text-sm text-amber-800">
        تنفيذ الترقيات أو الاستعادة في بيئة الإنتاج محظور دون تفويض صريح من مالك النظام.
        هذه الصفحة عرض للحالة الفعلية فقط.
      </div>
    `;
  }

  function renderPackagesTab() {
    const kit = K();
    return `
      ${renderNotice()}
      ${kit.renderTable({
        columns: [
          { key: 'name', title: 'الحزمة', render: row => kit.esc(row.name) },
          { key: 'version', title: 'الإصدار', render: row => kit.bidi(row.version || '—') },
          { key: 'target', title: 'الحد الأدنى المستهدف', render: row => kit.bidi(row.target_min_version || '—') },
          { key: 'status', title: 'الحالة', render: row => kit.renderStatusBadge(row.status, row.status === 'applied' ? 'active' : row.status === 'failed' ? 'blocked' : 'draft') },
          { key: 'created', title: 'أنشئت', render: row => kit.bidi(row.created_at || '—') },
          { key: 'applied', title: 'طبقت', render: row => kit.bidi(row.applied_at || '—') },
        ],
        rows: state.packages,
        emptyTitle: 'لا توجد حزم تهيئة',
        emptySubtitle: 'لم تُبنَ أو تُطبَّق أي حزمة تهيئة بعد',
      })}
    `;
  }

  function renderBackupsTab() {
    const kit = K();
    return `
      ${renderNotice()}
      ${kit.renderTable({
        columns: [
          { key: 'id', title: 'المعرف', render: row => kit.bidi(row.id) },
          { key: 'type', title: 'النوع', render: row => kit.bidi(row.backup_type || '—') },
          { key: 'status', title: 'الحالة', render: row => kit.renderStatusBadge(row.status || 'unknown', row.status === 'completed' ? 'active' : row.status === 'failed' ? 'blocked' : 'draft') },
          { key: 'verified', title: 'التحقق', render: row => row.verified_at ? kit.renderStatusBadge('موثقة', 'active') : kit.renderStatusBadge('غير موثقة', 'warning') },
          { key: 'completed', title: 'اكتملت', render: row => kit.bidi(row.completed_at || '—') },
        ],
        rows: state.backups,
        emptyTitle: 'لا توجد نقاط استعادة',
        emptySubtitle: 'لا توجد نسخ احتياطية موثقة يمكن الاستعادة منها — حقيقة يجب معالجتها قبل أي ترقية',
      })}
    `;
  }

  function render() {
    const kit = K();
    const b = body();
    if (!b || !kit) return;

    if (state.error) {
      kit.renderState(b, kit.STATES.BACKEND_FAILURE, {
        title: 'تعذر تحميل مركز الإصدار والترقية',
        subtitle: state.error,
        onRetry: 'OctagonReleaseUpgradeCenter.reload()',
      });
      return;
    }

    let tabContent = '';
    if (state.activeTab === 'packages') tabContent = renderPackagesTab();
    else if (state.activeTab === 'backups') tabContent = renderBackupsTab();

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
    navId: 'navReleaseUpgradeCenter',
    activate,
  });

  root.OctagonReleaseUpgradeCenter = {
    reload: loadData,
    switchTab: function (tabId) {
      state.activeTab = tabId;
      render();
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
