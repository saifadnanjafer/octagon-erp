/** BUILD-09R-2: purpose-built Mobile Picking scanning workspace.
 * Replaces the generic table+dialog shell for the mobile_picking page with a real
 * step-by-step flow matching how a picker actually works: pick a task from the queue,
 * scan the source location, scan the product, confirm the quantity (flagging short picks),
 * stage it, then request the canonical stock move. Uses the real WMS picking actions and
 * defers to canonical Inventory for the actual stock effect - no duplicate picking or stock
 * authority here. The final acknowledge step takes a canonical result ID as a plain text
 * field, matching the existing precedent for cross-authority handoffs elsewhere in BUILD-09
 * (shopfloor:material_acknowledge, quality:scrap_acknowledge in build09-action-forms.js). */
(function mobilePicking(root) {
  'use strict';
  const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const rtl = () => document.documentElement.dir === 'rtl' || String(document.documentElement.lang).startsWith('ar');
  const runtime = () => root.OctagonRuntimeContext;
  const STEPS = [
    ['queue', 'Queue', 'الطابور'], ['assigned', 'Source', 'المصدر'], ['source_scanned', 'Product', 'المنتج'],
    ['product_scanned', 'Quantity', 'الكمية'], ['staging', 'Stage', 'تجهيز'], ['posting-requested', 'Posting', 'الترحيل'], ['completed', 'Done', 'تم'],
  ];
  const ACTIVE_STATUSES = ['ready', 'assigned', 'source_scanned', 'product_scanned', 'picked', 'short', 'exception', 'staged', 'awaiting_canonical'];

  let state = freshState();
  function freshState() { return { view: 'queue', tasks: [], task: null, error: null, phase: null, busy: false }; }

  function host() { return document.querySelector('[data-build09-page="mobile_picking"]'); }
  function actorId() { return runtime()?.actorId || runtime()?.userId || null; }

  async function call(actionId, input) {
    return root.OctagonApiClient.post(`/api/v1/action/${actionId}`, { ...input, warehouse_id: runtime()?.warehouseId, idempotency_key: `${actionId}-${Date.now()}-${Math.random().toString(36).slice(2)}` });
  }

  async function fetchQueue() {
    const rows = await root.OctagonApiClient.get(`/api/v1/wms/pick-tasks?warehouse_id=${encodeURIComponent(runtime()?.warehouseId || '')}`);
    return (Array.isArray(rows) ? rows : []).filter((row) => ACTIVE_STATUSES.includes(row.status) && (!row.assignedTo || row.assignedTo === actorId()));
  }

  function stepFor(task) {
    if (!task) return 'queue';
    if (['ready', 'assigned'].includes(task.status)) return 'assigned';
    if (task.status === 'source_scanned') return 'source_scanned';
    if (task.status === 'product_scanned') return 'product_scanned';
    if (['picked', 'short', 'exception'].includes(task.status)) return 'staging';
    if (task.status === 'staged') return 'staging';
    if (task.status === 'awaiting_canonical') return 'posting-requested';
    if (task.status === 'completed') return 'completed';
    return 'queue';
  }

  function statusText(phase) {
    const map = {
      queue: ['Select a pick task to begin.', 'اختر مهمة التقاط للبدء.'],
      assigned: ['Scan the source location.', 'امسح موقع المصدر.'],
      source_scanned: ['Scan the product.', 'امسح المنتج.'],
      product_scanned: ['Enter the picked quantity. Short picks require a reason.', 'أدخل الكمية الملتقطة. النقص يتطلب سبباً.'],
      staging: ['Choose a staging location to complete this pick.', 'اختر موقع تجهيز لإنهاء هذا الالتقاط.'],
      'posting-requested': ['Canonical posting requested — awaiting Inventory to post the stock move.', 'تم طلب الترحيل الرسمي — بانتظار قسم المخزون لترحيل الحركة.'],
      completed: ['Pick task completed.', 'اكتملت مهمة الالتقاط.'],
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
    return `<div class="b09r-scope-line"><span>${rtl() ? 'المستودع' : 'Warehouse'}: ${escapeHtml(runtime()?.warehouseId || '—')}</span>${state.task ? `<span>${rtl() ? 'المهمة' : 'Task'}: ${escapeHtml(state.task.sourceDocumentId || state.task.id)}</span><span data-role="pt-status" class="b09r-badge">${escapeHtml(state.task.status)}</span>${state.task.waveId ? `<span>${rtl() ? 'الموجة' : 'Wave'}: ${escapeHtml(state.task.waveId)}</span>` : ''}` : ''}</div>`;
  }

  function queuePanel() {
    const rowsHtml = state.tasks.length
      ? state.tasks.map((task) => `<button type="button" class="b09r-scan-row b09r-queue-row" data-role="pt-select" data-task-id="${escapeHtml(task.id)}"><span>${escapeHtml(task.sourceDocumentId || task.id)} · ${escapeHtml(task.productId)}</span><span>${escapeHtml(String(task.requestedQuantity))}</span><span class="b09r-badge${task.status === 'ready' ? '' : ' b09r-badge-warn'}">${escapeHtml(task.assignedTo ? task.status : (rtl() ? 'غير مسند' : 'unassigned'))}</span></button>`).join('')
      : `<p class="b09r-muted">${rtl() ? 'لا توجد مهام التقاط في الطابور حالياً.' : 'No pick tasks are in the queue right now.'}</p>`;
    return `<div class="b09r-panel">
      <div class="b09r-actions-row"><button type="button" data-role="pt-refresh-queue" class="b09-button b09r-btn-xl">↻ ${rtl() ? 'تحديث الطابور' : 'Refresh queue'}</button></div>
      <div class="b09r-scan-list" data-role="pt-queue-list">${rowsHtml}</div>
    </div>`;
  }

  function sourceScanPanel() {
    const task = state.task;
    return `<div class="b09r-panel">
      <div class="b09r-grid-2"><div><span class="b09r-badge">${rtl() ? 'المنتج' : 'Product'}</span><p>${escapeHtml(task.productId)}</p></div><div><span class="b09r-badge">${rtl() ? 'الكمية المطلوبة' : 'Requested qty'}</span><p>${escapeHtml(String(task.requestedQuantity))}</p></div></div>
      <form data-role="pt-source-form" class="b09r-panel">
        <label class="b09r-field-lg"><span>${rtl() ? 'مسح موقع المصدر' : 'Scan source location'}</span><input name="barcode" required autocomplete="off" autofocus placeholder="${rtl() ? 'امسح أو اكتب رمز الموقع' : 'Scan or type location barcode'}"></label>
        <button type="submit" class="b09-button b09-primary b09r-btn-xl">${rtl() ? 'تأكيد المصدر' : 'Confirm source'}</button>
      </form>
    </div>`;
  }

  function productScanPanel() {
    const task = state.task;
    return `<div class="b09r-panel">
      <p>${rtl() ? 'موقع المصدر مؤكَّد.' : 'Source location confirmed.'}</p>
      <form data-role="pt-product-form" class="b09r-panel">
        <label class="b09r-field-lg"><span>${rtl() ? 'مسح باركود المنتج' : 'Scan product barcode'}</span><input name="barcode" required autocomplete="off" autofocus placeholder="${rtl() ? 'امسح أو اكتب الباركود' : 'Scan or type barcode'}"></label>
        ${task.lotId || task.serialId ? `<label class="b09r-field-lg"><span>${rtl() ? 'مسح الدفعة/الرقم التسلسلي' : 'Scan lot / serial'}</span><input name="lot_serial" autocomplete="off" placeholder="${escapeHtml(task.serialId || task.lotId || '')}"></label>` : ''}
        <button type="submit" class="b09-button b09-primary b09r-btn-xl">${rtl() ? 'تأكيد المنتج' : 'Confirm product'}</button>
      </form>
    </div>`;
  }

  function quantityPanel() {
    const task = state.task;
    return `<div class="b09r-panel">
      <div class="b09r-grid-2"><div><span class="b09r-badge">${rtl() ? 'المصدر' : 'Source'}</span><p>${escapeHtml(task.sourceLocationId)}</p></div><div><span class="b09r-badge">${rtl() ? 'الكمية المطلوبة' : 'Requested qty'}</span><p>${escapeHtml(String(task.requestedQuantity))}</p></div></div>
      <form data-role="pt-confirm-form" class="b09r-panel">
        <label class="b09r-field-lg"><span>${rtl() ? 'الكمية الملتقطة' : 'Picked quantity'}</span><input name="quantity" type="number" min="0" max="${escapeHtml(String(task.requestedQuantity))}" step="any" required value="${escapeHtml(String(task.requestedQuantity))}"></label>
        <label class="b09r-field-lg"><span>${rtl() ? 'سبب النقص (إن وُجد)' : 'Short-pick reason (if any)'}</span><input name="short_reason" autocomplete="off" placeholder="${rtl() ? 'مطلوب فقط عند التقاط أقل من الكمية المطلوبة' : 'Required only when picking less than requested'}"></label>
        <button type="submit" class="b09-button b09-primary b09r-btn-xl">${rtl() ? 'تأكيد الالتقاط' : 'Confirm pick'}</button>
      </form>
    </div>`;
  }

  function stagingPanel() {
    const task = state.task;
    const shortNotice = task.shortQuantity > 0 ? `<p class="b09r-error">${rtl() ? `نقص قدره ${escapeHtml(String(task.shortQuantity))} — ${escapeHtml(task.exceptionReason || '')}` : `Short by ${escapeHtml(String(task.shortQuantity))} — ${escapeHtml(task.exceptionReason || '')}`}</p>` : '';
    if (task.status === 'staged') {
      return `<div class="b09r-panel">${shortNotice}<p>${rtl() ? 'تم التجهيز. جاهز لطلب الترحيل الرسمي.' : 'Staged. Ready to request canonical posting.'}</p><button type="button" data-role="pt-request-post" class="b09-button b09-primary b09r-btn-xl">${rtl() ? 'طلب الترحيل الرسمي' : 'Request canonical posting'}</button></div>`;
    }
    return `<div class="b09r-panel">${shortNotice}
      <span class="b09-lookup b09r-field-lg" data-lookup-resource="locations"><span>${rtl() ? 'موقع التجهيز' : 'Staging location'}</span><input type="text" class="b09-lookup-query" placeholder="${rtl() ? 'ابحث…' : 'Search…'}" autocomplete="off"><select class="b09-lookup-select" name="staging_location_id"><option value="">${rtl() ? '— بحث ثم اختيار —' : '— Search then select —'}</option></select></span>
      <button type="button" data-role="pt-stage" class="b09-button b09-primary b09r-btn-xl">${rtl() ? 'تجهيز' : 'Stage'}</button>
    </div>`;
  }

  function postingRequestedPanel() {
    return `<div class="b09r-panel">
      <p>${statusText('posting-requested')}</p>
      <div class="b09r-actions-row"><button type="button" data-role="pt-refresh-task" class="b09-button b09r-btn-xl">↻ ${rtl() ? 'تحديث الحالة' : 'Refresh status'}</button></div>
      <form data-role="pt-ack-form" class="b09r-panel">
        <label class="b09r-field-lg"><span>${rtl() ? 'معرّف النتيجة الرسمية (من قسم المخزون)' : 'Canonical result ID (from Inventory)'}</span><input name="canonical_result_id" required autocomplete="off" placeholder="${rtl() ? 'أدخل معرّف حركة المخزون المكتملة' : 'Enter the completed stock-move ID'}"></label>
        <button type="submit" class="b09-button b09-primary b09r-btn-xl">${rtl() ? 'الإقرار بالترحيل' : 'Acknowledge posting'}</button>
      </form>
    </div>`;
  }

  function completedPanel() {
    return `<div class="b09r-panel"><p class="b09r-success">✓ ${statusText('completed')}</p><button type="button" data-role="pt-new" class="b09-button b09r-btn-xl">${rtl() ? 'العودة إلى الطابور' : 'Back to queue'}</button></div>`;
  }

  function panelFor(phase) {
    if (phase === 'queue') return queuePanel();
    if (phase === 'assigned') return sourceScanPanel();
    if (phase === 'source_scanned') return productScanPanel();
    if (phase === 'product_scanned') return quantityPanel();
    if (phase === 'staging') return stagingPanel();
    if (phase === 'posting-requested') return postingRequestedPanel();
    if (phase === 'completed') return completedPanel();
    return `<div class="b09r-panel"><p class="b09r-error">${escapeHtml(state.error || statusText(state.phase))}</p><button type="button" data-role="pt-new" class="b09-button b09r-btn-xl">${rtl() ? 'العودة إلى الطابور' : 'Back to queue'}</button></div>`;
  }

  function render() {
    const h = host(); if (!h) return;
    const body = h.querySelector('[data-role="pt-body"]');
    if (!body) return;
    state.phase = state.view === 'queue' ? 'queue' : stepFor(state.task);
    const displayPhase = state.error ? (/403|permission|denied/i.test(state.error) ? 'denied' : 'failed') : state.phase;
    body.innerHTML = `${scopeHeader()}${stepper()}<p class="b09-status" data-phase="${escapeHtml(displayPhase)}">${escapeHtml(statusText(displayPhase))}</p>${panelFor(state.error ? displayPhase : state.phase)}`;
    if (root.OctagonGovernedLookups) wireLookupsIn(body);
    bindPanel();
  }

  function wireLookupsIn(container) {
    container.querySelectorAll('[data-lookup-resource]').forEach((wrapper) => {
      if (wrapper.dataset.ptBound) return; wrapper.dataset.ptBound = 'true';
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

    const refreshQueue = h.querySelector('[data-role="pt-refresh-queue"]');
    if (refreshQueue) refreshQueue.addEventListener('click', async () => { await guarded(async () => { state.tasks = await fetchQueue(); render(); }); });

    h.querySelectorAll('[data-role="pt-select"]').forEach((button) => button.addEventListener('click', async () => { await guarded(async () => {
      const taskId = button.dataset.taskId;
      let task = state.tasks.find((row) => row.id === taskId);
      if (task && task.status === 'ready') task = await call('wms:pick_task_assign', { task_id: task.id, assigned_to: actorId() });
      state.task = task; state.view = 'task'; state.error = null; render();
    }); }));

    const sourceForm = h.querySelector('[data-role="pt-source-form"]');
    if (sourceForm) sourceForm.addEventListener('submit', async (event) => { event.preventDefault(); await guarded(async () => {
      const data = Object.fromEntries(new FormData(sourceForm).entries());
      state.task = await call('wms:pick_scan_source', { task_id: state.task.id, barcode: data.barcode }); render();
    }); });

    const productForm = h.querySelector('[data-role="pt-product-form"]');
    if (productForm) productForm.addEventListener('submit', async (event) => { event.preventDefault(); await guarded(async () => {
      const data = Object.fromEntries(new FormData(productForm).entries());
      state.task = await call('wms:pick_scan_product', { task_id: state.task.id, barcode: data.barcode, lot_serial: data.lot_serial || undefined }); render();
    }); });

    const confirmForm = h.querySelector('[data-role="pt-confirm-form"]');
    if (confirmForm) confirmForm.addEventListener('submit', async (event) => { event.preventDefault(); await guarded(async () => {
      const data = Object.fromEntries(new FormData(confirmForm).entries());
      const quantity = Number(data.quantity);
      if (quantity < state.task.requestedQuantity && !data.short_reason) throw new Error(rtl() ? 'أدخل سبب النقص.' : 'Enter a short-pick reason.');
      state.task = await call('wms:pick_confirm', { task_id: state.task.id, quantity, short_reason: data.short_reason || undefined }); render();
    }); });

    const stageButton = h.querySelector('[data-role="pt-stage"]');
    if (stageButton) stageButton.addEventListener('click', async () => { await guarded(async () => {
      const select = h.querySelector('[name="staging_location_id"]');
      if (!select?.value) throw new Error(rtl() ? 'اختر موقع تجهيز.' : 'Select a staging location.');
      state.task = await call('wms:pick_stage', { task_id: state.task.id, staging_location_id: select.value }); render();
    }); });

    const requestPost = h.querySelector('[data-role="pt-request-post"]');
    if (requestPost) requestPost.addEventListener('click', async () => { await guarded(async () => {
      state.task = await call('wms:pick_request_post', { task_id: state.task.id }); render();
    }); });

    const refreshTask = h.querySelector('[data-role="pt-refresh-task"]');
    if (refreshTask) refreshTask.addEventListener('click', async () => { await guarded(async () => {
      const rows = await root.OctagonApiClient.get(`/api/v1/wms/pick-tasks?warehouse_id=${encodeURIComponent(runtime()?.warehouseId || '')}`);
      const current = (Array.isArray(rows) ? rows : []).find((row) => row.id === state.task.id);
      if (current) state.task = current;
      render();
    }); });

    const ackForm = h.querySelector('[data-role="pt-ack-form"]');
    if (ackForm) ackForm.addEventListener('submit', async (event) => { event.preventDefault(); await guarded(async () => {
      const data = Object.fromEntries(new FormData(ackForm).entries());
      state.task = await call('wms:pick_acknowledge_post', { task_id: state.task.id, canonical_result_id: data.canonical_result_id }); render();
    }); });

    const backToQueue = h.querySelector('[data-role="pt-new"]');
    if (backToQueue) backToQueue.addEventListener('click', async () => { await guarded(async () => {
      state.task = null; state.view = 'queue'; state.error = null; state.tasks = await fetchQueue(); render();
    }); });
  }

  async function guarded(fn) {
    if (state.busy) return; state.busy = true;
    try { await fn(); state.error = null; }
    catch (error) { state.error = error.message; render(); }
    finally { state.busy = false; }
  }

  function activate() {
    const h = host(); if (!h) return;
    if (!h.querySelector('[data-role="pt-body"]')) h.insertAdjacentHTML('beforeend', '<div class="b09r-workspace" data-role="pt-body"></div>');
    if (state.view === 'queue' && !state.tasks.length) guarded(async () => { state.tasks = await fetchQueue(); render(); });
    else render();
  }

  root.Build09MobilePicking = { activate };
  if (root.OctagonBuild09) root.OctagonBuild09.registerPageOverride('mobile_picking', root.Build09MobilePicking);
})(window);
