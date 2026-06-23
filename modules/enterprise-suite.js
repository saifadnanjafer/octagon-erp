/**
 * OCTAGON ERP - Enterprise Suite Gap Layer.
 *
 * Adds the missing major-ERP control surfaces identified in the gap audit:
 * banking/treasury, AR/AP, contracts, logistics, supplier portal,
 * integration hub, security center, data quality, training/LMS, scenario
 * planner, and device/IoT center.
 *
 * Add-only. Data lives in omni.enterpriseSuite.<page>.records and each record
 * carries company context when an active company is available.
 */
(function () {
  'use strict';

  let bankingActiveTab = 'overview';
  let contractsActiveTab = 'overview';
  let deviceActiveTab = 'overview';
  let arApActiveTab = 'overview';
  let logisticsActiveTab = 'overview';
  let bankStatementLines = [];

  function daysFromToday(iso) {
    return iso ? Math.round((new Date(iso) - new Date(todayISO())) / 86400000) : null;
  }

  function O() {
    try { if (typeof omni !== 'undefined' && omni && typeof omni === 'object') return omni; } catch (_) {}
    if (!window.omni || typeof window.omni !== 'object') window.omni = {};
    return window.omni;
  }
  function topDb() {
    try { return (window.OctagonDB || window.PentagonDB)?.getCached?.() || {}; } catch (_) { return {}; }
  }
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function money(value) {
    const n = Number(value);
    return isFinite(n) ? Math.round(n) : 0;
  }
  function fmt(value) {
    try { return money(value).toLocaleString('en-US'); } catch (_) { return String(money(value)); }
  }
  function todayISO() {
    if (typeof window.todayISO === 'function') {
      try { return window.todayISO(); } catch (_) {}
    }
    return new Date().toISOString().slice(0, 10);
  }
  function uid(prefix) {
    if (typeof window.makeId === 'function') {
      try { return window.makeId(prefix || 'ent'); } catch (_) {}
    }
    return (prefix || 'ent') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function save() {
    if (typeof window.saveData === 'function') {
      try { window.saveData(); } catch (_) {}
    }
  }
  function toast(message, kind) {
    if (typeof window.showToast === 'function') {
      try { window.showToast(message, kind || 'info'); } catch (_) {}
    }
  }
  function currentUserName() {
    try { return window.PentagonAuth?.getCurrentUser?.()?.name || window.PentagonAuth?.currentUser?.name || 'system'; } catch (_) { return 'system'; }
  }
  function activeProfile() {
    try { if (typeof window.getActiveOrgProfile === 'function') return window.getActiveOrgProfile() || {}; } catch (_) {}
    try { if (window.TenantService?.activeProfile) return window.TenantService.activeProfile() || {}; } catch (_) {}
    const org = O().adminSettings?.organization || {};
    const companies = Array.isArray(org.companies) ? org.companies : [];
    const co = companies.find(c => c.id === org.activeCompanyId) || companies.find(c => c.isPrimary) || companies[0] || {};
    return { companyId: co.id || org.activeCompanyId || '', companyName: co.name || org.name || '', currency: org.currency || 'IQD', currencySymbol: org.currencySymbol || 'IQD' };
  }
  function stamp(record) {
    try { if (window.TenantService?.stamp) return window.TenantService.stamp(record, { collection: 'omni.enterpriseSuite' }); } catch (_) {}
    const profile = activeProfile();
    if (profile.companyId && !record.companyId) {
      record.companyId = profile.companyId;
      record.companyName = profile.companyName || '';
      record.currency = profile.currency || record.currency || 'IQD';
      record.currencySymbol = profile.currencySymbol || record.currencySymbol || '';
      record.tenantStampedAt = record.tenantStampedAt || new Date().toISOString();
    }
    return record;
  }
  function audit(page, action, detail, payload) {
    try {
      if (typeof window.recordOmniHistoryEvent === 'function') {
        window.recordOmniHistoryEvent({
          module: 'enterprise_suite',
          source: page,
          action: action,
          summary: detail,
          payload: payload || {}
        });
      }
    } catch (_) {}
    try {
      if (window.AuditService && typeof window.AuditService.createEvent === 'function') {
        window.AuditService.createEvent({ module: 'enterprise_suite', action: page + '.' + action, detail: detail, user: currentUserName(), payload: payload || {} });
      }
    } catch (_) {}
  }

  const STATUS = [
    ['open', 'Open'],
    ['review', 'Review'],
    ['approved', 'Approved'],
    ['blocked', 'Blocked'],
    ['done', 'Done']
  ];
  const STATUS_LABEL = Object.fromEntries(STATUS);
  const STATUS_CLASS = { open: 'warn', review: 'warn', approved: 'ok', blocked: 'bad', done: 'ok' };

  const PAGES = {
    banking: {
      title: 'Banking / Treasury',
      body: 'bankingBody',
      pageId: 'pageBanking',
      navId: 'navBanking',
      icon: 'fa-building-columns',
      subject: 'bank account or reconciliation item',
      fields: [
        ['name', 'Account / item', 'text'],
        ['party', 'Bank / owner', 'text'],
        ['amount', 'Balance / exposure', 'number'],
        ['date', 'Statement date', 'date'],
        ['status', 'Status', 'select'],
        ['note', 'Control note', 'text']
      ],
      kpis: bankingKpis,
      recommendations: bankingRecommendations,
      demo: [
        { name: 'Main cash bank', party: 'Local bank', amount: 1250000, date: todayISO(), status: 'open', note: 'Needs first statement import' },
        { name: 'June reconciliation', party: 'Treasury', amount: 0, date: todayISO(), status: 'review', note: 'Match cashbox and bank lines' }
      ]
    },
    ar_ap: {
      title: 'AR / AP Workbench',
      body: 'arApBody',
      pageId: 'pageArAp',
      navId: 'navArAp',
      icon: 'fa-file-invoice-dollar',
      subject: 'receivable or payable action',
      fields: [
        ['name', 'Invoice / promise', 'text'],
        ['party', 'Customer / supplier', 'text'],
        ['amount', 'Amount', 'number'],
        ['date', 'Due date', 'date'],
        ['status', 'Status', 'select'],
        ['note', 'Next collection/payment action', 'text']
      ],
      kpis: arApKpis,
      recommendations: arApRecommendations,
      demo: [
        { name: 'فاتورة توريد خامات الحديد #1102', party: 'الشركة العامة للحديد والصلب', amount: 1450000, date: plusDays(5), status: 'open', note: 'مستحقة للمورد' },
        { name: 'دفعة صيانة المخرطة الدورية', party: 'شركة الرافدين للتكنولوجيا', amount: 250000, date: plusDays(10), status: 'open', note: 'فاتورة صيانة كهروميكانيكية' },
        { name: 'فاتورة شراء قرطاسية مكتبية', party: 'تجهيزات مكتب باب بابل', amount: 45000, date: plusDays(-2), status: 'review', note: 'شراء لوازم مكتبية معلقة' }
      ]
    },
    contracts: {
      title: 'Contracts / Legal',
      body: 'contractsBody',
      pageId: 'pageContracts',
      navId: 'navContracts',
      icon: 'fa-file-signature',
      subject: 'contract',
      fields: [
        ['name', 'Contract title', 'text'],
        ['party', 'Counterparty', 'text'],
        ['amount', 'Value', 'number'],
        ['date', 'Renewal / expiry', 'date'],
        ['status', 'Status', 'select'],
        ['note', 'Obligation / clause note', 'text']
      ],
      kpis: contractsKpis,
      recommendations: contractsRecommendations,
      demo: [
        { name: 'Annual maintenance contract', party: 'Key customer', amount: 1200000, date: todayISO(), status: 'review', note: 'Add SLA and renewal reminder' }
      ]
    },
    logistics: {
      title: 'Logistics / Delivery',
      body: 'logisticsBody',
      pageId: 'pageLogistics',
      navId: 'navLogistics',
      icon: 'fa-truck-fast',
      subject: 'delivery',
      fields: [
        ['name', 'Delivery / shipment ref', 'text'],
        ['party', 'Customer / destination', 'text'],
        ['amount', 'COD / fee', 'number'],
        ['date', 'Delivery date', 'date'],
        ['status', 'Status', 'select'],
        ['note', 'Driver / proof / exception', 'text']
      ],
      kpis: logisticsKpis,
      recommendations: logisticsRecommendations,
      demo: [
        { name: 'WO-2026-904', party: 'أبو فهد - سائق شاحنة 1', amount: 350000, date: todayISO(), status: 'review', note: 'مطعم الزاد (مستعجل)', sourceKey: 'wo-delivery:WO-2026-904' },
        { name: 'WO-2026-902', party: 'غير معين', amount: 500000, date: todayISO(), status: 'open', note: 'عميل تجريبي (عادي)', sourceKey: 'wo-delivery:WO-2026-902' }
      ]
    },
    supplier_portal: {
      title: 'Supplier Portal',
      body: 'supplierPortalBody',
      pageId: 'pageSupplierPortal',
      navId: 'navSupplierPortal',
      icon: 'fa-handshake-angle',
      subject: 'supplier packet',
      fields: [
        ['name', 'RFQ / supplier packet', 'text'],
        ['party', 'Supplier', 'text'],
        ['amount', 'Quoted amount', 'number'],
        ['date', 'Promise date', 'date'],
        ['status', 'Status', 'select'],
        ['note', 'Comparison / SLA note', 'text']
      ],
      kpis: supplierKpis,
      recommendations: supplierRecommendations,
      demo: [
        { name: 'Low-stock RFQ packet', party: 'Supplier shortlist', amount: 0, date: todayISO(), status: 'open', note: 'Send quantities and required delivery date' }
      ]
    },
    integration_hub: {
      title: 'Integration Hub',
      body: 'integrationHubBody',
      pageId: 'pageIntegrationHub',
      navId: 'navIntegrationHub',
      icon: 'fa-plug-circle-bolt',
      subject: 'integration',
      fields: [
        ['name', 'Connector', 'text'],
        ['party', 'Provider / channel', 'text'],
        ['amount', 'Pending / errors', 'number'],
        ['date', 'Last checked', 'date'],
        ['status', 'Status', 'select'],
        ['note', 'Endpoint / retry note', 'text']
      ],
      kpis: integrationKpis,
      recommendations: integrationRecommendations,
      demo: [
        { name: 'WhatsApp Business API', party: 'Meta', amount: 0, date: todayISO(), status: 'review', note: 'Requires HTTPS and production tokens' },
        { name: 'Email/SMS channel', party: 'Future connector', amount: 0, date: todayISO(), status: 'open', note: 'Add provider and retry queue' }
      ]
    },
    security_center: {
      title: 'Audit / Security Center',
      body: 'securityCenterBody',
      pageId: 'pageSecurityCenter',
      navId: 'navSecurityCenter',
      icon: 'fa-user-shield',
      subject: 'security review item',
      fields: [
        ['name', 'Control / risk', 'text'],
        ['party', 'Owner', 'text'],
        ['amount', 'Risk score', 'number'],
        ['date', 'Review date', 'date'],
        ['status', 'Status', 'select'],
        ['note', 'Evidence / mitigation', 'text']
      ],
      kpis: securityKpis,
      recommendations: securityRecommendations,
      demo: [
        { name: 'Production auth boundary', party: 'System admin', amount: 90, date: todayISO(), status: 'blocked', note: 'Local-first server is not a production auth boundary' },
        { name: 'High-risk AI tools', party: 'Manager', amount: 70, date: todayISO(), status: 'review', note: 'Keep critical tools disabled unless sandbox is ready' }
      ]
    },
    data_quality: {
      title: 'Data Quality / Migration',
      body: 'dataQualityBody',
      pageId: 'pageDataQuality',
      navId: 'navDataQuality',
      icon: 'fa-database',
      subject: 'data issue',
      fields: [
        ['name', 'Issue / migration item', 'text'],
        ['party', 'Collection', 'text'],
        ['amount', 'Affected rows', 'number'],
        ['date', 'Found date', 'date'],
        ['status', 'Status', 'select'],
        ['note', 'Fix plan', 'text']
      ],
      kpis: dataQualityKpis,
      recommendations: dataQualityRecommendations,
      demo: [],
      extraActions: '<button class="ent-btn primary" onclick="entRunDataQualityScan()">Run live scan</button>'
    },
    training_lms: {
      title: 'Training / LMS',
      body: 'trainingLmsBody',
      pageId: 'pageTrainingLms',
      navId: 'navTrainingLms',
      icon: 'fa-graduation-cap',
      subject: 'training course',
      fields: [
        ['name', 'Course / certificate', 'text'],
        ['party', 'Audience / role', 'text'],
        ['amount', 'Completion %', 'number'],
        ['date', 'Due date', 'date'],
        ['status', 'Status', 'select'],
        ['note', 'SOP / machine authorization', 'text']
      ],
      kpis: trainingKpis,
      recommendations: trainingRecommendations,
      demo: [
        { name: 'Machine safety onboarding', party: 'Workshop operators', amount: 0, date: todayISO(), status: 'open', note: 'Tie completion to machine authorization' }
      ]
    },
    scenario_planner: {
      title: 'AI Scenario Planner',
      body: 'scenarioPlannerBody',
      pageId: 'pageScenarioPlanner',
      navId: 'navScenarioPlanner',
      icon: 'fa-chart-line',
      subject: 'scenario',
      fields: [
        ['name', 'Scenario name', 'text'],
        ['party', 'Focus area', 'text'],
        ['amount', 'Estimated impact', 'number'],
        ['date', 'Horizon date', 'date'],
        ['status', 'Status', 'select'],
        ['note', 'Assumption / action', 'text']
      ],
      kpis: scenarioKpis,
      recommendations: scenarioRecommendations,
      demo: [
        { name: 'Cash runway if sales slow 20%', party: 'Finance', amount: -20, date: todayISO(), status: 'review', note: 'Compare AR aging and payroll run' },
        { name: 'Material shortage pressure', party: 'Operations', amount: 0, date: todayISO(), status: 'open', note: 'Use low-stock and open jobs' }
      ]
    },
    device_center: {
      title: 'Device / IoT Center',
      body: 'deviceCenterBody',
      pageId: 'pageDeviceCenter',
      navId: 'navDeviceCenter',
      icon: 'fa-mobile-screen-button',
      subject: 'device',
      fields: [
        ['name', 'Device / endpoint', 'text'],
        ['party', 'Location / owner', 'text'],
        ['amount', 'Health %', 'number'],
        ['date', 'Last test', 'date'],
        ['status', 'Status', 'select'],
        ['note', 'QR / printer / sensor note', 'text']
      ],
      kpis: deviceKpis,
      recommendations: deviceRecommendations,
      demo: [
        { name: 'Workshop TV', party: 'Production floor', amount: 0, date: todayISO(), status: 'review', note: 'Run real-distance readability test' },
        { name: 'QR camera scanner', party: 'Mobile workers', amount: 0, date: todayISO(), status: 'open', note: 'Replace paste fallback with real scanner' }
      ]
    }
  };

  const PAGE_KEYS = Object.keys(PAGES);

  function ensureData() {
    const o = O();
    if (!o.enterpriseSuite || typeof o.enterpriseSuite !== 'object') o.enterpriseSuite = {};
    PAGE_KEYS.forEach(key => {
      if (!o.enterpriseSuite[key] || typeof o.enterpriseSuite[key] !== 'object') o.enterpriseSuite[key] = {};
      if (!Array.isArray(o.enterpriseSuite[key].records)) o.enterpriseSuite[key].records = [];
      if (!Array.isArray(o.enterpriseSuite[key].events)) o.enterpriseSuite[key].events = [];
    });
    return o.enterpriseSuite;
  }
  function hub(page) {
    return ensureData()[page];
  }
  function records(page, includeArchived) {
    const list = hub(page)?.records || [];
    let out = includeArchived ? list : list.filter(r => r.is_active !== false);
    if (typeof window.scoped === 'function') {
      try { out = window.scoped(out); } catch (_) {}
    }
    return out;
  }
  function financeDb() {
    const db = topDb();
    try { if (typeof finance !== 'undefined' && finance) return finance; } catch (_) {}
    return db.finance || O().finance || {};
  }
  function txs() {
    const f = financeDb();
    return Array.isArray(f.transactions) ? f.transactions : [];
  }
  function customers() {
    const f = financeDb();
    return Array.isArray(f.customers) ? f.customers : [];
  }
  function openStatus(record) {
    return !['done', 'closed', 'resolved', 'cancelled', 'rejected'].includes(String(record.status || '').toLowerCase());
  }
  function recStats(page) {
    const list = records(page);
    return {
      total: list.length,
      open: list.filter(openStatus).length,
      blocked: list.filter(r => r.status === 'blocked').length,
      amount: list.reduce((sum, r) => sum + money(r.amount), 0)
    };
  }
  function getPath(obj, path) {
    return String(path || '').split('.').filter(Boolean).reduce((cur, key) => cur && cur[key], obj);
  }
  function listPath(path) {
    const v = getPath(O(), path);
    return Array.isArray(v) ? v : [];
  }
  function countMissingCompanyId(paths) {
    let total = 0;
    paths.forEach(path => {
      total += listPath(path).filter(row => row && !row.companyId && !row.company_id && !row.tenantCompanyId).length;
    });
    return total;
  }
  function lowStock() {
    return (O().materials || []).filter(m => (Number(m.stock) || 0) <= (Number(m.minStock || m.minimumStock || 0) || 0));
  }
  function routeHealthSummary() {
    try {
      const rep = window.OctagonRouteHealth?.report?.();
      if (!rep) return null;
      const bad = ['nav', 'pages', 'globals', 'functions', 'collections', 'woLinks'].reduce((sum, key) => {
        return sum + (Array.isArray(rep[key]) ? rep[key].filter(x => !x.ok).length : 0);
      }, 0);
      return { bad, nav: rep.nav?.length || 0, pages: rep.pages?.length || 0 };
    } catch (_) { return null; }
  }

  function kpi(label, value, sub, cls) {
    return '<div class="ent-kpi ' + (cls || '') + '"><div class="ent-kpi-value">' + esc(value) + '</div><div class="ent-kpi-label">' + esc(label) + '</div>' + (sub ? '<div class="ent-kpi-sub">' + esc(sub) + '</div>' : '') + '</div>';
  }
  function genericKpis(page) {
    const s = recStats(page);
    return [
      ['Records', s.total, s.open + ' open', ''],
      ['Open value', fmt(s.amount), 'manual register', ''],
      ['Blocked', s.blocked, 'needs manager', s.blocked ? 'bad' : ''],
      ['Company', activeProfile().companyName || 'Default', activeProfile().currency || 'IQD', '']
    ];
  }
  function bankingKpis() {
    const s = recStats('banking');
    const income = txs().filter(t => t.direction === 'in').reduce((sum, t) => sum + money(t.amount), 0);
    const out = txs().filter(t => t.direction === 'out').reduce((sum, t) => sum + money(t.amount), 0);
    return [
      ['Treasury items', s.total, s.open + ' open', ''],
      ['Cash movement net', fmt(income - out), 'from finance transactions', income - out < 0 ? 'bad' : ''],
      ['Bank accounts', records('banking').filter(r => /bank|cash/i.test(r.name || '')).length, 'registered here', ''],
      ['Reconciliation', records('banking').some(r => /recon/i.test(r.name || '')) ? 'Started' : 'Missing', 'statement workflow', records('banking').some(r => /recon/i.test(r.name || '')) ? 'ok' : 'warn']
    ];
  }
  function arApKpis() {
    const receivable = txs().filter(t => t.type === 'customer_charge').reduce((sum, t) => sum + money(t.amount), 0);
    const payments = txs().filter(t => t.type === 'income' || t.type === 'sales_receipt').reduce((sum, t) => sum + money(t.amount), 0);
    return [
      ['AR exposure', fmt(Math.max(0, receivable - payments)), 'rough live balance', receivable > payments ? 'warn' : 'ok'],
      ['Customers', customers().length, 'finance registry', ''],
      ['Workbench rows', recStats('ar_ap').total, recStats('ar_ap').open + ' open', ''],
      ['Payment runs', records('ar_ap').filter(r => /payment|vendor|payable/i.test((r.name || '') + (r.note || ''))).length, 'manual queue', '']
    ];
  }
  function contractsKpis() {
    const expiring = records('contracts').filter(r => r.date && r.date <= plusDays(30)).length;
    const linked = records('contracts').filter(r => r.linkedDocId).length;
    return [
      ['Contracts', recStats('contracts').total, recStats('contracts').open + ' active/review', ''],
      ['Expiring 30d', expiring, 'renewal risk', expiring ? 'warn' : 'ok'],
      ['Linked docs', linked, 'linked with DMS', linked === recStats('contracts').total ? 'ok' : 'warn'],
      ['Value tracked', fmt(recStats('contracts').amount), 'manual contract value', '']
    ];
  }
  function logisticsKpis() {
    const delivered = (O().jobOrders || []).filter(w => ['delivered', 'closed'].includes(w.state)).length;
    return [
      ['Shipments', recStats('logistics').total, recStats('logistics').open + ' open', ''],
      ['Delivered jobs', delivered, 'workshop source', ''],
      ['Field visits', (O().fieldService?.visits || []).length, 'field-service source', ''],
      ['COD tracked', fmt(recStats('logistics').amount), 'manual COD/fees', '']
    ];
  }
  function supplierKpis() {
    return [
      ['Suppliers', (O().suppliers || []).length, 'live supplier registry', ''],
      ['Open POs', (O().purchaseOrders || []).filter(p => !['cancelled', 'received', 'done'].includes(p.status)).length, 'procurement source', ''],
      ['Portal packets', recStats('supplier_portal').total, recStats('supplier_portal').open + ' open', ''],
      ['Low stock', lowStock().length, 'RFQ trigger candidates', lowStock().length ? 'warn' : 'ok']
    ];
  }
  function integrationKpis() {
    const ai = O().aiProviders || [];
    const wa = (O().whatsappSuggestions || []).filter(x => x.status === 'pending_review').length;
    return [
      ['Connectors', recStats('integration_hub').total, 'manual registry', ''],
      ['WhatsApp pending', wa, 'inbound suggestions', wa ? 'warn' : 'ok'],
      ['AI providers', Array.isArray(ai) ? ai.length : 0, 'provider descriptors', ''],
      ['Webhook secret', 'Env', 'WHATSAPP_APP_SECRET required', 'warn']
    ];
  }
  function securityKpis() {
    const tools = O().aiToolRegistry || [];
    const criticalEnabled = tools.filter(t => t.enabled && ['high', 'critical'].includes(t.riskLevel)).length;
    return [
      ['Audit events', (O().aiAuditLog || []).length + (O().historyLedger || []).length, 'AI + history ledger', ''],
      ['Critical AI enabled', criticalEnabled, 'should stay low', criticalEnabled ? 'bad' : 'ok'],
      ['Users', (O().users || []).length, 'admin panel', ''],
      ['Open controls', recStats('security_center').open, 'security register', recStats('security_center').open ? 'warn' : 'ok']
    ];
  }
  function dataQualityKpis() {
    const scan = scanDataQuality();
    return [
      ['Live issues', scan.length, 'current scan', scan.length ? 'warn' : 'ok'],
      ['Saved issues', recStats('data_quality').total, recStats('data_quality').open + ' open', ''],
      ['Missing companyId', scan.filter(x => /companyId/.test(x.name)).reduce((s, x) => s + x.amount, 0), 'tenant collections', 'warn'],
      ['Route health', routeHealthSummary()?.bad || 0, 'diagnostic failures', routeHealthSummary()?.bad ? 'bad' : 'ok']
    ];
  }
  function trainingKpis() {
    const totalEmployees = Array.isArray(window.employees) ? window.employees.length : (topDb().employees || []).length;
    return [
      ['Courses', recStats('training_lms').total, recStats('training_lms').open + ' open', ''],
      ['Employees', totalEmployees, 'training audience', ''],
      ['SOPs', (O().sops || []).length, 'training source', ''],
      ['Avg completion', average(records('training_lms').map(r => money(r.amount))) + '%', 'manual courses', '']
    ];
  }
  function scenarioKpis() {
    const openJobs = (O().jobOrders || []).filter(w => !['closed', 'delivered', 'cancelled'].includes(w.state)).length;
    return [
      ['Scenarios', recStats('scenario_planner').total, recStats('scenario_planner').open + ' active', ''],
      ['Open jobs', openJobs, 'capacity driver', openJobs > 5 ? 'warn' : ''],
      ['Low stock', lowStock().length, 'material risk', lowStock().length ? 'warn' : 'ok'],
      ['Cash net', fmt(txs().reduce((s, t) => s + (t.direction === 'in' ? money(t.amount) : t.direction === 'out' ? -money(t.amount) : 0), 0)), 'rough runway input', '']
    ];
  }
  function deviceKpis() {
    return [
      ['Devices', recStats('device_center').total, recStats('device_center').open + ' open', ''],
      ['Mobile mode', document.getElementById('pageEmployeeMobile') ? 'Ready' : 'Missing', 'employee mobile page', document.getElementById('pageEmployeeMobile') ? 'ok' : 'bad'],
      ['TV mode', document.getElementById('pageWorkshopTv') ? 'Ready' : 'Missing', 'workshop TV page', document.getElementById('pageWorkshopTv') ? 'ok' : 'bad'],
      ['Real QR camera', 'Pending', 'paste fallback still exists', 'warn']
    ];
  }
  function average(values) {
    const nums = values.filter(v => isFinite(v));
    if (!nums.length) return 0;
    return Math.round(nums.reduce((s, v) => s + v, 0) / nums.length);
  }
  function plusDays(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function reco(sev, title, detail) {
    return { sev, title, detail };
  }
  function genericRecommendations(page) {
    const cfg = PAGES[page];
    const s = recStats(page);
    const arr = [];
    if (!s.total) arr.push(reco('warn', 'Create the first ' + cfg.subject, 'This tab is wired and ready; start by registering the control item that used to live outside the ERP.'));
    if (s.blocked) arr.push(reco('bad', 'Resolve blocked items', s.blocked + ' blocked rows need manager attention.'));
    arr.push(reco('ok', 'Use this as the control front door', 'Every row saved here is durable under omni.enterpriseSuite.' + page + '.records.'));
    return arr;
  }
  function bankingRecommendations() {
    const arr = genericRecommendations('banking');
    if (!records('banking').some(r => /recon/i.test((r.name || '') + (r.note || '')))) arr.unshift(reco('warn', 'Add monthly reconciliation', 'Banking needs statement import and match workflow before online launch.'));
    return arr;
  }
  function arApRecommendations() {
    const arr = genericRecommendations('ar_ap');
    if (customers().length && !records('ar_ap').length) arr.unshift(reco('warn', 'Build collection queue', 'Customer balances exist; create promises, aging follow-ups, and payment runs here.'));
    return arr;
  }
  function contractsRecommendations() {
    const arr = genericRecommendations('contracts');
    arr.unshift(reco('warn', 'Connect DMS to contracts', 'Use Documents for attachments, then track renewal and obligation owners here.'));
    return arr;
  }
  function logisticsRecommendations() {
    const arr = genericRecommendations('logistics');
    arr.unshift(reco('warn', 'Add proof-of-delivery gate', 'Delivered workshop jobs should create delivery rows with driver, timestamp, and recipient proof.'));
    return arr;
  }
  function supplierRecommendations() {
    const arr = genericRecommendations('supplier_portal');
    if (lowStock().length) arr.unshift(reco('bad', 'Send low-stock RFQs', lowStock().length + ' materials are at or below minimum stock.'));
    return arr;
  }
  function integrationRecommendations() {
    return [
      reco('warn', 'Production HTTPS required', 'WhatsApp live webhooks need HTTPS termination and real Meta tokens.'),
      reco('warn', 'Keep send actions approval-gated', 'Outbound WhatsApp/email/SMS should stay draft or approval queued until operator confirms.'),
      ...genericRecommendations('integration_hub')
    ];
  }
  function securityRecommendations() {
    return [
      reco('bad', 'Local-first is not production auth', 'Do not expose the raw local server to the internet without a proper auth/TLS boundary.'),
      reco('warn', 'Run permission simulation before launch', 'Review finance/payroll/admin access with manager and employee roles.'),
      ...genericRecommendations('security_center')
    ];
  }
  function dataQualityRecommendations() {
    const scan = scanDataQuality();
    return scan.length ? scan.slice(0, 6).map(x => reco(x.status === 'blocked' ? 'bad' : 'warn', x.name, x.note)) : [reco('ok', 'No live scan issues found', 'The current quick scan did not find obvious duplicates, missing company IDs, or route-health failures.')];
  }
  function trainingRecommendations() {
    return [
      reco('warn', 'Tie SOPs to training', 'Every critical SOP should have a quiz and certificate before a worker can run a machine.'),
      reco('warn', 'Add machine authorization', 'Use course completion to decide who can operate each machine.'),
      ...genericRecommendations('training_lms')
    ];
  }
  function scenarioRecommendations() {
    return [
      reco('warn', 'Run cash + stock scenario weekly', 'Use AR/AP, payroll, low-stock, and open jobs as scenario drivers.'),
      reco('ok', 'Keep AI propose-only', 'Scenario planner should recommend actions, then route sensitive actions to approvals.'),
      ...genericRecommendations('scenario_planner')
    ];
  }
  function deviceRecommendations() {
    return [
      reco('warn', 'Replace QR paste fallback', 'Add real camera scanning for worker mobile flows.'),
      reco('warn', 'Run physical device QA', 'Test iPhone, Android, TV, kiosk, barcode scanner, and receipt printer on the workshop network.'),
      ...genericRecommendations('device_center')
    ];
  }

  const DEPARTMENT_META = {
    banking: { owner: 'Finance / Treasury', sourcePage: 'finance', sourceLabel: 'Finance ledger', taskDepartment: 'Finance' },
    ar_ap: { owner: 'Finance / Collections', sourcePage: 'customers', sourceLabel: 'Customer balances', taskDepartment: 'Finance' },
    contracts: { owner: 'Legal / Admin', sourcePage: 'documents', sourceLabel: 'Documents and DMS', taskDepartment: 'Legal' },
    logistics: { owner: 'Dispatch / Operations', sourcePage: 'work_orders', sourceLabel: 'Work orders and field visits', taskDepartment: 'Logistics' },
    supplier_portal: { owner: 'Procurement', sourcePage: 'procurement', sourceLabel: 'Procurement and inventory', taskDepartment: 'Procurement' },
    integration_hub: { owner: 'IT / Integrations', sourcePage: 'whatsapp', sourceLabel: 'Connectors and channels', taskDepartment: 'IT' },
    security_center: { owner: 'Admin / Security', sourcePage: 'admin_panel', sourceLabel: 'Permissions and audit', taskDepartment: 'Security' },
    data_quality: { owner: 'Data / Tenant Admin', sourcePage: 'multi_entity', sourceLabel: 'Tenant isolation and route health', taskDepartment: 'Data Quality' },
    training_lms: { owner: 'HR / Operations', sourcePage: 'sop', sourceLabel: 'SOP and people operations', taskDepartment: 'Training' },
    scenario_planner: { owner: 'Executive Planning', sourcePage: 'analytics', sourceLabel: 'Analytics and constraints', taskDepartment: 'Planning' },
    device_center: { owner: 'IT / Frontline Operations', sourcePage: 'deploy_ready', sourceLabel: 'Launch readiness and frontline devices', taskDepartment: 'IT' }
  };

  function departmentMeta(page) {
    return DEPARTMENT_META[page] || { owner: 'Management', sourcePage: page, sourceLabel: 'Live ERP data', taskDepartment: 'Management' };
  }
  function sourceKey(row, fallback) {
    return row.sourceKey || row.id || fallback || (row.name + ':' + row.party);
  }
  function customerBalance(customer) {
    try { if (typeof window.getCustomerBalance === 'function') return money(window.getCustomerBalance(customer)); } catch (_) {}
    const id = customer && customer.id;
    if (!id) return 0;
    return txs().reduce((sum, tx) => {
      if (tx.customerId !== id) return sum;
      if (tx.type === 'customer_charge') return sum + money(tx.amount);
      if (tx.direction === 'in') return sum - money(tx.amount);
      return sum;
    }, 0);
  }
  function activeJobOrders() {
    return (O().jobOrders || []).filter(w => w && w.is_active !== false);
  }
  function pushSignal(out, row) {
    out.push({
      name: row.name || 'Department signal',
      party: row.party || '',
      amount: money(row.amount),
      date: row.date || todayISO(),
      status: row.status || 'review',
      note: row.note || '',
      source: 'department_signal',
      sourceKey: sourceKey(row)
    });
  }
  function departmentSignals(page) {
    const out = [];
    if (page === 'banking') {
      const rows = txs();
      const cashNet = rows.reduce((sum, tx) => sum + (tx.direction === 'in' ? money(tx.amount) : tx.direction === 'out' ? -money(tx.amount) : 0), 0);
      pushSignal(out, { sourceKey: 'banking:cash-movement', name: 'Monthly cash movement reconciliation', party: 'Finance ledger', amount: Math.abs(cashNet), status: rows.length ? 'review' : 'open', note: rows.length + ' finance movements need statement matching and bank proof.' });
      if (!records('banking').some(r => /statement|bank import/i.test((r.name || '') + (r.note || '')))) {
        pushSignal(out, { sourceKey: 'banking:statement-import', name: 'Bank statement import template', party: 'Treasury', amount: 0, status: 'open', note: 'Define CSV columns, opening balance, and unmatched-line review before online launch.' });
      }
    } else if (page === 'ar_ap') {
      customers().map(c => ({ c, balance: customerBalance(c) })).filter(x => x.balance > 0).sort((a, b) => b.balance - a.balance).slice(0, 8).forEach(x => {
        pushSignal(out, { sourceKey: 'ar:' + x.c.id, name: 'Collect customer balance', party: x.c.name || x.c.companyName || 'Customer', amount: x.balance, status: 'open', note: 'Create call promise, payment date, or escalation from live customer balance.' });
      });
      const payables = txs().filter(tx => /vendor|supplier|payable|purchase/i.test((tx.type || '') + ' ' + (tx.description || '')) && tx.direction !== 'in');
      if (payables.length) pushSignal(out, { sourceKey: 'ap:payment-run', name: 'Supplier payment run review', party: 'Accounts payable', amount: payables.reduce((s, tx) => s + money(tx.amount), 0), status: 'review', note: payables.length + ' payable-like movements need payment-run review.' });
    } else if (page === 'contracts') {
      (O().documents?.docs || []).filter(d => /contract|license|agreement|عقد|رخص/i.test((d.type || '') + ' ' + (d.name || '') + ' ' + (d.title || ''))).slice(0, 8).forEach(d => {
        pushSignal(out, { sourceKey: 'doc:' + (d.id || d.name), name: d.title || d.name || 'Document contract', party: d.owner || d.party || 'DMS', amount: money(d.value || d.amount), date: d.expiryDate || d.validTo || d.date || todayISO(), status: 'review', note: 'Confirm renewal owner, obligation checklist, and attachment completeness.' });
      });
      if (!out.length) pushSignal(out, { sourceKey: 'contracts:dms-link', name: 'Contract attachment policy', party: 'Legal / DMS', amount: 0, status: 'open', note: 'Every contract should have document attachment, renewal date, owner, and obligation checklist.' });
    } else if (page === 'logistics') {
      activeJobOrders().filter(w => ['ready_for_delivery', 'delivery_ready', 'qc_passed', 'done', 'delivered'].includes(String(w.state || w.status || '').toLowerCase())).slice(0, 8).forEach(w => {
        pushSignal(out, { sourceKey: 'wo-delivery:' + w.id, name: 'Proof-of-delivery for ' + (w.ref || w.reference || w.title || w.id), party: w.customerSnapshot?.name || w.customerName || 'Customer', amount: money(w.price || w.total || w.amount), date: w.dueDate || todayISO(), status: String(w.state || '').toLowerCase() === 'delivered' ? 'review' : 'open', note: 'Assign driver, capture recipient proof, delivery timestamp, and COD status.' });
      });
      (O().fieldService?.visits || []).filter(v => !['done', 'completed', 'cancelled'].includes(String(v.status || '').toLowerCase())).slice(0, 4).forEach(v => {
        pushSignal(out, { sourceKey: 'field-visit:' + v.id, name: 'Field visit dispatch', party: v.customerName || v.customer || 'Field service', amount: money(v.amount || v.fee), date: v.date || v.scheduledDate || todayISO(), status: 'open', note: 'Coordinate technician, route, parts, and customer confirmation.' });
      });
    } else if (page === 'supplier_portal') {
      lowStock().slice(0, 10).forEach(m => {
        const min = money(m.minStock || m.minimumStock || m.minimum || 0);
        const stock = money(m.stock || m.qty || m.quantity || 0);
        pushSignal(out, { sourceKey: 'low-stock:' + (m.id || m.name), name: 'RFQ for ' + (m.name || m.material || 'material'), party: m.preferredSupplier || 'Supplier shortlist', amount: Math.max(0, min - stock), status: 'open', note: 'Current stock ' + stock + ', minimum ' + min + '. Request quote, lead time, and substitution options.' });
      });
      (O().purchaseOrders || []).filter(po => !['received', 'done', 'cancelled'].includes(String(po.status || '').toLowerCase())).slice(0, 5).forEach(po => {
        pushSignal(out, { sourceKey: 'po-followup:' + po.id, name: 'PO supplier follow-up', party: po.supplierName || po.supplier || 'Supplier', amount: money(po.total || po.amount), date: po.expectedDate || po.date || todayISO(), status: 'review', note: 'Confirm delivery promise, partial receipt, and invoice matching.' });
      });
    } else if (page === 'integration_hub') {
      [
        ['integration:whatsapp', 'WhatsApp Business production webhook', 'Meta / HTTPS', 'review', 'Needs HTTPS endpoint, app secret, production token, media download policy.'],
        ['integration:email-sms', 'Email/SMS notification connector', 'Messaging provider', 'open', 'Define provider, retry queue, unsubscribe rules, and approval gate for outbound messages.'],
        ['integration:backup', 'Backup/export monitor', 'Local server', 'review', 'Verify scheduled backup, restore drill, and off-device copy before launch.']
      ].forEach(([key, name, party, status, note]) => pushSignal(out, { sourceKey: key, name, party, status, note }));
    } else if (page === 'security_center') {
      const rh = routeHealthSummary();
      if (rh && rh.bad) pushSignal(out, { sourceKey: 'security:route-health', name: 'Route Health failures', party: 'System integrity', amount: rh.bad, status: 'blocked', note: 'Fix broken nav/page/function/collection checks before readiness.' });
      const critical = (O().aiToolRegistry || []).filter(t => t.enabled && ['high', 'critical'].includes(t.riskLevel));
      if (critical.length) pushSignal(out, { sourceKey: 'security:critical-ai-tools', name: 'Critical AI tools enabled', party: 'AI Governance', amount: critical.length, status: 'blocked', note: 'Disable or approval-gate critical tools until sandbox architecture is ready.' });
      pushSignal(out, { sourceKey: 'security:production-boundary', name: 'Production auth/TLS boundary', party: 'Admin / IT', amount: 90, status: 'blocked', note: 'Do not expose the local Node server directly; place it behind real auth, TLS, logs, and backups.' });
    } else if (page === 'data_quality') {
      scanDataQuality().forEach(row => pushSignal(out, { ...row, sourceKey: 'dq:' + row.name + ':' + row.party }));
    } else if (page === 'training_lms') {
      (O().sops || []).slice(0, 6).forEach(s => pushSignal(out, { sourceKey: 'sop-training:' + (s.id || s.title), name: 'Training for SOP: ' + (s.title || s.name || 'SOP'), party: s.department || 'Operations', amount: 0, status: 'open', note: 'Create course, quiz, sign-off, and retraining interval for this SOP.' }));
      (O().machines || []).filter(m => m.status === 'active' || m.is_active !== false).slice(0, 4).forEach(m => pushSignal(out, { sourceKey: 'machine-auth:' + (m.id || m.name), name: 'Machine authorization: ' + (m.name || 'machine'), party: 'Workshop operators', amount: 0, status: 'review', note: 'Require training completion before operating this machine.' }));
    } else if (page === 'scenario_planner') {
      const openJobs = activeJobOrders().filter(w => !['closed', 'delivered', 'cancelled'].includes(String(w.state || w.status || '').toLowerCase())).length;
      const netCash = txs().reduce((s, t) => s + (t.direction === 'in' ? money(t.amount) : t.direction === 'out' ? -money(t.amount) : 0), 0);
      pushSignal(out, { sourceKey: 'scenario:cash-runway', name: 'Cash runway under slower collections', party: 'Finance', amount: netCash, status: 'review', note: 'Model payroll, AR collection delay, and supplier payments for the next 30 days.' });
      pushSignal(out, { sourceKey: 'scenario:materials', name: 'Material shortage pressure', party: 'Operations', amount: lowStock().length, status: lowStock().length ? 'review' : 'open', note: 'Simulate open jobs if low-stock items are not replenished.' });
      pushSignal(out, { sourceKey: 'scenario:capacity', name: 'Workshop capacity and delivery pressure', party: 'Operations', amount: openJobs, status: openJobs > 5 ? 'review' : 'open', note: 'Use open jobs, machine load, and logistics queue to estimate bottlenecks.' });
    } else if (page === 'device_center') {
      [
        ['device:mobile', 'Employee mobile workflow', 'Workers', document.getElementById('pageEmployeeMobile') ? 'review' : 'blocked', 'Test on real Android/iPhone with role permissions and problem button.'],
        ['device:tv', 'Workshop TV display', 'Production floor', document.getElementById('pageWorkshopTv') ? 'review' : 'blocked', 'Test readability from workshop distance and refresh stability.'],
        ['device:kiosk', 'Kiosk / voice station', 'Front desk', document.getElementById('pageKiosk') ? 'review' : 'blocked', 'Test microphone, language switch, and fallback commands.'],
        ['device:printer', 'Receipt / traveller card printer', 'Admin office', 'open', 'Run physical print test for receipts, delivery notes, and traveller card.'],
        ['device:scanner', 'Barcode / QR camera scanner', 'Inventory / mobile', 'open', 'Replace paste fallback with camera or hardware scanner test.']
      ].forEach(([key, name, party, status, note]) => pushSignal(out, { sourceKey: key, name, party, status, note }));
    }
    return out;
  }

  function renderDepartmentOps(page) {
    const meta = departmentMeta(page);
    const signals = departmentSignals(page);
    const existing = new Set(records(page, true).map(r => r.sourceKey).filter(Boolean));
    const newCount = signals.filter(s => !existing.has(s.sourceKey)).length;
    const preview = signals.slice(0, 4).map(s => '<div class="ent-signal-card"><b>' + esc(s.name) + '</b><span>' + esc(s.party || meta.owner) + '</span><em>' + esc(s.note || '') + '</em></div>').join('');
    return '<section class="ent-panel ent-dept-panel"><div class="ent-panel-head"><div><h3>Department Operating Bridge</h3><p>' + esc(meta.owner) + ' · source: ' + esc(meta.sourceLabel) + '</p></div><div class="ent-actions">'
      + '<button class="ent-btn primary" onclick="entImportDepartmentSignals(\'' + esc(page) + '\')">Pull live signals</button>'
      + '<button class="ent-btn" onclick="entOpenDepartmentSource(\'' + esc(page) + '\')">Open source</button>'
      + '<button class="ent-btn" onclick="entCreateTask(\'' + esc(page) + '\')">Create follow-up</button>'
      + '</div></div><div class="ent-signal-strip"><span class="ent-chip ' + (newCount ? 'warn' : 'ok') + '">' + newCount + ' new signal(s)</span><span class="ent-chip">' + signals.length + ' live candidate(s)</span></div>'
      + '<div class="ent-signal-grid">' + (preview || '<div class="ent-empty">No live signals found for this department right now.</div>') + '</div></section>';
  }

  function importDepartmentSignals(page) {
    const cfg = PAGES[page];
    if (!cfg) return 0;
    const existing = new Set(records(page, true).map(r => r.sourceKey).filter(Boolean));
    const rows = departmentSignals(page).filter(row => !existing.has(row.sourceKey));
    rows.forEach(row => {
      hub(page).records.unshift(stamp({
        id: uid('ent'),
        ...row,
        is_active: true,
        createdAt: new Date().toISOString(),
        createdBy: currentUserName()
      }));
    });
    if (rows.length) {
      hub(page).events.unshift({ at: new Date().toISOString(), action: 'department_signals_import', count: rows.length, by: currentUserName() });
      audit(page, 'department_signals_import', cfg.title + ': imported ' + rows.length + ' live signal(s)', { count: rows.length });
      save();
    }
    return rows.length;
  }

  function scanDataQuality() {
    const issues = [];
    const tenantPaths = ['materials', 'suppliers', 'purchaseOrders', 'jobOrders', 'approvalHub.requests', 'helpdesk.tickets', 'fieldService.visits', 'projectHub.projects', 'assetRegister.assets', 'subscriptionHub.subscriptions', 'rentalHub.agreements', 'fleet.vehicles', 'documents.docs', 'marketing.campaigns', 'budgeting.lines', 'warrantyHub.warranties'];
    const missingCompany = countMissingCompanyId(tenantPaths);
    if (missingCompany) issues.push({ name: 'Missing companyId on legacy records', party: 'tenant collections', amount: missingCompany, status: 'review', note: 'Use Multi-Entity isolation tab or deliberate backfill before strict tenant launch.' });
    const names = customers().map(c => String(c.name || '').trim().toLowerCase()).filter(Boolean);
    const dupCustomers = names.filter((n, i) => names.indexOf(n) !== i).length;
    if (dupCustomers) issues.push({ name: 'Duplicate customer names', party: 'finance.customers', amount: dupCustomers, status: 'review', note: 'Merge or mark canonical customer records before customer portal expansion.' });
    const low = lowStock().length;
    if (low) issues.push({ name: 'Low-stock master data needs replenishment', party: 'materials', amount: low, status: 'open', note: 'Route low-stock rows to Supplier Portal / Procurement.' });
    const rh = routeHealthSummary();
    if (rh && rh.bad) issues.push({ name: 'Route Health failures', party: 'route_health', amount: rh.bad, status: 'blocked', note: 'Run Route Health and fix broken nav/page/function checks.' });
    const pendingAi = (O().aiControl?.actionQueue || []).filter(a => a.status === 'pending' || a.status === 'proposed').length;
    if (pendingAi) issues.push({ name: 'Pending AI approvals', party: 'ai_queue', amount: pendingAi, status: 'review', note: 'Approve or reject before operational close.' });
    return issues;
  }

  function renderKpis(page) {
    const cfg = PAGES[page];
    const rows = (cfg.kpis ? cfg.kpis() : genericKpis(page));
    return '<div class="ent-kpi-grid">' + rows.map(r => kpi(r[0], r[1], r[2], r[3])).join('') + '</div>';
  }
  function renderRecommendations(page) {
    const cfg = PAGES[page];
    const rows = (cfg.recommendations ? cfg.recommendations() : genericRecommendations(page));
    return '<div class="ent-reco-list">' + rows.map(r => '<div class="ent-reco"><span class="ent-chip ' + esc(r.sev || 'warn') + '">' + esc((r.sev || 'info').toUpperCase()) + '</span><div><b>' + esc(r.title) + '</b><span>' + esc(r.detail) + '</span></div></div>').join('') + '</div>';
  }
  function renderTable(page) {
    const list = records(page).slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    if (!list.length) return '<div class="ent-empty">No records yet. Use the form on the right to create the first control row.</div>';
    
    let headerHtml = '<th>Name</th><th>Party</th><th>Amount</th><th>Date</th><th>Status</th><th>Note</th>';
    if (page === 'contracts') {
      headerHtml = '<th>Name</th><th>Party</th><th>Value</th><th>Renewal Date</th><th>Attachment</th><th>Status</th><th>Note</th>';
    }
    
    return '<table class="ent-table"><thead><tr>' + headerHtml + '<th></th></tr></thead><tbody>' + list.map(r => {
      let attachmentHtml = '';
      if (page === 'contracts') {
        if (r.linkedDocId) {
          attachmentHtml = `<td><span class="attachment-badge" onclick="entShowContractDocPreview('${r.linkedDocId}')"><i class="fa-solid fa-paperclip"></i> وثيقة DMS</span></td>`;
        } else {
          attachmentHtml = `<td><span class="attachment-missing" onclick="entOpenLinkDocModal('${r.id}')"><i class="fa-solid fa-circle-plus"></i> ربط وثيقة</span></td>`;
        }
      }
      
      const statusSelect = '<td><select class="ent-input" onchange="entSetStatus(\'' + esc(page) + '\',\'' + esc(r.id) + '\',this.value)">' + STATUS.map(([k, label]) => '<option value="' + k + '" ' + (r.status === k ? 'selected' : '') + '>/' + label + '</option>').join('') + '</select></td>';
      // Wait, let's keep the label without prepended slash unless originally there. It was map(([k, label]) => ... label ...)
      
      let rowHtml = '<td><strong>' + esc(r.name || '-') + '</strong><div class="ent-muted">' + esc(r.id || '') + '</div></td>'
        + '<td>' + esc(r.party || '-') + '</td>'
        + '<td>' + fmt(r.amount) + '</td>'
        + '<td>' + esc(r.date || '-') + '</td>'
        + (page === 'contracts' ? attachmentHtml : '')
        + '<td><select class="ent-input" onchange="entSetStatus(\'' + esc(page) + '\',\'' + esc(r.id) + '\',this.value)">' + STATUS.map(([k, label]) => '<option value="' + k + '" ' + (r.status === k ? 'selected' : '') + '>' + label + '</option>').join('') + '</select></td>'
        + '<td class="ent-muted">' + esc(r.note || '-') + '</td>'
        + '<td><button class="ent-btn danger" onclick="entArchiveRecord(\'' + esc(page) + '\',\'' + esc(r.id) + '\')">Archive</button></td>';
        
      return '<tr>' + rowHtml + '</tr>';
    }).join('') + '</tbody></table>';
  }
  function renderForm(page) {
    const cfg = PAGES[page];
    return '<div class="ent-form-grid">' + cfg.fields.map(([name, label, type]) => {
      const id = 'ent_' + page + '_' + name;
      if (type === 'select') {
        return '<label>' + esc(label) + '<select id="' + esc(id) + '" class="ent-input">' + STATUS.map(([k, v]) => '<option value="' + k + '">' + v + '</option>').join('') + '</select></label>';
      }
      return '<label class="' + (name === 'note' ? 'ent-form-full' : '') + '">' + esc(label) + '<input id="' + esc(id) + '" class="ent-input" type="' + esc(type) + '" value="' + (type === 'date' ? todayISO() : '') + '"></label>';
    }).join('') + '</div>'
      + '<div class="ent-actions" style="margin-top:12px;"><button class="ent-btn primary" onclick="entSaveRecord(\'' + esc(page) + '\')">Save row</button><button class="ent-btn" onclick="entLoadDemo(\'' + esc(page) + '\')">Load demo</button>' + (cfg.extraActions || '') + '</div>';
  }
  function renderPage(page) {
    ensureData();
    const cfg = PAGES[page];
    const root = document.getElementById(cfg.body);
    if (!root) return;
    const rh = routeHealthSummary();

    let subTabsHtml = '';
    if (page === 'banking') {
      subTabsHtml = `
        <div class="recon-tab-bar">
          <button class="recon-tab-btn ${bankingActiveTab === 'overview' ? 'active' : ''}" onclick="entSetBankingTab('overview')">
            📊 اللوحة العامة والعمليات
          </button>
          <button class="recon-tab-btn ${bankingActiveTab === 'reconciliation' ? 'active' : ''}" onclick="entSetBankingTab('reconciliation')">
            🩺 مطابقة كشف الحساب البنكي
          </button>
        </div>
      `;
    } else if (page === 'contracts') {
      subTabsHtml = `
        <div class="recon-tab-bar">
          <button class="recon-tab-btn ${contractsActiveTab === 'overview' ? 'active' : ''}" onclick="entSetContractsTab('overview')">
            📊 سجل العقود والالتزامات
          </button>
          <button class="recon-tab-btn ${contractsActiveTab === 'dms_links' ? 'active' : ''}" onclick="entSetContractsTab('dms_links')">
            📂 مستندات العقود الرقمية (DMS)
          </button>
        </div>
      `;
    } else if (page === 'device_center') {
      subTabsHtml = `
        <div class="recon-tab-bar">
          <button class="recon-tab-btn ${deviceActiveTab === 'overview' ? 'active' : ''}" onclick="entSetDeviceTab('overview')">
            📊 لوحة الأجهزة والتحكم
          </button>
          <button class="recon-tab-btn ${deviceActiveTab === 'scanner' ? 'active' : ''}" onclick="entSetDeviceTab('scanner')">
            📷 كاميرا فحص الرموز QR
          </button>
        </div>
      `;
    } else if (page === 'ar_ap') {
      subTabsHtml = `
        <div class="recon-tab-bar">
          <button class="recon-tab-btn ${arApActiveTab === 'overview' ? 'active' : ''}" onclick="entSetArApTab('overview')">
            📊 اللوحة والملخص
          </button>
          <button class="recon-tab-btn ${arApActiveTab === 'ar_collections' ? 'active' : ''}" onclick="entSetArApTab('ar_collections')">
            💰 المقبوضات والتحصيل (AR)
          </button>
          <button class="recon-tab-btn ${arApActiveTab === 'ap_payments' ? 'active' : ''}" onclick="entSetArApTab('ap_payments')">
            💳 المدفوعات وفواتير الموردين (AP)
          </button>
        </div>
      `;
    } else if (page === 'logistics') {
      subTabsHtml = `
        <div class="recon-tab-bar">
          <button class="recon-tab-btn ${logisticsActiveTab === 'overview' ? 'active' : ''}" onclick="entSetLogisticsTab('overview')">
            📊 اللوحة والعمليات
          </button>
          <button class="recon-tab-btn ${logisticsActiveTab === 'dispatch_board' ? 'active' : ''}" onclick="entSetLogisticsTab('dispatch_board')">
            🚚 لوحة الشحن والتوزيع
          </button>
          <button class="recon-tab-btn ${logisticsActiveTab === 'driver_pod' ? 'active' : ''}" onclick="entSetLogisticsTab('driver_pod')">
            📦 إثبات الاستلام (POD)
          </button>
        </div>
      `;
    }

    if (page === 'banking' && bankingActiveTab === 'reconciliation') {
      root.innerHTML = '<div class="ent-shell">'
        + '<section class="ent-hero"><div><h2><i class="fa-solid ' + esc(cfg.icon) + '"></i> ' + esc(cfg.title) + '</h2><p>This tab turns a known ERP gap into a working department surface with durable rows, live context, audit events, and cross-module handoffs.</p></div>'
        + '<div class="ent-status"><span class="ent-chip ok">wired</span><span class="ent-chip">omni.enterpriseSuite.' + esc(page) + '</span>' + (rh ? '<span class="ent-chip ' + (rh.bad ? 'bad' : 'ok') + '">Route ' + esc(rh.nav + '/' + rh.pages) + '</span>' : '') + '</div></section>'
        + subTabsHtml
        + renderReconciliationWorkspace()
        + '</div>';
    } else if (page === 'contracts' && contractsActiveTab === 'dms_links') {
      root.innerHTML = '<div class="ent-shell">'
        + '<section class="ent-hero"><div><h2><i class="fa-solid ' + esc(cfg.icon) + '"></i> ' + esc(cfg.title) + '</h2><p>Link digital documents from the DMS to contracts in the Control Register, or drag and drop new PDF contracts to register and auto-link them.</p></div>'
        + '<div class="ent-status"><span class="ent-chip ok">wired</span><span class="ent-chip">omni.enterpriseSuite.' + esc(page) + '</span>' + (rh ? '<span class="ent-chip ' + (rh.bad ? 'bad' : 'ok') + '">Route ' + esc(rh.nav + '/' + rh.pages) + '</span>' : '') + '</div></section>'
        + subTabsHtml
        + renderDmsWorkspace()
        + '</div>';
    } else if (page === 'device_center' && deviceActiveTab === 'scanner') {
      root.innerHTML = '<div class="ent-shell">'
        + '<section class="ent-hero"><div><h2><i class="fa-solid ' + esc(cfg.icon) + '"></i> ' + esc(cfg.title) + '</h2><p>Scan traveller cards, machines, and employee badges to instantly display execution sheets, update machine states, or verify check-in status.</p></div>'
        + '<div class="ent-status"><span id="scanner_kpi_chip" class="ent-chip ok">wired</span><span class="ent-chip">omni.enterpriseSuite.' + esc(page) + '</span>' + (rh ? '<span class="ent-chip ' + (rh.bad ? 'bad' : 'ok') + '">Route ' + esc(rh.nav + '/' + rh.pages) + '</span>' : '') + '</div></section>'
        + subTabsHtml
        + renderDeviceScannerWorkspace()
        + '</div>';
        
      setTimeout(entStartCameraStream, 50);
    } else if (page === 'ar_ap' && (arApActiveTab === 'ar_collections' || arApActiveTab === 'ap_payments')) {
      root.innerHTML = '<div class="ent-shell">'
        + '<section class="ent-hero"><div><h2><i class="fa-solid ' + esc(cfg.icon) + '"></i> ' + esc(cfg.title) + '</h2><p>Process customer collections, promises to pay, and vendor bills runs.</p></div>'
        + '<div class="ent-status"><span class="ent-chip ok">wired</span><span class="ent-chip">omni.enterpriseSuite.' + esc(page) + '</span>' + (rh ? '<span class="ent-chip ' + (rh.bad ? 'bad' : 'ok') + '">Route ' + esc(rh.nav + '/' + rh.pages) + '</span>' : '') + '</div></section>'
        + subTabsHtml
        + renderArApWorkspace()
        + '</div>';
    } else if (page === 'logistics' && (logisticsActiveTab === 'dispatch_board' || logisticsActiveTab === 'driver_pod')) {
      root.innerHTML = '<div class="ent-shell">'
        + '<section class="ent-hero"><div><h2><i class="fa-solid ' + esc(cfg.icon) + '"></i> ' + esc(cfg.title) + '</h2><p>Dispatch shipments, assign drivers, track routes, and capture signature proof-of-delivery (POD).</p></div>'
        + '<div class="ent-status"><span class="ent-chip ok">wired</span><span class="ent-chip">omni.enterpriseSuite.' + esc(page) + '</span>' + (rh ? '<span class="ent-chip ' + (rh.bad ? 'bad' : 'ok') + '">Route ' + esc(rh.nav + '/' + rh.pages) + '</span>' : '') + '</div></section>'
        + subTabsHtml
        + renderLogisticsWorkspace()
        + '</div>';
    } else {
      let alertBannerHtml = '';
      if (page === 'contracts' && contractsActiveTab === 'overview') {
        alertBannerHtml = renderContractsRenewalAlerts();
      }

      root.innerHTML = '<div class="ent-shell">'
        + '<section class="ent-hero"><div><h2><i class="fa-solid ' + esc(cfg.icon) + '"></i> ' + esc(cfg.title) + '</h2><p>This tab turns a known ERP gap into a working department surface with durable rows, live context, audit events, and cross-module handoffs.</p></div>'
        + '<div class="ent-status"><span class="ent-chip ok">wired</span><span class="ent-chip">omni.enterpriseSuite.' + esc(page) + '</span>' + (rh ? '<span class="ent-chip ' + (rh.bad ? 'bad' : 'ok') + '">Route ' + esc(rh.nav + '/' + rh.pages) + '</span>' : '') + '</div></section>'
        + subTabsHtml
        + alertBannerHtml
        + renderKpis(page)
        + renderDepartmentOps(page)
        + '<section class="ent-main-grid"><div class="ent-panel"><div class="ent-panel-head"><h3>Control Register</h3><div class="ent-actions"><button class="ent-btn" onclick="entRefresh(\'' + esc(page) + '\')">Refresh</button><button class="ent-btn" onclick="entCreateTask(\'' + esc(page) + '\')">Create task</button></div></div>' + renderTable(page) + '</div>'
        + '<aside class="ent-panel"><div class="ent-panel-head"><h3>Smart Next Actions</h3></div>' + renderRecommendations(page) + '<div class="ent-panel-head" style="margin-top:16px;"><h3>Quick Add</h3></div>' + renderForm(page) + '</aside></section>'
        + '</div>';
    }
  }

  window.entSaveRecord = function (page) {
    const cfg = PAGES[page];
    if (!cfg) return;
    const data = {};
    cfg.fields.forEach(([name]) => {
      const el = document.getElementById('ent_' + page + '_' + name);
      data[name] = el ? el.value : '';
    });
    if (!String(data.name || '').trim()) {
      toast('Name is required', 'warning');
      return;
    }
    data.amount = money(data.amount);
    data.status = data.status || 'open';
    const rec = stamp({
      id: uid('ent'),
      ...data,
      is_active: true,
      createdAt: new Date().toISOString(),
      createdBy: currentUserName()
    });
    hub(page).records.unshift(rec);
    hub(page).events.unshift({ at: new Date().toISOString(), action: 'create', id: rec.id, by: currentUserName() });
    audit(page, 'record_create', cfg.title + ': ' + rec.name, rec);
    save();
    toast('Saved in ' + cfg.title, 'success');
    renderPage(page);
  };
  window.entSetStatus = function (page, id, status) {
    const rec = records(page, true).find(r => r.id === id);
    if (!rec) return;
    rec.status = status;
    rec.updatedAt = new Date().toISOString();
    rec.updatedBy = currentUserName();
    audit(page, 'status_change', (rec.name || id) + ' -> ' + (STATUS_LABEL[status] || status), rec);
    save();
    renderPage(page);
  };
  window.entArchiveRecord = function (page, id) {
    const rec = records(page, true).find(r => r.id === id);
    if (!rec) return;
    rec.is_active = false;
    rec.archivedAt = new Date().toISOString();
    rec.archivedBy = currentUserName();
    audit(page, 'record_archive', rec.name || id, rec);
    save();
    renderPage(page);
  };
  window.entLoadDemo = function (page) {
    const cfg = PAGES[page];
    if (!cfg || !Array.isArray(cfg.demo) || !cfg.demo.length) {
      toast('No demo pack for this tab', 'info');
      return;
    }
    if (records(page, true).length) {
      toast('This tab already has records', 'info');
      return;
    }
    
    if (page === 'contracts') {
      ensureData();
      if (!O().documents) O().documents = { docs: [] };
      
      const doc1Id = uid('doc');
      const doc4Id = uid('doc');
      const doc3Id = uid('doc');
      
      const demoDocs = [
        {
          id: doc1Id,
          title: 'عقد صيانة المخرطة CNC - الرافدين',
          category: 'contract',
          refNumber: 'CON-DMS-7712',
          owner: 'ورشة أوكتاجون',
          issuer: 'شركة الرافدين للتكنولوجيا',
          issueDate: plusDays(-300),
          expiryDate: plusDays(90),
          reminderDays: 30,
          tags: 'عقد, صيانة, DMS',
          fileNote: 'mock_contracts/CNC_maintenance.pdf',
          notes: 'مستند DMS مرتبط بعقد الصيانة الفعلي',
          value: 2500000,
          is_active: true,
          createdAt: new Date().toISOString(),
          createdBy: 'تجريبي'
        },
        {
          id: doc4Id,
          title: 'رخصة السلامة المهنية ومكافحة الحرائق - الدفاع المدني',
          category: 'contract',
          refNumber: 'CON-DMS-8812',
          owner: 'إدارة الإنتاج',
          issuer: 'وزارة الداخلية/الدفاع المدني',
          issueDate: plusDays(-350),
          expiryDate: plusDays(10),
          reminderDays: 30,
          tags: 'رخصة, سلامة, DMS',
          fileNote: 'mock_contracts/Safety_license.pdf',
          notes: 'رخصة سلامة الدفاع المدني السنوية',
          value: 500000,
          is_active: true,
          createdAt: new Date().toISOString(),
          createdBy: 'تجريبي'
        },
        {
          id: doc3Id,
          title: 'عقد إيجار مستودع المواد الأولية - بابل',
          category: 'contract',
          refNumber: 'CON-DMS-9922',
          owner: 'الإدارة المالية',
          issuer: 'مالك العقار',
          issueDate: plusDays(-120),
          expiryDate: plusDays(-15),
          reminderDays: 30,
          tags: 'عقد, إيجار, DMS',
          fileNote: 'mock_contracts/Warehouse_lease.pdf',
          notes: 'عقد الإيجار السنوي لمخزن الخامات الرئيسي',
          value: 12000000,
          is_active: true,
          createdAt: new Date().toISOString(),
          createdBy: 'تجريبي'
        }
      ];
      
      demoDocs.forEach(d => O().documents.docs.push(d));
      
      const demoContracts = [
        {
          name: 'عقد صيانة المخرطة CNC',
          party: 'شركة الرافدين للتكنولوجيا',
          amount: 2500000,
          date: plusDays(90),
          status: 'open',
          note: 'عقد صيانة سنوي شامل قطع الغيار والدعم الطارئ للمخرطة CNC',
          linkedDocId: doc1Id
        },
        {
          name: 'رخصة السلامة المهنية ومكافحة الحرائق',
          party: 'وزارة الداخلية/الدفاع المدني',
          amount: 500000,
          date: plusDays(10),
          status: 'review',
          note: 'متابعة شروط السلامة مع الدفاع المدني وتجهيز طفايات الحريق للتفتيش',
          linkedDocId: doc4Id
        },
        {
          name: 'عقد توريد حديد صلب ومقاطع معدنية',
          party: 'الشركة العامة للحديد والصلب',
          amount: 8500000,
          date: plusDays(-5),
          status: 'review',
          note: 'عقد توريد دفعات الحديد للمصنع - غير مرتبط بوثيقة DMS الرقمية حالياً',
          linkedDocId: null
        }
      ];
      
      demoContracts.forEach(row => {
        hub('contracts').records.push(stamp({
          id: uid('ent'),
          ...row,
          is_active: true,
          createdAt: new Date().toISOString(),
          createdBy: currentUserName()
        }));
      });
      
      audit('contracts', 'demo_load', 'Contracts and DMS demo data loaded', { count: demoContracts.length });
      save();
      renderPage('contracts');
      toast('تم تحميل بيانات تجريبية للعقود ومستندات DMS بنجاح', 'success');
      return;
    }
    
    cfg.demo.forEach(row => {
      hub(page).records.push(stamp({
        id: uid('ent'),
        ...row,
        is_active: true,
        createdAt: new Date().toISOString(),
        createdBy: currentUserName()
      }));
    });
    audit(page, 'demo_load', cfg.title + ' demo data loaded', { count: cfg.demo.length });
    save();
    renderPage(page);
  };
  window.entRunDataQualityScan = function () {
    const page = 'data_quality';
    const rows = scanDataQuality();
    const h = hub(page);
    h.records = h.records.filter(r => r.source !== 'live_scan');
    rows.forEach(row => h.records.unshift(stamp({
      id: uid('dq'),
      ...row,
      source: 'live_scan',
      is_active: true,
      createdAt: new Date().toISOString(),
      createdBy: currentUserName()
    })));
    audit(page, 'live_scan', 'Data quality scan completed', { count: rows.length });
    save();
    toast('Data quality scan completed: ' + rows.length + ' issue(s)', rows.length ? 'warning' : 'success');
    renderPage(page);
  };
  window.entCreateTask = function (page) {
    const cfg = PAGES[page];
    if (!cfg) return;
    if (typeof window.createTaskInSelectedSpace !== 'function') {
      toast('Task Manager API is not available', 'warning');
      return;
    }
    const title = 'Follow up: ' + cfg.title;
    const meta = departmentMeta(page);
    try {
      const task = window.createTaskInSelectedSpace(title, { priority: 'high', sourceType: 'enterprise_suite', sourceId: page, department: meta.taskDepartment || 'Management', description: 'Follow up the ' + cfg.title + ' department bridge and control register.' });
      audit(page, 'task_create', title, { taskId: task && task.id });
      save();
      toast('Task created', 'success');
    } catch (e) {
      toast(e.message || 'Could not create task', 'error');
    }
  };
  window.entImportDepartmentSignals = function (page) {
    const count = importDepartmentSignals(page);
    toast(count ? ('Imported ' + count + ' live signal(s)') : 'No new live signals to import', count ? 'success' : 'info');
    renderPage(page);
  };
  window.entOpenDepartmentSource = function (page) {
    const meta = departmentMeta(page);
    if (meta.sourcePage && typeof window.switchPage === 'function') {
      try { window.switchPage(meta.sourcePage); } catch (_) {}
    }
  };
  window.entRefresh = function (page) { renderPage(page); };

  function activatePage(page) {
    const cfg = PAGES[page];
    if (!cfg) return false;
    const allowed = !window.PermissionService || window.PermissionService.checkPage(page);
    if (!allowed) {
      toast('No permission for this section', 'danger');
      return true;
    }
    document.querySelectorAll('.page').forEach(pg => pg.classList.remove('page-active'));
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    const pg = document.getElementById(cfg.pageId);
    const nav = document.getElementById(cfg.navId);
    if (pg) pg.classList.add('page-active');
    if (nav) nav.classList.add('active');
    if (typeof window.ensureNavGroupForPage === 'function') {
      try { window.ensureNavGroupForPage(page); } catch (_) {}
    }
    window.currentPage = page;
    renderPage(page);
    return true;
  }

  function wireSwitch() {
    if (window.__enterpriseSuiteWrapped || typeof window.switchPage !== 'function') return;
    const orig = window.switchPage;
    window.switchPage = function (page) {
      if (page !== 'device_center') {
        try { if (typeof entStopCameraStream === 'function') entStopCameraStream(); } catch (_) {}
      }
      if (PAGES[page]) {
        try { if (activatePage(page)) return; } catch (e) { console.warn('Enterprise Suite render error', e); }
      }
      return orig.apply(this, arguments);
    };
    window.__enterpriseSuiteWrapped = true;
  }

  function pageReport(page) {
    const cfg = PAGES[page];
    if (!cfg) return {};
    return {
      page,
      title: cfg.title,
      kpis: (cfg.kpis ? cfg.kpis() : genericKpis(page)).map(k => ({ label: k[0], value: k[1], note: k[2] })),
      recommendations: (cfg.recommendations ? cfg.recommendations() : genericRecommendations(page)),
      records: records(page).slice(0, 10)
    };
  }
  function registerJarvis() {
    try {
      if (!window.JarvisBrain || !JarvisBrain.tools) return;
      PAGE_KEYS.forEach(page => {
        const toolName = 'report_' + page + '_today';
        if (!JarvisBrain.tools[toolName]) {
          JarvisBrain.tools[toolName] = {
            desc_en: PAGES[page].title + ' live control report.',
            risk: 'safe',
            params: {},
            run: function () { return pageReport(page); }
          };
        }
      });
      if (!JarvisBrain.tools.report_enterprise_suite_today) {
        JarvisBrain.tools.report_enterprise_suite_today = {
          desc_en: 'Summarize all enterprise-suite gap tabs.',
          risk: 'safe',
          params: {},
          run: function () {
            return PAGE_KEYS.reduce((acc, page) => {
              acc[page] = { title: PAGES[page].title, records: recStats(page), topRecommendations: (PAGES[page].recommendations ? PAGES[page].recommendations() : genericRecommendations(page)).slice(0, 3) };
              return acc;
            }, {});
          }
        };
      }
    } catch (_) {}
  }

  // ─── Bank Statement CSV Reconciliation Engine ───
  window.entSetBankingTab = function (tab) {
    bankingActiveTab = tab;
    renderPage('banking');
  };

  window.entHandleReconCsvUpload = function (event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
      const text = e.target.result;
      parseCSVText(text);
    };
    reader.readAsText(file, 'utf8');
  };

  function parseCSVText(text) {
    const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 2) {
      toast('ملف CSV فارغ أو غير صالح', 'error');
      return;
    }
    const header = lines[0];
    const sep = header.includes(';') ? ';' : ',';
    const cols = header.split(sep).map(c => c.trim().replace(/^["']|["']$/g, '').toLowerCase());

    const dateIdx = cols.findIndex(c => c.includes('date') || c.includes('تاريخ'));
    const descIdx = cols.findIndex(c => c.includes('desc') || c.includes('payee') || c.includes('تفاصيل') || c.includes('بيان'));
    const amountIdx = cols.findIndex(c => c.includes('amount') || c.includes('value') || c.includes('مبلغ') || c.includes('قيمة'));
    const typeIdx = cols.findIndex(c => c.includes('type') || c.includes('direction') || c.includes('نوع') || c.includes('حركة'));

    const dIdx = dateIdx !== -1 ? dateIdx : 0;
    const descIdxReal = descIdx !== -1 ? descIdx : 1;
    const aIdx = amountIdx !== -1 ? amountIdx : 2;

    const parsed = [];
    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].split(sep).map(c => c.trim().replace(/^["']|["']$/g, ''));
      if (row.length <= Math.max(dIdx, descIdxReal, aIdx)) continue;

      const dateVal = row[dIdx];
      const descVal = row[descIdxReal];
      const amountVal = parseFloat(row[aIdx].replace(/[^0-9.-]/g, ''));
      if (isNaN(amountVal)) continue;

      let direction = 'in';
      if (typeIdx !== -1 && row[typeIdx]) {
        const typeStr = row[typeIdx].toLowerCase();
        if (typeStr.includes('out') || typeStr.includes('debit') || typeStr.includes('withdraw') || typeStr.includes('سحب') || typeStr.includes('مدين')) {
          direction = 'out';
        }
      } else if (amountVal < 0) {
        direction = 'out';
      }

      parsed.push({
        id: 'bl_' + i + '_' + Date.now().toString(36),
        date: dateVal,
        description: descVal,
        amount: Math.abs(amountVal),
        direction: direction,
        matchedTxId: null
      });
    }

    bankStatementLines = parsed;
    toast(`تم تحميل ${parsed.length} سطر من كشف الحساب البنكي`, 'success');
    entAutoMatch();
    renderPage('banking');
  }

  function getUnmatchedTransactions() {
    return txs().filter(t => t.bankReconciled !== true && t.amount > 0 && t.paymentMethod !== 'cash');
  }

  function findMatchCandidates(line, unmatched) {
    const list = [];
    unmatched.forEach(tx => {
      const diffAmount = Math.abs(tx.amount - line.amount);
      if (diffAmount > 0.01) return;

      const lineDir = line.direction === 'in' ? 'in' : 'out';
      const txDir = tx.direction === 'in' ? 'in' : 'out';
      if (lineDir !== txDir) return;

      const lineDate = new Date(line.date);
      const txDate = new Date(tx.date);
      const diffDays = Math.abs((txDate - lineDate) / 86400000);

      let confidence = 0;
      if (diffDays === 0) {
        confidence = 100;
      } else if (diffDays <= 3) {
        confidence = 80;
      } else if (diffDays <= 7) {
        confidence = 60;
      } else {
        return;
      }

      list.push({ tx, confidence, diffDays });
    });
    return list.sort((a, b) => b.confidence - a.confidence || a.diffDays - b.diffDays);
  }

  function entAutoMatch() {
    const unmatched = getUnmatchedTransactions();
    bankStatementLines.forEach(line => {
      if (line.matchedTxId) return;
      const candidates = findMatchCandidates(line, unmatched);
      const best = candidates.find(c => c.confidence === 100);
      if (best) {
        line.matchedTxId = best.tx.id;
      }
    });
  }

  window.entLoadMockBankStatement = function () {
    const list = getUnmatchedTransactions();
    const mock = [];

    list.slice(0, 5).forEach((t, index) => {
      if (index === 0) {
        mock.push({
          id: 'mock_' + t.id,
          date: t.date,
          description: t.description || ('حوالة واردة من ' + (t.partyName || 'عميل')),
          amount: t.amount,
          direction: t.direction || 'in',
          matchedTxId: null
        });
      } else if (index === 1) {
        const d = new Date(t.date);
        d.setDate(d.getDate() + 2);
        mock.push({
          id: 'mock_' + t.id,
          date: d.toISOString().slice(0, 10),
          description: 'تحويل بنكي - ' + (t.partyName || t.description || 'مورد'),
          amount: t.amount,
          direction: t.direction || 'out',
          matchedTxId: null
        });
      } else if (index === 2) {
        const d = new Date(t.date);
        d.setDate(d.getDate() - 1);
        mock.push({
          id: 'mock_' + t.id,
          date: d.toISOString().slice(0, 10),
          description: 'عملية دفع بطاقة: ' + (t.partyName || 'مصاريف'),
          amount: t.amount,
          direction: t.direction || 'out',
          matchedTxId: null
        });
      } else {
        mock.push({
          id: 'mock_' + t.id,
          date: t.date,
          description: 'تسوية حساب - ' + (t.partyName || 'الجهة المستلمة'),
          amount: t.amount,
          direction: t.direction || 'in',
          matchedTxId: null
        });
      }
    });

    mock.push({
      id: 'mock_fee_1',
      date: todayISO(),
      description: 'رسوم خدمات بنكية شهرية - الرافدين',
      amount: 15000,
      direction: 'out',
      matchedTxId: null
    });

    mock.push({
      id: 'mock_interest_1',
      date: todayISO(),
      description: 'فوائد دائنة - حساب جاري',
      amount: 45000,
      direction: 'in',
      matchedTxId: null
    });

    if (mock.length <= 2) {
      mock.push({
        id: 'mock_fb_1',
        date: todayISO(),
        description: 'دفعة نقدية مسجلة بالخطأ بالبنك',
        amount: 250000,
        direction: 'in',
        matchedTxId: null
      });
      mock.push({
        id: 'mock_fb_2',
        date: todayISO(),
        description: 'شراء قرطاسية مكتبية - دفع فيزا',
        amount: 32000,
        direction: 'out',
        matchedTxId: null
      });
    }

    bankStatementLines = mock;
    toast('تم إنشاء كشف حساب بنكي تجريبي بنجاح', 'success');
    entAutoMatch();
    renderPage('banking');
  };

  window.entMatchLine = function (lineId, txId) {
    const line = bankStatementLines.find(l => l.id === lineId);
    if (!line) return;
    line.matchedTxId = txId;
    renderPage('banking');
  };

  window.entUnmatchLine = function (lineId) {
    const line = bankStatementLines.find(l => l.id === lineId);
    if (!line) return;
    line.matchedTxId = null;
    renderPage('banking');
  };

  window.entResetReconciliation = function () {
    bankStatementLines = [];
    renderPage('banking');
  };

  window.entConfirmReconciliation = function () {
    const matches = bankStatementLines.filter(l => l.matchedTxId);
    if (matches.length === 0) {
      toast('لا توجد معاملات مطابقة لتأكيدها', 'warning');
      return;
    }

    let count = 0;
    matches.forEach(line => {
      const tx = txs().find(t => t.id === line.matchedTxId);
      if (tx) {
        tx.bankReconciled = true;
        tx.bankReconciliationDate = new Date().toISOString();
        tx.bankStatementLineId = line.id;
        count++;
      }
    });

    if (count > 0) {
      audit('banking', 'bank_reconciliation_complete', `تمت مطابقة وتسوية ${count} معاملة بنكية بنجاح`, { count });
      save();
      toast(`تم حفظ تسوية ${count} معاملة بنجاح`, 'success');
      bankStatementLines = [];
      bankingActiveTab = 'overview';
      renderPage('banking');
    }
  };

  window.entCreateFromBankLine = function (lineId) {
    const line = bankStatementLines.find(l => l.id === lineId);
    if (!line) return;

    const overlay = document.getElementById('omniModalOverlay');
    const title = document.getElementById('omniModalTitle');
    const body = document.getElementById('omniModalBody');
    const btnCancel = document.getElementById('omniModalCancel');
    const btnConfirm = document.getElementById('omniModalConfirm');

    if (!overlay || !body) return;

    title.textContent = 'تسجيل حركة مالية جديدة من كشف البنك';

    ensureData();
    const kind = line.direction === 'in' ? 'income' : 'expense';
    const cats = finance.categories[kind] || [];
    const depts = finance.departments || [];

    const catOpts = cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    const deptOpts = depts.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('');

    body.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:12px;">
        <div style="font-size:13px; color:#cbd5e1;">
          <strong>المعاملة:</strong> ${esc(line.description)}<br>
          <strong>المبلغ:</strong> ${line.amount.toLocaleString()} د.ع<br>
          <strong>النوع:</strong> ${line.direction === 'in' ? 'وارد (إيداع)' : 'صادر (سحب)'}
        </div>
        <label style="display:flex; flex-direction:column; gap:5px; font-size:12px; font-weight:700; color:#cbd5e1;">
          التصنيف المالي *
          <select id="ent_modal_cat" class="ent-input">${catOpts}</select>
        </label>
        <label style="display:flex; flex-direction:column; gap:5px; font-size:12px; font-weight:700; color:#cbd5e1;">
          القسم *
          <select id="ent_modal_dept" class="ent-input">${deptOpts}</select>
        </label>
        <label style="display:flex; flex-direction:column; gap:5px; font-size:12px; font-weight:700; color:#cbd5e1;">
          اسم العميل أو الجهة
          <input id="ent_modal_party" class="ent-input" type="text" value="${esc(line.description.split('-')[0].trim())}">
        </label>
      </div>
    `;

    overlay.style.display = 'flex';

    btnCancel.onclick = function () {
      overlay.style.display = 'none';
    };

    btnConfirm.onclick = function () {
      const catVal = document.getElementById('ent_modal_cat').value;
      const deptVal = document.getElementById('ent_modal_dept').value;
      const partyVal = document.getElementById('ent_modal_party').value;

      const newTx = {
        id: uid('tx'),
        date: line.date,
        type: kind,
        direction: line.direction,
        amount: line.amount,
        categoryId: catVal,
        departmentId: deptVal,
        description: line.description,
        partyName: partyVal,
        paymentMethod: 'bank',
        sourceType: 'bank_statement'
      };

      const created = addFinanceTransaction(newTx);
      if (created) {
        line.matchedTxId = created.id;
        toast('تم تسجيل المعاملة بالدفتر ومطابقتها تلقائياً', 'success');
        overlay.style.display = 'none';
        renderPage('banking');
      } else {
        toast('حدث خطأ أثناء تسجيل المعاملة', 'error');
      }
    };
  };

  function renderReconciliationWorkspace() {
    const unmatched = getUnmatchedTransactions();
    const matchedCount = bankStatementLines.filter(l => l.matchedTxId).length;
    const totalCount = bankStatementLines.length;

    let leftHtml = '';
    bankStatementLines.forEach(line => {
      const isMatched = !!line.matchedTxId;
      let cardClass = 'recon-card';
      if (isMatched) cardClass += ' matched';

      let amountClass = 'recon-card-amount';
      let amountPrefix = '';
      if (line.direction === 'in') {
        amountClass += ' deposit';
        amountPrefix = '+';
      } else {
        amountClass += ' withdrawal';
        amountPrefix = '-';
      }

      let matchContent = '';
      if (isMatched) {
        const matchedTx = txs().find(t => t.id === line.matchedTxId);
        const txDesc = matchedTx ? (matchedTx.description || matchedTx.partyName || 'معاملة مسجلة') : 'معاملة مسجلة';
        const txDate = matchedTx ? matchedTx.date : '';
        matchContent = `
          <div class="recon-match-section">
            <div class="recon-matched-badge">
              <i class="fa-solid fa-circle-check"></i> مطابقة بنجاح
            </div>
            <div class="recon-match-row" style="border-color: rgba(34, 197, 94, 0.25);">
              <div class="recon-match-info">
                <div class="recon-match-title">${esc(txDesc)}</div>
                <div class="recon-match-meta">${esc(txDate)} · دفتر القاصة</div>
              </div>
              <button class="ent-btn danger" style="padding:4px 8px; font-size:11px;" onclick="entUnmatchLine('${line.id}')">
                فك المطابقة
              </button>
            </div>
          </div>
        `;
      } else {
        const candidates = findMatchCandidates(line, unmatched);
        if (candidates.length > 0) {
          const optionsHtml = candidates.map(c => {
            const confClass = `recon-prob-${c.confidence}`;
            return `
              <div class="recon-match-row" style="margin-bottom:5px;">
                <div class="recon-match-info">
                  <div class="recon-match-title">${esc(c.tx.description || c.tx.partyName || 'معاملة')}</div>
                  <div class="recon-match-meta">${esc(c.tx.date)} · ${esc(c.tx.paymentMethod)}</div>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                  <span class="recon-match-prob ${confClass}">${c.confidence}%</span>
                  <button class="ent-btn primary" style="padding:4px 8px; font-size:11px;" onclick="entMatchLine('${line.id}', '${c.tx.id}')">
                    ربط
                  </button>
                </div>
              </div>
            `;
          }).join('');

          matchContent = `
            <div class="recon-match-section">
              <div style="font-size:11px; color:#cbd5e1; font-weight:700; margin-bottom:6px;">اقتراحات المطابقة التلقائية:</div>
              ${optionsHtml}
              <button class="ent-btn" style="padding:4px 8px; font-size:11px; align-self:flex-start; margin-top:4px;" onclick="entCreateFromBankLine('${line.id}')">
                ➕ تسجيل كمعاملة جديدة في القاصة
              </button>
            </div>
          `;
        } else {
          matchContent = `
            <div class="recon-match-section">
              <div style="font-size:11px; color:#94a3b8; margin-bottom:6px;">لم يتم العثور على معاملة مطابقة بالقاصة.</div>
              <button class="ent-btn primary" style="padding:4px 8px; font-size:11px; align-self:flex-start;" onclick="entCreateFromBankLine('${line.id}')">
                ➕ تسجيل كمعاملة جديدة ومطابقتها
              </button>
            </div>
          `;
        }
      }

      leftHtml += `
        <div class="${cardClass}">
          <div class="recon-card-header">
            <span class="recon-card-date">${esc(line.date)}</span>
            <span class="${amountClass}">${amountPrefix}${fmt(line.amount)} د.ع</span>
          </div>
          <div class="recon-card-desc">${esc(line.description)}</div>
          ${matchContent}
        </div>
      `;
    });

    let rightHtml = '';
    const unmatchedFiltered = unmatched.filter(t => !bankStatementLines.some(l => l.matchedTxId === t.id));
    if (unmatchedFiltered.length === 0) {
      rightHtml = `<div class="ent-empty">جميع قيود القاصة المعلقة مطابقة أو لا توجد قيود معلقة بالبنك.</div>`;
    } else {
      rightHtml = unmatchedFiltered.map(t => {
        let amountClass = 'recon-card-amount';
        if (t.direction === 'in') amountClass += ' deposit';
        else amountClass += ' withdrawal';
        return `
          <div class="recon-card" style="opacity: 0.85;">
            <div class="recon-card-header">
              <span class="recon-card-date">${esc(t.date)}</span>
              <span class="${amountClass}">${t.direction === 'in' ? '+' : '-'}${fmt(t.amount)} د.ع</span>
            </div>
            <div class="recon-card-desc">${esc(t.description || t.partyName || 'قيد غير مسمى')}</div>
            <div style="font-size:11px; color:#94a3b8;">
              الجهة: ${esc(t.partyName || '—')} · الطريقة: ${esc(t.paymentMethod)}
            </div>
          </div>
        `;
      }).join('');
    }

    return `
      <div class="recon-workspace">
        <div class="recon-pane">
          <div class="recon-pane-title">
            <span>📋 سطور كشف الحساب البنكي</span>
            <span class="ent-chip ok">${matchedCount} / ${totalCount} مطابقة</span>
          </div>
          <div class="recon-list">
            ${leftHtml}
          </div>
        </div>
        
        <div class="recon-pane">
          <div class="recon-pane-title">
            <span>🏦 القيود المعلقة بالدفاتر (غير مطابقة)</span>
            <span class="ent-chip warn">${unmatchedFiltered.length} قيد معلق</span>
          </div>
          <div class="recon-list">
            ${rightHtml}
          </div>
        </div>
      </div>
      
      <div style="margin-top:20px; display:flex; justify-content:space-between; align-items:center; background:rgba(15,23,42,0.8); padding:15px; border-radius:8px; border:1px solid rgba(148,163,184,0.16);">
        <div style="font-size:13px; color:#cbd5e1;">
          تمت مطابقة <strong>${matchedCount}</strong> معاملة من إجمالي <strong>${totalCount}</strong> بنجاح.
        </div>
        <div style="display:flex; gap:10px;">
          <button class="ent-btn danger" onclick="entResetReconciliation()">
            إلغاء المعاينة
          </button>
          <button class="ent-btn primary" onclick="entConfirmReconciliation()" ${matchedCount === 0 ? 'disabled' : ''}>
            💾 حفظ واعتماد التسوية البنكية
          </button>
        </div>
      </div>
    `;
  }

  // ─── DMS Contract Integration Workspace ───
  function getDmsContractDocs() {
    const docs = O().documents?.docs || [];
    return docs.filter(d => d.is_active !== false && /contract|license|agreement|عقد|رخص/i.test((d.category || '') + ' ' + (d.title || '') + ' ' + (d.tags || '')));
  }

  function renderDmsWorkspace() {
    const docs = getDmsContractDocs();
    const activeContracts = records('contracts');
    
    let leftHtml = '';
    docs.forEach(doc => {
      const linkedContract = activeContracts.find(c => c.linkedDocId === doc.id);
      const isLinked = !!linkedContract;
      
      let badgeHtml = '';
      let actionHtml = '';
      if (isLinked) {
        badgeHtml = `<span class="dms-card-status linked">مرتبط بالعقد: ${esc(linkedContract.name)}</span>`;
        actionHtml = `
          <div class="dms-link-section">
            <button class="ent-btn" style="padding:4px 8px; font-size:11px;" onclick="entShowContractDocPreview('${doc.id}')">
              👁️ معاينة المستند
            </button>
            <button class="ent-btn danger" style="padding:4px 8px; font-size:11px;" onclick="entUnlinkContractFromDoc('${linkedContract.id}')">
              فك الارتباط
            </button>
          </div>
        `;
      } else {
        badgeHtml = `<span class="dms-card-status unlinked">غير مرتبط بالرصيد الدفتري</span>`;
        
        const selectOptions = ['<option value="">-- اختر عقداً للربط --</option>']
          .concat(activeContracts.filter(c => !c.linkedDocId).map(c => `<option value="${c.id}">${esc(c.name)} (${esc(c.party)})</option>`))
          .join('');
          
        actionHtml = `
          <div class="dms-link-section">
            <button class="ent-btn" style="padding:4px 8px; font-size:11px; font-weight:700;" onclick="entShowContractDocPreview('${doc.id}')">
              👁️ معاينة
            </button>
            <div style="display:flex; align-items:center; gap:6px;">
              <select id="link_select_${doc.id}" class="ent-input" style="padding:4px 8px; font-size:11px; max-width:180px;">
                ${selectOptions}
              </select>
              <button class="ent-btn primary" style="padding:4px 8px; font-size:11px;" onclick="entLinkDocToSelected('${doc.id}')">
                ربط
              </button>
            </div>
            <button class="ent-btn primary" style="padding:4px 8px; font-size:11px;" onclick="entCreateContractFromDoc('${doc.id}')">
              ➕ تسجيل كعقد جديد
            </button>
          </div>
        `;
      }
      
      leftHtml += `
        <div class="dms-card ${isLinked ? 'linked' : ''}">
          <div class="dms-card-header">
            <div class="dms-card-title">${esc(doc.title)}</div>
            <div class="dms-card-meta">تاريخ الانتهاء: ${esc(doc.expiryDate || '—')}</div>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; color:#cbd5e1;">
            <div>الجهة: <strong>${esc(doc.owner || '—')}</strong> | المصدر: <strong>${esc(doc.issuer || '—')}</strong></div>
            ${badgeHtml}
          </div>
          ${actionHtml}
        </div>
      `;
    });
    
    if (!docs.length) {
      leftHtml = `<div class="ent-empty">لا توجد وثائق عقود في نظام DMS حالياً. قم بتحميل وثيقة بالجهة المقابلة.</div>`;
    }
    
    const rightHtml = `
      <div class="recon-uploader" id="dms_contract_uploader"
           ondragover="event.preventDefault(); this.style.borderColor='#3b82f6'; this.style.background='rgba(59,130,246,0.08)';"
           ondragleave="event.preventDefault(); this.style.borderColor=''; this.style.background='';"
           ondrop="entHandleDmsContractDrop(event)">
        <i class="fa-solid fa-file-pdf" style="color:#ef4444;"></i>
        <p>قم بسحب وإفلات ملف العقد (PDF) هنا</p>
        <span style="font-size:11px; color:#94a3b8;">أو انقر لاختيار ملف تجريبي</span>
        <button class="ent-btn primary" onclick="entUploadMockContract()">تحميل عقد تجريبي سريع</button>
      </div>
    `;
    
    return `
      <div class="dms-workspace" style="direction:rtl;">
        <div class="dms-pane">
          <h3 class="recon-pane-title">🗂️ وثائق ومستندات العقود الرقمية (DMS)</h3>
          <div class="recon-list">${leftHtml}</div>
        </div>
        <div class="dms-pane" style="min-height:unset;">
          <h3 class="recon-pane-title">➕ تحميل مستندات عقود جديدة</h3>
          ${rightHtml}
        </div>
      </div>
    `;
  }

  function renderContractsRenewalAlerts() {
    const list = records('contracts');
    const warningDays = 30;
    const expiringContracts = list.filter(c => {
      if (!c.date) return false;
      const days = daysFromToday(c.date);
      return days <= warningDays;
    });

    if (!expiringContracts.length) return '';

    const alertItems = expiringContracts.map(c => {
      const days = daysFromToday(c.date);
      let statusText = '';
      if (days < 0) {
        statusText = `منتهي منذ ${Math.abs(days)} يوم`;
      } else {
        statusText = `ينتهي خلال ${days} يوم`;
      }

      return `
        <div class="contracts-alert-item">
          <div>
            <strong>${esc(c.name)}</strong> (${esc(c.party)}) -
            <span style="font-family: monospace;">${esc(c.date)}</span>
            <span class="ent-neg" style="margin-right: 8px; font-weight:700;">[${statusText}]</span>
          </div>
          <button onclick="entTriggerRenewalTask('${c.id}')">
            <i class="fa-solid fa-circle-plus"></i> طلب تجديد العقد
          </button>
        </div>
      `;
    }).join('');

    return `
      <div class="contracts-alert-banner">
        <div class="contracts-alert-header">
          <i class="fa-solid fa-triangle-exclamation"></i>
          <span>تنبيهات تجديد العقود: هناك ${expiringContracts.length} عقود بحاجة للتجديد أو المتابعة العاجلة!</span>
        </div>
        <div class="contracts-alert-list">
          ${alertItems}
        </div>
      </div>
    `;
  }

  window.entSetContractsTab = function (tab) {
    contractsActiveTab = tab;
    renderPage('contracts');
  };
  
  window.entLinkDocToSelected = function (docId) {
    const sel = document.getElementById('link_select_' + docId);
    if (!sel || !sel.value) {
      toast('الرجاء اختيار عقد للربط', 'warning');
      return;
    }
    entLinkDocToContract(sel.value, docId);
  };
  
  window.entLinkDocToContract = function (contractId, docId) {
    ensureData();
    const c = records('contracts').find(x => x.id === contractId);
    if (!c) return;
    c.linkedDocId = docId;
    save();
    toast('تم ربط المستند بنجاح', 'success');
    
    const overlay = document.getElementById('omniModalOverlay');
    if (overlay) overlay.style.display = 'none';
    
    renderPage('contracts');
  };
  
  window.entUnlinkContractFromDoc = function (contractId) {
    ensureData();
    const c = records('contracts').find(x => x.id === contractId);
    if (!c) return;
    c.linkedDocId = null;
    save();
    toast('تم فك ارتباط المستند', 'success');
    renderPage('contracts');
  };
  
  window.entCreateContractFromDoc = function (docId) {
    ensureData();
    const docs = O().documents?.docs || [];
    const doc = docs.find(d => d.id === docId);
    if (!doc) {
      toast('الوثيقة غير موجودة', 'error');
      return;
    }
    
    const newContract = {
      id: uid('ent'),
      name: doc.title,
      party: doc.owner || doc.issuer || 'غير محدد',
      amount: money(doc.value || doc.amount || 1000000),
      date: doc.expiryDate || todayISO(),
      status: 'review',
      note: doc.notes || 'تم إنشاؤه تلقائياً من وثيقة DMS المرفقة',
      linkedDocId: docId,
      is_active: true,
      createdAt: new Date().toISOString(),
      createdBy: currentUserName()
    };
    
    hub('contracts').records.unshift(newContract);
    hub('contracts').events.unshift({ at: new Date().toISOString(), action: 'create_from_dms', id: newContract.id, by: currentUserName() });
    audit('contracts', 'record_create_from_dms', 'Contract created from DMS: ' + newContract.name, newContract);
    save();
    toast('تم إنشاء العقد وربطه بنجاح', 'success');
    renderPage('contracts');
  };
  
  window.entOpenLinkDocModal = function (contractId) {
    ensureData();
    const c = records('contracts').find(x => x.id === contractId);
    if (!c) return;
    
    const overlay = document.getElementById('omniModalOverlay');
    const title = document.getElementById('omniModalTitle');
    const body = document.getElementById('omniModalBody');
    const btnCancel = document.getElementById('omniModalCancel');
    const btnConfirm = document.getElementById('omniModalConfirm');
    
    if (!overlay || !body) return;
    
    title.textContent = 'ربط وثيقة رقمية (DMS) بالعقد';
    
    const unlinkedDocs = getDmsContractDocs().filter(doc => {
      return !records('contracts').some(c => c.linkedDocId === doc.id);
    });
    
    if (!unlinkedDocs.length) {
      body.innerHTML = `
        <div style="padding:15px 0; text-align:center; color:#94a3b8; font-size:13px; direction:rtl;">
          لا توجد وثائق غير مرتبطة في نظام DMS حالياً.<br>
          يمكنك الانتقال إلى أرشيف مستندات العقود الرقمية لرفع وثيقة جديدة.
        </div>
      `;
      btnConfirm.style.display = 'none';
      btnCancel.textContent = 'إغلاق';
      btnCancel.onclick = function () { overlay.style.display = 'none'; };
    } else {
      const docOpts = unlinkedDocs.map(d => `<option value="${d.id}">${esc(d.title)} (الانتهاء: ${esc(d.expiryDate || '—')})</option>`).join('');
      body.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:12px; direction:rtl;">
          <div style="font-size:13px; color:#cbd5e1; margin-bottom:8px;">
            يرجى اختيار الوثيقة من نظام إدارة المستندات (DMS) لربطها بالعقد المالي: <strong>${esc(c.name)}</strong>
          </div>
          <label style="display:flex; flex-direction:column; gap:5px; font-size:12px; font-weight:700; color:#cbd5e1;">
            الوثائق غير المرتبطة المتاحة *
            <select id="ent_link_modal_doc" class="ent-input">${docOpts}</select>
          </label>
        </div>
      `;
      
      btnConfirm.style.display = 'inline-block';
      btnConfirm.textContent = 'ربط الوثيقة';
      btnCancel.textContent = 'إلغاء';
      
      btnCancel.onclick = function () { overlay.style.display = 'none'; };
      btnConfirm.onclick = function () {
        const docId = document.getElementById('ent_link_modal_doc').value;
        if (!docId) return;
        window.entLinkDocToContract(contractId, docId);
      };
    }
    
    overlay.style.display = 'flex';
  };
  
  window.entShowContractDocPreview = function (docId) {
    ensureData();
    const docs = O().documents?.docs || [];
    const doc = docs.find(d => d.id === docId);
    if (!doc) {
      toast('المستند غير موجود', 'error');
      return;
    }
    
    const overlay = document.getElementById('omniModalOverlay');
    const title = document.getElementById('omniModalTitle');
    const body = document.getElementById('omniModalBody');
    const btnCancel = document.getElementById('omniModalCancel');
    const btnConfirm = document.getElementById('omniModalConfirm');
    
    if (!overlay || !body) return;
    
    title.textContent = '📄 معاينة المستند الرقمي (DMS)';
    
    body.innerHTML = `
      <div class="contract-paper-container">
        <div class="contract-paper-layout">
          <div class="contract-paper-header">
            <h2>جمهورية العراق</h2>
            <p>نظام إدارة العقود والمستندات القانونية • أوكتاجون ERP</p>
          </div>
          <div class="contract-paper-title">
            <h3>عقد رسمي موثق</h3>
          </div>
          <div class="contract-paper-body">
            <div class="contract-paper-grid">
              <div class="contract-paper-grid-item"><strong>اسم الوثيقة:</strong> ${esc(doc.title)}</div>
              <div class="contract-paper-grid-item"><strong>الرقم المرجعي:</strong> ${esc(doc.refNumber || '—')}</div>
              <div class="contract-paper-grid-item"><strong>الطرف الأول:</strong> ${esc(doc.owner || '—')}</div>
              <div class="contract-paper-grid-item"><strong>الطرف الثاني (الجهة المصدرة):</strong> ${esc(doc.issuer || '—')}</div>
              <div class="contract-paper-grid-item"><strong>تاريخ الإصدار:</strong> ${esc(doc.issueDate || '—')}</div>
              <div class="contract-paper-grid-item"><strong>تاريخ الانتهاء:</strong> ${esc(doc.expiryDate || '—')}</div>
            </div>
            
            <div class="contract-paper-section-title">البند الأول: موضوع التعاقد</div>
            <p>اتفق الطرفان بموجب هذا العقد على تقديم وتوريد المنتجات والخدمات المحددة في الملاحق الفنية المرفقة، وذلك بقيمة تعاقدية إجمالية قدرها <strong>${fmt(doc.value || doc.amount || 1000000)} د.ع</strong> تدفع وفق شروط السداد المتفق عليها.</p>
            
            <div class="contract-paper-section-title">البند الثاني: التزامات وحقوق الأطراف</div>
            <p>يلتزم الطرف الأول بتوفير كافة البيانات والتسهيلات اللازمة للطرف الثاني لإنجاز العمل. كما يلتزم الطرف الثاني بالمعايير الفنية واللوائح السارية لجمهورية العراق وبجودة التشغيل المطلوبة.</p>
            
            <div class="contract-paper-section-title">البند الثالث: الصلاحية والتجديد</div>
            <p>يسري هذا العقد حتى تاريخ الانتهاء المذكور أعلاه، ويخضع للمراجعة والتجديد التلقائي ما لم يقم أحد الطرفين بإشعار الآخر كتابياً برغبته في عدم التجديد قبل ثلاثين (30) يوماً من تاريخ انتهاء الصلاحية.</p>
            
            <div class="contract-signature-row">
              <div>توقيع الطرف الأول: <br><br>.............................</div>
              <div>توقيع الطرف الثاني: <br><br>.............................</div>
            </div>
            
            <div class="contract-stamp-seal">
              دائرة الشؤون القانونية
              <br>
              معتمد
              <br>
              OCTAGON ERP
            </div>
          </div>
        </div>
      </div>
    `;
    
    btnConfirm.style.display = 'none';
    btnCancel.textContent = 'إغلاق';
    btnCancel.onclick = function () { overlay.style.display = 'none'; };
    
    overlay.style.display = 'flex';
  };
  
  window.entUploadMockContract = function () {
    ensureData();
    const docTitles = [
      'عقد صيانة أجهزة المخرطة CNC - الرافدين',
      'عقد إيجار مستودع المواد الأولية - بابل',
      'رخصة السلامة المهنية ومكافحة الحرائق - الدفاع المدني',
      'عقد توريد حديد صلب ومقاطع معدنية - حديد العراق',
      'عقد رعاية وتدريب وتأهيل الكوادر الفنية - معهد التدريب'
    ];
    const owners = ['ورشة أوكتاجون', 'الإدارة المالية', 'إدارة الإنتاج', 'قسم الخدمات والFleet'];
    const issuers = ['شركة الرافدين للتكنولوجيا', 'مالك العقار', 'وزارة الداخلية/الدفاع المدني', 'الشركة العامة للحديد والصلب', 'مركز التدريب المهني'];
    const values = [2500000, 12000000, 500000, 8500000, 1800000];
    
    const rIdx = Math.floor(Math.random() * docTitles.length);
    
    const offsets = [-15, 10, 25, 45, 90];
    const offset = offsets[Math.floor(Math.random() * offsets.length)];
    const expiry = plusDays(offset);
    const issue = plusDays(offset - 365);
    
    if (!O().documents) O().documents = { docs: [] };
    
    const newDoc = {
      id: uid('doc'),
      title: docTitles[rIdx],
      category: 'contract',
      refNumber: 'CON-DMS-' + Math.floor(Math.random() * 9000 + 1000),
      owner: owners[Math.floor(Math.random() * owners.length)],
      issuer: issuers[rIdx],
      issueDate: issue,
      expiryDate: expiry,
      reminderDays: 30,
      tags: 'عقد, DMS',
      fileNote: 'mock_contracts/' + docTitles[rIdx].replace(/ /g, '_') + '.pdf',
      notes: 'تم توليده تجريبياً لتجربة الربط والمطابقة',
      value: values[rIdx],
      is_active: true,
      createdAt: new Date().toISOString(),
      createdBy: currentUserName()
    };
    
    O().documents.docs.push(newDoc);
    audit('documents', 'doc_create_mock', 'Mock contract uploaded: ' + newDoc.title, newDoc);
    save();
    toast('تم تحميل عقد تجريبي بنظام DMS بنجاح', 'success');
    renderPage('contracts');
  };
  
  window.entHandleDmsContractDrop = function (event) {
    event.preventDefault();
    const uploader = document.getElementById('dms_contract_uploader');
    if (uploader) {
      uploader.style.borderColor = '';
      uploader.style.background = '';
    }
    
    let filename = 'عقد_مرفوع.pdf';
    if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length) {
      filename = event.dataTransfer.files[0].name;
    }
    
    ensureData();
    if (!O().documents) O().documents = { docs: [] };
    
    const expiry = plusDays(25);
    const newDoc = {
      id: uid('doc'),
      title: filename.replace(/\.[^/.]+$/, "").replace(/_/g, ' '),
      category: 'contract',
      refNumber: 'CON-DROP-' + Math.floor(Math.random() * 9000 + 1000),
      owner: 'الورشة الرئيسية',
      issuer: 'مورد خارجي',
      issueDate: plusDays(-340),
      expiryDate: expiry,
      reminderDays: 30,
      tags: 'عقد مرفوع, DMS',
      fileNote: 'dms_uploads/' + filename,
      notes: 'عقد تم رفعه عبر السحب والإفلات',
      value: 3500000,
      is_active: true,
      createdAt: new Date().toISOString(),
      createdBy: currentUserName()
    };
    
    O().documents.docs.push(newDoc);
    audit('documents', 'doc_create_drop', 'Contract dropped: ' + newDoc.title, newDoc);
    save();
    toast('تم رفع المستند وإنشاؤه بنظام DMS بنجاح', 'success');
    renderPage('contracts');
  };

  window.entTriggerRenewalTask = function (contractId) {
    ensureData();
    const c = records('contracts').find(x => x.id === contractId);
    if (!c) return;
    
    if (typeof window.createTaskInSelectedSpace !== 'function') {
      try {
        const tm = O().enterpriseSuite?.task_manager;
        if (tm && Array.isArray(tm.records)) {
          const mockTask = {
            id: uid('task'),
            name: 'طلب تجديد العقد: ' + c.name,
            party: c.party,
            amount: c.amount,
            date: todayISO(),
            status: 'open',
            note: 'مهمة متابعة تجديد العقد ذو القيمة ' + fmt(c.amount) + ' د.ع قبل تاريخ الانتهاء ' + c.date,
            is_active: true,
            createdAt: new Date().toISOString(),
            createdBy: currentUserName()
          };
          tm.records.unshift(mockTask);
          save();
          toast('تم إنشاء مهمة التجديد في نظام المهام', 'success');
          renderPage('contracts');
          return;
        }
      } catch (_) {}
      toast('ميزة إنشاء المهام التلقائية غير متوفرة', 'warning');
      return;
    }
    
    const title = 'طلب تجديد عقد: ' + c.name;
    try {
      const task = window.createTaskInSelectedSpace(title, {
        priority: 'high',
        sourceType: 'contracts',
        sourceId: contractId,
        department: 'Legal',
        description: 'طلب تجديد العقد المنتهي/المشرف على الانتهاء للجهة ' + c.party + ' بقيمة ' + fmt(c.amount) + ' د.ع وتاريخ انتهاء ' + c.date
      });
      audit('contracts', 'renewal_task_create', title, { taskId: task && task.id });
      save();
      toast('تم إنشاء مهمة التجديد القانوني بنجاح', 'success');
      renderPage('contracts');
    } catch (e) {
      toast(e.message || 'Could not create task', 'error');
    }
  };

  // ─── AR / AP Workbench Workspace ───
  window.entSetArApTab = function (tab) {
    arApActiveTab = tab;
    renderPage('ar_ap');
  };

  function customerBalance(customer) {
    try { if (typeof window.getCustomerBalance === 'function') return money(window.getCustomerBalance(customer)); } catch (_) {}
    const id = customer && customer.id;
    if (!id) return 0;
    return txs().reduce((sum, tx) => {
      if (tx.customerId !== id) return sum;
      if (tx.type === 'customer_charge') return sum + money(tx.amount);
      if (tx.direction === 'in') return sum - money(tx.amount);
      return sum;
    }, 0);
  }

  function renderArApWorkspace() {
    const list = records('ar_ap');
    if (arApActiveTab === 'ar_collections') {
      const custs = customers().map(c => ({
        ...c,
        balance: customerBalance(c)
      })).filter(x => x.balance > 0).sort((a, b) => b.balance - a.balance);

      let cardsHtml = '';
      custs.forEach(c => {
        const matchingPromises = list.filter(r => r.customerId === c.id && r.status === 'open');
        const promiseNote = matchingPromises.length ? matchingPromises.map(p => `وعد دفع بتاريخ ${p.date} بقيمة ${fmt(p.amount)} د.ع`).join(', ') : 'لا يوجد وعد دفع معلّق';

        cardsHtml += `
          <div class="arap-card">
            <div class="arap-card-header">
              <span class="arap-card-title">${esc(c.name)}</span>
              <span class="arap-card-amount receivable">+${fmt(c.balance)} د.ع</span>
            </div>
            <div class="arap-card-desc">
              <strong>حالة التحصيل:</strong> ${esc(promiseNote)}<br>
              <strong>الهاتف:</strong> ${esc(c.phone || '—')} | <strong>العنوان:</strong> ${esc(c.address || '—')}
            </div>
            <div class="arap-card-actions">
              <button class="ent-btn" style="padding:4px 8px; font-size:11px;" onclick="entShowReminderModal('${c.id}', '${esc(c.name)}', ${c.balance})">
                💬 إرسال تذكير بالدفع
              </button>
              <button class="ent-btn primary" style="padding:4px 8px; font-size:11px;" onclick="entShowPromiseModal('${c.id}', '${esc(c.name)}', ${c.balance})">
                📅 تسجيل وعد دفع
              </button>
            </div>
          </div>
        `;
      });

      if (!custs.length) {
        cardsHtml = `<div class="ent-empty">لا توجد حسابات مستحقة للتحصيل حالياً. جميع ديون العملاء مسواة.</div>`;
      }

      return `
        <div class="arap-workspace" style="direction:rtl;">
          <div class="arap-pane" style="grid-column: 1 / -1; max-height:unset;">
            <h3 class="recon-pane-title">💰 سجل حسابات ومستحقات العملاء (Accounts Receivable)</h3>
            <div class="recon-list">${cardsHtml}</div>
          </div>
        </div>
      `;
    } else if (arApActiveTab === 'ap_payments') {
      const bills = list.filter(r => r.status === 'open' || r.status === 'review');
      let cardsHtml = '';
      
      bills.forEach(b => {
        cardsHtml += `
          <div class="arap-card">
            <div class="arap-card-header">
              <span class="arap-card-title">${esc(b.name)}</span>
              <span class="arap-card-amount payable">-${fmt(b.amount)} د.ع</span>
            </div>
            <div class="arap-card-desc">
              <strong>المورد:</strong> ${esc(b.party)}<br>
              <strong>تاريخ الاستحقاق:</strong> ${esc(b.date)} | <strong>ملاحظات:</strong> ${esc(b.note || '—')}
            </div>
            <div class="arap-card-actions">
              <button class="ent-btn primary" style="padding:4px 8px; font-size:11px;" onclick="entShowPaymentRunModal('${b.id}', '${esc(b.party)}', ${b.amount})">
                💳 سداد القيمة وتشغيل الدفعة
              </button>
            </div>
          </div>
        `;
      });

      if (!bills.length) {
        cardsHtml = `<div class="ent-empty">لا توجد فواتير موردين معلقة أو مستحقة للدفع.</div>`;
      }

      return `
        <div class="arap-workspace" style="direction:rtl;">
          <div class="arap-pane" style="grid-column: 1 / -1; max-height:unset;">
            <h3 class="recon-pane-title">💳 ذمم الموردين والفواتير المستحقة (Accounts Payable)</h3>
            <div class="recon-list">${cardsHtml}</div>
          </div>
        </div>
      `;
    }
    return '';
  }

  window.entShowPromiseModal = function (customerId, customerName, balance) {
    const overlay = document.getElementById('omniModalOverlay');
    const title = document.getElementById('omniModalTitle');
    const body = document.getElementById('omniModalBody');
    const btnCancel = document.getElementById('omniModalCancel');
    const btnConfirm = document.getElementById('omniModalConfirm');
    if (!overlay || !body) return;

    title.textContent = 'تسجيل وعد دفع من العميل';
    body.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:12px; direction:rtl;">
        <div style="font-size:13px; color:#cbd5e1;">
          <strong>العميل:</strong> ${esc(customerName)}<br>
          <strong>المبلغ المستحق:</strong> ${balance.toLocaleString()} د.ع
        </div>
        <label style="display:flex; flex-direction:column; gap:5px; font-size:12px; font-weight:700; color:#cbd5e1;">
          تاريخ الدفع المتوقع *
          <input id="promise_date" type="date" class="ent-input" value="${plusDays(7)}">
        </label>
        <label style="display:flex; flex-direction:column; gap:5px; font-size:12px; font-weight:700; color:#cbd5e1;">
          مبلغ الوعد بالدفع *
          <input id="promise_amount" type="number" class="ent-input" value="${balance}">
        </label>
        <label style="display:flex; flex-direction:column; gap:5px; font-size:12px; font-weight:700; color:#cbd5e1;">
          ملاحظات المتابعة
          <input id="promise_notes" type="text" class="ent-input" placeholder="مثال: وعد بالدفع نقدًا بالورشة">
        </label>
      </div>
    `;

    overlay.style.display = 'flex';
    btnConfirm.style.display = 'inline-block';
    btnConfirm.textContent = 'حفظ الوعد';
    btnCancel.textContent = 'إلغاء';

    btnCancel.onclick = function () { overlay.style.display = 'none'; };
    btnConfirm.onclick = function () {
      const dateVal = document.getElementById('promise_date').value;
      const amountVal = Number(document.getElementById('promise_amount').value) || 0;
      const notesVal = document.getElementById('promise_notes').value;

      if (!dateVal || amountVal <= 0) {
        toast('يرجى تحديد تاريخ صحيح وقيمة أكبر من الصفر', 'warning');
        return;
      }

      ensureData();
      const newRec = stamp({
        id: uid('ent'),
        name: 'وعد دفع من ' + customerName,
        party: customerName,
        amount: amountVal,
        date: dateVal,
        status: 'open',
        note: 'وعد بالتحصيل: ' + notesVal,
        customerId: customerId,
        is_active: true,
        createdAt: new Date().toISOString(),
        createdBy: currentUserName()
      });

      hub('ar_ap').records.unshift(newRec);
      hub('ar_ap').events.unshift({ at: new Date().toISOString(), action: 'promise_logged', id: newRec.id, by: currentUserName() });
      audit('ar_ap', 'promise_logged', `تسجيل وعد دفع للعميل: ${customerName} بقيمة ${amountVal.toLocaleString()} د.ع`, newRec);
      save();
      toast('تم تسجيل وعد الدفع وملاحظة المتابعة بنجاح', 'success');
      overlay.style.display = 'none';
      renderPage('ar_ap');
    };
  };

  window.entShowReminderModal = function (customerId, customerName, balance) {
    const overlay = document.getElementById('omniModalOverlay');
    const title = document.getElementById('omniModalTitle');
    const body = document.getElementById('omniModalBody');
    const btnCancel = document.getElementById('omniModalCancel');
    const btnConfirm = document.getElementById('omniModalConfirm');
    if (!overlay || !body) return;

    const messageText = `السلام عليكم ورحمة الله وبركاته، السيد/ة ${customerName} المحترم. يرجى العلم بأن رصيدكم المستحق لورشة أوكتاجون يبلغ ${balance.toLocaleString()} د.ع. يرجى التكرم بتسوية الرصيد في أقرب وقت ممكن. شاكرين تعاونكم وثقتكم بنا.`;

    title.textContent = 'رسالة تذكير بالدفع والمستحقات';
    body.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:12px; direction:rtl;">
        <div style="font-size:12px; color:#94a3b8; margin-bottom:4px;">
          يمكنك نسخ الرسالة أدناه لإرسالها للعميل عبر الواتساب أو الرسائل القصيرة:
        </div>
        <div class="arap-reminder-box" id="reminder_text_box">${esc(messageText)}</div>
        <button class="ent-btn primary" style="width:100%; display:flex; align-items:center; justify-content:center; gap:8px;" onclick="entCopyReminderText()">
          📋 نسخ الرسالة إلى الحافظة
        </button>
      </div>
    `;

    overlay.style.display = 'flex';
    btnConfirm.style.display = 'none';
    btnCancel.textContent = 'إغلاق';
    btnCancel.onclick = function () { overlay.style.display = 'none'; };

    window.entCopyReminderText = function () {
      navigator.clipboard.writeText(messageText)
        .then(() => toast('تم نسخ نص التذكير بنجاح!', 'success'))
        .catch(() => toast('فشل النسخ التلقائي، يرجى النسخ يدويًا', 'warning'));
    };
  };

  window.entShowPaymentRunModal = function (recordId, supplierName, amount) {
    const overlay = document.getElementById('omniModalOverlay');
    const title = document.getElementById('omniModalTitle');
    const body = document.getElementById('omniModalBody');
    const btnCancel = document.getElementById('omniModalCancel');
    const btnConfirm = document.getElementById('omniModalConfirm');
    if (!overlay || !body) return;

    ensureData();
    const fDb = financeDb();
    const depts = fDb.departments || [];
    const deptOpts = depts.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
    const cats = fDb.categories?.expense || [];
    const catOpts = cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

    title.textContent = 'تشغيل دفعة سداد للمورد';
    body.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:12px; direction:rtl;">
        <div style="font-size:13px; color:#cbd5e1;">
          <strong>المورد:</strong> ${esc(supplierName)}<br>
          <strong>القيمة المستحقة:</strong> ${amount.toLocaleString()} د.ع
        </div>
        <label style="display:flex; flex-direction:column; gap:5px; font-size:12px; font-weight:700; color:#cbd5e1;">
          التصنيف المالي *
          <select id="payment_cat" class="ent-input">${catOpts}</select>
        </label>
        <label style="display:flex; flex-direction:column; gap:5px; font-size:12px; font-weight:700; color:#cbd5e1;">
          القسم المالي المسدد له *
          <select id="payment_dept" class="ent-input">${deptOpts}</select>
        </label>
        <label style="display:flex; flex-direction:column; gap:5px; font-size:12px; font-weight:700; color:#cbd5e1;">
          وسيلة الدفع *
          <select id="payment_method" class="ent-input">
            <option value="cash">نقداً من القاصة</option>
            <option value="bank">حساب بنكي / حوالة</option>
          </select>
        </label>
      </div>
    `;

    overlay.style.display = 'flex';
    btnConfirm.style.display = 'inline-block';
    btnConfirm.textContent = 'تأكيد السداد وتخريج المبلغ';
    btnCancel.textContent = 'إلغاء';

    btnCancel.onclick = function () { overlay.style.display = 'none'; };
    btnConfirm.onclick = function () {
      const catVal = document.getElementById('payment_cat').value;
      const deptVal = document.getElementById('payment_dept').value;
      const methodVal = document.getElementById('payment_method').value;

      const newTx = {
        id: uid('tx'),
        date: todayISO(),
        type: 'expense',
        direction: 'out',
        amount: amount,
        categoryId: catVal,
        departmentId: deptVal,
        description: 'سداد ذمم فاتورة مورد: ' + supplierName,
        partyName: supplierName,
        paymentMethod: methodVal,
        sourceType: 'ap_payment_run',
        sourceId: recordId
      };

      if (typeof window.addFinanceTransaction === 'function') {
        try {
          const created = window.addFinanceTransaction(newTx);
          if (created) {
            const rec = records('ar_ap', true).find(r => r.id === recordId);
            if (rec) {
              rec.status = 'done';
              rec.updatedAt = new Date().toISOString();
              rec.updatedBy = currentUserName();
              rec.note = 'تم السداد بالدفاتر عبر عملية تشغيل الدفعة بنجاح';
            }
            save();
            toast('تم ترحيل المعاملة المالية وإغلاق الفاتورة بالكامل', 'success');
            overlay.style.display = 'none';
            renderPage('ar_ap');
          }
        } catch (err) {
          toast('فشل ترحيل المعاملة المالية: ' + err.message, 'error');
        }
      } else {
        toast('خطأ: جسر المعاملات المالية غير متوفر حالياً', 'error');
      }
    };
  };

  // ─── Logistics / Delivery Workspace ───
  window.entSetLogisticsTab = function (tab) {
    logisticsActiveTab = tab;
    renderPage('logistics');
  };

  function renderLogisticsWorkspace() {
    const list = records('logistics');
    
    if (logisticsActiveTab === 'dispatch_board') {
      const readyJobs = (O().jobOrders || []).filter(w => 
        w && w.is_active !== false && 
        ['ready_for_delivery', 'delivery_ready', 'qc_passed', 'done'].includes(String(w.state || w.status || '').toLowerCase())
      );
      
      let leftHtml = '';
      readyJobs.forEach(job => {
        const logRec = list.find(r => r.sourceKey === 'wo-delivery:' + job.id);
        const driver = logRec ? logRec.party : 'غير معين';
        const status = logRec ? logRec.status : 'pending';
        
        let statusBadgeClass = 'logistics-card-status pending';
        let statusText = 'بانتظار التعيين';
        if (status === 'review') {
          statusBadgeClass = 'logistics-card-status dispatched';
          statusText = 'قيد التوصيل';
        } else if (status === 'done' || status === 'approved') {
          statusBadgeClass = 'logistics-card-status delivered';
          statusText = 'تم التسليم';
        }

        let actionBtn = '';
        if (status === 'pending') {
          actionBtn = `
            <button class="ent-btn primary" style="padding:4px 8px; font-size:11px;" onclick="entShowDispatchModal('${job.id}', '${esc(job.ref || job.id)}', '${esc(job.customerName || 'عميل')}', ${money(job.price)})">
              🚚 تعيين سائق وتوزيع
            </button>
          `;
        } else if (status === 'review') {
          actionBtn = `
            <span style="font-size:12px; color:#cbd5e1;">السائق المعين: <strong>${esc(driver)}</strong></span>
          `;
        }

        leftHtml += `
          <div class="logistics-card ${status === 'review' ? 'dispatched' : status === 'done' ? 'delivered' : ''}">
            <div class="logistics-card-header">
              <span class="logistics-card-title">${esc(job.ref || job.id)} - ${esc(job.customerName || 'عميل')}</span>
              <span class="${statusBadgeClass}">${statusText}</span>
            </div>
            <div class="logistics-card-desc">
              <strong>المنتج/التفاصيل:</strong> ${esc(job.product || job.description || 'طلب عمل')}<br>
              <strong>القيمة/مبلغ التحصيل (COD):</strong> ${fmt(job.price || job.total || 0)} د.ع<br>
              <strong>تاريخ التخريج:</strong> ${esc(job.dueDate || todayISO())}
            </div>
            <div class="logistics-card-actions">
              ${actionBtn}
            </div>
          </div>
        `;
      });

      if (!readyJobs.length) {
        leftHtml = `<div class="ent-empty">لا توجد طلبات عمل جاهزة للتوصيل حالياً في الورشة.</div>`;
      }

      return `
        <div class="logistics-workspace" style="direction:rtl;">
          <div class="logistics-pane" style="grid-column: 1 / -1; max-height:unset;">
            <h3 class="recon-pane-title">🚚 لوحة الشحن وإسناد مهام التوصيل</h3>
            <div class="recon-list">${leftHtml}</div>
          </div>
        </div>
      `;
    } else if (logisticsActiveTab === 'driver_pod') {
      const dispatchedList = list.filter(r => r.status === 'review');
      
      let cardsHtml = '';
      dispatchedList.forEach(r => {
        cardsHtml += `
          <div class="logistics-card dispatched">
            <div class="logistics-card-header">
              <span class="logistics-card-title">${esc(r.name)}</span>
              <span class="logistics-card-status dispatched">قيد التوصيل</span>
            </div>
            <div class="logistics-card-desc">
              <strong>السائق:</strong> ${esc(r.party)}<br>
              <strong>العميل/العنوان:</strong> ${esc(r.note || 'الزبون')}<br>
              <strong>مبلغ التحصيل (COD):</strong> ${fmt(r.amount)} د.ع
            </div>
            <div class="logistics-card-actions">
              <button class="ent-btn primary" style="padding:4px 8px; font-size:11px;" onclick="entShowPodModal('${r.id}', '${esc(r.name)}', '${esc(r.note)}', ${r.amount})">
                ✍️ إثبات الاستلام والتوقيع (POD)
              </button>
            </div>
          </div>
        `;
      });

      if (!dispatchedList.length) {
        cardsHtml = `<div class="ent-empty">لا توجد شحنات قيد التوصيل حالياً. قم بتعيين السائقين أولاً من لوحة الشحن.</div>`;
      }

      return `
        <div class="logistics-workspace" style="direction:rtl;">
          <div class="logistics-pane" style="grid-column: 1 / -1; max-height:unset;">
            <h3 class="recon-pane-title">📦 بوابة إثبات الاستلام الرقمي (Driver Cockpit)</h3>
            <div class="recon-list">${cardsHtml}</div>
          </div>
        </div>
      `;
    }
    return '';
  }

  window.entShowDispatchModal = function (recordId, orderRef, customerName, amount) {
    const overlay = document.getElementById('omniModalOverlay');
    const title = document.getElementById('omniModalTitle');
    const body = document.getElementById('omniModalBody');
    const btnCancel = document.getElementById('omniModalCancel');
    const btnConfirm = document.getElementById('omniModalConfirm');
    if (!overlay || !body) return;

    const drivers = [
      'أبو فهد - سائق شاحنة 1',
      'كابتن سجاد - دراجة توصيل سريعة',
      'كابتن علي - شاحنة 2 متوسطة'
    ];

    let selectedDriver = drivers[0];

    title.textContent = 'إسناد وتوصيل الشحنة';
    
    const driverOptions = drivers.map((d, index) => `
      <div class="driver-option ${index === 0 ? 'selected' : ''}" onclick="entSelectDriverOption(this, '${esc(d)}')">
        <div class="driver-option-avatar">${esc(d.charAt(0))}</div>
        <div style="font-size:12px; font-weight:700; color:#f8fafc;">${esc(d)}</div>
      </div>
    `).join('');

    body.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:12px; direction:rtl;">
        <div style="font-size:13px; color:#cbd5e1; margin-bottom:4px;">
          اختر سائق التوزيع المسؤول لتكليفه بنقل الشحنة <strong>${esc(orderRef)}</strong> للزبون <strong>${esc(customerName)}</strong>:
        </div>
        <div class="driver-selector-container">
          ${driverOptions}
        </div>
        <label style="display:flex; flex-direction:column; gap:5px; font-size:12px; font-weight:700; color:#cbd5e1; margin-top:8px;">
          أولوية التوصيل وطريقة المسار
          <select id="route_priority" class="ent-input">
            <option value="normal">عادي (خلال اليوم)</option>
            <option value="high">مستعجل (خلال ساعتين)</option>
          </select>
        </label>
      </div>
    `;

    overlay.style.display = 'flex';
    btnConfirm.style.display = 'inline-block';
    btnConfirm.textContent = 'اعتماد وإرسال السائق';
    btnCancel.textContent = 'إلغاء';

    window.entSelectDriverOption = function (el, driverName) {
      document.querySelectorAll('.driver-option').forEach(opt => opt.classList.remove('selected'));
      el.classList.add('selected');
      selectedDriver = driverName;
    };

    btnCancel.onclick = function () { overlay.style.display = 'none'; };
    btnConfirm.onclick = function () {
      const priority = document.getElementById('route_priority').value;

      ensureData();
      
      const newRec = stamp({
        id: uid('ent'),
        name: orderRef,
        party: selectedDriver,
        amount: amount,
        date: todayISO(),
        status: 'review',
        note: customerName + ' (' + priority + ')',
        sourceKey: 'wo-delivery:' + recordId,
        is_active: true,
        createdAt: new Date().toISOString(),
        createdBy: currentUserName()
      });

      hub('logistics').records.unshift(newRec);
      hub('logistics').events.unshift({ at: new Date().toISOString(), action: 'dispatched', id: newRec.id, by: currentUserName() });
      audit('logistics', 'dispatched', `إرسال الشحنة ${orderRef} مع السائق ${selectedDriver}`, newRec);
      save();
      toast('تم إسناد الشحنة للسائق وإطلاق مسار التوصيل بنجاح', 'success');
      overlay.style.display = 'none';
      renderPage('logistics');
    };
  };

  function initSignaturePad(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    let drawing = false;
    let lastX = 0;
    let lastY = 0;

    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      let clientX, clientY;
      if (e.touches && e.touches.length) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }
      return {
        x: clientX - rect.left,
        y: clientY - rect.top
      };
    }

    function startDraw(e) {
      e.preventDefault();
      drawing = true;
      const pos = getPos(e);
      lastX = pos.x;
      lastY = pos.y;
    }

    function draw(e) {
      if (!drawing) return;
      e.preventDefault();
      const pos = getPos(e);
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      lastX = pos.x;
      lastY = pos.y;
    }

    function stopDraw(e) {
      drawing = false;
    }

    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDraw);
    canvas.addEventListener('mouseleave', stopDraw);

    canvas.addEventListener('touchstart', startDraw);
    canvas.addEventListener('touchmove', draw);
    canvas.addEventListener('touchend', stopDraw);

    canvas.clear = function () {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }

  window.entShowPodModal = function (recordId, orderRef, customerName, codAmount) {
    const overlay = document.getElementById('omniModalOverlay');
    const title = document.getElementById('omniModalTitle');
    const body = document.getElementById('omniModalBody');
    const btnCancel = document.getElementById('omniModalCancel');
    const btnConfirm = document.getElementById('omniModalConfirm');
    if (!overlay || !body) return;

    title.textContent = 'تسجيل إثبات الاستلام والتوقيع (POD)';
    body.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:12px; direction:rtl;">
        <div style="font-size:13px; color:#cbd5e1;">
          <strong>الشحنة:</strong> ${esc(orderRef)}<br>
          <strong>العميل المستلم:</strong> ${esc(customerName)}<br>
          <strong>مبلغ التحصيل (COD):</strong> ${codAmount.toLocaleString()} د.ع
        </div>
        <label style="display:flex; flex-direction:column; gap:5px; font-size:12px; font-weight:700; color:#cbd5e1;">
          اسم الشخص المستلم الفعلي *
          <input id="pod_recipient" type="text" class="ent-input" value="${esc(customerName.split(' ')[0])}">
        </label>
        
        <div style="font-size:12px; font-weight:700; color:#cbd5e1; margin-top:4px;">توقيع المستلم الرقمي (لوحة التوقيع):</div>
        <div class="sig-pad-container">
          <canvas id="sig_canvas" class="sig-pad-canvas" width="280" height="120" style="background:#fff;"></canvas>
          <div class="sig-pad-actions" style="margin-top:6px;">
            <button class="ent-btn" style="padding:2px 8px; font-size:10px;" onclick="entClearSignature()">
              🧹 مسح التوقيع
            </button>
          </div>
        </div>

        <label style="display:flex; align-items:center; gap:8px; font-size:12px; font-weight:700; color:#cbd5e1; margin-top:4px; cursor:pointer;">
          <input id="pod_collect_cod" type="checkbox" checked ${codAmount <= 0 ? 'disabled' : ''}>
          تم تحصيل النقد الكامل (COD) وإدخاله لقاصة السائق
        </label>
      </div>
    `;

    overlay.style.display = 'flex';
    btnConfirm.style.display = 'inline-block';
    btnConfirm.textContent = 'تأكيد إثبات الاستلام والتسليم';
    btnCancel.textContent = 'إلغاء';

    const canvas = document.getElementById('sig_canvas');
    let pad = null;
    if (canvas) {
      initSignaturePad(canvas);
      pad = canvas;
    }

    window.entClearSignature = function () {
      if (pad && typeof pad.clear === 'function') pad.clear();
    };

    btnCancel.onclick = function () { overlay.style.display = 'none'; };
    btnConfirm.onclick = function () {
      const recipientVal = document.getElementById('pod_recipient').value;
      const collectCodVal = document.getElementById('pod_collect_cod').checked;

      if (!recipientVal) {
        toast('يرجى تحديد اسم المستلم الفعلي', 'warning');
        return;
      }

      ensureData();
      
      const rec = records('logistics', true).find(r => r.id === recordId);
      if (rec) {
        rec.status = 'done';
        rec.updatedAt = new Date().toISOString();
        rec.updatedBy = currentUserName();
        rec.note = 'تم الاستلام بواسطة: ' + recipientVal + ' (موقّع)';
        
        if (collectCodVal && codAmount > 0) {
          const newTx = {
            id: uid('tx'),
            date: todayISO(),
            type: 'income',
            direction: 'in',
            amount: codAmount,
            description: `تحصيل مبلغ شحنة COD: ${orderRef}`,
            partyName: recipientVal,
            paymentMethod: 'cash',
            sourceType: 'logistics_cod',
            sourceId: recordId
          };
          
          if (typeof window.addFinanceTransaction === 'function') {
            try { window.addFinanceTransaction(newTx); } catch (e) { console.warn(e); }
          }
        }

        const woId = rec.sourceKey ? rec.sourceKey.replace('wo-delivery:', '') : '';
        if (woId && O().jobOrders) {
          const wo = O().jobOrders.find(w => w.id === woId || w.ref === woId);
          if (wo) {
            wo.state = 'delivered';
            wo.status = 'delivered';
            wo.deliveredAt = new Date().toISOString();
            wo.recipientName = recipientVal;
            wo.note = (wo.note || '') + ' [تم التوصيل والتوقيع رقمياً عبر بوابة اللوجستيات]';
            save();
          }
        }
      }

      save();
      toast('تم تأكيد توصيل الشحنة بنجاح وتحديث كروت مسار الورشة المعنية', 'success');
      overlay.style.display = 'none';
      renderPage('logistics');
    };
  };

  // ─── IoT Camera Scanner Workspace ───
  let qrMediaStream = null;
  let qrAnimationId = null;
  let qrScannedResult = null;

  function renderDeviceScannerWorkspace() {
    const detailHtml = qrScannedResult ? renderQrScannedDetails(qrScannedResult) : `
      <div class="ent-empty" style="padding: 24px; border: 1px dashed rgba(148, 163, 184, 0.2); border-radius: 8px;">
        بانتظار قراءة الرمز أو الباركود...
      </div>
    `;

    return `
      <div class="qr-scanner-workspace" style="direction:rtl;">
        <div class="qr-pane">
          <h3 class="recon-pane-title">📷 عدسة المسح وكاميرا الـ IoT</h3>
          <div class="qr-canvas-container">
            <canvas id="qr_canvas" width="400" height="300" style="border-radius:8px;"></canvas>
            <div id="qr_flash_overlay" class="qr-canvas-overlay-flash">
              <i class="fa-solid fa-circle-check"></i>
            </div>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
            <button class="ent-btn primary" id="btn_toggle_camera" onclick="entToggleCameraStream()">
              🛑 إيقاف الكاميرا
            </button>
            <span id="camera_state_label" class="ent-chip ok">الكاميرا نشطة</span>
          </div>
          <div id="qr_details_container" style="margin-top:12px;">
            ${detailHtml}
          </div>
        </div>
        
        <div class="qr-pane" style="min-height:unset;">
          <h3 class="recon-pane-title">⚡ محاكي مسح الرموز (QR Barcode Simulator)</h3>
          <div style="font-size:12px; color:#cbd5e1; margin-bottom:12px;">
            اختر أحد الرموز التالية لمحاكاة مسح كرت المسار الفعلي بورشة التصنيع:
          </div>
          <div class="qr-sim-grid">
            <button class="qr-sim-btn wo" onclick="entSimulateQrScan('WO-2026-904')">
              <i class="fa-solid fa-file-invoice"></i>
              <div class="qr-sim-btn-info">
                <span class="qr-sim-btn-title">أمر عمل ورشة (Work Order: WO-2026-904)</span>
                <span class="qr-sim-btn-desc">مسار تصنيع الأجزاء والمخرطة CNC</span>
              </div>
            </button>
            <button class="qr-sim-btn wo" onclick="entSimulateQrScan('WO-2026-902')">
              <i class="fa-solid fa-file-invoice"></i>
              <div class="qr-sim-btn-info">
                <span class="qr-sim-btn-title">أمر عمل ورشة (Work Order: WO-2026-902)</span>
                <span class="qr-sim-btn-desc">كرت مسار تجميع المكونات والطلاء</span>
              </div>
            </button>
            <button class="qr-sim-btn mac" onclick="entSimulateQrScan('MAC-CNC-01')">
              <i class="fa-solid fa-screwdriver-wrench"></i>
              <div class="qr-sim-btn-info">
                <span class="qr-sim-btn-title">رمز ماكينة المخرطة (Machine: MAC-CNC-01)</span>
                <span class="qr-sim-btn-desc">حالة المخرطة وصيانة القطع في ورشة الإنتاج</span>
              </div>
            </button>
            <button class="qr-sim-btn mac" onclick="entSimulateQrScan('MAC-LASER-02')">
              <i class="fa-solid fa-screwdriver-wrench"></i>
              <div class="qr-sim-btn-info">
                <span class="qr-sim-btn-title">رمز ماكينة الليزر (Machine: MAC-LASER-02)</span>
                <span class="qr-sim-btn-desc">جهاز القص بالليزر الألماني TRUMPF</span>
              </div>
            </button>
            <button class="qr-sim-btn emp" onclick="entSimulateQrScan('EMP-2026-Ahmed')">
              <i class="fa-solid fa-id-card"></i>
              <div class="qr-sim-btn-info">
                <span class="qr-sim-btn-title">هوية الموظف (Badge: EMP-2026-Ahmed)</span>
                <span class="qr-sim-btn-desc">أحمد الموسوي - فني ميكانيك أقدم</span>
              </div>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function renderQrScannedResult(payload) {
    qrScannedResult = payload;
    const container = document.getElementById('qr_details_container');
    if (container) {
      container.innerHTML = renderQrScannedDetails(payload);
    }
  }

  function renderQrScannedDetails(payload) {
    let typeLabel = '';
    let typeClass = '';
    let name = '';
    let details = '';
    let destPage = '';
    
    if (payload.startsWith('WO-')) {
      typeLabel = 'أمر عمل ورشة';
      typeClass = 'workorder';
      name = 'كرت مسار الإنتاج والتجميع';
      details = `رقم القيد: <strong>${payload}</strong><br>العملية الحالية: CNC Milling & Turning<br>القسم المسؤول: الخراطة والتسوية`;
      destPage = 'work_orders';
    } else if (payload.startsWith('MAC-')) {
      typeLabel = 'معدة / ماكينة';
      typeClass = 'machine';
      name = 'سجل حالة ماكينة التصنيع';
      details = `رقم الماكينة: <strong>${payload}</strong><br>النوع: CNC Lathe 5-Axis<br>الصيانة الوقائية: مجدولة خلال 5 أيام`;
      destPage = 'machines';
    } else if (payload.startsWith('EMP-')) {
      typeLabel = 'هوية موظف';
      typeClass = 'employee';
      name = 'البطاقة التعريفية للكوادر';
      const nameStr = payload.includes('Ahmed') ? 'أحمد الموسوي' : 'زهراء الدربوز';
      details = `الرقم الوظيفي: <strong>${payload}</strong><br>الاسم الكامل: <strong>${nameStr}</strong><br>المنصب: مشغل ماكينات أقدم CNC`;
      destPage = 'employee_ui';
    } else {
      typeLabel = 'رمز غير معروف';
      typeClass = 'unknown';
      name = 'بيانات الرمز الملتقط';
      details = `محتوى الرمز: <strong>${payload}</strong>`;
      destPage = 'command_center';
    }

    return `
      <div class="qr-details-card">
        <div class="qr-details-header">
          <span class="qr-details-title">${esc(name)}</span>
          <span class="qr-type-badge ${typeClass}">${typeLabel}</span>
        </div>
        <div class="qr-details-grid">
          <div class="qr-details-item" style="grid-column: 1 / -1;">
            ${details}
          </div>
        </div>
        <div style="display:flex; justify-content:flex-end;">
          <button class="qr-handoff-btn" onclick="entNavigateToScannedEntity('${destPage}', '${payload}')">
            انتقال وإجراء العملية <i class="fa-solid fa-chevron-left"></i>
          </button>
        </div>
      </div>
    `;
  }

  window.entToggleCameraStream = function () {
    const btn = document.getElementById('btn_toggle_camera');
    const stateLabel = document.getElementById('camera_state_label');
    const scannerKpi = document.getElementById('scanner_kpi_chip');
    
    if (qrAnimationId) {
      entStopCameraStream();
      if (btn) btn.textContent = '▶️ تشغيل الكاميرا';
      if (stateLabel) {
        stateLabel.textContent = 'الكاميرا متوقفة';
        stateLabel.className = 'ent-chip warn';
      }
      if (scannerKpi) {
        scannerKpi.textContent = 'wired';
        scannerKpi.className = 'ent-chip';
      }
    } else {
      entStartCameraStream();
      if (btn) btn.textContent = '🛑 إيقاف الكاميرا';
      if (stateLabel) {
        stateLabel.textContent = 'الكاميرا نشطة';
        stateLabel.className = 'ent-chip ok';
      }
      if (scannerKpi) {
        scannerKpi.textContent = 'Real QR active';
        scannerKpi.className = 'ent-chip ok';
      }
    }
  };

  window.entStartCameraStream = function () {
    const canvas = document.getElementById('qr_canvas');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    qrScannedResult = null;
    
    entStopCameraStream();
    
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(stream => {
          qrMediaStream = stream;
          let video = document.getElementById('qr_hidden_video');
          if (!video) {
            video = document.createElement('video');
            video.id = 'qr_hidden_video';
            video.style.display = 'none';
            document.body.appendChild(video);
          }
          video.srcObject = stream;
          video.setAttribute('playsinline', true);
          video.play();
          
          qrAnimationId = requestAnimationFrame(() => entCameraRenderLoop(canvas, ctx, video));
          
          const label = document.getElementById('camera_state_label');
          if (label) {
            label.textContent = 'كاميرا ويب حية نشطة';
            label.className = 'ent-chip ok';
          }
          
          const chip = document.getElementById('scanner_kpi_chip');
          if (chip) {
            chip.textContent = 'Real QR active';
            chip.className = 'ent-chip ok';
          }
        })
        .catch(err => {
          console.warn('Camera access denied or unavailable, using simulation overlay loop', err);
          qrAnimationId = requestAnimationFrame(() => entCameraRenderLoop(canvas, ctx, null));
        });
    } else {
      qrAnimationId = requestAnimationFrame(() => entCameraRenderLoop(canvas, ctx, null));
    }
  };

  function entCameraRenderLoop(canvas, ctx, video) {
    if (!canvas || !document.getElementById('qr_canvas')) {
      entStopCameraStream();
      return;
    }
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (video && video.readyState === video.HAVE_ENOUGH_DATA) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = '#0b0f19';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      for (let x = 20; x < canvas.width; x += 20) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
      }
      for (let y = 20; y < canvas.height; y += 20) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
      }
      
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '12px Cairo, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('محاكي المسح التلقائي نشط (Webcam Standby)', canvas.width / 2, 40);
    }
    
    const boxSize = 180;
    const x = (canvas.width - boxSize) / 2;
    const y = (canvas.height - boxSize) / 2;
    
    ctx.fillStyle = 'rgba(2, 6, 23, 0.65)';
    ctx.fillRect(0, 0, canvas.width, y);
    ctx.fillRect(0, y + boxSize, canvas.width, canvas.height - (y + boxSize));
    ctx.fillRect(0, y, x, boxSize);
    ctx.fillRect(x + boxSize, y, canvas.width - (x + boxSize), boxSize);
    
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 3;
    
    const bracketLen = 20;
    ctx.beginPath(); ctx.moveTo(x + bracketLen, y); ctx.lineTo(x, y); ctx.lineTo(x, y + bracketLen); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + boxSize - bracketLen, y); ctx.lineTo(x + boxSize, y); ctx.lineTo(x + boxSize, y + bracketLen); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + bracketLen, y + boxSize); ctx.lineTo(x, y + boxSize); ctx.lineTo(x, y + boxSize - bracketLen); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + boxSize - bracketLen, y + boxSize); ctx.lineTo(x + boxSize, y + boxSize); ctx.lineTo(x + boxSize, y + boxSize - bracketLen); ctx.stroke();
    
    const laserY = y + (Math.sin(Date.now() / 250) + 1) * 0.5 * boxSize;
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.88)';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#ef4444';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(x + 2, laserY);
    ctx.lineTo(x + boxSize - 2, laserY);
    ctx.stroke();
    
    ctx.shadowBlur = 0;
    
    qrAnimationId = requestAnimationFrame(() => entCameraRenderLoop(canvas, ctx, video));
  }

  window.entStopCameraStream = function () {
    if (qrAnimationId) {
      cancelAnimationFrame(qrAnimationId);
      qrAnimationId = null;
    }
    
    if (qrMediaStream) {
      try {
        qrMediaStream.getTracks().forEach(t => t.stop());
      } catch (e) {
        console.warn('Error stopping camera tracks', e);
      }
      qrMediaStream = null;
    }
    
    const video = document.getElementById('qr_hidden_video');
    if (video) {
      try { video.remove(); } catch (_) {}
    }
  };

  window.entSimulateQrScan = function (payload) {
    const flash = document.getElementById('qr_flash_overlay');
    if (flash) {
      flash.classList.add('flash-active');
      setTimeout(() => flash.classList.remove('flash-active'), 350);
    }
    
    toast('تم قراءة الرمز الثنائي بنجاح: ' + payload, 'success');
    audit('device_center', 'qr_scan_success', 'QR decoded: ' + payload, { payload });
    save();
    
    renderQrScannedResult(payload);
  };

  window.entNavigateToScannedEntity = function (destPage, payload) {
    if (typeof window.switchPage !== 'function') {
      toast('ميزة الانتقال المباشر غير متوفرة', 'warning');
      return;
    }
    
    entStopCameraStream();
    
    try {
      window.switchPage(destPage);
      toast('تم الانتقال تلقائياً لمراجعة المكون: ' + payload, 'success');
      
      setTimeout(() => {
        if (destPage === 'work_orders') {
          const inp = document.getElementById('woSearch') || document.querySelector('.wo-search-input');
          if (inp) {
            inp.value = payload;
            inp.dispatchEvent(new Event('input', { bubbles: true }));
          }
        } else if (destPage === 'machines') {
          const inp = document.getElementById('machineSearch') || document.querySelector('.machine-search-input');
          if (inp) {
            inp.value = payload.replace('MAC-', '');
            inp.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      }, 300);
      
    } catch (e) {
      console.error('Error navigating via scanner handoff', e);
    }
  };

  window.entSetDeviceTab = function (tab) {
    if (tab !== 'scanner') {
      entStopCameraStream();
    }
    deviceActiveTab = tab;
    renderPage('device_center');
  };


  // ─── Phase 7: Supplier Portal — RFQ Comparison Workspace ───
  let supplierPortalActiveTab = 'overview';

  function renderRfqWorkspace() {
    const lowStockItems = lowStock().slice(0, 12);
    const openPOs = (O().purchaseOrders || []).filter(po => !['received', 'done', 'cancelled'].includes(String(po.status || '').toLowerCase()));
    const suppliers = (O().suppliers || []).slice(0, 10);

    const criticalItems = lowStockItems.filter(m => {
      const stock = money(m.stock || m.qty || 0);
      const min = money(m.minStock || m.minimumStock || 0);
      return stock === 0 || (min > 0 && stock / min < 0.25);
    });

    const summaryHtml = `
      <div class="rfq-summary-bar">
        <div class="rfq-summary-card urgent">
          <div class="rfq-summary-value">${criticalItems.length}</div>
          <div class="rfq-summary-label">Critical Stock</div>
          <div class="rfq-summary-sub">Zero or near-zero</div>
        </div>
        <div class="rfq-summary-card warn">
          <div class="rfq-summary-value">${lowStockItems.length}</div>
          <div class="rfq-summary-label">Low Stock Items</div>
          <div class="rfq-summary-sub">Below minimum</div>
        </div>
        <div class="rfq-summary-card info">
          <div class="rfq-summary-value">${openPOs.length}</div>
          <div class="rfq-summary-label">Open POs</div>
          <div class="rfq-summary-sub">Pending delivery</div>
        </div>
        <div class="rfq-summary-card ok">
          <div class="rfq-summary-value">${suppliers.length}</div>
          <div class="rfq-summary-label">Suppliers</div>
          <div class="rfq-summary-sub">In registry</div>
        </div>
      </div>
    `;

    // Low stock items list
    const itemsHtml = lowStockItems.length ? lowStockItems.map(m => {
      const stock = money(m.stock || m.qty || 0);
      const min = money(m.minStock || m.minimumStock || 0);
      const needed = Math.max(0, min - stock + min);
      const pct = min > 0 ? Math.min(100, Math.round((stock / min) * 100)) : (stock > 0 ? 100 : 0);
      const severity = pct === 0 ? 'critical' : pct < 25 ? 'critical' : '';
      const fillClass = pct === 0 ? 'low' : pct < 50 ? 'low' : pct < 80 ? 'medium' : 'ok';
      return `
        <div class="rfq-item-card ${severity}">
          <div class="rfq-item-header">
            <div class="rfq-item-name">${esc(m.name || m.material || 'بند مستودع')}</div>
            ${severity === 'critical' ? '<span class="rfq-badge-urgent">⚠ طارئ</span>' : ''}
          </div>
          <div class="rfq-item-meta">
            <span>المخزون الحالي: <strong style="color:#f1f5f9">${stock.toLocaleString()}</strong> ${esc(m.unit || '')}</span>
            <span>الحد الأدنى: ${min.toLocaleString()} | المطلوب: ~${needed.toLocaleString()}</span>
            ${m.preferredSupplier ? `<span>المورد المفضل: ${esc(m.preferredSupplier)}</span>` : ''}
          </div>
          <div class="rfq-stock-bar">
            <div class="rfq-stock-fill ${fillClass}" style="width:${pct}%"></div>
          </div>
          <div class="rfq-action-row">
            <button class="ent-btn" style="padding:3px 8px; font-size:10px;" onclick="entRfqSendRequest('${esc(m.name || '')}', ${needed})">
              📤 إرسال طلب عرض سعر
            </button>
            <button class="ent-btn primary" style="padding:3px 8px; font-size:10px;" onclick="entRfqCreatePO('${esc(m.name || '')}', ${needed})">
              📋 إنشاء أمر شراء
            </button>
          </div>
        </div>
      `;
    }).join('') : `<div class="ent-empty">✅ لا توجد مواد تحت الحد الأدنى حالياً</div>`;

    // Supplier comparison matrix with mock quotes
    const mockSuppliers = suppliers.length ? suppliers.slice(0, 4) : [
      { name: 'الشركة العامة للحديد والصلب', id: 's1' },
      { name: 'مستودع الرافدين للمواد', id: 's2' },
      { name: 'تجهيزات باب بابل', id: 's3' }
    ];

    const compareItems = lowStockItems.slice(0, 3);
    let tableHtml = '';
    if (compareItems.length) {
      const headerCols = mockSuppliers.map(s => `<th>${esc(s.name || s.companyName || 'مورد')}</th>`).join('');
      const rows = compareItems.map((m, mi) => {
        const needed = Math.max(1, money(m.minStock || m.minimumStock || 10) - money(m.stock || 0));
        const prices = mockSuppliers.map((_, si) => {
          const base = 1500 + (mi * 400) + (si * 200);
          return Math.round(base * (0.85 + Math.random() * 0.3));
        });
        const bestIdx = prices.indexOf(Math.min(...prices));
        const cells = prices.map((p, si) =>
          `<td>${p.toLocaleString()} ${activeProfile().currencySymbol || 'IQD'} ${si === bestIdx ? '<span class="rfq-best-badge">✓ أفضل</span>' : ''}</td>`
        ).join('');
        return `<tr><td><strong>${esc(m.name || 'بند')}</strong><br><span style="color:#64748b;font-size:10px">الكمية: ${needed.toLocaleString()}</span></td>${cells}</tr>`;
      });

      tableHtml = `
        <div class="rfq-panel" style="overflow:auto">
          <div class="rfq-panel-head">
            <h3>📊 مقارنة عروض الأسعار (محاكاة)</h3>
          </div>
          <div style="overflow-x:auto; padding:14px;">
            <table class="rfq-compare-table">
              <thead><tr><th>المادة</th>${headerCols}</tr></thead>
              <tbody>${rows.join('')}</tbody>
            </table>
          </div>
        </div>
      `;
    }

    // Open POs tracker
    const poHtml = openPOs.length ? openPOs.slice(0, 6).map(po => {
      const daysLeft = po.expectedDate ? Math.round((new Date(po.expectedDate) - new Date()) / 86400000) : null;
      return `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px; background:rgba(30,41,59,0.3); border-radius:6px; font-size:11px; border:1px solid rgba(148,163,184,0.1);">
          <div>
            <strong style="color:#f1f5f9">${esc(po.reference || po.ref || po.id)}</strong>
            <div style="color:#64748b">${esc(po.supplierName || po.supplier || 'مورد')}</div>
          </div>
          <div style="text-align:right">
            <div style="color:#fbbf24">${fmt(po.total || po.amount)} ${activeProfile().currencySymbol || 'IQD'}</div>
            ${daysLeft !== null ? `<div style="color:${daysLeft < 0 ? '#f87171' : daysLeft < 3 ? '#fbbf24' : '#94a3b8'}">${daysLeft < 0 ? 'متأخر ' + Math.abs(daysLeft) + 'ي' : 'خلال ' + daysLeft + ' يوم'}</div>` : ''}
          </div>
        </div>
      `;
    }).join('') : '<div class="ent-empty">لا توجد أوامر شراء مفتوحة</div>';

    return `
      <div class="rfq-workspace">
        ${summaryHtml}
        <div class="rfq-main-grid">
          <div class="rfq-panel">
            <div class="rfq-panel-head">
              <h3>📦 قائمة المواد منخفضة المخزون (${lowStockItems.length} بند)</h3>
              <button class="ent-btn" style="padding:4px 10px; font-size:11px;" onclick="entRfqSendAllRequests()">
                📨 إرسال طلبات جماعية
              </button>
            </div>
            <div class="rfq-panel-body">${itemsHtml}</div>
          </div>
          <div style="display:flex; flex-direction:column; gap:16px;">
            <div class="rfq-panel">
              <div class="rfq-panel-head"><h3>🕐 أوامر الشراء المفتوحة</h3></div>
              <div class="rfq-panel-body" style="gap:8px">${poHtml}</div>
            </div>
          </div>
        </div>
        ${tableHtml}
      </div>
    `;
  }

  window.entRfqSendRequest = function (materialName, qty) {
    toast('تم إرسال طلب عرض سعر لـ: ' + materialName + ' (الكمية: ' + qty + ')', 'success');
    audit('supplier_portal', 'rfq_send', 'RFQ sent for: ' + materialName, { materialName, qty });
    save();
  };

  window.entRfqCreatePO = function (materialName, qty) {
    toast('تم إنشاء مسودة أمر شراء لـ: ' + materialName, 'info');
    audit('supplier_portal', 'po_create', 'PO draft for: ' + materialName, { materialName, qty });
    save();
  };

  window.entRfqSendAllRequests = function () {
    const count = lowStock().length;
    if (!count) { toast('لا توجد مواد تحتاج طلبات حالياً', 'info'); return; }
    toast('تم إرسال ' + count + ' طلب عرض سعر لجميع المواد المنخفضة', 'success');
    audit('supplier_portal', 'rfq_bulk_send', 'Bulk RFQ sent for ' + count + ' items', { count });
    save();
  };

  window.entSetSupplierPortalTab = function (tab) {
    supplierPortalActiveTab = tab;
    renderPage('supplier_portal');
  };

  // ─── Phase 7: Integration Hub — Connector Status Board ───
  function renderIntegrationHubWorkspace() {
    const wa = (O().whatsappSuggestions || []).filter(x => x.status === 'pending_review').length;
    const aiTools = O().aiToolRegistry || [];
    const criticalEnabled = aiTools.filter(t => t.enabled && ['high', 'critical'].includes(t.riskLevel)).length;
    const backupEvents = O().auditLog || O().historyLedger || [];

    const connectors = [
      {
        name: 'WhatsApp Business API',
        provider: 'Meta Platforms',
        icon: 'whatsapp',
        faIcon: 'fa-whatsapp',
        status: 'review',
        statusLabel: 'يحتاج إعداد',
        metrics: { messages: wa, errors: 0, uptime: 'N/A', latency: 'N/A' },
        metricLabels: { messages: 'في الانتظار', errors: 'أخطاء', uptime: 'وقت التشغيل', latency: 'زمن الاستجابة' },
        log: [
          { sev: 'warn', time: 'اليوم', text: 'HTTPS endpoint required for production webhook' },
          { sev: 'warn', time: 'اليوم', text: 'Missing: WHATSAPP_APP_SECRET environment variable' }
        ],
        note: 'يتطلب نطاق HTTPS ورمز إنتاج وحدود إرسال للعمليات الحية'
      },
      {
        name: 'البريد الإلكتروني / SMS',
        provider: 'مزود المراسلة',
        icon: 'email',
        faIcon: 'fa-envelope',
        status: 'inactive',
        statusLabel: 'غير مفعّل',
        metrics: { messages: 0, errors: 0, uptime: '—', latency: '—' },
        metricLabels: { messages: 'رسائل', errors: 'أخطاء', uptime: 'وقت التشغيل', latency: 'زمن الرد' },
        log: [
          { sev: 'warn', time: 'قريباً', text: 'تحديد مزود SMTP أو API لإرسال الإشعارات' }
        ],
        note: 'يحتاج: اختيار مزود، طابور إعادة المحاولة، وبوابة موافقة قبل الإرسال'
      },
      {
        name: 'نظام النسخ الاحتياطي',
        provider: 'الخادم المحلي',
        icon: 'backup',
        faIcon: 'fa-database',
        status: backupEvents.length > 10 ? 'active' : 'review',
        statusLabel: backupEvents.length > 10 ? 'نشط' : 'يحتاج مراجعة',
        metrics: { messages: backupEvents.length, errors: 0, uptime: '24/7', latency: 'محلي' },
        metricLabels: { messages: 'سجلات', errors: 'أخطاء', uptime: 'الجدولة', latency: 'النسخ' },
        log: [
          { sev: 'ok', time: 'اليوم', text: backupEvents.length + ' سجل محفوظ في قاعدة البيانات' },
          { sev: 'warn', time: 'مطلوب', text: 'نسخ خارجية دورية (USB أو Cloud) غير مضمونة بعد' }
        ],
        note: 'انجز اختبار استعادة كاملة واحدة قبل بدء الإنتاج'
      },
      {
        name: 'بوابة حوكمة الذكاء الاصطناعي',
        provider: 'Octagon AI Layer',
        icon: 'api',
        faIcon: 'fa-robot',
        status: criticalEnabled ? 'error' : 'review',
        statusLabel: criticalEnabled ? 'خطر: أدوات عالية الخطورة مفعّلة' : 'تحت المراجعة',
        metrics: { messages: aiTools.length, errors: criticalEnabled, uptime: '100%', latency: 'داخلي' },
        metricLabels: { messages: 'أدوات مسجلة', errors: 'خطر مرتفع', uptime: 'توفر', latency: 'نوع' },
        log: [
          criticalEnabled
            ? { sev: 'error', time: 'الآن', text: criticalEnabled + ' أداة عالية الخطورة مفعّلة — يُنصح بتعطيلها' }
            : { sev: 'ok', time: 'الآن', text: 'لا توجد أدوات ذكاء اصطناعي عالية الخطورة مفعّلة حالياً' },
          { sev: 'warn', time: 'مطلوب', text: 'ربط الإجراءات الحساسة ببوابة الموافقة قبل الإنتاج' }
        ],
        note: 'جميع الإجراءات التلقائية يجب أن تمر بموافقة مدير قبل التنفيذ في الإنتاج'
      },
      {
        name: 'طابعة الإيصالات والوثائق',
        provider: 'الشبكة المحلية',
        icon: 'printer',
        faIcon: 'fa-print',
        status: 'inactive',
        statusLabel: 'في الانتظار',
        metrics: { messages: 0, errors: 0, uptime: '—', latency: '—' },
        metricLabels: { messages: 'مطبوعات', errors: 'أخطاء', uptime: 'اتصال', latency: 'الطابعة' },
        log: [
          { sev: 'warn', time: 'مطلوب', text: 'اختبار طباعة إيصال توصيل وبطاقة سيارة (traveller card)' }
        ],
        note: 'اختبر الطباعة الفعلية على الشبكة المحلية قبل تفعيل استخدام حقلي'
      },
      {
        name: 'ماسح الباركود / QR',
        provider: 'كاميرا الموبايل / حارة',
        icon: 'sms',
        faIcon: 'fa-qrcode',
        status: 'review',
        statusLabel: 'محاكاة نشطة',
        metrics: { messages: 0, errors: 0, uptime: 'HTML5', latency: 'مباشر' },
        metricLabels: { messages: 'عمليات مسح', errors: 'أخطاء', uptime: 'النوع', latency: 'الوضع' },
        log: [
          { sev: 'ok', time: 'اليوم', text: 'كاميرا HTML5 نشطة في وضع المحاكاة' },
          { sev: 'warn', time: 'مطلوب', text: 'اختبار قراءة QR حقيقية على جهاز Android وiPhone' }
        ],
        note: 'استخدم وضع Scanner في صفحة Device Center لاختبار مسح القرود الثنائية الحقيقية'
      }
    ];

    const statusConfig = {
      active: { label: 'نشط', color: '#34d399', dotClass: 'active' },
      review: { label: 'مراجعة', color: '#fbbf24', dotClass: 'review' },
      error: { label: 'خطأ', color: '#f87171', dotClass: 'error' },
      inactive: { label: 'غير مفعّل', color: '#475569', dotClass: 'inactive' }
    };

    const cardsHtml = connectors.map(c => {
      const st = statusConfig[c.status] || statusConfig.review;
      const logHtml = c.log.map(l =>
        `<div class="hub-log-entry"><div class="hub-log-dot ${l.sev}"></div><span class="hub-log-time">${esc(l.time)}</span><span class="hub-log-text">${esc(l.text)}</span></div>`
      ).join('');

      return `
        <div class="hub-connector-card ${c.status}">
          <div class="hub-card-header">
            <div class="hub-card-icon ${c.icon}">
              <i class="fa-brands ${c.faIcon}" style="font-size:18px"></i>
            </div>
            <div>
              <div class="hub-card-name">${esc(c.name)}</div>
              <div class="hub-card-provider">${esc(c.provider)}</div>
            </div>
          </div>
          <div class="hub-status-row">
            <div class="hub-status-indicator" style="color:${st.color}">
              <div class="hub-status-dot ${st.dotClass}"></div>
              ${esc(st.label)}
            </div>
          </div>
          <div class="hub-card-metrics">
            <div class="hub-metric-item">
              <div class="hub-metric-value">${esc(String(c.metrics.messages))}</div>
              <div class="hub-metric-label">${esc(c.metricLabels.messages)}</div>
            </div>
            <div class="hub-metric-item">
              <div class="hub-metric-value">${esc(String(c.metrics.uptime))}</div>
              <div class="hub-metric-label">${esc(c.metricLabels.uptime)}</div>
            </div>
          </div>
          <div class="hub-retry-log">
            <h4>سجل الأحداث</h4>
            ${logHtml}
          </div>
          <div style="font-size:11px; color:#475569; padding:4px 0; border-top:1px dashed rgba(148,163,184,0.1);">
            💡 ${esc(c.note)}
          </div>
          <div class="hub-card-actions">
            <button class="ent-btn" style="padding:4px 8px; font-size:10px; flex:1;" onclick="entHubTestConnector('${esc(c.name)}')">
              🔌 اختبار الاتصال
            </button>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="hub-workspace">
        <div class="hub-connector-grid">${cardsHtml}</div>
      </div>
    `;
  }

  window.entHubTestConnector = function (name) {
    toast('جارٍ فحص اتصال: ' + name + ' (محاكاة)', 'info');
    audit('integration_hub', 'connector_test', 'Connector test triggered: ' + name, { name });
  };

  window.entSetIntegrationTab = function (tab) {
    renderPage('integration_hub');
  };

  // ─── Phase 7: Security Center — Audit Timeline & Risk Meter ───
  function renderSecurityWorkspace() {
    const aiLog = (O().aiAuditLog || []).slice(-20).reverse();
    const historyLog = (O().historyLedger || []).slice(-20).reverse();
    const users = (O().users || []);
    const aiTools = (O().aiToolRegistry || []);
    const criticalEnabled = aiTools.filter(t => t.enabled && ['high', 'critical'].includes(t.riskLevel));
    const rh = routeHealthSummary();

    // Build combined audit timeline
    const allEvents = [
      ...aiLog.map(e => ({
        type: 'ai',
        sev: e.outcome === 'blocked' ? 'bad' : e.outcome === 'approved' ? 'ok' : 'warn',
        icon: '🤖',
        title: (e.action || 'AI Action') + (e.toolName ? ': ' + e.toolName : ''),
        meta: (e.requestedBy || 'system') + ' · ' + (e.at || e.timestamp || '').slice(0, 16),
        at: e.at || e.timestamp || ''
      })),
      ...historyLog.map(e => ({
        type: 'history',
        sev: 'info',
        icon: '📋',
        title: (e.module || '') + ' · ' + (e.action || 'event'),
        meta: (e.user || 'system') + ' · ' + (e.at || e.timestamp || '').slice(0, 16),
        at: e.at || e.timestamp || ''
      }))
    ].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 24);

    // Add some always-visible system events if log is empty
    if (!allEvents.length) {
      allEvents.push(
        { sev: 'info', icon: '🟢', title: 'نظام الجلسة نشط', meta: 'system · ' + new Date().toISOString().slice(0, 16) },
        { sev: 'warn', icon: '🔒', title: 'حد المصادقة المحلي: الإنتاج يتطلب TLS وحد حقيقي', meta: 'تحقق من الإعدادات' },
        { sev: rh && rh.bad ? 'bad' : 'ok', icon: rh && rh.bad ? '🔴' : '✅', title: rh && rh.bad ? `${rh.bad} مسار يحتاج إصلاح` : 'صحة المسار: جيدة', meta: `nav: ${rh?.nav || 0}, pages: ${rh?.pages || 0}` }
      );
    }

    const timelineHtml = allEvents.map(e => `
      <div class="security-event">
        <div class="security-event-dot ${e.sev}">${esc(e.icon)}</div>
        <div class="security-event-content">
          <div class="security-event-title">${esc(e.title)}</div>
          <div class="security-event-meta">${esc(e.meta || '')}</div>
        </div>
      </div>
    `).join('');

    // Risk meter configuration
    const routeRisk = rh && rh.bad ? Math.min(100, rh.bad * 10) : 5;
    const authRisk = 90; // always high: local server not production auth
    const aiRisk = criticalEnabled.length ? Math.min(100, criticalEnabled.length * 25) : 10;
    const dataRisk = countMissingCompanyId(['materials', 'jobOrders', 'suppliers']) > 0 ? 55 : 10;
    const userRisk = users.length > 5 ? 30 : users.length > 0 ? 20 : 10;

    function riskClass(val) {
      if (val >= 80) return 'critical';
      if (val >= 55) return 'high';
      if (val >= 30) return 'medium';
      return 'low';
    }

    const riskRows = [
      { label: 'حد المصادقة', val: authRisk },
      { label: 'Route Health', val: routeRisk },
      { label: 'أدوات AI عالية الخطورة', val: aiRisk },
      { label: 'عزل البيانات', val: dataRisk },
      { label: 'صلاحيات المستخدمين', val: userRisk }
    ].map(r => `
      <div class="risk-row">
        <div class="risk-label">${esc(r.label)}</div>
        <div class="risk-bar"><div class="risk-bar-fill ${riskClass(r.val)}" style="width:${r.val}%"></div></div>
        <div class="risk-score ${riskClass(r.val)}">${r.val}</div>
      </div>
    `).join('');

    // Critical controls
    const controlsHtml = criticalEnabled.length ? criticalEnabled.slice(0, 4).map(t =>
      `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;background:rgba(127,29,29,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:6px;font-size:11px;">
        <span style="color:#fca5a5">${esc(t.name || t.id)}</span>
        <span style="color:#f87171;font-weight:700">خطر ${esc(t.riskLevel || 'high')}</span>
      </div>`
    ).join('') : `<div class="ent-empty" style="font-size:12px">✅ لا توجد أدوات عالية الخطورة مفعّلة حالياً</div>`;

    return `
      <div class="security-workspace">
        <div class="security-timeline">
          <div class="security-timeline-head">
            <h3>📋 سجل الأحداث والتدقيق</h3>
            <span class="ent-chip ${allEvents.length > 0 ? 'ok' : 'warn'}">${allEvents.length} حدث</span>
          </div>
          <div class="security-timeline-body">${timelineHtml || '<div class="ent-empty">لا توجد أحداث مسجلة بعد</div>'}</div>
        </div>

        <div class="security-panel-right">
          <div class="security-risk-card">
            <h4>📊 مؤشر مخاطر الأمن</h4>
            <div class="risk-meter">${riskRows}</div>
          </div>

          <div class="security-risk-card">
            <h4>⚠️ أدوات الذكاء الاصطناعي عالية الخطورة</h4>
            <div style="display:flex;flex-direction:column;gap:6px;">${controlsHtml}</div>
          </div>

          <div class="security-risk-card">
            <h4>👥 ملخص المستخدمين والصلاحيات</h4>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;">
              <div style="text-align:center;padding:10px;background:rgba(15,23,42,0.4);border-radius:8px;">
                <div style="font-size:20px;font-weight:900;color:#60a5fa">${users.length}</div>
                <div style="color:#64748b;font-size:10px">مستخدم مسجل</div>
              </div>
              <div style="text-align:center;padding:10px;background:rgba(15,23,42,0.4);border-radius:8px;">
                <div style="font-size:20px;font-weight:900;color:${rh && rh.bad ? '#f87171' : '#34d399'}">${rh ? rh.bad : '?'}</div>
                <div style="color:#64748b;font-size:10px">مسار معطل</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  window.entSetSecurityTab = function (tab) {
    renderPage('security_center');
  };

  // ─── Phase 7: Training / LMS — Course Builder ───
  let trainingActiveTab = 'overview';

  function renderTrainingWorkspace() {
    const sops = (O().sops || []).slice(0, 6);
    const machines = (O().machines || []).filter(m => m.status === 'active' || m.is_active !== false).slice(0, 4);

    const courses = [
      {
        icon: '🔧',
        title: 'السلامة الأساسية ومعدات الحماية الشخصية',
        desc: 'إلزامي لجميع موظفي الورشة. يغطي: طفايات الحريق، المسالك الطارئة، معدات الحماية الشخصية (PPE).',
        type: 'mandatory',
        typeLabel: 'إلزامي',
        progress: 68,
        modules: [
          { done: true, name: 'مقدمة السلامة والمخاطر' },
          { done: true, name: 'أنواع طفايات الحريق' },
          { done: true, name: 'معدات الحماية الشخصية (PPE)' },
          { done: false, name: 'إخلاء الطوارئ والتدريب الميداني' },
          { done: false, name: 'اختبار التحقق والشهادة' }
        ]
      },
      {
        icon: '⚙️',
        title: 'تشغيل مخرطة CNC والسلامة التشغيلية',
        desc: 'خاص بمشغلي الآلات. يتطلب إتمامه قبل السماح بتشغيل خط الإنتاج.',
        type: 'mandatory',
        typeLabel: 'إلزامي',
        progress: 45,
        modules: [
          { done: true, name: 'مقدمة المخرطة والأجزاء الرئيسية' },
          { done: true, name: 'إعداد المشغل وإجراءات بدء التشغيل' },
          { done: false, name: 'قراءة برامج G-code الأساسية' },
          { done: false, name: 'الصيانة اليومية والفحص الدوري' },
          { done: false, name: 'اختبار تشغيل حقيقي بإشراف مشرف' }
        ]
      },
      {
        icon: '📋',
        title: 'إجراءات مراقبة الجودة (QC) وبطاقة المسار',
        desc: 'تدريب على تعبئة بطاقة السيارة، فحص الأبعاد، وتوثيق اعتماد QC.',
        type: 'optional',
        typeLabel: 'اختياري',
        progress: 80,
        modules: [
          { done: true, name: 'مقدمة مراقبة الجودة وأهميتها' },
          { done: true, name: 'تعبئة بطاقة المسار الرقمية' },
          { done: true, name: 'قراءة رسومات الأبعاد' },
          { done: true, name: 'توثيق اعتماد QC والمخالفات' },
          { done: false, name: 'مراجعة حالات العيب والتصحيح' }
        ]
      },
      {
        icon: '🚚',
        title: 'إجراءات التوصيل وإثبات الاستلام الرقمي',
        desc: 'للسائقين ومنسقي التوصيل. يغطي POD الرقمي، تحصيل COD، وتحديث حالة أمر العمل.',
        type: 'refresher',
        typeLabel: 'تحديثي',
        progress: 100,
        modules: [
          { done: true, name: 'إجراءات التوصيل ومتطلبات POD' },
          { done: true, name: 'التوقيع الرقمي وتسجيل المستلم' },
          { done: true, name: 'تحصيل COD وإدخال الكاشير' },
          { done: true, name: 'تحديث حالة أمر العمل في النظام' }
        ]
      }
    ];

    const coursesHtml = courses.map(c => {
      const modulesHtml = c.modules.map(m =>
        `<div class="lms-module-item ${m.done ? 'done' : ''}">
          <i class="fa-solid ${m.done ? 'fa-circle-check' : 'fa-circle'}"></i>
          ${esc(m.name)}
        </div>`
      ).join('');

      return `
        <div class="lms-course-card">
          <span class="lms-course-badge ${c.type}">${esc(c.typeLabel)}</span>
          <div class="lms-course-icon">${esc(c.icon)}</div>
          <div class="lms-course-title">${esc(c.title)}</div>
          <div class="lms-course-desc">${esc(c.desc)}</div>
          <div class="lms-progress-row">
            <div class="lms-progress-bar">
              <div class="lms-progress-fill" style="width:${c.progress}%"></div>
            </div>
            <div class="lms-progress-label">${c.progress}%</div>
          </div>
          <div class="lms-module-list">${modulesHtml}</div>
          <div class="ent-actions" style="margin-top:4px;">
            <button class="ent-btn primary" style="padding:4px 8px;font-size:10px;" onclick="entLmsStartCourse('${esc(c.title)}')">
              ${c.progress === 100 ? '🏆 عرض الشهادة' : '▶ متابعة الدورة'}
            </button>
            <button class="ent-btn" style="padding:4px 8px;font-size:10px;" onclick="entLmsAssignCourse('${esc(c.title)}')">
              👥 تعيين للموظفين
            </button>
          </div>
        </div>
      `;
    }).join('');

    // SOP links section
    const sopLinksHtml = sops.length ? sops.map(s =>
      `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:rgba(30,41,59,0.3);border-radius:6px;font-size:11px;border:1px solid rgba(148,163,184,0.1);">
        <span style="color:#f1f5f9">${esc(s.title || s.name || 'SOP')}</span>
        <button class="ent-btn" style="padding:2px 6px;font-size:10px;" onclick="entLmsLinkSop('${esc(s.id || s.title || '')}')">
          🔗 ربط دورة
        </button>
      </div>`
    ).join('') : '<div class="ent-empty">لا توجد SOPs في النظام حالياً</div>';

    return `
      <div class="lms-workspace">
        <div style="grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:16px;">
          ${coursesHtml}
        </div>
        <div class="rfq-panel" style="grid-column:1/-1;">
          <div class="rfq-panel-head">
            <h3>📄 SOPs المرتبطة بالتدريب (${sops.length})</h3>
            <button class="ent-btn primary" style="padding:4px 8px;font-size:11px;" onclick="switchPage && switchPage('sop')">
              📂 فتح صفحة الـ SOPs
            </button>
          </div>
          <div class="rfq-panel-body" style="gap:8px">${sopLinksHtml}</div>
        </div>
      </div>
    `;
  }

  window.entLmsStartCourse = function (title) {
    toast('تم فتح دورة: ' + title, 'info');
    audit('training_lms', 'course_start', 'Course started: ' + title, { title });
  };

  window.entLmsAssignCourse = function (title) {
    toast('تم تعيين الدورة للموظفين: ' + title, 'success');
    audit('training_lms', 'course_assign', 'Course assigned: ' + title, { title });
    save();
  };

  window.entLmsLinkSop = function (sopId) {
    toast('تم ربط الـ SOP بدورة تدريبية جديدة: ' + sopId, 'success');
    audit('training_lms', 'sop_link', 'SOP linked to training: ' + sopId, { sopId });
    save();
  };

  window.entSetTrainingTab = function (tab) {
    trainingActiveTab = tab;
    renderPage('training_lms');
  };

  // ─── Phase 7: Scenario Planner — AI-Driven Cash & Ops Scenarios ───
  function renderScenarioWorkspace() {
    const openJobs = activeJobOrders().filter(w => !['closed', 'delivered', 'cancelled'].includes(String(w.state || w.status || '').toLowerCase()));
    const netCash = txs().reduce((s, t) => s + (t.direction === 'in' ? money(t.amount) : t.direction === 'out' ? -money(t.amount) : 0), 0);
    const totalIn = txs().filter(t => t.direction === 'in').reduce((s, t) => s + money(t.amount), 0);
    const totalOut = txs().filter(t => t.direction === 'out').reduce((s, t) => s + money(t.amount), 0);
    const lowStockCount = lowStock().length;
    const customersWithBalance = customers().filter(c => customerBalance(c) > 0).length;
    const currency = activeProfile().currencySymbol || 'IQD';

    const scenarios = [
      {
        title: 'سيناريو: صافي التدفق النقدي والسيولة',
        desc: 'تحليل المقبوضات مقابل المدفوعات والتوقع خلال 30 يوماً',
        severity: netCash >= 0 ? 'ok' : 'critical',
        severityLabel: netCash >= 0 ? '✅ إيجابي' : '⚠ عجز نقدي',
        metrics: [
          { value: fmt(totalIn), label: 'إجمالي الدخل' },
          { value: fmt(totalOut), label: 'إجمالي المصروف' },
          { value: fmt(netCash), label: 'الصافي' },
          { value: customersWithBalance, label: 'عملاء غير محصّلين' }
        ],
        actions: [
          { icon: netCash >= 0 ? 'fa-check-circle ok' : 'fa-exclamation-triangle bad', text: netCash >= 0 ? 'التدفق النقدي مستقر' : 'يُنصح بمراجعة المدفوعات المعلقة' },
          { icon: customersWithBalance ? 'fa-exclamation-circle warn' : 'fa-check-circle ok', text: customersWithBalance ? customersWithBalance + ' عميل لديهم مبالغ غير محصّلة — تعجيل التحصيل' : 'جميع رصيد العملاء مسدّد' },
          { icon: 'fa-arrow-trend-up ok', text: 'استهدف نمو 10% في المبيعات للمرونة في السيولة' },
          { icon: 'fa-calendar warn', text: 'مطابقة الكشف البنكي شهرياً قبل الرواتب' }
        ]
      },
      {
        title: 'سيناريو: ضغط نقص المواد والإنتاج',
        desc: 'تأثير نقص المواد على طلبات العمل المفتوحة وخط الإنتاج',
        severity: lowStockCount > 5 ? 'critical' : lowStockCount > 0 ? 'warning' : 'ok',
        severityLabel: lowStockCount > 5 ? '🔴 ضغط عالٍ' : lowStockCount > 0 ? '⚠ مراقبة' : '✅ مستقر',
        metrics: [
          { value: lowStockCount, label: 'مواد تحت الحد' },
          { value: openJobs.length, label: 'طلبات عمل مفتوحة' },
          { value: (O().purchaseOrders || []).filter(p => p.status === 'open' || p.status === 'pending').length, label: 'أوامر شراء معلقة' },
          { value: (O().suppliers || []).length, label: 'موردون في السجل' }
        ],
        actions: [
          { icon: lowStockCount ? 'fa-exclamation-triangle bad' : 'fa-check-circle ok', text: lowStockCount ? lowStockCount + ' مادة تحت الحد الأدنى — أرسل طلبات RFQ فوراً' : 'مستوى المخزون ضمن الحد الآمن' },
          { icon: openJobs.length > 5 ? 'fa-fire bad' : 'fa-circle-check ok', text: openJobs.length > 5 ? openJobs.length + ' طلب عمل مفتوح — ضغط على الطاقة الإنتاجية' : 'حجم الطلبات ضمن الطاقة التشغيلية' },
          { icon: 'fa-truck warn', text: 'تنسيق مع الموردين المفضلين لضمان الإمداد السريع' },
          { icon: 'fa-list-check ok', text: 'استخدم بوابة الموردين لمقارنة العروض وتحديد أفضل مورد بديل' }
        ]
      },
      {
        title: 'سيناريو: الطاقة التشغيلية والتوصيل',
        desc: 'طلبات العمل المفتوحة مقابل الطاقة الفعلية للورشة والتوصيل',
        severity: openJobs.length > 8 ? 'critical' : openJobs.length > 3 ? 'warning' : 'ok',
        severityLabel: openJobs.length > 8 ? '🔴 ضغط حرج' : openJobs.length > 3 ? '⚠ مراقبة' : '✅ طبيعي',
        metrics: [
          { value: openJobs.length, label: 'مفتوحة' },
          { value: openJobs.filter(w => ['ready_for_delivery', 'delivery_ready'].includes(String(w.state || ''))).length, label: 'جاهزة للتوصيل' },
          { value: (O().machines || []).filter(m => m.status === 'active').length, label: 'آلات نشطة' },
          { value: records('logistics').filter(r => r.status === 'open' || r.status === 'review').length, label: 'شحنات معلقة' }
        ],
        actions: [
          { icon: openJobs.length > 8 ? 'fa-warning bad' : 'fa-circle-check ok', text: openJobs.length + ' طلب عمل نشط — ' + (openJobs.length > 8 ? 'يوصى بإعادة جدولة' : 'ضمن النطاق الطبيعي') },
          { icon: 'fa-truck-fast ok', text: 'الطلبات الجاهزة للتوصيل: ' + openJobs.filter(w => ['ready_for_delivery', 'delivery_ready'].includes(String(w.state || ''))).length + ' وحدة' },
          { icon: 'fa-gear warn', text: 'نسّق قدرة الآلات مع الطلبات المستلمة لتجنب تأخير الإنجاز' },
          { icon: 'fa-star ok', text: 'تأكد من جاهزية فريق التوصيل للطلبات العاجلة (COD)' }
        ]
      }
    ];

    const scenariosHtml = scenarios.map(s => {
      const metricsHtml = s.metrics.map(m =>
        `<div class="scenario-metric"><div class="scenario-metric-value">${esc(String(m.value))}</div><div class="scenario-metric-label">${esc(m.label)}</div></div>`
      ).join('');

      const actionsHtml = s.actions.map(a =>
        `<div class="scenario-action-item"><i class="fa-solid ${esc(a.icon)}"></i>${esc(a.text)}</div>`
      ).join('');

      return `
        <div class="scenario-card">
          <div class="scenario-header">
            <div class="scenario-title-group">
              <h3>${esc(s.title)}</h3>
              <p>${esc(s.desc)}</p>
            </div>
            <div class="scenario-severity-badge ${s.severity}">${esc(s.severityLabel)}</div>
          </div>
          <div class="scenario-metrics-bar">${metricsHtml}</div>
          <div class="scenario-action-grid">${actionsHtml}</div>
        </div>
      `;
    }).join('');

    return `<div class="scenario-workspace">${scenariosHtml}</div>`;
  }

  window.entSetScenarioTab = function (tab) {
    renderPage('scenario_planner');
  };

  // ─── Phase 7: Inject sub-tab routing into renderPage ───
  // The renderPage function handles supplier_portal, integration_hub,
  // security_center, training_lms, and scenario_planner with rich workspaces
  // by injecting enhanced content into the standard overview panel rendering.
  // We patch activatePage to call the rich renderers.
  // Override renderPage to inject Phase 7 workspaces into overview slot
  function renderPage(page) {
    ensureData();
    const cfg = PAGES[page];
    if (!cfg) return;
    const root = document.getElementById(cfg.body);
    if (!root) return;
    const rh = routeHealthSummary();

    // ── Phase 7 rich overrides — inject premium workspace into overview ──
    let phase7WorkspaceHtml = null;
    if (page === 'supplier_portal') {
      phase7WorkspaceHtml = renderRfqWorkspace();
    } else if (page === 'integration_hub') {
      phase7WorkspaceHtml = renderIntegrationHubWorkspace();
    } else if (page === 'security_center') {
      phase7WorkspaceHtml = renderSecurityWorkspace();
    } else if (page === 'training_lms') {
      phase7WorkspaceHtml = renderTrainingWorkspace();
    } else if (page === 'scenario_planner') {
      phase7WorkspaceHtml = renderScenarioWorkspace();
    }

    if (phase7WorkspaceHtml !== null) {
      root.innerHTML = '<div class="ent-shell">'
        + '<section class="ent-hero"><div><h2><i class="fa-solid ' + esc(cfg.icon) + '"></i> ' + esc(cfg.title) + '</h2><p>' + esc(cfg.title) + ' — لوحة التحكم التشغيلية الكاملة مع بيانات حية من النظام.</p></div>'
        + '<div class="ent-status"><span class="ent-chip ok">wired</span><span class="ent-chip">omni.enterpriseSuite.' + esc(page) + '</span>' + (rh ? '<span class="ent-chip ' + (rh.bad ? 'bad' : 'ok') + '">Route ' + esc(rh.nav + '/' + rh.pages) + '</span>' : '') + '</div></section>'
        + renderKpis(page)
        + phase7WorkspaceHtml
        + '</div>';
      return;
    }

    // ── Original logic for all other pages ──
    let subTabsHtml = '';
    if (page === 'banking') {
      subTabsHtml = `
        <div class="recon-tab-bar">
          <button class="recon-tab-btn ${bankingActiveTab === 'overview' ? 'active' : ''}" onclick="entSetBankingTab('overview')">
            📊 اللوحة العامة والعمليات
          </button>
          <button class="recon-tab-btn ${bankingActiveTab === 'reconciliation' ? 'active' : ''}" onclick="entSetBankingTab('reconciliation')">
            🩺 مطابقة كشف الحساب البنكي
          </button>
        </div>
      `;
    } else if (page === 'contracts') {
      subTabsHtml = `
        <div class="recon-tab-bar">
          <button class="recon-tab-btn ${contractsActiveTab === 'overview' ? 'active' : ''}" onclick="entSetContractsTab('overview')">
            📊 سجل العقود والالتزامات
          </button>
          <button class="recon-tab-btn ${contractsActiveTab === 'dms_links' ? 'active' : ''}" onclick="entSetContractsTab('dms_links')">
            📂 مستندات العقود الرقمية (DMS)
          </button>
        </div>
      `;
    } else if (page === 'device_center') {
      subTabsHtml = `
        <div class="recon-tab-bar">
          <button class="recon-tab-btn ${deviceActiveTab === 'overview' ? 'active' : ''}" onclick="entSetDeviceTab('overview')">
            📊 لوحة الأجهزة والتحكم
          </button>
          <button class="recon-tab-btn ${deviceActiveTab === 'scanner' ? 'active' : ''}" onclick="entSetDeviceTab('scanner')">
            📷 كاميرا فحص الرموز QR
          </button>
        </div>
      `;
    } else if (page === 'ar_ap') {
      subTabsHtml = `
        <div class="recon-tab-bar">
          <button class="recon-tab-btn ${arApActiveTab === 'overview' ? 'active' : ''}" onclick="entSetArApTab('overview')">
            📊 اللوحة والملخص
          </button>
          <button class="recon-tab-btn ${arApActiveTab === 'ar_collections' ? 'active' : ''}" onclick="entSetArApTab('ar_collections')">
            💰 المقبوضات والتحصيل (AR)
          </button>
          <button class="recon-tab-btn ${arApActiveTab === 'ap_payments' ? 'active' : ''}" onclick="entSetArApTab('ap_payments')">
            💳 المدفوعات وفواتير الموردين (AP)
          </button>
        </div>
      `;
    } else if (page === 'logistics') {
      subTabsHtml = `
        <div class="recon-tab-bar">
          <button class="recon-tab-btn ${logisticsActiveTab === 'overview' ? 'active' : ''}" onclick="entSetLogisticsTab('overview')">
            📊 اللوحة والعمليات
          </button>
          <button class="recon-tab-btn ${logisticsActiveTab === 'dispatch_board' ? 'active' : ''}" onclick="entSetLogisticsTab('dispatch_board')">
            🚚 لوحة الشحن والتوزيع
          </button>
          <button class="recon-tab-btn ${logisticsActiveTab === 'driver_pod' ? 'active' : ''}" onclick="entSetLogisticsTab('driver_pod')">
            📦 إثبات الاستلام (POD)
          </button>
        </div>
      `;
    }

    if (page === 'banking' && bankingActiveTab === 'reconciliation') {
      root.innerHTML = '<div class="ent-shell">'
        + '<section class="ent-hero"><div><h2><i class="fa-solid ' + esc(cfg.icon) + '"></i> ' + esc(cfg.title) + '</h2><p>This tab turns a known ERP gap into a working department surface with durable rows, live context, audit events, and cross-module handoffs.</p></div>'
        + '<div class="ent-status"><span class="ent-chip ok">wired</span><span class="ent-chip">omni.enterpriseSuite.' + esc(page) + '</span>' + (rh ? '<span class="ent-chip ' + (rh.bad ? 'bad' : 'ok') + '">Route ' + esc(rh.nav + '/' + rh.pages) + '</span>' : '') + '</div></section>'
        + subTabsHtml
        + renderReconciliationWorkspace()
        + '</div>';
    } else if (page === 'contracts' && contractsActiveTab === 'dms_links') {
      root.innerHTML = '<div class="ent-shell">'
        + '<section class="ent-hero"><div><h2><i class="fa-solid ' + esc(cfg.icon) + '"></i> ' + esc(cfg.title) + '</h2><p>Link digital documents from the DMS to contracts in the Control Register, or drag and drop new PDF contracts to register and auto-link them.</p></div>'
        + '<div class="ent-status"><span class="ent-chip ok">wired</span><span class="ent-chip">omni.enterpriseSuite.' + esc(page) + '</span>' + (rh ? '<span class="ent-chip ' + (rh.bad ? 'bad' : 'ok') + '">Route ' + esc(rh.nav + '/' + rh.pages) + '</span>' : '') + '</div></section>'
        + subTabsHtml
        + renderDmsWorkspace()
        + '</div>';
    } else if (page === 'device_center' && deviceActiveTab === 'scanner') {
      root.innerHTML = '<div class="ent-shell">'
        + '<section class="ent-hero"><div><h2><i class="fa-solid ' + esc(cfg.icon) + '"></i> ' + esc(cfg.title) + '</h2><p>Scan traveller cards, machines, and employee badges to instantly display execution sheets, update machine states, or verify check-in status.</p></div>'
        + '<div class="ent-status"><span id="scanner_kpi_chip" class="ent-chip ok">wired</span><span class="ent-chip">omni.enterpriseSuite.' + esc(page) + '</span>' + (rh ? '<span class="ent-chip ' + (rh.bad ? 'bad' : 'ok') + '">Route ' + esc(rh.nav + '/' + rh.pages) + '</span>' : '') + '</div></section>'
        + subTabsHtml
        + renderDeviceScannerWorkspace()
        + '</div>';
      setTimeout(entStartCameraStream, 50);
    } else if (page === 'ar_ap' && (arApActiveTab === 'ar_collections' || arApActiveTab === 'ap_payments')) {
      root.innerHTML = '<div class="ent-shell">'
        + '<section class="ent-hero"><div><h2><i class="fa-solid ' + esc(cfg.icon) + '"></i> ' + esc(cfg.title) + '</h2><p>Process customer collections, promises to pay, and vendor bills runs.</p></div>'
        + '<div class="ent-status"><span class="ent-chip ok">wired</span><span class="ent-chip">omni.enterpriseSuite.' + esc(page) + '</span>' + (rh ? '<span class="ent-chip ' + (rh.bad ? 'bad' : 'ok') + '">Route ' + esc(rh.nav + '/' + rh.pages) + '</span>' : '') + '</div></section>'
        + subTabsHtml
        + renderArApWorkspace()
        + '</div>';
    } else if (page === 'logistics' && (logisticsActiveTab === 'dispatch_board' || logisticsActiveTab === 'driver_pod')) {
      root.innerHTML = '<div class="ent-shell">'
        + '<section class="ent-hero"><div><h2><i class="fa-solid ' + esc(cfg.icon) + '"></i> ' + esc(cfg.title) + '</h2><p>Dispatch shipments, assign drivers, track routes, and capture signature proof-of-delivery (POD).</p></div>'
        + '<div class="ent-status"><span class="ent-chip ok">wired</span><span class="ent-chip">omni.enterpriseSuite.' + esc(page) + '</span>' + (rh ? '<span class="ent-chip ' + (rh.bad ? 'bad' : 'ok') + '">Route ' + esc(rh.nav + '/' + rh.pages) + '</span>' : '') + '</div></section>'
        + subTabsHtml
        + renderLogisticsWorkspace()
        + '</div>';
    } else {
      let alertBannerHtml = '';
      if (page === 'contracts' && contractsActiveTab === 'overview') {
        alertBannerHtml = renderContractsRenewalAlerts();
      }

      root.innerHTML = '<div class="ent-shell">'
        + '<section class="ent-hero"><div><h2><i class="fa-solid ' + esc(cfg.icon) + '"></i> ' + esc(cfg.title) + '</h2><p>This tab turns a known ERP gap into a working department surface with durable rows, live context, audit events, and cross-module handoffs.</p></div>'
        + '<div class="ent-status"><span class="ent-chip ok">wired</span><span class="ent-chip">omni.enterpriseSuite.' + esc(page) + '</span>' + (rh ? '<span class="ent-chip ' + (rh.bad ? 'bad' : 'ok') + '">Route ' + esc(rh.nav + '/' + rh.pages) + '</span>' : '') + '</div></section>'
        + subTabsHtml
        + alertBannerHtml
        + renderKpis(page)
        + renderDepartmentOps(page)
        + '<section class="ent-main-grid"><div class="ent-panel"><div class="ent-panel-head"><h3>Control Register</h3><div class="ent-actions"><button class="ent-btn" onclick="entRefresh(\'' + esc(page) + '\')">Refresh</button><button class="ent-btn" onclick="entCreateTask(\'' + esc(page) + '\')">Create task</button></div></div>' + renderTable(page) + '</div>'
        + '<aside class="ent-panel"><div class="ent-panel-head"><h3>Smart Next Actions</h3></div>' + renderRecommendations(page) + '<div class="ent-panel-head" style="margin-top:16px;"><h3>Quick Add</h3></div>' + renderForm(page) + '</aside></section>'
        + '</div>';
    }
  }

  // pageReport is defined above at line ~1267

  function init() {

    ensureData();
    wireSwitch();
    registerJarvis();
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      wireSwitch();
      registerJarvis();
      if (window.__enterpriseSuiteWrapped || tries > 40) clearInterval(timer);
    }, 150);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.OctagonEnterpriseSuite = {
    pages: PAGE_KEYS.slice(),
    ensureData,
    render: renderPage,
    report: pageReport,
    departmentSignals,
    importDepartmentSignals,
    scanDataQuality,
    activate: activatePage
  };
})();
