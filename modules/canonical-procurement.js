(function (root) {
  'use strict';

  // Checkpoint C2: final visible Procurement writer. All commands travel
  // through CanonicalClient and ActionExecutor; the legacy local writer retires.
  root.__canonicalProcurementAuthorityActive = true;

  const state = {
    active: 'dashboard',
    report: 'by-supplier',
    selectedWarehouseId: null,
    selectedRfqId: null,
    selectedOrderId: null,
    loading: false,
    busy: false,
    error: null,
    notice: null,
    rows: {
      requests: [], requisitions: [], rfqs: [], quotations: [], orders: [],
      receipts: [], qualityChecks: [], matches: [], mismatches: [], billRequests: [],
      returns: [], commitments: [], performance: [], suppliers: [], products: [],
      warehouses: [], report: [],
    },
  };

  const tabs = [
    ['dashboard', 'لوحة المشتريات', 'Procurement Dashboard', 'fa-chart-line'],
    ['requests', 'طلبات الشراء', 'Purchase Requests', 'fa-file-circle-plus'],
    ['requisitions', 'الاحتياجات', 'Requisitions', 'fa-clipboard-check'],
    ['rfqs', 'طلبات التسعير', 'RFQs', 'fa-envelope-open-text'],
    ['supplier-quotations', 'عروض الموردين', 'Supplier Quotations', 'fa-tags'],
    ['comparison', 'المقارنة', 'Comparison', 'fa-scale-balanced'],
    ['orders', 'أوامر الشراء', 'Purchase Orders', 'fa-cart-flatbed'],
    ['receipts', 'الاستلامات', 'Receipts', 'fa-dolly'],
    ['three-way-match', 'المطابقة الثلاثية', 'Three-Way Match', 'fa-diagram-project'],
    ['bill-requests', 'طلبات فواتير الموردين', 'Supplier Bill Requests', 'fa-file-invoice'],
    ['returns', 'مرتجعات الموردين', 'Returns', 'fa-arrow-rotate-left'],
    ['supplier-performance', 'أداء الموردين', 'Supplier Performance', 'fa-ranking-star'],
    ['reports', 'تقارير المشتريات', 'Procurement Reports', 'fa-chart-column'],
  ];

  function api() { return root.CanonicalClient || null; }
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
    return new Intl.NumberFormat(isArabic() ? 'ar-IQ' : 'en-US', { maximumFractionDigits: 2 }).format(Number(value || 0));
  }
  function date(value) {
    if (!value) return '—';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? esc(value) : parsed.toLocaleDateString(isArabic() ? 'ar-IQ' : 'en-GB');
  }
  function status(value) {
    const key = String(value || 'unknown');
    return `<span class="cp-badge cp-state-${esc(key.replace(/[^a-z0-9_-]/gi, '-'))}">${esc(key)}</span>`;
  }
  function host() { return document.getElementById('pageProcurement') || document.getElementById('procurementBody'); }
  function normalizeError(error) {
    if (!error) return tx('حدث خطأ غير معروف.', 'An unknown error occurred.');
    if (error.isAuthorization) return tx('لا تملك صلاحية تنفيذ هذا الإجراء.', 'You are not authorized to perform this action.');
    return error.code ? `${error.code}: ${error.message}` : (error.message || String(error));
  }
  function toast(message, kind) {
    if (typeof root.showToast === 'function') root.showToast(message, kind || 'info');
  }
  function empty(message) { return `<div class="cp-empty"><i class="fa-regular fa-folder-open"></i><p>${esc(message)}</p></div>`; }
  function table(headers, rows, emptyMessage) {
    if (!rows.length) return empty(emptyMessage);
    return `<div class="cp-table-wrap"><table class="cp-table"><thead><tr>${headers.map((header) => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell == null ? '—' : cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function supplierName(id) {
    return state.rows.suppliers.find((row) => row.id === id)?.name || id || '—';
  }
  function productName(id) {
    return state.rows.products.find((row) => row.variant_id === id || row.id === id)?.name || id || '—';
  }
  function supplierOptions() {
    return state.rows.suppliers.map((row) => `<option value="${esc(row.id)}">${esc(row.name)}</option>`).join('');
  }
  function productOptions() {
    return state.rows.products.map((row) => `<option value="${esc(row.variant_id)}">${esc(row.name)} · ${esc(row.sku || '')}</option>`).join('');
  }
  function warehousePicker() {
    return `<section class="cp-context"><label><span><i class="fa-solid fa-warehouse"></i> ${tx('مستودع التنفيذ', 'Execution warehouse')}</span><select data-cp-warehouse>${state.rows.warehouses.map((row) => `<option value="${esc(row.id)}" ${row.id === state.selectedWarehouseId ? 'selected' : ''}>${esc(row.name || row.code || row.id)}</option>`).join('')}</select></label><small>${tx('يستخدم للاستلام والمرتجعات فقط؛ المخزون يبقى السلطة القانونية.', 'Used for receipts and returns; Inventory remains the canonical authority.')}</small></section>`;
  }

  function dashboard() {
    const openCommitments = state.rows.commitments.filter((row) => row.state === 'open').reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const openOrders = state.rows.orders.filter((row) => ['approved', 'purchase'].includes(row.state) && !row.closed_at).length;
    return `<div class="cp-kpis">
      <div class="cp-kpi"><b>${state.rows.requests.filter((row) => ['draft', 'submitted'].includes(row.state)).length}</b><span>${tx('طلبات مفتوحة', 'Open requests')}</span></div>
      <div class="cp-kpi"><b>${openOrders}</b><span>${tx('أوامر قيد التنفيذ', 'Orders in progress')}</span></div>
      <div class="cp-kpi"><b>${money(openCommitments)}</b><span>${tx('الالتزامات المفتوحة', 'Open commitments')}</span></div>
      <div class="cp-kpi"><b>${state.rows.mismatches.length}</b><span>${tx('استثناءات المطابقة', 'Match exceptions')}</span></div>
    </div>
    <section class="cp-card"><div class="cp-card-head"><div><h3>${tx('دورة الشراء القانونية', 'Canonical procurement path')}</h3><p>${tx('كل انتقال يكتب التدقيق وصندوق الصادر ضمن نفس المعاملة.', 'Every transition writes audit and outbox in the same transaction.')}</p></div></div>
    ${table(
      [tx('المرحلة', 'Stage'), tx('الحالة الحالية', 'Current facts'), tx('السلطة', 'Authority')],
      [
        [tx('طلب ← احتياج', 'Request → Requisition'), String(state.rows.requests.length), 'Procurement'],
        [tx('RFQ ← مقارنة', 'RFQ → Comparison'), `${state.rows.rfqs.length} / ${state.rows.quotations.length}`, 'Procurement'],
        [tx('أمر ← استلام', 'Order → Receipt'), `${state.rows.orders.length} / ${state.rows.receipts.length}`, 'Inventory'],
        [tx('مطابقة ← فاتورة', 'Match → Bill'), `${state.rows.matches.length} / ${state.rows.billRequests.length}`, 'Finance'],
      ],
      tx('لا توجد حقائق بعد.', 'No facts yet.'),
    )}</section>`;
  }

  function requests() {
    return `<section class="cp-card"><div class="cp-card-head"><div><h3>${tx('طلب شراء جديد', 'New purchase request')}</h3><p>${tx('المنتج ووحدة القياس من السلطات القانونية الحالية.', 'Product and UOM come from current canonical authorities.')}</p></div></div>
      <form class="cp-form" data-cp-form="request">
        <label><span>${tx('العنوان', 'Title')}</span><input name="name" required></label>
        <label><span>${tx('المنتج', 'Product')}</span><select name="product_id" required><option value="">—</option>${productOptions()}</select></label>
        <label><span>${tx('الكمية', 'Quantity')}</span><input name="quantity" type="number" min="0.0001" step="0.0001" value="1" required></label>
        <label><span>${tx('التكلفة التقديرية', 'Estimated unit cost')}</span><input name="estimated_unit_cost" type="number" min="0" step="0.01" value="0"></label>
        <label><span>${tx('مطلوب قبل', 'Needed by')}</span><input name="needed_by" type="date"></label>
        <label><span>${tx('فحص جودة', 'Quality required')}</span><select name="quality_required"><option value="0">${tx('لا', 'No')}</option><option value="1">${tx('نعم', 'Yes')}</option></select></label>
        <label class="cp-span-two"><span>${tx('المرفقات (بفاصلة)', 'Attachments (comma-separated)')}</span><input name="attachments"></label>
        <label><span>${tx('المبرر والتعليقات', 'Justification and comments')}</span><textarea name="comments"></textarea></label>
        <button type="submit" ${state.busy ? 'disabled' : ''}>${tx('إنشاء الطلب', 'Create request')}</button>
      </form></section>
      <section class="cp-card"><div class="cp-card-head"><div><h3>${tx('طلبات الشراء', 'Purchase requests')}</h3></div></div>${table(
        [tx('المرجع', 'Reference'), tx('العنوان', 'Title'), tx('الحالة', 'State'), tx('المطلوب', 'Needed'), tx('الإجراءات', 'Actions')],
        state.rows.requests.map((row) => [
          esc(row.id), esc(row.name), status(row.state), date(row.needed_by),
          `<div class="cp-actions">${row.state === 'draft' ? action('submit-request', row.id, tx('إرسال', 'Submit')) : ''}${row.state === 'submitted' ? action('approve-request', row.id, tx('اعتماد وتحويل', 'Approve & convert'), 'cp-success') : ''}</div>`,
        ]),
        tx('لا توجد طلبات شراء.', 'No purchase requests.'),
      )}</section>`;
  }

  function requisitions() {
    return `<section class="cp-card"><div class="cp-card-head"><div><h3>${tx('الاحتياجات والاعتمادات', 'Requisitions and approvals')}</h3><p>${tx('تتحول الطلبات المعتمدة إلى احتياجات قابلة للإرسال للموردين.', 'Approved requests become requisitions ready for supplier sourcing.')}</p></div></div>${table(
      [tx('المرجع', 'Reference'), tx('العنوان', 'Name'), tx('الحالة', 'State'), tx('المطلوب', 'Needed'), tx('الإجراء', 'Action')],
      state.rows.requisitions.map((row) => [esc(row.id), esc(row.name), status(row.state), date(row.needed_by), row.state === 'draft' ? action('approve-requisition', row.id, tx('اعتماد', 'Approve'), 'cp-success') : '—']),
      tx('لا توجد احتياجات.', 'No requisitions.'),
    )}</section>`;
  }

  function rfqs() {
    const approvedOptions = state.rows.requisitions.filter((row) => row.state === 'approved').map((row) => `<option value="${esc(row.id)}">${esc(row.name)}</option>`).join('');
    return `<section class="cp-card"><div class="cp-card-head"><div><h3>${tx('إنشاء RFQ متعدد الموردين', 'Create multi-supplier RFQ')}</h3></div></div>
      <form class="cp-form" data-cp-form="rfq">
        <label><span>${tx('الاحتياج المعتمد', 'Approved requisition')}</span><select name="requisition_id" required><option value="">—</option>${approvedOptions}</select></label>
        <label><span>${tx('العنوان', 'Name')}</span><input name="name" required></label>
        <label><span>${tx('آخر موعد', 'Response deadline')}</span><input name="deadline" type="date"></label>
        <label class="cp-span-two"><span>${tx('الموردون (اختر عدة)', 'Suppliers (select multiple)')}</span><select name="supplier_ids" multiple required>${supplierOptions()}</select></label>
        <label><span>${tx('تعليقات', 'Comments')}</span><textarea name="comments"></textarea></label>
        <button type="submit">${tx('إصدار RFQ', 'Issue RFQ')}</button>
      </form></section>
      <section class="cp-card"><div class="cp-card-head"><div><h3>RFQs</h3></div></div>${table(
        [tx('المرجع', 'Reference'), tx('العنوان', 'Name'), tx('الحالة', 'State'), tx('الموعد', 'Deadline'), tx('المقارنة', 'Comparison')],
        state.rows.rfqs.map((row) => [esc(row.id), esc(row.name), status(row.state), date(row.deadline), `<button class="cp-small" data-cp-select-rfq="${esc(row.id)}">${tx('فتح', 'Open')}</button>`]),
        tx('لا توجد RFQs.', 'No RFQs.'),
      )}</section>`;
  }

  function supplierQuotations() {
    const issued = state.rows.rfqs.filter((row) => ['issued', 'awarded'].includes(row.state));
    return `<section class="cp-card"><div class="cp-card-head"><div><h3>${tx('تسجيل عرض مورد', 'Record supplier quotation')}</h3><p>${tx('تسجل حقائق السعر والضريبة والمهلة والتسليم على مستوى البند.', 'Price, tax, lead time, and delivery are recorded at line level.')}</p></div></div>
      <form class="cp-form" data-cp-form="supplier-quotation">
        <label><span>RFQ</span><select name="rfq_id" required><option value="">—</option>${issued.map((row) => `<option value="${esc(row.id)}">${esc(row.name)}</option>`).join('')}</select></label>
        <label><span>${tx('المورد', 'Supplier')}</span><select name="supplier_id" required><option value="">—</option>${supplierOptions()}</select></label>
        <label><span>${tx('سعر الوحدة', 'Unit price')}</span><input name="unit_price" type="number" min="0" step="0.01" required></label>
        <label><span>${tx('الضريبة', 'Tax')}</span><input name="tax_amount" type="number" min="0" step="0.01" value="0"></label>
        <label><span>${tx('مهلة التوريد (يوم)', 'Lead time (days)')}</span><input name="lead_time_days" type="number" min="0" value="0"></label>
        <label><span>${tx('التسليم', 'Delivery date')}</span><input name="delivery_date" type="date"></label>
        <label class="cp-span-two"><span>${tx('المرفقات (بفاصلة)', 'Attachments (comma-separated)')}</span><input name="attachments"></label>
        <label><span>${tx('تعليقات', 'Comments')}</span><textarea name="comments"></textarea></label>
        <button type="submit">${tx('تسجيل العرض', 'Record quotation')}</button>
      </form></section>
      <section class="cp-card"><div class="cp-card-head"><div><h3>${tx('عروض الموردين', 'Supplier quotations')}</h3></div></div>${table(
        [tx('المرجع', 'Reference'), tx('المورد', 'Supplier'), tx('الإجمالي', 'Total'), tx('الضريبة', 'Tax'), tx('المهلة', 'Lead'), tx('الحالة', 'State'), tx('إجراء', 'Action')],
        state.rows.quotations.map((row) => [
          esc(row.id), esc(supplierName(row.supplier_id)), money(row.total_amount), money(row.tax_amount), `${Number(row.lead_time_days || 0)}d`, status(row.state),
          row.is_awarded ? `<button class="cp-small cp-success" data-cp-quote-to-order="${esc(row.id)}">${tx('إنشاء أمر', 'Create PO')}</button>` : action('award-quotation', row.id, tx('اختيار', 'Award')),
        ]),
        tx('لا توجد عروض موردين.', 'No supplier quotations.'),
      )}</section>`;
  }

  function comparison() {
    const rfqId = state.selectedRfqId || state.rows.rfqs[0]?.id;
    const rows = state.rows.quotations.filter((row) => !rfqId || row.rfq_id === rfqId).slice().sort((a, b) => Number(a.total_amount) - Number(b.total_amount) || Number(a.lead_time_days) - Number(b.lead_time_days));
    return `<section class="cp-card"><div class="cp-card-head"><div><h3>${tx('مقارنة خطية لعروض الموردين', 'Line-by-line supplier comparison')}</h3><p>${tx('الترتيب حسب الإجمالي ثم مهلة التسليم؛ تظهر الضريبة والتاريخ بشكل مستقل.', 'Ranked by total then lead time, with tax and delivery visible separately.')}</p></div><select data-cp-comparison-rfq>${state.rows.rfqs.map((row) => `<option value="${esc(row.id)}" ${row.id === rfqId ? 'selected' : ''}>${esc(row.name)}</option>`).join('')}</select></div>${table(
      [tx('الترتيب', 'Rank'), tx('المورد', 'Supplier'), tx('السعر', 'Price'), tx('الضريبة', 'Tax'), tx('الإجمالي', 'Total'), tx('المهلة', 'Lead'), tx('التسليم', 'Delivery'), tx('الإجراء', 'Action')],
      rows.map((row, index) => [String(index + 1), esc(supplierName(row.supplier_id)), money(Number(row.total_amount) - Number(row.tax_amount || 0)), money(row.tax_amount), money(row.total_amount), `${Number(row.lead_time_days || 0)}d`, date(row.delivery_date), row.is_awarded ? status('awarded') : action('award-quotation', row.id, tx('اختيار', 'Award'))]),
      tx('لا توجد عروض للمقارنة.', 'No quotations to compare.'),
    )}</section>`;
  }

  function action(name, id, label, css) {
    return `<button class="cp-small ${css || ''}" data-cp-row-action="${name}" data-cp-id="${esc(id)}">${esc(label)}</button>`;
  }
  function orderMatches(row, id) { return row.purchase_order_id === id || row.source_document_id === id; }

  function orders() {
    return `${warehousePicker()}<section class="cp-card"><div class="cp-card-head"><div><h3>${tx('أوامر الشراء والالتزامات', 'Purchase orders and commitments')}</h3></div></div>${table(
      [tx('المرجع', 'Reference'), tx('المورد', 'Supplier'), tx('الحالة', 'State'), tx('الإجمالي', 'Total'), tx('استلام/مطابقة', 'Receipt / match'), tx('الإجراءات', 'Actions')],
      state.rows.orders.map((row) => [
        `<button class="cp-link" data-cp-order="${esc(row.id)}">${esc(row.name || row.id)}</button>`,
        esc(supplierName(row.supplier_id)), status(row.state), money(row.amount_total),
        `${state.rows.receipts.filter((item) => orderMatches(item, row.id)).length} / ${state.rows.matches.filter((item) => orderMatches(item, row.id)).length}`,
        `<div class="cp-actions">${row.state === 'draft' ? action('approve-order', row.id, tx('اعتماد', 'Approve')) : ''}${row.state === 'approved' ? action('confirm-order', row.id, tx('تأكيد', 'Confirm'), 'cp-success') : ''}${row.state === 'purchase' ? action('receive-order', row.id, tx('استلام', 'Receive'), 'cp-success') + action('match-order', row.id, tx('مطابقة', 'Match')) + action('bill-order', row.id, tx('طلب فاتورة', 'Bill request')) + action('return-order', row.id, tx('مرتجع', 'Return')) + action('score-order', row.id, tx('تقييم', 'Score')) : ''}</div>`,
      ]),
      tx('لا توجد أوامر شراء.', 'No purchase orders.'),
    )}${state.selectedOrderId ? orderDrawer() : ''}</section>`;
  }

  function orderDrawer() {
    const row = state.rows.orders.find((order) => order.id === state.selectedOrderId);
    if (!row) return '';
    return `<section class="cp-card" style="margin-top:16px"><div class="cp-card-head"><div><h3>${esc(row.name || row.id)}</h3><p>${esc(supplierName(row.supplier_id))} · ${status(row.state)} · ${money(row.amount_total)}</p></div><button class="cp-small" data-cp-close-order>×</button></div>
      ${table([tx('المنتج', 'Product'), tx('المطلوب', 'Ordered'), tx('المستلم', 'Received'), tx('المفوتر', 'Billed'), tx('السعر', 'Price'), tx('الإجمالي', 'Total')], (row.lines || []).map((line) => [esc(productName(line.product_id)), money(line.product_qty), money(line.received_quantity), money(line.billed_quantity), money(line.price_unit), money(line.price_total || line.price_subtotal)]), tx('لا توجد بنود.', 'No lines.'))}
      <div class="cp-kpis" style="margin-top:14px"><div class="cp-kpi"><span>${tx('التسليم المتوقع', 'Expected')}</span><b style="font-size:18px">${date(row.expected_date)}</b></div><div class="cp-kpi"><span>${tx('الجودة', 'Quality')}</span><b style="font-size:18px">${row.quality_required ? tx('مطلوبة', 'Required') : tx('قياسية', 'Standard')}</b></div><div class="cp-kpi"><span>${tx('المرفقات', 'Attachments')}</span><b style="font-size:14px">${(row.attachments || []).map((item) => esc(item)).join('<br>') || '—'}</b></div><div class="cp-kpi"><span>${tx('المدفوعات والرصيد', 'Payments and balance')}</span><button class="cp-link" data-cp-finance-link>${tx('فتح المالية', 'Open Finance')}</button></div></div>
      <h4>${tx('السجل الزمني', 'Timeline')}</h4>${table([tx('الإجراء', 'Action'), tx('الفاعل', 'Actor'), tx('الوقت', 'Time')], (row.timeline || []).map((item) => [esc(item.action), esc(item.actor_id), date(item.occurred_at)]), tx('لا توجد أحداث.', 'No events.'))}
    </section>`;
  }

  function receipts() {
    return `<section class="cp-card"><div class="cp-card-head"><div><h3>${tx('الاستلامات وفحوص الجودة', 'Receipts and quality checks')}</h3></div></div>${table(
      [tx('المرجع', 'Reference'), tx('الأمر', 'Order'), tx('الحالة', 'State'), tx('المرتجع الخلفي', 'Backorder'), tx('التاريخ', 'Date')],
      state.rows.receipts.map((row) => [esc(row.reference || row.id), esc(row.purchase_order_id), status(row.state), esc(row.backorder_picking_id || '—'), date(row.created_at)]),
      tx('لا توجد استلامات.', 'No receipts.'),
    )}<h4>${tx('فحوص الجودة', 'Quality checks')}</h4>${table(
      [tx('البند', 'Order line'), tx('مفحوص', 'Inspected'), tx('مقبول', 'Accepted'), tx('مرفوض', 'Rejected'), tx('الحالة', 'State')],
      state.rows.qualityChecks.map((row) => [esc(row.purchase_order_line_id), money(row.inspected_quantity), money(row.accepted_quantity), money(row.rejected_quantity), status(row.status)]),
      tx('لا توجد فحوص جودة.', 'No quality checks.'),
    )}</section>`;
  }

  function matches() {
    return `<section class="cp-card"><div class="cp-card-head"><div><h3>${tx('المطابقة الثلاثية وقائمة الفروقات', 'Three-way match and mismatch worklist')}</h3></div></div>${table(
      [tx('المرجع', 'Reference'), tx('الأمر', 'Order'), tx('الحالة', 'State'), tx('الاستثناءات', 'Exceptions'), tx('الملاحظات', 'Notes')],
      state.rows.matches.map((row) => [esc(row.id), esc(row.purchase_order_id), status(row.match_status), String(row.exception_count || 0), esc(row.notes)]),
      tx('لا توجد مطابقات.', 'No matches.'),
    )}<h4>${tx('قائمة معالجة الفروقات', 'Mismatch worklist')}</h4>${table(
      [tx('الأمر', 'Order'), tx('الكود', 'Code'), tx('متوقع', 'Expected'), tx('فعلي', 'Actual'), tx('الحالة', 'Status')],
      state.rows.mismatches.map((row) => [esc(row.purchase_order_id), esc(row.exception_code), esc(row.expected_value), esc(row.actual_value), status(row.approval_status)]),
      tx('لا توجد فروقات معلقة.', 'No pending variances.'),
    )}</section>`;
  }

  function billRequests() {
    return `<section class="cp-card"><div class="cp-card-head"><div><h3>${tx('طلبات فواتير الموردين وروابط الدفع', 'Supplier bill requests and payment links')}</h3></div></div>${table(
      [tx('المرجع', 'Reference'), tx('النوع', 'Type'), tx('المصدر', 'Source'), tx('الحالة', 'State'), tx('وثيقة المالية', 'Finance document'), tx('الدفع', 'Payment')],
      state.rows.billRequests.map((row) => [esc(row.id), esc(row.request_type), esc(row.source_document_id), status(row.status), esc(row.finance_document_id || '—'), `<button class="cp-link" data-cp-finance-link>${tx('فتح المالية', 'Open Finance')}</button>`]),
      tx('لا توجد طلبات فواتير.', 'No supplier bill requests.'),
    )}</section>`;
  }

  function returnsView() {
    return `<section class="cp-card"><div class="cp-card-head"><div><h3>${tx('مرتجعات الموردين وطلبات إشعار الخصم', 'Supplier returns and debit-note requests')}</h3></div></div>${table(
      [tx('المرجع', 'Reference'), tx('الأمر', 'Order'), tx('الحالة', 'State'), tx('السبب', 'Reason'), tx('إشعار الخصم', 'Debit note'), tx('التاريخ', 'Date')],
      state.rows.returns.map((row) => [esc(row.id), esc(row.purchase_order_id), status(row.state), esc(row.reason), esc(row.debit_note_request_id || '—'), date(row.created_at)]),
      tx('لا توجد مرتجعات.', 'No supplier returns.'),
    )}</section>`;
  }

  function performance() {
    return `<section class="cp-card"><div class="cp-card-head"><div><h3>${tx('بطاقات أداء الموردين', 'Supplier performance scorecards')}</h3><p>${tx('الالتزام والجودة والسعر من الحقائق القانونية.', 'Delivery, quality, and price scores derive from canonical facts.')}</p></div></div>${table(
      [tx('المورد', 'Supplier'), tx('الالتزام', 'On-time'), tx('الجودة', 'Quality'), tx('السعر', 'Price'), tx('الإجمالي', 'Overall'), tx('التاريخ', 'Date')],
      state.rows.performance.map((row) => [esc(row.supplier_name || supplierName(row.supplier_id)), `${money(row.on_time_score)}%`, `${money(row.quality_score)}%`, `${money(row.price_score)}%`, `${money(row.overall_score)}%`, date(row.created_at)]),
      tx('لا توجد بطاقات أداء.', 'No supplier scorecards.'),
    )}</section>`;
  }

  function reports() {
    const definitions = [
      ['by-supplier', tx('المشتريات حسب المورد', 'Purchases by supplier')],
      ['open-commitments', tx('الالتزامات المفتوحة', 'Open commitments')],
      ['overdue-receipts', tx('الاستلامات المتأخرة', 'Overdue receipts')],
      ['supplier-price-comparison', tx('مقارنة أسعار الموردين', 'Supplier price comparison')],
      ['match-variances', tx('فروقات المطابقة', 'Match variances')],
      ['supplier-performance', tx('أداء الموردين', 'Supplier performance')],
      ['return-rates', tx('معدلات المرتجعات', 'Return rates')],
    ];
    const rows = state.rows.report || [];
    const keys = rows.length ? Object.keys(rows[0]).filter((key) => !/(^id$)/.test(key)).slice(0, 8) : [];
    return `<section class="cp-card"><div class="cp-card-head"><div><h3>${tx('تقارير المشتريات القانونية', 'Canonical Procurement reports')}</h3></div></div><div class="cp-report-tabs">${definitions.map(([key, label]) => `<button class="${state.report === key ? 'active' : ''}" data-cp-report="${key}">${esc(label)}</button>`).join('')}</div>${keys.length ? table(keys.map((key) => key.replace(/_/g, ' ')), rows.map((row) => keys.map((key) => typeof row[key] === 'number' ? money(row[key]) : esc(row[key]))), tx('لا توجد بيانات.', 'No report rows.')) : empty(tx('لا توجد بيانات.', 'No report rows.'))}</section>`;
  }

  function activeView() {
    if (state.active === 'requests') return requests();
    if (state.active === 'requisitions') return requisitions();
    if (state.active === 'rfqs') return rfqs();
    if (state.active === 'supplier-quotations') return supplierQuotations();
    if (state.active === 'comparison') return comparison();
    if (state.active === 'orders') return orders();
    if (state.active === 'receipts') return receipts();
    if (state.active === 'three-way-match') return matches();
    if (state.active === 'bill-requests') return billRequests();
    if (state.active === 'returns') return returnsView();
    if (state.active === 'supplier-performance') return performance();
    if (state.active === 'reports') return reports();
    return dashboard();
  }

  function shell() {
    const target = host();
    if (!target) return;
    target.innerHTML = `<div data-cp-workspace>
      <section class="cp-hero"><div><div class="cp-eyebrow">Octagon ERP · Canonical procure-to-pay</div><h1>${tx('المشتريات', 'Procurement')}</h1><p>${tx('من طلب الشراء إلى الاستلام والمطابقة وفاتورة المورد.', 'Request-to-receipt execution with canonical Inventory and Finance.')}</p></div><div class="cp-trust"><i class="fa-solid fa-shield-halved"></i>${tx('هوية ونطاق من الخادم', 'Server-derived identity and scope')}</div></section>
      <nav class="cp-tabs">${tabs.map(([key, ar, en, icon]) => `<button class="cp-tab ${state.active === key ? 'active' : ''}" data-cp-tab="${key}"><i class="fa-solid ${icon}"></i>${tx(ar, en)}</button>`).join('')}</nav>
      ${state.notice ? `<div class="cp-notice">${esc(state.notice)}</div>` : ''}
      ${state.error ? `<div class="cp-state cp-error"><strong>${tx('تعذر تنفيذ المشتريات', 'Procurement could not continue')}</strong><p>${esc(state.error)}</p><button class="cp-small" data-cp-refresh>${tx('إعادة المحاولة', 'Retry')}</button></div>` : state.loading ? `<div class="cp-state cp-loading"><i class="fa-solid fa-circle-notch fa-spin"></i>${tx('جاري تحميل حقائق المشتريات القانونية…', 'Loading canonical Procurement facts…')}</div>` : activeView()}
    </div>`;
    bind(target);
  }

  async function refresh(options) {
    const client = api();
    if (!client) {
      state.error = tx('طبقة العميل القانونية غير محملة.', 'Canonical client is not loaded.');
      shell();
      return;
    }
    state.loading = !(options && options.silent);
    state.error = null;
    shell();
    try {
      const values = await Promise.all([
        client.procurement.listRequests(), client.procurement.listRequisitions(),
        client.procurement.listRfqs(), client.procurement.listSupplierQuotations(),
        client.procurement.listOrders(), client.procurement.listReceipts(),
        client.procurement.listQualityChecks(), client.procurement.listMatches(),
        client.procurement.listMismatches(), client.procurement.listBillRequests(),
        client.procurement.listReturns(), client.procurement.listCommitments(),
        client.procurement.listSupplierPerformance(), client.parties.list({ role: 'supplier' }),
        client.products.list(), client.warehouses.list(),
      ]);
      const keys = ['requests', 'requisitions', 'rfqs', 'quotations', 'orders', 'receipts', 'qualityChecks', 'matches', 'mismatches', 'billRequests', 'returns', 'commitments', 'performance', 'suppliers', 'products', 'warehouses'];
      keys.forEach((key, index) => { state.rows[key] = values[index]; });
      if (!state.rows.warehouses.some((row) => row.id === state.selectedWarehouseId)) state.selectedWarehouseId = state.rows.warehouses[0]?.id || null;
      if (!state.selectedRfqId) state.selectedRfqId = state.rows.rfqs[0]?.id || null;
      if (state.selectedOrderId) {
        const detail = await client.procurement.getOrder(state.selectedOrderId).catch(() => null);
        const index = state.rows.orders.findIndex((row) => row.id === state.selectedOrderId);
        if (detail && index >= 0) state.rows.orders[index] = detail;
      }
      if (state.active === 'reports') state.rows.report = await client.procurement.report(state.report);
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
    state.error = null;
    state.notice = null;
    shell();
    try {
      const result = await work();
      if (result !== null) {
        state.notice = label;
        toast(label, 'success');
      }
      await refresh({ silent: true });
    } catch (error) {
      state.error = normalizeError(error);
      toast(state.error, error?.isAuthorization ? 'warning' : 'error');
      shell();
    } finally {
      state.busy = false;
    }
  }

  async function selectOrder(id) {
    state.selectedOrderId = id;
    const detail = await api().procurement.getOrder(id).catch((error) => { state.error = normalizeError(error); return null; });
    const index = state.rows.orders.findIndex((row) => row.id === id);
    if (detail && index >= 0) state.rows.orders[index] = detail;
    shell();
  }

  async function rowAction(name, id) {
    const client = api();
    const labels = {
      'submit-request': tx('تم إرسال طلب الشراء.', 'Purchase request submitted.'),
      'approve-request': tx('تم اعتماد الطلب وتحويله.', 'Request approved and converted.'),
      'approve-requisition': tx('تم اعتماد الاحتياج.', 'Requisition approved.'),
      'award-quotation': tx('تم اختيار عرض المورد.', 'Supplier quotation awarded.'),
      'approve-order': tx('تم اعتماد أمر الشراء وتسجيل الالتزام.', 'Purchase order approved and committed.'),
      'confirm-order': tx('تم تأكيد أمر الشراء وإنشاء الاستلام.', 'Purchase order confirmed and receipt created.'),
      'receive-order': tx('تم استلام أمر الشراء عبر المخزون القانوني.', 'Purchase receipt posted through canonical Inventory.'),
      'match-order': tx('تم تشغيل المطابقة الثلاثية.', 'Three-way match completed.'),
      'bill-order': tx('تم إنشاء طلب فاتورة المورد.', 'Supplier bill request created.'),
      'return-order': tx('تم إنشاء مرتجع المورد.', 'Supplier return created.'),
      'score-order': tx('تم تسجيل بطاقة أداء المورد.', 'Supplier performance scorecard recorded.'),
    };
    await command(labels[name] || tx('تم الإجراء.', 'Action completed.'), async () => {
      if (name === 'submit-request') return client.procurement.submitRequest({ request_id: id });
      if (name === 'approve-request') return client.procurement.approveRequest({ request_id: id });
      if (name === 'approve-requisition') return client.procurement.approveRequisition({ requisition_id: id });
      if (name === 'award-quotation') return client.procurement.awardSupplierQuotation({ quotation_id: id });
      if (name === 'approve-order') return client.procurement.approveOrder({ order_id: id });
      if (name === 'confirm-order') {
        if (!state.selectedWarehouseId) throw new Error(tx('أنشئ مستودعاً أولاً.', 'Create a warehouse first.'));
        return client.procurement.confirmOrder({ order_id: id, warehouse_id: state.selectedWarehouseId });
      }
      const order = await client.procurement.getOrder(id);
      if (name === 'receive-order') {
        const defaults = order.lines.map((line) => Number(line.product_qty) - Number(line.received_quantity || 0)).join(',');
        const raw = root.prompt(tx('كميات الاستلام حسب ترتيب البنود:', 'Receipt quantities in line order:'), defaults);
        if (raw === null) return null;
        const quantities = String(raw).split(',').map((value) => Number(value.trim()));
        const receiptLines = order.lines.map((line, index) => ({ purchase_order_line_id: line.id, quantity: quantities[index], accepted_quantity: quantities[index], rejected_quantity: 0 })).filter((line) => line.quantity > 0);
        if (!receiptLines.length || quantities.some((value) => !Number.isFinite(value) || value < 0)) throw new Error(tx('كميات الاستلام غير صالحة.', 'Receipt quantities are invalid.'));
        return client.procurement.postReceipt({ purchase_order_id: id, lines: receiptLines });
      }
      if (name === 'match-order') {
        const invoice = root.prompt(tx('رقم فاتورة المورد:', 'Supplier invoice number:'), `SUP-${Date.now().toString().slice(-6)}`);
        if (invoice === null) return null;
        return client.procurement.threeWayMatch({
          purchase_order_id: id,
          supplier_invoice_number: invoice,
          bill_lines: order.lines.map((line) => ({
            purchase_order_line_id: line.id,
            quantity: Number(line.received_quantity || 0),
            unit_price: Number(line.price_unit),
            currency: order.currency_id,
          })),
        });
      }
      if (name === 'bill-order') return client.procurement.createBillRequest({ purchase_order_id: id });
      if (name === 'return-order') {
        const line = order.lines[0];
        const raw = root.prompt(tx('كمية المرتجع للبند الأول:', 'Return quantity for the first line:'), '1');
        if (raw === null) return null;
        return client.procurement.createReturn({ purchase_order_id: id, warehouse_id: state.selectedWarehouseId, reason: tx('مرتجع من واجهة المشتريات', 'Return from Procurement workspace'), lines: [{ purchase_order_line_id: line.id, quantity: Number(raw) }] });
      }
      if (name === 'score-order') {
        const raw = root.prompt(tx('درجة الالتزام بالتسليم من 0 إلى 100:', 'On-time delivery score from 0 to 100:'), '95');
        if (raw === null) return null;
        const onTimeScore = Number(raw);
        if (!Number.isFinite(onTimeScore) || onTimeScore < 0 || onTimeScore > 100) {
          throw new Error(tx('درجة الالتزام يجب أن تكون بين 0 و100.', 'On-time score must be between 0 and 100.'));
        }
        return client.procurement.recordSupplierScore({
          supplier_id: order.supplier_id,
          purchase_order_id: id,
          on_time_score: onTimeScore,
          notes: tx('تقييم من واجهة المشتريات', 'Score from Procurement workspace'),
        });
      }
      throw new Error(`Unknown procurement action: ${name}`);
    });
  }

  function bind(target) {
    target.querySelectorAll('[data-cp-tab]').forEach((button) => button.addEventListener('click', async () => {
      state.active = button.dataset.cpTab;
      state.notice = null;
      if (state.active === 'reports') {
        state.loading = true; shell();
        try { state.rows.report = await api().procurement.report(state.report); } catch (error) { state.error = normalizeError(error); }
        finally { state.loading = false; shell(); }
      } else shell();
    }));
    target.querySelectorAll('[data-cp-refresh]').forEach((button) => button.addEventListener('click', () => refresh()));
    target.querySelectorAll('[data-cp-warehouse]').forEach((select) => select.addEventListener('change', () => { state.selectedWarehouseId = select.value || null; }));
    target.querySelectorAll('[data-cp-row-action]').forEach((button) => button.addEventListener('click', () => rowAction(button.dataset.cpRowAction, button.dataset.cpId)));
    target.querySelectorAll('[data-cp-select-rfq]').forEach((button) => button.addEventListener('click', () => { state.selectedRfqId = button.dataset.cpSelectRfq; state.active = 'comparison'; shell(); }));
    const compare = target.querySelector('[data-cp-comparison-rfq]');
    if (compare) compare.addEventListener('change', () => { state.selectedRfqId = compare.value; shell(); });
    target.querySelectorAll('[data-cp-order]').forEach((button) => button.addEventListener('click', () => selectOrder(button.dataset.cpOrder)));
    target.querySelectorAll('[data-cp-close-order]').forEach((button) => button.addEventListener('click', () => { state.selectedOrderId = null; shell(); }));
    target.querySelectorAll('[data-cp-finance-link]').forEach((button) => button.addEventListener('click', () => { if (typeof root.switchPage === 'function') root.switchPage('finance'); }));
    target.querySelectorAll('[data-cp-report]').forEach((button) => button.addEventListener('click', async () => {
      state.report = button.dataset.cpReport; state.loading = true; shell();
      try { state.rows.report = await api().procurement.report(state.report); } catch (error) { state.error = normalizeError(error); }
      finally { state.loading = false; shell(); }
    }));

    const requestForm = target.querySelector('[data-cp-form="request"]');
    if (requestForm) requestForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(requestForm);
      const product = state.rows.products.find((row) => row.variant_id === form.get('product_id'));
      command(tx('تم إنشاء طلب الشراء.', 'Purchase request created.'), () => api().procurement.createRequest({
        name: form.get('name'),
        needed_by: form.get('needed_by') || null,
        justification: form.get('comments') || '',
        comments: form.get('comments') || '',
        attachments: String(form.get('attachments') || '').split(',').map((value) => value.trim()).filter(Boolean),
        lines: [{
          product_id: form.get('product_id'),
          quantity: Number(form.get('quantity')),
          uom_id: product?.uom_id || '',
          estimated_unit_cost: Number(form.get('estimated_unit_cost') || 0),
          quality_required: form.get('quality_required') === '1',
        }],
      }));
    });
    const rfqForm = target.querySelector('[data-cp-form="rfq"]');
    if (rfqForm) rfqForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(rfqForm);
      command(tx('تم إصدار RFQ.', 'RFQ issued.'), () => api().procurement.createRfq({
        requisition_id: form.get('requisition_id'),
        name: form.get('name'),
        deadline: form.get('deadline') || null,
        supplier_ids: form.getAll('supplier_ids'),
        comments: form.get('comments') || '',
      }));
    });
    const quoteForm = target.querySelector('[data-cp-form="supplier-quotation"]');
    if (quoteForm) quoteForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(quoteForm);
      const rfq = await api().procurement.getRfq(form.get('rfq_id')).catch((error) => { state.error = normalizeError(error); shell(); return null; });
      if (!rfq?.lines?.[0]) return;
      command(tx('تم تسجيل عرض المورد.', 'Supplier quotation recorded.'), () => api().procurement.recordSupplierQuotation({
        rfq_id: rfq.id,
        supplier_id: form.get('supplier_id'),
        lead_time_days: Number(form.get('lead_time_days') || 0),
        delivery_date: form.get('delivery_date') || null,
        attachments: String(form.get('attachments') || '').split(',').map((value) => value.trim()).filter(Boolean),
        comments: form.get('comments') || '',
        lines: [{
          rfq_line_id: rfq.lines[0].id,
          quantity: Number(rfq.lines[0].quantity),
          unit_price: Number(form.get('unit_price')),
          tax_amount: Number(form.get('tax_amount') || 0),
          lead_time_days: Number(form.get('lead_time_days') || 0),
          delivery_date: form.get('delivery_date') || null,
        }],
      }));
    });
    target.querySelectorAll('[data-cp-quote-to-order]').forEach((button) => button.addEventListener('click', async () => {
      const quote = await api().procurement.getSupplierQuotation(button.dataset.cpQuoteToOrder);
      const rfq = await api().procurement.getRfq(quote.rfq_id);
      const products = state.rows.products;
      command(tx('تم إنشاء أمر شراء من العرض المختار.', 'Purchase order created from awarded quotation.'), () => api().procurement.createOrder({
        supplier_id: quote.supplier_id,
        rfq_id: quote.rfq_id,
        selected_quotation_id: quote.id,
        expected_date: quote.delivery_date || null,
        quality_required: (rfq.lines || []).some((line) => Boolean(line.quality_required)),
        attachments: quote.attachments,
        comments: quote.comments || '',
        lines: quote.lines.map((line) => ({
          product_id: line.product_id,
          product_qty: Number(line.quantity),
          product_uom: products.find((product) => product.variant_id === line.product_id)?.uom_id || '',
          price_unit: Number(line.unit_price),
          tax_amount: Number(line.tax_amount || 0),
        })),
      }));
    }));
  }

  function activate() { shell(); refresh(); }
  const previousRender = root.renderProcurement;
  root.renderProcurement = activate;
  const previousSwitchPage = root.switchPage;
  root.switchPage = function switchPageWithCanonicalProcurement(page) {
    const result = previousSwitchPage ? previousSwitchPage.apply(this, arguments) : undefined;
    if (page === 'procurement') setTimeout(activate, 0);
    return result;
  };
  root.CanonicalProcurement = {
    activate,
    refresh,
    state,
    previousRender,
    TABS: tabs.map(([key, ar, en, icon]) => ({ key, label: { ar, en }, icon })),
    selectTab(key) { state.active = key; shell(); },
  };

  if (document.getElementById('pageProcurement') && getComputedStyle(document.getElementById('pageProcurement')).display !== 'none') activate();
})(window);
