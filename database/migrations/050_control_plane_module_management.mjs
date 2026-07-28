// 050_control_plane_module_management — Checkpoint C5
//
// Extends the existing platform Control Plane with company/branch assignment,
// licensing, module-health and backup-run facts. Module actions stay on the
// existing ActionExecutor so enable/disable, entitlements, audit, outbox and
// idempotency are one transaction.

const CONTROL_ACTIONS = [
  ['control:module:set_status', ['module_id', 'enabled']],
  ['control:feature:set', ['key', 'enabled']],
  ['control:module:assign', ['module_id', 'scope_type', 'scope_id', 'enabled']],
  ['control:license:set', ['module_id', 'company_id', 'status', 'plan']],
  ['control:job:set', ['job_id', 'enabled']],
];

export const migration = {
  id: '050_control_plane_module_management',
  owner: 'platform.kernel',
  version: '1.29.0',
  parent: '049_work_item_operating_views',
  dependsOn: ['049_work_item_operating_views'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible-owned-facts',
  sourceProvenance: 'Existing Octagon Control Plane and frozen VNext module lifecycle/pack entitlement behavior, clean-room adapted after Odoo 19 settings review',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS platform_module_assignments (
        id TEXT PRIMARY KEY,
        module_id TEXT NOT NULL REFERENCES platform_modules(id),
        scope_type TEXT NOT NULL CHECK (scope_type IN ('company','branch')),
        scope_id TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        navigation_visible INTEGER NOT NULL DEFAULT 1,
        configuration_url TEXT,
        configuration_status TEXT NOT NULL DEFAULT 'ready'
          CHECK (configuration_status IN ('ready','warning','missing')),
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        UNIQUE(module_id, scope_type, scope_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_module_assignments_scope
        ON platform_module_assignments(scope_type, scope_id, module_id);

      CREATE TABLE IF NOT EXISTS platform_module_licenses (
        id TEXT PRIMARY KEY,
        module_id TEXT NOT NULL REFERENCES platform_modules(id),
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        plan TEXT NOT NULL,
        package_status TEXT NOT NULL DEFAULT 'active'
          CHECK (package_status IN ('active','trial','suspended','expired','unlicensed')),
        license_key_prefix TEXT,
        seats INTEGER,
        features TEXT NOT NULL DEFAULT '[]',
        valid_from TEXT,
        valid_until TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        UNIQUE(module_id, company_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_module_licenses_company
        ON platform_module_licenses(company_id, package_status, module_id);

      CREATE TABLE IF NOT EXISTS platform_backup_runs (
        id TEXT PRIMARY KEY,
        company_id TEXT,
        backup_type TEXT NOT NULL CHECK (backup_type IN ('database','configuration','full')),
        status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed','verified')),
        storage_ref TEXT,
        checksum TEXT,
        bytes INTEGER,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        verified_at TEXT,
        created_by TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_backup_runs_company
        ON platform_backup_runs(company_id, started_at);
    `);

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO platform_modules (
        id, name, version, status, kind, owner, dependencies,
        optional_dependencies, capabilities, migrations, settings,
        created_at, updated_at
      ) VALUES (
        'checkpoint_c_test_module', 'Checkpoint C Test Module', '1.0.0',
        'enabled', 'optional', 'octagon', '["platform_kernel"]', '[]',
        '["module_control_acceptance"]',
        '["050_control_plane_module_management"]', '[]', ?, ?
      ) ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, version=excluded.version, status='enabled',
        capabilities=excluded.capabilities, migrations=excluded.migrations,
        updated_at=excluded.updated_at
    `).run(now, now);

    db.prepare(`
      INSERT INTO platform_views (
        id, module_id, entity_id, view_type, route, menu_location,
        layout_schema, layout_version, actions, required_permissions,
        required_feature_states, localization_keys, extension_patches,
        created_at, updated_at
      ) VALUES (
        'view_checkpoint_c_test_module', 'checkpoint_c_test_module', NULL,
        'workspace', 'checkpoint_c_test', 'administration_preview', '{}', '1',
        '[]', '["control:admin"]', '[]',
        '{"ar":"وحدة اختبار التحكم","en":"Control Test Module"}', '[]', ?, ?
      ) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at
    `).run(now, now);

    db.prepare(`
      INSERT INTO platform_entities (
        id,module_id,storage_owner,primary_key,label_ar,label_en,section,
        chatter,fields,relations,scope,lifecycle_policy,query_policy,
        action_policy,customization_policy,history_policy,api_exposed,
        migration_owner,created_at,updated_at
      ) VALUES (
        'control_plane','platform_kernel','platform.control_plane','id',
        'منصة التحكم','Control Plane','administration',1,'{}','{}','company',
        'governed','scoped','registered','metadata','audit',1,
        'platform.kernel',?,?
      ) ON CONFLICT(id) DO UPDATE SET
        module_id='platform_kernel',storage_owner='platform.control_plane',
        updated_at=excluded.updated_at
    `).run(now, now);

    const insertAction = db.prepare(`
      INSERT INTO platform_actions (
        id, module_id, entity_id, kind, allowed_states, required_permission,
        required_scope, input_schema, preconditions, transaction_owner,
        idempotency_policy, sequence_policy, audit_policy, outbox_policy,
        reversal_action, result_schema, error_contract, created_at, updated_at
      ) VALUES (?, 'platform_kernel', 'control_plane', 'domain', '[]', 'control:admin',
        'company', ?, '[]', 'platform_action_executor', 'required', 'none',
        'required', 'required', NULL, NULL, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        module_id='platform_kernel', kind='domain',
        required_permission='control:admin', required_scope='company',
        input_schema=excluded.input_schema,
        transaction_owner='platform_action_executor',
        idempotency_policy='required', audit_policy='required',
        outbox_policy='required', error_contract=excluded.error_contract,
        updated_at=excluded.updated_at
    `);
    const errorContract = JSON.stringify({
      envelope: 'stable',
      rollback: 'control fact, audit, outbox, and idempotency are atomic',
      codes: [
        'MODULE_NOT_FOUND', 'MODULE_NOT_ENABLED', 'DEPENDENCY_NOT_ENABLED',
        'DEPENDENT_MODULES_ENABLED', 'MODULE_SCOPE_DENIED',
        'MODULE_UNLICENSED', 'CONTROL_VERSION_CONFLICT',
      ],
    });
    for (const [id, required] of CONTROL_ACTIONS) {
      insertAction.run(
        id,
        JSON.stringify({ type: 'object', required }),
        errorContract,
        now,
        now,
      );
    }

    db.prepare(`
      INSERT INTO platform_actions (
        id, module_id, entity_id, kind, allowed_states, required_permission,
        required_scope, input_schema, preconditions, transaction_owner,
        idempotency_policy, sequence_policy, audit_policy, outbox_policy,
        reversal_action, result_schema, error_contract, created_at, updated_at
      ) VALUES (
        'control:test:ping', 'checkpoint_c_test_module', 'control_plane', 'domain', '[]',
        'control:admin', 'company', '{"type":"object","required":[]}', '[]',
        'platform_action_executor', 'required', 'none', 'required', 'required',
        NULL, NULL, ?, ?, ?
      ) ON CONFLICT(id) DO UPDATE SET
        module_id='checkpoint_c_test_module', required_permission='control:admin',
        transaction_owner='platform_action_executor', updated_at=excluded.updated_at
    `).run(errorContract, now, now);
  },

  down(db) {
    const removeAction = db.prepare('DELETE FROM platform_actions WHERE id = ?');
    removeAction.run('control:test:ping');
    for (const [id] of CONTROL_ACTIONS) removeAction.run(id);
    db.prepare("DELETE FROM platform_views WHERE id='view_checkpoint_c_test_module'").run();
    db.prepare("DELETE FROM platform_entities WHERE id='control_plane'").run();
    db.prepare("DELETE FROM platform_modules WHERE id='checkpoint_c_test_module'").run();
    db.exec(`
      DROP INDEX IF EXISTS idx_backup_runs_company;
      DROP TABLE IF EXISTS platform_backup_runs;
      DROP INDEX IF EXISTS idx_module_licenses_company;
      DROP TABLE IF EXISTS platform_module_licenses;
      DROP INDEX IF EXISTS idx_module_assignments_scope;
      DROP TABLE IF EXISTS platform_module_assignments;
    `);
  },
};

export default migration;
