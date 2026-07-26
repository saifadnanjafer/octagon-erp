/**
 * OCTAGON ERP — Phase 05 canonical operations workspace
 * (العمليات الكنسية — التصنيع والمشاريع والأصول).
 *
 * ADD-ONLY. This page introduces no data store of its own. Every figure is read
 * from the canonical Phase 05 API families over `/api/v1/...`, and every write
 * goes through the governed action route `POST /api/v1/action/:actionId`, which
 * enforces the permission, company scope, idempotency, audit and outbox contract
 * declared in `platform_actions`.
 *
 * That is the whole point of the page: it is a *view* over the canonical
 * authorities, not a second authority. It does not read or write `omni.*`, it
 * does not touch the legacy production/asset/fleet stores, and it never goes
 * near payroll, attendance or timesheet data.
 *
 * The existing legacy tabs (mrp, work_orders, assets, fleet, projects, qc_center,
 * equipment) keep working untouched. They are retired only by a later, separate
 * cutover with its own reconciliation and browser parity — never by this file.
 */
(function () {
  'use strict';

  const PAGE = 'canonical_operations';
  const PAGE_ELEMENT_ID = 'pageCanonicalOperations';
  const BODY_ID = 'canonicalOperationsBody';

  const WORKSPACES = [
    { key: 'overview', label: 'نظرة عامة', icon: 'fa-gauge-high' },
    { key: 'projects', label: 'المشاريع', icon: 'fa-diagram-project' },
    { key: 'project_costing', label: 'تكاليف المشاريع', icon: 'fa-coins' },
    { key: 'engineering', label: 'الهندسة وقوائم المواد', icon: 'fa-drafting-compass' },
    { key: 'planning', label: 'تخطيط الإنتاج', icon: 'fa-calendar-days' },
    { key: 'orders', label: 'أوامر التصنيع', icon: 'fa-industry' },
    { key: 'shop_floor', label: 'أرضية الورشة', icon: 'fa-screwdriver-wrench' },
    { key: 'work_centers', label: 'مراكز العمل', icon: 'fa-gears' },
    { key: 'quality', label: 'الجودة', icon: 'fa-clipboard-check' },
    { key: 'assets', label: 'الأصول', icon: 'fa-building-columns' },
    { key: 'maintenance', label: 'الصيانة', icon: 'fa-wrench' },
    { key: 'fleet', label: 'المركبات', icon: 'fa-truck' },
  ];

  let activeWorkspace = 'overview';
  let selectedProjectId = null;
  let lastError = null;

  /* ───────────────────────── helpers ───────────────────────── */

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function num(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function money(value) {
    try { return num(value).toLocaleString('en-US', { maximumFractionDigits: 2 }); } catch (_) { return String(num(value)); }
  }

  function qty(value) {
    try { return num(value).toLocaleString('en-US', { maximumFractionDigits: 3 }); } catch (_) { return String(num(value)); }
  }

  function toast(message, kind) {
    if (typeof window.showToast === 'function') { try { window.showToast(message, kind || 'info'); } catch (_) {} }
  }

  /** Canonical read. Returns `null` (and records the reason) on failure. */
  async function apiGet(pathname) {
    try {
      const response = await fetch(`/api/v1/${pathname}`, {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.success === false) {
        lastError = body.error || `HTTP ${response.status}`;
        return null;
      }
      lastError = null;
      return body.data;
    } catch (error) {
      lastError = error && error.message ? error.message : String(error);
      return null;
    }
  }

  /** Canonical governed write. The action route owns permission and idempotency. */
  async function apiAction(actionId, payload) {
    const idempotencyKey = `${PAGE}:${actionId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const response = await fetch(`/api/v1/action/${encodeURIComponent(actionId)}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-idempotency-key': idempotencyKey },
      body: JSON.stringify(payload || {}),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) {
      throw new Error(body.error || `HTTP ${response.status}`);
    }
    return body.data;
  }

  function body() {
    return document.getElementById(BODY_ID);
  }

  function loading(message) {
    const target = body();
    if (!target) return;
    target.innerHTML = `
      <div class="card" style="text-align:center;padding:32px">
        <i class="fa-solid fa-spinner fa-spin" style="font-size:22px;opacity:.7"></i>
        <p style="margin-top:12px">${esc(message || 'جارٍ التحميل من الخادم الكنسي…')}</p>
      </div>`;
  }

  function unavailable(what) {
    return `
      <div class="card" style="border-right:4px solid var(--warning, #d97706)">
        <h3 style="margin:0 0 6px"><i class="fa-solid fa-plug-circle-xmark"></i> ${esc(what)} غير متاح الآن</h3>
        <p style="margin:0">
          تعذّر القراءة من الخادم الكنسي${lastError ? `: <span dir="ltr">${esc(lastError)}</span>` : ''}.
          هذه الصفحة لا تعرض بيانات بديلة أو تجريبية — الرقم إمّا من دفتر الأستاذ الكنسي أو لا يُعرض إطلاقاً.
        </p>
      </div>`;
  }

  function tabs() {
    return `
      <div class="tabs" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">
        ${WORKSPACES.map((workspace) => `
          <button type="button"
                  class="btn ${activeWorkspace === workspace.key ? 'btn-primary' : 'btn-secondary'}"
                  onclick="OctagonCanonicalOperations.show('${workspace.key}')">
            <i class="fa-solid ${workspace.icon}"></i> ${esc(workspace.label)}
          </button>`).join('')}
      </div>`;
  }

  function statCard(label, value, hint) {
    return `
      <div class="stat-card" style="flex:1 1 180px;min-width:170px">
        <div class="stat-label">${esc(label)}</div>
        <div class="stat-value" dir="ltr">${esc(value)}</div>
        ${hint ? `<div class="stat-hint" style="opacity:.7;font-size:12px">${esc(hint)}</div>` : ''}
      </div>`;
  }

  function table(columns, rows, emptyMessage) {
    if (!rows || !rows.length) {
      return `<div class="card"><p style="margin:0;opacity:.75">${esc(emptyMessage || 'لا توجد سجلات بعد.')}</p></div>`;
    }
    return `
      <div class="card" style="overflow-x:auto">
        <table class="data-table" style="width:100%">
          <thead><tr>${columns.map((column) => `<th>${esc(column.label)}</th>`).join('')}</tr></thead>
          <tbody>
            ${rows.map((row) => `<tr>${columns.map((column) => {
              const raw = column.get(row);
              return `<td${column.ltr ? ' dir="ltr"' : ''}>${column.html ? raw : esc(raw)}</td>`;
            }).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  const STATE_LABELS = {
    draft: 'مسودة', planned: 'مخطّط', approved: 'معتمد', released: 'مُطلَق',
    in_progress: 'قيد التنفيذ', partially_completed: 'مكتمل جزئياً', completed: 'مكتمل',
    closed: 'مغلق', cancelled: 'ملغى', active: 'نشط', on_hold: 'موقوف مؤقتاً',
    ready: 'جاهز', waiting_material: 'بانتظار المواد', waiting_approval: 'بانتظار الموافقة',
    scheduled: 'مجدول', paused: 'متوقّف', quality_hold: 'حجز جودة',
    pending: 'قيد الانتظار', passed: 'ناجح', failed: 'راسب',
    conditionally_passed: 'ناجح بشروط', acquired: 'مُقتنى',
    pending_capitalization: 'بانتظار الرسملة', under_maintenance: 'تحت الصيانة',
    suspended: 'موقوف', disposed: 'مستبعد', written_off: 'مشطوب', open: 'مفتوح',
  };

  function stateLabel(state) {
    return STATE_LABELS[state] || state || '—';
  }

  /* ───────────────────────── workspaces ───────────────────────── */

  async function renderOverview() {
    const [status, wip, plan, shortages, portfolio, due, alerts] = await Promise.all([
      apiGet('phase05/status'),
      apiGet('manufacturing/wip'),
      apiGet('manufacturing/status-summary'),
      apiGet('manufacturing/shortages'),
      apiGet('projects/portfolio'),
      apiGet('maintenance/due'),
      apiGet('fleet/alerts'),
    ]);

    if (!status) return unavailable('لوحة العمليات الكنسية');

    const openOrders = (plan || []).filter((row) => !['closed', 'cancelled', 'completed'].includes(row.state))
      .reduce((sum, row) => sum + num(row.orders), 0);
    const derivedWip = wip && wip.derived ? num(wip.derived.total_wip_balance) : 0;
    const ledgerWip = wip && wip.general_ledger ? num(wip.general_ledger.balance) : 0;
    const reconciled = Math.abs(derivedWip - ledgerWip) < 0.005;

    const modules = (status.modules || []).map((module) => `
      <span class="badge ${module.enabled ? 'badge-success' : 'badge-muted'}" style="margin:2px" dir="ltr">
        ${esc(module.key.replace('phase05.', '').replace('.enabled', ''))} ${module.enabled ? '✓' : '✗'}
      </span>`).join('');

    return `
      <div class="stats-row" style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:14px">
        ${statCard('أوامر تصنيع مفتوحة', qty(openOrders))}
        ${statCard('الإنتاج تحت التشغيل (المشتق)', money(derivedWip), 'مجموع أوامر التصنيع')}
        ${statCard('الإنتاج تحت التشغيل (دفتر الأستاذ)', money(ledgerWip), 'حساب WIP')}
        ${statCard('نواقص المواد', qty((shortages || []).length))}
        ${statCard('مشاريع', qty((portfolio || []).length))}
        ${statCard('صيانة مستحقة', qty(((due && due.open_orders) || []).length))}
        ${statCard('تنبيهات المركبات', qty((alerts || []).length))}
      </div>

      <div class="card" style="border-right:4px solid ${reconciled ? 'var(--success,#16a34a)' : 'var(--danger,#dc2626)'}">
        <h3 style="margin:0 0 6px">
          <i class="fa-solid ${reconciled ? 'fa-circle-check' : 'fa-triangle-exclamation'}"></i>
          مطابقة الإنتاج تحت التشغيل مع دفتر الأستاذ
        </h3>
        <p style="margin:0" dir="ltr">
          derived ${money(derivedWip)} · ledger ${money(ledgerWip)} · Δ ${money(derivedWip - ledgerWip)}
        </p>
        <p style="margin:6px 0 0;opacity:.75">
          ${reconciled
            ? 'الرقمان متطابقان: كل حركة إنتاج مرّت عبر محرّك المخزون والقيود الكنسية.'
            : 'الرقمان غير متطابقين — هذا فرق حقيقي يجب فحصه قبل الإقفال، ولا يُخفى هنا.'}
        </p>
      </div>

      <div class="card">
        <h3 style="margin:0 0 8px"><i class="fa-solid fa-toggle-on"></i> وحدات المرحلة الخامسة (تُطبَّق على الخادم)</h3>
        <div>${modules || '<span style="opacity:.7">لا توجد وحدات مسجّلة.</span>'}</div>
        <p style="margin:8px 0 0;opacity:.7;font-size:12px">
          تعطيل أي وحدة يمنع أوامرها على الخادم، وليس في المتصفح فقط.
        </p>
      </div>

      ${table(
        [
          { label: 'الحالة', get: (row) => stateLabel(row.state) },
          { label: 'عدد الأوامر', get: (row) => qty(row.orders), ltr: true },
          { label: 'الكمية المخططة', get: (row) => qty(row.planned_quantity), ltr: true },
          { label: 'الكمية المنجزة', get: (row) => qty(row.completed_quantity), ltr: true },
        ],
        plan || [],
        'لا توجد أوامر تصنيع بعد.',
      )}`;
  }

  async function renderProjects() {
    const projects = await apiGet('projects?limit=200');
    if (!projects) return unavailable('المشاريع');
    return `
      <div class="card">
        <h3 style="margin:0 0 6px"><i class="fa-solid fa-diagram-project"></i> المشاريع الكنسية</h3>
        <p style="margin:0;opacity:.75">
          أعمال المشروع هي عناصر عمل كنسية <span dir="ltr">(work_items)</span> — لا يوجد جدول مهام ثانٍ للمشاريع.
        </p>
      </div>
      ${table(
        [
          { label: 'الرمز', get: (row) => row.code, ltr: true },
          { label: 'الاسم', get: (row) => row.name },
          { label: 'الحالة', get: (row) => stateLabel(row.state) },
          { label: 'قيمة العقد', get: (row) => money(row.contract_value), ltr: true },
          { label: 'الإنجاز %', get: (row) => qty(row.percent_complete), ltr: true },
          {
            label: 'التكاليف',
            html: true,
            get: (row) => `<button type="button" class="btn btn-secondary btn-sm"
              onclick="OctagonCanonicalOperations.openProject('${esc(row.id)}')">فتح التكاليف</button>`,
          },
        ],
        projects,
        'لا توجد مشاريع كنسية بعد. أنشئ مشروعاً عبر أمر project:create.',
      )}`;
  }

  async function renderProjectCosting() {
    const projects = await apiGet('projects?limit=200');
    if (!projects) return unavailable('تكاليف المشاريع');
    if (!projects.length) {
      return '<div class="card"><p style="margin:0;opacity:.75">لا توجد مشاريع لعرض تكاليفها.</p></div>';
    }
    const projectId = selectedProjectId && projects.some((row) => row.id === selectedProjectId)
      ? selectedProjectId
      : projects[0].id;
    selectedProjectId = projectId;

    const [profitability, budget, billing, cash] = await Promise.all([
      apiGet(`projects/${encodeURIComponent(projectId)}/profitability`),
      apiGet(`projects/${encodeURIComponent(projectId)}/budget-vs-actual`),
      apiGet(`projects/${encodeURIComponent(projectId)}/billing`),
      apiGet(`projects/${encodeURIComponent(projectId)}/cash-flow`),
    ]);
    if (!profitability) return unavailable('ربحية المشروع');

    const selector = `
      <div class="card">
        <label for="canonicalProjectSelect" style="font-weight:600">المشروع</label>
        <select id="canonicalProjectSelect" class="form-control"
                onchange="OctagonCanonicalOperations.openProject(this.value)">
          ${projects.map((row) => `
            <option value="${esc(row.id)}" ${row.id === projectId ? 'selected' : ''}>
              ${esc(row.code)} — ${esc(row.name)}
            </option>`).join('')}
        </select>
      </div>`;

    return `
      ${selector}
      <div class="stats-row" style="display:flex;flex-wrap:wrap;gap:12px;margin:14px 0">
        ${statCard('قيمة العقد', money(profitability.contract_value))}
        ${statCard('الموازنة المعتمدة', money(profitability.budget_amount))}
        ${statCard('التكلفة الفعلية', money(profitability.actual_cost))}
        ${statCard('الالتزامات المفتوحة', money(profitability.open_commitments))}
        ${statCard('المفوتر', money(profitability.billed_amount))}
        ${statCard('هامش الربح', money(profitability.margin_amount),
          profitability.margin_percent === null ? 'لا توجد قيمة عقد' : `${qty(profitability.margin_percent)}%`)}
        ${statCard('التوقّع عند الإنجاز', money(profitability.forecast_at_completion),
          profitability.cost_performance_index === null
            ? 'لا يوجد مؤشر أداء بعد'
            : `CPI ${qty(profitability.cost_performance_index)}`)}
      </div>

      ${budget ? table(
        [
          { label: 'نوع التكلفة', get: (row) => row.cost_type },
          { label: 'الموازنة', get: (row) => money(row.budget), ltr: true },
          { label: 'الفعلي', get: (row) => money(row.actual), ltr: true },
          { label: 'الانحراف', get: (row) => money(row.variance), ltr: true },
        ],
        budget.lines || [],
        'لا توجد موازنة معتمدة لهذا المشروع.',
      ) : ''}

      ${cash ? `
        <div class="card">
          <h3 style="margin:0 0 6px"><i class="fa-solid fa-money-bill-transfer"></i> التدفق النقدي للمشروع</h3>
          <p style="margin:0" dir="ltr">
            billed ${money(cash.billed_amount)} · retainage ${money(cash.retainage_withheld)} ·
            received ${money(cash.cash_received)} · outstanding ${money(cash.outstanding_receivable)} ·
            spent ${money(cash.cost_incurred)}
          </p>
          <p style="margin:6px 0 0;opacity:.7;font-size:12px">
            المقبوضات مأخوذة من تخصيصات الدفعات الكنسية، وليست تقديراً من جانب المشروع.
          </p>
        </div>` : ''}

      ${billing ? table(
        [
          { label: 'الطريقة', get: (row) => row.billing_method },
          { label: 'المبلغ', get: (row) => money(row.amount), ltr: true },
          { label: 'المحتجز', get: (row) => money(row.retainage_amount), ltr: true },
          { label: 'مستند القيد', get: (row) => row.finance_document_id || '—', ltr: true },
          { label: 'التاريخ', get: (row) => String(row.billed_at || '').slice(0, 10), ltr: true },
        ],
        billing.billings || [],
        'لم تُصدر مطالبات لهذا المشروع بعد.',
      ) : ''}`;
  }

  async function renderEngineering() {
    const [boms, routings] = await Promise.all([apiGet('boms?limit=200'), apiGet('routings?limit=200')]);
    if (!boms && !routings) return unavailable('الهندسة وقوائم المواد');
    return `
      <div class="card">
        <h3 style="margin:0 0 6px"><i class="fa-solid fa-drafting-compass"></i> قوائم المواد والمسارات</h3>
        <p style="margin:0;opacity:.75">
          كل نسخة مستقلة ومؤرَّخة: اعتماد نسخة جديدة يجعل السابقة «مُستبدلة»، وأمر التصنيع المُطلَق
          يحتفظ برقم النسخة التي استُخدمت فعلاً — فلا يتغيّر تاريخ أمر قديم عند تعديل الهندسة.
        </p>
      </div>
      <h4 style="margin:14px 0 6px">قوائم المواد</h4>
      ${table(
        [
          { label: 'الرمز', get: (row) => row.code, ltr: true },
          { label: 'النسخة', get: (row) => row.version, ltr: true },
          { label: 'النوع', get: (row) => row.bom_type, ltr: true },
          { label: 'الحالة', get: (row) => stateLabel(row.status) },
          { label: 'الكمية', get: (row) => qty(row.quantity), ltr: true },
          { label: 'سارية من', get: (row) => String(row.effective_from || '—').slice(0, 10), ltr: true },
        ],
        boms || [],
        'لا توجد قوائم مواد كنسية بعد.',
      )}
      <h4 style="margin:14px 0 6px">المسارات</h4>
      ${table(
        [
          { label: 'الرمز', get: (row) => row.code, ltr: true },
          { label: 'الاسم', get: (row) => row.name },
          { label: 'النسخة', get: (row) => row.version, ltr: true },
          { label: 'الحالة', get: (row) => stateLabel(row.status) },
        ],
        routings || [],
        'لا توجد مسارات كنسية بعد.',
      )}`;
  }

  async function renderPlanning() {
    const [worklist, runs] = await Promise.all([apiGet('planning/worklist'), apiGet('planning/runs')]);
    if (!worklist) return unavailable('تخطيط الإنتاج');
    return `
      <div class="card">
        <h3 style="margin:0 0 6px"><i class="fa-solid fa-calendar-days"></i> مقترحات التخطيط</h3>
        <p style="margin:0 0 10px;opacity:.75">
          التخطيط يقترح ولا يلتزم: لا يُنشأ أمر شراء أو تصنيع إلا بقبول صريح من المخطِّط،
          ويحتفظ كل مقترح بمصدر الطلب الذي أنشأه.
        </p>
        <button type="button" class="btn btn-primary" onclick="OctagonCanonicalOperations.runPlanning()">
          <i class="fa-solid fa-play"></i> تشغيل دورة تخطيط
        </button>
      </div>
      ${table(
        [
          { label: 'المنتج', get: (row) => row.product_id, ltr: true },
          { label: 'النوع', get: (row) => row.proposal_type, ltr: true },
          { label: 'الكمية', get: (row) => qty(row.quantity), ltr: true },
          { label: 'صافي الاحتياج', get: (row) => qty(row.net_requirement), ltr: true },
          { label: 'مصدر الطلب', get: (row) => `${row.demand_source_type}:${String(row.demand_source_id).slice(0, 12)}`, ltr: true },
          { label: 'استثناء', get: (row) => row.exception_code || '—', ltr: true },
          {
            label: 'القرار',
            html: true,
            get: (row) => `
              <button type="button" class="btn btn-primary btn-sm"
                      onclick="OctagonCanonicalOperations.decideProposal('${esc(row.id)}', true)">قبول</button>
              <button type="button" class="btn btn-secondary btn-sm"
                      onclick="OctagonCanonicalOperations.decideProposal('${esc(row.id)}', false)">رفض</button>`,
          },
        ],
        worklist.proposals || [],
        'لا توجد مقترحات تخطيط مفتوحة.',
      )}
      ${table(
        [
          { label: 'الدورة', get: (row) => String(row.id).slice(0, 14), ltr: true },
          { label: 'الطلبات', get: (row) => qty(row.demand_count), ltr: true },
          { label: 'المقترحات', get: (row) => qty(row.proposal_count), ltr: true },
          { label: 'الاستثناءات', get: (row) => qty(row.exception_count), ltr: true },
          { label: 'الحالة', get: (row) => row.status, ltr: true },
        ],
        runs || [],
        'لم تُشغَّل دورات تخطيط بعد.',
      )}`;
  }

  async function renderOrders() {
    const [orders, shortages] = await Promise.all([
      apiGet('manufacturing/orders?limit=200'),
      apiGet('manufacturing/shortages'),
    ]);
    if (!orders) return unavailable('أوامر التصنيع');
    return `
      ${table(
        [
          { label: 'المرجع', get: (row) => row.reference, ltr: true },
          { label: 'الحالة', get: (row) => stateLabel(row.state) },
          { label: 'المخطط', get: (row) => qty(row.planned_quantity), ltr: true },
          { label: 'المنجز', get: (row) => qty(row.completed_quantity), ltr: true },
          { label: 'نسخة قائمة المواد', get: (row) => row.bom_version || '—', ltr: true },
          { label: 'نسخة المسار', get: (row) => row.routing_version || '—', ltr: true },
        ],
        orders,
        'لا توجد أوامر تصنيع كنسية بعد.',
      )}
      <h4 style="margin:14px 0 6px">نواقص المواد</h4>
      ${table(
        [
          { label: 'الأمر', get: (row) => row.reference, ltr: true },
          { label: 'المنتج', get: (row) => row.product_id, ltr: true },
          { label: 'المطلوب', get: (row) => qty(row.required_quantity), ltr: true },
          { label: 'المصروف', get: (row) => qty(row.issued_quantity), ltr: true },
          { label: 'النقص', get: (row) => qty(row.shortage_quantity), ltr: true },
        ],
        shortages || [],
        'لا توجد نواقص مواد على الأوامر المفتوحة.',
      )}`;
  }

  async function renderShopFloor() {
    const [workOrders, loading_, downtime] = await Promise.all([
      apiGet('manufacturing/work-orders'),
      apiGet('manufacturing/work-center-loading'),
      apiGet('manufacturing/downtime'),
    ]);
    if (!workOrders) return unavailable('أرضية الورشة');
    return `
      <div class="card">
        <h3 style="margin:0 0 6px"><i class="fa-solid fa-screwdriver-wrench"></i> أوامر العمل</h3>
        <p style="margin:0;opacity:.75">
          كل أمر عمل مرتبط بعنصر عمل كنسي؛ التنسيق والتكليف يتمّان على عنصر العمل،
          بينما تبقى الكميات والتكاليف ملكاً لأوامر التصنيع.
        </p>
      </div>
      ${table(
        [
          { label: 'التسلسل', get: (row) => row.sequence, ltr: true },
          { label: 'الحالة', get: (row) => stateLabel(row.state) },
          { label: 'مركز العمل', get: (row) => row.work_center_id || '—', ltr: true },
          { label: 'المنتَج', get: (row) => qty(row.output_quantity), ltr: true },
          { label: 'الهالك', get: (row) => qty(row.scrap_quantity), ltr: true },
          { label: 'سبب التوقف', get: (row) => row.blocking_reason || '—' },
        ],
        workOrders,
        'لا توجد أوامر عمل مفتوحة.',
      )}
      <h4 style="margin:14px 0 6px">تحميل مراكز العمل</h4>
      ${table(
        [
          { label: 'المركز', get: (row) => row.code, ltr: true },
          { label: 'دقائق مخططة مفتوحة', get: (row) => qty(row.open_planned_minutes), ltr: true },
          { label: 'دقائق مسجّلة', get: (row) => qty(row.recorded_minutes), ltr: true },
          { label: 'دقائق توقف', get: (row) => qty(row.downtime_minutes), ltr: true },
          { label: 'الاستغلال %', get: (row) => (row.utilisation_percent === null ? 'لا توجد سعة معرّفة' : qty(row.utilisation_percent)), ltr: true },
        ],
        loading_ || [],
        'لا توجد مراكز عمل فعّالة.',
      )}
      ${table(
        [
          { label: 'المركز', get: (row) => row.code || row.work_center_id || '—', ltr: true },
          { label: 'دقائق التوقف', get: (row) => qty(row.downtime_minutes), ltr: true },
          { label: 'عدد الأحداث', get: (row) => qty(row.events), ltr: true },
        ],
        downtime || [],
        'لا توجد توقفات مسجّلة.',
      )}`;
  }

  async function renderWorkCenters() {
    const centers = await apiGet('work-centers');
    if (!centers) return unavailable('مراكز العمل');
    return table(
      [
        { label: 'الرمز', get: (row) => row.code, ltr: true },
        { label: 'الاسم', get: (row) => row.name },
        { label: 'النوع', get: (row) => row.resource_type, ltr: true },
        { label: 'كلفة العمالة/ساعة', get: (row) => money(row.labor_cost_per_hour), ltr: true },
        { label: 'كلفة الماكنة/ساعة', get: (row) => money(row.machine_cost_per_hour), ltr: true },
        { label: 'التحميل الإضافي/ساعة', get: (row) => money(row.overhead_cost_per_hour), ltr: true },
      ],
      centers,
      'لا توجد مراكز عمل كنسية بعد.',
    );
  }

  async function renderQuality() {
    const [inspections, passRate, aging, capa] = await Promise.all([
      apiGet('quality/inspections?limit=100'),
      apiGet('quality/pass-rate'),
      apiGet('quality/ncr-aging'),
      apiGet('quality/capa-status'),
    ]);
    if (!inspections) return unavailable('الجودة');
    return `
      <div class="stats-row" style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:14px">
        ${statCard('نسبة النجاح %', passRate && passRate.pass_rate_percent !== null ? qty(passRate.pass_rate_percent) : 'لا قرارات بعد')}
        ${statCard('فحوصات مقرّرة', qty(passRate ? passRate.decided : 0))}
        ${statCard('عدم مطابقة مفتوحة', qty((aging || []).length))}
      </div>
      <div class="card">
        <p style="margin:0;opacity:.75">
          الفحص الإلزامي الراسب يمنع إتمام التصنيع والتسليم وإعادة الأصل للخدمة،
          ما لم توجد موافقة انحراف معتمدة من شخص غير الذي سجّل الرسوب.
        </p>
      </div>
      ${table(
        [
          { label: 'المرجع', get: (row) => row.reference, ltr: true },
          { label: 'الموضوع', get: (row) => row.subject_type, ltr: true },
          { label: 'الحالة', get: (row) => stateLabel(row.state) },
          { label: 'يمنع التالي', get: (row) => (num(row.blocks_downstream) ? 'نعم' : 'لا') },
          { label: 'انحراف معتمد', get: (row) => row.deviation_approved_by || '—', ltr: true },
        ],
        inspections,
        'لا توجد فحوصات جودة بعد.',
      )}
      ${table(
        [
          { label: 'الحالة', get: (row) => stateLabel(row.state) },
          { label: 'العدد', get: (row) => qty(row.n), ltr: true },
          { label: 'بإجراء تصحيحي', get: (row) => qty(row.with_corrective_action), ltr: true },
          { label: 'بإجراء وقائي', get: (row) => qty(row.with_preventive_action), ltr: true },
        ],
        capa || [],
        'لا توجد حالات عدم مطابقة.',
      )}`;
  }

  async function renderAssets() {
    const [register, reconciliation, depreciation] = await Promise.all([
      apiGet('assets/register'),
      apiGet('assets/reconciliation'),
      apiGet('assets/depreciation'),
    ]);
    if (!register) return unavailable('الأصول');

    const drift = (reconciliation || []).filter((row) => row.mapped
      && (Math.abs(num(row.asset_variance)) > 0.005 || Math.abs(num(row.depreciation_variance)) > 0.005));

    return `
      <div class="stats-row" style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:14px">
        ${statCard('عدد الأصول', qty(register.length))}
        ${statCard('الإهلاك المرحَّل', money(depreciation ? depreciation.posted_total : 0))}
        ${statCard('الإهلاك المجدول', money(depreciation ? depreciation.scheduled_total : 0))}
      </div>
      <div class="card" style="border-right:4px solid ${drift.length ? 'var(--danger,#dc2626)' : 'var(--success,#16a34a)'}">
        <h3 style="margin:0 0 6px">
          <i class="fa-solid ${drift.length ? 'fa-triangle-exclamation' : 'fa-circle-check'}"></i>
          مطابقة سجل الأصول مع دفتر الأستاذ
        </h3>
        <p style="margin:0;opacity:.8">
          ${drift.length
            ? `توجد ${drift.length} فئة بانحراف حقيقي يجب فحصه.`
            : 'كل فئة مربوطة تطابق حساباتها في دفتر الأستاذ.'}
        </p>
        <p style="margin:6px 0 0;opacity:.7;font-size:12px">
          المرحلة الخامسة تحسب وتجدول الإهلاك، والمرحلة الثالثة هي التي ترحّله. لا يوجد دفتر أصول ثانٍ.
        </p>
      </div>
      ${table(
        [
          { label: 'رقم الأصل', get: (row) => row.asset_tag, ltr: true },
          { label: 'الاسم', get: (row) => row.name },
          { label: 'الفئة', get: (row) => row.category_code, ltr: true },
          { label: 'الحالة', get: (row) => stateLabel(row.state) },
          { label: 'القيمة المرسملة', get: (row) => money(row.capitalized_value), ltr: true },
          { label: 'مجمع الإهلاك', get: (row) => money(row.accumulated_depreciation), ltr: true },
          { label: 'القيمة الدفترية', get: (row) => money(row.net_book_value), ltr: true },
        ],
        register,
        'لا توجد أصول في السجل الكنسي بعد.',
      )}`;
  }

  async function renderMaintenance() {
    const [orders, due, cost, reliability] = await Promise.all([
      apiGet('maintenance/orders?limit=100'),
      apiGet('maintenance/due'),
      apiGet('maintenance/cost'),
      apiGet('maintenance/reliability'),
    ]);
    if (!orders) return unavailable('الصيانة');
    return `
      <div class="stats-row" style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:14px">
        ${statCard('أوامر مفتوحة', qty(((due && due.open_orders) || []).length))}
        ${statCard('خطط وقائية مستحقة', qty(((due && due.due_plans) || []).length))}
        ${statCard('كلفة القطع', money(cost ? cost.parts_cost : 0))}
        ${statCard('كلفة العمالة', money(cost ? cost.labor_cost : 0))}
        ${statCard('كلفة خارجية', money(cost ? cost.external_cost : 0))}
      </div>
      ${table(
        [
          { label: 'المرجع', get: (row) => row.reference, ltr: true },
          { label: 'العنوان', get: (row) => row.title },
          { label: 'النوع', get: (row) => row.maintenance_type, ltr: true },
          { label: 'الحالة', get: (row) => stateLabel(row.state) },
          { label: 'دقائق التوقف', get: (row) => qty(row.downtime_minutes), ltr: true },
        ],
        orders,
        'لا توجد أوامر صيانة كنسية بعد.',
      )}
      <h4 style="margin:14px 0 6px">الموثوقية</h4>
      ${table(
        [
          { label: 'الأصل', get: (row) => row.asset_tag, ltr: true },
          { label: 'الأعطال', get: (row) => qty(row.failures), ltr: true },
          { label: 'MTTR (ساعة)', get: (row) => (row.mttr_hours === null ? '—' : qty(row.mttr_hours)), ltr: true },
          { label: 'MTBF (ساعة)', get: (row) => (row.mtbf_hours === null ? 'سجل أعطال غير كافٍ' : qty(row.mtbf_hours)), ltr: true },
        ],
        reliability || [],
        'لا توجد بيانات موثوقية بعد.',
      )}`;
  }

  async function renderFleet() {
    const [vehicles, costPerKm, expiries, alerts] = await Promise.all([
      apiGet('fleet/vehicles'),
      apiGet('fleet/cost-per-km'),
      apiGet('fleet/expiries'),
      apiGet('fleet/alerts'),
    ]);
    if (!vehicles) return unavailable('المركبات');
    return `
      <div class="card">
        <p style="margin:0;opacity:.75">
          المركبة أصلٌ كنسي، وصيانتها أمر صيانة كنسي — لا يوجد محرّك صيانة منفصل للمركبات.
        </p>
      </div>
      ${table(
        [
          { label: 'اللوحة', get: (row) => row.plate_number || '—', ltr: true },
          { label: 'الاسم', get: (row) => row.name },
          { label: 'الحالة', get: (row) => stateLabel(row.state) },
          { label: 'العداد', get: (row) => qty(row.odometer), ltr: true },
          { label: 'الاستهلاك المتوقع/100', get: (row) => qty(row.expected_consumption_per_100), ltr: true },
        ],
        vehicles,
        'لا توجد مركبات كنسية بعد.',
      )}
      <h4 style="margin:14px 0 6px">الكلفة لكل كيلومتر</h4>
      ${table(
        [
          { label: 'اللوحة', get: (row) => row.plate_number || row.name, ltr: true },
          { label: 'المسافة (كم)', get: (row) => qty(row.distance_km), ltr: true },
          { label: 'الوقود', get: (row) => money(row.fuel_cost), ltr: true },
          { label: 'الصيانة', get: (row) => money(row.maintenance_cost), ltr: true },
          { label: 'الكلفة/كم', get: (row) => (row.cost_per_km === null ? 'لا توجد رحلات مقيسة' : money(row.cost_per_km)), ltr: true },
        ],
        costPerKm || [],
        'لا توجد بيانات كلفة بعد.',
      )}
      <h4 style="margin:14px 0 6px">وثائق قاربت على الانتهاء</h4>
      ${table(
        [
          { label: 'المركبة', get: (row) => row.plate_number || row.name, ltr: true },
          { label: 'النوع', get: (row) => row.document_type, ltr: true },
          { label: 'ينتهي في', get: (row) => row.expires_on, ltr: true },
        ],
        (expiries && expiries.documents) || [],
        'لا توجد وثائق قاربت على الانتهاء.',
      )}
      ${table(
        [
          { label: 'التنبيه', get: (row) => row.alert_type, ltr: true },
          { label: 'الخطورة', get: (row) => row.severity, ltr: true },
          { label: 'الرسالة', get: (row) => row.message },
        ],
        alerts || [],
        'لا توجد تنبيهات مفتوحة.',
      )}`;
  }

  const RENDERERS = {
    overview: renderOverview,
    projects: renderProjects,
    project_costing: renderProjectCosting,
    engineering: renderEngineering,
    planning: renderPlanning,
    orders: renderOrders,
    shop_floor: renderShopFloor,
    work_centers: renderWorkCenters,
    quality: renderQuality,
    assets: renderAssets,
    maintenance: renderMaintenance,
    fleet: renderFleet,
  };

  async function render() {
    const target = body();
    if (!target) return;
    loading();
    let html;
    try {
      html = await (RENDERERS[activeWorkspace] || renderOverview)();
    } catch (error) {
      lastError = error && error.message ? error.message : String(error);
      html = unavailable('مساحة العمل');
    }
    const current = body();
    if (current) current.innerHTML = tabs() + html;
  }

  /* ───────────────────────── page wiring ───────────────────────── */

  function activatePage() {
    const allowed = !window.PermissionService || window.PermissionService.checkPage(PAGE);
    if (!allowed) { toast('لا تملك صلاحية لهذا القسم', 'danger'); return true; }
    document.querySelectorAll('.page').forEach((element) => element.classList.remove('page-active'));
    document.querySelectorAll('.nav-btn').forEach((element) => element.classList.remove('active'));
    const page = document.getElementById(PAGE_ELEMENT_ID);
    const nav = document.getElementById('navCanonical_operations');
    if (page) page.classList.add('page-active');
    if (nav) nav.classList.add('active');
    if (typeof window.ensureNavGroupForPage === 'function') {
      try { window.ensureNavGroupForPage(PAGE); } catch (_) {}
    }
    window.currentPage = PAGE;
    render();
    return !!page;
  }

  function wireSwitch() {
    if (window.__canonicalOperationsWrapped || typeof window.switchPage !== 'function') return;
    const original = window.switchPage;
    window.switchPage = function (page) {
      if (page === PAGE) {
        try { if (activatePage()) return; } catch (error) { console.warn('Canonical operations render error', error); }
      }
      return original.apply(this, arguments);
    };
    window.__canonicalOperationsWrapped = true;
  }

  function init() {
    wireSwitch();
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      wireSwitch();
      if (window.__canonicalOperationsWrapped || tries > 40) clearInterval(timer);
    }, 150);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.OctagonCanonicalOperations = {
    show(workspace) {
      activeWorkspace = RENDERERS[workspace] ? workspace : 'overview';
      render();
    },
    openProject(projectId) {
      selectedProjectId = projectId;
      activeWorkspace = 'project_costing';
      render();
    },
    async runPlanning() {
      try {
        const result = await apiAction('manufacturing:planning:run', {});
        toast(`دورة تخطيط: ${result.proposal_count} مقترح، ${result.exception_count} استثناء`, 'success');
      } catch (error) {
        toast(`تعذّر تشغيل التخطيط: ${error.message}`, 'danger');
      }
      render();
    },
    async decideProposal(proposalId, accept) {
      try {
        await apiAction(accept ? 'manufacturing:planning:accept' : 'manufacturing:planning:reject', {
          proposal_id: proposalId,
        });
        toast(accept ? 'تم قبول المقترح وإنشاء المستند المقابل' : 'تم رفض المقترح', 'success');
      } catch (error) {
        toast(`تعذّر تنفيذ القرار: ${error.message}`, 'danger');
      }
      render();
    },
    render,
    open() { try { window.switchPage(PAGE); } catch (_) {} },
  };
})();
