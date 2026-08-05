(function workshopCommandCenter(root) {
  'use strict';

  const state = { loading: false, loadedAt: null, payload: null, error: null, freshnessTimer: null };

  function elements() {
    return {
      page: document.getElementById('pageWorkshopCommandCenter'),
      body: document.getElementById('workshopCommandBody'),
      scope: document.getElementById('workshopCommandScope'),
      freshness: document.getElementById('workshopCommandFreshness'),
      partial: document.getElementById('workshopCommandPartial'),
      refresh: document.getElementById('workshopCommandRefresh'),
    };
  }

  function cardHtml(card) {
    const shell = root.WorkshopShell;
    const label = shell.bilingual(card);
    const value = card.display || (card.value === null || card.value === undefined ? '—' : card.value);
    const interactive = card.state === 'ready' && card.target;
    const tag = interactive ? 'button' : 'article';
    const type = interactive ? ' type="button"' : '';
    const target = interactive ? ` data-target="${shell.escapeHtml(card.target)}"` : '';
    return `<${tag}${type} class="workshop-command-card" data-state="${shell.escapeHtml(card.state)}" data-tone="${shell.escapeHtml(card.tone)}"${target}>
      <div class="workshop-card-state"><span>${shell.escapeHtml(card.state.replaceAll('_', ' '))}</span><span class="workshop-card-dot"></span></div>
      <div class="workshop-card-value">${shell.escapeHtml(value)}</div>
      <div class="workshop-card-label">${shell.escapeHtml(label)}</div>
      <div class="workshop-card-detail">${shell.escapeHtml(card.detail || '')}</div>
      ${interactive ? '<span class="workshop-card-arrow" aria-hidden="true">↗</span>' : ''}
    </${tag}>`;
  }

  function sectionHtml(section) {
    const shell = root.WorkshopShell;
    return `<section class="workshop-command-section" data-section="${shell.escapeHtml(section.id)}">
      <div class="workshop-command-section-head"><h2>${shell.escapeHtml(shell.bilingual(section))}</h2><span class="workshop-command-section-count">${section.cards.length}</span></div>
      <div class="workshop-card-grid">${section.cards.map(cardHtml).join('')}</div>
    </section>`;
  }

  function bindCards(body) {
    body.querySelectorAll('[data-target]').forEach((card) => card.addEventListener('click', () => root.WorkshopShell.navigate(card.dataset.target)));
  }

  function paint(payload) {
    const el = elements();
    if (!el.body || !payload) return;
    state.payload = payload;
    state.loadedAt = payload.generatedAt;
    root.WorkshopShell.renderScope(el.scope, payload.scope || {});
    el.body.innerHTML = (payload.sections || []).map(sectionHtml).join('') || '<div class="workshop-empty-state">No permitted operational signals are available.</div>';
    bindCards(el.body);
    if (el.partial) {
      const unavailable = Number(payload.summary?.unavailable || 0);
      el.partial.hidden = unavailable === 0;
      el.partial.textContent = unavailable ? `${unavailable} operational signal${unavailable === 1 ? '' : 's'} could not be loaded. Available sections remain usable.` : '';
    }
    updateFreshness();
  }

  function updateFreshness() {
    const el = elements();
    if (el.freshness) el.freshness.textContent = root.WorkshopShell.formatFreshness(state.loadedAt);
  }

  async function load(force = false) {
    const el = elements();
    if (!el.page || !el.body || state.loading) return;
    if (!force && state.payload) { paint(state.payload); return; }
    state.loading = true;
    state.error = null;
    el.body.innerHTML = '<div class="workshop-loading" role="status"><span class="workshop-spinner"></span> Loading operational signals…</div>';
    if (el.refresh) el.refresh.disabled = true;
    try {
      const payload = await root.OctagonApiClient.get('/api/v1/workshop/command-center');
      paint(payload);
    } catch (error) {
      state.error = error;
      el.body.innerHTML = root.WorkshopShell.errorPanel(error?.message || 'Unknown server error', 'workshopCommandRetry');
      document.getElementById('workshopCommandRetry')?.addEventListener('click', () => load(true));
    } finally {
      state.loading = false;
      if (el.refresh) el.refresh.disabled = false;
    }
  }

  function init() {
    const el = elements();
    if (!el.page || el.page.dataset.boundWorkshopCommand === '1') return;
    el.page.dataset.boundWorkshopCommand = '1';
    el.refresh?.addEventListener('click', () => load(true));
    state.freshnessTimer = root.setInterval(updateFreshness, 15000);
  }

  root.renderWorkshopCommandCenter = function renderWorkshopCommandCenter() { init(); return load(false); };
  root.WorkshopCommandCenter = Object.freeze({ load, state });
})(window);

