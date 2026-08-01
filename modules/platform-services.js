/* BUILD-05: governed Collaboration and Notification operations panel. */
(function () {
  'use strict';
  const api = async (path, options) => {
    const response = await fetch('/api/v1/platform/' + path, { credentials: 'same-origin', ...options });
    const payload = await response.json();
    if (!response.ok || !payload.success) throw new Error(payload.error || 'Platform request failed');
    return payload.data;
  };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  async function render() {
    const host = document.getElementById('integrationHubBody'); if (!host) return;
    let inbox = [], activities = [], health = { providers: [], deadLetters: [] }, error = null;
    try { [inbox, activities, health] = await Promise.all([api('notifications'), api('activities'), api('notification-health')]); } catch (e) { error = e.message; }
    const old = document.getElementById('platformServicesWorkspace'); if (old) old.remove();
    const section = document.createElement('section'); section.id = 'platformServicesWorkspace'; section.className = 'pmk-shell';
    section.innerHTML = '<div class="pmk-hero"><div><div class="pmk-kicker">Platform Services</div><h3>التعاون والإشعارات والأنشطة</h3><p>كل البيانات من API المحكوم؛ لا توجد كتابة مباشرة أو مزود خارجي مفعّل.</p></div><button class="btn-secondary" onclick="PlatformServices.refresh()">تحديث</button></div>'
      + (error ? '<div class="pmk-panel"><strong>تعذر تحميل الخدمات:</strong> ' + esc(error) + '</div>'
      : '<div class="pmk-grid"><div class="pmk-panel"><h3>الإشعارات (' + inbox.length + ')</h3>' + (inbox.slice(0,6).map(n => '<p><strong>' + esc(n.subject || n.eventKey) + '</strong><br>' + esc(n.body) + '</p>').join('') || '<p>لا توجد إشعارات.</p>') + '</div>'
      + '<div class="pmk-panel"><h3>أنشطتي (' + activities.length + ')</h3>' + (activities.slice(0,6).map(a => '<p><strong>' + esc(a.summaryAr) + '</strong><br>' + esc(a.entity) + ' · ' + esc(a.dueAt || 'بدون موعد') + '</p>').join('') || '<p>لا توجد أنشطة مفتوحة.</p>') + '</div>'
      + '<div class="pmk-panel"><h3>صحة التسليم</h3><p>مزودات: ' + health.providers.length + '</p><p>Dead letters: ' + health.deadLetters.length + '</p><p>المزودات الخارجية تبقى محاكاة/مغلقة.</p></div></div>');
    host.prepend(section);
  }
  function install() { const original = window.switchPage; if (typeof original !== 'function' || original.__platformServicesWrapped) return; const wrapped = function (page) { const result = original.apply(this, arguments); if (page === 'integration_hub') setTimeout(render, 420); return result; }; wrapped.__platformServicesWrapped = true; window.switchPage = wrapped; }
  window.PlatformServices = { refresh: render, version: 'build05-v1' };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
})();
