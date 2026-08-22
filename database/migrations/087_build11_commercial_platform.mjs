'use strict';

const MODULE_ID = 'build11_commercial';

const PERMISSIONS = [
  ['platform:saas:read', 'Read commercial and tenant data'],
  ['platform:saas:write', 'Create and update own tenant commercial data'],
  ['platform:saas:tenant_admin', 'Administer the active tenant'],
  ['platform:saas:cross_tenant', 'Use audited platform-wide tenant administration'],
  ['platform:saas:plans:publish', 'Publish commercial plan versions'],
  ['platform:saas:packages:review', 'Review extension packages'],
  ['platform:saas:packages:manage', 'Stage and manage extension installations'],
  ['platform:saas:billing:simulate', 'Run billing and payment simulations'],
  ['platform:saas:usage:record', 'Record governed usage events'],
];

const ACTIONS = [
  ['saas:tenant_create', 'saas_tenant_profile', 'platform:saas:cross_tenant'],
  ['saas:tenant_attach_company', 'saas_tenant_company', 'platform:saas:cross_tenant'],
  ['saas:tenant_transition', 'saas_tenant_event', 'platform:saas:cross_tenant'],
  ['saas:tenant_provision', 'saas_tenant_provisioning', 'platform:saas:cross_tenant'],
  ['saas:subscription_create', 'saas_subscription', 'platform:saas:tenant_admin'],
  ['saas:subscription_transition', 'saas_subscription_history', 'platform:saas:tenant_admin'],
  ['saas:seat_assign', 'saas_seat_assignment', 'platform:saas:tenant_admin'],
  ['saas:usage_record', 'saas_usage_event', 'platform:saas:usage:record'],
  ['saas:usage_reconcile', 'saas_usage_counter', 'platform:saas:tenant_admin'],
  ['saas:plan_publish', 'saas_plan_version', 'platform:saas:plans:publish'],
  ['saas:package_validate', 'saas_extension_package', 'platform:saas:packages:review'],
  ['saas:package_approve', 'saas_extension_package', 'platform:saas:packages:review'],
  ['saas:package_stage', 'saas_extension_installation', 'platform:saas:packages:manage'],
  ['saas:package_enable', 'saas_extension_installation', 'platform:saas:packages:manage'],
  ['saas:package_disable', 'saas_extension_installation', 'platform:saas:packages:manage'],
  ['saas:package_rollback', 'saas_extension_installation', 'platform:saas:packages:manage'],
  ['saas:invoice_simulate', 'saas_simulated_invoice', 'platform:saas:billing:simulate'],
  ['saas:invoice_issue', 'saas_simulated_invoice', 'platform:saas:billing:simulate'],
  ['saas:payment_simulate', 'saas_simulated_payment', 'platform:saas:billing:simulate'],
];

export const migration = {
  id: '087_build11_commercial_platform',
  owner: MODULE_ID,
  version: '11.0.0',
  parent: '086_build10_actions_and_permissions_followup',
  dependsOn: ['086_build10_actions_and_permissions_followup'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'BUILD-11 additive commercial platform, tenant lifecycle, usage, billing simulator, and safe extensions',

  up(db) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO platform_modules (id,name,version,status,kind,owner,dependencies,optional_dependencies,capabilities,migrations,settings,created_at,updated_at)
      VALUES (?, 'BUILD-11 Commercial Platform', '11.0.0', 'enabled', 'standard', 'commercial_platform', '["platform_kernel"]', '[]', ?, ?, '{}', ?, ?)
      ON CONFLICT(id) DO UPDATE SET version=excluded.version,status='enabled',updated_at=excluded.updated_at
    `).run(MODULE_ID, JSON.stringify(['tenant_lifecycle','commercial_catalog','entitlements','usage_quotas','billing_simulator','safe_extensions']), JSON.stringify(['087_build11_commercial_platform']), now, now);

    db.exec(`
      CREATE TABLE IF NOT EXISTS saas_tenant_profiles (
        tenant_id TEXT PRIMARY KEY REFERENCES platform_tenants(id),
        deployment_profile TEXT NOT NULL DEFAULT 'managed_saas' CHECK (deployment_profile IN ('managed_saas','standalone','internal')),
        lifecycle_state TEXT NOT NULL DEFAULT 'draft' CHECK (lifecycle_state IN ('draft','provisioning','trial','active','grace','suspended','expired','cancelled','archived','provisioning_failed')),
        primary_company_id TEXT,
        support_status TEXT NOT NULL DEFAULT 'standard',
        provisioning_step TEXT,
        provisioning_error TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_saas_tenant_state ON saas_tenant_profiles(lifecycle_state, updated_at);
      CREATE TABLE IF NOT EXISTS saas_tenant_companies (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES saas_tenant_profiles(tenant_id),
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        is_primary INTEGER NOT NULL DEFAULT 0,
        attached_at TEXT NOT NULL,
        attached_by TEXT NOT NULL,
        UNIQUE(tenant_id, company_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_saas_tenant_companies ON saas_tenant_companies(tenant_id, is_primary);
      CREATE TABLE IF NOT EXISTS saas_tenant_events (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        from_state TEXT,
        to_state TEXT NOT NULL,
        command TEXT NOT NULL,
        reason TEXT,
        actor_id TEXT NOT NULL,
        correlation_id TEXT NOT NULL,
        idempotency_key TEXT,
        occurred_at TEXT NOT NULL,
        UNIQUE(tenant_id, command, idempotency_key)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS saas_tenant_provisioning (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        step TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending','completed','failed')),
        error_code TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        started_at TEXT,
        completed_at TEXT,
        UNIQUE(tenant_id, step)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS saas_editions (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS saas_plans (
        id TEXT PRIMARY KEY,
        edition_id TEXT NOT NULL REFERENCES saas_editions(id),
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        lifecycle_state TEXT NOT NULL DEFAULT 'draft' CHECK (lifecycle_state IN ('draft','review','published','retired')),
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS saas_plan_versions (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES saas_plans(id),
        version_number INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','published','retired')),
        currency TEXT NOT NULL DEFAULT 'USD',
        billing_frequency TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_frequency IN ('monthly','quarterly','annual')),
        base_price REAL NOT NULL DEFAULT 0,
        trial_days INTEGER NOT NULL DEFAULT 0,
        grace_days INTEGER NOT NULL DEFAULT 0,
        published_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(plan_id, version_number)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS saas_plan_entitlements (
        plan_version_id TEXT NOT NULL REFERENCES saas_plan_versions(id),
        capability TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'plan',
        PRIMARY KEY(plan_version_id, capability)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS saas_plan_limits (
        plan_version_id TEXT NOT NULL REFERENCES saas_plan_versions(id),
        metric TEXT NOT NULL,
        allowance REAL,
        unit TEXT NOT NULL,
        policy TEXT NOT NULL DEFAULT 'hard' CHECK (policy IN ('unlimited','warning','soft','hard')),
        warning_threshold REAL,
        reset_policy TEXT NOT NULL DEFAULT 'billing_period',
        PRIMARY KEY(plan_version_id, metric)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS saas_addons (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        price REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS saas_addon_entitlements (
        addon_id TEXT NOT NULL REFERENCES saas_addons(id),
        capability TEXT NOT NULL,
        PRIMARY KEY(addon_id, capability)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS saas_addon_limits (
        addon_id TEXT NOT NULL REFERENCES saas_addons(id),
        metric TEXT NOT NULL,
        allowance REAL,
        unit TEXT NOT NULL,
        PRIMARY KEY(addon_id, metric)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS saas_subscriptions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES saas_tenant_profiles(tenant_id),
        plan_version_id TEXT NOT NULL REFERENCES saas_plan_versions(id),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','trial','active','grace','suspended','expired','cancelled','archived')),
        starts_at TEXT NOT NULL,
        current_period_start TEXT NOT NULL,
        current_period_end TEXT NOT NULL,
        trial_end_at TEXT,
        grace_end_at TEXT,
        cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
        renewal_enabled INTEGER NOT NULL DEFAULT 1,
        seat_limit INTEGER,
        currency TEXT NOT NULL DEFAULT 'USD',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_saas_subscriptions_tenant ON saas_subscriptions(tenant_id,status);
      CREATE TABLE IF NOT EXISTS saas_subscription_addons (
        subscription_id TEXT NOT NULL REFERENCES saas_subscriptions(id),
        addon_id TEXT NOT NULL REFERENCES saas_addons(id),
        quantity REAL NOT NULL DEFAULT 1,
        PRIMARY KEY(subscription_id, addon_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS saas_subscription_history (
        id TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL REFERENCES saas_subscriptions(id),
        from_status TEXT,
        to_status TEXT NOT NULL,
        reason TEXT,
        actor_id TEXT NOT NULL,
        correlation_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS saas_entitlement_overrides (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        capability TEXT NOT NULL,
        effect TEXT NOT NULL CHECK (effect IN ('allow','deny')),
        effective_from TEXT NOT NULL,
        effective_until TEXT,
        reason TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS saas_seat_assignments (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        seat_type TEXT NOT NULL CHECK (seat_type IN ('full_user','operational_user','employee_self_service','external_portal','device_kiosk')),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','released','excess')),
        assigned_at TEXT NOT NULL,
        released_at TEXT,
        assigned_by TEXT NOT NULL,
        UNIQUE(tenant_id,user_id,seat_type)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_saas_seats_tenant ON saas_seat_assignments(tenant_id,status);

      CREATE TABLE IF NOT EXISTS saas_usage_events (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        metric TEXT NOT NULL,
        quantity REAL NOT NULL CHECK(quantity >= 0),
        unit TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        source TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        correlation_id TEXT NOT NULL,
        actor_id TEXT,
        company_id TEXT,
        provenance TEXT NOT NULL,
        UNIQUE(tenant_id, metric, idempotency_key)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_saas_usage_period ON saas_usage_events(tenant_id,metric,occurred_at);
      CREATE TABLE IF NOT EXISTS saas_usage_counters (
        tenant_id TEXT NOT NULL,
        metric TEXT NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        consumed REAL NOT NULL DEFAULT 0,
        allowance REAL,
        warning_threshold REAL,
        policy TEXT NOT NULL,
        remaining REAL,
        reconciliation_status TEXT NOT NULL DEFAULT 'reconciled',
        updated_at TEXT NOT NULL,
        PRIMARY KEY(tenant_id,metric,period_start)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS saas_quota_warnings (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        metric TEXT NOT NULL,
        period_start TEXT NOT NULL,
        threshold REAL NOT NULL,
        warning_type TEXT NOT NULL,
        emitted_at TEXT NOT NULL,
        UNIQUE(tenant_id,metric,period_start,warning_type)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS saas_simulated_invoices (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        subscription_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','issued','void','paid_simulated','overdue_simulated')),
        currency TEXT NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        base_amount REAL NOT NULL DEFAULT 0,
        seat_amount REAL NOT NULL DEFAULT 0,
        addon_amount REAL NOT NULL DEFAULT 0,
        usage_overage_amount REAL NOT NULL DEFAULT 0,
        discount_amount REAL NOT NULL DEFAULT 0,
        tax_metadata TEXT NOT NULL DEFAULT '{}',
        total_amount REAL NOT NULL DEFAULT 0,
        simulation_label TEXT NOT NULL DEFAULT 'SIMULATION / NO EXTERNAL CHARGE / NO GL POSTING',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS saas_simulated_payments (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        invoice_id TEXT NOT NULL REFERENCES saas_simulated_invoices(id),
        status TEXT NOT NULL CHECK(status IN ('initiated','succeeded','failed','reversed')),
        amount REAL NOT NULL,
        currency TEXT NOT NULL,
        simulation_label TEXT NOT NULL DEFAULT 'SIMULATION / NO EXTERNAL CHARGE / NO GL POSTING',
        failure_reason TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS saas_extension_packages (
        id TEXT PRIMARY KEY,
        package_id TEXT NOT NULL UNIQUE,
        publisher TEXT NOT NULL,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        compatibility_range TEXT NOT NULL,
        manifest_version TEXT NOT NULL,
        dependencies TEXT NOT NULL DEFAULT '[]',
        capability_contributions TEXT NOT NULL DEFAULT '[]',
        permissions_requested TEXT NOT NULL DEFAULT '[]',
        declarations TEXT NOT NULL DEFAULT '{}',
        provenance TEXT NOT NULL,
        license_metadata TEXT NOT NULL DEFAULT '{}',
        checksum TEXT,
        signature TEXT,
        review_state TEXT NOT NULL DEFAULT 'pending' CHECK(review_state IN ('pending','approved','rejected')),
        publication_state TEXT NOT NULL DEFAULT 'uploaded' CHECK(publication_state IN ('uploaded','validating','validation_failed','awaiting_review','approved','rejected','published')),
        validation_findings TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS saas_extension_installations (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        package_id TEXT NOT NULL REFERENCES saas_extension_packages(package_id),
        package_version TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'staged' CHECK(state IN ('staged','installed_disabled','enabled','upgrade_available','rollback_pending','disabled','removed_metadata_only')),
        installed_at TEXT,
        enabled_at TEXT,
        disabled_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(tenant_id,package_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS saas_extension_history (
        id TEXT PRIMARY KEY,
        installation_id TEXT NOT NULL,
        package_id TEXT NOT NULL,
        from_state TEXT,
        to_state TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        reason TEXT,
        occurred_at TEXT NOT NULL
      ) STRICT;
    `);

    const permission = db.prepare(`INSERT INTO authorization_permissions(id,module_id,kind,resource,action,label_ar,label_en,sensitive,depends_on,deprecated,created_at,updated_at)
      VALUES(?,?,'action',?,?,?, ?,0,'[]',0,?,?) ON CONFLICT(id) DO NOTHING`);
    for (const [id, label] of PERMISSIONS) permission.run(id, MODULE_ID, 'saas', id.split(':').at(-1), label, label, now, now);
    const entity = db.prepare(`INSERT INTO platform_entities(id,module_id,storage_owner,primary_key,label_ar,label_en,section,chatter,fields,relations,scope,lifecycle_policy,query_policy,action_policy,customization_policy,history_policy,api_exposed,migration_owner,created_at,updated_at)
      VALUES(?,?,'platform.build11','id',?,?, 'commercial',0,'{}','{}','tenant','governed','scoped','registered','metadata','audit',1,?,?,?) ON CONFLICT(id) DO NOTHING`);
    for (const id of [...new Set(ACTIONS.map(([, entityId]) => entityId))]) entity.run(id, MODULE_ID, id, id, MODULE_ID, now, now);
    const action = db.prepare(`INSERT INTO platform_actions(id,module_id,entity_id,kind,allowed_states,required_permission,required_scope,input_schema,preconditions,transaction_owner,idempotency_policy,sequence_policy,audit_policy,outbox_policy,error_contract,created_at,updated_at)
      VALUES(?,?,?,'domain','[]',?,'tenant','{}','[]','platform.build11','required','none','required','required','{}',?,?) ON CONFLICT(id) DO UPDATE SET required_permission=excluded.required_permission,required_scope='tenant',updated_at=excluded.updated_at`);
    for (const [id, entityId, required] of ACTIONS) action.run(id, MODULE_ID, entityId, required, now, now);

    db.prepare(`INSERT INTO saas_editions(id,code,name,description,status,created_at) VALUES('edition_core','core','Core Edition','Managed SaaS core capabilities','active',?) ON CONFLICT(id) DO NOTHING`).run(now);
    db.prepare(`INSERT INTO saas_plans(id,edition_id,code,name,lifecycle_state,created_at) VALUES('plan_workshop_core','edition_core','workshop_core','Workshop Core','published',?) ON CONFLICT(id) DO NOTHING`).run(now);
    db.prepare(`INSERT INTO saas_plan_versions(id,plan_id,version_number,status,currency,billing_frequency,base_price,trial_days,grace_days,published_at,created_at) VALUES('planv_workshop_core_1','plan_workshop_core',1,'published','USD','monthly',0,14,7,?,?) ON CONFLICT(id) DO NOTHING`).run(now, now);
    const cap = db.prepare('INSERT INTO saas_plan_entitlements(plan_version_id,capability) VALUES(?,?) ON CONFLICT DO NOTHING');
    for (const capability of ['module:core','page:home','api:saas:read','capability:usage:metering','capability:billing:simulation']) cap.run('planv_workshop_core_1', capability);
    const limit = db.prepare('INSERT INTO saas_plan_limits(plan_version_id,metric,allowance,unit,policy,warning_threshold,reset_policy) VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING');
    for (const row of [['full_user',10,'seats','hard',8,'billing_period'],['companies',1,'companies','hard',1,'none'],['branches',10,'branches','hard',8,'none'],['warehouses',10,'warehouses','hard',8,'none'],['api_calls',10000,'calls','warning',8000,'billing_period'],['storage_bytes',1073741824,'bytes','soft',858993459,'billing_period']]) limit.run('planv_workshop_core_1', ...row);
    db.prepare(`INSERT INTO saas_tenant_profiles(tenant_id,deployment_profile,lifecycle_state,primary_company_id,support_status,created_at,updated_at)
      VALUES('default','internal','active','default','standard',?,?) ON CONFLICT(tenant_id) DO NOTHING`).run(now, now);
    db.prepare(`INSERT INTO saas_tenant_companies(id,tenant_id,company_id,is_primary,attached_at,attached_by) VALUES('stc_default_default','default','default',1,?,'migration') ON CONFLICT(tenant_id,company_id) DO NOTHING`).run(now);
    db.prepare(`INSERT INTO saas_subscriptions(id,tenant_id,plan_version_id,status,starts_at,current_period_start,current_period_end,currency,created_at,updated_at)
      VALUES('sub_default_workshop','default','planv_workshop_core_1','active',?,?,?,'USD',?,?) ON CONFLICT(id) DO NOTHING`).run(now, now, new Date(Date.now() + 30 * 86400000).toISOString(), now, now);
  },

  down(db) {
    db.exec(`DROP TABLE IF EXISTS saas_extension_history; DROP TABLE IF EXISTS saas_extension_installations; DROP TABLE IF EXISTS saas_extension_packages;
      DROP TABLE IF EXISTS saas_simulated_payments; DROP TABLE IF EXISTS saas_simulated_invoices; DROP TABLE IF EXISTS saas_quota_warnings; DROP TABLE IF EXISTS saas_usage_counters; DROP TABLE IF EXISTS saas_usage_events;
      DROP TABLE IF EXISTS saas_seat_assignments; DROP TABLE IF EXISTS saas_entitlement_overrides; DROP TABLE IF EXISTS saas_subscription_history; DROP TABLE IF EXISTS saas_subscription_addons; DROP TABLE IF EXISTS saas_subscriptions;
      DROP TABLE IF EXISTS saas_addon_limits; DROP TABLE IF EXISTS saas_addon_entitlements; DROP TABLE IF EXISTS saas_addons; DROP TABLE IF EXISTS saas_plan_limits; DROP TABLE IF EXISTS saas_plan_entitlements; DROP TABLE IF EXISTS saas_plan_versions; DROP TABLE IF EXISTS saas_plans; DROP TABLE IF EXISTS saas_editions;
      DROP TABLE IF EXISTS saas_tenant_provisioning; DROP TABLE IF EXISTS saas_tenant_events; DROP TABLE IF EXISTS saas_tenant_companies; DROP TABLE IF EXISTS saas_tenant_profiles;`);
    ACTIONS.forEach(([id]) => db.prepare('DELETE FROM platform_actions WHERE id=?').run(id));
    [...new Set(ACTIONS.map(([, entityId]) => entityId))].forEach((id) => db.prepare('DELETE FROM platform_entities WHERE id=?').run(id));
    PERMISSIONS.forEach(([id]) => db.prepare('DELETE FROM authorization_permissions WHERE id=?').run(id));
    db.prepare('DELETE FROM platform_modules WHERE id=?').run(MODULE_ID);
  },
};

export default migration;
