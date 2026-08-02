/** BUILD-09 responsive WMS, production, quality, and performance workspaces. */
(function build09Workspaces(root) {
  'use strict';

  const PAGES = {
    warehouse_topology: ['Warehouse Topology', 'هيكل المستودع', 'hierarchy', ['id', 'name', 'code', 'type', 'active'], ['wms:zone_create', 'wms:location_create']],
    zone_bin_management: ['Zone and Bin Management', 'إدارة المناطق والخانات', 'locations', ['locationCode', 'name', 'locationType', 'zoneId', 'capacityUnits', 'active'], ['wms:location_create', 'wms:location_update', 'wms:location_set_capacity']],
    putaway_rules: ['Putaway Rules', 'قواعد الإيداع', 'putaway-rules', ['name', 'priority', 'productId', 'zoneId', 'destinationLocationId', 'active'], ['wms:putaway_rule_create', 'wms:putaway_rule_update']],
    putaway_task_queue: ['Putaway Task Queue', 'طابور مهام الإيداع', 'putaway-queue', ['taskType', 'productId', 'sourceLocationId', 'destinationLocationId', 'quantity', 'status'], ['wms:putaway_recommend', 'wms:putaway_accept', 'wms:putaway_override']],
    replenishment_rules: ['Replenishment Rules', 'قواعد إعادة التعبئة', 'replenishment-rules', ['name', 'productId', 'sourceLocationId', 'destinationLocationId', 'minimumQuantity', 'maximumQuantity', 'active'], ['wms:replenishment_rule_create']],
    replenishment_proposals: ['Replenishment Proposals', 'مقترحات إعادة التعبئة', 'replenishment-proposals', ['productId', 'requestedQuantity', 'availableQuantity', 'proposedQuantity', 'status', 'reasonCode'], ['wms:replenishment_calculate', 'wms:replenishment_approve', 'wms:replenishment_cancel']],
    mobile_receiving: ['Mobile Receiving', 'الاستلام المتنقل', 'receiving-sessions', ['reference', 'receiptType', 'status', 'expectedLineCount', 'scannedLineCount', 'startedBy'], ['wms:receiving_start', 'wms:receiving_scan_reference', 'wms:receiving_scan_product', 'wms:receiving_review'], true],
    receiving_discrepancies: ['Receiving Discrepancies', 'فروقات الاستلام', 'receiving-discrepancies', ['session_id', 'discrepancy_type', 'expected_quantity', 'actual_quantity', 'status', 'requested_by'], ['wms:receiving_discrepancy_approve', 'wms:receiving_request_post']],
    mobile_picking: ['Mobile Picking', 'الالتقاط المتنقل', 'pick-tasks', ['reference', 'productId', 'quantity', 'sourceLocationId', 'destinationLocationId', 'status'], ['wms:pick_task_assign', 'wms:pick_scan_source', 'wms:pick_scan_product', 'wms:pick_confirm', 'wms:pick_stage'], true],
    pick_task_queue: ['Pick Task Queue', 'طابور مهام الالتقاط', 'pick-tasks', ['reference', 'waveId', 'priority', 'assignedTo', 'quantity', 'status'], ['wms:pick_task_create', 'wms:pick_task_assign', 'wms:pick_request_post']],
    wave_planning: ['Wave Planning', 'تخطيط الموجات', 'waves', ['name', 'strategy', 'priority', 'plannedTaskCount', 'status', 'createdBy'], ['wms:wave_create', 'wms:wave_calculate', 'wms:wave_review']],
    wave_execution: ['Wave Execution', 'تنفيذ الموجات', 'waves', ['name', 'releasedTaskCount', 'completedTaskCount', 'exceptionCount', 'status', 'releasedBy'], ['wms:wave_release', 'wms:wave_complete', 'wms:wave_cancel']],
    cycle_count_plans: ['Cycle Count Plans', 'خطط الجرد الدوري', 'count-plans', ['name', 'frequency', 'blindCount', 'varianceTolerance', 'status', 'nextCountAt'], ['wms:count_plan_create', 'wms:count_session_start']],
    count_session: ['Count Session', 'جلسة الجرد', 'count-sessions', ['reference', 'planId', 'blindCount', 'lineCount', 'varianceCount', 'status'], ['wms:count_line_record', 'wms:count_submit', 'wms:count_recount'], true],
    variance_review: ['Variance Review', 'مراجعة الفروقات', 'count-sessions', ['reference', 'varianceCount', 'varianceValue', 'requestedBy', 'approvedBy', 'status'], ['wms:count_approve_variance', 'wms:count_request_adjustment']],
    dock_schedule: ['Dock Schedule', 'جدول الأرصفة', 'dock-appointments', ['appointmentType', 'sourceDocumentType', 'carrierName', 'expectedArrival', 'expectedDeparture', 'status'], ['wms:dock_appointment_create', 'wms:dock_assign']],
    dock_checkin: ['Dock Check-In', 'تسجيل دخول الرصيف', 'dock-appointments', ['vehicleReference', 'dockId', 'actualArrival', 'detentionStartedAt', 'checkedInBy', 'status'], ['wms:dock_check_in', 'wms:dock_start_service', 'wms:dock_depart'], true],
    staging_board: ['Staging Board', 'لوحة التجهيز', 'staging-allocations', ['staging_location_id', 'source_type', 'source_id', 'product_id', 'quantity', 'status'], ['wms:staging_allocate', 'wms:staging_release']],
    crossdock_workspace: ['Cross-Dock Workspace', 'مساحة العبور المباشر', 'crossdock-matches', ['productId', 'availableQuantity', 'demandQuantity', 'matchedQuantity', 'eligibilityScore', 'status'], ['wms:crossdock_evaluate', 'wms:crossdock_approve', 'wms:crossdock_request_post']],
    lot_serial_traceability: ['Lot / Serial Traceability', 'تتبع الدفعة والرقم التسلسلي', 'trace', ['moveId', 'sourceDocumentType', 'sourceDocumentId', 'from', 'to', 'quantity'], [], false, ['lot_id', 'serial_id']],
    expiration_queue: ['Expiration Queue', 'طابور انتهاء الصلاحية', 'expiration-queue', ['productId', 'lotId', 'serialId', 'expiryDate', 'retestDate', 'qualityStatus'], ['wms:trace_quality_set']],
    recall_analysis: ['Recall Analysis', 'تحليل السحب', 'recall-cases', ['reference', 'lotId', 'serialId', 'reason', 'status', 'identifiedAt'], ['wms:recall_identify', 'wms:recall_analyze', 'wms:recall_propose_holds']],
    shopfloor_terminal: ['Shop-Floor Terminal', 'محطة أرض المصنع', 'shopfloor-sessions', ['productionOrderId', 'workOrderId', 'operatorId', 'producedQuantity', 'rejectedQuantity', 'status'], ['shopfloor:session_open', 'shopfloor:operator_assign', 'shopfloor:operation_start', 'shopfloor:operation_output', 'shopfloor:operation_complete'], true],
    workcenter_queue: ['Work-Center Queue', 'طابور مركز العمل', 'shopfloor-sessions', ['workCenterId', 'workOrderId', 'plannedStartAt', 'operatorId', 'shiftCode', 'status'], ['shopfloor:operator_assign', 'shopfloor:operation_handoff']],
    production_material_requests: ['Production Material Requests', 'طلبات مواد الإنتاج', 'material-flow', ['productionOrderId', 'requestType', 'productId', 'requestedQuantity', 'availableQuantity', 'status'], ['shopfloor:material_request', 'shopfloor:material_availability', 'shopfloor:material_approve']],
    production_issue_return: ['Production Issue / Return', 'صرف وإرجاع الإنتاج', 'material-flow', ['requestType', 'productId', 'approvedQuantity', 'sourceLocationId', 'destinationLocationId', 'status'], ['shopfloor:material_request_canonical', 'shopfloor:material_acknowledge'], true],
    production_receipt: ['Production Receipt', 'استلام الإنتاج', 'material-flow', ['productionOrderId', 'productId', 'approvedQuantity', 'destinationLocationId', 'canonicalResultId', 'status'], ['shopfloor:material_request', 'shopfloor:material_approve', 'shopfloor:material_request_canonical'], true],
    quality_hold_queue: ['Quality Hold Queue', 'طابور حجز الجودة', 'quality-checkpoints', ['checkpointType', 'sourceType', 'productId', 'rejectedQuantity', 'reasonCode', 'status'], ['quality:checkpoint_open', 'quality:checkpoint_sync', 'quality:checkpoint_conditional_accept']],
    rework_workspace: ['Rework Workspace', 'مساحة إعادة العمل', 'rework-routes', ['route_reference', 'production_order_id', 'source_work_order_id', 'retest_required', 'status', 'created_by'], ['quality:disposition_request', 'quality:disposition_approve', 'quality:rework_start', 'quality:rework_complete']],
    scrap_approval: ['Scrap Approval', 'اعتماد الإتلاف', 'quality-dispositions', ['dispositionType', 'quantity', 'reasonCode', 'requestedBy', 'approvedBy', 'status'], ['quality:disposition_request', 'quality:disposition_approve', 'quality:scrap_request_canonical', 'quality:scrap_acknowledge']],
    downtime_board: ['Downtime Board', 'لوحة التوقف', 'downtime', ['workCenterId', 'assetReference', 'reasonCode', 'reasonCategory', 'durationMinutes', 'status'], ['shopfloor:downtime_start', 'shopfloor:downtime_end']],
    operational_performance: ['Operational Performance Dashboard', 'لوحة الأداء التشغيلي', 'work-center-performance', ['sessionId', 'availability', 'performance', 'qualityRate', 'oee', 'downtimeMinutes'], []]
  };

  const PAGE_IDS = Object.keys(PAGES);
  const states = new Map();
  const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const humanize = (value) => String(value || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  const rtl = () => document.documentElement.dir === 'rtl' || String(document.documentElement.lang).startsWith('ar');
  const config = (id) => { const row = PAGES[id]; return row && { id, title: row[0], titleAr: row[1], resource: row[2], columns: row[3], actions: row[4], mobile: Boolean(row[5]), required: row[6] || [] }; };
  const stateFor = (id) => { if (!states.has(id)) states.set(id, { phase: 'idle', rows: [], filter: '', error: '', updatedAt: null }); return states.get(id); };
  const activeCompany = () => root.__octagonBootstrap?.actor?.activeCompanyId || root.__octagonBootstrap?.activeCompanyId || root.__octagonServerSession?.activeCompanyId || '';
  const activeWarehouse = () => root.__octagonBootstrap?.warehouseId || root.__octagonServerSession?.warehouseId || localStorage.getItem('octagon_active_warehouse_id') || '';
  const canWrite = () => root.__BUILD09_FORCE_READ_ONLY__ !== true && root.__octagonBootstrap?.actions?.find?.((action) => action.id === 'db_write')?.enabled !== false;

  function workspaceMarkup(id) {
    const page = config(id); const requiredInputs = page.required.map((name) => `<label class="b09-query-field"><span>${escapeHtml(humanize(name))}</span><input data-query="${escapeHtml(name)}" autocomplete="off"></label>`).join('');
    return `<section id="${escapeHtml(id)}" class="page b09-workspace${page.mobile ? ' b09-mobile' : ''}" data-build09-page="${escapeHtml(id)}" aria-labelledby="${escapeHtml(id)}Title">
      <header class="b09-hero"><div><p class="b09-eyebrow">BUILD-09 · WMS & Operations</p><h1 id="${escapeHtml(id)}Title" data-role="title">${escapeHtml(page.title)}</h1><p data-role="subtitle"></p></div><div class="b09-scope"><span data-role="company"></span><label>Warehouse <input data-role="warehouse" autocomplete="off"></label></div></header>
      <div class="b09-query-fields">${requiredInputs}</div>
      <div class="b09-toolbar"><label class="b09-search"><span aria-hidden="true">⌕</span><span class="sr-only">Filter</span><input data-role="filter" type="search" placeholder="Filter visible records…"></label><div class="b09-actions" data-role="actions"></div></div>
      <p class="b09-notice" data-role="permission" hidden></p><p class="b09-status" data-role="status" data-phase="idle" aria-live="polite">Ready for a scoped query.</p>
      <article class="b09-card"><div class="b09-table-wrap"><table class="b09-table"><thead data-role="head"></thead><tbody data-role="rows"><tr><td class="b09-empty">Loading workspace…</td></tr></tbody></table></div>
      <footer><span>Canonical read model · company and warehouse scoped</span><span>Loading · empty · error · denied</span></footer></article></section>`;
  }

  function installPages() {
    const host = document.getElementById('mainContent'); if (!host) return;
    PAGE_IDS.forEach((id) => { if (!document.getElementById(id)) host.insertAdjacentHTML('beforeend', workspaceMarkup(id)); });
  }

  function setStatus(id, phase, text) {
    const node = document.querySelector(`[data-build09-page="${id}"] [data-role="status"]`); if (!node) return;
    node.dataset.phase = phase; node.textContent = text;
  }

  function flattenPayload(page, payload) {
    if (page.resource === 'trace') return payload?.movements || payload?.forwardTrace || [];
    if (page.resource === 'hierarchy') return payload?.locations || payload?.zones || (payload ? [payload] : []);
    if (page.resource === 'work-center-performance') return payload?.metrics || (payload ? [payload] : []);
    return Array.isArray(payload) ? payload : payload ? [payload] : [];
  }

  function display(value) {
    if (value == null || value === '') return '—';
    if (typeof value === 'number') return new Intl.NumberFormat(rtl() ? 'ar-IQ' : 'en-US', { maximumFractionDigits: 3 }).format(value);
    if (typeof value === 'boolean') return value ? (rtl() ? 'نعم' : 'Yes') : (rtl() ? 'لا' : 'No');
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }

  function renderRows(id) {
    const page = config(id), state = stateFor(id), body = document.querySelector(`[data-build09-page="${id}"] [data-role="rows"]`); if (!body) return;
    const needle = state.filter.toLowerCase(); const rows = needle ? state.rows.filter((row) => JSON.stringify(row).toLowerCase().includes(needle)) : state.rows;
    if (!rows.length) { body.innerHTML = `<tr><td colspan="${escapeHtml(page.columns.length)}" class="b09-empty"><strong>${rtl() ? 'لا توجد سجلات' : 'No records yet'}</strong><span>${rtl() ? 'غيّر المرشح أو نطاق المستودع ثم حدّث.' : 'Change the filter or warehouse scope, then refresh.'}</span></td></tr>`; return; }
    body.innerHTML = rows.map((row) => `<tr data-record-id="${escapeHtml(row.id || row.sessionId || '')}">${page.columns.map((column) => `<td data-label="${escapeHtml(humanize(column))}">${escapeHtml(display(row[column]))}</td>`).join('')}</tr>`).join('');
  }

  function renderPage(id) {
    const page = config(id), host = document.querySelector(`[data-build09-page="${id}"]`); if (!page || !host) return;
    host.querySelector('[data-role="title"]').textContent = rtl() ? page.titleAr : page.title;
    host.querySelector('[data-role="subtitle"]').textContent = rtl() ? 'مساحة تشغيلية محكومة، مرتبطة بالسلطات الأساسية والتدقيق.' : 'Governed operational workspace linked to canonical authorities and audit.';
    host.querySelector('[data-role="company"]').textContent = `${rtl() ? 'الشركة' : 'Company'}: ${activeCompany() || '—'}`;
    host.querySelector('[data-role="warehouse"]').value = activeWarehouse();
    host.querySelector('[data-role="head"]').innerHTML = `<tr>${page.columns.map((column) => `<th>${escapeHtml(humanize(column))}</th>`).join('')}</tr>`;
    const writable = canWrite();
    host.querySelector('[data-role="actions"]').innerHTML = `<button class="b09-button b09-primary" data-command="refresh">↻ ${rtl() ? 'تحديث' : 'Refresh'}</button><button class="b09-button" data-command="export">⇩ CSV</button>${page.actions.map((action) => `<button class="b09-button" data-action="${escapeHtml(action)}" ${writable ? '' : 'disabled'}>${escapeHtml(humanize(action.split(':').slice(1).join(' ')))}</button>`).join('')}`;
    const notice = host.querySelector('[data-role="permission"]'); notice.hidden = writable || !page.actions.length; notice.textContent = rtl() ? 'صلاحية القراءة فقط: الإجراءات التغييرية معطلة.' : 'Read-only permission: mutation actions are disabled.';
    renderRows(id); bindPage(id);
  }

  function queryParams(id) {
    const host = document.querySelector(`[data-build09-page="${id}"]`); const warehouse = host.querySelector('[data-role="warehouse"]').value.trim();
    if (!warehouse) return { error: rtl() ? 'اختر مستودعاً قبل التحميل.' : 'Enter a warehouse before loading.' };
    localStorage.setItem('octagon_active_warehouse_id', warehouse); const params = new URLSearchParams({ warehouse_id: warehouse });
    for (const input of host.querySelectorAll('[data-query]')) if (input.value.trim()) params.set(input.dataset.query, input.value.trim());
    const page = config(id); if (page.resource === 'trace' && !params.has('lot_id') && !params.has('serial_id')) return { error: rtl() ? 'أدخل معرف دفعة أو رقم تسلسلي.' : 'Enter a lot or serial identifier.' };
    return { params };
  }

  async function fetchRows(id) {
    const page = config(id), state = stateFor(id), query = queryParams(id);
    if (query.error) { state.phase = 'empty'; state.rows = []; renderRows(id); setStatus(id, 'empty', query.error); return []; }
    state.phase = 'loading'; setStatus(id, 'loading', rtl() ? 'جارِ تحميل البيانات…' : 'Loading data…');
    try {
      const response = await fetch(`/api/v1/wms/${encodeURIComponent(page.resource)}?${query.params}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const payload = await response.json().catch(() => ({})); if (!response.ok || payload.success === false) throw new Error(payload.error || `HTTP ${response.status}`);
      state.rows = flattenPayload(page, payload.data); state.phase = state.rows.length ? 'ready' : 'empty'; state.error = ''; state.updatedAt = new Date(); renderRows(id);
      setStatus(id, state.phase, state.rows.length ? `${state.rows.length} ${rtl() ? 'سجل' : 'records'} · ${state.updatedAt.toLocaleTimeString()}` : (rtl() ? 'لا توجد بيانات ضمن النطاق الحالي.' : 'No data in the current scope.'));
      return state.rows;
    } catch (error) {
      state.rows = []; state.error = error.message; state.phase = /403|permission|denied/i.test(error.message) ? 'denied' : 'error'; renderRows(id); setStatus(id, state.phase, `${rtl() ? 'تعذر التحميل' : 'Unable to load'}: ${error.message}`); return [];
    }
  }

  function actionDialog(id, actionId) {
    if (!canWrite()) { setStatus(id, 'denied', rtl() ? 'لا تملك صلاحية هذا الإجراء.' : 'You do not have permission for this action.'); return; }
    const dialog = document.getElementById('build09ActionDialog'); dialog.dataset.page = id; dialog.dataset.action = actionId;
    dialog.querySelector('[data-role="action-name"]').textContent = actionId; const warehouse = document.querySelector(`[data-build09-page="${id}"] [data-role="warehouse"]`).value.trim();
    dialog.querySelector('textarea').value = JSON.stringify({ warehouse_id: warehouse, idempotency_key: `${actionId}-${Date.now()}` }, null, 2); dialog.querySelector('[data-role="dialog-error"]').textContent = '';
    if (dialog.showModal) dialog.showModal(); else dialog.hidden = false;
  }

  async function submitAction() {
    const dialog = document.getElementById('build09ActionDialog'), id = dialog.dataset.page, actionId = dialog.dataset.action, errorNode = dialog.querySelector('[data-role="dialog-error"]'); let input;
    try { input = JSON.parse(dialog.querySelector('textarea').value || '{}'); } catch (error) { errorNode.textContent = `Invalid JSON: ${error.message}`; return; }
    const button = dialog.querySelector('[data-command="submit"]'); button.disabled = true;
    try {
      const response = await fetch(`/api/v1/action/${encodeURIComponent(actionId)}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      const payload = await response.json().catch(() => ({})); if (!response.ok || payload.success === false) throw new Error(payload.error || `HTTP ${response.status}`);
      if (dialog.close) dialog.close(); else dialog.hidden = true; setStatus(id, 'success', rtl() ? 'تم الإجراء وتسجيله في التدقيق.' : 'Action completed and recorded in audit.'); await fetchRows(id);
    } catch (error) { errorNode.textContent = error.message; } finally { button.disabled = false; }
  }

  function exportCsv(id) {
    const page = config(id), rows = stateFor(id).rows, quote = (value) => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
    const csv = [page.columns.map(quote).join(','), ...rows.map((row) => page.columns.map((column) => quote(display(row[column]))).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = `${id}.csv`; link.click(); URL.revokeObjectURL(url);
  }

  function bindPage(id) {
    const host = document.querySelector(`[data-build09-page="${id}"]`); if (host.dataset.bound) return; host.dataset.bound = 'true';
    host.addEventListener('click', (event) => { const button = event.target.closest('button'); if (!button) return; if (button.dataset.command === 'refresh') fetchRows(id); if (button.dataset.command === 'export') exportCsv(id); if (button.dataset.action) actionDialog(id, button.dataset.action); });
    host.querySelector('[data-role="filter"]').addEventListener('input', (event) => { stateFor(id).filter = event.target.value; renderRows(id); });
    host.querySelector('[data-role="warehouse"]').addEventListener('change', () => fetchRows(id));
  }

  function installDialog() {
    if (document.getElementById('build09ActionDialog')) return;
    document.body.insertAdjacentHTML('beforeend', `<dialog id="build09ActionDialog" class="b09-dialog"><form method="dialog"><header><div><small>BUILD-09 governed action</small><h2 data-role="action-name"></h2></div><button value="cancel" aria-label="Close">×</button></header><p>${rtl() ? 'أدخل حمولة JSON. يتحقق الخادم من الشركة والمستودع والصلاحية.' : 'Enter the JSON payload. The server validates company, warehouse, and permission.'}</p><textarea rows="13" spellcheck="false"></textarea><p data-role="dialog-error" class="b09-dialog-error"></p><footer><button value="cancel" class="b09-button">${rtl() ? 'إلغاء' : 'Cancel'}</button><button type="button" class="b09-button b09-primary" data-command="submit">${rtl() ? 'تنفيذ' : 'Run'}</button></footer></form></dialog>`);
    document.querySelector('#build09ActionDialog [data-command="submit"]').addEventListener('click', submitAction);
  }

  async function activate(id) {
    if (!PAGES[id] || (root.PermissionService && !root.PermissionService.checkPage(id))) return;
    document.querySelectorAll('.page').forEach((node) => node.classList.remove('page-active')); document.querySelectorAll('.nav-btn').forEach((node) => node.classList.toggle('active', node.dataset.page === id));
    const host = document.querySelector(`[data-build09-page="${id}"]`); host.classList.add('page-active'); renderPage(id); await fetchRows(id);
  }

  function wrapNavigation() {
    const previous = root.switchPage; if (previous?.__build09Wrapper) return;
    const wrapped = function switchBuild09Page(id) { const result = typeof previous === 'function' ? previous.apply(this, arguments) : undefined; if (PAGES[id]) Promise.resolve(result).then(() => activate(id)); return result; };
    wrapped.__build09Wrapper = true; wrapped.__previous = previous; root.switchPage = wrapped;
  }

  function initialize() {
    installPages(); installDialog(); wrapNavigation();
    document.addEventListener('octagon:language-changed', () => PAGE_IDS.forEach((id) => { if (document.querySelector(`[data-build09-page="${id}"]`)) renderPage(id); }));
  }

  root.OctagonBuild09 = { pages: PAGES, activate, fetchRows, renderPage, stateFor, canWrite };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true }); else initialize();
})(window);
