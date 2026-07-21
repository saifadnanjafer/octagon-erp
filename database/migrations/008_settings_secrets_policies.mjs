// 008_settings_secrets_policies — Phase 02 Wave C (packets 02.12 – 02.16)
//
// Source composition:
// - Phase 01 platform_settings (EXTEND, not replace): the definition table stays
//   the canonical definition authority; this migration adds the VALUE, HISTORY,
//   and SECRET tables it lacked plus full scope inheritance.
// - VNext R1 organization/fiscal settings + custom-fields engine
//   (vnext/server/fields/custom-fields.js, project-owned, MERGE-CANONICAL).
// - VNext integration-engine encrypted credentials (project-owned).
// - NocoBase collection metadata / UI-schema separation (clean-room): entity
//   schema, view schema, and the protected business engine are three things.
// - Frappe Custom Field / Property Setter / fixtures (SPEC-IMPLEMENT, FRAPPE_ROOT absent).
// - Aureus plugins/webkul/fields + table-views (MIT reference, behavior only).
// - RuoYi system config + dictionary modules (MIT reference, behavior only).
//
// Invariants:
//   - a secret VALUE never lands in settings_values; only a reference does
//   - custom fields never issue runtime DDL: they live in JSON on x_records and
//     are declared as metadata (§ 4.4, § 40)

export const migration = {
  id: '008_settings_secrets_policies',
  owner: 'platform.settings',
  version: '2.0.0',
  dependsOn: ['007_authorization_registry'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Phase 01 platform_settings extended + VNext custom-fields/integration-engine (project-owned) + NocoBase/Frappe/Aureus/RuoYi behavior references',

  up(dialect) {
    dialect.exec(`
      -- ---- Settings values and inheritance (packet 02.13) --------------------
      -- Definitions stay in Phase 01's platform_settings. This is the value store.
      CREATE TABLE IF NOT EXISTS settings_values (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL REFERENCES platform_settings(key),
        scope TEXT NOT NULL CHECK (scope IN ('system','tenant','company','branch','warehouse','user')),
        scope_id TEXT NOT NULL DEFAULT '',
        value TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL,
        updated_by TEXT
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_setting_value ON settings_values(key, scope, scope_id);

      CREATE TABLE IF NOT EXISTS settings_history (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        scope TEXT NOT NULL,
        scope_id TEXT NOT NULL DEFAULT '',
        old_value TEXT,
        new_value TEXT,
        version INTEGER NOT NULL,
        changed_at TEXT NOT NULL,
        changed_by TEXT,
        reason TEXT,
        reverted_from TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_settings_history_key ON settings_history(key, changed_at);

      -- ---- Secrets (packet 02.14) -------------------------------------------
      -- A secret is addressed by reference (secret://<name>) everywhere else in
      -- the system. Ciphertext lives here and nowhere else.
      CREATE TABLE IF NOT EXISTS secret_references (
        ref TEXT PRIMARY KEY,
        module_id TEXT NOT NULL,
        tenant_id TEXT,
        company_id TEXT,
        label TEXT,
        required_permission TEXT,
        reveal_policy TEXT NOT NULL DEFAULT 'never' CHECK (reveal_policy IN ('never','restricted')),
        rotation_required INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS secret_values (
        id TEXT PRIMARY KEY,
        ref TEXT NOT NULL REFERENCES secret_references(ref) ON DELETE CASCADE,
        key_version INTEGER NOT NULL DEFAULT 1,
        algorithm TEXT NOT NULL DEFAULT 'aes-256-gcm',
        iv TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        created_by TEXT,
        rotated_at TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_secret_values_ref ON secret_values(ref, active);

      CREATE TABLE IF NOT EXISTS secret_events (
        id TEXT PRIMARY KEY,
        ref TEXT NOT NULL,
        event TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        actor_id TEXT,
        detail TEXT
      ) STRICT;

      -- ---- Policies, authority limits, delegation, SoD (packets 02.12/02.22) --
      CREATE TABLE IF NOT EXISTS policy_definitions (
        id TEXT PRIMARY KEY,
        module_id TEXT NOT NULL,
        category TEXT NOT NULL CHECK (category IN (
          'authority_limit','segregation_of_duties','approval_requirement','export_restriction',
          'credential_control','ai_tool_limit','period_lock','discount_limit','negative_stock'
        )),
        name TEXT NOT NULL,
        label_ar TEXT,
        severity TEXT NOT NULL DEFAULT 'deny' CHECK (severity IN ('deny','require_approval','warn')),
        priority INTEGER NOT NULL DEFAULT 100,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','retired')),
        active_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS policy_versions (
        id TEXT PRIMARY KEY,
        policy_id TEXT NOT NULL REFERENCES policy_definitions(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        tenant_id TEXT,
        company_id TEXT,
        applies_to TEXT NOT NULL DEFAULT '[]',
        rule TEXT NOT NULL,
        effective_from TEXT,
        effective_to TEXT,
        created_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_policy_version ON policy_versions(policy_id, version);

      CREATE TABLE IF NOT EXISTS policy_authority_limits (
        id TEXT PRIMARY KEY,
        role_id TEXT,
        user_id TEXT,
        company_id TEXT,
        permission TEXT NOT NULL,
        max_amount REAL,
        currency TEXT NOT NULL DEFAULT 'IQD',
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_authority_limit ON policy_authority_limits(permission);

      CREATE TABLE IF NOT EXISTS policy_delegations (
        id TEXT PRIMARY KEY,
        from_user_id TEXT NOT NULL REFERENCES identity_users(id) ON DELETE CASCADE,
        to_user_id TEXT NOT NULL REFERENCES identity_users(id) ON DELETE CASCADE,
        company_id TEXT,
        permissions TEXT NOT NULL DEFAULT '[]',
        max_amount REAL,
        reason TEXT,
        valid_from TEXT NOT NULL,
        valid_to TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired')),
        created_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_delegation_to ON policy_delegations(to_user_id, status);

      CREATE TABLE IF NOT EXISTS policy_sod_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        label_ar TEXT,
        left_permission TEXT NOT NULL,
        right_permission TEXT NOT NULL,
        enforce_at_assignment INTEGER NOT NULL DEFAULT 1,
        enforce_at_transaction INTEGER NOT NULL DEFAULT 1,
        allow_emergency_override INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS policy_overrides (
        id TEXT PRIMARY KEY,
        policy_id TEXT,
        sod_rule_id TEXT,
        actor_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        record_ref TEXT,
        occurred_at TEXT NOT NULL,
        approved_by TEXT
      ) STRICT;

      -- ---- Controlled configuration (packets 02.15/02.16) --------------------
      CREATE TABLE IF NOT EXISTS custom_fields (
        id TEXT PRIMARY KEY,
        entity TEXT NOT NULL,
        field TEXT NOT NULL,
        data_type TEXT NOT NULL CHECK (data_type IN ('string','text','integer','decimal','boolean','date','datetime','select','reference')),
        label_ar TEXT NOT NULL,
        label_en TEXT,
        required INTEGER NOT NULL DEFAULT 0,
        default_value TEXT,
        options TEXT NOT NULL DEFAULT '[]',
        validation TEXT NOT NULL DEFAULT '[]',
        tenant_id TEXT,
        company_id TEXT,
        module_id TEXT NOT NULL DEFAULT 'platform_configuration',
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
        created_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_custom_field ON custom_fields(entity, field, COALESCE(tenant_id,''), COALESCE(company_id,''));

      -- Entities/fields/actions that configuration may NEVER touch (§ 40).
      CREATE TABLE IF NOT EXISTS configuration_protected (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('entity','field','action')),
        entity TEXT NOT NULL,
        field TEXT,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_config_protected ON configuration_protected(kind, entity, COALESCE(field,''));

      CREATE TABLE IF NOT EXISTS view_schemas (
        id TEXT PRIMARY KEY,
        entity TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('form','list','kanban','detail')),
        name TEXT NOT NULL,
        schema TEXT NOT NULL,
        tenant_id TEXT,
        company_id TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','retired')),
        created_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS saved_views (
        id TEXT PRIMARY KEY,
        entity TEXT NOT NULL,
        name TEXT NOT NULL,
        owner_id TEXT,
        shared INTEGER NOT NULL DEFAULT 0,
        shared_approved_by TEXT,
        role_id TEXT,
        company_id TEXT,
        filters TEXT NOT NULL DEFAULT '{}',
        sort TEXT NOT NULL DEFAULT '[]',
        columns TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_saved_views_entity ON saved_views(entity, owner_id);

      CREATE TABLE IF NOT EXISTS configuration_packages (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        manifest TEXT NOT NULL,
        checksum TEXT NOT NULL,
        target_min_version TEXT,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','applied','rolled_back')),
        created_at TEXT NOT NULL,
        created_by TEXT,
        applied_at TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS configuration_package_items (
        id TEXT PRIMARY KEY,
        package_id TEXT NOT NULL REFERENCES configuration_packages(id) ON DELETE CASCADE,
        item_kind TEXT NOT NULL,
        item_key TEXT NOT NULL,
        payload TEXT NOT NULL,
        previous_payload TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_pkg_items ON configuration_package_items(package_id);
    `);

    const now = new Date().toISOString();
    // Protected surfaces that configuration can never alter. Finance/stock rows
    // are pre-declared here so Phase 03/04 inherit the guard rather than
    // re-inventing it.
    const prot = dialect.prepare(`
      INSERT INTO configuration_protected (id, kind, entity, field, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING
    `);
    const protectedRows = [
      ['entity', 'account_moves', null, 'general ledger integrity'],
      ['entity', 'account_move_lines', null, 'general ledger integrity'],
      ['entity', 'stock_moves', null, 'stock valuation integrity'],
      ['entity', 'identity_users', null, 'identity authority'],
      ['entity', 'identity_sessions', null, 'identity authority'],
      ['entity', 'authorization_grants', null, 'authorization authority'],
      ['entity', 'workflow_instances', null, 'workflow runtime integrity'],
      ['entity', 'approval_decisions', null, 'approval integrity'],
      ['entity', 'employees', null, 'frozen payroll zone'],
      ['entity', 'timesheet', null, 'frozen attendance zone'],
      ['entity', 'attendance', null, 'frozen attendance zone'],
      ['field', 'crm_lead', 'company_id', 'tenant/company scope column'],
      ['field', 'crm_lead', 'created_by', 'ownership scope column'],
    ];
    for (const [kind, entity, field, reason] of protectedRows) {
      prot.run(`cfgp_${kind}_${entity}_${field || 'all'}`, kind, entity, field, reason, now);
    }
  },

  down(dialect) {
    dialect.exec(`
      DROP TABLE IF EXISTS configuration_package_items;
      DROP TABLE IF EXISTS configuration_packages;
      DROP TABLE IF EXISTS saved_views;
      DROP TABLE IF EXISTS view_schemas;
      DROP TABLE IF EXISTS configuration_protected;
      DROP TABLE IF EXISTS custom_fields;
      DROP TABLE IF EXISTS policy_overrides;
      DROP TABLE IF EXISTS policy_sod_rules;
      DROP TABLE IF EXISTS policy_delegations;
      DROP TABLE IF EXISTS policy_authority_limits;
      DROP TABLE IF EXISTS policy_versions;
      DROP TABLE IF EXISTS policy_definitions;
      DROP TABLE IF EXISTS secret_events;
      DROP TABLE IF EXISTS secret_values;
      DROP TABLE IF EXISTS secret_references;
      DROP TABLE IF EXISTS settings_history;
      DROP TABLE IF EXISTS settings_values;
    `);
  }
};
