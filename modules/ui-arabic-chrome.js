/**
 * Arabic chrome for the five legacy panels that were never translated.
 *
 * phase7a-stabilization, implementation-methodology, platform-marketplace,
 * platform-services and sales-commercial-pack build their markup by
 * concatenating quoted HTML fragments, so their table headers, buttons and
 * empty states were English literals buried mid-string. The rest of the app
 * translates at a render helper (build08 AR_FIELDS, build11 FORM_AR,
 * build12 LABELS_AR); these modules have no such helper to hook.
 *
 * Rewriting 155 literals into `' + t('x') + '` splices would have meant
 * unverifiable syntax surgery across five files, so instead the finished HTML
 * string is passed through one dictionary substitution at each innerHTML site.
 * This is a pure string transform at render time — deliberately NOT a DOM
 * MutationObserver, which is what made the language layer slow before.
 *
 * Only exact whole text nodes are replaced, so partial words, attribute values
 * and interpolated numbers are left alone. Untranslated text passes through
 * unchanged, and English mode (the toggle in omni-language-fix.js) is a no-op.
 */
(function octagonArabicChrome(root) {
  'use strict';

  const AR = {
    'AI events': 'أحداث الذكاء الاصطناعي',
    'Action': 'الإجراء',
    'Actions': 'الإجراءات',
    'Actual': 'الفعلي',
    'Add target': 'إضافة هدف',
    'Apply plan': 'تطبيق الخطة',
    'Auth events': 'أحداث الدخول',
    'Backup age': 'عمر النسخة الاحتياطية',
    'Backup count': 'عدد النسخ الاحتياطية',
    'Backup folder': 'مجلد النسخ الاحتياطية',
    'Backups': 'النسخ الاحتياطية',
    'Balance': 'الرصيد',
    'Batch': 'الدفعة',
    'Blocked / failed / approval': 'محظور / فاشل / بانتظار اعتماد',
    'Branch': 'الفرع',
    'Capability': 'القدرة',
    'Channel': 'القناة',
    'Checklist item': 'بند القائمة',
    'Collaboration, notifications, and scheduled reporting': 'التعاون والإشعارات والتقارير المجدولة',
    'Commit': 'الالتزام',
    'Company setup wizard foundation': 'أساس معالج تهيئة الشركة',
    'Company setup, industry templates, sign-off, and launch method': 'تهيئة الشركة وقوالب القطاعات والاعتماد وطريقة الإطلاق',
    'Contract': 'العقد',
    'Copy': 'نسخ',
    'Copy statement': 'نسخ كشف الحساب',
    'Count/sample': 'العدد/عينة',
    'Create scoped key': 'إنشاء مفتاح مقيّد',
    'Create validation batch': 'إنشاء دفعة تحقق',
    'Created': 'تاريخ الإنشاء',
    'Credit': 'دائن',
    'Current client user': 'مستخدم الجهاز الحالي',
    'Customer': 'العميل',
    'Data Import Center': 'مركز استيراد البيانات',
    'Database parse': 'قراءة قاعدة البيانات',
    'Date': 'التاريخ',
    'Debit': 'مدين',
    'Delivery health': 'سلامة التسليم',
    'Developer API Keys': 'مفاتيح واجهة المطوّرين',
    'Dirty state': 'تغييرات غير محفوظة',
    'End': 'النهاية',
    'Enforcement contract': 'عقد الإلزام',
    'Entity': 'الكيان',
    'Errors': 'الأخطاء',
    'Event': 'الحدث',
    'Evidence': 'الدليل',
    'Extension registry, tier gates, API keys, and webhooks': 'سجل الإضافات وبوابات الفئات ومفاتيح الواجهة وخطافات الويب',
    'External providers remain staged or disabled.': 'مزوّدو الخدمة الخارجيون ما زالوا معطّلين أو قيد التهيئة.',
    'Fix policy': 'سياسة المعالجة',
    'Gate': 'البوابة',
    'Go-live checklist': 'قائمة الإطلاق',
    'Go-live control': 'التحكم بالإطلاق',
    'High-risk related': 'مرتبط بمخاطر عالية',
    'Industry templates': 'قوالب القطاعات',
    'Installments': 'الأقساط',
    'Issue': 'المشكلة',
    'Job Queue': 'طابور المهام',
    'Key': 'المفتاح',
    'Latest backup': 'أحدث نسخة احتياطية',
    'Lock period': 'إقفال الفترة',
    'Message': 'الرسالة',
    'Model': 'النموذج',
    'Module': 'الوحدة',
    'Module Catalog': 'دليل الوحدات',
    'Month': 'الشهر',
    'No API keys yet.': 'لا توجد مفاتيح واجهة بعد.',
    'No audit events found.': 'لا توجد أحداث تدقيق.',
    'No delivery attempts yet.': 'لا توجد محاولات تسليم بعد.',
    'No deployment blockers detected by Phase 7B checks.': 'لم تكتشف فحوصات المرحلة 7B أي عوائق للنشر.',
    'No invoice/payment rows for this customer.': 'لا توجد فواتير أو مدفوعات لهذا العميل.',
    'No period locks yet.': 'لا توجد فترات مقفلة بعد.',
    'No registered matches.': 'لا توجد نتائج مسجَّلة.',
    'No sales orders yet.': 'لا توجد أوامر بيع بعد.',
    'No sales targets yet.': 'لا توجد أهداف مبيعات بعد.',
    'No sent/approved quotes yet.': 'لا توجد عروض مرسلة أو معتمدة بعد.',
    'No share drafts prepared yet.': 'لا توجد مسودات مشاركة جاهزة بعد.',
    'No validation batches yet.': 'لا توجد دفعات تحقق بعد.',
    'Note': 'ملاحظة',
    'Opening balance control': 'التحكم بالأرصدة الافتتاحية',
    'Order': 'الأمر',
    'Order to Work': 'من الأمر إلى التنفيذ',
    'Owner': 'المسؤول',
    'P0 launch checklist and role training': 'قائمة إطلاق P0 وتدريب الأدوار',
    'Password storage': 'تخزين كلمات المرور',
    'Period': 'الفترة',
    'Phase 7J Sales Commercial Pack': 'حزمة المبيعات التجارية — المرحلة 7J',
    'Phase 7K Implementation Methodology': 'منهجية التطبيق — المرحلة 7K',
    'Platform / Marketplace Foundation': 'أساس المنصة والسوق',
    'Platform Services': 'خدمات المنصة',
    'Plugin / Extension Registry': 'سجل الإضافات والملحقات',
    'Port fallback': 'المنفذ البديل',
    'Progress': 'التقدم',
    'Quote': 'عرض السعر',
    'Quote to Contract': 'من العرض إلى العقد',
    'Read-only checks. No auto-fix is performed.': 'فحوصات للقراءة فقط. لا يُجرى أي إصلاح تلقائي.',
    'Reason': 'السبب',
    'Recommendation': 'التوصية',
    'Record proof review': 'تسجيل مراجعة الدليل',
    'Ref': 'المرجع',
    'Refresh': 'تحديث',
    'Remote': 'المستودع البعيد',
    'Required columns': 'الأعمدة المطلوبة',
    'Required tier': 'الفئة المطلوبة',
    'Restore dry-run': 'محاكاة الاستعادة',
    'Result': 'النتيجة',
    'Revoke': 'إلغاء',
    'Risk/source': 'المخاطر/المصدر',
    'Role': 'الدور',
    'Routes': 'المسارات',
    'Rows': 'الصفوف',
    'Scopes': 'النطاقات',
    'Search results': 'نتائج البحث',
    'Seed current month': 'تعبئة الشهر الحالي',
    'Server port': 'منفذ الخادم',
    'Server session': 'جلسة الخادم',
    'Session mode': 'نمط الجلسة',
    'Severity': 'الخطورة',
    'Simulate': 'محاكاة',
    'Source': 'المصدر',
    'Start': 'البداية',
    'Status': 'الحالة',
    'Switcher policy': 'سياسة التبديل',
    'Target': 'الهدف',
    'Tenant': 'المستأجر',
    'Time': 'الوقت',
    'Total': 'الإجمالي',
    'Total audit events': 'إجمالي أحداث التدقيق',
    'Total issues': 'إجمالي المشاكل',
    'Training checklist': 'قائمة التدريب',
    'Type': 'النوع',
    'Unable to load platform services:': 'تعذّر تحميل خدمات المنصة:',
    'Unlock': 'فتح الإقفال',
    'User': 'المستخدم',
    'Validated import batches before write': 'دفعات استيراد مُتحقَّق منها قبل الكتابة',
    'Verify latest backup': 'التحقق من أحدث نسخة احتياطية',
    'Mark done': 'وضع علامة منجز',
    'Reopen': 'إعادة فتح',
    'Preview audit export': 'معاينة تصدير التدقيق',
    'Preview reorder suggestions': 'معاينة مقترحات إعادة الطلب',
    'Total issues found': 'إجمالي المشاكل المكتشفة',

    // Remaining legacy panels reached through the switchPage hook rather than
    // their own render call. Code identifiers (omni.aiAgents.catalog), shell
    // commands, URLs, file names and format acronyms are deliberately absent —
    // those must stay literal.
    'HRMS Lifecycle Foundation': 'أساس دورة حياة الموارد البشرية',
    'Area': 'المجال',
    'What is wired': 'ما تم ربطه',
    'Org Chart Snapshot': 'لقطة الهيكل التنظيمي',
    'Phase 7I Advanced Inventory and Supply Chain': 'المخزون المتقدم وسلسلة التوريد — المرحلة 7I',
    'Phase 7H Finance Close and Planning': 'الإقفال المالي والتخطيط — المرحلة 7H',
    'AR/AP aging preview': 'معاينة أعمار الذمم المدينة والدائنة',
    'budget lines for period': 'بنود الموازنة للفترة',
    'reserved units': 'وحدات محجوزة',
    'suppliers': 'الموردون',
    'materials': 'المواد',
    'Scope': 'النطاق',
    'All': 'الكل',
    'Work': 'العمل',
    'Family': 'النوع',
    'Due': 'الاستحقاق',
    'Flags': 'الإشارات',
    'Low': 'منخفض',
    'Medium': 'متوسط',
    'High': 'مرتفع',
    'Urgent': 'عاجل',
    'None': 'بلا',
    'Daily': 'يومي',
    'Checklist': 'قائمة التحقق',
    'Review': 'مراجعة',
    'Pilot Review': 'مراجعة التشغيل التجريبي',
    'Manual Debug': 'تصحيح يدوي',
    'Manual Debug Mode': 'وضع التصحيح اليدوي',
    'Agent Catalog Foundation': 'أساس دليل الوكلاء',
    'All states': 'كل الحالات',
    'Requested': 'مطلوب',
    'Shortage': 'نقص',
    'Available': 'متاح',
    'Default': 'افتراضي',
    'Phase': 'المرحلة',
    'High-risk unmapped deny': 'منع غير مُخطَّط عالي المخاطر',
    'Command Center': 'مركز القيادة',
    'Task Manager': 'مدير المهام',
    'HRMS Lifecycle': 'دورة حياة الموارد البشرية',
    'Route Health': 'صحة المسارات',
  };

  const isArabic = () => (document.documentElement.dir || '').toLowerCase() === 'rtl'
    || (document.documentElement.lang || '').toLowerCase().startsWith('ar');

  /** Replace whole text nodes that exactly match a dictionary entry. */
  function localize(html) {
    if (html == null || !isArabic()) return html;
    return String(html).replace(/>([^<>]+)</g, (match, inner) => {
      const key = inner.trim();
      if (!key) return match;
      const translated = AR[key];
      if (!translated) return match;
      return '>' + inner.replace(key, translated) + '<';
    });
  }

  /**
   * Translate a container that has already been rendered.
   *
   * Walks text nodes and rewrites only those whose trimmed value is an exact
   * dictionary match. Elements and their attributes are never touched, so the
   * event listeners these panels attach directly after render survive — which
   * reassigning innerHTML would silently destroy.
   */
  function localizeElement(element) {
    if (!element || !isArabic() || typeof document === 'undefined') return element;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
    const pending = [];
    let node = walker.nextNode();
    while (node) {
      const translated = AR[String(node.nodeValue || '').trim()];
      if (translated) pending.push([node, translated]);
      node = walker.nextNode();
    }
    pending.forEach(([textNode, translated]) => {
      textNode.nodeValue = textNode.nodeValue.replace(textNode.nodeValue.trim(), translated);
    });
    return element;
  }

  root.OctagonArabicChrome = { localize, localizeElement, dictionary: AR };
}(window));
