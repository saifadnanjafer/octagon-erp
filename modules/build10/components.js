(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  if (!root) return;

  function renderBadge(status) {
    const s = String(status || 'active').toLowerCase();
    if (['active', 'completed', 'resolved', 'synced', 'online'].includes(s)) {
      return `<span class="b10-badge b10-badge-active">${s}</span>`;
    }
    if (['warning', 'pending', 'scanning', 'open', 'degraded'].includes(s)) {
      return `<span class="b10-badge b10-badge-warning">${s}</span>`;
    }
    if (['critical', 'breach', 'rejected', 'error', 'revoked'].includes(s)) {
      return `<span class="b10-badge b10-badge-critical">${s}</span>`;
    }
    return `<span class="b10-badge b10-badge-offline">${s}</span>`;
  }

  function renderControlsBar(pageKey, isRtl, readOnly = false) {
    const registry = root.Build10Registry;
    const meta = registry ? registry.getPage(pageKey) : null;
    const actions = meta?.actions || [];

    const actionButtons = actions.map(actId => {
      const formDef = root.Build10Forms ? root.Build10Forms.getForm(actId) : null;
      const btnTitle = formDef ? (isRtl ? formDef.titleAr : formDef.titleEn) : actId.split(':')[1] || actId;
      return `<button class="b10-btn b10-btn-primary" data-action="${actId}" ${readOnly ? 'disabled' : ''} onclick="window.Build10Engine.openActionDialog('${pageKey}', '${actId}')">
        <i class="fa-solid fa-play"></i> ${btnTitle}
      </button>`;
    }).join('');

    return `
      <div class="b10-controls-bar">
        <input type="text" class="b10-search-input" data-role="filter" placeholder="${isRtl ? 'بحث في السجلات...' : 'Search records...'}" oninput="window.Build10Engine.handleSearch('${pageKey}', this.value)" />
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
          <button class="b10-btn b10-btn-secondary" onclick="window.Build10Engine.exportCsv('${pageKey}')">
            <i class="fa-solid fa-file-csv"></i> ${isRtl ? 'تصدير CSV' : 'Export CSV'}
          </button>
          ${actionButtons}
        </div>
      </div>
    `;
  }

  function renderTable(pageKey, columns, rows, isRtl) {
    if (!rows || rows.length === 0) {
      const meta = root.Build10Registry ? root.Build10Registry.getPage(pageKey) : null;
      const emptyMsg = isRtl ? (meta?.emptyStateAr || 'لا توجد سجلات بعد.') : (meta?.emptyStateEn || 'No records yet.');
      return `
        <div class="b10-table-wrap">
          <table class="b10-table">
            <thead>
              <tr>${columns.map(col => `<th>${col}</th>`).join('')}</tr>
            </thead>
            <tbody>
              <tr><td colspan="${columns.length}" style="text-align:center;padding:2rem;color:#94a3b8;">${emptyMsg}</td></tr>
            </tbody>
          </table>
        </div>
      `;
    }

    const headersHtml = columns.map(col => `<th>${col.replace(/_/g, ' ').toUpperCase()}</th>`).join('');
    const rowsHtml = rows.map((r, idx) => {
      const recId = r.id || r.device_code || r.code || r.uuid || r.queue_item_uuid || r.event_uuid || r.trip_code || r.client_uuid || `rec-${idx+1}`;
      const cells = columns.map(col => {
        let val = r[col];
        if (col === 'status' || col === 'breach_flag' || col === 'anomaly_flag') {
          val = renderBadge(val);
        } else if (typeof val === 'object' && val !== null) {
          val = `<code>${JSON.stringify(val).slice(0, 30)}...</code>`;
        } else if (val === undefined || val === null) {
          val = '-';
        }
        return `<td>${val}</td>`;
      }).join('');

      return `<tr data-record-id="${recId}">${cells}</tr>`;
    }).join('');

    return `
      <div class="b10-table-wrap">
        <table class="b10-table">
          <thead><tr>${headersHtml}</tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    `;
  }

  root.Build10Components = {
    renderBadge,
    renderControlsBar,
    renderTable
  };
})();
