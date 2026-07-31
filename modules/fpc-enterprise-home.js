(function (root) {
  'use strict';

  // ---------------------------------------------------------------------
  // Page 01 — Enterprise Home (`enterprise_home`).
  //
  // The universal landing surface after login: who you are, where you are,
  // what is waiting for you, and where to go next.
  //
  // This does NOT replace the existing `home` page. `home` is Octagon's
  // resume-launcher (it restores your last page and shows pinned tiles) and
  // stays the boot landing. `enterprise_home` is the role workspace: it reads
  // real facts and shows real work.
  //
  // AUTHORITY
  //   query    : canonical Work Items (/api/v1/work-items/*), the platform
  //              bootstrap (company/branch/navigation/actions), and the Wave 2
  //              domain descriptors.
  //   mutation : none. Every action on this page navigates; it never writes.
  //              Creating work happens on the page that owns that work.
  //
  // HONESTY RULE
  //   Every count on this page comes from a governed query or is rendered as
  //   "not available". There is no hardcoded KPI and no zero standing in for
  //   an unknown value — see OctagonPageKit.STATES.
  // ---------------------------------------------------------------------

  const PAGE_ID = 'enterprise_home';
  const HOST_ID = 'pageEnterpriseHome';
  const BODY_ID = 'enterpriseHomeBody';

  const state = {
    loading: false,
    error: null,
    myWork: { state: 'loading', rows: [] },
    recent: [],
    modules: { installed: 0, enabled: 0, unavailable: [] },
    context: { company: null, branch: null, user: null, roles: [] },
  };

  function K() { return root.OctagonPageKit; }
  function client() { return root.CanonicalClient || null; }
  function host() { return document.getElementById(HOST_ID); }
  function body() { return document.getElementById(BODY_ID); }

  function bootstrap() {
    return root.__octagonBootstrap || null;
  }

  /**
   * Read the acting user's context.
   *
   * Server-derived where the bootstrap provides it. This page never lets the
   * browser decide company or branch — it only DISPLAYS what the server said.
   */
  function readContext() {
    const b = bootstrap();
    const identity = (b && (b.identity || b.session || b.user)) || {};
    return {
      user: identity.name || identity.display_name || identity.user_id || null,
      company: (b && b.company && (b.company.name || b.company.id))
        || (identity.company_name || identity.company_id) || null,
      branch: (b && b.branch && (b.branch.name || b.branch.id))
        || identity.branch_name || null,
      roles: Array.isArray(identity.roles) ? identity.roles : [],
    };
  }

  function greeting() {
    const kit = K();
    const hour = new Date().getHours();
    if (hour < 12) return kit.tx('صباح الخير', 'Good morning');
    if (hour < 17) return kit.tx('طاب يومك', 'Good afternoon');
    return kit.tx('مساء الخير', 'Good evening');
  }

  /** Pages the user opened recently — local UX state, never a business fact. */
  function recentPages() {
    try {
      const raw = localStorage.getItem('octagon_recent_pages');
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.slice(0, 8) : [];
    } catch (_) {
      return [];
    }
  }

  function recordRecentPage(page) {
    if (!page || page === PAGE_ID) return;
    try {
      const list = recentPages().filter((p) => p !== page);
      list.unshift(page);
      localStorage.setItem('octagon_recent_pages', JSON.stringify(list.slice(0, 8)));
    } catch (_) { /* storage unavailable — recents are optional */ }
  }

  function pageLabel(page) {
    const btn = document.querySelector(`.nav-btn[data-page="${page}"] .nav-label`);
    return btn ? btn.textContent.trim() : page;
  }

  function canOpen(page) {
    return !root.PermissionService || root.PermissionService.checkPage(page);
  }

  // ---------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------

  async function loadMyWork() {
    const kit = K();
    const c = client();
    if (!c || !c.workItems) {
      return { state: kit.STATES.NOT_AVAILABLE, rows: [] };
    }
    // Assignment is resolved server-side from the session; the browser does
    // not get to ask "show me someone else's work".
    return kit.safeQuery(() => c.workItems.list({ assigned_to_me: 1, limit: 25 }));
  }

  async function loadModuleHealth() {
    const c = client();
    if (!c || !c.controlPlane) return { installed: 0, enabled: 0, unavailable: [] };
    try {
      const rows = await c.controlPlane.list('modules');
      const list = Array.isArray(rows) ? rows : [];
      return {
        installed: list.filter((m) => m.status === 'installed').length,
        enabled: list.filter((m) => m.status === 'enabled').length,
        unavailable: list.filter((m) => m.status === 'available').map((m) => m.id),
      };
    } catch (_) {
      // Not an error worth blocking the page for: module health is advisory
      // here. The Module & Pack Center is the page that must report it fully.
      return null;
    }
  }

  async function refresh() {
    state.loading = true;
    render();

    state.context = readContext();
    state.recent = recentPages();

    const [work, modules] = await Promise.all([loadMyWork(), loadModuleHealth()]);
    state.myWork = work;
    state.modules = modules;
    state.loading = false;
    render();
  }

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  const QUICK_LINKS = [
    { page: 'my_work', ar: 'أعمالي', en: 'My Work', icon: 'fa-list-check' },
    { page: 'unified_inbox', ar: 'صندوق الوارد والاعتمادات', en: 'Inbox & Approvals', icon: 'fa-inbox' },
    { page: 'command_center', ar: 'مركز القيادة', en: 'Command Center', icon: 'fa-diagram-project' },
    { page: 'executive_cockpit', ar: 'لوحة الإدارة التنفيذية', en: 'Executive Cockpit', icon: 'fa-gauge-high' },
    { page: 'global_search', ar: 'البحث الشامل', en: 'Global Search', icon: 'fa-magnifying-glass' },
    { page: 'finance', ar: 'المالية', en: 'Finance', icon: 'fa-building-columns' },
    { page: 'canonical_inventory', ar: 'المخزون', en: 'Inventory', icon: 'fa-boxes-stacked' },
    { page: 'projects', ar: 'المشاريع', en: 'Projects', icon: 'fa-diagram-successor' },
  ];

  function renderWorkSection() {
    const kit = K();
    if (state.loading) return kit.skeleton(4);
    if (state.myWork.state !== kit.STATES.POPULATED) {
      return kit.stateBlock(state.myWork.state, state.myWork.message);
    }
    return kit.grid(
      [
        { key: 'reference', labelAr: 'المرجع', labelEn: 'Reference', render: 'code' },
        { key: 'title', labelAr: 'العنوان', labelEn: 'Title' },
        { key: 'state', labelAr: 'الحالة', labelEn: 'State', render: 'badge' },
        { key: 'due_date', labelAr: 'الاستحقاق', labelEn: 'Due', render: 'date' },
      ],
      state.myWork.rows.slice(0, 8),
      { total: state.myWork.rows.length },
    );
  }

  function renderKpis() {
    const kit = K();
    const workCount = state.myWork.state === kit.STATES.POPULATED ? state.myWork.rows.length : null;
    const overdue = state.myWork.state === kit.STATES.POPULATED
      ? state.myWork.rows.filter((r) => r.due_date && new Date(r.due_date) < new Date()).length
      : null;

    return kit.kpiRow([
      {
        id: 'my-open-work', labelAr: 'أعمالي المفتوحة', labelEn: 'My open work',
        value: workCount, icon: 'fa-list-check', tone: 'info',
        sourceModule: 'work_item_canonical',
        explainAr: 'عدد بنود العمل المسندة إليك والتي لم تُغلق بعد.',
        explainEn: 'Work Items assigned to you that are not yet closed.',
        drillTo: 'my_work',
      },
      {
        id: 'my-overdue', labelAr: 'متأخر عن موعده', labelEn: 'Overdue',
        value: overdue, icon: 'fa-clock', tone: overdue ? 'warn' : 'neutral',
        sourceModule: 'work_item_canonical',
        explainAr: 'بنود عملك التي تجاوزت تاريخ الاستحقاق.',
        explainEn: 'Your Work Items past their due date.',
        drillTo: 'my_work',
      },
      {
        id: 'modules-enabled', labelAr: 'وحدات مفعّلة', labelEn: 'Enabled modules',
        value: state.modules ? state.modules.enabled : null,
        icon: 'fa-cubes', tone: 'neutral',
        sourceModule: 'control_plane',
        explainAr: 'الوحدات المفعّلة لشركتك الحالية.',
        explainEn: 'Modules enabled for your current company.',
        drillTo: 'module_pack_center',
      },
      {
        id: 'modules-installed', labelAr: 'وحدات مثبّتة غير مفعّلة', labelEn: 'Installed, not enabled',
        value: state.modules ? state.modules.installed : null,
        icon: 'fa-toggle-off', tone: 'neutral',
        sourceModule: 'control_plane',
        explainAr: 'مخططها موجود لكنها بحاجة إلى تفعيل من مركز الوحدات.',
        explainEn: 'Their schema exists but they need enabling in the Module Center.',
        drillTo: 'module_pack_center',
      },
    ]);
  }

  function renderQuickLinks() {
    const kit = K();
    const links = QUICK_LINKS.filter((l) => canOpen(l.page));
    if (!links.length) return kit.stateBlock(kit.STATES.PERMISSION_DENIED);
    return `<div class="fpc-tiles" data-fpc-tiles>
      ${links.map((l) => `<button type="button" class="fpc-tile" data-opk-drill="${kit.esc(l.page)}">
        <i class="fa-solid ${kit.esc(l.icon)}"></i>
        <span>${kit.esc(kit.tx(l.ar, l.en))}</span>
      </button>`).join('')}
    </div>`;
  }

  function renderRecent() {
    const kit = K();
    const items = state.recent.filter(canOpen);
    if (!items.length) {
      return kit.stateBlock(kit.STATES.EMPTY);
    }
    return `<div class="fpc-tiles" data-fpc-recent>
      ${items.map((p) => `<button type="button" class="fpc-tile fpc-tile-quiet" data-opk-drill="${kit.esc(p)}">
        <i class="fa-solid fa-clock-rotate-left"></i>
        <span>${kit.esc(pageLabel(p))}</span>
      </button>`).join('')}
    </div>`;
  }

  function render() {
    const el = body();
    if (!el) return;
    const kit = K();
    if (!kit) {
      el.innerHTML = '<p style="padding:24px">Page kit unavailable.</p>';
      return;
    }

    const ctx = state.context;
    el.innerHTML = `
      ${kit.header({
    titleAr: `${greeting()}${ctx.user ? '، ' + kit.esc(ctx.user) : ''}`,
    titleEn: `${greeting()}${ctx.user ? ', ' + kit.esc(ctx.user) : ''}`,
    subtitleAr: 'مساحة عملك: ما هو مسند إليك، ما ينتظر قرارك، وأين تذهب بعد ذلك.',
    subtitleEn: 'Your workspace: what is assigned to you, what awaits your decision, and where to go next.',
    icon: 'fa-house-chimney',
    context: { company: ctx.company, branch: ctx.branch },
    actions: [
      { id: 'refresh', labelAr: 'تحديث', labelEn: 'Refresh', icon: 'fa-rotate' },
      { id: 'open-inbox', labelAr: 'فتح صندوق الوارد', labelEn: 'Open Inbox', icon: 'fa-inbox', variant: 'primary' },
    ],
  })}
      ${renderKpis()}
      ${kit.section('أعمالي', 'My Work', renderWorkSection(), { id: 'my-work', icon: 'fa-list-check' })}
      ${kit.section('الانتقال السريع', 'Quick Access', renderQuickLinks(), { id: 'quick', icon: 'fa-bolt' })}
      ${kit.section('فُتحت مؤخراً', 'Recently Opened', renderRecent(), { id: 'recent', icon: 'fa-clock-rotate-left' })}
    `;

    kit.bind(el, {
      onAction(id) {
        if (id === 'refresh') refresh();
        if (id === 'open-inbox' && typeof root.switchPage === 'function') root.switchPage('unified_inbox');
      },
      onDrill(page) {
        if (typeof root.switchPage === 'function') root.switchPage(page);
      },
    });
  }

  function activate() {
    render();
    refresh();
  }

  root.renderEnterpriseHome = activate;
  root.FpcEnterpriseHome = { activate, refresh, state, PAGE_ID, recordRecentPage };

  // The shell hydrates views/<page>.html asynchronously, AFTER switchPage's
  // synchronous dispatch. Activating inside the wrapper — once the template
  // load has settled — makes the ordering deterministic instead of a race.
  // This is the established Octagon pattern (see modules/canonical-projects.js).


  // Track recently-opened pages for the "Recently Opened" tile row. This runs
  // for EVERY navigation, not only this page's, so it is wired separately from
  // the page mount.
  (function trackRecents() {
    if (root.__fpcRecentTrackerWrapped || typeof root.switchPage !== 'function') return;
    const orig = root.switchPage;
    root.switchPage = function (page) {
      recordRecentPage(page);
      return orig.apply(this, arguments);
    };
    root.__fpcRecentTrackerWrapped = true;
  }());
  // Mount into the original shell. OctagonPageKit.wirePage owns the whole
  // dance: permission gate, async template hydration, page/nav activation, and
  // nav-group opening. Doing it here rather than per-page is what keeps three
  // pages from drifting into three subtly different activation behaviours.
  OctagonPageKit.wirePage({
    pageId: PAGE_ID,
    sectionId: HOST_ID,
    navId: 'navEnterpriseHome',
    activate,
  });
})(window);
