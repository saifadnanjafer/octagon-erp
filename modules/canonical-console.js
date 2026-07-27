(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Canonical Operations console — visible original-shell surface over the
  // canonical platform engines.
  //
  // Every list on this page is a real canonical query and every create is a
  // real canonical command, both issued through window.CanonicalClient:
  //
  //   GET  /api/v1/<namespace>/<resource>      (queries)
  //   POST /api/v1/action/<actionId>           (commands)
  //
  // This module holds NO domain logic. It does not compute balances,
  // availability, valuation or posting effects — those are read from the
  // canonical queries. It does not decide permissions or scope — the server
  // derives actor/tenant/company/branch from the session cookie and answers
  // 401/403 when it must.
  //
  // Bilingual: every label carries an Arabic and an English string and the
  // page re-renders on 'octagon:language-applied'.
  // ---------------------------------------------------------------------

  const root = window;

  function client() {
    return root.CanonicalClient || null;
  }

  function lang() {
    try {
      if (typeof root.getLang === 'function') return root.getLang();
    } catch (_) { /* fall through */ }
    return document.documentElement.getAttribute('lang') === 'en' ? 'en' : 'ar';
  }

  /** Pick the Arabic or English member of a {ar,en} pair. */
  function tx(pair) {
    if (!pair) return '';
    return lang() === 'en' ? (pair.en || pair.ar || '') : (pair.ar || pair.en || '');
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function num(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString(lang() === 'en' ? 'en-US' : 'ar-EG');
  }

  // -------------------------------------------------------------------
  // Domain definitions
  //
  // Each domain declares: how to read it, what columns to show, and which
  // canonical command creates a record. `cutoverDomain` is the Phase 04
  // retirement domain this surface belongs to, used only to display whether
  // the canonical engine is currently the active write authority.
  // -------------------------------------------------------------------

  const DOMAINS = [
    {
      key: 'products',
      icon: 'fa-boxes-stacked',
      label: { ar: 'المنتجات والمواد', en: 'Products & Materials' },
      cutoverDomain: 'COMMERCIAL',
      permission: 'inventory',
      load: (c) => c.products.list({ limit: 100 }),
      columns: [
        { key: 'name', label: { ar: 'الاسم', en: 'Name' } },
        { key: 'sku', label: { ar: 'الرمز', en: 'SKU' } },
        { key: 'tracking', label: { ar: 'التتبع', en: 'Tracking' } },
        { key: 'costing_method', label: { ar: 'طريقة التقييم', en: 'Costing' } },
      ],
      create: {
        actionId: 'product:template:create',
        label: { ar: 'منتج جديد', en: 'New product' },
        fields: [
          { key: 'name', label: { ar: 'الاسم', en: 'Name' }, required: true },
          { key: 'sku', label: { ar: 'الرمز', en: 'SKU' } },
        ],
        submit: (c, values) => c.products.createTemplate(values),
      },
    },
    {
      key: 'parties',
      icon: 'fa-handshake',
      label: { ar: 'العملاء والموردون', en: 'Customers & Suppliers' },
      cutoverDomain: 'COMMERCIAL',
      permission: 'customers',
      load: (c) => c.parties.list({ limit: 100 }),
      columns: [
        { key: 'name', label: { ar: 'الاسم', en: 'Name' } },
        { key: 'tax_id', label: { ar: 'الرقم الضريبي', en: 'Tax ID' } },
        { key: 'roles', label: { ar: 'الأدوار', en: 'Roles' } },
      ],
      create: {
        actionId: 'party:create',
        label: { ar: 'طرف جديد', en: 'New party' },
        fields: [
          { key: 'name', label: { ar: 'الاسم', en: 'Name' }, required: true },
          {
            key: 'roles', label: { ar: 'الدور', en: 'Role' }, type: 'select',
            options: [
              { value: 'customer', label: { ar: 'عميل', en: 'Customer' } },
              { value: 'supplier', label: { ar: 'مورد', en: 'Supplier' } },
            ],
          },
        ],
        submit: (c, values) => c.parties.create({
          name: values.name,
          roles: [values.roles || 'customer'],
        }),
      },
    },
    {
      key: 'inventory',
      icon: 'fa-warehouse',
      label: { ar: 'المخزون والمستودعات', en: 'Inventory & Warehouses' },
      cutoverDomain: 'INVENTORY',
      permission: 'inventory',
      load: (c) => c.stock.balances({ limit: 100 }),
      columns: [
        { key: 'product_id', label: { ar: 'المنتج', en: 'Product' } },
        { key: 'location_id', label: { ar: 'الموقع', en: 'Location' } },
        { key: 'quantity', label: { ar: 'المتوفر', en: 'On hand' }, numeric: true },
        { key: 'reserved_quantity', label: { ar: 'المحجوز', en: 'Reserved' }, numeric: true },
        { key: 'available_quantity', label: { ar: 'القابل للاستخدام', en: 'Available' }, numeric: true },
      ],
      // Quantities are read-only here on purpose: stock changes only through
      // an explicit governed lifecycle command, never through a grid edit.
      note: {
        ar: 'الأرصدة للقراءة فقط. تتغيّر الكميات فقط عبر أوامر حركة مخزنية محكومة.',
        en: 'Balances are read-only. Quantities change only through governed stock commands.',
      },
    },
    {
      key: 'warehouses',
      icon: 'fa-building',
      label: { ar: 'المستودعات', en: 'Warehouses' },
      cutoverDomain: 'INVENTORY',
      permission: 'inventory',
      load: (c) => c.warehouses.list({ limit: 100 }),
      columns: [
        { key: 'name', label: { ar: 'الاسم', en: 'Name' } },
        { key: 'code', label: { ar: 'الرمز', en: 'Code' } },
      ],
      create: {
        actionId: 'warehouse:create',
        label: { ar: 'مستودع جديد', en: 'New warehouse' },
        fields: [
          { key: 'name', label: { ar: 'الاسم', en: 'Name' }, required: true },
          { key: 'code', label: { ar: 'الرمز', en: 'Code' }, required: true },
        ],
        submit: (c, values) => c.warehouses.create(values),
      },
    },
    {
      key: 'sales',
      icon: 'fa-cart-shopping',
      label: { ar: 'المبيعات', en: 'Sales' },
      cutoverDomain: 'SALES',
      permission: 'sales',
      load: (c) => c.sales.listOrders({ limit: 100 }),
      columns: [
        { key: 'id', label: { ar: 'المعرّف', en: 'ID' } },
        { key: 'partner_id', label: { ar: 'العميل', en: 'Customer' } },
        { key: 'state', label: { ar: 'الحالة', en: 'State' } },
        { key: 'amount_total', label: { ar: 'الإجمالي', en: 'Total' }, numeric: true },
      ],
    },
    {
      key: 'procurement',
      icon: 'fa-truck-ramp-box',
      label: { ar: 'المشتريات', en: 'Procurement' },
      cutoverDomain: 'PROCUREMENT',
      permission: 'procurement',
      load: (c) => c.procurement.listOrders({ limit: 100 }),
      columns: [
        { key: 'id', label: { ar: 'المعرّف', en: 'ID' } },
        { key: 'partner_id', label: { ar: 'المورد', en: 'Supplier' } },
        { key: 'state', label: { ar: 'الحالة', en: 'State' } },
        { key: 'amount_total', label: { ar: 'الإجمالي', en: 'Total' }, numeric: true },
      ],
    },
    {
      key: 'pos',
      icon: 'fa-cash-register',
      label: { ar: 'نقطة البيع', en: 'Point of Sale' },
      cutoverDomain: 'POS',
      permission: 'pos',
      load: (c) => c.pos.listOrders({ limit: 100 }),
      columns: [
        { key: 'id', label: { ar: 'المعرّف', en: 'ID' } },
        { key: 'session_id', label: { ar: 'الجلسة', en: 'Session' } },
        { key: 'state', label: { ar: 'الحالة', en: 'State' } },
        { key: 'amount_total', label: { ar: 'الإجمالي', en: 'Total' }, numeric: true },
      ],
    },
    {
      key: 'work_items',
      icon: 'fa-list-check',
      label: { ar: 'إدارة العمل', en: 'Work Management' },
      cutoverDomain: 'WORK_ITEM',
      permission: 'task_manager',
      load: (c) => c.workItems.list({ limit: 100 }),
      columns: [
        { key: 'title', label: { ar: 'العنوان', en: 'Title' } },
        { key: 'status', label: { ar: 'الحالة', en: 'Status' } },
        { key: 'priority', label: { ar: 'الأولوية', en: 'Priority' } },
        { key: 'assignee_id', label: { ar: 'المسؤول', en: 'Assignee' } },
      ],
      create: {
        actionId: 'work_item:create',
        label: { ar: 'مهمة جديدة', en: 'New work item' },
        fields: [
          { key: 'title', label: { ar: 'العنوان', en: 'Title' }, required: true },
          {
            key: 'priority', label: { ar: 'الأولوية', en: 'Priority' }, type: 'select',
            options: [
              { value: 'low', label: { ar: 'منخفضة', en: 'Low' } },
              { value: 'normal', label: { ar: 'عادية', en: 'Normal' } },
              { value: 'high', label: { ar: 'عالية', en: 'High' } },
            ],
          },
        ],
        submit: (c, values) => c.workItems.create(values),
      },
    },
  ];

  let activeKey = DOMAINS[0].key;

  // -------------------------------------------------------------------
  // Permission gate — advisory only.
  //
  // The server is the authority and will answer 403 regardless. This hides
  // controls the current user cannot use so the UI does not invite a denial.
  // -------------------------------------------------------------------

  function mayAccess(domain) {
    // ADVISORY ONLY, AND FAIL-OPEN.
    //
    // The server is the permission authority: every query and command is
    // evaluated against the session-derived context and answered with 401/403
    // when it must be. This check exists purely so the UI does not invite a
    // denial it already knows about.
    //
    // It must never be the thing that blocks access. PermissionService reads
    // the LEGACY user store; a user authenticated canonically (session cookie)
    // has no legacy identity, so checkPage() returns false for everything and
    // an authoritative-looking gate here would hide the entire page from a
    // perfectly authorised user. That is exactly what happened before this
    // comment existed.
    //
    // So: hide a tab only when a legacy user is actually present AND that
    // legacy policy positively denies it. No legacy user, or no opinion, means
    // show the tab and let the server decide.
    try {
      const ps = root.PermissionService;
      if (!ps || typeof ps.checkPage !== 'function') return true;
      const legacyUserId = root.localStorage && root.localStorage.getItem
        ? root.localStorage.getItem('octagon_user_id')
        : null;
      if (!legacyUserId) return true;
      return ps.checkPage(domain.permission) !== false;
    } catch (_) {
      return true;
    }
  }

  // -------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------

  function renderAuthorityBanner() {
    const el = document.getElementById('ccAuthorityBanner');
    if (!el) return;
    const c = client();
    if (!c) {
      el.innerHTML = `<div class="cc-banner cc-banner-warn">${escapeHtml(tx({
        ar: 'طبقة العميل القانونية غير محمّلة.',
        en: 'Canonical client layer is not loaded.',
      }))}</div>`;
      return;
    }
    const status = c.cutoverStatus();
    const chips = c.PHASE04_DOMAINS.map((d) => {
      const on = !!(status.domains[d] && status.domains[d].enforced);
      const stateLabel = on
        ? tx({ ar: 'قانوني', en: 'canonical' })
        : tx({ ar: 'قديم', en: 'legacy' });
      return `<span class="cc-chip ${on ? 'cc-chip-on' : 'cc-chip-off'}" title="${escapeHtml(d)}">${escapeHtml(d)}: ${escapeHtml(stateLabel)}</span>`;
    }).join('');
    el.innerHTML = `
      <div class="cc-banner">
        <strong>${escapeHtml(tx({ ar: 'سلطة الكتابة الحالية', en: 'Current write authority' }))}:</strong>
        ${chips}
        <span class="cc-banner-note">${escapeHtml(tx({
          ar: 'يحدّدها الخادم — لا يمكن للمتصفح تغييرها.',
          en: 'Server-decided — the browser cannot change this.',
        }))}</span>
      </div>`;
  }

  function renderTabs() {
    const el = document.getElementById('ccTabs');
    if (!el) return;
    el.innerHTML = DOMAINS.filter(mayAccess).map((d) => `
      <button class="cc-tab ${d.key === activeKey ? 'active' : ''}"
              role="tab" type="button"
              aria-selected="${d.key === activeKey}"
              data-cc-tab="${escapeHtml(d.key)}">
        <i class="fa-solid ${escapeHtml(d.icon)}"></i>
        <span>${escapeHtml(tx(d.label))}</span>
      </button>`).join('');
  }

  function skeleton(message) {
    return `<div class="cc-state cc-state-loading"><i class="fa-solid fa-circle-notch fa-spin"></i> ${escapeHtml(message)}</div>`;
  }

  function errorState(err) {
    const c = client();
    const isAuth = err && (err.status === 401 || err.status === 403);
    const title = isAuth
      ? tx({ ar: 'الوصول مرفوض', en: 'Access denied' })
      : tx({ ar: 'تعذّر تحميل البيانات', en: 'Could not load data' });
    const hint = err && err.status === 401
      ? tx({ ar: 'سجّل الدخول أولاً — الهوية تُشتق من الخادم.', en: 'Sign in first — identity is derived server-side.' })
      : '';
    const code = err && err.code ? `<code class="cc-code">${escapeHtml(err.code)}</code>` : '';
    const corr = err && err.correlationId
      ? `<div class="cc-corr">${escapeHtml(tx({ ar: 'معرّف الارتباط', en: 'Correlation' }))}: <code>${escapeHtml(err.correlationId)}</code></div>`
      : '';
    return `
      <div class="cc-state cc-state-error">
        <div class="cc-state-title"><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(title)} ${code}</div>
        <div class="cc-state-msg">${escapeHtml(err && err.message ? err.message : String(err))}</div>
        ${hint ? `<div class="cc-state-hint">${escapeHtml(hint)}</div>` : ''}
        ${corr}
      </div>`;
  }

  function renderCreateForm(domain) {
    if (!domain.create) return '';
    const fields = domain.create.fields.map((f) => {
      if (f.type === 'select') {
        const opts = f.options.map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(tx(o.label))}</option>`).join('');
        return `<label class="cc-field"><span>${escapeHtml(tx(f.label))}</span>
          <select class="form-input" data-cc-field="${escapeHtml(f.key)}">${opts}</select></label>`;
      }
      return `<label class="cc-field"><span>${escapeHtml(tx(f.label))}${f.required ? ' *' : ''}</span>
        <input class="form-input" data-cc-field="${escapeHtml(f.key)}" ${f.required ? 'required' : ''}></label>`;
    }).join('');
    return `
      <form class="cc-create" id="ccCreateForm" data-cc-domain="${escapeHtml(domain.key)}">
        <div class="cc-create-fields">${fields}</div>
        <button class="btn btn-primary" type="submit">
          <i class="fa-solid fa-plus"></i> ${escapeHtml(tx(domain.create.label))}
        </button>
        <span class="cc-action-id" title="${escapeHtml(tx({ ar: 'الأمر القانوني المُنفَّذ', en: 'canonical command executed' }))}">
          ${escapeHtml(domain.create.actionId)}
        </span>
      </form>`;
  }

  function renderTable(domain, rows) {
    if (!Array.isArray(rows) || !rows.length) {
      return `<div class="cc-state cc-state-empty"><i class="fa-regular fa-folder-open"></i> ${escapeHtml(tx({
        ar: 'لا توجد سجلات بعد.', en: 'No records yet.',
      }))}</div>`;
    }
    const head = domain.columns.map((col) => `<th>${escapeHtml(tx(col.label))}</th>`).join('');
    const body = rows.map((row) => {
      const cells = domain.columns.map((col) => {
        let raw = row[col.key];
        if (Array.isArray(raw)) raw = raw.join(', ');
        const value = col.numeric ? num(raw) : (raw == null || raw === '' ? '—' : raw);
        return `<td class="${col.numeric ? 'cc-num' : ''}">${escapeHtml(value)}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<div class="cc-table-wrap"><table class="cc-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  // Render generation guard.
  //
  // renderPanel() is triggered from several places at once: page activation,
  // tab clicks, language switches and octagon:canonical-changed. Each call
  // writes a loading skeleton, awaits a network read, then writes its result.
  // Without sequencing, a slower earlier call can land after a faster later
  // one and leave the panel showing a stale skeleton forever — which is
  // exactly what happened during browser verification.
  //
  // Every call takes a ticket; only the holder of the newest ticket is allowed
  // to write to the DOM.
  let renderGeneration = 0;

  async function renderPanel() {
    const generation = ++renderGeneration;
    const isStale = () => generation !== renderGeneration;

    const el = document.getElementById('ccPanel');
    if (!el) return;
    const domain = DOMAINS.find((d) => d.key === activeKey) || DOMAINS[0];

    const c = client();
    if (!c) {
      el.innerHTML = errorState(new Error(tx({
        ar: 'طبقة العميل القانونية غير محمّلة.',
        en: 'Canonical client layer is not loaded.',
      })));
      return;
    }

    // Only show the skeleton if the panel has no usable content yet; otherwise
    // a background refresh would blank a working table for no reason.
    if (!el.querySelector('.cc-table, .cc-state-empty, .cc-state-error')) {
      el.innerHTML = skeleton(tx({ ar: 'جارٍ التحميل…', en: 'Loading…' }));
    }

    let rows = [];
    let failure = null;
    try {
      rows = await domain.load(c);
    } catch (err) {
      failure = err;
    }

    // A newer render started while this one was awaiting the network. Abandon
    // this result rather than overwriting fresher content.
    if (isStale()) return;

    const note = domain.note
      ? `<div class="cc-note"><i class="fa-solid fa-circle-info"></i> ${escapeHtml(tx(domain.note))}</div>`
      : '';
    const count = failure
      ? ''
      : `<div class="cc-count">${escapeHtml(tx({ ar: 'عدد السجلات', en: 'Records' }))}: <strong>${escapeHtml(num(rows ? rows.length : 0))}</strong></div>`;

    el.innerHTML = `
      <div class="cc-panel-head">
        <h2 class="cc-panel-title"><i class="fa-solid ${escapeHtml(domain.icon)}"></i> ${escapeHtml(tx(domain.label))}</h2>
        ${count}
      </div>
      ${note}
      ${renderCreateForm(domain)}
      <div id="ccResult">${failure ? errorState(failure) : renderTable(domain, rows)}</div>`;
  }

  async function submitCreate(form) {
    const domain = DOMAINS.find((d) => d.key === form.getAttribute('data-cc-domain'));
    if (!domain || !domain.create) return;
    const c = client();
    if (!c) return;

    const values = {};
    form.querySelectorAll('[data-cc-field]').forEach((input) => {
      values[input.getAttribute('data-cc-field')] = input.value.trim ? input.value.trim() : input.value;
    });

    const missing = domain.create.fields.filter((f) => f.required && !values[f.key]);
    if (missing.length) {
      toast(tx({ ar: 'أكمل الحقول المطلوبة.', en: 'Fill the required fields.' }), 'error');
      return;
    }

    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      await domain.create.submit(c, values);
      toast(tx({ ar: 'تم الحفظ عبر المحرّك القانوني.', en: 'Saved through the canonical engine.' }), 'success');
      await renderPanel();
    } catch (err) {
      // Surface the server's own machine code rather than a generic message.
      const detail = err && err.code ? `${err.code}: ${err.message}` : (err && err.message) || String(err);
      toast(detail, 'error');
      const result = document.getElementById('ccResult');
      if (result) result.innerHTML = errorState(err);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function toast(message, kind) {
    if (typeof root.showToast === 'function') {
      root.showToast(message, kind);
      return;
    }
    if (root.console) root.console.log(`[canonical-console] ${kind}: ${message}`);
  }

  // -------------------------------------------------------------------
  // Wiring
  // -------------------------------------------------------------------

  async function render() {
    renderAuthorityBanner();
    renderTabs();
    await renderPanel();
  }

  // Delegated listeners survive re-render and lazy view loading.
  document.addEventListener('click', (event) => {
    const tab = event.target.closest && event.target.closest('[data-cc-tab]');
    if (tab) {
      activeKey = tab.getAttribute('data-cc-tab');
      renderTabs();
      renderPanel();
      return;
    }
    if (event.target.closest && event.target.closest('#ccRefreshBtn')) {
      render();
    }
  });

  document.addEventListener('submit', (event) => {
    const form = event.target.closest && event.target.closest('#ccCreateForm');
    if (!form) return;
    event.preventDefault();
    submitCreate(form);
  });

  // Re-render on language switch so Arabic/English both stay correct.
  root.addEventListener('octagon:language-applied', () => {
    if (document.getElementById('pageCanonicalConsole')) render();
  });

  // Refresh when any canonical write succeeds anywhere in the shell.
  root.addEventListener('octagon:canonical-changed', () => {
    if (document.getElementById('pageCanonicalConsole')) renderPanel();
  });

  /**
   * Activate the page on navigation.
   *
   * Non-core tabs must self-activate: the shell's switchPage handles showing
   * the section, but the lazily-fetched template may not exist yet and nothing
   * would render our content into it. So we let the shell run first, then make
   * sure the template is present and render.
   */
  async function activate() {
    try {
      if (typeof root.ensurePageTemplateLoaded === 'function') {
        await root.ensurePageTemplateLoaded('canonical_console');
      }
    } catch (e) {
      if (root.console) root.console.warn('Canonical console: template load failed', e);
    }
    const section = document.getElementById('pageCanonicalConsole');
    if (!section) return false;

    // Self-activate. The shell's switchPage adds 'page-active' to the target
    // section, but on the first navigation this section does not exist yet —
    // it is fetched lazily above — so the shell had nothing to reveal and the
    // page would stay blank. Apply the same reveal the shell would have.
    section.classList.add('page-active');
    const navBtn = document.querySelector('.nav-btn[data-page="canonical_console"]');
    if (navBtn) {
      navBtn.classList.add('active');
      navBtn.setAttribute('aria-current', 'page');
    }

    await render();
    return true;
  }

  function wireSwitch() {
    if (root.__canonicalConsoleWrapped || typeof root.switchPage !== 'function') return;
    const orig = root.switchPage;
    root.switchPage = function (page) {
      const result = orig.apply(this, arguments);
      if (page === 'canonical_console') {
        // Fire and forget: the shell has already revealed the section, we only
        // need to fill it. Errors are contained so navigation never breaks.
        Promise.resolve().then(activate).catch((e) => {
          if (root.console) root.console.warn('Canonical console render error', e);
        });
      }
      return result;
    };
    root.__canonicalConsoleWrapped = true;
  }

  function init() {
    wireSwitch();
    // switchPage may be defined after this module loads; retry briefly.
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      wireSwitch();
      if (root.__canonicalConsoleWrapped || tries > 40) clearInterval(timer);
    }, 250);
    // Handle a direct load/resume straight onto this page.
    if (document.getElementById('pageCanonicalConsole')) activate();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  root.renderCanonicalConsole = render;
  root.CanonicalConsole = { render, activate, DOMAINS, get activeKey() { return activeKey; } };
})();
