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
    const map = { flDashBody: 'dashboard', flVehBody: 'vehicles', flLogsBody: 'logs' };
    Object.keys(map).forEach(id => { const e = document.getElementById(id); if (e) e.style.display = map[id] === activeTab ? '' : 'none'; });
    if (activeTab === 'dashboard') renderDashboard(); else if (activeTab === 'vehicles') renderVehicles(); else renderLogs();
  }
  function render() {
    const body = document.getElementById('fleetBody'); if (!body) return;
    ensureData();
    const tabs = [['dashboard', '📊 اللوحة'], ['vehicles', '🚚 المركبات'], ['logs', '⛽ الوقود والرحلات']];
    body.innerHTML = `<div class="fl-tabs">${tabs.map(([k, l]) => `<button class="fl-tab-btn ${activeTab === k ? 'active' : ''}" onclick="flOpenTab('${k}')">${l}</button>`).join('')}</div>
      <div id="flDashBody"></div><div id="flVehBody"></div><div id="flLogsBody"></div>`;
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
