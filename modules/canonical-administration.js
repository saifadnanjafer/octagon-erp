(function (root) {
  'use strict';

  root.__canonicalAdministrationAuthorityActive = true;

  const areas = [
    ['companies', 'الشركات', 'Companies', 'fa-building'],
    ['branches', 'الفروع', 'Branches', 'fa-code-branch'],
    ['users', 'المستخدمون', 'Users', 'fa-users'],
    ['roles', 'الأدوار', 'Roles', 'fa-user-shield'],
    ['permissions', 'الصلاحيات', 'Permissions', 'fa-key'],
    ['data-scopes', 'نطاقات البيانات', 'Data Scopes', 'fa-crosshairs'],
    ['modules', 'الوحدات', 'Modules', 'fa-cubes'],
    ['feature-flags', 'ميزات النظام', 'Feature Flags', 'fa-toggle-on'],
    ['packages', 'الحزم', 'Packages', 'fa-box-open'],
    ['licensing', 'التراخيص', 'Licensing', 'fa-certificate'],
    ['settings', 'الإعدادات', 'Settings', 'fa-sliders'],
    ['numbering-sequences', 'تسلسل الترقيم', 'Numbering Sequences', 'fa-arrow-down-1-9'],
    ['integrations', 'التكاملات', 'Integrations', 'fa-plug'],
    ['api-keys', 'مفاتيح API', 'API Keys', 'fa-code'],
    ['jobs', 'الوظائف', 'Jobs', 'fa-clock-rotate-left'],
    ['audit', 'التدقيق', 'Audit', 'fa-clipboard-check'],
    ['health', 'الصحة', 'Health', 'fa-heart-pulse'],
    ['backups', 'النسخ الاحتياطية', 'Backups', 'fa-database'],
    ['localization', 'التوطين', 'Localization', 'fa-earth-asia'],
  ];

  const state = {
    active: 'modules',
    loading: false,
    error: null,
    notice: null,
    overview: {},
    companies: [],
    rows: [],
    modules: [],
  };

  function language() {
    return String(document.documentElement.lang || 'ar').toLowerCase().startsWith('ar') ? 'ar' : 'en';
  }
  function tx(ar, en) { return language() === 'ar' ? ar : en; }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[char]));
  }
  function api() {
    if (!root.CanonicalClient?.controlPlane) throw new Error('Canonical Control Plane client is unavailable');
    return root.CanonicalClient.controlPlane;
  }
  function host() { return document.getElementById('pageAdminPanel'); }
  function bool(value) { return value === true || value === 1 || value === '1'; }
  function normalizeError(error) {
    if (error?.isAuthorization || [401, 403].includes(Number(error?.status))) {
      return tx('ليس لديك صلاحية إدارة منصة التحكم.', 'You are not authorized to administer the Control Plane.');
    }
    return error?.message || tx('تعذر تنفيذ طلب الإدارة.', 'The Administration request failed.');
  }
  function badge(value) {
    const key = String(value == null ? '' : value).toLowerCase();
    const tone = /active|enabled|healthy|ok|granted|ready|verified/.test(key)
      ? 'good' : /warning|trial|queued|installed/.test(key) ? 'warn' : /blocked|expired|failed|denied|unlicensed|suspended/.test(key) ? 'bad' : 'muted';
    return `<span class="cadm-badge ${tone}">${esc(value == null ? '—' : value)}</span>`;
  }
  function valueCell(value) {
    if (value == null || value === '') return '—';
    if (typeof value === 'boolean' || value === 0 || value === 1) return badge(bool(value) ? tx('نعم', 'Yes') : tx('لا', 'No'));
    if (Array.isArray(value)) return esc(value.join(', '));
    if (typeof value === 'object') return esc(value.code || value.status || JSON.stringify(value));
    return esc(value);
  }
  function genericTable(rows) {
    if (!rows.length) {
      return `<div class="cadm-empty"><i class="fa-regular fa-folder-open"></i><h3>${tx('لا توجد سجلات', 'No records')}</h3><p>${tx('المصدر القانوني جاهز ولا توجد بيانات ضمن النطاق الحالي.', 'The canonical source is ready and has no records in the active scope.')}</p></div>`;
    }
    const preferred = [
      'id', 'name', 'module_id', 'company_id', 'branch_id', 'login', 'status',
      'kind', 'action', 'resource', 'key', 'plan', 'package_status', 'scope',
      'enabled', 'version', 'updated_at', 'occurred_at',
    ];
    const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    const columns = [...preferred.filter((key) => keys.includes(key)), ...keys.filter((key) => !preferred.includes(key))].slice(0, 8);
    return `<div class="cadm-table-wrap"><table><thead><tr>${columns.map((key) => `<th>${esc(key.replaceAll('_', ' '))}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((key) => `<td>${valueCell(row[key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function moduleCard(module) {
    const access = module.access || {};
    const enabled = module.status === 'enabled';
    const navVisible = (module.navigation || []).some((item) => item.visible);
    const protectedCore = module.id === 'platform_kernel';
    return `<article class="cadm-module ${access.allowed ? 'enabled' : 'blocked'}" data-admin-module="${esc(module.id)}">
      <header><div><span>${esc(module.kind)} · v${esc(module.version)}</span><h3>${esc(module.name)}</h3><code>${esc(module.id)}</code></div>${badge(module.health)}</header>
      <div class="cadm-module-facts">
        <span>${tx('الحالة', 'Status')}<b>${esc(module.status)}</b></span>
        <span>${tx('الوصول', 'Access')}<b data-module-access="${esc(module.id)}">${esc(access.code || '—')}</b></span>
        <span>${tx('الترخيص', 'License')}<b>${esc(access.license?.status || 'inherited')}</b></span>
        <span>${tx('الإعداد', 'Configuration')}<b>${Number(module.missing_configuration || 0) ? `${module.missing_configuration} missing` : 'ready'}</b></span>
      </div>
      <div class="cadm-deps"><i class="fa-solid fa-diagram-project"></i>${esc((module.dependencies || []).join(' → ') || tx('لا اعتماديات', 'No dependencies'))}</div>
      <div class="cadm-nav-preview" data-module-nav="${esc(module.id)}" ${navVisible ? '' : 'hidden'}>
        <i class="fa-regular fa-eye"></i>${tx('ظاهر في معاينة التنقل', 'Visible in navigation preview')}
      </div>
      <div class="cadm-module-actions">
        <button data-module-toggle="${esc(module.id)}" data-enabled="${enabled ? '1' : '0'}" ${protectedCore ? 'disabled' : ''}>
          <i class="fa-solid ${enabled ? 'fa-toggle-on' : 'fa-toggle-off'}"></i>${enabled ? tx('تعطيل', 'Disable') : tx('تفعيل', 'Enable')}
        </button>
        <button data-module-assign="${esc(module.id)}"><i class="fa-solid fa-building-circle-check"></i>${tx('إسناد للشركة', 'Assign company')}</button>
        <select data-module-license="${esc(module.id)}">
          ${['active', 'trial', 'unlicensed', 'expired', 'suspended'].map((status) => `<option value="${status}" ${access.license?.status === status ? 'selected' : ''}>${status}</option>`).join('')}
        </select>
        ${module.id === 'checkpoint_c_test_module' ? `<button class="cadm-ping" data-module-ping><i class="fa-solid fa-satellite-dish"></i>${tx('اختبار وصول الخادم', 'Server access test')}</button>` : ''}
      </div>
      ${module.configuration_url ? `<a class="cadm-config-link" href="${esc(module.configuration_url)}"><i class="fa-solid fa-arrow-up-right-from-square"></i>${tx('فتح الإعداد', 'Open configuration')}</a>` : ''}
    </article>`;
  }
  function modulesView() {
    return `<section class="cadm-modules">
      <div class="cadm-section-head"><div><h2>${tx('إدارة الوحدات والتراخيص', 'Module and license control')}</h2><p>${tx('القرارات تنفذ على الخادم مع فحص الاعتماديات والنطاق والترخيص.', 'Server-enforced dependency, scope, and license decisions.')}</p></div><div class="cadm-legend">${badge('healthy')}${badge('warning')}${badge('blocked')}</div></div>
      <div class="cadm-module-grid">${state.modules.map(moduleCard).join('')}</div>
    </section>`;
  }
  function featureView() {
    if (!state.rows.length) return genericTable([]);
    return `<div class="cadm-feature-list">${state.rows.map((flag) => `<article data-admin-feature="${esc(flag.key)}"><div><h3>${esc(flag.key)}</h3><span>${esc(flag.module_id)} · ${esc(flag.scope)}</span></div><button data-feature-toggle="${esc(flag.key)}" data-module="${esc(flag.module_id)}" data-enabled="${bool(flag.enabled) ? '1' : '0'}">${badge(bool(flag.enabled) ? 'enabled' : 'disabled')}</button></article>`).join('')}</div>`;
  }
  function activeBody() {
    if (state.loading) return `<div class="cadm-loading"><i class="fa-solid fa-spinner fa-spin"></i>${tx('تحميل حقائق منصة التحكم…', 'Loading Control Plane facts…')}</div>`;
    if (state.active === 'modules') return modulesView();
    if (state.active === 'feature-flags') return featureView();
    return `<section class="cadm-generic"><div class="cadm-section-head"><div><h2>${esc(areas.find(([key]) => key === state.active)?.[language() === 'ar' ? 1 : 2] || state.active)}</h2><p>${tx('قراءة آمنة ومحددة النطاق من السلطة القانونية.', 'Safe, scoped read from the canonical authority.')}</p></div><span>${state.rows.length} ${tx('سجل', 'records')}</span></div>${genericTable(state.rows)}</section>`;
  }
  function markup() {
    const overview = state.overview || {};
    return `<div class="cadm-shell" dir="${language() === 'ar' ? 'rtl' : 'ltr'}">
      <header class="cadm-hero"><div><span>CHECKPOINT C5 · CONTROL PLANE</span><h1><i class="fa-solid fa-shield-halved"></i>${tx('الإدارة والتحكم بالوحدات', 'Administration & Module Control')}</h1><p>${tx('إدارة الهوية والنطاق والوحدات والميزات والتراخيص والصحة من منصة تحكم واحدة.', 'Identity, scope, modules, features, licensing, and health from one governed control plane.')}</p></div><button data-admin-refresh><i class="fa-solid fa-rotate"></i>${tx('تحديث', 'Refresh')}</button></header>
      <div class="cadm-kpis">
        <article><span>${tx('الشركات', 'Companies')}</span><b>${Number(overview.companies || 0)}</b></article>
        <article><span>${tx('الوحدات المتاحة', 'Accessible modules')}</span><b>${Number(overview.enabled_modules || 0)}</b></article>
        <article><span>${tx('تحذيرات الصحة', 'Health warnings')}</span><b>${Number(overview.unhealthy_modules || 0)}</b></article>
        <article><span>${tx('ميزات النظام', 'Feature flags')}</span><b>${Number(overview.feature_flags || 0)}</b></article>
      </div>
      <nav class="cadm-tabs">${areas.map(([key, ar, en, icon]) => `<button class="${state.active === key ? 'active' : ''}" data-admin-tab="${key}"><i class="fa-solid ${icon}"></i><span>${tx(ar, en)}</span></button>`).join('')}</nav>
      <div class="cadm-feedback" aria-live="polite">${state.notice ? `<div class="cadm-notice">${esc(state.notice)}</div>` : ''}${state.error ? `<div class="cadm-error">${esc(state.error)}</div>` : ''}</div>
      <main>${activeBody()}</main>
    </div>`;
  }
  function render() {
    const element = host();
    if (!element) return;
    element.classList.add('canonical-administration-page');
    element.innerHTML = markup();
    bind(element);
  }
  async function refresh() {
    state.loading = true; state.error = null; render();
    try {
      const [overview, companies, modules, rows] = await Promise.all([
        api().list('overview'),
        api().list('companies'),
        api().list('modules'),
        state.active === 'modules' ? Promise.resolve([]) : api().list(state.active),
      ]);
      state.overview = overview?.[0] || {};
      state.companies = companies || [];
      state.modules = modules || [];
      state.rows = state.active === 'modules' ? modules : rows || [];
    } catch (error) {
      state.error = normalizeError(error);
      state.rows = [];
      state.modules = [];
    } finally {
      state.loading = false; render();
    }
  }
  async function command(message, task) {
    state.loading = true; state.error = null; state.notice = null; render();
    try {
      await task();
      state.notice = message;
      await refresh();
      return true;
    } catch (error) {
      state.loading = false;
      state.error = normalizeError(error);
      render();
      return false;
    }
  }
  function setModuleStatus(moduleId, enabled) {
    return command(
      enabled ? tx('تم تفعيل الوحدة.', 'Module enabled.') : tx('تم تعطيل الوحدة.', 'Module disabled.'),
      () => api().setModuleStatus({ module_id: moduleId, enabled }),
    );
  }
  function assignModule(moduleId) {
    const company = state.companies[0];
    if (!company) return Promise.resolve(false);
    return command(tx('تم إسناد الوحدة للشركة.', 'Module assigned to company.'), () => api().assignModule({
      module_id: moduleId,
      scope_type: 'company',
      scope_id: company.id,
      enabled: true,
      navigation_visible: true,
      configuration_status: 'ready',
      configuration_url: '#admin_panel',
    }));
  }
  function setLicense(moduleId, status) {
    const company = state.companies[0];
    if (!company) return Promise.resolve(false);
    return command(tx('تم تحديث حالة الترخيص.', 'License status updated.'), () => api().setLicense({
      module_id: moduleId,
      company_id: company.id,
      status,
      plan: status === 'trial' ? 'trial' : 'octagon-enterprise',
      features: ['navigation', 'commands', 'reports'],
    }));
  }
  function testPing() {
    return command(tx('تم تأكيد الوصول من الخادم.', 'Server access confirmed.'), () => api().testPing());
  }
  function bind(element) {
    element.querySelector('[data-admin-refresh]')?.addEventListener('click', refresh);
    element.querySelectorAll('[data-admin-tab]').forEach((button) => button.addEventListener('click', () => {
      state.active = button.dataset.adminTab; state.notice = null; state.error = null; refresh();
    }));
    element.querySelectorAll('[data-module-toggle]').forEach((button) => button.addEventListener('click', () => {
      setModuleStatus(button.dataset.moduleToggle, button.dataset.enabled !== '1');
    }));
    element.querySelectorAll('[data-module-assign]').forEach((button) => button.addEventListener('click', () => assignModule(button.dataset.moduleAssign)));
    element.querySelectorAll('[data-module-license]').forEach((select) => select.addEventListener('change', () => setLicense(select.dataset.moduleLicense, select.value)));
    element.querySelector('[data-module-ping]')?.addEventListener('click', testPing);
    element.querySelectorAll('[data-feature-toggle]').forEach((button) => button.addEventListener('click', () => command(
      tx('تم تحديث الميزة.', 'Feature updated.'),
      () => api().setFeature({
        key: button.dataset.featureToggle,
        module_id: button.dataset.module,
        enabled: button.dataset.enabled !== '1',
      }),
    )));
  }
  function activate(tab = state.active) {
    document.querySelectorAll('.page').forEach((page) => page.classList.remove('page-active'));
    document.querySelectorAll('.nav-btn').forEach((button) => button.classList.remove('active'));
    host()?.classList.add('page-active');
    document.getElementById('navAdminPanel')?.classList.add('active');
    state.active = areas.some(([key]) => key === tab) ? tab : 'modules';
    root.currentPage = 'admin_panel';
    render();
    refresh();
  }
  function installRouteAuthority() {
    if (typeof root.switchPage !== 'function' || root.switchPage.__canonicalAdministrationFinalAuthority) return;
    const previous = root.switchPage;
    const canonical = function canonicalAdministrationSwitch(page) {
      if (page === 'admin_panel') {
        if (!host() && typeof root.ensurePageTemplateLoaded === 'function') {
          return Promise.resolve(root.ensurePageTemplateLoaded('admin_panel')).then(() => activate());
        }
        activate();
        return;
      }
      return previous.apply(this, arguments);
    };
    canonical.__canonicalAdministrationFinalAuthority = true;
    canonical.__canonicalAdministrationPreviousSwitch = previous;
    root.switchPage = canonical;
  }

  root.renderAdminPanel = activate;
  root.CanonicalAdministration = {
    activate, refresh, render, assignModule, setLicense, setModuleStatus, testPing,
    state, areas: areas.map(([key]) => key),
  };
  root.addEventListener?.('octagon:language-applied', render);
  root.addEventListener?.('octagon:canonical-changed', (event) => {
    if (event.detail?.domain === 'CONTROL_PLANE' && root.currentPage === 'admin_panel') refresh();
  });
  document.addEventListener('DOMContentLoaded', installRouteAuthority);
  root.addEventListener?.('load', installRouteAuthority);
  [0, 50, 250, 1000, 2500].forEach((delay) => setTimeout(installRouteAuthority, delay));
  installRouteAuthority();
})(window);
