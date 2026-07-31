// platform/domains/wave2-registry.mjs — Final Page Catalog · Wave 2 domain registry.
//
// WHY THIS FILE EXISTS
//
// Module Expansion Wave 2 shipped 16 business domains as migrations (067-082)
// + service modules + unit tests, and stopped there. None of them were wired
// into the running runtime, none had a governed query path, and none had a
// page. From the application's point of view all 16 were MODULE NOT
// IMPLEMENTED.
//
// Worse, Wave 2 shipped two mutually incompatible registration dialects and
// NEITHER matches the kernel contract:
//
//   executor.registerAction('contracts:create', { permission, handler })   // contracts/subscriptions/rental
//   actionRegistry.register('wms:create-warehouse', async (ctx, p) => ...) // the other 13
//
// The real contract (platform/kernel/actions/index.mjs) is:
//
//   actionExecutor.registerHandler(actionId, fn)     + a platform_actions row
//
// exactly as platform/domains/crm/index.mjs does it. Neither Wave 2 dialect
// would have executed. That is a nonfunctional-primary-action defect, which
// §81 forbids deferring, so it is corrected here rather than recorded.
//
// WHAT THIS FILE IS
//
// One declarative registry — the single source of truth for:
//   - which Wave 2 modules exist, and their control-plane identity
//   - every governed action: id, entity, permission, required input, service fn
//   - every governed read: resource name, table, scope rule, filterable columns
//
// Everything downstream (action registration, the query API, the page
// registry, the regression scan) is generated from this one declaration, so a
// page can never reference an action or query that does not exist.
//
// SCOPE RULES
//
//   scope: 'company'  -> WHERE company_id = <session company>
//   scope: 'parent'   -> WHERE <fk> IN (SELECT id FROM <parent> WHERE company_id = ?)
//   scope: 'global'   -> reference data with no company column (read-only lookup)
//
// The browser never supplies company_id. It is always the server-derived
// session scope. See platform/kernel/actions/domain-handler.mjs.

'use strict';

import * as contracts from './contracts/service.mjs';
import * as subscriptions from './subscriptions/service.mjs';
import * as rental from './rental/service.mjs';
import * as expenses from './expenses/service.mjs';
import * as procurement from './procurement/service.mjs';
import * as humanCapital from './human_capital/service.mjs';
import * as financialPlanning from './financial_planning/service.mjs';
import * as treasury from './treasury/service.mjs';
import * as wms from './wms/service.mjs';
import * as plm from './plm/service.mjs';
import * as grc from './grc/service.mjs';
import * as hse from './hse/service.mjs';
import * as bi from './bi/service.mjs';
import * as integration from './integration/service.mjs';
import * as iraq from './iraq_localization/service.mjs';
import * as aiCopilot from './ai_copilot/service.mjs';

/** Common list filters every governed resource accepts. */
const PAGING = ['limit', 'offset'];

/**
 * The 16 Wave 2 domains.
 *
 * `module` fields feed platform_modules / module_expansion_registry.
 * `actions` feed platform_actions + ActionExecutor.registerHandler.
 * `queries` feed the governed read API (platform/api/wave2.mjs).
 */
export const WAVE2_DOMAINS = [
  // -------------------------------------------------------------- contracts
  {
    key: 'contracts',
    module: {
      id: 'contracts', nameAr: 'العقود والشؤون القانونية', nameEn: 'Contracts & Legal',
      kind: 'standard', licenseKey: 'octagon.contracts', navGroup: 'resources_supply',
      capabilities: ['CNT-CONTRACT', 'CNT-OBLIGATION', 'CNT-AMENDMENT', 'CNT-RENEWAL', 'CNT-LEGAL'],
      dependencies: ['platform_kernel', 'commercial_core'],
      schemaMigration: '067_contracts_and_legal_management',
    },
    service: contracts,
    permissions: ['contracts.view', 'contracts.create', 'contracts.update', 'contracts.approve',
      'contracts.amend', 'contracts.renew', 'contracts.terminate', 'contracts.obligations.manage',
      'contracts.legal.manage'],
    actions: [
      { id: 'contracts:create', entity: 'contract', fn: 'createContract', permission: 'contracts.create', required: ['title_ar', 'title_en', 'type_id', 'owner_user_id'] },
      { id: 'contracts:transition_status', entity: 'contract', fn: 'transitionContractStatus', permission: 'contracts.update', required: ['contract_id', 'target_status'] },
      { id: 'contracts:amend', entity: 'contract', fn: 'amendContract', permission: 'contracts.amend', required: ['contract_id', 'title_ar', 'title_en', 'description', 'effective_date'] },
      { id: 'contracts:renew', entity: 'contract', fn: 'renewContract', permission: 'contracts.renew', required: ['contract_id', 'new_end_date'] },
      { id: 'contracts:obligation_add', entity: 'contract_obligation', fn: 'addContractObligation', permission: 'contracts.obligations.manage', required: ['contract_id', 'title_ar', 'title_en'] },
      { id: 'contracts:obligation_fulfill', entity: 'contract_obligation', fn: 'fulfillContractObligation', permission: 'contracts.obligations.manage', required: ['obligation_id'] },
      { id: 'contracts:guarantee_add', entity: 'contract_guarantee', fn: 'addContractGuarantee', permission: 'contracts.update', required: ['contract_id', 'bank_name', 'amount'] },
      { id: 'contracts:legal_matter_create', entity: 'legal_matter', fn: 'createLegalMatter', permission: 'contracts.legal.manage', required: ['title_ar', 'title_en'] },
    ],
    queries: [
      { resource: 'contracts', table: 'contracts', scope: 'company', filters: ['status', 'type_id', 'party_id', 'project_id'], search: ['contract_number', 'title_ar', 'title_en'], order: 'created_at DESC' },
      { resource: 'types', table: 'contract_types', scope: 'company', filters: ['category', 'is_active'], order: 'name_en ASC' },
      { resource: 'clause-library', table: 'contract_clause_library', scope: 'company', filters: ['category', 'is_standard'], order: 'title_en ASC' },
      { resource: 'obligations', table: 'contract_obligations', scope: 'company', filters: ['contract_id', 'status', 'assigned_user_id'], order: 'due_date ASC' },
      { resource: 'guarantees', table: 'contract_guarantees', scope: 'company', filters: ['contract_id', 'status', 'guarantee_type'], order: 'expiry_date ASC' },
      { resource: 'legal-matters', table: 'legal_matters', scope: 'company', filters: ['status', 'category', 'contract_id'], search: ['matter_number', 'title_ar', 'title_en'], order: 'created_at DESC' },
      { resource: 'versions', table: 'contract_versions', scope: 'parent', parent: { table: 'contracts', fk: 'contract_id' }, filters: ['contract_id'], order: 'version_number DESC' },
      { resource: 'amendments', table: 'contract_amendments', scope: 'parent', parent: { table: 'contracts', fk: 'contract_id' }, filters: ['contract_id', 'status'], order: 'effective_date DESC' },
      { resource: 'milestones', table: 'contract_milestones', scope: 'parent', parent: { table: 'contracts', fk: 'contract_id' }, filters: ['contract_id', 'status'], order: 'due_date ASC' },
      { resource: 'renewals', table: 'contract_renewals', scope: 'parent', parent: { table: 'contracts', fk: 'contract_id' }, filters: ['contract_id'], order: 'renewed_at DESC' },
      { resource: 'approvals', table: 'contract_approvals', scope: 'parent', parent: { table: 'contracts', fk: 'contract_id' }, filters: ['contract_id', 'status'], order: 'created_at ASC' },
      { resource: 'parties', table: 'contract_parties', scope: 'parent', parent: { table: 'contracts', fk: 'contract_id' }, filters: ['contract_id', 'role'], order: 'created_at ASC' },
      { resource: 'insurance', table: 'contract_insurance_requirements', scope: 'parent', parent: { table: 'contracts', fk: 'contract_id' }, filters: ['contract_id'], order: 'expiry_date ASC' },
    ],
  },

  // ---------------------------------------------------------- subscriptions
  {
    key: 'subscriptions',
    module: {
      id: 'subscriptions', nameAr: 'الاشتراكات والفوترة الدورية', nameEn: 'Subscriptions & Recurring Billing',
      kind: 'standard', licenseKey: 'octagon.subscriptions', navGroup: 'commercial_sales',
      capabilities: ['SUB-PLAN', 'SUB-LIFECYCLE', 'SUB-BILLING', 'SUB-DUNNING', 'SUB-ENTITLEMENT'],
      dependencies: ['platform_kernel', 'commercial_core', 'commercial_sales'],
      schemaMigration: '068_subscriptions_and_recurring_billing',
    },
    service: subscriptions,
    permissions: ['subscriptions.view', 'subscriptions.create', 'subscriptions.update',
      'subscriptions.activate', 'subscriptions.bill', 'subscriptions.pause', 'subscriptions.cancel',
      'subscriptions.plans.manage'],
    actions: [
      { id: 'subscriptions:plan_create', entity: 'subscription_plan', fn: 'createPlan', permission: 'subscriptions.plans.manage', required: ['code', 'name_ar', 'name_en', 'base_price'] },
      { id: 'subscriptions:create', entity: 'subscription', fn: 'createSubscription', permission: 'subscriptions.create', required: ['party_id', 'plan_id'] },
      { id: 'subscriptions:activate', entity: 'subscription', fn: 'activateSubscription', permission: 'subscriptions.activate', required: ['subscription_id'] },
      { id: 'subscriptions:generate_cycle', entity: 'subscription_billing_cycle', fn: 'generateBillingCycle', permission: 'subscriptions.bill', required: ['subscription_id'] },
      { id: 'subscriptions:pause', entity: 'subscription', fn: 'pauseSubscription', permission: 'subscriptions.pause', required: ['subscription_id'] },
      { id: 'subscriptions:cancel', entity: 'subscription', fn: 'cancelSubscription', permission: 'subscriptions.cancel', required: ['subscription_id'] },
    ],
    queries: [
      { resource: 'subscriptions', table: 'subscriptions', scope: 'company', filters: ['status', 'party_id', 'plan_id'], search: ['subscription_number'], order: 'created_at DESC' },
      { resource: 'plans', table: 'subscription_plans', scope: 'company', filters: ['is_active', 'billing_interval'], search: ['code', 'name_ar', 'name_en'], order: 'name_en ASC' },
      { resource: 'billing-cycles', table: 'subscription_billing_cycles', scope: 'company', filters: ['subscription_id', 'status'], order: 'period_start DESC' },
      { resource: 'dunning-policies', table: 'subscription_dunning_policies', scope: 'company', filters: [], order: 'created_at DESC' },
      { resource: 'lines', table: 'subscription_lines', scope: 'parent', parent: { table: 'subscriptions', fk: 'subscription_id' }, filters: ['subscription_id'], order: 'created_at ASC' },
      { resource: 'schedules', table: 'subscription_schedules', scope: 'parent', parent: { table: 'subscriptions', fk: 'subscription_id' }, filters: ['subscription_id', 'is_active'], order: 'next_billing_date ASC' },
      { resource: 'plan-changes', table: 'subscription_plan_changes', scope: 'parent', parent: { table: 'subscriptions', fk: 'subscription_id' }, filters: ['subscription_id'], order: 'effective_date DESC' },
      { resource: 'entitlements', table: 'subscription_entitlements', scope: 'parent', parent: { table: 'subscriptions', fk: 'subscription_id' }, filters: ['subscription_id', 'is_enabled'], order: 'entitlement_key ASC' },
    ],
  },

  // ----------------------------------------------------------------- rental
  {
    key: 'rental',
    module: {
      id: 'rental', nameAr: 'التأجير ومعدات الإيجار', nameEn: 'Rental & Equipment Hire',
      kind: 'standard', licenseKey: 'octagon.rental', navGroup: 'commercial_verticals',
      capabilities: ['RNT-AGREEMENT', 'RNT-AVAILABILITY', 'RNT-HANDOVER', 'RNT-RETURN', 'RNT-DEPOSIT'],
      dependencies: ['platform_kernel', 'commercial_core', 'stock_inventory', 'assets_management'],
      schemaMigration: '069_rental_and_equipment_hire',
    },
    service: rental,
    permissions: ['rental.view', 'rental.create', 'rental.update', 'rental.handover',
      'rental.return', 'rental.extend', 'rental.configure', 'rental.maintenance.hold'],
    actions: [
      { id: 'rental:configure_product', entity: 'rental_product_config', fn: 'configureRentalProduct', permission: 'rental.configure', required: ['product_id', 'daily_rate'] },
      { id: 'rental:agreement_create', entity: 'rental_agreement', fn: 'createAgreement', permission: 'rental.create', required: ['party_id', 'planned_start', 'planned_end', 'lines'] },
      { id: 'rental:handover', entity: 'rental_agreement', fn: 'handoverRental', permission: 'rental.handover', required: ['agreement_id'] },
      { id: 'rental:extend', entity: 'rental_extension', fn: 'extendRental', permission: 'rental.extend', required: ['agreement_id', 'extension_days'] },
      { id: 'rental:return', entity: 'rental_return', fn: 'returnRental', permission: 'rental.return', required: ['agreement_id'] },
      { id: 'rental:maintenance_hold', entity: 'rental_maintenance_hold', fn: 'setMaintenanceHold', permission: 'rental.maintenance.hold', required: ['start_date', 'end_date'] },
    ],
    queries: [
      { resource: 'agreements', table: 'rental_agreements', scope: 'company', filters: ['status', 'party_id', 'project_id'], search: ['agreement_number'], order: 'planned_start DESC' },
      { resource: 'product-configs', table: 'rental_product_configs', scope: 'company', filters: ['product_id', 'asset_id', 'is_available_for_rent'], order: 'created_at DESC' },
      { resource: 'rate-rules', table: 'rental_rate_rules', scope: 'company', filters: ['product_id', 'is_active'], order: 'start_date DESC' },
      { resource: 'lines', table: 'rental_lines', scope: 'parent', parent: { table: 'rental_agreements', fk: 'agreement_id' }, filters: ['agreement_id', 'status'], order: 'created_at ASC' },
      { resource: 'reservations', table: 'rental_reservations', scope: 'parent', parent: { table: 'rental_agreements', fk: 'agreement_id' }, filters: ['agreement_id', 'status', 'product_id'], order: 'reserved_from ASC' },
      { resource: 'handovers', table: 'rental_handovers', scope: 'parent', parent: { table: 'rental_agreements', fk: 'agreement_id' }, filters: ['agreement_id'], order: 'handover_date DESC' },
      { resource: 'returns', table: 'rental_returns', scope: 'parent', parent: { table: 'rental_agreements', fk: 'agreement_id' }, filters: ['agreement_id'], order: 'return_date DESC' },
      { resource: 'inspections', table: 'rental_inspections', scope: 'parent', parent: { table: 'rental_agreements', fk: 'agreement_id' }, filters: ['agreement_id'], order: 'inspection_date DESC' },
      { resource: 'damages', table: 'rental_damage_records', scope: 'parent', parent: { table: 'rental_agreements', fk: 'agreement_id' }, filters: ['agreement_id', 'status'], order: 'created_at DESC' },
      { resource: 'deposits', table: 'rental_deposits', scope: 'parent', parent: { table: 'rental_agreements', fk: 'agreement_id' }, filters: ['agreement_id', 'status'], order: 'created_at DESC' },
      { resource: 'late-fees', table: 'rental_late_fees', scope: 'parent', parent: { table: 'rental_agreements', fk: 'agreement_id' }, filters: ['agreement_id', 'status'], order: 'created_at DESC' },
    ],
  },

  // --------------------------------------------------------------- expenses
  {
    key: 'expenses',
    module: {
      id: 'expenses_travel', nameAr: 'المصروفات وسفر الأعمال', nameEn: 'Expenses & Business Travel',
      kind: 'standard', licenseKey: 'octagon.expenses', navGroup: 'finance_accounts',
      capabilities: ['EXP-REPORT', 'EXP-TRAVEL', 'EXP-PERDIEM', 'EXP-POLICY', 'EXP-REIMBURSE'],
      dependencies: ['platform_kernel', 'finance_canonical'],
      schemaMigration: '070_expenses_and_business_travel',
    },
    service: expenses,
    permissions: ['expenses.view', 'expenses.create', 'expenses.submit', 'expenses.approve',
      'expenses.pay', 'expenses.travel.request', 'expenses.travel.approve', 'expenses.configure'],
    actions: [
      { id: 'expenses:category_create', entity: 'expense_category', fn: 'createCategory', permission: 'expenses.configure', required: ['name', 'code'] },
      { id: 'expenses:travel_request', entity: 'travel_request', fn: 'createTravelRequest', permission: 'expenses.travel.request', required: ['employee_id', 'title', 'destination', 'start_date', 'end_date'] },
      { id: 'expenses:travel_approve', entity: 'travel_request', fn: 'approveTravelRequest', permission: 'expenses.travel.approve', required: ['id'] },
      { id: 'expenses:report_create', entity: 'expense_report', fn: 'createExpenseReport', permission: 'expenses.create', required: ['employee_id', 'title'] },
      { id: 'expenses:line_add', entity: 'expense_line', fn: 'addExpenseLine', permission: 'expenses.create', required: ['expense_report_id', 'category_id', 'expense_date', 'amount'] },
      { id: 'expenses:report_submit', entity: 'expense_report', fn: 'submitExpenseReport', permission: 'expenses.submit', required: ['id'] },
      { id: 'expenses:report_approve', entity: 'expense_report', fn: 'approveExpenseReport', permission: 'expenses.approve', required: ['id'] },
      { id: 'expenses:report_pay', entity: 'expense_report', fn: 'payExpenseReport', permission: 'expenses.pay', required: ['id'] },
    ],
    queries: [
      { resource: 'reports', table: 'expense_reports', scope: 'company', filters: ['status', 'employee_id', 'travel_request_id'], search: ['report_number', 'title'], order: 'created_at DESC' },
      { resource: 'lines', table: 'expense_lines', scope: 'company', filters: ['expense_report_id', 'category_id', 'is_billable', 'project_id'], order: 'expense_date DESC' },
      { resource: 'categories', table: 'expense_categories', scope: 'company', filters: ['is_active'], search: ['name', 'code'], order: 'name ASC' },
      { resource: 'policies', table: 'expense_policies', scope: 'company', filters: [], order: 'created_at DESC' },
      { resource: 'travel-requests', table: 'travel_requests', scope: 'company', filters: ['status', 'employee_id'], search: ['request_number', 'title', 'destination'], order: 'start_date DESC' },
      { resource: 'itineraries', table: 'travel_itineraries', scope: 'company', filters: ['travel_request_id', 'type'], order: 'departure_time ASC' },
      { resource: 'per-diems', table: 'expense_per_diems', scope: 'company', filters: ['destination_zone'], order: 'effective_from DESC' },
      { resource: 'mileage-rates', table: 'expense_mileage_rates', scope: 'company', filters: ['vehicle_type', 'effective_year'], order: 'effective_year DESC' },
      // expense_advances is a Travel advance ledger owned by this module. It is
      // NOT employee_advances (payroll). The frozen payroll zone is untouched.
      { resource: 'advances', table: 'expense_advances', scope: 'company', filters: ['status', 'employee_id', 'travel_request_id'], search: ['advance_number'], order: 'created_at DESC' },
      { resource: 'approval-rules', table: 'expense_approval_rules', scope: 'company', filters: ['is_active', 'approver_role'], order: 'min_amount ASC' },
      { resource: 'audit-logs', table: 'expense_audit_logs', scope: 'company', filters: ['expense_report_id', 'action'], order: 'created_at DESC' },
    ],
  },

  // ------------------------------------------------------------ procurement
  {
    key: 'sourcing',
    module: {
      id: 'sourcing_tenders', nameAr: 'المشتريات المتقدمة والمناقصات', nameEn: 'Advanced Procurement & Sourcing',
      kind: 'standard', licenseKey: 'octagon.sourcing', navGroup: 'resources_supply',
      capabilities: ['SRC-REQUISITION', 'SRC-RFQ', 'SRC-BID', 'SRC-AWARD', 'SRC-SCORECARD'],
      dependencies: ['platform_kernel', 'commercial_core', 'commercial_procurement'],
      schemaMigration: '071_advanced_procurement_and_supplier_portal',
    },
    service: procurement,
    permissions: ['sourcing.view', 'sourcing.requisition.create', 'sourcing.requisition.approve',
      'sourcing.rfq.create', 'sourcing.rfq.publish', 'sourcing.bid.submit', 'sourcing.award',
      'sourcing.supplier.evaluate'],
    actions: [
      { id: 'sourcing:requisition_create', entity: 'purchase_requisition', fn: 'createRequisition', permission: 'sourcing.requisition.create', required: ['requester_id', 'title'] },
      { id: 'sourcing:requisition_line_add', entity: 'purchase_requisition_line', fn: 'addRequisitionLine', permission: 'sourcing.requisition.create', required: ['requisition_id', 'product_id', 'quantity'] },
      { id: 'sourcing:requisition_approve', entity: 'purchase_requisition', fn: 'approveRequisition', permission: 'sourcing.requisition.approve', required: ['id'] },
      { id: 'sourcing:rfq_create', entity: 'rfq_header', fn: 'createRFQ', permission: 'sourcing.rfq.create', required: ['title', 'bid_submission_deadline'] },
      { id: 'sourcing:rfq_invite', entity: 'rfq_supplier', fn: 'inviteSupplierToRFQ', permission: 'sourcing.rfq.create', required: ['rfq_id', 'supplier_id'] },
      { id: 'sourcing:rfq_publish', entity: 'rfq_header', fn: 'publishRFQ', permission: 'sourcing.rfq.publish', required: ['id'] },
      { id: 'sourcing:bid_submit', entity: 'supplier_bid', fn: 'submitSupplierBid', permission: 'sourcing.bid.submit', required: ['rfq_id', 'supplier_id', 'lines'] },
      { id: 'sourcing:rfq_award', entity: 'rfq_header', fn: 'awardRFQ', permission: 'sourcing.award', required: ['rfq_id', 'winning_bid_id'] },
      { id: 'sourcing:supplier_evaluate', entity: 'supplier_evaluation', fn: 'evaluateSupplierPerformance', permission: 'sourcing.supplier.evaluate', required: ['supplier_id', 'evaluation_period'] },
    ],
    queries: [
      { resource: 'requisitions', table: 'purchase_requisitions', scope: 'company', filters: ['state', 'requested_by'], search: ['requisition_number', 'name'], order: 'created_at DESC' },
      { resource: 'requisition-lines', table: 'purchase_requisition_lines', scope: 'company', filters: ['requisition_id', 'product_id'], order: 'created_at ASC' },
      { resource: 'rfqs', table: 'rfq_headers', scope: 'company', filters: ['status', 'requisition_id'], search: ['rfq_number', 'title'], order: 'bid_submission_deadline DESC' },
      { resource: 'rfq-suppliers', table: 'rfq_suppliers', scope: 'company', filters: ['rfq_id', 'supplier_id', 'invitation_status'], order: 'invited_at DESC' },
      { resource: 'bids', table: 'supplier_bids', scope: 'company', filters: ['rfq_id', 'supplier_id', 'status'], search: ['bid_number'], order: 'total_bid_amount ASC' },
      { resource: 'bid-lines', table: 'supplier_bid_lines', scope: 'company', filters: ['bid_id', 'product_id'], order: 'total_line_amount DESC' },
      { resource: 'qualifications', table: 'supplier_qualifications', scope: 'company', filters: ['supplier_id', 'status', 'qualification_type'], order: 'expiry_date ASC' },
      { resource: 'evaluations', table: 'supplier_evaluations', scope: 'company', filters: ['supplier_id'], order: 'created_at DESC' },
      { resource: 'contracts', table: 'procurement_contracts', scope: 'company', filters: ['supplier_id', 'status'], search: ['contract_number', 'title'], order: 'end_date ASC' },
      { resource: 'portal-access', table: 'supplier_portal_access', scope: 'company', filters: ['supplier_id', 'is_active'], order: 'created_at DESC' },
      { resource: 'non-conformances', table: 'vendor_non_conformances', scope: 'company', filters: ['supplier_id', 'status', 'severity'], search: ['ncr_number'], order: 'issued_at DESC' },
    ],
  },

  // ---------------------------------------------------------- human capital
  {
    key: 'human_capital',
    module: {
      id: 'human_capital', nameAr: 'تطوير رأس المال البشري', nameEn: 'Human Capital Development',
      kind: 'standard', licenseKey: 'octagon.humancapital', navGroup: 'resources_org',
      capabilities: ['HC-RECRUIT', 'HC-ONBOARD', 'HC-TRAINING', 'HC-APPRAISAL', 'HC-LEAVE'],
      dependencies: ['platform_kernel'],
      schemaMigration: '072_human_capital_development',
    },
    service: humanCapital,
    permissions: ['hc.view', 'hc.recruitment.manage', 'hc.application.submit', 'hc.hire',
      'hc.training.manage', 'hc.training.enroll', 'hc.leave.request', 'hc.leave.approve',
      'hc.appraisal.manage'],
    actions: [
      { id: 'human_capital:job_opening_create', entity: 'job_opening', fn: 'createJobOpening', permission: 'hc.recruitment.manage', required: ['title'] },
      { id: 'human_capital:application_submit', entity: 'job_application', fn: 'submitApplication', permission: 'hc.application.submit', required: ['job_opening_id', 'candidate_name', 'candidate_email'] },
      { id: 'human_capital:candidate_hire', entity: 'job_application', fn: 'hireCandidate', permission: 'hc.hire', required: ['application_id'] },
      { id: 'human_capital:course_create', entity: 'training_course', fn: 'createCourse', permission: 'hc.training.manage', required: ['course_code', 'title'] },
      { id: 'human_capital:course_enroll', entity: 'training_enrollment', fn: 'enrollEmployeeInCourse', permission: 'hc.training.enroll', required: ['course_id', 'employee_id'] },
      { id: 'human_capital:course_complete', entity: 'training_enrollment', fn: 'recordCourseCompletion', permission: 'hc.training.manage', required: ['enrollment_id', 'score'] },
      { id: 'human_capital:leave_type_create', entity: 'leave_type', fn: 'createLeaveType', permission: 'hc.leave.approve', required: ['code', 'name'] },
      { id: 'human_capital:leave_request', entity: 'leave_request', fn: 'requestLeave', permission: 'hc.leave.request', required: ['employee_id', 'leave_type_id', 'start_date', 'end_date'] },
      { id: 'human_capital:leave_approve', entity: 'leave_request', fn: 'approveLeave', permission: 'hc.leave.approve', required: ['request_id'] },
    ],
    queries: [
      { resource: 'job-openings', table: 'job_openings', scope: 'company', filters: ['status', 'department_id', 'employment_type'], search: ['job_code', 'title'], order: 'opened_at DESC' },
      { resource: 'applications', table: 'job_applications', scope: 'company', filters: ['job_opening_id', 'status'], search: ['application_number', 'candidate_name', 'candidate_email'], order: 'applied_at DESC' },
      { resource: 'interviews', table: 'interview_schedules', scope: 'company', filters: ['application_id', 'interviewer_id', 'status'], order: 'scheduled_at ASC' },
      { resource: 'offers', table: 'job_offers', scope: 'company', filters: ['application_id', 'status'], search: ['offer_number'], order: 'sent_at DESC' },
      { resource: 'onboarding', table: 'onboarding_checklists', scope: 'company', filters: ['employee_id', 'status', 'category'], order: 'due_date ASC' },
      { resource: 'courses', table: 'training_courses', scope: 'company', filters: ['is_mandatory'], search: ['course_code', 'title'], order: 'title ASC' },
      { resource: 'enrollments', table: 'training_enrollments', scope: 'company', filters: ['course_id', 'employee_id', 'status'], order: 'enrolled_at DESC' },
      { resource: 'appraisals', table: 'performance_appraisals', scope: 'company', filters: ['employee_id', 'reviewer_id', 'status'], search: ['appraisal_number', 'period_name'], order: 'created_at DESC' },
      { resource: 'kpis', table: 'performance_kpis', scope: 'company', filters: ['appraisal_id'], order: 'weight_percentage DESC' },
      { resource: 'leave-types', table: 'leave_types', scope: 'company', filters: ['is_paid'], search: ['code', 'name'], order: 'name ASC' },
      { resource: 'leave-requests', table: 'leave_requests', scope: 'company', filters: ['employee_id', 'leave_type_id', 'status'], search: ['request_number'], order: 'start_date DESC' },
      { resource: 'leave-balances', table: 'leave_balances', scope: 'company', filters: ['employee_id', 'leave_type_id', 'year'], order: 'year DESC' },
    ],
  },

  // ----------------------------------------------------- financial planning
  {
    key: 'financial_planning',
    module: {
      id: 'financial_planning', nameAr: 'الموازنات والتخطيط المالي', nameEn: 'Budgeting & Financial Planning',
      kind: 'standard', licenseKey: 'octagon.planning', navGroup: 'finance_accounts',
      capabilities: ['FP-BUDGET', 'FP-FORECAST', 'FP-COSTCENTER', 'FP-COMMITMENT', 'FP-SCENARIO'],
      dependencies: ['platform_kernel', 'finance_canonical'],
      schemaMigration: '073_budgeting_and_financial_planning',
    },
    service: financialPlanning,
    permissions: ['planning.view', 'planning.budget.create', 'planning.budget.approve',
      'planning.budget.commit', 'planning.budget.reallocate', 'planning.forecast.manage',
      'planning.costcenter.manage'],
    actions: [
      { id: 'financial_planning:cost_center_create', entity: 'cost_center', fn: 'createCostCenter', permission: 'planning.costcenter.manage', required: ['code', 'name'] },
      { id: 'financial_planning:budget_create', entity: 'fiscal_budget', fn: 'createFiscalBudget', permission: 'planning.budget.create', required: ['fiscal_year', 'title'] },
      { id: 'financial_planning:budget_line_add', entity: 'budget_line', fn: 'addBudgetLine', permission: 'planning.budget.create', required: ['budget_id', 'gl_account_code', 'budgeted_amount'] },
      { id: 'financial_planning:budget_approve', entity: 'fiscal_budget', fn: 'approveFiscalBudget', permission: 'planning.budget.approve', required: ['id'] },
      { id: 'financial_planning:budget_commit', entity: 'budget_commitment', fn: 'commitBudgetAmount', permission: 'planning.budget.commit', required: ['budget_line_id', 'amount'] },
      { id: 'financial_planning:budget_reallocate', entity: 'budget_reallocation', fn: 'reallocateBudget', permission: 'planning.budget.reallocate', required: ['from_budget_line_id', 'to_budget_line_id', 'amount'] },
      { id: 'financial_planning:forecast_create', entity: 'financial_forecast', fn: 'createFinancialForecast', permission: 'planning.forecast.manage', required: ['title', 'period_start', 'period_end'] },
    ],
    queries: [
      { resource: 'budgets', table: 'fiscal_budgets', scope: 'company', filters: ['fiscal_year', 'status'], search: ['budget_number', 'title'], order: 'fiscal_year DESC' },
      { resource: 'budget-lines', table: 'budget_lines', scope: 'company', filters: ['budget_id', 'cost_center_id', 'gl_account_code', 'period_month'], order: 'period_month ASC' },
      { resource: 'cost-centers', table: 'cost_centers', scope: 'company', filters: ['is_active', 'parent_cost_center_id', 'manager_id'], search: ['code', 'name'], order: 'code ASC' },
      { resource: 'commitments', table: 'budget_commitments', scope: 'company', filters: ['budget_line_id', 'status', 'source_document_type'], order: 'created_at DESC' },
      { resource: 'reallocations', table: 'budget_reallocations', scope: 'company', filters: ['status'], search: ['reallocation_number'], order: 'created_at DESC' },
      { resource: 'forecasts', table: 'financial_forecasts', scope: 'company', filters: ['status', 'scenario'], search: ['forecast_number', 'title'], order: 'period_start DESC' },
      { resource: 'forecast-lines', table: 'financial_forecast_lines', scope: 'company', filters: ['forecast_id', 'category'], order: 'projected_amount DESC' },
      { resource: 'scenarios', table: 'financial_scenarios', scope: 'company', filters: [], search: ['name'], order: 'created_at DESC' },
    ],
  },

  // --------------------------------------------------------------- treasury
  {
    key: 'treasury',
    module: {
      id: 'treasury', nameAr: 'الخزينة والبنوك', nameEn: 'Treasury & Banking',
      kind: 'standard', licenseKey: 'octagon.treasury', navGroup: 'finance_accounts',
      capabilities: ['TRS-BANK', 'TRS-STATEMENT', 'TRS-RECONCILE', 'TRS-TRANSFER', 'TRS-FORECAST'],
      dependencies: ['platform_kernel', 'finance_canonical'],
      schemaMigration: '074_treasury_and_cash_management',
    },
    service: treasury,
    permissions: ['treasury.view', 'treasury.account.manage', 'treasury.statement.import',
      'treasury.reconcile', 'treasury.reconcile.finalize', 'treasury.transfer.execute'],
    actions: [
      { id: 'treasury:bank_account_create', entity: 'bank_account', fn: 'createBankAccount', permission: 'treasury.account.manage', required: ['account_number', 'bank_name', 'gl_account_code'] },
      { id: 'treasury:statement_import', entity: 'bank_statement', fn: 'importBankStatement', permission: 'treasury.statement.import', required: ['bank_account_id', 'statement_date', 'starting_balance', 'ending_balance'] },
      { id: 'treasury:statement_line_add', entity: 'bank_statement_line', fn: 'addStatementLine', permission: 'treasury.statement.import', required: ['bank_statement_id', 'transaction_date', 'amount'] },
      { id: 'treasury:line_match', entity: 'bank_statement_line', fn: 'matchStatementLine', permission: 'treasury.reconcile', required: ['line_id'] },
      { id: 'treasury:reconciliation_finalize', entity: 'cash_reconciliation', fn: 'finalizeReconciliation', permission: 'treasury.reconcile.finalize', required: ['bank_statement_id'] },
      { id: 'treasury:transfer_execute', entity: 'cash_transfer', fn: 'executeCashTransfer', permission: 'treasury.transfer.execute', required: ['from_bank_account_id', 'to_bank_account_id', 'amount'] },
    ],
    queries: [
      { resource: 'bank-accounts', table: 'bank_accounts', scope: 'company', filters: ['is_active', 'currency'], search: ['account_number', 'bank_name', 'iban'], order: 'bank_name ASC' },
      { resource: 'statements', table: 'bank_statements', scope: 'company', filters: ['bank_account_id', 'status'], search: ['statement_number'], order: 'statement_date DESC' },
      { resource: 'statement-lines', table: 'bank_statement_lines', scope: 'company', filters: ['bank_statement_id', 'status'], search: ['reference_number', 'counterparty_name', 'description'], order: 'transaction_date DESC' },
      { resource: 'reconciliations', table: 'cash_reconciliations', scope: 'company', filters: ['bank_statement_id', 'status'], search: ['reconciliation_number'], order: 'created_at DESC' },
      { resource: 'transfers', table: 'cash_transfers', scope: 'company', filters: ['status', 'from_bank_account_id', 'to_bank_account_id'], search: ['transfer_number'], order: 'transfer_date DESC' },
      { resource: 'petty-cash', table: 'petty_cash_funds', scope: 'company', filters: ['is_active', 'custodian_id'], search: ['fund_name'], order: 'fund_name ASC' },
      { resource: 'cash-forecasts', table: 'cash_flow_forecasts', scope: 'company', filters: [], order: 'forecast_date DESC' },
    ],
  },

  // -------------------------------------------------------------------- wms
  {
    key: 'wms',
    module: {
      id: 'wms_advanced', nameAr: 'إدارة المستودعات المتقدمة', nameEn: 'Advanced Warehouse Management',
      kind: 'standard', licenseKey: 'octagon.wms', navGroup: 'ops_production',
      capabilities: ['WMS-ZONE', 'WMS-BIN', 'WMS-PUTAWAY', 'WMS-WAVE', 'WMS-CYCLECOUNT'],
      dependencies: ['platform_kernel', 'stock_inventory', 'stock_wms'],
      schemaMigration: '075_advanced_wms',
    },
    service: wms,
    permissions: ['wms.view', 'wms.configure', 'wms.receive', 'wms.wave.manage',
      'wms.pick', 'wms.transfer', 'wms.count'],
    actions: [
      { id: 'wms:warehouse_create', entity: 'wms_warehouse', fn: 'createWarehouse', permission: 'wms.configure', required: ['code', 'name'] },
      { id: 'wms:zone_create', entity: 'wms_zone', fn: 'createZone', permission: 'wms.configure', required: ['warehouse_id', 'code', 'name'] },
      { id: 'wms:bin_create', entity: 'wms_bin', fn: 'createBin', permission: 'wms.configure', required: ['zone_id', 'bin_code'] },
      { id: 'wms:receive', entity: 'wms_bin_inventory', fn: 'receiveInventoryToBin', permission: 'wms.receive', required: ['bin_id', 'product_id', 'quantity'] },
      { id: 'wms:wave_create', entity: 'wms_wave_picking', fn: 'createWavePicking', permission: 'wms.wave.manage', required: ['warehouse_id'] },
      { id: 'wms:pick_task_add', entity: 'wms_pick_task', fn: 'addPickTask', permission: 'wms.pick', required: ['wave_id', 'bin_id', 'product_id', 'qty_to_pick'] },
      { id: 'wms:bin_transfer', entity: 'wms_stock_transfer', fn: 'executeBinTransfer', permission: 'wms.transfer', required: ['from_bin_id', 'to_bin_id', 'product_id', 'quantity'] },
      { id: 'wms:cycle_count_create', entity: 'wms_cycle_count', fn: 'createCycleCount', permission: 'wms.count', required: ['warehouse_id'] },
    ],
    queries: [
      { resource: 'warehouses', table: 'wms_warehouses', scope: 'company', filters: ['is_active'], search: ['code', 'name'], order: 'name ASC' },
      { resource: 'zones', table: 'wms_zones', scope: 'company', filters: ['warehouse_id', 'type'], search: ['code', 'name'], order: 'code ASC' },
      { resource: 'bins', table: 'wms_bins', scope: 'company', filters: ['zone_id', 'is_locked'], search: ['bin_code'], order: 'bin_code ASC' },
      { resource: 'bin-inventories', table: 'wms_bin_inventories', scope: 'company', filters: ['bin_id', 'product_id'], order: 'updated_at DESC' },
      { resource: 'putaway-rules', table: 'wms_putaway_rules', scope: 'company', filters: ['target_zone_id', 'strategy'], search: ['name'], order: 'priority ASC' },
      { resource: 'waves', table: 'wms_wave_pickings', scope: 'company', filters: ['warehouse_id', 'status', 'picking_strategy'], search: ['wave_number'], order: 'created_at DESC' },
      { resource: 'pick-tasks', table: 'wms_pick_tasks', scope: 'company', filters: ['wave_id', 'bin_id', 'picker_id', 'status'], order: 'created_at ASC' },
      { resource: 'transfers', table: 'wms_stock_transfers', scope: 'company', filters: ['status', 'product_id'], search: ['transfer_number'], order: 'created_at DESC' },
      { resource: 'cycle-counts', table: 'wms_cycle_counts', scope: 'company', filters: ['warehouse_id', 'zone_id', 'status'], search: ['count_number'], order: 'count_date DESC' },
      { resource: 'cycle-count-lines', table: 'wms_cycle_count_lines', scope: 'company', filters: ['cycle_count_id', 'bin_id', 'product_id'], order: 'variance_qty DESC' },
    ],
  },

  // -------------------------------------------------------------------- plm
  {
    key: 'plm',
    module: {
      id: 'plm', nameAr: 'إدارة دورة حياة المنتج', nameEn: 'Product Lifecycle Management',
      kind: 'standard', licenseKey: 'octagon.plm', navGroup: 'ops_production',
      capabilities: ['PLM-REVISION', 'PLM-ECO', 'PLM-APPROVAL', 'PLM-CAD', 'PLM-EFFECTIVITY'],
      dependencies: ['platform_kernel', 'operations_engineering'],
      schemaMigration: '076_plm_and_engineering_change_control',
    },
    service: plm,
    permissions: ['plm.view', 'plm.revision.create', 'plm.eco.create', 'plm.eco.approve',
      'plm.eco.implement'],
    actions: [
      { id: 'plm:revision_create', entity: 'plm_engineering_revision', fn: 'createEngineeringRevision', permission: 'plm.revision.create', required: ['product_id', 'revision_code'] },
      { id: 'plm:eco_create', entity: 'plm_engineering_change_order', fn: 'createECO', permission: 'plm.eco.create', required: ['title', 'change_reason'] },
      { id: 'plm:eco_affected_add', entity: 'plm_eco_affected_item', fn: 'addAffectedItemToECO', permission: 'plm.eco.create', required: ['eco_id', 'product_id'] },
      { id: 'plm:eco_approval_add', entity: 'plm_eco_approval', fn: 'addECOApprovalRequirement', permission: 'plm.eco.create', required: ['eco_id', 'department'] },
      { id: 'plm:eco_department_approve', entity: 'plm_eco_approval', fn: 'approveECODepartment', permission: 'plm.eco.approve', required: ['eco_id', 'department'] },
      { id: 'plm:eco_implement', entity: 'plm_engineering_change_order', fn: 'implementECO', permission: 'plm.eco.implement', required: ['eco_id'] },
    ],
    queries: [
      { resource: 'revisions', table: 'plm_engineering_revisions', scope: 'company', filters: ['product_id', 'status'], search: ['revision_number', 'revision_code'], order: 'created_at DESC' },
      { resource: 'change-orders', table: 'plm_engineering_change_orders', scope: 'company', filters: ['status', 'change_type', 'priority', 'initiator_id'], search: ['eco_number', 'title'], order: 'created_at DESC' },
      { resource: 'affected-items', table: 'plm_eco_affected_items', scope: 'company', filters: ['eco_id', 'product_id', 'action_type'], order: 'created_at ASC' },
      { resource: 'approvals', table: 'plm_eco_approvals', scope: 'company', filters: ['eco_id', 'department', 'status'], order: 'department ASC' },
      { resource: 'cad-documents', table: 'plm_cad_documents', scope: 'company', filters: ['revision_id', 'file_format'], search: ['document_name'], order: 'uploaded_at DESC' },
    ],
  },

  // -------------------------------------------------------------------- grc
  {
    key: 'grc',
    module: {
      id: 'grc', nameAr: 'الحوكمة والمخاطر والامتثال', nameEn: 'Governance, Risk & Compliance',
      kind: 'standard', licenseKey: 'octagon.grc', navGroup: 'admin_org',
      capabilities: ['GRC-RISK', 'GRC-CONTROL', 'GRC-FRAMEWORK', 'GRC-AUDIT', 'GRC-FINDING'],
      dependencies: ['platform_kernel'],
      schemaMigration: '077_grc_and_internal_audit',
    },
    service: grc,
    permissions: ['grc.view', 'grc.risk.manage', 'grc.control.manage', 'grc.control.evaluate',
      'grc.audit.manage', 'grc.finding.manage'],
    actions: [
      { id: 'grc:risk_create', entity: 'grc_risk_register', fn: 'createRisk', permission: 'grc.risk.manage', required: ['title', 'likelihood_rating', 'impact_rating'] },
      { id: 'grc:risk_mitigation_add', entity: 'grc_risk_mitigation', fn: 'addRiskMitigation', permission: 'grc.risk.manage', required: ['risk_id', 'action_description'] },
      { id: 'grc:framework_create', entity: 'grc_compliance_framework', fn: 'createComplianceFramework', permission: 'grc.control.manage', required: ['code', 'name'] },
      { id: 'grc:control_create', entity: 'grc_compliance_control', fn: 'createControl', permission: 'grc.control.manage', required: ['framework_id', 'control_code', 'title'] },
      { id: 'grc:control_evaluate', entity: 'grc_control_evaluation', fn: 'evaluateControl', permission: 'grc.control.evaluate', required: ['control_id', 'result'] },
      { id: 'grc:audit_create', entity: 'grc_internal_audit', fn: 'createInternalAudit', permission: 'grc.audit.manage', required: ['title', 'scope'] },
      { id: 'grc:finding_log', entity: 'grc_audit_finding', fn: 'logAuditFinding', permission: 'grc.finding.manage', required: ['audit_id', 'title', 'severity'] },
    ],
    queries: [
      { resource: 'risks', table: 'grc_risk_registers', scope: 'company', filters: ['status', 'category', 'risk_level', 'risk_owner_id'], search: ['risk_number', 'title'], order: 'risk_score DESC' },
      { resource: 'mitigations', table: 'grc_risk_mitigations', scope: 'company', filters: ['risk_id', 'status', 'assigned_to'], order: 'target_date ASC' },
      { resource: 'frameworks', table: 'grc_compliance_frameworks', scope: 'company', filters: [], search: ['code', 'name', 'governing_body'], order: 'name ASC' },
      { resource: 'controls', table: 'grc_compliance_controls', scope: 'company', filters: ['framework_id', 'control_type', 'is_active', 'control_owner_id'], search: ['control_code', 'title'], order: 'control_code ASC' },
      { resource: 'evaluations', table: 'grc_control_evaluations', scope: 'company', filters: ['control_id', 'result', 'tester_id'], search: ['evaluation_number'], order: 'test_date DESC' },
      { resource: 'audits', table: 'grc_internal_audits', scope: 'company', filters: ['status', 'lead_auditor_id'], search: ['audit_number', 'title'], order: 'start_date DESC' },
      { resource: 'findings', table: 'grc_audit_findings', scope: 'company', filters: ['audit_id', 'severity', 'status'], search: ['finding_number', 'title'], order: 'target_closure_date ASC' },
    ],
  },

  // -------------------------------------------------------------------- hse
  {
    key: 'hse',
    module: {
      id: 'hse', nameAr: 'الصحة والسلامة والبيئة', nameEn: 'Health, Safety & Environment',
      kind: 'standard', licenseKey: 'octagon.hse', navGroup: 'admin_org',
      capabilities: ['HSE-INCIDENT', 'HSE-CAPA', 'HSE-PERMIT', 'HSE-INSPECTION', 'HSE-HAZARD'],
      dependencies: ['platform_kernel', 'work_item_canonical'],
      schemaMigration: '078_hse_and_safety_management',
    },
    service: hse,
    permissions: ['hse.view', 'hse.incident.report', 'hse.incident.investigate', 'hse.capa.manage',
      'hse.permit.request', 'hse.permit.issue', 'hse.inspection.record'],
    actions: [
      { id: 'hse:incident_report', entity: 'hse_incident', fn: 'reportIncident', permission: 'hse.incident.report', required: ['incident_date', 'location', 'category', 'severity', 'title'] },
      { id: 'hse:incident_investigate', entity: 'hse_incident_investigation', fn: 'investigateIncident', permission: 'hse.incident.investigate', required: ['incident_id', 'root_cause_analysis'] },
      { id: 'hse:capa_create', entity: 'hse_corrective_action', fn: 'createCAPA', permission: 'hse.capa.manage', required: ['action_description'] },
      { id: 'hse:permit_request', entity: 'hse_safety_permit', fn: 'requestSafetyPermit', permission: 'hse.permit.request', required: ['permit_type', 'location', 'work_description', 'valid_from', 'valid_until'] },
      { id: 'hse:permit_issue', entity: 'hse_safety_permit', fn: 'issueSafetyPermit', permission: 'hse.permit.issue', required: ['permit_id'] },
      { id: 'hse:inspection_record', entity: 'hse_safety_inspection', fn: 'recordSafetyInspection', permission: 'hse.inspection.record', required: ['facility_location', 'inspection_date'] },
    ],
    queries: [
      { resource: 'incidents', table: 'hse_incidents', scope: 'company', filters: ['status', 'category', 'severity', 'reporter_id'], search: ['incident_number', 'title', 'location'], order: 'incident_date DESC' },
      { resource: 'investigations', table: 'hse_incident_investigations', scope: 'company', filters: ['incident_id', 'investigator_id'], order: 'investigation_date DESC' },
      { resource: 'corrective-actions', table: 'hse_corrective_actions', scope: 'company', filters: ['incident_id', 'status', 'assigned_to'], search: ['capa_number'], order: 'target_date ASC' },
      { resource: 'permits', table: 'hse_safety_permits', scope: 'company', filters: ['status', 'permit_type', 'contractor_id'], search: ['permit_number', 'location'], order: 'valid_from DESC' },
      { resource: 'permit-checklists', table: 'hse_permit_checklists', scope: 'company', filters: ['permit_id', 'is_verified'], order: 'check_item ASC' },
      { resource: 'inspections', table: 'hse_safety_inspections', scope: 'company', filters: ['inspector_id'], search: ['inspection_number', 'facility_location'], order: 'inspection_date DESC' },
      { resource: 'hazards', table: 'hse_hazard_reports', scope: 'company', filters: ['status', 'hazard_type', 'reported_by'], search: ['hazard_number', 'location'], order: 'created_at DESC' },
    ],
  },

  // --------------------------------------------------------------------- bi
  {
    key: 'bi',
    module: {
      id: 'business_intelligence', nameAr: 'ذكاء الأعمال', nameEn: 'Business Intelligence',
      kind: 'standard', licenseKey: 'octagon.bi', navGroup: 'intelligence_core',
      capabilities: ['BI-DASHBOARD', 'BI-WIDGET', 'BI-KPI', 'BI-SNAPSHOT', 'BI-SCHEDULE'],
      dependencies: ['platform_kernel'],
      schemaMigration: '079_business_intelligence',
    },
    service: bi,
    permissions: ['bi.view', 'bi.dashboard.create', 'bi.widget.manage', 'bi.kpi.define',
      'bi.kpi.snapshot', 'bi.report.schedule'],
    actions: [
      { id: 'bi:dashboard_create', entity: 'bi_dashboard', fn: 'createDashboard', permission: 'bi.dashboard.create', required: ['title'] },
      { id: 'bi:widget_add', entity: 'bi_widget', fn: 'addWidget', permission: 'bi.widget.manage', required: ['dashboard_id', 'title', 'widget_type'] },
      { id: 'bi:kpi_define', entity: 'bi_kpi_definition', fn: 'defineKPI', permission: 'bi.kpi.define', required: ['kpi_code', 'name'] },
      { id: 'bi:kpi_snapshot', entity: 'bi_kpi_snapshot', fn: 'recordKPISnapshot', permission: 'bi.kpi.snapshot', required: ['kpi_id', 'actual_value'] },
      { id: 'bi:report_schedule', entity: 'bi_scheduled_report', fn: 'scheduleReport', permission: 'bi.report.schedule', required: ['title', 'cron_expression'] },
    ],
    queries: [
      { resource: 'dashboards', table: 'bi_dashboards', scope: 'company', filters: ['category', 'is_default', 'owner_id'], search: ['dashboard_number', 'title'], order: 'created_at DESC' },
      { resource: 'widgets', table: 'bi_widgets', scope: 'company', filters: ['dashboard_id', 'widget_type'], order: 'pos_y ASC' },
      { resource: 'kpi-definitions', table: 'bi_kpi_definitions', scope: 'company', filters: ['domain_module'], search: ['kpi_code', 'name'], order: 'kpi_code ASC' },
      { resource: 'kpi-snapshots', table: 'bi_kpi_snapshots', scope: 'company', filters: ['kpi_id', 'status'], order: 'snapshot_date DESC' },
      { resource: 'scheduled-reports', table: 'bi_scheduled_reports', scope: 'company', filters: ['dashboard_id', 'is_active', 'format'], search: ['report_number', 'title'], order: 'created_at DESC' },
    ],
  },

  // ------------------------------------------------------------ integration
  {
    key: 'integration',
    module: {
      id: 'integration_hub', nameAr: 'مركز التكامل وواجهات البرمجة', nameEn: 'Integration Hub & API Management',
      kind: 'standard', licenseKey: 'octagon.integration', navGroup: 'admin_org',
      capabilities: ['INT-ENDPOINT', 'INT-APIKEY', 'INT-WEBHOOK', 'INT-DELIVERY', 'INT-CONNECTOR'],
      dependencies: ['platform_kernel'],
      schemaMigration: '080_integration_hub_and_api_management',
    },
    service: integration,
    permissions: ['integration.view', 'integration.endpoint.manage', 'integration.apikey.manage',
      'integration.webhook.manage', 'integration.connector.manage'],
    actions: [
      { id: 'integration:endpoint_register', entity: 'api_endpoint', fn: 'registerEndpoint', permission: 'integration.endpoint.manage', required: ['path', 'http_method'] },
      { id: 'integration:apikey_create', entity: 'api_key', fn: 'createAPIKey', permission: 'integration.apikey.manage', required: ['client_name'] },
      { id: 'integration:webhook_subscribe', entity: 'webhook_subscription', fn: 'subscribeWebhook', permission: 'integration.webhook.manage', required: ['event_type', 'url'] },
      { id: 'integration:webhook_delivery_record', entity: 'webhook_delivery', fn: 'recordWebhookDelivery', permission: 'integration.webhook.manage', required: ['subscription_id'] },
      { id: 'integration:connector_register', entity: 'integration_connector', fn: 'registerConnector', permission: 'integration.connector.manage', required: ['name', 'connector_type'] },
    ],
    queries: [
      { resource: 'endpoints', table: 'api_endpoints', scope: 'company', filters: ['http_method', 'domain_module', 'auth_required'], search: ['endpoint_number', 'path'], order: 'path ASC' },
      // NOTE: api_keys exposes key_prefix and status only for display. key_hash
      // is a secret and is stripped by the query layer's REDACTED_COLUMNS.
      { resource: 'api-keys', table: 'api_keys', scope: 'company', filters: ['status'], search: ['key_number', 'client_name', 'key_prefix'], order: 'created_at DESC' },
      { resource: 'webhooks', table: 'webhook_subscriptions', scope: 'company', filters: ['event_type', 'active', 'module_id'], search: ['url'], order: 'created_at DESC' },
      { resource: 'deliveries', table: 'webhook_deliveries', scope: 'parent', parent: { table: 'webhook_subscriptions', fk: 'subscription_id' }, filters: ['subscription_id', 'status'], order: 'created_at DESC' },
      { resource: 'connectors', table: 'integration_connectors', scope: 'company', filters: ['connector_type', 'status'], search: ['connector_number', 'name'], order: 'name ASC' },
    ],
  },

  // ------------------------------------------------------ iraq localization
  {
    key: 'iraq_localization',
    module: {
      id: 'iraq_localization', nameAr: 'التوطين العراقي والضرائب', nameEn: 'Iraq Localization & Tax',
      kind: 'standard', licenseKey: 'octagon.iraq', navGroup: 'finance_accounts',
      capabilities: ['IQ-TAXRULE', 'IQ-FILING', 'IQ-CBIRATE', 'IQ-GOVERNORATE', 'IQ-BILINGUAL'],
      dependencies: ['platform_kernel', 'finance_canonical'],
      schemaMigration: '081_iraq_localization_and_tax',
    },
    service: iraq,
    permissions: ['iraq.view', 'iraq.taxrule.manage', 'iraq.filing.submit', 'iraq.rate.record',
      'iraq.template.manage'],
    actions: [
      { id: 'iraq_localization:tax_rule_create', entity: 'iq_tax_rule', fn: 'createTaxRule', permission: 'iraq.taxrule.manage', required: ['tax_type', 'name_ar', 'name_en', 'rate_pct'] },
      { id: 'iraq_localization:filing_submit', entity: 'iq_tax_filing', fn: 'fileTaxDeclaration', permission: 'iraq.filing.submit', required: ['tax_year', 'tax_type', 'gross_taxable_amount_iqd'] },
      { id: 'iraq_localization:cbi_rate_record', entity: 'iq_currency_conversion', fn: 'recordCBIRate', permission: 'iraq.rate.record', required: ['conversion_date', 'cbi_official_rate_iqd'] },
      { id: 'iraq_localization:template_configure', entity: 'iq_bilingual_template', fn: 'configureBilingualTemplate', permission: 'iraq.template.manage', required: ['template_key', 'title_ar', 'title_en'] },
    ],
    queries: [
      { resource: 'tax-rules', table: 'iq_tax_rules', scope: 'company', filters: ['tax_type', 'is_active'], search: ['rule_number', 'name_ar', 'name_en'], order: 'valid_from DESC' },
      { resource: 'filings', table: 'iq_tax_filings', scope: 'company', filters: ['tax_year', 'tax_quarter', 'tax_type', 'filing_status'], search: ['filing_number'], order: 'tax_year DESC' },
      { resource: 'cbi-rates', table: 'iq_currency_conversions', scope: 'company', filters: [], order: 'conversion_date DESC' },
      { resource: 'templates', table: 'iq_bilingual_templates', scope: 'company', filters: ['template_key'], search: ['title_ar', 'title_en'], order: 'template_key ASC' },
      // Reference data: the 18 Iraqi governorates. No company column by design.
      { resource: 'governorates', table: 'iq_governorates', scope: 'global', filters: ['region', 'is_active'], search: ['governorate_code', 'name_ar', 'name_en'], order: 'governorate_code ASC' },
    ],
  },

  // ------------------------------------------------------------- ai copilot
  {
    key: 'ai_copilot',
    module: {
      id: 'ai_copilot', nameAr: 'مساعد أوكتاغون الذكي', nameEn: 'AI Copilot & Governance',
      kind: 'optional', licenseKey: 'octagon.ai', navGroup: 'intelligence_ai',
      capabilities: ['AI-AGENT', 'AI-SESSION', 'AI-TOOLAUDIT', 'AI-GUARDRAIL'],
      dependencies: ['platform_kernel'],
      schemaMigration: '082_ai_copilot_and_jarvis_governance',
    },
    service: aiCopilot,
    permissions: ['ai.view', 'ai.agent.manage', 'ai.session.start', 'ai.message.record',
      'ai.tool.audit', 'ai.guardrail.manage'],
    actions: [
      { id: 'ai_copilot:agent_register', entity: 'ai_agent', fn: 'registerAgent', permission: 'ai.agent.manage', required: ['agent_name', 'model_name'] },
      { id: 'ai_copilot:session_start', entity: 'ai_session', fn: 'startSession', permission: 'ai.session.start', required: ['agent_id'] },
      { id: 'ai_copilot:message_record', entity: 'ai_message', fn: 'recordMessage', permission: 'ai.message.record', required: ['session_id', 'sender_type', 'content'] },
      { id: 'ai_copilot:tool_call_audit', entity: 'ai_tool_call_audit', fn: 'auditToolCall', permission: 'ai.tool.audit', required: ['message_id', 'tool_name'] },
      { id: 'ai_copilot:guardrail_configure', entity: 'ai_guardrail_rule', fn: 'configureGuardrailRule', permission: 'ai.guardrail.manage', required: ['rule_name', 'category'] },
    ],
    queries: [
      { resource: 'agents', table: 'ai_agents', scope: 'company', filters: ['status', 'model_name'], search: ['agent_number', 'agent_name'], order: 'created_at DESC' },
      { resource: 'sessions', table: 'ai_sessions', scope: 'company', filters: ['agent_id', 'user_id', 'domain_scope'], search: ['session_number', 'session_title'], order: 'created_at DESC' },
      { resource: 'messages', table: 'ai_messages', scope: 'company', filters: ['session_id', 'sender_type'], order: 'message_number ASC' },
      { resource: 'tool-audits', table: 'ai_tool_call_audits', scope: 'company', filters: ['message_id', 'tool_name', 'approval_status', 'execution_status'], search: ['audit_number'], order: 'executed_at DESC' },
      { resource: 'guardrails', table: 'ai_guardrail_rules', scope: 'company', filters: ['category', 'is_active'], search: ['rule_number', 'rule_name'], order: 'rule_name ASC' },
    ],
  },
];

/**
 * Columns that must never leave the server, whatever a resource declares.
 * The query layer strips these from every row.
 */
export const REDACTED_COLUMNS = Object.freeze([
  'key_hash', 'access_token_hash', 'secret_ref', 'signature', 'password_hash',
  'system_prompt', 'parameters_json',
]);

/** Flat map: `${namespace}/${resource}` -> query descriptor. */
export function buildQueryIndex() {
  const index = new Map();
  for (const domain of WAVE2_DOMAINS) {
    for (const q of domain.queries) {
      index.set(`${domain.key}/${q.resource}`, {
        ...q,
        namespace: domain.key,
        moduleId: domain.module.id,
        // Reads are gated by the domain's own view permission, which is always
        // the first entry in `permissions` by construction.
        permission: domain.permissions[0],
        paging: PAGING,
      });
    }
  }
  return index;
}

/** Every action id declared by Wave 2, with its module and permission. */
export function allActions() {
  return WAVE2_DOMAINS.flatMap((d) => d.actions.map((a) => ({
    ...a,
    namespace: d.key,
    moduleId: d.module.id,
  })));
}

/** Every permission id declared by Wave 2. */
export function allPermissions() {
  return WAVE2_DOMAINS.flatMap((d) => d.permissions.map((p) => ({
    id: p, moduleId: d.module.id, namespace: d.key,
  })));
}

export default WAVE2_DOMAINS;
