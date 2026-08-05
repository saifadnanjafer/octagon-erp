(function workshopDrilldown(root) {
  'use strict';

  const state = { open: false, loading: false, metricId: null, target: null, label: '', payload: null, returnFocus: null };

  function elements() {
    return {
      panel: document.getElementById('workshopDrilldown'), backdrop: document.getElementById('workshopDrilldownBackdrop'),
      title: document.getElementById('workshopDrilldownTitle'), description: document.getElementById('workshopDrilldownDescription'),
      scope: document.getElementById('workshopDrilldownScope'), body: document.getElementById('workshopDrilldownBody'),
      count: document.getElementById('workshopDrilldownCount'), close: document.getElementById('workshopDrilldownClose'),
      target: document.getElementById('workshopDrilldownOpenTarget'),
    };
  }

  function safeDate(value) {
    if (!value) return 'No due date';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
  }

  function priorityClass(priority) {
    const normalized = String(priority || 'normal').toLowerCase();
    if (['urgent', 'critical', 'high'].includes(normalized)) return 'danger';
    if (['warning', 'medium'].includes(normalized)) return 'attention';
    return 'normal';
  }

  function rowHtml(row) {
    const escape = root.WorkshopShell.escapeHtml;
    return `<article class="workshop-drilldown-row" data-priority="${priorityClass(row.priority)}">
      <div class="workshop-drilldown-row-main">
        <strong>${escape(row.title || row.id)}</strong>
        <span class="workshop-drilldown-reference">${escape(row.reference || row.type || '')}</span>
      </div>
      <div class="workshop-drilldown-row-meta">
        <span class="workshop-status-pill">${escape(row.status || 'unknown')}</span>
        <span>${escape(row.priority || 'normal')}</span>
        <span>${escape(safeDate(row.dueAt))}</span>
        <span>${escape(row.ownerId ? `Owner: ${row.ownerId}` : 'Unassigned')}</span>
      </div>
    </article>`;
  }

  function render(payload) {
    const el = elements();
    state.payload = payload;
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    el.description.textContent = payload?.description || 'Live records from the canonical operational authority.';
    root.WorkshopShell.renderScope(el.scope, payload?.scope || {});
    el.body.innerHTML = rows.length
      ? rows.map(rowHtml).join('')
      : '<div class="workshop-empty-state">No matching open records in the active scope.</div>';
    el.count.textContent = `${rows.length} record${rows.length === 1 ? '' : 's'} · bounded live query`;
    el.target.disabled = !state.target;
  }

  function renderError(error) {
    const el = elements();
    el.body.innerHTML = root.WorkshopShell.errorPanel(error?.message || 'Unable to load signal details', 'workshopDrilldownRetry');
    el.count.textContent = 'Detail unavailable';
    document.getElementById('workshopDrilldownRetry')?.addEventListener('click', load);
  }

  async function load() {
    const el = elements();
    if (!state.metricId || state.loading) return;
    state.loading = true;
    el.body.innerHTML = '<div class="workshop-loading" role="status"><span class="workshop-spinner"></span> Loading scoped records…</div>';
    el.count.textContent = 'Loading';
    try {
      const metric = encodeURIComponent(state.metricId);
      const payload = await root.OctagonApiClient.get(`/api/v1/workshop/drilldown?metric_id=${metric}&limit=20`);
      render(payload);
    } catch (error) { renderError(error); }
    finally { state.loading = false; }
  }

  function focusable(panel) {
    return [...panel.querySelectorAll('button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')];
  }

  function trapFocus(event) {
    if (!state.open || event.key !== 'Tab') return;
    const items = focusable(elements().panel);
    if (!items.length) return;
    const first = items[0]; const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function close() {
    const el = elements();
    if (!state.open) return;
    state.open = false;
    el.panel.hidden = true; el.backdrop.hidden = true;
    document.body.classList.remove('workshop-drilldown-open');
    state.returnFocus?.focus?.();
  }

  function openPanel(metricId, target, label) {
    const el = elements();
    if (!el.panel) { root.WorkshopShell.navigate(target); return; }
    state.metricId = metricId; state.target = target; state.label = label || 'Signal details';
    state.returnFocus = document.activeElement; state.open = true; state.payload = null;
    el.title.textContent = state.label; el.panel.hidden = false; el.backdrop.hidden = false;
    document.body.classList.add('workshop-drilldown-open');
    el.close.focus();
    load();
  }

  function init() {
    const el = elements();
    if (!el.panel || el.panel.dataset.bound === '1') return;
    el.panel.dataset.bound = '1';
    el.close.addEventListener('click', close); el.backdrop.addEventListener('click', close);
    el.target.addEventListener('click', () => { const target = state.target; close(); if (target) root.WorkshopShell.navigate(target); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); else trapFocus(event); });
  }

  root.WorkshopDrilldown = Object.freeze({ open(metricId, target, label) { init(); openPanel(metricId, target, label); }, close, load, state });
})(window);
