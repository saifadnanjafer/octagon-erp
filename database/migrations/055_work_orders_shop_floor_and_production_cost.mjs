// 055_work_orders_shop_floor_and_production_cost.mjs — Work Orders, Shop Floor, Material Issues, WIP & Production Costing (Checkpoint D3).

const MODULE_ID = 'platform.kernel';
const MANUFACTURING_MODULE = 'operations_manufacturing';
const migrationIdSelf = '055_work_orders_shop_floor_and_production_cost';

const ENTITIES = [
  ['mfg_work_order', MANUFACTURING_MODULE, 'platform.manufacturing', 'Mfg Work Order'],
  ['mfg_material_issue', MANUFACTURING_MODULE, 'platform.manufacturing', 'Material Issue'],
  ['mfg_labor_entry', MANUFACTURING_MODULE, 'platform.manufacturing', 'Labor Entry'],
  ['mfg_production_cost_summary', MANUFACTURING_MODULE, 'platform.manufacturing', 'Production Cost Summary'],
];

const ACTIONS = [
  ['manufacturing:work_order:start', 'mfg_work_order', 'manufacturing:work_order:write', ['work_order_id']],
  ['manufacturing:work_order:pause', 'mfg_work_order', 'manufacturing:work_order:write', ['work_order_id']],
  ['manufacturing:work_order:resume', 'mfg_work_order', 'manufacturing:work_order:write', ['work_order_id']],
  ['manufacturing:work_order:complete', 'mfg_work_order', 'manufacturing:work_order:write', ['work_order_id']],
  ['manufacturing:work_order:record_labor', 'mfg_labor_entry', 'manufacturing:work_order:write', ['work_order_id', 'run_minutes']],
  ['manufacturing:material:issue', 'mfg_material_issue', 'manufacturing:material:write', ['production_order_id', 'requirement_id', 'quantity']],
  ['manufacturing:material:return', 'mfg_material_issue', 'manufacturing:material:write', ['production_order_id', 'requirement_id', 'quantity']],
  ['manufacturing:order:complete', 'production_order', 'manufacturing:order:approve', ['order_id']],
  ['manufacturing:order:close', 'production_order', 'manufacturing:order:approve', ['order_id']],
];

export const migration = {
  id: migrationIdSelf,
  owner: MODULE_ID,
  version: '1.34.0',
  parent: '054_mrp_and_manufacturing_orders',
  dependsOn: ['054_mrp_and_manufacturing_orders'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Clean-room implementation on canonical Work Items, Inventory, and Finance authorities.',

  up(db) {
    const now = new Date().toISOString();

    db.exec(`
      CREATE TABLE IF NOT EXISTS mfg_work_orders (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        production_order_id TEXT NOT NULL REFERENCES mfg_production_orders(id) ON DELETE CASCADE,
        work_item_id TEXT REFERENCES work_items(id),
        operation_sequence INTEGER NOT NULL DEFAULT 10,
        operation_id TEXT REFERENCES routing_operations(id),
        work_center_id TEXT NOT NULL REFERENCES work_centers(id),
        resource_id TEXT REFERENCES work_center_resources(id),
        name TEXT NOT NULL,
        planned_setup_minutes REAL NOT NULL DEFAULT 0.0,
        planned_run_minutes REAL NOT NULL DEFAULT 0.0,
        actual_setup_minutes REAL NOT NULL DEFAULT 0.0,
        actual_run_minutes REAL NOT NULL DEFAULT 0.0,
        planned_start_date TEXT,
        planned_end_date TEXT,
        actual_start_date TEXT,
        actual_end_date TEXT,
        quantity_to_produce REAL NOT NULL CHECK(quantity_to_produce > 0),
        quantity_started REAL NOT NULL DEFAULT 0.0,
        quantity_completed REAL NOT NULL DEFAULT 0.0,
        quantity_rejected REAL NOT NULL DEFAULT 0.0,
        state TEXT NOT NULL DEFAULT 'draft'
          CHECK(state IN ('draft','ready','in_progress','paused','on_hold','completed','rejected')),
        operator_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(production_order_id, operation_sequence)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_work_orders_center ON mfg_work_orders(company_id, work_center_id, state);

      CREATE TABLE IF NOT EXISTS mfg_material_issues (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        production_order_id TEXT NOT NULL REFERENCES mfg_production_orders(id),
        requirement_id TEXT REFERENCES mfg_material_requirements(id),
        component_id TEXT NOT NULL REFERENCES product_variants(id),
        uom_id TEXT REFERENCES uoms(id),
        quantity REAL NOT NULL CHECK(quantity > 0),
        issue_type TEXT NOT NULL DEFAULT 'issue'
          CHECK(issue_type IN ('issue','return','scrap','backflush')),
        warehouse_id TEXT NOT NULL,
        location_id TEXT NOT NULL,
        wip_location_id TEXT NOT NULL,
        lot_number TEXT,
        serial_number TEXT,
        stock_move_id TEXT,
        valuation_fact_id TEXT,
        journal_entry_id TEXT,
        issued_by TEXT,
        issued_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_material_issues_order ON mfg_material_issues(production_order_id);

      CREATE TABLE IF NOT EXISTS mfg_labor_entries (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        work_order_id TEXT NOT NULL REFERENCES mfg_work_orders(id) ON DELETE CASCADE,
        production_order_id TEXT NOT NULL REFERENCES mfg_production_orders(id),
        work_center_id TEXT NOT NULL REFERENCES work_centers(id),
        resource_id TEXT REFERENCES work_center_resources(id),
        operator_id TEXT,
        setup_minutes REAL NOT NULL DEFAULT 0.0,
        run_minutes REAL NOT NULL DEFAULT 0.0,
        labor_rate REAL NOT NULL DEFAULT 0.0,
        machine_rate REAL NOT NULL DEFAULT 0.0,
        overhead_rate REAL NOT NULL DEFAULT 0.0,
        total_cost REAL NOT NULL DEFAULT 0.0,
        entry_date TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS mfg_production_cost_summaries (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        production_order_id TEXT NOT NULL REFERENCES mfg_production_orders(id) ON DELETE CASCADE,
        direct_material_cost REAL NOT NULL DEFAULT 0.0,
        direct_labor_cost REAL NOT NULL DEFAULT 0.0,
        machine_overhead_cost REAL NOT NULL DEFAULT 0.0,
        subcontract_cost REAL NOT NULL DEFAULT 0.0,
        scrap_cost REAL NOT NULL DEFAULT 0.0,
        total_wip_cost REAL NOT NULL DEFAULT 0.0,
        finished_goods_cost REAL NOT NULL DEFAULT 0.0,
        variance_cost REAL NOT NULL DEFAULT 0.0,
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed','reconciled')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(production_order_id)
      ) STRICT;
    `);

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
      codes: ['INPUT_MISSING_FIELD', 'PRECONDITION_FAILED', 'WORK_ORDER_NOT_FOUND'],
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

    db.exec(`
      DROP TABLE IF EXISTS mfg_production_cost_summaries;
      DROP TABLE IF EXISTS mfg_labor_entries;
      DROP TABLE IF EXISTS mfg_material_issues;
      DROP TABLE IF EXISTS mfg_work_orders;
    `);
  },
};
