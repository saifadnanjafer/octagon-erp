(function (root) {
  'use strict';

  // ---------------------------------------------------------------------
  // Page 07 — Module & Pack Center (`module_pack_center`).
  //
  // Control Plane authority for module activation, feature flag toggles,
  // licensing, and branch scope assignments.
  // ---------------------------------------------------------------------

  const PAGE_ID = 'module_pack_center';
  const HOST_ID = 'pageModulePackCenter';
  const BODY_ID = 'modulePackCenterBody';

  const state = {
    loading: false,
    error: null,
    activeTab: 'modules',
    overview: null,
    modules: [],
    featureFlags: [],
    licensing: [],
    filters: {
      search: '',
      status: 'all',
      kind: 'all',
    },
  };

  function K() { return root.OctagonPageKit; }
  function host() { return document.getElementById(HOST_ID); }
  function body() { return document.getElementById(BODY_ID); }

  async function apiQuery(resource) {
    try {
      const res = await fetch(`/api/v1/control-plane/${resource}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return json.data || [];
    } catch (e) {
      console.warn(`[ModulePackCenter] Query ${resource} failed:`, e);
      return [];
    }
  }

  async function apiAction(actionId, payload) {
    try {
      const res = await fetch('/api/v1/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action_id: actionId,
          payload: payload,
          idempotency_key: `mpc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error?.message || json.error || `HTTP ${res.status}`);
      }
      return json.data || json.result;
    } catch (e) {
      alert(`فشلت العملية: ${e.message}`);
      throw e;
    }
  }

  async function loadData() {
    state.loading = true;
    const kit = K();
    const b = body();
    if (b && kit) kit.renderState(b, kit.STATES.LOADING, { title: 'جاري تحميل الموديلات والتراخيص...' });

    try {
      const [overviewData, modulesData, flagsData, licenseData] = await Promise.all([
        apiQuery('overview'),
        apiQuery('modules'),
        apiQuery('feature-flags'),
        apiQuery('licensing'),
      ]);

      state.overview = Array.isArray(overviewData) ? overviewData[0] : overviewData;
      state.modules = Array.isArray(modulesData) ? modulesData : [];
      state.featureFlags = Array.isArray(flagsData) ? flagsData : [];
      state.licensing = Array.isArray(licenseData) ? licenseData : [];
      state.error = null;
    } catch (err) {
      state.error = err.message || 'فشل تحميل معلومات الكنترول بلين';
    } finally {
      state.loading = false;
      render();
    }
  }

  async function toggleModuleStatus(moduleId, currentEnabled) {
    const targetStatus = !currentEnabled;
    const actionName = targetStatus ? 'تفعيل' : 'تعطيل';
    if (!confirm(`هل أنت تأكد من رغبتك في ${actionName} الموديل "${moduleId}"؟`)) return;

    try {
      await apiAction('control:module:set_status', {
        module_id: moduleId,
        enabled: targetStatus,
      });
      await loadData();
    } catch (_) { /* handled in apiAction */ }
  }

  async function toggleFeatureFlag(key, currentEnabled) {
    const targetStatus = !currentEnabled;
    try {
      await apiAction('control:feature:set', {
        key: key,
        enabled: targetStatus,
      });
      await loadData();
    } catch (_) { /* handled in apiAction */ }
  }

  function filteredModules() {
    return state.modules.filter((m) => {
      const q = state.filters.search.toLowerCase().trim();
      if (q && !m.name.toLowerCase().includes(q) && !m.id.toLowerCase().includes(q)) return false;

      if (state.filters.status === 'enabled' && !m.access?.allowed) return false;
      if (state.filters.status === 'installed' && m.access?.allowed) return false;
      if (state.filters.status === 'warning' && m.health === 'healthy') return false;

      if (state.filters.kind !== 'all' && m.kind !== state.filters.kind) return false;

      return true;
    });
  }

  function renderKPIs() {
    const overview = state.overview || {};
    const totalEl = document.getElementById('mpcValTotal');
    const enabledEl = document.getElementById('mpcValEnabled');
    const blockedEl = document.getElementById('mpcValBlocked');
    const flagsEl = document.getElementById('mpcValFlags');

    if (totalEl) totalEl.textContent = state.modules.length || overview.modules || 0;
    if (enabledEl) enabledEl.textContent = state.modules.filter((m) => m.access?.allowed).length || overview.enabled_modules || 0;
    if (blockedEl) blockedEl.textContent = state.modules.filter((m) => m.health !== 'healthy').length || overview.unhealthy_modules || 0;
    if (flagsEl) flagsEl.textContent = state.featureFlags.length || overview.feature_flags || 0;
  }

  function renderModulesTab() {
    const container = document.getElementById('mpcModulesContainer');
    if (!container) return;

    const list = filteredModules();
    if (!list.length) {
      container.innerHTML = `
        <div class="fpc-empty-state" style="grid-column: 1 / -1; text-align: center; padding: 40px;">
          <i class="fa-solid fa-folder-open" style="font-size: 3rem; color: #9ca3af; margin-bottom: 12px;"></i>
          <h4>لا توجد موديلات مطابقة للفلاتر</h4>
          <p>جرّب تعديل نتائج البحث أو اختيار حالة مختلفة</p>
        </div>
      `;
      return;
    }

    container.innerHTML = list.map((m) => {
      const isKernel = m.id === 'platform_kernel';
      const isEnabled = !!(m.access && m.access.allowed);
      const badgeClass = isEnabled ? 'fpc-badge-success' : 'fpc-badge-neutral';
      const badgeText = isEnabled ? 'مفعل (Enabled)' : 'مثبت (Installed)';
      const healthClass = m.health === 'healthy' ? 'text-green-600' : m.health === 'warning' ? 'text-amber-500' : 'text-red-500';

      const deps = Array.isArray(m.dependencies) ? m.dependencies : [];
      const depsHtml = deps.length
        ? `<div class="fpc-mod-deps"><strong>المتطلبات:</strong> ${deps.join(', ')}</div>`
        : '';

      return `
        <div class="fpc-module-card ${isEnabled ? 'enabled' : ''}" data-module-id="${m.id}">
          <div class="fpc-mod-header">
            <div>
              <span class="fpc-badge ${badgeClass}">${badgeText}</span>
              <span class="fpc-mod-kind">${m.kind || 'general'}</span>
            </div>
            <span class="fpc-mod-version">v${m.version || '1.0.0'}</span>
          </div>

          <div class="fpc-mod-body">
            <h4 class="fpc-mod-title">${m.name}</h4>
            <div class="fpc-mod-code"><code>${m.id}</code></div>
            ${depsHtml}
          </div>

          <div class="fpc-mod-footer">
            <div class="fpc-mod-health ${healthClass}">
              <i class="fa-solid fa-heart-pulse"></i> ${m.health || 'normal'}
            </div>

            ${isKernel ? `
              <span class="oct-btn oct-btn-disabled" title="موديل النواة محمي من التعطيل">
                <i class="fa-solid fa-lock"></i> نواة النظام
              </span>
            ` : `
              <button class="oct-btn ${isEnabled ? 'oct-btn-danger' : 'oct-btn-primary'} mpc-toggle-btn"
                data-id="${m.id}" data-enabled="${isEnabled ? 'true' : 'false'}">
                ${isEnabled ? '<i class="fa-solid fa-power-off"></i> تعطيل' : '<i class="fa-solid fa-bolt"></i> تفعيل الموديل'}
              </button>
            `}
          </div>
        </div>
      `;
    }).join('');

    // Attach click events
    container.querySelectorAll('.mpc-toggle-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const enabled = e.currentTarget.getAttribute('data-enabled') === 'true';
        toggleModuleStatus(id, enabled);
      });
    });
  }

  function renderFlagsTab() {
    const container = document.getElementById('mpcFlagsContainer');
    if (!container) return;

    if (!state.featureFlags.length) {
      container.innerHTML = `<p style="padding: 20px; text-align: center;">لا توجد مفاتيح ميزات مسجلة بالنظام</p>`;
      return;
    }

    container.innerHTML = `
      <table class="fpc-table">
        <thead>
          <tr>
            <th>مفتاح الميزة (Flag Key)</th>
            <th>الموديل</th>
            <th>النطاق</th>
            <th>الحالة</th>
            <th>الإجراء</th>
          </tr>
        </thead>
        <tbody>
          ${state.featureFlags.map((f) => `
            <tr>
              <td><code>${f.key}</code></td>
              <td>${f.module_id || 'platform_kernel'}</td>
              <td>${f.scope || 'company'}</td>
              <td>
                <span class="fpc-badge ${f.enabled ? 'fpc-badge-success' : 'fpc-badge-neutral'}">
                  ${f.enabled ? 'نشط (On)' : 'معطل (Off)'}
                </span>
              </td>
              <td>
                <button class="oct-btn oct-btn-sm ${f.enabled ? 'oct-btn-secondary' : 'oct-btn-primary'} mpc-flag-toggle"
                  data-key="${f.key}" data-enabled="${f.enabled ? 'true' : 'false'}">
                  ${f.enabled ? 'إيقاف' : 'تشغيل'}
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    container.querySelectorAll('.mpc-flag-toggle').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const key = e.currentTarget.getAttribute('data-key');
        const enabled = e.currentTarget.getAttribute('data-enabled') === 'true';
        toggleFeatureFlag(key, enabled);
      });
    });
  }

  function renderLicensesTab() {
    const container = document.getElementById('mpcLicensesContainer');
    if (!container) return;

    if (!state.licensing.length) {
      container.innerHTML = `<p style="padding: 20px; text-align: center;">جميع الموديلات تعمل تحت الرخصة الافتراضية للشركة</p>`;
      return;
    }

    container.innerHTML = `
      <table class="fpc-table">
        <thead>
          <tr>
            <th>الموديل</th>
            <th>الشركة</th>
            <th>الخطة (Plan)</th>
            <th>حالة الحزمة</th>
            <th>المقاعد</th>
            <th>صالح حتى</th>
          </tr>
        </thead>
        <tbody>
          ${state.licensing.map((l) => `
            <tr>
              <td><code>${l.module_id}</code></td>
              <td>${l.company_id}</td>
              <td>${l.plan || 'enterprise'}</td>
              <td>
                <span class="fpc-badge fpc-badge-success">${l.package_status || 'active'}</span>
              </td>
              <td>${l.seats || 'غير محدود'}</td>
              <td>${l.valid_until || 'دائم'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  function render() {
    const h = host();
    if (!h) return;

    renderKPIs();
    renderModulesTab();
    renderFlagsTab();
    renderLicensesTab();
  }

  function setupEvents() {
    const h = host();
    if (!h || h.dataset.eventsBound) return;
    h.dataset.eventsBound = 'true';

    // Refresh Button
    const refreshBtn = document.getElementById('mpcRefreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', loadData);

    // Tab buttons
    h.querySelectorAll('.fpc-tab-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const tab = e.currentTarget.getAttribute('data-tab');
        h.querySelectorAll('.fpc-tab-btn').forEach((b) => b.classList.remove('active'));
        e.currentTarget.classList.add('active');

        h.querySelectorAll('.fpc-tab-content').forEach((c) => {
          c.style.display = c.id === `mpcTab${tab.charAt(0).toUpperCase() + tab.slice(1)}` ? 'block' : 'none';
        });
        state.activeTab = tab;
      });
    });

    // Filters
    const searchInput = document.getElementById('mpcSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        state.filters.search = e.target.value;
        renderModulesTab();
      });
    }

    const statusFilter = document.getElementById('mpcStatusFilter');
    if (statusFilter) {
      statusFilter.addEventListener('change', (e) => {
        state.filters.status = e.target.value;
        renderModulesTab();
      });
    }

    const kindFilter = document.getElementById('mpcKindFilter');
    if (kindFilter) {
      kindFilter.addEventListener('change', (e) => {
        state.filters.kind = e.target.value;
        renderModulesTab();
      });
    }
  }

  function mount() {
    const kit = K();
    if (kit) kit.wirePage(PAGE_ID, HOST_ID, loadData);
    setupEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})(typeof window !== 'undefined' ? window : this);
