// BUILD-09 mobile receiving, picking, waves, and governed cycle counting.
'use strict';

const ENTITIES = [
  ['wms_receiving_session', 'جلسة استلام', 'Receiving Session'],
  ['wms_receiving_discrepancy', 'فرق استلام', 'Receiving Discrepancy'],
  ['wms_pick_task', 'مهمة التقاط', 'Pick Task'],
  ['wms_pick_wave', 'موجة التقاط', 'Pick Wave'],
  ['wms_count_plan', 'خطة جرد', 'Count Plan'],
  ['wms_count_session', 'جلسة جرد', 'Count Session'],
];

const ACTIONS = [
  ['wms:receiving_start', 'wms_receiving_session', 'wms:receiving:operate'],
  ['wms:receiving_scan_reference', 'wms_receiving_session', 'wms:receiving:operate'],
  ['wms:receiving_scan_product', 'wms_receiving_session', 'wms:receiving:operate'],
  ['wms:receiving_review', 'wms_receiving_session', 'wms:receiving:operate'],
  ['wms:receiving_discrepancy_approve', 'wms_receiving_discrepancy', 'wms:receiving_discrepancy:approve'],
  ['wms:receiving_request_post', 'wms_receiving_session', 'wms:receiving:post'],
  ['wms:receiving_acknowledge_post', 'wms_receiving_session', 'wms:receiving:post'],
  ['wms:receiving_complete', 'wms_receiving_session', 'wms:receiving:operate'],
  ['wms:pick_task_create', 'wms_pick_task', 'wms:picking:plan'],
  ['wms:pick_task_assign', 'wms_pick_task', 'wms:picking:assign'],
  ['wms:pick_scan_source', 'wms_pick_task', 'wms:picking:operate'],
  ['wms:pick_scan_product', 'wms_pick_task', 'wms:picking:operate'],
  ['wms:pick_confirm', 'wms_pick_task', 'wms:picking:operate'],
  ['wms:pick_stage', 'wms_pick_task', 'wms:picking:operate'],
  ['wms:pick_request_post', 'wms_pick_task', 'wms:picking:post'],
  ['wms:pick_acknowledge_post', 'wms_pick_task', 'wms:picking:post'],
  ['wms:wave_create', 'wms_pick_wave', 'wms:wave:plan'],
  ['wms:wave_calculate', 'wms_pick_wave', 'wms:wave:plan'],
  ['wms:wave_review', 'wms_pick_wave', 'wms:wave:review'],
  ['wms:wave_release', 'wms_pick_wave', 'wms:wave:release'],
  ['wms:wave_cancel', 'wms_pick_wave', 'wms:wave:release'],
  ['wms:wave_complete', 'wms_pick_wave', 'wms:wave:release'],
  ['wms:count_plan_create', 'wms_count_plan', 'wms:count:plan'],
  ['wms:count_session_start', 'wms_count_session', 'wms:count:operate'],
  ['wms:count_line_record', 'wms_count_session', 'wms:count:operate'],
  ['wms:count_submit', 'wms_count_session', 'wms:count:operate'],
  ['wms:count_recount', 'wms_count_session', 'wms:count:approve'],
  ['wms:count_approve_variance', 'wms_count_session', 'wms:count:approve'],
  ['wms:count_request_adjustment', 'wms_count_session', 'wms:count:adjust'],
  ['wms:count_acknowledge_adjustment', 'wms_count_session', 'wms:count:adjust'],
];

const PERMISSIONS = [
  ['wms:receiving:operate', 'receiving', 'operate', 0],
  ['wms:receiving:post', 'receiving', 'post', 1],
  ['wms:receiving_discrepancy:approve', 'receiving_discrepancy', 'approve', 1],
  ['wms:picking:plan', 'picking', 'plan', 0],
  ['wms:picking:assign', 'picking', 'assign', 0],
  ['wms:picking:operate', 'picking', 'operate', 0],
  ['wms:picking:post', 'picking', 'post', 1],
  ['wms:wave:plan', 'wave', 'plan', 0],
  ['wms:wave:review', 'wave', 'review', 1],
  ['wms:wave:release', 'wave', 'release', 1],
  ['wms:count:plan', 'cycle_count', 'plan', 0],
  ['wms:count:operate', 'cycle_count', 'operate', 0],
  ['wms:count:approve', 'cycle_count', 'approve', 1],
  ['wms:count:adjust', 'cycle_count', 'adjust', 1],
  ['wms:mobile:view', 'mobile_wms', 'view', 0],
];

export const migration = {
  id: '077_build09_mobile_execution',
  owner: 'stock_wms',
  version: '9.1.0',
  parent: '076_build09_wms_topology_putaway_replenishment',
  dependsOn: ['076_build09_wms_topology_putaway_replenishment'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  reversible: true,

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS wms_receiving_sessions (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        branch_id TEXT,
        warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
        receipt_type TEXT NOT NULL CHECK(receipt_type IN ('purchase_order','return','intercompany','production_return','controlled_non_po')),
        reference TEXT,
        source_document_id TEXT,
        supplier_id TEXT,
        status TEXT NOT NULL CHECK(status IN ('started','scanning','discrepancy_review','ready','awaiting_canonical','posted','putaway_pending','completed','cancelled','blocked')),
        expected_line_count INTEGER NOT NULL DEFAULT 0,
        scanned_line_count INTEGER NOT NULL DEFAULT 0,
        over_receipt_tolerance REAL NOT NULL DEFAULT 0,
        quarantine_location_id TEXT REFERENCES stock_locations(id),
        canonical_action TEXT NOT NULL DEFAULT 'wms:picking:validate',
        canonical_request_json TEXT NOT NULL DEFAULT '{}',
        canonical_picking_id TEXT,
        label_requests_json TEXT NOT NULL DEFAULT '[]',
        started_by TEXT NOT NULL,
        reviewed_by TEXT,
        posted_by TEXT,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        idempotency_key TEXT UNIQUE
      );
      CREATE INDEX IF NOT EXISTS idx_wms_receiving_queue ON wms_receiving_sessions(company_id,warehouse_id,status,started_at);

      CREATE TABLE IF NOT EXISTS wms_receiving_lines (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES wms_receiving_sessions(id) ON DELETE CASCADE,
        source_line_id TEXT,
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        supplier_barcode TEXT,
        scanned_barcode TEXT,
        uom_id TEXT,
        expected_quantity REAL NOT NULL DEFAULT 0,
        received_quantity REAL NOT NULL CHECK(received_quantity > 0),
        lot_id TEXT,
        lot_code TEXT,
        serial_id TEXT,
        serial_code TEXT,
        manufacture_date TEXT,
        expiry_date TEXT,
        damaged INTEGER NOT NULL DEFAULT 0 CHECK(damaged IN (0,1)),
        quality_required INTEGER NOT NULL DEFAULT 0 CHECK(quality_required IN (0,1)),
        quarantine_required INTEGER NOT NULL DEFAULT 0 CHECK(quarantine_required IN (0,1)),
        destination_location_id TEXT REFERENCES stock_locations(id),
        evidence_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL CHECK(status IN ('scanned','discrepancy','accepted','rejected','awaiting_canonical','posted','putaway_pending','completed')),
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(session_id,product_id,lot_code,serial_code)
      );
      CREATE INDEX IF NOT EXISTS idx_wms_receiving_lines ON wms_receiving_lines(session_id,status,product_id);

      CREATE TABLE IF NOT EXISTS wms_receiving_discrepancies (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES wms_receiving_sessions(id) ON DELETE CASCADE,
        line_id TEXT NOT NULL REFERENCES wms_receiving_lines(id) ON DELETE CASCADE,
        discrepancy_type TEXT NOT NULL CHECK(discrepancy_type IN ('over','under','damage','uom','barcode','quality','expiry','unexpected_product')),
        expected_value TEXT,
        actual_value TEXT,
        reason TEXT,
        status TEXT NOT NULL CHECK(status IN ('open','approved','rejected','resolved')),
        requested_by TEXT NOT NULL,
        approved_by TEXT,
        requested_at TEXT NOT NULL,
        resolved_at TEXT,
        CHECK(approved_by IS NULL OR approved_by <> requested_by)
      );
      CREATE INDEX IF NOT EXISTS idx_wms_receiving_discrepancies ON wms_receiving_discrepancies(session_id,status,discrepancy_type);

      CREATE TABLE IF NOT EXISTS wms_pick_tasks_v2 (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        branch_id TEXT,
        warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
        picking_type TEXT NOT NULL CHECK(picking_type IN ('sales_delivery','internal_transfer','production_issue','service_parts','supplier_return','rma_replacement')),
        source_document_id TEXT NOT NULL,
        source_line_id TEXT,
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        lot_id TEXT,
        serial_id TEXT,
        source_location_id TEXT NOT NULL REFERENCES stock_locations(id),
        staging_location_id TEXT REFERENCES stock_locations(id),
        destination_location_id TEXT NOT NULL REFERENCES stock_locations(id),
        requested_quantity REAL NOT NULL CHECK(requested_quantity > 0),
        picked_quantity REAL NOT NULL DEFAULT 0 CHECK(picked_quantity >= 0),
        short_quantity REAL NOT NULL DEFAULT 0 CHECK(short_quantity >= 0),
        strategy TEXT NOT NULL CHECK(strategy IN ('fifo','fefo','nearest','fixed_bin','lot_priority','serial_specific','manual_override')),
        route_sequence INTEGER NOT NULL DEFAULT 100,
        status TEXT NOT NULL CHECK(status IN ('planned','ready','assigned','source_scanned','product_scanned','picked','short','staged','packed','awaiting_canonical','shipped','completed','blocked','cancelled','exception')),
        assigned_to TEXT,
        source_scan TEXT,
        product_scan TEXT,
        lot_serial_scan TEXT,
        exception_code TEXT,
        exception_reason TEXT,
        substitute_product_id TEXT,
        proof_json TEXT NOT NULL DEFAULT '[]',
        canonical_action TEXT NOT NULL DEFAULT 'stock:move:post',
        canonical_request_json TEXT NOT NULL DEFAULT '{}',
        canonical_result_id TEXT,
        wave_id TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        idempotency_key TEXT UNIQUE
      );
      CREATE INDEX IF NOT EXISTS idx_wms_pick_queue ON wms_pick_tasks_v2(company_id,warehouse_id,status,assigned_to,route_sequence);

      CREATE TABLE IF NOT EXISTS wms_pick_waves (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        branch_id TEXT,
        warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
        name TEXT NOT NULL,
        wave_type TEXT NOT NULL CHECK(wave_type IN ('wave','batch','cluster','zone')),
        grouping_strategy TEXT NOT NULL CHECK(grouping_strategy IN ('carrier','route','customer','zone','product','manual')),
        criteria_json TEXT NOT NULL DEFAULT '{}',
        priority INTEGER NOT NULL DEFAULT 100,
        cutoff_at TEXT,
        staging_location_id TEXT REFERENCES stock_locations(id),
        status TEXT NOT NULL CHECK(status IN ('draft','calculated','reviewed','released','active','partially_completed','completed','cancelled','blocked','exception')),
        operator_id TEXT,
        task_count INTEGER NOT NULL DEFAULT 0,
        completed_task_count INTEGER NOT NULL DEFAULT 0,
        exception_count INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL,
        reviewed_by TEXT,
        released_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        idempotency_key TEXT UNIQUE
      );
      CREATE INDEX IF NOT EXISTS idx_wms_wave_queue ON wms_pick_waves(company_id,warehouse_id,status,priority,cutoff_at);
      CREATE TABLE IF NOT EXISTS wms_pick_wave_tasks (
        wave_id TEXT NOT NULL REFERENCES wms_pick_waves(id) ON DELETE CASCADE,
        pick_task_id TEXT NOT NULL UNIQUE REFERENCES wms_pick_tasks_v2(id),
        zone_id TEXT REFERENCES wms_zones(id),
        sequence INTEGER NOT NULL,
        consolidated_group TEXT,
        PRIMARY KEY(wave_id,pick_task_id)
      );

      CREATE TABLE IF NOT EXISTS wms_count_plans_v2 (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
        name TEXT NOT NULL,
        count_scope TEXT NOT NULL CHECK(count_scope IN ('location','product','zone','abc','ad_hoc')),
        zone_id TEXT REFERENCES wms_zones(id),
        location_id TEXT REFERENCES stock_locations(id),
        product_id TEXT REFERENCES product_variants(id),
        abc_class TEXT CHECK(abc_class IN ('A','B','C') OR abc_class IS NULL),
        frequency_days INTEGER NOT NULL DEFAULT 30 CHECK(frequency_days > 0),
        tolerance_quantity REAL NOT NULL DEFAULT 0,
        tolerance_percent REAL NOT NULL DEFAULT 0,
        blind_count INTEGER NOT NULL DEFAULT 1 CHECK(blind_count IN (0,1)),
        directed_count INTEGER NOT NULL DEFAULT 1 CHECK(directed_count IN (0,1)),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
        next_count_date TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_wms_count_plans ON wms_count_plans_v2(company_id,warehouse_id,is_active,next_count_date);

      CREATE TABLE IF NOT EXISTS wms_count_sessions_v2 (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        branch_id TEXT,
        warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
        plan_id TEXT REFERENCES wms_count_plans_v2(id),
        session_type TEXT NOT NULL CHECK(session_type IN ('planned','directed','ad_hoc','recount')),
        status TEXT NOT NULL CHECK(status IN ('planned','assigned','counting','submitted','variance_review','recount','approved','adjustment_requested','awaiting_canonical','closed','cancelled','blocked')),
        assigned_to TEXT,
        blind_count INTEGER NOT NULL DEFAULT 1,
        snapshot_at TEXT NOT NULL,
        freeze_reference TEXT,
        recount_of_id TEXT REFERENCES wms_count_sessions_v2(id),
        variance_count INTEGER NOT NULL DEFAULT 0,
        adjustment_request_json TEXT NOT NULL DEFAULT '{}',
        canonical_result_ids_json TEXT NOT NULL DEFAULT '[]',
        created_by TEXT NOT NULL,
        approved_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        closed_at TEXT,
        idempotency_key TEXT UNIQUE
      );
      CREATE INDEX IF NOT EXISTS idx_wms_count_sessions ON wms_count_sessions_v2(company_id,warehouse_id,status,assigned_to);

      CREATE TABLE IF NOT EXISTS wms_count_lines_v2 (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES wms_count_sessions_v2(id) ON DELETE CASCADE,
        location_id TEXT NOT NULL REFERENCES stock_locations(id),
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        lot_id TEXT,
        serial_id TEXT,
        theoretical_quantity REAL NOT NULL,
        counted_quantity REAL,
        variance_quantity REAL,
        variance_percent REAL,
        tolerance_exceeded INTEGER NOT NULL DEFAULT 0 CHECK(tolerance_exceeded IN (0,1)),
        discrepancy_reason TEXT,
        counted_by TEXT,
        counted_at TEXT,
        status TEXT NOT NULL CHECK(status IN ('pending','counted','variance','recount','approved','adjustment_requested','closed')),
        UNIQUE(session_id,location_id,product_id,lot_id,serial_id)
      );
      CREATE INDEX IF NOT EXISTS idx_wms_count_lines ON wms_count_lines_v2(session_id,status,location_id,product_id);
    `);

    const stamp = new Date().toISOString();
    const entity = db.prepare(`INSERT INTO platform_entities(id,module_id,storage_owner,primary_key,label_ar,label_en,section,chatter,fields,relations,scope,lifecycle_policy,query_policy,action_policy,customization_policy,history_policy,api_exposed,migration_owner,created_at,updated_at)
      VALUES(?,'stock_wms','platform.wms.mobile','id',?,?,'wms',0,'{}','{}','company','governed','scoped','registered','metadata','audit',1,'077_build09_mobile_execution',?,?) ON CONFLICT(id) DO NOTHING`);
    ENTITIES.forEach(([id, ar, en]) => entity.run(id, ar, en, stamp, stamp));
    const action = db.prepare(`INSERT INTO platform_actions(id,module_id,entity_id,kind,allowed_states,required_permission,required_scope,input_schema,preconditions,transaction_owner,idempotency_policy,sequence_policy,audit_policy,outbox_policy,error_contract,created_at,updated_at)
      VALUES(?,'stock_wms',?,'domain','[]',?,'warehouse','{}','[]','platform_action_executor','required','none','required','required','{}',?,?) ON CONFLICT(id) DO UPDATE SET required_permission=excluded.required_permission,updated_at=excluded.updated_at`);
    ACTIONS.forEach(([id, entityId, permission]) => action.run(id, entityId, permission, stamp, stamp));
    const permission = db.prepare(`INSERT INTO authorization_permissions(id,module_id,kind,resource,action,label_ar,label_en,sensitive,depends_on,deprecated,created_at,updated_at)
      VALUES(?,'stock_wms','action',?,?,?,? ,?,'[]',0,?,?) ON CONFLICT(id) DO UPDATE SET sensitive=excluded.sensitive,updated_at=excluded.updated_at`);
    PERMISSIONS.forEach(([id, resource, verb, sensitive]) => permission.run(id, resource, verb, id, id, sensitive, stamp, stamp));
  },

  down(db) {
    const actionIds = ACTIONS.map(([id]) => id);
    const permissionIds = PERMISSIONS.map(([id]) => id);
    const entityIds = ENTITIES.map(([id]) => id);
    const remove = (table, ids) => ids.forEach((id) => db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id));
    remove('platform_actions', actionIds);
    remove('authorization_permissions', permissionIds);
    remove('platform_entities', entityIds);
    db.exec(`
      DROP TABLE IF EXISTS wms_count_lines_v2;
      DROP TABLE IF EXISTS wms_count_sessions_v2;
      DROP TABLE IF EXISTS wms_count_plans_v2;
      DROP TABLE IF EXISTS wms_pick_wave_tasks;
      DROP TABLE IF EXISTS wms_pick_waves;
      DROP TABLE IF EXISTS wms_pick_tasks_v2;
      DROP TABLE IF EXISTS wms_receiving_discrepancies;
      DROP TABLE IF EXISTS wms_receiving_lines;
      DROP TABLE IF EXISTS wms_receiving_sessions;
    `);
  },
};

export default migration;
