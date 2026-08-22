(function workshopShell(root) {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function locale() {
    const context = root.OctagonRuntimeContext || {};
    return context.locale || document.documentElement.lang || 'ar';
  }

  function bilingual(item, key = 'label') {
    return locale().toLowerCase().startsWith('ar') ? (item[`${key}Ar`] || item[key]) : (item[key] || item[`${key}Ar`]);
  }

  function activeScope() {
    const context = root.OctagonRuntimeContext || {};
    return {
      companyId: context.companyId || context.activeCompanyId || '',
      branchId: context.branchId || '',
      warehouseId: context.warehouseId || '',
      actorId: context.actorId || context.userId || '',
    };
  }

  function formatFreshness(value) {
    if (!value) return 'لم يُحمَّل بعد';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    const seconds = Math.max(0, Math.round((Date.now() - parsed.getTime()) / 1000));
    if (seconds < 10) return 'حُدِّث الآن';
    if (seconds < 60) return `حُدِّث قبل ${seconds} ثانية`;
    return `حُدِّث قبل ${Math.floor(seconds / 60)} دقيقة`;
  }

  function navigate(page) {
    if (!page) return;
    if (typeof root.switchPage === 'function') root.switchPage(page);
  }

  function renderScope(host, scope) {
    if (!host) return;
    const rows = [
      ['الشركة', scope.companyId],
      ['الفرع', scope.branchId || 'كل المسموح'],
      ['المستودع', scope.warehouseId || 'اختر مستودعاً'],
      ['المستخدم', scope.actorId || 'مستخدم الجلسة'],
    ];
    host.innerHTML = rows.map(([label, value]) => `<span class="workshop-scope-pill">${escapeHtml(label)}<strong>${escapeHtml(value)}</strong></span>`).join('');
  }

  function errorPanel(message, retryId) {
    return `<div class="workshop-error-state" role="alert"><strong>Operational data could not be loaded</strong><span>${escapeHtml(message)}</span>${retryId ? `<button class="btn-secondary" id="${escapeHtml(retryId)}" type="button">Retry</button>` : ''}</div>`;
  }

  root.WorkshopShell = Object.freeze({ escapeHtml, locale, bilingual, activeScope, formatFreshness, navigate, renderScope, errorPanel });
})(window);

