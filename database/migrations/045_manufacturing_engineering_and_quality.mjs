// 045_manufacturing_engineering_and_quality — Phase 05 Wave A
//
// Source composition (donor selection recorded in
// docs/evidence/phase-05/source-selection-ledger.md):
// - Odoo 19 Community `addons/mrp` (LGPL-3, clean-room reference only — no code
//   copied): BOM/routing/work-centre separation, phantom BOM explosion, the
//   production-location accounting pattern (Dr WIP / Cr Stock on issue,
//   Dr Inventory / Cr WIP on output), and the work-order state vocabulary.
// - ERPNext `erpnext/manufacturing` (GPL-3, clean-room reference only): the
//   "operation snapshot on the order" idea — a released order keeps the exact
//   BOM/routing version it was released against.
// - Octagon Phase 04 `043_phase04_canonical_registry_and_lineage` supplied the
//   registration idiom (modules / entities / actions / error contract) that this
//   migration follows verbatim in shape.
//
// Authority rules enforced by this schema:
//   - Manufacturing owns NO stock balance. Every material movement is a Phase 04
//     `stock_moves` row; `production_material_consumptions` is a lineage link,
//     not a ledger.
//   - Manufacturing owns NO GL. Every posting is a Phase 03 finance document
//     reached through `postSourceFact` / the stock accounting port;
//     `production_cost_facts` records what was posted, it does not post.
//   - Manufacturing owns NO task table. Execution coordination uses Phase 04
//     `work_items` via `production_work_orders.work_item_id`.
//   - Account numbers are never hard-coded: `manufacturing_account_mappings` is
//     the company-scoped Control Plane row every posting path reads.

const MODULES = [
  ['manufacturing_core', 'Manufacturing', ['boms', 'routings', 'work_centers', 'production_orders', 'work_orders', 'costing']],
  ['quality_core', 'Quality', ['quality_plans', 'inspections', 'nonconformances', 'capa']],
];

const ENTITIES = [
  ['work_center', 'manufacturing_core', 'platform.manufacturing', 'Work Center'],
  ['bom', 'manufacturing_core', 'platform.manufacturing', 'Bill of Material'],
  ['routing', 'manufacturing_core', 'platform.manufacturing', 'Routing'],
  ['engineering_change', 'manufacturing_core', 'platform.manufacturing', 'Engineering Change'],
  ['production_order', 'manufacturing_core', 'platform.manufacturing', 'Manufacturing Order'],
  ['production_work_order', 'manufacturing_core', 'platform.manufacturing', 'Work Order'],
  ['quality_plan', 'quality_core', 'platform.quality', 'Quality Plan'],
  ['quality_inspection', 'quality_core', 'platform.quality', 'Quality Inspection'],
  ['quality_nonconformance', 'quality_core', 'platform.quality', 'Nonconformance'],
];

// [id, module, entity, required_permission, required input fields]
const ACTIONS = [
  ['manufacturing:work_center:create', 'manufacturing_core', 'work_center', 'manufacturing:work_center:write', ['name', 'code']],
  ['manufacturing:account_mapping:set', 'manufacturing_core', 'work_center', 'manufacturing:config:write', ['wip_account_id']],
  ['manufacturing:bom:create', 'manufacturing_core', 'bom', 'manufacturing:bom:write', ['product_id', 'quantity']],
  ['manufacturing:bom:revise', 'manufacturing_core', 'bom', 'manufacturing:bom:write', ['bom_id']],
  ['manufacturing:bom:approve', 'manufacturing_core', 'bom', 'manufacturing:bom:approve', ['bom_id']],
  ['manufacturing:bom:update_lines', 'manufacturing_core', 'bom', 'manufacturing:bom:write', ['bom_id', 'lines']],
  ['manufacturing:routing:create', 'manufacturing_core', 'routing', 'manufacturing:routing:write', ['name']],
  ['manufacturing:routing:approve', 'manufacturing_core', 'routing', 'manufacturing:routing:approve', ['routing_id']],
  ['manufacturing:engineering_change:create', 'manufacturing_core', 'engineering_change', 'manufacturing:bom:write', ['title']],
  ['manufacturing:engineering_change:approve', 'manufacturing_core', 'engineering_change', 'manufacturing:bom:approve', ['change_id']],
  ['manufacturing:order:create', 'manufacturing_core', 'production_order', 'manufacturing:order:write', ['product_id', 'planned_quantity']],
  ['manufacturing:order:approve', 'manufacturing_core', 'production_order', 'manufacturing:order:approve', ['order_id']],
  ['manufacturing:order:release', 'manufacturing_core', 'production_order', 'manufacturing:order:release', ['order_id']],
  ['manufacturing:order:cancel', 'manufacturing_core', 'production_order', 'manufacturing:order:release', ['order_id']],
  ['manufacturing:order:close', 'manufacturing_core', 'production_order', 'manufacturing:order:release', ['order_id']],
  ['manufacturing:material:issue', 'manufacturing_core', 'production_order', 'manufacturing:material:write', ['order_id', 'product_id', 'quantity']],
  ['manufacturing:material:return', 'manufacturing_core', 'production_order', 'manufacturing:material:write', ['order_id', 'product_id', 'quantity']],
  ['manufacturing:material:scrap', 'manufacturing_core', 'production_order', 'manufacturing:material:write', ['order_id', 'product_id', 'quantity']],
  ['manufacturing:order:complete', 'manufacturing_core', 'production_order', 'manufacturing:order:complete', ['order_id', 'quantity']],
  ['manufacturing:work_order:start', 'manufacturing_core', 'production_work_order', 'manufacturing:work_order:write', ['work_order_id']],
  ['manufacturing:work_order:pause', 'manufacturing_core', 'production_work_order', 'manufacturing:work_order:write', ['work_order_id']],
  ['manufacturing:work_order:resume', 'manufacturing_core', 'production_work_order', 'manufacturing:work_order:write', ['work_order_id']],
  ['manufacturing:work_order:hold', 'manufacturing_core', 'production_work_order', 'manufacturing:work_order:write', ['work_order_id']],
  ['manufacturing:work_order:complete', 'manufacturing_core', 'production_work_order', 'manufacturing:work_order:write', ['work_order_id']],
  ['manufacturing:work_order:time_entry', 'manufacturing_core', 'production_work_order', 'manufacturing:work_order:write', ['work_order_id', 'entry_type', 'duration_minutes']],
  ['quality:plan:create', 'quality_core', 'quality_plan', 'quality:plan:write', ['name', 'trigger_event']],
  ['quality:inspection:create', 'quality_core', 'quality_inspection', 'quality:inspection:write', ['plan_id']],
  ['quality:inspection:record', 'quality_core', 'quality_inspection', 'quality:inspection:write', ['inspection_id', 'measurements']],
  ['quality:inspection:decide', 'quality_core', 'quality_inspection', 'quality:inspection:decide', ['inspection_id', 'decision']],
  ['quality:nonconformance:create', 'quality_core', 'quality_nonconformance', 'quality:inspection:write', ['title']],
  ['quality:nonconformance:resolve', 'quality_core', 'quality_nonconformance', 'quality:inspection:decide', ['nonconformance_id']],
  ['quality:deviation:approve', 'quality_core', 'quality_inspection', 'quality:deviation:approve', ['inspection_id', 'reason']],
];

export const migration = {
  id: '045_manufacturing_engineering_and_quality',
  owner: 'manufacturing_core',
  version: '1.24.0',
  parent: '044_opening_stock_cutover_and_equity_coa',
  dependsOn: ['044_opening_stock_cutover_and_equity_coa'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Phase 05 Wave A — canonical manufacturing, engineering and quality schema; clean-room references: Odoo 19 addons/mrp, ERPNext manufacturing; registration idiom from Octagon migration 043',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS manufacturing_account_mappings (
        company_id TEXT PRIMARY KEY,
        wip_account_id TEXT NOT NULL REFERENCES finance_accounts(id),
        labor_absorption_account_id TEXT REFERENCES finance_accounts(id),
        overhead_absorption_account_id TEXT REFERENCES finance_accounts(id),
        scrap_account_id TEXT REFERENCES finance_accounts(id),
        variance_account_id TEXT REFERENCES finance_accounts(id),
        subcontract_stock_account_id TEXT REFERENCES finance_accounts(id),
        subcontract_expense_account_id TEXT REFERENCES finance_accounts(id),
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS work_centers (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        branch_id TEXT,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        resource_type TEXT NOT NULL DEFAULT 'machine' CHECK(resource_type IN ('machine','manual','line','cell','subcontractor')),
        asset_id TEXT,
        location_id TEXT REFERENCES stock_locations(id),
        capacity_per_hour REAL NOT NULL DEFAULT 1.0 CHECK(capacity_per_hour > 0),
        efficiency_percent REAL NOT NULL DEFAULT 100.0 CHECK(efficiency_percent > 0),
        labor_cost_per_hour REAL NOT NULL DEFAULT 0 CHECK(labor_cost_per_hour >= 0),
        machine_cost_per_hour REAL NOT NULL DEFAULT 0 CHECK(machine_cost_per_hour >= 0),
        overhead_cost_per_hour REAL NOT NULL DEFAULT 0 CHECK(overhead_cost_per_hour >= 0),
        currency TEXT NOT NULL DEFAULT 'IQD',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, code)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS work_center_calendars (
        id TEXT PRIMARY KEY,
        work_center_id TEXT NOT NULL REFERENCES work_centers(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
        start_minute INTEGER NOT NULL CHECK(start_minute BETWEEN 0 AND 1440),
        end_minute INTEGER NOT NULL CHECK(end_minute BETWEEN 0 AND 1440),
        created_at TEXT NOT NULL,
        UNIQUE(work_center_id, weekday, start_minute)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS bom_headers (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        code TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
        revision_of_id TEXT REFERENCES bom_headers(id),
        bom_type TEXT NOT NULL DEFAULT 'normal' CHECK(bom_type IN ('normal','phantom','subcontract','configurable')),
        quantity REAL NOT NULL CHECK(quantity > 0),
        uom_id TEXT REFERENCES uoms(id),
        routing_id TEXT,
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','superseded','obsolete')),
        effective_from TEXT,
        effective_to TEXT,
        scrap_percent REAL NOT NULL DEFAULT 0 CHECK(scrap_percent >= 0 AND scrap_percent < 100),
        yield_percent REAL NOT NULL DEFAULT 100 CHECK(yield_percent > 0),
        engineering_change_id TEXT,
        attachments_json TEXT NOT NULL DEFAULT '[]',
        approved_by TEXT,
        approved_at TEXT,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, code, version)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS bom_lines (
        id TEXT PRIMARY KEY,
        bom_id TEXT NOT NULL REFERENCES bom_headers(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        sequence INTEGER NOT NULL DEFAULT 10,
        line_type TEXT NOT NULL DEFAULT 'component' CHECK(line_type IN ('component','by_product','co_product')),
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        quantity REAL NOT NULL CHECK(quantity > 0),
        uom_id TEXT REFERENCES uoms(id),
        scrap_percent REAL NOT NULL DEFAULT 0 CHECK(scrap_percent >= 0 AND scrap_percent < 100),
        operation_ref TEXT,
        is_phantom INTEGER NOT NULL DEFAULT 0,
        substitute_of_line_id TEXT REFERENCES bom_lines(id),
        cost_share_percent REAL NOT NULL DEFAULT 0 CHECK(cost_share_percent >= 0),
        notes TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_bom_lines_bom ON bom_lines(bom_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_bom_headers_product ON bom_headers(company_id, product_id, status);

      CREATE TABLE IF NOT EXISTS routings (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
        revision_of_id TEXT REFERENCES routings(id),
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','superseded','obsolete')),
        effective_from TEXT,
        effective_to TEXT,
        engineering_change_id TEXT,
        approved_by TEXT,
        approved_at TEXT,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, code, version)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS routing_operations (
        id TEXT PRIMARY KEY,
        routing_id TEXT NOT NULL REFERENCES routings(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        sequence INTEGER NOT NULL DEFAULT 10,
        name TEXT NOT NULL,
        work_center_id TEXT REFERENCES work_centers(id),
        skill_requirement TEXT,
        setup_minutes REAL NOT NULL DEFAULT 0 CHECK(setup_minutes >= 0),
        run_minutes_per_unit REAL NOT NULL DEFAULT 0 CHECK(run_minutes_per_unit >= 0),
        cleanup_minutes REAL NOT NULL DEFAULT 0 CHECK(cleanup_minutes >= 0),
        queue_minutes REAL NOT NULL DEFAULT 0 CHECK(queue_minutes >= 0),
        move_minutes REAL NOT NULL DEFAULT 0 CHECK(move_minutes >= 0),
        is_subcontracted INTEGER NOT NULL DEFAULT 0,
        subcontractor_party_id TEXT REFERENCES parties(id),
        quality_plan_id TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(routing_id, sequence)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS work_instructions (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        routing_operation_id TEXT REFERENCES routing_operations(id) ON DELETE CASCADE,
        instruction_type TEXT NOT NULL DEFAULT 'work' CHECK(instruction_type IN ('work','safety','drawing','setup')),
        title TEXT NOT NULL,
        body TEXT,
        attachment_ref TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS engineering_changes (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        reference TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','rejected','applied')),
        effective_from TEXT,
        requested_by TEXT NOT NULL,
        approved_by TEXT,
        approved_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, reference)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS production_orders (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        branch_id TEXT,
        reference TEXT NOT NULL,
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        uom_id TEXT REFERENCES uoms(id),
        bom_id TEXT REFERENCES bom_headers(id),
        bom_version INTEGER,
        routing_id TEXT REFERENCES routings(id),
        routing_version INTEGER,
        planned_quantity REAL NOT NULL CHECK(planned_quantity > 0),
        completed_quantity REAL NOT NULL DEFAULT 0 CHECK(completed_quantity >= 0),
        rejected_quantity REAL NOT NULL DEFAULT 0 CHECK(rejected_quantity >= 0),
        warehouse_id TEXT REFERENCES warehouses(id),
        source_location_id TEXT REFERENCES stock_locations(id),
        production_location_id TEXT REFERENCES stock_locations(id),
        finished_location_id TEXT REFERENCES stock_locations(id),
        state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','planned','approved','released','in_progress','partially_completed','completed','closed','cancelled')),
        priority INTEGER NOT NULL DEFAULT 10,
        scheduled_start TEXT,
        scheduled_end TEXT,
        actual_start TEXT,
        actual_end TEXT,
        demand_source_type TEXT,
        demand_source_id TEXT,
        project_id TEXT,
        sale_order_id TEXT REFERENCES sale_orders(id),
        planning_proposal_id TEXT,
        approved_by TEXT,
        approved_at TEXT,
        released_by TEXT,
        released_at TEXT,
        cancelled_reason TEXT,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        UNIQUE(company_id, reference)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_production_orders_state ON production_orders(company_id, state);
      CREATE INDEX IF NOT EXISTS idx_production_orders_project ON production_orders(company_id, project_id);

      CREATE TABLE IF NOT EXISTS production_order_materials (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        bom_line_id TEXT REFERENCES bom_lines(id),
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        uom_id TEXT REFERENCES uoms(id),
        required_quantity REAL NOT NULL CHECK(required_quantity > 0),
        issued_quantity REAL NOT NULL DEFAULT 0 CHECK(issued_quantity >= 0),
        returned_quantity REAL NOT NULL DEFAULT 0 CHECK(returned_quantity >= 0),
        scrapped_quantity REAL NOT NULL DEFAULT 0 CHECK(scrapped_quantity >= 0),
        reservation_id TEXT REFERENCES stock_reservations(id),
        shortage_quantity REAL NOT NULL DEFAULT 0 CHECK(shortage_quantity >= 0),
        backflush INTEGER NOT NULL DEFAULT 0,
        operation_ref TEXT,
        bom_path TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(order_id, product_id, bom_path)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS production_order_operations (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        routing_operation_id TEXT REFERENCES routing_operations(id),
        sequence INTEGER NOT NULL,
        name TEXT NOT NULL,
        work_center_id TEXT REFERENCES work_centers(id),
        planned_setup_minutes REAL NOT NULL DEFAULT 0,
        planned_run_minutes REAL NOT NULL DEFAULT 0,
        is_subcontracted INTEGER NOT NULL DEFAULT 0,
        subcontractor_party_id TEXT REFERENCES parties(id),
        quality_plan_id TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(order_id, sequence)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS production_work_orders (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
        order_operation_id TEXT NOT NULL REFERENCES production_order_operations(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        work_item_id TEXT REFERENCES work_items(id),
        work_center_id TEXT REFERENCES work_centers(id),
        operator_user_id TEXT,
        sequence INTEGER NOT NULL,
        state TEXT NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','waiting_material','waiting_approval','scheduled','in_progress','paused','quality_hold','completed','cancelled')),
        planned_start TEXT,
        planned_end TEXT,
        actual_start TEXT,
        actual_end TEXT,
        output_quantity REAL NOT NULL DEFAULT 0 CHECK(output_quantity >= 0),
        scrap_quantity REAL NOT NULL DEFAULT 0 CHECK(scrap_quantity >= 0),
        rework_quantity REAL NOT NULL DEFAULT 0 CHECK(rework_quantity >= 0),
        blocking_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        UNIQUE(order_id, sequence)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS production_work_order_events (
        id TEXT PRIMARY KEY,
        work_order_id TEXT NOT NULL REFERENCES production_work_orders(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        event_type TEXT NOT NULL CHECK(event_type IN ('start','pause','resume','complete','cancel','quality_hold','quality_release','downtime','block','unblock')),
        reason TEXT,
        actor_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS production_time_entries (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        order_id TEXT NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
        work_order_id TEXT REFERENCES production_work_orders(id) ON DELETE CASCADE,
        entry_type TEXT NOT NULL CHECK(entry_type IN ('setup','labor','machine','downtime','rework')),
        work_center_id TEXT REFERENCES work_centers(id),
        operator_ref TEXT,
        duration_minutes REAL NOT NULL CHECK(duration_minutes > 0),
        rate_per_hour REAL NOT NULL DEFAULT 0 CHECK(rate_per_hour >= 0),
        amount REAL NOT NULL DEFAULT 0 CHECK(amount >= 0),
        currency TEXT NOT NULL DEFAULT 'IQD',
        cost_fact_id TEXT,
        recorded_by TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS production_material_consumptions (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        order_id TEXT NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
        order_material_id TEXT REFERENCES production_order_materials(id),
        work_order_id TEXT REFERENCES production_work_orders(id),
        stock_move_id TEXT NOT NULL REFERENCES stock_moves(id),
        movement_type TEXT NOT NULL CHECK(movement_type IN ('issue','return','scrap','substitution','subcontract_transfer','subcontract_return')),
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        quantity REAL NOT NULL CHECK(quantity > 0),
        value REAL NOT NULL DEFAULT 0,
        finance_document_id TEXT REFERENCES finance_documents(id),
        created_at TEXT NOT NULL,
        UNIQUE(stock_move_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS production_outputs (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        order_id TEXT NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
        stock_move_id TEXT NOT NULL REFERENCES stock_moves(id),
        output_type TEXT NOT NULL CHECK(output_type IN ('finished','by_product','co_product','rework')),
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        quantity REAL NOT NULL CHECK(quantity > 0),
        unit_cost REAL NOT NULL DEFAULT 0,
        value REAL NOT NULL DEFAULT 0,
        finance_document_id TEXT REFERENCES finance_documents(id),
        quality_inspection_id TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(stock_move_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS production_cost_facts (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        order_id TEXT NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
        work_order_id TEXT REFERENCES production_work_orders(id),
        cost_type TEXT NOT NULL CHECK(cost_type IN ('material','labor','machine','overhead','setup','subcontract','scrap','rework','by_product_credit','variance','finished_goods')),
        direction TEXT NOT NULL CHECK(direction IN ('debit_wip','credit_wip')),
        amount REAL NOT NULL CHECK(amount >= 0),
        currency TEXT NOT NULL DEFAULT 'IQD',
        quantity REAL NOT NULL DEFAULT 0,
        finance_document_id TEXT REFERENCES finance_documents(id),
        source_reference TEXT,
        project_id TEXT,
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_production_cost_facts_order ON production_cost_facts(company_id, order_id, cost_type);

      CREATE TABLE IF NOT EXISTS quality_plans (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        trigger_event TEXT NOT NULL CHECK(trigger_event IN ('receipt','operation','production_completion','delivery','maintenance','asset_inspection','supplier_evaluation','customer_complaint')),
        product_id TEXT REFERENCES product_variants(id),
        work_center_id TEXT REFERENCES work_centers(id),
        is_mandatory INTEGER NOT NULL DEFAULT 1,
        sample_size REAL NOT NULL DEFAULT 1 CHECK(sample_size > 0),
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        UNIQUE(company_id, code)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS quality_plan_points (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES quality_plans(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        sequence INTEGER NOT NULL DEFAULT 10,
        characteristic TEXT NOT NULL,
        measurement_type TEXT NOT NULL DEFAULT 'numeric' CHECK(measurement_type IN ('numeric','boolean','text','visual')),
        uom_id TEXT REFERENCES uoms(id),
        target_value REAL,
        min_value REAL,
        max_value REAL,
        expected_text TEXT,
        is_critical INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        UNIQUE(plan_id, sequence)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS quality_inspections (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        plan_id TEXT NOT NULL REFERENCES quality_plans(id),
        reference TEXT NOT NULL,
        subject_type TEXT NOT NULL CHECK(subject_type IN ('production_order','work_order','stock_move','purchase_receipt','delivery','asset','maintenance_order','supplier','customer_complaint')),
        subject_id TEXT NOT NULL,
        product_id TEXT REFERENCES product_variants(id),
        sample_quantity REAL NOT NULL DEFAULT 1 CHECK(sample_quantity > 0),
        state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','in_progress','passed','failed','conditionally_passed','cancelled')),
        decided_by TEXT,
        decided_at TEXT,
        deviation_approved_by TEXT,
        deviation_reason TEXT,
        blocks_downstream INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, reference)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_quality_inspections_subject ON quality_inspections(company_id, subject_type, subject_id);

      CREATE TABLE IF NOT EXISTS quality_inspection_measurements (
        id TEXT PRIMARY KEY,
        inspection_id TEXT NOT NULL REFERENCES quality_inspections(id) ON DELETE CASCADE,
        plan_point_id TEXT NOT NULL REFERENCES quality_plan_points(id),
        company_id TEXT NOT NULL,
        numeric_value REAL,
        text_value TEXT,
        passed INTEGER NOT NULL DEFAULT 0,
        recorded_by TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        UNIQUE(inspection_id, plan_point_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS quality_nonconformances (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        reference TEXT NOT NULL,
        inspection_id TEXT REFERENCES quality_inspections(id),
        title TEXT NOT NULL,
        description TEXT,
        severity TEXT NOT NULL DEFAULT 'medium' CHECK(severity IN ('low','medium','high','critical')),
        defect_code TEXT,
        root_cause TEXT,
        corrective_action TEXT,
        preventive_action TEXT,
        disposition TEXT CHECK(disposition IN ('rework','scrap','use_as_is','return_to_supplier','regrade')),
        supplier_party_id TEXT REFERENCES parties(id),
        work_item_id TEXT REFERENCES work_items(id),
        state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','investigating','action_pending','resolved','closed')),
        opened_at TEXT NOT NULL,
        resolved_at TEXT,
        created_by TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, reference)
      ) STRICT;
    `);

    registerCatalogue(db);
  },

  down(db) {
    const deleteAction = db.prepare('DELETE FROM platform_actions WHERE id = ?');
    for (const [id] of ACTIONS) deleteAction.run(id);
    const deleteEntity = db.prepare('DELETE FROM platform_entities WHERE id = ?');
    for (const [id] of ENTITIES) deleteEntity.run(id);
    const deleteModule = db.prepare('DELETE FROM platform_modules WHERE id = ?');
    for (const [id] of MODULES.slice().reverse()) deleteModule.run(id);

    db.exec(`
      DROP TABLE IF EXISTS quality_nonconformances;
      DROP TABLE IF EXISTS quality_inspection_measurements;
      DROP TABLE IF EXISTS quality_inspections;
      DROP TABLE IF EXISTS quality_plan_points;
      DROP TABLE IF EXISTS quality_plans;
      DROP TABLE IF EXISTS production_cost_facts;
      DROP TABLE IF EXISTS production_outputs;
      DROP TABLE IF EXISTS production_material_consumptions;
      DROP TABLE IF EXISTS production_time_entries;
      DROP TABLE IF EXISTS production_work_order_events;
      DROP TABLE IF EXISTS production_work_orders;
      DROP TABLE IF EXISTS production_order_operations;
      DROP TABLE IF EXISTS production_order_materials;
      DROP TABLE IF EXISTS production_orders;
      DROP TABLE IF EXISTS engineering_changes;
      DROP TABLE IF EXISTS work_instructions;
      DROP TABLE IF EXISTS routing_operations;
      DROP TABLE IF EXISTS routings;
      DROP TABLE IF EXISTS bom_lines;
      DROP TABLE IF EXISTS bom_headers;
      DROP TABLE IF EXISTS work_center_calendars;
      DROP TABLE IF EXISTS work_centers;
      DROP TABLE IF EXISTS manufacturing_account_mappings;
    `);
  },
};

function registerCatalogue(db) {
  const now = new Date().toISOString();
  const insertModule = db.prepare(`
    INSERT INTO platform_modules (
      id, name, version, status, kind, owner, dependencies, optional_dependencies,
      capabilities, migrations, settings, created_at, updated_at
    ) VALUES (?, ?, '1.24.0', 'enabled', 'standard', 'octagon', ?, '[]', ?, ?, '[]', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      version = excluded.version,
      status = excluded.status,
      capabilities = excluded.capabilities,
      migrations = excluded.migrations,
      updated_at = excluded.updated_at
  `);
  for (const [id, name, capabilities] of MODULES) {
    insertModule.run(
      id, name,
      JSON.stringify(['platform_kernel']),
      JSON.stringify(capabilities),
      JSON.stringify(['045_manufacturing_engineering_and_quality']),
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

  const errorContract = JSON.stringify({
    envelope: 'stable',
    rollback: 'business mutation, stock consequence, finance consequence, audit, outbox and idempotency are atomic',
    codes: [
      'INPUT_MISSING_FIELD', 'IDEMPOTENCY_KEY_REQUIRED', 'UNTRUSTED_ACTION_SCOPE',
      'PRECONDITION_FAILED', 'MANUFACTURING_STATE_INVALID', 'MANUFACTURING_ACCOUNT_MAPPING_MISSING',
      'QUALITY_HOLD_ACTIVE',
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
      module_id = excluded.module_id,
      entity_id = excluded.entity_id,
      required_permission = excluded.required_permission,
      input_schema = excluded.input_schema,
      reversal_action = excluded.reversal_action,
      error_contract = excluded.error_contract,
      updated_at = excluded.updated_at
  `);
  const reversals = {
    'manufacturing:material:issue': 'manufacturing:material:return',
    'manufacturing:order:release': 'manufacturing:order:cancel',
    'manufacturing:order:create': 'manufacturing:order:cancel',
  };
  for (const [id, moduleId, entityId, permission, required] of ACTIONS) {
    insertAction.run(
      id, moduleId, entityId, permission,
      JSON.stringify({ type: 'object', required }),
      reversals[id] || null,
      errorContract, now, now,
    );
  }
}
