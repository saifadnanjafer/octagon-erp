(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Canonical Inventory & Warehouses — visible original-shell module.
  //
  // Reads:
  //   GET /api/v1/inventory/warehouses            (list)
  //   GET /api/v1/inventory/locations             (list)
  //   GET /api/v1/inventory/operations            (list — movement history)
  //   GET /api/v1/inventory/reservations          (list)
  //   GET /api/v1/inventory/lots|serials|packages (lists)
  //   GET /api/v1/inventory/quants?product_id=    (single balance object)
  //   GET /api/v1/inventory/valuation?product_id= (single valuation object)
  //
  // Commands:
  //   warehouse:create, stock:location:create, stock:move:post,
  //   stock:reservation:reserve | release, stock:quants:rebuild,
  //   stock:lot:create
  //
  // The browser NEVER computes on-hand, reserved, available or valuation.
  // Those numbers come from the canonical queries above and are displayed
  // as-is. There is no arithmetic on governed quantities anywhere in this file.
  //
  // Receipt lifecycle: Draft -> Validate -> canonical command -> atomic
  // transaction -> success/failure -> refresh. "Draft" is a client-side
  // staging step: the canonical engine posts a stock move atomically and has
  // no separate server-side draft state for a bare move, so the draft exists
  // only so the operator can review before committing. Nothing is persisted
  // until Validate is pressed.
  // ---------------------------------------------------------------------

  const root = window;

  function client() { return root.CanonicalClient || null; }

  function lang() {
    try { if (typeof root.getLang === 'function') return root.getLang(); } catch (_) { /* noop */ }
    return document.documentElement.getAttribute('lang') === 'en' ? 'en' : 'ar';
  }

  function tx(pair) {
    if (!pair) return '';
    return lang() === 'en' ? (pair.en || pair.ar || '') : (pair.ar || pair.en || '');
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function num(value) {
    if (value === null || value === undefined || value === '') return '—';
    const n = Number(value);
    if (!Number.isFinite(n)) return escapeHtml(value);
    return n.toLocaleString(lang() === 'en' ? 'en-US' : 'ar-EG');
  }

  // Draft receipt lines, staged client-side until Validate.
  let draftLines = [];

  // Per-line outcome of the last Validate. Kept so the operator can see
  // exactly which line failed and why — a transient toast is not enough when
  // a multi-line receipt partially posts.
  let lastValidation = null;

  const TABS = [
    { key: 'warehouses',   icon: 'fa-building',        label: { ar: 'المستودعات', en: 'Warehouses' } },
    { key: 'locations',    icon: 'fa-sitemap',         label: { ar: 'المواقع', en: 'Locations' } },
    { key: 'receipt',      icon: 'fa-dolly',           label: { ar: 'استلام مخزني', en: 'Stock Receipt' } },
    { key: 'balances',     icon: 'fa-scale-balanced',  label: { ar: 'الأرصدة والتقييم', en: 'Balances & Valuation' } },
    { key: 'movements',    icon: 'fa-right-left',      label: { ar: 'الحركات', en: 'Movements' } },
    { key: 'reservations', icon: 'fa-lock',            label: { ar: 'الحجوزات', en: 'Reservations' } },
    { key: 'traceability', icon: 'fa-barcode',         label: { ar: 'التتبّع', en: 'Traceability' } },
  ];

  let activeKey = TABS[0].key;
  let renderGeneration = 0;

  // -------------------------------------------------------------------
  // Shared UI helpers
  // -------------------------------------------------------------------

  function skeleton(message) {
    return `<div class="ci-state ci-state-loading"><i class="fa-solid fa-circle-notch fa-spin"></i> ${escapeHtml(message)}</div>`;
  }

  function emptyState() {
    return `<div class="ci-state ci-state-empty"><i class="fa-regular fa-folder-open"></i> ${escapeHtml(tx({
      ar: 'لا توجد سجلات بعد.', en: 'No records yet.',
    }))}</div>`;
  }

  function errorState(err) {
    const isAuth = err && (err.status === 401 || err.status === 403);
    const title = isAuth
      ? tx({ ar: 'الوصول مرفوض', en: 'Access denied' })
      : tx({ ar: 'تعذّر تحميل البيانات', en: 'Could not load data' });
    const hint = err && err.status === 401
      ? tx({ ar: 'سجّل الدخول أولاً — الهوية تُشتق من الخادم.', en: 'Sign in first — identity is derived server-side.' })
      : '';
    const code = err && err.code ? `<code class="ci-code">${escapeHtml(err.code)}</code>` : '';
    const corr = err && err.correlationId
      ? `<div class="ci-corr">${escapeHtml(tx({ ar: 'معرّف الارتباط', en: 'Correlation' }))}: <code>${escapeHtml(err.correlationId)}</code></div>`
      : '';
    return `<div class="ci-state ci-state-error">
        <div class="ci-state-title"><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(title)} ${code}</div>
        <div class="ci-state-msg">${escapeHtml(err && err.message ? err.message : String(err))}</div>
        ${hint ? `<div class="ci-state-hint">${escapeHtml(hint)}</div>` : ''}
        ${corr}
      </div>`;
  }

  function table(columns, rows) {
    if (!Array.isArray(rows) || !rows.length) return emptyState();
    const head = columns.map((c) => `<th>${escapeHtml(tx(c.label))}</th>`).join('');
    const body = rows.map((row) => {
      const cells = columns.map((c) => {
        let raw = row[c.key];
        if (Array.isArray(raw)) raw = raw.join(', ');
        const value = c.numeric ? num(raw) : (raw == null || raw === '' ? '—' : raw);
        return `<td class="${c.numeric ? 'ci-num' : ''}">${escapeHtml(value)}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<div class="ci-table-wrap"><table class="ci-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function field(name, label, opts = {}) {
    const type = opts.type || 'text';
    return `<label class="ci-field"><span>${escapeHtml(tx(label))}${opts.required ? ' *' : ''}</span>
      <input class="form-input" data-ci-field="${escapeHtml(name)}" type="${escapeHtml(type)}"
        ${opts.value !== undefined ? `value="${escapeHtml(opts.value)}"` : ''}
        ${opts.placeholder ? `placeholder="${escapeHtml(tx(opts.placeholder))}"` : ''}></label>`;
  }

  function actionTag(actionId) {
    return `<span class="ci-action-id" title="${escapeHtml(tx({ ar: 'الأمر القانوني المُنفَّذ', en: 'canonical command executed' }))}">${escapeHtml(actionId)}</span>`;
  }

  function toast(message, kind) {
    if (typeof root.showToast === 'function') { root.showToast(message, kind); return; }
    if (root.console) root.console.log(`[canonical-inventory] ${kind}: ${message}`);
  }

  function readFields(scope) {
    const values = {};
    scope.querySelectorAll('[data-ci-field]').forEach((el) => {
      values[el.getAttribute('data-ci-field')] = typeof el.value === 'string' ? el.value.trim() : el.value;
    });
    return values;
  }

  // -------------------------------------------------------------------
  // Panels
  // -------------------------------------------------------------------

  async function panelWarehouses(c) {
    const rows = await c.warehouses.list({ limit: 200 });
    return `
      <form class="ci-form" data-ci-form="warehouse">
        <div class="ci-form-fields">
          ${field('name', { ar: 'اسم المستودع', en: 'Warehouse name' }, { required: true })}
          ${field('code', { ar: 'الرمز', en: 'Code' }, { required: true })}
        </div>
        <button class="btn btn-primary" type="submit"><i class="fa-solid fa-plus"></i> ${escapeHtml(tx({ ar: 'إنشاء مستودع', en: 'Create warehouse' }))}</button>
        ${actionTag('warehouse:create')}
      </form>
      ${table([
        { key: 'name', label: { ar: 'الاسم', en: 'Name' } },
        { key: 'code', label: { ar: 'الرمز', en: 'Code' } },
        { key: 'lot_stock_id', label: { ar: 'موقع المخزون', en: 'Stock location' } },
        { key: 'is_active', label: { ar: 'نشط', en: 'Active' } },
      ], rows)}`;
  }

  async function panelLocations(c) {
    const rows = await c.locations.list({ limit: 200 });
    return `
      <form class="ci-form" data-ci-form="location">
        <div class="ci-form-fields">
          ${field('name', { ar: 'اسم الموقع', en: 'Location name' }, { required: true })}
          <label class="ci-field"><span>${escapeHtml(tx({ ar: 'الاستخدام', en: 'Usage' }))}</span>
            <select class="form-input" data-ci-field="usage">
              <option value="internal">${escapeHtml(tx({ ar: 'داخلي', en: 'Internal' }))}</option>
              <option value="supplier">${escapeHtml(tx({ ar: 'مورد', en: 'Supplier' }))}</option>
              <option value="customer">${escapeHtml(tx({ ar: 'عميل', en: 'Customer' }))}</option>
              <option value="inventory">${escapeHtml(tx({ ar: 'تسوية جردية', en: 'Inventory adjustment' }))}</option>
              <option value="production">${escapeHtml(tx({ ar: 'إنتاج', en: 'Production' }))}</option>
            </select></label>
        </div>
        <button class="btn btn-primary" type="submit"><i class="fa-solid fa-plus"></i> ${escapeHtml(tx({ ar: 'إنشاء موقع', en: 'Create location' }))}</button>
        ${actionTag('stock:location:create')}
      </form>
      ${table([
        { key: 'name', label: { ar: 'الاسم', en: 'Name' } },
        { key: 'usage', label: { ar: 'الاستخدام', en: 'Usage' } },
        { key: 'id', label: { ar: 'المعرّف', en: 'ID' } },
      ], rows)}`;
  }

  /**
   * Receipt: Draft -> Validate.
   * Lines are staged in memory; nothing is persisted until Validate posts each
   * line through stock:move:post. Each line is its own atomic governed command.
   */
  function panelReceipt() {
    const lines = draftLines.length
      ? table([
        { key: 'product_id', label: { ar: 'المنتج', en: 'Product' } },
        { key: 'product_qty', label: { ar: 'الكمية', en: 'Qty' }, numeric: true },
        { key: 'unit_cost', label: { ar: 'التكلفة', en: 'Unit cost' }, numeric: true },
        { key: 'location_id', label: { ar: 'من', en: 'From' } },
        { key: 'location_dest_id', label: { ar: 'إلى', en: 'To' } },
      ], draftLines)
      : `<div class="ci-state ci-state-empty">${escapeHtml(tx({ ar: 'لا توجد أسطر في المسودة.', en: 'No draft lines yet.' }))}</div>`;

    // Persistent per-line outcome of the last Validate. A multi-line receipt
    // can partly succeed, and the operator must be able to see which line
    // failed and why after the toast has gone.
    let outcome = '';
    if (lastValidation) {
      const { posted, failed } = lastValidation;
      const failRows = failed.map((f) => `
        <tr>
          <td>${escapeHtml(f.line.product_id)}</td>
          <td class="ci-num">${escapeHtml(num(f.line.product_qty))}</td>
          <td>${escapeHtml(f.code || '—')}</td>
          <td>${escapeHtml(f.message)}</td>
        </tr>`).join('');
      outcome = `
        <div class="ci-state ${failed.length ? 'ci-state-error' : ''}" style="${failed.length ? '' : 'text-align:start'}">
          <div class="ci-state-title">
            <i class="fa-solid ${failed.length ? 'fa-triangle-exclamation' : 'fa-circle-check'}"></i>
            ${escapeHtml(tx({ ar: 'نتيجة آخر اعتماد', en: 'Last validation result' }))}:
            ${escapeHtml(tx({ ar: 'مُرحَّل', en: 'posted' }))} ${escapeHtml(num(posted))} ·
            ${escapeHtml(tx({ ar: 'فاشل', en: 'failed' }))} ${escapeHtml(num(failed.length))}
          </div>
          ${failed.length ? `<div class="ci-table-wrap"><table class="ci-table"><thead><tr>
              <th>${escapeHtml(tx({ ar: 'المنتج', en: 'Product' }))}</th>
              <th>${escapeHtml(tx({ ar: 'الكمية', en: 'Qty' }))}</th>
              <th>${escapeHtml(tx({ ar: 'الرمز', en: 'Code' }))}</th>
              <th>${escapeHtml(tx({ ar: 'السبب', en: 'Reason' }))}</th>
            </tr></thead><tbody>${failRows}</tbody></table></div>
            <div class="ci-state-hint">${escapeHtml(tx({
              ar: 'الأسطر الفاشلة بقيت في المسودة. لم يُحفظ أي أثر جزئي لها — المحرّك يتراجع ذرّياً.',
              en: 'Failed lines remain in the draft. Nothing partial was persisted for them — the engine rolls back atomically.',
            }))}</div>` : ''}
        </div>`;
    }

    return `
      <div class="ci-note"><i class="fa-solid fa-circle-info"></i> ${escapeHtml(tx({
        ar: 'المسودة محلية ولا تُحفظ. عند "اعتماد" يُنفَّذ لكل سطر أمر مخزني محكوم بشكل ذرّي.',
        en: 'The draft is local and not persisted. On Validate each line is posted as its own atomic governed stock command.',
      }))}</div>
      ${outcome}
      <form class="ci-form" data-ci-form="draft-line">
        <div class="ci-form-fields">
          ${field('product_id', { ar: 'معرّف المنتج', en: 'Product id' }, { required: true })}
          ${field('uom_id', { ar: 'وحدة القياس', en: 'Unit of measure' }, { required: true })}
          ${field('product_qty', { ar: 'الكمية', en: 'Quantity' }, { type: 'number', required: true })}
          ${field('unit_cost', { ar: 'تكلفة الوحدة', en: 'Unit cost' }, { type: 'number', value: '0' })}
          ${field('location_id', { ar: 'من موقع', en: 'From location' }, { required: true })}
          ${field('location_dest_id', { ar: 'إلى موقع', en: 'To location' }, { required: true })}
          ${field('reference', { ar: 'المرجع', en: 'Reference' })}
        </div>
        <button class="btn btn-secondary" type="submit"><i class="fa-solid fa-plus"></i> ${escapeHtml(tx({ ar: 'إضافة للمسودة', en: 'Add to draft' }))}</button>
      </form>
      <div class="ci-draft-head">
        <strong>${escapeHtml(tx({ ar: 'مسودة الاستلام', en: 'Receipt draft' }))}</strong>
        <span class="ci-count">${escapeHtml(tx({ ar: 'الأسطر', en: 'Lines' }))}: <strong>${escapeHtml(num(draftLines.length))}</strong></span>
      </div>
      ${lines}
      <div class="ci-draft-actions">
        <button class="btn btn-primary" id="ciValidateReceipt" type="button" ${draftLines.length ? '' : 'disabled'}>
          <i class="fa-solid fa-check"></i> ${escapeHtml(tx({ ar: 'اعتماد الاستلام', en: 'Validate receipt' }))}
        </button>
        <button class="btn btn-secondary" id="ciClearDraft" type="button" ${draftLines.length ? '' : 'disabled'}>
          ${escapeHtml(tx({ ar: 'مسح المسودة', en: 'Clear draft' }))}
        </button>
        ${actionTag('stock:move:post')}
      </div>`;
  }

  /**
   * Balances and valuation are per-product: the canonical queries require a
   * product_id and return a single object, not a list. So this panel is a
   * lookup, not a grid — showing a grid here would mean inventing an aggregate
   * the engine does not expose.
   */
  async function panelBalances(c, state) {
    const productId = state && state.productId;
    let body = `<div class="ci-state ci-state-empty">${escapeHtml(tx({
      ar: 'أدخل معرّف منتج لعرض رصيده وتقييمه.',
      en: 'Enter a product id to view its balance and valuation.',
    }))}</div>`;

    if (productId) {
      let balance = null; let valuation = null; let failure = null;
      try {
        balance = await c.stock.balances({ product_id: productId });
      } catch (e) { failure = e; }
      if (!failure) {
        try { valuation = await c.stock.valuation({ product_id: productId }); } catch (e) { valuation = { error: e.message }; }
      }
      body = failure ? errorState(failure) : `
        <div class="ci-metrics">
          <div class="ci-metric"><span class="ci-metric-label">${escapeHtml(tx({ ar: 'المتوفر', en: 'On hand' }))}</span><span class="ci-metric-value">${escapeHtml(num(balance && balance.onHand))}</span></div>
          <div class="ci-metric"><span class="ci-metric-label">${escapeHtml(tx({ ar: 'المحجوز', en: 'Reserved' }))}</span><span class="ci-metric-value">${escapeHtml(num(balance && balance.reserved))}</span></div>
          <div class="ci-metric"><span class="ci-metric-label">${escapeHtml(tx({ ar: 'القابل للاستخدام', en: 'Available' }))}</span><span class="ci-metric-value">${escapeHtml(num(balance && balance.available))}</span></div>
          <div class="ci-metric"><span class="ci-metric-label">${escapeHtml(tx({ ar: 'القيمة', en: 'Valuation' }))}</span><span class="ci-metric-value">${escapeHtml(valuation && valuation.value !== undefined ? num(valuation.value) : '—')}</span></div>
        </div>
        <div class="ci-note"><i class="fa-solid fa-circle-info"></i> ${escapeHtml(tx({
          ar: 'هذه الأرقام تُقرأ من المحرّك القانوني ولا تُحسب في المتصفح.',
          en: 'These figures are read from the canonical engine and are never computed in the browser.',
        }))}</div>`;
    }

    return `
      <form class="ci-form" data-ci-form="balance-lookup">
        <div class="ci-form-fields">
          ${field('product_id', { ar: 'معرّف المنتج', en: 'Product id' }, { required: true, value: productId || '' })}
        </div>
        <button class="btn btn-primary" type="submit"><i class="fa-solid fa-magnifying-glass"></i> ${escapeHtml(tx({ ar: 'استعلام', en: 'Look up' }))}</button>
      </form>
      ${body}`;
  }

  async function panelMovements(c) {
    const rows = await c.stock.operations({ limit: 200 });
    return `
      <div class="ci-note"><i class="fa-solid fa-circle-info"></i> ${escapeHtml(tx({
        ar: 'سجل الحركات المخزنية المرحّلة، من المحرّك القانوني.',
        en: 'Posted stock movement history, straight from the canonical engine.',
      }))}</div>
      ${table([
        { key: 'reference', label: { ar: 'المرجع', en: 'Reference' } },
        { key: 'product_id', label: { ar: 'المنتج', en: 'Product' } },
        { key: 'product_qty', label: { ar: 'الكمية', en: 'Qty' }, numeric: true },
        { key: 'location_id', label: { ar: 'من', en: 'From' } },
        { key: 'location_dest_id', label: { ar: 'إلى', en: 'To' } },
        { key: 'state', label: { ar: 'الحالة', en: 'State' } },
        { key: 'move_date', label: { ar: 'التاريخ', en: 'Date' } },
      ], rows)}`;
  }

  async function panelReservations(c) {
    const rows = await c.reservations.list({ limit: 200 });
    return `
      <form class="ci-form" data-ci-form="reserve">
        <div class="ci-form-fields">
          ${field('warehouse_id', { ar: 'المستودع', en: 'Warehouse' }, { required: true })}
          ${field('location_id', { ar: 'الموقع', en: 'Location' }, { required: true })}
          ${field('product_id', { ar: 'المنتج', en: 'Product' }, { required: true })}
          ${field('quantity', { ar: 'الكمية', en: 'Quantity' }, { type: 'number', required: true })}
          ${field('source_document_id', { ar: 'المستند المصدر', en: 'Source document' }, { required: true })}
          <label class="ci-field"><span>${escapeHtml(tx({ ar: 'حجز جزئي', en: 'Allow partial' }))}</span>
            <select class="form-input" data-ci-field="allow_partial">
              <option value="">${escapeHtml(tx({ ar: 'لا', en: 'No' }))}</option>
              <option value="1">${escapeHtml(tx({ ar: 'نعم', en: 'Yes' }))}</option>
            </select></label>
        </div>
        <button class="btn btn-primary" type="submit"><i class="fa-solid fa-lock"></i> ${escapeHtml(tx({ ar: 'حجز', en: 'Reserve' }))}</button>
        ${actionTag('stock:reservation:reserve')}
      </form>
      <form class="ci-form" data-ci-form="release">
        <div class="ci-form-fields">
          ${field('reservation_id', { ar: 'معرّف الحجز', en: 'Reservation id' }, { required: true })}
        </div>
        <button class="btn btn-secondary" type="submit"><i class="fa-solid fa-lock-open"></i> ${escapeHtml(tx({ ar: 'فكّ الحجز', en: 'Release' }))}</button>
        ${actionTag('stock:reservation:release')}
      </form>
      ${table([
        { key: 'id', label: { ar: 'المعرّف', en: 'ID' } },
        { key: 'product_id', label: { ar: 'المنتج', en: 'Product' } },
        { key: 'quantity', label: { ar: 'الكمية', en: 'Qty' }, numeric: true },
        { key: 'status', label: { ar: 'الحالة', en: 'Status' } },
        { key: 'source_document_id', label: { ar: 'المستند', en: 'Document' } },
      ], rows)}`;
  }

  async function panelTraceability(c) {
    const [lots, serials, packages] = await Promise.all([
      c.stock.lots({ limit: 100 }).catch(() => []),
      c.stock.serials({ limit: 100 }).catch(() => []),
      c.stock.packages({ limit: 100 }).catch(() => []),
    ]);
    return `
      <form class="ci-form" data-ci-form="lot">
        <div class="ci-form-fields">
          ${field('product_id', { ar: 'المنتج', en: 'Product' }, { required: true })}
          ${field('name', { ar: 'رقم الحصة', en: 'Lot number' }, { required: true })}
        </div>
        <button class="btn btn-primary" type="submit"><i class="fa-solid fa-plus"></i> ${escapeHtml(tx({ ar: 'إنشاء حصة', en: 'Create lot' }))}</button>
        ${actionTag('stock:lot:create')}
      </form>
      <h3 class="ci-sub">${escapeHtml(tx({ ar: 'الحصص', en: 'Lots' }))}</h3>
      ${table([{ key: 'name', label: { ar: 'الرقم', en: 'Name' } }, { key: 'product_id', label: { ar: 'المنتج', en: 'Product' } }], lots)}
      <h3 class="ci-sub">${escapeHtml(tx({ ar: 'الأرقام التسلسلية', en: 'Serials' }))}</h3>
      ${table([{ key: 'name', label: { ar: 'الرقم', en: 'Name' } }, { key: 'product_id', label: { ar: 'المنتج', en: 'Product' } }], serials)}
      <h3 class="ci-sub">${escapeHtml(tx({ ar: 'الطرود', en: 'Packages' }))}</h3>
      ${table([{ key: 'name', label: { ar: 'الاسم', en: 'Name' } }, { key: 'id', label: { ar: 'المعرّف', en: 'ID' } }], packages)}`;
  }

  const PANELS = {
    warehouses: panelWarehouses,
    locations: panelLocations,
    receipt: () => panelReceipt(),
    balances: panelBalances,
    movements: panelMovements,
    reservations: panelReservations,
    traceability: panelTraceability,
  };

  let balanceState = { productId: '' };

  // -------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------

  async function submitForm(form) {
    const c = client();
    if (!c) return;
    const kind = form.getAttribute('data-ci-form');
    const values = readFields(form);
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;

    try {
      if (kind === 'warehouse') {
        if (!values.name || !values.code) throw new Error(tx({ ar: 'أكمل الحقول المطلوبة.', en: 'Fill the required fields.' }));
        await c.warehouses.create({ name: values.name, code: values.code });
        toast(tx({ ar: 'تم إنشاء المستودع.', en: 'Warehouse created.' }), 'success');

      } else if (kind === 'location') {
        if (!values.name) throw new Error(tx({ ar: 'الاسم مطلوب.', en: 'Name is required.' }));
        await c.locations.create({ name: values.name, usage: values.usage || 'internal' });
        toast(tx({ ar: 'تم إنشاء الموقع.', en: 'Location created.' }), 'success');

      } else if (kind === 'draft-line') {
        if (!values.product_id || !values.uom_id || !values.location_id || !values.location_dest_id) {
          throw new Error(tx({ ar: 'أكمل الحقول المطلوبة.', en: 'Fill the required fields.' }));
        }
        const qty = Number(values.product_qty);
        if (!Number.isFinite(qty) || qty <= 0) {
          throw new Error(tx({ ar: 'الكمية يجب أن تكون أكبر من صفر.', en: 'Quantity must be greater than zero.' }));
        }
        // Staged only. No request is issued here.
        draftLines = draftLines.concat([{
          product_id: values.product_id,
          uom_id: values.uom_id,
          product_qty: qty,
          unit_cost: Number(values.unit_cost) || 0,
          location_id: values.location_id,
          location_dest_id: values.location_dest_id,
          reference: values.reference || 'RECEIPT',
        }]);
        toast(tx({ ar: 'أُضيف السطر إلى المسودة.', en: 'Line added to draft.' }), 'success');

      } else if (kind === 'balance-lookup') {
        balanceState = { productId: values.product_id || '' };

      } else if (kind === 'reserve') {
        await c.reservations.reserve({
          warehouse_id: values.warehouse_id,
          location_id: values.location_id,
          product_id: values.product_id,
          quantity: Number(values.quantity) || 0,
          source_document_type: 'sale_order',
          source_document_id: values.source_document_id,
          source_line_id: `${values.source_document_id}-1`,
          allow_partial: values.allow_partial === '1',
        });
        toast(tx({ ar: 'تم الحجز.', en: 'Reserved.' }), 'success');

      } else if (kind === 'release') {
        await c.reservations.release({ reservation_id: values.reservation_id });
        toast(tx({ ar: 'تم فكّ الحجز.', en: 'Reservation released.' }), 'success');

      } else if (kind === 'lot') {
        await c.stock.createLot({ product_id: values.product_id, name: values.name });
        toast(tx({ ar: 'تم إنشاء الحصة.', en: 'Lot created.' }), 'success');
      }

      await renderPanel();
    } catch (err) {
      const detail = err && err.code ? `${err.code}: ${err.message}` : (err && err.message) || String(err);
      toast(detail, 'error');
      const holder = document.getElementById('ciResult');
      if (holder) holder.innerHTML = errorState(err);
    } finally {
      if (button) button.disabled = false;
    }
  }

  /**
   * Validate the staged receipt. Each line posts its own atomic canonical
   * command. A line that fails leaves the remaining lines in the draft so the
   * operator can see exactly what did and did not post — the engine's own
   * rollback guarantees nothing partial persisted for the failed line.
   */
  async function validateReceipt() {
    const c = client();
    if (!c || !draftLines.length) return;
    const button = document.getElementById('ciValidateReceipt');
    if (button) button.disabled = true;

    const posted = [];
    const failed = [];
    for (const line of draftLines) {
      try {
        await c.stock.postMove({
          reference: line.reference,
          product_id: line.product_id,
          uom_id: line.uom_id,
          product_qty: line.product_qty,
          unit_cost: line.unit_cost,
          location_id: line.location_id,
          location_dest_id: line.location_dest_id,
          source_document_type: 'inventory_adjustment',
          source_document_id: `${line.reference}-${line.product_id}`,
        });
        posted.push(line);
      } catch (err) {
        failed.push({ line, err });
      }
    }

    draftLines = failed.map((f) => f.line);

    // Record the per-line outcome so the receipt panel can show it durably,
    // not just as a toast that disappears.
    lastValidation = {
      posted: posted.length,
      failed: failed.map((f) => ({
        line: f.line,
        code: f.err && f.err.code ? f.err.code : null,
        message: f.err && f.err.message ? f.err.message : String(f.err),
      })),
    };

    if (failed.length) {
      const first = failed[0].err;
      const detail = first && first.code ? `${first.code}: ${first.message}` : (first && first.message) || String(first);
      toast(`${tx({ ar: 'فشل اعتماد بعض الأسطر', en: 'Some lines failed to validate' })} (${posted.length}/${posted.length + failed.length}) — ${detail}`, 'error');
    } else {
      toast(`${tx({ ar: 'تم اعتماد الاستلام', en: 'Receipt validated' })} (${posted.length})`, 'success');
    }
    await renderPanel();
  }

  // -------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------

  function renderAuthorityBanner() {
    const el = document.getElementById('ciAuthorityBanner');
    if (!el) return;
    const c = client();
    if (!c) {
      el.innerHTML = `<div class="ci-banner ci-banner-warn">${escapeHtml(tx({ ar: 'طبقة العميل القانونية غير محمّلة.', en: 'Canonical client layer is not loaded.' }))}</div>`;
      return;
    }
    const status = c.cutoverStatus();
    const on = !!(status.domains.INVENTORY && status.domains.INVENTORY.enforced);
    el.innerHTML = `<div class="ci-banner">
        <strong>${escapeHtml(tx({ ar: 'سلطة كتابة المخزون', en: 'Inventory write authority' }))}:</strong>
        <span class="ci-chip ${on ? 'ci-chip-on' : 'ci-chip-off'}">${escapeHtml(on ? tx({ ar: 'قانوني', en: 'canonical' }) : tx({ ar: 'قديم', en: 'legacy' }))}</span>
        <span class="ci-banner-note">${escapeHtml(tx({
          ar: 'يحدّدها الخادم. كل أمر هنا يُنفَّذ على المحرّك القانوني بغضّ النظر.',
          en: 'Server-decided. Every command here executes against the canonical engine regardless.',
        }))}</span>
      </div>`;
  }

  function renderTabs() {
    const el = document.getElementById('ciTabs');
    if (!el) return;
    el.innerHTML = TABS.map((t) => `
      <button class="ci-tab ${t.key === activeKey ? 'active' : ''}" role="tab" type="button"
              aria-selected="${t.key === activeKey}" data-ci-tab="${escapeHtml(t.key)}">
        <i class="fa-solid ${escapeHtml(t.icon)}"></i><span>${escapeHtml(tx(t.label))}</span>
      </button>`).join('');
  }

  async function renderPanel() {
    const generation = ++renderGeneration;
    const el = document.getElementById('ciPanel');
    if (!el) return;
    const tab = TABS.find((t) => t.key === activeKey) || TABS[0];
    const c = client();

    if (!c) {
      el.innerHTML = errorState(new Error(tx({ ar: 'طبقة العميل القانونية غير محمّلة.', en: 'Canonical client layer is not loaded.' })));
      return;
    }

    if (!el.querySelector('.ci-table, .ci-state-empty, .ci-state-error, .ci-metrics')) {
      el.innerHTML = skeleton(tx({ ar: 'جارٍ التحميل…', en: 'Loading…' }));
    }

    let html;
    try {
      html = await PANELS[tab.key](c, tab.key === 'balances' ? balanceState : undefined);
    } catch (err) {
      html = errorState(err);
    }

    // A newer render started while this one awaited; do not overwrite it.
    if (generation !== renderGeneration) return;

    el.innerHTML = `
      <div class="ci-panel-head">
        <h2 class="ci-panel-title"><i class="fa-solid ${escapeHtml(tab.icon)}"></i> ${escapeHtml(tx(tab.label))}</h2>
      </div>
      <div id="ciResult">${html}</div>`;
  }

  async function render() {
    renderAuthorityBanner();
    renderTabs();
    await renderPanel();
  }

  // -------------------------------------------------------------------
  // Wiring
  // -------------------------------------------------------------------

  document.addEventListener('click', (event) => {
    if (!event.target.closest) return;
    const tab = event.target.closest('[data-ci-tab]');
    if (tab) { activeKey = tab.getAttribute('data-ci-tab'); renderTabs(); renderPanel(); return; }
    if (event.target.closest('#ciRefreshBtn')) { render(); return; }
    if (event.target.closest('#ciValidateReceipt')) { validateReceipt(); return; }
    if (event.target.closest('#ciClearDraft')) { draftLines = []; lastValidation = null; renderPanel(); }
  });

  document.addEventListener('submit', (event) => {
    const form = event.target.closest && event.target.closest('[data-ci-form]');
    if (!form) return;
    event.preventDefault();
    submitForm(form);
  });

  root.addEventListener('octagon:language-applied', () => {
    if (document.getElementById('pageCanonicalInventory')) render();
  });
  root.addEventListener('octagon:canonical-changed', (e) => {
    const domain = e && e.detail ? e.detail.domain : null;
    if (domain === 'INVENTORY' && document.getElementById('pageCanonicalInventory')) renderPanel();
  });

  async function activate() {
    try {
      if (typeof root.ensurePageTemplateLoaded === 'function') {
        await root.ensurePageTemplateLoaded('canonical_inventory');
      }
    } catch (e) {
      if (root.console) root.console.warn('Canonical inventory: template load failed', e);
    }
    const section = document.getElementById('pageCanonicalInventory');
    if (!section) return false;
    // Non-core tabs must self-activate: the shell revealed nothing because the
    // section did not exist yet when switchPage ran.
    section.classList.add('page-active');
    const navBtn = document.querySelector('.nav-btn[data-page="canonical_inventory"]');
    if (navBtn) { navBtn.classList.add('active'); navBtn.setAttribute('aria-current', 'page'); }
    await render();
    return true;
  }

  function wireSwitch() {
    if (root.__canonicalInventoryWrapped || typeof root.switchPage !== 'function') return;
    const orig = root.switchPage;
    root.switchPage = function (page) {
      const result = orig.apply(this, arguments);
      if (page === 'canonical_inventory') {
        Promise.resolve().then(activate).catch((e) => {
          if (root.console) root.console.warn('Canonical inventory render error', e);
        });
      }
      return result;
    };
    root.__canonicalInventoryWrapped = true;
  }

  function init() {
    wireSwitch();
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      wireSwitch();
      if (root.__canonicalInventoryWrapped || tries > 40) clearInterval(timer);
    }, 250);
    if (document.getElementById('pageCanonicalInventory')) activate();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  root.renderCanonicalInventory = render;
  root.CanonicalInventory = {
    render, activate, TABS,
    get activeKey() { return activeKey; },
    get draftLines() { return draftLines.slice(); },
    _clearDraft() { draftLines = []; },
  };
})();
