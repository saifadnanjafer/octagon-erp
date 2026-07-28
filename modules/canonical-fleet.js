(function (root) {
  'use strict';

  // Checkpoint E3: visible Fleet Operations workspace over the canonical Octagon runtime.
  root.__canonicalFleetAuthorityActive = true;

  const state = {
    active: 'dashboard',
    loading: false,
    error: null,
    rows: { vehicles: [], drivers: [], trips: [], fuelLogs: [], telemetry: [] },
  };

  const tabs = [
    ['dashboard', 'لوحة الأسطول', 'Fleet Dashboard', 'fa-truck-moving'],
    ['vehicles', 'المركبات', 'Vehicles', 'fa-car'],
    ['drivers', 'السائقون', 'Drivers', 'fa-id-card'],
    ['trips', 'الرحلات والمسارات', 'Trips & Routes', 'fa-route'],
    ['fuel-logs', 'سجل الوقود', 'Fuel Logs', 'fa-gas-pump'],
    ['telemetry', 'الاتصال عن بُعد (Telematics)', 'Telematics', 'fa-satellite-dish'],
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
    return `<span class="cflt-badge cflt-state-${esc(k.replace(/[^a-z0-9_-]/gi, '-'))}">${esc(k)}</span>`;
  }
  function host() { return document.getElementById('pageFleet') || document.getElementById('fleetBody'); }

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
      const [vRes, dRes, tRes, fRes, telRes] = await Promise.all([
        client.get('/api/v1/fleet/vehicles').catch(() => ({ data: [] })),
        client.get('/api/v1/fleet/drivers').catch(() => ({ data: [] })),
        client.get('/api/v1/fleet/trips').catch(() => ({ data: [] })),
        client.get('/api/v1/fleet/fuel-logs').catch(() => ({ data: [] })),
        client.get('/api/v1/fleet/telemetry').catch(() => ({ data: [] })),
      ]);
      state.rows.vehicles = vRes.data || [];
      state.rows.drivers = dRes.data || [];
      state.rows.trips = tRes.data || [];
      state.rows.fuelLogs = fRes.data || [];
      state.rows.telemetry = telRes.data || [];
      state.loading = false;
    } catch (err) {
      state.error = err.message || String(err);
      state.loading = false;
    }
    render();
  }

  function renderNav() {
    return `
      <nav class="cflt-nav">
        ${tabs.map(([id, ar, en, icon]) => `
          <button type="button" class="cflt-tab ${state.active === id ? 'active' : ''}" data-cflt-tab="${id}">
            <i class="fa-solid ${icon}"></i>
            <span>${esc(tx(ar, en))}</span>
          </button>
        `).join('')}
      </nav>
    `;
  }

  function renderContent() {
    if (state.loading) {
      return `<div class="cflt-state cflt-loading"><i class="fa-solid fa-circle-notch fa-spin"></i><div>${tx('جاري تحميل بيانات الأسطول…', 'Loading fleet data…')}</div></div>`;
    }
    if (state.error) {
      return `<div class="cflt-error"><i class="fa-solid fa-triangle-exclamation"></i><div><strong>${tx('فشل تحميل الأسطول', 'Fleet Load Failure')}</strong><p>${esc(state.error)}</p></div></div>`;
    }

    if (state.active === 'dashboard') {
      const activeVeh = state.rows.vehicles.filter(v => v.status === 'active').length;
      const anomalies = state.rows.fuelLogs.filter(f => f.anomaly_flag === 1).length;
      return `
        <div class="cflt-kpis">
          <div class="cflt-kpi"><i class="fa-solid fa-truck-moving"></i><div><strong>${state.rows.vehicles.length}</strong><span>${tx('إجمالي المركبات', 'Total Vehicles')}</span></div></div>
          <div class="cflt-kpi"><i class="fa-solid fa-circle-check"></i><div><strong>${activeVeh}</strong><span>${tx('المركبات النشطة', 'Active Vehicles')}</span></div></div>
          <div class="cflt-kpi"><i class="fa-solid fa-id-card"></i><div><strong>${state.rows.drivers.length}</strong><span>${tx('السائقون المسجلون', 'Registered Drivers')}</span></div></div>
          <div class="cflt-kpi"><i class="fa-solid fa-gas-pump"></i><div><strong>${anomalies}</strong><span>${tx('تنبيهات استهلاك الوقود', 'Fuel Anomaly Alerts')}</span></div></div>
        </div>
      `;
    }

    if (state.active === 'vehicles') {
      if (!state.rows.vehicles.length) return `<div class="cflt-state">${tx('لا توجد مركبات مسجلة حتى الآن.', 'No registered vehicles yet.')}</div>`;
      return `
        <div class="cflt-table-wrap">
          <table class="cflt-table">
            <thead>
              <tr>
                <th>${tx('رقم المركبة', 'Vehicle Number')}</th>
                <th>${tx('الاسم', 'Name')}</th>
                <th>${tx('لوحة التسجيل', 'Plate / License')}</th>
                <th>${tx('عداد الكيلومترات', 'Odometer')}</th>
                <th>${tx('الحالة', 'Status')}</th>
              </tr>
            </thead>
            <tbody>
              ${state.rows.vehicles.map(v => `
                <tr>
                  <td><strong>${esc(v.vehicle_number)}</strong></td>
                  <td>${esc(v.name)}</td>
                  <td>${esc(v.license_plate || v.registration_number)}</td>
                  <td>${esc(v.current_odometer)} km</td>
                  <td>${badge(v.status)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    return `<div class="cflt-state">${tx('عرض سجلات الأسطول القانونية.', 'Showing canonical fleet records.')}</div>`;
  }

  function render() {
    const el = host();
    if (!el) return;
    el.innerHTML = `
      <section class="cflt-workspace">
        <header class="cflt-hero">
          <span class="cflt-eyebrow">${tx('أوكتاغون ERP · عمليات الأسطول والاتصال عن بُعد', 'Octagon ERP · Fleet Operations & Telematics')}</span>
          <h2>${tx('إدارة أسطول المركبات والرحلات', 'Fleet & Telematics Management')}</h2>
          <p>${tx('مركبات الأسطول المرتبطة بالأصول، تتبع السائقين والرحلات، سجل وقود محمي ضد الاحتيال ومحولات التليماتكس.', 'Asset-linked fleet vehicles, driver/trip tracking, fraud-protected fuel logs and telematics adapters.')}</p>
        </header>
        ${renderNav()}
        ${renderContent()}
      </section>
    `;

    el.querySelectorAll('[data-cflt-tab]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        state.active = ev.currentTarget.getAttribute('data-cflt-tab');
        render();
      });
    });
  }

  function mount() {
    loadData();
  }

  root.CanonicalFleet = { mount, loadData };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})(typeof window !== 'undefined' ? window : globalThis);
