/** BUILD-09 responsive WMS, production, quality, and performance workspaces. */
(function build09Workspaces(root) {
  'use strict';

  // filters: [name, [labelEn, labelAr], [[value, optionEn, optionAr], ...]] — optional data-query selects, independent of `required`.
  const STATUS = (options) => ['status', ['Status', 'الحالة'], options];
  const PAGES = {
    warehouse_topology: ['Warehouse Topology', 'هيكل المستودع', 'hierarchy', ['id', 'name', 'code', 'type', 'active'], ['wms:zone_create', 'wms:location_create'], false, [], ['No zones or locations are configured for this warehouse yet.', 'لم يتم تهيئة أي مناطق أو مواقع لهذا المستودع بعد.']],
    zone_bin_management: ['Zone and Bin Management', 'إدارة المناطق والخانات', 'locations', ['locationCode', 'name', 'locationType', 'zoneId', 'capacityUnits', 'active'], ['wms:location_create', 'wms:location_update', 'wms:location_set_capacity'], false, [], ['No locations exist in this warehouse yet. Create one to get started.', 'لا توجد مواقع في هذا المستودع بعد. أنشئ موقعاً للبدء.'], [['locationType', ['Location type', 'نوع الموقع'], [['bin', 'Bin', 'صندوق'], ['shelf', 'Shelf', 'رف'], ['floor', 'Floor', 'أرضية'], ['dock', 'Dock', 'رصيف'], ['staging', 'Staging', 'تجهيز']]]]],
    putaway_rules: ['Putaway Rules', 'قواعد الإيداع', 'putaway-rules', ['name', 'priority', 'productId', 'zoneId', 'destinationLocationId', 'active'], ['wms:putaway_rule_create', 'wms:putaway_rule_update'], false, [], ['No putaway rules are configured for this warehouse.', 'لا توجد قواعد إيداع مهيأة لهذا المستودع.'], [['active', ['Active only', 'النشطة فقط'], [['1', 'Active', 'نشطة'], ['0', 'Inactive', 'غير نشطة']]]]],
    putaway_task_queue: ['Putaway Task Queue', 'طابور مهام الإيداع', 'putaway-queue', ['taskType', 'productId', 'sourceLocationId', 'destinationLocationId', 'quantity', 'status'], ['wms:putaway_recommend', 'wms:putaway_accept', 'wms:putaway_override'], false, [], ['The putaway queue is empty — nothing is waiting to be put away.', 'طابور الإيداع فارغ — لا يوجد شيء بانتظار الإيداع.'], [STATUS([['suggested', 'Suggested', 'مقترح'], ['task_created', 'Task created', 'تم إنشاء المهمة'], ['completed', 'Completed', 'مكتمل'], ['exception', 'Exception', 'استثناء']])]],
    replenishment_rules: ['Replenishment Rules', 'قواعد إعادة التعبئة', 'replenishment-rules', ['name', 'productId', 'sourceLocationId', 'destinationLocationId', 'minimumQuantity', 'maximumQuantity', 'active'], ['wms:replenishment_rule_create'], false, [], ['No replenishment rules exist for this warehouse.', 'لا توجد قواعد إعادة تعبئة لهذا المستودع.']],
    replenishment_proposals: ['Replenishment Proposals', 'مقترحات إعادة التعبئة', 'replenishment-proposals', ['productId', 'requestedQuantity', 'availableQuantity', 'proposedQuantity', 'status', 'reasonCode'], ['wms:replenishment_calculate', 'wms:replenishment_approve', 'wms:replenishment_cancel'], false, [], ['No replenishment proposals are pending review.', 'لا توجد مقترحات تعبئة قيد المراجعة.'], [STATUS([['proposed', 'Proposed', 'مقترح'], ['approved', 'Approved', 'معتمد'], ['cancelled', 'Cancelled', 'ملغى']])]],
    mobile_receiving: ['Mobile Receiving', 'الاستلام المتنقل', 'receiving-sessions', ['reference', 'receiptType', 'status', 'expectedLineCount', 'scannedLineCount', 'startedBy'], ['wms:receiving_start', 'wms:receiving_scan_reference', 'wms:receiving_scan_product', 'wms:receiving_review'], true, [], ['No receiving sessions exist in this warehouse.', 'لا توجد جلسات استلام في هذا المستودع.'], [STATUS([['draft', 'Draft', 'مسودة'], ['scanning', 'Scanning', 'قيد المسح'], ['ready', 'Ready', 'جاهز'], ['putaway_pending', 'Putaway pending', 'بانتظار الإيداع'], ['completed', 'Completed', 'مكتمل']])]],
    receiving_discrepancies: ['Receiving Discrepancies', 'فروقات الاستلام', 'receiving-discrepancies', ['session_id', 'discrepancy_type', 'expected_quantity', 'actual_quantity', 'status', 'requested_by'], ['wms:receiving_discrepancy_approve', 'wms:receiving_request_post'], false, [], ['No receiving discrepancies have been reported.', 'لم يتم الإبلاغ عن أي فروقات استلام.'], [STATUS([['open', 'Open', 'مفتوح'], ['approved', 'Approved', 'معتمد'], ['rejected', 'Rejected', 'مرفوض']])]],
    mobile_picking: ['Mobile Picking', 'الالتقاط المتنقل', 'pick-tasks', ['reference', 'productId', 'quantity', 'sourceLocationId', 'destinationLocationId', 'status'], ['wms:pick_task_assign', 'wms:pick_scan_source', 'wms:pick_scan_product', 'wms:pick_confirm', 'wms:pick_stage'], true, [], ['No pick tasks are assigned to you in this warehouse.', 'لا توجد مهام التقاط مسندة إليك في هذا المستودع.'], [STATUS([['pending', 'Pending', 'معلق'], ['assigned', 'Assigned', 'مسند'], ['in_progress', 'In progress', 'قيد التنفيذ'], ['staged', 'Staged', 'مجهز'], ['completed', 'Completed', 'مكتمل']])]],
    pick_task_queue: ['Pick Task Queue', 'طابور مهام الالتقاط', 'pick-tasks', ['reference', 'waveId', 'priority', 'assignedTo', 'quantity', 'status'], ['wms:pick_task_create', 'wms:pick_task_assign', 'wms:pick_request_post'], false, [], ['The pick task queue is empty.', 'طابور مهام الالتقاط فارغ.'], [STATUS([['pending', 'Pending', 'معلق'], ['assigned', 'Assigned', 'مسند'], ['completed', 'Completed', 'مكتمل']])]],
    wave_planning: ['Wave Planning', 'تخطيط الموجات', 'waves', ['name', 'strategy', 'priority', 'plannedTaskCount', 'status', 'createdBy'], ['wms:wave_create', 'wms:wave_calculate', 'wms:wave_review'], false, [], ['No waves have been planned for this warehouse.', 'لم يتم تخطيط أي موجات لهذا المستودع.'], [STATUS([['draft', 'Draft', 'مسودة'], ['calculated', 'Calculated', 'محسوبة'], ['reviewed', 'Reviewed', 'تمت مراجعتها']])]],
    wave_execution: ['Wave Execution', 'تنفيذ الموجات', 'waves', ['name', 'releasedTaskCount', 'completedTaskCount', 'exceptionCount', 'status', 'releasedBy'], ['wms:wave_release', 'wms:wave_complete', 'wms:wave_cancel'], false, [], ['No waves are currently in execution.', 'لا توجد موجات قيد التنفيذ حالياً.'], [STATUS([['released', 'Released', 'مُطلقة'], ['completed', 'Completed', 'مكتملة'], ['cancelled', 'Cancelled', 'ملغاة']])]],
    cycle_count_plans: ['Cycle Count Plans', 'خطط الجرد الدوري', 'count-plans', ['name', 'frequency', 'blindCount', 'varianceTolerance', 'status', 'nextCountAt'], ['wms:count_plan_create', 'wms:count_session_start'], false, [], ['No cycle count plans exist for this warehouse.', 'لا توجد خطط جرد دوري لهذا المستودع.']],
    count_session: ['Count Session', 'جلسة الجرد', 'count-sessions', ['reference', 'planId', 'blindCount', 'lineCount', 'varianceCount', 'status'], ['wms:count_line_record', 'wms:count_submit', 'wms:count_recount'], true, [], ['No count session is active. Start one from a count plan.', 'لا توجد جلسة جرد نشطة. ابدأ واحدة من خطة جرد.'], [STATUS([['open', 'Open', 'مفتوحة'], ['submitted', 'Submitted', 'مسلّمة'], ['recount_requested', 'Recount requested', 'طُلب إعادة الجرد']])]],
    variance_review: ['Variance Review', 'مراجعة الفروقات', 'count-sessions', ['reference', 'varianceCount', 'varianceValue', 'requestedBy', 'approvedBy', 'status'], ['wms:count_approve_variance', 'wms:count_request_adjustment'], false, [], ['No count variances are awaiting approval.', 'لا توجد فروقات جرد بانتظار الاعتماد.'], [STATUS([['submitted', 'Submitted', 'مسلّمة'], ['approved', 'Approved', 'معتمدة']])]],
    dock_schedule: ['Dock Schedule', 'جدول الأرصفة', 'dock-appointments', ['appointmentType', 'sourceDocumentType', 'carrierName', 'expectedArrival', 'expectedDeparture', 'status'], ['wms:dock_appointment_create', 'wms:dock_assign'], false, [], ['No dock appointments are scheduled.', 'لا توجد مواعيد أرصفة مجدولة.'], [['appointmentType', ['Type', 'النوع'], [['inbound', 'Inbound', 'وارد'], ['outbound', 'Outbound', 'صادر']]]]],
    dock_checkin: ['Dock Check-In', 'تسجيل دخول الرصيف', 'dock-appointments', ['vehicleReference', 'dockId', 'actualArrival', 'detentionStartedAt', 'checkedInBy', 'status'], ['wms:dock_check_in', 'wms:dock_start_service', 'wms:dock_depart'], true, [], ['No vehicles are checked in at this dock.', 'لا توجد مركبات مسجلة الدخول في هذا الرصيف.']],
    staging_board: ['Staging Board', 'لوحة التجهيز', 'staging-allocations', ['staging_location_id', 'source_type', 'source_id', 'product_id', 'quantity', 'status'], ['wms:staging_allocate', 'wms:staging_release'], false, [], ['No staging allocations are active.', 'لا توجد تخصيصات تجهيز نشطة.']],
    crossdock_workspace: ['Cross-Dock Workspace', 'مساحة العبور المباشر', 'crossdock-matches', ['productId', 'availableQuantity', 'demandQuantity', 'matchedQuantity', 'eligibilityScore', 'status'], ['wms:crossdock_evaluate', 'wms:crossdock_approve', 'wms:crossdock_request_post'], false, [], ['No cross-dock matches are available for this warehouse.', 'لا توجد مطابقات عبور مباشر متاحة لهذا المستودع.'], [STATUS([['evaluated', 'Evaluated', 'تم التقييم'], ['approved', 'Approved', 'معتمد']])]],
    lot_serial_traceability: ['Lot / Serial Traceability', 'تتبع الدفعة والرقم التسلسلي', 'trace', ['moveId', 'sourceDocumentType', 'sourceDocumentId', 'from', 'to', 'quantity'], [], false, ['lot_id', 'serial_id'], ['Select a lot or serial to begin traceability.', 'اختر دفعة أو رقماً تسلسلياً لبدء التتبع.']],
    expiration_queue: ['Expiration Queue', 'طابور انتهاء الصلاحية', 'expiration-queue', ['productId', 'lotId', 'serialId', 'expiryDate', 'retestDate', 'qualityStatus'], ['wms:trace_quality_set'], false, [], ['No lots or serials are nearing expiration in this warehouse.', 'لا توجد دفعات أو أرقام تسلسلية قريبة من انتهاء الصلاحية في هذا المستودع.']],
    recall_analysis: ['Recall Analysis', 'تحليل السحب', 'recall-cases', ['reference', 'lotId', 'serialId', 'reason', 'status', 'identifiedAt'], ['wms:recall_identify', 'wms:recall_analyze', 'wms:recall_propose_holds'], false, [], ['No recall cases have been identified.', 'لم يتم تحديد أي حالات سحب.'], [STATUS([['identified', 'Identified', 'محدد'], ['analyzing', 'Analyzing', 'قيد التحليل'], ['holds_proposed', 'Holds proposed', 'تم اقتراح الحجوزات']])]],
    shopfloor_terminal: ['Shop-Floor Terminal', 'محطة أرض المصنع', 'shopfloor-sessions', ['productionOrderId', 'workOrderId', 'operatorId', 'producedQuantity', 'rejectedQuantity', 'status'], ['shopfloor:session_open', 'shopfloor:operator_assign', 'shopfloor:operation_start', 'shopfloor:operation_output', 'shopfloor:operation_complete'], true, [], ['No shop-floor sessions are open for this warehouse.', 'لا توجد جلسات أرضية مصنع مفتوحة لهذا المستودع.'], [STATUS([['open', 'Open', 'مفتوحة'], ['running', 'Running', 'قيد التشغيل'], ['completed', 'Completed', 'مكتملة']])]],
    workcenter_queue: ['Work-Center Queue', 'طابور مركز العمل', 'shopfloor-sessions', ['workCenterId', 'workOrderId', 'plannedStartAt', 'operatorId', 'shiftCode', 'status'], ['shopfloor:operator_assign', 'shopfloor:operation_handoff'], false, [], ['No work-center sessions are queued.', 'لا توجد جلسات مركز عمل في الطابور.']],
    production_material_requests: ['Production Material Requests', 'طلبات مواد الإنتاج', 'material-flow', ['productionOrderId', 'requestType', 'productId', 'requestedQuantity', 'availableQuantity', 'status'], ['shopfloor:material_request', 'shopfloor:material_availability', 'shopfloor:material_approve'], false, [], ['No Production Orders are ready for this work center.', 'لا توجد أوامر إنتاج جاهزة لمركز العمل هذا.'], [STATUS([['requested', 'Requested', 'مطلوب'], ['available', 'Available', 'متوفر'], ['approved', 'Approved', 'معتمد']])]],
    production_issue_return: ['Production Issue / Return', 'صرف وإرجاع الإنتاج', 'material-flow', ['requestType', 'productId', 'approvedQuantity', 'sourceLocationId', 'destinationLocationId', 'status'], ['shopfloor:material_request_canonical', 'shopfloor:material_acknowledge'], true, [], ['No material issue or return requests are pending.', 'لا توجد طلبات صرف أو إرجاع مواد معلقة.']],
    production_receipt: ['Production Receipt', 'استلام الإنتاج', 'material-flow', ['productionOrderId', 'productId', 'approvedQuantity', 'destinationLocationId', 'canonicalResultId', 'status'], ['shopfloor:material_request', 'shopfloor:material_approve', 'shopfloor:material_request_canonical'], true, [], ['No production receipts are pending.', 'لا توجد إيصالات إنتاج معلقة.']],
    quality_hold_queue: ['Quality Hold Queue', 'طابور حجز الجودة', 'quality-checkpoints', ['checkpointType', 'sourceType', 'productId', 'rejectedQuantity', 'reasonCode', 'status'], ['quality:checkpoint_open', 'quality:checkpoint_sync', 'quality:checkpoint_conditional_accept'], false, [], ['No quality checkpoints are open.', 'لا توجد نقاط فحص جودة مفتوحة.'], [STATUS([['open', 'Open', 'مفتوحة'], ['synced', 'Synced', 'متزامنة'], ['conditional_accept', 'Conditional accept', 'قبول مشروط']])]],
    rework_workspace: ['Rework Workspace', 'مساحة إعادة العمل', 'rework-routes', ['route_reference', 'production_order_id', 'source_work_order_id', 'retest_required', 'status', 'created_by'], ['quality:disposition_request', 'quality:disposition_approve', 'quality:rework_start', 'quality:rework_complete'], false, [], ['No rework routes are active.', 'لا توجد مسارات إعادة عمل نشطة.'], [STATUS([['started', 'Started', 'بدأت'], ['completed', 'Completed', 'مكتملة']])]],
    scrap_approval: ['Scrap Approval', 'اعتماد الإتلاف', 'quality-dispositions', ['dispositionType', 'quantity', 'reasonCode', 'requestedBy', 'approvedBy', 'status'], ['quality:disposition_request', 'quality:disposition_approve', 'quality:scrap_request_canonical', 'quality:scrap_acknowledge'], false, [], ['No scrap dispositions are awaiting approval.', 'لا توجد قرارات إتلاف بانتظار الاعتماد.'], [STATUS([['requested', 'Requested', 'مطلوب'], ['approved', 'Approved', 'معتمد'], ['acknowledged', 'Acknowledged', 'تم الإقرار به']])]],
    downtime_board: ['Downtime Board', 'لوحة التوقف', 'downtime', ['workCenterId', 'assetReference', 'reasonCode', 'reasonCategory', 'durationMinutes', 'status'], ['shopfloor:downtime_start', 'shopfloor:downtime_end'], false, [], ['No downtime events have been logged for this warehouse.', 'لم يتم تسجيل أي أحداث توقف لهذا المستودع.'], [['reasonCategory', ['Reason', 'السبب'], [['breakdown', 'Breakdown', 'عطل'], ['changeover', 'Changeover', 'تبديل الإعداد'], ['material_shortage', 'Material shortage', 'نقص مواد'], ['planned_maintenance', 'Planned maintenance', 'صيانة مخططة']]]]],
    operational_performance: ['Operational Performance Dashboard', 'لوحة الأداء التشغيلي', 'work-center-performance', ['sessionId', 'availability', 'performance', 'qualityRate', 'oee', 'downtimeMinutes'], [], false, [], ['No performance metrics are available yet — evidence requires completed shop-floor sessions.', 'لا تتوفر مقاييس أداء بعد — تتطلب البيانات جلسات أرضية مصنع مكتملة.']]
  };

  // Mirrors platform_actions.required_permission from database/migrations/076-080_build09_*.mjs — the server is authoritative; this only drives UI affordance.
  const ACTION_PERMISSIONS = {
    'wms:zone_create': 'wms:topology:admin', 'wms:location_create': 'wms:topology:admin', 'wms:location_update': 'wms:topology:admin', 'wms:location_set_capacity': 'wms:topology:admin',
    'wms:putaway_rule_create': 'wms:putaway:admin', 'wms:putaway_rule_update': 'wms:putaway:admin', 'wms:putaway_recommend': 'wms:receiving:operate', 'wms:putaway_accept': 'wms:receiving:operate', 'wms:putaway_override': 'wms:putaway:override',
    'wms:replenishment_rule_create': 'wms:replenishment:admin', 'wms:replenishment_calculate': 'wms:replenishment:operate', 'wms:replenishment_approve': 'wms:replenishment:approve', 'wms:replenishment_cancel': 'wms:replenishment:approve',
    'wms:receiving_start': 'wms:receiving:operate', 'wms:receiving_scan_reference': 'wms:receiving:operate', 'wms:receiving_scan_product': 'wms:receiving:operate', 'wms:receiving_review': 'wms:receiving:operate', 'wms:receiving_discrepancy_approve': 'wms:receiving_discrepancy:approve', 'wms:receiving_request_post': 'wms:receiving:post',
    'wms:pick_task_create': 'wms:picking:plan', 'wms:pick_task_assign': 'wms:picking:assign', 'wms:pick_scan_source': 'wms:picking:operate', 'wms:pick_scan_product': 'wms:picking:operate', 'wms:pick_confirm': 'wms:picking:operate', 'wms:pick_stage': 'wms:picking:operate', 'wms:pick_request_post': 'wms:picking:post',
    'wms:wave_create': 'wms:wave:plan', 'wms:wave_calculate': 'wms:wave:plan', 'wms:wave_review': 'wms:wave:review', 'wms:wave_release': 'wms:wave:release', 'wms:wave_complete': 'wms:wave:release', 'wms:wave_cancel': 'wms:wave:release',
    'wms:count_plan_create': 'wms:count:plan', 'wms:count_session_start': 'wms:count:operate', 'wms:count_line_record': 'wms:count:operate', 'wms:count_submit': 'wms:count:operate', 'wms:count_recount': 'wms:count:approve', 'wms:count_approve_variance': 'wms:count:approve', 'wms:count_request_adjustment': 'wms:count:adjust',
    'wms:dock_appointment_create': 'wms:dock:schedule', 'wms:dock_assign': 'wms:dock:assign', 'wms:dock_check_in': 'wms:dock:operate', 'wms:dock_start_service': 'wms:dock:operate', 'wms:dock_depart': 'wms:dock:operate',
    'wms:staging_allocate': 'wms:staging:operate', 'wms:staging_release': 'wms:staging:operate', 'wms:crossdock_evaluate': 'wms:crossdock:plan', 'wms:crossdock_approve': 'wms:crossdock:approve', 'wms:crossdock_request_post': 'wms:crossdock:operate',
    'wms:trace_quality_set': 'wms:trace:quality', 'wms:recall_identify': 'wms:recall:plan', 'wms:recall_analyze': 'wms:recall:analyze', 'wms:recall_propose_holds': 'wms:recall:approve',
    'shopfloor:session_open': 'shopfloor:operate', 'shopfloor:operator_assign': 'shopfloor:assign', 'shopfloor:operation_start': 'shopfloor:operate', 'shopfloor:operation_output': 'shopfloor:operate', 'shopfloor:operation_complete': 'shopfloor:operate', 'shopfloor:operation_handoff': 'shopfloor:assign',
    'shopfloor:material_request': 'shopfloor:material:request', 'shopfloor:material_availability': 'shopfloor:material:request', 'shopfloor:material_approve': 'shopfloor:material:approve', 'shopfloor:material_request_canonical': 'shopfloor:material:issue', 'shopfloor:material_acknowledge': 'shopfloor:material:issue',
    'shopfloor:downtime_start': 'shopfloor:downtime:admin', 'shopfloor:downtime_end': 'shopfloor:downtime:admin',
    'quality:checkpoint_open': 'quality:operational:inspect', 'quality:checkpoint_sync': 'quality:operational:inspect', 'quality:checkpoint_conditional_accept': 'quality:operational:hold',
    'quality:disposition_request': 'quality:disposition:request', 'quality:disposition_approve': 'quality:disposition:approve', 'quality:rework_start': 'quality:rework:approve', 'quality:rework_complete': 'quality:rework:approve', 'quality:scrap_request_canonical': 'quality:scrap:approve', 'quality:scrap_acknowledge': 'quality:scrap:approve'
  };

  const PAGE_IDS = Object.keys(PAGES);
  const states = new Map();
  const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const humanize = (value) => String(value || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  const rtl = () => document.documentElement.dir === 'rtl' || String(document.documentElement.lang).startsWith('ar');
  const config = (id) => { const row = PAGES[id]; return row && { id, title: row[0], titleAr: row[1], resource: row[2], columns: row[3], actions: row[4], mobile: Boolean(row[5]), required: row[6] || [], emptyState: row[7] || ['No records yet', 'لا توجد سجلات بعد'], filters: row[8] || [] }; };
  const stateFor = (id) => { if (!states.has(id)) states.set(id, { phase: 'idle', rows: [], filter: '', error: '', updatedAt: null }); return states.get(id); };
  const runtime = () => root.OctagonRuntimeContext;
  const canWrite = (actionId) => {
    if (root.__BUILD09_FORCE_READ_ONLY__ === true) return false;
    const permissions = runtime()?.permissions;
    if (!Array.isArray(permissions) || !permissions.length) return true;
    if (permissions.includes('platform:db:write')) return true;
    const required = actionId ? ACTION_PERMISSIONS[actionId] : null;
    return required ? permissions.includes(required) : false;
  };

  function workspaceMarkup(id) {
    const page = config(id); const requiredInputs = page.required.map((name) => `<label class="b09-query-field"><span>${escapeHtml(humanize(name))}</span><input data-query="${escapeHtml(name)}" autocomplete="off"></label>`).join('');
    const optionalFilters = page.filters.map(([name, filterLabel, options]) => `<label class="b09-query-field"><span>${escapeHtml(rtl() ? filterLabel[1] : filterLabel[0])}</span><select data-query="${escapeHtml(name)}"><option value="">${rtl() ? 'الكل' : 'All'}</option>${options.map(([value, en, ar]) => `<option value="${escapeHtml(value)}">${escapeHtml(rtl() ? ar : en)}</option>`).join('')}</select></label>`).join('');
    return `<section id="${escapeHtml(id)}" class="page b09-workspace${page.mobile ? ' b09-mobile' : ''}" data-build09-page="${escapeHtml(id)}" aria-labelledby="${escapeHtml(id)}Title">
      <header class="b09-hero"><div><p class="b09-eyebrow">BUILD-09 · WMS & Operations</p><h1 id="${escapeHtml(id)}Title" data-role="title">${escapeHtml(page.title)}</h1><p data-role="subtitle"></p></div>${root.OctagonScopeSelector.markup()}</header>
      <div class="b09-query-fields">${requiredInputs}${optionalFilters}</div>
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
    if (!rows.length) { body.innerHTML = `<tr><td colspan="${escapeHtml(page.columns.length)}" class="b09-empty"><strong>${escapeHtml(rtl() ? page.emptyState[1] : page.emptyState[0])}</strong><span>${rtl() ? 'غيّر المرشح أو نطاق المستودع ثم حدّث.' : 'Change the filter or warehouse scope, then refresh.'}</span></td></tr>`; return; }
    body.innerHTML = rows.map((row) => `<tr data-record-id="${escapeHtml(row.id || row.sessionId || '')}">${page.columns.map((column) => `<td data-label="${escapeHtml(humanize(column))}">${escapeHtml(display(row[column]))}</td>`).join('')}</tr>`).join('');
  }

  function renderPage(id) {
    const page = config(id), host = document.querySelector(`[data-build09-page="${id}"]`); if (!page || !host) return;
    host.querySelector('[data-role="title"]').textContent = rtl() ? page.titleAr : page.title;
    host.querySelector('[data-role="subtitle"]').textContent = rtl() ? 'مساحة تشغيلية محكومة، مرتبطة بالسلطات الأساسية والتدقيق.' : 'Governed operational workspace linked to canonical authorities and audit.';
    root.OctagonScopeSelector.render(host, runtime()?.snapshot ? runtime().snapshot() : null);
    host.querySelector('[data-role="head"]').innerHTML = `<tr>${page.columns.map((column) => `<th>${escapeHtml(humanize(column))}</th>`).join('')}</tr>`;
    host.querySelector('[data-role="actions"]').innerHTML = `<button class="b09-button b09-primary" data-command="refresh">↻ ${rtl() ? 'تحديث' : 'Refresh'}</button><button class="b09-button" data-command="export">⇩ CSV</button>${page.actions.map((action) => { const allowed = canWrite(action); const title = root.OctagonActionForms?.get(action); return `<button class="b09-button" data-action="${escapeHtml(action)}" ${allowed ? '' : 'disabled'} title="${allowed ? '' : escapeHtml(rtl() ? 'لا تملك صلاحية هذا الإجراء' : 'You do not have permission for this action')}">${escapeHtml(title ? (rtl() ? title.title.ar : title.title.en) : humanize(action.split(':').slice(1).join(' ')))}</button>`; }).join('')}`;
    const anyWritable = page.actions.some((action) => canWrite(action));
    const notice = host.querySelector('[data-role="permission"]'); notice.hidden = anyWritable || !page.actions.length; notice.textContent = rtl() ? 'صلاحية القراءة فقط: الإجراءات التغييرية معطلة.' : 'Read-only permission: mutation actions are disabled.';
    renderRows(id); bindPage(id);
  }

  function queryParams(id) {
    const host = document.querySelector(`[data-build09-page="${id}"]`); const warehouse = host.querySelector('[data-role="warehouse"]').value.trim();
    if (!warehouse) return { error: rtl() ? 'اختر مستودعاً قبل التحميل.' : 'Enter a warehouse before loading.' };
    const params = new URLSearchParams({ warehouse_id: warehouse });
    for (const input of host.querySelectorAll('[data-query]')) if (input.value.trim()) params.set(input.dataset.query, input.value.trim());
    const page = config(id); if (page.resource === 'trace' && !params.has('lot_id') && !params.has('serial_id')) return { error: rtl() ? 'أدخل معرف دفعة أو رقم تسلسلي.' : 'Enter a lot or serial identifier.' };
    return { params };
  }

  async function fetchRows(id) {
    const page = config(id), state = stateFor(id), query = queryParams(id);
    if (query.error) { state.phase = 'empty'; state.rows = []; renderRows(id); setStatus(id, 'empty', query.error); return []; }
    state.phase = 'loading'; setStatus(id, 'loading', rtl() ? 'جارِ تحميل البيانات…' : 'Loading data…');
    try {
      const payload = await root.OctagonApiClient.get(`/api/v1/wms/${encodeURIComponent(page.resource)}?${query.params}`);
      state.rows = flattenPayload(page, payload); state.phase = state.rows.length ? 'ready' : 'empty'; state.error = ''; state.updatedAt = new Date(); renderRows(id);
      setStatus(id, state.phase, state.rows.length ? `${state.rows.length} ${rtl() ? 'سجل' : 'records'} · ${state.updatedAt.toLocaleTimeString()}` : (rtl() ? 'لا توجد بيانات ضمن النطاق الحالي.' : 'No data in the current scope.'));
      return state.rows;
    } catch (error) {
      state.rows = []; state.error = error.message; state.phase = /403|permission|denied/i.test(error.message) ? 'denied' : 'error'; renderRows(id); setStatus(id, state.phase, `${rtl() ? 'تعذر التحميل' : 'Unable to load'}: ${error.message}`); return [];
    }
  }

  function actionDialog(id, actionId) {
    if (!canWrite(actionId)) { setStatus(id, 'denied', rtl() ? 'لا تملك صلاحية هذا الإجراء.' : 'You do not have permission for this action.'); return; }
    const dialog = document.getElementById('build09ActionDialog'); dialog.dataset.page = id; dialog.dataset.action = actionId;
    const definition = root.OctagonActionForms.get(actionId);
    dialog.querySelector('[data-role="action-name"]').textContent = definition ? (rtl() ? definition.title.ar : definition.title.en) : actionId;
    const warehouse = document.querySelector(`[data-build09-page="${id}"] [data-role="warehouse"]`).value.trim();
    const fieldsHost = dialog.querySelector('[data-role="form-fields"]');
    if (definition) root.OctagonActionForms.render(actionId, fieldsHost, {}); else fieldsHost.innerHTML = `<p>${escapeHtml(rtl() ? 'لا يوجد نموذج مسجل لهذا الإجراء.' : 'No form is registered for this action.')}</p>`;
    dialog.dataset.warehouse = warehouse; dialog.querySelector('[data-role="dialog-error"]').textContent = '';
    if (dialog.showModal) dialog.showModal(); else dialog.hidden = false;
  }

  async function submitAction() {
    const dialog = document.getElementById('build09ActionDialog'), id = dialog.dataset.page, actionId = dialog.dataset.action, errorNode = dialog.querySelector('[data-role="dialog-error"]'); const input = { ...root.OctagonActionForms.collect(dialog.querySelector('form'), actionId), warehouse_id: dialog.dataset.warehouse, idempotency_key: `${actionId}-${Date.now()}` };
    const button = dialog.querySelector('[data-command="submit"]'); button.disabled = true;
    try {
      await root.OctagonApiClient.post(`/api/v1/action/${actionId}`, input);
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
    host.querySelector('[data-role="warehouse"]').addEventListener('change', async (event) => { try { await runtime()?.setWarehouse(event.target.value); await fetchRows(id); } catch (error) { setStatus(id, 'denied', error.message); } });
  }

  function installDialog() {
    if (document.getElementById('build09ActionDialog')) return;
    document.body.insertAdjacentHTML('beforeend', `<dialog id="build09ActionDialog" class="b09-dialog"><form method="dialog"><header><div><small>BUILD-09 governed action</small><h2 data-role="action-name"></h2></div><button value="cancel" aria-label="Close">×</button></header><p>${rtl() ? 'أدخل بيانات الإجراء المطلوبة.' : 'Complete the governed action form.'}</p><div data-role="form-fields"></div><p data-role="dialog-error" class="b09-dialog-error"></p><footer><button value="cancel" class="b09-button">${rtl() ? 'إلغاء' : 'Cancel'}</button><button type="button" class="b09-button b09-primary" data-command="submit">${rtl() ? 'تنفيذ' : 'Run'}</button></footer></form></dialog>`);
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
    runtime()?.subscribe(() => PAGE_IDS.forEach((id) => { if (document.querySelector(`[data-build09-page="${id}"]`)) renderPage(id); }));
  }

  root.OctagonBuild09 = { pages: PAGES, activate, fetchRows, renderPage, stateFor, canWrite };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true }); else initialize();
})(window);
