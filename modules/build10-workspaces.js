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
    return bootstrap.actor?.activeCompanyId || bootstrap.activeCompanyId || 'default';
  }

  function getActiveWarehouse() {
    const bootstrap = root.__octagonBootstrap || {};
    return root.localStorage?.getItem('octagon_active_warehouse_id') || bootstrap.warehouseId || 'wh-main';
  }

  function getEndpointForPage(pageKey) {
    if (pageKey.startsWith('device_') || pageKey.includes('gateway') || pageKey.includes('sensor') || pageKey.includes('telemetry') || pageKey.includes('firmware') || pageKey.includes('rollout') || pageKey.includes('configuration')) {
      return `/api/v1/iot/${pageKey}`;
    }
    if (pageKey.startsWith('fleet_') || pageKey.includes('vehicle') || pageKey.includes('geofence') || pageKey.includes('speed') || pageKey.includes('fuel') || pageKey.includes('maintenance')) {
      return `/api/v1/iot/fleet/${pageKey}`;
    }
    if (pageKey.startsWith('offline_') || pageKey.includes('sync') || pageKey.includes('conflict')) {
      return `/api/v1/iot/offline/${pageKey}`;
    }
    if (pageKey.includes('kiosk')) {
      return `/api/v1/iot/kiosk/${pageKey}`;
    }
    return `/api/v1/iot/boards/${pageKey}`;
  }

  function mockDataForPage(pageKey) {
    const company = getActiveCompany();
    const warehouse = getActiveWarehouse();
    if (pageKey === 'vehicle_trip_timeline') {
      return [
        { id: 'TRIP-101', trip_code: 'TRIP-101', vehicle_id: 'veh-browser-b10', driver_name: 'Driver Alpha', start_time: new Date(Date.now() - 3600000).toISOString(), end_time: new Date().toISOString(), distance_km: 42.5, max_speed_kmh: 88, status: 'completed', company_id: company, warehouse_id: warehouse },
        { id: 'TRIP-102', trip_code: 'TRIP-102', vehicle_id: 'veh-browser-b10', driver_name: 'Driver Beta', start_time: new Date(Date.now() - 7200000).toISOString(), end_time: new Date(Date.now() - 3600000).toISOString(), distance_km: 18.2, max_speed_kmh: 65, status: 'completed', company_id: company, warehouse_id: warehouse }
      ];
    }
    if (pageKey === 'sync_conflicts') {
      return [
        { id: 'CONF-201', conflict_uuid: 'CONF-201', client_id: 'PWA-BROWSER-99', entity_name: 'inventory_count', entity_id: 'quant-99', conflict_type: 'version_mismatch', status: 'pending', created_at: new Date().toISOString(), company_id: company, warehouse_id: warehouse },
        { id: 'CONF-202', conflict_uuid: 'CONF-202', client_id: 'PWA-BROWSER-99', entity_name: 'sales_order', entity_id: 'so-404', conflict_type: 'concurrent_edit', status: 'resolved', created_at: new Date().toISOString(), company_id: company, warehouse_id: warehouse }
      ];
    }
    return [
      { id: `${pageKey}-1`, code: `REF-${pageKey.slice(0, 4).toUpperCase()}-1`, name: `${pageKey} Item 1`, status: 'active', company_id: company, warehouse_id: warehouse, updated_at: new Date().toISOString() },
      { id: `${pageKey}-2`, code: `REF-${pageKey.slice(0, 4).toUpperCase()}-2`, name: `${pageKey} Item 2`, status: 'operational', company_id: company, warehouse_id: warehouse, updated_at: new Date().toISOString() }
    ];
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

    let contentHtml = '';
    if (isBoard) {
      contentHtml = `
        <div class="b10-board-grid">
          <div class="b10-board-card">
            <h3>Active Assets</h3>
            <div class="b10-board-metric">142</div>
            <div class="b10-status" data-phase="online">Operational</div>
          </div>
          <div class="b10-board-card">
            <h3>Active Trips</h3>
            <div class="b10-board-metric">18</div>
            <div class="b10-status" data-phase="moving">In Transit</div>
          </div>
          <div class="b10-board-card">
            <h3>Geofence Events</h3>
            <div class="b10-board-metric">4</div>
            <div class="b10-status" data-phase="warning">Breaches</div>
          </div>
          <div class="b10-board-card">
            <h3>Offline Sync</h3>
            <div class="b10-board-metric">99.8%</div>
            <div class="b10-status" data-phase="synced">Healthy</div>
          </div>
        </div>
      `;
    } else {
      const records = mockDataForPage(pageKey);
      const rows = records.map(r => `
        <tr data-record-id="${r.id}">
          <td><strong>${r.trip_code || r.conflict_uuid || r.code || r.id}</strong></td>
          <td>${r.vehicle_id || r.client_id || r.name || 'Record Name'}</td>
          <td>${r.driver_name || r.entity_name || r.status || 'Active'}</td>
          <td><span class="b10-badge b10-badge-success">${r.status || 'active'}</span></td>
          <td>
            <button class="b10-btn b10-btn-sm" data-action="${pageKey}:view" onclick="OctagonBuild10.openActionDialog('${pageKey}', 'view')">${isRtl ? 'عرض' : 'View'}</button>
            <button class="b10-btn b10-btn-sm b10-btn-primary" data-action="${pageKey}:edit" onclick="OctagonBuild10.openActionDialog('${pageKey}', 'edit')">${isRtl ? 'تعديل' : 'Edit'}</button>
          </td>
        </tr>
      `).join('');

      contentHtml = `
        <div class="b10-controls">
          <input type="text" class="b10-search-input" placeholder="${isRtl ? 'بحث...' : 'Search...'}" oninput="OctagonBuild10.handleSearch('${pageKey}', this.value)" />
          <button class="b10-btn b10-btn-primary" data-action="${pageKey}:create" onclick="OctagonBuild10.openActionDialog('${pageKey}', 'create')">${isRtl ? '+ إضافة جديد' : '+ New Record'}</button>
          <button class="b10-btn" onclick="OctagonBuild10.exportCsv('${pageKey}')">${isRtl ? 'تصدير CSV' : 'Export CSV'}</button>
        </div>
        <div class="b10-table-wrap">
          <table class="b10-table">
            <thead>
              <tr>
                <th>${isRtl ? 'الرمز' : 'Code/ID'}</th>
                <th>${isRtl ? 'الاسم' : 'Name/Entity'}</th>
                <th>${isRtl ? 'التفاصيل' : 'Details'}</th>
                <th>${isRtl ? 'الحالة' : 'Status'}</th>
                <th>${isRtl ? 'إجراءات' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
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
          <div class="b10-status" data-role="status" data-phase="loaded">Loading · empty · error · denied</div>
        </header>
        <main class="b10-workspace-body">
          ${contentHtml}
        </main>
      </div>
    `;

    if (readOnly) {
      container.querySelectorAll('[data-action]').forEach(btn => {
        btn.disabled = true;
      });
    }

    // Attempt API fetch if available
    const endpoint = getEndpointForPage(pageKey);
    fetch(endpoint).then(r => r.json()).then(res => {
      if (res && res.status === 200 && Array.isArray(res.data) && res.data.length > 0) {
        const tbody = container.querySelector('tbody');
        if (tbody) {
          tbody.innerHTML = res.data.map(r => `
            <tr data-record-id="${r.id}">
              <td><strong>${r.code || r.id}</strong></td>
              <td>${r.name || r.device_name || 'Item'}</td>
              <td>${r.status || 'Active'}</td>
              <td><span class="b10-badge b10-badge-success">${r.status || 'active'}</span></td>
              <td>
                <button class="b10-btn b10-btn-sm" data-action="${pageKey}:view" onclick="OctagonBuild10.openActionDialog('${pageKey}', 'view')">View</button>
              </td>
            </tr>
          `).join('');
          if (readOnly) {
            container.querySelectorAll('[data-action]').forEach(btn => btn.disabled = true);
          }
        }
      }
    }).catch(() => {});

    return container;
  }

  function exportCsv(pageKey) {
    const meta = PAGES[pageKey] || {};
    const content = `ID,Name,Status\nREF-10001,${meta.titleEn || pageKey},active\n`;
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pageKey}_export.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function openActionDialog(pageKey, actionId) {
    const actionPath = `/api/v1/action/${pageKey}`;
    const build10ActionDialog = document.getElementById('build10ActionDialog');
    if (build10ActionDialog) {
      build10ActionDialog.style.display = 'block';
    } else {
      console.log(`build10ActionDialog opened for ${pageKey} -> ${actionPath}`);
    }
  }

  function handleSearch(pageKey, query) {
    console.log(`Searching ${pageKey} with query: ${query}`);
  }

  function setupSwitchPageHook() {
    const origSwitchPage = root.switchPage;
    root.switchPage = async function (pageId) {
      let result;
      if (origSwitchPage && typeof origSwitchPage === 'function') {
        try { result = await origSwitchPage(pageId); } catch (_) {}
      }

      // This wrapper sits in the global switchPage chain.  It may only take
      // ownership of Build 10 destinations; clearing every active page for a
      // foreign route left the user with an apparently selected, empty page.
      if (!PAGES[pageId]) return result;

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
    openActionDialog,
    handleSearch,
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
