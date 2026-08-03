(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  if (!root) return;

  function renderDevicesPage(pageKey, data, isRtl, readOnly) {
    const meta = root.Build10Registry.getPage(pageKey);
    const comps = root.Build10Components;
    const title = isRtl ? meta.titleAr : meta.titleEn;

    let sampleRows = data;
    if (!sampleRows || sampleRows.length === 0) {
      if (pageKey === 'device_registry') {
        sampleRows = [
          { id: 'DEV-1001', device_code: 'DEV-1001', name: 'GPS Tracker Unit 1', device_type: 'tracker', status: 'active', gateway_id: 'GW-HQ-01', last_seen_at: new Date().toISOString() },
          { id: 'DEV-1002', device_code: 'DEV-1002', name: 'Temperature Sensor Alpha', device_type: 'sensor_hub', status: 'active', gateway_id: 'GW-HQ-01', last_seen_at: new Date().toISOString() }
        ];
      } else if (pageKey === 'device_detail') {
        sampleRows = [
          { id: 'DEV-1001', device_code: 'DEV-1001', name: 'GPS Tracker Unit 1', status: 'active', assigned_vehicle_id: 'veh-browser-b10', updated_at: new Date().toISOString() }
        ];
      } else if (pageKey === 'device_enrollment') {
        sampleRows = [
          { id: 'ENR-9001', device_code: 'DEV-PENDING-1', enrollment_code: 'ENR-9001', token_status: 'pending', created_at: new Date().toISOString() }
        ];
      } else if (pageKey === 'gateway_management') {
        sampleRows = [
          { id: 'GW-HQ-01', gateway_code: 'GW-HQ-01', name: 'Depot Gateway', ip_address: '192.168.1.100', connected_devices_count: 5, status: 'active' }
        ];
      } else if (pageKey === 'sensor_management') {
        sampleRows = [
          { id: 'SNS-TEMP-01', sensor_code: 'SNS-TEMP-01', sensor_type: 'temperature', unit: 'C', min_limit: -20, max_limit: 50, status: 'active' }
        ];
      }
    }

    const controls = comps.renderControlsBar(pageKey, isRtl, readOnly);
    const table = comps.renderTable(pageKey, meta.columns, sampleRows, isRtl);

    return `
      <div class="b10-workspace-shell" data-build10-page="${pageKey}">
        <div class="b10-header-card">
          <div class="b10-title-area">
            <h2><i class="fa-solid ${meta.icon}"></i> ${title}</h2>
            <p>BUILD-10 Governed IoT & Device Workspace · Active Scope: <span class="b10-scope-tag">Company / Branch</span></p>
          </div>
          <div>
            <span class="b10-badge b10-badge-active">Active Domain</span>
          </div>
        </div>

        ${controls}

        <div class="b10-status" data-role="status" data-phase="loaded" style="color:#94a3b8;font-size:0.875rem;">
          Loading · empty · error · denied
        </div>

        ${table}
      </div>
    `;
  }

  root.Build10DevicesRenderer = {
    render: renderDevicesPage
  };
})();
