/** BUILD-08 planning, treasury, intercompany and consolidation workspaces. */
(function build08Workspaces(root) {
  'use strict';

  const PAGE_DEFINITIONS = {
    demand_planning: ['Demand Planning', 'تخطيط الطلب', 'planning/horizons', ['name', 'bucket_type', 'start_date', 'end_date', 'status'], ['forecast:version_create']],
    forecast_versions: ['Forecast Versions', 'إصدارات التنبؤ', 'planning/forecasts', ['name', 'method', 'horizon_id', 'status', 'published_at'], ['forecast:calculate', 'forecast:publish']],
    forecast_overrides: ['Forecast Overrides', 'تعديلات التنبؤ', 'planning/overrides', ['version_id', 'product_id', 'bucket_start', 'requested_quantity', 'status'], ['forecast:override_submit', 'forecast:override_approve']],
    forecast_accuracy: ['Forecast Accuracy', 'دقة التنبؤ', 'planning/forecasts', ['name', 'method', 'calculated_at', 'status', 'published_at'], ['forecast:calculate']],
    planning_exceptions: ['Planning Exceptions', 'استثناءات التخطيط', 'planning/exceptions', ['exception_type', 'severity', 'product_id', 'message', 'status'], []],
    mps: ['Master Production Schedule', 'جدول الإنتاج الرئيسي', 'mps/runs', ['name', 'forecast_version_id', 'horizon_id', 'status', 'created_at'], ['mps:run']],
    mps_proposals: ['MPS Proposals', 'مقترحات جدول الإنتاج', 'mps/proposals', ['proposal_type', 'product_id', 'quantity', 'required_date', 'status'], ['mps:proposal_approve', 'mps:proposal_release_request']],
    supply_demand_balance: ['Supply / Demand Balance', 'توازن العرض والطلب', 'mps/balance-latest', ['product_id', 'bucket_start', 'gross_requirement', 'scheduled_receipts', 'projected_available', 'warning_code'], ['mps:run']],
    sop_scenarios: ['S&OP Scenarios', 'سيناريوهات المبيعات والعمليات', 'sop/scenarios', ['name', 'cycle_id', 'demand_total', 'supply_total', 'financial_total', 'status'], ['sop:scenario_create']],
    sop_review: ['S&OP Review', 'مراجعة المبيعات والعمليات', 'sop/cycles', ['name', 'period_start', 'period_end', 'selected_scenario_id', 'status'], ['sop:cycle_create', 'sop:review_approve', 'sop:publish']],
    treasury_cash_position: ['Treasury Cash Position', 'مركز النقد بالخزينة', 'treasury/positions', ['as_of_date', 'currency', 'bank_balance', 'restricted_cash', 'available_cash'], ['treasury:position_capture']],
    liquidity_forecast: ['Liquidity Forecast', 'تنبؤ السيولة', 'treasury/liquidity-forecasts', ['name', 'as_of_date', 'horizon_end', 'currency', 'status'], ['treasury:liquidity_generate']],
    treasury_alerts: ['Treasury Alerts', 'تنبيهات الخزينة', 'treasury/alerts', ['alert_type', 'severity', 'bucket_start', 'shortfall_amount', 'status'], ['treasury:alert_acknowledge']],
    payment_funding_proposals: ['Payment / Funding Proposals', 'مقترحات الدفع والتمويل', 'treasury/proposals', ['proposal_type', 'amount', 'currency', 'required_date', 'status'], ['treasury:proposal_create', 'treasury:proposal_approve']],
    financing_facilities: ['Financing Facilities', 'تسهيلات التمويل', 'treasury/facilities', ['name', 'facility_type', 'limit_amount', 'available_amount', 'end_date', 'status'], ['treasury:facility_create', 'treasury:facility_utilize']],
    intercompany_transactions: ['Intercompany Transactions', 'معاملات الشركات الشقيقة', 'intercompany/operations', ['reference', 'transaction_type', 'source_company_id', 'target_company_id', 'source_amount', 'status'], ['intercompany:operation_create', 'intercompany:operation_approve']],
    mismatch_queue: ['Mismatch Queue', 'قائمة عدم التطابق', 'intercompany/mismatches', ['mismatch_type', 'operation_id', 'difference_amount', 'severity', 'status'], ['intercompany:mismatch_detect']],
    intercompany_reconciliation: ['Intercompany Reconciliation', 'تسوية الشركات الشقيقة', 'intercompany/reconciliations', ['operation_id', 'resolution_type', 'approved_by', 'approved_at'], ['intercompany:reconcile', 'intercompany:settlement_propose']],
    consolidation_groups: ['Consolidation Groups', 'مجموعات التوحيد', 'consolidation/groups', ['name', 'parent_company_id', 'presentation_currency', 'status', 'created_at'], ['consolidation:group_create', 'consolidation:member_add']],
    account_mapping: ['Account Mapping', 'ربط الحسابات', 'consolidation/mappings', ['company_id', 'source_account_code', 'target_account_code', 'mapping_type', 'status'], ['consolidation:mapping_upsert']],
    consolidation_runs: ['Consolidation Runs', 'عمليات التوحيد', 'consolidation/runs', ['period_id', 'presentation_currency', 'status', 'calculated_at', 'finalized_at'], ['consolidation:period_create', 'consolidation:snapshot_capture', 'consolidation:run_calculate', 'consolidation:finalize']],
    eliminations: ['Eliminations', 'قيود الاستبعاد', 'consolidation/eliminations', ['elimination_type', 'debit_account', 'credit_account', 'amount', 'status'], ['consolidation:elimination_approve']],
    consolidated_reports: ['Consolidated Reports', 'التقارير الموحدة', 'consolidation/reports', ['target_account_code', 'target_account_name', 'statement_type', 'translated_debit', 'translated_credit', 'consolidated_balance'], []],
    consolidation_lineage: ['Consolidation Lineage', 'تتبع التوحيد', 'consolidation/lineage', ['balance_id', 'snapshot_id', 'source_line_id', 'contribution_amount', 'lineage_type', 'created_at'], []]
  };

  const PAGE_IDS = Object.keys(PAGE_DEFINITIONS);
  const states = new Map();
  const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const humanize = (value) => String(value || '').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  // Every column header, cell label, action button and dialog title on these 24
  // pages was produced by humanize() straight off the snake_case field or action
  // id, so an Arabic page rendered English chrome: "Facility Create",
  // "Projected Available", "Shortfall Amount". The page titles were already
  // bilingual; only the generated labels were not.
  //
  // Translated once here and consumed by all four render points rather than
  // rewriting the definition table, so adding a page still only needs the
  // snake_case names. Anything unmapped falls back to humanize() unchanged.
  const AR_FIELDS = {
    alert_type: 'نوع التنبيه', amount: 'المبلغ', approved_at: 'تاريخ الاعتماد',
    approved_by: 'اعتمده', as_of_date: 'كما في تاريخ', available_amount: 'المبلغ المتاح',
    available_cash: 'النقد المتاح', balance_id: 'مرجع الرصيد', bank_balance: 'رصيد البنك',
    bucket_start: 'بداية الفترة', bucket_type: 'نوع الفترة', calculated_at: 'تاريخ الاحتساب',
    company_id: 'الشركة', consolidated_balance: 'الرصيد الموحد',
    contribution_amount: 'مبلغ المساهمة', created_at: 'تاريخ الإنشاء',
    credit_account: 'الحساب الدائن', currency: 'العملة', cycle_id: 'الدورة',
    debit_account: 'الحساب المدين', demand_total: 'إجمالي الطلب',
    difference_amount: 'مبلغ الفرق', elimination_type: 'نوع الاستبعاد',
    end_date: 'تاريخ الانتهاء', exception_type: 'نوع الاستثناء',
    facility_type: 'نوع التسهيل', finalized_at: 'تاريخ الإقفال',
    financial_total: 'الإجمالي المالي', forecast_version_id: 'إصدار التنبؤ',
    gross_requirement: 'الاحتياج الإجمالي', horizon_end: 'نهاية الأفق',
    horizon_id: 'أفق التخطيط', limit_amount: 'سقف التسهيل', lineage_type: 'نوع التتبع',
    mapping_type: 'نوع الربط', message: 'الرسالة', method: 'الطريقة',
    mismatch_type: 'نوع عدم التطابق', name: 'الاسم', operation_id: 'العملية',
    parent_company_id: 'الشركة الأم', period_end: 'نهاية الفترة', period_id: 'الفترة',
    period_start: 'بداية الفترة', presentation_currency: 'عملة العرض',
    product_id: 'الصنف', projected_available: 'المتاح المتوقع', proposal_type: 'نوع المقترح',
    published_at: 'تاريخ النشر', quantity: 'الكمية', reference: 'المرجع',
    required_date: 'التاريخ المطلوب', requested_quantity: 'الكمية المطلوبة',
    resolution_type: 'نوع التسوية', restricted_cash: 'النقد المقيّد',
    scheduled_receipts: 'الاستلامات المجدولة', selected_scenario_id: 'السيناريو المعتمد',
    severity: 'الخطورة', shortfall_amount: 'مبلغ العجز', snapshot_id: 'اللقطة',
    source_account_code: 'رمز الحساب المصدر', source_amount: 'مبلغ المصدر',
    source_company_id: 'الشركة المصدر', source_line_id: 'سطر المصدر',
    start_date: 'تاريخ البدء', statement_type: 'نوع القائمة', status: 'الحالة',
    supply_total: 'إجمالي العرض', target_account_code: 'رمز الحساب الهدف',
    target_account_name: 'اسم الحساب الهدف', target_company_id: 'الشركة الهدف',
    transaction_type: 'نوع المعاملة', translated_credit: 'الدائن المحوَّل',
    translated_debit: 'المدين المحوَّل', version_id: 'الإصدار', warning_code: 'رمز التحذير',
  };
  const AR_ACTIONS = {
    alert_acknowledge: 'إقرار التنبيه', calculate: 'احتساب', cycle_create: 'إنشاء دورة',
    elimination_approve: 'اعتماد الاستبعاد', facility_create: 'إنشاء تسهيل',
    facility_utilize: 'سحب من التسهيل', finalize: 'إقفال نهائي',
    group_create: 'إنشاء مجموعة', liquidity_generate: 'توليد تنبؤ السيولة',
    mapping_upsert: 'حفظ الربط', member_add: 'إضافة عضو',
    mismatch_detect: 'كشف عدم التطابق', operation_approve: 'اعتماد العملية',
    operation_create: 'إنشاء عملية', override_approve: 'اعتماد التعديل',
    override_submit: 'تقديم تعديل', period_create: 'إنشاء فترة',
    position_capture: 'التقاط مركز النقد', proposal_approve: 'اعتماد المقترح',
    proposal_create: 'إنشاء مقترح', proposal_release_request: 'طلب إطلاق المقترح',
    publish: 'نشر', reconcile: 'تسوية', review_approve: 'اعتماد المراجعة',
    run: 'تشغيل', run_calculate: 'تشغيل الاحتساب', scenario_create: 'إنشاء سيناريو',
    settlement_propose: 'اقتراح تسوية', snapshot_capture: 'التقاط لقطة',
    version_create: 'إنشاء إصدار',
  };
  const fieldLabel = (key) => (isArabic() && AR_FIELDS[key]) ? AR_FIELDS[key] : humanize(key);
  const actionLabel = (key) => (isArabic() && AR_ACTIONS[key]) ? AR_ACTIONS[key] : humanize(key);
  const isArabic = () => (document.documentElement.dir || '').toLowerCase() === 'rtl' || (document.documentElement.lang || '').toLowerCase().startsWith('ar');
  const definition = (pageId) => {
    const raw = PAGE_DEFINITIONS[pageId];
    return raw && { id: pageId, title: raw[0], titleAr: raw[1], endpoint: raw[2], columns: raw[3], actions: raw[4] };
  };
  const company = () => {
    const bootstrap = root.__octagonBootstrap || {};
    return bootstrap.context?.companyId || bootstrap.actor?.activeCompanyId || bootstrap.activeCompanyId || root.__octagonServerSession?.activeCompanyId || '—';
  };
  const canWrite = () => {
    if (root.__BUILD08_FORCE_READ_ONLY__ === true) return false;
    const actions = root.__octagonBootstrap?.actions;
    if (Array.isArray(actions)) {
      const write = actions.find((action) => action.id === 'db_write');
      if (write) return write.enabled === true;
    }
    return true;
  };
  const stateFor = (pageId) => {
    if (!states.has(pageId)) states.set(pageId, { phase: 'idle', rows: [], error: '', filter: '', updatedAt: null });
    return states.get(pageId);
  };

  function setStatus(pageId, phase, message) {
    const status = document.querySelector(`[data-build08-page="${pageId}"] [data-role="status"]`);
    if (!status) return;
    status.dataset.phase = phase;
    status.textContent = message;
  }

  function formatValue(value) {
    if (value == null || value === '') return '—';
    if (typeof value === 'number') return new Intl.NumberFormat(isArabic() ? 'ar-IQ' : 'en-US', { maximumFractionDigits: 2 }).format(value);
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  function renderTable(pageId) {
    const config = definition(pageId);
    const state = stateFor(pageId);
    const body = document.querySelector(`[data-build08-page="${pageId}"] [data-role="rows"]`);
    if (!config || !body) return;
    const needle = state.filter.toLowerCase();
    const rows = needle ? state.rows.filter((row) => JSON.stringify(row).toLowerCase().includes(needle)) : state.rows;
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="${escapeHtml(config.columns.length)}" class="b08-empty"><strong>${escapeHtml(isArabic() ? 'لا توجد سجلات' : 'No records yet')}</strong><span>${escapeHtml(isArabic() ? 'غيّر المرشح أو نفّذ إجراءً ثم حدّث الصفحة.' : 'Change the filter or run an action, then refresh.')}</span></td></tr>`;
      return;
    }
    body.innerHTML = rows.map((row) => `<tr data-record-id="${escapeHtml(row.id || '')}">${config.columns.map((column) => `<td data-label="${escapeHtml(fieldLabel(column))}">${escapeHtml(formatValue(row[column]))}</td>`).join('')}</tr>`).join('');
  }

  function renderPage(pageId) {
    const config = definition(pageId);
    const host = document.querySelector(`[data-build08-page="${pageId}"]`);
    if (!config || !host) return;
    const title = isArabic() ? config.titleAr : config.title;
    host.querySelector('[data-role="title"]').textContent = title;
    host.querySelector('[data-role="subtitle"]').textContent = isArabic()
      ? 'مساحة عمل محكومة بنطاق الشركة مع مصدر بيانات وخط تدقيق موحّد.'
      : 'Company-scoped workspace with a governed data source and audit trail.';
    host.querySelector('[data-role="company"]').textContent = `${isArabic() ? 'الشركة' : 'Company'}: ${company()}`;
    const head = host.querySelector('[data-role="head"]');
    head.innerHTML = `<tr>${config.columns.map((column) => `<th scope="col">${escapeHtml(fieldLabel(column))}</th>`).join('')}</tr>`;
    const actionBar = host.querySelector('[data-role="actions"]');
    const writeAllowed = canWrite();
    actionBar.innerHTML = [
      `<button class="b08-button b08-primary" type="button" data-command="refresh">↻ ${isArabic() ? 'تحديث' : 'Refresh'}</button>`,
      `<button class="b08-button" type="button" data-command="export">⇩ ${isArabic() ? 'تصدير CSV' : 'Export CSV'}</button>`,
      ...config.actions.map((action) => `<button class="b08-button" type="button" data-action-id="${escapeHtml(action)}" ${writeAllowed ? '' : 'disabled aria-disabled="true"'}>${escapeHtml(actionLabel(action.split(':')[1]))}</button>`)
    ].join('');
    const permission = host.querySelector('[data-role="permission"]');
    permission.hidden = writeAllowed || !config.actions.length;
    permission.textContent = isArabic() ? 'صلاحية القراءة فقط: الإجراءات التغييرية معطلة.' : 'Read-only permission: mutation actions are disabled.';
    bindPage(pageId);
    renderTable(pageId);
  }

  async function fetchRows(pageId) {
    const config = definition(pageId);
    const state = stateFor(pageId);
    state.phase = 'loading';
    setStatus(pageId, 'loading', isArabic() ? 'جارِ تحميل البيانات…' : 'Loading data…');
    try {
      const response = await fetch(`/api/v1/${config.endpoint}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) throw new Error(payload.error?.message || payload.error || `${response.status} ${response.statusText}`);
      state.rows = Array.isArray(payload.data) ? payload.data : payload.data ? [payload.data] : [];
      state.phase = state.rows.length ? 'ready' : 'empty';
      state.error = '';
      state.updatedAt = new Date();
      renderTable(pageId);
      setStatus(pageId, state.phase, state.rows.length
        ? `${state.rows.length} ${isArabic() ? 'سجل — آخر تحديث' : 'records — updated'} ${state.updatedAt.toLocaleTimeString()}`
        : (isArabic() ? 'لا توجد بيانات ضمن الشركة الحالية.' : 'No data in the active company scope.'));
      return state.rows;
    } catch (error) {
      state.phase = error.message.includes('403') ? 'denied' : 'error';
      state.error = error.message;
      state.rows = [];
      renderTable(pageId);
      setStatus(pageId, state.phase, `${isArabic() ? 'تعذر التحميل' : 'Unable to load'}: ${error.message}`);
      return [];
    }
  }

  function openActionDialog(pageId, actionId) {
    if (!canWrite()) {
      setStatus(pageId, 'denied', isArabic() ? 'لا تملك صلاحية تنفيذ هذا الإجراء.' : 'You do not have permission to run this action.');
      return;
    }
    const dialog = document.getElementById('build08ActionDialog');
    if (!dialog) return;
    dialog.dataset.pageId = pageId;
    dialog.dataset.actionId = actionId;
    dialog.querySelector('[data-role="dialog-title"]').textContent = actionLabel(String(actionId).split(':')[1]);
    dialog.querySelector('[data-role="action-id"]').textContent = actionId;
    dialog.querySelector('textarea').value = JSON.stringify({ idempotency_key: `${actionId}-${Date.now()}` }, null, 2);
    dialog.querySelector('[data-role="dialog-error"]').textContent = '';
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.hidden = false;
  }

  async function submitAction(dialog) {
    const pageId = dialog.dataset.pageId;
    const actionId = dialog.dataset.actionId;
    const errorBox = dialog.querySelector('[data-role="dialog-error"]');
    let input;
    try { input = JSON.parse(dialog.querySelector('textarea').value || '{}'); }
    catch (error) { errorBox.textContent = `${isArabic() ? 'JSON غير صالح' : 'Invalid JSON'}: ${error.message}`; return; }
    const submit = dialog.querySelector('[data-command="submit-action"]');
    submit.disabled = true;
    errorBox.textContent = isArabic() ? 'جارِ التنفيذ…' : 'Running…';
    try {
      const response = await fetch(`/api/v1/action/${actionId}`, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) throw new Error(payload.error?.message || payload.error || `HTTP ${response.status}`);
      if (typeof dialog.close === 'function') dialog.close(); else dialog.hidden = true;
      setStatus(pageId, 'success', isArabic() ? 'تم تنفيذ الإجراء وتسجيله في مسار التدقيق.' : 'Action completed and recorded in the audit trail.');
      await fetchRows(pageId);
    } catch (error) { errorBox.textContent = error.message; }
    finally { submit.disabled = false; }
  }

  function exportCsv(pageId) {
    const config = definition(pageId);
    const state = stateFor(pageId);
    const quote = (value) => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
    const csv = [config.columns.map(quote).join(','), ...state.rows.map((row) => config.columns.map((column) => quote(formatValue(row[column]))).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${pageId}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function bindPage(pageId) {
    const host = document.querySelector(`[data-build08-page="${pageId}"]`);
    if (!host || host.dataset.bound === 'true') return;
    host.dataset.bound = 'true';
    host.addEventListener('click', (event) => {
      const target = event.target.closest('button');
      if (!target) return;
      if (target.dataset.command === 'refresh') fetchRows(pageId);
      if (target.dataset.command === 'export') exportCsv(pageId);
      if (target.dataset.actionId) openActionDialog(pageId, target.dataset.actionId);
    });
    host.querySelector('[data-role="filter"]').addEventListener('input', (event) => {
      stateFor(pageId).filter = event.target.value;
      renderTable(pageId);
    });
  }

  function installDialog() {
    if (document.getElementById('build08ActionDialog')) return;
    document.body.insertAdjacentHTML('beforeend', `<dialog id="build08ActionDialog" class="b08-dialog" aria-labelledby="build08DialogTitle">
      <form method="dialog" class="b08-dialog-card">
        <header><div><small data-role="action-id"></small><h2 id="build08DialogTitle" data-role="dialog-title"></h2></div><button value="cancel" aria-label="Close">×</button></header>
        <p>${isArabic() ? 'أدخل حمولة الإجراء. يتحقق الخادم من الشركة والصلاحية وسير العمل.' : 'Enter the action payload. The server validates company, permission, and workflow.'}</p>
        <label>${isArabic() ? 'حمولة JSON' : 'JSON payload'}<textarea rows="12" spellcheck="false"></textarea></label>
        <p class="b08-dialog-error" data-role="dialog-error" aria-live="polite"></p>
        <footer><button value="cancel" class="b08-button">${isArabic() ? 'إلغاء' : 'Cancel'}</button><button type="button" class="b08-button b08-primary" data-command="submit-action">${isArabic() ? 'تنفيذ' : 'Run action'}</button></footer>
      </form></dialog>`);
    const dialog = document.getElementById('build08ActionDialog');
    dialog.querySelector('[data-command="submit-action"]').addEventListener('click', () => submitAction(dialog));
  }

  async function activate(pageId) {
    if (!PAGE_DEFINITIONS[pageId]) return;
    document.querySelectorAll('.page').forEach((page) => page.classList.remove('page-active'));
    document.querySelectorAll('.nav-btn').forEach((button) => button.classList.toggle('active', button.dataset.page === pageId));
    const host = document.querySelector(`[data-build08-page="${pageId}"]`);
    if (!host) return;
    host.classList.add('page-active');
    renderPage(pageId);
    await fetchRows(pageId);
  }

  function installNavigationWrapper() {
    const previous = root.switchPage;
    if (previous?.__build08Wrapper) return;
    const wrapped = function switchBuild08Page(pageId) {
      const result = typeof previous === 'function' ? previous.apply(this, arguments) : undefined;
      if (PAGE_DEFINITIONS[pageId]) Promise.resolve(result).then(() => activate(pageId));
      return result;
    };
    wrapped.__build08Wrapper = true;
    wrapped.__previous = previous;
    root.switchPage = wrapped;
  }

  function initialize() {
    installDialog();
    installNavigationWrapper();
    document.addEventListener('octagon:language-changed', () => {
      PAGE_IDS.forEach((pageId) => { if (document.querySelector(`[data-build08-page="${pageId}"]`)) renderPage(pageId); });
    });
  }

  root.OctagonBuild08 = { pages: PAGE_DEFINITIONS, activate, fetchRows, renderPage, canWrite, stateFor };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})(window);
