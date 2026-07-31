(function (root) {
  'use strict';

  // ---------------------------------------------------------------------
  // Octagon Page Kit — Final Page Catalog · shared page components (§73).
  //
  // WHY
  //
  // Before this file, every new page re-implemented its own header, tab strip,
  // filter bar, table, KPI card and — worst of all — its own idea of what an
  // empty page looks like. That is how a page ends up showing a green "0" when
  // the truth is "you do not have permission", "this module is not installed",
  // or "the backend call failed". §74 forbids exactly that.
  //
  // WHAT
  //
  // One vocabulary of page primitives, Arabic-first and RTL-correct, that every
  // page in this wave renders through. Each primitive emits a stable
  // `data-opk-*` selector so browser tests can assert on structure rather than
  // on Arabic copy.
  //
  // THE STATE MODEL — the important part
  //
  // A page never renders "nothing". It renders one of nine honest states:
  //
  //   loading              a request is in flight
  //   empty                the query succeeded and returned zero rows
  //   populated            the query succeeded and returned rows
  //   validation_error     the user's input was rejected
  //   permission_denied    403 — the actor lacks the permission
  //   module_disabled      the module exists but is not enabled for this company
  //   entitlement_denied   the plan does not include this module
  //   not_available        the module's schema is not installed
  //   backend_failure      anything else — shown as a failure, never as zero
  //
  // OctagonPageKit.classifyError() maps a CanonicalError onto that vocabulary,
  // so every page reacts to a 403 the same way without repeating the logic.
  //
  // This file adds no business logic and owns no data. It renders.
  // ---------------------------------------------------------------------

  const KIT_VERSION = '1.0.0';

  function isArabic() {
    const lang = String(document.documentElement.lang || '').toLowerCase();
    return document.documentElement.dir === 'rtl' || !lang || lang.startsWith('ar');
  }

  /** Pick the Arabic or English string for the active direction. */
  function tx(ar, en) {
    return isArabic() ? ar : en;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Wrap an identifier so bidirectional text never reorders it.
   *
   * An invoice number like `INV-2026-00042` rendered inside an Arabic (RTL)
   * paragraph is reordered by the bidi algorithm and can display as
   * `00042-2026-INV`. U+2068 FIRST STRONG ISOLATE + U+2069 POP DIRECTIONAL
   * ISOLATE pins it. Every code, number and id in this kit goes through here.
   */
  function bidi(value) {
    if (value === null || value === undefined || value === '') return '—';
    return `⁨${esc(value)}⁩`;
  }

  function money(value, currency) {
    const n = Number(value || 0);
    const formatted = new Intl.NumberFormat(isArabic() ? 'ar-IQ' : 'en-US', {
      maximumFractionDigits: 2,
    }).format(n);
    return `⁨${esc(formatted)}${currency ? ' ' + esc(currency) : ''}⁩`;
  }

  function date(value) {
    if (!value) return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return bidi(value);
    return `⁨${esc(parsed.toLocaleDateString(isArabic() ? 'ar-IQ' : 'en-GB'))}⁩`;
  }

  function num(value) {
    const n = Number(value || 0);
    return `⁨${esc(new Intl.NumberFormat(isArabic() ? 'ar-IQ' : 'en-US').format(n))}⁩`;
  }

  // ---------------------------------------------------------------------
  // State classification
  // ---------------------------------------------------------------------

  const STATES = Object.freeze({
    LOADING: 'loading',
    EMPTY: 'empty',
    POPULATED: 'populated',
    VALIDATION_ERROR: 'validation_error',
    PERMISSION_DENIED: 'permission_denied',
    MODULE_DISABLED: 'module_disabled',
    ENTITLEMENT_DENIED: 'entitlement_denied',
    NOT_AVAILABLE: 'not_available',
    BACKEND_FAILURE: 'backend_failure',
  });

  /**
   * Map a thrown error onto the state vocabulary.
   * Never returns EMPTY — an error is never "no data".
   */
  function classifyError(error) {
    if (!error) return { state: STATES.BACKEND_FAILURE, code: null, message: '' };

    const code = error.code || null;
    const status = error.status || 0;
    const message = error.message || String(error);

    if (code === 'MODULE_NOT_ENABLED') return { state: STATES.MODULE_DISABLED, code, message };
    if (code === 'MODULE_UNLICENSED' || code === 'ENTITLEMENT_DENIED') {
      return { state: STATES.ENTITLEMENT_DENIED, code, message };
    }
    if (code === 'MODULE_NOT_INSTALLED' || code === 'MODULE_NOT_FOUND') {
      return { state: STATES.NOT_AVAILABLE, code, message };
    }
    if (status === 401 || status === 403) return { state: STATES.PERMISSION_DENIED, code, message };
    if (status === 422 || status === 400) return { state: STATES.VALIDATION_ERROR, code, message };
    return { state: STATES.BACKEND_FAILURE, code, message };
  }

  const STATE_PRESENTATION = {
    [STATES.LOADING]: {
      icon: 'fa-circle-notch fa-spin', tone: 'info',
      ar: 'جارٍ التحميل…', en: 'Loading…',
      hintAr: '', hintEn: '',
    },
    [STATES.EMPTY]: {
      icon: 'fa-inbox', tone: 'muted',
      ar: 'لا توجد سجلات بعد', en: 'No records yet',
      hintAr: 'ابدأ بإضافة أول سجل من الأزرار أعلاه.',
      hintEn: 'Start by creating the first record using the actions above.',
    },
    [STATES.PERMISSION_DENIED]: {
      icon: 'fa-lock', tone: 'warning',
      ar: 'لا تملك صلاحية عرض هذا المحتوى', en: 'You do not have permission to view this',
      hintAr: 'اطلب من مدير النظام منحك الصلاحية المطلوبة.',
      hintEn: 'Ask a system administrator to grant you the required permission.',
    },
    [STATES.MODULE_DISABLED]: {
      icon: 'fa-toggle-off', tone: 'warning',
      ar: 'هذه الوحدة غير مفعّلة', en: 'This module is not enabled',
      hintAr: 'يمكن تفعيلها من مركز الوحدات والحزم.',
      hintEn: 'It can be enabled from the Module & Pack Center.',
    },
    [STATES.ENTITLEMENT_DENIED]: {
      icon: 'fa-gem', tone: 'warning',
      ar: 'هذه الوحدة غير مشمولة في الاشتراك الحالي', en: 'This module is not included in the current plan',
      hintAr: 'راجع مركز التحكم التجاري لترقية الاشتراك.',
      hintEn: 'See the Commercial Control Center to upgrade the plan.',
    },
    [STATES.NOT_AVAILABLE]: {
      icon: 'fa-plug-circle-xmark', tone: 'warning',
      ar: 'هذه الوحدة غير مثبّتة في قاعدة البيانات', en: 'This module is not installed in the database',
      hintAr: 'لم يتم تطبيق ترحيل المخطط الخاص بها بعد.',
      hintEn: 'Its schema migration has not been applied yet.',
    },
    [STATES.VALIDATION_ERROR]: {
      icon: 'fa-triangle-exclamation', tone: 'danger',
      ar: 'تعذّر قبول البيانات المُدخلة', en: 'The submitted data was rejected',
      hintAr: '', hintEn: '',
    },
    [STATES.BACKEND_FAILURE]: {
      icon: 'fa-server', tone: 'danger',
      ar: 'تعذّر جلب البيانات من الخادم', en: 'Could not load data from the server',
      hintAr: 'هذه ليست "لا توجد بيانات" — الطلب فشل. حاول مرة أخرى.',
      hintEn: 'This is NOT "no data" — the request failed. Try again.',
    },
  };

  // ---------------------------------------------------------------------
  // Primitives
  // ---------------------------------------------------------------------

  /** Page header: title, subtitle, company/branch context, actions. */
  function header(options) {
    const opts = options || {};
    const actions = (opts.actions || [])
      .map((a) => `<button type="button" class="${a.variant === 'primary' ? 'btn-primary' : 'btn-secondary'} opk-action"
        data-opk-action="${esc(a.id)}"${a.disabled ? ' disabled' : ''}>
        ${a.icon ? `<i class="fa-solid ${esc(a.icon)}"></i> ` : ''}${esc(tx(a.labelAr, a.labelEn))}
      </button>`)
      .join('');

    const context = opts.context
      ? `<div class="opk-context" data-opk-context>
           <span class="opk-context-item"><i class="fa-solid fa-building"></i> ${esc(opts.context.company || tx('غير محدد', 'Not set'))}</span>
           ${opts.context.branch ? `<span class="opk-context-item"><i class="fa-solid fa-code-branch"></i> ${esc(opts.context.branch)}</span>` : ''}
         </div>`
      : '';

    const crumbs = (opts.breadcrumbs || []).length
      ? `<nav class="opk-breadcrumbs" data-opk-breadcrumbs aria-label="${esc(tx('مسار التنقل', 'Breadcrumb'))}">
           ${opts.breadcrumbs.map((c, i, arr) => (
    i === arr.length - 1
      ? `<span aria-current="page">${esc(tx(c.labelAr, c.labelEn))}</span>`
      : `<button type="button" data-opk-crumb="${esc(c.id)}">${esc(tx(c.labelAr, c.labelEn))}</button><i class="fa-solid fa-angle-left"></i>`
  )).join('')}
         </nav>`
      : '';

    return `<div class="opk-header" data-opk-header>
      ${crumbs}
      <div class="opk-header-main">
        <div class="opk-header-text">
          <h2 class="opk-title" data-opk-title>
            ${opts.icon ? `<i class="fa-solid ${esc(opts.icon)}"></i> ` : ''}${esc(tx(opts.titleAr, opts.titleEn))}
          </h2>
          ${opts.subtitleAr || opts.subtitleEn
    ? `<p class="opk-subtitle" data-opk-subtitle>${esc(tx(opts.subtitleAr, opts.subtitleEn))}</p>`
    : ''}
          ${context}
        </div>
        ${actions ? `<div class="opk-header-actions" data-opk-header-actions>${actions}</div>` : ''}
      </div>
    </div>`;
  }

  /** Horizontal, keyboard-navigable tab strip for a page family. */
  function tabs(items, activeKey) {
    return `<div class="opk-tabs" data-opk-tabs role="tablist">
      ${(items || []).map((t) => `<button type="button" role="tab"
        class="opk-tab${t.key === activeKey ? ' active' : ''}"
        data-opk-tab="${esc(t.key)}"
        aria-selected="${t.key === activeKey ? 'true' : 'false'}"
        tabindex="${t.key === activeKey ? '0' : '-1'}">
        ${t.icon ? `<i class="fa-solid ${esc(t.icon)}"></i> ` : ''}${esc(tx(t.labelAr, t.labelEn))}
        ${t.count !== undefined && t.count !== null ? `<em class="opk-tab-count">${num(t.count)}</em>` : ''}
      </button>`).join('')}
    </div>`;
  }

  /** Filter bar: search box plus declared select/date filters. */
  function filterBar(filters, values) {
    const current = values || {};
    const controls = (filters || []).map((f) => {
      if (f.type === 'select') {
        return `<label class="opk-filter">
          <span>${esc(tx(f.labelAr, f.labelEn))}</span>
          <select data-opk-filter="${esc(f.id)}">
            <option value="">${esc(tx('الكل', 'All'))}</option>
            ${(f.options || []).map((o) => `<option value="${esc(o.value)}"${String(current[f.id] || '') === String(o.value) ? ' selected' : ''}>${esc(tx(o.labelAr, o.labelEn))}</option>`).join('')}
          </select>
        </label>`;
      }
      if (f.type === 'date') {
        return `<label class="opk-filter">
          <span>${esc(tx(f.labelAr, f.labelEn))}</span>
          <input type="date" data-opk-filter="${esc(f.id)}" value="${esc(current[f.id] || '')}">
        </label>`;
      }
      return `<label class="opk-filter">
        <span>${esc(tx(f.labelAr, f.labelEn))}</span>
        <input type="text" data-opk-filter="${esc(f.id)}" value="${esc(current[f.id] || '')}">
      </label>`;
    }).join('');

    return `<div class="opk-filterbar" data-opk-filterbar>
      <div class="opk-search">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="search" data-opk-search
          placeholder="${esc(tx('بحث…', 'Search…'))}"
          aria-label="${esc(tx('بحث', 'Search'))}"
          value="${esc(current.q || '')}">
      </div>
      ${controls}
      <button type="button" class="btn-secondary opk-refresh" data-opk-refresh>
        <i class="fa-solid fa-rotate"></i> ${esc(tx('تحديث', 'Refresh'))}
      </button>
    </div>`;
  }

  /**
   * KPI card.
   *
   * `value` may legitimately be unavailable. When it is, the card shows the
   * reason — it never substitutes zero for "unknown", because a fake green zero
   * is indistinguishable from a real one.
   */
  function kpi(card) {
    const c = card || {};
    const unavailable = c.value === null || c.value === undefined;
    const body = unavailable
      ? `<div class="opk-kpi-value opk-kpi-unavailable" data-opk-kpi-state="${esc(c.unavailableState || STATES.NOT_AVAILABLE)}">
           <i class="fa-solid fa-minus"></i>
           <span>${esc(tx('غير متاح', 'Not available'))}</span>
         </div>`
      : `<div class="opk-kpi-value" data-opk-kpi-state="populated">${c.format === 'money' ? money(c.value, c.currency) : num(c.value)}</div>`;

    return `<div class="opk-kpi opk-kpi-${esc(c.tone || 'neutral')}" data-opk-kpi="${esc(c.id)}">
      <div class="opk-kpi-head">
        ${c.icon ? `<i class="fa-solid ${esc(c.icon)}"></i>` : ''}
        <span class="opk-kpi-label">${esc(tx(c.labelAr, c.labelEn))}</span>
      </div>
      ${body}
      <div class="opk-kpi-meta" data-opk-kpi-meta>
        ${c.sourceModule ? `<span title="${esc(tx('الوحدة المصدر', 'Source module'))}"><i class="fa-solid fa-cube"></i> ${bidi(c.sourceModule)}</span>` : ''}
        ${c.asOf ? `<span title="${esc(tx('محسوب في', 'Calculated at'))}"><i class="fa-solid fa-clock"></i> ${date(c.asOf)}</span>` : ''}
      </div>
      ${c.explain ? `<p class="opk-kpi-explain">${esc(tx(c.explainAr || c.explain, c.explainEn || c.explain))}</p>` : ''}
      ${c.drillTo ? `<button type="button" class="opk-kpi-drill" data-opk-drill="${esc(c.drillTo)}">${esc(tx('تفصيل', 'Drill down'))} <i class="fa-solid fa-angle-left"></i></button>` : ''}
    </div>`;
  }

  function kpiRow(cards) {
    return `<div class="opk-kpi-row" data-opk-kpi-row>${(cards || []).map(kpi).join('')}</div>`;
  }

  /**
   * Data grid.
   *
   * Always wrapped in an `overflow-x:auto` container so a wide table scrolls
   * inside itself instead of making the whole page scroll sideways on mobile.
   */
  function grid(columns, rows, options) {
    const opts = options || {};
    const cols = columns || [];
    const data = rows || [];

    if (!data.length) {
      return stateBlock(opts.emptyState || STATES.EMPTY, opts.emptyDetail);
    }

    const head = cols.map((c) => `<th scope="col"${c.numeric ? ' class="opk-numeric"' : ''}>${esc(tx(c.labelAr, c.labelEn))}</th>`).join('');

    const body = data.map((row, index) => {
      const cells = cols.map((c) => {
        const raw = typeof c.value === 'function' ? c.value(row, index) : row[c.key];
        let rendered;
        if (c.render === 'money') rendered = money(raw, c.currency || row.currency);
        else if (c.render === 'date') rendered = date(raw);
        else if (c.render === 'number') rendered = num(raw);
        else if (c.render === 'code') rendered = bidi(raw);
        else if (c.render === 'badge') rendered = badge(raw);
        else if (c.render === 'html') rendered = raw == null ? '—' : String(raw);
        else rendered = raw === null || raw === undefined || raw === '' ? '—' : esc(raw);
        return `<td${c.numeric ? ' class="opk-numeric"' : ''} data-opk-col="${esc(c.key || c.id)}">${rendered}</td>`;
      }).join('');

      const actions = (opts.rowActions || [])
        .filter((a) => (typeof a.when === 'function' ? a.when(row) : true))
        .map((a) => `<button type="button" class="opk-row-action" data-opk-row-action="${esc(a.id)}" data-opk-row-id="${esc(row[opts.idKey || 'id'])}" title="${esc(tx(a.labelAr, a.labelEn))}">
            <i class="fa-solid ${esc(a.icon || 'fa-ellipsis')}"></i>
          </button>`).join('');

      return `<tr data-opk-row="${esc(row[opts.idKey || 'id'])}">
        ${cells}
        ${(opts.rowActions || []).length ? `<td class="opk-row-actions">${actions}</td>` : ''}
      </tr>`;
    }).join('');

    return `<div class="opk-grid-wrap" data-opk-grid-wrap>
      <table class="opk-grid" data-opk-grid>
        <thead><tr>${head}${(opts.rowActions || []).length ? `<th scope="col" class="opk-row-actions-head">${esc(tx('إجراءات', 'Actions'))}</th>` : ''}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    ${opts.total !== undefined ? `<div class="opk-grid-footer" data-opk-grid-footer>${esc(tx('عدد السجلات', 'Records'))}: ${num(opts.total)}</div>` : ''}`;
  }

  function badge(value) {
    const key = String(value == null ? 'unknown' : value);
    const slug = key.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
    return `<span class="opk-badge opk-badge-${esc(slug)}" data-opk-badge="${esc(slug)}">${bidi(key)}</span>`;
  }

  /**
   * The one place a non-populated state is rendered.
   *
   * Every page routes loading / empty / denial / failure through here, so the
   * distinction between "no rows" and "request failed" is always visible and
   * always worded the same way.
   */
  function stateBlock(state, detail) {
    const preset = STATE_PRESENTATION[state] || STATE_PRESENTATION[STATES.BACKEND_FAILURE];
    const hint = tx(preset.hintAr, preset.hintEn);
    return `<div class="opk-state opk-state-${esc(preset.tone)}" data-opk-state="${esc(state)}" role="status">
      <i class="fa-solid ${esc(preset.icon)} opk-state-icon"></i>
      <p class="opk-state-title">${esc(tx(preset.ar, preset.en))}</p>
      ${hint ? `<p class="opk-state-hint">${esc(hint)}</p>` : ''}
      ${detail ? `<p class="opk-state-detail" dir="ltr">${esc(String(detail).slice(0, 300))}</p>` : ''}
    </div>`;
  }

  function loading(labelAr, labelEn) {
    return `<div class="opk-state opk-state-info" data-opk-state="${STATES.LOADING}" role="status" aria-live="polite">
      <i class="fa-solid fa-circle-notch fa-spin opk-state-icon"></i>
      <p class="opk-state-title">${esc(labelAr || labelEn ? tx(labelAr, labelEn) : tx('جارٍ التحميل…', 'Loading…'))}</p>
    </div>`;
  }

  /** Skeleton rows, for a first paint that does not flash empty. */
  function skeleton(rows) {
    const n = Math.max(1, Math.min(Number(rows) || 5, 12));
    return `<div class="opk-skeleton" data-opk-skeleton aria-hidden="true">
      ${Array.from({ length: n }, () => '<div class="opk-skeleton-row"></div>').join('')}
    </div>`;
  }

  /** Section shell: a titled card that holds one workflow. */
  function section(titleAr, titleEn, bodyHtml, options) {
    const opts = options || {};
    return `<section class="opk-section" data-opk-section="${esc(opts.id || '')}">
      <div class="opk-section-head">
        <h3>${opts.icon ? `<i class="fa-solid ${esc(opts.icon)}"></i> ` : ''}${esc(tx(titleAr, titleEn))}</h3>
        ${opts.actions ? `<div class="opk-section-actions">${opts.actions}</div>` : ''}
      </div>
      <div class="opk-section-body">${bodyHtml}</div>
    </section>`;
  }

  /** Notice strip: success / warning / danger, dismissible by the caller. */
  function notice(tone, messageAr, messageEn) {
    return `<div class="opk-notice opk-notice-${esc(tone || 'info')}" data-opk-notice="${esc(tone || 'info')}" role="alert">
      ${esc(tx(messageAr, messageEn))}
    </div>`;
  }

  // ---------------------------------------------------------------------
  // Behaviour helpers
  // ---------------------------------------------------------------------

  /**
   * Bind the standard page events once per render.
   * Handlers receive the parsed identifier, never the raw event.
   */
  function bind(hostEl, handlers) {
    if (!hostEl) return;
    const h = handlers || {};

    if (h.onTab) {
      hostEl.querySelectorAll('[data-opk-tab]').forEach((btn) => {
        btn.addEventListener('click', () => h.onTab(btn.dataset.opkTab));
        btn.addEventListener('keydown', (event) => {
          // Roving tabindex: arrow keys move between tabs, as ARIA expects.
          if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
          const all = [...hostEl.querySelectorAll('[data-opk-tab]')];
          const at = all.indexOf(btn);
          // In RTL, ArrowLeft advances. Resolve against the document direction
          // rather than hardcoding either order.
          const forward = isArabic() ? event.key === 'ArrowLeft' : event.key === 'ArrowRight';
          const next = all[(at + (forward ? 1 : -1) + all.length) % all.length];
          if (next) { next.focus(); h.onTab(next.dataset.opkTab); }
          event.preventDefault();
        });
      });
    }

    if (h.onAction) {
      hostEl.querySelectorAll('[data-opk-action]').forEach((btn) => {
        btn.addEventListener('click', () => h.onAction(btn.dataset.opkAction, btn));
      });
    }

    if (h.onRowAction) {
      hostEl.querySelectorAll('[data-opk-row-action]').forEach((btn) => {
        btn.addEventListener('click', () => h.onRowAction(btn.dataset.opkRowAction, btn.dataset.opkRowId, btn));
      });
    }

    if (h.onFilter) {
      hostEl.querySelectorAll('[data-opk-filter]').forEach((el) => {
        el.addEventListener('change', () => h.onFilter(el.dataset.opkFilter, el.value));
      });
      const search = hostEl.querySelector('[data-opk-search]');
      if (search) {
        let timer = null;
        search.addEventListener('input', () => {
          // Debounced: a keystroke must not fire a governed query per character.
          clearTimeout(timer);
          timer = setTimeout(() => h.onFilter('q', search.value), 300);
        });
      }
    }

    if (h.onRefresh) {
      const refresh = hostEl.querySelector('[data-opk-refresh]');
      if (refresh) refresh.addEventListener('click', () => h.onRefresh());
    }

    if (h.onDrill) {
      hostEl.querySelectorAll('[data-opk-drill]').forEach((btn) => {
        btn.addEventListener('click', () => h.onDrill(btn.dataset.opkDrill));
      });
    }

    if (h.onCrumb) {
      hostEl.querySelectorAll('[data-opk-crumb]').forEach((btn) => {
        btn.addEventListener('click', () => h.onCrumb(btn.dataset.opkCrumb));
      });
    }
  }

  /**
   * Run a governed read and hand back either rows or a classified state.
   * Pages call this instead of try/catching every fetch themselves, which is
   * how the nine states stay consistent across every page in the catalog.
   */
  async function safeQuery(promiseFactory) {
    try {
      const data = await promiseFactory();
      const rows = Array.isArray(data) ? data : (data ? [data] : []);
      return { ok: true, rows, state: rows.length ? STATES.POPULATED : STATES.EMPTY };
    } catch (error) {
      const classified = classifyError(error);
      return { ok: false, rows: [], ...classified };
    }
  }

  /** Is the canonical client actually present? Pages must not assume it. */
  function client() {
    return root.CanonicalClient || null;
  }

  /**
   * Mount a non-core page into the original shell.
   *
   * WHY THIS EXISTS
   *
   * `switchPage()` activates a page by looking its id up in its OWN `pageMap`
   * literal — a small map covering the core pages only. A page that is not in
   * that literal gets no `.page-active` class, so it stays invisible no matter
   * how correct its controller is. Every non-core Octagon page therefore has to
   * intercept switchPage and activate itself (see modules/appointments.js).
   *
   * There is a second trap: the shell hydrates `views/<page>.html`
   * ASYNCHRONOUSLY, after switchPage's synchronous dispatch. Activating before
   * that settles finds no section and silently does nothing.
   *
   * This helper does both correctly, once, for every page in this wave:
   *   1. intercept switchPage for `pageId` and its aliases;
   *   2. enforce the page permission (fail closed, with a toast);
   *   3. await the template load;
   *   4. deactivate every other page, activate this one and its nav button;
   *   5. open the containing nav group and set `currentPage`;
   *   6. call the page's own `activate()`.
   *
   * @param {{pageId: string, sectionId: string, navId?: string,
   *          aliases?: string[], activate: () => void}} config
   */
  function wirePage(config) {
    const { pageId, sectionId, navId, aliases = [], activate } = config || {};
    if (!pageId || !sectionId || typeof activate !== 'function') return;

    const flag = `__opkWired_${pageId}`;
    if (root[flag]) return;

    function permitted() {
      return !root.PermissionService || root.PermissionService.checkPage(pageId);
    }

    async function mount() {
      if (!permitted()) {
        if (typeof root.showToast === 'function') {
          root.showToast(tx(
            'عذراً، ليس لديك صلاحية للوصول إلى هذا القسم',
            'You do not have permission to open this section',
          ), 'danger');
        }
        return false;
      }

      if (typeof root.ensurePageTemplateLoaded === 'function') {
        try { await root.ensurePageTemplateLoaded(pageId); } catch (_) { /* fall through */ }
      }

      const section = document.getElementById(sectionId);
      if (!section) return false;

      document.querySelectorAll('.page').forEach((p) => p.classList.remove('page-active'));
      document.querySelectorAll('.nav-btn').forEach((b) => {
        b.classList.remove('active');
        b.removeAttribute('aria-current');
      });

      section.classList.add('page-active');
      const nav = (navId && document.getElementById(navId))
        || document.querySelector(`.nav-btn[data-page="${pageId}"]`);
      if (nav) {
        nav.classList.add('active');
        nav.setAttribute('aria-current', 'page');
      }

      if (typeof root.ensureNavGroupForPage === 'function') {
        try { root.ensureNavGroupForPage(pageId); } catch (_) { /* nav group optional */ }
      }
      root.currentPage = pageId;

      const main = document.getElementById('mainContent');
      if (main) { main.scrollTop = 0; main.scrollLeft = 0; }

      activate();
      return true;
    }

    function wire() {
      if (root[flag] || typeof root.switchPage !== 'function') return;
      const orig = root.switchPage;
      const owned = new Set([pageId].concat(aliases));
      root.switchPage = function (page) {
        if (owned.has(page)) {
          // Intercept: this page owns its own activation. Returning without
          // calling through prevents the core switchPage from clearing the
          // class we are about to set.
          mount().catch((error) => console.error(`[${pageId}] mount failed:`, error));
          return undefined;
        }
        return orig.apply(this, arguments);
      };
      root[flag] = true;
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', wire, { once: true });
    } else {
      wire();
    }

    const existing = document.getElementById(sectionId);
    if (existing && existing.classList.contains('page-active')) activate();

    return mount;
  }

  const OctagonPageKit = {
    VERSION: KIT_VERSION,
    STATES,
    // formatting
    tx, esc, bidi, money, date, num, isArabic,
    // primitives
    header, tabs, filterBar, kpi, kpiRow, grid, badge, section, notice,
    stateBlock, loading, skeleton,
    // behaviour
    bind, classifyError, safeQuery, client, wirePage,
  };

  root.OctagonPageKit = OctagonPageKit;
  root.OPK = OctagonPageKit;
})(window);
