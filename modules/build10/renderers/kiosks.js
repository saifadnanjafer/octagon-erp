(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  if (!root) return;

  function renderKioskPage(pageKey, data, isRtl, readOnly) {
    const meta = root.Build10Registry.getPage(pageKey);
    const comps = root.Build10Components;
    const title = isRtl ? meta.titleAr : meta.titleEn;

    if (pageKey === 'kiosk_device_registry') {
      let sampleRows = data && data.length > 0 ? data : [
        { id: 'KIOSK-BROWSER-1', code: 'KIOSK-BROWSER-1', name: 'Browser Fleet Board Kiosk', kiosk_type: 'warehouse', status: 'active', last_ping_at: new Date().toISOString() }
      ];
      const controls = comps.renderControlsBar(pageKey, isRtl, readOnly);
      const table = comps.renderTable(pageKey, meta.columns, sampleRows, isRtl);
      return `
        <div class="b10-workspace-shell" data-build10-page="${pageKey}">
          <div class="b10-header-card">
            <div class="b10-title-area">
              <h2><i class="fa-solid ${meta.icon}"></i> ${title}</h2>
              <p>BUILD-10 Governed Kiosk Registry · Active Scope: <span class="b10-scope-tag">Company / Branch</span></p>
            </div>
            <div><span class="b10-badge b10-badge-active">Kiosk Registry</span></div>
          </div>
          ${controls}
          <div class="b10-status" data-role="status" data-phase="loaded" style="color:#94a3b8;font-size:0.875rem;">Loading · empty · error · denied</div>
          ${table}
        </div>
      `;
    }

    // Touch Kiosk Terminals (employee_kiosk, warehouse_kiosk, shop_floor_kiosk, service_kiosk)
    let kioskNotice = '';
    let kioskActions = '';

    if (pageKey === 'employee_kiosk') {
      kioskNotice = isRtl ? 'كشك الخدمة الذاتية للموظفين (تسجيل الحضور والجدول اليومي) - لا يتم عرض معلومات الرواتب أو البيانات الخاصة.' : 'Employee Self-Service Kiosk (Check-in & Shift Schedule) - Sensitive HR & Payroll records are strictly excluded.';
      kioskActions = `
        <button class="b10-btn b10-btn-primary" style="font-size:1.1rem;padding:0.75rem 1.5rem;" ${readOnly ? 'disabled' : ''} onclick="window.Build10Engine.openActionDialog('${pageKey}', 'kiosk:employee_checkin')">
          <i class="fa-solid fa-user-check"></i> ${isRtl ? 'تسجيل الحضور/الانصراف الذاتي' : 'Employee Self Check-in'}
        </button>
      `;
    } else if (pageKey === 'warehouse_kiosk') {
      kioskNotice = isRtl ? 'كشك العمليات المخزنية (مسح وتنفيذ استلام / التقاط سريع)' : 'Warehouse Operations Touch Terminal (Fast Receiving & Picking Scan)';
      kioskActions = `
        <button class="b10-btn b10-btn-primary" style="font-size:1.1rem;padding:0.75rem 1.5rem;" ${readOnly ? 'disabled' : ''} onclick="window.Build10Engine.openActionDialog('${pageKey}', 'kiosk:warehouse_quick_scan')">
          <i class="fa-solid fa-barcode"></i> ${isRtl ? 'مسح باركود سريع' : 'Quick Barcode Scan'}
        </button>
      `;
    } else if (pageKey === 'shop_floor_kiosk') {
      kioskNotice = isRtl ? 'كشك صالة الإنتاج (تسجيل بدء العمليات، الإخراج والتوقفات)' : 'Shop Floor Terminal (Start/Pause Operation & Record Output)';
      kioskActions = `
        <button class="b10-btn b10-btn-primary" style="font-size:1.1rem;padding:0.75rem 1.5rem;" ${readOnly ? 'disabled' : ''} onclick="window.Build10Engine.openActionDialog('${pageKey}', 'kiosk:shopfloor_quick_output')">
          <i class="fa-solid fa-industry"></i> ${isRtl ? 'تسجيل إنتاج جديد' : 'Record Operation Output'}
        </button>
      `;
    } else if (pageKey === 'service_kiosk') {
      kioskNotice = isRtl ? 'كشك الخدمة والصيانة (استقبال الأجهزة وطلبات الصيانة)' : 'Service Desk Terminal (Reception & Service Checklist)';
      kioskActions = `
        <button class="b10-btn b10-btn-primary" style="font-size:1.1rem;padding:0.75rem 1.5rem;" ${readOnly ? 'disabled' : ''} onclick="window.Build10Engine.openActionDialog('${pageKey}', 'kiosk:service_checkin')">
          <i class="fa-solid fa-headset"></i> ${isRtl ? 'استلام طلب خدمة جديد' : 'New Service Reception'}
        </button>
      `;
    }

    return `
      <div class="b10-workspace-shell b10-kiosk-shell" data-build10-page="${pageKey}">
        <div class="b10-kiosk-card">
          <div class="b10-header-card" style="margin-bottom:1.5rem;">
            <div class="b10-title-area">
              <h2><i class="fa-solid ${meta.icon}"></i> ${title}</h2>
              <p>${kioskNotice}</p>
            </div>
            <div><span class="b10-badge b10-badge-active">Touch Kiosk Mode</span></div>
          </div>

          <div class="b10-status" data-role="status" data-phase="loaded" style="color:#94a3b8;font-size:0.875rem;margin-bottom:1rem;">
            Loading · empty · error · denied
          </div>

          <div style="display:flex;gap:1rem;justify-content:center;margin:2rem 0;">
            ${kioskActions}
          </div>

          <div style="background:rgba(15,23,42,0.8);border:1px solid rgba(255,255,255,0.1);border-radius:0.5rem;padding:1rem;">
            <h4 style="margin-0 0 0.5rem 0;color:#38bdf8;">${isRtl ? 'النشاط الحالي للكشك' : 'Active Kiosk Session'}</h4>
            <p style="font-size:0.875rem;color:#cbd5e1;margin:0;">
              ${isRtl ? 'جهاز الكشك جاهز للعمل. يتم تطبيق القيود الأمنية تلقائياً لمنع أي إجراءات إدارية غير مصرح بها.' : 'Kiosk is ready for operator touch input. Kiosk security restrictions apply.'}
            </p>
          </div>
        </div>
      </div>
    `;
  }

  root.Build10KiosksRenderer = {
    render: renderKioskPage
  };
})();
