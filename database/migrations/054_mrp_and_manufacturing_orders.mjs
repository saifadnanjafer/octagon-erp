// 054_mrp_and_manufacturing_orders.mjs — Manufacturing Orders & Material Requirements (Checkpoint D3).

const MODULE_ID = 'platform.kernel';
const MANUFACTURING_MODULE = 'operations_manufacturing';
const migrationIdSelf = '054_mrp_and_manufacturing_orders';

const ENTITIES = [
  ['production_order', MANUFACTURING_MODULE, 'platform.manufacturing', 'Production Order'],
  ['mfg_material_requirement', MANUFACTURING_MODULE, 'platform.manufacturing', 'Material Requirement'],
];

const ACTIONS = [
  ['manufacturing:order:create', 'production_order', 'manufacturing:order:write', ['product_id', 'planned_quantity']],
  ['manufacturing:order:plan', 'production_order', 'manufacturing:order:write', ['order_id']],
  ['manufacturing:order:release', 'production_order', 'manufacturing:order:approve', ['order_id']],
  ['manufacturing:order:reserve_materials', 'production_order', 'manufacturing:order:write', ['order_id']],
  ['manufacturing:order:hold', 'production_order', 'manufacturing:order:write', ['order_id']],
  ['manufacturing:order:cancel', 'production_order', 'manufacturing:order:write', ['order_id']],
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
    JSON.stringify(['platform_kernel', 'operations_engineering', 'commercial_inventory']),
    JSON.stringify(capabilities),
    JSON.stringify([migrationIdSelf]),
    now, now,
  );

  const companies = db.prepare('SELECT id FROM platform_companies').all();
  const insertAssignment = db.prepare(`
    INSERT INTO platform_module_assignments (
      id, module_id, scope_type, scope_id, enabled, navigation_visible,
      configuration_url, configuration_status, version, created_at, updated_at, updated_by
    ) VALUES (?, ?, 'company', ?, 1, 1, ?, 'ready', 1, ?, ?, 'migration:054')
    ON CONFLICT(module_id, scope_type, scope_id) DO NOTHING
  `);
  for (const company of companies) {
    insertAssignment.run(`pma_${id}_${company.id}`, id, company.id, `/${id}`, now, now);
  }
}

export const migration = {
  id: migrationIdSelf,
  owner: MODULE_ID,
  version: '1.33.0',
  parent: '053_engineering_bom_routing_mrp',
  dependsOn: ['053_engineering_bom_routing_mrp'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Clean-room implementation on canonical product/BOM/Routing/inventory authorities. VNext donors inspected (migrations/615_r3_manufacturing_core.mjs, vnext/server/modules/manufacturing/). Manufacturing order lifecycle modelled after Odoo 19 mrp.production and ERPNext Work Order.',

  up(db) {
    const now = new Date().toISOString();

    db.exec(`
      CREATE TABLE IF NOT EXISTS mfg_production_orders (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        branch_id TEXT,
        order_number TEXT NOT NULL,
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        bom_version_id TEXT NOT NULL REFERENCES bom_versions(id),
        routing_version_id TEXT REFERENCES routing_versions(id),
        planned_quantity REAL NOT NULL CHECK(planned_quantity > 0),
        completed_quantity REAL NOT NULL DEFAULT 0.0 CHECK(completed_quantity >= 0),
        rejected_quantity REAL NOT NULL DEFAULT 0.0 CHECK(rejected_quantity >= 0),
        uom_id TEXT REFERENCES uoms(id),
        warehouse_id TEXT NOT NULL,
        wip_location_id TEXT NOT NULL,
        finished_location_id TEXT NOT NULL,
        project_id TEXT REFERENCES projects(id),
        work_item_id TEXT REFERENCES work_items(id),
        cost_center_id TEXT,
        state TEXT NOT NULL DEFAULT 'draft'
          CHECK(state IN ('draft','planned','released','materials_reserved','in_progress','quality','completed','closed','on_hold','cancelled','reversed')),
        planned_start_date TEXT,
        planned_end_date TEXT,
        actual_start_date TEXT,
        actual_end_date TEXT,
        priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')),
        notes TEXT NOT NULL DEFAULT '',
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, order_number)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_production_orders_state ON mfg_production_orders(company_id, state);
      CREATE INDEX IF NOT EXISTS idx_production_orders_project ON mfg_production_orders(project_id);

      CREATE TABLE IF NOT EXISTS mfg_material_requirements (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        production_order_id TEXT NOT NULL REFERENCES mfg_production_orders(id) ON DELETE CASCADE,
        bom_line_id TEXT REFERENCES bom_lines(id),
        component_id TEXT NOT NULL REFERENCES product_variants(id),
        uom_id TEXT REFERENCES uoms(id),
        required_quantity REAL NOT NULL CHECK(required_quantity > 0),
        reserved_quantity REAL NOT NULL DEFAULT 0.0 CHECK(reserved_quantity >= 0),
        issued_quantity REAL NOT NULL DEFAULT 0.0 CHECK(issued_quantity >= 0),
        returned_quantity REAL NOT NULL DEFAULT 0.0 CHECK(returned_quantity >= 0),
        scrap_quantity REAL NOT NULL DEFAULT 0.0 CHECK(scrap_quantity >= 0),
        is_by_product INTEGER NOT NULL DEFAULT 0,
        is_co_product INTEGER NOT NULL DEFAULT 0,
        cost_share_percent REAL NOT NULL DEFAULT 0.0,
        warehouse_id TEXT,
        location_id TEXT,
        state TEXT NOT NULL DEFAULT 'pending'
          CHECK(state IN ('pending','reserved','issued','completed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_material_reqs_order ON mfg_material_requirements(production_order_id);
    `);

    registerModule(db, MANUFACTURING_MODULE, 'Manufacturing Operations', ['manufacturing.order'], now);

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
      codes: ['INPUT_MISSING_FIELD', 'PRECONDITION_FAILED', 'MANUFACTURING_ORDER_NOT_FOUND', 'INVALID_STATE_TRANSITION'],
    });
    for (const [actionId, entityId, permission, required] of ACTIONS) {
      insertAction.run(
        actionId, MANUFACTURING_MODULE, entityId, permission,
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

    db.prepare('DELETE FROM platform_module_assignments WHERE module_id = ?').run(MANUFACTURING_MODULE);
    db.prepare('DELETE FROM platform_modules WHERE id = ?').run(MANUFACTURING_MODULE);

    db.exec(`
      DROP TABLE IF EXISTS mfg_material_requirements;
      DROP TABLE IF EXISTS mfg_production_orders;
    `);
  },
};
