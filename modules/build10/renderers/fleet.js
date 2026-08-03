(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  if (!root) return;

  function renderFleetPage(pageKey, data, isRtl, readOnly) {
    const meta = root.Build10Registry.getPage(pageKey);
    const comps = root.Build10Components;
    const title = isRtl ? meta.titleAr : meta.titleEn;

    let sampleRows = data;
    if (!sampleRows || sampleRows.length === 0) {
      if (pageKey === 'fleet_device_mapping') {
        sampleRows = [
          { id: 'MAP-101', vehicle_number: 'VN-BROWSER-B10', registration_number: 'REG-BROWSER-B10', tracker_device_id: 'DEV-1001', odometer_offset_km: 12000, status: 'active' }
        ];
      } else if (pageKey === 'fleet_live_map_simulator') {
        sampleRows = [
          { id: 'LOC-101', vehicle_id: 'veh-browser-b10', latitude: 33.3152, longitude: 44.3661, speed_kmh: 45, freshness: 'live', timestamp: new Date().toISOString() }
        ];
      } else if (pageKey === 'vehicle_trip_timeline') {
        sampleRows = [
          { id: 'TRIP-1001', trip_code: 'TRIP-1001', vehicle_id: 'veh-browser-b10', start_time: new Date(Date.now() - 3600000).toISOString(), end_time: new Date().toISOString(), distance_km: 15, max_speed_kmh: 90, status: 'completed' }
        ];
      } else if (pageKey === 'geofence_management') {
        sampleRows = [
          { id: 'GF-BROWSER-HQ', code: 'GF-BROWSER-HQ', name: 'Browser HQ Depot', fence_type: 'circular', center_lat: 33.3152, center_lng: 44.3661, radius_m: 300, active: 1 }
        ];
      } else if (pageKey === 'geofence_events') {
        sampleRows = [
          { id: 'EVT-GF-1', event_uuid: 'EVT-GF-1', device_id: 'DEV-1001', geofence_id: 'GF-BROWSER-HQ', event_type: 'exit', breach_flag: 'breach', timestamp: new Date().toISOString() }
        ];
      } else if (pageKey === 'speed_and_driver_events') {
        sampleRows = [
          { id: 'EVT-SPD-1', event_uuid: 'EVT-SPD-1', vehicle_id: 'veh-browser-b10', recorded_speed_kmh: 95, speed_limit_kmh: 80, severity: 'warning', timestamp: new Date().toISOString() }
        ];
      } else if (pageKey === 'fuel_telemetry') {
        sampleRows = [
          { id: 'FUEL-1', device_id: 'DEV-1001', fuel_level_liters: 75.0, percentage: 75, delta_liters: 0, anomaly_flag: 'normal', timestamp: new Date().toISOString() }
        ];
      } else if (pageKey === 'suspected_fuel_loss_queue') {
        sampleRows = [
          { id: 'FLOSS-1', case_code: 'FLOSS-1', vehicle_id: 'veh-browser-b10', fuel_drop_liters: 12.5, suspected_reason: 'Unusual drop while stationary', investigation_status: 'under_review', updated_at: new Date().toISOString() }
        ];
      } else if (pageKey === 'maintenance_triggers') {
        sampleRows = [
          { id: 'TRIG-1', trigger_code: 'TRIG-1', vehicle_id: 'veh-browser-b10', trigger_type: 'odometer', threshold_value: 15000, current_value: 15200, status: 'active' }
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
            <p>BUILD-10 Governed Fleet Telematics Workspace · Active Scope: <span class="b10-scope-tag">Company / Branch</span></p>
          </div>
          <div>
            <span class="b10-badge b10-badge-active">Fleet Domain</span>
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

  root.Build10FleetRenderer = {
    render: renderFleetPage
  };
})();
