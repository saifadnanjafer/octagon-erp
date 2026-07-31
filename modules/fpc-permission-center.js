(function (root) {
  'use strict';

  // ---------------------------------------------------------------------
  // Permission Center (`permission_center`) — FP-2D.
  //
  // Governed READ projection over the canonical authorization registry via
  // /api/v1/control-plane/{roles,permissions,data-scopes}, plus real access
  // simulation through the governance `permissions/explain` evaluator query
  // (read-only; never mutates).
  // ---------------------------------------------------------------------

  const PAGE_ID = 'permission_center';
  const HOST_ID = 'pagePermissionCenter';
  const BODY_ID = 'permissionCenterBody';

  const state = {
    loading: false,
    error: null,
    activeTab: 'roles',
    roles: [],
    permissions: [],
    scopes: [],
    simulation: null,
    simulating: false,
    simulationError: null,
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
    if (b && kit) kit.renderState(b, kit.STATES.LOADING, { title: 'جاري تحميل مركز الصلاحيات...' });

    try {
      const [roles, permissions, scopes] = await Promise.all([
        apiQuery('roles'),
        apiQuery('permissions'),
        apiQuery('data-scopes'),
      ]);
      state.roles = roles;
      state.permissions = permissions;
      state.scopes = scopes;
    } catch (err) {
      state.error = err.message || 'فشل تحميل بيانات الصلاحيات';
    } finally {
      state.loading = false;
      render();
    }
  }

  function renderHeader() {
    const kit = K();
    return kit.renderHeader({
      title: 'مركز الصلاحيات',
      subtitle: 'الأدوار، سجل الصلاحيات، نطاقات البيانات، ومحاكاة الوصول الفعلي عبر المُقيِّم المرجعي',
      actionsHtml: '',
    });
  }

  function renderTabs() {
    const kit = K();
    return kit.renderTabStrip({
      tabs: [
        { id: 'roles', label: 'الأدوار', badge: state.roles.length },
        { id: 'permissions', label: 'الصلاحيات', badge: state.permissions.length },
        { id: 'scopes', label: 'نطاقات البيانات', badge: state.scopes.length },
        { id: 'simulation', label: 'محاكاة الوصول' },
      ],
      activeTab: state.activeTab,
      onSelect: 'OctagonPermissionCenter.switchTab',
    });
  }

  function renderRolesTab() {
    const kit = K();
    return kit.renderTable({
      columns: [
        { key: 'name', title: 'معرف الدور', render: row => kit.bidi(row.name) },
        { key: 'label', title: 'الاسم', render: row => kit.esc(row.label_ar || row.name) },
        { key: 'system', title: 'دور نظام', render: row => row.is_system ? kit.renderStatusBadge('نظام', 'warning') : '—' },
        { key: 'grants', title: 'عدد المنح', render: row => kit.num(row.grant_count ?? 0) },
        { key: 'status', title: 'الحالة', render: row => kit.renderStatusBadge(row.status, row.status === 'active' ? 'active' : 'inactive') },
      ],
      rows: state.roles,
      emptyTitle: 'لا توجد أدوار',
      emptySubtitle: 'لم يتم تعريف أي دور ضمن هذا المستأجر بعد',
    });
  }

  function renderPermissionsTab() {
    const kit = K();
    return kit.renderTable({
      columns: [
        { key: 'id', title: 'الرمز', render: row => kit.bidi(row.id) },
        { key: 'module', title: 'الوحدة', render: row => kit.bidi(row.module_id) },
        { key: 'kind', title: 'النوع', render: row => kit.bidi(row.kind) },
        { key: 'resource', title: 'المورد', render: row => kit.bidi(row.resource || '—') },
        { key: 'action', title: 'العملية', render: row => kit.bidi(row.action || '—') },
        { key: 'label', title: 'الوصف', render: row => kit.esc(row.label_ar || row.label_en || row.id) },
      ],
      rows: state.permissions,
      emptyTitle: 'لا توجد صلاحيات مسجلة',
      emptySubtitle: 'سجل الصلاحيات المرجعي فارغ',
    });
  }

  function renderScopesTab() {
    const kit = K();
    return kit.renderTable({
      columns: [
        { key: 'kind', title: 'نوع النطاق', render: row => kit.bidi(row.kind) },
        { key: 'name', title: 'الاسم', render: row => kit.esc(row.name) },
        { key: 'company', title: 'الشركة', render: row => kit.bidi(row.company_id) },
        { key: 'status', title: 'الحالة', render: row => kit.renderStatusBadge(row.status, row.status === 'active' ? 'active' : 'inactive') },
      ],
      rows: state.scopes,
      emptyTitle: 'لا توجد نطاقات بيانات',
      emptySubtitle: 'لم يتم تعريف نطاقات تشغيل بعد',
    });
  }

  function decisionHtml(decision) {
    const kit = K();
    const allowed = decision && (decision.allowed === true || decision.decision === 'allow' || decision.decision === 'allowed');
    const reasons = (decision && (decision.reasons || decision.explanation || [])) || [];
    const reasonList = Array.isArray(reasons)
      ? reasons.map((r) => `<li class="text-sm text-slate-600">${kit.esc(typeof r === 'string' ? r : JSON.stringify(r))}</li>`).join('')
      : `<li class="text-sm text-slate-600">${kit.esc(JSON.stringify(reasons))}</li>`;
    return `
      <div class="rounded-lg border p-4 ${allowed ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50'}">
        <div class="mb-2">${kit.renderStatusBadge(allowed ? 'مسموح' : 'مرفوض', allowed ? 'active' : 'blocked')}</div>
        <ul class="list-disc pr-5 space-y-1">${reasonList}</ul>
        <details class="mt-3 text-xs text-slate-500">
          <summary>القرار الخام (JSON)</summary>
          <pre class="mt-2 overflow-x-auto" dir="ltr">${kit.esc(JSON.stringify(decision, null, 2))}</pre>
        </details>
      </div>
    `;
  }

  function renderSimulationTab() {
    const kit = K();
    let resultHtml = '';
    if (state.simulating) {
      resultHtml = `<div class="text-sm text-slate-500 p-4">جاري تقييم الصلاحية عبر المُقيِّم المرجعي...</div>`;
    } else if (state.simulationError) {
      resultHtml = `<div class="rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700">${kit.esc(state.simulationError)}</div>`;
    } else if (state.simulation) {
      resultHtml = decisionHtml(state.simulation);
    }

    return `
      <div class="rounded-lg border border-slate-200 p-4 space-y-3 max-w-2xl">
        <p class="text-sm text-slate-600">تقييم فعلي عبر <span dir="ltr">/api/v1/permissions/explain</span> — استعلام قراءة فقط، لا يغيّر أي حالة.</p>
        <label class="block text-sm">
          <span class="text-slate-600">رمز الصلاحية (إلزامي)</span>
          <input id="pcSimPermission" type="text" dir="ltr" placeholder="control:admin"
            class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-600">لحساب مستخدم آخر (اختياري)</span>
          <input id="pcSimUser" type="text" dir="ltr" placeholder="user-id"
            class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-600">كيان / مبلغ (اختياري، مفصولة بفاصلة)</span>
          <input id="pcSimContext" type="text" dir="ltr" placeholder="entity,10000"
            class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
        </label>
        <button class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition"
          onclick="OctagonPermissionCenter.runSimulation()">تشغيل المحاكاة</button>
      </div>
      <div class="mt-4 max-w-2xl">${resultHtml}</div>
    `;
  }

  function render() {
    const kit = K();
    const b = body();
    if (!b || !kit) return;

    if (state.error) {
      kit.renderState(b, kit.STATES.BACKEND_FAILURE, {
        title: 'تعذر تحميل مركز الصلاحيات',
        subtitle: state.error,
        onRetry: 'OctagonPermissionCenter.reload()',
      });
      return;
    }

    let tabContent = '';
    if (state.activeTab === 'roles') tabContent = renderRolesTab();
    else if (state.activeTab === 'permissions') tabContent = renderPermissionsTab();
    else if (state.activeTab === 'scopes') tabContent = renderScopesTab();
    else if (state.activeTab === 'simulation') tabContent = renderSimulationTab();

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
    navId: 'navPermissionCenter',
    activate,
  });

  root.OctagonPermissionCenter = {
    reload: loadData,
    switchTab: function (tabId) {
      state.activeTab = tabId;
      render();
    },
    runSimulation: async function () {
      const permission = (document.getElementById('pcSimPermission') || {}).value || '';
      const forUser = (document.getElementById('pcSimUser') || {}).value || '';
      const context = (document.getElementById('pcSimContext') || {}).value || '';
      state.simulating = true;
      state.simulation = null;
      state.simulationError = null;
      render();
      try {
        if (!permission.trim()) throw new Error('رمز الصلاحية إلزامي');
        const params = new URLSearchParams({ permission: permission.trim() });
        if (forUser.trim()) params.set('for_user_id', forUser.trim());
        const [entity, amount] = context.split(',').map((s) => s.trim());
        if (entity) params.set('entity', entity);
        if (amount) params.set('amount', amount);
        const res = await fetch(`/api/v1/permissions/explain?${params.toString()}`);
        const json = await res.json();
        if (!res.ok || json.error) throw new Error(json.error?.message || json.error || `HTTP ${res.status}`);
        state.simulation = json.data;
      } catch (err) {
        state.simulationError = err.message || 'فشلت المحاكاة';
      } finally {
        state.simulating = false;
        render();
      }
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
