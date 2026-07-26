// 046_mrp_planning_subcontracting_and_control_plane — Phase 05 Wave A/D
//
// Source composition:
// - Odoo 19 `addons/stock`/`addons/mrp` reordering rules and `addons/purchase`
//   (LGPL-3, clean-room reference only): the reorder-policy vocabulary
//   (make / buy / subcontract / transfer), lead-time offsetting, and
//   minimum-quantity + multiple lot sizing.
// - ERPNext `erpnext/manufacturing/doctype/production_plan` (GPL-3, clean-room
//   reference only): the "planning run produces proposals a planner accepts"
//   separation, which is what keeps MRP from silently committing money.
// - Octagon migration 043 for the registration idiom.
//
// Control plane: `platform_feature_flags` rows added here are the server-side
// on/off switch for every Phase 05 domain. They are read by the runtime, not by
// the browser, so disabling a module denies its actions rather than merely
// hiding a tab.

const MODULES = [
  ['manufacturing_planning', 'Production Planning', ['mrp', 'proposals', 'exceptions', 'subcontracting']],
];

const ENTITIES = [
  ['planning_run', 'manufacturing_planning', 'platform.manufacturing', 'Planning Run'],
  ['planning_proposal', 'manufacturing_planning', 'platform.manufacturing', 'Planning Proposal'],
  ['subcontract_holding', 'manufacturing_planning', 'platform.manufacturing', 'Subcontractor Holding'],
];

const ACTIONS = [
  ['manufacturing:order:plan', 'manufacturing_core', 'production_order', 'manufacturing:order:write', ['order_id']],
  ['manufacturing:order:variance', 'manufacturing_core', 'production_order', 'manufacturing:order:complete', ['order_id']],
  ['manufacturing:planning:policy', 'manufacturing_planning', 'planning_proposal', 'manufacturing:planning:write', ['product_id']],
  ['manufacturing:planning:run', 'manufacturing_planning', 'planning_run', 'manufacturing:planning:run', []],
  ['manufacturing:planning:accept', 'manufacturing_planning', 'planning_proposal', 'manufacturing:planning:accept', ['proposal_id']],
  ['manufacturing:planning:reject', 'manufacturing_planning', 'planning_proposal', 'manufacturing:planning:accept', ['proposal_id']],
  ['manufacturing:subcontract:transfer', 'manufacturing_planning', 'subcontract_holding', 'manufacturing:subcontract:write', ['order_id', 'order_operation_id', 'product_id', 'quantity']],
  ['manufacturing:subcontract:receive', 'manufacturing_planning', 'subcontract_holding', 'manufacturing:subcontract:write', ['order_id', 'order_operation_id', 'quantity']],
  ['manufacturing:subcontract:return', 'manufacturing_planning', 'subcontract_holding', 'manufacturing:subcontract:write', ['order_id', 'order_operation_id', 'product_id', 'quantity']],
];

// Phase 05 module gates. `enabled` defaults to 1 for the domains this phase
// ships, and the runtime denies actions for a flag that is off.
const FEATURE_FLAGS = [
  ['phase05.manufacturing.enabled', 'manufacturing_core', 1],
  ['phase05.quality.enabled', 'quality_core', 1],
  ['phase05.planning.enabled', 'manufacturing_planning', 1],
  ['phase05.projects.enabled', 'project_core', 1],
  ['phase05.assets.enabled', 'asset_core', 1],
  ['phase05.maintenance.enabled', 'maintenance_core', 1],
  ['phase05.fleet.enabled', 'fleet_core', 1],
];

// Company-scoped operating policy. These are the switches the spec asks for:
// approval requirements, negative-material policy, tolerances, backflush,
// reservation policy and costing method.
const POLICY_DEFAULTS = [
  ['bom_approval_required', '1'],
  ['routing_approval_required', '1'],
  ['manufacturing_order_approval_required', '1'],
  ['negative_material_policy', 'deny'],
  ['overproduction_tolerance_percent', '0'],
  ['underproduction_tolerance_percent', '0'],
  ['backflush_default', '0'],
  ['reservation_policy', 'reserve_on_release'],
  ['costing_method', 'actual'],
  ['quality_hold_policy', 'block_downstream'],
  ['subcontract_ownership_policy', 'retained'],
];

export const migration = {
  id: '046_mrp_planning_subcontracting_and_control_plane',
  owner: 'manufacturing_planning',
  version: '1.24.1',
  parent: '045_manufacturing_engineering_and_quality',
  dependsOn: ['045_manufacturing_engineering_and_quality'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Phase 05 — MRP proposal engine, subcontract ownership ledger and Phase 05 control-plane switches; clean-room references: Odoo 19 stock/mrp reordering, ERPNext production_plan',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS product_planning_policies (
        product_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        reorder_policy TEXT NOT NULL DEFAULT 'buy' CHECK(reorder_policy IN ('make','buy','subcontract','transfer')),
        safety_stock REAL NOT NULL DEFAULT 0 CHECK(safety_stock >= 0),
        lead_time_days REAL NOT NULL DEFAULT 0 CHECK(lead_time_days >= 0),
        minimum_order_quantity REAL NOT NULL DEFAULT 0 CHECK(minimum_order_quantity >= 0),
        order_multiple REAL NOT NULL DEFAULT 0 CHECK(order_multiple >= 0),
        lot_sizing TEXT NOT NULL DEFAULT 'lot_for_lot' CHECK(lot_sizing IN ('lot_for_lot','fixed','min_max')),
        preferred_supplier_id TEXT REFERENCES parties(id),
        preferred_warehouse_id TEXT REFERENCES warehouses(id),
        is_active INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        PRIMARY KEY (product_id, company_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS planning_runs (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        run_type TEXT NOT NULL DEFAULT 'mrp' CHECK(run_type IN ('mrp','mps','forecast','reorder')),
        demand_count INTEGER NOT NULL DEFAULT 0,
        proposal_count INTEGER NOT NULL DEFAULT 0,
        exception_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','completed','failed')),
        started_at TEXT NOT NULL,
        started_by TEXT NOT NULL,
        completed_at TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS planning_proposals (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES planning_runs(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        proposal_type TEXT NOT NULL CHECK(proposal_type IN ('make','buy','subcontract','transfer')),
        quantity REAL NOT NULL CHECK(quantity > 0),
        gross_demand REAL NOT NULL DEFAULT 0,
        available_stock REAL NOT NULL DEFAULT 0,
        open_supply REAL NOT NULL DEFAULT 0,
        safety_stock REAL NOT NULL DEFAULT 0,
        net_requirement REAL NOT NULL DEFAULT 0,
        need_date TEXT,
        order_date TEXT,
        demand_source_type TEXT NOT NULL,
        demand_source_id TEXT NOT NULL,
        demand_lineage TEXT NOT NULL DEFAULT '[]',
        preferred_supplier_id TEXT REFERENCES parties(id),
        warehouse_id TEXT REFERENCES warehouses(id),
        status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','accepted','rejected','expired')),
        accepted_quantity REAL,
        result_type TEXT,
        result_id TEXT,
        decided_by TEXT,
        decided_at TEXT,
        exception_code TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_planning_proposals_status ON planning_proposals(company_id, status);
      CREATE INDEX IF NOT EXISTS idx_planning_proposals_lineage ON planning_proposals(demand_source_type, demand_source_id);

      CREATE TABLE IF NOT EXISTS planning_exceptions (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES planning_runs(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        product_id TEXT REFERENCES product_variants(id),
        exception_code TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS subcontract_holdings (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        order_id TEXT NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
        order_operation_id TEXT NOT NULL REFERENCES production_order_operations(id) ON DELETE CASCADE,
        subcontractor_party_id TEXT NOT NULL REFERENCES parties(id),
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        location_id TEXT NOT NULL REFERENCES stock_locations(id),
        transferred_quantity REAL NOT NULL DEFAULT 0 CHECK(transferred_quantity >= 0),
        consumed_quantity REAL NOT NULL DEFAULT 0 CHECK(consumed_quantity >= 0),
        returned_quantity REAL NOT NULL DEFAULT 0 CHECK(returned_quantity >= 0),
        scrapped_quantity REAL NOT NULL DEFAULT 0 CHECK(scrapped_quantity >= 0),
        value REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, order_id, order_operation_id, product_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS subcontract_receipts (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        order_id TEXT NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
        order_operation_id TEXT NOT NULL REFERENCES production_order_operations(id) ON DELETE CASCADE,
        subcontractor_party_id TEXT NOT NULL REFERENCES parties(id),
        quantity REAL NOT NULL CHECK(quantity > 0),
        service_charge REAL NOT NULL DEFAULT 0 CHECK(service_charge >= 0),
        currency TEXT NOT NULL DEFAULT 'IQD',
        consumed_value REAL NOT NULL DEFAULT 0,
        service_document_id TEXT REFERENCES finance_documents(id),
        quality_inspection_id TEXT REFERENCES quality_inspections(id),
        received_by TEXT NOT NULL,
        received_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS phase05_operating_policies (
        company_id TEXT NOT NULL,
        policy_key TEXT NOT NULL,
        policy_value TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        PRIMARY KEY (company_id, policy_key)
      ) STRICT;
    `);

    const now = new Date().toISOString();
    // Register the module catalogue BEFORE the flags: a flag row references its
    // module, so inserting flags first would silently skip this migration's own
    // `manufacturing_planning` flag.
    registerCatalogue(db, now);

    const insertFlag = db.prepare(`
      INSERT INTO platform_feature_flags (key, module_id, scope, enabled, audit_policy, created_at, updated_at)
      VALUES (?, ?, 'global', ?, 'required', ?, ?)
      ON CONFLICT(key) DO NOTHING
    `);
    // A flag may reference a module that a later Phase 05 migration creates.
    // Insert the flag rows that this migration can satisfy now; the remaining
    // ones are inserted by the migration that creates their module.
    for (const [key, moduleId, enabled] of FEATURE_FLAGS) {
      const moduleExists = db.prepare('SELECT 1 FROM platform_modules WHERE id = ?').get(moduleId);
      if (!moduleExists) continue;
      insertFlag.run(key, moduleId, enabled, now, now);
    }

    const insertPolicy = db.prepare(`
      INSERT INTO phase05_operating_policies (company_id, policy_key, policy_value, updated_at, updated_by)
      VALUES (?, ?, ?, ?, 'migration_046')
      ON CONFLICT(company_id, policy_key) DO NOTHING
    `);
    for (const company of db.prepare('SELECT id FROM platform_companies').all()) {
      for (const [key, value] of POLICY_DEFAULTS) {
        insertPolicy.run(company.id, key, value, now);
      }
    }
  },

  down(db) {
    const deleteAction = db.prepare('DELETE FROM platform_actions WHERE id = ?');
    for (const [id] of ACTIONS) deleteAction.run(id);
    const deleteEntity = db.prepare('DELETE FROM platform_entities WHERE id = ?');
    for (const [id] of ENTITIES) deleteEntity.run(id);
    const deleteFlag = db.prepare('DELETE FROM platform_feature_flags WHERE key = ?');
    for (const [key] of FEATURE_FLAGS) deleteFlag.run(key);
    const deleteModule = db.prepare('DELETE FROM platform_modules WHERE id = ?');
    for (const [id] of MODULES.slice().reverse()) deleteModule.run(id);

    db.exec(`
      DROP TABLE IF EXISTS phase05_operating_policies;
      DROP TABLE IF EXISTS subcontract_receipts;
      DROP TABLE IF EXISTS subcontract_holdings;
      DROP TABLE IF EXISTS planning_exceptions;
      DROP TABLE IF EXISTS planning_proposals;
      DROP TABLE IF EXISTS planning_runs;
      DROP TABLE IF EXISTS product_planning_policies;
    `);
  },
};

function registerCatalogue(db, now) {
  const insertModule = db.prepare(`
    INSERT INTO platform_modules (
      id, name, version, status, kind, owner, dependencies, optional_dependencies,
      capabilities, migrations, settings, created_at, updated_at
    ) VALUES (?, ?, '1.24.1', 'enabled', 'standard', 'octagon', ?, '[]', ?, ?, '[]', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, version = excluded.version, status = excluded.status,
      capabilities = excluded.capabilities, migrations = excluded.migrations,
      updated_at = excluded.updated_at
  `);
  for (const [id, name, capabilities] of MODULES) {
    insertModule.run(
      id, name, JSON.stringify(['platform_kernel', 'manufacturing_core']),
      JSON.stringify(capabilities),
      JSON.stringify(['046_mrp_planning_subcontracting_and_control_plane']),
      now, now,
    );
  }

  const insertEntity = db.prepare(`
    INSERT INTO platform_entities (
      id, module_id, storage_owner, primary_key, label_ar, label_en, section,
      chatter, fields, relations, scope, lifecycle_policy, query_policy,
      action_policy, customization_policy, history_policy, api_exposed,
      migration_owner, created_at, updated_at
    ) VALUES (?, ?, ?, 'id', ?, ?, 'operations', 1, '{}', '{}', 'company',
      'generic', 'scoped', 'registered', 'metadata', 'audit', 1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      module_id = excluded.module_id, storage_owner = excluded.storage_owner,
      label_en = excluded.label_en, updated_at = excluded.updated_at
  `);
  for (const [id, moduleId, storageOwner, label] of ENTITIES) {
    insertEntity.run(id, moduleId, storageOwner, label, label, moduleId, now, now);
  }

  const errorContract = JSON.stringify({
    envelope: 'stable',
    rollback: 'planning writes, stock consequence, finance consequence, audit, outbox and idempotency are atomic',
    codes: [
      'INPUT_MISSING_FIELD', 'IDEMPOTENCY_KEY_REQUIRED', 'UNTRUSTED_ACTION_SCOPE',
      'PLANNING_PROPOSAL_DECIDED', 'SUBCONTRACT_QUANTITY_EXCEEDED',
      'SUBCONTRACT_HOLDING_MISSING', 'MANUFACTURING_ACCOUNT_MAPPING_MISSING',
    ],
  });
  const insertAction = db.prepare(`
    INSERT INTO platform_actions (
      id, module_id, entity_id, kind, allowed_states, required_permission,
      required_scope, input_schema, preconditions, transaction_owner,
      idempotency_policy, sequence_policy, audit_policy, outbox_policy,
      reversal_action, result_schema, error_contract, created_at, updated_at
    ) VALUES (?, ?, ?, 'domain', '[]', ?, 'company', ?, '[]',
      'platform_action_executor', 'required', 'none', 'required', 'required',
      ?, NULL, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      module_id = excluded.module_id, entity_id = excluded.entity_id,
      required_permission = excluded.required_permission,
      input_schema = excluded.input_schema,
      reversal_action = excluded.reversal_action,
      error_contract = excluded.error_contract, updated_at = excluded.updated_at
  `);
  const reversals = {
    'manufacturing:planning:accept': 'manufacturing:planning:reject',
    'manufacturing:subcontract:transfer': 'manufacturing:subcontract:return',
  };
  for (const [id, moduleId, entityId, permission, required] of ACTIONS) {
    insertAction.run(
      id, moduleId, entityId, permission,
      JSON.stringify({ type: 'object', required }),
      reversals[id] || null, errorContract, now, now,
    );
  }
}
