(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  if (!root) return;

  function renderBoardsPage(pageKey, data, isRtl, readOnly) {
    const meta = root.Build10Registry.getPage(pageKey);
    const title = isRtl ? meta.titleAr : meta.titleEn;

    let cards = [];
    if (pageKey === 'fleet_operations_board') {
      cards = [
        { titleAr: 'المركبات النشطة', titleEn: 'Active Vehicles', value: '18 / 20', status: 'online', icon: 'fa-truck-fast', subtitleAr: 'في الخدمة الميدانية', subtitleEn: 'In field service' },
        { titleAr: 'معدل السرعة الزائدة', titleEn: 'Speed Violation Rate', value: '2.1%', status: 'warning', icon: 'fa-gauge-high', subtitleAr: 'خلال الـ 24 ساعة', subtitleEn: 'Last 24 hours' },
        { titleAr: 'حالات اشتباه الوقود', titleEn: 'Suspected Fuel Loss', value: '1 case', status: 'critical', icon: 'fa-gas-pump', subtitleAr: 'قيد التحقيق الفني', subtitleEn: 'Under investigation' },
        { titleAr: 'جاهزية الأسطول', titleEn: 'Fleet Readiness', value: '95%', status: 'online', icon: 'fa-shield-halved', subtitleAr: 'جاهزية تشغيلية', subtitleEn: 'Operational uptime' }
      ];
    } else if (pageKey === 'device_health_board') {
      cards = [
        { titleAr: 'إجمالي أجهزة IoT', titleEn: 'Total IoT Devices', value: '142', status: 'online', icon: 'fa-microchip', subtitleAr: 'أجهزة مسجلة', subtitleEn: 'Registered units' },
        { titleAr: 'الأجهزة المتصلة', titleEn: 'Devices Online', value: '138', status: 'online', icon: 'fa-wifi', subtitleAr: 'بث مباشر حظي', subtitleEn: 'Broadcasting live' },
        { titleAr: 'أجهزة متدهورة', titleEn: 'Degraded Devices', value: '3', status: 'warning', icon: 'fa-heart-crack', subtitleAr: 'تتطلب فحص فني', subtitleEn: 'Requires diagnostic' },
        { titleAr: 'أجهزة غير متصلة', titleEn: 'Offline Devices', value: '1', status: 'critical', icon: 'fa-plug-circle-xmark', subtitleAr: 'انقطاع الاتصال', subtitleEn: 'Connection timeout' }
      ];
    } else if (pageKey === 'warehouse_large_screen') {
      cards = [
        { titleAr: 'إنتاجية الاستلام', titleEn: 'Receiving Throughput', value: '320 pkgs/h', status: 'online', icon: 'fa-boxes-packing', subtitleAr: 'معدل الساعة الحالية', subtitleEn: 'Current hour rate' },
        { titleAr: 'إنتاجية الالتقاط', titleEn: 'Picking Throughput', value: '450 lines/h', status: 'online', icon: 'fa-dolly', subtitleAr: 'معدل الالتقاط الميداني', subtitleEn: 'Pick execution rate' },
        { titleAr: 'الأرصفة النشطة', titleEn: 'Active Docks', value: '4 / 6', status: 'online', icon: 'fa-truck-ramp-box', subtitleAr: 'شحن واستلام جاري', subtitleEn: 'Dock operations' },
        { titleAr: 'طابور التجهيز', titleEn: 'Staging Backlog', value: '12 orders', status: 'warning', icon: 'fa-layer-group', subtitleAr: 'بانتظار التحميل', subtitleEn: 'Awaiting loading' }
      ];
    } else if (pageKey === 'production_large_screen') {
      cards = [
        { titleAr: 'كفاءة OEE الحالية', titleEn: 'Current OEE Rate', value: '87.4%', status: 'online', icon: 'fa-chart-pie', subtitleAr: 'معدل الأداء الفعلي', subtitleEn: 'Overall efficiency' },
        { titleAr: 'إنتاجية خط المصنع', titleEn: 'Line Output Rate', value: '1,200 units', status: 'online', icon: 'fa-industry', subtitleAr: 'الوردية الحالية', subtitleEn: 'Current shift' },
        { titleAr: 'معدل الإتلاف/الهدر', titleEn: 'Scrap/Rejection Rate', value: '0.8%', status: 'online', icon: 'fa-trash-can', subtitleAr: 'ضمن النطاق المسموح', subtitleEn: 'Within tolerance' },
        { titleAr: 'زمن التوقف الكلي', titleEn: 'Total Downtime', value: '14 min', status: 'warning', icon: 'fa-clock', subtitleAr: 'أسباب صيانة مخططة', subtitleEn: 'Planned maintenance' }
      ];
    } else if (pageKey === 'service_queue_board') {
      cards = [
        { titleAr: 'طابور الصيانة', titleEn: 'Service Queue', value: '8 tickets', status: 'online', icon: 'fa-headset', subtitleAr: 'تذاكر بانتظار البدء', subtitleEn: 'Awaiting technician' },
        { titleAr: 'متوسط زمن الانتظار', titleEn: 'Avg Wait Time', value: '12 min', status: 'online', icon: 'fa-hourglass-half', subtitleAr: 'زمن استجابة سريع', subtitleEn: 'Response speed' },
        { titleAr: 'الفنيين المتاحين', titleEn: 'Available Techs', value: '5 / 6', status: 'online', icon: 'fa-user-nurse', subtitleAr: 'فنيو صيانة', subtitleEn: 'Service engineers' },
        { titleAr: 'تذاكر عاجلة', titleEn: 'Urgent Tickets', value: '1 ticket', status: 'critical', icon: 'fa-fire', subtitleAr: 'صيانة طارئة', subtitleEn: 'Emergency repair' }
      ];
    } else {
      cards = [
        { titleAr: 'تنبيهات حرجة', titleEn: 'Critical Alerts', value: '0', status: 'online', icon: 'fa-triangle-exclamation', subtitleAr: 'لا توجد مخاوف عاجلة', subtitleEn: 'No urgent issues' },
        { titleAr: 'تحذيرات النظام', titleEn: 'System Warnings', value: '2', status: 'warning', icon: 'fa-bell', subtitleAr: 'تنبيهات سريعة', subtitleEn: 'System warnings' },
        { titleAr: 'مراقبة الأداء', titleEn: 'Performance Monitor', value: 'Optimal', status: 'online', icon: 'fa-gauge-simple-high', subtitleAr: 'استقرار تام', subtitleEn: 'System stable' },
        { titleAr: 'زمن التشغيل', titleEn: 'System Uptime', value: '99.99%', status: 'online', icon: 'fa-server', subtitleAr: 'جاهزية السيرفر', subtitleEn: 'Server availability' }
      ];
    }

    const cardsHtml = cards.map(c => `
      <div class="b10-board-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
          <span style="font-size:1.25rem;color:#38bdf8;"><i class="fa-solid ${c.icon}"></i></span>
          <span class="b10-badge b10-badge-${c.status}">${c.status}</span>
        </div>
        <h4 style="margin:0 0 0.25rem 0;color:#cbd5e1;font-size:0.9rem;">${isRtl ? c.titleAr : c.titleEn}</h4>
        <div style="font-size:1.75rem;font-weight:800;color:#f8fafc;margin-bottom:0.25rem;">${c.value}</div>
        <div style="font-size:0.75rem;color:#94a3b8;">${isRtl ? c.subtitleAr : c.subtitleEn}</div>
      </div>
    `).join('');

    return `
      <div class="b10-workspace-shell" data-build10-page="${pageKey}">
        <div class="b10-header-card">
          <div class="b10-title-area">
            <h2><i class="fa-solid ${meta.icon}"></i> ${title}</h2>
            <p>BUILD-10 Large-Screen Operational Monitor · Active Scope: <span class="b10-scope-tag">Company / Branch</span></p>
          </div>
          <div><span class="b10-badge b10-badge-active">Live Board</span></div>
        </div>

        <div class="b10-status" data-role="status" data-phase="loaded" style="color:#94a3b8;font-size:0.875rem;margin-bottom:1rem;">
          Loading · empty · error · denied
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
