(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  if (!root) return;

  function renderOfflinePage(pageKey, data, isRtl, readOnly) {
    const meta = root.Build10Registry.getPage(pageKey);
    const comps = root.Build10Components;
    const title = isRtl ? meta.titleAr : meta.titleEn;

    let sampleRows = data;
    if (!sampleRows || sampleRows.length === 0) {
      if (pageKey === 'offline_client_registry') {
        sampleRows = [
          { id: 'PWA-BROWSER-99', client_uuid: 'PWA-BROWSER-99', device_name: 'Browser PWA Scanner', app_version: 'v1.0.4', sync_status: 'synced', last_sync_at: new Date().toISOString() }
        ];
      } else if (pageKey === 'offline_queue') {
        sampleRows = [
          { id: 'BITEM-1', queue_item_uuid: 'BITEM-1', client_id: 'PWA-BROWSER-99', entity_name: 'inventory_scan', action_type: 'record_scan', status: 'accepted', client_timestamp: new Date().toISOString() },
          { id: 'BITEM-2', queue_item_uuid: 'BITEM-2', client_id: 'PWA-BROWSER-99', entity_name: 'gl_journal', action_type: 'post_journal', status: 'rejected', client_timestamp: new Date().toISOString() }
        ];
      } else if (pageKey === 'sync_sessions') {
        sampleRows = [
          { id: 'SYNC-BROWSER-101', session_uuid: 'SYNC-BROWSER-101', client_id: 'PWA-BROWSER-99', processed_count: 2, rejected_count: 1, status: 'completed', started_at: new Date().toISOString() }
        ];
      } else if (pageKey === 'sync_conflicts') {
        sampleRows = [
          { id: 'CNF-101', client_id: 'PWA-BROWSER-99', entity_name: 'inventory_count', conflict_type: 'version_mismatch', resolution_status: 'open', created_at: new Date().toISOString() }
        ];
      } else if (pageKey === 'conflict_resolution') {
        sampleRows = [
          { id: 'RES-101', conflict_id: 'CNF-101', strategy: 'server_wins', applied_by: 'browser-manager', status: 'resolved', resolved_at: new Date().toISOString() }
        ];
      } else if (pageKey === 'offline_capability_policies') {
        sampleRows = [
          { id: 'POL-1', role_id: 'operator', allowed_actions: 'receiving,picking,counting', max_offline_hours: 24, requires_reauth: 0, updated_at: new Date().toISOString() }
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
            <p>BUILD-10 Governed Offline & Sync Workspace · Active Scope: <span class="b10-scope-tag">Company / Branch</span></p>
          </div>
          <div>
            <span class="b10-badge b10-badge-active">Offline Domain</span>
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

  root.Build10OfflineRenderer = {
    render: renderOfflinePage
  };
})();
