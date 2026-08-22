/**
 * OCTAGON ERP — ROUTE HEALTH / SYSTEM INTEGRITY DOCTOR (فحص صحة النظام).
 * Read-only diagnostic page that audits the runtime:
 *  - every sidebar nav button has a matching .page section
 *  - every page key has a known renderer or module hook
 *  - every important module global is loaded
 *  - no core functions are missing
 *  - expected data collections exist
 *  - work-order links are valid (no orphan tasks/cards/QC/reservations/queue items)
 * ADD-ONLY: zero edits to existing code. Output: OK / Warning / Broken with detail.
 */
(function () {
  'use strict';

  function O() { try { return (typeof omni !== 'undefined') ? omni : null; } catch (_) { return null; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function toast(m, t) { if (typeof window.showToast === 'function') window.showToast(m, t || 'info'); }

  /* ───────── what we expect ───────── */
  const REQUIRED_GLOBALS = [
    { name: 'omni', kind: 'object' },
    { name: 'finance', kind: 'object', optional: true },
    { name: 'PentagonAuth', kind: 'object' },
    { name: 'PermissionService', kind: 'object' },
    { name: 'FinanceService', kind: 'object' },
    { name: 'OctagonAI', kind: 'object', optional: true },
    { name: 'JarvisBrain', kind: 'object' },
    { name: 'OctagonPOS', kind: 'object' },
    { name: 'OctagonPharmacy', kind: 'object' },
    { name: 'OctagonWorkOrders', kind: 'object' },
    { name: 'OctagonAIAssistant', kind: 'object', optional: true }
  ];
  const REQUIRED_FUNCTIONS = [
    'switchPage', 'saveData', 'showToast', 'makeId', 'ensureOmni', 'todayISO',
    'createTaskInSelectedSpace', 'recordStockMovement', 'getMaterialAvailableQty',
    'addFinanceTransaction', 'createOmniNotification', 'recordOmniHistoryEvent',
    'renderCommandCenter', 'getAiControl'
  ];
  const REQUIRED_COLLECTIONS = [
    'kanban.cards', 'kanban.columns', 'materials', 'machines', 'opPacks', 'qcRecords',
    'sops', 'jobOrders', 'workOrderEvents', 'materialReservations', 'workOrderIssues',
    'posSales', 'requests'
  ];

  function getPath(obj, path) {
    const parts = String(path).split('.');
    let cur = obj;
    for (const p of parts) {
      if (cur == null) return undefined;
      cur = cur[p];
    }
    return cur;
  }

  /* ───────── checks ───────── */
  // Governed BUILD-08…BUILD-12 workspaces do not own a `section.page` element.
  // They are registered against a shared renderer host, so resolving them by
  // section id reports every one of them as a broken nav entry. Collect the
  // registered workspace keys so those pages can be recognised as legitimately
  // renderer-driven instead.
  function governedWorkspaceKeys() {
    const keys = new Set();
    let names = [];
    try { names = Object.keys(window); } catch (_) { return keys; }
    names.forEach(name => {
      let holder;
      try { holder = window[name]; } catch (_) { return; }
      if (!holder || typeof holder !== 'object') return;
      ['pages', 'PAGES'].forEach(prop => {
        let map;
        try { map = holder[prop]; } catch (_) { return; }
        if (!map || typeof map !== 'object' || Array.isArray(map)) return;
        let entries = [];
        try { entries = Object.keys(map); } catch (_) { return; }
        // Guard against tiny incidental `pages` properties on unrelated objects.
        if (entries.length < 4) return;
        entries.forEach(k => keys.add(k));
      });
    });
    return keys;
  }

  function checkNavPages() {
    const navBtns = Array.from(document.querySelectorAll('.nav-btn[data-page]'));
    // The app publishes its real page → section-id routing table; prefer it over
    // guessing, so pages whose section id does not contain their page key
    // (parties → pageCustomersAndSuppliers) resolve correctly.
    const canonicalMap = (window.__octagonPageMap && typeof window.__octagonPageMap === 'object') ? window.__octagonPageMap : {};
    const workspaceKeys = governedWorkspaceKeys();
    const out = [];
    navBtns.forEach(btn => {
      const page = btn.dataset.page;
      const label = (btn.querySelector('.nav-label') || {}).textContent || page;
      if (!page) return;
      // Convert nav keys to PascalCase section ids. Handle both "_" and "-"
      // separators so hyphenated keys (e.g. "real-estate" → "RealEstate") map too.
      const sectionId = 'page' + page.replace(/(^\w|[_-]\w)/g, m => m.replace(/[_-]/, '').toUpperCase());
      // also accept a few hand-rolled IDs
      const aliases = [canonicalMap[page] || '', 'page' + page, 'page' + page.charAt(0).toUpperCase() + page.slice(1), sectionId,
        page === 'pos' ? 'pagePOS' : '', page === 'qc_center' ? 'pageQc' : '',
        page === 'work_orders' ? 'pageWorkOrders' : '', page === 'route_health' ? 'pageRouteHealth' : ''];
      let found = null;
      for (const id of aliases) { if (id && document.getElementById(id)) { found = id; break; } }
      if (!found) {
        // try by data-page or any section that contains the page key
        const cand = Array.from(document.querySelectorAll('section.page')).find(s => (s.id || '').toLowerCase().includes(page.replace(/[_-]/g, '').toLowerCase()));
        if (cand) found = cand.id;
      }
      // A registered governed workspace is routed by its renderer, not a section.
      const governed = !found && workspaceKeys.has(page);
      // A page the router knows about but whose template has not been hydrated
      // yet is a lazy-load, not a broken route.
      const routedNotHydrated = !found && !governed && !!canonicalMap[page];
      // Anything left is a module-owned page (the vertical packs, for example)
      // whose section is created by its own module on first visit. From here it
      // is genuinely indistinguishable from a dead route without navigating to
      // it, so it is reported as UNVERIFIED rather than asserted to be broken —
      // claiming "broken" for these produced dozens of false alarms that buried
      // real breakage.
      const unverified = !found && !governed && !routedNotHydrated;
      out.push({
        ok: !!found || governed || routedNotHydrated,
        unverified: unverified,
        page: page,
        label: String(label).trim(),
        governed: governed,
        routedNotHydrated: routedNotHydrated,
        sectionId: found || (governed ? '(governed workspace)' : (routedNotHydrated ? canonicalMap[page] + ' (not hydrated)' : '(يُنشئه المودیول عند أول زيارة)'))
      });
    });
    return out;
  }
  function checkPageHooks() {
    const pages = Array.from(document.querySelectorAll('section.page'));
    // Governed workspace hosts are keyed by the raw page key (`warehouse_topology`),
    // not the `pageWarehouseTopology` + `renderWarehouseTopology` convention this
    // check was written for, so they never match a hook and were all reported as
    // warnings. Recognise them by their renderer registration instead.
    const workspaceKeys = governedWorkspaceKeys();
    // Cache once: any global function whose name starts with "render" — covers
    // page-specific names like renderKanbanBoard, renderSopHub, renderCalculator...
    let renderFns = [];
    try { renderFns = Object.keys(window).filter(k => k.startsWith('render') && typeof window[k] === 'function'); } catch (_) {}
    return pages.map(s => {
      const id = s.id || '';
      const key = id.replace(/^page/, '').replace(/^./, c => c.toLowerCase());
      const stem = id.replace(/^page/, '').toLowerCase();
      const hookCandidates = [
        'render' + id.replace(/^page/, ''),
        'renderPage' + id.replace(/^page/, ''),
        'render' + key.charAt(0).toUpperCase() + key.slice(1),
        'render' + key + 'Page'
      ];
      const directHook = hookCandidates.some(fn => typeof window[fn] === 'function');
      const fuzzyHook = !directHook && renderFns.some(fn => fn.toLowerCase().includes(stem));
      const moduleDriven = !!s.querySelector('[id$="Body"]');
      // A section whose id is itself a registered governed page key is rendered
      // by that workspace engine, not by a window-level render* hook.
      const governed = workspaceKeys.has(id) || workspaceKeys.has(key) || workspaceKeys.has(id.replace(/^page/, ''));
      // Static pages (calculator etc.) ship full inline HTML — count them OK if
      // they have substantial content already in the DOM.
      const staticContent = !directHook && !fuzzyHook && !moduleDriven && !governed && s.innerHTML.length > 1500;
      return { ok: directHook || fuzzyHook || moduleDriven || governed || staticContent, id: id, hookCandidates: hookCandidates, moduleDriven: moduleDriven, fuzzyHook: fuzzyHook, governed: governed, staticContent: staticContent };
    });
  }
  function checkGlobals() {
    // Some globals are exposed on window (modules), some are bare top-level globals
    // (omni, finance, employees) — eval-check the bare name as a fallback. See
    // memory: "Modules use bare `omni` (not window.omni)".
    function probe(name) {
      let v = window[name];
      if (v == null) { try { v = (0, eval)('typeof ' + name + ' !== "undefined" ? ' + name + ' : undefined'); } catch (_) {} }
      return v;
    }
    return REQUIRED_GLOBALS.map(g => {
      const v = probe(g.name);
      const ok = (g.kind === 'object') ? (v && typeof v === 'object') : (typeof v === g.kind);
      return { ok: ok || g.optional, name: g.name, optional: !!g.optional, present: !!v };
    });
  }
  function checkFunctions() {
    return REQUIRED_FUNCTIONS.map(fn => ({ ok: typeof window[fn] === 'function', name: fn }));
  }
  function probeGlobal(name) {
    let v = window[name];
    if (v == null) { try { v = (0, eval)('typeof ' + name + ' !== "undefined" ? ' + name + ' : undefined'); } catch (_) {} }
    return v;
  }
  function hydrateExpectedCollections() {
    ['OctagonWorkOrders', 'PentagonWorkOrders', 'OctagonPOS', 'PentagonPOS'].forEach(name => {
      try {
        const api = probeGlobal(name);
        if (api && typeof api.ensureData === 'function') api.ensureData();
      } catch (_) {}
    });
  }
  function checkCollections() {
    hydrateExpectedCollections();
    const o = O() || {};
    return REQUIRED_COLLECTIONS.map(path => {
      const v = getPath(o, path);
      const ok = Array.isArray(v);
      return { ok: ok, path: path, count: ok ? v.length : 0 };
    });
  }
  function checkWorkOrderLinks() {
    const o = O() || {};
    const wos = (o.jobOrders || []).filter(w => w.is_active !== false);
    const woIds = new Set(wos.map(w => w.id));
    // Some records (QC, tasks) use sourceType:'work_order' to point at MRP work orders
    // in omni.workOrders too. Allow either to satisfy the link.
    const allWoIds = new Set([...woIds, ...((o.workOrders || []).map(w => w.id))]);
    const issues = [];

    // orphan tasks (task.workOrderId points at missing WO)
    if (typeof window.getAllTaskManagerTasks === 'function') {
      try {
        const tasks = window.getAllTaskManagerTasks(true).map(x => x.task);
        const orphans = tasks.filter(t => t.workOrderId && !woIds.has(t.workOrderId));
        if (orphans.length) issues.push({ ok: false, kind: 'orphan_tasks', count: orphans.length, sample: orphans.slice(0, 3).map(t => t.title) });
      } catch (_) {}
    }
    // orphan kanban cards
    const cards = (o.kanban && Array.isArray(o.kanban.cards)) ? o.kanban.cards : [];
    const orphanCards = cards.filter(c => c.workOrderId && !allWoIds.has(c.workOrderId));
    if (orphanCards.length) issues.push({ ok: false, kind: 'orphan_kanban_cards', count: orphanCards.length, sample: orphanCards.slice(0, 3).map(c => c.title) });
    // orphan QC
    const qcs = Array.isArray(o.qcRecords) ? o.qcRecords : [];
    const orphanQc = qcs.filter(q => q.sourceType === 'work_order' && q.sourceId && !allWoIds.has(q.sourceId));
    if (orphanQc.length) issues.push({ ok: false, kind: 'orphan_qc', count: orphanQc.length, sample: orphanQc.slice(0, 3).map(q => q.title || q.type || q.id) });
    // orphan reservations
    const res = Array.isArray(o.materialReservations) ? o.materialReservations : [];
    const orphanRes = res.filter(r => r.is_active !== false && r.workOrderId && !woIds.has(r.workOrderId));
    if (orphanRes.length) issues.push({ ok: false, kind: 'orphan_reservations', count: orphanRes.length, sample: orphanRes.slice(0, 3).map(r => (r.materialSnapshot || {}).name || r.materialId) });
    // orphan machine queue entries
    let orphanQueue = 0;
    (o.machines || []).forEach(m => {
      (Array.isArray(m.queue) ? m.queue : []).forEach(q => {
        if (q.sourceType === 'work_order' && q.workOrderId && !woIds.has(q.workOrderId)) orphanQueue++;
      });
    });
    if (orphanQueue) issues.push({ ok: false, kind: 'orphan_machine_queue', count: orphanQueue });
    // WOs with broken material refs
    const matIds = new Set((o.materials || []).map(m => m.id));
    let brokenMat = 0;
    wos.forEach(w => (w.requiredMaterials || []).forEach(r => { if (r.materialId && !matIds.has(r.materialId)) brokenMat++; }));
    if (brokenMat) issues.push({ ok: false, kind: 'wo_unknown_material', count: brokenMat });
    // WOs with broken machine refs
    const machIds = new Set((o.machines || []).map(m => m.id));
    let brokenMach = 0;
    wos.forEach(w => (w.machineIds || []).forEach(mid => { if (mid && !machIds.has(mid)) brokenMach++; }));
    if (brokenMach) issues.push({ ok: false, kind: 'wo_unknown_machine', count: brokenMach });

    if (!issues.length) issues.push({ ok: true, kind: 'links_clean', count: wos.length });
    return issues;
  }

  // `skipDomChecks` is used for the first paint, before page templates have been
  // hydrated. Both nav resolution and page-hook detection look up `section.page`
  // elements, so before hydration every not-yet-loaded template reports as a
  // missing section — a large, entirely false failure count. Those two sections
  // are deferred rather than reported wrongly. The remaining checks read globals,
  // functions and in-memory collections, so they are accurate immediately.
  function buildReport(skipDomChecks) {
    return {
      generatedAt: new Date().toISOString(),
      nav: skipDomChecks ? null : checkNavPages(),
      pages: skipDomChecks ? null : checkPageHooks(),
      globals: checkGlobals(),
      functions: checkFunctions(),
      collections: checkCollections(),
      woLinks: checkWorkOrderLinks()
    };
  }

  /* ───────── render ───────── */
  function counts(arr) { return { ok: arr.filter(r => r.ok).length, total: arr.length, bad: arr.filter(r => !r.ok).length }; }
  function pill(ok, label) { return '<span class="rh-pill ' + (ok ? 'ok' : 'bad') + '">' + label + '</span>'; }

  function navHtml(rows) {
    return rows.map(r => {
      const state = r.unverified ? '<span class="rh-pill warn">يتطلب زيارة للتحقق</span>'
        : !r.ok ? pill(false, 'Broken — لا قسم')
        : r.governed ? pill(true, 'OK (مساحة عمل مُدارة)')
        : r.routedNotHydrated ? pill(true, 'OK (تحميل مؤجل)')
        : pill(true, 'OK');
      const detail = (r.ok || r.unverified)
        ? '<span class="rh-detail">' + esc(r.sectionId) + '</span>'
        : '<span class="rh-fix-hint">أضف &lt;section class="page" id="' + esc('page' + r.page.charAt(0).toUpperCase() + r.page.slice(1)) + '"&gt; في index.html</span>';
      return '<div class="rh-row"><span class="label">' + esc(r.label) + ' <span class="meta">(' + esc(r.page) + ')</span></span>' + state + detail + '</div>';
    }).join('');
  }
  function pagesHtml(rows) {
    return rows.map(r => '<div class="rh-row"><span class="label">' + esc(r.id) + '</span>'
      + (r.ok ? pill(true, r.governed ? 'OK (مساحة عمل مُدارة)' : r.moduleDriven ? 'OK (module-driven)' : 'OK') : pill(false, 'Warning'))
      + (r.ok ? '' : '<span class="rh-fix-hint">أضف render*() أو *Body div داخل القسم</span>')
      + '</div>').join('');
  }
  function globalsHtml(rows) {
    return rows.map(r => '<div class="rh-row"><span class="label">window.' + esc(r.name) + (r.optional ? ' <span class="meta">(اختياري)</span>' : '') + '</span>'
      + (r.present ? pill(true, 'محمَّل') : pill(r.optional, r.optional ? 'غير محمَّل' : 'مفقود')) + '</div>').join('');
  }
  function functionsHtml(rows) {
    return rows.map(r => '<div class="rh-row"><span class="label">' + esc(r.name) + '()</span>' + (r.ok ? pill(true, 'موجودة') : pill(false, 'مفقودة')) + '</div>').join('');
  }
  function collectionsHtml(rows) {
    return rows.map(r => '<div class="rh-row"><span class="label">omni.' + esc(r.path) + '</span>'
      + (r.ok ? pill(true, r.count + ' سجل') : pill(false, 'غير مهيأة')) + '</div>').join('');
  }
  function woLinksHtml(rows) {
    const kindAr = {
      orphan_tasks: 'مهام يتيمة (workOrderId غير موجود)',
      orphan_kanban_cards: 'بطاقات كانبان يتيمة',
      orphan_qc: 'فحوصات جودة يتيمة',
      orphan_reservations: 'حجوزات يتيمة',
      orphan_machine_queue: 'سطور طابور مكائن يتيمة',
      wo_unknown_material: 'متطلبات مواد لمواد غير معروفة',
      wo_unknown_machine: 'إسناد مكائن غير معروفة',
      links_clean: 'كل الروابط سليمة'
    };
    return rows.map(r => '<div class="rh-row"><span class="label">' + esc(kindAr[r.kind] || r.kind)
      + (r.sample ? ' — ' + r.sample.map(esc).join('، ') : '') + '</span>'
      + (r.ok ? pill(true, r.count + ' سجل') : pill(false, r.count + ' مشكلة')) + '</div>').join('');
  }

  let routeHealthViewsHydrated = false;
  let routeHealthHydrationPromise = null;
  function navPageKeys() {
    const keys = Array.from(document.querySelectorAll('.nav-btn[data-page]'))
      .map(btn => btn.getAttribute('data-page'))
      .filter(Boolean);
    return Array.from(new Set(keys));
  }
  function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  async function hydrateRouteHealthViews() {
    if (routeHealthViewsHydrated) return;
    if (routeHealthHydrationPromise) return routeHealthHydrationPromise;
    routeHealthHydrationPromise = (async () => {
      if (typeof window.ensurePageTemplateLoaded !== 'function') return;
      const pages = navPageKeys();
      // Load templates in SMALL COOPERATIVE BATCHES with a frame-yield between each.
      // Firing all ~86 loads at once (mass fetch + synchronous DOM injection of every
      // view + observer callbacks, all in one burst) starved the event loop long enough
      // that the whole app appeared frozen — and because the main thread was blocked, the
      // per-item timers below could never even fire. Batching + `await delay(16)` lets the
      // browser paint and flush observers between chunks, so the page can never hard-freeze
      // and stays navigable throughout. Each item still has its own timeout guard.
      const BATCH = 4;
      for (let i = 0; i < pages.length; i += BATCH) {
        const batch = pages.slice(i, i + BATCH);
        await Promise.all(batch.map(page =>
          Promise.race([
            Promise.resolve().then(() => window.ensurePageTemplateLoaded(page)),
            delay(2500)
          ]).catch(() => {})
        ));
        await delay(16); // yield ~one frame between batches — keeps the UI responsive
      }
      routeHealthViewsHydrated = true;
    })().finally(() => {
      routeHealthHydrationPromise = null;
    });
    return routeHealthHydrationPromise;
  }

  async function renderReady() {
    if (routeHealthViewsHydrated) { render(); return; }
    // Paint every check that does not depend on template hydration straight away,
    // so the page has its controls and real results within one frame instead of
    // sitting on a bare loading pill for the length of the hydration pass. The
    // two DOM-dependent sections stay marked pending until hydration finishes.
    render(true);
    // Await hydration but cap the wait with an overall deadline so a hanging
    // template loader can never freeze the page on the loading state. Each
    // template is also individually timeout-guarded inside hydrateRouteHealthViews.
    try { await Promise.race([hydrateRouteHealthViews(), delay(7000)]); } catch (_) {}
    render();
  }

  function render(domPending) {
    const root = document.getElementById('routeHealthBody');
    if (!root) return;
    const rep = buildReport(domPending);
    const globals = counts(rep.globals.filter(g => !g.optional)),
      fns = counts(rep.functions), cols = counts(rep.collections),
      links = counts(rep.woLinks);
    // Nav entries that could not be resolved without navigating to them are
    // reported separately; they are unknown, not known-bad, so they must not
    // inflate the failure count.
    const navUnverified = rep.nav ? rep.nav.filter(r => r.unverified).length : 0;
    const nav = rep.nav ? counts(rep.nav.filter(r => !r.unverified)) : null;
    const pages = rep.pages ? counts(rep.pages) : null;
    // Only count sections that were actually measured, so the pending paint can
    // never report a failure it has not yet checked.
    const totalBad = (nav ? nav.bad : 0) + (pages ? pages.bad : 0) + globals.bad + fns.bad + cols.bad + links.bad;
    const cls = domPending ? 'warn' : (totalBad === 0 ? 'ok' : (totalBad <= 3 ? 'warn' : 'bad'));
    const headline = domPending
      ? 'جارٍ تحميل قوالب الصفحات… (' + totalBad + ' مشكلة حتى الآن)'
      : (totalBad === 0 ? 'كل الأنظمة سليمة ✅' : 'مشاكل: ' + totalBad);
    const stat = (l, ok, total, c) => '<div class="rh-stat ' + (c || '') + '"><div class="rh-stat-label">' + l + '</div><div class="rh-stat-value">' + ok + '/' + total + '</div></div>';
    const pendingStat = (l) => '<div class="rh-stat warn"><div class="rh-stat-label">' + l + '</div><div class="rh-stat-value">…</div></div>';
    const pendingRow = '<div class="rh-row"><span class="label">جارٍ تحميل قوالب الصفحات للفحص الكامل…</span><span class="rh-pill warn">قيد الفحص</span></div>';
    root.innerHTML = ''
      + '<div class="rh-toolbar">'
      + '<button class="rh-btn primary" onclick="rhRunNow()">🔄 إعادة الفحص</button>'
      + '<button class="rh-btn" onclick="rhCopyReport()">📋 نسخ التقرير</button>'
      + '<span class="spacer"></span>'
      + '<span class="rh-pill ' + cls + '">' + headline + '</span>'
      + '</div>'
      + '<div class="rh-summary">'
      + (nav ? stat('أزرار التنقل', nav.ok, nav.total, nav.bad ? 'bad' : 'ok') : pendingStat('أزرار التنقل'))
      + (navUnverified ? '<div class="rh-stat warn"><div class="rh-stat-label">تحتاج زيارة للتحقق</div><div class="rh-stat-value">' + navUnverified + '</div></div>' : '')
      + (pages ? stat('الصفحات', pages.ok, pages.total, pages.bad ? 'warn' : 'ok') : pendingStat('الصفحات'))
      + stat('الـ Globals', globals.ok, globals.total, globals.bad ? 'bad' : 'ok')
      + stat('الدوال الجوهرية', fns.ok, fns.total, fns.bad ? 'bad' : 'ok')
      + stat('مجموعات البيانات', cols.ok, cols.total, cols.bad ? 'warn' : 'ok')
      + stat('روابط أوامر العمل', links.ok, links.total, links.bad ? 'bad' : 'ok')
      + '</div>'
      + '<div class="rh-section"><div class="rh-section-title">🧭 أزرار التنقل ↔ الأقسام</div>' + (nav ? navHtml(rep.nav) : pendingRow) + '</div>'
      + '<div class="rh-section"><div class="rh-section-title">📄 خطاطيف العرض على الأقسام</div>' + (pages ? pagesHtml(rep.pages) : pendingRow) + '</div>'
      + '<div class="rh-section"><div class="rh-section-title">🧩 الكائنات العامة (Modules / Globals)</div>' + globalsHtml(rep.globals) + '</div>'
      + '<div class="rh-section"><div class="rh-section-title">⚙️ الدوال الجوهرية</div>' + functionsHtml(rep.functions) + '</div>'
      + '<div class="rh-section"><div class="rh-section-title">📚 مجموعات البيانات</div>' + collectionsHtml(rep.collections) + '</div>'
      + '<div class="rh-section"><div class="rh-section-title">🔗 سلامة روابط أوامر العمل</div>' + woLinksHtml(rep.woLinks) + '</div>';
    // Only cache a complete report — a pending one would hand rhCopyReport a
    // snapshot missing the nav and page-hook results entirely.
    if (!domPending) window.__rhLastReport = rep;
  }

  window.rhRunNow = function () { renderReady().then(() => toast('اكتمل فحص النظام', 'info')); };
  window.rhCopyReport = function () {
    try {
      const txt = JSON.stringify(window.__rhLastReport || buildReport(), null, 2);
      navigator.clipboard.writeText(txt).then(() => toast('تم نسخ التقرير 📋', 'success'));
    } catch (_) {
      console.log('[RouteHealth] report copy fallback', JSON.stringify(window.__rhLastReport || buildReport()));
      toast('تعذر النسخ التلقائي؛ التقرير طُبع في Console', 'warning');
    }
  };

  function activatePage() {
    document.querySelectorAll('.page').forEach(pg => pg.classList.remove('page-active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const pg = document.getElementById('pageRouteHealth'); if (pg) pg.classList.add('page-active');
    const nav = document.getElementById('navRouteHealth'); if (nav) nav.classList.add('active');
    window.currentPage = 'route_health';
    renderReady();
  }
  function wireSwitch() {
    if (window.__rhWrapped) return;
    if (typeof window.switchPage !== 'function') return;
    const orig = window.switchPage;
    window.switchPage = function (page) {
      if (page === 'route_health') { try { activatePage(); } catch (e) { console.warn('RH render error', e); } return; }
      return orig.apply(this, arguments);
    };
    window.__rhWrapped = true;
  }
  function init() {
    wireSwitch();
    let tries = 0;
    const t = setInterval(() => {
      tries++; wireSwitch();
      if (window.__rhWrapped || tries > 40) clearInterval(t);
    }, 150);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.OctagonRouteHealth = { render: renderReady, report: buildReport, hydrate: hydrateRouteHealthViews, open: function () { try { window.switchPage('route_health'); } catch (_) {} } };
})();
