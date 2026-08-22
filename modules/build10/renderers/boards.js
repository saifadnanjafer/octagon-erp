(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  if (!root) return;

  function renderBoardsPage(pageKey, data, isRtl, readOnly) {
    const meta = root.Build10Registry.getPage(pageKey);
    const title = isRtl ? meta.titleAr : meta.titleEn;
    // These displays once presented illustrative numbers as if they were live
    // operational facts. A board without an authoritative metric feed must
    // say so and hand the operator to the governed source workspace instead.
    const boardDestinations = {
      fleet_operations_board: ['fleet_live_map_simulator', 'speed_and_driver_events', 'suspected_fuel_loss_queue', 'maintenance_triggers'],
      device_health_board: ['device_registry', 'device_health_center', 'device_alerts', 'gateway_management'],
      warehouse_large_screen: ['mobile_receiving', 'pick_task_queue', 'dock_schedule', 'staging_board'],
      production_large_screen: ['shopfloor_terminal', 'workcenter_queue', 'downtime_board', 'production_receipt'],
      service_queue_board: ['service_kiosk', 'maintenance_triggers', 'device_alerts', 'workshop_command_center'],
      alert_board: ['device_alerts', 'treasury_alerts', 'quality_hold_queue', 'workshop_command_center'],
    };

    const destinations = boardDestinations[pageKey] || [];
    const cards = destinations.map((target) => {
      const destination = root.Build10Registry.getPage(target) || { titleAr: target, titleEn: target, icon: 'fa-arrow-up-right-from-square' };
      return {
      titleAr: destination.titleAr,
      titleEn: destination.titleEn,
      icon: destination.icon,
      value: '—',
      status: 'muted',
      subtitleAr: 'تتطلب القراءة الحية مصدراً محكوماً؛ افتح المصدر.',
      subtitleEn: 'Live metric not verified; open the governed source.',
      target,
      };
    });

    const cardsHtml = cards.map(c => `
      <div class="b10-board-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
          <span style="font-size:1.25rem;color:#38bdf8;"><i class="fa-solid ${c.icon}"></i></span>
          <span class="b10-badge b10-badge-${c.status}">${c.status}</span>
        </div>
        <h4 style="margin:0 0 0.25rem 0;color:#cbd5e1;font-size:0.9rem;">${isRtl ? c.titleAr : c.titleEn}</h4>
        <div style="font-size:1.75rem;font-weight:800;color:#f8fafc;margin-bottom:0.25rem;">${c.value}</div>
        <div style="font-size:0.75rem;color:#94a3b8;">${isRtl ? c.subtitleAr : c.subtitleEn}</div>
        ${c.target ? `<button type="button" class="b10-btn b10-btn-sm" data-page="${c.target}" onclick="switchPage('${c.target}')">${isRtl ? 'فتح المصدر' : 'Open source'}</button>` : ''}
      </div>
    `).join('');

    return `
      <div class="b10-workspace-shell" data-build10-page="${pageKey}">
        <div class="b10-header-card">
          <div class="b10-title-area">
            <h2><i class="fa-solid ${meta.icon}"></i> ${title}</h2>
            <p>BUILD-10 Large-Screen Operational Monitor · source navigation is company/branch scoped</p>
          </div>
          <div><span class="b10-badge">Guided board</span></div>
        </div>

        <div class="b10-status" data-role="status" data-phase="loaded" style="color:#94a3b8;font-size:0.875rem;margin-bottom:1rem;">
          ${isRtl ? 'روابط المصادر المحكومة جاهزة؛ تتطلب القياسات الحية مصدراً موثقاً.' : 'Governed source links are ready; live metrics require a verified feed.'}
        </div>

        <div class="b10-board-grid">
          ${cardsHtml}
        </div>
      </div>
    `;
  }

  root.Build10BoardsRenderer = {
    render: renderBoardsPage
  };
})();
