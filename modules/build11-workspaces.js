(function () {
  'use strict';
  const root = window;
  const PAGES = {
    saas_overview: ['SaaS Overview', 'نظرة SaaS', 'overview'],
    tenant_directory: ['Tenant Directory', 'دليل المستأجرين', 'tenants'],
    tenant_detail: ['Tenant Detail', 'تفاصيل المستأجر', 'tenant'],
    commercial_plans: ['Commercial Plans', 'الخطط التجارية', 'plans'],
    subscriptions: ['Subscriptions', 'الاشتراكات', 'subscriptions'],
    entitlements: ['Entitlements', 'الاستحقاقات', 'entitlements'],
    seats_and_limits: ['Seats and Limits', 'المقاعد والحدود', 'seats-and-limits'],
    usage_and_quotas: ['Usage and Quotas', 'الاستخدام والحصص', 'usage-and-quotas'],
    billing_simulator: ['Billing Simulator', 'محاكي الفوترة', 'billing-simulator'],
    extension_marketplace: ['Extension Marketplace', 'سوق الإضافات الآمن', 'extension-marketplace'],
    extension_installations: ['Extension Installations', 'تثبيتات الإضافات', 'extension-installations'],
  };
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rtl = () => document.documentElement.dir === 'rtl' || String(document.documentElement.lang).startsWith('ar');
  const label = (en, ar) => rtl() ? ar : en;
  const api = async (path, options = {}) => {
    const response = await fetch(`/api/v1/saas/${path}`, { credentials: 'same-origin', headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) }, ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) { const error = new Error(payload.error || (response.status === 403 ? 'Access denied' : 'Request failed')); error.status = response.status; error.payload = payload; throw error; }
    return payload.data;
  };
  const containerFor = (pageId) => {
    let host = document.querySelector(`[data-build11-page="${pageId}"]`);
    if (!host) { host = document.createElement('section'); host.className = 'page b11-page'; host.dataset.page = pageId; host.dataset.build11Page = pageId; (document.getElementById('mainContent') || document.body).appendChild(host); }
    return host;
  };
  const status = (host, phase, message) => { const node = host.querySelector('[data-role="status"]'); if (node) { node.dataset.phase = phase; node.textContent = message; } };
  const rows = (data) => Array.isArray(data) ? data : (data && typeof data === 'object' ? Object.entries(data).map(([key, value]) => ({ key, value: typeof value === 'object' ? JSON.stringify(value) : value })) : []);
  function table(data) {
    const list = rows(data);
    if (!list.length) return `<div class="b11-empty" data-state="empty">${label('No records in this scope.', 'لا توجد سجلات في هذا النطاق.')}</div>`;
    const keys = [...new Set(list.flatMap((item) => Object.keys(item)))].slice(0, 8);
    return `<div class="b11-table-wrap"><table class="b11-table"><thead><tr>${keys.map((key) => `<th>${escapeHtml(key.replaceAll('_', ' '))}</th>`).join('')}</tr></thead><tbody>${list.map((item) => `<tr>${keys.map((key) => `<td>${escapeHtml(typeof item[key] === 'object' ? JSON.stringify(item[key]) : item[key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function actionForm(pageId) {
    if (pageId === 'tenant_directory') return `<form class="b11-form" data-build11-form="tenant-create"><label>Tenant ID<input name="tenant_id" required pattern="[a-z0-9_\\-]+"></label><label>Name<input name="name" required></label><button class="b11-btn primary" data-build11-action="tenant-create" type="submit">${label('Create tenant', 'إنشاء مستأجر')}</button></form>`;
    if (pageId === 'tenant_detail') return `<form class="b11-form" data-build11-form="tenant-provision"><label>Tenant ID<input name="tenant_id" value="${escapeHtml(root.__octagonBootstrap?.actor?.tenantId || 'default')}" required></label><button class="b11-btn primary" data-build11-action="tenant-provision" type="submit">${label('Provision / resume', 'بدء أو استئناف التهيئة')}</button></form>`;
    if (pageId === 'usage_and_quotas') return `<form class="b11-form" data-build11-form="usage-record"><label>Metric<input name="metric" value="api_calls" required></label><label>Quantity<input name="quantity" type="number" min="0" value="1" required></label><label>Idempotency key<input name="idempotency_key" required></label><button class="b11-btn primary" data-build11-action="usage-record" type="submit">${label('Record usage', 'تسجيل استخدام')}</button></form>`;
    if (pageId === 'extension_marketplace') return `<form class="b11-form b11-wide" data-build11-form="package-validate"><label>Manifest JSON<textarea name="manifest" required>{"package_id":"safe_package","publisher":"curated","name":"Safe terminology","version":"1.0.0","compatibility_range":"*","manifest_version":"1","provenance":"curated","checksum":"sha256:provided","signature":"signed:provided","permissions_requested":[],"contributions":[{"type":"terminology_overlay"}]}</textarea></label><button class="b11-btn primary" data-build11-action="package-validate" type="submit">${label('Validate manifest', 'التحقق من البيان')}</button></form>`;
    return '';
  }
  async function runForm(host, form) {
    const values = Object.fromEntries(new FormData(form).entries()); const name = form.dataset.build11Form; let action; let body = values;
    if (name === 'tenant-create') { action = 'saas:tenant_create'; }
    if (name === 'tenant-provision') { action = 'saas:tenant_provision'; }
    if (name === 'usage-record') { action = 'saas:usage_record'; body.quantity = Number(body.quantity); }
    if (name === 'package-validate') { action = 'saas:package_validate'; body = { manifest: JSON.parse(body.manifest) }; }
    if (!action) return;
    body.idempotency_key = body.idempotency_key || `${action}-${Date.now()}`;
    status(host, 'loading', label('Saving…', 'جارٍ الحفظ…'));
    try { await fetch(`/api/v1/action/${action}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': `${action}-${Date.now()}` }, body: JSON.stringify(body) }).then(async (response) => { const payload = await response.json(); if (!response.ok || payload.success === false) throw new Error(payload.error || 'Action denied'); return payload; }); status(host, 'success', label('Action completed and audited.', 'اكتمل الإجراء وسُجل في التدقيق.')); await load(host, host.dataset.build11Page); }
    catch (error) { status(host, 'error', error.message); }
  }
  async function load(host, pageId) {
    const meta = PAGES[pageId]; if (!meta) return; host.dataset.build11Page = pageId; host.innerHTML = `<div class="b11-shell"><header class="b11-header"><div><span class="b11-kicker">${label('COMMERCIAL AND SAAS', 'التجاري و SaaS')}</span><h2>${escapeHtml(label(meta[0], meta[1]))}</h2><p>${label('Server-scoped commercial state; simulator boundaries are explicit.', 'حالة تجارية محددة من الخادم؛ حدود المحاكاة واضحة.')}</p></div><button class="b11-btn" data-command="refresh">${label('Refresh', 'تحديث')}</button></header><div class="b11-status" data-role="status" data-phase="loading">${label('Loading…', 'جارٍ التحميل…')}</div><div class="b11-action-slot">${actionForm(pageId)}</div><main class="b11-content" data-role="content"></main></div>`;
    host.querySelector('[data-command="refresh"]').addEventListener('click', () => load(host, pageId));
    host.querySelectorAll('form[data-build11-form]').forEach((form) => form.addEventListener('submit', (event) => { event.preventDefault(); runForm(host, form); }));
    try { const data = await api(meta[2]); host.querySelector('[data-role="content"]').innerHTML = pageId === 'saas_overview' ? `<div class="b11-metric-grid">${rows(data?.[0] || data).map((item) => `<article class="b11-card"><span>${escapeHtml(item.key || 'metric')}</span><strong>${escapeHtml(item.value ?? item.count ?? item.n ?? '')}</strong></article>`).join('')}</div>${table(data)}` : table(data); status(host, 'ready', `${label('Generated', 'تم الإنشاء')}: ${new Date().toLocaleString()}`); }
    catch (error) { host.querySelector('[data-role="content"]').innerHTML = `<div class="b11-denied" data-state="${error.status === 403 ? 'denied' : 'error'}">${escapeHtml(error.message)}</div>`; status(host, error.status === 403 ? 'denied' : 'error', error.message); }
  }
  function activate(pageId) { if (!PAGES[pageId]) return; document.querySelectorAll('.b11-page').forEach((node) => { node.style.display = node.dataset.build11Page === pageId ? 'block' : 'none'; }); const host = containerFor(pageId); host.style.display = 'block'; load(host, pageId); }
  const originalSwitchPage = root.switchPage;
  if (typeof originalSwitchPage === 'function' && !originalSwitchPage.__build11Wrapped) { const wrapped = function (pageId) { const result = originalSwitchPage.apply(this, arguments); if (PAGES[pageId]) Promise.resolve(result).then(() => activate(pageId)); return result; }; wrapped.__build11Wrapped = true; root.switchPage = wrapped; }
  root.Build11Engine = { PAGES, activate, load, api };
  root.addEventListener('octagon:language-changed', () => { const active = document.querySelector('.b11-page[style*="block"]'); if (active) load(active, active.dataset.build11Page); });
})();
