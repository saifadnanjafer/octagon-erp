/** BUILD-09R governed action-form registry: real per-action fields, no raw JSON. */
(function actionForms(root) {
  'use strict';
  const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const rtl = () => document.documentElement.dir === 'rtl' || String(document.documentElement.lang).startsWith('ar');
  const t = (en, ar) => ({ en, ar });
  const label = (field) => rtl() ? field.label.ar : field.label.en;

  const text = (name, lbl, opts = {}) => ({ name, type: 'text', label: lbl, required: !!opts.required, placeholder: opts.placeholder || '' });
  const textarea = (name, lbl, opts = {}) => ({ name, type: 'textarea', label: lbl, required: !!opts.required });
  const number = (name, lbl, opts = {}) => ({ name, type: 'number', label: lbl, required: !!opts.required, min: opts.min, step: opts.step || 'any' });
  const checkbox = (name, lbl, opts = {}) => ({ name, type: 'checkbox', label: lbl, default: !!opts.default });
  const select = (name, lbl, options, opts = {}) => ({ name, type: 'select', label: lbl, required: !!opts.required, options });
  const lookup = (name, lbl, resource, opts = {}) => ({ name, type: 'lookup', label: lbl, required: !!opts.required, resource });
  const date = (name, lbl, opts = {}) => ({ name, type: 'date', label: lbl, required: !!opts.required });
  const datetime = (name, lbl, opts = {}) => ({ name, type: 'datetime', label: lbl, required: !!opts.required });
  const opt = (value, en, ar) => ({ value, label: t(en, ar) });

  const REASON = {
    putawayOverride: [opt('capacity', 'Capacity', 'السعة'), opt('proximity', 'Proximity', 'القرب'), opt('fifo', 'FIFO', 'الوارد أولاً'), opt('quality_hold', 'Quality hold', 'حجز الجودة'), opt('other', 'Other', 'أخرى')],
    shortPick: [opt('', 'None — full pick', 'لا يوجد — التقاط كامل'), opt('out_of_stock', 'Out of stock', 'نفاد المخزون'), opt('location_empty', 'Location empty', 'الموقع فارغ'), opt('damaged', 'Damaged', 'تالف'), opt('miscount', 'Miscount', 'خطأ عد')],
    discrepancyResolution: [opt('accept_as_is', 'Accept as-is', 'قبول كما هو'), opt('adjust_quantity', 'Adjust quantity', 'تعديل الكمية'), opt('reject', 'Reject', 'رفض')],
    downtime: [opt('breakdown', 'Breakdown', 'عطل'), opt('changeover', 'Changeover', 'تبديل الإعداد'), opt('material_shortage', 'Material shortage', 'نقص مواد'), opt('planned_maintenance', 'Planned maintenance', 'صيانة مخططة'), opt('other', 'Other', 'أخرى')],
    disposition: [opt('rework', 'Rework', 'إعادة عمل'), opt('scrap', 'Scrap', 'إتلاف'), opt('return_to_vendor', 'Return to vendor', 'إرجاع للمورد'), opt('use_as_is', 'Use as-is', 'استخدام كما هو')]
  };

  const registry = {
    'wms:zone_create': { title: t('Create Zone', 'إنشاء منطقة'), fields: [text('name', t('Name', 'الاسم'), { required: true }), text('code', t('Code', 'الرمز'), { required: true }), select('zoneType', t('Zone type', 'نوع المنطقة'), [opt('storage', 'Storage', 'تخزين'), opt('staging', 'Staging', 'تجهيز'), opt('receiving', 'Receiving', 'استلام'), opt('shipping', 'Shipping', 'شحن'), opt('quality_hold', 'Quality hold', 'حجز جودة')], { required: true }), checkbox('active', t('Active', 'نشط'), { default: true })] },
    'wms:location_create': { title: t('Create Location', 'إنشاء موقع'), fields: [text('locationCode', t('Location code', 'رمز الموقع'), { required: true }), text('name', t('Name', 'الاسم'), { required: true }), select('locationType', t('Location type', 'نوع الموقع'), [opt('bin', 'Bin', 'صندوق'), opt('shelf', 'Shelf', 'رف'), opt('floor', 'Floor', 'أرضية'), opt('dock', 'Dock', 'رصيف'), opt('staging', 'Staging', 'تجهيز')], { required: true }), lookup('zoneId', t('Zone', 'المنطقة'), 'zones', { required: true }), number('capacityUnits', t('Capacity units', 'وحدات السعة'), { min: 0 }), checkbox('active', t('Active', 'نشط'), { default: true })] },
    'wms:location_update': { title: t('Update Location', 'تحديث الموقع'), fields: [lookup('locationId', t('Location', 'الموقع'), 'locations', { required: true }), text('name', t('Name', 'الاسم')), select('locationType', t('Location type', 'نوع الموقع'), [opt('bin', 'Bin', 'صندوق'), opt('shelf', 'Shelf', 'رف'), opt('floor', 'Floor', 'أرضية'), opt('dock', 'Dock', 'رصيف'), opt('staging', 'Staging', 'تجهيز')]), checkbox('active', t('Active', 'نشط'), { default: true })] },
    'wms:location_set_capacity': { title: t('Set Capacity', 'تحديد السعة'), fields: [lookup('locationId', t('Location', 'الموقع'), 'locations', { required: true }), number('capacityUnits', t('Capacity units', 'وحدات السعة'), { required: true, min: 0 })] },

    'wms:putaway_rule_create': { title: t('Create Putaway Rule', 'إنشاء قاعدة إيداع'), fields: [text('name', t('Name', 'الاسم'), { required: true }), number('priority', t('Priority', 'الأولوية'), { required: true, min: 1 }), lookup('productId', t('Product', 'المنتج'), 'products'), lookup('zoneId', t('Zone', 'المنطقة'), 'zones'), lookup('destinationLocationId', t('Destination location', 'موقع الوجهة'), 'locations'), checkbox('active', t('Active', 'نشط'), { default: true })] },
    'wms:putaway_rule_update': { title: t('Update Putaway Rule', 'تحديث قاعدة الإيداع'), fields: [lookup('ruleId', t('Rule', 'القاعدة'), 'putawayRules', { required: true }), number('priority', t('Priority', 'الأولوية'), { min: 1 }), lookup('destinationLocationId', t('Destination location', 'موقع الوجهة'), 'locations'), checkbox('active', t('Active', 'نشط'), { default: true })] },
    'wms:putaway_recommend': { title: t('Request Putaway Recommendation', 'طلب توصية إيداع'), fields: [lookup('taskId', t('Putaway task', 'مهمة الإيداع'), 'putawayQueue', { required: true })] },
    'wms:putaway_accept': { title: t('Accept Putaway Recommendation', 'قبول توصية الإيداع'), fields: [lookup('taskId', t('Putaway task', 'مهمة الإيداع'), 'putawayQueue', { required: true }), lookup('destinationLocationId', t('Destination location', 'موقع الوجهة'), 'locations', { required: true })] },
    'wms:putaway_override': { title: t('Override Putaway Destination', 'تجاوز وجهة الإيداع'), fields: [lookup('taskId', t('Putaway task', 'مهمة الإيداع'), 'putawayQueue', { required: true }), lookup('destinationLocationId', t('Destination location', 'موقع الوجهة'), 'locations', { required: true }), select('reasonCode', t('Reason', 'السبب'), REASON.putawayOverride, { required: true })] },

    'wms:replenishment_rule_create': { title: t('Create Replenishment Rule', 'إنشاء قاعدة تعبئة'), fields: [text('name', t('Name', 'الاسم'), { required: true }), lookup('productId', t('Product', 'المنتج'), 'products', { required: true }), lookup('sourceLocationId', t('Source location', 'موقع المصدر'), 'locations', { required: true }), lookup('destinationLocationId', t('Destination location', 'موقع الوجهة'), 'locations', { required: true }), number('minimumQuantity', t('Minimum quantity', 'الحد الأدنى'), { required: true, min: 0 }), number('maximumQuantity', t('Maximum quantity', 'الحد الأقصى'), { required: true, min: 0 }), checkbox('active', t('Active', 'نشط'), { default: true })] },
    'wms:replenishment_calculate': { title: t('Calculate Replenishment', 'حساب التعبئة'), fields: [lookup('zoneId', t('Zone (optional scope)', 'المنطقة (نطاق اختياري)'), 'zones')] },
    'wms:replenishment_approve': { title: t('Approve Replenishment Proposal', 'اعتماد مقترح التعبئة'), fields: [lookup('proposalId', t('Proposal', 'المقترح'), 'replenishmentProposals', { required: true }), number('proposedQuantity', t('Approved quantity', 'الكمية المعتمدة'), { min: 0 })] },
    'wms:replenishment_cancel': { title: t('Cancel Replenishment Proposal', 'إلغاء مقترح التعبئة'), fields: [lookup('proposalId', t('Proposal', 'المقترح'), 'replenishmentProposals', { required: true }), text('reasonCode', t('Reason', 'السبب'), { required: true })] },

    'wms:receiving_start': { title: t('Start Receiving Session', 'بدء جلسة استلام'), fields: [text('reference', t('Reference', 'المرجع'), { required: true }), select('receiptType', t('Receipt type', 'نوع الاستلام'), [opt('purchase_order', 'Purchase order', 'أمر شراء'), opt('transfer', 'Transfer', 'تحويل'), opt('return', 'Return', 'إرجاع'), opt('other', 'Other', 'أخرى')], { required: true })] },
    'wms:receiving_scan_reference': { title: t('Scan Reference', 'مسح المرجع'), fields: [lookup('sessionId', t('Receiving session', 'جلسة الاستلام'), 'receivingSessions', { required: true }), text('reference', t('Scanned reference', 'المرجع الممسوح'), { required: true })] },
    'wms:receiving_scan_product': { title: t('Scan Product', 'مسح المنتج'), fields: [lookup('sessionId', t('Receiving session', 'جلسة الاستلام'), 'receivingSessions', { required: true }), lookup('productId', t('Product', 'المنتج'), 'products', { required: true }), number('quantity', t('Quantity', 'الكمية'), { required: true, min: 0 }), lookup('lotId', t('Lot (if applicable)', 'الدفعة (إن وجدت)'), 'lots'), lookup('serialId', t('Serial (if applicable)', 'الرقم التسلسلي (إن وجد)'), 'serials')] },
    'wms:receiving_review': { title: t('Review Receiving Session', 'مراجعة جلسة الاستلام'), fields: [lookup('sessionId', t('Receiving session', 'جلسة الاستلام'), 'receivingSessions', { required: true }), textarea('notes', t('Review notes', 'ملاحظات المراجعة'))] },
    'wms:receiving_discrepancy_approve': { title: t('Resolve Receiving Discrepancy', 'حل فرق الاستلام'), fields: [lookup('discrepancyId', t('Discrepancy', 'الفرق'), 'receivingDiscrepancies', { required: true }), select('resolution', t('Resolution', 'القرار'), REASON.discrepancyResolution, { required: true }), textarea('notes', t('Notes', 'ملاحظات'))] },
    'wms:receiving_request_post': { title: t('Request Canonical Receipt Posting', 'طلب ترحيل الاستلام الرسمي'), fields: [lookup('sessionId', t('Receiving session', 'جلسة الاستلام'), 'receivingSessions', { required: true })] },

    'wms:pick_task_create': { title: t('Create Pick Task', 'إنشاء مهمة التقاط'), fields: [lookup('waveId', t('Wave (optional)', 'الموجة (اختياري)'), 'waves'), lookup('productId', t('Product', 'المنتج'), 'products', { required: true }), number('quantity', t('Quantity', 'الكمية'), { required: true, min: 0 }), lookup('sourceLocationId', t('Source location', 'موقع المصدر'), 'locations', { required: true })] },
    'wms:pick_task_assign': { title: t('Assign Pick Task', 'تعيين مهمة الالتقاط'), fields: [lookup('taskId', t('Pick task', 'مهمة الالتقاط'), 'pickTasks', { required: true }), lookup('operatorId', t('Operator', 'المشغل'), 'operators', { required: true })] },
    'wms:pick_scan_source': { title: t('Confirm Source Scan', 'تأكيد مسح المصدر'), fields: [lookup('taskId', t('Pick task', 'مهمة الالتقاط'), 'pickTasks', { required: true }), lookup('sourceLocationId', t('Scanned source location', 'موقع المصدر الممسوح'), 'locations', { required: true })] },
    'wms:pick_scan_product': { title: t('Confirm Product Scan', 'تأكيد مسح المنتج'), fields: [lookup('taskId', t('Pick task', 'مهمة الالتقاط'), 'pickTasks', { required: true }), lookup('productId', t('Scanned product', 'المنتج الممسوح'), 'products', { required: true })] },
    'wms:pick_confirm': { title: t('Confirm Pick', 'تأكيد الالتقاط'), fields: [lookup('taskId', t('Pick task', 'مهمة الالتقاط'), 'pickTasks', { required: true }), number('quantityConfirmed', t('Quantity confirmed', 'الكمية المؤكدة'), { required: true, min: 0 }), select('shortPickReasonCode', t('Short-pick reason', 'سبب النقص في الالتقاط'), REASON.shortPick)] },
    'wms:pick_stage': { title: t('Stage Pick', 'تجهيز الالتقاط'), fields: [lookup('taskId', t('Pick task', 'مهمة الالتقاط'), 'pickTasks', { required: true }), lookup('stagingLocationId', t('Staging location', 'موقع التجهيز'), 'locations', { required: true })] },
    'wms:pick_request_post': { title: t('Request Canonical Move Posting', 'طلب ترحيل الحركة الرسمية'), fields: [lookup('taskId', t('Pick task', 'مهمة الالتقاط'), 'pickTasks', { required: true })] },

    'wms:wave_create': { title: t('Create Wave', 'إنشاء موجة'), fields: [text('name', t('Name', 'الاسم'), { required: true }), select('strategy', t('Strategy', 'الاستراتيجية'), [opt('single_order', 'Single order', 'طلب واحد'), opt('batch', 'Batch', 'دفعة'), opt('zone', 'Zone', 'منطقة'), opt('cluster', 'Cluster', 'تجميع')], { required: true }), select('priority', t('Priority', 'الأولوية'), [opt('low', 'Low', 'منخفضة'), opt('normal', 'Normal', 'عادية'), opt('high', 'High', 'عالية')])] },
    'wms:wave_calculate': { title: t('Calculate Wave', 'حساب الموجة'), fields: [lookup('waveId', t('Wave', 'الموجة'), 'waves', { required: true })] },
    'wms:wave_review': { title: t('Review Wave', 'مراجعة الموجة'), fields: [lookup('waveId', t('Wave', 'الموجة'), 'waves', { required: true })] },
    'wms:wave_release': { title: t('Release Wave', 'إطلاق الموجة'), fields: [lookup('waveId', t('Wave', 'الموجة'), 'waves', { required: true })] },
    'wms:wave_complete': { title: t('Complete Wave', 'إكمال الموجة'), fields: [lookup('waveId', t('Wave', 'الموجة'), 'waves', { required: true })] },
    'wms:wave_cancel': { title: t('Cancel Wave', 'إلغاء الموجة'), fields: [lookup('waveId', t('Wave', 'الموجة'), 'waves', { required: true }), text('reasonCode', t('Reason', 'السبب'), { required: true })] },

    'wms:count_plan_create': { title: t('Create Count Plan', 'إنشاء خطة جرد'), fields: [text('name', t('Name', 'الاسم'), { required: true }), select('frequency', t('Frequency', 'التكرار'), [opt('daily', 'Daily', 'يومي'), opt('weekly', 'Weekly', 'أسبوعي'), opt('monthly', 'Monthly', 'شهري'), opt('quarterly', 'Quarterly', 'ربع سنوي')], { required: true }), checkbox('blindCount', t('Blind count', 'جرد أعمى'), { default: true }), number('varianceTolerance', t('Variance tolerance %', 'نسبة تحمل الفرق'), { min: 0 })] },
    'wms:count_session_start': { title: t('Start Count Session', 'بدء جلسة جرد'), fields: [lookup('planId', t('Count plan', 'خطة الجرد'), 'countPlans', { required: true })] },
    'wms:count_line_record': { title: t('Record Count Line', 'تسجيل سطر جرد'), fields: [lookup('sessionId', t('Count session', 'جلسة الجرد'), 'countSessions', { required: true }), lookup('locationId', t('Location', 'الموقع'), 'locations', { required: true }), lookup('productId', t('Product', 'المنتج'), 'products', { required: true }), number('countedQuantity', t('Counted quantity', 'الكمية المعدودة'), { required: true, min: 0 })] },
    'wms:count_submit': { title: t('Submit Count Session', 'تسليم جلسة الجرد'), fields: [lookup('sessionId', t('Count session', 'جلسة الجرد'), 'countSessions', { required: true })] },
    'wms:count_recount': { title: t('Request Recount', 'طلب إعادة جرد'), fields: [lookup('sessionId', t('Count session', 'جلسة الجرد'), 'countSessions', { required: true }), text('reasonCode', t('Reason', 'السبب'), { required: true })] },
    'wms:count_approve_variance': { title: t('Approve Variance', 'اعتماد الفرق'), fields: [lookup('sessionId', t('Count session', 'جلسة الجرد'), 'countSessions', { required: true }), number('approvedQuantity', t('Approved quantity', 'الكمية المعتمدة'), { required: true, min: 0 }), textarea('notes', t('Notes', 'ملاحظات'))] },
    'wms:count_request_adjustment': { title: t('Request Stock Adjustment', 'طلب تسوية مخزون'), fields: [lookup('sessionId', t('Count session', 'جلسة الجرد'), 'countSessions', { required: true }), number('adjustmentQuantity', t('Adjustment quantity', 'كمية التسوية'), { required: true }), text('reasonCode', t('Reason', 'السبب'), { required: true })] },

    'wms:dock_appointment_create': { title: t('Create Dock Appointment', 'إنشاء موعد رصيف'), fields: [select('appointmentType', t('Appointment type', 'نوع الموعد'), [opt('inbound', 'Inbound', 'وارد'), opt('outbound', 'Outbound', 'صادر')], { required: true }), text('carrierName', t('Carrier name', 'اسم الناقل'), { required: true }), datetime('expectedArrival', t('Expected arrival', 'الوصول المتوقع'), { required: true }), datetime('expectedDeparture', t('Expected departure', 'المغادرة المتوقعة'))] },
    'wms:dock_assign': { title: t('Assign Dock', 'تعيين رصيف'), fields: [lookup('appointmentId', t('Appointment', 'الموعد'), 'dockAppointments', { required: true }), lookup('dockId', t('Dock', 'الرصيف'), 'docks', { required: true })] },
    'wms:dock_check_in': { title: t('Dock Check-In', 'تسجيل دخول الرصيف'), fields: [lookup('appointmentId', t('Appointment', 'الموعد'), 'dockAppointments', { required: true }), text('vehicleReference', t('Vehicle reference', 'رقم المركبة'), { required: true })] },
    'wms:dock_start_service': { title: t('Start Dock Service', 'بدء خدمة الرصيف'), fields: [lookup('appointmentId', t('Appointment', 'الموعد'), 'dockAppointments', { required: true })] },
    'wms:dock_depart': { title: t('Dock Departure', 'مغادرة الرصيف'), fields: [lookup('appointmentId', t('Appointment', 'الموعد'), 'dockAppointments', { required: true })] },

    'wms:staging_allocate': { title: t('Allocate Staging', 'تخصيص تجهيز'), fields: [lookup('stagingLocationId', t('Staging location', 'موقع التجهيز'), 'locations', { required: true }), lookup('productId', t('Product', 'المنتج'), 'products', { required: true }), number('quantity', t('Quantity', 'الكمية'), { required: true, min: 0 })] },
    'wms:staging_release': { title: t('Release Staging', 'تحرير التجهيز'), fields: [lookup('stagingLocationId', t('Staging location', 'موقع التجهيز'), 'locations', { required: true })] },
    'wms:crossdock_evaluate': { title: t('Evaluate Cross-Dock Match', 'تقييم مطابقة العبور المباشر'), fields: [lookup('productId', t('Product', 'المنتج'), 'products', { required: true })] },
    'wms:crossdock_approve': { title: t('Approve Cross-Dock Match', 'اعتماد مطابقة العبور المباشر'), fields: [lookup('matchId', t('Match', 'المطابقة'), 'crossdockMatches', { required: true }), number('matchedQuantity', t('Matched quantity', 'الكمية المطابقة'), { required: true, min: 0 })] },
    'wms:crossdock_request_post': { title: t('Request Cross-Dock Posting', 'طلب ترحيل العبور المباشر'), fields: [lookup('matchId', t('Match', 'المطابقة'), 'crossdockMatches', { required: true })] },

    'wms:trace_quality_set': { title: t('Set Lot/Serial Quality Status', 'تحديد حالة جودة الدفعة/الرقم التسلسلي'), fields: [lookup('lotId', t('Lot', 'الدفعة'), 'lots'), lookup('serialId', t('Serial', 'الرقم التسلسلي'), 'serials'), select('qualityStatus', t('Quality status', 'حالة الجودة'), [opt('released', 'Released', 'مُفرج عنه'), opt('quarantined', 'Quarantined', 'حجر صحي'), opt('rejected', 'Rejected', 'مرفوض')], { required: true })] },
    'wms:recall_identify': { title: t('Identify Recall', 'تحديد سحب'), fields: [lookup('productId', t('Product', 'المنتج'), 'products', { required: true }), lookup('lotId', t('Lot', 'الدفعة'), 'lots'), lookup('serialId', t('Serial', 'الرقم التسلسلي'), 'serials'), textarea('reason', t('Reason', 'السبب'), { required: true })] },
    'wms:recall_analyze': { title: t('Analyze Recall Case', 'تحليل حالة السحب'), fields: [lookup('caseId', t('Recall case', 'حالة السحب'), 'recallCases', { required: true }), textarea('notes', t('Analysis notes', 'ملاحظات التحليل'))] },
    'wms:recall_propose_holds': { title: t('Propose Recall Holds', 'اقتراح حجوزات السحب'), fields: [lookup('caseId', t('Recall case', 'حالة السحب'), 'recallCases', { required: true }), textarea('proposedAction', t('Proposed hold action', 'إجراء الحجز المقترح'), { required: true })] },

    'shopfloor:session_open': { title: t('Open Shop-Floor Session', 'فتح جلسة أرضية المصنع'), fields: [lookup('productionOrderId', t('Production order', 'أمر الإنتاج'), 'productionOrders', { required: true }), lookup('workOrderId', t('Work order', 'أمر العمل'), 'workOrders', { required: true }), lookup('workCenterId', t('Work center', 'مركز العمل'), 'workCenters', { required: true })] },
    'shopfloor:operator_assign': { title: t('Assign Operator', 'تعيين مشغل'), fields: [lookup('sessionId', t('Session', 'الجلسة'), 'shopfloorSessions', { required: true }), lookup('operatorId', t('Operator', 'المشغل'), 'operators', { required: true })] },
    'shopfloor:operation_start': { title: t('Start Operation', 'بدء العملية'), fields: [lookup('sessionId', t('Session', 'الجلسة'), 'shopfloorSessions', { required: true })] },
    'shopfloor:operation_output': { title: t('Report Output', 'الإبلاغ عن الإنتاج'), fields: [lookup('sessionId', t('Session', 'الجلسة'), 'shopfloorSessions', { required: true }), number('producedQuantity', t('Produced quantity', 'الكمية المنتجة'), { required: true, min: 0 }), number('rejectedQuantity', t('Rejected quantity', 'الكمية المرفوضة'), { min: 0 })] },
    'shopfloor:operation_complete': { title: t('Complete Operation', 'إكمال العملية'), fields: [lookup('sessionId', t('Session', 'الجلسة'), 'shopfloorSessions', { required: true })] },
    'shopfloor:operation_handoff': { title: t('Hand Off Operation', 'تسليم العملية'), fields: [lookup('sessionId', t('Session', 'الجلسة'), 'shopfloorSessions', { required: true }), lookup('nextWorkCenterId', t('Next work center', 'مركز العمل التالي'), 'workCenters', { required: true })] },

    'shopfloor:material_request': { title: t('Request Material', 'طلب مادة'), fields: [lookup('productionOrderId', t('Production order', 'أمر الإنتاج'), 'productionOrders', { required: true }), lookup('productId', t('Product', 'المنتج'), 'products', { required: true }), number('requestedQuantity', t('Requested quantity', 'الكمية المطلوبة'), { required: true, min: 0 })] },
    'shopfloor:material_availability': { title: t('Check Material Availability', 'التحقق من توفر المادة'), fields: [lookup('requestId', t('Material request', 'طلب المادة'), 'materialFlow', { required: true })] },
    'shopfloor:material_approve': { title: t('Approve Material Request', 'اعتماد طلب المادة'), fields: [lookup('requestId', t('Material request', 'طلب المادة'), 'materialFlow', { required: true }), number('approvedQuantity', t('Approved quantity', 'الكمية المعتمدة'), { required: true, min: 0 })] },
    'shopfloor:material_request_canonical': { title: t('Request Canonical Material Move', 'طلب حركة المادة الرسمية'), fields: [lookup('requestId', t('Material request', 'طلب المادة'), 'materialFlow', { required: true }), lookup('destinationLocationId', t('Destination location', 'موقع الوجهة'), 'locations', { required: true })] },
    'shopfloor:material_acknowledge': { title: t('Acknowledge Material Move', 'الإقرار بحركة المادة'), fields: [lookup('requestId', t('Material request', 'طلب المادة'), 'materialFlow', { required: true })] },

    'shopfloor:downtime_start': { title: t('Start Downtime', 'بدء التوقف'), fields: [lookup('workCenterId', t('Work center', 'مركز العمل'), 'workCenters', { required: true }), select('reasonCode', t('Reason', 'السبب'), REASON.downtime, { required: true })] },
    'shopfloor:downtime_end': { title: t('End Downtime', 'إنهاء التوقف'), fields: [lookup('downtimeId', t('Downtime event', 'حدث التوقف'), 'downtimeEvents', { required: true })] },

    'quality:checkpoint_open': { title: t('Open Quality Checkpoint', 'فتح نقطة فحص جودة'), fields: [select('sourceType', t('Source', 'المصدر'), [opt('receiving', 'Receiving', 'استلام'), opt('production', 'Production', 'إنتاج'), opt('shipping', 'Shipping', 'شحن')], { required: true }), lookup('productId', t('Product', 'المنتج'), 'products', { required: true }), select('checkpointType', t('Checkpoint type', 'نوع نقطة الفحص'), [opt('incoming', 'Incoming', 'وارد'), opt('in_process', 'In-process', 'أثناء العملية'), opt('final', 'Final', 'نهائي')], { required: true })] },
    'quality:checkpoint_sync': { title: t('Sync Checkpoint', 'مزامنة نقطة الفحص'), fields: [lookup('checkpointId', t('Checkpoint', 'نقطة الفحص'), 'qualityCheckpoints', { required: true })] },
    'quality:checkpoint_conditional_accept': { title: t('Conditionally Accept', 'قبول مشروط'), fields: [lookup('checkpointId', t('Checkpoint', 'نقطة الفحص'), 'qualityCheckpoints', { required: true }), textarea('conditions', t('Conditions', 'الشروط'), { required: true })] },
    'quality:disposition_request': { title: t('Request Disposition', 'طلب قرار تصرف'), fields: [lookup('checkpointId', t('Checkpoint', 'نقطة الفحص'), 'qualityCheckpoints', { required: true }), select('dispositionType', t('Disposition type', 'نوع التصرف'), REASON.disposition, { required: true }), number('quantity', t('Quantity', 'الكمية'), { required: true, min: 0 }), text('reasonCode', t('Reason', 'السبب'), { required: true })] },
    'quality:disposition_approve': { title: t('Approve Disposition', 'اعتماد قرار التصرف'), fields: [lookup('dispositionId', t('Disposition', 'قرار التصرف'), 'dispositions', { required: true })] },
    'quality:rework_start': { title: t('Start Rework', 'بدء إعادة العمل'), fields: [lookup('routeId', t('Rework route', 'مسار إعادة العمل'), 'reworkRoutes', { required: true })] },
    'quality:rework_complete': { title: t('Complete Rework', 'إكمال إعادة العمل'), fields: [lookup('routeId', t('Rework route', 'مسار إعادة العمل'), 'reworkRoutes', { required: true }), checkbox('retestRequired', t('Retest required', 'يتطلب إعادة فحص'), { default: true })] },
    'quality:scrap_request_canonical': { title: t('Request Canonical Scrap Posting', 'طلب ترحيل الإتلاف الرسمي'), fields: [lookup('dispositionId', t('Disposition', 'قرار التصرف'), 'dispositions', { required: true })] },
    'quality:scrap_acknowledge': { title: t('Acknowledge Scrap Posting', 'الإقرار بترحيل الإتلاف'), fields: [lookup('dispositionId', t('Disposition', 'قرار التصرف'), 'dispositions', { required: true })] }
  };

  function fieldMarkup(field, value) {
    const id = `b09f-${field.name}`, req = field.required ? 'required' : '';
    const wrapper = (inner) => `<label class="b09-field" for="${id}" data-field-type="${field.type}"><span>${escapeHtml(label(field))}${field.required ? ' *' : ''}</span>${inner}</label>`;
    if (field.type === 'textarea') return wrapper(`<textarea id="${id}" name="${escapeHtml(field.name)}" ${req}>${escapeHtml(value || '')}</textarea>`);
    if (field.type === 'checkbox') return wrapper(`<input id="${id}" name="${escapeHtml(field.name)}" type="checkbox" ${value ?? field.default ? 'checked' : ''}>`);
    if (field.type === 'select') return wrapper(`<select id="${id}" name="${escapeHtml(field.name)}" ${req}><option value="">${rtl() ? '— اختر —' : '— Select —'}</option>${field.options.map((o) => `<option value="${escapeHtml(o.value)}" ${value === o.value ? 'selected' : ''}>${escapeHtml(rtl() ? o.label.ar : o.label.en)}</option>`).join('')}</select>`);
    if (field.type === 'lookup') return wrapper(`<span class="b09-lookup" data-lookup-resource="${escapeHtml(field.resource)}"><input type="text" class="b09-lookup-query" placeholder="${rtl() ? 'ابحث…' : 'Search…'}" autocomplete="off"><select id="${id}" name="${escapeHtml(field.name)}" class="b09-lookup-select" ${req}><option value="">${rtl() ? '— بحث ثم اختيار —' : '— Search then select —'}</option></select></span>`);
    if (field.type === 'number') return wrapper(`<input id="${id}" name="${escapeHtml(field.name)}" type="number" step="${escapeHtml(field.step)}" ${field.min != null ? `min="${field.min}"` : ''} value="${escapeHtml(value ?? '')}" ${req}>`);
    if (field.type === 'date' || field.type === 'datetime') return wrapper(`<input id="${id}" name="${escapeHtml(field.name)}" type="${field.type === 'date' ? 'date' : 'datetime-local'}" value="${escapeHtml(value || '')}" ${req}>`);
    return wrapper(`<input id="${id}" name="${escapeHtml(field.name)}" type="text" placeholder="${escapeHtml(field.placeholder || '')}" value="${escapeHtml(value ?? '')}" ${req}>`);
  }

  function wireLookups(host) {
    host.querySelectorAll('[data-lookup-resource]').forEach((wrapper) => {
      const resource = wrapper.dataset.lookupResource, queryInput = wrapper.querySelector('.b09-lookup-query'), resultSelect = wrapper.querySelector('.b09-lookup-select');
      let timer = null;
      queryInput.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          if (!root.OctagonGovernedLookups) return;
          const rows = await root.OctagonGovernedLookups.search(resource, { query: queryInput.value }).catch(() => []);
          resultSelect.innerHTML = `<option value="">${rtl() ? '— بحث ثم اختيار —' : '— Search then select —'}</option>` + rows.map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.label)}</option>`).join('');
        }, 250);
      });
    });
  }

  root.OctagonActionForms = {
    registry,
    get(id) { return registry[id] || null; },
    render(id, host, values = {}) {
      const form = registry[id]; if (!form) throw new Error('Unsupported action form');
      host.innerHTML = form.fields.map((field) => fieldMarkup(field, values[field.name])).join('');
      wireLookups(host);
    },
    collect(form, actionId) {
      const definition = actionId ? registry[actionId] : null;
      const data = Object.fromEntries(new FormData(form).entries());
      if (!definition) return data;
      definition.fields.forEach((field) => {
        if (field.type === 'checkbox') { const element = form.elements.namedItem(field.name); data[field.name] = element ? element.checked : false; }
        else if (field.type === 'number' && data[field.name] !== undefined && data[field.name] !== '') data[field.name] = Number(data[field.name]);
      });
      return data;
    }
  };
})(window);
