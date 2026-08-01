/* BUILD-05: governed Collaboration and Notification operations panel. */
(function () {
  'use strict';
  const api = async (path) => {
    const response = await fetch('/api/v1/platform/' + path, { credentials: 'same-origin' });
    const payload = await response.json();
    if (!response.ok || !payload.success) throw new Error(payload.error || 'Platform request failed');
    return payload.data;
  };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const cards = (title, rows, render, empty) => '<div class="pmk-panel"><h3>' + esc(title) + ' (' + rows.length + ')</h3>' + (rows.slice(0, 6).map(render).join('') || '<p>' + esc(empty) + '</p>') + '</div>';
  async function render() {
    const host = document.getElementById('integrationHubBody'); if (!host) return;
    let inbox = [], activities = [], views = [], schedules = [], jobs = { queued: [], failed: [], deadLetters: [] }, health = { providers: [], deadLetters: [] }, error = null;
    try { [inbox, activities, health, views, schedules, jobs] = await Promise.all([api('notifications'), api('activities'), api('notification-health'), api('saved-views?entity=sale_contract'), api('scheduled-reports'), api('job-health')]); } catch (e) { error = e.message; }
    const old = document.getElementById('platformServicesWorkspace'); if (old) old.remove();
    const section = document.createElement('section'); section.id = 'platformServicesWorkspace'; section.className = 'pmk-shell';
    const headline = '<div class="pmk-hero"><div><div class="pmk-kicker">Platform Services</div><h3>Collaboration, notifications, and scheduled reporting</h3><p>All operational data is read from governed APIs; no direct browser writes or live external provider activation.</p><input id="platformGlobalSearch" class="form-input" placeholder="Search registered entities and actions" style="max-width:360px" /></div><button class="btn-secondary" onclick="PlatformServices.refresh()">Refresh</button></div>';
    if (error) section.innerHTML = headline + '<div class="pmk-panel"><strong>Unable to load platform services:</strong> ' + esc(error) + '</div>';
    else section.innerHTML = headline + '<div class="pmk-grid">'
      + cards('Notifications', inbox, (n) => '<p><strong>' + esc(n.subject || n.eventKey) + '</strong><br>' + esc(n.body) + '</p>', 'No notifications.')
      + cards('My activities', activities, (a) => '<p><strong>' + esc(a.summaryAr) + '</strong><br>' + esc(a.entity) + ' / ' + esc(a.dueAt || 'No due date') + '</p>', 'No open activities.')
      + cards('Saved Views', views, (v) => '<p><strong>' + esc(v.name) + '</strong><br>' + esc(v.entity) + '</p>', 'No saved views.')
      + cards('Scheduled reports', schedules, (s) => '<p><strong>' + esc(s.name) + '</strong><br>' + esc(s.reportKey) + ' / ' + esc(s.schedule) + '</p>', 'No active schedules.')
      + '<div class="pmk-panel"><h3>Job Queue</h3><p>Queued: ' + jobs.queued.length + '</p><p>Failed: ' + jobs.failed.length + '</p><p>Dead letters: ' + jobs.deadLetters.length + '</p></div>'
      + '<div class="pmk-panel"><h3>Delivery health</h3><p>Providers: ' + health.providers.length + '</p><p>Dead letters: ' + health.deadLetters.length + '</p><p>External providers remain staged or disabled.</p></div></div>';
    host.prepend(section);
    const input = section.querySelector('#platformGlobalSearch');
    if (input) input.addEventListener('input', async () => { const query = input.value.trim(); const prior = section.querySelector('#platformSearchResults'); if (prior) prior.remove(); if (query.length < 2) return; const result = document.createElement('div'); result.id = 'platformSearchResults'; result.className = 'pmk-panel'; try { const rows = await api('search?q=' + encodeURIComponent(query)); result.innerHTML = '<h3>Search results</h3>' + (rows.map(r => '<p><strong>' + esc(r.id) + '</strong><br>' + esc(r.labelAr || r.labelEn || r.entityId || r.type) + '</p>').join('') || '<p>No registered matches.</p>'); } catch (e) { result.textContent = e.message; } section.append(result); });
  }
  function install() { const original = window.switchPage; if (typeof original !== 'function' || original.__platformServicesWrapped) return; const wrapped = function (page) { const result = original.apply(this, arguments); if (page === 'integration_hub') setTimeout(render, 420); return result; }; wrapped.__platformServicesWrapped = true; window.switchPage = wrapped; }
  window.PlatformServices = { refresh: render, version: 'build05-v2' };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
})();
