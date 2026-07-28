(function (root) {
  'use strict';

  // Checkpoint E2: visible Maintenance Management workspace over the canonical Octagon runtime.
  root.__canonicalMaintenanceAuthorityActive = true;

  const state = {
    active: 'dashboard',
    loading: false,
    error: null,
    rows: { requests: [], plans: [], orders: [], spareParts: [] },
  };

  const tabs = [
    ['dashboard', 'لوحة الصيانة', 'Maintenance Dashboard', 'fa-wrench'],
    ['requests', 'طلبات الصيانة', 'Requests', 'fa-file-signature'],
    ['plans', 'الخُطط الوقائية', 'Preventive Plans', 'fa-calendar-check'],
    ['orders', 'أوامر الصيانة', 'Work Orders', 'fa-screwdriver-wrench'],
    ['spare-parts', 'قطع الغيار', 'Spare Parts', 'fa-gears'],
  ];

  function isArabic() {
    const lang = String(document.documentElement.lang || '').toLowerCase();
    return document.documentElement.dir === 'rtl' || !lang || lang.startsWith('ar');
  }
  function tx(ar, en) { return isArabic() ? ar : en; }
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function badge(v) {
    const k = String(v || 'unknown');
    return `<span class="cmnt-badge cmnt-state-${esc(k.replace(/[^a-z0-9_-]/gi, '-'))}">${esc(k)}</span>`;
  }
  function host() { return document.getElementById('pageMaintenance') || document.getElementById('pageEquipment') || document.getElementById('pageMachines') || document.getElementById('machinesBody'); }

  async function loadData() {
    state.loading = true;
    state.error = null;
    render();
    try {
      const client = root.CanonicalClient;
      if (!client) {
        state.loading = false;
        render();
        return;
      }
      const [rRes, pRes, oRes, sRes] = await Promise.all([
        client.get('/api/v1/maintenance/requests').catch(() => ({ data: [] })),
        client.get('/api/v1/maintenance/plans').catch(() => ({ data: [] })),
        client.get('/api/v1/maintenance/orders').catch(() => ({ data: [] })),
        client.get('/api/v1/maintenance/spare-parts').catch(() => ({ data: [] })),
      ]);
      state.rows.requests = rRes.data || [];
      state.rows.plans = pRes.data || [];
      state.rows.orders = oRes.data || [];
      state.rows.spareParts = sRes.data || [];
      state.loading = false;
    } catch (err) {
      state.error = err.message || String(err);
      state.loading = false;
    }
    render();
  }

  function renderNav() {
    return `
      <nav class="cmnt-nav">
        ${tabs.map(([id, ar, en, icon]) => `
          <button type="button" class="cmnt-tab ${state.active === id ? 'active' : ''}" data-cmnt-tab="${id}">
            <i class="fa-solid ${icon}"></i>
            <span>${esc(tx(ar, en))}</span>
          </button>
        `).join('')}
      </nav>
    `;
  }

  function renderContent() {
    if (state.loading) {
      return `<div class="cmnt-state cmnt-loading"><i class="fa-solid fa-circle-notch fa-spin"></i><div>${tx('جاري تحميل بيانات الصيانة…', 'Loading maintenance data…')}</div></div>`;
    }
    if (state.error) {
      return `<div class="cmnt-error"><i class="fa-solid fa-triangle-exclamation"></i><div><strong>${tx('فشل تحميل الصيانة', 'Maintenance Load Failure')}</strong><p>${esc(state.error)}</p></div></div>`;
    }

    if (state.active === 'dashboard') {
      const completed = state.rows.orders.filter(o => o.state === 'completed').length;
      return `
        <div class="cmnt-kpis">
          <div class="cmnt-kpi"><i class="fa-solid fa-screwdriver-wrench"></i><div><strong>${state.rows.orders.length}</strong><span>${tx('إجمالي أوامر الصيانة', 'Total Maintenance Orders')}</span></div></div>
          <div class="cmnt-kpi"><i class="fa-solid fa-file-signature"></i><div><strong>${state.rows.requests.length}</strong><span>${tx('طلبات الصيانة', 'Maintenance Requests')}</span></div></div>
          <div class="cmnt-kpi"><i class="fa-solid fa-calendar-check"></i><div><strong>${state.rows.plans.length}</strong><span>${tx('الخطط الوقائية', 'Preventive Plans')}</span></div></div>
          <div class="cmnt-kpi"><i class="fa-solid fa-circle-check"></i><div><strong>${completed}</strong><span>${tx('الأوامر المكتملة', 'Completed Orders')}</span></div></div>
        </div>
      `;
    }

    if (state.active === 'orders') {
      if (!state.rows.orders.length) return `<div class="cmnt-state">${tx('لا توجد أوامر صيانة حتى الآن.', 'No maintenance orders yet.')}</div>`;
      return `
        <div class="cmnt-table-wrap">
          <table class="cmnt-table">
            <thead>
              <tr>
                <th>${tx('رقم الأمر', 'Order Number')}</th>
                <th>${tx('العنوان', 'Title')}</th>
                <th>${tx('النوع', 'Type')}</th>
                <th>${tx('الأصل', 'Asset')}</th>
                <th>${tx('الحالة', 'Status')}</th>
              </tr>
            </thead>
            <tbody>
              ${state.rows.orders.map(o => `
                <tr>
                  <td><strong>${esc(o.order_number)}</strong></td>
                  <td>${esc(o.title)}</td>
                  <td>${esc(o.order_type)}</td>
                  <td>${esc(o.asset_id)}</td>
                  <td>${badge(o.state)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    return `<div class="cmnt-state">${tx('عرض سجلات الصيانة القانونية.', 'Showing canonical maintenance records.')}</div>`;
  }

  function render() {
    const el = host();
    if (!el) return;
    el.innerHTML = `
      <section class="cmnt-workspace">
        <header class="cmnt-hero">
          <span class="cmnt-eyebrow">${tx('أوكتاغون ERP · إدارة الصيانة الوقائية والطارئة', 'Octagon ERP · Preventive & Emergency Maintenance')}</span>
          <h2>${tx('الصيانة وقطع الغيار', 'Maintenance & Spare Parts')}</h2>
          <p>${tx('طلبات صيانة المعدات، الخطط الوقائية، التوقفات وحجز صرف قطع الغيار من المخزون.', 'Equipment maintenance requests, preventive schedules, downtime and spare parts inventory integration.')}</p>
        </header>
        ${renderNav()}
        ${renderContent()}
      </section>
    `;

    el.querySelectorAll('[data-cmnt-tab]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        state.active = ev.currentTarget.getAttribute('data-cmnt-tab');
        render();
      });
    });
  }

  function mount() {
    loadData();
  }

  root.CanonicalMaintenance = { mount, loadData };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})(typeof window !== 'undefined' ? window : globalThis);
