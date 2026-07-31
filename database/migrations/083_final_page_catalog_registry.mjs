// database/migrations/083_final_page_catalog_registry.mjs
//
// Final Page Catalog — control-plane registry.
//
// Three jobs, none of them business schema:
//
//   1. Register the 16 Wave 2 modules in platform_modules and
//      module_expansion_registry. Wave 2 created their TABLES (067-082) but
//      never registered the MODULES, so the control plane could not enable,
//      license, scope, or permission-check any of them, and the kernel refused
//      to accept their action definitions (module_id had no row).
//
//   2. Register every Wave 2 permission in authorization_permissions, so a
//      page can be gated by a real permission instead of a client-side guess.
//
//   3. Create platform_pages — the canonical page registry. Until now the only
//      record of which pages exist lived in three JavaScript literals inside
//      app.js. That is why pages could drift out of navigation, lose their
//      permission, or be referenced with no section behind them (see
//      docs/evidence/final-page-catalog/starting-page-inventory.md). The server
//      now owns the page registry and the regression scan checks the client
//      against it.
//
// No business table is created, altered, or dropped here. No payroll,
// attendance, or timesheet object is touched.
//
// Dialect: SQLite and PostgreSQL — no SQLite-only construct.

const MIGRATION_ID = '083_final_page_catalog_registry';

/**
 * The 16 Wave 2 modules, mirrored from platform/domains/wave2-registry.mjs.
 *
 * Mirrored rather than imported: a migration must stay reproducible against a
 * database created at any past commit, so it cannot depend on a runtime module
 * that may change shape later. The regression suite asserts the two lists stay
 * in sync (tests/final-page-catalog/wave2-wiring.test.mjs).
 */
const WAVE2_MODULES = [
  { id: 'contracts', nameAr: 'العقود والشؤون القانونية', nameEn: 'Contracts & Legal', kind: 'standard', license: 'octagon.contracts', nav: 'resources_supply', ns: 'contracts', migration: '067_contracts_and_legal_management', deps: ['platform_kernel', 'commercial_core'], caps: ['CNT-CONTRACT', 'CNT-OBLIGATION', 'CNT-AMENDMENT', 'CNT-RENEWAL', 'CNT-LEGAL'] },
  { id: 'subscriptions', nameAr: 'الاشتراكات والفوترة الدورية', nameEn: 'Subscriptions & Recurring Billing', kind: 'standard', license: 'octagon.subscriptions', nav: 'commercial_sales', ns: 'subscriptions', migration: '068_subscriptions_and_recurring_billing', deps: ['platform_kernel', 'commercial_core', 'commercial_sales'], caps: ['SUB-PLAN', 'SUB-LIFECYCLE', 'SUB-BILLING', 'SUB-DUNNING', 'SUB-ENTITLEMENT'] },
  { id: 'rental', nameAr: 'التأجير ومعدات الإيجار', nameEn: 'Rental & Equipment Hire', kind: 'standard', license: 'octagon.rental', nav: 'commercial_verticals', ns: 'rental', migration: '069_rental_and_equipment_hire', deps: ['platform_kernel', 'commercial_core', 'stock_inventory', 'assets_management'], caps: ['RNT-AGREEMENT', 'RNT-AVAILABILITY', 'RNT-HANDOVER', 'RNT-RETURN', 'RNT-DEPOSIT'] },
  { id: 'expenses_travel', nameAr: 'المصروفات وسفر الأعمال', nameEn: 'Expenses & Business Travel', kind: 'standard', license: 'octagon.expenses', nav: 'finance_accounts', ns: 'expenses', migration: '070_expenses_and_business_travel', deps: ['platform_kernel', 'finance_canonical'], caps: ['EXP-REPORT', 'EXP-TRAVEL', 'EXP-PERDIEM', 'EXP-POLICY', 'EXP-REIMBURSE'] },
  { id: 'sourcing_tenders', nameAr: 'المشتريات المتقدمة والمناقصات', nameEn: 'Advanced Procurement & Sourcing', kind: 'standard', license: 'octagon.sourcing', nav: 'resources_supply', ns: 'sourcing', migration: '071_advanced_procurement_and_supplier_portal', deps: ['platform_kernel', 'commercial_core', 'commercial_procurement'], caps: ['SRC-REQUISITION', 'SRC-RFQ', 'SRC-BID', 'SRC-AWARD', 'SRC-SCORECARD'] },
  { id: 'human_capital', nameAr: 'تطوير رأس المال البشري', nameEn: 'Human Capital Development', kind: 'standard', license: 'octagon.humancapital', nav: 'resources_org', ns: 'hc', api: 'human_capital', migration: '072_human_capital_development', deps: ['platform_kernel'], caps: ['HC-RECRUIT', 'HC-ONBOARD', 'HC-TRAINING', 'HC-APPRAISAL', 'HC-LEAVE'] },
  { id: 'financial_planning', nameAr: 'الموازنات والتخطيط المالي', nameEn: 'Budgeting & Financial Planning', kind: 'standard', license: 'octagon.planning', nav: 'finance_accounts', ns: 'planning', api: 'financial_planning', migration: '073_budgeting_and_financial_planning', deps: ['platform_kernel', 'finance_canonical'], caps: ['FP-BUDGET', 'FP-FORECAST', 'FP-COSTCENTER', 'FP-COMMITMENT', 'FP-SCENARIO'] },
  { id: 'treasury', nameAr: 'الخزينة والبنوك', nameEn: 'Treasury & Banking', kind: 'standard', license: 'octagon.treasury', nav: 'finance_accounts', ns: 'treasury', migration: '074_treasury_and_cash_management', deps: ['platform_kernel', 'finance_canonical'], caps: ['TRS-BANK', 'TRS-STATEMENT', 'TRS-RECONCILE', 'TRS-TRANSFER', 'TRS-FORECAST'] },
  { id: 'wms_advanced', nameAr: 'إدارة المستودعات المتقدمة', nameEn: 'Advanced Warehouse Management', kind: 'standard', license: 'octagon.wms', nav: 'ops_production', ns: 'wms', migration: '075_advanced_wms', deps: ['platform_kernel', 'stock_inventory', 'stock_wms'], caps: ['WMS-ZONE', 'WMS-BIN', 'WMS-PUTAWAY', 'WMS-WAVE', 'WMS-CYCLECOUNT'] },
  { id: 'plm', nameAr: 'إدارة دورة حياة المنتج', nameEn: 'Product Lifecycle Management', kind: 'standard', license: 'octagon.plm', nav: 'ops_production', ns: 'plm', migration: '076_plm_and_engineering_change_control', deps: ['platform_kernel', 'operations_engineering'], caps: ['PLM-REVISION', 'PLM-ECO', 'PLM-APPROVAL', 'PLM-CAD', 'PLM-EFFECTIVITY'] },
  { id: 'grc', nameAr: 'الحوكمة والمخاطر والامتثال', nameEn: 'Governance, Risk & Compliance', kind: 'standard', license: 'octagon.grc', nav: 'admin_org', ns: 'grc', migration: '077_grc_and_internal_audit', deps: ['platform_kernel'], caps: ['GRC-RISK', 'GRC-CONTROL', 'GRC-FRAMEWORK', 'GRC-AUDIT', 'GRC-FINDING'] },
  { id: 'hse', nameAr: 'الصحة والسلامة والبيئة', nameEn: 'Health, Safety & Environment', kind: 'standard', license: 'octagon.hse', nav: 'admin_org', ns: 'hse', migration: '078_hse_and_safety_management', deps: ['platform_kernel', 'work_item_canonical'], caps: ['HSE-INCIDENT', 'HSE-CAPA', 'HSE-PERMIT', 'HSE-INSPECTION', 'HSE-HAZARD'] },
  { id: 'business_intelligence', nameAr: 'ذكاء الأعمال', nameEn: 'Business Intelligence', kind: 'standard', license: 'octagon.bi', nav: 'intelligence_core', ns: 'bi', migration: '079_business_intelligence', deps: ['platform_kernel'], caps: ['BI-DASHBOARD', 'BI-WIDGET', 'BI-KPI', 'BI-SNAPSHOT', 'BI-SCHEDULE'] },
  { id: 'integration_hub', nameAr: 'مركز التكامل وواجهات البرمجة', nameEn: 'Integration Hub & API Management', kind: 'standard', license: 'octagon.integration', nav: 'admin_org', ns: 'integration', migration: '080_integration_hub_and_api_management', deps: ['platform_kernel'], caps: ['INT-ENDPOINT', 'INT-APIKEY', 'INT-WEBHOOK', 'INT-DELIVERY', 'INT-CONNECTOR'] },
  { id: 'iraq_localization', nameAr: 'التوطين العراقي والضرائب', nameEn: 'Iraq Localization & Tax', kind: 'standard', license: 'octagon.iraq', nav: 'finance_accounts', ns: 'iraq', api: 'iraq_localization', migration: '081_iraq_localization_and_tax', deps: ['platform_kernel', 'finance_canonical'], caps: ['IQ-TAXRULE', 'IQ-FILING', 'IQ-CBIRATE', 'IQ-GOVERNORATE', 'IQ-BILINGUAL'] },
  { id: 'ai_copilot', nameAr: 'مساعد أوكتاغون الذكي', nameEn: 'AI Copilot & Governance', kind: 'optional', license: 'octagon.ai', nav: 'intelligence_ai', ns: 'ai', api: 'ai_copilot', migration: '082_ai_copilot_and_jarvis_governance', deps: ['platform_kernel'], caps: ['AI-AGENT', 'AI-SESSION', 'AI-TOOLAUDIT', 'AI-GUARDRAIL'] },
];

/**
 * Wave 2 entities, grouped by owning module.
 *
 * platform_actions.entity_id has a foreign key into platform_entities, so an
 * action cannot be registered for an entity the kernel has never heard of.
 * Wave 2 never registered any of its entities, which is the second reason its
 * action definitions could not be written. Each id below maps 1:1 to a table
 * created by migrations 067-082.
 */
const WAVE2_ENTITIES = {
  contracts: [['contract', 'عقد', 'Contract'], ['contract_obligation', 'التزام تعاقدي', 'Contract Obligation'], ['contract_guarantee', 'ضمان تعاقدي', 'Contract Guarantee'], ['legal_matter', 'قضية قانونية', 'Legal Matter']],
  subscriptions: [['subscription_plan', 'خطة اشتراك', 'Subscription Plan'], ['subscription', 'اشتراك', 'Subscription'], ['subscription_billing_cycle', 'دورة فوترة اشتراك', 'Subscription Billing Cycle']],
  rental: [['rental_product_config', 'إعداد صنف تأجير', 'Rental Product Configuration'], ['rental_agreement', 'عقد تأجير', 'Rental Agreement'], ['rental_extension', 'تمديد تأجير', 'Rental Extension'], ['rental_return', 'إرجاع تأجير', 'Rental Return'], ['rental_maintenance_hold', 'حجز صيانة للتأجير', 'Rental Maintenance Hold']],
  expenses_travel: [['expense_category', 'فئة مصروف', 'Expense Category'], ['travel_request', 'طلب سفر', 'Travel Request'], ['expense_report', 'تقرير مصروفات', 'Expense Report'], ['expense_line', 'بند مصروف', 'Expense Line']],
  sourcing_tenders: [['purchase_requisition', 'طلب شراء داخلي', 'Purchase Requisition'], ['purchase_requisition_line', 'بند طلب شراء داخلي', 'Purchase Requisition Line'], ['rfq_header', 'طلب عروض أسعار', 'Request for Quotation'], ['rfq_supplier', 'مورّد مدعو لطلب العروض', 'RFQ Invited Supplier'], ['supplier_bid', 'عرض مورّد', 'Supplier Bid'], ['supplier_evaluation', 'تقييم أداء مورّد', 'Supplier Evaluation']],
  human_capital: [['job_opening', 'شاغر وظيفي', 'Job Opening'], ['job_application', 'طلب توظيف', 'Job Application'], ['training_course', 'دورة تدريبية', 'Training Course'], ['training_enrollment', 'تسجيل في دورة تدريبية', 'Training Enrollment'], ['leave_type', 'نوع إجازة', 'Leave Type'], ['leave_request', 'طلب إجازة', 'Leave Request']],
  financial_planning: [['cost_center', 'مركز تكلفة', 'Cost Center'], ['fiscal_budget', 'موازنة مالية', 'Fiscal Budget'], ['budget_line', 'بند موازنة', 'Budget Line'], ['budget_commitment', 'التزام على الموازنة', 'Budget Commitment'], ['budget_reallocation', 'إعادة توزيع موازنة', 'Budget Reallocation'], ['financial_forecast', 'توقّع مالي', 'Financial Forecast']],
  treasury: [['bank_account', 'حساب بنكي', 'Bank Account'], ['bank_statement', 'كشف حساب بنكي', 'Bank Statement'], ['bank_statement_line', 'بند كشف حساب بنكي', 'Bank Statement Line'], ['cash_reconciliation', 'تسوية نقدية', 'Cash Reconciliation'], ['cash_transfer', 'تحويل نقدي', 'Cash Transfer']],
  wms_advanced: [['wms_warehouse', 'مستودع', 'Warehouse'], ['wms_zone', 'منطقة تخزين', 'Storage Zone'], ['wms_bin', 'موقع تخزين', 'Storage Bin'], ['wms_bin_inventory', 'رصيد موقع تخزين', 'Bin Inventory'], ['wms_wave_picking', 'موجة تجميع', 'Wave Picking'], ['wms_pick_task', 'مهمة تجميع', 'Pick Task'], ['wms_stock_transfer', 'تحويل مخزني بين المواقع', 'Bin Stock Transfer'], ['wms_cycle_count', 'جرد دوري', 'Cycle Count']],
  plm: [['plm_engineering_revision', 'مراجعة هندسية', 'Engineering Revision'], ['plm_engineering_change_order', 'أمر تغيير هندسي', 'Engineering Change Order'], ['plm_eco_affected_item', 'صنف متأثر بأمر التغيير', 'ECO Affected Item'], ['plm_eco_approval', 'اعتماد أمر تغيير هندسي', 'ECO Approval']],
  grc: [['grc_risk_register', 'سجل مخاطر', 'Risk Register'], ['grc_risk_mitigation', 'إجراء معالجة مخاطر', 'Risk Mitigation'], ['grc_compliance_framework', 'إطار امتثال', 'Compliance Framework'], ['grc_compliance_control', 'ضابط امتثال', 'Compliance Control'], ['grc_control_evaluation', 'تقييم ضابط امتثال', 'Control Evaluation'], ['grc_internal_audit', 'تدقيق داخلي', 'Internal Audit'], ['grc_audit_finding', 'ملاحظة تدقيق', 'Audit Finding']],
  hse: [['hse_incident', 'حادث سلامة', 'Safety Incident'], ['hse_incident_investigation', 'تحقيق في حادث', 'Incident Investigation'], ['hse_corrective_action', 'إجراء تصحيحي ووقائي', 'Corrective & Preventive Action'], ['hse_safety_permit', 'تصريح عمل آمن', 'Safety Work Permit'], ['hse_safety_inspection', 'تفتيش سلامة', 'Safety Inspection']],
  business_intelligence: [['bi_dashboard', 'لوحة معلومات', 'Dashboard'], ['bi_widget', 'عنصر لوحة معلومات', 'Dashboard Widget'], ['bi_kpi_definition', 'تعريف مؤشر أداء', 'KPI Definition'], ['bi_kpi_snapshot', 'لقطة مؤشر أداء', 'KPI Snapshot'], ['bi_scheduled_report', 'تقرير مجدول', 'Scheduled Report']],
  integration_hub: [['api_endpoint', 'نقطة نهاية برمجية', 'API Endpoint'], ['api_key', 'مفتاح برمجي', 'API Key'], ['webhook_subscription', 'اشتراك ويب هوك', 'Webhook Subscription'], ['webhook_delivery', 'تسليم ويب هوك', 'Webhook Delivery'], ['integration_connector', 'موصّل تكامل', 'Integration Connector']],
  iraq_localization: [['iq_tax_rule', 'قاعدة ضريبية عراقية', 'Iraqi Tax Rule'], ['iq_tax_filing', 'إقرار ضريبي', 'Tax Filing'], ['iq_currency_conversion', 'سعر صرف رسمي', 'Official Exchange Rate'], ['iq_bilingual_template', 'قالب ثنائي اللغة', 'Bilingual Template']],
  ai_copilot: [['ai_agent', 'وكيل ذكاء اصطناعي', 'AI Agent'], ['ai_session', 'جلسة مساعد ذكي', 'AI Session'], ['ai_message', 'رسالة مساعد ذكي', 'AI Message'], ['ai_tool_call_audit', 'تدقيق استدعاء أداة ذكية', 'AI Tool Call Audit'], ['ai_guardrail_rule', 'قاعدة ضبط للذكاء الاصطناعي', 'AI Guardrail Rule']],
};

/** Wave 2 permission ids, grouped by owning module. */
const WAVE2_PERMISSIONS = {
  contracts: ['contracts.view', 'contracts.create', 'contracts.update', 'contracts.approve', 'contracts.amend', 'contracts.renew', 'contracts.terminate', 'contracts.obligations.manage', 'contracts.legal.manage'],
  subscriptions: ['subscriptions.view', 'subscriptions.create', 'subscriptions.update', 'subscriptions.activate', 'subscriptions.bill', 'subscriptions.pause', 'subscriptions.cancel', 'subscriptions.plans.manage'],
  rental: ['rental.view', 'rental.create', 'rental.update', 'rental.handover', 'rental.return', 'rental.extend', 'rental.configure', 'rental.maintenance.hold'],
  expenses_travel: ['expenses.view', 'expenses.create', 'expenses.submit', 'expenses.approve', 'expenses.pay', 'expenses.travel.request', 'expenses.travel.approve', 'expenses.configure'],
  sourcing_tenders: ['sourcing.view', 'sourcing.requisition.create', 'sourcing.requisition.approve', 'sourcing.rfq.create', 'sourcing.rfq.publish', 'sourcing.bid.submit', 'sourcing.award', 'sourcing.supplier.evaluate'],
  human_capital: ['hc.view', 'hc.recruitment.manage', 'hc.application.submit', 'hc.hire', 'hc.training.manage', 'hc.training.enroll', 'hc.leave.request', 'hc.leave.approve', 'hc.appraisal.manage'],
  financial_planning: ['planning.view', 'planning.budget.create', 'planning.budget.approve', 'planning.budget.commit', 'planning.budget.reallocate', 'planning.forecast.manage', 'planning.costcenter.manage'],
  treasury: ['treasury.view', 'treasury.account.manage', 'treasury.statement.import', 'treasury.reconcile', 'treasury.reconcile.finalize', 'treasury.transfer.execute'],
  wms_advanced: ['wms.view', 'wms.configure', 'wms.receive', 'wms.wave.manage', 'wms.pick', 'wms.transfer', 'wms.count'],
  plm: ['plm.view', 'plm.revision.create', 'plm.eco.create', 'plm.eco.approve', 'plm.eco.implement'],
  grc: ['grc.view', 'grc.risk.manage', 'grc.control.manage', 'grc.control.evaluate', 'grc.audit.manage', 'grc.finding.manage'],
  hse: ['hse.view', 'hse.incident.report', 'hse.incident.investigate', 'hse.capa.manage', 'hse.permit.request', 'hse.permit.issue', 'hse.inspection.record'],
  business_intelligence: ['bi.view', 'bi.dashboard.create', 'bi.widget.manage', 'bi.kpi.define', 'bi.kpi.snapshot', 'bi.report.schedule'],
  integration_hub: ['integration.view', 'integration.endpoint.manage', 'integration.apikey.manage', 'integration.webhook.manage', 'integration.connector.manage'],
  iraq_localization: ['iraq.view', 'iraq.taxrule.manage', 'iraq.filing.submit', 'iraq.rate.record', 'iraq.template.manage'],
  ai_copilot: ['ai.view', 'ai.agent.manage', 'ai.session.start', 'ai.message.record', 'ai.tool.audit', 'ai.guardrail.manage'],
};

export const migration = {
  id: MIGRATION_ID,
  description: 'Migration 083: Final Page Catalog control-plane registry — Wave 2 module registration, Wave 2 permission registration, and the canonical platform_pages registry.',
  owner: 'platform.control_plane',
  dialect: ['sqlite', 'postgres'],

  async up(db) {
    const now = new Date().toISOString();

    // ---------------------------------------------------------------------
    // 1. platform_modules — register the 16 Wave 2 modules.
    //
    // status 'installed', not 'enabled': the schema exists, so the module is
    // installed, but enabling it for a company is a control-plane decision
    // taken in the Module & Pack Center, not a migration decision. A page whose
    // module is installed-but-not-enabled must render the disabled-module state,
    // which is exactly what §74 requires and what we can now prove.
    // ---------------------------------------------------------------------
    const upsertModule = db.prepare(`
      INSERT INTO platform_modules (
        id, name, version, status, kind, owner, dependencies,
        optional_dependencies, capabilities, migrations, settings,
        created_at, updated_at
      ) VALUES (?, ?, '2.0.0', 'installed', ?, 'octagon.platform', ?, '[]', ?, ?, '[]', ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        version = excluded.version,
        kind = excluded.kind,
        dependencies = excluded.dependencies,
        capabilities = excluded.capabilities,
        migrations = excluded.migrations,
        updated_at = excluded.updated_at
    `);

    // Three Wave 2 modules (contracts, rental, subscriptions) already had a
    // placeholder row from migration 064 with status 'available' — declared but
    // not installable. Their schema now exists, so advance them to 'installed'.
    // The advance is conditional: a module an administrator has already ENABLED
    // must never be pushed back down to 'installed' by a migration re-run.
    const advanceToInstalled = db.prepare(`
      UPDATE platform_modules SET status = 'installed', updated_at = ?
      WHERE id = ? AND status = 'available'
    `);

    for (const m of WAVE2_MODULES) {
      upsertModule.run(
        m.id, m.nameEn, m.kind,
        JSON.stringify(m.deps), JSON.stringify(m.caps), JSON.stringify([m.migration]),
        now, now,
      );
      advanceToInstalled.run(now, m.id);
    }

    // ---------------------------------------------------------------------
    // 2. module_expansion_registry — the bilingual, license-aware wave record.
    // ---------------------------------------------------------------------
    const upsertExpansion = db.prepare(`
      INSERT INTO module_expansion_registry (
        module_id, wave, name_ar, name_en, license_key, nav_group,
        permission_namespace, lifecycle, module_pre_existed, schema_migration,
        feature_flags, health_check, created_at, updated_at
      ) VALUES (?, 'wave-2', ?, ?, ?, ?, ?, 'available', 0, ?, '{}', ?, ?, ?)
      ON CONFLICT(module_id) DO UPDATE SET
        wave = excluded.wave,
        name_ar = excluded.name_ar,
        name_en = excluded.name_en,
        license_key = excluded.license_key,
        nav_group = excluded.nav_group,
        permission_namespace = excluded.permission_namespace,
        lifecycle = excluded.lifecycle,
        schema_migration = excluded.schema_migration,
        health_check = excluded.health_check,
        updated_at = excluded.updated_at
    `);

    for (const m of WAVE2_MODULES) {
      upsertExpansion.run(
        m.id, m.nameAr, m.nameEn, m.license, m.nav, m.ns, m.migration,
        `/api/v1/${m.api || m.ns}`, now, now,
      );
    }

    // ---------------------------------------------------------------------
    // 3. platform_entities — register every Wave 2 entity.
    //
    // platform_actions.entity_id is a foreign key into this table. Without
    // these rows the kernel rejects every Wave 2 action definition with
    // "FOREIGN KEY constraint failed", which is the second reason none of the
    // 105 Wave 2 actions could execute.
    //
    // query_policy 'scoped' + action_policy 'registered' means: reads are
    // company-scoped and writes must go through a registered action. That is
    // precisely the guarantee the pages in this wave depend on.
    // ---------------------------------------------------------------------
    // DO NOTHING on conflict, deliberately — not DO UPDATE.
    //
    // Two of the ids below (purchase_requisition, purchase_requisition_line)
    // ALREADY exist, owned by commercial_procurement since migration 040/047.
    // An upsert would re-parent those canonical entities to a Wave 2 module —
    // a duplicate-authority violation — and, worse, rollback would then delete
    // them and orphan commercial_procurement's own actions
    // (foreign_key_check: platform_actions -> platform_entities).
    //
    // One entity has exactly one owner. Wave 2's sourcing actions bind to the
    // existing canonical entity rather than claiming it.
    const insertEntity = db.prepare(`
      INSERT INTO platform_entities (
        id, module_id, storage_owner, primary_key, label_ar, label_en,
        section, sequence, seq_field, chatter, acl, status_key, fields,
        relations, scope, lifecycle_policy, query_policy, action_policy,
        customization_policy, history_policy, api_exposed, migration_owner,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'id', ?, ?, NULL, NULL, NULL, 0, NULL, NULL, '{}',
        '{}', 'company', 'generic', 'scoped', 'registered', 'metadata',
        'audit', 1, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `);

    for (const [moduleId, entities] of Object.entries(WAVE2_ENTITIES)) {
      for (const [entityId, labelAr, labelEn] of entities) {
        insertEntity.run(entityId, moduleId, moduleId, labelAr, labelEn, MIGRATION_ID, now, now);
      }
    }

    // ---------------------------------------------------------------------
    // 4. authorization_permissions — one row per Wave 2 permission.
    // ---------------------------------------------------------------------
    const upsertPermission = db.prepare(`
      INSERT INTO authorization_permissions (
        id, module_id, kind, resource, action, label_ar, label_en,
        sensitive, depends_on, deprecated, replaced_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', 0, NULL, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        module_id = excluded.module_id,
        kind = excluded.kind,
        resource = excluded.resource,
        action = excluded.action,
        label_en = excluded.label_en,
        sensitive = excluded.sensitive,
        updated_at = excluded.updated_at
    `);

    // Permissions that touch money movement, secrets, or safety sign-off are
    // marked sensitive so the permission centre can surface them separately.
    const SENSITIVE = /(\.pay$|\.approve$|transfer\.execute|reconcile\.finalize|apikey|guardrail|permit\.issue|award$|hire$)/;

    for (const [moduleId, ids] of Object.entries(WAVE2_PERMISSIONS)) {
      for (const id of ids) {
        const parts = id.split('.');
        const action = parts[parts.length - 1];
        const resource = parts.slice(0, -1).join('.') || parts[0];
        upsertPermission.run(
          id, moduleId, 'action', resource, action,
          null, id, SENSITIVE.test(id) ? 1 : 0, now, now,
        );
      }
    }

    // ---------------------------------------------------------------------
    // 5. platform_pages — the canonical page registry.
    //
    // One row per visible page. This is what makes §79's regression scan
    // possible: the client's navigation, permission map, and template map are
    // checked AGAINST this table, so a page can no longer silently lose its
    // navigation entry or its permission.
    // ---------------------------------------------------------------------
    db.prepare(`
      CREATE TABLE IF NOT EXISTS platform_pages (
        id TEXT PRIMARY KEY,
        module_id TEXT NOT NULL,
        name_ar TEXT NOT NULL,
        name_en TEXT NOT NULL,
        nav_group TEXT,
        nav_domain TEXT,
        section_id TEXT NOT NULL,
        view_file TEXT,
        controller TEXT,
        required_permission TEXT,
        entitlement_module TEXT,
        query_authority TEXT NOT NULL DEFAULT '[]',
        mutation_authority TEXT NOT NULL DEFAULT '[]',
        data_authority TEXT,
        company_scope TEXT NOT NULL DEFAULT 'company',
        page_family TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        route_aliases TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `).run();

    db.prepare('CREATE INDEX IF NOT EXISTS idx_platform_pages_module ON platform_pages(module_id)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_platform_pages_nav ON platform_pages(nav_group)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_platform_pages_family ON platform_pages(page_family)').run();
  },

  async down(db) {
    // Reverse only what this migration created. Wave 2 business tables belong
    // to 067-082 and are untouched here; removing their module rows would
    // orphan real data, so the modules revert to 'available' instead.
    const now = new Date().toISOString();

    db.prepare('DROP INDEX IF EXISTS idx_platform_pages_family').run();
    db.prepare('DROP INDEX IF EXISTS idx_platform_pages_nav').run();
    db.prepare('DROP INDEX IF EXISTS idx_platform_pages_module').run();
    db.prepare('DROP TABLE IF EXISTS platform_pages').run();

    for (const [moduleId, ids] of Object.entries(WAVE2_PERMISSIONS)) {
      for (const id of ids) {
        db.prepare('DELETE FROM authorization_permissions WHERE id = ? AND module_id = ?').run(id, moduleId);
      }
    }

    // Actions reference entities, so the action definitions this wave seeded
    // must go before the entity rows they point at. Scope the delete to the
    // Wave 2 modules only — an action owned by commercial_procurement or any
    // other pre-existing module must survive this rollback untouched.
    const wave2ModuleIds = WAVE2_MODULES.map((m) => m.id);
    db.prepare(
      `DELETE FROM platform_actions WHERE module_id IN (${wave2ModuleIds.map(() => '?').join(',')})`,
    ).run(...wave2ModuleIds);
    for (const entities of Object.values(WAVE2_ENTITIES)) {
      for (const [entityId] of entities) {
        db.prepare('DELETE FROM platform_entities WHERE id = ? AND migration_owner = ?').run(entityId, MIGRATION_ID);
      }
    }

    for (const m of WAVE2_MODULES) {
      db.prepare('UPDATE module_expansion_registry SET lifecycle = ?, updated_at = ? WHERE module_id = ?')
        .run('planned', now, m.id);
      db.prepare('UPDATE platform_modules SET status = ?, updated_at = ? WHERE id = ?')
        .run('available', now, m.id);
    }
  },
};

export { WAVE2_MODULES, WAVE2_PERMISSIONS, WAVE2_ENTITIES };
