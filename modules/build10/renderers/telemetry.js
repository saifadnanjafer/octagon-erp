(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  if (!root) return;

  function renderTelemetryPage(pageKey, data, isRtl, readOnly) {
    const meta = root.Build10Registry.getPage(pageKey);
    const comps = root.Build10Components;
    const title = isRtl ? meta.titleAr : meta.titleEn;

    let sampleRows = data;
    if (!sampleRows || sampleRows.length === 0) {
      if (pageKey === 'telemetry_explorer') {
        sampleRows = [
          { id: 'TEL-101', device_id: 'DEV-1001', metric: 'temperature', value: 24.5, unit: 'C', quality_flag: 'good', timestamp: new Date().toISOString() }
        ];
      } else if (pageKey === 'device_health_center') {
        sampleRows = [
          { id: 'DEV-1001', device_code: 'DEV-1001', health_score: 98, last_heartbeat: new Date().toISOString(), drift_status: 'none', status: 'active' }
        ];
      } else if (pageKey === 'device_alerts') {
        sampleRows = [
          { id: 'ALT-501', alert_code: 'ALT-501', severity: 'warning', device_code: 'DEV-1001', message: 'High temperature reading', occurred_at: new Date().toISOString(), status: 'open' }
        ];
      } else if (pageKey === 'firmware_catalogue') {
        sampleRows = [
          { id: 'FW-v2.1', version: 'v2.1.0', hardware_model: 'Tracker-X1', checksum: 'sha256-abc12345', release_notes: 'Bug fixes and performance improvements', created_at: new Date().toISOString() }
        ];
      } else if (pageKey === 'rollout_simulator') {
        sampleRows = [
          { id: 'ROL-101', rollout_code: 'ROL-101', firmware_version: 'v2.1.0', target_count: 50, success_rate: '98%', status: 'in_progress' }
        ];
      } else if (pageKey === 'configuration_profiles') {
        sampleRows = [
          { id: 'CFG-PROF-1', profile_code: 'CFG-PROF-1', name: 'High Frequency Telemetry', target_device_type: 'tracker', drift_count: 0, updated_at: new Date().toISOString() }
        ];
      } else if (pageKey === 'device_command_center') {
        sampleRows = [
          { id: 'CMD-801', command_uuid: 'CMD-801', device_code: 'DEV-1001', command_type: 'sync_config', payload: '{"interval": 30}', dispatch_status: 'dispatched', created_at: new Date().toISOString() }
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
            <p>BUILD-10 Governed Telemetry & Health Workspace · Active Scope: <span class="b10-scope-tag">Company / Branch</span></p>
          </div>
          <div>
            <span class="b10-badge b10-badge-active">Telemetry Domain</span>
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

  root.Build10TelemetryRenderer = {
    render: renderTelemetryPage
  };
})();
