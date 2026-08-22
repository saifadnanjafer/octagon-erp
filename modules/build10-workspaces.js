(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  if (!root) return;

  const PAGES = {
    device_registry: { titleAr: 'سجل أجهزة IoT', titleEn: 'IoT Device Registry', icon: '⚡', category: 'devices' },
    device_detail: { titleAr: 'تفاصيل الجهاز', titleEn: 'Device Detail', icon: '🔍', category: 'devices' },
    device_enrollment: { titleAr: 'تسجيل وتفعيل الأجهزة', titleEn: 'Device Enrollment', icon: '🔑', category: 'devices' },
    gateway_management: { titleAr: 'إدارة البوابات', titleEn: 'Gateway Management', icon: '🌐', category: 'devices' },
    sensor_management: { titleAr: 'إدارة الحساسات', titleEn: 'Sensor Management', icon: '📡', category: 'devices' },
    telemetry_explorer: { titleAr: 'مستكشف بيانات القياس', titleEn: 'Telemetry Explorer', icon: '📈', category: 'telemetry' },
    device_health_center: { titleAr: 'مركز صحة الأجهزة', titleEn: 'Device Health Center', icon: '💚', category: 'telemetry' },
    device_alerts: { titleAr: 'تنبيهات وأعطال الأجهزة', titleEn: 'Device Alerts', icon: '⚠️', category: 'telemetry' },
    firmware_catalogue: { titleAr: 'كتالوج البرامج الثابتة', titleEn: 'Firmware Catalogue', icon: '💾', category: 'telemetry' },
    rollout_simulator: { titleAr: 'محاكي التحديث الميداني', titleEn: 'Rollout Simulator', icon: '🚀', category: 'telemetry' },
    configuration_profiles: { titleAr: 'ملفات إعدادات الأجهزة', titleEn: 'Configuration Profiles', icon: '⚙️', category: 'telemetry' },
    device_command_center: { titleAr: 'مركز أوامر الأجهزة', titleEn: 'Device Command Center', icon: '💻', category: 'telemetry' },
    fleet_device_mapping: { titleAr: 'ربط أجهزة أسطول السيارات', titleEn: 'Fleet Device Mapping', icon: '🚚', category: 'fleet' },
    fleet_live_map_simulator: { titleAr: 'خريطة التتبع المباشر', titleEn: 'Fleet Live Map Simulator', icon: '🗺️', category: 'fleet' },
    vehicle_trip_timeline: { titleAr: 'خط زمني لرحلات السيارات', titleEn: 'Vehicle Trip Timeline', icon: '⏱️', category: 'fleet' },
    geofence_management: { titleAr: 'إدارة النطاقات الجغرافية', titleEn: 'Geofence Management', icon: '📍', category: 'fleet' },
    geofence_events: { titleAr: 'أحداث دخول وخروج النطاقات', titleEn: 'Geofence Events', icon: '🔔', category: 'fleet' },
    speed_and_driver_events: { titleAr: 'أحداث السرعة والسياقة', titleEn: 'Speed and Driver Events', icon: '🏎️', category: 'fleet' },
    fuel_telemetry: { titleAr: 'قياسات واستهلاك الوقود', titleEn: 'Fuel Telemetry', icon: '⛽', category: 'fleet' },
    suspected_fuel_loss_queue: { titleAr: 'طابور الاشتباه في هدر الوقود', titleEn: 'Suspected Fuel Loss Queue', icon: '🛡️', category: 'fleet' },
    maintenance_triggers: { titleAr: 'محفزات الصيانة التلقائية', titleEn: 'Maintenance Triggers', icon: '🔧', category: 'fleet' },
    offline_client_registry: { titleAr: 'سجل التطبيقات الميدانية المستقلة', titleEn: 'Offline Client Registry', icon: '📱', category: 'offline' },
    offline_queue: { titleAr: 'طابور الأوامر غير المتصلة', titleEn: 'Offline Queue', icon: '📋', category: 'offline' },
    sync_sessions: { titleAr: 'جلسات المزامنة الميدانية', titleEn: 'Sync Sessions', icon: '🔄', category: 'offline' },
    sync_conflicts: { titleAr: 'تعارضات المزامنة', titleEn: 'Sync Conflicts', icon: '⚔️', category: 'offline' },
    conflict_resolution: { titleAr: 'معالجة وتصفية التعارضات', titleEn: 'Conflict Resolution', icon: '✅', category: 'offline' },
    offline_capability_policies: { titleAr: 'سياسات الصلاحيات الميدانية', titleEn: 'Offline Capability Policies', icon: '🛡️', category: 'offline' },
    kiosk_device_registry: { titleAr: 'سجل أجهزة الكشك الخدمي', titleEn: 'Kiosk Device Registry', icon: '🖥️', category: 'kiosk' },
    employee_kiosk: { titleAr: 'كشك الموظفين الذاتي', titleEn: 'Employee Kiosk', icon: '👤', category: 'kiosk' },
    warehouse_kiosk: { titleAr: 'كشك العمليات المخزنية', titleEn: 'Warehouse Kiosk', icon: '📦', category: 'kiosk' },
    shop_floor_kiosk: { titleAr: 'كشك صالة الإنتاج', titleEn: 'Shop Floor Kiosk', icon: '🏭', category: 'kiosk' },
    service_kiosk: { titleAr: 'كشك الخدمة والصيانة', titleEn: 'Service Kiosk', icon: '🎧', category: 'kiosk' },
    fleet_operations_board: { titleAr: 'لوحة عمليات الأسطول', titleEn: 'Fleet Operations Board', icon: '📊', category: 'boards' },
    device_health_board: { titleAr: 'لوحة صحة وشبكة الأجهزة', titleEn: 'Device Health Board', icon: '📊', category: 'boards' },
    warehouse_large_screen: { titleAr: 'شاشة المخزن الكبيرة', titleEn: 'Warehouse Large Screen', icon: '📊', category: 'boards' },
    production_large_screen: { titleAr: 'شاشة خط الإنتاج الكبيرة', titleEn: 'Production Large Screen', icon: '📊', category: 'boards' },
    service_queue_board: { titleAr: 'شاشة طابور الصيانة', titleEn: 'Service Queue Board', icon: '📊', category: 'boards' },
    alert_board: { titleAr: 'شاشة التنبيهات المركزية', titleEn: 'Alert Board', icon: '📊', category: 'boards' }
  };

  function getActiveCompany() {
    const bootstrap = root.__octagonBootstrap || {};
    return bootstrap.context?.companyId || bootstrap.actor?.activeCompanyId || bootstrap.activeCompanyId || 'default';
  }

  function getActiveWarehouse() {
    const bootstrap = root.__octagonBootstrap || {};
    return root.localStorage?.getItem('octagon_active_warehouse_id') || bootstrap.warehouseId || 'wh-main';
  }

  function getEndpointForPage(pageKey) {
    return `/api/v1/build10/${encodeURIComponent(pageKey)}`;
  }

  const recordsByPage = new Map();

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  }

  function rowValue(row, keys, fallback = '—') {
    for (const key of keys) {
      if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
    }
    return fallback;
  }

  function renderRows(records, isRtl) {
    if (!records.length) {
      return `<tr data-state="empty"><td colspan="4">${isRtl ? 'لا توجد سجلات مؤكدة ضمن نطاق الشركة الحالي.' : 'No verified records exist in the current company scope.'}</td></tr>`;
    }
    return records.map((record) => {
      const id = rowValue(record, ['trip_code', 'conflict_uuid', 'client_uuid', 'device_code', 'code', 'id']);
      const name = rowValue(record, ['name', 'device_name', 'vehicle_id', 'client_id', 'entity_name', 'kiosk_type']);
      const status = rowValue(record, ['status', 'health_state', 'lifecycle_state', 'sync_status', 'event_classification']);
      const updated = rowValue(record, ['updated_at', 'created_at', 'timestamp', 'start_time', 'received_at']);
      return `<tr data-record-id="${escapeHtml(rowValue(record, ['id'], id))}"><td><strong>${escapeHtml(id)}</strong></td><td>${escapeHtml(name)}</td><td><span class="b10-badge b10-badge-success">${escapeHtml(status)}</span></td><td>${escapeHtml(updated)}</td></tr>`;
    }).join('');
  }

  function setStatus(container, phase, message) {
    const status = container.querySelector('[data-role="status"]');
    if (!status) return;
    status.dataset.phase = phase;
    status.textContent = message;
  }

  async function refreshRecords(pageKey, container, isRtl) {
    setStatus(container, 'loading', isRtl ? 'جارٍ تحميل السجلات المؤكدة…' : 'Loading verified records…');
    try {
      const response = await fetch(getEndpointForPage(pageKey), { headers: { accept: 'application/json' } });
      const payload = await response.json();
      if (!response.ok || payload?.success === false) throw new Error(payload?.error || `HTTP ${response.status}`);
      const records = Array.isArray(payload?.data) ? payload.data : [];
      recordsByPage.set(pageKey, records);
      const tbody = container.querySelector('tbody');
      if (tbody) tbody.innerHTML = renderRows(records, isRtl);
      setStatus(container, records.length ? 'loaded' : 'empty', records.length
        ? (isRtl ? `جاهز · ${records.length} سجل مؤكد` : `Ready · ${records.length} verified record${records.length === 1 ? '' : 's'}`)
        : (isRtl ? 'لا توجد سجلات مؤكدة ضمن نطاق الشركة الحالي.' : 'No verified records in the current company scope.'));
    } catch (error) {
      recordsByPage.set(pageKey, []);
      const tbody = container.querySelector('tbody');
      if (tbody) {
        const row = document.createElement('tr');
        row.dataset.state = 'error';
        const cell = document.createElement('td');
        cell.colSpan = 4;
        cell.textContent = isRtl ? 'تعذر تحميل السجلات المؤكدة.' : 'Verified records could not be loaded.';
        row.appendChild(cell);
        tbody.replaceChildren(row);
      }
      setStatus(container, 'error', isRtl ? 'تعذر تحميل السجلات المؤكدة.' : 'Verified records could not be loaded.');
      console.warn(`BUILD-10 read model unavailable for ${pageKey}:`, error);
    }
  }

  function renderPage(pageKey, targetContainer = null) {
    const meta = PAGES[pageKey] || { titleAr: pageKey, titleEn: pageKey, icon: '⚡', category: 'devices' };

    if (root.PermissionService && typeof root.PermissionService.checkPage === 'function') {
      const allowed = root.PermissionService.checkPage(pageKey);
      if (!allowed) {
        console.warn(`PermissionService.checkPage denied: ${pageKey}`);
      }
    }

    const isRtl = document.documentElement.dir === 'rtl' || String(document.documentElement.lang).startsWith('ar');
    const readOnly = root.__BUILD10_FORCE_READ_ONLY__ === true;

    let container = targetContainer || document.querySelector(`.page[data-build10-page="${pageKey}"]`);
    if (!container) {
      const mainContent = document.getElementById('mainContent') || document.body;
      container = document.createElement('div');
      container.setAttribute('data-build10-page', pageKey);
      container.setAttribute('data-page', pageKey);
      container.className = 'page b10-page-container';
      mainContent.appendChild(container);
    }

    const activeCompany = getActiveCompany();
    const activeWarehouse = getActiveWarehouse();
    const isBoard = meta.category === 'boards' || pageKey.includes('board') || pageKey.includes('screen');

    // Board pages have no authoritative aggregate metric endpoint.  Their
    // dedicated renderer is deliberately fail-closed: it states that no live
    // metric is verified and offers links to the governed source workspaces.
    // Do not fall through to the legacy illustrative board cards here.
    if (isBoard && root.Build10BoardsRenderer && typeof root.Build10BoardsRenderer.render === 'function') {
      container.innerHTML = root.Build10BoardsRenderer.render(pageKey, null, isRtl, readOnly);
      return container;
    }

    let contentHtml = '';
    if (!isBoard) {
      contentHtml = `
        <div class="b10-controls">
          <button class="b10-btn b10-btn-primary" data-command="refresh">${isRtl ? 'تحديث السجلات' : 'Refresh records'}</button>
          <button class="b10-btn" data-command="export">${isRtl ? 'تصدير CSV' : 'Export CSV'}</button>
        </div>
        <div class="b10-table-wrap">
          <table class="b10-table">
            <thead>
              <tr>
                <th>${isRtl ? 'الرمز' : 'Code/ID'}</th>
                <th>${isRtl ? 'الاسم' : 'Name/Entity'}</th>
                <th>${isRtl ? 'الحالة' : 'Status'}</th>
                <th>${isRtl ? 'آخر تحديث' : 'Updated'}</th>
              </tr>
            </thead>
            <tbody>
              ${renderRows([], isRtl)}
            </tbody>
          </table>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="b10-workspace-shell b10-board" data-build10-page="${pageKey}" data-company="${activeCompany}" data-warehouse="${activeWarehouse}">
        <header class="b10-workspace-header">
          <div class="b10-header-title">
            <span class="b10-header-icon">${meta.icon}</span>
            <h2>${isRtl ? meta.titleAr : meta.titleEn}</h2>
          </div>
          <div class="b10-status" data-role="status" data-phase="loading">${isRtl ? 'جارٍ تحميل السجلات المؤكدة…' : 'Loading verified records…'}</div>
        </header>
        <main class="b10-workspace-body">
          ${contentHtml}
        </main>
      </div>
    `;

    container.querySelector('[data-command="refresh"]')?.addEventListener('click', () => { void refreshRecords(pageKey, container, isRtl); });
    container.querySelector('[data-command="export"]')?.addEventListener('click', () => exportCsv(pageKey));
    void refreshRecords(pageKey, container, isRtl);

    return container;
  }

  function exportCsv(pageKey) {
    const records = recordsByPage.get(pageKey) || [];
    const quote = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const content = ['ID,Name,Status,Updated', ...records.map((record) => [
      rowValue(record, ['trip_code', 'conflict_uuid', 'client_uuid', 'device_code', 'code', 'id'], ''),
      rowValue(record, ['name', 'device_name', 'vehicle_id', 'client_id', 'entity_name', 'kiosk_type'], ''),
      rowValue(record, ['status', 'health_state', 'lifecycle_state', 'sync_status', 'event_classification'], ''),
      rowValue(record, ['updated_at', 'created_at', 'timestamp', 'start_time', 'received_at'], '')
    ].map(quote).join(','))].join('\n') + '\n';
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pageKey}_export.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function setupSwitchPageHook() {
    const origSwitchPage = root.switchPage;
    // localSeq/mySeq: a self-contained staleness guard. This codebase wraps
    // window.switchPage through many modules (40+), so by the time this hook
    // captures origSwitchPage it may already be asynchronous for reasons that
    // have nothing to do with Build10 — origSwitchPage(pageId) can return a
    // still-pending promise, and there is no reliable way to observe "has the
    // real core switchPage body run yet" from the outside. Rather than infer
    // staleness from a shared, timing-sensitive value, each call captures its
    // own sequence number synchronously (before any await), and only proceeds
    // to mutate the DOM if no newer switchPage call has started meanwhile.
    let localSeq = 0;
    root.switchPage = async function (pageId) {
      const mySeq = ++localSeq;
      let result;
      if (origSwitchPage && typeof origSwitchPage === 'function') {
        try { result = await origSwitchPage(pageId); } catch (_) {}
      }

      // This wrapper sits in the global switchPage chain and may only take
      // ownership of Build 10 destinations. Deactivating every page host —
      // including foreign ones — happens once, centrally, in core switchPage
      // above; it already cleared the page-active class and any inline
      // display style off every .page element, so a foreign route reaching
      // this point needs no cleanup here.
      if (!PAGES[pageId]) return result;

      // Staleness guard: if a later switchPage call started while this call
      // was suspended at the `await` above, localSeq will have moved past
      // mySeq. Activating now would re-surface a Build10 page the user has
      // already navigated away from.
      if (mySeq !== localSeq) return result;

      document.querySelectorAll('.page[data-build10-page], .page.page-active').forEach(elem => {
        if (elem.classList.contains('page-active') || elem.hasAttribute('data-build10-page')) {
          elem.classList.remove('page-active');
          elem.style.display = 'none';
        }
      });

      let pageElem = document.querySelector(`.page[data-build10-page="${pageId}"]`);
      if (!pageElem) {
        pageElem = renderPage(pageId);
      } else {
        renderPage(pageId, pageElem);
      }
      if (pageElem) {
        pageElem.classList.add('page-active');
        pageElem.style.display = 'block';
      }
      return result;
    };
  }

  root.Build10Engine = {
    PAGES,
    renderPage,
    exportCsv,
    refreshRecords,
    getActiveCompany,
    getActiveWarehouse
  };

  root.OctagonBuild10 = root.Build10Engine;

  root.addEventListener('octagon:language-changed', () => {
    const isRtl = document.documentElement.dir === 'rtl';
    console.log(`octagon:language-changed triggered, isRtl: ${isRtl}`);
    const activeElem = document.querySelector('[data-build10-page].page-active');
    if (activeElem) {
      const pageKey = activeElem.getAttribute('data-build10-page');
      renderPage(pageKey, activeElem);
    }
  });

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        setupSwitchPageHook();
        Object.keys(PAGES).forEach((pageKey) => {
          const elem = document.querySelector(`.page[data-page="${pageKey}"], .page[data-build10-page="${pageKey}"]`);
          if (elem) renderPage(pageKey, elem);
        });
      });
    } else {
      setupSwitchPageHook();
      Object.keys(PAGES).forEach((pageKey) => {
        const elem = document.querySelector(`.page[data-page="${pageKey}"], .page[data-build10-page="${pageKey}"]`);
        if (elem) renderPage(pageKey, elem);
      });
    }
  }
})();
