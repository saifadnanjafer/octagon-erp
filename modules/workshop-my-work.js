(function workshopMyWork(root) {
  'use strict';

  const PRESETS = [
    ['assigned', 'Assigned'], ['waiting', 'Waiting on me'], ['approvals', 'Approvals'],
    ['today', 'Due today'], ['overdue', 'Overdue'], ['blocked', 'Blocked'], ['recent', 'Recent completion'],
  ];
  const state = { view: 'assigned', loading: false, payload: null, savedViews: [], request: 0, bound: false };

  function el() {
    return {
      page: document.getElementById('pageMyWork'), body: document.getElementById('myWorkBody'),
      summary: document.getElementById('myWorkSummary'), presets: document.getElementById('myWorkPresets'),
      filters: document.getElementById('myWorkFilters'), scope: document.getElementById('myWorkScope'),
      freshness: document.getElementById('myWorkFreshness'), refresh: document.getElementById('myWorkRefresh'),
      sources: document.getElementById('myWorkSourceStatus'), saved: document.getElementById('myWorkSavedViews'),
      savedCount: document.getElementById('myWorkSavedCount'),
    };
  }

  function params() {
    const controls = new FormData(el().filters);
    const result = new URLSearchParams({ view: state.view, limit: '100' });
    for (const [key, value] of controls.entries()) if (value) result.set(key, value);
    if (state.view === 'today') result.set('due', 'today');
    if (state.view === 'overdue') result.set('due', 'overdue');
    if (state.view === 'approvals') result.set('status', 'review');
    return result;
  }

  function summaryHtml(summary = {}) {
    const cards = [
      ['assigned', 'Assigned'], ['waiting', 'Waiting'], ['dueToday', 'Due today'],
      ['overdue', 'Overdue'], ['blocked', 'Blocked'], ['recent', 'Recent'],
    ];
    return cards.map(([key, label]) => `<button type="button" class="my-work-summary-card" data-summary="${key}"><strong>${Number(summary[key] || 0)}</strong><span>${label}</span></button>`).join('');
  }

  function itemHtml(item) {
    const shell = root.WorkshopShell;
    const flags = Object.entries(item.flags || {}).filter(([, active]) => active).map(([flag]) => `<span class="my-work-flag my-work-flag-${shell.escapeHtml(flag)}">${shell.escapeHtml(flag)}</span>`).join('');
    const due = item.dueAt ? new Date(item.dueAt).toLocaleString(shell.locale()) : 'No due date';
    return `<button type="button" class="my-work-item" data-target="${shell.escapeHtml(item.target)}">
      <span class="my-work-item-priority" data-priority="${shell.escapeHtml(item.priority)}"></span>
      <span class="my-work-item-main"><strong>${shell.escapeHtml(item.title)}</strong><small>${shell.escapeHtml(item.description || item.sourceLabel)}</small></span>
      <span class="my-work-item-family">${shell.escapeHtml(item.taskFamily)}</span>
      <span class="my-work-item-status">${shell.escapeHtml(item.status)}</span>
      <span class="my-work-item-due">${shell.escapeHtml(due)}</span>
      <span class="my-work-item-flags">${flags}</span>
      <span class="my-work-item-arrow" aria-hidden="true">↗</span>
    </button>`;
  }

  function populateSelect(select, values, current) {
    if (!select) return;
    const first = select.options[0]?.outerHTML || '<option value="">All</option>';
    select.innerHTML = first + (values || []).map((value) => `<option value="${root.WorkshopShell.escapeHtml(value)}">${root.WorkshopShell.escapeHtml(value)}</option>`).join('');
    select.value = current || '';
  }

  function paint(payload) {
    const nodes = el();
    state.payload = payload;
    root.WorkshopShell.renderScope(nodes.scope, payload.scope || {});
    nodes.freshness.textContent = root.WorkshopShell.formatFreshness(payload.generatedAt);
    nodes.summary.innerHTML = summaryHtml(payload.summary);
    nodes.presets.innerHTML = PRESETS.map(([key, label]) => `<button type="button" role="tab" aria-selected="${key === state.view}" class="my-work-preset${key === state.view ? ' active' : ''}" data-view="${root.WorkshopShell.escapeHtml(key)}">${root.WorkshopShell.escapeHtml(label)}</button>`).join('');
    const formValues = Object.fromEntries(new FormData(nodes.filters).entries());
    populateSelect(nodes.filters.elements.task_family, payload.filters?.taskFamilies, formValues.task_family);
    populateSelect(nodes.filters.elements.status, payload.filters?.statuses, formValues.status);
    populateSelect(nodes.filters.elements.priority, payload.filters?.priorities, formValues.priority);
    populateSelect(nodes.filters.elements.warehouse_id, payload.filters?.warehouses, formValues.warehouse_id);
    nodes.sources.innerHTML = (payload.sources || []).map((source) => `<span class="my-work-source" data-state="${root.WorkshopShell.escapeHtml(source.state)}">${root.WorkshopShell.escapeHtml(source.source)} · ${source.count}</span>`).join('');
    const safeItemMarkup = (payload.items || []).map(itemHtml).join('');
    nodes.body.innerHTML = payload.items?.length ? '<div class="my-work-list-head"><span>Work</span><span>Family</span><span>Status</span><span>Due</span><span>Flags</span></div>' + safeItemMarkup : '<div class="workshop-empty-state"><strong>No assigned work in this view</strong><span>Change filters or open another view.</span></div>';
    bindPainted();
  }

  function bindPainted() {
    const nodes = el();
    nodes.presets.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => { state.view = button.dataset.view; load(); }));
    nodes.body.querySelectorAll('[data-target]').forEach((item) => item.addEventListener('click', () => root.WorkshopShell.navigate(item.dataset.target)));
    nodes.summary.querySelectorAll('[data-summary]').forEach((button) => button.addEventListener('click', () => {
      const mapping = { dueToday: 'today', recent: 'recent' }; state.view = mapping[button.dataset.summary] || button.dataset.summary; load();
    }));
  }

  async function loadSavedViews() {
    const nodes = el();
    try {
      state.savedViews = await root.OctagonApiClient.get('/api/v1/platform/saved-views?entity=work_item');
    } catch (_) { state.savedViews = []; }
    nodes.savedCount.textContent = state.savedViews.length;
    nodes.saved.innerHTML = state.savedViews.length ? state.savedViews.map((view) => `<button type="button" class="my-work-saved-view" data-saved-id="${root.WorkshopShell.escapeHtml(view.id)}">${root.WorkshopShell.escapeHtml(view.name || view.id)}</button>`).join('') : '<span>No saved work-item views.</span>';
    nodes.saved.querySelectorAll('[data-saved-id]').forEach((button) => button.addEventListener('click', () => applySaved(state.savedViews.find((view) => String(view.id) === button.dataset.savedId))));
  }

  function applySaved(view) {
    if (!view) return;
    let definition = view.definition || view.filters || view.configuration || {};
    if (typeof definition === 'string') { try { definition = JSON.parse(definition); } catch (_) { definition = {}; } }
    const nodes = el();
    Object.entries(definition.filters || definition).forEach(([key, value]) => { if (nodes.filters.elements[key]) nodes.filters.elements[key].value = value; });
    if (definition.view) state.view = definition.view;
    load();
  }

  async function load() {
    const nodes = el();
    if (!nodes.page || state.loading) return;
    const request = ++state.request;
    state.loading = true;
    nodes.body.innerHTML = '<div class="workshop-loading"><span class="workshop-spinner"></span> Loading assigned work…</div>';
    nodes.refresh.disabled = true;
    try {
      const payload = await root.OctagonApiClient.get(`/api/v1/workshop/my-work?${params()}`);
      if (request === state.request) paint(payload);
    } catch (error) {
      nodes.body.innerHTML = root.WorkshopShell.errorPanel(error?.message || 'My Work unavailable', 'myWorkRetry');
      document.getElementById('myWorkRetry')?.addEventListener('click', load);
    } finally {
      state.loading = false; nodes.refresh.disabled = false;
    }
  }

  function init() {
    const nodes = el(); if (!nodes.page || state.bound) return;
    state.bound = true;
    nodes.refresh.addEventListener('click', load);
    nodes.filters.addEventListener('change', load);
    nodes.filters.addEventListener('reset', () => root.setTimeout(load, 0));
    loadSavedViews();
  }

  root.renderMyWork = function renderMyWork() { init(); return load(); };
  root.WorkshopMyWork = Object.freeze({ load, state });
})(window);
