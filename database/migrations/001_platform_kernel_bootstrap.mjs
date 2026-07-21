// 001_platform_kernel_bootstrap.mjs
//
// Source composition:
// - VNext R0/R1 migrations established a global migration ledger and the x_records
//   collection registry; this migration maps those concepts into the Phase 01
//   target architecture: one module registry, one entity registry, one action
//   registry, one view registry, one event registry, one settings registry, one
//   sequence registry, and one append-only audit log.
// - No runtime DDL is performed outside the migration runner.

export const migration = {
  id: '001_platform_kernel_bootstrap',
  owner: 'platform.kernel',
  version: '1.0.0',
  dependsOn: [],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'VNext 001_r0_scope_contract + 101_r1_lane_a_tables mapped to target architecture',

  up(dialect) {
    dialect.exec(`
      CREATE TABLE IF NOT EXISTS platform_modules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','installed','licensed','enabled','visible','authorized')),
        kind TEXT NOT NULL CHECK (kind IN ('core','standard','optional','pack')),
        owner TEXT NOT NULL,
        dependencies TEXT NOT NULL DEFAULT '[]',
        optional_dependencies TEXT NOT NULL DEFAULT '[]',
        capabilities TEXT NOT NULL DEFAULT '[]',
        migrations TEXT NOT NULL DEFAULT '[]',
        settings TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS platform_entities (
        id TEXT PRIMARY KEY,
        module_id TEXT NOT NULL REFERENCES platform_modules(id),
        storage_owner TEXT NOT NULL,
        primary_key TEXT NOT NULL,
        label_ar TEXT,
        label_en TEXT,
        section TEXT,
        sequence TEXT,
        seq_field TEXT,
        chatter INTEGER NOT NULL DEFAULT 0,
        acl TEXT,
        status_key TEXT,
        fields TEXT NOT NULL DEFAULT '[]',
        relations TEXT NOT NULL DEFAULT '[]',
        scope TEXT NOT NULL DEFAULT 'company' CHECK (scope IN ('tenant','company','branch','none')),
        lifecycle_policy TEXT NOT NULL DEFAULT 'generic',
        query_policy TEXT NOT NULL DEFAULT 'scoped',
        action_policy TEXT NOT NULL DEFAULT 'registered',
        customization_policy TEXT NOT NULL DEFAULT 'metadata',
        history_policy TEXT NOT NULL DEFAULT 'audit',
        api_exposed INTEGER NOT NULL DEFAULT 1,
        migration_owner TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS platform_actions (
        id TEXT PRIMARY KEY,
        module_id TEXT NOT NULL REFERENCES platform_modules(id),
        entity_id TEXT REFERENCES platform_entities(id),
        allowed_states TEXT NOT NULL DEFAULT '[]',
        required_permission TEXT NOT NULL,
        required_scope TEXT NOT NULL DEFAULT 'company',
        input_schema TEXT,
        preconditions TEXT NOT NULL DEFAULT '[]',
        transaction_owner TEXT NOT NULL,
        idempotency_policy TEXT NOT NULL DEFAULT 'required' CHECK (idempotency_policy IN ('none','required','supported')),
        sequence_policy TEXT NOT NULL DEFAULT 'none',
        audit_policy TEXT NOT NULL DEFAULT 'required',
        outbox_policy TEXT NOT NULL DEFAULT 'none',
        reversal_action TEXT,
        result_schema TEXT,
        error_contract TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS platform_views (
        id TEXT PRIMARY KEY,
        module_id TEXT NOT NULL REFERENCES platform_modules(id),
        entity_id TEXT REFERENCES platform_entities(id),
        view_type TEXT NOT NULL CHECK (view_type IN ('page','list','form','detail','workspace','dialog','custom')),
        route TEXT,
        menu_location TEXT,
        layout_schema TEXT NOT NULL DEFAULT '{}',
        layout_version TEXT NOT NULL DEFAULT '1',
        actions TEXT NOT NULL DEFAULT '[]',
        required_permissions TEXT NOT NULL DEFAULT '[]',
        required_feature_states TEXT NOT NULL DEFAULT '[]',
        localization_keys TEXT NOT NULL DEFAULT '{}',
        extension_patches TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS platform_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        schema_version TEXT NOT NULL,
        module_id TEXT NOT NULL REFERENCES platform_modules(id),
        aggregate_entity TEXT,
        tenant_scoped INTEGER NOT NULL DEFAULT 1,
        company_scoped INTEGER NOT NULL DEFAULT 1,
        payload_schema TEXT,
        delivery_guarantee TEXT NOT NULL DEFAULT 'at-least-once',
        retention_policy TEXT,
        privacy_classification TEXT NOT NULL DEFAULT 'internal',
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS platform_settings (
        key TEXT PRIMARY KEY,
        module_id TEXT NOT NULL REFERENCES platform_modules(id),
        type TEXT NOT NULL,
        default_value TEXT,
        scopes TEXT NOT NULL DEFAULT '[]',
        overridable_scopes TEXT NOT NULL DEFAULT '{}',
        required_permission TEXT,
        audit_policy TEXT NOT NULL DEFAULT 'required',
        secret INTEGER NOT NULL DEFAULT 0,
        restart_required INTEGER NOT NULL DEFAULT 0,
        validation_rules TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS platform_sequences (
        id TEXT PRIMARY KEY,
        module_id TEXT NOT NULL REFERENCES platform_modules(id),
        scope_key TEXT NOT NULL,
        template TEXT NOT NULL,
        current_value INTEGER NOT NULL DEFAULT 0,
        reset_policy TEXT NOT NULL DEFAULT 'none',
        gap_policy TEXT NOT NULL DEFAULT 'allowed',
        fiscal_period_key TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS platform_audit_log (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        actor_type TEXT NOT NULL DEFAULT 'user',
        tenant_id TEXT,
        company_id TEXT,
        branch_id TEXT,
        action TEXT NOT NULL,
        resource TEXT NOT NULL,
        resource_id TEXT,
        correlation_id TEXT,
        occurred_at TEXT NOT NULL,
        before_value TEXT,
        after_value TEXT,
        reason TEXT,
        source_channel TEXT NOT NULL DEFAULT 'system',
        result TEXT NOT NULL DEFAULT 'success',
        failure_code TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS platform_outbox (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        schema_version TEXT NOT NULL,
        module_id TEXT NOT NULL,
        aggregate_id TEXT,
        tenant_id TEXT,
        company_id TEXT,
        actor_id TEXT,
        correlation_id TEXT,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        scheduled_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','delivered','failed','dead')),
        error_log TEXT,
        delivered_at TEXT
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_platform_entities_module ON platform_entities(module_id);
      CREATE INDEX IF NOT EXISTS idx_platform_actions_module ON platform_actions(module_id);
      CREATE INDEX IF NOT EXISTS idx_platform_views_module ON platform_views(module_id);
      CREATE INDEX IF NOT EXISTS idx_platform_views_route ON platform_views(route);
      CREATE INDEX IF NOT EXISTS idx_platform_audit_occurred ON platform_audit_log(occurred_at);
      CREATE INDEX IF NOT EXISTS idx_platform_audit_correlation ON platform_audit_log(correlation_id);
      CREATE INDEX IF NOT EXISTS idx_platform_outbox_status ON platform_outbox(status, scheduled_at);
      CREATE INDEX IF NOT EXISTS idx_platform_outbox_correlation ON platform_outbox(correlation_id);
    `);
  },

  down(dialect) {
    dialect.exec(`
      DROP TABLE IF EXISTS platform_outbox;
      DROP TABLE IF EXISTS platform_audit_log;
      DROP TABLE IF EXISTS platform_sequences;
      DROP TABLE IF EXISTS platform_settings;
      DROP TABLE IF EXISTS platform_events;
      DROP TABLE IF EXISTS platform_views;
      DROP TABLE IF EXISTS platform_actions;
      DROP TABLE IF EXISTS platform_entities;
      DROP TABLE IF EXISTS platform_modules;
    `);
  }
};
