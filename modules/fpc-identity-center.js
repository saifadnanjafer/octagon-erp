(function (root) {
  'use strict';

  // ---------------------------------------------------------------------
  // Identity Center (`identity_center`) — FP-2D.
  //
  // Governed READ projection over the canonical identity authority via
  // /api/v1/control-plane/{users,api-keys,integrations}.
  //
  // This page NEVER renders passwords, hashes, tokens, recovery codes, or
  // secret values. The api-keys resource exposes key prefixes only, by design
  // of the canonical backend.
  // ---------------------------------------------------------------------

  const PAGE_ID = 'identity_center';
  const HOST_ID = 'pageIdentityCenter';
  const BODY_ID = 'identityCenterBody';

  const state = {
    loading: false,
    error: null,
    activeTab: 'users',
    users: [],
    apiKeys: [],
    ssoProviders: [],
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
    if (b && kit) kit.renderState(b, kit.STATES.LOADING, { title: 'جاري تحميل مركز الهوية...' });

    try {
      const [users, apiKeys, ssoProviders] = await Promise.all([
        apiQuery('users'),
        apiQuery('api-keys'),
        apiQuery('integrations'),
      ]);
      state.users = users;
      state.apiKeys = apiKeys;
      state.ssoProviders = ssoProviders;
    } catch (err) {
      state.error = err.message || 'فشل تحميل بيانات الهوية';
    } finally {
      state.loading = false;
      render();
    }
  }

  function renderHeader() {
    const kit = K();
    return kit.renderHeader({
      title: 'مركز الهوية',
      subtitle: 'المستخدمون، مفاتيح API (البادئات فقط)، ومزودو الدخول الموحد — بلا أي أسرار',
      actionsHtml: '',
    });
  }

  function renderTabs() {
    const kit = K();
    return kit.renderTabStrip({
      tabs: [
        { id: 'users', label: 'المستخدمون', badge: state.users.length },
        { id: 'api_keys', label: 'مفاتيح API', badge: state.apiKeys.length },
        { id: 'sso', label: 'الدخول الموحد (SSO)', badge: state.ssoProviders.length },
      ],
      activeTab: state.activeTab,
      onSelect: 'OctagonIdentityCenter.switchTab',
    });
  }

  function renderUsersTab() {
    const kit = K();
    return kit.renderTable({
      columns: [
        { key: 'login', title: 'اسم الدخول', render: row => kit.bidi(row.login) },
        { key: 'name', title: 'الاسم', render: row => kit.esc(row.name || '—') },
        { key: 'email', title: 'البريد', render: row => kit.bidi(row.email || '—') },
        { key: 'status', title: 'الحالة', render: row => kit.renderStatusBadge(row.status, row.status === 'active' ? 'active' : 'inactive') },
        { key: 'owner', title: 'مالك النظام', render: row => row.is_owner ? kit.renderStatusBadge('مالك', 'warning') : '—' },
        { key: 'mfa', title: 'المصادقة الثنائية', render: row => kit.renderStatusBadge(row.mfa_required ? 'مطلوبة' : 'غير مفروضة', row.mfa_required ? 'active' : 'draft') },
        { key: 'last_login', title: 'آخر دخول', render: row => kit.bidi(row.last_login_at || '—') },
      ],
      rows: state.users,
      emptyTitle: 'لا يوجد مستخدمون',
      emptySubtitle: 'لم يتم تسجيل أي هوية ضمن هذا المستأجر بعد',
    });
  }

  function renderApiKeysTab() {
    const kit = K();
    return kit.renderTable({
      columns: [
        { key: 'label', title: 'الوصف', render: row => kit.esc(row.label || '—') },
        { key: 'prefix', title: 'بادئة المفتاح', render: row => kit.bidi(row.prefix) },
        { key: 'scopes', title: 'النطاقات', render: row => kit.bidi(row.scopes || '—') },
        { key: 'expires', title: 'الانتهاء', render: row => kit.bidi(row.expires_at || 'بلا انتهاء') },
        { key: 'status', title: 'الحالة', render: row => kit.renderStatusBadge(row.revoked_at ? 'ملغى' : 'نشط', row.revoked_at ? 'inactive' : 'active') },
        { key: 'last_used', title: 'آخر استخدام', render: row => kit.bidi(row.last_used_at || '—') },
      ],
      rows: state.apiKeys,
      emptyTitle: 'لا توجد مفاتيح API',
      emptySubtitle: 'لم يتم إصدار أي مفتاح وصول برمجي بعد',
    });
  }

  function renderSsoTab() {
    const kit = K();
    return kit.renderTable({
      columns: [
        { key: 'name', title: 'المزود', render: row => kit.esc(row.name) },
        { key: 'kind', title: 'النوع', render: row => kit.bidi(row.kind) },
        { key: 'issuer', title: 'المُصدر', render: row => kit.bidi(row.issuer || '—') },
        { key: 'jit', title: 'التوفير الفوري', render: row => kit.renderStatusBadge(row.jit_provisioning ? 'مفعّل' : 'معطّل', row.jit_provisioning ? 'active' : 'draft') },
        { key: 'status', title: 'الحالة', render: row => kit.renderStatusBadge(row.status, row.status === 'active' ? 'active' : 'inactive') },
      ],
      rows: state.ssoProviders,
      emptyTitle: 'لا يوجد مزودو دخول موحد',
      emptySubtitle: 'لم يتم تكوين أي مزود SSO بعد',
    });
  }

  function render() {
    const kit = K();
    const b = body();
    if (!b || !kit) return;

    if (state.error) {
      kit.renderState(b, kit.STATES.BACKEND_FAILURE, {
        title: 'تعذر تحميل مركز الهوية',
        subtitle: state.error,
        onRetry: 'OctagonIdentityCenter.reload()',
      });
      return;
    }

    let tabContent = '';
    if (state.activeTab === 'users') tabContent = renderUsersTab();
    else if (state.activeTab === 'api_keys') tabContent = renderApiKeysTab();
    else if (state.activeTab === 'sso') tabContent = renderSsoTab();

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
    navId: 'navIdentityCenter',
    activate,
  });

  root.OctagonIdentityCenter = {
    reload: loadData,
    switchTab: function (tabId) {
      state.activeTab = tabId;
      render();
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
