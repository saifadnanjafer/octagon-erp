(function workshopReadiness(root) {
  'use strict';

  const state = { loading: false, payload: null, activeCategory: null, bound: false };

  function el() {
    return {
      page: document.getElementById('pageWorkshopReadiness'), body: document.getElementById('workshopReadinessBody'),
      nav: document.getElementById('workshopReadinessNav'), formula: document.getElementById('workshopReadinessFormula'),
      scope: document.getElementById('workshopReadinessScope'), freshness: document.getElementById('workshopReadinessFreshness'),
      refresh: document.getElementById('workshopReadinessRefresh'),
    };
  }

  function stateLabel(value) { return String(value || 'NOT_SUPPORTED').replaceAll('_', ' '); }

  function navHtml(category) {
    const shell = root.WorkshopShell;
    const active = category.id === state.activeCategory;
    return `<button type="button" class="readiness-category-tab${active ? ' active' : ''}" data-category="${shell.escapeHtml(category.id)}" aria-current="${active ? 'step' : 'false'}">
      <span class="readiness-category-icon" aria-hidden="true">${shell.escapeHtml(category.icon.slice(0, 1).toUpperCase())}</span>
      <span><strong>${shell.escapeHtml(shell.bilingual(category))}</strong><small>${category.checks.length} checks</small></span>
      <em data-state="${shell.escapeHtml(category.state)}">${shell.escapeHtml(stateLabel(category.state))}</em>
    </button>`;
  }

  function checkHtml(check) {
    const shell = root.WorkshopShell;
    const actionable = check.target && !['READY','PERMISSION_DENIED','NOT_SUPPORTED'].includes(check.state);
    return `<article class="readiness-check" data-state="${shell.escapeHtml(check.state)}">
      <div class="readiness-check-state"><span aria-hidden="true"></span>${shell.escapeHtml(stateLabel(check.state))}</div>
      <div class="readiness-check-copy"><strong>${shell.escapeHtml(shell.bilingual(check))}</strong><p>${shell.escapeHtml(check.detail || '')}</p><small>${check.mandatory ? 'Mandatory' : 'Optional'}${check.value !== null && check.value !== undefined ? ` · ${shell.escapeHtml(check.value)}` : ''}</small></div>
      ${actionable ? `<button type="button" class="btn-secondary readiness-setup-link" data-target="${shell.escapeHtml(check.target)}">Open setup ↗</button>` : ''}
    </article>`;
  }

  function categoryHtml(category) {
    const shell = root.WorkshopShell;
    const ready = category.checks.filter((check) => check.state === 'READY').length;
    return `<section class="readiness-category-panel" data-category-panel="${shell.escapeHtml(category.id)}">
      <div class="readiness-category-heading"><div><p>Setup category</p><h2>${shell.escapeHtml(shell.bilingual(category))}</h2></div><span data-state="${shell.escapeHtml(category.state)}">${shell.escapeHtml(stateLabel(category.state))}</span></div>
      <div class="readiness-category-progress"><span style="width:${Math.round((ready / Math.max(1, category.checks.length)) * 100)}%"></span></div>
      <div class="readiness-check-list">${category.checks.map(checkHtml).join('')}</div>
    </section>`;
  }

  function formulaHtml(formula) {
    const shell = root.WorkshopShell;
    return `<div class="readiness-score"><strong>${Number(formula.percentage || 0)}%</strong><span>mandatory readiness</span></div>
      <div class="readiness-score-bar"><span style="width:${Number(formula.percentage || 0)}%"></span></div>
      <div class="readiness-formula-copy"><strong>${shell.escapeHtml(formula.expression)}</strong><span>${formula.passed} passed ÷ ${formula.denominator} evaluated · ${formula.failed} failed · ${formula.optional} optional · ${formula.excludedPermission} permission-hidden · ${formula.excludedUnsupported} unsupported</span><small>Excluded from denominator: ${shell.escapeHtml((formula.exclusions || []).join(', '))}</small></div>`;
  }

  function paint(payload) {
    const nodes = el(); state.payload = payload;
    state.activeCategory = state.activeCategory || payload.categories?.[0]?.id || null;
    root.WorkshopShell.renderScope(nodes.scope, payload.scope || {});
    nodes.freshness.textContent = root.WorkshopShell.formatFreshness(payload.generatedAt);
    nodes.formula.innerHTML = formulaHtml(payload.formula || {});
    nodes.nav.innerHTML = (payload.categories || []).map(navHtml).join('');
    const current = payload.categories.find((category) => category.id === state.activeCategory) || payload.categories[0];
    nodes.body.innerHTML = current ? categoryHtml(current) : '<div class="workshop-empty-state">No readiness categories are available.</div>';
    bindPainted();
  }

  function bindPainted() {
    const nodes = el();
    nodes.nav.querySelectorAll('[data-category]').forEach((button) => button.addEventListener('click', () => { state.activeCategory = button.dataset.category; paint(state.payload); }));
    nodes.body.querySelectorAll('[data-target]').forEach((button) => button.addEventListener('click', () => root.WorkshopShell.navigate(button.dataset.target)));
  }

  async function load() {
    const nodes = el(); if (!nodes.page || state.loading) return;
    state.loading = true; nodes.refresh.disabled = true;
    nodes.body.innerHTML = '<div class="workshop-loading"><span class="workshop-spinner"></span> Inspecting configuration…</div>';
    try {
      const payload = await root.OctagonApiClient.get('/api/v1/workshop/readiness');
      paint(payload);
    } catch (error) {
      nodes.body.innerHTML = root.WorkshopShell.errorPanel(error?.message || 'Readiness unavailable', 'workshopReadinessRetry');
      document.getElementById('workshopReadinessRetry')?.addEventListener('click', load);
    } finally { state.loading = false; nodes.refresh.disabled = false; }
  }

  function init() {
    const nodes = el(); if (!nodes.page || state.bound) return;
    state.bound = true; nodes.refresh.addEventListener('click', load);
  }

  root.renderWorkshopReadiness = function renderWorkshopReadiness() { init(); return load(); };
  root.WorkshopReadiness = Object.freeze({ load, state });
})(window);

