/** BUILD-09R governed action-form registry: real per-action fields, no raw JSON.
 * Field names are verified against the actual server handler each action id maps to
 * (database/migrations/076-080_build09_*.mjs registerDomainHandler calls -> platform/wms|manufacturing|quality/*.mjs),
 * not guessed from the read-side camelCase column names, which most handlers do not accept as input. */
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
    discrepancyDecision: [opt('approved', 'Approved', 'معتمد'), opt('rejected', 'Rejected', 'مرفوض')],
    downtimeCategory: [opt('setup', 'Setup', 'إعداد'), opt('breakdown', 'Breakdown', 'عطل'), opt('material', 'Material', 'مواد'), opt('quality', 'Quality', 'جودة'), opt('operator', 'Operator', 'مشغل'), opt('planned', 'Planned', 'مخطط'), opt('other', 'Other', 'أخرى')],
    disposition: [opt('rework', 'Rework', 'إعادة عمل'), opt('scrap', 'Scrap', 'إتلاف'), opt('return_to_vendor', 'Return to vendor', 'إرجاع للمورد'), opt('use_as_is', 'Use as-is', 'استخدام كما هو')],
    countScope: [opt('location', 'Location', 'موقع'), opt('product', 'Product', 'منتج'), opt('zone', 'Zone', 'منطقة'), opt('abc', 'ABC class', 'فئة ABC'), opt('ad_hoc', 'Ad hoc', 'عشوائي')],
    waveType: [opt('wave', 'Wave', 'موجة'), opt('batch', 'Batch', 'دفعة'), opt('cluster', 'Cluster', 'تجميع'), opt('zone', 'Zone', 'منطقة')],
    groupingStrategy: [opt('manual', 'Manual', 'يدوي'), opt('carrier', 'Carrier', 'ناقل'), opt('route', 'Route', 'مسار'), opt('customer', 'Customer', 'عميل'), opt('zone', 'Zone', 'منطقة'), opt('product', 'Product', 'منتج')],
    materialRequestType: [opt('request', 'Request', 'طلب'), opt('reservation', 'Reservation', 'حجز'), opt('issue', 'Issue', 'صرف'), opt('return', 'Return', 'إرجاع'), opt('substitution', 'Substitution', 'استبدال'), opt('shortage', 'Shortage', 'نقص'), opt('backflush', 'Backflush', 'صرف تلقائي'), opt('production_receipt', 'Production receipt', 'استلام إنتاج'), opt('co_product', 'Co-product', 'منتج مشترك'), opt('by_product', 'By-product', 'منتج ثانوي'), opt('putaway', 'Putaway', 'إيداع')]
  };

  const registry = {
    'wms:zone_create': { title: t('Create Zone', 'إنشاء منطقة'), fields: [text('code', t('Code', 'الرمز'), { required: true }), text('name', t('Name', 'الاسم'), { required: true }), select('zone_type', t('Zone type', 'نوع المنطقة'), [opt('storage', 'Storage', 'تخزين'), opt('staging', 'Staging', 'تجهيز'), opt('receiving', 'Receiving', 'استلام'), opt('shipping', 'Shipping', 'شحن'), opt('quality_hold', 'Quality hold', 'حجز جودة')], { required: true }), lookup('parent_zone_id', t('Parent zone (optional)', 'المنطقة الأصل (اختياري)'), 'zones'), checkbox('hazardous', t('Hazardous', 'خطر')), checkbox('restricted', t('Restricted', 'مقيّد'))] },
    'wms:location_create': { title: t('Create Location', 'إنشاء موقع'), fields: [text('location_code', t('Location code', 'رمز الموقع'), { required: true }), text('name', t('Name', 'الاسم'), { required: true }), select('location_type', t('Location type', 'نوع الموقع'), [opt('bin', 'Bin', 'صندوق'), opt('shelf', 'Shelf', 'رف'), opt('floor', 'Floor', 'أرضية'), opt('dock', 'Dock', 'رصيف'), opt('staging', 'Staging', 'تجهيز')], { required: true }), lookup('zone_id', t('Zone', 'المنطقة'), 'zones'), number('capacity_units', t('Capacity units', 'وحدات السعة'), { min: 0 })] },
    'wms:location_update': { title: t('Update Location', 'تحديث الموقع'), fields: [lookup('location_id', t('Location', 'الموقع'), 'locations', { required: true }), text('name', t('Name', 'الاسم')), select('location_type', t('Location type', 'نوع الموقع'), [opt('bin', 'Bin', 'صندوق'), opt('shelf', 'Shelf', 'رف'), opt('floor', 'Floor', 'أرضية'), opt('dock', 'Dock', 'رصيف'), opt('staging', 'Staging', 'تجهيز')]), checkbox('active', t('Active', 'نشط'), { default: true })] },
    'wms:location_set_capacity': { title: t('Set Capacity', 'تحديد السعة'), fields: [lookup('location_id', t('Location', 'الموقع'), 'locations', { required: true }), number('capacity_units', t('Capacity units', 'وحدات السعة'), { required: true, min: 0 })] },

    'wms:putaway_rule_create': { title: t('Create Putaway Rule', 'إنشاء قاعدة إيداع'), fields: [text('name', t('Name', 'الاسم'), { required: true }), number('priority', t('Priority', 'الأولوية'), { required: true, min: 1 }), lookup('product_id', t('Product', 'المنتج'), 'products'), lookup('destination_zone_id', t('Destination zone', 'منطقة الوجهة'), 'zones'), lookup('destination_location_id', t('Destination location', 'موقع الوجهة'), 'locations')] },
    'wms:putaway_rule_update': { title: t('Update Putaway Rule', 'تحديث قاعدة الإيداع'), fields: [lookup('rule_id', t('Rule', 'القاعدة'), 'putawayRules', { required: true }), text('name', t('Name', 'الاسم')), number('priority', t('Priority', 'الأولوية'), { min: 1 }), checkbox('allow_split', t('Allow split', 'السماح بالتجزئة')), checkbox('is_active', t('Active', 'نشط'), { default: true })] },
    'wms:putaway_recommend': { title: t('Request Putaway Recommendation', 'طلب توصية إيداع'), fields: [lookup('product_id', t('Product', 'المنتج'), 'products', { required: true }), number('quantity', t('Quantity', 'الكمية'), { required: true, min: 0 }), lookup('source_location_id', t('Source location', 'موقع المصدر'), 'locations', { required: true })] },
    'wms:putaway_accept': { title: t('Accept Putaway Recommendation', 'قبول توصية الإيداع'), fields: [lookup('recommendation_id', t('Recommendation', 'التوصية'), 'putawayQueue', { required: true }), lookup('assigned_to', t('Assign to operator (optional)', 'إسناد إلى مشغل (اختياري)'), 'operators')] },
    'wms:putaway_override': { title: t('Override Putaway Destination', 'تجاوز وجهة الإيداع'), fields: [lookup('recommendation_id', t('Recommendation', 'التوصية'), 'putawayQueue', { required: true }), lookup('destination_location_id', t('Destination location', 'موقع الوجهة'), 'locations', { required: true }), select('reason', t('Reason', 'السبب'), REASON.putawayOverride, { required: true })] },

    'wms:replenishment_rule_create': { title: t('Create Replenishment Rule', 'إنشاء قاعدة تعبئة'), fields: [text('name', t('Name', 'الاسم'), { required: true }), lookup('product_id', t('Product', 'المنتج'), 'products', { required: true }), lookup('source_location_id', t('Source location', 'موقع المصدر'), 'locations', { required: true }), lookup('destination_location_id', t('Destination location', 'موقع الوجهة'), 'locations', { required: true }), number('minimum_quantity', t('Minimum quantity', 'الحد الأدنى'), { required: true, min: 0 }), number('maximum_quantity', t('Maximum quantity', 'الحد الأقصى'), { required: true, min: 0 })] },
    'wms:replenishment_calculate': { title: t('Calculate Replenishment', 'حساب التعبئة'), fields: [lookup('rule_id', t('Rule (optional — all rules if empty)', 'القاعدة (اختياري — كل القواعد إن تُرك فارغاً)'), 'replenishmentRules')] },
    'wms:replenishment_approve': { title: t('Approve Replenishment Proposal', 'اعتماد مقترح التعبئة'), fields: [lookup('proposal_id', t('Proposal', 'المقترح'), 'replenishmentProposals', { required: true })] },
    'wms:replenishment_cancel': { title: t('Cancel Replenishment Proposal', 'إلغاء مقترح التعبئة'), fields: [lookup('proposal_id', t('Proposal', 'المقترح'), 'replenishmentProposals', { required: true }), text('reason', t('Reason', 'السبب'), { required: true })] },

    'wms:receiving_start': { title: t('Start Receiving Session', 'بدء جلسة استلام'), fields: [text('reference', t('Reference', 'المرجع'), { required: true }), select('receipt_type', t('Receipt type', 'نوع الاستلام'), [opt('purchase_order', 'Purchase order', 'أمر شراء'), opt('transfer', 'Transfer', 'تحويل'), opt('return', 'Return', 'إرجاع'), opt('other', 'Other', 'أخرى')], { required: true })] },
    'wms:receiving_scan_reference': { title: t('Scan Reference', 'مسح المرجع'), fields: [lookup('session_id', t('Receiving session', 'جلسة الاستلام'), 'receivingSessions', { required: true }), text('reference', t('Scanned reference', 'المرجع الممسوح'), { required: true })] },
    'wms:receiving_scan_product': { title: t('Scan Product', 'مسح المنتج'), fields: [lookup('session_id', t('Receiving session', 'جلسة الاستلام'), 'receivingSessions', { required: true }), lookup('product_id', t('Product', 'المنتج'), 'products', { required: true }), number('quantity', t('Quantity', 'الكمية'), { required: true, min: 0 }), lookup('lot_id', t('Lot (if applicable)', 'الدفعة (إن وجدت)'), 'lots'), lookup('serial_id', t('Serial (if applicable)', 'الرقم التسلسلي (إن وجد)'), 'serials')] },
    'wms:receiving_review': { title: t('Review Receiving Session', 'مراجعة جلسة الاستلام'), fields: [lookup('session_id', t('Receiving session', 'جلسة الاستلام'), 'receivingSessions', { required: true })] },
    'wms:receiving_discrepancy_approve': { title: t('Resolve Receiving Discrepancy', 'حل فرق الاستلام'), fields: [lookup('session_id', t('Receiving session', 'جلسة الاستلام'), 'receivingSessions', { required: true }), lookup('discrepancy_id', t('Discrepancy', 'الفرق'), 'receivingDiscrepancies', { required: true }), select('decision', t('Decision', 'القرار'), REASON.discrepancyDecision, { required: true }), text('reason', t('Reason', 'السبب'))] },
    'wms:receiving_request_post': { title: t('Request Canonical Receipt Posting', 'طلب ترحيل الاستلام الرسمي'), fields: [lookup('session_id', t('Receiving session', 'جلسة الاستلام'), 'receivingSessions', { required: true }), text('picking_id', t('Canonical picking ID', 'معرّف عملية النقل الرسمي'), { required: true })] },

    'wms:pick_task_create': { title: t('Create Pick Task', 'إنشاء مهمة التقاط'), fields: [lookup('product_id', t('Product', 'المنتج'), 'products', { required: true }), number('quantity', t('Quantity', 'الكمية'), { required: true, min: 0 }), lookup('source_location_id', t('Source location', 'موقع المصدر'), 'locations', { required: true }), lookup('destination_location_id', t('Destination location', 'موقع الوجهة'), 'locations', { required: true }), text('picking_type', t('Picking type', 'نوع الالتقاط'), { required: true }), text('source_document_id', t('Source document ID', 'معرّف المستند المصدر'), { required: true })] },
    'wms:pick_task_assign': { title: t('Assign Pick Task', 'تعيين مهمة الالتقاط'), fields: [lookup('task_id', t('Pick task', 'مهمة الالتقاط'), 'pickTasks', { required: true }), lookup('assigned_to', t('Operator', 'المشغل'), 'operators', { required: true })] },
    'wms:pick_scan_source': { title: t('Confirm Source Scan', 'تأكيد مسح المصدر'), fields: [lookup('task_id', t('Pick task', 'مهمة الالتقاط'), 'pickTasks', { required: true }), text('barcode', t('Scanned barcode', 'الباركود الممسوح'), { required: true })] },
    'wms:pick_scan_product': { title: t('Confirm Product Scan', 'تأكيد مسح المنتج'), fields: [lookup('task_id', t('Pick task', 'مهمة الالتقاط'), 'pickTasks', { required: true }), text('barcode', t('Scanned barcode', 'الباركود الممسوح'), { required: true })] },
    'wms:pick_confirm': { title: t('Confirm Pick', 'تأكيد الالتقاط'), fields: [lookup('task_id', t('Pick task', 'مهمة الالتقاط'), 'pickTasks', { required: true }), number('quantity', t('Quantity confirmed', 'الكمية المؤكدة'), { required: true, min: 0 }), select('short_reason', t('Short-pick reason', 'سبب النقص في الالتقاط'), REASON.shortPick)] },
    'wms:pick_stage': { title: t('Stage Pick', 'تجهيز الالتقاط'), fields: [lookup('task_id', t('Pick task', 'مهمة الالتقاط'), 'pickTasks', { required: true }), lookup('staging_location_id', t('Staging location', 'موقع التجهيز'), 'locations', { required: true })] },
    'wms:pick_request_post': { title: t('Request Canonical Move Posting', 'طلب ترحيل الحركة الرسمية'), fields: [lookup('task_id', t('Pick task', 'مهمة الالتقاط'), 'pickTasks', { required: true })] },

    'wms:wave_create': { title: t('Create Wave', 'إنشاء موجة'), fields: [text('name', t('Name', 'الاسم'), { required: true }), select('wave_type', t('Wave type', 'نوع الموجة'), REASON.waveType, { required: true }), select('grouping_strategy', t('Grouping strategy', 'استراتيجية التجميع'), REASON.groupingStrategy), select('priority', t('Priority', 'الأولوية'), [opt('low', 'Low', 'منخفضة'), opt('normal', 'Normal', 'عادية'), opt('high', 'High', 'عالية')])] },
    'wms:wave_calculate': { title: t('Calculate Wave', 'حساب الموجة'), fields: [lookup('wave_id', t('Wave', 'الموجة'), 'waves', { required: true })] },
    'wms:wave_review': { title: t('Review Wave', 'مراجعة الموجة'), fields: [lookup('wave_id', t('Wave', 'الموجة'), 'waves', { required: true })] },
    'wms:wave_release': { title: t('Release Wave', 'إطلاق الموجة'), fields: [lookup('wave_id', t('Wave', 'الموجة'), 'waves', { required: true })] },
    'wms:wave_complete': { title: t('Complete Wave', 'إكمال الموجة'), fields: [lookup('wave_id', t('Wave', 'الموجة'), 'waves', { required: true })] },
    'wms:wave_cancel': { title: t('Cancel Wave', 'إلغاء الموجة'), fields: [lookup('wave_id', t('Wave', 'الموجة'), 'waves', { required: true })] },

    'wms:count_plan_create': { title: t('Create Count Plan', 'إنشاء خطة جرد'), fields: [text('name', t('Name', 'الاسم'), { required: true }), select('count_scope', t('Scope', 'النطاق'), REASON.countScope, { required: true }), number('frequency_days', t('Frequency (days)', 'التكرار (أيام)'), { required: true, min: 1 }), checkbox('blind_count', t('Blind count', 'جرد أعمى'), { default: true }), number('tolerance_percent', t('Variance tolerance %', 'نسبة تحمل الفرق'), { min: 0 }), lookup('location_id', t('Location (if location-scoped)', 'الموقع (إذا كان النطاق موقعاً)'), 'locations'), lookup('product_id', t('Product (if product-scoped)', 'المنتج (إذا كان النطاق منتجاً)'), 'products'), lookup('zone_id', t('Zone (if zone-scoped)', 'المنطقة (إذا كان النطاق منطقة)'), 'zones')] },
    'wms:count_session_start': { title: t('Start Count Session', 'بدء جلسة جرد'), fields: [lookup('plan_id', t('Count plan', 'خطة الجرد'), 'countPlans', { required: true })] },
    'wms:count_line_record': { title: t('Record Count Line', 'تسجيل سطر جرد'), fields: [lookup('session_id', t('Count session', 'جلسة الجرد'), 'countSessions', { required: true }), text('line_id', t('Count line ID', 'معرّف سطر الجرد'), { required: true }), number('counted_quantity', t('Counted quantity', 'الكمية المعدودة'), { required: true, min: 0 })] },
    'wms:count_submit': { title: t('Submit Count Session', 'تسليم جلسة الجرد'), fields: [lookup('session_id', t('Count session', 'جلسة الجرد'), 'countSessions', { required: true })] },
    'wms:count_recount': { title: t('Request Recount', 'طلب إعادة جرد'), fields: [lookup('session_id', t('Count session', 'جلسة الجرد'), 'countSessions', { required: true })] },
    'wms:count_approve_variance': { title: t('Approve Variance', 'اعتماد الفرق'), fields: [lookup('session_id', t('Count session', 'جلسة الجرد'), 'countSessions', { required: true }), textarea('reason', t('Reason (required for unexplained variances)', 'السبب (مطلوب للفروقات غير المبررة)'))] },
    'wms:count_request_adjustment': { title: t('Request Stock Adjustment', 'طلب تسوية مخزون'), fields: [lookup('session_id', t('Count session', 'جلسة الجرد'), 'countSessions', { required: true })] },

    'wms:dock_appointment_create': { title: t('Create Dock Appointment', 'إنشاء موعد رصيف'), fields: [select('appointment_type', t('Appointment type', 'نوع الموعد'), [opt('inbound', 'Inbound', 'وارد'), opt('outbound', 'Outbound', 'صادر')], { required: true }), text('carrier_name', t('Carrier name', 'اسم الناقل'), { required: true }), datetime('expected_arrival', t('Expected arrival', 'الوصول المتوقع'), { required: true }), datetime('expected_departure', t('Expected departure', 'المغادرة المتوقعة'))] },
    'wms:dock_assign': { title: t('Assign Dock', 'تعيين رصيف'), fields: [lookup('appointment_id', t('Appointment', 'الموعد'), 'dockAppointments', { required: true }), lookup('dock_id', t('Dock', 'الرصيف'), 'docks', { required: true })] },
    'wms:dock_check_in': { title: t('Dock Check-In', 'تسجيل دخول الرصيف'), fields: [lookup('appointment_id', t('Appointment', 'الموعد'), 'dockAppointments', { required: true }), text('vehicle_reference', t('Vehicle reference', 'رقم المركبة'), { required: true })] },
    'wms:dock_start_service': { title: t('Start Dock Service', 'بدء خدمة الرصيف'), fields: [lookup('appointment_id', t('Appointment', 'الموعد'), 'dockAppointments', { required: true })] },
    'wms:dock_depart': { title: t('Dock Departure', 'مغادرة الرصيف'), fields: [lookup('appointment_id', t('Appointment', 'الموعد'), 'dockAppointments', { required: true })] },

    'wms:staging_allocate': { title: t('Allocate Staging', 'تخصيص تجهيز'), fields: [lookup('staging_location_id', t('Staging location', 'موقع التجهيز'), 'locations', { required: true }), lookup('product_id', t('Product', 'المنتج'), 'products', { required: true }), number('quantity', t('Quantity', 'الكمية'), { required: true, min: 0 }), text('source_type', t('Source type', 'نوع المصدر'), { required: true }), text('source_id', t('Source ID', 'معرّف المصدر'), { required: true })] },
    'wms:staging_release': { title: t('Release Staging', 'تحرير التجهيز'), fields: [lookup('allocation_id', t('Staging allocation', 'تخصيص التجهيز'), 'stagingAllocations', { required: true })] },
    'wms:crossdock_evaluate': { title: t('Evaluate Cross-Dock Match', 'تقييم مطابقة العبور المباشر'), fields: [lookup('product_id', t('Product', 'المنتج'), 'products', { required: true }), lookup('outbound_location_id', t('Outbound location', 'موقع الصادر'), 'locations', { required: true }), number('available_quantity', t('Available quantity', 'الكمية المتاحة'), { required: true, min: 0 }), number('demand_quantity', t('Demand quantity', 'الكمية المطلوبة'), { required: true, min: 0 }), text('inbound_source_type', t('Inbound source type', 'نوع مصدر الوارد'), { required: true }), text('inbound_source_id', t('Inbound source ID', 'معرّف مصدر الوارد'), { required: true }), text('outbound_source_type', t('Outbound source type', 'نوع مصدر الصادر'), { required: true }), text('outbound_source_id', t('Outbound source ID', 'معرّف مصدر الصادر'), { required: true })] },
    'wms:crossdock_approve': { title: t('Approve Cross-Dock Match', 'اعتماد مطابقة العبور المباشر'), fields: [lookup('match_id', t('Match', 'المطابقة'), 'crossdockMatches', { required: true })] },
    'wms:crossdock_request_post': { title: t('Request Cross-Dock Posting', 'طلب ترحيل العبور المباشر'), fields: [lookup('match_id', t('Match', 'المطابقة'), 'crossdockMatches', { required: true })] },

    'wms:trace_quality_set': { title: t('Set Lot/Serial Quality Status', 'تحديد حالة جودة الدفعة/الرقم التسلسلي'), fields: [lookup('lot_id', t('Lot', 'الدفعة'), 'lots'), lookup('serial_id', t('Serial', 'الرقم التسلسلي'), 'serials'), select('quality_status', t('Quality status', 'حالة الجودة'), [opt('released', 'Released', 'مُفرج عنه'), opt('quarantined', 'Quarantined', 'حجر صحي'), opt('rejected', 'Rejected', 'مرفوض')], { required: true })] },
    'wms:recall_identify': { title: t('Identify Recall', 'تحديد سحب'), fields: [text('reference', t('Reference', 'المرجع'), { required: true }), lookup('product_id', t('Product', 'المنتج'), 'products', { required: true }), lookup('lot_id', t('Lot', 'الدفعة'), 'lots'), lookup('serial_id', t('Serial', 'الرقم التسلسلي'), 'serials'), textarea('reason', t('Reason', 'السبب'), { required: true })] },
    'wms:recall_analyze': { title: t('Analyze Recall Case', 'تحليل حالة السحب'), fields: [lookup('recall_case_id', t('Recall case', 'حالة السحب'), 'recallCases', { required: true })] },
    'wms:recall_propose_holds': { title: t('Propose Recall Holds', 'اقتراح حجوزات السحب'), fields: [lookup('recall_case_id', t('Recall case', 'حالة السحب'), 'recallCases', { required: true })] },

    'shopfloor:session_open': { title: t('Open Shop-Floor Session', 'فتح جلسة أرضية المصنع'), fields: [lookup('work_order_id', t('Work order', 'أمر العمل'), 'workOrders', { required: true })] },
    'shopfloor:operator_assign': { title: t('Assign Operator', 'تعيين مشغل'), fields: [lookup('session_id', t('Session', 'الجلسة'), 'shopfloorSessions', { required: true }), lookup('operator_id', t('Operator', 'المشغل'), 'operators', { required: true })] },
    'shopfloor:operation_start': { title: t('Start Operation', 'بدء العملية'), fields: [lookup('session_id', t('Session', 'الجلسة'), 'shopfloorSessions', { required: true })] },
    'shopfloor:operation_output': { title: t('Report Output', 'الإبلاغ عن الإنتاج'), fields: [lookup('session_id', t('Session', 'الجلسة'), 'shopfloorSessions', { required: true }), number('produced_quantity', t('Produced quantity', 'الكمية المنتجة'), { required: true, min: 0 }), number('rejected_quantity', t('Rejected quantity', 'الكمية المرفوضة'), { min: 0 })] },
    'shopfloor:operation_complete': { title: t('Complete Operation', 'إكمال العملية'), fields: [lookup('session_id', t('Session', 'الجلسة'), 'shopfloorSessions', { required: true })] },
    'shopfloor:operation_handoff': { title: t('Hand Off Operation', 'تسليم العملية'), fields: [lookup('session_id', t('Session', 'الجلسة'), 'shopfloorSessions', { required: true }), lookup('to_operator_id', t('Hand off to operator', 'التسليم إلى المشغل'), 'operators', { required: true })] },

    'shopfloor:material_request': { title: t('Request Material', 'طلب مادة'), fields: [lookup('production_order_id', t('Production order', 'أمر الإنتاج'), 'productionOrders', { required: true }), lookup('product_id', t('Product', 'المنتج'), 'products', { required: true }), number('requested_quantity', t('Requested quantity', 'الكمية المطلوبة'), { required: true, min: 0 }), select('request_type', t('Request type', 'نوع الطلب'), REASON.materialRequestType, { required: true })] },
    'shopfloor:material_availability': { title: t('Check Material Availability', 'التحقق من توفر المادة'), fields: [lookup('request_id', t('Material request', 'طلب المادة'), 'materialFlow', { required: true })] },
    'shopfloor:material_approve': { title: t('Approve Material Request', 'اعتماد طلب المادة'), fields: [lookup('request_id', t('Material request', 'طلب المادة'), 'materialFlow', { required: true }), number('approved_quantity', t('Approved quantity', 'الكمية المعتمدة'), { required: true, min: 0 })] },
    'shopfloor:material_request_canonical': { title: t('Request Canonical Material Move', 'طلب حركة المادة الرسمية'), fields: [lookup('request_id', t('Material request', 'طلب المادة'), 'materialFlow', { required: true })] },
    'shopfloor:material_acknowledge': { title: t('Acknowledge Material Move', 'الإقرار بحركة المادة'), fields: [lookup('request_id', t('Material request', 'طلب المادة'), 'materialFlow', { required: true }), text('canonical_result_id', t('Canonical result ID', 'معرّف النتيجة الرسمية'), { required: true })] },

    'shopfloor:downtime_start': { title: t('Start Downtime', 'بدء التوقف'), fields: [lookup('session_id', t('Shop-floor session', 'جلسة أرضية المصنع'), 'shopfloorSessions', { required: true }), text('reason_code', t('Reason code', 'رمز السبب'), { required: true }), select('reason_category', t('Reason category', 'فئة السبب'), REASON.downtimeCategory, { required: true })] },
    'shopfloor:downtime_end': { title: t('End Downtime', 'إنهاء التوقف'), fields: [lookup('downtime_id', t('Downtime event', 'حدث التوقف'), 'downtimeEvents', { required: true })] },

    'quality:checkpoint_open': { title: t('Open Quality Checkpoint', 'فتح نقطة فحص جودة'), fields: [select('source_type', t('Source', 'المصدر'), [opt('receiving', 'Receiving', 'استلام'), opt('production', 'Production', 'إنتاج'), opt('shipping', 'Shipping', 'شحن')], { required: true }), text('source_id', t('Source ID', 'معرّف المصدر'), { required: true }), lookup('product_id', t('Product', 'المنتج'), 'products', { required: true }), select('checkpoint_type', t('Checkpoint type', 'نوع نقطة الفحص'), [opt('incoming', 'Incoming', 'وارد'), opt('in_process', 'In-process', 'أثناء العملية'), opt('final', 'Final', 'نهائي')], { required: true }), text('inspection_id', t('Inspection ID', 'معرّف الفحص'), { required: true })] },
    'quality:checkpoint_sync': { title: t('Sync Checkpoint', 'مزامنة نقطة الفحص'), fields: [lookup('checkpoint_id', t('Checkpoint', 'نقطة الفحص'), 'qualityCheckpoints', { required: true })] },
    'quality:checkpoint_conditional_accept': { title: t('Conditionally Accept', 'قبول مشروط'), fields: [lookup('checkpoint_id', t('Checkpoint', 'نقطة الفحص'), 'qualityCheckpoints', { required: true }), number('accepted_quantity', t('Accepted quantity', 'الكمية المقبولة'), { required: true, min: 0 })] },
    'quality:disposition_request': { title: t('Request Disposition', 'طلب قرار تصرف'), fields: [lookup('checkpoint_id', t('Checkpoint', 'نقطة الفحص'), 'qualityCheckpoints', { required: true }), select('disposition_type', t('Disposition type', 'نوع التصرف'), REASON.disposition, { required: true }), number('quantity', t('Quantity', 'الكمية'), { required: true, min: 0 }), text('reason_code', t('Reason', 'السبب'), { required: true }), text('ncr_id', t('NCR ID (required for rework/scrap/return)', 'معرّف تقرير عدم المطابقة (مطلوب لإعادة العمل/الإتلاف/الإرجاع)'))] },
    'quality:disposition_approve': { title: t('Approve Disposition', 'اعتماد قرار التصرف'), fields: [lookup('disposition_id', t('Disposition', 'قرار التصرف'), 'dispositions', { required: true })] },
    'quality:rework_start': { title: t('Start Rework', 'بدء إعادة العمل'), fields: [lookup('rework_route_id', t('Rework route', 'مسار إعادة العمل'), 'reworkRoutes', { required: true })] },
    'quality:rework_complete': { title: t('Complete Rework', 'إكمال إعادة العمل'), fields: [lookup('rework_route_id', t('Rework route', 'مسار إعادة العمل'), 'reworkRoutes', { required: true })] },
    'quality:scrap_request_canonical': { title: t('Request Canonical Scrap Posting', 'طلب ترحيل الإتلاف الرسمي'), fields: [lookup('disposition_id', t('Disposition', 'قرار التصرف'), 'dispositions', { required: true })] },
    'quality:scrap_acknowledge': { title: t('Acknowledge Scrap Posting', 'الإقرار بترحيل الإتلاف'), fields: [lookup('disposition_id', t('Disposition', 'قرار التصرف'), 'dispositions', { required: true }), text('canonical_result_id', t('Canonical result ID', 'معرّف النتيجة الرسمية'), { required: true })] }
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
        else if (!field.required && data[field.name] === '') delete data[field.name];
      });
      return data;
    }
  };
})(window);
