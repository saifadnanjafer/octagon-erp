/**
 * OCTAGON ERP — Fleet Management (إدارة المركبات والأسطول).
 *
 * A standard ERP module Octagon had ZERO of (`fleet_`/`fuel log`/`odometer` = 0). Manages the
 * business's vehicles: registration, fuel/odometer logs, trips, driver assignment, and — the
 * highest-value bit — license & insurance expiry alerts. Pairs with the Fixed-Assets module
 * (a vehicle can also be a depreciable asset). Add-only; self-contained in `omni.fleet`.
 *
 *  - Vehicles: plate, name, type, driver, current odometer, fuel type, license/insurance expiry,
 *    status (active / maintenance / idle).
 *  - Fuel logs: date, liters, cost, odometer (auto-updates the vehicle odometer; optional finance
 *    expense post via the proven bridge). Trips: date, driver, from→to, distance, purpose.
 *  - Dashboard: active vehicles, license/insurance expiring (≤30d) or expired, fuel-cost-this-month,
 *    total distance + alert table.
 *  - Fleet/Fuel Guard demo: local mock command map, zone speed limits, fuel anomaly center,
 *    vehicle history, trip history, oil/service/inspection tracking. No hardware integration.
 *  - Jarvis tool: report_fleet_today. Every mutation writes an audit event. Archive, never delete.
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

  const TYPES = [['car', 'سيارة'], ['truck', 'شاحنة'], ['van', 'فان'], ['motorcycle', 'دراجة'], ['forklift', 'رافعة'], ['other', 'أخرى']];
  const TYPE_LABEL = Object.fromEntries(TYPES);
  const STATUS_LABEL = { active: 'في الخدمة', maintenance: 'صيانة', idle: 'متوقفة' };
  const STATUS_CLASS = { active: 'fl-st-ok', maintenance: 'fl-st-maint', idle: 'fl-st-idle' };

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
  function getEmployees() { return Array.isArray(window.employees) ? window.employees : ((O() && Array.isArray(O().employees)) ? O().employees : []); }

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
    const f = F(); if (!f) return;
    if (f.vehicles.length) { toast('توجد مركبات مسبقاً', 'info'); return; }
    const fwd = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
    f.vehicles.push(
      { id: uid('veh'), plate: '12345 بغداد', name: 'شاحنة التوصيل', type: 'truck', driver: 'سعد', odometer: 84200, fuelType: 'ديزل', licenseExpiry: fwd(12), insuranceExpiry: fwd(75), status: 'active', notes: '', is_active: true, companyId: coId(), createdAt: new Date().toISOString() },
      { id: uid('veh'), plate: '67890 بغداد', name: 'فان المبيعات', type: 'van', driver: 'كرار', odometer: 51000, fuelType: 'بنزين', licenseExpiry: fwd(-5), insuranceExpiry: fwd(120), status: 'active', notes: 'الإجازة منتهية', is_active: true, companyId: coId(), createdAt: new Date().toISOString() },
      { id: uid('veh'), plate: 'R-22', name: 'رافعة شوكية', type: 'forklift', driver: '-', odometer: 3200, fuelType: 'غاز', licenseExpiry: '', insuranceExpiry: '', status: 'maintenance', notes: '', is_active: true, companyId: coId(), createdAt: new Date().toISOString() }
    );
    const v0 = f.vehicles[0];
    f.fuelLogs.unshift({ id: uid('fuel'), vehicleId: v0.id, plate: v0.plate, date: todayISO(), liters: 60, cost: 90000, odometer: 84200, by: 'تجريبي', createdAt: new Date().toISOString(), companyId: coId() });
    f.trips.unshift({ id: uid('trip'), vehicleId: v0.id, plate: v0.plate, date: todayISO(), driver: 'سعد', from: 'الورشة', to: 'الكرادة', distance: 18, purpose: 'تسليم طلب', by: 'تجريبي', createdAt: new Date().toISOString(), companyId: coId() });
    audit('fleet_demo', 'تحميل أسطول تجريبي');
    save(); toast('تم تحميل بيانات تجريبية', 'success'); render();
  };

  function kpi(label, value, sub, cls) { return `<div class="fl-kpi ${cls || ''}"><div class="fl-kpi-val">${value}</div><div class="fl-kpi-label">${label}</div>${sub ? `<div class="fl-kpi-sub">${sub}</div>` : ''}</div>`; }
  function dateShift(days) { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }

  const GUARD_ZONES = [
    { id: 'workshop', name: 'الورشة', type: 'workshop', limit: 10, heavyLimit: 8, color: 'teal' },
    { id: 'site', name: 'موقع المشروع', type: 'project_site', limit: 20, heavyLimit: 15, color: 'blue' },
    { id: 'city', name: 'طريق المدينة', type: 'city_road', limit: 60, heavyLimit: 45, color: 'slate' },
    { id: 'highway', name: 'الطريق السريع', type: 'highway', limit: 90, heavyLimit: 70, color: 'indigo' },
    { id: 'fuel_station', name: 'محطة الوقود', type: 'fuel_station', limit: 15, heavyLimit: 10, color: 'amber' },
    { id: 'restricted', name: 'منطقة حساسة', type: 'restricted', limit: 5, heavyLimit: 5, color: 'red' }
  ];

  function isHeavyVehicle(v) { return ['truck', 'forklift', 'loader', 'crane', 'excavator', 'heavy', 'generator'].includes(String(v.type || '').toLowerCase()); }
  function zoneLimit(v, z) { return isHeavyVehicle(v) ? z.heavyLimit : z.limit; }
  function demoVehicleRows() {
    return [
      { id: 'demo-truck-01', plate: 'D-1045', name: 'شاحنة ديزل كبيرة', type: 'truck', driver: 'سعد', odometer: 84200, fuelType: 'diesel/kaz', status: 'active', project: 'مشروع الكرادة', site: 'موقع A', tankCapacity: 220, hourMeter: 4180 },
      { id: 'demo-loader-02', plate: 'EQ-77', name: 'لودر موقع', type: 'loader', driver: 'حيدر', odometer: 12800, fuelType: 'diesel/kaz', status: 'active', project: 'مشروع بسماية', site: 'موقع B', tankCapacity: 310, hourMeter: 6030 },
      { id: 'demo-gen-03', plate: 'GEN-19', name: 'مولدة ديزل', type: 'generator', driver: 'فريق الكهرباء', odometer: 0, fuelType: 'diesel/kaz', status: 'idle', project: 'المخزن المركزي', site: 'Depot', tankCapacity: 500, hourMeter: 2280 },
      { id: 'demo-pickup-04', plate: 'P-5521', name: 'بيك أب متابعة', type: 'car', driver: 'كرار', odometer: 51240, fuelType: 'gasoline', status: 'active', project: 'الإدارة', site: 'المدينة', tankCapacity: 75, hourMeter: 0 }
    ];
  }
  function sourceVehicles() {
    const actual = getVehicles().filter(v => v.status !== 'retired');
    return (actual.length ? actual : demoVehicleRows()).map((v, idx) => {
      const z = GUARD_ZONES[idx % GUARD_ZONES.length];
      const limit = zoneLimit(v, z);
      const speedSeed = [8, 27, 0, 72, 96, 14][idx % 6];
      const speed = Number(v.currentSpeed != null ? v.currentSpeed : speedSeed);
      const tank = Math.max(40, Number(v.tankCapacity || (isHeavyVehicle(v) ? 240 : 75)));
      const fuelPercent = Number(v.fuelPercent != null ? v.fuelPercent : Math.max(18, 78 - idx * 13));
      const fuelLiters = Math.round(tank * fuelPercent / 100);
      const anomaly = idx === 1 || (speed > limit && idx % 2 === 0);
      const markerStatus = v.status === 'maintenance' ? 'offline' : anomaly ? 'fuel_anomaly' : speed > limit ? 'speeding' : v.status === 'idle' ? 'idle' : 'normal';
      return {
        ...v,
        project: v.project || v.department || ['مشروع الكرادة', 'مشروع بسماية', 'الإدارة', 'المخزن المركزي'][idx % 4],
        site: v.site || ['موقع A', 'موقع B', 'المدينة', 'Depot'][idx % 4],
        zone: z,
        currentSpeed: speed,
        speedLimit: limit,
        tankCapacity: tank,
        fuelPercent,
        fuelLiters,
        hourMeter: Number(v.hourMeter || (isHeavyVehicle(v) ? 1800 + idx * 920 : 0)),
        engineState: v.status === 'idle' ? 'idle' : v.status === 'maintenance' ? 'off' : 'on',
        markerStatus,
        lastUpdate: idx === 0 ? 'قبل 4 دقائق' : idx === 1 ? 'قبل 11 دقيقة' : idx === 2 ? 'قبل 28 دقيقة' : 'قبل 7 دقائق'
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
    const logs = Array.isArray(f.fuelLogs) && f.fuelLogs.length ? f.fuelLogs.slice(0, 8) : vehicles.slice(0, 4).map((v, idx) => ({
      id: 'demo-fuel-' + idx, vehicleId: v.id, plate: v.plate, date: dateShift(-idx * 2), liters: [100, 85, 160, 45][idx % 4], cost: [150000, 127000, 240000, 69000][idx % 4], odometer: Number(v.odometer || 0), by: 'عرض تجريبي'
    }));
    return logs.map((l, idx) => {
      const v = vehicles.find(x => x.id === l.vehicleId || x.plate === l.plate) || vehicles[idx % vehicles.length] || {};
      const tank = Number(v.tankCapacity || 120);
      const dispensed = Number(l.liters || 0);
      const variance = idx === 1 ? -18 : idx === 3 ? -7 : 0;
      const measured = Math.max(0, dispensed + variance);
      const before = Math.max(0, Math.round(Number(v.fuelLiters || tank * 0.35) - measured));
      const after = Math.min(tank, before + measured);
      return { ...l, vehicle: v, tank, before, after, dispensed, measured, variance, method: idx % 2 ? 'يدوي + وصل مضخة' : 'حساس خزان تجريبي', confidence: Math.abs(variance) > 10 ? 'منخفضة' : 'عالية', station: idx % 2 ? 'محطة خارجية' : 'Depot' };
    });
  }
  function guardTripRows(vehicles) {
    const f = F() || {};
    const rows = Array.isArray(f.trips) && f.trips.length ? f.trips.slice(0, 8) : vehicles.slice(0, 4).map((v, idx) => ({
      id: 'demo-trip-' + idx, vehicleId: v.id, plate: v.plate, date: dateShift(-idx), driver: v.driver, from: ['Depot', 'الورشة', 'موقع A', 'المدينة'][idx % 4], to: ['موقع A', 'محطة الوقود', 'موقع B', 'Depot'][idx % 4], distance: [42, 18, 64, 27][idx % 4], purpose: ['تسليم مواد', 'تعبئة وقود', 'نقل معدات', 'زيارة إشراف'][idx % 4]
    }));
    return rows.map((t, idx) => {
      const v = vehicles.find(x => x.id === t.vehicleId || x.plate === t.plate) || vehicles[idx % vehicles.length] || {};
      const startOdo = Math.max(0, Number(t.odometerStart || v.odometer || 0) - Number(t.distance || 0));
      const endOdo = Number(t.odometerEnd || v.odometer || startOdo + Number(t.distance || 0));
      const maxSpeed = idx === 2 ? 96 : Math.max(22, Number(v.currentSpeed || 0) + 8);
      return { ...t, vehicle: v, planned: Number(t.distance || 0), actual: Number(t.distance || 0) + (idx === 2 ? 11 : 0), startOdo, endOdo, fuelStart: Math.min(100, Number(v.fuelPercent || 50) + 8), fuelEnd: Math.max(0, Number(v.fuelPercent || 50) - 9), idleMinutes: [12, 4, 38, 8][idx % 4], maxSpeed, avgSpeed: Math.max(10, Math.round(maxSpeed * 0.62)), zones: [v.zone?.name || 'غير محدد', idx === 1 ? 'محطة الوقود' : 'طريق المدينة'] };
    });
  }
  function guardServiceRows(vehicles) {
    return vehicles.map((v, idx) => {
      const km = Number(v.odometer || 0);
      const hours = Number(v.hourMeter || 0);
      const oilDueKm = isHeavyVehicle(v) ? km + (idx === 1 ? 350 : 1200) : km + (idx === 3 ? 800 : 5000);
      const oilDueHours = hours ? hours + (idx === 1 ? 22 : 120) : 0;
      const inspectionState = idx === 1 ? 'فشل فحص هيدروليك' : idx === 2 ? 'مطلوب فحص تشغيل' : 'ناجح';
      return { vehicle: v, lastOil: dateShift(-45 - idx * 11), nextOilDate: dateShift(idx === 1 ? 5 : 28 + idx * 8), oilDueKm, oilDueHours, inspectionState, service: idx === 1 ? 'عاجل' : idx === 2 ? 'قريب' : 'ضمن الجدول', filters: idx % 2 ? 'زيت + هيدروليك' : 'زيت + هواء' };
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

  function renderFleetGuard() {
    const el = document.getElementById('flGuardBody'); if (!el) return;
    const g = buildGuardSnapshot();
    const active = g.vehicles.filter(v => v.status === 'active').length;
    const offline = g.vehicles.filter(v => v.markerStatus === 'offline').length;
    const serviceDue = g.service.filter(s => s.service !== 'ضمن الجدول').length;
    const fuelCost = g.fuels.reduce((s, f) => s + money(f.cost), 0);
    const markerCards = g.vehicles.map(v => `<article class="fl-map-marker fl-${guardStatusClass(v.markerStatus)}">
      <div class="fl-marker-head"><strong>${esc(v.plate || v.name)}</strong><span>${guardStatusLabel(v.markerStatus)}</span></div>
      <div class="fl-marker-meta">${esc(v.name || '')} · ${esc(v.driver || 'بدون سائق')}</div>
      <div class="fl-marker-grid"><span>المنطقة</span><b>${esc(v.zone.name)}</b><span>السرعة</span><b>${fmt(v.currentSpeed)} / ${fmt(v.speedLimit)} كم/س</b><span>الوقود</span><b>${fmt(v.fuelLiters)} لتر (${fmt(v.fuelPercent)}%)</b><span>آخر تحديث</span><b>${esc(v.lastUpdate)}</b></div>
    </article>`).join('');
    const zones = g.zones.map(z => `<div class="fl-zone-card fl-zone-${z.color}"><b>${esc(z.name)}</b><span>${fmt(z.limit)} كم/س · ثقيل ${fmt(z.heavyLimit)}</span></div>`).join('');
    const speedRows = g.zones.map(z => `<tr><td>${esc(z.name)}</td><td>${fmt(z.limit)} كم/س</td><td>${fmt(z.heavyLimit)} كم/س</td><td>تنبيه بعد 60 ثانية · AI يشرح فقط</td></tr>`).join('');
    const anomalyRows = g.anomalies.map(a => `<tr class="${a.severity === 'critical' ? 'fl-row-danger' : a.severity === 'high' ? 'fl-row-warn' : ''}"><td><span class="fl-sev fl-sev-${a.severity}">${a.severity}</span></td><td>${esc(a.vehicle?.plate || '')}</td><td>${esc(a.type)}</td><td>${esc(a.detail)}</td><td>${esc(a.action)}</td></tr>`).join('');
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
      <div class="fl-guard-note">مرحلة عرض داخلية: بيانات demo/manual فقط، لا يوجد ربط GPS/OBD/CAN/J1939/حساسات حقيقي الآن.</div>
      <div class="fl-kpi-grid">
        ${kpi('إجمالي الأسطول', g.vehicles.length, `${active} فعالة · ${offline} غير متصلة`, 'fl-kpi-accent')}
        ${kpi('تنبيهات الوقود', g.anomalies.length, `${fmt(g.suspiciousLiters)} لتر مشتبه`, g.anomalies.length ? 'fl-kpi-warn' : '')}
        ${kpi('مخالفات السرعة', g.speedViolations, 'حسب المنطقة ونوع المركبة', g.speedViolations ? 'fl-kpi-warn' : '')}
        ${kpi('صيانة/فحص قريب', serviceDue, 'زيت · فلاتر · فحص تشغيل', serviceDue ? 'fl-kpi-warn' : '')}
        ${kpi('كلفة تعبئة العرض', fmt(fuelCost) + ' ' + curSym(), 'من سجل التعبئة والقياس', '')}
      </div>
      <div class="fl-guard-grid">
        <section class="fl-panel fl-guard-map-panel"><div class="fl-panel-head"><h3>خريطة التحكم بالأسطول</h3></div><div class="fl-zone-strip">${zones}</div><div class="fl-map-grid">${markerCards}</div></section>
        <section class="fl-panel"><div class="fl-panel-head"><h3>محددات السرعة حسب المنطقة</h3></div><table class="fl-table"><thead><tr><th>المنطقة</th><th>مركبات خفيفة</th><th>معدات ثقيلة</th><th>قاعدة التنبيه</th></tr></thead><tbody>${speedRows}</tbody></table></section>
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
    el.innerHTML = `
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
    el.innerHTML = `
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
    const sOpt = Object.entries(STATUS_LABEL).map(([k, l]) => `<option value="${k}" ${d.status === k ? 'selected' : ''}>${l}</option>`).join('');
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

  function renderLogs() {
    const el = document.getElementById('flLogsBody'); if (!el) return;
    const f = F();
    const vehOpts = ['<option value="">— اختر المركبة —</option>'].concat(getVehicles().map(v => `<option value="${v.id}">${esc(v.plate)} (${esc(v.name || '')})</option>`)).join('');
    const fuel = (f.fuelLogs || []).slice(0, 20), trips = (f.trips || []).slice(0, 20);
    el.innerHTML = `
      <div class="fl-panel"><div class="fl-panel-head"><h3>⛽ تسجيل تزويد وقود</h3></div>
        <div class="fl-form-grid">
          <div><label>المركبة</label><select id="flFuelVehicle" class="fl-input">${vehOpts}</select></div>
          <div><label>التاريخ</label><input id="flFuelDate" type="date" class="fl-input" value="${todayISO()}"></div>
          <div><label>اللترات</label><input id="flFuelLiters" type="number" class="fl-input"></div>
          <div><label>الكلفة (${curSym()})</label><input id="flFuelCost" type="number" class="fl-input"></div>
          <div><label>قراءة العداد</label><input id="flFuelOdo" type="number" class="fl-input"></div>
        </div>
        <div class="fl-form-actions"><button class="btn-primary" onclick="flLogFuel()">تسجيل (يُرحَّل كمصروف نقل)</button></div>
        <table class="fl-table" style="margin-top:14px"><thead><tr><th>التاريخ</th><th>المركبة</th><th>لترات</th><th>الكلفة</th><th>العداد</th></tr></thead>
        <tbody>${fuel.map(l => `<tr><td class="fl-muted">${esc(l.date)}</td><td>${esc(l.plate)}</td><td>${fmt(l.liters)}</td><td>${l.cost ? fmt(l.cost) + ' ' + curSym() : '—'}</td><td>${fmt(l.odometer)}</td></tr>`).join('') || '<tr><td colspan="5" class="fl-empty">لا يوجد سجل وقود</td></tr>'}</tbody></table>
      </div>
      <div class="fl-panel"><div class="fl-panel-head"><h3>🛣️ تسجيل رحلة</h3></div>
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
        <table class="fl-table" style="margin-top:14px"><thead><tr><th>التاريخ</th><th>المركبة</th><th>المسار</th><th>المسافة</th><th>الغرض</th></tr></thead>
        <tbody>${trips.map(t => `<tr><td class="fl-muted">${esc(t.date)}</td><td>${esc(t.plate)}</td><td>${esc(t.from || '?')} → ${esc(t.to || '?')}</td><td>${fmt(t.distance)} كم</td><td>${esc(t.purpose || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="fl-empty">لا يوجد سجل رحلات</td></tr>'}</tbody></table>
      </div>`;
  }

  function renderTabContent() {
    const map = { flDashBody: 'dashboard', flVehBody: 'vehicles', flLogsBody: 'logs', flGuardBody: 'guard' };
    Object.keys(map).forEach(id => { const e = document.getElementById(id); if (e) e.style.display = map[id] === activeTab ? '' : 'none'; });
    if (activeTab === 'dashboard') renderDashboard(); else if (activeTab === 'vehicles') renderVehicles(); else if (activeTab === 'guard') renderFleetGuard(); else renderLogs();
  }
  function render() {
    const body = document.getElementById('fleetBody'); if (!body) return;
    ensureData();
    const tabs = [['dashboard', '📊 اللوحة'], ['vehicles', '🚚 المركبات'], ['logs', '⛽ الوقود والرحلات'], ['guard', 'Fleet/Fuel Guard']];
    body.innerHTML = `<div class="fl-tabs">${tabs.map(([k, l]) => `<button class="fl-tab-btn ${activeTab === k ? 'active' : ''}" onclick="flOpenTab('${k}')">${l}</button>`).join('')}</div>
      <div id="flDashBody"></div><div id="flVehBody"></div><div id="flLogsBody"></div><div id="flGuardBody"></div>`;
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
  window.OctagonFleet = { render, ensureData, portfolio };
})();
