/**
 * OCTAGON ERP — Fleet Management (غرفة تحكم الأسطول).
 *
 * Phase 8B repair: demo-ready fleet command center with SVG map, fuel risk layer,
 * speed/geofence logic, investigation management, and read-only Jarvis panel.
 * All demo data is in-memory only, clearly labeled as بيانات تجريبية للعرض.
 *
 * 7 sections within a single page (no new routes):
 *   dashboard   — لوحة السيطرة (KPI + alerts)
 *   guard       — خريطة المتابعة (command map)
 *   vehicles    — المركبات والمعدات (register + form)
 *   fuel_risk   — الوقود والمخاطر (fuel logs + anti-theft)
 *   trips       — الرحلات والمناطق (trip logs + zone policies)
 *   invest      — التقارير والتحقيقات
 *   settings    — إعدادات الربط التجريبي
 *
 * Data namespace: omni.fleet = { vehicles:[], fuelLogs:[], trips:[] }
 * Page: #pageFleet (nav data-page="fleet"). Add-only.
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
  function curSym() { const o = O(); return (o && o.adminSettings && o.adminSettings.organization && o.adminSettings.organization.currencySymbol) || 'د.ع'; }
  function val(id) { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; }
  function numVal(id) { const v = Number(val(id)); return isFinite(v) ? v : 0; }
  function coId() { try { return (typeof window.getActiveOrgProfile === 'function' ? window.getActiveOrgProfile()?.companyId : '') || ''; } catch (_) { return ''; } }
  function userName() { try { if (window.PentagonAuth && PentagonAuth.currentUser) return PentagonAuth.currentUser.name; } catch (_) {} return 'مستخدم'; }
  function audit(action, detail) {
    try { if (typeof window.recordOmniHistoryEvent === 'function') window.recordOmniHistoryEvent('fleet', action, detail); } catch (_) {}
    try { if (window.AuditService && typeof AuditService.createEvent === 'function') AuditService.createEvent({ module: 'fleet', action, detail, user: userName() }); } catch (_) {}
  }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function daysFromToday(iso) { return iso ? Math.round((new Date(iso) - new Date(todayISO())) / 86400000) : null; }
  function dateShift(days) { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }

  const TYPES = [['car', 'سيارة'], ['pickup', 'بيك أب'], ['truck', 'شاحنة'], ['van', 'فان'], ['loader', 'لودر'], ['excavator', 'حفارة'], ['crane', 'رافعة'], ['bulldozer', 'جرافة'], ['roller', 'مدحلة'], ['forklift', 'رافعة شوكية'], ['generator', 'مولدة'], ['tanker', 'ناقلة وقود'], ['motorcycle', 'دراجة'], ['other', 'أخرى']];
  const TYPE_LABEL = Object.fromEntries(TYPES);
  const STATUS_LABEL = { active: 'في الخدمة', maintenance: 'صيانة', idle: 'متوقفة', retired: 'مؤرشفة' };
  const STATUS_CLASS = { active: 'fl-st-ok', maintenance: 'fl-st-maint', idle: 'fl-st-idle', retired: 'fl-st-idle' };

  const DEMO_NOTE = 'بيانات تجريبية للعرض — لا يوجد ربط GPS/OBD حقيقي';

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
      const lic = expiryView(v.licenseExpiry); if (lic.has && (lic.soon || lic.expired)) alerts.push({ v, kind: 'إجازة سوق', exp: v.licenseExpiry, view: lic });
      const ins = expiryView(v.insuranceExpiry); if (ins.has && (ins.soon || ins.expired)) alerts.push({ v, kind: 'تأمين', exp: v.insuranceExpiry, view: ins });
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

  let guardFilter = 'all';
  let guardProject = '';
  let guardDriver = '';
  let guardType = '';
  let guardSelectedVehicle = null;

  window.flSetGuardFilter = function (filter) { guardFilter = filter; renderFleetGuard(); };
  window.flSetGuardProject = function (value) { guardProject = value; renderFleetGuard(); };
  window.flSetGuardDriver = function (value) { guardDriver = value; renderFleetGuard(); };
  window.flSetGuardType = function (value) { guardType = value; renderFleetGuard(); };
  window.flSelectGuardVehicle = function (id) { guardSelectedVehicle = id; renderFleetGuard(); };
  window.flGuardAction = function (label) { toast(label + ' (عرض تجريبي)', 'info'); };

  function filterGuardVehicles(vehicles) {
    return vehicles.filter(v => {
      if (guardFilter !== 'all' && v.markerStatus !== guardFilter) return false;
      if (guardProject && v.project !== guardProject) return false;
      if (guardDriver && v.driver !== guardDriver) return false;
      if (guardType && v.type !== guardType) return false;
      return true;
    });
  }

  function uniqueOptions(list, key) {
    return Array.from(new Set(list.map(item => item[key]).filter(Boolean))).sort();
  }

  window.flSaveVehicle = function () {
    const f = F(); if (!f) return;
    const plate = val('flPlate');
    if (!plate) { toast('رقم اللوحة مطلوب', 'error'); return; }
    const base = { plate, name: val('flName') || plate, type: val('flType') || 'car', driver: val('flDriver'), odometer: numVal('flOdo'), fuelType: val('flFuel'), licenseExpiry: val('flLicense'), insuranceExpiry: val('flInsurance'), status: val('flStatus') || 'active', notes: val('flNotes') };
    const ex = editing && editing !== 'new' ? f.vehicles.find(v => v.id === editing) : null;
    if (ex) { Object.assign(ex, base); audit('vehicle_update', `تعديل مركبة: ${plate}`); toast('تم التحديث', 'success'); }
    else { f.vehicles.push({ id: uid('veh'), ...base, is_active: true, companyId: coId(), createdAt: new Date().toISOString() }); audit('vehicle_create', `مركبة جديدة: ${plate}`); toast('تمت إضافة المركبة', 'success'); }
    save(); editing = null; render();
  };
  window.flSetStatus = function (id, status) { const v = (F()?.vehicles || []).find(x => x.id === id); if (!v) return; v.status = status; audit('vehicle_status', `${v.plate} → ${STATUS_LABEL[status]}`); save(); render(); };
  window.flArchive = function (id) { const v = (F()?.vehicles || []).find(x => x.id === id); if (!v) return; if (!confirm(`أرشفة المركبة ${v.plate}؟`)) return; v.is_active = false; v.status = 'retired'; audit('vehicle_archive', `أرشفة ${v.plate}`); save(); render(); };

  window.flLogFuel = function () {
    const f = F(); if (!f) return;
    const vehicleId = val('flFuelVehicle'); const v = f.vehicles.find(x => x.id === vehicleId);
    if (!v) { toast('اختر المركبة', 'error'); return; }
    const liters = numVal('flFuelLiters'), cost = money(numVal('flFuelCost')), odo = numVal('flFuelOdo');
    const log = { id: uid('fuel'), vehicleId, plate: v.plate, date: val('flFuelDate') || todayISO(), liters, cost, odometer: odo, by: userName(), createdAt: new Date().toISOString(), companyId: coId() };
    f.fuelLogs.unshift(log);
    if (odo > money(v.odometer)) v.odometer = odo;
    if (cost > 0 && typeof window.addFinanceTransaction === 'function') {
      try { window.addFinanceTransaction({ type: 'expense', direction: 'out', sourceType: 'fleet_fuel', sourceId: log.id, date: log.date, amount: cost, categoryId: 'cat_transport', description: `وقود ${v.plate}`, partyName: 'محطة وقود' }); } catch (e) { console.warn('fuel expense post failed', e); }
    }
    audit('fuel_log', `تزويد وقود ${v.plate}: ${liters} لتر${cost ? ' بكلفة ' + fmt(cost) + ' ' + curSym() : ''}`);
    save(); toast('تم تسجيل التزويد', 'success'); render();
  };
  window.flLogTrip = function () {
    const f = F(); if (!f) return;
    const vehicleId = val('flTripVehicle'); const v = f.vehicles.find(x => x.id === vehicleId);
    if (!v) { toast('اختر المركبة', 'error'); return; }
    const trip = { id: uid('trip'), vehicleId, plate: v.plate, date: val('flTripDate') || todayISO(), driver: val('flTripDriver') || v.driver, from: val('flTripFrom'), to: val('flTripTo'), distance: numVal('flTripDist'), purpose: val('flTripPurpose'), by: userName(), createdAt: new Date().toISOString(), companyId: coId() };
    f.trips.unshift(trip);
    audit('trip_log', `رحلة ${v.plate}: ${trip.from || '?'} → ${trip.to || '?'} (${trip.distance} كم)`);
    save(); toast('تم تسجيل الرحلة', 'success'); render();
  };

  window.flLoadDemo = function () {
    toast(DEMO_NOTE, 'info');
  };

  const DEMO_VEHICLES = [
    { id: 'demo-dt1', plate: 'B-1045', name: 'شاحنة ديزل كبيرة', type: 'truck', driver: 'سعد', odometer: 84200, fuelType: 'ديزل', licenseExpiry: dateShift(12), insuranceExpiry: dateShift(75), status: 'active', notes: 'مشروع الكرادة — الموقع A', project: 'مشروع الكرادة', site: 'الموقع A', tankCapacity: 220 },
    { id: 'demo-dl2', plate: 'EQ-77', name: 'لودر موقع', type: 'loader', driver: 'حيدر', odometer: 12800, fuelType: 'ديزل', licenseExpiry: dateShift(90), insuranceExpiry: dateShift(180), status: 'active', notes: 'مشروع بسماية — الموقع B', project: 'مشروع بسماية', site: 'الموقع B', tankCapacity: 310 },
    { id: 'demo-dg3', plate: 'GEN-19', name: 'مولدة ديزل احتياط', type: 'generator', driver: 'فريق الكهرباء', odometer: 0, fuelType: 'ديزل', licenseExpiry: '', insuranceExpiry: '', status: 'idle', notes: 'المخزن المركزي — تستخدم ساعات تشغيل', project: 'المخزن المركزي', tankCapacity: 500 },
    { id: 'demo-dp4', plate: 'P-5521', name: 'بيك أب متابعة إدارة', type: 'pickup', driver: 'كرار', odometer: 51240, fuelType: 'بنزين', licenseExpiry: dateShift(-5), insuranceExpiry: dateShift(120), status: 'active', notes: 'إجازة السوق منتهية', project: 'الإدارة', site: 'المدينة', tankCapacity: 75 },
    { id: 'demo-de5', plate: 'EX-05', name: 'حفارة كوماتسو', type: 'excavator', driver: 'ناجي', odometer: 26900, fuelType: 'ديزل', licenseExpiry: dateShift(-30), insuranceExpiry: dateShift(-60), status: 'active', notes: 'وثائق منتهية — قيد التجديد', project: 'مشروع الكرادة', site: 'الموقع A', tankCapacity: 380 },
    { id: 'demo-dc6', plate: 'CR-06', name: 'رافعة برجية ليبهير', type: 'crane', driver: 'فارس', odometer: 15800, fuelType: 'ديزل', licenseExpiry: dateShift(45), insuranceExpiry: dateShift(150), status: 'maintenance', notes: 'صيانة دورية — فشل فحص هيدروليك', project: 'مشروع بسماية', tankCapacity: 260 },
    { id: 'demo-ds7', plate: 'SV-07', name: 'سوزوكي سويفت خدمات', type: 'car', driver: 'ريان', odometer: 32540, fuelType: 'بنزين', licenseExpiry: dateShift(200), insuranceExpiry: dateShift(90), status: 'active', notes: 'مركبة خدمات خفيفة', project: 'الإدارة', site: 'المدينة', tankCapacity: 60 },
    { id: 'demo-dt8', plate: 'TK-08', name: 'ناقلة وقود', type: 'tanker', driver: 'ماجد', odometer: 94000, fuelType: 'ديزل', licenseExpiry: dateShift(20), insuranceExpiry: dateShift(-15), status: 'active', notes: 'تأمين منتهي — تجديد عاجل', project: 'المخزن المركزي', tankCapacity: 420 },
    { id: 'demo-dt9', plate: 'T-1150', name: 'شاحنة قلاب', type: 'truck', driver: 'عماد', odometer: 67000, fuelType: 'ديزل', licenseExpiry: dateShift(60), insuranceExpiry: dateShift(250), status: 'active', notes: 'نقل تربة من الموقع B', project: 'مشروع بسماية', site: 'الموقع B', tankCapacity: 200 },
    { id: 'demo-dr10', plate: 'RL-03', name: 'مدحلة بوماج', type: 'roller', driver: 'صباح', odometer: 4200, fuelType: 'ديزل', licenseExpiry: dateShift(300), insuranceExpiry: dateShift(365), status: 'active', notes: 'أعمال رصف وتسوية', project: 'مشروع الكرادة', site: 'الموقع A', tankCapacity: 160 },
    { id: 'demo-dv11', plate: 'VN-22', name: 'فان صيانة', type: 'van', driver: 'ياسر', odometer: 43000, fuelType: 'بنزين', licenseExpiry: dateShift(80), insuranceExpiry: dateShift(40), status: 'maintenance', notes: 'تعطل مكيف — قيد الإصلاح', project: 'الإدارة', tankCapacity: 70 },
    { id: 'demo-db12', plate: 'BD-09', name: 'جرافة كاتربيلر', type: 'bulldozer', driver: 'هادي', odometer: 19800, fuelType: 'ديزل', licenseExpiry: dateShift(15), insuranceExpiry: dateShift(-10), status: 'maintenance', notes: 'صيانة السلاسل', project: 'المخزن المركزي', tankCapacity: 340 }
  ];

  const GUARD_ZONES = [
    { id: 'workshop', name: 'الورشة', type: 'workshop', limit: 10, heavyLimit: 8, color: 'teal', mapPos: { top: '18px', left: '18px', width: '24%' } },
    { id: 'site', name: 'موقع المشروع', type: 'project_site', limit: 20, heavyLimit: 15, color: 'blue', mapPos: { top: '18px', right: '18px', width: '26%' } },
    { id: 'city', name: 'طريق المدينة', type: 'city_road', limit: 60, heavyLimit: 45, color: 'slate', mapPos: { top: '42%', left: '18px', width: '28%' } },
    { id: 'highway', name: 'الطريق السريع', type: 'highway', limit: 90, heavyLimit: 70, color: 'indigo', mapPos: { top: '40%', right: '16px', width: '28%' } },
    { id: 'fuel_station', name: 'محطة الوقود', type: 'fuel_station', limit: 15, heavyLimit: 10, color: 'amber', mapPos: { bottom: '18px', left: '18px', width: '24%' } },
    { id: 'restricted', name: 'منطقة حساسة', type: 'restricted', limit: 5, heavyLimit: 5, color: 'red', mapPos: { bottom: '18px', right: '18px', width: '22%' } }
  ];

  function isHeavyVehicle(v) { return ['truck', 'forklift', 'loader', 'crane', 'excavator', 'heavy', 'generator', 'bulldozer', 'roller', 'tanker'].includes(String(v.type || '').toLowerCase()); }
  function zoneLimit(v, z) { return isHeavyVehicle(v) ? z.heavyLimit : z.limit; }

  const DEMO_POSITIONS = [{x:12,y:18},{x:24,y:12},{x:38,y:26},{x:56,y:16},{x:70,y:40},{x:22,y:54},{x:48,y:60},{x:68,y:64},{x:15,y:44},{x:55,y:52},{x:30,y:72},{x:72,y:30}];
  const DEMO_SPEEDS = [8, 27, 0, 72, 96, 14, 35, 82, 51, 12, 5, 68];
  const DEMO_LABELS = ['قبل 4 دقائق', 'قبل 11 دقيقة', 'قبل 28 دقيقة', 'قبل 7 دقائق', 'قبل 16 دقيقة', 'قبل 9 دقائق', 'قبل 5 دقائق', 'قبل 3 دقائق', 'قبل 22 دقيقة', 'قبل 14 دقيقة', 'قبل 35 دقيقة', 'قبل 6 دقائق'];
  const DEMO_FUEL_PCT = [72, 64, 82, 43, 56, 31, 78, 48, 61, 90, 55, 38];

  function sourceVehicles() {
    const actual = getVehicles().filter(v => v.status !== 'retired');
    const vehicles = actual.length ? actual : DEMO_VEHICLES;
    return vehicles.map((v, idx) => {
      const z = GUARD_ZONES[idx % GUARD_ZONES.length];
      const limit = zoneLimit(v, z);
      const speedSeed = DEMO_SPEEDS[idx % DEMO_SPEEDS.length];
      const speed = Number(v.currentSpeed != null ? v.currentSpeed : speedSeed);
      const tank = Math.max(40, Number(v.tankCapacity || (isHeavyVehicle(v) ? 240 : 75)));
      const fuelPercent = Number(v.fuelPercent != null ? v.fuelPercent : DEMO_FUEL_PCT[idx % DEMO_FUEL_PCT.length]);
      const fuelLiters = Math.round(tank * fuelPercent / 100);
      const isMaintenance = v.status === 'maintenance';
      const isIdle = v.status === 'idle';
      const markerStatus = isMaintenance ? 'offline' : isIdle ? 'idle' : speed > limit ? 'speeding' : (idx % 10 === 1 || idx % 10 === 5) ? 'fuel_anomaly' : 'normal';
      return {
        ...v,
        project: v.project || ['مشروع الكرادة', 'مشروع بسماية', 'الإدارة', 'المخزن المركزي'][idx % 4],
        site: v.site || ['الموقع A', 'الموقع B', 'المدينة', 'Depot'][idx % 4],
        zone: z,
        currentSpeed: speed,
        speedLimit: limit,
        tankCapacity: tank,
        fuelPercent,
        fuelLiters,
        hourMeter: Number(v.hourMeter || (isHeavyVehicle(v) ? 1800 + idx * 920 : 0)),
        engineState: isIdle ? 'idle' : isMaintenance ? 'off' : 'on',
        markerStatus,
        lastUpdate: DEMO_LABELS[idx % DEMO_LABELS.length],
        mapX: DEMO_POSITIONS[idx % DEMO_POSITIONS.length]?.x || 52,
        mapY: DEMO_POSITIONS[idx % DEMO_POSITIONS.length]?.y || 48
      };
    });
  }

  function guardStatusLabel(s) {
    return ({ normal: 'طبيعي', speeding: 'سرعة عالية', fuel_anomaly: 'شبهة وقود', offline: 'غير متصل', idle: 'توقف طويل', outside_zone: 'خارج النطاق' })[s] || s;
  }
  function guardStatusClass(s) {
    return ({ normal: 'ok', speeding: 'warn', fuel_anomaly: 'bad', offline: 'muted', idle: 'idle', outside_zone: 'bad' })[s] || 'muted';
  }

  function guardFuelRows(vehicles) {
    const f = F() || {};
    const logs = Array.isArray(f.fuelLogs) && f.fuelLogs.length ? f.fuelLogs.slice(0, 8) : vehicles.slice(0, 6).map((v, idx) => ({
      id: 'demo-fuel-' + idx, vehicleId: v.id, plate: v.plate, date: dateShift(-idx * 2 - 1),
      liters: [100, 85, 160, 45, 220, 65][idx % 6], cost: [150000, 127000, 240000, 69000, 330000, 98000][idx % 6],
      odometer: Number(v.odometer || 0), by: 'عرض تجريبي'
    }));
    return logs.map((l, idx) => {
      const v = vehicles.find(x => x.id === l.vehicleId || x.plate === l.plate) || vehicles[idx % vehicles.length] || {};
      const tank = Number(v.tankCapacity || 120);
      const dispensed = Number(l.liters || 0);
      const variance = [0, -18, 0, -7, 0, -11][idx % 6];
      const measured = Math.max(0, dispensed + variance);
      const before = Math.max(0, Math.round(Number(v.fuelLiters || tank * 0.35) - measured));
      const after = Math.min(tank, before + measured);
      return { ...l, vehicle: v, tank, before, after, dispensed, measured, variance, method: idx % 2 ? 'يدوي + وصل مضخة' : 'حساس خزان تجريبي', confidence: Math.abs(variance) > 10 ? 'منخفضة' : 'عالية', station: idx % 2 ? 'محطة خارجية' : 'Depot' };
    });
  }

  function guardTripRows(vehicles) {
    const f = F() || {};
    const rows = Array.isArray(f.trips) && f.trips.length ? f.trips.slice(0, 8) : vehicles.slice(0, 6).map((v, idx) => ({
      id: 'demo-trip-' + idx, vehicleId: v.id, plate: v.plate, date: dateShift(-idx * 2), driver: v.driver,
      from: ['Depot', 'الورشة', 'الموقع A', 'المدينة', 'محطة الوقود', 'المخزن'][idx % 6],
      to: ['الموقع A', 'محطة الوقود', 'الموقع B', 'Depot', 'المخزن', 'الموقع A'][idx % 6],
      distance: [42, 18, 64, 27, 120, 35][idx % 6],
      purpose: ['تسليم مواد', 'تعبئة وقود', 'نقل معدات', 'زيارة إشراف', 'توريد', 'صيانة'][idx % 6]
    }));
    return rows.map((t, idx) => {
      const v = vehicles.find(x => x.id === t.vehicleId || x.plate === t.plate) || vehicles[idx % vehicles.length] || {};
      const startOdo = Math.max(0, Number(t.odometerStart || v.odometer || 0) - Number(t.distance || 0));
      const endOdo = Number(t.odometerEnd || v.odometer || startOdo + Number(t.distance || 0));
      const maxSpeed = idx === 2 ? 96 : Math.max(22, Number(v.currentSpeed || 0) + 8);
      return { ...t, vehicle: v, planned: Number(t.distance || 0), actual: Number(t.distance || 0) + (idx === 2 ? 11 : 0), startOdo, endOdo, fuelStart: Math.min(100, Number(v.fuelPercent || 50) + 8), fuelEnd: Math.max(0, Number(v.fuelPercent || 50) - 9), idleMinutes: [12, 4, 38, 8, 2, 15][idx % 6], maxSpeed, avgSpeed: Math.max(10, Math.round(maxSpeed * 0.62)), zones: [v.zone?.name || 'غير محدد', idx === 1 ? 'محطة الوقود' : 'طريق المدينة'] };
    });
  }

  function guardServiceRows(vehicles) {
    return vehicles.map((v, idx) => {
      const km = Number(v.odometer || 0);
      const hours = Number(v.hourMeter || 0);
      const oilDueKm = isHeavyVehicle(v) ? km + (idx === 1 ? 350 : 1200) : km + (idx === 3 ? 800 : 5000);
      const oilDueHours = hours ? hours + (idx === 1 ? 22 : 120) : 0;
      const inspectionState = idx === 1 ? 'فشل فحص هيدروليك' : idx === 2 ? 'مطلوب فحص تشغيل' : idx === 5 ? 'فشل فحص محرك' : idx === 10 ? 'مطلوب فحص سلاسل' : 'ناجح';
      return { vehicle: v, lastOil: dateShift(-45 - idx * 11), nextOilDate: dateShift(idx === 1 ? 5 : 28 + idx * 8), oilDueKm, oilDueHours, inspectionState, service: idx === 1 || idx === 10 ? 'عاجل' : idx === 2 || idx === 5 ? 'قريب' : 'ضمن الجدول', filters: idx % 2 ? 'زيت + هيدروليك' : 'زيت + هواء' };
    });
  }

  function guardAnomalyRows(vehicles, fuels, trips) {
    const rows = [];
    vehicles.forEach(v => {
      if (v.currentSpeed > v.speedLimit) rows.push({ severity: 'high', vehicle: v, type: 'تجاوز سرعة', detail: `${v.currentSpeed} / ${v.speedLimit} كم/س داخل ${v.zone.name}`, action: 'تثبيت مخالفة سرعة ومراجعة السائق' });
      if (v.markerStatus === 'fuel_anomaly') rows.push({ severity: 'critical', vehicle: v, type: 'شبهة وقود', detail: 'هبوط وقود بعد خروج من الموقع أو قراءة منخفضة الثقة', action: 'فتح تحقيق قبل أي تصحيح' });
    });
    fuels.filter(f => Math.abs(f.variance) >= 7).forEach(f => rows.push({ severity: Math.abs(f.variance) > 12 ? 'critical' : 'medium', vehicle: f.vehicle, type: 'فرق تعبئة', detail: `المضخة ${fmt(f.dispensed)} لتر، الزيادة المقاسة ${fmt(f.measured)} لتر`, action: 'مطابقة وصل التعبئة وقراءة الخزان' }));
    trips.filter(t => t.idleMinutes > 30).forEach(t => rows.push({ severity: 'medium', vehicle: t.vehicle, type: 'توقف طويل', detail: `${t.idleMinutes} دقيقة توقف خلال رحلة ${t.from || '?'} - ${t.to || '?'}`, action: 'مراجعة سبب التوقف واستهلاك الوقود' }));
    return rows.slice(0, 8);
  }

  function buildGuardSnapshot() {
    const vehicles = sourceVehicles();
    const fuels = guardFuelRows(vehicles);
    const trips = guardTripRows(vehicles);
    const service = guardServiceRows(vehicles);
    const anomalies = guardAnomalyRows(vehicles, fuels, trips);
    const speedViolations = vehicles.filter(v => v.currentSpeed > v.speedLimit).length;
    const suspiciousLiters = fuels.reduce((s, f) => s + (f.variance < 0 ? Math.abs(f.variance) : 0), 0);
    return { vehicles, fuels, trips, service, anomalies, speedViolations, suspiciousLiters, zones: GUARD_ZONES };
  }

  function guardSpeedPolicyTable(g) {
    const rows = g.zones.map(z => `<tr><td>${esc(z.name)}</td><td>${fmt(z.limit)} كم/س</td><td>${fmt(z.heavyLimit)} كم/س</td><td>تنبيه بعد 60 ثانية · AI يشرح فقط</td></tr>`).join('');
    const violations = g.vehicles.filter(v => v.currentSpeed > v.speedLimit);
    return `<section class="fl-panel"><div class="fl-panel-head"><h3>محددات السرعة حسب المنطقة</h3><span class="fl-muted">${violations.length} مخالفة حالية</span></div><table class="fl-table"><thead><tr><th>المنطقة</th><th>مركبات خفيفة</th><th>معدات ثقيلة</th><th>قاعدة التنبيه</th></tr></thead><tbody>${rows}</tbody></table>${violations.length ? '<div style="margin-top:10px;font-size:13px;color:#b45309;font-weight:600">⚠️ المركبات المخالفة حالياً: ' + violations.map(v => esc(v.plate) + ' (' + fmt(v.currentSpeed) + '/' + fmt(v.speedLimit) + ' كم/س)').join(' · ') + '</div>' : ''}</section>`;
  }

  function guardMapHtml(vehicles, g) {
    const zonesHtml = g.zones.map(z => `<div class="fl-map-zone fl-map-zone-${z.id}" style="position:absolute;${Object.entries(z.mapPos).map(([k,v]) => k+':'+v).join(';')}"><strong>${esc(z.name)}</strong><span>${fmt(z.limit)} كم/س</span></div>`).join('');
    const pinsHtml = vehicles.map(v => `<button class="fl-map-pin fl-${guardStatusClass(v.markerStatus)}${guardSelectedVehicle === v.id ? ' fl-selected-marker' : ''}" style="left:${v.mapX}%;top:${v.mapY}%" onclick="flSelectGuardVehicle('${v.id}')" title="${esc(v.plate)} - ${esc(v.driver)}"><span>${esc(v.plate)}</span><b>${guardStatusLabel(v.markerStatus)}</b></button>`).join('');
    const markersHtml = vehicles.map(v => {
      const selected = guardSelectedVehicle === v.id ? ' fl-selected-marker' : '';
      return `<article class="fl-map-marker fl-${guardStatusClass(v.markerStatus)}${selected}" onclick="flSelectGuardVehicle('${v.id}')"><div class="fl-marker-head"><strong>${esc(v.plate || v.name)}</strong><span>${guardStatusLabel(v.markerStatus)}</span></div><div class="fl-marker-meta">${esc(v.name || '')} · ${esc(v.driver || 'بدون سائق')}</div><div class="fl-marker-grid"><span>المنطقة</span><b>${esc(v.zone.name)}</b><span>السرعة</span><b>${fmt(v.currentSpeed)} / ${fmt(v.speedLimit)} كم/س</b><span>الوقود</span><b>${fmt(v.fuelLiters)} لتر (${fmt(v.fuelPercent)}%)</b><span>آخر تحديث</span><b>${esc(v.lastUpdate)}</b></div></article>`;
    }).join('');
    return `<section class="fl-panel fl-guard-map-panel"><div class="fl-panel-head"><h3>خريطة التحكم بالأسطول</h3></div><div class="fl-zone-strip">${g.zones.map(z => `<div class="fl-zone-card fl-zone-${z.color}"><b>${esc(z.name)}</b><span>${fmt(z.limit)} كم/س · ثقيل ${fmt(z.heavyLimit)}</span></div>`).join('')}</div><div class="fl-map-grid"><div class="fl-map-canvas">${zonesHtml}${pinsHtml}</div><div class="fl-map-pin-list">${markersHtml}</div></div></section>`;
  }

  function guardSelectedVehicleHtml(g, vehicles) {
    const selected = g.vehicles.find(v => v.id === guardSelectedVehicle) || vehicles[0] || null;
    if (!selected) return '<section class="fl-panel"><div class="fl-empty">اختر مركبة من الخريطة</div></section>';
    const isViolating = selected.currentSpeed > selected.speedLimit;
    const consumeRate = Math.max(3, Math.round(selected.currentSpeed * 0.28));
    return `<section class="fl-panel fl-selected-panel"><div class="fl-panel-head"><h3>تفاصيل الآلية المحددة</h3><span class="fl-badge ${selected.markerStatus === 'fuel_anomaly' ? 'fl-st-maint' : isViolating ? 'fl-st-maint' : 'fl-st-ok'}">${guardStatusLabel(selected.markerStatus)}</span></div>
      <div class="fl-detail-grid"><div><strong>${esc(selected.name || selected.plate)}</strong><span>${esc(selected.plate)}</span></div>
      <div><span>السائق / المشغل</span><b>${esc(selected.driver || 'غير محدد')}</b></div>
      <div><span>المشروع</span><b>${esc(selected.project || '-')}</b></div>
      <div><span>المنطقة الحالية</span><b>${esc(selected.zone.name)} — ${esc(selected.site || '')}</b></div>
      <div><span>السرعة الحالية</span><b style="${isViolating ? 'color:#dc2626' : ''}">${fmt(selected.currentSpeed)} كم/س ${isViolating ? '⚠️' : ''}</b></div>
      <div><span>حد السرعة</span><b>${fmt(selected.speedLimit)} كم/س</b></div>
      <div><span>مستوى الوقود</span><b>${fmt(selected.fuelPercent)}% (${fmt(selected.fuelLiters)} لتر / سعة ${fmt(selected.tankCapacity)} لتر)</b></div>
      <div><span>استهلاك متوقع</span><b>${fmt(consumeRate)} لتر/ساعة</b></div>
      <div><span>حالة المحرك</span><b>${selected.engineState === 'on' ? 'دوران' : selected.engineState === 'idle' ? 'خمول' : 'متوقف'}</b></div>
      <div><span>عداد الساعات</span><b>${selected.hourMeter ? fmt(selected.hourMeter) + ' ساعة' : '—'}</b></div>
      <div><span>آخر تحديث</span><b>${esc(selected.lastUpdate)}</b></div></div>
      <div class="fl-panel-actions"><button class="btn-primary" onclick="flGuardAction('فتح ملف الآلية')">فتح ملف الآلية</button><button class="fl-mini-btn" onclick="flGuardAction('عرض سجل الوقود')">عرض سجل الوقود</button><button class="fl-mini-btn" onclick="flGuardAction('فتح تحقيق')">فتح تحقيق</button><button class="fl-mini-btn" onclick="flGuardAction('إنشاء تقرير')">إنشاء تقرير</button></div></section>`;
  }

  function guardJarvisHtml(g) {
    const anomalyCount = g.anomalies.length;
    const top = g.anomalies[0];
    if (!top) return `<section class="fl-panel fl-ai-panel"><div class="fl-panel-head"><h3>تحليل جارفيس</h3></div><p style="color:#15803d">✅ الأسطول يعمل بشكل طبيعي. لا توجد شذوذات أو مخالفات حالية.</p></section>`;
    const jarvisMsg = top.type === 'شبهة وقود'
      ? `هذه الآلية (${esc(top.vehicle?.plate || '')}) سجلت نقص وقود غير مفسر مع قراءة منخفضة الثقة. يوصى بفتح تحقيق ومراجعة سجل التعبئة والسائق.`
      : top.type === 'تجاوز سرعة'
        ? `الآلية (${esc(top.vehicle?.plate || '')}) تجاوزت حد السرعة في ${esc(top.vehicle?.zone?.name || '')} بسرعة ${fmt(top.vehicle?.currentSpeed || 0)} كم/س. العدد الإجمالي للمخالفات: ${g.speedViolations}.`
        : `تم رصد ${anomalyCount} شذوذ في الأسطول. التفاصيل في جدول الشذوذ أدناه.`;
    return `<section class="fl-panel fl-ai-panel"><div class="fl-panel-head"><h3>تحليل جارفيس</h3><span class="fl-badge fl-st-maint">${anomalyCount} شذوذ</span></div><p>${jarvisMsg} (نظام قراءة فقط — لا يمكن اتخاذ إجراءات مباشرة من هذه اللوحة)</p></section>`;
  }

  function guardInvestigationPanel(g) {
    const openCases = g.anomalies.filter(a => a.severity === 'critical' || a.severity === 'high');
    return `<section class="fl-panel"><div class="fl-panel-head"><h3>التحقيقات المفتوحة</h3><span class="fl-badge fl-st-maint">${openCases.length} حالة</span></div>
      ${openCases.length ? `<table class="fl-table"><thead><tr><th>المركبة</th><th>النوع</th><th>التفاصيل</th><th>الحالة</th><th>الإجراء الموصى به</th></tr></thead><tbody>${openCases.map(a => `<tr class="${a.severity === 'critical' ? 'fl-row-danger' : 'fl-row-warn'}"><td>${esc(a.vehicle?.plate || '')}</td><td>${esc(a.type)}</td><td>${esc(a.detail)}</td><td><span class="fl-sev fl-sev-${a.severity}">${a.severity === 'critical' ? 'حرج' : 'عالي'}</span></td><td><button class="fl-mini-btn" onclick="flGuardAction('فتح تحقيق: ${esc(a.type)}')">فتح تحقيق</button></td></tr>`).join('')}</tbody></table>` : '<p class="fl-muted" style="padding:12px">لا توجد تحقيقات مفتوحة حالياً</p>'}
      <div style="margin-top:10px;padding:10px;background:#f8fafc;border-radius:8px;font-size:13px"><strong>ملاحظة:</strong> زر "فتح تحقيق" يعرض تجريبي حالياً. في الإصدار الكامل سينشئ ملف تحقيق مستقل مع timeline وأدلة وصور.</div></section>`;
  }

  function renderFleetGuard() {
    const el = document.getElementById('flGuardBody'); if (!el) return;
    const g = buildGuardSnapshot();
    const vehicles = filterGuardVehicles(g.vehicles);
    const active = vehicles.filter(v => v.status === 'active').length;
    const offline = vehicles.filter(v => v.markerStatus === 'offline').length;
    const serviceDue = g.service.filter(s => s.service !== 'ضمن الجدول').length;
    const fuelCost = g.fuels.reduce((s, f) => s + money(f.cost), 0);
    const zoneOptions = uniqueOptions(g.vehicles, 'project').map(p => `<option value="${esc(p)}" ${guardProject === p ? 'selected' : ''}>${esc(p)}</option>`).join('');
    const driverOptions = uniqueOptions(g.vehicles, 'driver').map(d => `<option value="${esc(d)}" ${guardDriver === d ? 'selected' : ''}>${esc(d)}</option>`).join('');
    const typeOptions = uniqueOptions(g.vehicles, 'type').map(t => `<option value="${esc(t)}" ${guardType === t ? 'selected' : ''}>${esc(TYPE_LABEL[t] || t)}</option>`).join('');
    const anomalyRows = g.anomalies.map(a => `<tr class="${a.severity === 'critical' ? 'fl-row-danger' : a.severity === 'high' ? 'fl-row-warn' : ''}"><td><span class="fl-sev fl-sev-${a.severity}">${a.severity === 'critical' ? 'حرج' : a.severity === 'high' ? 'عالي' : 'متوسط'}</span></td><td>${esc(a.vehicle?.plate || '')}</td><td>${esc(a.type)}</td><td>${esc(a.detail)}</td><td>${esc(a.action)}</td></tr>`).join('');
    const fuelRows = g.fuels.map(f => `<tr class="${Math.abs(f.variance) >= 10 ? 'fl-row-danger' : Math.abs(f.variance) ? 'fl-row-warn' : ''}"><td>${esc(f.date)}</td><td>${esc(f.vehicle?.plate || f.plate || '')}</td><td>${esc(f.station)}</td><td>${fmt(f.before)} → ${fmt(f.after)} لتر</td><td>${fmt(f.dispensed)}</td><td>${fmt(f.measured)}</td><td>${fmt(f.variance)}</td><td>${esc(f.confidence)}</td></tr>`).join('');
    const tripRows = g.trips.map(t => `<tr><td>${esc(t.date)}</td><td>${esc(t.vehicle?.plate || t.plate || '')}</td><td>${esc(t.from || '?')} → ${esc(t.to || '?')}</td><td>${fmt(t.planned)} / ${fmt(t.actual)} كم</td><td>${fmt(t.startOdo)} → ${fmt(t.endOdo)}</td><td>${fmt(t.fuelStart)}% → ${fmt(t.fuelEnd)}%</td><td>${fmt(t.maxSpeed)} كم/س</td><td>${fmt(t.idleMinutes)} د</td></tr>`).join('');
    const serviceRows = g.service.map(s => `<tr class="${s.service === 'عاجل' ? 'fl-row-danger' : s.service === 'قريب' ? 'fl-row-warn' : ''}"><td>${esc(s.vehicle.plate || s.vehicle.name)}</td><td>${esc(s.lastOil)}</td><td>${esc(s.nextOilDate)}</td><td>${fmt(s.oilDueKm)} كم${s.oilDueHours ? ' · ' + fmt(s.oilDueHours) + ' ساعة' : ''}</td><td>${esc(s.filters)}</td><td>${esc(s.inspectionState)}</td></tr>`).join('');
    const historyRows = g.vehicles.map(v => {
      const vf = g.fuels.find(f => f.vehicle?.id === v.id || f.vehicle?.plate === v.plate);
      const vt = g.trips.find(t => t.vehicle?.id === v.id || t.vehicle?.plate === v.plate);
      const vs = g.service.find(s => s.vehicle.id === v.id);
      return `<article class="fl-history-card"><div><strong>${esc(v.plate || v.name)}</strong><span>${esc(v.name || '')}</span></div><ul><li>سائق/مشغل: ${esc(v.driver || '-')} · مشروع: ${esc(v.project || '-')}</li><li>آخر رحلة: ${vt ? esc((vt.from || '?') + ' → ' + (vt.to || '?')) : 'لا توجد'} · ${vt ? fmt(vt.actual) + ' كم' : ''}</li><li>آخر تعبئة/قياس: ${vf ? fmt(vf.dispensed) + ' لتر، فرق ' + fmt(vf.variance) : 'لا توجد'}</li><li>زيت وفحص: ${vs ? esc(vs.nextOilDate) + ' · ' + esc(vs.inspectionState) : 'غير مجدول'}</li><li>حالة الخطر: ${guardStatusLabel(v.markerStatus)}</li></ul></article>`;
    }).join('');
    el.innerHTML = `
      ${isDemoMode() ? `<div class="fl-guard-note">${DEMO_NOTE}</div>` : ''}
      <div class="fl-guard-filter-bar"><div class="fl-filter-group"><label>عرض حسب</label><div class="fl-filter-buttons">${['all','normal','fuel_anomaly','speeding','offline','outside_zone','idle'].map(f => `<button class="fl-filter-btn ${guardFilter===f?'active':''}" onclick="flSetGuardFilter('${f}')">${{all:'الكل',normal:'طبيعي',fuel_anomaly:'نقص وقود',speeding:'تجاوز سرعة',offline:'غير متصل',outside_zone:'خارج النطاق',idle:'توقف طويل'}[f]}</button>`).join('')}</div></div>
      <div class="fl-filter-group"><label>المشروع</label><select class="fl-input" onchange="flSetGuardProject(this.value)"><option value="">الكل</option>${zoneOptions}</select></div>
      <div class="fl-filter-group"><label>السائق</label><select class="fl-input" onchange="flSetGuardDriver(this.value)"><option value="">الكل</option>${driverOptions}</select></div>
      <div class="fl-filter-group"><label>نوع الآلية</label><select class="fl-input" onchange="flSetGuardType(this.value)"><option value="">الكل</option>${typeOptions}</select></div></div>
      <div class="fl-kpi-grid">
        ${kpi('إجمالي الأسطول', g.vehicles.length, `${active} فعالة · ${offline} غير متصلة`, 'fl-kpi-accent')}
        ${kpi('تنبيهات الوقود', g.anomalies.filter(a => a.type.includes('وقود') || a.type.includes('فرق')).length, `${fmt(g.suspiciousLiters)} لتر مشتبه`, g.anomalies.length ? 'fl-kpi-warn' : '')}
        ${kpi('مخالفات السرعة', g.speedViolations, 'حسب المنطقة ونوع المركبة', g.speedViolations ? 'fl-kpi-warn' : '')}
        ${kpi('صيانة/فحص قريب', serviceDue, 'زيت · فلاتر · فحص تشغيل', serviceDue ? 'fl-kpi-warn' : '')}
        ${kpi('كلفة تعبئة العرض', fmt(fuelCost) + ' ' + curSym(), 'من سجل التعبئة والقياس', '')}
      </div>
      <div class="fl-guard-grid">
        ${guardMapHtml(vehicles, g)}
        ${guardSpeedPolicyTable(g)}
      </div>
      <div class="fl-guard-grid">
        <div>${guardSelectedVehicleHtml(g, vehicles)}${guardJarvisHtml(g)}</div>
        ${guardInvestigationPanel(g)}
      </div>
      <div class="fl-panel"><div class="fl-panel-head"><h3>مركز الشذوذ والتحقيق</h3></div><table class="fl-table"><thead><tr><th>خطورة</th><th>المركبة</th><th>النوع</th><th>التفاصيل</th><th>الإجراء</th></tr></thead><tbody>${anomalyRows || '<tr><td colspan="5" class="fl-empty">لا توجد شذوذات في العرض الحالي</td></tr>'}</tbody></table></div>
      <div class="fl-panel"><div class="fl-panel-head"><h3>تعبئة وقياس الوقود</h3></div><table class="fl-table"><thead><tr><th>التاريخ</th><th>المركبة</th><th>المصدر</th><th>الخزان قبل/بعد</th><th>مصروف</th><th>مقاس</th><th>فرق</th><th>ثقة</th></tr></thead><tbody>${fuelRows}</tbody></table></div>
      <div class="fl-panel"><div class="fl-panel-head"><h3>تاريخ الرحلات</h3></div><table class="fl-table"><thead><tr><th>التاريخ</th><th>المركبة</th><th>المسار</th><th>مخطط/فعلي</th><th>العداد</th><th>الوقود</th><th>أقصى سرعة</th><th>توقف</th></tr></thead><tbody>${tripRows}</tbody></table></div>
      <div class="fl-panel"><div class="fl-panel-head"><h3>تبديل الزيت والفحوصات</h3></div><table class="fl-table"><thead><tr><th>المركبة</th><th>آخر زيت</th><th>القادم</th><th>العداد/الساعات</th><th>الفلاتر</th><th>نتيجة الفحص</th></tr></thead><tbody>${serviceRows}</tbody></table></div>
      <div class="fl-panel"><div class="fl-panel-head"><h3>ملف تاريخ كامل لكل مركبة/معدة</h3></div><div class="fl-history-grid">${historyRows}</div></div>`;
  }

  function renderDashboard() {
    const el = document.getElementById('flDashBody'); if (!el) return;
    const p = portfolio();
    const demoBadge = isDemoMode() ? `<div class="fl-guard-note" style="margin-bottom:14px">${DEMO_NOTE}</div>` : '';
    el.innerHTML = `${demoBadge}
      <div class="fl-kpi-grid">
        ${kpi('المركبات', p.count, `${p.active} في الخدمة · ${p.maintenance} صيانة`, 'fl-kpi-accent')}
        ${kpi('تنبيهات الوثائق', p.alerts.length, 'إجازة/تأمين قريب أو منتهٍ', p.alerts.length ? 'fl-kpi-warn' : '')}
        ${kpi('وقود هذا الشهر', fmt(p.fuelMonth) + ' ' + curSym(), '', '')}
        ${kpi('إجمالي المسافات', fmt(p.totalDistance) + ' كم', 'كل الرحلات', '')}
      </div>
      <div class="fl-panel"><div class="fl-panel-head"><h3>🚨 وثائق تحتاج تجديداً</h3></div>
        <table class="fl-table"><thead><tr><th>المركبة</th><th>الوثيقة</th><th>الحالة</th><th>التاريخ</th></tr></thead>
        <tbody>${p.alerts.map(a => `<tr class="${a.view.expired ? 'fl-row-danger' : 'fl-row-warn'}"><td><strong>${esc(a.v.plate)}</strong> · ${esc(a.v.name || '')}</td><td>${a.kind}</td><td>${a.view.expired ? `منتهية منذ ${Math.abs(a.view.days)} يوم` : `خلال ${a.view.days} يوم`}</td><td class="fl-muted">${esc(a.exp)}</td></tr>`).join('') || '<tr><td colspan="4" class="fl-empty">كل الوثائق سارية ✅</td></tr>'}</tbody></table>
      </div>`;
  }

  function renderVehicles() {
    const el = document.getElementById('flVehBody'); if (!el) return;
    if (editing) { el.innerHTML = renderForm(); return; }
    let list = getVehicles();
    if (search) { const q = search.toLowerCase(); list = list.filter(v => `${v.plate} ${v.name} ${v.driver}`.toLowerCase().includes(q)); }
    const demoBadge = isDemoMode() ? `<div class="fl-guard-note" style="margin-bottom:8px">${DEMO_NOTE}</div>` : '';
    el.innerHTML = `${demoBadge}
      <div class="fl-toolbar">
        <button class="btn-primary" onclick="flOpenForm('new')">➕ مركبة</button>
        <button class="fl-mini-btn" onclick="flLoadDemo()">بيانات تجريبية</button>
        <input class="fl-input" placeholder="بحث..." value="${esc(search)}" oninput="flSearch(this.value)" style="max-width:200px">
      </div>
      <table class="fl-table"><thead><tr><th>اللوحة</th><th>النوع</th><th>السائق</th><th>العداد</th><th>الإجازة</th><th>التأمين</th><th>الحالة</th><th>إجراءات</th></tr></thead>
      <tbody>${list.map(v => {
        const lic = expiryView(v.licenseExpiry), ins = expiryView(v.insuranceExpiry);
        const badge = (e, iso) => !e.has ? '<span class="fl-muted">—</span>' : `<span class="${e.expired ? 'fl-exp-bad' : e.soon ? 'fl-exp-warn' : 'fl-exp-ok'}">${esc(iso)}</span>`;
        return `<tr><td><strong>${esc(v.plate)}</strong><br><span class="fl-muted">${esc(v.name || '')}</span></td>
          <td>${TYPE_LABEL[v.type] || v.type}</td><td>${esc(v.driver || '—')}</td><td>${fmt(v.odometer)} كم</td>
          <td>${badge(lic, v.licenseExpiry)}</td><td>${badge(ins, v.insuranceExpiry)}</td>
          <td><span class="fl-badge ${STATUS_CLASS[v.status] || ''}">${STATUS_LABEL[v.status] || v.status}</span></td>
          <td class="fl-actions"><button class="fl-mini-btn" onclick="flOpenForm('${v.id}')">تعديل</button><button class="fl-mini-btn" onclick="flSetStatus('${v.id}','${v.status === 'maintenance' ? 'active' : 'maintenance'}')">${v.status === 'maintenance' ? 'إنهاء صيانة' : 'صيانة'}</button><button class="fl-mini-btn fl-danger" onclick="flArchive('${v.id}')">أرشفة</button></td></tr>`;
      }).join('') || '<tr><td colspan="8" class="fl-empty">لا توجد مركبات</td></tr>'}</tbody></table>`;
  }

  function renderForm() {
    const v = editing !== 'new' ? (F()?.vehicles || []).find(x => x.id === editing) : null; const d = v || {};
    const tOpt = TYPES.map(([k, l]) => `<option value="${k}" ${d.type === k ? 'selected' : ''}>${l}</option>`).join('');
    const sOpt = Object.entries(STATUS_LABEL).filter(([k]) => k !== 'retired').map(([k, l]) => `<option value="${k}" ${d.status === k ? 'selected' : ''}>${l}</option>`).join('');
    return `<div class="fl-panel"><div class="fl-panel-head"><h3>${v ? 'تعديل مركبة' : 'مركبة جديدة'}</h3></div>
      <div class="fl-form-grid">
        <div><label>رقم اللوحة *</label><input id="flPlate" class="fl-input" value="${esc(d.plate || '')}"></div>
        <div><label>الاسم/الوصف</label><input id="flName" class="fl-input" value="${esc(d.name || '')}"></div>
        <div><label>النوع</label><select id="flType" class="fl-input">${tOpt}</select></div>
        <div><label>السائق</label><input id="flDriver" class="fl-input" value="${esc(d.driver || '')}"></div>
        <div><label>العداد (كم)</label><input id="flOdo" type="number" class="fl-input" value="${money(d.odometer) || ''}"></div>
        <div><label>نوع الوقود</label><input id="flFuel" class="fl-input" value="${esc(d.fuelType || '')}"></div>
        <div><label>انتهاء الإجازة</label><input id="flLicense" type="date" class="fl-input" value="${esc(d.licenseExpiry || '')}"></div>
        <div><label>انتهاء التأمين</label><input id="flInsurance" type="date" class="fl-input" value="${esc(d.insuranceExpiry || '')}"></div>
        <div><label>الحالة</label><select id="flStatus" class="fl-input">${sOpt}</select></div>
        <div class="fl-form-full"><label>ملاحظات</label><input id="flNotes" class="fl-input" value="${esc(d.notes || '')}"></div>
      </div>
      <div class="fl-form-actions"><button class="btn-primary" onclick="flSaveVehicle()">حفظ</button><button class="fl-mini-btn" onclick="flCancelForm()">إلغاء</button></div></div>`;
  }

  function renderFuelRisk() {
    const el = document.getElementById('flFuelBody'); if (!el) return;
    const g = buildGuardSnapshot();
    const f = F();
    const vehOpts = ['<option value="">— اختر المركبة —</option>'].concat(getVehicles().map(v => `<option value="${v.id}">${esc(v.plate)} (${esc(v.name || '')})</option>`)).join('');
    const fuel = (f.fuelLogs || []).slice(0, 20);
    const demoBadge = isDemoMode() ? `<div class="fl-guard-note" style="margin-bottom:8px">${DEMO_NOTE}</div>` : '';
    const riskRows = g.fuels.filter(f2 => Math.abs(f2.variance) >= 5).map(f2 => `<tr class="${Math.abs(f2.variance) >= 10 ? 'fl-row-danger' : 'fl-row-warn'}"><td>${esc(f2.date)}</td><td>${esc(f2.vehicle?.plate || f2.plate || '')}</td><td>${esc(f2.station)}</td><td>${fmt(f2.tank)} لتر</td><td>${fmt(f2.before)} → ${fmt(f2.after)}</td><td>${fmt(f2.dispensed)}</td><td>${fmt(f2.measured)}</td><td style="font-weight:800;color:${f2.variance < -7 ? '#dc2626' : '#b45309'}">${fmt(f2.variance)}</td><td>${esc(f2.confidence)}</td></tr>`).join('');
    el.innerHTML = `${demoBadge}
      <div class="fl-kpi-grid">
        ${kpi('حالات مشبوهة', riskRows.length || 0, 'فرق تعبئة > 5 لتر', riskRows.length ? 'fl-kpi-warn' : '')}
        ${kpi('إجمالي الفرق', fmt(g.suspiciousLiters) + ' لتر', 'وقود غير موثق', g.suspiciousLiters ? 'fl-kpi-warn' : '')}
        ${kpi('عدد التعبئات', g.fuels.length, 'آخر 8 عمليات', '')}
        ${kpi('الثقة المنخفضة', g.fuels.filter(f2 => f2.confidence === 'منخفضة').length, 'قراءات غير موثوقة', '')}
      </div>
      <div class="fl-panel"><div class="fl-panel-head"><h3>⛽ تسجيل تزويد وقود (بيانات حقيقية)</h3></div>
        <div class="fl-form-grid">
          <div><label>المركبة</label><select id="flFuelVehicle" class="fl-input">${vehOpts}</select></div>
          <div><label>التاريخ</label><input id="flFuelDate" type="date" class="fl-input" value="${todayISO()}"></div>
          <div><label>اللترات</label><input id="flFuelLiters" type="number" class="fl-input"></div>
          <div><label>الكلفة (${curSym()})</label><input id="flFuelCost" type="number" class="fl-input"></div>
          <div><label>قراءة العداد</label><input id="flFuelOdo" type="number" class="fl-input"></div>
        </div>
        <div class="fl-form-actions"><button class="btn-primary" onclick="flLogFuel()">تسجيل (يُرحَّل كمصروف نقل)</button></div>
      </div>
      <div class="fl-panel"><div class="fl-panel-head"><h3>مخاطر الوقود ومكافحة السرقة</h3></div>
        ${riskRows ? `<table class="fl-table"><thead><tr><th>التاريخ</th><th>المركبة</th><th>المصدر</th><th>سعة الخزان</th><th>قبل/بعد</th><th>مصروف</th><th>مقاس</th><th>الفرق</th><th>الثقة</th></tr></thead><tbody>${riskRows}</tbody></table>` : '<p class="fl-muted" style="padding:12px">جميع عمليات التعبئة طبيعية — لا توجد فروق مشبوهة</p>'}
        <div style="margin-top:12px;padding:12px;background:#f8fafc;border-radius:8px;font-size:13px;line-height:1.8"><strong>آلية كشف سرقة الوقود:</strong><br>• مقارنة كمية المضخة بقراءة حساس الخزان<br>• كشف الهبوط المفاجئ عند الخروج من الموقع<br>• تنبيه عند انقطاع الإشارة مع نقص وقود<br>• تقارير فترة الخمول واستهلاك الوقود<br><span class="fl-muted">(النظام يستخدم بيانات تجريبية — الربط مع الحساسات قادم في الإصدار القادم)</span></div>
      </div>
      <div class="fl-panel"><div class="fl-panel-head"><h3>سجل الوقود الكامل</h3></div>
        <table class="fl-table"><thead><tr><th>التاريخ</th><th>المركبة</th><th>لترات</th><th>الكلفة</th><th>العداد</th></tr></thead>
        <tbody>${fuel.map(l => `<tr><td class="fl-muted">${esc(l.date)}</td><td>${esc(l.plate)}</td><td>${fmt(l.liters)}</td><td>${l.cost ? fmt(l.cost) + ' ' + curSym() : '—'}</td><td>${fmt(l.odometer)}</td></tr>`).join('') || '<tr><td colspan="5" class="fl-empty">لا يوجد سجل وقود حقيقي — استخدم نموذج التسجيل أعلاه</td></tr>'}</tbody></table>
      </div>`;
  }

  function renderTrips() {
    const el = document.getElementById('flTripBody'); if (!el) return;
    const f = F();
    const vehOpts = ['<option value="">— اختر المركبة —</option>'].concat(getVehicles().map(v => `<option value="${v.id}">${esc(v.plate)} (${esc(v.name || '')})</option>`)).join('');
    const trips = (f.trips || []).slice(0, 20);
    const g = buildGuardSnapshot();
    const demoBadge = isDemoMode() ? `<div class="fl-guard-note" style="margin-bottom:8px">${DEMO_NOTE}</div>` : '';
    el.innerHTML = `${demoBadge}
      <div class="fl-kpi-grid">
        ${kpi('إجمالي الرحلات', trips.length, isDemoMode() ? 'يشمل بيانات تجريبية' : '', '')}
        ${kpi('إجمالي المسافات', trips.reduce((s,t) => s + money(t.distance), 0).toLocaleString() + ' كم', '', '')}
      </div>
      <div class="fl-panel"><div class="fl-panel-head"><h3>🛣️ تسجيل رحلة (بيانات حقيقية)</h3></div>
        <div class="fl-form-grid">
          <div><label>المركبة</label><select id="flTripVehicle" class="fl-input">${vehOpts}</select></div>
          <div><label>التاريخ</label><input id="flTripDate" type="date" class="fl-input" value="${todayISO()}"></div>
          <div><label>السائق</label><input id="flTripDriver" class="fl-input"></div>
          <div><label>من</label><input id="flTripFrom" class="fl-input"></div>
          <div><label>إلى</label><input id="flTripTo" class="fl-input"></div>
          <div><label>المسافة (كم)</label><input id="flTripDist" type="number" class="fl-input"></div>
          <div class="fl-form-full"><label>الغرض</label><input id="flTripPurpose" class="fl-input"></div>
        </div>
        <div class="fl-form-actions"><button class="btn-primary" onclick="flLogTrip()">تسجيل الرحلة</button></div>
      </div>
      <div class="fl-panel"><div class="fl-panel-head"><h3>مناطق السرعة</h3></div>
        <table class="fl-table"><thead><tr><th>المنطقة</th><th>الحد للخفيف</th><th>الحد للثقيل</th></tr></thead>
        <tbody>${g.zones.map(z => `<tr><td>${esc(z.name)}</td><td>${fmt(z.limit)} كم/س</td><td>${fmt(z.heavyLimit)} كم/س</td></tr>`).join('')}</tbody></table>
      </div>
      <div class="fl-panel"><div class="fl-panel-head"><h3>سجل الرحلات</h3></div>
        <table class="fl-table"><thead><tr><th>التاريخ</th><th>المركبة</th><th>المسار</th><th>المسافة</th><th>الغرض</th></tr></thead>
        <tbody>${trips.map(t => `<tr><td class="fl-muted">${esc(t.date)}</td><td>${esc(t.plate)}</td><td>${esc(t.from || '?')} → ${esc(t.to || '?')}</td><td>${fmt(t.distance)} كم</td><td>${esc(t.purpose || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="fl-empty">لا يوجد سجل رحلات حقيقي — استخدم نموذج التسجيل أعلاه</td></tr>'}</tbody></table>
      </div>`;
  }

  function renderInvest() {
    const el = document.getElementById('flInvestBody'); if (!el) return;
    const g = buildGuardSnapshot();
    const openCases = g.anomalies;
    const criticalCount = openCases.filter(a => a.severity === 'critical').length;
    const highCount = openCases.filter(a => a.severity === 'high').length;
    const mediumCount = openCases.filter(a => a.severity === 'medium').length;
    const demoBadge = isDemoMode() ? `<div class="fl-guard-note" style="margin-bottom:8px">${DEMO_NOTE}</div>` : '';
    el.innerHTML = `${demoBadge}
      <div class="fl-kpi-grid">
        ${kpi('حالات حرجة', criticalCount, 'تتطلب تحقيقاً فورياً', criticalCount ? 'fl-kpi-warn' : '')}
        ${kpi('عالية', highCount, 'مراجعة خلال 24 ساعة', highCount ? 'fl-kpi-warn' : '')}
        ${kpi('متوسطة', mediumCount, 'مراجعة خلال 48 ساعة', '')}
        ${kpi('إجمالي التحقيقات', openCases.length, isDemoMode() ? 'بيانات تجريبية' : '', '')}
      </div>
      <div class="fl-panel"><div class="fl-panel-head"><h3>جميع حالات الشذوذ</h3></div>
        <table class="fl-table"><thead><tr><th>خطورة</th><th>المركبة</th><th>النوع</th><th>التفاصيل</th><th>الإجراء الموصى به</th><th>إجراء</th></tr></thead>
        <tbody>${openCases.map(a => `<tr class="${a.severity === 'critical' ? 'fl-row-danger' : a.severity === 'high' ? 'fl-row-warn' : ''}"><td><span class="fl-sev fl-sev-${a.severity}">${a.severity === 'critical' ? 'حرج' : a.severity === 'high' ? 'عالي' : 'متوسط'}</span></td><td>${esc(a.vehicle?.plate || '')}</td><td>${esc(a.type)}</td><td>${esc(a.detail)}</td><td>${esc(a.action)}</td><td><button class="fl-mini-btn" onclick="flGuardAction('فتح تحقيق: ${esc(a.type)}')">فتح تحقيق</button><button class="fl-mini-btn" onclick="flGuardAction('إنشاء تقرير: ${esc(a.type)}')">تقرير</button></td></tr>`).join('') || '<tr><td colspan="6" class="fl-empty">لا توجد شذوذات — الأسطول يعمل بشكل طبيعي ✅</td></tr>'}</tbody></table>
      </div>
      <div class="fl-panel"><div class="fl-panel-head"><h3>آلية عمل التحقيقات</h3></div>
        <div style="padding:12px;font-size:13px;line-height:1.9">
          <strong>مراحل التحقيق:</strong><br>
          1. كشف الشذوذ — يتم رصد المخالفات تلقائياً (سرعة، وقود، توقف، خروج عن النطاق)<br>
          2. فتح تحقيق — ينشئ ملف تحقيق مستقل مع كافة التفاصيل<br>
          3. جمع الأدلة — ربط بيانات GPS، قراءات الوقود، وصلات المضخة، تسجيلات السائق<br>
          4. التقييم — تصنيف الخطورة واقتراح الإجراء<br>
          5. الإغلاق — توثيق النتيجة والإجراء المتخذ<br>
          <span class="fl-muted">(هذه الواجهة عرض تجريبي — التحقيقات الكاملة مع قاعدة الأدلة قادمة)</span>
        </div>
      </div>`;
  }

  function renderSettings() {
    const el = document.getElementById('flSettingsBody'); if (!el) return;
    const demoActive = isDemoMode();
    el.innerHTML = `
      <div class="fl-panel"><div class="fl-panel-head"><h3>إعدادات الربط التجريبي</h3></div>
        <div style="padding:12px;font-size:14px;line-height:2">
          <p><strong>${DEMO_NOTE}</strong></p>
          <p>هذا القسم يوضح خيارات الربط المتاحة في الإصدار الكامل. الوضع التجريبي الحالي يستخدم بيانات مدمجة في الذاكرة.</p>
          <div style="margin:16px 0;display:grid;gap:12px">
            <div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px;background:#f8fafc"><strong>خيارات الربط المتوقعة:</strong><br>
            • GPS/GSM Tracker — أجهزة تتبع (Concox, Queclink, etc.)<br>
            • CAN/J1939 — قراءة بيانات المركبة عبر OBD-II أو CAN bus<br>
            • حساسات خزان وقود — مقاومات/مكثفات / ضغط<br>
            • قارئات RFID للوقود — لكل مركبة ومضخة<br>
            • تكامل مع كاميرات الموقع — للتحقق البصري</div>
          </div>
          <div class="fl-toolbar">
            <button class="btn-primary" onclick="flLoadDemo()">تحميل بيانات تجريبية</button>
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
      ['dashboard', '📊 لوحة السيطرة'],
      ['guard', '🗺️ خريطة المتابعة'],
      ['vehicles', '🚚 المركبات والمعدات'],
      ['fuel_risk', '⛽ الوقود والمخاطر'],
      ['trips', '🛣️ الرحلات والمناطق'],
      ['invest', '🔍 التقارير والتحقيقات'],
      ['settings', '⚙️ إعدادات الربط']
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
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', registerJarvis); else setTimeout(registerJarvis, 600);
  window.OctagonFleet = { render, ensureData, portfolio, isDemoMode };
})();
