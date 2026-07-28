// 057_assets_and_depreciation_schedules.mjs — Assets, Asset Register & Depreciation (Checkpoint E1).

const MODULE_ID = 'platform.kernel';
const ASSETS_MODULE = 'assets_management';
const migrationIdSelf = '057_assets_and_depreciation_schedules';

const ENTITIES = [
  ['asset_category', ASSETS_MODULE, 'platform.assets', 'Asset Category'],
  ['asset', ASSETS_MODULE, 'platform.assets', 'Asset'],
  ['asset_depreciation_schedule', ASSETS_MODULE, 'platform.assets', 'Asset Depreciation Schedule'],
  ['asset_transfer', ASSETS_MODULE, 'platform.assets', 'Asset Transfer'],
];

const ACTIONS = [
  ['assets:category:create', 'asset_category', 'assets:category:write', ['code', 'name_en']],
  ['assets:asset:create', 'asset', 'assets:asset:write', ['name_en', 'category_id', 'acquisition_cost']],
  ['assets:asset:capitalize', 'asset', 'assets:asset:approve', ['asset_id']],
  ['assets:asset:assign', 'asset', 'assets:asset:write', ['asset_id', 'custodian_user_id']],
  ['assets:asset:transfer', 'asset_transfer', 'assets:asset:write', ['asset_id']],
  ['assets:asset:calculate_depreciation', 'asset_depreciation_schedule', 'assets:asset:write', ['asset_id']],
  ['assets:asset:post_depreciation_request', 'asset_depreciation_schedule', 'assets:asset:approve', ['schedule_id']],
  ['assets:asset:dispose', 'asset', 'assets:asset:approve', ['asset_id']],
];

function registerModule(db, id, name, capabilities, now) {
  db.prepare(`
    INSERT INTO platform_modules (
      id, name, version, status, kind, owner, dependencies, optional_dependencies,
      capabilities, migrations, settings, created_at, updated_at
    ) VALUES (?, ?, '1.0.0', 'enabled', 'standard', 'finance', ?, '[]', ?, ?, '{}', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      version = excluded.version,
      status = excluded.status,
      dependencies = excluded.dependencies,
      capabilities = excluded.capabilities,
      migrations = excluded.migrations,
      updated_at = excluded.updated_at
  `).run(
    id, name,
    JSON.stringify(['platform_kernel', 'finance']),
    JSON.stringify(capabilities),
    JSON.stringify([migrationIdSelf]),
    now, now,
  );

  const companies = db.prepare('SELECT id FROM platform_companies').all();
  const insertAssignment = db.prepare(`
    INSERT INTO platform_module_assignments (
      id, module_id, scope_type, scope_id, enabled, navigation_visible,
      configuration_url, configuration_status, version, created_at, updated_at, updated_by
    ) VALUES (?, ?, 'company', ?, 1, 1, ?, 'ready', 1, ?, ?, 'migration:057')
    ON CONFLICT(module_id, scope_type, scope_id) DO NOTHING
  `);
  for (const company of companies) {
    insertAssignment.run(`pma_${id}_${company.id}`, id, company.id, `/${id}`, now, now);
  }
}

export const migration = {
  id: migrationIdSelf,
  owner: MODULE_ID,
  version: '1.36.0',
  parent: '056_quality_management_and_subcontracting',
  dependsOn: ['056_quality_management_and_subcontracting'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Clean-room implementation on canonical Asset Register & Phase 03 asset-accounting interface.',

  up(db) {
    const now = new Date().toISOString();

    db.exec(`
      CREATE TABLE IF NOT EXISTS asset_categories (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        code TEXT NOT NULL,
        name_ar TEXT NOT NULL DEFAULT '',
        name_en TEXT NOT NULL DEFAULT '',
        depreciation_method TEXT NOT NULL DEFAULT 'straight_line'
          CHECK(depreciation_method IN ('straight_line','declining_balance')),
        useful_life_months INTEGER NOT NULL DEFAULT 36 CHECK(useful_life_months > 0),
        asset_account_id TEXT,
        depreciation_account_id TEXT,
        accumulated_depreciation_account_id TEXT,
        disposal_gain_loss_account_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, code)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        branch_id TEXT,
        asset_number TEXT NOT NULL,
        name_ar TEXT NOT NULL DEFAULT '',
        name_en TEXT NOT NULL DEFAULT '',
        category_id TEXT NOT NULL REFERENCES asset_categories(id),
        equipment_class TEXT NOT NULL DEFAULT 'general',
        serial_number TEXT NOT NULL DEFAULT '',
        acquisition_date TEXT,
        capitalization_date TEXT,
        acquisition_cost REAL NOT NULL CHECK(acquisition_cost >= 0),
        residual_value REAL NOT NULL DEFAULT 0.0 CHECK(residual_value >= 0),
        accumulated_depreciation REAL NOT NULL DEFAULT 0.0,
        book_value REAL NOT NULL DEFAULT 0.0,
        useful_life_months INTEGER NOT NULL DEFAULT 36 CHECK(useful_life_months > 0),
        depreciation_method TEXT NOT NULL DEFAULT 'straight_line'
          CHECK(depreciation_method IN ('straight_line','declining_balance')),
        asset_account_id TEXT,
        depreciation_account_id TEXT,
        accumulated_depreciation_account_id TEXT,
        supplier_id TEXT REFERENCES parties(id),
        location_id TEXT,
        custodian_user_id TEXT,
        project_id TEXT REFERENCES projects(id),
        warranty_expiry TEXT,
        state TEXT NOT NULL DEFAULT 'draft'
          CHECK(state IN ('draft','capitalized','active','impaired','disposed')),
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, asset_number)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_assets_category ON assets(company_id, category_id, state);

      CREATE TABLE IF NOT EXISTS asset_depreciation_schedules (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        period_number INTEGER NOT NULL,
        period_date TEXT NOT NULL,
        depreciation_amount REAL NOT NULL CHECK(depreciation_amount >= 0),
        accumulated_depreciation REAL NOT NULL CHECK(accumulated_depreciation >= 0),
        book_value REAL NOT NULL CHECK(book_value >= 0),
        state TEXT NOT NULL DEFAULT 'scheduled' CHECK(state IN ('scheduled','posted','cancelled')),
        journal_entry_id TEXT,
        posted_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(asset_id, period_number)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS asset_transfers (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        asset_id TEXT NOT NULL REFERENCES assets(id),
        from_location_id TEXT,
        to_location_id TEXT,
        from_custodian_id TEXT,
        to_custodian_id TEXT,
        transfer_date TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      ) STRICT;
    `);

    registerModule(db, ASSETS_MODULE, 'Asset Management', ['assets.register', 'assets.depreciation'], now);

    const insertEntity = db.prepare(`
      INSERT INTO platform_entities (
        id, module_id, storage_owner, primary_key, label_ar, label_en, section,
        chatter, fields, relations, scope, lifecycle_policy, query_policy,
        action_policy, customization_policy, history_policy, api_exposed,
        migration_owner, created_at, updated_at
      ) VALUES (?, ?, ?, 'id', ?, ?, 'operations', 1, '{}', '{}', 'company',
        'generic', 'scoped', 'registered', 'metadata', 'audit', 1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        module_id = excluded.module_id,
        storage_owner = excluded.storage_owner,
        label_en = excluded.label_en,
        query_policy = 'scoped',
        action_policy = 'registered',
        history_policy = 'audit',
        updated_at = excluded.updated_at
    `);
    for (const [id, moduleId, storageOwner, label] of ENTITIES) {
      insertEntity.run(id, moduleId, storageOwner, label, label, moduleId, now, now);
    }

    const insertAction = db.prepare(`
      INSERT INTO platform_actions (
        id, module_id, entity_id, kind, allowed_states, required_permission,
        required_scope, input_schema, preconditions, transaction_owner,
        idempotency_policy, sequence_policy, audit_policy, outbox_policy,
        reversal_action, result_schema, error_contract, created_at, updated_at
      ) VALUES (?, ?, ?, 'domain', '[]', ?, 'company', ?, '[]',
        'platform_action_executor', 'required', 'none', 'required', 'required',
        NULL, NULL, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        module_id = excluded.module_id,
        entity_id = excluded.entity_id,
        required_permission = excluded.required_permission,
        input_schema = excluded.input_schema,
        transaction_owner = excluded.transaction_owner,
        idempotency_policy = excluded.idempotency_policy,
        audit_policy = excluded.audit_policy,
        outbox_policy = excluded.outbox_policy,
        error_contract = excluded.error_contract,
        updated_at = excluded.updated_at
    `);
    const errorContract = JSON.stringify({
      envelope: 'stable',
      rollback: 'atomic',
      codes: ['INPUT_MISSING_FIELD', 'PRECONDITION_FAILED', 'ASSET_NOT_FOUND'],
    });
    for (const [actionId, entityId, permission, required] of ACTIONS) {
      insertAction.run(
        actionId, ASSETS_MODULE, entityId, permission,
        JSON.stringify({ type: 'object', required }),
        errorContract, now, now,
      );
    }
  },

  down(db) {
    const deleteAction = db.prepare('DELETE FROM platform_actions WHERE id = ?');
    for (const [actionId] of ACTIONS) deleteAction.run(actionId);
    const deleteEntity = db.prepare('DELETE FROM platform_entities WHERE id = ?');
    for (const [id] of ENTITIES) deleteEntity.run(id);

    db.prepare('DELETE FROM platform_module_assignments WHERE module_id = ?').run(ASSETS_MODULE);
    db.prepare('DELETE FROM platform_modules WHERE id = ?').run(ASSETS_MODULE);

    db.exec(`
      DROP TABLE IF EXISTS asset_transfers;
      DROP TABLE IF EXISTS asset_depreciation_schedules;
      DROP TABLE IF EXISTS assets;
      DROP TABLE IF EXISTS asset_categories;
    `);
  },
};
