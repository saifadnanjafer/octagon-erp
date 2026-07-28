(function (root) {
  'use strict';

  // Checkpoint E1: visible Asset Management workspace over the canonical Octagon runtime.
  root.__canonicalAssetsAuthorityActive = true;

  const state = {
    active: 'dashboard',
    loading: false,
    error: null,
    rows: { categories: [], assets: [], schedules: [], transfers: [] },
  };

  const tabs = [
    ['dashboard', 'لوحة الأصول', 'Asset Dashboard', 'fa-building-columns'],
    ['assets', 'سجل الأصول', 'Asset Register', 'fa-boxes-packing'],
    ['categories', 'فئات الأصول', 'Categories', 'fa-folder-tree'],
    ['schedules', 'جداول الإهلاك', 'Depreciation Schedules', 'fa-chart-line'],
    ['transfers', 'النقولات والعهدة', 'Transfers & Custody', 'fa-right-left'],
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
    return `<span class="cast-badge cast-state-${esc(k.replace(/[^a-z0-9_-]/gi, '-'))}">${esc(k)}</span>`;
  }
  function host() { return document.getElementById('pageAssets') || document.getElementById('assetsBody'); }

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
      const [catRes, astRes, schRes, trnRes] = await Promise.all([
        client.get('/api/v1/assets/categories').catch(() => ({ data: [] })),
        client.get('/api/v1/assets/assets').catch(() => ({ data: [] })),
        client.get('/api/v1/assets/depreciation-schedules').catch(() => ({ data: [] })),
        client.get('/api/v1/assets/transfers').catch(() => ({ data: [] })),
      ]);
      state.rows.categories = catRes.data || [];
      state.rows.assets = astRes.data || [];
      state.rows.schedules = schRes.data || [];
      state.rows.transfers = trnRes.data || [];
      state.loading = false;
    } catch (err) {
      state.error = err.message || String(err);
      state.loading = false;
    }
    render();
  }

  function renderNav() {
    return `
      <nav class="cast-nav">
        ${tabs.map(([id, ar, en, icon]) => `
          <button type="button" class="cast-tab ${state.active === id ? 'active' : ''}" data-cast-tab="${id}">
            <i class="fa-solid ${icon}"></i>
            <span>${esc(tx(ar, en))}</span>
          </button>
        `).join('')}
      </nav>
    `;
  }

  function renderContent() {
    if (state.loading) {
      return `<div class="cast-state cast-loading"><i class="fa-solid fa-circle-notch fa-spin"></i><div>${tx('جاري تحميل سجل الأصول…', 'Loading asset register…')}</div></div>`;
    }
    if (state.error) {
      return `<div class="cast-error"><i class="fa-solid fa-triangle-exclamation"></i><div><strong>${tx('فشل تحميل الأصول', 'Asset Load Failure')}</strong><p>${esc(state.error)}</p></div></div>`;
    }

    if (state.active === 'dashboard') {
      const activeAssets = state.rows.assets.filter(a => a.state === 'active' || a.state === 'capitalized').length;
      return `
        <div class="cast-kpis">
          <div class="cast-kpi"><i class="fa-solid fa-building-columns"></i><div><strong>${state.rows.assets.length}</strong><span>${tx('إجمالي الأصول', 'Total Assets')}</span></div></div>
          <div class="cast-kpi"><i class="fa-solid fa-circle-check"></i><div><strong>${activeAssets}</strong><span>${tx('الأصول المفعّلة', 'Active Assets')}</span></div></div>
          <div class="cast-kpi"><i class="fa-solid fa-folder-tree"></i><div><strong>${state.rows.categories.length}</strong><span>${tx('فئات الأصول', 'Asset Categories')}</span></div></div>
          <div class="cast-kpi"><i class="fa-solid fa-chart-line"></i><div><strong>${state.rows.schedules.length}</strong><span>${tx('أقساط الإهلاك المجدولة', 'Scheduled Depreciation')}</span></div></div>
        </div>
      `;
    }

    if (state.active === 'assets') {
      if (!state.rows.assets.length) return `<div class="cast-state">${tx('لا توجد أصول مسجلة حتى الآن.', 'No registered assets yet.')}</div>`;
      return `
        <div class="cast-table-wrap">
          <table class="cast-table">
            <thead>
              <tr>
                <th>${tx('رقم الأصل', 'Asset Number')}</th>
                <th>${tx('الاسم', 'Name')}</th>
                <th>${tx('تكلفة الشراء', 'Acquisition Cost')}</th>
                <th>${tx('العمر الانتاجي (شهر)', 'Useful Life (Months)')}</th>
                <th>${tx('الحالة', 'Status')}</th>
              </tr>
            </thead>
            <tbody>
              ${state.rows.assets.map(a => `
                <tr>
                  <td><strong>${esc(a.asset_number)}</strong></td>
                  <td>${esc(a.name_en || a.name_ar)}</td>
                  <td>$${esc(a.acquisition_cost)}</td>
                  <td>${esc(a.useful_life_months)}</td>
                  <td>${badge(a.state)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    return `<div class="cast-state">${tx('عرض سجلات الأصول القانونية.', 'Showing canonical asset records.')}</div>`;
  }

  function render() {
    const el = host();
    if (!el) return;
    el.innerHTML = `
      <section class="cast-workspace">
        <header class="cast-hero">
          <span class="cast-eyebrow">${tx('أوكتاغون ERP · سجل الأصول والإهلاك القانوني', 'Octagon ERP · Canonical Asset Register & Depreciation')}</span>
          <h2>${tx('إدارة الأصول الثابتة والمعدات', 'Assets & Equipment Management')}</h2>
          <p>${tx('سجل موحد للأصول والمعدات، الرأسمالية، جداول الإهلاك والعهد والنقل.', 'Single authority for assets, equipment, capitalization, depreciation schedules and custody transfers.')}</p>
        </header>
        ${renderNav()}
        ${renderContent()}
      </section>
    `;

    el.querySelectorAll('[data-cast-tab]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        state.active = ev.currentTarget.getAttribute('data-cast-tab');
        render();
      });
    });
  }

  function mount() {
    loadData();
  }

  root.CanonicalAssets = { mount, loadData };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})(typeof window !== 'undefined' ? window : globalThis);
