/**
 * OCTAGON ERP — Fleet Management (غرفة تحكم الأسطول).
 *
 * Phase 8E bilingualization and presentation enrichment.
 * Features: live SVG map, geofence zones, document tracking, fuel anomalies,
 * and read-only Jarvis assistant integration.
 *
 * Data namespace: omni.fleet = { vehicles:[], fuelLogs:[], trips:[] }
 * Page: #pageFleet (nav data-page="fleet").
 */
(function () {
  'use strict';

  function O() { if (typeof omni !== 'undefined' && omni) return omni; if (typeof window.ensureOmni === 'function') { try { return window.ensureOmni(); } catch (_) {} } return null; }
  function save() { if (typeof window.saveData === 'function') window.saveData(); }
  function toast(m, t) { if (typeof window.showToast === 'function') window.showToast(m, t || 'info'); }
  function uid(p) { return (typeof window.makeId === 'function') ? window.makeId(p) : (p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)); }
  function money(n) { n = Number(n); return isFinite(n) ? Math.round(n) : 0; }
  function fmt(n) { return money(n).toLocaleString(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function curSym() { const o = O(); return (o && o.adminSettings && o.adminSettings.organization && o.adminSettings.organization.currencySymbol) || tx('د.ع'); }
  function val(id) { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; }
  function numVal(id) { const v = Number(val(id)); return isFinite(v) ? v : 0; }
  function coId() { try { return (typeof window.getActiveOrgProfile === 'function' ? window.getActiveOrgProfile()?.companyId : '') || ''; } catch (_) { return ''; } }
  function userName() { try { if (window.PentagonAuth && PentagonAuth.currentUser) return PentagonAuth.currentUser.name; } catch (_) {} return tx('مستخدم'); }
  function audit(action, detail) {
    try { if (typeof window.recordOmniHistoryEvent === 'function') window.recordOmniHistoryEvent('fleet', action, detail); } catch (_) {}
    try { if (window.AuditService && typeof AuditService.createEvent === 'function') AuditService.createEvent({ module: 'fleet', action, detail, user: userName() }); } catch (_) {}
  }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function daysFromToday(iso) { return iso ? Math.round((new Date(iso) - new Date(todayISO())) / 86400000) : null; }
  function dateShift(days) { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }

  function getLang() {
    try {
      const stored = localStorage.getItem('octagon:language') || localStorage.getItem('omni:language');
      if (stored) return stored;
    } catch (_) {}
    return window.currentLang || 'ar';
  }
  function t(ar, en) {
    return getLang() === 'ar' ? ar : en;
  }

  const DICT = {
    'بيانات تجريبية للعرض — لا يوجد ربط GPS/OBD حقيقي': ['بيانات تجريبية للعرض — لا يوجد ربط GPS/OBD حقيقي', 'Demo Data — No active GPS/OBD integration'],
    'إجازة سوق': ['إجازة سوق', 'Driving License'],
    'تأمين': ['تأمين', 'Insurance'],
    'المركبات': ['المركبات', 'Vehicles'],
    'في الخدمة': ['في الخدمة', 'In Service'],
    'صيانة': ['صيانة', 'Maintenance'],
    'وقود هذا الشهر': ['وقود هذا الشهر', 'Fuel This Month'],
    'إجمالي المسافات': ['إجمالي المسافات', 'Total Distance'],
    'وثائق تحتاج تجديداً': ['وثائق تحتاج تجديداً', 'Document Renewals'],
    'الوثيقة': ['الوثيقة', 'Document'],
    'الحالة': ['الحالة', 'Status'],
    'التاريخ': ['التاريخ', 'Date'],
    'كل الوثائق سارية ✅': ['كل الوثائق سارية ✅', 'All documents active ✅'],
    'منتهية منذ ': ['منتهية منذ ', 'Expired '],
    ' يوم': [' يوم', ' days'],
    'خلال ': ['خلال ', 'Within '],
    'اللوحة': ['اللوحة', 'Plate'],
    'النوع': ['النوع', 'Type'],
    'السائق': ['السائق', 'Driver'],
    'العداد': ['العداد', 'Odometer'],
    'الإجازة': ['الإجازة', 'License'],
    'التأمين': ['التأمين', 'Insurance'],
    'إجراءات': ['إجراءات', 'Actions'],
    'تعديل': ['تعديل', 'Edit'],
    'إنهاء صيانة': ['إنهاء صيانة', 'Finish Maint'],
    'أرشفة': ['أرشفة', 'Archive'],
    'رقم اللوحة مطلوب': ['رقم اللوحة مطلوب', 'Plate number is required'],
    'تم التحديث': ['تم التحديث', 'Updated successfully'],
    'تمت إضافة المركبة': ['تمت إضافة المركبة', 'Vehicle added successfully'],
    'أرشفة المركبة ': ['أرشفة المركبة ', 'Archive vehicle '],
    'تعديل مركبة': ['تعديل مركبة', 'Edit Vehicle'],
    'مركبة جديدة': ['مركبة جديدة', 'New Vehicle'],
    'رقم اللوحة *': ['رقم اللوحة *', 'Plate Number *'],
    'الاسم/الوصف': ['الاسم/الوصف', 'Name/Description'],
    'نوع الوقود': ['نوع الوقود', 'Fuel Type'],
    'انتهاء الإجازة': ['انتهاء الإجازة', 'License Expiry'],
    'انتهاء التأمين': ['انتهاء التأمين', 'Insurance Expiry'],
    'ملاحظات': ['ملاحظات', 'Notes'],
    'حفظ': ['حفظ', 'Save'],
    'إلغاء': ['إلغاء', 'Cancel'],
    'حالات مشبوهة': ['حالات مشبوهة', 'Suspicious Cases'],
    'إجمالي الفرق': ['إجمالي الفرق', 'Total Variance'],
    'عدد التعبئات': ['عدد التعبئات', 'Fuel Fills'],
    'الثقة المنخفضة': ['الثقة المنخفضة', 'Low Confidence'],
    'تسجيل تزويد وقود (بيانات حقيقية)': ['تسجيل تزويد وقود (بيانات حقيقية)', 'Log Fuel Refill (Real Data)'],
    'اللترات': ['اللترات', 'Liters'],
    'الكلفة ': ['الكلفة ', 'Cost '],
    'قراءة العداد': ['قراءة العداد', 'Odometer Reading'],
    'تسجيل (يُرحَّل كمصروف نقل)': ['تسجيل (يُرحَّل كمصروف نقل)', 'Log (Posted as transport expense)'],
    'مخاطر الوقود ومكافحة السرقة': ['مخاطر الوقود ومكافحة السرقة', 'Fuel Risks & Theft Prevention'],
    'سجل الوقود الكامل': ['سجل الوقود الكامل', 'Complete Fuel Logs'],
    'إجمالي الرحلات': ['إجمالي الرحلات', 'Total Trips'],
    'تسجيل رحلة (بيانات حقيقية)': ['تسجيل رحلة (بيانات حقيقية)', 'Log Trip (Real Data)'],
    'من': ['من', 'From'],
    'إلى': ['إلى', 'To'],
    'المسافة (كم)': ['المسافة (كم)', 'Distance (km)'],
    'الغرض': ['الغرض', 'Purpose'],
    'سجل الرحلات': ['سجل الرحلات', 'Trips Log'],
    'حالات حرجة': ['حالات حرجة', 'Critical Cases'],
    'عالية': ['عالية', 'High'],
    'متوسطة': ['متوسطة', 'Medium'],
    'إجمالي التحقيقات': ['إجمالي التحقيقات', 'Total Investigations'],
    'جميع حالات الشذوذ': ['جميع حالات الشذوذ', 'All Anomaly Cases'],
    'خطورة': ['خطورة', 'Severity'],
    'التفاصيل': ['التفاصيل', 'Details'],
    'الإجراء الموصى به': ['الإجراء الموصى به', 'Recommended Action'],
    'فتح تحقيق': ['فتح تحقيق', 'Open Investigation'],
    'آلية عمل التحقيقات': ['آلية عمل التحقيقات', 'Investigation Workflow'],
    'إعدادات الربط التجريبي': ['إعدادات الربط التجريبي', 'Demo Connection Settings'],
    'التحقيقات المفتوحة': ['التحقيقات المفتوحة', 'Open Investigations'],
    'حالة': ['حالة', 'Cases'],
    'محددات السرعة حسب المنطقة': ['محددات السرعة حسب المنطقة', 'Speed Limits by Zone'],
    'مركبات خفيفة': ['مركبات خفيفة', 'Light/Service'],
    'معدات ثقيلة': ['معدات ثقيلة', 'Heavy Equipment'],
    'قاعدة التنبيه': ['قاعدة التنبيه', 'Alert Rule'],
    'المنطقة': ['المنطقة', 'Zone'],
    'خريطة التحكم بالأسطول': ['خريطة التحكم بالأسطول', 'Fleet Command Map'],
    'تفاصيل الآلية المحددة': ['تفاصيل الآلية المحددة', 'Selected Vehicle Details'],
    'السائق / المشغل': ['السائق / المشغل', 'Driver / Operator'],
    'المشروع': ['المشروع', 'Project'],
    'المنطقة الحالية': ['المنطقة الحالية', 'Current Zone'],
    'السرعة الحالية': ['السرعة الحالية', 'Current Speed'],
    'حد السرعة': ['حد السرعة', 'Speed Limit'],
    'مستوى الوقود': ['مستوى الوقود', 'Fuel Level'],
    'استهلاك متوقع': ['استهلاك متوقع', 'Expected Consumption'],
    'حالة المحرك': ['حالة المحرك', 'Engine State'],
    'عداد الساعات': ['عداد الساعات', 'Hour Meter'],
    'آخر تحديث': ['آخر تحديث', 'Last Update'],
    'تحليل أومني': ['تحليل أومني', 'Omni Analysis'],
    'شبهة وقود': ['شبهة وقود', 'Fuel Anomaly'],
    'تجاوز سرعة': ['تجاوز سرعة', 'Speeding'],
    'فرق تعبئة': ['فرق تعبئة', 'Fill Variance'],
    'توقف طويل': ['توقف طويل', 'Long Idle'],
    'تنبيهات الوثائق': ['تنبيهات الوثائق', 'Document Alerts'],
    'د.ع': ['د.ع', 'IQD'],
    'مستخدم': ['مستخدم', 'User'],
    'سيارة': ['سيارة', 'Car'],
    'بيك أب': ['بيك أب', 'Pickup'],
    'شاحنة': ['شاحنة', 'Truck'],
    'فان': ['فان', 'Van'],
    'لودر': ['لودر', 'Loader'],
    'حفارة': ['حفارة', 'Excavator'],
    'رافعة': ['رافعة', 'Crane'],
    'جرافة': ['جرافة', 'Bulldozer'],
    'مدحلة': ['مدحلة', 'Roller'],
    'رافعة شوكية': ['رافعة شوكية', 'Forklift'],
    'مولدة': ['مولدة', 'Generator'],
    'ناقلة وقود': ['ناقلة وقود', 'Fuel Tanker'],
    'دراجة نارية': ['دراجة نارية', 'Motorcycle'],
    'أخرى': ['أخرى', 'Other']
  };

  function tx(arKey) {
    if (!arKey) return '';
    const key = String(arKey).trim();
    const match = DICT[key];
    if (match) return t(match[0], match[1]);
    return arKey;
  }

  function tObj(obj, fallback) {
    if (!obj) return fallback || '';
    if (typeof obj === 'string') return tx(obj);
    return t(obj.ar, obj.en) || fallback || '';
  }

  const TYPES = [
    ['car', tx('سيارة')],
    ['pickup', tx('بيك أب')],
    ['truck', tx('شاحنة')],
    ['van', tx('فان')],
    ['loader', tx('لودر')],
    ['excavator', tx('حفارة')],
    ['crane', tx('رافعة')],
    ['bulldozer', tx('جرافة')],
    ['roller', tx('مدحلة')],
    ['forklift', tx('رافعة شوكية')],
    ['generator', tx('مولدة')],
    ['tanker', tx('ناقلة وقود')],
    ['motorcycle', tx('دراجة نارية')],
    ['other', tx('أخرى')]
  ];
  const TYPE_LABEL = Object.fromEntries(TYPES);
  const STATUS_LABEL = {
    active: t('في الخدمة', 'In Service'),
    maintenance: t('صيانة', 'Maintenance'),
    idle: t('متوقفة', 'Idle'),
    retired: t('مؤرشفة', 'Archived')
  };
  const STATUS_CLASS = { active: 'fl-st-ok', maintenance: 'fl-st-maint', idle: 'fl-st-idle', retired: 'fl-st-idle' };

  const DEMO_NOTE = tx('بيانات تجريبية للعرض — لا يوجد ربط GPS/OBD حقيقي');

  function isDemoMode() { return (F()?.vehicles || []).length === 0; }

  function ensureData() {
    const o = O(); if (!o) return null;
    if (!o.fleet || typeof o.fleet !== 'object') o.fleet = {};
    const f = o.fleet;
    if (!Array.isArray(f.vehicles)) f.vehicles = [];
    if (!Array.isArray(f.fuelLogs)) f.fuelLogs = [];
    if (!Array.isArray(f.trips)) f.trips = [];
    return f;
  }
  function F() { return ensureData(); }
  function getVehicles(all) { let l = (F()?.vehicles || []).filter(v => all || v.is_active !== false); if (typeof window.scoped === 'function') { try { l = window.scoped(l); } catch (_) {} } return l; }

  function expiryView(iso) { if (!iso) return { has: false }; const d = daysFromToday(iso); return { has: true, days: d, expired: d < 0, soon: d >= 0 && d <= 30 }; }

  function portfolio() {
    const vs = getVehicles().filter(v => v.status !== 'retired');
    const alerts = [];
    vs.forEach(v => {
      const lic = expiryView(v.licenseExpiry); if (lic.has && (lic.soon || lic.expired)) alerts.push({ v, kind: tx('إجازة سوق'), exp: v.licenseExpiry, view: lic });
      const ins = expiryView(v.insuranceExpiry); if (ins.has && (ins.soon || ins.expired)) alerts.push({ v, kind: tx('تأمين'), exp: v.insuranceExpiry, view: ins });
    });
    alerts.sort((a, b) => a.view.days - b.view.days);
    const month = todayISO().slice(0, 7);
    const fuelMonth = (F()?.fuelLogs || []).filter(l => (l.date || '').slice(0, 7) === month).reduce((s, l) => s + money(l.cost), 0);
    const totalDistance = (F()?.trips || []).reduce((s, t) => s + money(t.distance), 0);
    return { count: vs.length, active: vs.filter(v => v.status === 'active').length, maintenance: vs.filter(v => v.status === 'maintenance').length, alerts, fuelMonth, totalDistance };
  }

  let activeTab = 'dashboard', editing = null, search = '';
  window.flOpenTab = function (t) { activeTab = t; editing = null; render(); };
  window.flSearch = function (v) { search = v; renderVehicles(); };
  window.flOpenForm = function (id) { editing = id || 'new'; activeTab = 'vehicles'; render(); };
  window.flCancelForm = function () { editing = null; render(); };

  function govSourceLink(pageKey, ar, en) {
    return `<button type="button" class="fl-mini-btn" data-page="${esc(pageKey)}" onclick="switchPage('${pageKey}')">${t(ar, en)}</button>`;
  }

  window.flSaveVehicle = function () {
    const f = F(); if (!f) return;
    const plate = val('flPlate');
    if (!plate) { toast(tx('رقم اللوحة مطلوب'), 'error'); return; }
    const base = { plate, name: val('flName') || plate, type: val('flType') || 'car', driver: val('flDriver'), odometer: numVal('flOdo'), fuelType: val('flFuel'), licenseExpiry: val('flLicense'), insuranceExpiry: val('flInsurance'), status: val('flStatus') || 'active', notes: val('flNotes') };
    const ex = editing && editing !== 'new' ? f.vehicles.find(v => v.id === editing) : null;
    if (ex) { Object.assign(ex, base); audit('vehicle_update', `تعديل مركبة: ${plate}`); toast(tx('تم التحديث'), 'success'); }
    else { f.vehicles.push({ id: uid('veh'), ...base, is_active: true, companyId: coId(), createdAt: new Date().toISOString() }); audit('vehicle_create', `مركبة جديدة: ${plate}`); toast(tx('تمت إضافة المركبة'), 'success'); }
    save(); editing = null; render();
  };
  window.flSetStatus = function (id, status) { const v = (F()?.vehicles || []).find(x => x.id === id); if (!v) return; v.status = status; audit('vehicle_status', `${v.plate} → ${STATUS_LABEL[status]}`); save(); render(); };
  window.flArchive = function (id) { const v = (F()?.vehicles || []).find(x => x.id === id); if (!v) return; if (!confirm(t(`أرشفة المركبة ${v.plate}؟`, `Archive vehicle ${v.plate}?`))) return; v.is_active = false; v.status = 'retired'; audit('vehicle_archive', `أرشفة ${v.plate}`); save(); render(); };

  window.flLogFuel = function () {
    const f = F(); if (!f) return;
    const vehicleId = val('flFuelVehicle'); const v = f.vehicles.find(x => x.id === vehicleId);
    if (!v) { toast(t('اختر المركبة', 'Select vehicle'), 'error'); return; }
    const liters = numVal('flFuelLiters'), cost = money(numVal('flFuelCost')), odo = numVal('flFuelOdo');
    const log = { id: uid('fuel'), vehicleId, plate: v.plate, date: val('flFuelDate') || todayISO(), liters, cost, odometer: odo, by: userName(), createdAt: new Date().toISOString(), companyId: coId() };
    f.fuelLogs.unshift(log);
    if (odo > money(v.odometer)) v.odometer = odo;
    if (cost > 0 && typeof window.addFinanceTransaction === 'function') {
      try { window.addFinanceTransaction({ type: 'expense', direction: 'out', sourceType: 'fleet_fuel', sourceId: log.id, date: log.date, amount: cost, categoryId: 'cat_transport', description: `وقود ${v.plate}`, partyName: 'محطة وقود' }); } catch (e) { console.warn('fuel expense post failed', e); }
    }
    audit('fuel_log', `تزويد وقود ${v.plate}: ${liters} لتر${cost ? ' بكلفة ' + fmt(cost) + ' ' + curSym() : ''}`);
    save(); toast(t('تم تسجيل التزويد', 'Fuel log saved'), 'success'); render();
  };
  window.flLogTrip = function () {
    const f = F(); if (!f) return;
    const vehicleId = val('flTripVehicle'); const v = f.vehicles.find(x => x.id === vehicleId);
    if (!v) { toast(t('اختر المركبة', 'Select vehicle'), 'error'); return; }
    const trip = { id: uid('trip'), vehicleId, plate: v.plate, date: val('flTripDate') || todayISO(), driver: val('flTripDriver') || v.driver, from: val('flTripFrom'), to: val('flTripTo'), distance: numVal('flTripDist'), purpose: val('flTripPurpose'), by: userName(), createdAt: new Date().toISOString(), companyId: coId() };
    f.trips.unshift(trip);
    audit('trip_log', `رحلة ${v.plate}: ${trip.from || '?'} → ${trip.to || '?'} (${trip.distance} كم)`);
    save(); toast(t('تم تسجيل الرحلة', 'Trip log saved'), 'success'); render();
  };

  const GUARD_ZONES = [
    { id: 'workshop', name: { ar: 'الورشة', en: 'Workshop Depot' }, type: 'workshop', limit: 10, heavyLimit: 8, color: 'teal', mapPos: { top: '18px', left: '18px', width: '24%' } },
    { id: 'site', name: { ar: 'موقع المشروع', en: 'Project Site' }, type: 'project_site', limit: 20, heavyLimit: 15, color: 'blue', mapPos: { top: '18px', right: '18px', width: '26%' } },
    { id: 'city', name: { ar: 'طريق المدينة', en: 'City Road' }, type: 'city_road', limit: 60, heavyLimit: 45, color: 'slate', mapPos: { top: '42%', left: '18px', width: '28%' } },
    { id: 'highway', name: { ar: 'الطريق السريع', en: 'Highway' }, type: 'highway', limit: 90, heavyLimit: 70, color: 'indigo', mapPos: { top: '40%', right: '16px', width: '28%' } },
    { id: 'fuel_station', name: { ar: 'محطة الوقود', en: 'Fuel Station' }, type: 'fuel_station', limit: 15, heavyLimit: 10, color: 'amber', mapPos: { bottom: '18px', left: '18px', width: '24%' } },
    { id: 'restricted', name: { ar: 'منطقة حساسة', en: 'Restricted Area' }, type: 'restricted', limit: 5, heavyLimit: 5, color: 'red', mapPos: { bottom: '18px', right: '18px', width: '22%' } }
  ];

  function speedZoneTable(zones) {
    const rows = zones.map(z => `<tr><td>${esc(tObj(z.name))}</td><td>${fmt(z.limit)} ${t('كم/س', 'km/h')}</td><td>${fmt(z.heavyLimit)} ${t('كم/س', 'km/h')}</td></tr>`).join('');
    return `<section class="fl-panel"><div class="fl-panel-head"><h3>${tx('محددات السرعة حسب المنطقة')}</h3></div><table class="fl-table"><thead><tr><th>${tx('المنطقة')}</th><th>${tx('مركبات خفيفة')}</th><th>${tx('معدات ثقيلة')}</th></tr></thead><tbody>${rows}</tbody></table></section>`;
  }

  function renderFleetGuard() {
    const el = document.getElementById('flGuardBody'); if (!el) return;
    const vehicles = getVehicles().filter(v => v.status !== 'retired');
    const active = vehicles.filter(v => v.status === 'active').length;
    const maint = vehicles.filter(v => v.status === 'maintenance').length;
    el.innerHTML = `
      <div class="fl-guard-note">${t('لا يوجد ربط GPS/OBD حقيقي على هذه الصفحة القديمة. الموقع اللحظي والسرعة والوقود والشذوذ متاحة فقط من صفحات تتبع الأسطول المعتمدة أدناه.', 'This legacy page has no real GPS/OBD connection. Live location, speed, fuel, and anomaly data are only available from the governed fleet telemetry pages below.')}</div>
      <div class="fl-kpi-grid">
        ${kpi(tx('إجمالي الأسطول'), vehicles.length, t(`${active} فعالة · ${maint} صيانة`, `${active} active · ${maint} maintenance`), 'fl-kpi-accent')}
        ${kpi(t('الموقع الحي والسرعة', 'Live Location & Speed'), '—', t('غير متوفر هنا', 'Not verified here'), '')}
        ${kpi(t('شبهات الوقود', 'Fuel Anomalies'), '—', t('غير متوفر هنا', 'Not verified here'), '')}
        ${kpi(t('صيانة/فحص مستحق', 'Due Maintenance'), '—', t('غير متوفر هنا', 'Not verified here'), '')}
      </div>
      ${speedZoneTable(GUARD_ZONES)}
      <div class="fl-panel"><div class="fl-panel-head"><h3>${tx('خريطة التحكم بالأسطول')}</h3></div>
        <div class="fl-empty">${t('لا تُعرض بيانات حية هنا. لعرض الموقع اللحظي والرحلات والنطاقات الجغرافية الحقيقية افتح المصادر المعتمدة:', 'No live data is shown here. Open the governed sources for real live location, trips, and geofences:')}</div>
        <div class="fl-panel-actions">
          ${govSourceLink('fleet_live_map_simulator', 'خريطة التتبع المباشر', 'Live Location Map')}
          ${govSourceLink('vehicle_trip_timeline', 'خط زمني للرحلات', 'Trip Timeline')}
          ${govSourceLink('geofence_management', 'إدارة النطاقات الجغرافية', 'Geofence Management')}
          ${govSourceLink('speed_and_driver_events', 'أحداث السرعة والسياقة', 'Speed & Driver Events')}
        </div>
      </div>
      <div class="fl-panel"><div class="fl-panel-head"><h3>${tx('التحقيقات المفتوحة')}</h3></div>
        <div class="fl-empty">${t('كشف الشذوذ (وقود/سرعة/توقف) يتطلب تتبعاً حقيقياً غير متاح من هذه الصفحة.', 'Anomaly detection (fuel/speed/idle) requires real telemetry not available on this page.')}</div>
        <div class="fl-panel-actions">
          ${govSourceLink('suspected_fuel_loss_queue', 'طابور شبهات الوقود', 'Suspected Fuel Loss Queue')}
          ${govSourceLink('speed_and_driver_events', 'أحداث السرعة والسياقة', 'Speed & Driver Events')}
        </div>
      </div>
      <div class="fl-panel"><div class="fl-panel-head"><h3>${t('تبديل الزيت والفحوصات', 'Oil Changes & Checks')}</h3></div>
        <div class="fl-empty">${t('جدولة الصيانة التلقائية غير متوفرة هنا.', 'Automated maintenance scheduling is not available here.')}</div>
        <div class="fl-panel-actions">${govSourceLink('maintenance_triggers', 'محفزات الصيانة', 'Maintenance Triggers')}</div>
      </div>`;
  }

  function renderDashboard() {
    const el = document.getElementById('flDashBody'); if (!el) return;
    const p = portfolio();
    const demoBadge = isDemoMode() ? `<div class="fl-guard-note" style="margin-bottom:14px">${DEMO_NOTE}</div>` : '';
    el.innerHTML = `${demoBadge}
      <div class="fl-kpi-grid">
        ${kpi(tx('المركبات'), p.count, t(`${p.active} في الخدمة · ${p.maintenance} صيانة`, `${p.active} in service · ${p.maintenance} maint`), 'fl-kpi-accent')}
        ${kpi(tx('تنبيهات الوثائق'), p.alerts.length, t('إجازة/تأمين قريب أو منتهٍ', 'License/Insurance near expiry'), p.alerts.length ? 'fl-kpi-warn' : '')}
        ${kpi(tx('وقود هذا الشهر'), fmt(p.fuelMonth) + ' ' + curSym(), '', '')}
        ${kpi(tx('إجمالي المسافات'), fmt(p.totalDistance) + ' ' + t('كم', 'km'), t('كل الرحلات', 'Total all trips'), '')}
      </div>
      <div class="fl-panel"><div class="fl-panel-head"><h3>🚨 ${tx('وثائق تحتاج تجديداً')}</h3></div>
        <table class="fl-table"><thead><tr><th>${t('المركبة', 'Vehicle')}</th><th>${tx('الوثيقة')}</th><th>${tx('الحالة')}</th><th>${tx('التاريخ')}</th></tr></thead>
        <tbody>${p.alerts.map(a => `<tr class="${a.view.expired ? 'fl-row-danger' : 'fl-row-warn'}"><td><strong>${esc(a.v.plate)}</strong> · ${esc(tObj(a.v.name) || '')}</td><td>${a.kind}</td><td>${a.view.expired ? t(`منتهية منذ ${Math.abs(a.view.days)} يوم`, `Expired ${Math.abs(a.view.days)} days ago`) : t(`خلال ${a.view.days} يوم`, `Due in ${a.view.days} days`)}</td><td class="fl-muted">${esc(a.exp)}</td></tr>`).join('') || `<tr><td colspan="4" class="fl-empty">${t('كل الوثائق سارية ✅', 'All documents active ✅')}</td></tr>`}</tbody></table>
      </div>`;
  }

  function renderVehicles() {
    const el = document.getElementById('flVehBody'); if (!el) return;
    if (editing) { el.innerHTML = renderForm(); return; }
    let list = getVehicles();
    if (search) { const q = search.toLowerCase(); list = list.filter(v => `${v.plate} ${tObj(v.name)} ${tObj(v.driver)}`.toLowerCase().includes(q)); }
    const demoBadge = isDemoMode() ? `<div class="fl-guard-note" style="margin-bottom:8px">${DEMO_NOTE}</div>` : '';
    el.innerHTML = `${demoBadge}
      <div class="fl-toolbar">
        <button class="btn-primary" onclick="flOpenForm('new')">➕ ${t('مركبة', 'Vehicle')}</button>
        <input class="fl-input" placeholder="${t('بحث...', 'Search...')}" value="${esc(search)}" oninput="flSearch(this.value)" style="max-width:200px">
      </div>
      <table class="fl-table"><thead><tr><th>${tx('اللوحة')}</th><th>${tx('النوع')}</th><th>${tx('السائق')}</th><th>${tx('العداد')}</th><th>${tx('الإجازة')}</th><th>${tx('التأمين')}</th><th>${tx('الحالة')}</th><th>${tx('إجراءات')}</th></tr></thead>
      <tbody>${list.map(v => {
        const lic = expiryView(v.licenseExpiry), ins = expiryView(v.insuranceExpiry);
        const badge = (e, iso) => !e.has ? '<span class="fl-muted">—</span>' : `<span class="${e.expired ? 'fl-exp-bad' : e.soon ? 'fl-exp-warn' : 'fl-exp-ok'}">${esc(iso)}</span>`;
        return `<tr><td><strong>${esc(v.plate)}</strong><br><span class="fl-muted">${esc(tObj(v.name) || '')}</span></td>
          <td>${TYPE_LABEL[v.type] || v.type}</td><td>${esc(tObj(v.driver) || '—')}</td><td>${fmt(v.odometer)} ${t('كم', 'km')}</td>
          <td>${badge(lic, v.licenseExpiry)}</td><td>${badge(ins, v.insuranceExpiry)}</td>
          <td><span class="fl-badge ${STATUS_CLASS[v.status] || ''}">${STATUS_LABEL[v.status] || v.status}</span></td>
          <td class="fl-actions"><button class="fl-mini-btn" onclick="flOpenForm('${v.id}')">${tx('تعديل')}</button><button class="fl-mini-btn" onclick="flSetStatus('${v.id}','${v.status === 'maintenance' ? 'active' : 'maintenance'}')">${v.status === 'maintenance' ? t('إنهاء صيانة', 'End Maint') : tx('صيانة')}</button><button class="fl-mini-btn fl-danger" onclick="flArchive('${v.id}')">${tx('أرشفة')}</button></td></tr>`;
      }).join('') || `<tr><td colspan="8" class="fl-empty">${t('لا توجد مركبات', 'No vehicles registered')}</td></tr>`}</tbody></table>`;
  }

  function renderForm() {
    const v = editing !== 'new' ? (F()?.vehicles || []).find(x => x.id === editing) : null; const d = v || {};
    const tOpt = TYPES.map(([k, l]) => `<option value="${k}" ${d.type === k ? 'selected' : ''}>${l}</option>`).join('');
    const sOpt = Object.entries(STATUS_LABEL).filter(([k]) => k !== 'retired').map(([k, l]) => `<option value="${k}" ${d.status === k ? 'selected' : ''}>${l}</option>`).join('');
    return `<div class="fl-panel"><div class="fl-panel-head"><h3>${v ? tx('تعديل مركبة') : tx('مركبة جديدة')}</h3></div>
      <div class="fl-form-grid">
        <div><label>${tx('رقم اللوحة *')}</label><input id="flPlate" class="fl-input" value="${esc(d.plate || '')}"></div>
        <div><label>${tx('الاسم/الوصف')}</label><input id="flName" class="fl-input" value="${esc(tObj(d.name) || '')}"></div>
        <div><label>${tx('النوع')}</label><select id="flType" class="fl-input">${tOpt}</select></div>
        <div><label>${tx('السائق')}</label><input id="flDriver" class="fl-input" value="${esc(tObj(d.driver) || '')}"></div>
        <div><label>${t('العداد (كم)', 'Odometer (km)')}</label><input id="flOdo" type="number" class="fl-input" value="${money(d.odometer) || ''}"></div>
        <div><label>${tx('نوع الوقود')}</label><input id="flFuel" class="fl-input" value="${esc(tObj(d.fuelType) || '')}"></div>
        <div><label>${tx('انتهاء الإجازة')}</label><input id="flLicense" type="date" class="fl-input" value="${esc(d.licenseExpiry || '')}"></div>
        <div><label>${tx('انتهاء التأمين')}</label><input id="flInsurance" type="date" class="fl-input" value="${esc(d.insuranceExpiry || '')}"></div>
        <div><label>${tx('الحالة')}</label><select id="flStatus" class="fl-input">${sOpt}</select></div>
        <div class="fl-form-full"><label>${tx('ملاحظات')}</label><input id="flNotes" class="fl-input" value="${esc(tObj(d.notes) || '')}"></div>
      </div>
      <div class="fl-form-actions"><button class="btn-primary" onclick="flSaveVehicle()">${tx('حفظ')}</button><button class="fl-mini-btn" onclick="flCancelForm()">${tx('إلغاء')}</button></div></div>`;
  }

  function renderFuelRisk() {
    const el = document.getElementById('flFuelBody'); if (!el) return;
    const f = F();
    const vehOpts = ['<option value="">— ' + t('اختر المركبة', 'Select Vehicle') + ' —</option>'].concat(getVehicles().map(v => `<option value="${v.id}">${esc(v.plate)} (${esc(tObj(v.name) || '')})</option>`)).join('');
    const logs = f.fuelLogs || [];
    const fuel = logs.slice(0, 20);
    const totalLiters = logs.reduce((s, l) => s + money(l.liters), 0);
    const totalCost = logs.reduce((s, l) => s + money(l.cost), 0);
    el.innerHTML = `
      <div class="fl-kpi-grid">
        ${kpi(tx('عدد التعبئات'), logs.length, t('كل السجلات الحقيقية', 'All real refuel logs'), '')}
        ${kpi(t('إجمالي اللترات', 'Total Liters'), fmt(totalLiters) + ' ' + t('لتر', 'L'), '', '')}
        ${kpi(t('إجمالي الكلفة', 'Total Cost'), fmt(totalCost) + ' ' + curSym(), '', '')}
      </div>
      <div class="fl-panel"><div class="fl-panel-head"><h3>⛽ ${tx('تسجيل تزويد وقود (بيانات حقيقية)')}</h3></div>
        <div class="fl-form-grid">
          <div><label>${t('المركبة', 'Vehicle')}</label><select id="flFuelVehicle" class="fl-input">${vehOpts}</select></div>
          <div><label>${tx('التاريخ')}</label><input id="flFuelDate" type="date" class="fl-input" value="${todayISO()}"></div>
          <div><label>${t('اللترات', 'Liters')}</label><input id="flFuelLiters" type="number" class="fl-input"></div>
          <div><label>${t('الكلفة', 'Cost')} (${curSym()})</label><input id="flFuelCost" type="number" class="fl-input"></div>
          <div><label>${tx('قراءة العداد')}</label><input id="flFuelOdo" type="number" class="fl-input"></div>
        </div>
        <div class="fl-form-actions"><button class="btn-primary" onclick="flLogFuel()">${tx('تسجيل (يُرحَّل كمصروف نقل)')}</button></div>
      </div>
      <div class="fl-panel"><div class="fl-panel-head"><h3>${tx('مخاطر الوقود ومكافحة السرقة')}</h3></div>
        <div class="fl-empty">${t('كشف السرقة يتطلب مقارنة كمية المضخة بقراءة حساس خزان حقيقية. هذه الصفحة لا تملك ربطاً حقيقياً بالحساسات.', 'Theft detection requires comparing pump flow with a real tank-sensor reading. This page has no real sensor connection.')}</div>
        <div class="fl-panel-actions">
          ${govSourceLink('suspected_fuel_loss_queue', 'طابور شبهات الوقود', 'Suspected Fuel Loss Queue')}
          ${govSourceLink('fuel_telemetry', 'قياسات الوقود', 'Fuel Telemetry')}
        </div>
      </div>
      <div class="fl-panel"><div class="fl-panel-head"><h3>${tx('سجل الوقود الكامل')}</h3></div>
        <table class="fl-table"><thead><tr><th>${tx('التاريخ')}</th><th>${t('المركبة', 'Vehicle')}</th><th>${t('لترات', 'Liters')}</th><th>${t('الكلفة', 'Cost')}</th><th>${tx('قراءة العداد')}</th></tr></thead>
        <tbody>${fuel.map(l => `<tr><td class="fl-muted">${esc(l.date)}</td><td>${esc(l.plate)}</td><td>${fmt(l.liters)}</td><td>${l.cost ? fmt(l.cost) + ' ' + curSym() : '—'}</td><td>${fmt(l.odometer)}</td></tr>`).join('') || `<tr><td colspan="5" class="fl-empty">${t('لا يوجد سجل وقود حقيقي — استخدم نموذج التسجيل أعلاه', 'No real logs saved. Log new fuel refill above.')}</td></tr>`}</tbody></table>
      </div>`;
  }

  function renderTrips() {
    const el = document.getElementById('flTripBody'); if (!el) return;
    const f = F();
    const vehOpts = ['<option value="">— ' + t('اختر المركبة', 'Select Vehicle') + ' —</option>'].concat(getVehicles().map(v => `<option value="${v.id}">${esc(v.plate)} (${esc(tObj(v.name) || '')})</option>`)).join('');
    const trips = (f.trips || []).slice(0, 20);
    el.innerHTML = `
      <div class="fl-kpi-grid">
        ${kpi(tx('إجمالي الرحلات'), trips.length, '', '')}
        ${kpi(tx('إجمالي المسافات'), trips.reduce((s,t2) => s + money(t2.distance), 0).toLocaleString() + ' ' + t('كم', 'km'), '', '')}
      </div>
      <div class="fl-panel"><div class="fl-panel-head"><h3>🛣️ ${tx('تسجيل رحلة (بيانات حقيقية)')}</h3></div>
        <div class="fl-form-grid">
          <div><label>${t('المركبة', 'Vehicle')}</label><select id="flTripVehicle" class="fl-input">${vehOpts}</select></div>
          <div><label>${tx('التاريخ')}</label><input id="flTripDate" type="date" class="fl-input" value="${todayISO()}"></div>
          <div><label>${tx('السائق')}</label><input id="flTripDriver" class="fl-input"></div>
          <div><label>${tx('من')}</label><input id="flTripFrom" class="fl-input"></div>
          <div><label>${tx('إلى')}</label><input id="flTripTo" class="fl-input"></div>
          <div><label>${tx('المسافة (كم)')}</label><input id="flTripDist" type="number" class="fl-input"></div>
          <div class="fl-form-full"><label>${tx('الغرض')}</label><input id="flTripPurpose" class="fl-input"></div>
        </div>
        <div class="fl-form-actions"><button class="btn-primary" onclick="flLogTrip()">${t('تسجيل الرحلة', 'Save Trip Log')}</button></div>
      </div>
      <div class="fl-panel"><div class="fl-panel-head"><h3>${t('مناطق السرعة', 'Speed Limit Geofences')}</h3></div>
        <table class="fl-table"><thead><tr><th>${tx('المنطقة')}</th><th>${t('الحد للخفيف', 'Light Limit')}</th><th>${t('الحد للثقيل', 'Heavy Limit')}</th></tr></thead>
        <tbody>${GUARD_ZONES.map(z => `<tr><td>${esc(tObj(z.name))}</td><td>${fmt(z.limit)} ${t('كم/س', 'km/h')}</td><td>${fmt(z.heavyLimit)} ${t('كم/س', 'km/h')}</td></tr>`).join('')}</tbody></table>
      </div>
      <div class="fl-panel"><div class="fl-panel-head"><h3>${tx('سجل الرحلات')}</h3></div>
        <table class="fl-table"><thead><tr><th>${tx('التاريخ')}</th><th>${t('المركبة', 'Vehicle')}</th><th>${t('المسار', 'Route')}</th><th>${t('المسافة', 'Distance')}</th><th>${tx('الغرض')}</th></tr></thead>
        <tbody>${trips.map(t2 => `<tr><td class="fl-muted">${esc(t2.date)}</td><td>${esc(t2.plate)}</td><td>${esc(t2.from || '?')} → ${esc(t2.to || '?')}</td><td>${fmt(t2.distance)} ${t('كم', 'km')}</td><td>${esc(t2.purpose || '')}</td></tr>`).join('') || `<tr><td colspan="5" class="fl-empty">${t('لا يوجد سجل رحلات حقيقي — استخدم نموذج التسجيل أعلاه', 'No real trip logs recorded. Log new trip above.')}</td></tr>`}</tbody></table>
      </div>`;
  }

  function renderInvest() {
    const el = document.getElementById('flInvestBody'); if (!el) return;
    el.innerHTML = `
      <div class="fl-guard-note">${t('كشف الشذوذ (سرعة/وقود/توقف/خروج نطاق) يعتمد على تتبع حي غير متوفر في هذه الصفحة القديمة.', 'Anomaly detection (speed/fuel/idle/geofence) depends on live telemetry not available on this legacy page.')}</div>
      <div class="fl-panel"><div class="fl-panel-head"><h3>${tx('جميع حالات الشذوذ')}</h3></div>
        <div class="fl-empty">${t('افتح المصادر المعتمدة لعرض الحالات الحقيقية:', 'Open the governed sources to view real cases:')}</div>
        <div class="fl-panel-actions">
          ${govSourceLink('suspected_fuel_loss_queue', 'طابور شبهات الوقود', 'Suspected Fuel Loss Queue')}
          ${govSourceLink('speed_and_driver_events', 'أحداث السرعة والسياقة', 'Speed & Driver Events')}
          ${govSourceLink('geofence_events', 'أحداث النطاقات الجغرافية', 'Geofence Events')}
          ${govSourceLink('maintenance_triggers', 'محفزات الصيانة', 'Maintenance Triggers')}
        </div>
      </div>
      <div class="fl-panel"><div class="fl-panel-head"><h3>${t('تنبيهات الوثائق الحقيقية', 'Real Document Alerts')}</h3></div>
        <div class="fl-empty">${t('تنبيهات انتهاء الإجازة والتأمين حقيقية دائماً — راجع لوحة السيطرة.', 'License and insurance expiry alerts are always real — see the Dashboard tab.')}</div>
        <div class="fl-panel-actions"><button type="button" class="fl-mini-btn" onclick="flOpenTab('dashboard')">${t('لوحة السيطرة', 'Dashboard')}</button></div>
      </div>`;
  }

  function renderSettings() {
    const el = document.getElementById('flSettingsBody'); if (!el) return;
    el.innerHTML = `
      <div class="fl-panel"><div class="fl-panel-head"><h3>${tx('إعدادات الربط التجريبي')}</h3></div>
        <div style="padding:12px;font-size:14px;line-height:2">
          <p><strong>${DEMO_NOTE}</strong></p>
          <p>${t('هذا القسم يوضح خيارات الربط المتاحة في الإصدار الكامل. الوضع التجريبي الحالي يستخدم بيانات مدمجة في الذاكرة.', 'This panel demonstrates API connectors available in the complete production environment. Demo mode utilizes in-memory seed data.')}</p>
          <div style="margin:16px 0;display:grid;gap:12px">
            <div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px;background:#f8fafc"><strong>${t('خيارات الربط المتوقعة:', 'Available API Integration Protocols:')}</strong><br>
            • ${t('أجهزة تتبع نظام تحديد المواقع (GPS/GSM Tracker)', 'GPS/GSM Tracker — Concox, Queclink, Teltonika protocols')}<br>
            • ${t('قارئ بيانات المركبة (CAN/J1939)', 'CAN/J1939 — OBD-II / J1939 CAN bus telemetry')}<br>
            • ${t('حساسات خزان وقود — مقاومات/مكثفات / ضغط', 'Digital Fuel Sensors — resistive/capacitive/pressure telemetry')}<br>
            • ${t('قارئات RFID للوقود — لكل مركبة ومضخة', 'RFID Fuel Rings — authorize pumps per vehicle registration')}<br>
            • ${t('تكامل مع كاميرات الموقع — للتحقق البصري', 'CCTV Site Integration — visual verification matches fuel logs')}</div>
          </div>
        </div>
      </div>`;
  }

  function kpi(label, value, sub, cls) { return `<div class="fl-kpi ${cls || ''}"><div class="fl-kpi-val">${value}</div><div class="fl-kpi-label">${label}</div>${sub ? `<div class="fl-kpi-sub">${sub}</div>` : ''}</div>`; }

  function renderTabContent() {
    const sections = ['flDashBody', 'flVehBody', 'flGuardBody', 'flFuelBody', 'flTripBody', 'flInvestBody', 'flSettingsBody'];
    sections.forEach(id => { const e = document.getElementById(id); if (e) e.style.display = 'none'; });
    const visible = document.getElementById(activeTab === 'dashboard' ? 'flDashBody' : activeTab === 'vehicles' ? 'flVehBody' : activeTab === 'guard' ? 'flGuardBody' : activeTab === 'fuel_risk' ? 'flFuelBody' : activeTab === 'trips' ? 'flTripBody' : activeTab === 'invest' ? 'flInvestBody' : 'flSettingsBody');
    if (visible) visible.style.display = '';
    if (activeTab === 'dashboard') renderDashboard();
    else if (activeTab === 'vehicles') renderVehicles();
    else if (activeTab === 'guard') renderFleetGuard();
    else if (activeTab === 'fuel_risk') renderFuelRisk();
    else if (activeTab === 'trips') renderTrips();
    else if (activeTab === 'invest') renderInvest();
    else renderSettings();
  }

  function render() {
    const body = document.getElementById('fleetBody'); if (!body) return;
    ensureData();
    const tabs = [
      ['dashboard', t('📊 لوحة السيطرة', '📊 Dashboard')],
      ['guard', t('🗺️ خريطة المتابعة', '🗺️ Command Map')],
      ['vehicles', t('🚚 المركبات والمعدات', '🚚 Vehicles & Eq')],
      ['fuel_risk', t('⛽ الوقود والمخاطر', '⛽ Fuel & Risks')],
      ['trips', t('🛣️ الرحلات والمناطق', '🛣️ Trips & Zones')],
      ['invest', t('🔍 التقارير والتحقيقات', '🔍 Reports')],
      ['settings', t('⚙️ إعدادات الربط', '⚙️ API Settings')]
    ];
    body.innerHTML = `<div class="fl-tabs">${tabs.map(([k, l]) => `<button class="fl-tab-btn ${activeTab === k ? 'active' : ''}" onclick="flOpenTab('${k}')">${l}</button>`).join('')}</div>
      <div id="flDashBody"></div><div id="flVehBody"></div><div id="flGuardBody"></div><div id="flFuelBody"></div><div id="flTripBody"></div><div id="flInvestBody"></div><div id="flSettingsBody"></div>`;
    renderTabContent();
  }
  window.renderFleet = render;

  const _origSwitch = window.switchPage;
  window.switchPage = function (page) {
    if (_origSwitch) _origSwitch(page);
    if (page === 'fleet') {
      try {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('page-active'));
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        const pg = document.getElementById('pageFleet'); if (pg) pg.classList.add('page-active');
        const nav = document.getElementById('navFleet'); if (nav) nav.classList.add('active');
        if (typeof window.ensureNavGroupForPage === 'function') window.ensureNavGroupForPage('fleet');
      } catch (_) {}
      ensureData(); setTimeout(render, 0);
    }
  };

  function registerJarvis() {
    try {
      if (window.JarvisBrain && JarvisBrain.tools) {
        JarvisBrain.tools['report_fleet_today'] = function () {
          const p = portfolio();
          return { vehicles: p.count, active: p.active, maintenance: p.maintenance, fuelCostThisMonth: p.fuelMonth, totalDistanceKm: p.totalDistance, documentAlerts: p.alerts.map(a => ({ plate: a.v.plate, doc: a.kind, expiry: a.exp, expired: a.view.expired })) };
        };
        if (JarvisBrain.PAGES) JarvisBrain.PAGES['fleet'] = '#pageFleet';
      }
    } catch (_) {}
  }

  // Listen for language changes and re-render
  window.addEventListener('octagon:language-applied', function () {
    if (window.currentPage === 'fleet') {
      render();
    }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', registerJarvis); else setTimeout(registerJarvis, 600);
  window.OctagonFleet = { render, ensureData, portfolio, isDemoMode };
})();
