(function (root) {
  'use strict';

  // Checkpoint C1: visible Sales workspace over the canonical Octagon runtime.
  // This module intentionally replaces the legacy in-browser Sales writer.
  // Every mutation below travels through CanonicalClient -> ActionExecutor.
  root.__canonicalSalesAuthorityActive = true;

  const state = {
    active: 'dashboard',
    loading: false,
    busy: false,
    error: null,
    notice: null,
    selectedOrderId: null,
    selectedWarehouseId: null,
    report: 'pipeline',
    rows: {
      leads: [], opportunities: [], orders: [], reservations: [], deliveries: [],
      returns: [], invoiceRequests: [], balances: [], parties: [], products: [],
      warehouses: [], commissions: [], priceLists: [], report: [],
    },
  };

  const tabs = [
    ['dashboard', 'لوحة المبيعات', 'Sales Dashboard', 'fa-chart-line'],
    ['leads', 'العملاء المحتملون', 'Leads', 'fa-user-plus'],
    ['opportunities', 'الفرص', 'Opportunities', 'fa-filter-circle-dollar'],
    ['quotations', 'عروض الأسعار', 'Quotations', 'fa-file-invoice-dollar'],
    ['orders', 'طلبات المبيعات', 'Sales Orders', 'fa-cart-shopping'],
    ['reservations', 'الحجوزات', 'Reservations', 'fa-boxes-stacked'],
    ['deliveries', 'التسليمات', 'Deliveries', 'fa-truck'],
    ['returns', 'المرتجعات', 'Returns', 'fa-rotate-left'],
    ['invoice-requests', 'طلبات الفواتير', 'Invoice Requests', 'fa-receipt'],
    ['balances', 'أرصدة العملاء', 'Customer Balances', 'fa-scale-balanced'],
    ['reports', 'تقارير المبيعات', 'Sales Reports', 'fa-chart-column'],
  ];

  function client() { return root.CanonicalClient || null; }
  function isArabic() {
    const lang = String(document.documentElement.lang || '').toLowerCase();
    return document.documentElement.dir === 'rtl' || !lang || lang.startsWith('ar');
  }
  function tx(ar, en) { return isArabic() ? ar : en; }
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function money(value) {
    return new Intl.NumberFormat(isArabic() ? 'ar-IQ' : 'en-US', {
      maximumFractionDigits: 2,
    }).format(Number(value || 0));
  }
  function date(value) {
    if (!value) return '—';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? esc(value) : parsed.toLocaleDateString(isArabic() ? 'ar-IQ' : 'en-GB');
  }
  function status(value) {
    const key = String(value || 'unknown');
    return `<span class="cs-badge cs-state-${esc(key.replace(/[^a-z0-9_-]/gi, '-'))}">${esc(key)}</span>`;
  }
  function showToast(message, kind) {
    if (typeof root.showToast === 'function') root.showToast(message, kind || 'info');
  }
  // Replace the whole original Sales page. Mounting only inside salesCrmBody
  // leaves legacy commercial packs above the canonical workspace, so the
  // user still lands on an obsolete writer even though the new DOM exists.
  function host() { return document.getElementById('pageSales') || document.getElementById('salesCrmBody'); }

  function normalizeError(error) {
    if (!error) return tx('حدث خطأ غير معروف.', 'An unknown error occurred.');
    if (error.isAuthorization) return tx('لا تملك صلاحية تنفيذ هذا الإجراء.', 'You are not authorized to perform this action.');
    if (error.code) return `${error.code}: ${error.message}`;
    return error.message || String(error);
  }

  function loadingState() {
    return `<div class="cs-state cs-loading"><i class="fa-solid fa-circle-notch fa-spin"></i><strong>${tx('جاري تحميل حقائق المبيعات القانونية…', 'Loading canonical Sales facts…')}</strong></div>`;
  }
  function errorState() {
    return `<div class="cs-state cs-error" role="alert"><i class="fa-solid fa-triangle-exclamation"></i><div><strong>${tx('تعذر تحميل المبيعات', 'Sales could not be loaded')}</strong><p>${esc(state.error)}</p></div><button type="button" data-cs-action="refresh">${tx('إعادة المحاولة', 'Retry')}</button></div>`;
  }
  function emptyState(label) {
    return `<div class="cs-state cs-empty"><i class="fa-regular fa-folder-open"></i><strong>${esc(label)}</strong><span>${tx('استخدم الإجراء المناسب لإنشاء أول سجل قانوني.', 'Use the relevant action to create the first canonical record.')}</span></div>`;
  }

  function shell() {
    const el = host();
    if (!el) return;
    el.innerHTML = `
      <section class="cs-workspace" data-cs-workspace>
        <header class="cs-hero">
          <div>
            <span class="cs-eyebrow">${tx('أوكتاغون ERP · دورة تجارية قانونية', 'Octagon ERP · Canonical commercial cycle')}</span>
            <h2>${tx('المبيعات', 'Sales')}</h2>
            <p>${tx('من العميل المحتمل إلى الفاتورة والرصيد، عبر المخزون والمالية القانونيين.', 'Lead-to-balance execution through canonical Inventory and Finance.')}</p>
          </div>
          <div class="cs-hero-actions">
            <span class="cs-authority"><i class="fa-solid fa-shield-halved"></i>${tx('هوية ونطاق من الخادم', 'Server-derived identity and scope')}</span>
            <button type="button" class="cs-icon-btn" data-cs-action="refresh" title="${tx('تحديث', 'Refresh')}"><i class="fa-solid fa-rotate"></i></button>
          </div>
        </header>
        <nav class="cs-tabs" aria-label="${tx('مساحات المبيعات', 'Sales areas')}">
          ${tabs.map(([key, ar, en, icon]) => `<button type="button" class="${state.active === key ? 'active' : ''}" data-cs-tab="${key}"><i class="fa-solid ${icon}"></i><span>${tx(ar, en)}</span></button>`).join('')}
        </nav>
        <div class="cs-feedback" aria-live="polite">${state.notice ? `<div class="cs-notice"><i class="fa-solid fa-circle-check"></i>${esc(state.notice)}</div>` : ''}</div>
        <main class="cs-body">${state.loading ? loadingState() : state.error ? errorState() : renderActive()}</main>
      </section>`;
    bind(el);
  }

  function kpi(label, value, detail, icon) {
    return `<article class="cs-kpi"><i class="fa-solid ${icon}"></i><div><strong>${esc(value)}</strong><span>${esc(label)}</span><small>${esc(detail || '')}</small></div></article>`;
  }

  function renderDashboard() {
    const orders = state.rows.orders;
    const quotations = orders.filter((row) => row.state === 'draft' || row.quotation_state);
    const confirmed = orders.filter((row) => row.state === 'sale');
    const pipeline = state.rows.opportunities.filter((row) => row.status === 'open')
      .reduce((sum, row) => sum + Number(row.expected_value || 0), 0);
    const salesTotal = confirmed.reduce((sum, row) => sum + Number(row.amount_total || 0), 0);
    const accepted = quotations.filter((row) => row.quotation_state === 'accepted').length;
    const conversion = quotations.length ? Math.round((accepted / quotations.length) * 100) : 0;
    return `
      <div class="cs-kpis">
        ${kpi(tx('قيمة الفرص', 'Opportunity pipeline'), money(pipeline), tx('فرص مفتوحة', 'open opportunities'), 'fa-filter-circle-dollar')}
        ${kpi(tx('المبيعات المؤكدة', 'Confirmed sales'), money(salesTotal), `${confirmed.length} ${tx('طلب', 'orders')}`, 'fa-chart-line')}
        ${kpi(tx('نسبة قبول العروض', 'Quotation acceptance'), `${conversion}%`, `${accepted}/${quotations.length}`, 'fa-percent')}
        ${kpi(tx('طلبات الفاتورة', 'Invoice requests'), state.rows.invoiceRequests.length, tx('مرتبطة بالمالية', 'linked to Finance'), 'fa-receipt')}
      </div>
      <div class="cs-grid-two">
        <section class="cs-card">
          <div class="cs-card-head"><div><h3>${tx('مسار التنفيذ', 'Execution path')}</h3><p>${tx('كل انتقال ينفّذ أمراً قانونياً مسجلاً.', 'Every transition executes a governed, audited command.')}</p></div></div>
          <ol class="cs-lifecycle">
            ${[
              [tx('عميل محتمل', 'Lead'), state.rows.leads.length],
              [tx('فرصة', 'Opportunity'), state.rows.opportunities.length],
              [tx('عرض سعر', 'Quotation'), quotations.length],
              [tx('طلب مبيعات', 'Sales Order'), confirmed.length],
              [tx('حجز', 'Reservation'), state.rows.reservations.length],
              [tx('تسليم', 'Delivery'), state.rows.deliveries.length],
              [tx('طلب فاتورة', 'Invoice Request'), state.rows.invoiceRequests.length],
            ].map(([label, count], index) => `<li><span>${index + 1}</span><div><strong>${label}</strong><small>${count}</small></div></li>`).join('')}
          </ol>
        </section>
        <section class="cs-card">
          <div class="cs-card-head"><div><h3>${tx('آخر طلبات المبيعات', 'Recent sales orders')}</h3><p>${tx('قراءة مباشرة من السلطة القانونية.', 'Live read from the canonical authority.')}</p></div></div>
          ${table(
            [tx('المرجع', 'Reference'), tx('العميل', 'Customer'), tx('الحالة', 'State'), tx('الإجمالي', 'Total')],
            orders.slice(0, 7).map((row) => [
              `<button class="cs-link" data-cs-order="${esc(row.id)}">${esc(row.name || row.id)}</button>`,
              esc(partyName(row.partner_id)), status(row.state), money(row.amount_total),
            ]),
            tx('لا توجد طلبات مبيعات بعد.', 'No sales orders yet.'),
          )}
        </section>
      </div>`;
  }

  function table(headers, rows, emptyLabel) {
    if (!rows.length) return emptyState(emptyLabel);
    return `<div class="cs-table-wrap"><table class="cs-table"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function partyName(id) {
    const row = state.rows.parties.find((party) => party.id === id);
    return row ? row.name : (id || '—');
  }
  function productName(id) {
    const row = state.rows.products.find((product) => product.variant_id === id || product.id === id);
    return row ? row.name : (id || '—');
  }
  function warehouseOptions() {
    return state.rows.warehouses.map((row) => `<option value="${esc(row.id)}">${esc(row.name)} · ${esc(row.code || '')}</option>`).join('');
  }
  function partyOptions() {
    return state.rows.parties.map((row) => `<option value="${esc(row.id)}">${esc(row.name)}</option>`).join('');
  }
  function productOptions() {
    return state.rows.products.map((row) => `<option value="${esc(row.variant_id)}" data-uom="${esc(row.uom_id)}" data-price="${esc(row.list_price)}">${esc(row.name)} · ${esc(row.sku || '')}</option>`).join('');
  }
  function priceListOptions() {
    return state.rows.priceLists.map((row) => `<option value="${esc(row.id)}">${esc(row.name)} · ${esc(row.currency_id || '')}</option>`).join('');
  }

  function renderLeads() {
    return `
      <section class="cs-card">
        <div class="cs-card-head"><div><h3>${tx('إنشاء عميل محتمل', 'Create lead')}</h3><p>${tx('ينشأ عبر crm:lead:create.', 'Executes crm:lead:create.')}</p></div></div>
        <form class="cs-form cs-form-inline" data-cs-form="lead">
          <label><span>${tx('الاسم', 'Name')}</span><input name="name" required></label>
          <label><span>${tx('الإيراد المتوقع', 'Expected revenue')}</span><input name="expected_revenue" type="number" min="0" step="0.01" value="0"></label>
          <label><span>${tx('الاحتمالية %', 'Probability %')}</span><input name="probability" type="number" min="0" max="100" value="20"></label>
          <button type="submit" ${state.busy ? 'disabled' : ''}><i class="fa-solid fa-plus"></i>${tx('إنشاء', 'Create')}</button>
        </form>
      </section>
      <section class="cs-card">
        <div class="cs-card-head"><div><h3>${tx('العملاء المحتملون', 'Leads')}</h3><p>${tx('نشاطات المتابعة مرتبطة بالسجل القانوني.', 'Follow-up activities remain linked to the canonical record.')}</p></div></div>
        ${table(
          [tx('الاسم', 'Name'), tx('المرحلة', 'Stage'), tx('القيمة', 'Value'), tx('الاحتمالية', 'Probability'), tx('الإجراء', 'Action')],
          state.rows.leads.map((row) => [
            esc(row.name), status(row.stage), money(row.expected_revenue), `${Number(row.probability || 0)}%`,
            row.stage === 'won' || !state.rows.parties.length ? '—' : `<button class="cs-small" data-cs-convert-lead="${esc(row.id)}"><i class="fa-solid fa-arrow-right-arrow-left"></i>${tx('تحويل لفرصة', 'Convert')}</button>`,
          ]),
          tx('لا يوجد عملاء محتملون.', 'No leads found.'),
        )}
      </section>`;
  }

  function renderOpportunities() {
    const stages = ['qualification', 'proposal', 'negotiation'];
    return `<section class="cs-card">
      <div class="cs-card-head"><div><h3>${tx('خط الفرص', 'Opportunity pipeline')}</h3><p>${tx('تغيير المرحلة والإغلاق يسجلان نشاطاً وتدقيقاً.', 'Stage changes and close outcomes write activity and audit history.')}</p></div></div>
      ${table(
        [tx('الفرصة', 'Opportunity'), tx('العميل', 'Customer'), tx('المرحلة', 'Stage'), tx('الحالة', 'Status'), tx('القيمة', 'Value'), tx('الإجراءات', 'Actions')],
        state.rows.opportunities.map((row) => [
          esc(row.name), esc(partyName(row.party_id)), status(row.stage), status(row.status), money(row.expected_value),
          row.status !== 'open' ? '—' : `<div class="cs-actions">
            ${stages.filter((s) => s !== row.stage).map((s) => `<button class="cs-small" data-cs-stage="${s}" data-cs-opportunity="${esc(row.id)}">${esc(s)}</button>`).join('')}
            <button class="cs-small" data-cs-opportunity-activity="${esc(row.id)}"><i class="fa-solid fa-calendar-plus"></i>${tx('متابعة', 'Follow-up')}</button>
            <button class="cs-small cs-success" data-cs-close-opportunity="${esc(row.id)}">${tx('فوز', 'Won')}</button>
            <button class="cs-small cs-danger" data-cs-lose-opportunity="${esc(row.id)}">${tx('خسارة', 'Lost')}</button>
          </div>`,
        ]),
        tx('لا توجد فرص.', 'No opportunities found.'),
      )}
    </section>`;
  }

  function renderQuotations() {
    const quotations = state.rows.orders.filter((row) => row.state === 'draft' || row.quotation_state);
    return `
      ${warehousePicker()}
      <section class="cs-card">
        <div class="cs-card-head"><div><h3>${tx('عرض سعر جديد', 'New quotation')}</h3><p>${tx('المنتج والعميل من السلطات القانونية الحالية.', 'Customer and product are selected from canonical authorities.')}</p></div></div>
        <form class="cs-form" data-cs-form="quotation">
          <label><span>${tx('العميل', 'Customer')}</span><select name="partner_id" required><option value="">—</option>${partyOptions()}</select></label>
          <label><span>${tx('قائمة الأسعار', 'Price list')}</span><select name="pricelist_id"><option value="">—</option>${priceListOptions()}</select></label>
          <label><span>${tx('المنتج', 'Product')}</span><select name="product_id" required><option value="">—</option>${productOptions()}</select></label>
          <label><span>${tx('الكمية', 'Quantity')}</span><input name="quantity" type="number" min="0.0001" step="0.0001" value="1" required></label>
          <label><span>${tx('السعر', 'Unit price')}</span><input name="price_unit" type="number" min="0" step="0.01" value="0" required></label>
          <label><span>${tx('الخصم %', 'Discount %')}</span><input name="discount" type="number" min="0" max="100" step="0.01" value="0"></label>
          <label><span>${tx('صالح حتى', 'Valid until')}</span><input name="validity_date" type="date"></label>
          <label><span>${tx('مرجع المشروع', 'Project reference')}</span><input name="project_ref" placeholder="PRJ-001"></label>
          <label class="cs-span-two"><span>${tx('المرفقات (مفصولة بفاصلة)', 'Attachments (comma-separated)')}</span><input name="attachments" placeholder="proposal.pdf, https://example.test/spec"></label>
          <label class="cs-span-two"><span>${tx('ملاحظات وتعليقات', 'Notes and comments')}</span><textarea name="notes" rows="2"></textarea></label>
          <button type="submit" ${state.busy ? 'disabled' : ''}><i class="fa-solid fa-file-circle-plus"></i>${tx('إنشاء العرض', 'Create quotation')}</button>
        </form>
      </section>
      <section class="cs-card">
        <div class="cs-card-head"><div><h3>${tx('عروض الأسعار', 'Quotations')}</h3><p>${tx('مسودة ← مرسل ← معتمد ← مقبول.', 'Draft → Sent → Approved → Accepted.')}</p></div></div>
        ${table(
          [tx('المرجع', 'Reference'), tx('العميل', 'Customer'), tx('الحالة', 'State'), tx('المراجعة', 'Revision'), tx('الإجمالي', 'Total'), tx('الصلاحية', 'Validity'), tx('الإجراءات', 'Actions')],
          quotations.map((row) => [
            `<button class="cs-link" data-cs-order="${esc(row.id)}">${esc(row.name || row.id)}</button>`,
            esc(partyName(row.partner_id)), status(row.quotation_state || row.state), String(row.revision_no || 1),
            money(row.amount_total), date(row.validity_date), quotationActions(row),
          ]),
          tx('لا توجد عروض أسعار.', 'No quotations found.'),
        )}
      </section>`;
  }

  function quotationActions(row) {
    if (row.state === 'sale') return '—';
    const buttons = [];
    if (row.quotation_state === 'draft') buttons.push(actionButton('submit-quotation', row.id, tx('إرسال', 'Submit')));
    if (row.quotation_state === 'sent') buttons.push(actionButton('approve-quotation', row.id, tx('اعتماد', 'Approve')));
    if (row.quotation_state === 'approved') {
      buttons.push(actionButton('accept-quotation', row.id, tx('قبول', 'Accept'), 'cs-success'));
      buttons.push(actionButton('revise-quotation', row.id, tx('مراجعة', 'Revise')));
    }
    if (row.quotation_state === 'accepted') buttons.push(actionButton('confirm-order', row.id, tx('تأكيد الطلب', 'Confirm order'), 'cs-success'));
    return `<div class="cs-actions">${buttons.join('')}</div>`;
  }

  function actionButton(action, id, label, css) {
    return `<button class="cs-small ${css || ''}" data-cs-action-row="${action}" data-cs-id="${esc(id)}">${esc(label)}</button>`;
  }

  function renderOrders() {
    const rows = state.rows.orders.filter((row) => row.state === 'sale' || row.state === 'cancel');
    return `${warehousePicker()}<section class="cs-card">
      <div class="cs-card-head"><div><h3>${tx('طلبات المبيعات', 'Sales orders')}</h3><p>${tx('التأكيد والحجز ضمن معاملة واحدة؛ التسليم يستخدم المخزون القانوني.', 'Confirmation and reservation are atomic; delivery uses canonical Inventory.')}</p></div></div>
      ${table(
        [tx('المرجع', 'Reference'), tx('العميل', 'Customer'), tx('الحالة', 'State'), tx('الإجمالي', 'Total'), tx('التسليم/الفاتورة', 'Delivery / invoice'), tx('الإجراءات', 'Actions')],
        rows.map((row) => [
          `<button class="cs-link" data-cs-order="${esc(row.id)}">${esc(row.name || row.id)}</button>`,
          esc(partyName(row.partner_id)), status(row.state), money(row.amount_total),
          `${state.rows.deliveries.filter((d) => deliveryMatches(d, row.id)).length} / ${state.rows.invoiceRequests.filter((r) => r.source_document_id === row.id).length}`,
          row.state === 'cancel' ? '—' : `<div class="cs-actions">
            ${actionButton('reserve-order', row.id, tx('حجز', 'Reserve'))}
            ${actionButton('deliver-order', row.id, tx('تسليم', 'Deliver'), 'cs-success')}
            ${actionButton('invoice-order', row.id, tx('طلب فاتورة', 'Invoice request'))}
            ${actionButton('return-order', row.id, tx('مرتجع', 'Return'))}
            ${actionButton('cancel-order', row.id, tx('إلغاء', 'Cancel'), 'cs-danger')}
          </div>`,
        ]),
        tx('لا توجد طلبات مؤكدة.', 'No confirmed sales orders found.'),
      )}
      ${state.selectedOrderId ? renderOrderDrawer() : ''}
    </section>`;
  }

  function deliveryMatches(delivery, orderId) {
    return delivery.sale_order_id === orderId || delivery.origin === orderId || delivery.reference === orderId;
  }

  function renderOrderDrawer() {
    const row = state.rows.orders.find((order) => order.id === state.selectedOrderId);
    if (!row) return '';
    const lines = Array.isArray(row.lines) ? row.lines : [];
    return `<aside class="cs-drawer">
      <div class="cs-card-head"><div><h3>${esc(row.name || row.id)}</h3><p>${esc(partyName(row.partner_id))} · ${status(row.state)} · ${money(row.amount_total)}</p></div><button class="cs-icon-btn" data-cs-action="close-order"><i class="fa-solid fa-xmark"></i></button></div>
      ${table(
        [tx('المنتج', 'Product'), tx('الكمية', 'Quantity'), tx('السعر', 'Price'), tx('الخصم', 'Discount'), tx('الضريبة', 'Tax'), tx('الإجمالي', 'Total')],
        lines.map((line) => [esc(productName(line.product_id)), money(line.product_uom_qty), money(line.price_unit), `${Number(line.discount || 0)}%`, money(line.tax_amount), money(line.price_total)]),
        tx('لا توجد بنود.', 'No order lines.'),
      )}
      <div class="cs-meta-grid">
        <span><b>${tx('تاريخ الطلب', 'Order date')}</b>${date(row.order_date)}</span>
        <span><b>${tx('صالح حتى', 'Valid until')}</b>${date(row.validity_date)}</span>
        <span><b>${tx('الملاحظات', 'Notes')}</b>${esc(row.notes || '—')}</span>
        <span><b>${tx('مصدر الفرصة', 'Opportunity source')}</b>${esc(row.source_opportunity_id || '—')}</span>
        <span><b>${tx('مرجع المشروع', 'Project reference')}</b>${esc(row.project_ref || '—')}</span>
        <span><b>${tx('المرفقات', 'Attachments')}</b>${(row.attachments || []).length ? row.attachments.map((item) => esc(typeof item === 'string' ? item : (item.name || item.url || JSON.stringify(item)))).join('<br>') : '—'}</span>
        <span><b>${tx('الإيراد / التكلفة / الهامش', 'Revenue / cost / margin')}</b>${money(row.profitability && row.profitability.revenue)} / ${money(row.profitability && row.profitability.cost)} / ${money(row.profitability && row.profitability.margin)}</span>
        <span><b>${tx('الرصيد والمدفوعات', 'Balance and payments')}</b><button class="cs-link" data-cs-finance-link="${esc(row.partner_id)}">${tx('فتح المالية', 'Open Finance')}</button></span>
      </div>
      <h4>${tx('السجل الزمني', 'Timeline')}</h4>
      ${table(
        [tx('الإجراء', 'Action'), tx('الفاعل', 'Actor'), tx('الوقت', 'Time')],
        (row.timeline || []).map((item) => [esc(item.action_id || item.action || '—'), esc(item.actor_id || item.actor || '—'), date(item.occurred_at || item.created_at)]),
        tx('لا توجد أحداث مسجلة.', 'No recorded events.'),
      )}
    </aside>`;
  }

  function renderReservations() {
    return `<section class="cs-card"><div class="cs-card-head"><div><h3>${tx('حجوزات المخزون', 'Stock reservations')}</h3><p>${tx('قراءة من سلطة المخزون، دون حساب في المتصفح.', 'Read from Inventory authority; the browser computes no availability.')}</p></div></div>${table(
      [tx('الطلب', 'Order'), tx('المنتج', 'Product'), tx('الحالة', 'State'), tx('المحجوز', 'Reserved'), tx('المستهلك', 'Consumed'), tx('الموقع', 'Location')],
      state.rows.reservations.map((row) => [esc(row.source_document_id), esc(productName(row.product_id)), status(row.status), money(row.quantity), money(row.consumed_quantity), esc(row.location_id)]),
      tx('لا توجد حجوزات.', 'No reservations found.'),
    )}</section>`;
  }

  function renderDeliveries() {
    return `<section class="cs-card"><div class="cs-card-head"><div><h3>${tx('التسليمات', 'Deliveries')}</h3><p>${tx('حركات المخزون القانونية المرتبطة بطلبات المبيعات.', 'Canonical stock pickings linked to sales orders.')}</p></div></div>${table(
      [tx('المرجع', 'Reference'), tx('الأصل', 'Origin'), tx('الحالة', 'State'), tx('من', 'From'), tx('إلى', 'To'), tx('التاريخ', 'Date')],
      state.rows.deliveries.map((row) => [esc(row.reference || row.id), esc(row.origin || row.sale_order_id || '—'), status(row.state), esc(row.location_id), esc(row.location_dest_id), date(row.created_at)]),
      tx('لا توجد تسليمات.', 'No deliveries found.'),
    )}</section>`;
  }

  function renderReturns() {
    return `<section class="cs-card"><div class="cs-card-head"><div><h3>${tx('مرتجعات العملاء', 'Customer returns')}</h3><p>${tx('المرتجع يعيد المخزون ويطلب إشعاراً دائناً عند وجود فاتورة.', 'A return restores stock and posts a credit-note request when an invoice exists.')}</p></div></div>${table(
      [tx('المرجع', 'Reference'), tx('طلب المبيعات', 'Sales order'), tx('الحالة', 'State'), tx('السبب', 'Reason'), tx('طلب الإشعار', 'Credit note request'), tx('التاريخ', 'Date')],
      state.rows.returns.map((row) => [esc(row.id), esc(row.sale_order_id), status(row.state), esc(row.reason), esc(row.credit_note_request_id || '—'), date(row.created_at)]),
      tx('لا توجد مرتجعات.', 'No returns found.'),
    )}</section>`;
  }

  function renderInvoiceRequests() {
    return `<section class="cs-card"><div class="cs-card-head"><div><h3>${tx('طلبات الفواتير', 'Invoice requests')}</h3><p>${tx('الوثيقة المالية تبقى ضمن سلطة المالية في المرحلة 03.', 'Fiscal documents remain owned by Phase 03 Finance.')}</p></div></div>${table(
      [tx('المرجع', 'Reference'), tx('النوع', 'Type'), tx('المصدر', 'Source'), tx('الحالة', 'State'), tx('الوثيقة المالية', 'Finance document'), tx('التاريخ', 'Date')],
      state.rows.invoiceRequests.map((row) => [esc(row.id), esc(row.request_type), esc(row.source_document_id), status(row.status), esc(row.finance_document_id || '—'), date(row.created_at)]),
      tx('لا توجد طلبات فواتير.', 'No invoice requests found.'),
    )}</section>`;
  }

  function renderBalances() {
    const grouped = new Map();
    state.rows.balances.forEach((row) => {
      const key = row.partner_id || 'unknown';
      const current = grouped.get(key) || { count: 0, residual: 0, overdue: 0 };
      current.count += 1;
      current.residual += Number(row.residual_amount || row.open_amount || 0);
      if (row.due_date && new Date(row.due_date) < new Date()) current.overdue += Number(row.residual_amount || row.open_amount || 0);
      grouped.set(key, current);
    });
    return `<section class="cs-card"><div class="cs-card-head"><div><h3>${tx('أرصدة العملاء', 'Customer balances')}</h3><p>${tx('عناصر الذمم المفتوحة من المالية القانونية.', 'Open receivable items from canonical Finance.')}</p></div></div>${table(
      [tx('العميل', 'Customer'), tx('العناصر المفتوحة', 'Open items'), tx('الرصيد', 'Balance'), tx('المتأخر', 'Overdue')],
      [...grouped.entries()].map(([id, summary]) => [esc(partyName(id)), String(summary.count), money(summary.residual), money(summary.overdue)]),
      tx('لا توجد ذمم مفتوحة.', 'No open receivable items.'),
    )}</section>`;
  }

  function renderReports() {
    const reports = [
      ['pipeline', tx('خط الطلبات', 'Order pipeline')],
      ['by-customer', tx('المبيعات حسب العميل', 'Sales by customer')],
      ['by-product', tx('المبيعات حسب المنتج', 'Sales by product')],
      ['conversion', tx('تحويل العروض', 'Quotation conversion')],
      ['margin', tx('الهامش', 'Margin')],
      ['returns', tx('المرتجعات', 'Returns')],
      ['overdue-deliveries', tx('التسليمات المتأخرة', 'Overdue deliveries')],
      ['customer-balances', tx('أرصدة العملاء', 'Customer balances')],
    ];
    const reportRows = state.rows.report || [];
    const keys = reportRows.length ? Object.keys(reportRows[0]).filter((key) => !/(_id$|^id$)/.test(key)).slice(0, 8) : [];
    return `<section class="cs-card">
      <div class="cs-card-head"><div><h3>${tx('تقارير المبيعات القانونية', 'Canonical Sales reports')}</h3><p>${tx('تجميعات من حقائق الطلبات والمخزون والمالية.', 'Aggregates over Sales, Inventory and Finance facts.')}</p></div></div>
      <div class="cs-report-tabs">${reports.map(([key, label]) => `<button class="${state.report === key ? 'active' : ''}" data-cs-report="${key}">${esc(label)}</button>`).join('')}</div>
      ${keys.length ? table(keys.map((key) => key.replace(/_/g, ' ')), reportRows.map((row) => keys.map((key) => typeof row[key] === 'number' ? money(row[key]) : esc(row[key]))), tx('لا توجد بيانات للتقرير.', 'No report rows.')) : emptyState(tx('لا توجد بيانات للتقرير.', 'No report rows.'))}
    </section>`;
  }

  function renderActive() {
    switch (state.active) {
      case 'leads': return renderLeads();
      case 'opportunities': return renderOpportunities();
      case 'quotations': return renderQuotations();
      case 'orders': return renderOrders();
      case 'reservations': return renderReservations();
      case 'deliveries': return renderDeliveries();
      case 'returns': return renderReturns();
      case 'invoice-requests': return renderInvoiceRequests();
      case 'balances': return renderBalances();
      case 'reports': return renderReports();
      default: return renderDashboard();
    }
  }

  async function refresh(options) {
    const api = client();
    if (!api) {
      state.error = tx('طبقة العميل القانونية غير محمّلة.', 'Canonical client layer is not loaded.');
      state.loading = false;
      shell();
      return;
    }
    state.loading = !(options && options.silent);
    state.error = null;
    shell();
    try {
      const [
        leads, opportunities, orders, reservations, deliveries, returns,
        invoiceRequests, balances, parties, products, warehouses, commissions, priceLists,
      ] = await Promise.all([
        api.sales.listLeads(), api.sales.listOpportunities(), api.sales.listOrders(),
        api.sales.listReservations(), api.sales.listDeliveries(), api.sales.listReturns(),
        api.sales.listInvoiceRequests(), api.sales.listCustomerBalances(),
        api.parties.list({ role: 'customer' }), api.products.list(), api.warehouses.list(),
        api.sales.listCommissions(), api.sales.listPriceLists(),
      ]);
      Object.assign(state.rows, {
        leads, opportunities, orders, reservations, deliveries, returns,
        invoiceRequests, balances, parties, products, warehouses, commissions, priceLists,
      });
      if (!warehouses.some((row) => row.id === state.selectedWarehouseId)) {
        state.selectedWarehouseId = warehouses[0] ? warehouses[0].id : null;
      }
      if (state.selectedOrderId) {
        const detail = await api.sales.getOrder(state.selectedOrderId).catch(() => null);
        if (detail) {
          const index = state.rows.orders.findIndex((row) => row.id === detail.id);
          if (index >= 0) state.rows.orders[index] = detail;
        }
      }
      if (state.active === 'reports') state.rows.report = await api.sales.report(state.report);
    } catch (error) {
      state.error = normalizeError(error);
    } finally {
      state.loading = false;
      shell();
    }
  }

  async function command(label, work) {
    if (state.busy) return;
    state.busy = true;
    state.notice = null;
    state.error = null;
    shell();
    try {
      await work();
      state.notice = label;
      showToast(label, 'success');
      await refresh({ silent: true });
    } catch (error) {
      state.error = normalizeError(error);
      showToast(state.error, error && error.isAuthorization ? 'warning' : 'error');
      shell();
    } finally {
      state.busy = false;
    }
  }

  async function selectOrder(id) {
    state.selectedOrderId = id;
    const api = client();
    try {
      const detail = await api.sales.getOrder(id);
      const index = state.rows.orders.findIndex((row) => row.id === id);
      if (index >= 0) state.rows.orders[index] = detail;
    } catch (error) {
      state.error = normalizeError(error);
    }
    shell();
  }

  function warehousePicker() {
    return `<section class="cs-context">
      <label><span><i class="fa-solid fa-warehouse"></i>${tx('مستودع التنفيذ', 'Execution warehouse')}</span>
        <select data-cs-warehouse>
          ${state.rows.warehouses.map((row) => `<option value="${esc(row.id)}" ${row.id === state.selectedWarehouseId ? 'selected' : ''}>${esc(row.name || row.code || row.id)}</option>`).join('')}
        </select>
      </label>
      <small>${tx('يُستخدم للحجز والتسليم والمرتجعات.', 'Used for reservation, delivery, and returns.')}</small>
    </section>`;
  }

  function firstWarehouseId() {
    return state.selectedWarehouseId || (state.rows.warehouses[0] ? state.rows.warehouses[0].id : null);
  }

  async function rowAction(actionName, id) {
    const api = client();
    const warehouseId = firstWarehouseId();
    const labels = {
      'submit-quotation': tx('تم إرسال عرض السعر.', 'Quotation submitted.'),
      'approve-quotation': tx('تم اعتماد عرض السعر.', 'Quotation approved.'),
      'accept-quotation': tx('تم قبول عرض السعر.', 'Quotation accepted.'),
      'revise-quotation': tx('تم إنشاء مراجعة جديدة.', 'Quotation revision created.'),
      'confirm-order': tx('تم تأكيد الطلب وحجز المخزون.', 'Order confirmed and stock reserved.'),
      'reserve-order': tx('تم تحديث حجز الطلب.', 'Order reservation refreshed.'),
      'deliver-order': tx('تم تسليم الطلب عبر المخزون القانوني.', 'Order delivered through canonical Inventory.'),
      'invoice-order': tx('تم إنشاء طلب الفاتورة.', 'Invoice request created.'),
      'return-order': tx('تم إنشاء مرتجع العميل.', 'Customer return created.'),
      'cancel-order': tx('تم إلغاء الطلب.', 'Order cancelled.'),
    };
    await command(labels[actionName] || tx('تم الإجراء.', 'Action completed.'), async () => {
      if (actionName === 'submit-quotation') return api.sales.submitQuotation({ order_id: id });
      if (actionName === 'approve-quotation') return api.sales.approveQuotation({ order_id: id });
      if (actionName === 'accept-quotation') return api.sales.acceptQuotation({ order_id: id });
      if (actionName === 'revise-quotation') return api.sales.reviseQuotation({ order_id: id });
      if (actionName === 'confirm-order') {
        if (!warehouseId) throw new Error(tx('يجب إنشاء مستودع أولاً.', 'Create a warehouse first.'));
        return api.sales.confirmOrder({ order_id: id, warehouse_id: warehouseId });
      }
      if (actionName === 'reserve-order') {
        if (!warehouseId) throw new Error(tx('يجب إنشاء مستودع أولاً.', 'Create a warehouse first.'));
        return api.sales.reserveOrder({ order_id: id, warehouse_id: warehouseId });
      }
      if (actionName === 'invoice-order') return api.sales.createInvoiceRequest({ order_id: id });
      if (actionName === 'cancel-order') {
        const reason = root.prompt(tx('سبب الإلغاء:', 'Cancellation reason:'), tx('طلب العميل', 'Customer request'));
        if (reason === null) return null;
        return api.sales.cancelOrder({ order_id: id, reason });
      }
      const order = await api.sales.getOrder(id);
      if (actionName === 'deliver-order') {
        const deliveries = await api.sales.listDeliveries({ sale_order_id: id });
        const picking = deliveries.find((row) => !['done', 'cancelled'].includes(row.state));
        if (!picking) throw new Error(tx('لا يوجد تسليم مفتوح لهذا الطلب.', 'No open delivery exists for this order.'));
        const defaults = order.lines.map((line) => Number(line.product_uom_qty) - Number(line.delivered_quantity || 0)).join(',');
        const raw = root.prompt(
          tx('كميات التسليم حسب ترتيب البنود (مفصولة بفاصلة):', 'Delivery quantities in line order (comma-separated):'),
          defaults,
        );
        if (raw === null) return null;
        const quantities = String(raw).split(',').map((value) => Number(value.trim()));
        if (quantities.length !== order.lines.length || quantities.some((value) => !Number.isFinite(value) || value < 0)) {
          throw new Error(tx('كميات التسليم غير صالحة.', 'Delivery quantities are invalid.'));
        }
        const deliveryLines = order.lines.map((line, index) => ({
          sale_order_line_id: line.id,
          quantity: quantities[index],
        })).filter((line) => line.quantity > 0);
        if (!deliveryLines.length) throw new Error(tx('أدخل كمية تسليم واحدة على الأقل.', 'Enter at least one delivery quantity.'));
        return api.sales.postDelivery({
          order_id: id,
          picking_id: picking.id,
          lines: deliveryLines,
        });
      }
      if (actionName === 'return-order') {
        if (!warehouseId) throw new Error(tx('يجب إنشاء مستودع أولاً.', 'Create a warehouse first.'));
        const line = order.lines[0];
        if (!line) throw new Error(tx('الطلب بلا بنود.', 'The order has no lines.'));
        const raw = root.prompt(tx('كمية المرتجع للبند الأول:', 'Return quantity for the first line:'), '1');
        if (raw === null) return null;
        return api.sales.createReturn({
          order_id: id,
          warehouse_id: warehouseId,
          reason: tx('مرتجع عميل من واجهة المبيعات', 'Customer return from Sales workspace'),
          lines: [{ sale_order_line_id: line.id, quantity: Number(raw), reason: tx('مرتجع عميل', 'Customer return') }],
        });
      }
      throw new Error(`Unknown Sales action: ${actionName}`);
    });
  }

  function bind(el) {
    el.querySelectorAll('[data-cs-tab]').forEach((button) => {
      button.addEventListener('click', async () => {
        state.active = button.dataset.csTab;
        state.notice = null;
        if (state.active === 'reports') {
          state.loading = true;
          shell();
          try { state.rows.report = await client().sales.report(state.report); }
          catch (error) { state.error = normalizeError(error); }
          finally { state.loading = false; shell(); }
        } else shell();
      });
    });
    el.querySelectorAll('[data-cs-action="refresh"]').forEach((button) => button.addEventListener('click', () => refresh()));
    el.querySelectorAll('[data-cs-warehouse]').forEach((select) => select.addEventListener('change', () => {
      state.selectedWarehouseId = select.value || null;
    }));
    const close = el.querySelector('[data-cs-action="close-order"]');
    if (close) close.addEventListener('click', () => { state.selectedOrderId = null; shell(); });
    el.querySelectorAll('[data-cs-order]').forEach((button) => button.addEventListener('click', () => selectOrder(button.dataset.csOrder)));
    el.querySelectorAll('[data-cs-finance-link]').forEach((button) => button.addEventListener('click', () => {
      if (typeof root.switchPage === 'function') root.switchPage('finance');
    }));
    el.querySelectorAll('[data-cs-action-row]').forEach((button) => button.addEventListener('click', () => rowAction(button.dataset.csActionRow, button.dataset.csId)));
    el.querySelectorAll('[data-cs-report]').forEach((button) => {
      button.addEventListener('click', async () => {
        state.report = button.dataset.csReport;
        state.loading = true;
        shell();
        try { state.rows.report = await client().sales.report(state.report); }
        catch (error) { state.error = normalizeError(error); }
        finally { state.loading = false; shell(); }
      });
    });
    const leadForm = el.querySelector('[data-cs-form="lead"]');
    if (leadForm) leadForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(leadForm);
      command(tx('تم إنشاء العميل المحتمل.', 'Lead created.'), () => client().sales.createLead({
        name: form.get('name'),
        expected_revenue: Number(form.get('expected_revenue') || 0),
        probability: Number(form.get('probability') || 0),
      }));
    });
    const quotationForm = el.querySelector('[data-cs-form="quotation"]');
    if (quotationForm) {
      const product = quotationForm.elements.product_id;
      product.addEventListener('change', () => {
        const option = product.options[product.selectedIndex];
        quotationForm.elements.price_unit.value = option ? Number(option.dataset.price || 0) : 0;
      });
      quotationForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const form = new FormData(quotationForm);
        const productRow = state.rows.products.find((row) => row.variant_id === form.get('product_id'));
        command(tx('تم إنشاء عرض السعر.', 'Quotation created.'), () => client().sales.createQuotation({
          partner_id: form.get('partner_id'),
          pricelist_id: form.get('pricelist_id') || null,
          validity_date: form.get('validity_date') || null,
          project_ref: form.get('project_ref') || null,
          notes: form.get('notes') || '',
          attachments: String(form.get('attachments') || '').split(',').map((value) => value.trim()).filter(Boolean),
          lines: [{
            product_id: form.get('product_id'),
            product_uom: productRow ? productRow.uom_id : '',
            product_uom_qty: Number(form.get('quantity')),
            price_unit: Number(form.get('price_unit')),
            discount: Number(form.get('discount') || 0),
          }],
        }));
      });
    }
    el.querySelectorAll('[data-cs-convert-lead]').forEach((button) => {
      button.addEventListener('click', () => {
        const party = state.rows.parties[0];
        if (!party) {
          state.error = tx('أنشئ عميلاً قانونياً قبل تحويل العميل المحتمل.', 'Create a canonical customer before converting the lead.');
          shell();
          return;
        }
        command(tx('تم تحويل العميل المحتمل إلى فرصة.', 'Lead converted to opportunity.'), () => client().sales.convertLead({
          id: button.dataset.csConvertLead,
          partner_id: party.id,
        }));
      });
    });
    el.querySelectorAll('[data-cs-opportunity]').forEach((button) => button.addEventListener('click', () => command(
      tx('تم تحديث مرحلة الفرصة.', 'Opportunity stage updated.'),
      () => client().sales.updateOpportunityStage({ id: button.dataset.csOpportunity, stage: button.dataset.csStage }),
    )));
    el.querySelectorAll('[data-cs-opportunity-activity]').forEach((button) => button.addEventListener('click', () => {
      const summary = root.prompt(tx('ملخص المتابعة:', 'Follow-up summary:'), tx('متابعة العميل', 'Customer follow-up'));
      if (summary === null || !String(summary).trim()) return;
      const dueDate = root.prompt(tx('تاريخ الاستحقاق (YYYY-MM-DD، اختياري):', 'Due date (YYYY-MM-DD, optional):'), '');
      if (dueDate === null) return;
      command(
        tx('تمت إضافة نشاط المتابعة.', 'Follow-up activity added.'),
        () => client().sales.addOpportunityActivity({
          id: button.dataset.csOpportunityActivity,
          summary: String(summary).trim(),
          due_date: String(dueDate || '').trim() || null,
        }),
      );
    }));
    el.querySelectorAll('[data-cs-close-opportunity]').forEach((button) => button.addEventListener('click', () => command(
      tx('تم إغلاق الفرصة كفوز.', 'Opportunity closed as won.'),
      () => client().sales.closeOpportunity({ id: button.dataset.csCloseOpportunity, outcome: 'won', spawn_quotation: false }),
    )));
    el.querySelectorAll('[data-cs-lose-opportunity]').forEach((button) => button.addEventListener('click', () => command(
      tx('تم إغلاق الفرصة كخسارة.', 'Opportunity closed as lost.'),
      () => client().sales.closeOpportunity({ id: button.dataset.csLoseOpportunity, outcome: 'lost', spawn_quotation: false }),
    )));
  }

  function activate() {
    shell();
    refresh();
  }

  const previousRender = root.renderSalesCrmPage;
  root.renderSalesCrmPage = function renderCanonicalSales() {
    activate();
  };
  root.CanonicalSales = {
    activate,
    refresh,
    state,
    TABS: tabs.map(([key, ar, en, icon]) => ({ key, label: { ar, en }, icon })),
    previousRender,
    selectTab(key) { state.active = key; shell(); },
  };

  if (document.getElementById('pageSales') && getComputedStyle(document.getElementById('pageSales')).display !== 'none') {
    activate();
  }
})(window);
