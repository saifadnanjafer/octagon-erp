/** BUILD-09R-2: purpose-built Mobile Receiving scanning workspace.
 * Replaces the generic table+dialog shell for the mobile_receiving page with a real
 * step-by-step scanning flow, matching how a receiving clerk actually works: confirm a
 * reference, scan products against expected lines (catching over/under receipt as they
 * happen), review, then request the canonical stock posting. Uses the real WMS receiving
 * actions and defers to canonical Inventory (wms:picking:create / wms:picking:validate) for
 * the actual stock effect - no duplicate receipt or stock authority here. */
(function mobileReceiving(root) {
  'use strict';
  const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const rtl = () => document.documentElement.dir === 'rtl' || String(document.documentElement.lang).startsWith('ar');
  const runtime = () => root.OctagonRuntimeContext;
  const STEPS = [
    ['no-session', 'Start', 'بدء'], ['session-started', 'Reference', 'المرجع'], ['scanning', 'Scan products', 'مسح المنتجات'],
    ['ready-for-review', 'Review', 'مراجعة'], ['posting-requested', 'Awaiting posting', 'بانتظار الترحيل'], ['completed', 'Complete', 'مكتمل'],
  ];

  let state = freshState();
  function freshState() { return { phase: 'no-session', session: null, lines: [], error: null, denied: false, busy: false }; }

  function host() { return document.querySelector('[data-build09-page="mobile_receiving"]'); }

  async function call(actionId, input) {
    const h = host();
    return root.OctagonApiClient.post(`/api/v1/action/${actionId}`, { ...input, warehouse_id: runtime()?.warehouseId, idempotency_key: `${actionId}-${Date.now()}-${Math.random().toString(36).slice(2)}` });
  }

  function statusText(phase) {
    const map = {
      'no-session': ['Start a receiving session to begin.', 'ابدأ جلسة استلام للبدء.'],
      'session-started': ['Confirm the inbound reference (PO / transfer / return).', 'أكّد المرجع الوارد (أمر شراء / تحويل / إرجاع).'],
      scanning: ['Scan each product line. Over/under receipt is flagged automatically.', 'امسح كل سطر منتج. يتم رصد النقص أو الزيادة تلقائياً.'],
      'ready-for-review': ['Review scanned lines, then request canonical posting.', 'راجع السطور الممسوحة ثم اطلب الترحيل الرسمي.'],
      'posting-requested': ['Canonical posting requested — awaiting Inventory to post the stock move.', 'تم طلب الترحيل الرسمي — بانتظار قسم المخزون لترحيل الحركة.'],
      'putaway-pending': ['Posted. Putaway is pending — complete once putaway tasks are done.', 'تم الترحيل. الإيداع معلق — أكمل الجلسة بعد إنهاء مهام الإيداع.'],
      completed: ['Session completed.', 'اكتملت الجلسة.'],
      denied: ['You do not have permission for this step.', 'لا تملك صلاحية هذه الخطوة.'],
      failed: ['Something went wrong.', 'حدث خطأ.'],
    };
    return rtl() ? map[phase][1] : map[phase][0];
  }

  function stepper() {
    const activeIndex = Math.max(0, STEPS.findIndex(([id]) => id === state.phase));
    return `<ol class="b09r-stepper">${STEPS.map(([id, en, ar], index) => `<li class="${index <= activeIndex ? 'b09r-step-done' : ''} ${id === state.phase ? 'b09r-step-active' : ''}">${escapeHtml(rtl() ? ar : en)}</li>`).join('')}</ol>`;
  }

  function scopeHeader() {
    return `<div class="b09r-scope-line"><span>${rtl() ? 'المستودع' : 'Warehouse'}: ${escapeHtml(runtime()?.warehouseId || '—')}</span>${state.session ? `<span>${rtl() ? 'الجلسة' : 'Session'}: ${escapeHtml(state.session.reference || state.session.id)}</span><span data-role="mr-status" class="b09r-badge">${escapeHtml(state.session.status)}</span>` : ''}</div>`;
  }

  function noSessionPanel() {
    return `<form data-role="mr-start-form" class="b09r-panel">
      <label class="b09r-field-lg"><span>${rtl() ? 'المرجع' : 'Reference'}</span><input name="reference" required autocomplete="off" placeholder="${rtl() ? 'مثال: PO-00123' : 'e.g. PO-00123'}"></label>
      <label class="b09r-field-lg"><span>${rtl() ? 'نوع الاستلام' : 'Receipt type'}</span><select name="receipt_type" required><option value="purchase_order">${rtl() ? 'أمر شراء' : 'Purchase order'}</option><option value="transfer">${rtl() ? 'تحويل' : 'Transfer'}</option><option value="return">${rtl() ? 'إرجاع' : 'Return'}</option><option value="other">${rtl() ? 'أخرى' : 'Other'}</option></select></label>
      <button type="submit" class="b09-button b09-primary b09r-btn-xl">${rtl() ? 'بدء جلسة الاستلام' : 'Start receiving session'}</button>
    </form>`;
  }

  function referencePanel() {
    return `<form data-role="mr-reference-form" class="b09r-panel">
      <p>${rtl() ? 'امسح أو أدخل المرجع لتأكيده.' : 'Scan or type the reference to confirm it.'}</p>
      <label class="b09r-field-lg"><span>${rtl() ? 'مسح المرجع' : 'Scan reference'}</span><input name="reference" required autocomplete="off" autofocus value="${escapeHtml(state.session?.reference || '')}"></label>
      <button type="submit" class="b09-button b09-primary b09r-btn-xl">${rtl() ? 'تأكيد المرجع' : 'Confirm reference'}</button>
    </form>`;
  }

  function scanPanel() {
    const expectedRemaining = (state.session?.expectedLineCount || 0) - state.lines.length;
    return `<form data-role="mr-scan-form" class="b09r-panel">
      <p class="b09r-scan-hint">${rtl() ? `متبقٍ تقريباً ${Math.max(0, expectedRemaining)} سطر` : `~${Math.max(0, expectedRemaining)} lines remaining`}</p>
      <label class="b09r-field-lg"><span>${rtl() ? 'باركود المنتج' : 'Product barcode'}</span><input name="barcode" data-role="mr-barcode" autocomplete="off" autofocus placeholder="${rtl() ? 'امسح أو اكتب الباركود' : 'Scan or type barcode'}"></label>
      <span class="b09-lookup b09r-field-lg" data-lookup-resource="products"><span>${rtl() ? 'أو ابحث عن المنتج' : 'Or search for product'}</span><input type="text" class="b09-lookup-query" placeholder="${rtl() ? 'ابحث…' : 'Search…'}" autocomplete="off"><select class="b09-lookup-select" name="product_id"><option value="">${rtl() ? '— بحث ثم اختيار —' : '— Search then select —'}</option></select></span>
      <div class="b09r-grid-2">
        <label><span>${rtl() ? 'الكمية المتوقعة' : 'Expected quantity'}</span><input name="expected_quantity" type="number" min="0" step="any"></label>
        <label><span>${rtl() ? 'الكمية المستلمة' : 'Received quantity'}</span><input name="quantity" type="number" min="0" step="any" required></label>
      </div>
      <div class="b09r-grid-2">
        <label><span>${rtl() ? 'رمز الدفعة (اختياري)' : 'Lot code (optional)'}</span><input name="lot_code" autocomplete="off"></label>
        <label><span>${rtl() ? 'الرقم التسلسلي (اختياري)' : 'Serial code (optional)'}</span><input name="serial_code" autocomplete="off"></label>
      </div>
      <div class="b09r-grid-2">
        <label><span>${rtl() ? 'تاريخ الإنتاج' : 'Manufacture date'}</span><input name="manufacture_date" type="date"></label>
        <label><span>${rtl() ? 'تاريخ الانتهاء' : 'Expiry date'}</span><input name="expiry_date" type="date"></label>
      </div>
      <span class="b09-lookup b09r-field-lg" data-lookup-resource="locations"><span>${rtl() ? 'موقع الوجهة' : 'Destination location'}</span><input type="text" class="b09-lookup-query" placeholder="${rtl() ? 'ابحث…' : 'Search…'}" autocomplete="off"><select class="b09-lookup-select" name="destination_location_id"><option value="">${rtl() ? '— بحث ثم اختيار —' : '— Search then select —'}</option></select></span>
      <label class="b09r-checkbox"><input type="checkbox" name="damaged"><span>${rtl() ? 'تالف' : 'Damaged'}</span></label>
      <div class="b09r-actions-row">
        <button type="submit" class="b09-button b09-primary b09r-btn-xl">${rtl() ? 'تسجيل المسح' : 'Record scan'}</button>
        <button type="button" data-role="mr-goto-review" class="b09-button b09r-btn-xl">${rtl() ? 'إنهاء المسح ← مراجعة' : 'Finish scanning → Review'}</button>
      </div>
    </form>
    <div class="b09r-scan-list" data-role="mr-scan-list"></div>`;
  }

  function reviewPanel() {
    return `<div class="b09r-panel">
      <div class="b09r-scan-list" data-role="mr-scan-list"></div>
      <form data-role="mr-post-form" class="b09r-panel">
        <p>${rtl() ? 'اختر مواقع أمر النقل الرسمي لطلب الترحيل.' : 'Choose the canonical transfer locations to request posting.'}</p>
        <span class="b09-lookup b09r-field-lg" data-lookup-resource="locations"><span>${rtl() ? 'موقع المصدر (المورّد/الرصيف)' : 'Source location (supplier/dock)'}</span><input type="text" class="b09-lookup-query" placeholder="${rtl() ? 'ابحث…' : 'Search…'}" autocomplete="off"><select class="b09-lookup-select" name="location_id"><option value="">${rtl() ? '— بحث ثم اختيار —' : '— Search then select —'}</option></select></span>
        <span class="b09-lookup b09r-field-lg" data-lookup-resource="locations"><span>${rtl() ? 'موقع الاستلام' : 'Receiving destination location'}</span><input type="text" class="b09-lookup-query" placeholder="${rtl() ? 'ابحث…' : 'Search…'}" autocomplete="off"><select class="b09-lookup-select" name="location_dest_id"><option value="">${rtl() ? '— بحث ثم اختيار —' : '— Search then select —'}</option></select></span>
        <label class="b09r-field-lg"><span>${rtl() ? 'نوع النقل الرسمي' : 'Canonical picking type'}</span><input name="picking_type_id" required autocomplete="off" placeholder="${rtl() ? 'مثال: incoming' : 'e.g. incoming'}"></label>
        <button type="submit" class="b09-button b09-primary b09r-btn-xl">${rtl() ? 'طلب الترحيل الرسمي' : 'Request canonical posting'}</button>
      </form>
    </div>`;
  }

  function postingRequestedPanel() {
    return `<div class="b09r-panel">
      <p>${statusText('posting-requested')}</p>
      <button type="button" data-role="mr-refresh" class="b09-button b09r-btn-xl">↻ ${rtl() ? 'تحديث الحالة' : 'Refresh status'}</button>
      <button type="button" data-role="mr-acknowledge" class="b09-button b09-primary b09r-btn-xl">${rtl() ? 'الإقرار بالترحيل' : 'Acknowledge posting'}</button>
    </div>`;
  }

  function putawayPendingPanel() {
    return `<div class="b09r-panel"><p>${statusText('putaway-pending')}</p><button type="button" data-role="mr-complete" class="b09-button b09-primary b09r-btn-xl">${rtl() ? 'إكمال الجلسة' : 'Complete session'}</button></div>`;
  }

  function completedPanel() {
    return `<div class="b09r-panel"><p class="b09r-success">✓ ${statusText('completed')}</p><button type="button" data-role="mr-new" class="b09-button b09r-btn-xl">${rtl() ? 'جلسة استلام جديدة' : 'New receiving session'}</button></div>`;
  }

  function panelFor(phase) {
    if (phase === 'no-session') return noSessionPanel();
    if (phase === 'session-started') return referencePanel();
    if (phase === 'scanning' || phase === 'discrepancy') return scanPanel();
    if (phase === 'ready-for-review') return reviewPanel();
    if (phase === 'posting-requested') return postingRequestedPanel();
    if (phase === 'putaway-pending') return putawayPendingPanel();
    if (phase === 'completed') return completedPanel();
    return `<div class="b09r-panel"><p class="b09r-error">${escapeHtml(state.error || statusText(state.phase))}</p><button type="button" data-role="mr-new" class="b09-button b09r-btn-xl">${rtl() ? 'إعادة المحاولة' : 'Try again'}</button></div>`;
  }

  function renderScanList() {
    const nodes = document.querySelectorAll('[data-build09-page="mobile_receiving"] [data-role="mr-scan-list"]');
    const rowsHtml = state.lines.length
      ? state.lines.map((line) => `<div class="b09r-scan-row${line.discrepancy ? ' b09r-scan-discrepancy' : ''}"><span>${escapeHtml(line.barcode || line.productId)}</span><span>${escapeHtml(String(line.quantity))}${line.expectedQuantity ? ` / ${escapeHtml(String(line.expectedQuantity))}` : ''}</span>${line.discrepancy ? `<span class="b09r-badge b09r-badge-warn">${rtl() ? 'فرق' : 'discrepancy'}</span>` : ''}</div>`).join('')
      : `<p class="b09r-muted">${rtl() ? 'لا سطور ممسوحة بعد.' : 'No lines scanned yet.'}</p>`;
    nodes.forEach((node) => { node.innerHTML = rowsHtml; });
  }

  function render() {
    const h = host(); if (!h) return;
    const body = h.querySelector('[data-role="mr-body"]');
    if (!body) return;
    body.innerHTML = `${scopeHeader()}${stepper()}<p class="b09-status" data-phase="${escapeHtml(state.phase)}">${escapeHtml(statusText(state.phase in { 'no-session': 1, 'session-started': 1, scanning: 1, 'ready-for-review': 1, 'posting-requested': 1, 'putaway-pending': 1, completed: 1 } ? state.phase : (state.error ? 'failed' : state.phase)) || '')}</p>${panelFor(state.phase)}`;
    renderScanList();
    if (root.OctagonGovernedLookups && root.OctagonActionForms) wireLookupsIn(body);
    bindPanel();
  }

  function wireLookupsIn(container) {
    container.querySelectorAll('[data-lookup-resource]').forEach((wrapper) => {
      if (wrapper.dataset.mrBound) return; wrapper.dataset.mrBound = 'true';
      const resource = wrapper.dataset.lookupResource, queryInput = wrapper.querySelector('.b09-lookup-query'), resultSelect = wrapper.querySelector('.b09-lookup-select');
      let timer = null;
      queryInput.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          const rows = await root.OctagonGovernedLookups.search(resource, { query: queryInput.value }).catch(() => []);
          resultSelect.innerHTML = `<option value="">${rtl() ? '— بحث ثم اختيار —' : '— Search then select —'}</option>` + rows.map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.label)}</option>`).join('');
        }, 250);
      });
    });
  }

  function bindPanel() {
    const h = host(); if (!h) return;
    const startForm = h.querySelector('[data-role="mr-start-form"]');
    if (startForm) startForm.addEventListener('submit', async (event) => { event.preventDefault(); await guarded(async () => {
      const data = Object.fromEntries(new FormData(startForm).entries());
      const session = await call('wms:receiving_start', { reference: data.reference, receipt_type: data.receipt_type });
      state.session = session; state.phase = 'session-started'; render();
    }); });

    const referenceForm = h.querySelector('[data-role="mr-reference-form"]');
    if (referenceForm) referenceForm.addEventListener('submit', async (event) => { event.preventDefault(); await guarded(async () => {
      const data = Object.fromEntries(new FormData(referenceForm).entries());
      const session = await call('wms:receiving_scan_reference', { session_id: state.session.id, reference: data.reference });
      state.session = session; state.phase = 'scanning'; render();
    }); });

    const scanForm = h.querySelector('[data-role="mr-scan-form"]');
    if (scanForm) scanForm.addEventListener('submit', async (event) => { event.preventDefault(); await guarded(async () => {
      const data = Object.fromEntries(new FormData(scanForm).entries());
      if (!data.product_id) throw new Error(rtl() ? 'اختر منتجاً من نتائج البحث.' : 'Select a product from the search results.');
      const payload = {
        session_id: state.session.id, product_id: data.product_id, quantity: Number(data.quantity),
        barcode: data.barcode || undefined, expected_quantity: data.expected_quantity ? Number(data.expected_quantity) : undefined,
        lot_code: data.lot_code || undefined, serial_code: data.serial_code || undefined,
        manufacture_date: data.manufacture_date || undefined, expiry_date: data.expiry_date || undefined,
        destination_location_id: data.destination_location_id || undefined, damaged: scanForm.elements.damaged.checked || undefined,
      };
      const result = await call('wms:receiving_scan_product', payload);
      state.session = result.session || state.session;
      state.lines.push({ productId: data.product_id, barcode: data.barcode, quantity: payload.quantity, expectedQuantity: payload.expected_quantity, discrepancy: result.discrepancy || (payload.expected_quantity && payload.expected_quantity !== payload.quantity) });
      state.phase = 'scanning'; scanForm.reset(); render();
    }); });

    const gotoReview = h.querySelector('[data-role="mr-goto-review"]');
    if (gotoReview) gotoReview.addEventListener('click', async () => { await guarded(async () => {
      const session = await call('wms:receiving_review', { session_id: state.session.id });
      state.session = session; state.phase = 'ready-for-review'; render();
    }); });

    const postForm = h.querySelector('[data-role="mr-post-form"]');
    if (postForm) postForm.addEventListener('submit', async (event) => { event.preventDefault(); await guarded(async () => {
      const data = Object.fromEntries(new FormData(postForm).entries());
      if (!data.location_id || !data.location_dest_id) throw new Error(rtl() ? 'اختر مواقع المصدر والوجهة.' : 'Select both source and destination locations.');
      const picking = await call('wms:picking:create', { picking_type_id: data.picking_type_id, reference: state.session.reference, location_id: data.location_id, location_dest_id: data.location_dest_id });
      const session = await call('wms:receiving_request_post', { session_id: state.session.id, picking_id: picking.id });
      state.session = session; state.phase = 'posting-requested'; render();
    }); });

    const refresh = h.querySelector('[data-role="mr-refresh"]');
    if (refresh) refresh.addEventListener('click', async () => { await guarded(async () => {
      const rows = await root.OctagonApiClient.get(`/api/v1/wms/receiving-sessions?warehouse_id=${encodeURIComponent(runtime()?.warehouseId || '')}`);
      const current = (Array.isArray(rows) ? rows : []).find((row) => row.id === state.session.id);
      if (current) state.session = current;
      if (current?.status === 'putaway_pending') state.phase = 'putaway-pending';
      render();
    }); });

    const acknowledge = h.querySelector('[data-role="mr-acknowledge"]');
    if (acknowledge) acknowledge.addEventListener('click', async () => { await guarded(async () => {
      const session = await call('wms:receiving_acknowledge_post', { session_id: state.session.id });
      state.session = session; state.phase = 'putaway-pending'; render();
    }); });

    const complete = h.querySelector('[data-role="mr-complete"]');
    if (complete) complete.addEventListener('click', async () => { await guarded(async () => {
      const session = await call('wms:receiving_complete', { session_id: state.session.id });
      state.session = session; state.phase = 'completed'; render();
    }); });

    const startOver = h.querySelector('[data-role="mr-new"]');
    if (startOver) startOver.addEventListener('click', () => { state = freshState(); render(); });
  }

  async function guarded(fn) {
    if (state.busy) return; state.busy = true;
    try { await fn(); }
    catch (error) { state.error = error.message; state.phase = /403|permission|denied/i.test(error.message) ? 'denied' : 'failed'; render(); }
    finally { state.busy = false; }
  }

  function activate() {
    const h = host(); if (!h) return;
    if (!h.querySelector('[data-role="mr-body"]')) h.insertAdjacentHTML('beforeend', '<div class="b09r-workspace" data-role="mr-body"></div>');
    render();
  }

  root.Build09MobileReceiving = { activate };
  if (root.OctagonBuild09) root.OctagonBuild09.registerPageOverride('mobile_receiving', root.Build09MobileReceiving);
})(window);
