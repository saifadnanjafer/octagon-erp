// 056_quality_management_and_subcontracting.mjs — Quality Management & Subcontract Manufacturing (Checkpoint D4).

const MODULE_ID = 'platform.kernel';
const QUALITY_MODULE = 'operations_quality';
const MANUFACTURING_MODULE = 'operations_manufacturing';
const migrationIdSelf = '056_quality_management_and_subcontracting';

const ENTITIES = [
  ['quality_plan', QUALITY_MODULE, 'platform.quality', 'Quality Plan'],
  ['quality_inspection_point', QUALITY_MODULE, 'platform.quality', 'Quality Inspection Point'],
  ['quality_inspection', QUALITY_MODULE, 'platform.quality', 'Quality Inspection'],
  ['quality_ncr', QUALITY_MODULE, 'platform.quality', 'Non-Conformance Report'],
  ['quality_capa', QUALITY_MODULE, 'platform.quality', 'CAPA Action'],
  ['subcontract_order', MANUFACTURING_MODULE, 'platform.manufacturing', 'Subcontract Order'],
  ['supplier_held_stock', MANUFACTURING_MODULE, 'platform.manufacturing', 'Supplier Held Stock'],
];

const ACTIONS = [
  ['quality:plan:create', 'quality_plan', 'quality:plan:write', ['name']],
  ['quality:inspection:create', 'quality_inspection', 'quality:inspection:write', ['inspection_type', 'source_type', 'source_id', 'product_id']],
  ['quality:inspection:record_results', 'quality_inspection', 'quality:inspection:write', ['inspection_id']],
  ['quality:inspection:pass', 'quality_inspection', 'quality:inspection:approve', ['inspection_id']],
  ['quality:inspection:fail', 'quality_inspection', 'quality:inspection:approve', ['inspection_id']],
  ['quality:inspection:release', 'quality_inspection', 'quality:inspection:approve', ['inspection_id']],
  ['quality:ncr:create', 'quality_ncr', 'quality:ncr:write', ['title', 'inspection_id']],
  ['quality:capa:create', 'quality_capa', 'quality:capa:write', ['title', 'ncr_id']],
  ['quality:capa:close', 'quality_capa', 'quality:capa:write', ['capa_id']],
  ['manufacturing:subcontract:create', 'subcontract_order', 'manufacturing:subcontract:write', ['production_order_id', 'supplier_id', 'service_product_id', 'quantity']],
  ['manufacturing:subcontract:dispatch_components', 'subcontract_order', 'manufacturing:subcontract:write', ['subcontract_order_id']],
  ['manufacturing:subcontract:receive_goods', 'subcontract_order', 'manufacturing:subcontract:write', ['subcontract_order_id', 'quantity']],
  ['manufacturing:subcontract:reconcile', 'subcontract_order', 'manufacturing:subcontract:write', ['subcontract_order_id']],
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
    JSON.stringify(['platform_kernel', 'commercial_inventory']),
    JSON.stringify(capabilities),
    JSON.stringify([migrationIdSelf]),
    now, now,
  );

  const companies = db.prepare('SELECT id FROM platform_companies').all();
  const insertAssignment = db.prepare(`
    INSERT INTO platform_module_assignments (
      id, module_id, scope_type, scope_id, enabled, navigation_visible,
      configuration_url, configuration_status, version, created_at, updated_at, updated_by
    ) VALUES (?, ?, 'company', ?, 1, 1, ?, 'ready', 1, ?, ?, 'migration:056')
    ON CONFLICT(module_id, scope_type, scope_id) DO NOTHING
  `);
  for (const company of companies) {
    insertAssignment.run(`pma_${id}_${company.id}`, id, company.id, `/${id}`, now, now);
  }
}

export const migration = {
  id: migrationIdSelf,
  owner: MODULE_ID,
  version: '1.35.0',
  parent: '055_work_orders_shop_floor_and_production_cost',
  dependsOn: ['055_work_orders_shop_floor_and_production_cost'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Clean-room implementation on canonical Quality, Work Items, Inventory, and Subcontract authorities.',

  up(db) {
    const now = new Date().toISOString();

    db.exec(`
      CREATE TABLE IF NOT EXISTS quality_plans (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        product_id TEXT REFERENCES product_variants(id),
        category TEXT NOT NULL DEFAULT 'general',
        version INTEGER NOT NULL DEFAULT 1,
        state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','approved','obsolete')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, code)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS quality_inspection_points (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        plan_id TEXT NOT NULL REFERENCES quality_plans(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL DEFAULT 10,
        title TEXT NOT NULL,
        test_type TEXT NOT NULL DEFAULT 'pass_fail' CHECK(test_type IN ('pass_fail','quantitative','qualitative')),
        min_value REAL,
        max_value REAL,
        target_value REAL,
        uom_id TEXT REFERENCES uoms(id),
        is_mandatory INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS quality_inspections (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        plan_id TEXT REFERENCES quality_plans(id),
        inspection_number TEXT NOT NULL,
        inspection_type TEXT NOT NULL DEFAULT 'in_process'
          CHECK(inspection_type IN ('incoming','in_process','final','supplier','return')),
        source_type TEXT NOT NULL
          CHECK(source_type IN ('production_order','work_order','purchase_receipt','customer_return')),
        source_id TEXT NOT NULL,
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        lot_number TEXT,
        serial_number TEXT,
        sample_size REAL NOT NULL DEFAULT 1.0 CHECK(sample_size > 0),
        inspected_quantity REAL NOT NULL DEFAULT 0.0 CHECK(inspected_quantity >= 0),
        passed_quantity REAL NOT NULL DEFAULT 0.0 CHECK(passed_quantity >= 0),
        failed_quantity REAL NOT NULL DEFAULT 0.0 CHECK(failed_quantity >= 0),
        state TEXT NOT NULL DEFAULT 'pending'
          CHECK(state IN ('pending','in_progress','pass','fail','released','quarantine','ncr')),
        inspector_id TEXT,
        inspected_at TEXT,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, inspection_number)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_quality_inspections_source ON quality_inspections(company_id, source_type, source_id);

      CREATE TABLE IF NOT EXISTS quality_inspection_results (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        inspection_id TEXT NOT NULL REFERENCES quality_inspections(id) ON DELETE CASCADE,
        point_id TEXT NOT NULL REFERENCES quality_inspection_points(id),
        result_value TEXT,
        pass_fail TEXT NOT NULL CHECK(pass_fail IN ('pass','fail')),
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS quality_ncrs (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        ncr_number TEXT NOT NULL,
        inspection_id TEXT NOT NULL REFERENCES quality_inspections(id),
        title TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'minor' CHECK(severity IN ('minor','major','critical')),
        disposition TEXT NOT NULL DEFAULT 'hold' CHECK(disposition IN ('hold','rework','scrap','concession','return_to_vendor')),
        root_cause TEXT NOT NULL DEFAULT '',
        state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','investigating','action_required','closed')),
        assigned_to TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, ncr_number)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS quality_capas (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        capa_number TEXT NOT NULL,
        ncr_id TEXT NOT NULL REFERENCES quality_ncrs(id),
        work_item_id TEXT REFERENCES work_items(id),
        title TEXT NOT NULL,
        action_type TEXT NOT NULL DEFAULT 'corrective' CHECK(action_type IN ('corrective','preventive')),
        description TEXT NOT NULL DEFAULT '',
        root_cause_analysis TEXT NOT NULL DEFAULT '',
        target_date TEXT,
        state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','in_progress','verification','closed')),
        closed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, capa_number)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS mfg_subcontract_orders (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        subcontract_number TEXT NOT NULL,
        production_order_id TEXT NOT NULL REFERENCES mfg_production_orders(id),
        work_order_id TEXT REFERENCES mfg_work_orders(id),
        supplier_id TEXT NOT NULL REFERENCES parties(id),
        subcontract_operation_id TEXT REFERENCES routing_operations(id),
        service_product_id TEXT NOT NULL REFERENCES product_variants(id),
        quantity REAL NOT NULL CHECK(quantity > 0),
        unit_cost REAL NOT NULL DEFAULT 0.0 CHECK(unit_cost >= 0),
        total_cost REAL NOT NULL DEFAULT 0.0 CHECK(total_cost >= 0),
        state TEXT NOT NULL DEFAULT 'draft'
          CHECK(state IN ('draft','dispatched','received','inspected','billed','closed')),
        dispatch_stock_move_id TEXT,
        return_stock_move_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, subcontract_number)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS mfg_supplier_held_stock (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        supplier_id TEXT NOT NULL REFERENCES parties(id),
        component_id TEXT NOT NULL REFERENCES product_variants(id),
        uom_id TEXT REFERENCES uoms(id),
        dispatched_quantity REAL NOT NULL DEFAULT 0.0 CHECK(dispatched_quantity >= 0),
        consumed_quantity REAL NOT NULL DEFAULT 0.0 CHECK(consumed_quantity >= 0),
        returned_quantity REAL NOT NULL DEFAULT 0.0 CHECK(returned_quantity >= 0),
        remaining_quantity REAL NOT NULL DEFAULT 0.0 CHECK(remaining_quantity >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, supplier_id, component_id)
      ) STRICT;
    `);

    registerModule(db, QUALITY_MODULE, 'Quality Assurance & Control', ['quality.inspection', 'quality.ncr', 'quality.capa'], now);

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
      codes: ['INPUT_MISSING_FIELD', 'PRECONDITION_FAILED', 'QUALITY_INSPECTION_NOT_FOUND', 'NCR_NOT_FOUND'],
    });
    for (const [actionId, entityId, permission, required] of ACTIONS) {
      const moduleId = actionId.startsWith('quality:') ? QUALITY_MODULE : MANUFACTURING_MODULE;
      insertAction.run(
        actionId, moduleId, entityId, permission,
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

    db.prepare('DELETE FROM platform_module_assignments WHERE module_id = ?').run(QUALITY_MODULE);
    db.prepare('DELETE FROM platform_modules WHERE id = ?').run(QUALITY_MODULE);

    db.exec(`
      DROP TABLE IF EXISTS mfg_supplier_held_stock;
      DROP TABLE IF EXISTS mfg_subcontract_orders;
      DROP TABLE IF EXISTS quality_capas;
      DROP TABLE IF EXISTS quality_ncrs;
      DROP TABLE IF EXISTS quality_inspection_results;
      DROP TABLE IF EXISTS quality_inspections;
      DROP TABLE IF EXISTS quality_inspection_points;
      DROP TABLE IF EXISTS quality_plans;
    `);
  },
};
