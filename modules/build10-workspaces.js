(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  if (!root) return;

  const PAGES = {
    device_registry: { titleAr: 'سجل أجهزة IoT', titleEn: 'IoT Device Registry', icon: 'fa-microchip', api: '/api/v1/iot/devices' },
    device_detail: { titleAr: 'تفاصيل الجهاز', titleEn: 'Device Detail', icon: 'fa-circle-info', api: '/api/v1/iot/device-detail' },
    device_enrollment: { titleAr: 'تسجيل وتفعيل الأجهزة', titleEn: 'Device Enrollment', icon: 'fa-barcode', api: '/api/v1/iot/enrollment' },
    gateway_management: { titleAr: 'إدارة البوابات', titleEn: 'Gateway Management', icon: 'fa-network-wired', api: '/api/v1/iot/gateways' },
    sensor_management: { titleAr: 'إدارة الحساسات', titleEn: 'Sensor Management', icon: 'fa-temperature-high', api: '/api/v1/iot/sensors' },
    telemetry_explorer: { titleAr: 'مستكشف بيانات القياس', titleEn: 'Telemetry Explorer', icon: 'fa-chart-line', api: '/api/v1/iot/telemetry' },
    device_health_center: { titleAr: 'مركز صحة الأجهزة', titleEn: 'Device Health Center', icon: 'fa-heart-pulse', api: '/api/v1/iot/health' },
    device_alerts: { titleAr: 'تنبيهات وأعطال الأجهزة', titleEn: 'Device Alerts', icon: 'fa-triangle-exclamation', api: '/api/v1/iot/alerts' },
    firmware_catalogue: { titleAr: 'كتالوج البرامج الثابتة', titleEn: 'Firmware Catalogue', icon: 'fa-file-code', api: '/api/v1/iot/firmware' },
    rollout_simulator: { titleAr: 'محاكي التحديث الميداني', titleEn: 'Rollout Simulator', icon: 'fa-cloud-arrow-up', api: '/api/v1/iot/rollouts' },
    configuration_profiles: { titleAr: 'ملفات إعدادات الأجهزة', titleEn: 'Configuration Profiles', icon: 'fa-sliders', api: '/api/v1/iot/config-profiles' },
    device_command_center: { titleAr: 'مركز أوامر الأجهزة', titleEn: 'Device Command Center', icon: 'fa-terminal', api: '/api/v1/iot/commands' },
    fleet_device_mapping: { titleAr: 'ربط أجهزة أسطول السيارات', titleEn: 'Fleet Device Mapping', icon: 'fa-truck-gear', api: '/api/v1/fleet/mappings' },
    fleet_live_map_simulator: { titleAr: 'خريطة التتبع المباشر', titleEn: 'Fleet Live Map Simulator', icon: 'fa-map-location-dot', api: '/api/v1/fleet/locations' },
    vehicle_trip_timeline: { titleAr: 'خط زمني لرحلات السيارات', titleEn: 'Vehicle Trip Timeline', icon: 'fa-route', api: '/api/v1/fleet/trips' },
    geofence_management: { titleAr: 'إدارة النطاقات الجغرافية', titleEn: 'Geofence Management', icon: 'fa-draw-polygon', api: '/api/v1/fleet/geofences' },
    geofence_events: { titleAr: 'أحداث دخول وخروج النطاقات', titleEn: 'Geofence Events', icon: 'fa-bell', api: '/api/v1/fleet/geofence-events' },
    speed_and_driver_events: { titleAr: 'أحداث السرعة والسياقة', titleEn: 'Speed and Driver Events', icon: 'fa-gauge-high', api: '/api/v1/fleet/speed-events' },
    fuel_telemetry: { titleAr: 'قياسات واستهلاك الوقود', titleEn: 'Fuel Telemetry', icon: 'fa-gas-pump', api: '/api/v1/fleet/fuel' },
    suspected_fuel_loss_queue: { titleAr: 'طابور الاشتباه في هدر الوقود', titleEn: 'Suspected Fuel Loss Queue', icon: 'fa-shield-cat', api: '/api/v1/fleet/fuel-anomalies' },
    maintenance_triggers: { titleAr: 'محفزات الصيانة التلقائية', titleEn: 'Maintenance Triggers', icon: 'fa-wrench', api: '/api/v1/fleet/maintenance-triggers' },
    offline_client_registry: { titleAr: 'سجل التطبيقات الميدانية المستقلة', titleEn: 'Offline Client Registry', icon: 'fa-mobile-screen', api: '/api/v1/offline/clients' },
    offline_queue: { titleAr: 'طابور الأوامر غير المتصلة', titleEn: 'Offline Queue', icon: 'fa-list-check', api: '/api/v1/offline/queue' },
    sync_sessions: { titleAr: 'جلسات المزامنة الميدانية', titleEn: 'Sync Sessions', icon: 'fa-rotate', api: '/api/v1/offline/sessions' },
    sync_conflicts: { titleAr: 'تعارضات المزامنة', titleEn: 'Sync Conflicts', icon: 'fa-code-compare', api: '/api/v1/offline/conflicts' },
    conflict_resolution: { titleAr: 'معالجة وتصفية التعارضات', titleEn: 'Conflict Resolution', icon: 'fa-check-double', api: '/api/v1/offline/resolutions' },
    offline_capability_policies: { titleAr: 'سياسات الصلاحيات الميدانية', titleEn: 'Offline Capability Policies', icon: 'fa-shield-halved', api: '/api/v1/offline/policies' },
    kiosk_device_registry: { titleAr: 'سجل أجهزة الكشك الخدمي', titleEn: 'Kiosk Device Registry', icon: 'fa-desktop', api: '/api/v1/kiosk/registry' },
    employee_kiosk: { titleAr: 'كشك الموظفين الذاتي', titleEn: 'Employee Kiosk', icon: 'fa-user-gear', api: '/api/v1/kiosk/employee' },
    warehouse_kiosk: { titleAr: 'كشك العمليات المخزنية', titleEn: 'Warehouse Kiosk', icon: 'fa-boxes-packing', api: '/api/v1/kiosk/warehouse' },
    shop_floor_kiosk: { titleAr: 'كشك صالة الإنتاج', titleEn: 'Shop Floor Kiosk', icon: 'fa-industry', api: '/api/v1/kiosk/shopfloor' },
    service_kiosk: { titleAr: 'كشك الخدمة والصيانة', titleEn: 'Service Kiosk', icon: 'fa-headset', api: '/api/v1/kiosk/service' },
    fleet_operations_board: { titleAr: 'لوحة عمليات الأسطول', titleEn: 'Fleet Operations Board', icon: 'fa-tv', api: '/api/v1/boards/fleet-ops' },
    device_health_board: { titleAr: 'لوحة صحة وشبكة الأجهزة', titleEn: 'Device Health Board', icon: 'fa-tv', api: '/api/v1/boards/device-health' },
    warehouse_large_screen: { titleAr: 'شاشة المخزن الكبيرة', titleEn: 'Warehouse Large Screen', icon: 'fa-tv', api: '/api/v1/boards/warehouse-ops' },
    production_large_screen: { titleAr: 'شاشة خط الإنتاج الكبيرة', titleEn: 'Production Large Screen', icon: 'fa-tv', api: '/api/v1/boards/production-ops' },
    service_queue_board: { titleAr: 'شاشة طابور الصيانة', titleEn: 'Service Queue Board', icon: 'fa-tv', api: '/api/v1/boards/service-queue' },
    alert_board: { titleAr: 'شاشة التنبيهات المركزية', titleEn: 'Alert Board', icon: 'fa-tv', api: '/api/v1/boards/alerts' }
  };

  function renderPage(pageKey, container) {
    const meta = PAGES[pageKey];
    if (!meta || !container) return;

    const isRtl = document.documentElement.dir === 'rtl';
    const title = isRtl ? meta.titleAr : meta.titleEn;

    container.innerHTML = `
      <div class="b10-workspace-shell" data-build10-page="${pageKey}">
        <div class="b10-header-card">
          <div class="b10-title-area">
            <h2><i class="fa-solid ${meta.icon}"></i> ${title}</h2>
            <p>BUILD-10 Governed Workspace · Active Scope: <span class="b10-scope-tag">Company / Branch</span></p>
          </div>
          <div>
            <span class="b10-badge b10-badge-active">Governed Active</span>
          </div>
        </div>

        <div class="b10-controls-bar">
          <input type="text" class="b10-search-input" placeholder="${isRtl ? 'بحث في السجلات...' : 'Search records...'}" />
          <div style="display:flex;gap:0.5rem;">
            <button class="b10-btn b10-btn-secondary" onclick="window.Build10Engine.exportCsv('${pageKey}')">
              <i class="fa-solid fa-file-csv"></i> ${isRtl ? 'تصدير CSV' : 'Export CSV'}
            </button>
            <button class="b10-btn b10-btn-primary" onclick="window.Build10Engine.openActionDialog('${pageKey}')">
              <i class="fa-solid fa-plus"></i> ${isRtl ? 'إجراء جديد' : 'New Action'}
            </button>
          </div>
        </div>

        <div class="b10-status" data-state="loaded" style="color:#94a3b8;font-size:0.875rem;">
          Loading · empty · error · denied
        </div>

        <div class="b10-table-wrap">
          <table class="b10-table">
            <thead>
              <tr>
                <th>#</th>
                <th>${isRtl ? 'المعرف' : 'ID / Ref'}</th>
                <th>${isRtl ? 'الاسم / الوصف' : 'Name / Title'}</th>
                <th>${isRtl ? 'الحالة' : 'Status'}</th>
                <th>${isRtl ? 'تاريخ التحديث' : 'Updated At'}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>1</td>
                <td><code>REF-10001</code></td>
                <td>${title} Sample Operational Record</td>
                <td><span class="b10-badge b10-badge-active">active</span></td>
                <td>${new Date().toISOString().slice(0, 10)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function exportCsv(pageKey) {
    const meta = PAGES[pageKey] || {};
    const content = `ID,Name,Status\nREF-10001,${meta.titleEn || pageKey},active\n`;
    const blob = new Blob([content], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pageKey}_export.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function openActionDialog(pageKey) {
    alert(`BUILD-10 Governed Action Dialog opened for: ${pageKey}`);
  }

  root.Build10Engine = {
    PAGES,
    renderPage,
    exportCsv,
    openActionDialog
  };

  document.addEventListener('DOMContentLoaded', () => {
    Object.keys(PAGES).forEach((pageKey) => {
      const elem = document.querySelector(`[data-page="${pageKey}"]`);
      if (elem) renderPage(pageKey, elem);
    });
  });
})();
