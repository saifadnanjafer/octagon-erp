(function (root) {
  'use strict';

  // Checkpoint C3: final visible POS authority. Every mutation travels through
  // CanonicalClient -> ActionExecutor; the original localStorage POS writer is retired.
  root.__canonicalPosAuthorityActive = true;

  const tabs = [
    ['dashboard', 'لوحة POS', 'POS dashboard', 'fa-gauge-high'],
    ['sessions', 'الجلسات والصندوق', 'Sessions & cashbox', 'fa-cash-register'],
    ['catalogue', 'الكتالوج والتوفر', 'Catalogue & availability', 'fa-barcode'],
    ['cart', 'السلة والدفع', 'Cart & payments', 'fa-cart-shopping'],
    ['sales', 'المبيعات المكتملة', 'Completed sales', 'fa-receipt'],
    ['receipts', 'الإيصالات', 'Receipts', 'fa-print'],
    ['returns', 'المرتجعات والاسترداد', 'Returns & refunds', 'fa-rotate-left'],
    ['reconciliation', 'الإغلاق والمطابقة', 'Closing & reconciliation', 'fa-scale-balanced'],
    ['audit', 'التدقيق وصندوق الصادر', 'Audit & outbox', 'fa-shield-halved'],
    ['reports', 'التقارير', 'Reports', 'fa-chart-column'],
  ];

  const state = {
    active: 'dashboard',
    loading: false,
    error: null,
    notice: null,
    selectedOrderId: null,
    report: 'daily-sales',
    rows: {
      sessions: [], terminals: [], products: [], parties: [], warehouses: [],
      quants: [], orders: [], refunds: [], reconciliations: [], methods: [],
      accounts: [], audit: [], outbox: [], report: [],
    },
  };

  function api() {
    if (!root.CanonicalClient) throw new Error('CanonicalClient is unavailable');
    return root.CanonicalClient;
  }
  function lang() { return String(document.documentElement.lang || 'ar').toLowerCase().startsWith('ar') ? 'ar' : 'en'; }
  function tx(ar, en) { return lang() === 'ar' ? ar : en; }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[char]));
  }
  const escapeHtml = esc;
  function money(value) {
    return Number(value || 0).toLocaleString(lang() === 'ar' ? 'ar-IQ' : 'en-US', { maximumFractionDigits: 2 });
  }
  function date(value) {
    if (!value) return '—';
    try { return new Date(value).toLocaleString(lang() === 'ar' ? 'ar-IQ' : 'en-GB'); } catch (_) { return value; }
  }
  function host() { return document.getElementById('pagePOS') || document.getElementById('posBody'); }
  function isAuthorization(error) {
    return Number(error?.status) === 401 || Number(error?.status) === 403 ||
      /permission|forbidden|unauthori[sz]ed|denied/i.test(String(error?.message || error || ''));
  }
  function normalizeError(error) {
    if (isAuthorization(error)) return tx('لا تملك صلاحية تنفيذ هذا الإجراء.', 'You are not authorized to perform this action.');
    return String(error?.message || error || tx('حدث خطأ غير متوقع.', 'An unexpected error occurred.'));
  }
  function empty(label) { return `<div class="cpos-empty"><i class="fa-solid fa-inbox"></i><p>${esc(label)}</p></div>`; }
  function badge(value) { return `<span class="cpos-badge cpos-${esc(value || 'unknown')}">${esc(value || '—')}</span>`; }
  function openSession() { return state.rows.sessions.find((row) => row.state === 'opened') || null; }
  function productId(row) { return row.variant_id || row.id; }
  function productName(row) { return row.variant_name || row.name || productId(row); }
  function productPrice(row) { return Number(row.variant_list_price ?? row.list_price ?? 0) + Number(row.list_price_extra || 0); }
  function available(row) {
    const id = productId(row);
    return state.rows.quants.filter((quant) => quant.product_id === id).reduce((sum, quant) => sum + Number(quant.on_hand_qty ?? quant.quantity ?? quant.onHand ?? 0), 0);
  }
  function currentOrder() { return state.rows.orders.find((row) => row.id === state.selectedOrderId) || null; }

  function kpi(label, value, hint, icon) {
    return `<article class="cpos-kpi"><i class="fa-solid ${icon}"></i><div><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(hint)}</small></div></article>`;
  }
  function table(headers, rows) {
    if (!rows.length) return empty(tx('لا توجد بيانات بعد.', 'No data yet.'));
    return `<div class="cpos-table-wrap"><table><thead><tr>${headers.map((header) => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  }
  function productOptions() {
    return state.rows.products.map((row) =>
      `<option value="${esc(productId(row))}" data-price="${productPrice(row)}">${esc(productName(row))} · ${money(productPrice(row))} · ${tx('متاح', 'Available')} ${money(available(row))}</option>`).join('');
  }
  function partyOptions() {
    return state.rows.parties.map((row) => `<option value="${esc(row.id)}">${esc(row.display_name || row.name || row.id)}</option>`).join('');
  }

  function dashboard() {
    const sales = state.rows.orders.filter((row) => row.order_kind !== 'refund' && row.state === 'paid');
    const refunds = state.rows.orders.filter((row) => row.order_kind === 'refund' && row.state === 'refunded');
    const current = openSession();
    const net = sales.reduce((sum, row) => sum + Number(row.amount_total || 0), 0) -
      refunds.reduce((sum, row) => sum + Number(row.amount_total || 0), 0);
    return `<section class="cpos-stack">
      <div class="cpos-kpis">
        ${kpi(tx('حالة الجلسة', 'Session status'), current ? tx('مفتوحة', 'Open') : tx('مغلقة', 'Closed'), current?.name || tx('ابدأ جلسة تشغيل', 'Open an operating session'), 'fa-power-off')}
        ${kpi(tx('صافي المبيعات', 'Net sales'), `${money(net)} IQD`, `${sales.length} ${tx('بيع', 'sales')} · ${refunds.length} ${tx('مرتجع', 'refunds')}`, 'fa-coins')}
        ${kpi(tx('المخزون المتاح', 'Available stock'), money(state.rows.quants.reduce((sum, row) => sum + Number(row.on_hand_qty ?? row.quantity ?? 0), 0)), tx('من سجل المخزون القانوني', 'From canonical inventory ledger'), 'fa-boxes-stacked')}
        ${kpi(tx('المطابقات', 'Reconciliations'), state.rows.reconciliations.length, tx('إغلاق موثق للصندوق', 'Audited cashbox closures'), 'fa-scale-balanced')}
      </div>
      <article class="cpos-card"><header><div><h3>${tx('مسار البيع الذري', 'Atomic sale path')}</h3><p>${tx('السلة ← الدفع ← المخزون ← الضريبة/المالية ← الصندوق ← التدقيق ← صندوق الصادر ← الالتزام', 'Cart → payment → stock → tax/finance → cashbox → audit → outbox → commit')}</p></div></header>
        <div class="cpos-flow"><span>${tx('الجلسة', 'Session')}</span><b>→</b><span>${tx('الدفع المتعدد', 'Split payment')}</span><b>→</b><span>${tx('المخزون والتقييم', 'Stock & valuation')}</span><b>→</b><span>${tx('القيد المالي', 'Fiscal posting')}</span><b>→</b><span>${tx('التدقيق والصادر', 'Audit & outbox')}</span></div>
      </article>
    </section>`;
  }

  function sessions() {
    const current = openSession();
    return `<section class="cpos-grid">
      <article class="cpos-card"><header><div><h3>${tx('إعداد محطة POS', 'Configure POS terminal')}</h3><p>${tx('يربط الفرع والمخزن بصندوق مالية قانوني.', 'Binds branch and warehouse to a canonical Finance cashbox.')}</p></div></header>
        <form data-cpos-form="terminal" class="cpos-form">
          <label>${tx('اسم المحطة', 'Terminal name')}<input name="name" required value="${tx('محطة البيع الرئيسية', 'Main POS Terminal')}"></label>
          <label>${tx('المخزن', 'Warehouse')}<select name="warehouse_id" required>${state.rows.warehouses.map((row) => `<option value="${esc(row.id)}">${esc(row.name)}</option>`).join('')}</select></label>
          <label>${tx('حساب النقد', 'Cash account')}<select name="cash_account_id" required>${state.rows.accounts.map((row) => `<option value="${esc(row.id)}">${esc(row.code)} · ${esc(row.name)}</option>`).join('')}</select></label>
          <button class="cpos-primary" type="submit">${tx('تكوين المحطة والصندوق', 'Configure terminal & cashbox')}</button>
        </form>
      </article>
      <article class="cpos-card"><header><div><h3>${tx('فتح / إغلاق الجلسة', 'Open / close session')}</h3><p>${tx('لا يمكن لأمين الصندوق امتلاك أكثر من جلسة مفتوحة.', 'A cashier can own only one open session.')}</p></div></header>
        ${current ? `<div class="cpos-session-live"><span class="cpos-pulse"></span><strong>${esc(current.name)}</strong><small>${date(current.start_at)} · ${esc(current.user_id)}</small></div>
          <form data-cpos-form="close-session" class="cpos-form compact"><label>${tx('النقد المعدود', 'Counted cash')}<input type="number" step="0.01" min="0" name="counted_amount" required></label><button class="cpos-danger" type="submit">${tx('عدّ وإغلاق ومطابقة', 'Count, close & reconcile')}</button></form>`
          : `<form data-cpos-form="open-session" class="cpos-form">
              <label>${tx('المحطة', 'Terminal')}<select name="terminal_id" required>${state.rows.terminals.map((row) => `<option value="${esc(row.id)}">${esc(row.name)} · ${esc(row.warehouse_name)}</option>`).join('')}</select></label>
              <label>${tx('رصيد الافتتاح', 'Opening cash')}<input type="number" name="opening_cash" step="0.01" min="0" value="0" required></label>
              <button class="cpos-primary" type="submit">${tx('فتح الجلسة', 'Open session')}</button>
            </form>`}
      </article>
      <article class="cpos-card cpos-span"><header><div><h3>${tx('سجل الجلسات', 'Session register')}</h3></div></header>
        ${table([tx('المحطة', 'Terminal'), tx('أمين الصندوق', 'Cashier'), tx('الحالة', 'State'), tx('الافتتاح', 'Opened'), tx('التوقف', 'Closed'), tx('الفرق', 'Variance')],
          state.rows.sessions.map((row) => `<tr><td>${esc(row.name)}</td><td>${esc(row.user_id)}</td><td>${badge(row.state)}</td><td>${date(row.start_at)}</td><td>${date(row.stop_at)}</td><td>${money(row.variance)}</td></tr>`))}
      </article>
    </section>`;
  }

  function catalogue() {
    return `<section class="cpos-card"><header><div><h3>${tx('بحث الكتالوج والباركود والتوفر', 'Catalogue, barcode search & availability')}</h3><p>${tx('الأسعار من كتالوج المنتج والتوفر من سجل المخزون.', 'Pricing comes from Product catalogue; availability comes from Inventory ledger.')}</p></div><input class="cpos-search" data-cpos-search placeholder="${tx('اسم، SKU، باركود…', 'Name, SKU, barcode…')}"></header>
      <div class="cpos-products">${state.rows.products.map((row) => `<article class="cpos-product" data-cpos-product="${esc(`${productName(row)} ${row.sku || ''} ${row.barcode || ''}`.toLowerCase())}">
        <span class="cpos-stock ${available(row) <= 0 ? 'empty' : ''}">${tx('متاح', 'Available')} ${money(available(row))}</span>
        <i class="fa-solid fa-box"></i><h4>${esc(productName(row))}</h4><small>${esc(row.sku || row.barcode || productId(row))}</small><strong>${money(productPrice(row))} IQD</strong>
        <button type="button" data-cpos-add="${esc(productId(row))}">${tx('إضافة للسلة', 'Add to cart')}</button>
      </article>`).join('') || empty(tx('لا توجد منتجات.', 'No products.'))}</div>
    </section>`;
  }

  function cart() {
    const current = openSession();
    return `<section class="cpos-grid">
      <article class="cpos-card cpos-span"><header><div><h3>${tx('سلة البيع والدفع المتعدد', 'Sale cart & split payments')}</h3><p>${tx('يمكن دمج النقد والبطاقة والحساب المكوّن؛ الخادم يتحقق من المجموع والضريبة.', 'Combine cash, card, or configured account; the server verifies total and tax.')}</p></div>${current ? badge('opened') : badge('closed')}</header>
        <form data-cpos-form="sale" class="cpos-form cpos-sale-form">
          <label>${tx('العميل', 'Customer')}<select name="partner_id" required><option value="">—</option>${partyOptions()}</select></label>
          <label>${tx('المنتج / الباركود', 'Product / barcode')}<select name="product_id" required>${productOptions()}</select></label>
          <label>${tx('الكمية', 'Quantity')}<input name="qty" type="number" step="0.01" min="0.01" value="1" required></label>
          <label>${tx('الخصم %', 'Discount %')}<input name="discount" type="number" step="0.01" min="0" max="100" value="0"></label>
          <label>${tx('دفع نقدي', 'Cash payment')}<input name="cash_amount" type="number" step="0.01" min="0" value="0"></label>
          <label>${tx('دفع بطاقة', 'Card payment')}<input name="card_amount" type="number" step="0.01" min="0" value="0"></label>
          <label>${tx('دفع على الحساب', 'Account payment')}<input name="account_amount" type="number" step="0.01" min="0" value="0"></label>
          <button class="cpos-primary" type="submit" ${current ? '' : 'disabled'}>${tx('إتمام البيع الذري', 'Commit atomic sale')}</button>
        </form>
        <div class="cpos-hint">${tx('أدخل مجموع الدفعات شاملاً الضريبة. عند أي فشل تُلغى كل الآثار.', 'Enter the tax-inclusive payment total. Any failure rolls every effect back.')}</div>
      </article>
    </section>`;
  }

  function sales(receiptsOnly) {
    const rows = state.rows.orders.filter((row) => row.order_kind !== 'refund');
    return `<section class="cpos-card"><header><div><h3>${receiptsOnly ? tx('الإيصالات المالية', 'Fiscal receipts') : tx('المبيعات المكتملة', 'Completed sales')}</h3><p>${tx('إيصال ← دفع ← حركة مخزون ← مستند مالية.', 'Receipt → payment → stock movement → Finance document.')}</p></div></header>
      ${table([tx('الإيصال', 'Receipt'), tx('الجلسة', 'Session'), tx('العميل', 'Customer'), tx('الإجمالي', 'Total'), tx('الضريبة', 'Tax'), tx('الحالة', 'State'), tx('إجراء', 'Action')],
        rows.map((row) => `<tr><td>${esc(row.receipt_number || row.name)}</td><td>${esc(row.session_id)}</td><td>${esc(row.partner_id || '—')}</td><td>${money(row.amount_total)} IQD</td><td>${money(row.amount_tax)}</td><td>${badge(row.state)}</td><td><button class="cpos-link" data-cpos-receipt="${esc(row.id)}">${tx('عرض/طباعة', 'View/print')}</button></td></tr>`))}
    </section>`;
  }

  function returns() {
    const salesRows = state.rows.orders.filter((row) => row.order_kind !== 'refund' && row.state === 'paid');
    return `<section class="cpos-grid">
      <article class="cpos-card"><header><div><h3>${tx('استرداد قانوني', 'Canonical refund')}</h3><p>${tx('يمنع تجاوز الكمية المباعة ويرد المخزون والمال بالقيد العكسي.', 'Caps returned quantity and reverses stock and Finance atomically.')}</p></div></header>
        <form data-cpos-form="refund" class="cpos-form">
          <label>${tx('إيصال البيع', 'Original receipt')}<select name="original_order_id" required><option value="">—</option>${salesRows.map((row) => `<option value="${esc(row.id)}">${esc(row.receipt_number || row.name)} · ${money(row.amount_total)}</option>`).join('')}</select></label>
          <label>${tx('معرّف سطر الإيصال', 'Receipt line ID')}<input name="original_order_line_id" required placeholder="posol_…"></label>
          <label>${tx('الكمية', 'Quantity')}<input name="qty" type="number" step="0.01" min="0.01" value="1" required></label>
          <label>${tx('طريقة الاسترداد', 'Refund method')}<select name="payment_method_id"><option value="cash">${tx('نقد', 'Cash')}</option><option value="card">${tx('بطاقة', 'Card')}</option><option value="account">${tx('حساب', 'Account')}</option></select></label>
          <label>${tx('مبلغ الاسترداد', 'Refund amount')}<input name="amount" type="number" step="0.01" min="0.01" required></label>
          <label>${tx('السبب', 'Reason')}<textarea name="reason" required>${tx('إرجاع عميل', 'Customer return')}</textarea></label>
          <button class="cpos-danger" type="submit" ${openSession() ? '' : 'disabled'}>${tx('تنفيذ المرتجع والاسترداد', 'Commit return & refund')}</button>
        </form>
      </article>
      <article class="cpos-card"><header><div><h3>${tx('سجل المرتجعات', 'Refund register')}</h3></div></header>
        ${table([tx('الأصل', 'Original'), tx('إيصال المرتجع', 'Refund receipt'), tx('المبلغ', 'Amount'), tx('السبب', 'Reason'), tx('التاريخ', 'Date')],
          state.rows.refunds.map((row) => `<tr><td>${esc(row.original_receipt_number)}</td><td>${esc(row.refund_receipt_number)}</td><td>${money(row.amount_total)}</td><td>${esc(row.reason)}</td><td>${date(row.created_at)}</td></tr>`))}
      </article>
    </section>`;
  }

  function reconciliation() {
    return `<section class="cpos-card"><header><div><h3>${tx('مطابقة افتتاح / متوقع / معدود / فرق', 'Opening / expected / counted / variance')}</h3><p>${tx('المتوقع مشتق من دفتر المالية وليس من الواجهة.', 'Expected cash is derived by Finance, never by the UI.')}</p></div></header>
      ${table([tx('الجلسة', 'Session'), tx('الافتتاح', 'Opening'), tx('المبيعات', 'Sales'), tx('المرتجعات', 'Refunds'), tx('المتوقع', 'Expected'), tx('المعدود', 'Counted'), tx('الفرق', 'Variance'), tx('الحالة', 'Status')],
        state.rows.reconciliations.map((row) => `<tr><td>${esc(row.session_name || row.session_id)}</td><td>${money(row.opening_amount)}</td><td>${money(row.sales_amount)}</td><td>${money(row.refunds_amount)}</td><td>${money(row.expected_amount)}</td><td>${money(row.counted_amount)}</td><td>${money(row.variance)}</td><td>${badge(row.status)}</td></tr>`))}
    </section>`;
  }

  function audit() {
    return `<section class="cpos-grid">
      <article class="cpos-card"><header><div><h3>${tx('سجل التدقيق', 'Audit log')}</h3><p>${tx('إثبات المستخدم والإجراء والارتباط.', 'Actor, action, and correlation proof.')}</p></div></header>
        ${table([tx('الإجراء', 'Action'), tx('المورد', 'Resource'), tx('المستخدم', 'Actor'), tx('النتيجة', 'Result'), tx('الوقت', 'Time')],
          state.rows.audit.map((row) => `<tr><td>${esc(row.action)}</td><td>${esc(row.resource)}</td><td>${esc(row.actor_id)}</td><td>${badge(row.result)}</td><td>${date(row.occurred_at)}</td></tr>`))}
      </article>
      <article class="cpos-card"><header><div><h3>${tx('صندوق الصادر', 'Outbox')}</h3><p>${tx('الحدث يُكتب داخل نفس معاملة البيع.', 'The event is written in the same sale transaction.')}</p></div></header>
        ${table([tx('الحدث', 'Event'), tx('التجميع', 'Aggregate'), tx('الحالة', 'Status'), tx('المحاولات', 'Attempts'), tx('الوقت', 'Time')],
          state.rows.outbox.map((row) => `<tr><td>${esc(row.event_type)}</td><td>${esc(row.aggregate_id)}</td><td>${badge(row.status)}</td><td>${esc(row.attempts)}</td><td>${date(row.created_at)}</td></tr>`))}
      </article>
    </section>`;
  }

  function reports() {
    return `<section class="cpos-card"><header><div><h3>${tx('تقارير POS', 'POS reports')}</h3><p>${tx('مبيعات يومية، طرق الدفع، وأداء أمين الصندوق.', 'Daily sales, payment methods, and cashier performance.')}</p></div>
      <div class="cpos-report-buttons">${[['daily-sales', tx('يومي', 'Daily')], ['payment-methods', tx('طرق الدفع', 'Payments')], ['cashier-performance', tx('أمين الصندوق', 'Cashier')]].map(([key, label]) => `<button data-cpos-report="${key}" class="${state.report === key ? 'active' : ''}">${label}</button>`).join('')}</div></header>
      <pre class="cpos-report">${esc(JSON.stringify(state.rows.report, null, 2))}</pre>
    </section>`;
  }

  function renderActive() {
    if (state.active === 'dashboard') return dashboard();
    if (state.active === 'sessions') return sessions();
    if (state.active === 'catalogue') return catalogue();
    if (state.active === 'cart') return cart();
    if (state.active === 'sales') return sales(false);
    if (state.active === 'receipts') return sales(true);
    if (state.active === 'returns') return returns();
    if (state.active === 'reconciliation') return reconciliation();
    if (state.active === 'audit') return audit();
    return reports();
  }

  function shell() {
    const el = host();
    if (!el) return;
    el.classList.add('canonical-pos-page');
    el.innerHTML = `<section class="cpos-shell" dir="${escapeHtml(lang() === 'ar' ? 'rtl' : 'ltr')}">
      <header class="cpos-hero"><div><span class="cpos-eyebrow">CHECKPOINT C3 · CANONICAL POS</span><h1><i class="fa-solid fa-cash-register"></i> ${tx('نقطة البيع القانونية', 'Canonical Point of Sale')}</h1><p>${tx('جلسة، كتالوج، دفع متعدد، إيصال، مرتجع، صندوق ومطابقة—في سلطة واحدة.', 'Session, catalogue, split payment, receipt, refund, cashbox, and reconciliation under one authority.')}</p></div><button data-cpos-refresh><i class="fa-solid fa-rotate"></i> ${tx('تحديث', 'Refresh')}</button></header>
      <nav class="cpos-tabs">${tabs.map(([key, ar, en, icon]) => `<button data-cpos-tab="${key}" class="${state.active === key ? 'active' : ''}"><i class="fa-solid ${icon}"></i><span>${tx(ar, en)}</span></button>`).join('')}</nav>
      <div class="cpos-feedback" aria-live="polite">${state.notice ? `<div class="cpos-notice">${esc(state.notice)}</div>` : ''}${state.error ? `<div class="cpos-error">${esc(state.error)}</div>` : ''}</div>
      <main class="cpos-body">${state.loading ? `<div class="cpos-loading"><i class="fa-solid fa-spinner fa-spin"></i><span>${tx('جارٍ تحميل الحقائق القانونية…', 'Loading canonical facts…')}</span></div>` : renderActive()}</main>
    </section>`;
    bind(el);
  }

  async function refresh() {
    state.loading = true; state.error = null; shell();
    try {
      const client = api();
      const [sessionsRows, terminalRows, productRows, partyRows, warehouseRows, orderRows, refundRows, reconciliationRows, methodRows, accountRows, auditRows, reportRows] = await Promise.all([
        client.pos.listSessions(), client.pos.listTerminals(), client.products.list(),
        client.parties.list({ role: 'customer' }), client.warehouses.list(),
        client.pos.listOrders(), client.pos.listRefunds(), client.pos.listReconciliations(),
        client.pos.listPaymentMethods(), client.query('/finance/accounts'), client.pos.listAuditOutbox(),
        client.pos.report(state.report),
      ]);
      const quantRows = (await Promise.all(productRows.flatMap((product) =>
        warehouseRows.map(async (warehouse) => {
          const balance = await client.stock.balances({
            product_id: productId(product),
            location_id: warehouse.lot_stock_id,
          });
          return {
            ...balance,
            product_id: productId(product),
            warehouse_id: warehouse.id,
            on_hand_qty: Number(balance.onHand ?? balance.on_hand_qty ?? balance.quantity ?? 0),
          };
        })))).flat();
      Object.assign(state.rows, {
        sessions: sessionsRows, terminals: terminalRows, products: productRows,
        parties: partyRows, warehouses: warehouseRows, quants: quantRows,
        orders: orderRows, refunds: refundRows, reconciliations: reconciliationRows,
        methods: methodRows, accounts: accountRows,
        audit: auditRows.audit || [], outbox: auditRows.outbox || [], report: reportRows,
      });
    } catch (error) {
      state.error = normalizeError(error);
    } finally {
      state.loading = false; shell();
    }
  }

  async function command(message, task) {
    state.loading = true; state.error = null; state.notice = null; shell();
    try {
      await task();
      state.notice = message;
      await refresh();
    } catch (error) {
      state.loading = false;
      state.error = normalizeError(error);
      shell();
    }
  }

  function bind(el) {
    el.querySelectorAll('[data-cpos-tab]').forEach((button) => button.addEventListener('click', async () => {
      state.active = button.dataset.cposTab;
      if (state.active === 'reports') {
        state.rows.report = await api().pos.report(state.report).catch((error) => { state.error = normalizeError(error); return []; });
      }
      shell();
    }));
    el.querySelectorAll('[data-cpos-refresh]').forEach((button) => button.addEventListener('click', refresh));
    const search = el.querySelector('[data-cpos-search]');
    if (search) search.addEventListener('input', () => {
      const term = search.value.toLowerCase().trim();
      el.querySelectorAll('[data-cpos-product]').forEach((card) => { card.hidden = term && !card.dataset.cposProduct.includes(term); });
    });
    el.querySelectorAll('[data-cpos-add]').forEach((button) => button.addEventListener('click', () => {
      state.active = 'cart'; shell();
      const select = host()?.querySelector('select[name="product_id"]');
      if (select) select.value = button.dataset.cposAdd;
    }));
    el.querySelectorAll('[data-cpos-report]').forEach((button) => button.addEventListener('click', async () => {
      state.report = button.dataset.cposReport;
      state.loading = true; shell();
      try { state.rows.report = await api().pos.report(state.report); } catch (error) { state.error = normalizeError(error); }
      state.loading = false; shell();
    }));
    el.querySelectorAll('[data-cpos-receipt]').forEach((button) => button.addEventListener('click', async () => {
      try {
        const order = await api().pos.getOrder(button.dataset.cposReceipt);
        const popup = root.open('', '_blank', 'width=420,height=720');
        if (!popup) return;
        popup.document.write(`<!doctype html><html dir="${lang() === 'ar' ? 'rtl' : 'ltr'}"><meta charset="utf-8"><title>${esc(order.receipt_number || order.name)}</title><style>body{font:14px system-ui;padding:24px;color:#111}h1{text-align:center}table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px dashed #888}.total{font-size:22px;font-weight:800;margin-top:20px;display:flex;justify-content:space-between}@media print{button{display:none}}</style><body><h1>OCTAGON ERP</h1><p>${esc(order.receipt_number || order.name)} · ${date(order.completed_at)}</p><table><tr><th>${tx('الصنف', 'Product')}</th><th>${tx('الكمية', 'Qty')}</th><th>${tx('الإجمالي', 'Total')}</th></tr>${order.lines.map((line) => `<tr><td>${esc(line.product_id)}</td><td>${money(line.qty)}</td><td>${money(line.price_total)}</td></tr>`).join('')}</table><div class="total"><span>${tx('الإجمالي', 'Total')}</span><span>${money(order.amount_total)} IQD</span></div><p>${tx('الضريبة', 'Tax')}: ${money(order.amount_tax)} IQD</p><button onclick="print()">${tx('طباعة', 'Print')}</button></body></html>`);
        popup.document.close();
      } catch (error) { state.error = normalizeError(error); shell(); }
    }));
    const terminalForm = el.querySelector('[data-cpos-form="terminal"]');
    if (terminalForm) terminalForm.addEventListener('submit', (event) => {
      event.preventDefault(); const form = new FormData(terminalForm);
      command(tx('تم تكوين محطة POS وصندوقها.', 'POS terminal and cashbox configured.'), () => api().pos.configureTerminal({
        name: form.get('name'), warehouse_id: form.get('warehouse_id'), cash_account_id: form.get('cash_account_id'),
      }));
    });
    const openForm = el.querySelector('[data-cpos-form="open-session"]');
    if (openForm) openForm.addEventListener('submit', (event) => {
      event.preventDefault(); const form = new FormData(openForm);
      command(tx('تم فتح جلسة POS.', 'POS session opened.'), () => api().pos.openSession({
        terminal_id: form.get('terminal_id'), opening_cash: Number(form.get('opening_cash') || 0),
      }));
    });
    const closeForm = el.querySelector('[data-cpos-form="close-session"]');
    if (closeForm) closeForm.addEventListener('submit', (event) => {
      event.preventDefault(); const form = new FormData(closeForm); const session = openSession();
      command(tx('تم إغلاق الجلسة وتسجيل المطابقة.', 'Session closed and reconciled.'), () => api().pos.closeSession({
        session_id: session.id, counted_amount: Number(form.get('counted_amount')),
      }));
    });
    const saleForm = el.querySelector('[data-cpos-form="sale"]');
    if (saleForm) saleForm.addEventListener('submit', (event) => {
      event.preventDefault(); const form = new FormData(saleForm); const session = openSession();
      const payments = [['cash', 'cash_amount'], ['card', 'card_amount'], ['account', 'account_amount']]
        .map(([payment_method_id, field]) => ({ payment_method_id, amount: Number(form.get(field) || 0) }))
        .filter((payment) => payment.amount > 0);
      const warehouseId = session.warehouse_id || state.rows.terminals.find((row) => row.id === session.terminal_id)?.warehouse_id;
      command(tx('تم البيع وإصدار الإيصال قانونياً.', 'Sale committed and fiscal receipt issued.'), () => api().pos.processOrder({
        session_id: session.id, partner_id: form.get('partner_id'), warehouse_id: warehouseId,
        lines: [{ product_id: form.get('product_id'), qty: Number(form.get('qty')), discount: Number(form.get('discount') || 0) }],
        payments,
      }));
    });
    const refundForm = el.querySelector('[data-cpos-form="refund"]');
    if (refundForm) refundForm.addEventListener('submit', (event) => {
      event.preventDefault(); const form = new FormData(refundForm); const session = openSession();
      command(tx('تم المرتجع والاسترداد والقيد العكسي.', 'Return, refund, and reversing entry committed.'), () => api().pos.refundOrder({
        session_id: session.id, original_order_id: form.get('original_order_id'), reason: form.get('reason'),
        lines: [{ original_order_line_id: form.get('original_order_line_id'), qty: Number(form.get('qty')) }],
        payments: [{ payment_method_id: form.get('payment_method_id'), amount: Number(form.get('amount')) }],
      }));
    });
  }

  function activate() {
    document.querySelectorAll('.page').forEach((page) => page.classList.remove('page-active'));
    document.querySelectorAll('.nav-btn').forEach((button) => button.classList.remove('active'));
    const page = document.getElementById('pagePOS');
    const nav = document.getElementById('navPOS');
    if (page) page.classList.add('page-active');
    if (nav) nav.classList.add('active');
    const legacyNav = document.getElementById('navPOSDeepening');
    if (legacyNav) legacyNav.hidden = true;
    root.currentPage = 'pos';
    shell();
    refresh();
  }

  function installRouteAuthority() {
    if (typeof root.switchPage !== 'function' || root.switchPage.__canonicalPosFinalAuthority) return;
    const previousSwitch = root.switchPage;
    const canonicalPosSwitch = function canonicalPosSwitch(page) {
      if (page === 'pos' || page === 'pos_deepening') {
        if (!document.getElementById('pagePOS') && typeof root.ensurePageTemplateLoaded === 'function') {
          return Promise.resolve(root.ensurePageTemplateLoaded('pos')).then(() => activate());
        }
        activate();
        return;
      }
      return previousSwitch.apply(this, arguments);
    };
    canonicalPosSwitch.__canonicalPosFinalAuthority = true;
    canonicalPosSwitch.__canonicalPosPreviousSwitch = previousSwitch;
    root.switchPage = canonicalPosSwitch;
  }
  installRouteAuthority();
  let routeInstallAttempts = 0;
  const routeInstallTimer = setInterval(() => {
    routeInstallAttempts += 1;
    installRouteAuthority();
    if (routeInstallAttempts >= 80) clearInterval(routeInstallTimer);
  }, 150);
  root.addEventListener('load', () => setTimeout(installRouteAuthority, 0));
  root.renderPOS = activate;
  root.CanonicalPOS = {
    activate, refresh, state,
    TABS: tabs.map(([key, ar, en, icon]) => ({ key, label: { ar, en }, icon })),
    selectTab(key) { state.active = key; shell(); },
  };

  if (document.getElementById('pagePOS') && getComputedStyle(document.getElementById('pagePOS')).display !== 'none') activate();
})(window);
