(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  if (!root) return;

  function renderTelemetryPage(pageKey, data, isRtl, readOnly) {
    const meta = root.Build10Registry.getPage(pageKey);
    const comps = root.Build10Components;
    const title = isRtl ? meta.titleAr : meta.titleEn;

    const sampleRows = Array.isArray(data) ? data : [];

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
          ${isRtl ? 'جاهز · تم تحميل البيانات' : 'Ready · data loaded'}
        </div>

        ${table}
      </div>
    `;
  }

  root.Build10TelemetryRenderer = {
    render: renderTelemetryPage
  };
})();
