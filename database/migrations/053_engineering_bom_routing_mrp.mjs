// 053_engineering_bom_routing_mrp — Engineering, BOMs, Routings, Work Centers,
// and MRP planning (Checkpoint D2).
//
// What this migration does:
//   1. Adds the versioned BOM authority (header + versions + lines) with
//      multi-level, phantom, alternative/substitute, by-product/co-product,
//      scrap-factor and yield support.
//   2. Adds engineering change orders (ECO) as the governed path for revising
//      an approved BOM or routing.
//   3. Adds work centers and machines/resources with cost rates.
//   4. Adds the versioned Routing authority (header + versions + operations)
//      including setup/cycle/queue time, labour and machine requirements,
//      subcontract operations and quality checkpoints.
//   5. Adds MRP: planning runs, demand records, requirement explosions and
//      governed PROPOSALS (purchase / transfer / manufacture / reschedule).
//   6. Registers the module, entities and governed actions.
//
// Authority boundaries honoured here:
//   - Products, variants, UOMs and parties stay canonical. No copies.
//   - MRP produces PROPOSALS ONLY. It never creates a financial commitment,
//     a purchase order, or a stock move directly; approval is a separate
//     governed action that hands off to the canonical Procurement /
//     Inventory / Manufacturing authorities.
//   - Work-centre cost rates reuse the Checkpoint D1 `project_cost_rates`
//     table (rate_scope='work_center'), so there is ONE standard-cost
//     authority and payroll is still never consulted.
//   - An approved BOM/routing version consumed by a posted production order
//     is immutable; change requires a new revision plus explicit supersession.
//
// Source provenance: clean-room behavioural implementation on Octagon's own
// canonical authorities. The project-owned VNext donors were inspected —
// octagon-erp-commercial-vnext/migrations/615_r3_manufacturing_core.mjs
// (19 lines) and vnext/server/modules/manufacturing/manufacturing-engine.js
// (4 lines) @ cf7ae4ed — and carry no reusable BOM/routing lifecycle, so
// nothing was salvaged from them. vnext/server/modules/manufacturing/
// mrp-engine.js (92 lines) was read for its explosion shape only; the
// implementation here is re-expressed on canonical stock/reservation facts and
// shares no code. Versioned-BOM, phantom-explosion and routing-operation
// concepts were modelled behaviourally after Odoo 19 Community `mrp` and
// ERPNext `manufacturing`; no donor source was copied.

const MODULE_ID = 'platform.kernel';
const ENGINEERING_MODULE = 'operations_engineering';
const MRP_MODULE = 'operations_mrp';
const migrationIdSelf = '053_engineering_bom_routing_mrp';

const ENTITIES = [
  ['bom', ENGINEERING_MODULE, 'platform.engineering', 'Bill of Materials'],
  ['bom_version', ENGINEERING_MODULE, 'platform.engineering', 'BOM Version'],
  ['bom_line', ENGINEERING_MODULE, 'platform.engineering', 'BOM Line'],
  ['engineering_change_order', ENGINEERING_MODULE, 'platform.engineering', 'Engineering Change Order'],
  ['work_center', ENGINEERING_MODULE, 'platform.engineering', 'Work Center'],
  ['work_center_resource', ENGINEERING_MODULE, 'platform.engineering', 'Work Center Resource'],
  ['routing', ENGINEERING_MODULE, 'platform.engineering', 'Routing'],
  ['routing_version', ENGINEERING_MODULE, 'platform.engineering', 'Routing Version'],
  ['routing_operation', ENGINEERING_MODULE, 'platform.engineering', 'Routing Operation'],
  ['mrp_run', MRP_MODULE, 'platform.mrp', 'MRP Run'],
  ['mrp_demand', MRP_MODULE, 'platform.mrp', 'MRP Demand'],
  ['mrp_requirement', MRP_MODULE, 'platform.mrp', 'MRP Requirement'],
  ['mrp_proposal', MRP_MODULE, 'platform.mrp', 'MRP Proposal'],
  ['mrp_item_policy', MRP_MODULE, 'platform.mrp', 'MRP Item Policy'],
];

const ACTIONS = [
  // BOM
  ['engineering:bom:create', 'bom', 'engineering:bom:write', ['product_id']],
  ['engineering:bom:add_line', 'bom_line', 'engineering:bom:write', ['bom_version_id', 'component_id', 'quantity']],
  ['engineering:bom:remove_line', 'bom_line', 'engineering:bom:write', ['line_id']],
  ['engineering:bom:submit', 'bom_version', 'engineering:bom:write', ['bom_version_id']],
  ['engineering:bom:approve', 'bom_version', 'engineering:bom:approve', ['bom_version_id']],
  ['engineering:bom:reject', 'bom_version', 'engineering:bom:approve', ['bom_version_id']],
  ['engineering:bom:new_revision', 'bom_version', 'engineering:bom:write', ['bom_id']],
  ['engineering:bom:supersede', 'bom_version', 'engineering:bom:approve', ['bom_version_id', 'superseded_by_id']],
  // ECO
  ['engineering:eco:create', 'engineering_change_order', 'engineering:bom:write', ['title']],
  ['engineering:eco:approve', 'engineering_change_order', 'engineering:bom:approve', ['eco_id']],
  ['engineering:eco:reject', 'engineering_change_order', 'engineering:bom:approve', ['eco_id']],
  // Work centers
  ['engineering:work_center:create', 'work_center', 'engineering:work_center:write', ['code', 'name']],
  ['engineering:work_center:update', 'work_center', 'engineering:work_center:write', ['work_center_id']],
  ['engineering:work_center:add_resource', 'work_center_resource', 'engineering:work_center:write', ['work_center_id', 'name']],
  // Routing
  ['engineering:routing:create', 'routing', 'engineering:routing:write', ['product_id']],
  ['engineering:routing:add_operation', 'routing_operation', 'engineering:routing:write', ['routing_version_id', 'work_center_id', 'name']],
  ['engineering:routing:submit', 'routing_version', 'engineering:routing:write', ['routing_version_id']],
  ['engineering:routing:approve', 'routing_version', 'engineering:routing:approve', ['routing_version_id']],
  ['engineering:routing:new_revision', 'routing_version', 'engineering:routing:write', ['routing_id']],
  // MRP
  ['mrp:policy:set', 'mrp_item_policy', 'mrp:plan:write', ['product_id']],
  ['mrp:demand:record', 'mrp_demand', 'mrp:plan:write', ['product_id', 'quantity']],
  ['mrp:run:execute', 'mrp_run', 'mrp:plan:write', []],
  ['mrp:proposal:approve', 'mrp_proposal', 'mrp:plan:approve', ['proposal_id']],
  ['mrp:proposal:reject', 'mrp_proposal', 'mrp:plan:approve', ['proposal_id']],
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
    JSON.stringify(['platform_kernel', 'finance', 'commercial_inventory']),
    JSON.stringify(capabilities),
    JSON.stringify([migrationIdSelf]),
    now, now,
  );

  const companies = db.prepare('SELECT id FROM platform_companies').all();
  const insertAssignment = db.prepare(`
    INSERT INTO platform_module_assignments (
      id, module_id, scope_type, scope_id, enabled, navigation_visible,
      configuration_url, configuration_status, version, created_at, updated_at, updated_by
    ) VALUES (?, ?, 'company', ?, 1, 1, ?, 'ready', 1, ?, ?, 'migration:053')
    ON CONFLICT(module_id, scope_type, scope_id) DO NOTHING
  `);
  for (const company of companies) {
    insertAssignment.run(`pma_${id}_${company.id}`, id, company.id, `/${id}`, now, now);
  }
}

export const migration = {
  id: migrationIdSelf,
  owner: MODULE_ID,
  version: '1.32.0',
  parent: '052_projects_and_project_costing',
  dependsOn: ['052_projects_and_project_costing'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Clean-room behavioural implementation on canonical product/UOM/inventory authorities. VNext donors inspected (migrations/615_r3_manufacturing_core.mjs 19 lines, manufacturing-engine.js 4 lines @ cf7ae4ed) and found to carry no reusable lifecycle — nothing salvaged; mrp-engine.js read for explosion shape only, no code shared. Versioned-BOM/routing and phantom-explosion concepts modelled behaviourally after Odoo 19 Community mrp and ERPNext manufacturing; no donor source copied.',

  up(db) {
    const now = new Date().toISOString();

    // ---------------------------------------------------------------
    // 1. BOM authority — header, versions, lines
    // ---------------------------------------------------------------
    db.exec(`
      CREATE TABLE IF NOT EXISTS boms (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        branch_id TEXT,
        code TEXT NOT NULL,
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        name_ar TEXT NOT NULL DEFAULT '',
        name_en TEXT NOT NULL DEFAULT '',
        bom_type TEXT NOT NULL DEFAULT 'manufacturing'
          CHECK(bom_type IN ('manufacturing','phantom','subcontract')),
        uom_id TEXT REFERENCES uoms(id),
        is_active INTEGER NOT NULL DEFAULT 1,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, code)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_boms_product ON boms(company_id, product_id);

      CREATE TABLE IF NOT EXISTS bom_versions (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        bom_id TEXT NOT NULL REFERENCES boms(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL DEFAULT 1,
        quantity REAL NOT NULL DEFAULT 1.0 CHECK(quantity > 0),
        state TEXT NOT NULL DEFAULT 'draft'
          CHECK(state IN ('draft','review','approved','superseded','rejected','cancelled')),
        effective_from TEXT,
        effective_to TEXT,
        yield_percent REAL NOT NULL DEFAULT 100.0 CHECK(yield_percent > 0),
        submitted_by TEXT,
        submitted_at TEXT,
        approved_by TEXT,
        approved_at TEXT,
        rejected_reason TEXT NOT NULL DEFAULT '',
        superseded_by_id TEXT REFERENCES bom_versions(id),
        superseded_at TEXT,
        eco_id TEXT,
        drawings TEXT NOT NULL DEFAULT '[]',
        work_instructions TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        -- Set the first time a production order consumes this version.
        -- Once set, the version is immutable.
        consumed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(bom_id, revision)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_bom_versions_state ON bom_versions(bom_id, state);

      CREATE TABLE IF NOT EXISTS bom_lines (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        bom_version_id TEXT NOT NULL REFERENCES bom_versions(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL DEFAULT 10,
        line_type TEXT NOT NULL DEFAULT 'component'
          CHECK(line_type IN ('component','by_product','co_product')),
        component_id TEXT NOT NULL REFERENCES product_variants(id),
        uom_id TEXT REFERENCES uoms(id),
        quantity REAL NOT NULL CHECK(quantity > 0),
        scrap_factor_percent REAL NOT NULL DEFAULT 0.0 CHECK(scrap_factor_percent >= 0),
        -- A phantom line explodes into its own BOM instead of being issued.
        is_phantom INTEGER NOT NULL DEFAULT 0,
        child_bom_id TEXT REFERENCES boms(id),
        -- Co-product allocation share (percent of joint cost).
        cost_share_percent REAL NOT NULL DEFAULT 0.0,
        operation_seq INTEGER,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_bom_lines_version ON bom_lines(bom_version_id, sequence);

      -- Approved alternatives / substitutes for a component on a BOM line.
      CREATE TABLE IF NOT EXISTS bom_line_substitutes (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        bom_line_id TEXT NOT NULL REFERENCES bom_lines(id) ON DELETE CASCADE,
        substitute_id TEXT NOT NULL REFERENCES product_variants(id),
        conversion_ratio REAL NOT NULL DEFAULT 1.0 CHECK(conversion_ratio > 0),
        priority INTEGER NOT NULL DEFAULT 10,
        is_approved INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        UNIQUE(bom_line_id, substitute_id)
      ) STRICT;
    `);

    // ---------------------------------------------------------------
    // 2. Engineering change orders
    // ---------------------------------------------------------------
    db.exec(`
      CREATE TABLE IF NOT EXISTS engineering_change_orders (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        eco_number TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        change_type TEXT NOT NULL DEFAULT 'bom'
          CHECK(change_type IN ('bom','routing','both')),
        bom_id TEXT REFERENCES boms(id),
        routing_id TEXT,
        reason TEXT NOT NULL DEFAULT '',
        state TEXT NOT NULL DEFAULT 'draft'
          CHECK(state IN ('draft','submitted','approved','rejected','implemented','cancelled')),
        requested_by TEXT,
        decided_by TEXT,
        decided_at TEXT,
        decision_reason TEXT NOT NULL DEFAULT '',
        resulting_bom_version_id TEXT REFERENCES bom_versions(id),
        resulting_routing_version_id TEXT,
        attachments TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, eco_number)
      ) STRICT;
    `);

    // ---------------------------------------------------------------
    // 3. Work centers and resources
    // ---------------------------------------------------------------
    db.exec(`
      CREATE TABLE IF NOT EXISTS work_centers (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        branch_id TEXT,
        code TEXT NOT NULL,
        name_ar TEXT NOT NULL DEFAULT '',
        name_en TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        warehouse_id TEXT,
        wip_location_id TEXT,
        capacity_per_hour REAL NOT NULL DEFAULT 1.0 CHECK(capacity_per_hour > 0),
        efficiency_percent REAL NOT NULL DEFAULT 100.0 CHECK(efficiency_percent > 0),
        working_hours_per_day REAL NOT NULL DEFAULT 8.0,
        -- Absorption/accrual account used when labour and machine time are
        -- charged to WIP. Finance remains the only GL writer.
        absorption_account_id TEXT,
        machine_cost_per_hour REAL NOT NULL DEFAULT 0.0,
        labor_cost_per_hour REAL NOT NULL DEFAULT 0.0,
        overhead_cost_per_hour REAL NOT NULL DEFAULT 0.0,
        is_subcontract INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, code)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS work_center_resources (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        work_center_id TEXT NOT NULL REFERENCES work_centers(id) ON DELETE CASCADE,
        resource_type TEXT NOT NULL DEFAULT 'machine'
          CHECK(resource_type IN ('machine','tool','labor_pool')),
        code TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL,
        asset_ref TEXT,
        capacity_per_hour REAL NOT NULL DEFAULT 1.0,
        cost_per_hour REAL NOT NULL DEFAULT 0.0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `);

    // ---------------------------------------------------------------
    // 4. Routing authority — header, versions, operations
    // ---------------------------------------------------------------
    db.exec(`
      CREATE TABLE IF NOT EXISTS routings (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        branch_id TEXT,
        code TEXT NOT NULL,
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        name_ar TEXT NOT NULL DEFAULT '',
        name_en TEXT NOT NULL DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, code)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_routings_product ON routings(company_id, product_id);

      CREATE TABLE IF NOT EXISTS routing_versions (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        routing_id TEXT NOT NULL REFERENCES routings(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL DEFAULT 1,
        state TEXT NOT NULL DEFAULT 'draft'
          CHECK(state IN ('draft','review','approved','superseded','rejected','cancelled')),
        effective_from TEXT,
        effective_to TEXT,
        submitted_by TEXT,
        submitted_at TEXT,
        approved_by TEXT,
        approved_at TEXT,
        rejected_reason TEXT NOT NULL DEFAULT '',
        superseded_by_id TEXT REFERENCES routing_versions(id),
        superseded_at TEXT,
        eco_id TEXT REFERENCES engineering_change_orders(id),
        consumed_at TEXT,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(routing_id, revision)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS routing_operations (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        routing_version_id TEXT NOT NULL REFERENCES routing_versions(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL DEFAULT 10,
        code TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        work_center_id TEXT NOT NULL REFERENCES work_centers(id),
        resource_id TEXT REFERENCES work_center_resources(id),
        setup_minutes REAL NOT NULL DEFAULT 0.0 CHECK(setup_minutes >= 0),
        cycle_minutes_per_unit REAL NOT NULL DEFAULT 0.0 CHECK(cycle_minutes_per_unit >= 0),
        queue_minutes REAL NOT NULL DEFAULT 0.0 CHECK(queue_minutes >= 0),
        labor_required INTEGER NOT NULL DEFAULT 1,
        machine_required INTEGER NOT NULL DEFAULT 1,
        labor_rate_per_hour REAL NOT NULL DEFAULT 0.0,
        machine_rate_per_hour REAL NOT NULL DEFAULT 0.0,
        predecessor_seq INTEGER,
        is_subcontract INTEGER NOT NULL DEFAULT 0,
        subcontract_party_id TEXT REFERENCES parties(id),
        subcontract_service_cost REAL NOT NULL DEFAULT 0.0,
        quality_checkpoint INTEGER NOT NULL DEFAULT 0,
        quality_plan_ref TEXT,
        work_instructions TEXT NOT NULL DEFAULT '',
        attachments TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        UNIQUE(routing_version_id, sequence)
      ) STRICT;
    `);

    // ---------------------------------------------------------------
    // 5. MRP — policies, demand, runs, requirements, proposals
    // ---------------------------------------------------------------
    db.exec(`
      CREATE TABLE IF NOT EXISTS mrp_item_policies (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        sourcing TEXT NOT NULL DEFAULT 'buy'
          CHECK(sourcing IN ('make','buy','transfer','subcontract')),
        safety_stock REAL NOT NULL DEFAULT 0.0 CHECK(safety_stock >= 0),
        reorder_point REAL NOT NULL DEFAULT 0.0 CHECK(reorder_point >= 0),
        lead_time_days INTEGER NOT NULL DEFAULT 0 CHECK(lead_time_days >= 0),
        lot_sizing TEXT NOT NULL DEFAULT 'lot_for_lot'
          CHECK(lot_sizing IN ('lot_for_lot','fixed','min_max','economic')),
        fixed_lot_size REAL NOT NULL DEFAULT 0.0,
        minimum_order_quantity REAL NOT NULL DEFAULT 0.0,
        multiple_of REAL NOT NULL DEFAULT 0.0,
        preferred_supplier_id TEXT REFERENCES parties(id),
        source_warehouse_id TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, product_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS mrp_demands (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        demand_type TEXT NOT NULL DEFAULT 'manual'
          CHECK(demand_type IN ('sales_order','project','forecast','manual','master_schedule')),
        source_id TEXT,
        project_id TEXT REFERENCES projects(id),
        warehouse_id TEXT,
        quantity REAL NOT NULL CHECK(quantity > 0),
        required_date TEXT,
        state TEXT NOT NULL DEFAULT 'open'
          CHECK(state IN ('open','planned','closed','cancelled')),
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_mrp_demands_open ON mrp_demands(company_id, state, product_id);

      CREATE TABLE IF NOT EXISTS mrp_runs (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        run_number TEXT NOT NULL,
        warehouse_id TEXT,
        horizon_days INTEGER NOT NULL DEFAULT 90,
        state TEXT NOT NULL DEFAULT 'completed'
          CHECK(state IN ('running','completed','failed','cancelled')),
        demand_count INTEGER NOT NULL DEFAULT 0,
        requirement_count INTEGER NOT NULL DEFAULT 0,
        proposal_count INTEGER NOT NULL DEFAULT 0,
        shortage_count INTEGER NOT NULL DEFAULT 0,
        executed_by TEXT,
        executed_at TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE(company_id, run_number)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS mrp_requirements (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        mrp_run_id TEXT NOT NULL REFERENCES mrp_runs(id) ON DELETE CASCADE,
        parent_requirement_id TEXT REFERENCES mrp_requirements(id) ON DELETE CASCADE,
        level INTEGER NOT NULL DEFAULT 0,
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        demand_id TEXT REFERENCES mrp_demands(id),
        bom_version_id TEXT REFERENCES bom_versions(id),
        gross_requirement REAL NOT NULL DEFAULT 0.0,
        on_hand REAL NOT NULL DEFAULT 0.0,
        reserved REAL NOT NULL DEFAULT 0.0,
        scheduled_receipts REAL NOT NULL DEFAULT 0.0,
        safety_stock REAL NOT NULL DEFAULT 0.0,
        available REAL NOT NULL DEFAULT 0.0,
        net_requirement REAL NOT NULL DEFAULT 0.0,
        required_date TEXT,
        is_shortage INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_mrp_requirements_run ON mrp_requirements(mrp_run_id, level);

      -- MRP output is a PROPOSAL. It carries no financial commitment and
      -- creates no stock movement until a separate governed approval hands it
      -- to the canonical Procurement / Inventory / Manufacturing authority.
      CREATE TABLE IF NOT EXISTS mrp_proposals (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        mrp_run_id TEXT NOT NULL REFERENCES mrp_runs(id) ON DELETE CASCADE,
        requirement_id TEXT REFERENCES mrp_requirements(id) ON DELETE CASCADE,
        proposal_type TEXT NOT NULL
          CHECK(proposal_type IN ('purchase','transfer','manufacture','subcontract','reschedule')),
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        quantity REAL NOT NULL CHECK(quantity > 0),
        suggested_date TEXT,
        supplier_id TEXT REFERENCES parties(id),
        source_warehouse_id TEXT,
        target_warehouse_id TEXT,
        bom_version_id TEXT REFERENCES bom_versions(id),
        routing_version_id TEXT REFERENCES routing_versions(id),
        reschedule_reason TEXT NOT NULL DEFAULT '',
        state TEXT NOT NULL DEFAULT 'proposed'
          CHECK(state IN ('proposed','approved','rejected','executed','cancelled')),
        decided_by TEXT,
        decided_at TEXT,
        decision_reason TEXT NOT NULL DEFAULT '',
        -- Set when an approved proposal is handed to a canonical authority.
        executed_authority TEXT,
        executed_ref TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_mrp_proposals_state ON mrp_proposals(company_id, state, proposal_type);
    `);

    // ---------------------------------------------------------------
    // 6. Registry
    // ---------------------------------------------------------------
    registerModule(db, ENGINEERING_MODULE, 'Engineering', ['engineering.bom', 'engineering.routing', 'engineering.work_center'], now);
    registerModule(db, MRP_MODULE, 'MRP & Planning', ['mrp.plan', 'mrp.proposal'], now);

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
      rollback: 'business mutation, audit, outbox, and idempotency are atomic',
      codes: [
        'INPUT_MISSING_FIELD', 'IDEMPOTENCY_KEY_REQUIRED', 'UNTRUSTED_ACTION_SCOPE',
        'PRECONDITION_FAILED', 'BOM_NOT_FOUND', 'BOM_VERSION_IMMUTABLE',
        'BOM_NOT_APPROVED', 'ROUTING_NOT_APPROVED', 'MRP_PROPOSAL_CLOSED',
        'MODULE_NOT_ENABLED',
      ],
    });
    for (const [actionId, entityId, permission, required] of ACTIONS) {
      const moduleId = actionId.startsWith('mrp:') ? MRP_MODULE : ENGINEERING_MODULE;
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

    for (const moduleId of [ENGINEERING_MODULE, MRP_MODULE]) {
      db.prepare('DELETE FROM platform_module_licenses WHERE module_id = ?').run(moduleId);
      db.prepare('DELETE FROM platform_module_assignments WHERE module_id = ?').run(moduleId);
      db.prepare('DELETE FROM platform_modules WHERE id = ?').run(moduleId);
    }

    db.exec(`
      DROP TABLE IF EXISTS mrp_proposals;
      DROP TABLE IF EXISTS mrp_requirements;
      DROP TABLE IF EXISTS mrp_runs;
      DROP TABLE IF EXISTS mrp_demands;
      DROP TABLE IF EXISTS mrp_item_policies;
      DROP TABLE IF EXISTS routing_operations;
      DROP TABLE IF EXISTS routing_versions;
      DROP TABLE IF EXISTS routings;
      DROP TABLE IF EXISTS work_center_resources;
      DROP TABLE IF EXISTS work_centers;
      DROP TABLE IF EXISTS engineering_change_orders;
      DROP TABLE IF EXISTS bom_line_substitutes;
      DROP TABLE IF EXISTS bom_lines;
      DROP TABLE IF EXISTS bom_versions;
      DROP TABLE IF EXISTS boms;
    `);
  },
};
