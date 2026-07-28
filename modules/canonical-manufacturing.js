(function (root) {
  'use strict';

  // Checkpoint D3: visible Manufacturing workspace over the canonical Octagon runtime.
  root.__canonicalManufacturingAuthorityActive = true;

  const state = {
    active: 'dashboard',
    loading: false,
    error: null,
    rows: { orders: [], workOrders: [], materialReqs: [], costSummaries: [], subcontracts: [] },
  };

  const tabs = [
    ['dashboard', 'لوحة التصنيع', 'Manufacturing Dashboard', 'fa-industry'],
    ['orders', 'أوامر الإنتاج', 'Production Orders', 'fa-boxes-stacked'],
    ['work-orders', 'أوامر العمل', 'Work Orders', 'fa-list-check'],
    ['material-reqs', 'احتياجات المواد', 'Material Requirements', 'fa-cubes'],
    ['cost-summaries', 'تكاليف الإنتاج', 'Production Costing', 'fa-calculator'],
    ['subcontracts', 'التصنيع الخارجي', 'Subcontracting', 'fa-handshake'],
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
    return `<span class="cmfg-badge cmfg-state-${esc(k.replace(/[^a-z0-9_-]/gi, '-'))}">${esc(k)}</span>`;
  }
  function host() { return document.getElementById('pageManufacturing') || document.getElementById('pageMrp') || document.getElementById('mrpBody'); }

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
      const [ordRes, woRes, reqRes, costRes, subRes] = await Promise.all([
        client.get('/api/v1/manufacturing/production-orders').catch(() => ({ data: [] })),
        client.get('/api/v1/manufacturing/work-orders').catch(() => ({ data: [] })),
        client.get('/api/v1/manufacturing/material-requirements').catch(() => ({ data: [] })),
        client.get('/api/v1/manufacturing/cost-summaries').catch(() => ({ data: [] })),
        client.get('/api/v1/manufacturing/subcontract-orders').catch(() => ({ data: [] })),
      ]);
      state.rows.orders = ordRes.data || [];
      state.rows.workOrders = woRes.data || [];
      state.rows.materialReqs = reqRes.data || [];
      state.rows.costSummaries = costRes.data || [];
      state.rows.subcontracts = subRes.data || [];
      state.loading = false;
    } catch (err) {
      state.error = err.message || String(err);
      state.loading = false;
    }
    render();
  }

  function renderNav() {
    return `
      <nav class="cmfg-nav">
        ${tabs.map(([id, ar, en, icon]) => `
          <button type="button" class="cmfg-tab ${state.active === id ? 'active' : ''}" data-cmfg-tab="${id}">
            <i class="fa-solid ${icon}"></i>
            <span>${esc(tx(ar, en))}</span>
          </button>
        `).join('')}
      </nav>
    `;
  }

  function renderContent() {
    if (state.loading) {
      return `<div class="cmfg-state cmfg-loading"><i class="fa-solid fa-circle-notch fa-spin"></i><div>${tx('جاري تحميل بيانات التصنيع…', 'Loading manufacturing data…')}</div></div>`;
    }
    if (state.error) {
      return `<div class="cmfg-error"><i class="fa-solid fa-triangle-exclamation"></i><div><strong>${tx('فشل تحميل التصنيع', 'Manufacturing Load Failure')}</strong><p>${esc(state.error)}</p></div></div>`;
    }

    if (state.active === 'dashboard') {
      const activeOrders = state.rows.orders.filter(o => ['released','in_progress'].includes(o.state)).length;
      const completedOrders = state.rows.orders.filter(o => o.state === 'completed').length;
      return `
        <div class="cmfg-kpis">
          <div class="cmfg-kpi"><i class="fa-solid fa-industry"></i><div><strong>${state.rows.orders.length}</strong><span>${tx('إجمالي أوامر الإنتاج', 'Total Production Orders')}</span></div></div>
          <div class="cmfg-kpi"><i class="fa-solid fa-spinner"></i><div><strong>${activeOrders}</strong><span>${tx('الأوامر النشطة', 'Active Orders')}</span></div></div>
          <div class="cmfg-kpi"><i class="fa-solid fa-circle-check"></i><div><strong>${completedOrders}</strong><span>${tx('الأوامر المكتملة', 'Completed Orders')}</span></div></div>
          <div class="cmfg-kpi"><i class="fa-solid fa-list-check"></i><div><strong>${state.rows.workOrders.length}</strong><span>${tx('أوامر العمل', 'Work Orders')}</span></div></div>
        </div>
      `;
    }

    if (state.active === 'orders') {
      if (!state.rows.orders.length) return `<div class="cmfg-state">${tx('لا توجد أوامر إنتاج حتى الآن.', 'No production orders yet.')}</div>`;
      return `
        <div class="cmfg-table-wrap">
          <table class="cmfg-table">
            <thead>
              <tr>
                <th>${tx('رقم الأمر', 'Order Number')}</th>
                <th>${tx('المنتج', 'Product')}</th>
                <th>${tx('الكمية المخططة', 'Planned Qty')}</th>
                <th>${tx('الكمية المكتملة', 'Completed Qty')}</th>
                <th>${tx('الحالة', 'Status')}</th>
              </tr>
            </thead>
            <tbody>
              ${state.rows.orders.map(o => `
                <tr>
                  <td><strong>${esc(o.order_number)}</strong></td>
                  <td>${esc(o.product_id)}</td>
                  <td>${esc(o.planned_quantity)}</td>
                  <td>${esc(o.completed_quantity)}</td>
                  <td>${badge(o.state)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    if (state.active === 'work-orders') {
      if (!state.rows.workOrders.length) return `<div class="cmfg-state">${tx('لا توجد أوامر عمل حتى الآن.', 'No work orders yet.')}</div>`;
      return `
        <div class="cmfg-table-wrap">
          <table class="cmfg-table">
            <thead>
              <tr>
                <th>${tx('العملية', 'Operation')}</th>
                <th>${tx('مركز العمل', 'Work Center')}</th>
                <th>${tx('الكمية المستهدفة', 'Target Qty')}</th>
                <th>${tx('المنجزة', 'Completed Qty')}</th>
                <th>${tx('الحالة', 'Status')}</th>
              </tr>
            </thead>
            <tbody>
              ${state.rows.workOrders.map(w => `
                <tr>
                  <td><strong>${esc(w.name)}</strong></td>
                  <td>${esc(w.work_center_id)}</td>
                  <td>${esc(w.quantity_to_produce)}</td>
                  <td>${esc(w.quantity_completed)}</td>
                  <td>${badge(w.state)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    return `<div class="cmfg-state">${tx('عرض السجلات القانونية.', 'Showing canonical records.')}</div>`;
  }

  function render() {
    const el = host();
    if (!el) return;
    el.innerHTML = `
      <section class="cmfg-workspace">
        <header class="cmfg-hero">
          <span class="cmfg-eyebrow">${tx('أوكتاغون ERP · عمليات التصنيع القانونية', 'Octagon ERP · Canonical Manufacturing Operations')}</span>
          <h2>${tx('التصنيع وأرضية المصنع', 'Manufacturing & Shop Floor')}</h2>
          <p>${tx('إدارة كاملة لأوامر الإنتاج، التكلفة، المحجوزات وتتبع WIP عبر السجل القانوني.', 'Complete management of production orders, costing, material reservations and WIP tracking.')}</p>
        </header>
        ${renderNav()}
        ${renderContent()}
      </section>
    `;

    el.querySelectorAll('[data-cmfg-tab]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        state.active = ev.currentTarget.getAttribute('data-cmfg-tab');
        render();
      });
    });
  }

  function mount() {
    loadData();
  }

  root.CanonicalManufacturing = { mount, loadData };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})(typeof window !== 'undefined' ? window : globalThis);
