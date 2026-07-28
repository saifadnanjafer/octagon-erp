// 058_maintenance_management.mjs — Maintenance Management & Spare Parts (Checkpoint E2).

const MODULE_ID = 'platform.kernel';
const MAINTENANCE_MODULE = 'operations_maintenance';
const migrationIdSelf = '058_maintenance_management';

const ENTITIES = [
  ['maintenance_request', MAINTENANCE_MODULE, 'platform.maintenance', 'Maintenance Request'],
  ['maintenance_preventive_plan', MAINTENANCE_MODULE, 'platform.maintenance', 'Preventive Plan'],
  ['maintenance_order', MAINTENANCE_MODULE, 'platform.maintenance', 'Maintenance Order'],
  ['maintenance_spare_part', MAINTENANCE_MODULE, 'platform.maintenance', 'Spare Part Reservation/Issue'],
];

const ACTIONS = [
  ['maintenance:request:create', 'maintenance_request', 'maintenance:request:write', ['asset_id', 'title']],
  ['maintenance:request:approve', 'maintenance_request', 'maintenance:request:approve', ['request_id']],
  ['maintenance:plan:create', 'maintenance_preventive_plan', 'maintenance:plan:write', ['title', 'asset_id']],
  ['maintenance:order:create', 'maintenance_order', 'maintenance:order:write', ['asset_id', 'title']],
  ['maintenance:order:reserve_parts', 'maintenance_order', 'maintenance:order:write', ['order_id']],
  ['maintenance:order:issue_parts', 'maintenance_order', 'maintenance:order:write', ['order_id']],
  ['maintenance:order:complete', 'maintenance_order', 'maintenance:order:approve', ['order_id']],
];

function registerModule(db, id, name, capabilities, now) {
  db.prepare(`
    INSERT INTO platform_modules (
      id, name, version, status, kind, owner, dependencies, optional_dependencies,
      capabilities, migrations, settings, created_at, updated_at
    ) VALUES (?, ?, '1.0.0', 'enabled', 'standard', 'operations', ?, '[]', ?, ?, '{}', ?, ?)
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
    JSON.stringify(['platform_kernel', 'assets_management', 'commercial_inventory']),
    JSON.stringify(capabilities),
    JSON.stringify([migrationIdSelf]),
    now, now,
  );

  const companies = db.prepare('SELECT id FROM platform_companies').all();
  const insertAssignment = db.prepare(`
    INSERT INTO platform_module_assignments (
      id, module_id, scope_type, scope_id, enabled, navigation_visible,
      configuration_url, configuration_status, version, created_at, updated_at, updated_by
    ) VALUES (?, ?, 'company', ?, 1, 1, ?, 'ready', 1, ?, ?, 'migration:058')
    ON CONFLICT(module_id, scope_type, scope_id) DO NOTHING
  `);
  for (const company of companies) {
    insertAssignment.run(`pma_${id}_${company.id}`, id, company.id, `/${id}`, now, now);
  }
}

export const migration = {
  id: migrationIdSelf,
  owner: MODULE_ID,
  version: '1.37.0',
  parent: '057_assets_and_depreciation_schedules',
  dependsOn: ['057_assets_and_depreciation_schedules'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Clean-room implementation on canonical Work Items, Inventory, and Assets authorities.',

  up(db) {
    const now = new Date().toISOString();

    db.exec(`
      CREATE TABLE IF NOT EXISTS maintenance_requests (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        request_number TEXT NOT NULL,
        asset_id TEXT NOT NULL REFERENCES assets(id),
        request_type TEXT NOT NULL DEFAULT 'corrective'
          CHECK(request_type IN ('preventive','corrective','emergency')),
        priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')),
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        failure_code TEXT NOT NULL DEFAULT '',
        symptom TEXT NOT NULL DEFAULT '',
        reported_by TEXT,
        reported_at TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'submitted'
          CHECK(state IN ('draft','submitted','approved','work_order_created','rejected','cancelled')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, request_number)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS maintenance_preventive_plans (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        code TEXT NOT NULL,
        title TEXT NOT NULL,
        asset_id TEXT NOT NULL REFERENCES assets(id),
        frequency_type TEXT NOT NULL DEFAULT 'days'
          CHECK(frequency_type IN ('days','weeks','months','odometer','engine_hours')),
        frequency_value REAL NOT NULL CHECK(frequency_value > 0),
        last_done_date TEXT,
        last_done_meter REAL NOT NULL DEFAULT 0.0,
        next_due_date TEXT,
        next_due_meter REAL NOT NULL DEFAULT 0.0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, code)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS maintenance_orders (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        order_number TEXT NOT NULL,
        request_id TEXT REFERENCES maintenance_requests(id),
        preventive_plan_id TEXT REFERENCES maintenance_preventive_plans(id),
        asset_id TEXT NOT NULL REFERENCES assets(id),
        work_item_id TEXT REFERENCES work_items(id),
        order_type TEXT NOT NULL DEFAULT 'corrective'
          CHECK(order_type IN ('preventive','corrective','emergency')),
        priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')),
        title TEXT NOT NULL,
        failure_code TEXT NOT NULL DEFAULT '',
        root_cause TEXT NOT NULL DEFAULT '',
        action_taken TEXT NOT NULL DEFAULT '',
        downtime_hours REAL NOT NULL DEFAULT 0.0 CHECK(downtime_hours >= 0),
        total_parts_cost REAL NOT NULL DEFAULT 0.0 CHECK(total_parts_cost >= 0),
        total_labor_cost REAL NOT NULL DEFAULT 0.0 CHECK(total_labor_cost >= 0),
        total_cost REAL NOT NULL DEFAULT 0.0 CHECK(total_cost >= 0),
        state TEXT NOT NULL DEFAULT 'draft'
          CHECK(state IN ('draft','scheduled','parts_reserved','in_progress','completed','closed','cancelled')),
        scheduled_start TEXT,
        scheduled_end TEXT,
        actual_start TEXT,
        actual_end TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, order_number)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_maint_orders_asset ON maintenance_orders(company_id, asset_id, state);

      CREATE TABLE IF NOT EXISTS maintenance_spare_parts (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        maintenance_order_id TEXT NOT NULL REFERENCES maintenance_orders(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        uom_id TEXT REFERENCES uoms(id),
        required_quantity REAL NOT NULL CHECK(required_quantity > 0),
        issued_quantity REAL NOT NULL DEFAULT 0.0 CHECK(issued_quantity >= 0),
        unit_cost REAL NOT NULL DEFAULT 0.0 CHECK(unit_cost >= 0),
        total_cost REAL NOT NULL DEFAULT 0.0 CHECK(total_cost >= 0),
        stock_move_id TEXT,
        state TEXT NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','issued','returned')),
        created_at TEXT NOT NULL
      ) STRICT;
    `);

    registerModule(db, MAINTENANCE_MODULE, 'Maintenance Operations', ['maintenance.request', 'maintenance.order'], now);

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
      codes: ['INPUT_MISSING_FIELD', 'PRECONDITION_FAILED', 'MAINTENANCE_ORDER_NOT_FOUND'],
    });
    for (const [actionId, entityId, permission, required] of ACTIONS) {
      insertAction.run(
        actionId, MAINTENANCE_MODULE, entityId, permission,
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

    db.prepare('DELETE FROM platform_module_assignments WHERE module_id = ?').run(MAINTENANCE_MODULE);
    db.prepare('DELETE FROM platform_modules WHERE id = ?').run(MAINTENANCE_MODULE);

    db.exec(`
      DROP TABLE IF EXISTS maintenance_spare_parts;
      DROP TABLE IF EXISTS maintenance_orders;
      DROP TABLE IF EXISTS maintenance_preventive_plans;
      DROP TABLE IF EXISTS maintenance_requests;
    `);
  },
};
