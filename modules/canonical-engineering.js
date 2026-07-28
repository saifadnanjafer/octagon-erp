(function (root) {
  'use strict';

  // Checkpoint D2: visible Engineering / BOM / Routing / Work Center / MRP
  // workspace over the canonical Octagon runtime. Every mutation travels
  // through CanonicalClient -> /api/v1/action/:actionId -> ActionExecutor.
  // MRP produces governed PROPOSALS only — it never commits or moves stock.
  root.__canonicalEngineeringAuthorityActive = true;

  const state = {
    active: 'dashboard',
    loading: false,
    busy: false,
    error: null,
    notice: null,
    selectedBomId: null,
    selectedRoutingId: null,
    selectedRunId: null,
    rows: {
      boms: [], bomDetail: null, routings: [], routingDetail: null,
      workCenters: [], changeOrders: [], policies: [], demand: [],
      runs: [], requirements: [], proposals: [], shortages: [], products: [],
    },
    dashboard: null,
  };

  const tabs = [
    ['dashboard', 'لوحة الهندسة', 'Engineering Dashboard', 'fa-drafting-compass'],
    ['boms', 'قوائم المواد', 'BOMs', 'fa-sitemap'],
    ['bom-detail', 'تفصيل قائمة المواد', 'BOM Detail', 'fa-list-tree'],
    ['routings', 'مسارات التصنيع', 'Routings', 'fa-route'],
    ['work-centers', 'مراكز العمل', 'Work Centers', 'fa-industry'],
    ['change-orders', 'أوامر التغيير الهندسي', 'Change Orders', 'fa-file-pen'],
    ['policies', 'سياسات التخطيط', 'Planning Policies', 'fa-sliders'],
    ['demand', 'الطلب', 'Demand', 'fa-arrow-trend-up'],
    ['runs', 'دورات التخطيط', 'MRP Runs', 'fa-play'],
    ['requirements', 'الاحتياجات', 'Requirements', 'fa-layer-group'],
    ['proposals', 'المقترحات', 'Proposals', 'fa-clipboard-check'],
    ['shortages', 'النواقص', 'Shortages', 'fa-triangle-exclamation'],
  ];

  function client() { return root.CanonicalClient || null; }
  function isArabic() {
    const lang = String(document.documentElement.lang || '').toLowerCase();
    return document.documentElement.dir === 'rtl' || !lang || lang.startsWith('ar');
  }
  function tx(ar, en) { return isArabic() ? ar : en; }
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function num(v) {
    return new Intl.NumberFormat(isArabic() ? 'ar-IQ' : 'en-US', { maximumFractionDigits: 3 }).format(Number(v || 0));
  }
  function date(v) {
    if (!v) return '—';
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? esc(v) : d.toLocaleDateString(isArabic() ? 'ar-IQ' : 'en-GB');
  }
  function badge(v) {
    const k = String(v || 'unknown');
    return `<span class="ce-badge ce-state-${esc(k.replace(/[^a-z0-9_-]/gi, '-'))}">${esc(k)}</span>`;
  }
  function host() { return document.getElementById('pageMrp'); }

  function normalizeError(e) {
    if (!e) return tx('حدث خطأ غير معروف.', 'An unknown error occurred.');
    if (e.isAuthorization) return tx('لا تملك صلاحية تنفيذ هذا الإجراء.', 'You are not authorized to perform this action.');
    if (e.code) return `${e.code}: ${e.message}`;
    return e.message || String(e);
  }

  function loadingState() {
    return `<div class="ce-state ce-loading"><i class="fa-solid fa-circle-notch fa-spin"></i><strong>${tx('جاري تحميل حقائق الهندسة القانونية…', 'Loading canonical Engineering facts…')}</strong></div>`;
  }
  function errorState() {
    return `<div class="ce-state ce-error" role="alert"><i class="fa-solid fa-triangle-exclamation"></i><div><strong>${tx('تعذر تحميل الهندسة', 'Engineering could not be loaded')}</strong><p>${esc(state.error)}</p></div><button type="button" data-ce-action="refresh">${tx('إعادة المحاولة', 'Retry')}</button></div>`;
  }
  function emptyState(label) {
    return `<div class="ce-state ce-empty"><i class="fa-regular fa-folder-open"></i><strong>${esc(label)}</strong><span>${tx('استخدم الإجراء المناسب لإنشاء أول سجل قانوني.', 'Use the relevant action to create the first canonical record.')}</span></div>`;
  }
  function table(headers, body, empty) {
    if (!body.length) return emptyState(empty);
    return `<div class="ce-table-wrap"><table class="ce-table"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body.join('')}</tbody></table></div>`;
  }
  function kpi(label, value, detail, icon) {
    return `<article class="ce-kpi"><i class="fa-solid ${icon}"></i><div><strong>${esc(value)}</strong><span>${esc(label)}</span><small>${esc(detail || '')}</small></div></article>`;
  }

  function shell() {
    const el = host();
    if (!el) return;
    el.innerHTML = `
      <section class="ce-workspace" data-ce-workspace>
        <header class="ce-hero">
          <div>
            <span class="ce-eyebrow">${tx('أوكتاغون ERP · الهندسة والتخطيط القانوني', 'Octagon ERP · Canonical engineering and planning')}</span>
            <h2>${tx('الهندسة وتخطيط المواد', 'Engineering & Material Planning')}</h2>
            <p>${tx('قوائم مواد ومسارات معتمدة بإصدارات، وتخطيط ينتج مقترحات محكومة فقط.', 'Version-controlled BOMs and routings, with planning that produces governed proposals only.')}</p>
          </div>
          <div class="ce-hero-actions">
            <span class="ce-authority"><i class="fa-solid fa-shield-halved"></i>${tx('هوية ونطاق من الخادم', 'Server-derived identity and scope')}</span>
            <button type="button" class="ce-icon-btn" data-ce-action="refresh" title="${tx('تحديث', 'Refresh')}"><i class="fa-solid fa-rotate"></i></button>
          </div>
        </header>
        <nav class="ce-tabs" aria-label="${tx('مساحات الهندسة', 'Engineering areas')}">
          ${tabs.map(([k, ar, en, ic]) => `<button type="button" class="${state.active === k ? 'active' : ''}" data-ce-tab="${k}"><i class="fa-solid ${ic}"></i><span>${tx(ar, en)}</span></button>`).join('')}
        </nav>
        <div class="ce-feedback" aria-live="polite">${state.notice ? `<div class="ce-notice"><i class="fa-solid fa-circle-check"></i>${esc(state.notice)}</div>` : ''}</div>
        <main class="ce-body">${state.loading ? loadingState() : state.error ? errorState() : renderActive()}</main>
      </section>`;
    bind(el);
  }

  // ------------------------------------------------------------------ areas

  function renderDashboard() {
    const d = state.dashboard || {};
    return `
      <div class="ce-kpis">
        ${kpi(tx('قوائم المواد', 'BOMs'), d.bom_count ?? 0, tx('إجمالي السجلات', 'total records'), 'fa-sitemap')}
        ${kpi(tx('إصدارات معتمدة', 'Approved versions'), d.approved_boms ?? 0, tx('سارية للإنتاج', 'effective for production'), 'fa-circle-check')}
        ${kpi(tx('قيد الإعداد', 'Draft / review'), d.draft_boms ?? 0, tx('غير قابلة للإنتاج', 'not usable by production'), 'fa-pen-ruler')}
        ${kpi(tx('مسارات التصنيع', 'Routings'), d.routing_count ?? 0, '', 'fa-route')}
        ${kpi(tx('مراكز العمل', 'Work centers'), d.work_center_count ?? 0, tx('نشطة', 'active'), 'fa-industry')}
        ${kpi(tx('أوامر تغيير مفتوحة', 'Open ECOs'), d.open_ecos ?? 0, tx('تنتظر القرار', 'awaiting decision'), 'fa-file-pen')}
      </div>
      <section class="ce-panel">
        <h3>${tx('النواقص الحالية', 'Current shortages')}</h3>
        ${table(
          [tx('الصنف', 'Item'), tx('المطلوب', 'Gross'), tx('المتاح', 'Available'), tx('الصافي', 'Net'), tx('التاريخ', 'Date')],
          state.rows.shortages.slice(0, 10).map((r) => `<tr class="ce-row-warn">
            <td>${esc(r.sku || r.product_id)}</td><td>${num(r.gross_requirement)}</td>
            <td>${num(r.available)}</td><td>${num(r.net_requirement)}</td><td>${date(r.required_date)}</td>
          </tr>`),
          tx('لا توجد نواقص', 'No shortages'),
        )}
      </section>`;
  }

  function renderBoms() {
    return `
      <section class="ce-panel">
        <h3>${tx('إنشاء قائمة مواد', 'Create BOM')}</h3>
        <form class="ce-form" data-ce-form="bom">
          <label>${tx('المنتج', 'Product')}<select name="product_id" required>
            ${state.rows.products.map((p) => `<option value="${esc(p.variant_id || p.id)}">${esc(p.sku || '')} — ${esc(p.name)}</option>`).join('')}
          </select></label>
          <label>${tx('الاسم (عربي)', 'Name (Arabic)')}<input name="name_ar" maxlength="120"></label>
          <label>${tx('الاسم (إنجليزي)', 'Name (English)')}<input name="name_en" maxlength="120"></label>
          <label>${tx('الكمية الأساسية', 'Base quantity')}<input name="quantity" type="number" step="0.001" min="0.001" value="1"></label>
          <label>${tx('نسبة الإنتاجية %', 'Yield %')}<input name="yield_percent" type="number" step="0.01" min="0.01" max="100" value="100"></label>
          <label>${tx('النوع', 'Type')}<select name="bom_type">
            <option value="manufacturing">${tx('تصنيع', 'Manufacturing')}</option>
            <option value="phantom">${tx('وهمية', 'Phantom')}</option>
            <option value="subcontract">${tx('مقاولة باطن', 'Subcontract')}</option>
          </select></label>
          <button type="submit" ${state.busy ? 'disabled' : ''}>${tx('إنشاء', 'Create')}</button>
        </form>
        <p class="ce-hint"><i class="fa-solid fa-circle-info"></i>${tx('الإنتاج يستخدم الإصدار المعتمد الساري فقط؛ الإصدار المستهلك يصبح غير قابل للتعديل.', 'Production uses only the effective approved version; a consumed version becomes immutable.')}</p>
      </section>
      <section class="ce-panel">
        <h3>${tx('قوائم المواد', 'Bills of materials')}</h3>
        ${table(
          [tx('الرمز', 'Code'), tx('الاسم', 'Name'), tx('النوع', 'Type'), tx('الإصدار الساري', 'Effective rev.'), tx('الحالة', 'State'), tx('إجراءات', 'Actions')],
          state.rows.boms.map((r) => `<tr class="${r.id === state.selectedBomId ? 'ce-row-active' : ''}">
            <td>${esc(r.code)}</td><td>${esc(r.name_en || r.name_ar || '—')}</td><td>${esc(r.bom_type)}</td>
            <td>${r.effective_revision != null ? esc(r.effective_revision) : '—'}</td>
            <td>${r.effective_state ? badge(r.effective_state) : badge('draft')}</td>
            <td><button type="button" class="ce-link" data-ce-bom="${esc(r.id)}">${tx('فتح', 'Open')}</button></td>
          </tr>`),
          tx('لا توجد قوائم مواد', 'No BOMs'),
        )}
      </section>`;
  }

  function renderBomDetail() {
    const d = state.rows.bomDetail;
    if (!d) return emptyState(tx('اختر قائمة مواد من تبويب «قوائم المواد»', 'Select a BOM from the BOMs tab'));
    const draft = d.versions.find((v) => v.state === 'draft');
    return `
      <section class="ce-panel">
        <h3>${esc(d.code)} — ${esc(d.name_en || d.name_ar || '')}</h3>
        ${table(
          [tx('الإصدار', 'Rev'), tx('الحالة', 'State'), tx('الكمية', 'Qty'), tx('الإنتاجية', 'Yield'), tx('السطور', 'Lines'), tx('مستهلك', 'Consumed'), tx('إجراءات', 'Actions')],
          d.versions.map((v) => `<tr>
            <td>${esc(v.revision)}</td><td>${badge(v.state)}</td><td>${num(v.quantity)}</td>
            <td>${num(v.yield_percent)}%</td><td>${esc(v.lines.length)}</td>
            <td>${v.consumed_at ? `<i class="fa-solid fa-lock" title="${tx('غير قابل للتعديل', 'immutable')}"></i>` : '—'}</td>
            <td class="ce-actions">
              ${v.state === 'draft' ? `<button type="button" class="ce-link" data-ce-bom-submit="${esc(v.id)}">${tx('إرسال للمراجعة', 'Submit')}</button>` : ''}
              ${v.state === 'review' ? `<button type="button" class="ce-link" data-ce-bom-approve="${esc(v.id)}">${tx('اعتماد', 'Approve')}</button>
                 <button type="button" class="ce-link ce-danger" data-ce-bom-reject="${esc(v.id)}">${tx('رفض', 'Reject')}</button>` : ''}
              ${v.state === 'approved' ? `<button type="button" class="ce-link" data-ce-bom-revise="${esc(d.id)}">${tx('إصدار جديد', 'New revision')}</button>` : ''}
            </td>
          </tr>`),
          tx('لا توجد إصدارات', 'No versions'),
        )}
      </section>
      ${draft ? `<section class="ce-panel">
        <h3>${tx('إضافة مكوّن للإصدار المسودة', 'Add component to the draft revision')}</h3>
        <form class="ce-form" data-ce-form="bom-line">
          <input type="hidden" name="bom_version_id" value="${esc(draft.id)}">
          <label>${tx('المكوّن', 'Component')}<select name="component_id" required>
            ${state.rows.products.map((p) => `<option value="${esc(p.variant_id || p.id)}">${esc(p.sku || '')} — ${esc(p.name)}</option>`).join('')}
          </select></label>
          <label>${tx('الكمية', 'Quantity')}<input name="quantity" type="number" step="0.001" min="0.001" required></label>
          <label>${tx('نسبة الهدر %', 'Scrap %')}<input name="scrap_factor_percent" type="number" step="0.01" min="0" max="99" value="0"></label>
          <label>${tx('النوع', 'Line type')}<select name="line_type">
            <option value="component">${tx('مكوّن', 'Component')}</option>
            <option value="by_product">${tx('منتج ثانوي', 'By-product')}</option>
            <option value="co_product">${tx('منتج مشترك', 'Co-product')}</option>
          </select></label>
          <button type="submit" ${state.busy ? 'disabled' : ''}>${tx('إضافة', 'Add')}</button>
        </form>
      </section>` : ''}
      <section class="ce-panel">
        <h3>${tx('سطور الإصدارات', 'Version lines')}</h3>
        ${table(
          [tx('الإصدار', 'Rev'), tx('التسلسل', 'Seq'), tx('المكوّن', 'Component'), tx('الكمية', 'Qty'), tx('الهدر', 'Scrap'), tx('وهمي', 'Phantom'), tx('إجراءات', 'Actions')],
          d.versions.flatMap((v) => v.lines.map((l) => `<tr>
            <td>${esc(v.revision)}</td><td>${esc(l.sequence)}</td><td>${esc(l.component_id)}</td>
            <td>${num(l.quantity)}</td><td>${num(l.scrap_factor_percent)}%</td>
            <td>${l.is_phantom ? tx('نعم', 'Yes') : '—'}</td>
            <td>${v.state === 'draft' ? `<button type="button" class="ce-link ce-danger" data-ce-line-remove="${esc(l.id)}">${tx('حذف', 'Remove')}</button>` : '—'}</td>
          </tr>`)),
          tx('لا توجد سطور', 'No lines'),
        )}
      </section>`;
  }

  function renderRoutings() {
    const d = state.rows.routingDetail;
    return `
      <section class="ce-panel">
        <h3>${tx('إنشاء مسار تصنيع', 'Create routing')}</h3>
        <form class="ce-form" data-ce-form="routing">
          <label>${tx('المنتج', 'Product')}<select name="product_id" required>
            ${state.rows.products.map((p) => `<option value="${esc(p.variant_id || p.id)}">${esc(p.sku || '')} — ${esc(p.name)}</option>`).join('')}
          </select></label>
          <label>${tx('الاسم', 'Name')}<input name="name_en" maxlength="120"></label>
          <button type="submit" ${state.busy ? 'disabled' : ''}>${tx('إنشاء', 'Create')}</button>
        </form>
      </section>
      <section class="ce-panel">
        <h3>${tx('المسارات', 'Routings')}</h3>
        ${table(
          [tx('الرمز', 'Code'), tx('الاسم', 'Name'), tx('الإصدار الساري', 'Effective rev.'), tx('إجراءات', 'Actions')],
          state.rows.routings.map((r) => `<tr class="${r.id === state.selectedRoutingId ? 'ce-row-active' : ''}">
            <td>${esc(r.code)}</td><td>${esc(r.name_en || r.name_ar || '—')}</td>
            <td>${r.effective_revision != null ? esc(r.effective_revision) : '—'}</td>
            <td><button type="button" class="ce-link" data-ce-routing="${esc(r.id)}">${tx('فتح', 'Open')}</button></td>
          </tr>`),
          tx('لا توجد مسارات', 'No routings'),
        )}
      </section>
      ${d ? `<section class="ce-panel">
        <h3>${esc(d.code)} — ${tx('العمليات', 'Operations')}</h3>
        ${(() => {
          const draft = d.versions.find((v) => v.state === 'draft');
          return draft ? `<form class="ce-form" data-ce-form="routing-op">
            <input type="hidden" name="routing_version_id" value="${esc(draft.id)}">
            <label>${tx('مركز العمل', 'Work center')}<select name="work_center_id" required>
              ${state.rows.workCenters.map((w) => `<option value="${esc(w.id)}">${esc(w.code)} — ${esc(w.name_en || w.name_ar)}</option>`).join('')}
            </select></label>
            <label>${tx('اسم العملية', 'Operation name')}<input name="name" required maxlength="120"></label>
            <label>${tx('زمن التهيئة (د)', 'Setup (min)')}<input name="setup_minutes" type="number" step="0.1" min="0" value="0"></label>
            <label>${tx('زمن الدورة/وحدة (د)', 'Cycle/unit (min)')}<input name="cycle_minutes_per_unit" type="number" step="0.1" min="0" value="0"></label>
            <label>${tx('نقطة فحص جودة', 'Quality checkpoint')}<select name="quality_checkpoint"><option value="0">${tx('لا', 'No')}</option><option value="1">${tx('نعم', 'Yes')}</option></select></label>
            <button type="submit" ${state.busy ? 'disabled' : ''}>${tx('إضافة عملية', 'Add operation')}</button>
          </form>` : '';
        })()}
        ${table(
          [tx('الإصدار', 'Rev'), tx('الحالة', 'State'), tx('التسلسل', 'Seq'), tx('العملية', 'Operation'), tx('التهيئة', 'Setup'), tx('الدورة', 'Cycle'), tx('جودة', 'QC'), tx('إجراءات', 'Actions')],
          d.versions.flatMap((v) => (v.operations.length ? v.operations.map((o) => `<tr>
            <td>${esc(v.revision)}</td><td>${badge(v.state)}</td><td>${esc(o.sequence)}</td><td>${esc(o.name)}</td>
            <td>${num(o.setup_minutes)}</td><td>${num(o.cycle_minutes_per_unit)}</td>
            <td>${o.quality_checkpoint ? '<i class="fa-solid fa-clipboard-check"></i>' : '—'}</td>
            <td class="ce-actions">
              ${v.state === 'draft' ? `<button type="button" class="ce-link" data-ce-routing-submit="${esc(v.id)}">${tx('إرسال', 'Submit')}</button>` : ''}
              ${v.state === 'review' ? `<button type="button" class="ce-link" data-ce-routing-approve="${esc(v.id)}">${tx('اعتماد', 'Approve')}</button>` : ''}
            </td>
          </tr>`) : [`<tr><td>${esc(v.revision)}</td><td>${badge(v.state)}</td><td colspan="4">${tx('لا توجد عمليات', 'No operations')}</td><td>—</td><td>${v.state === 'draft' ? `<button type="button" class="ce-link" data-ce-routing-submit="${esc(v.id)}">${tx('إرسال', 'Submit')}</button>` : '—'}</td></tr>`])),
          tx('لا توجد عمليات', 'No operations'),
        )}
      </section>` : ''}`;
  }

  function renderWorkCenters() {
    return `
      <section class="ce-panel">
        <h3>${tx('إنشاء مركز عمل', 'Create work center')}</h3>
        <form class="ce-form" data-ce-form="work-center">
          <label>${tx('الرمز', 'Code')}<input name="code" required maxlength="30"></label>
          <label>${tx('الاسم', 'Name')}<input name="name" required maxlength="120"></label>
          <label>${tx('كلفة الآلة/ساعة', 'Machine cost/hr')}<input name="machine_cost_per_hour" type="number" step="0.01" min="0" value="0"></label>
          <label>${tx('كلفة العمالة/ساعة', 'Labor cost/hr')}<input name="labor_cost_per_hour" type="number" step="0.01" min="0" value="0"></label>
          <label>${tx('الطاقة/ساعة', 'Capacity/hr')}<input name="capacity_per_hour" type="number" step="0.01" min="0.01" value="1"></label>
          <button type="submit" ${state.busy ? 'disabled' : ''}>${tx('إنشاء', 'Create')}</button>
        </form>
        <p class="ce-hint"><i class="fa-solid fa-shield-halved"></i>${tx('معدلات مراكز العمل تُكتب في سلطة التكلفة المعيارية الوحيدة — لا تُقرأ الرواتب إطلاقاً.', 'Work-centre rates are written into the single standard-cost authority — payroll is never read.')}</p>
      </section>
      <section class="ce-panel">
        <h3>${tx('مراكز العمل', 'Work centers')}</h3>
        ${table(
          [tx('الرمز', 'Code'), tx('الاسم', 'Name'), tx('آلة/ساعة', 'Machine/hr'), tx('عمالة/ساعة', 'Labor/hr'), tx('الطاقة', 'Capacity'), tx('مقاولة باطن', 'Subcon')],
          state.rows.workCenters.map((r) => `<tr>
            <td>${esc(r.code)}</td><td>${esc(r.name_en || r.name_ar)}</td>
            <td>${num(r.machine_cost_per_hour)}</td><td>${num(r.labor_cost_per_hour)}</td>
            <td>${num(r.capacity_per_hour)}</td><td>${r.is_subcontract ? tx('نعم', 'Yes') : '—'}</td>
          </tr>`),
          tx('لا توجد مراكز عمل', 'No work centers'),
        )}
      </section>`;
  }

  function renderChangeOrders() {
    return `
      <section class="ce-panel">
        <h3>${tx('إنشاء أمر تغيير هندسي', 'Create engineering change order')}</h3>
        <form class="ce-form" data-ce-form="eco">
          <label>${tx('العنوان', 'Title')}<input name="title" required maxlength="140"></label>
          <label>${tx('النوع', 'Change type')}<select name="change_type">
            <option value="bom">${tx('قائمة مواد', 'BOM')}</option>
            <option value="routing">${tx('مسار', 'Routing')}</option>
            <option value="both">${tx('كلاهما', 'Both')}</option>
          </select></label>
          <label>${tx('قائمة المواد', 'BOM')}<select name="bom_id">
            <option value="">${tx('بدون', 'None')}</option>
            ${state.rows.boms.map((b) => `<option value="${esc(b.id)}">${esc(b.code)}</option>`).join('')}
          </select></label>
          <label>${tx('السبب', 'Reason')}<input name="reason" maxlength="200"></label>
          <button type="submit" ${state.busy ? 'disabled' : ''}>${tx('إنشاء', 'Create')}</button>
        </form>
        <p class="ce-hint"><i class="fa-solid fa-circle-info"></i>${tx('اعتماد أمر التغيير يفتح إصداراً جديداً محكوماً ولا يعدّل إصداراً معتمداً في مكانه.', 'Approving an ECO opens a new governed revision; it never edits an approved version in place.')}</p>
      </section>
      <section class="ce-panel">
        <h3>${tx('أوامر التغيير الهندسي', 'Engineering change orders')}</h3>
        ${table(
          [tx('الرقم', 'Number'), tx('العنوان', 'Title'), tx('النوع', 'Type'), tx('الحالة', 'State'), tx('إجراءات', 'Actions')],
          state.rows.changeOrders.map((r) => `<tr>
            <td>${esc(r.eco_number)}</td><td>${esc(r.title)}</td><td>${esc(r.change_type)}</td><td>${badge(r.state)}</td>
            <td class="ce-actions">${['draft', 'submitted'].includes(r.state) ? `
              <button type="button" class="ce-link" data-ce-eco-approve="${esc(r.id)}">${tx('اعتماد', 'Approve')}</button>
              <button type="button" class="ce-link ce-danger" data-ce-eco-reject="${esc(r.id)}">${tx('رفض', 'Reject')}</button>` : '—'}</td>
          </tr>`),
          tx('لا توجد أوامر تغيير', 'No change orders'),
        )}
      </section>`;
  }

  function renderPolicies() {
    return `
      <section class="ce-panel">
        <h3>${tx('تحديد سياسة تخطيط', 'Set planning policy')}</h3>
        <form class="ce-form" data-ce-form="policy">
          <label>${tx('الصنف', 'Item')}<select name="product_id" required>
            ${state.rows.products.map((p) => `<option value="${esc(p.variant_id || p.id)}">${esc(p.sku || '')} — ${esc(p.name)}</option>`).join('')}
          </select></label>
          <label>${tx('مصدر التوريد', 'Sourcing')}<select name="sourcing">
            <option value="buy">${tx('شراء', 'Buy')}</option>
            <option value="make">${tx('تصنيع', 'Make')}</option>
            <option value="transfer">${tx('نقل', 'Transfer')}</option>
            <option value="subcontract">${tx('مقاولة باطن', 'Subcontract')}</option>
          </select></label>
          <label>${tx('مخزون الأمان', 'Safety stock')}<input name="safety_stock" type="number" step="0.001" min="0" value="0"></label>
          <label>${tx('مهلة التوريد (أيام)', 'Lead time (days)')}<input name="lead_time_days" type="number" step="1" min="0" value="0"></label>
          <label>${tx('حجم الدفعة', 'Lot sizing')}<select name="lot_sizing">
            <option value="lot_for_lot">${tx('حسب الحاجة', 'Lot for lot')}</option>
            <option value="fixed">${tx('ثابت', 'Fixed')}</option>
          </select></label>
          <label>${tx('حجم الدفعة الثابت', 'Fixed lot size')}<input name="fixed_lot_size" type="number" step="0.001" min="0" value="0"></label>
          <label>${tx('أقل كمية طلب', 'Min order qty')}<input name="minimum_order_quantity" type="number" step="0.001" min="0" value="0"></label>
          <button type="submit" ${state.busy ? 'disabled' : ''}>${tx('حفظ', 'Save')}</button>
        </form>
      </section>
      <section class="ce-panel">
        <h3>${tx('سياسات التخطيط', 'Planning policies')}</h3>
        ${table(
          [tx('الصنف', 'Item'), tx('المصدر', 'Sourcing'), tx('مخزون الأمان', 'Safety'), tx('المهلة', 'Lead'), tx('الدفعة', 'Lot'), tx('أقل كمية', 'MOQ')],
          state.rows.policies.map((r) => `<tr>
            <td>${esc(r.sku || r.product_id)}</td><td>${badge(r.sourcing)}</td><td>${num(r.safety_stock)}</td>
            <td>${esc(r.lead_time_days)}</td><td>${esc(r.lot_sizing)}</td><td>${num(r.minimum_order_quantity)}</td>
          </tr>`),
          tx('لا توجد سياسات', 'No policies'),
        )}
      </section>`;
  }

  function renderDemand() {
    return `
      <section class="ce-panel">
        <h3>${tx('تسجيل طلب', 'Record demand')}</h3>
        <form class="ce-form" data-ce-form="demand">
          <label>${tx('الصنف', 'Item')}<select name="product_id" required>
            ${state.rows.products.map((p) => `<option value="${esc(p.variant_id || p.id)}">${esc(p.sku || '')} — ${esc(p.name)}</option>`).join('')}
          </select></label>
          <label>${tx('الكمية', 'Quantity')}<input name="quantity" type="number" step="0.001" min="0.001" required></label>
          <label>${tx('النوع', 'Demand type')}<select name="demand_type">
            <option value="manual">${tx('يدوي', 'Manual')}</option>
            <option value="sales_order">${tx('أمر بيع', 'Sales order')}</option>
            <option value="project">${tx('مشروع', 'Project')}</option>
            <option value="forecast">${tx('توقع', 'Forecast')}</option>
            <option value="master_schedule">${tx('جدول إنتاج رئيسي', 'Master schedule')}</option>
          </select></label>
          <label>${tx('تاريخ الحاجة', 'Required date')}<input name="required_date" type="date"></label>
          <button type="submit" ${state.busy ? 'disabled' : ''}>${tx('تسجيل', 'Record')}</button>
        </form>
      </section>
      <section class="ce-panel">
        <h3>${tx('الطلب', 'Demand')}</h3>
        ${table(
          [tx('الصنف', 'Item'), tx('النوع', 'Type'), tx('الكمية', 'Qty'), tx('التاريخ', 'Date'), tx('الحالة', 'State')],
          state.rows.demand.map((r) => `<tr>
            <td>${esc(r.sku || r.product_id)}</td><td>${esc(r.demand_type)}</td><td>${num(r.quantity)}</td>
            <td>${date(r.required_date)}</td><td>${badge(r.state)}</td>
          </tr>`),
          tx('لا يوجد طلب', 'No demand'),
        )}
      </section>`;
  }

  function renderRuns() {
    return `
      <section class="ce-panel">
        <h3>${tx('تشغيل دورة تخطيط', 'Execute planning run')}</h3>
        <p class="ce-hint"><i class="fa-solid fa-shield-halved"></i>${tx('التخطيط ينتج مقترحات محكومة فقط — لا يُنشئ التزاماً مالياً ولا يحرّك مخزوناً.', 'Planning produces governed proposals only — it creates no financial commitment and moves no stock.')}</p>
        <form class="ce-form" data-ce-form="run">
          <label>${tx('أفق التخطيط (أيام)', 'Horizon (days)')}<input name="horizon_days" type="number" step="1" min="1" value="90"></label>
          <button type="submit" ${state.busy ? 'disabled' : ''}>${tx('تشغيل MRP', 'Run MRP')}</button>
        </form>
      </section>
      <section class="ce-panel">
        <h3>${tx('دورات التخطيط', 'MRP runs')}</h3>
        ${table(
          [tx('الرقم', 'Run'), tx('الحالة', 'State'), tx('الطلب', 'Demand'), tx('الاحتياجات', 'Requirements'), tx('المقترحات', 'Proposals'), tx('النواقص', 'Shortages'), tx('التنفيذ', 'Executed'), tx('إجراءات', 'Actions')],
          state.rows.runs.map((r) => `<tr class="${r.id === state.selectedRunId ? 'ce-row-active' : ''}">
            <td>${esc(r.run_number)}</td><td>${badge(r.state)}</td><td>${esc(r.demand_count)}</td>
            <td>${esc(r.requirement_count)}</td><td>${esc(r.proposal_count)}</td><td>${esc(r.shortage_count)}</td>
            <td>${date(r.executed_at)}</td>
            <td><button type="button" class="ce-link" data-ce-run="${esc(r.id)}">${tx('عرض', 'View')}</button></td>
          </tr>`),
          tx('لا توجد دورات تخطيط', 'No MRP runs'),
        )}
      </section>`;
  }

  function renderRequirements() {
    return `<section class="ce-panel">
      <h3>${tx('الاحتياجات', 'Requirements')}${state.selectedRunId ? '' : ` — ${tx('اختر دورة', 'select a run')}`}</h3>
      ${table(
        [tx('المستوى', 'Level'), tx('الصنف', 'Item'), tx('المطلوب', 'Gross'), tx('المتوفر', 'On hand'), tx('المحجوز', 'Reserved'), tx('وارد', 'Receipts'), tx('الأمان', 'Safety'), tx('المتاح', 'Available'), tx('الصافي', 'Net')],
        state.rows.requirements.map((r) => `<tr class="${r.is_shortage ? 'ce-row-warn' : ''}">
          <td>${esc(r.level)}</td><td>${esc(r.sku || r.product_id)}</td><td>${num(r.gross_requirement)}</td>
          <td>${num(r.on_hand)}</td><td>${num(r.reserved)}</td><td>${num(r.scheduled_receipts)}</td>
          <td>${num(r.safety_stock)}</td><td>${num(r.available)}</td><td>${num(r.net_requirement)}</td>
        </tr>`),
        tx('لا توجد احتياجات', 'No requirements'),
      )}
    </section>`;
  }

  function renderProposals() {
    return `<section class="ce-panel">
      <h3>${tx('المقترحات المحكومة', 'Governed proposals')}</h3>
      <p class="ce-hint"><i class="fa-solid fa-circle-info"></i>${tx('الاعتماد يصرّح بالتسليم إلى السلطة القانونية المختصة، ولا ينشئ المستند بنفسه.', 'Approval authorises hand-off to the responsible canonical authority; it does not itself create the document.')}</p>
      ${table(
        [tx('النوع', 'Type'), tx('الصنف', 'Item'), tx('الكمية', 'Qty'), tx('التاريخ', 'Date'), tx('الحالة', 'State'), tx('إجراءات', 'Actions')],
        state.rows.proposals.map((r) => `<tr>
          <td>${badge(r.proposal_type)}</td><td>${esc(r.sku || r.product_id)}</td><td>${num(r.quantity)}</td>
          <td>${date(r.suggested_date)}</td><td>${badge(r.state)}</td>
          <td class="ce-actions">${r.state === 'proposed' ? `
            <button type="button" class="ce-link" data-ce-prop-approve="${esc(r.id)}">${tx('اعتماد', 'Approve')}</button>
            <button type="button" class="ce-link ce-danger" data-ce-prop-reject="${esc(r.id)}">${tx('رفض', 'Reject')}</button>` : '—'}</td>
        </tr>`),
        tx('لا توجد مقترحات', 'No proposals'),
      )}
    </section>`;
  }

  function renderShortages() {
    return `<section class="ce-panel">
      <h3>${tx('قائمة النواقص', 'Shortage worklist')}</h3>
      ${table(
        [tx('المستوى', 'Level'), tx('الصنف', 'Item'), tx('المطلوب', 'Gross'), tx('المتاح', 'Available'), tx('الصافي', 'Net'), tx('تاريخ الحاجة', 'Required')],
        state.rows.shortages.map((r) => `<tr class="ce-row-warn">
          <td>${esc(r.level)}</td><td>${esc(r.sku || r.product_id)}</td><td>${num(r.gross_requirement)}</td>
          <td>${num(r.available)}</td><td>${num(r.net_requirement)}</td><td>${date(r.required_date)}</td>
        </tr>`),
        tx('لا توجد نواقص', 'No shortages'),
      )}
    </section>`;
  }

  function renderActive() {
    switch (state.active) {
      case 'dashboard': return renderDashboard();
      case 'boms': return renderBoms();
      case 'bom-detail': return renderBomDetail();
      case 'routings': return renderRoutings();
      case 'work-centers': return renderWorkCenters();
      case 'change-orders': return renderChangeOrders();
      case 'policies': return renderPolicies();
      case 'demand': return renderDemand();
      case 'runs': return renderRuns();
      case 'requirements': return renderRequirements();
      case 'proposals': return renderProposals();
      case 'shortages': return renderShortages();
      default: return renderDashboard();
    }
  }

  // --------------------------------------------------------------- data

  async function refresh() {
    const api = client();
    if (!api) {
      state.error = tx('طبقة النقل القانونية غير متاحة.', 'The canonical transport layer is unavailable.');
      shell();
      return;
    }
    state.loading = true;
    state.error = null;
    shell();
    try {
      const [dashboard, boms, routings, workCenters, changeOrders, policies, demand, runs, proposals, shortages, products] =
        await Promise.all([
          api.engineering.dashboard(),
          api.engineering.listBoms(),
          api.engineering.listRoutings(),
          api.engineering.listWorkCenters(),
          api.engineering.listChangeOrders(),
          api.mrp.listPolicies(),
          api.mrp.listDemand(),
          api.mrp.listRuns(),
          api.mrp.listProposals(),
          api.mrp.listShortages(),
          api.products.list({ limit: 300 }),
        ]);
      state.dashboard = dashboard || {};
      state.rows.boms = boms || [];
      state.rows.routings = routings || [];
      state.rows.workCenters = workCenters || [];
      state.rows.changeOrders = changeOrders || [];
      state.rows.policies = policies || [];
      state.rows.demand = demand || [];
      state.rows.runs = runs || [];
      state.rows.proposals = proposals || [];
      state.rows.shortages = shortages || [];
      state.rows.products = products || [];

      if (state.selectedBomId) {
        try { state.rows.bomDetail = await api.engineering.getBom(state.selectedBomId); }
        catch (_) { state.rows.bomDetail = null; state.selectedBomId = null; }
      }
      if (state.selectedRoutingId) {
        try { state.rows.routingDetail = await api.engineering.getRouting(state.selectedRoutingId); }
        catch (_) { state.rows.routingDetail = null; state.selectedRoutingId = null; }
      }
      if (state.selectedRunId) {
        state.rows.requirements = await api.mrp.listRequirements({ mrp_run_id: state.selectedRunId });
      }
    } catch (error) {
      state.error = normalizeError(error);
    } finally {
      state.loading = false;
      shell();
    }
  }

  async function command(message, run) {
    if (state.busy) return;
    state.busy = true;
    state.error = null;
    state.notice = null;
    shell();
    try {
      await run();
      state.notice = message;
      await refresh();
    } catch (error) {
      state.error = normalizeError(error);
      state.busy = false;
      shell();
      return;
    }
    state.busy = false;
    shell();
  }

  // ------------------------------------------------------------- binding

  function bind(el) {
    const api = client();

    el.querySelectorAll('[data-ce-tab]').forEach((b) => b.addEventListener('click', () => {
      state.active = b.dataset.ceTab;
      state.notice = null;
      shell();
    }));
    el.querySelectorAll('[data-ce-action="refresh"]').forEach((b) => b.addEventListener('click', () => refresh()));

    el.querySelectorAll('[data-ce-bom]').forEach((b) => b.addEventListener('click', async () => {
      state.selectedBomId = b.dataset.ceBom;
      state.active = 'bom-detail';
      state.loading = true; shell();
      try { state.rows.bomDetail = await api.engineering.getBom(state.selectedBomId); }
      catch (e) { state.error = normalizeError(e); }
      finally { state.loading = false; shell(); }
    }));
    el.querySelectorAll('[data-ce-routing]').forEach((b) => b.addEventListener('click', async () => {
      state.selectedRoutingId = b.dataset.ceRouting;
      state.loading = true; shell();
      try { state.rows.routingDetail = await api.engineering.getRouting(state.selectedRoutingId); }
      catch (e) { state.error = normalizeError(e); }
      finally { state.loading = false; shell(); }
    }));
    el.querySelectorAll('[data-ce-run]').forEach((b) => b.addEventListener('click', async () => {
      state.selectedRunId = b.dataset.ceRun;
      state.active = 'requirements';
      state.loading = true; shell();
      try { state.rows.requirements = await api.mrp.listRequirements({ mrp_run_id: state.selectedRunId }); }
      catch (e) { state.error = normalizeError(e); }
      finally { state.loading = false; shell(); }
    }));

    const form = (n) => el.querySelector(`[data-ce-form="${n}"]`);
    const on = (n, h) => { const f = form(n); if (f) f.addEventListener('submit', (e) => { e.preventDefault(); h(new FormData(f)); }); };

    on('bom', (d) => command(tx('تم إنشاء قائمة المواد.', 'BOM created.'), () => api.engineering.createBom({
      product_id: d.get('product_id'),
      name_ar: d.get('name_ar') || '', name_en: d.get('name_en') || '',
      quantity: Number(d.get('quantity') || 1),
      yield_percent: Number(d.get('yield_percent') || 100),
      bom_type: d.get('bom_type'),
    })));
    on('bom-line', (d) => command(tx('تمت إضافة المكوّن.', 'Component added.'), () => api.engineering.addBomLine({
      bom_version_id: d.get('bom_version_id'),
      component_id: d.get('component_id'),
      quantity: Number(d.get('quantity')),
      scrap_factor_percent: Number(d.get('scrap_factor_percent') || 0),
      line_type: d.get('line_type'),
    })));
    on('routing', (d) => command(tx('تم إنشاء المسار.', 'Routing created.'), () => api.engineering.createRouting({
      product_id: d.get('product_id'), name_en: d.get('name_en') || '',
    })));
    on('routing-op', (d) => command(tx('تمت إضافة العملية.', 'Operation added.'), () => api.engineering.addRoutingOperation({
      routing_version_id: d.get('routing_version_id'),
      work_center_id: d.get('work_center_id'),
      name: d.get('name'),
      setup_minutes: Number(d.get('setup_minutes') || 0),
      cycle_minutes_per_unit: Number(d.get('cycle_minutes_per_unit') || 0),
      quality_checkpoint: d.get('quality_checkpoint') === '1',
    })));
    on('work-center', (d) => command(tx('تم إنشاء مركز العمل.', 'Work center created.'), () => api.engineering.createWorkCenter({
      code: d.get('code'), name: d.get('name'),
      machine_cost_per_hour: Number(d.get('machine_cost_per_hour') || 0),
      labor_cost_per_hour: Number(d.get('labor_cost_per_hour') || 0),
      capacity_per_hour: Number(d.get('capacity_per_hour') || 1),
    })));
    on('eco', (d) => command(tx('تم إنشاء أمر التغيير.', 'Change order created.'), () => api.engineering.createEco({
      title: d.get('title'), change_type: d.get('change_type'),
      bom_id: d.get('bom_id') || undefined, reason: d.get('reason') || '',
    })));
    on('policy', (d) => command(tx('تم حفظ السياسة.', 'Policy saved.'), () => api.mrp.setPolicy({
      product_id: d.get('product_id'), sourcing: d.get('sourcing'),
      safety_stock: Number(d.get('safety_stock') || 0),
      lead_time_days: Number(d.get('lead_time_days') || 0),
      lot_sizing: d.get('lot_sizing'),
      fixed_lot_size: Number(d.get('fixed_lot_size') || 0),
      minimum_order_quantity: Number(d.get('minimum_order_quantity') || 0),
    })));
    on('demand', (d) => command(tx('تم تسجيل الطلب.', 'Demand recorded.'), () => api.mrp.recordDemand({
      product_id: d.get('product_id'), quantity: Number(d.get('quantity')),
      demand_type: d.get('demand_type'), required_date: d.get('required_date') || null,
    })));
    on('run', (d) => command(tx('تم تنفيذ دورة التخطيط.', 'MRP run completed.'), () => api.mrp.run({
      horizon_days: Number(d.get('horizon_days') || 90),
    })));

    const act = (sel, key, msg, fn) => el.querySelectorAll(`[${sel}]`).forEach((b) => b.addEventListener('click', () => command(msg, () => fn(b.dataset[key]))));
    act('data-ce-bom-submit', 'ceBomSubmit', tx('تم إرسال الإصدار للمراجعة.', 'Version submitted for review.'), (id) => api.engineering.submitBom({ bom_version_id: id }));
    act('data-ce-bom-approve', 'ceBomApprove', tx('تم اعتماد الإصدار.', 'Version approved.'), (id) => api.engineering.approveBom({ bom_version_id: id }));
    act('data-ce-bom-reject', 'ceBomReject', tx('تم رفض الإصدار.', 'Version rejected.'), (id) => api.engineering.rejectBom({ bom_version_id: id, reason: 'Rejected from Engineering workspace' }));
    act('data-ce-bom-revise', 'ceBomRevise', tx('تم فتح إصدار جديد.', 'New revision opened.'), (id) => api.engineering.newBomRevision({ bom_id: id }));
    act('data-ce-line-remove', 'ceLineRemove', tx('تم حذف السطر.', 'Line removed.'), (id) => api.engineering.removeBomLine({ line_id: id }));
    act('data-ce-routing-submit', 'ceRoutingSubmit', tx('تم إرسال المسار للمراجعة.', 'Routing submitted.'), (id) => api.engineering.submitRouting({ routing_version_id: id }));
    act('data-ce-routing-approve', 'ceRoutingApprove', tx('تم اعتماد المسار.', 'Routing approved.'), (id) => api.engineering.approveRouting({ routing_version_id: id }));
    act('data-ce-eco-approve', 'ceEcoApprove', tx('تم اعتماد أمر التغيير.', 'Change order approved.'), (id) => api.engineering.approveEco({ eco_id: id }));
    act('data-ce-eco-reject', 'ceEcoReject', tx('تم رفض أمر التغيير.', 'Change order rejected.'), (id) => api.engineering.rejectEco({ eco_id: id }));
    act('data-ce-prop-approve', 'cePropApprove', tx('تم اعتماد المقترح.', 'Proposal approved.'), (id) => api.mrp.approveProposal({ proposal_id: id }));
    act('data-ce-prop-reject', 'cePropReject', tx('تم رفض المقترح.', 'Proposal rejected.'), (id) => api.mrp.rejectProposal({ proposal_id: id }));
  }

  function activate() { shell(); refresh(); }

  const previousRender = root.renderMrpPage;
  root.renderMrpPage = function renderCanonicalEngineering() { activate(); };
  root.CanonicalEngineering = {
    activate, refresh, state,
    TABS: tabs.map(([key, ar, en, icon]) => ({ key, label: { ar, en }, icon })),
    previousRender,
    selectTab(key) { state.active = key; shell(); },
  };

  // `mrp` is a core pageMap entry, so the shell asynchronously hydrates
  // views/mrp.html into #pageMrp. Activating only once that load has settled
  // makes the ordering deterministic instead of a race (same pattern as
  // modules/canonical-projects.js and modules/appointments.js).
  function wireSwitch() {
    if (root.__canonicalEngineeringWrapped || typeof root.switchPage !== 'function') return;
    const orig = root.switchPage;
    root.switchPage = function (page) {
      const result = orig.apply(this, arguments);
      if (page === 'mrp') {
        const settle = typeof root.ensurePageTemplateLoaded === 'function'
          ? Promise.resolve(root.ensurePageTemplateLoaded('mrp')).catch(() => {})
          : Promise.resolve();
        settle.then(() => {
          const el = host();
          if (el && el.classList.contains('page-active')) activate();
        });
      }
      return result;
    };
    root.__canonicalEngineeringWrapped = true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireSwitch, { once: true });
  } else {
    wireSwitch();
  }

  const mount = document.getElementById('pageMrp');
  if (mount && mount.classList.contains('page-active')) activate();
})(window);
