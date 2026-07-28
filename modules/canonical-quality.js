(function (root) {
  'use strict';

  // Checkpoint D4: visible Quality Assurance workspace over the canonical Octagon runtime.
  root.__canonicalQualityAuthorityActive = true;

  const state = {
    active: 'dashboard',
    loading: false,
    error: null,
    rows: { plans: [], inspections: [], ncrs: [], capas: [] },
  };

  const tabs = [
    ['dashboard', 'لوحة الجودة', 'Quality Dashboard', 'fa-award'],
    ['plans', 'خطط الجودة', 'Quality Plans', 'fa-clipboard-list'],
    ['inspections', 'الفحوصات', 'Inspections', 'fa-vial-circle-check'],
    ['ncrs', 'تقارير عدم المطابقة', 'NCR Reports', 'fa-triangle-exclamation'],
    ['capas', 'الإجراءات التصحيحية', 'CAPAs', 'fa-shield-halved'],
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
    return `<span class="cq-badge cq-state-${esc(k.replace(/[^a-z0-9_-]/gi, '-'))}">${esc(k)}</span>`;
  }
  function host() { return document.getElementById('pageQuality') || document.getElementById('pageQcCenter') || document.getElementById('qcCenterBody'); }

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
      const [pRes, iRes, nRes, cRes] = await Promise.all([
        client.get('/api/v1/quality/plans').catch(() => ({ data: [] })),
        client.get('/api/v1/quality/inspections').catch(() => ({ data: [] })),
        client.get('/api/v1/quality/ncrs').catch(() => ({ data: [] })),
        client.get('/api/v1/quality/capas').catch(() => ({ data: [] })),
      ]);
      state.rows.plans = pRes.data || [];
      state.rows.inspections = iRes.data || [];
      state.rows.ncrs = nRes.data || [];
      state.rows.capas = cRes.data || [];
      state.loading = false;
    } catch (err) {
      state.error = err.message || String(err);
      state.loading = false;
    }
    render();
  }

  function renderNav() {
    return `
      <nav class="cq-nav">
        ${tabs.map(([id, ar, en, icon]) => `
          <button type="button" class="cq-tab ${state.active === id ? 'active' : ''}" data-cq-tab="${id}">
            <i class="fa-solid ${icon}"></i>
            <span>${esc(tx(ar, en))}</span>
          </button>
        `).join('')}
      </nav>
    `;
  }

  function renderContent() {
    if (state.loading) {
      return `<div class="cq-state cq-loading"><i class="fa-solid fa-circle-notch fa-spin"></i><div>${tx('جاري تحميل بيانات الجودة…', 'Loading quality data…')}</div></div>`;
    }
    if (state.error) {
      return `<div class="cq-error"><i class="fa-solid fa-triangle-exclamation"></i><div><strong>${tx('فشل تحميل الجودة', 'Quality Load Failure')}</strong><p>${esc(state.error)}</p></div></div>`;
    }

    if (state.active === 'dashboard') {
      const passed = state.rows.inspections.filter(i => i.state === 'pass' || i.state === 'released').length;
      const failed = state.rows.inspections.filter(i => i.state === 'fail' || i.state === 'ncr').length;
      return `
        <div class="cq-kpis">
          <div class="cq-kpi"><i class="fa-solid fa-vial"></i><div><strong>${state.rows.inspections.length}</strong><span>${tx('إجمالي الفحوصات', 'Total Inspections')}</span></div></div>
          <div class="cq-kpi"><i class="fa-solid fa-circle-check"></i><div><strong>${passed}</strong><span>${tx('الفحوصات الناجحة', 'Passed Inspections')}</span></div></div>
          <div class="cq-kpi"><i class="fa-solid fa-triangle-exclamation"></i><div><strong>${failed}</strong><span>${tx('الفحوصات الفاشلة', 'Failed Inspections')}</span></div></div>
          <div class="cq-kpi"><i class="fa-solid fa-shield-halved"></i><div><strong>${state.rows.capas.length}</strong><span>${tx('إجراءات CAPA', 'CAPA Actions')}</span></div></div>
        </div>
      `;
    }

    if (state.active === 'inspections') {
      if (!state.rows.inspections.length) return `<div class="cq-state">${tx('لا توجد فحوصات جودة حتى الآن.', 'No quality inspections yet.')}</div>`;
      return `
        <div class="cq-table-wrap">
          <table class="cq-table">
            <thead>
              <tr>
                <th>${tx('رقم الفحص', 'Inspection Number')}</th>
                <th>${tx('النوع', 'Type')}</th>
                <th>${tx('المنتج', 'Product')}</th>
                <th>${tx('حجم العينة', 'Sample Size')}</th>
                <th>${tx('الحالة', 'Status')}</th>
              </tr>
            </thead>
            <tbody>
              ${state.rows.inspections.map(i => `
                <tr>
                  <td><strong>${esc(i.inspection_number)}</strong></td>
                  <td>${esc(i.inspection_type)}</td>
                  <td>${esc(i.product_id)}</td>
                  <td>${esc(i.sample_size)}</td>
                  <td>${badge(i.state)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    return `<div class="cq-state">${tx('عرض سجلات الجودة القانونية.', 'Showing canonical quality records.')}</div>`;
  }

  function render() {
    const el = host();
    if (!el) return;
    el.innerHTML = `
      <section class="cq-workspace">
        <header class="cq-hero">
          <span class="cq-eyebrow">${tx('أوكتاغون ERP · توكيد وضبط الجودة', 'Octagon ERP · Canonical Quality Assurance & Control')}</span>
          <h2>${tx('إدارة الجودة وعدم المطابقة', 'Quality & CAPA Management')}</h2>
          <p>${tx('فحوصات الجودة الواردة وداخل العمليات، تقارير NCR وإجراءات CAPA عبر عناصر العمل القانونية.', 'Incoming and in-process inspections, NCR reporting, and CAPA tasks via canonical Work Items.')}</p>
        </header>
        ${renderNav()}
        ${renderContent()}
      </section>
    `;

    el.querySelectorAll('[data-cq-tab]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        state.active = ev.currentTarget.getAttribute('data-cq-tab');
        render();
      });
    });
  }

  function mount() {
    loadData();
  }

  root.CanonicalQuality = { mount, loadData };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})(typeof window !== 'undefined' ? window : globalThis);
