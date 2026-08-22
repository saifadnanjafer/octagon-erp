'use strict';

const MODULE_ID = 'build12_governed_intelligence';

const PERMISSIONS = [
  ['platform:ai:configure', 'Configure governed AI providers, tasks, and policies'],
  ['platform:ai:execute', 'Run approved deterministic AI tasks'],
  ['platform:ai:context', 'Inspect authorized AI context references'],
  ['platform:ai:proposal:review', 'Review and decide AI proposals'],
  ['platform:ai:feedback', 'Record AI quality and safety feedback'],
  ['platform:people:skills:admin', 'Administer skills and competency definitions'],
  ['platform:people:development:own', 'View and update own development records'],
  ['platform:people:development:team', 'Manage team development records'],
  ['platform:people:certifications:manage', 'Manage learning and certification evidence'],
  ['platform:marketing:manage', 'Manage campaigns, audiences, and simulated attribution'],
  ['platform:marketing:content:review', 'Review and approve marketing content'],
  ['platform:events:manage', 'Manage events, sessions, and registrations'],
  ['platform:events:checkin', 'Check in event attendees only'],
  ['platform:packs:review', 'Review safe vertical packages'],
  ['platform:packs:install', 'Stage and install safe vertical packages'],
  ['platform:packs:enable', 'Enable, disable, and roll back safe vertical packages'],
];

const ACTIONS = [
  ['ai:provider_upsert', 'ai_provider', 'platform:ai:configure'],
  ['ai:policy_upsert', 'ai_policy', 'platform:ai:configure'],
  ['ai:task_run', 'ai_run', 'platform:ai:execute'],
  ['ai:proposal_create', 'ai_proposal', 'platform:ai:execute'],
  ['ai:proposal_approve', 'ai_proposal_review', 'platform:ai:proposal:review'],
  ['ai:proposal_reject', 'ai_proposal_review', 'platform:ai:proposal:review'],
  ['ai:proposal_withdraw', 'ai_proposal_review', 'platform:ai:execute'],
  ['ai:feedback_record', 'ai_feedback', 'platform:ai:feedback'],
  ['people:skill_create', 'people_skill', 'platform:people:skills:admin'],
  ['people:evidence_record', 'people_skill_evidence', 'platform:people:development:team'],
  ['people:development_plan_create', 'people_development_plan', 'platform:people:development:team'],
  ['people:development_transition', 'people_development_plan', 'platform:people:development:team'],
  ['people:learning_record', 'people_learning_record', 'platform:people:certifications:manage'],
  ['people:certification_record', 'people_certification', 'platform:people:certifications:manage'],
  ['marketing:audience_create', 'marketing_audience', 'platform:marketing:manage'],
  ['marketing:campaign_create', 'marketing_campaign', 'platform:marketing:manage'],
  ['marketing:campaign_submit', 'marketing_campaign', 'platform:marketing:manage'],
  ['marketing:content_create', 'marketing_content', 'platform:marketing:manage'],
  ['marketing:content_submit', 'marketing_content', 'platform:marketing:manage'],
  ['marketing:content_approve', 'marketing_content_review', 'platform:marketing:content:review'],
  ['marketing:attribution_simulate', 'marketing_attribution', 'platform:marketing:manage'],
  ['events:event_create', 'event', 'platform:events:manage'],
  ['events:session_create', 'event_session', 'platform:events:manage'],
  ['events:registration_create', 'event_registration', 'platform:events:manage'],
  ['events:checkin', 'event_registration', 'platform:events:checkin'],
  ['packs:validate', 'vertical_pack', 'platform:packs:review'],
  ['packs:approve', 'vertical_pack', 'platform:packs:review'],
  ['packs:stage', 'vertical_pack_installation', 'platform:packs:install'],
  ['packs:enable', 'vertical_pack_installation', 'platform:packs:enable'],
  ['packs:disable', 'vertical_pack_installation', 'platform:packs:enable'],
  ['packs:rollback', 'vertical_pack_installation', 'platform:packs:enable'],
];

const SKILL_TEMPLATES = [
  ['graphic_design', 'Graphic Design'], ['architectural_design', 'Architectural Design'],
  ['cnc', 'CNC'], ['co2_laser', 'CO2 Laser'], ['fiber_laser', 'Fiber Laser'],
  ['large_format_printing', 'Large-format Printing'], ['3d_printing', '3D Printing'],
  ['metal_fabrication', 'Metal Fabrication'], ['welding', 'Welding'], ['painting', 'Painting'],
  ['electrical', 'Electrical'], ['led_installation', 'LED Installation'],
  ['site_installation', 'Site Installation'], ['quality_inspection', 'Quality Inspection'],
  ['inventory_handling', 'Inventory Handling'], ['customer_communication', 'Customer Communication'],
  ['supervision', 'Supervision'],
];

export const migration = {
  id: '089_build12_ai_people_marketing_events_pack',
  owner: MODULE_ID,
  version: '12.0.0',
  parent: '088_build11_billing_action',
  dependsOn: ['088_build11_billing_action'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'BUILD-12 additive governed AI, people development, marketing, event, and safe pack authority',
  up(db) {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO platform_modules (id,name,version,status,kind,owner,dependencies,optional_dependencies,capabilities,migrations,settings,created_at,updated_at)
      VALUES (?, 'BUILD-12 Governed Intelligence and Vertical Pack', '12.0.0', 'enabled', 'standard', 'build12', '["build11_commercial"]', '[]', ?, ?, '{}', ?, ?)
      ON CONFLICT(id) DO UPDATE SET version=excluded.version,status='enabled',updated_at=excluded.updated_at`)
      .run(MODULE_ID, JSON.stringify(['governed_ai','people_development','marketing_simulation','event_management','al_warsha_pack']), JSON.stringify(['089_build12_ai_people_marketing_events_pack']), now, now);

    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_providers (
        id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, model_id TEXT NOT NULL, display_name TEXT NOT NULL,
        capability_class TEXT NOT NULL, context_window INTEGER NOT NULL DEFAULT 0, cost_unit TEXT NOT NULL DEFAULT 'simulated_token',
        enabled INTEGER NOT NULL DEFAULT 0, deployment_profile TEXT NOT NULL DEFAULT 'simulator', data_residency TEXT NOT NULL DEFAULT 'internal',
        allowed_data_classifications TEXT NOT NULL DEFAULT '["public","internal"]', simulator_state TEXT NOT NULL DEFAULT 'deterministic',
        health_state TEXT NOT NULL DEFAULT 'healthy', supported_modalities TEXT NOT NULL DEFAULT '["text"]', rate_policy TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(provider_id, model_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS ai_tasks (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE, purpose TEXT NOT NULL, input_schema TEXT NOT NULL DEFAULT '{}', output_schema TEXT NOT NULL DEFAULT '{}',
        required_permission TEXT NOT NULL, required_entitlement TEXT, allowed_data_classifications TEXT NOT NULL DEFAULT '["public","internal"]',
        risk_class TEXT NOT NULL CHECK(risk_class IN ('LOW','MEDIUM','HIGH','PROHIBITED')), human_review_policy TEXT NOT NULL,
        allowed_model_classes TEXT NOT NULL DEFAULT '[]', max_context INTEGER NOT NULL DEFAULT 50, retention_days INTEGER NOT NULL DEFAULT 30,
        proposal_type TEXT, canonical_target TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS ai_policies (
        id TEXT PRIMARY KEY, tenant_id TEXT, name TEXT NOT NULL, risk_class TEXT NOT NULL CHECK(risk_class IN ('LOW','MEDIUM','HIGH','PROHIBITED')),
        allow_external_content INTEGER NOT NULL DEFAULT 0, max_context_rows INTEGER NOT NULL DEFAULT 50, require_review INTEGER NOT NULL DEFAULT 0,
        blocked_actions TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_ai_policies_scope ON ai_policies(tenant_id, risk_class, enabled);
      CREATE TABLE IF NOT EXISTS ai_runs (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, actor_id TEXT NOT NULL, task_id TEXT NOT NULL, provider_id TEXT NOT NULL, model_id TEXT NOT NULL,
        prompt_template_version TEXT NOT NULL, context_references TEXT NOT NULL DEFAULT '[]', input_hash TEXT NOT NULL, output_hash TEXT, output_payload TEXT,
        policy_decision TEXT NOT NULL, risk_class TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('requested','context_preparing','blocked','queued','running','completed','failed','cancelled','expired')),
        input_units REAL NOT NULL DEFAULT 0, output_units REAL NOT NULL DEFAULT 0, simulated_cost_units REAL NOT NULL DEFAULT 0,
        idempotency_key TEXT NOT NULL, correlation_id TEXT NOT NULL, error_code TEXT, started_at TEXT, ended_at TEXT, created_at TEXT NOT NULL,
        UNIQUE(tenant_id, task_id, idempotency_key)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_ai_runs_tenant_status ON ai_runs(tenant_id, status, created_at);
      CREATE TABLE IF NOT EXISTS ai_context_sources (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, run_id TEXT NOT NULL, source_type TEXT NOT NULL, source_label TEXT NOT NULL,
        classification TEXT NOT NULL, content_hash TEXT NOT NULL, row_count INTEGER NOT NULL DEFAULT 0, redacted_fields TEXT NOT NULL DEFAULT '[]',
        blocked_instructions TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS ai_proposals (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, run_id TEXT NOT NULL, proposal_type TEXT NOT NULL, summary TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}', target_authority TEXT, risk_class TEXT NOT NULL, reviewer_required INTEGER NOT NULL DEFAULT 1,
        expires_at TEXT, status TEXT NOT NULL CHECK(status IN ('draft','generated','review_required','approved','rejected','expired','withdrawn','applied','application_failed')),
        created_by TEXT NOT NULL, reviewer_id TEXT, decision_reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_ai_proposals_review ON ai_proposals(tenant_id, status, created_at);
      CREATE TABLE IF NOT EXISTS ai_proposal_reviews (
        id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL, tenant_id TEXT NOT NULL, reviewer_id TEXT NOT NULL,
        decision TEXT NOT NULL CHECK(decision IN ('approved','rejected','revision_requested')), reason TEXT NOT NULL, created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS ai_feedback (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, run_id TEXT, proposal_id TEXT, actor_id TEXT NOT NULL,
        rating TEXT NOT NULL CHECK(rating IN ('useful','partially_useful','incorrect','unsafe','outdated','missing_context')), comment TEXT, created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS people_skills (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, description TEXT, level_scale TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','retired')), version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(tenant_id, code)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS people_competencies (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, person_id TEXT NOT NULL, skill_id TEXT NOT NULL, level INTEGER NOT NULL DEFAULT 0,
        visibility TEXT NOT NULL DEFAULT 'team' CHECK(visibility IN ('own','team','manager')), version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL,
        UNIQUE(tenant_id, person_id, skill_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS people_skill_evidence (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, person_id TEXT NOT NULL, skill_id TEXT NOT NULL, evidence_type TEXT NOT NULL,
        description TEXT NOT NULL, source_ref TEXT, observed_at TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS people_development_plans (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, person_id TEXT NOT NULL, title TEXT NOT NULL, objective TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','completed','cancelled')), due_at TEXT, owner_id TEXT NOT NULL,
        ai_proposal_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS people_development_steps (
        id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','active','complete','cancelled')),
        due_at TEXT, evidence_required INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS people_learning_records (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, person_id TEXT NOT NULL, course TEXT NOT NULL, provider TEXT, status TEXT NOT NULL DEFAULT 'planned',
        completed_at TEXT, evidence_ref TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS people_certifications (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, person_id TEXT NOT NULL, name TEXT NOT NULL, expires_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','expired','revoked')), evidence_ref TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_people_plans_scope ON people_development_plans(tenant_id, person_id, status);
      CREATE INDEX IF NOT EXISTS idx_people_cert_expiry ON people_certifications(tenant_id, expires_at, status);

      CREATE TABLE IF NOT EXISTS marketing_audiences (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, consent_basis TEXT NOT NULL, criteria TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','archived')), created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS marketing_campaigns (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','review','approved','simulated','archived')),
        audience_id TEXT, objective TEXT NOT NULL, budget REAL NOT NULL DEFAULT 0, simulation_label TEXT NOT NULL DEFAULT 'SIMULATION ONLY - NO EXTERNAL PUBLISHING',
        starts_at TEXT, ends_at TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS marketing_content (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, campaign_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
        channel TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','rejected','withdrawn')),
        created_by TEXT NOT NULL, approved_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS marketing_content_reviews (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, content_id TEXT NOT NULL, reviewer_id TEXT NOT NULL,
        decision TEXT NOT NULL CHECK(decision IN ('approved','rejected','revision_requested')), reason TEXT NOT NULL, created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS marketing_attribution (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, campaign_id TEXT NOT NULL, source TEXT NOT NULL, medium TEXT NOT NULL,
        leads INTEGER NOT NULL DEFAULT 0, conversions INTEGER NOT NULL DEFAULT 0, simulated_revenue REAL NOT NULL DEFAULT 0,
        simulation_label TEXT NOT NULL DEFAULT 'SIMULATION ONLY - CANONICAL SALES DATA UNCHANGED', created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_status ON marketing_campaigns(tenant_id, status, starts_at);

      CREATE TABLE IF NOT EXISTS build12_events (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','ongoing','completed','cancelled')),
        description TEXT, venue TEXT, capacity INTEGER NOT NULL DEFAULT 0, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS build12_event_sessions (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, event_id TEXT NOT NULL, title TEXT NOT NULL, speaker TEXT,
        starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, capacity INTEGER, created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS build12_event_registrations (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, event_id TEXT NOT NULL, session_id TEXT, attendee_name TEXT NOT NULL, attendee_email TEXT,
        status TEXT NOT NULL DEFAULT 'registered' CHECK(status IN ('registered','waitlisted','checked_in','cancelled')), checked_in_at TEXT,
        registered_at TEXT NOT NULL, UNIQUE(tenant_id, event_id, attendee_email)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_events_schedule ON build12_events(tenant_id, status, starts_at);
      CREATE INDEX IF NOT EXISTS idx_event_regs ON build12_event_registrations(tenant_id, event_id, status);

      CREATE TABLE IF NOT EXISTS build12_pack_profiles (
        id TEXT PRIMARY KEY, package_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, version TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'validated',
        terminology_overlay TEXT NOT NULL DEFAULT '{}', workflow_templates TEXT NOT NULL DEFAULT '[]', readiness_categories TEXT NOT NULL DEFAULT '[]',
        kpi_catalog TEXT NOT NULL DEFAULT '[]', validation_findings TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS build12_pack_installations (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, package_id TEXT NOT NULL, extension_installation_id TEXT, version TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'staged' CHECK(state IN ('staged','installed_disabled','enabled','disabled','rollback_pending','rolled_back')),
        previous_version TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(tenant_id, package_id)
      ) STRICT;
    `);

    const permission = db.prepare(`INSERT INTO authorization_permissions(id,module_id,kind,resource,action,label_ar,label_en,sensitive,depends_on,deprecated,created_at,updated_at)
      VALUES(?,?,'action',?,?,?, ?,0,'[]',0,?,?) ON CONFLICT(id) DO NOTHING`);
    for (const [id, label] of PERMISSIONS) permission.run(id, MODULE_ID, 'build12', id.split(':').at(-1), label, label, now, now);
    const entity = db.prepare(`INSERT INTO platform_entities(id,module_id,storage_owner,primary_key,label_ar,label_en,section,chatter,fields,relations,scope,lifecycle_policy,query_policy,action_policy,customization_policy,history_policy,api_exposed,migration_owner,created_at,updated_at)
      VALUES(?,?,'platform.build12','id',?,?, 'build12',0,'{}','{}','tenant','governed','scoped','registered','metadata','audit',1,?,?,?) ON CONFLICT(id) DO NOTHING`);
    for (const id of [...new Set(ACTIONS.map(([, entityId]) => entityId))]) entity.run(id, MODULE_ID, id, id, MODULE_ID, now, now);
    const action = db.prepare(`INSERT INTO platform_actions(id,module_id,entity_id,kind,allowed_states,required_permission,required_scope,input_schema,preconditions,transaction_owner,idempotency_policy,sequence_policy,audit_policy,outbox_policy,error_contract,created_at,updated_at)
      VALUES(?,?,?,'domain','[]',?,'tenant','{}','[]','platform.build12','required','none','required','required','{}',?,?) ON CONFLICT(id) DO UPDATE SET required_permission=excluded.required_permission,required_scope='tenant',updated_at=excluded.updated_at`);
    for (const [id, entityId, required] of ACTIONS) action.run(id, MODULE_ID, entityId, required, now, now);

    const provider = db.prepare(`INSERT INTO ai_providers(id,provider_id,model_id,display_name,capability_class,context_window,cost_unit,enabled,deployment_profile,data_residency,allowed_data_classifications,simulator_state,health_state,supported_modalities,rate_policy,created_at,updated_at)
      VALUES('ai_provider_simulator','octagon_simulator','deterministic-v1','Octagon Deterministic Simulator','advisory',8192,'simulated_unit',1,'simulator','internal','["public","internal","confidential"]','deterministic','healthy','["text"]','{}',?,?) ON CONFLICT(id) DO NOTHING`);
    provider.run(now, now);
    const task = db.prepare(`INSERT INTO ai_tasks(id,task_id,purpose,input_schema,output_schema,required_permission,required_entitlement,allowed_data_classifications,risk_class,human_review_policy,allowed_model_classes,max_context,retention_days,proposal_type,canonical_target,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(task_id) DO NOTHING`);
    const tasks = [
      ['ai_task_operational_summary','operational_summary','Bounded operational summary','{}','{"type":"object"}','platform:ai:execute','capability:ai_operational_briefing','["public","internal"]','LOW','optional','["advisory"]',25,30,'operational_summary','workshop.command_center'],
      ['ai_task_command_center_briefing','command_center_briefing','Read-only command center briefing','{}','{"type":"object"}','platform:ai:execute','capability:ai_operational_briefing','["public","internal"]','MEDIUM','required','["advisory"]',25,30,'command_center_briefing','workshop.command_center'],
      ['ai_task_competency_gap_summary','competency_gap_summary','Development gap explanation','{}','{"type":"object"}','platform:ai:execute','capability:advanced_people_development','["public","internal","confidential"]','MEDIUM','required','["advisory"]',20,60,'development_plan_proposal','people.development'],
      ['ai_task_campaign_brief','campaign_brief','Simulated campaign brief','{}','{"type":"object"}','platform:ai:execute','capability:ai_marketing_drafts','["public","internal"]','MEDIUM','required','["advisory"]',20,30,'campaign_brief','marketing.campaign'],
      ['ai_task_event_plan_draft','event_plan_draft','Event plan draft','{}','{"type":"object"}','platform:ai:execute','capability:event_management','["public","internal"]','MEDIUM','required','["advisory"]',20,30,'event_plan_draft','events.planner'],
    ];
    for (const row of tasks) task.run(row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9], row[10], row[11], row[12], row[13], row[14], now, now);

    const skill = db.prepare(`INSERT INTO people_skills(id,tenant_id,code,name,description,level_scale,status,version,created_at,updated_at)
      VALUES(?,?,?,?,?,'{"min":0,"max":5}','active',1,?,?) ON CONFLICT(tenant_id,code) DO NOTHING`);
    for (const [code, name] of SKILL_TEMPLATES) skill.run(`skill_default_${code}`, 'default', code, name, `Curated Al-Warsha template for ${name}.`, now, now);
    db.prepare(`INSERT INTO build12_pack_profiles(id,package_id,name,version,status,terminology_overlay,workflow_templates,readiness_categories,kpi_catalog,validation_findings,created_at,updated_at)
      VALUES('pack_profile_al_warsha','pack:al_warsha','Al-Warsha Workshop Operating Pack','1.0.0','validated','{"work_order":"Workshop Job","quality_hold":"Quality Hold","ready_for_delivery":"Ready for Delivery"}','["design_approval","material_readiness","quality_release","delivery_readiness"]','["required_roles","workshop_locations","work_centers","picking_staging","quality_checkpoints","material_flow","delivery_readiness","device_readiness","critical_skills","safe_ai_policy"]','["open_workshop_jobs","due_today","overdue","blocked_materials","quality_hold","rework","ready_for_delivery","downtime"]','[]',?,?) ON CONFLICT(package_id) DO NOTHING`).run(now, now);
    const build12Capabilities = db.prepare('INSERT INTO saas_plan_entitlements(plan_version_id,capability) VALUES(?,?) ON CONFLICT DO NOTHING');
    for (const capability of ['module:ai','module:people_development','module:marketing','module:events','pack:al_warsha','capability:ai_operational_briefing','capability:ai_marketing_drafts','capability:advanced_people_development','capability:event_management']) build12Capabilities.run('planv_workshop_core_1', capability);
    db.prepare('INSERT INTO saas_plan_limits(plan_version_id,metric,allowance,unit,policy,warning_threshold,reset_policy) VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING').run('planv_workshop_core_1','ai_usage',1000,'simulated_units','hard',800,'billing_period');
  },
  down(db) {
    db.exec(`DROP TABLE IF EXISTS build12_pack_installations; DROP TABLE IF EXISTS build12_pack_profiles;
      DROP TABLE IF EXISTS build12_event_registrations; DROP TABLE IF EXISTS build12_event_sessions; DROP TABLE IF EXISTS build12_events;
      DROP TABLE IF EXISTS marketing_attribution; DROP TABLE IF EXISTS marketing_content_reviews; DROP TABLE IF EXISTS marketing_content; DROP TABLE IF EXISTS marketing_campaigns; DROP TABLE IF EXISTS marketing_audiences;
      DROP TABLE IF EXISTS people_certifications; DROP TABLE IF EXISTS people_learning_records; DROP TABLE IF EXISTS people_development_steps; DROP TABLE IF EXISTS people_development_plans; DROP TABLE IF EXISTS people_skill_evidence; DROP TABLE IF EXISTS people_competencies; DROP TABLE IF EXISTS people_skills;
      DROP TABLE IF EXISTS ai_feedback; DROP TABLE IF EXISTS ai_proposal_reviews; DROP TABLE IF EXISTS ai_proposals; DROP TABLE IF EXISTS ai_context_sources; DROP TABLE IF EXISTS ai_runs; DROP TABLE IF EXISTS ai_policies; DROP TABLE IF EXISTS ai_tasks; DROP TABLE IF EXISTS ai_providers;`);
    ACTIONS.forEach(([id]) => db.prepare('DELETE FROM platform_actions WHERE id=?').run(id));
    [...new Set(ACTIONS.map(([, entityId]) => entityId))].forEach((id) => db.prepare('DELETE FROM platform_entities WHERE id=?').run(id));
    PERMISSIONS.forEach(([id]) => db.prepare('DELETE FROM authorization_permissions WHERE id=?').run(id));
    db.prepare('DELETE FROM platform_modules WHERE id=?').run(MODULE_ID);
  },
};

export default migration;
