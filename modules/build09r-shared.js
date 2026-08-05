/** BUILD-09R-2 shared workspace kernel.
 *
 * The six high-value operational page groups (waves, cycle counting, traceability/recall,
 * shop-floor, quality disposition, downtime/performance) each need the same primitives that
 * modules/build09-mobile-receiving.js grew organically: bilingual labels, an RTL-aware
 * renderer, a guarded action caller that turns a 403 into an honest "denied" panel instead of
 * an unhandled rejection, governed-lookup wiring, and honest loading/empty/error states.
 *
 * Rather than copy that ~250-line shape six more times, the reusable half lives here and each
 * group module supplies only its own domain: which phases exist, what each panel renders, and
 * which governed actions each control calls. The generic table+dialog shell in
 * build09-workspaces.js is untouched - these modules register through registerPageOverride().
 */
(function build09rShared(root) {
  'use strict';

  const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const rtl = () => document.documentElement.dir === 'rtl' || String(document.documentElement.lang).startsWith('ar');
  const t = (en, ar) => (rtl() ? ar : en);
  const runtime = () => root.OctagonRuntimeContext;
  const warehouseId = () => runtime()?.warehouseId || '';

  /** Numbers must read correctly in both locales - Intl, never String(). */
  const num = (value, digits = 2) => (value == null || value === '' || Number.isNaN(Number(value))
    ? '—'
    : new Intl.NumberFormat(rtl() ? 'ar-IQ' : 'en-US', { maximumFractionDigits: digits }).format(Number(value)));
  const percent = (value) => (value == null || Number.isNaN(Number(value)) ? '—' : `${num(value, 1)}%`);
  const when = (value) => {
    if (!value) return '—';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString(rtl() ? 'ar-IQ' : 'en-US');
  };
  const minutes = (value) => {
    const total = Number(value || 0);
    if (!Number.isFinite(total) || total <= 0) return '—';
    const hours = Math.floor(total / 60); const rest = Math.round(total % 60);
    return hours ? `${num(hours, 0)}${t('h', 'س')} ${num(rest, 0)}${t('m', 'د')}` : `${num(rest, 0)}${t('m', 'د')}`;
  };

  /** A single POST helper so every group inherits warehouse scope + idempotency identically. */
  async function call(actionId, input = {}) {
    return root.OctagonApiClient.post(`/api/v1/action/${actionId}`, {
      ...input,
      warehouse_id: input.warehouse_id || warehouseId(),
      idempotency_key: input.idempotency_key || `${actionId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
  }

  /** Read the canonical BUILD-09 query surface (platform/api/build09.mjs). */
  async function query(resource, params = {}) {
    const search = new URLSearchParams({ warehouse_id: warehouseId() });
    for (const [key, value] of Object.entries(params)) if (value != null && value !== '') search.set(key, value);
    return root.OctagonApiClient.get(`/api/v1/wms/${encodeURIComponent(resource)}?${search}`);
  }

  const isDenied = (error) => /403|permission|denied|maker.?checker|scope/i.test(String(error?.message || error));

  /** Markup primitives - shared so all six groups look like one product, not six. */
  function scopeLine(extras = []) {
    const cells = [`<span>${t('Warehouse', 'المستودع')}: ${escapeHtml(warehouseId() || '—')}</span>`]
      .concat(extras.filter(Boolean).map((cell) => `<span>${cell}</span>`));
    return `<div class="b09r-scope-line">${cells.join('')}</div>`;
  }

  function stepper(steps, activePhase) {
    const index = Math.max(0, steps.findIndex(([id]) => id === activePhase));
    return `<ol class="b09r-stepper">${steps.map(([id, en, ar], position) => `<li class="${position <= index ? 'b09r-step-done' : ''} ${id === activePhase ? 'b09r-step-active' : ''}">${escapeHtml(t(en, ar))}</li>`).join('')}</ol>`;
  }

  /** KPI cards: [labelEn, labelAr, value, tone?, role?] - tone drives the semantic accent, and
   *  role stamps a data-role on the value so live counters can be patched without a repaint. */
  function kpis(cards) {
    return `<div class="b09r-kpis">${cards.map(([en, ar, value, tone, role]) => `<div class="b09r-kpi${tone ? ` b09r-kpi-${escapeHtml(tone)}` : ''}"><span class="b09r-kpi-label">${escapeHtml(t(en, ar))}</span><strong class="b09r-kpi-value"${role ? ` data-role="${escapeHtml(role)}"` : ''}>${escapeHtml(String(value))}</strong></div>`).join('')}</div>`;
  }

  function progressBar(done, total, exceptions = 0) {
    const totalCount = Number(total || 0);
    const ratio = totalCount ? Math.min(100, (Number(done || 0) / totalCount) * 100) : 0;
    const exceptionRatio = totalCount ? Math.min(100 - ratio, (Number(exceptions || 0) / totalCount) * 100) : 0;
    // A <span> wrapper (not <div>) so a progress bar stays valid phrasing content inside the
    // <button> rows the wave/queue lists render.
    return `<span class="b09r-progress" role="progressbar" aria-valuenow="${escapeHtml(String(Math.round(ratio)))}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeHtml(t('Completion', 'نسبة الإنجاز'))}">
      <span class="b09r-progress-done" style="width:${ratio.toFixed(2)}%"></span>
      <span class="b09r-progress-exception" style="width:${exceptionRatio.toFixed(2)}%"></span>
      <em>${escapeHtml(`${num(done, 0)} / ${num(total, 0)}`)}</em></span>`;
  }

  const badge = (text, tone) => `<span class="b09r-badge${tone ? ` b09r-badge-${escapeHtml(tone)}` : ''}">${escapeHtml(String(text || '—'))}</span>`;
  const muted = (en, ar) => `<p class="b09r-muted">${escapeHtml(t(en, ar))}</p>`;

  function field(name, en, ar, { type = 'text', required = false, value = '', step, min, placeholder = '', autofocus = false } = {}) {
    const attrs = [`name="${escapeHtml(name)}"`, `type="${escapeHtml(type)}"`, required ? 'required' : '', step ? `step="${escapeHtml(step)}"` : '', min != null ? `min="${escapeHtml(String(min))}"` : '', value !== '' && value != null ? `value="${escapeHtml(String(value))}"` : '', placeholder ? `placeholder="${escapeHtml(placeholder)}"` : '', autofocus ? 'autofocus' : '', 'autocomplete="off"'].filter(Boolean).join(' ');
    return `<label class="b09r-field-lg"><span>${escapeHtml(t(en, ar))}</span><input ${attrs}></label>`;
  }

  function select(name, en, ar, options, { required = false, value = '' } = {}) {
    const body = options.map(([optionValue, optionEn, optionAr]) => `<option value="${escapeHtml(optionValue)}"${String(optionValue) === String(value) ? ' selected' : ''}>${escapeHtml(t(optionEn, optionAr))}</option>`).join('');
    return `<label class="b09r-field-lg"><span>${escapeHtml(t(en, ar))}</span><select name="${escapeHtml(name)}"${required ? ' required' : ''}>${body}</select></label>`;
  }

  function textarea(name, en, ar, { required = false, rows = 3, placeholder = '' } = {}) {
    return `<label class="b09r-field-lg"><span>${escapeHtml(t(en, ar))}</span><textarea class="b09r-textarea" name="${escapeHtml(name)}" rows="${escapeHtml(String(rows))}"${required ? ' required' : ''} placeholder="${escapeHtml(placeholder)}"></textarea></label>`;
  }

  /** Governed lookup (products / locations / …) - server-filtered, never a client-side id box. */
  function lookup(resource, name, en, ar) {
    return `<span class="b09-lookup b09r-field-lg" data-lookup-resource="${escapeHtml(resource)}"><span>${escapeHtml(t(en, ar))}</span>
      <input type="text" class="b09-lookup-query" placeholder="${escapeHtml(t('Search…', 'ابحث…'))}" autocomplete="off">
      <select class="b09-lookup-select" name="${escapeHtml(name)}"><option value="">${escapeHtml(t('— Search then select —', '— بحث ثم اختيار —'))}</option></select></span>`;
  }

  function wireLookups(container, boundFlag) {
    if (!root.OctagonGovernedLookups) return;
    container.querySelectorAll('[data-lookup-resource]').forEach((wrapper) => {
      if (wrapper.dataset[boundFlag]) return;
      wrapper.dataset[boundFlag] = 'true';
      const resource = wrapper.dataset.lookupResource;
      const queryInput = wrapper.querySelector('.b09-lookup-query');
      const resultSelect = wrapper.querySelector('.b09-lookup-select');
      let timer = null;
      queryInput.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          const rows = await root.OctagonGovernedLookups.search(resource, { query: queryInput.value }).catch(() => []);
          resultSelect.innerHTML = `<option value="">${escapeHtml(t('— Search then select —', '— بحث ثم اختيار —'))}</option>` + rows.map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.label)}</option>`).join('');
        }, 250);
      });
    });
  }

  const formData = (form) => Object.fromEntries(new FormData(form).entries());

  /**
   * Build a page override. The caller supplies `render(state, api)` returning the workspace HTML
   * and `bind(host, state, api)` attaching handlers; the kernel owns the host element, the busy
   * latch, error classification (denied vs failed) and re-render, so no group module can leave a
   * rejected promise on the floor or render a half-updated panel.
   */
  function createWorkspace({ pageId, prefix, initialState, render, bind, onActivate }) {
    let state = { ...initialState(), busy: false, error: null, denied: false };
    const host = () => document.querySelector(`[data-build09-page="${pageId}"]`);
    const body = () => host()?.querySelector(`[data-role="${prefix}-body"]`);

    function reset() { state = { ...initialState(), busy: false, error: null, denied: false }; }

    function paint() {
      const target = body();
      if (!target) return;
      target.innerHTML = state.error
        ? `${render(state, api)}<div class="b09r-panel"><p class="b09-status b09r-alert" data-role="${escapeHtml(prefix)}-alert" data-phase="${state.denied ? 'denied' : 'failed'}">${escapeHtml(state.error)}</p><button type="button" class="b09-button" data-role="${escapeHtml(prefix)}-dismiss">${escapeHtml(t('Dismiss', 'إغلاق'))}</button></div>`
        : render(state, api);
      wireLookups(target, `${prefix}Bound`);
      const dismiss = target.querySelector(`[data-role="${prefix}-dismiss"]`);
      if (dismiss) dismiss.addEventListener('click', () => { state.error = null; state.denied = false; paint(); });
      bind(target, state, api);
    }

    /** Every mutation funnels through here: single-flight, and a failure is shown, not swallowed. */
    async function guarded(fn) {
      if (state.busy) return;
      state.busy = true;
      try {
        state.error = null; state.denied = false;
        await fn();
      } catch (error) {
        state.denied = isDenied(error);
        state.error = error.message || String(error);
      } finally {
        state.busy = false;
        paint();
      }
    }

    const api = { call, query, guarded, paint, reset, formData, state: () => state };

    async function activate() {
      const container = host();
      if (!container) return;
      if (!container.querySelector(`[data-role="${prefix}-body"]`)) container.insertAdjacentHTML('beforeend', `<div class="b09r-workspace" data-role="${prefix}-body"></div>`);
      paint();
      // guarded() re-paints in its own finally; clearing `loading` first means a failed load
      // renders the error panel instead of an honest-looking but permanent "Loading…".
      if (onActivate) await guarded(async () => { try { await onActivate(state, api); } finally { state.loading = false; } });
    }

    return { activate, api, state: () => state };
  }

  function registerOverride(pageId, workspace) {
    if (root.OctagonBuild09) root.OctagonBuild09.registerPageOverride(pageId, workspace);
  }

  root.OctagonBuild09R = {
    escapeHtml, rtl, t, runtime, warehouseId, num, percent, when, minutes,
    call, query, isDenied, scopeLine, stepper, kpis, progressBar, badge, muted,
    field, select, textarea, lookup, wireLookups, formData, createWorkspace, registerOverride,
  };
})(window);
