// Review Freeze 2 — role catalogue.
//
// Nineteen disposable review identities, one per named role in
// docs/review/TEAM_HANDOFF.md / ROLE_REVIEW_SCENARIOS.md. Permission tokens
// are the real tokens the canonical API checks (grepped from platform/*),
// not placeholders — a denied action in the review environment must mean
// the same thing it would mean in production.
//
// Every role belongs to REVIEW_TENANT / REVIEW_COMPANY unless `tenant`
// overrides it (used for the isolation reviewer, who must NOT see review
// tenant data).

export const REVIEW_TENANT = 't_octagon_review';
export const REVIEW_COMPANY = 'c_alwarsha_demo';
export const REVIEW_BRANCH = 'b_alwarsha_demo_main';

export const ISOLATION_TENANT = 't_octagon_isolation_review';
export const ISOLATION_COMPANY = 'c_second_demo';
export const ISOLATION_BRANCH = 'b_second_demo_main';

const READ = 'platform:db:read';
const WRITE = 'platform:db:write';

export const REVIEW_ROLES = Object.freeze([
  {
    key: 'sysadmin',
    login: 'review.sysadmin',
    name: 'Review System Administrator',
    roleId: 'review.system_admin',
    permissions: [READ, WRITE, 'control:admin', 'platform:packs:install', 'platform:packs:enable'],
    isOwner: true,
  },
  {
    key: 'tenant_admin',
    login: 'review.tenant_admin',
    name: 'Review Tenant Administrator',
    roleId: 'review.tenant_admin',
    permissions: [
      READ, WRITE,
      'saas:tenant_create', 'saas:tenant_provision', 'saas:tenant_transition', 'saas:tenant_attach_company',
      'saas:subscription_create', 'saas:subscription_transition', 'saas:plan_publish',
      'saas:seat_assign', 'saas:usage_record', 'saas:usage_reconcile',
      'saas:invoice_issue', 'saas:invoice_simulate', 'saas:payment_simulate',
      'platform:packs:install', 'platform:packs:enable',
    ],
  },
  {
    key: 'workshop_manager',
    login: 'review.workshop_manager',
    name: 'Review Workshop Manager',
    roleId: 'review.workshop_manager',
    permissions: [READ, WRITE, 'task:write', 'task:approve', 'quality:disposition_approve'],
  },
  {
    key: 'ops_coordinator',
    login: 'review.ops_coordinator',
    name: 'Review Operations Coordinator',
    roleId: 'review.ops_coordinator',
    permissions: [READ, WRITE, 'task:write', 'wms:pick_confirm', 'wms:dock_assign'],
  },
  {
    key: 'warehouse_operator',
    login: 'review.warehouse_operator',
    name: 'Review Warehouse Operator',
    roleId: 'review.warehouse_operator',
    permissions: [
      READ, WRITE,
      'wms:location_create', 'wms:location_update', 'wms:location_move',
      'wms:dock_appointment_create', 'wms:dock_check_in', 'wms:dock_start_service', 'wms:dock_depart',
      'wms:pick_confirm', 'wms:pick_acknowledge_post',
      'wms:count_session_start', 'wms:count_line_record', 'wms:count_submit', 'wms:count_recount',
      'wms:crossdock_evaluate', 'wms:crossdock_request_post',
    ],
  },
  {
    key: 'production_operator',
    login: 'review.production_operator',
    name: 'Review Production Operator',
    roleId: 'review.production_operator',
    permissions: [
      READ, WRITE, 'task:write',
      'engineering:bom:write', 'engineering:routing:write', 'engineering:work_center:write',
      'mrp:plan:write',
    ],
  },
  {
    key: 'quality_reviewer',
    login: 'review.quality_reviewer',
    name: 'Review Quality Reviewer',
    roleId: 'review.quality_reviewer',
    permissions: [
      READ, WRITE,
      'quality:checkpoint_open', 'quality:checkpoint_conditional_accept', 'quality:checkpoint_sync',
      'quality:disposition_request', 'quality:disposition_approve', 'quality:disposition_close',
      'quality:rework_start', 'quality:rework_complete',
      'quality:scrap_request_canonical', 'quality:scrap_acknowledge',
    ],
  },
  {
    key: 'finance_manager',
    login: 'review.finance_manager',
    name: 'Review Finance Manager',
    roleId: 'review.finance_manager',
    permissions: [READ, WRITE],
  },
  {
    key: 'maintenance_fleet',
    login: 'review.maintenance_fleet',
    name: 'Review Maintenance and Fleet User',
    roleId: 'review.maintenance_fleet',
    permissions: [
      READ, WRITE,
      'maintenance:request:create', 'maintenance:request:approve', 'maintenance:order:create',
      'maintenance:order:reserve_parts', 'maintenance:order:issue_parts', 'maintenance:order:complete',
      'maintenance:plan:create',
      'fleet:vehicle:create', 'fleet:driver:create', 'fleet:driver:assign',
      'fleet:trip:record', 'fleet:fuel:record', 'fleet:telemetry:ingest',
    ],
  },
  {
    key: 'ai_operator',
    login: 'review.ai_operator',
    name: 'Review AI Operator',
    roleId: 'review.ai_operator',
    permissions: [READ, WRITE, 'ai:task_run', 'ai:feedback_record'],
  },
  {
    key: 'ai_reviewer',
    login: 'review.ai_reviewer',
    name: 'Review AI Proposal Reviewer',
    roleId: 'review.ai_reviewer',
    permissions: [
      READ, WRITE,
      'ai:proposal_create', 'ai:proposal_approve', 'ai:proposal_reject', 'ai:proposal_withdraw',
      'ai:policy_upsert',
    ],
  },
  {
    key: 'people_manager',
    login: 'review.people_manager',
    name: 'Review People Development Manager',
    roleId: 'review.people_manager',
    permissions: [
      READ, WRITE, 'capability:advanced_people_development',
      'people:skill_create', 'people:evidence_record', 'people:development_plan_create',
      'people:development_transition', 'people:certification_record', 'people:learning_record',
    ],
  },
  {
    key: 'employee_self_service',
    login: 'review.employee_self_service',
    name: 'Review Employee Self-Service Reviewer',
    roleId: 'review.employee_self_service',
    permissions: [READ, 'people:evidence_record', 'people:learning_record'],
    scope: 'own',
  },
  {
    key: 'marketing_manager',
    login: 'review.marketing_manager',
    name: 'Review Marketing Manager',
    roleId: 'review.marketing_manager',
    permissions: [
      READ, WRITE,
      'marketing:campaign_create', 'marketing:campaign_submit',
      'marketing:audience_create', 'marketing:attribution_simulate',
    ],
  },
  {
    key: 'content_reviewer',
    login: 'review.content_reviewer',
    name: 'Review Content Reviewer',
    roleId: 'review.content_reviewer',
    permissions: [READ, WRITE, 'marketing:content_create', 'marketing:content_submit', 'marketing:content_approve'],
  },
  {
    key: 'event_manager',
    login: 'review.event_manager',
    name: 'Review Event Manager',
    roleId: 'review.event_manager',
    permissions: [READ, WRITE, 'events:event_create', 'events:session_create', 'events:registration_create'],
  },
  {
    key: 'event_checkin',
    login: 'review.event_checkin',
    name: 'Review Event Check-In Operator',
    roleId: 'review.event_checkin',
    permissions: [READ, WRITE, 'events:checkin', 'events:registration_create'],
  },
  {
    key: 'package_reviewer',
    login: 'review.package_reviewer',
    name: 'Review Package Reviewer',
    roleId: 'review.package_reviewer',
    permissions: [
      READ, WRITE,
      'packs:validate', 'packs:stage', 'packs:approve', 'packs:enable', 'packs:disable', 'packs:rollback',
    ],
  },
  {
    key: 'viewer',
    login: 'review.viewer',
    name: 'Review Viewer User',
    roleId: 'review.viewer',
    permissions: [READ],
  },
  // Isolation reviewer deliberately lives in the SECOND tenant/company, so
  // reviewers can prove tenant/company scoping denies cross-tenant reads
  // rather than assuming it.
  {
    key: 'isolation_viewer',
    login: 'review.isolation_viewer',
    name: 'Review Isolation Tenant Viewer',
    roleId: 'review.isolation_viewer',
    permissions: [READ],
    tenant: ISOLATION_TENANT,
    company: ISOLATION_COMPANY,
    branch: ISOLATION_BRANCH,
  },
]);
