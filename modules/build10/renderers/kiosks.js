(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  if (!root) return;

  function renderKioskPage(pageKey, data, isRtl, readOnly) {
    const meta = root.Build10Registry.getPage(pageKey);
    const comps = root.Build10Components;
    const title = isRtl ? meta.titleAr : meta.titleEn;

    if (pageKey === 'kiosk_device_registry') {
      const sampleRows = Array.isArray(data) ? data : [];
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
          <div class="b10-status" data-role="status" data-phase="loaded" style="color:#94a3b8;font-size:0.875rem;">${isRtl ? 'جاهز · تم تحميل البيانات' : 'Ready · data loaded'}</div>
          ${table}
        </div>
      `;
    }

    // Touch Kiosk Terminals (employee_kiosk, warehouse_kiosk, shop_floor_kiosk, service_kiosk)
    let kioskNotice = '';
    const kioskActions = `<p data-state="unavailable" style="color:#94a3b8;text-align:center;">${isRtl ? 'لا يتوفر إجراء كشك محكوم لهذه الشاشة حتى يتم تسجيل عقد الإجراء.' : 'No governed kiosk action is registered for this screen yet.'}</p>`;

    if (pageKey === 'employee_kiosk') {
      kioskNotice = isRtl ? 'كشك الخدمة الذاتية للموظفين (تسجيل الحضور والجدول اليومي) - لا يتم عرض معلومات الرواتب أو البيانات الخاصة.' : 'Employee Self-Service Kiosk (Check-in & Shift Schedule) - Sensitive HR & Payroll records are strictly excluded.';
    } else if (pageKey === 'warehouse_kiosk') {
      kioskNotice = isRtl ? 'كشك العمليات المخزنية (مسح وتنفيذ استلام / التقاط سريع)' : 'Warehouse Operations Touch Terminal (Fast Receiving & Picking Scan)';
    } else if (pageKey === 'shop_floor_kiosk') {
      kioskNotice = isRtl ? 'كشك صالة الإنتاج (تسجيل بدء العمليات، الإخراج والتوقفات)' : 'Shop Floor Terminal (Start/Pause Operation & Record Output)';
    } else if (pageKey === 'service_kiosk') {
      kioskNotice = isRtl ? 'كشك الخدمة والصيانة (استقبال الأجهزة وطلبات الصيانة)' : 'Service Desk Terminal (Reception & Service Checklist)';
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
            ${isRtl ? 'جاهز · تم تحميل البيانات' : 'Ready · data loaded'}
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
