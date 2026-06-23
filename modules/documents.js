/**
 * OCTAGON ERP — Document Management / DMS (إدارة الوثائق والمستندات).
 *
 * A standard ERP module Octagon had ZERO of (`document_management`/`dms` = 0). A central registry
 * for the business's important documents — licenses, contracts, certificates, permits, policies —
 * with issue/expiry dates and the high-value bit: **expiry alerts** so a trade license or a contract
 * never lapses unnoticed. Metadata-only (no binary upload yet — a file note/link field is provided).
 * Add-only; self-contained in `omni.documents`.
 *
 *  - Documents: title, category, ref number, owner/entity, issuer, issue date, expiry date, status,
 *    tags, file note/link, reminder lead-days.
 *  - Dashboard: total / expiring-soon / expired / by-category + an expiry alert table.
 *  - Jarvis tool: report_documents_today. Every mutation writes an audit event. Archive, never delete.
 *
 * Data namespace: omni.documents = { docs:[] }
 * Page: #pageDocuments (nav data-page="documents"). Add-only.
 */
(function () {
  'use strict';

  function O() { if (typeof omni !== 'undefined' && omni) return omni; if (typeof window.ensureOmni === 'function') { try { return window.ensureOmni(); } catch (_) {} } return null; }
  function save() { if (typeof window.saveData === 'function') window.saveData(); }
  function toast(m, t) { if (typeof window.showToast === 'function') window.showToast(m, t || 'info'); }
  function uid(p) { return (typeof window.makeId === 'function') ? window.makeId(p) : (p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function val(id) { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; }
  function numVal(id) { const v = Number(val(id)); return isFinite(v) ? v : 0; }
  function coId() { try { return (typeof window.getActiveOrgProfile === 'function' ? window.getActiveOrgProfile()?.companyId : '') || ''; } catch (_) { return ''; } }
  function userName() { try { if (window.PentagonAuth && PentagonAuth.currentUser) return PentagonAuth.currentUser.name; } catch (_) {} return 'مستخدم'; }
  function audit(action, detail) {
    try { if (typeof window.recordOmniHistoryEvent === 'function') window.recordOmniHistoryEvent('documents', action, detail); } catch (_) {}
    try { if (window.AuditService && typeof AuditService.createEvent === 'function') AuditService.createEvent({ module: 'documents', action, detail, user: userName() }); } catch (_) {}
  }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function daysFromToday(iso) { return iso ? Math.round((new Date(iso) - new Date(todayISO())) / 86400000) : null; }

  const CATEGORIES = [['license', '📜 إجازة/رخصة'], ['contract', '📝 عقد'], ['certificate', '🏅 شهادة'], ['permit', '✅ تصريح'], ['policy', '🛡️ بوليصة/سياسة'], ['id', '🪪 هوية/وثيقة'], ['other', '📄 أخرى']];
  const CAT_LABEL = Object.fromEntries(CATEGORIES);

  function ensureData() {
    const o = O(); if (!o) return null;
    if (!o.documents || typeof o.documents !== 'object') o.documents = {};
    if (!Array.isArray(o.documents.docs)) o.documents.docs = [];
    return o.documents;
  }
  function D() { return ensureData(); }
  function getDocs(all) { let l = (D()?.docs || []).filter(d => all || d.is_active !== false); if (typeof window.scoped === 'function') { try { l = window.scoped(l); } catch (_) {} } return l; }
  function expiryView(d) {
    if (!d.expiryDate) return { has: false };
    const days = daysFromToday(d.expiryDate);
    const lead = Number(d.reminderDays) || 30;
    return { has: true, days, expired: days < 0, soon: days >= 0 && days <= lead, lead };
  }

  function portfolio() {
    const docs = getDocs();
    const alerts = [];
    docs.forEach(d => { const e = expiryView(d); if (e.has && (e.soon || e.expired)) alerts.push({ d, e }); });
    alerts.sort((a, b) => a.e.days - b.e.days);
    return {
      total: docs.length,
      expiringSoon: alerts.filter(a => !a.e.expired).length,
      expired: alerts.filter(a => a.e.expired).length,
      byCategory: CATEGORIES.map(([k, l]) => ({ key: k, label: l, count: docs.filter(d => d.category === k).length })).filter(c => c.count),
      alerts
    };
  }

  let activeTab = 'dashboard', editing = null, search = '', catFilter = '';
  window.docOpenTab = function (t) { activeTab = t; editing = null; render(); };
  window.docSearch = function (v) { search = v; renderRegistry(); };
  window.docCatFilter = function (v) { catFilter = v; renderRegistry(); };
  window.docOpenForm = function (id) { editing = id || 'new'; activeTab = 'registry'; render(); };
  window.docCancelForm = function () { editing = null; render(); };

  window.docSave = function () {
    const dd = D(); if (!dd) return;
    const title = val('docTitle');
    if (!title) { toast('عنوان الوثيقة مطلوب', 'error'); return; }
    const base = {
      title, category: val('docCategory') || 'license', refNumber: val('docRef'),
      owner: val('docOwner'), issuer: val('docIssuer'), issueDate: val('docIssue'),
      expiryDate: val('docExpiry'), reminderDays: Math.max(0, Math.round(numVal('docReminder')) || 30),
      tags: val('docTags'), fileNote: val('docFile'), notes: val('docNotes')
    };
    const ex = editing && editing !== 'new' ? dd.docs.find(d => d.id === editing) : null;
    if (ex) { Object.assign(ex, base); audit('doc_update', `تعديل وثيقة: ${title}`); toast('تم التحديث', 'success'); }
    else { dd.docs.push({ id: uid('doc'), ...base, is_active: true, companyId: coId(), createdAt: new Date().toISOString(), createdBy: userName() }); audit('doc_create', `وثيقة جديدة: ${title}`); toast('تمت إضافة الوثيقة', 'success'); }
    save(); editing = null; render();
  };
  window.docArchive = function (id) {
    const d = (D()?.docs || []).find(x => x.id === id); if (!d) return;
    if (!confirm(`أرشفة الوثيقة "${d.title}"؟`)) return;
    d.is_active = false; audit('doc_archive', `أرشفة: ${d.title}`); save(); render();
  };
  window.docLoadDemo = function () {
    const dd = D(); if (!dd) return;
    if (dd.docs.length) { toast('توجد وثائق مسبقاً', 'info'); return; }
    const fwd = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
    dd.docs.push(
      { id: uid('doc'), title: 'إجازة ممارسة المهنة', category: 'license', refNumber: 'LIC-2024-117', owner: 'الورشة', issuer: 'غرفة التجارة', issueDate: fwd(-330), expiryDate: fwd(20), reminderDays: 30, tags: 'رسمي', fileNote: '', notes: '', is_active: true, companyId: coId(), createdAt: new Date().toISOString(), createdBy: 'تجريبي' },
      { id: uid('doc'), title: 'عقد إيجار المحل', category: 'contract', refNumber: 'C-88', owner: 'الإدارة', issuer: 'المالك', issueDate: fwd(-300), expiryDate: fwd(-10), reminderDays: 45, tags: 'إيجار', fileNote: '', notes: 'يحتاج تجديد', is_active: true, companyId: coId(), createdAt: new Date().toISOString(), createdBy: 'تجريبي' },
      { id: uid('doc'), title: 'شهادة سلامة المعدات', category: 'certificate', refNumber: 'SAF-22', owner: 'الإنتاج', issuer: 'الدفاع المدني', issueDate: fwd(-60), expiryDate: fwd(200), reminderDays: 30, tags: 'سلامة', fileNote: '', notes: '', is_active: true, companyId: coId(), createdAt: new Date().toISOString(), createdBy: 'تجريبي' }
    );
    audit('doc_demo', 'تحميل وثائق تجريبية');
    save(); toast('تم تحميل بيانات تجريبية', 'success'); render();
  };

  function kpi(label, value, sub, cls) { return `<div class="dc-kpi ${cls || ''}"><div class="dc-kpi-val">${value}</div><div class="dc-kpi-label">${label}</div>${sub ? `<div class="dc-kpi-sub">${sub}</div>` : ''}</div>`; }

  function renderDashboard() {
    const el = document.getElementById('dcDashBody'); if (!el) return;
    const p = portfolio();
    el.innerHTML = `
      <div class="dc-kpi-grid">
        ${kpi('إجمالي الوثائق', p.total, '', 'dc-kpi-accent')}
        ${kpi('تنتهي قريباً', p.expiringSoon, 'ضمن مهلة التذكير', p.expiringSoon ? 'dc-kpi-warn' : '')}
        ${kpi('منتهية', p.expired, 'تحتاج تجديداً', p.expired ? 'dc-kpi-danger' : '')}
        ${kpi('الفئات', p.byCategory.length, 'أنواع الوثائق', '')}
      </div>
      <div class="dc-panel"><div class="dc-panel-head"><h3>🚨 وثائق تحتاج تجديداً</h3><button class="dc-mini-btn" onclick="docOpenTab('registry')">السجل الكامل</button></div>
        <table class="dc-table"><thead><tr><th>الوثيقة</th><th>الفئة</th><th>الجهة</th><th>الانتهاء</th><th>الحالة</th></tr></thead>
        <tbody>${p.alerts.map(a => `<tr class="${a.e.expired ? 'dc-row-danger' : 'dc-row-warn'}"><td><strong>${esc(a.d.title)}</strong>${a.d.refNumber ? `<br><span class="dc-muted">${esc(a.d.refNumber)}</span>` : ''}</td><td>${CAT_LABEL[a.d.category] || a.d.category}</td><td>${esc(a.d.owner || '—')}</td><td class="dc-muted">${esc(a.d.expiryDate)}</td><td>${a.e.expired ? `<span class="dc-badge dc-bad">منتهية منذ ${Math.abs(a.e.days)} يوم</span>` : `<span class="dc-badge dc-warn">خلال ${a.e.days} يوم</span>`}</td></tr>`).join('') || '<tr><td colspan="5" class="dc-empty">كل الوثائق سارية ✅</td></tr>'}</tbody></table>
      </div>
      ${p.byCategory.length ? `<div class="dc-panel"><div class="dc-panel-head"><h3>حسب الفئة</h3></div><div class="dc-cats">${p.byCategory.map(c => `<div class="dc-cat-chip">${c.label} <strong>${c.count}</strong></div>`).join('')}</div></div>` : ''}`;
  }

  function renderRegistry() {
    const el = document.getElementById('dcRegBody'); if (!el) return;
    if (editing) { el.innerHTML = renderForm(); return; }
    let list = getDocs();
    if (catFilter) list = list.filter(d => d.category === catFilter);
    if (search) { const q = search.toLowerCase(); list = list.filter(d => `${d.title} ${d.refNumber} ${d.owner} ${d.tags}`.toLowerCase().includes(q)); }
    const catOpts = ['<option value="">كل الفئات</option>'].concat(CATEGORIES.map(([k, l]) => `<option value="${k}" ${catFilter === k ? 'selected' : ''}>${l}</option>`)).join('');
    el.innerHTML = `
      <div class="dc-toolbar">
        <button class="btn-primary" onclick="docOpenForm('new')">➕ وثيقة</button>
        <button class="dc-mini-btn" onclick="docLoadDemo()">بيانات تجريبية</button>
        <input class="dc-input" placeholder="بحث..." value="${esc(search)}" oninput="docSearch(this.value)" style="max-width:200px">
        <select class="dc-input" onchange="docCatFilter(this.value)" style="max-width:170px">${catOpts}</select>
      </div>
      <table class="dc-table"><thead><tr><th>الوثيقة</th><th>الفئة</th><th>الرقم</th><th>الجهة</th><th>الإصدار</th><th>الانتهاء</th><th>إجراءات</th></tr></thead>
      <tbody>${list.map(d => { const e = expiryView(d); const exp = !e.has ? '<span class="dc-muted">—</span>' : `<span class="${e.expired ? 'dc-exp-bad' : e.soon ? 'dc-exp-warn' : 'dc-exp-ok'}">${esc(d.expiryDate)}</span>`;
        return `<tr><td><strong>${esc(d.title)}</strong>${d.tags ? `<br><span class="dc-muted">${esc(d.tags)}</span>` : ''}</td><td>${CAT_LABEL[d.category] || d.category}</td><td class="dc-muted">${esc(d.refNumber || '—')}</td><td>${esc(d.owner || '—')}</td><td class="dc-muted">${esc(d.issueDate || '—')}</td><td>${exp}</td>
        <td class="dc-actions"><button class="dc-mini-btn" onclick="docOpenForm('${d.id}')">تعديل</button><button class="dc-mini-btn dc-danger" onclick="docArchive('${d.id}')">أرشفة</button></td></tr>`;
      }).join('') || '<tr><td colspan="7" class="dc-empty">لا توجد وثائق</td></tr>'}</tbody></table>`;
  }
  function renderForm() {
    const d = editing !== 'new' ? (D()?.docs || []).find(x => x.id === editing) : null; const v = d || {};
    const cOpt = CATEGORIES.map(([k, l]) => `<option value="${k}" ${v.category === k ? 'selected' : ''}>${l}</option>`).join('');
    return `<div class="dc-panel"><div class="dc-panel-head"><h3>${d ? 'تعديل وثيقة' : 'وثيقة جديدة'}</h3></div>
      <div class="dc-form-grid">
        <div class="dc-form-full"><label>العنوان *</label><input id="docTitle" class="dc-input" value="${esc(v.title || '')}"></div>
        <div><label>الفئة</label><select id="docCategory" class="dc-input">${cOpt}</select></div>
        <div><label>رقم الوثيقة</label><input id="docRef" class="dc-input" value="${esc(v.refNumber || '')}"></div>
        <div><label>الجهة المالكة</label><input id="docOwner" class="dc-input" value="${esc(v.owner || '')}"></div>
        <div><label>جهة الإصدار</label><input id="docIssuer" class="dc-input" value="${esc(v.issuer || '')}"></div>
        <div><label>تاريخ الإصدار</label><input id="docIssue" type="date" class="dc-input" value="${esc(v.issueDate || '')}"></div>
        <div><label>تاريخ الانتهاء</label><input id="docExpiry" type="date" class="dc-input" value="${esc(v.expiryDate || '')}"></div>
        <div><label>التذكير قبل (يوم)</label><input id="docReminder" type="number" class="dc-input" value="${v.reminderDays != null ? v.reminderDays : 30}"></div>
        <div><label>الوسوم</label><input id="docTags" class="dc-input" value="${esc(v.tags || '')}"></div>
        <div class="dc-form-full"><label>ملف/رابط (ملاحظة)</label><input id="docFile" class="dc-input" value="${esc(v.fileNote || '')}" placeholder="مسار أو رابط الملف"></div>
        <div class="dc-form-full"><label>ملاحظات</label><input id="docNotes" class="dc-input" value="${esc(v.notes || '')}"></div>
      </div>
      <div class="dc-form-actions"><button class="btn-primary" onclick="docSave()">حفظ</button><button class="dc-mini-btn" onclick="docCancelForm()">إلغاء</button></div></div>`;
  }

  function renderTabContent() {
    const map = { dcDashBody: 'dashboard', dcRegBody: 'registry' };
    Object.keys(map).forEach(id => { const e = document.getElementById(id); if (e) e.style.display = map[id] === activeTab ? '' : 'none'; });
    if (activeTab === 'dashboard') renderDashboard(); else renderRegistry();
  }
  function render() {
    const body = document.getElementById('documentsBody'); if (!body) return;
    ensureData();
    const tabs = [['dashboard', '📊 اللوحة'], ['registry', '🗂️ السجل']];
    body.innerHTML = `<div class="dc-tabs">${tabs.map(([k, l]) => `<button class="dc-tab-btn ${activeTab === k ? 'active' : ''}" onclick="docOpenTab('${k}')">${l}</button>`).join('')}</div>
      <div id="dcDashBody"></div><div id="dcRegBody"></div>`;
    renderTabContent();
  }
  window.renderDocuments = render;

  const _origSwitch = window.switchPage;
  window.switchPage = function (page) {
    if (_origSwitch) _origSwitch(page);
    if (page === 'documents') {
      try {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('page-active'));
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        const pg = document.getElementById('pageDocuments'); if (pg) pg.classList.add('page-active');
        const nav = document.getElementById('navDocuments'); if (nav) nav.classList.add('active');
        if (typeof window.ensureNavGroupForPage === 'function') window.ensureNavGroupForPage('documents');
      } catch (_) {}
      ensureData(); setTimeout(render, 0);
    }
  };
  function registerJarvis() {
    try {
      if (window.JarvisBrain && JarvisBrain.tools) {
        JarvisBrain.tools['report_documents_today'] = function () {
          const p = portfolio();
          return { total: p.total, expiringSoon: p.expiringSoon, expired: p.expired, alerts: p.alerts.map(a => ({ title: a.d.title, category: a.d.category, expiry: a.d.expiryDate, expired: a.e.expired, daysLeft: a.e.days })) };
        };
        if (JarvisBrain.PAGES) JarvisBrain.PAGES['documents'] = '#pageDocuments';
      }
    } catch (_) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', registerJarvis); else setTimeout(registerJarvis, 600);
  window.OctagonDocuments = { render, ensureData, portfolio };
})();
