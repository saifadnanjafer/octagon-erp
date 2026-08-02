// BUILD-09 shop-floor terminals, governed production material requests, and downtime analytics.
'use strict';

const ENTITIES = [
  ['mfg_shopfloor_session', 'محطة أرض المصنع', 'Shop-floor Session'],
  ['mfg_shopfloor_event', 'حدث أرض المصنع', 'Shop-floor Event'],
  ['mfg_material_flow_request', 'طلب تدفق مواد الإنتاج', 'Production Material Flow Request'],
  ['mfg_downtime_event', 'حدث توقف', 'Downtime Event'],
];

const ACTIONS = [
  ['shopfloor:session_open', 'mfg_shopfloor_session', 'shopfloor:operate'],
  ['shopfloor:operator_assign', 'mfg_shopfloor_session', 'shopfloor:assign'],
  ['shopfloor:operation_start', 'mfg_shopfloor_session', 'shopfloor:operate'],
  ['shopfloor:operation_pause', 'mfg_shopfloor_session', 'shopfloor:operate'],
  ['shopfloor:operation_resume', 'mfg_shopfloor_session', 'shopfloor:operate'],
  ['shopfloor:operation_output', 'mfg_shopfloor_session', 'shopfloor:operate'],
  ['shopfloor:operation_complete', 'mfg_shopfloor_session', 'shopfloor:operate'],
  ['shopfloor:operation_acknowledge', 'mfg_shopfloor_session', 'shopfloor:operate'],
  ['shopfloor:operation_handoff', 'mfg_shopfloor_session', 'shopfloor:assign'],
  ['shopfloor:material_request', 'mfg_material_flow_request', 'shopfloor:material:request'],
  ['shopfloor:material_availability', 'mfg_material_flow_request', 'shopfloor:material:request'],
  ['shopfloor:material_approve', 'mfg_material_flow_request', 'shopfloor:material:approve'],
  ['shopfloor:material_request_canonical', 'mfg_material_flow_request', 'shopfloor:material:issue'],
  ['shopfloor:material_acknowledge', 'mfg_material_flow_request', 'shopfloor:material:issue'],
  ['shopfloor:downtime_start', 'mfg_downtime_event', 'shopfloor:downtime:admin'],
  ['shopfloor:downtime_end', 'mfg_downtime_event', 'shopfloor:downtime:admin'],
];

const PERMISSIONS = [
  ['shopfloor:operate', 'shopfloor', 'operate', 0],
  ['shopfloor:assign', 'shopfloor', 'assign', 1],
  ['shopfloor:view', 'shopfloor', 'view', 0],
  ['shopfloor:material:request', 'production_material', 'request', 0],
  ['shopfloor:material:approve', 'production_material', 'approve', 1],
  ['shopfloor:material:issue', 'production_material', 'issue', 1],
  ['shopfloor:downtime:admin', 'downtime', 'admin', 1],
  ['shopfloor:performance:view', 'operational_performance', 'view', 0],
];

export const migration = {
  id: '079_build09_shopfloor_material_performance', owner: 'manufacturing', version: '9.3.0',
  parent: '078_build09_dock_crossdock_traceability', dependsOn: ['078_build09_dock_crossdock_traceability'],
  dialect: ['sqlite'], transactionPolicy: 'required', reversible: true,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS mfg_shopfloor_sessions (
        id TEXT PRIMARY KEY, company_id TEXT NOT NULL, branch_id TEXT, warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
        production_order_id TEXT NOT NULL REFERENCES mfg_production_orders(id),
        work_order_id TEXT NOT NULL REFERENCES mfg_work_orders(id), work_center_id TEXT NOT NULL REFERENCES work_centers(id),
        resource_id TEXT REFERENCES work_center_resources(id), operator_id TEXT, assigned_by TEXT,
        asset_reference TEXT, tool_reference TEXT, shift_code TEXT, handoff_from TEXT, handoff_to TEXT,
        instructions TEXT NOT NULL DEFAULT '', files_json TEXT NOT NULL DEFAULT '[]', notes TEXT NOT NULL DEFAULT '',
        collaboration_json TEXT NOT NULL DEFAULT '{}', planned_quantity REAL,
        produced_quantity REAL NOT NULL DEFAULT 0 CHECK(produced_quantity >= 0),
        rejected_quantity REAL NOT NULL DEFAULT 0 CHECK(rejected_quantity >= 0),
        scrap_quantity REAL NOT NULL DEFAULT 0 CHECK(scrap_quantity >= 0),
        status TEXT NOT NULL CHECK(status IN ('ready','assigned','running','paused','quality_hold','completed','blocked','cancelled','rework','awaiting_canonical')),
        quality_checkpoint_required INTEGER NOT NULL DEFAULT 0 CHECK(quality_checkpoint_required IN (0,1)),
        canonical_action TEXT, canonical_request_json TEXT NOT NULL DEFAULT '{}', canonical_result_id TEXT,
        planned_start_at TEXT, planned_end_at TEXT, actual_start_at TEXT, actual_end_at TEXT,
        created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        idempotency_key TEXT UNIQUE, UNIQUE(company_id,work_order_id)
      );
      CREATE INDEX IF NOT EXISTS idx_shopfloor_queue ON mfg_shopfloor_sessions(company_id,warehouse_id,work_center_id,status);
      CREATE TABLE IF NOT EXISTS mfg_shopfloor_events (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES mfg_shopfloor_sessions(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL, event_type TEXT NOT NULL, from_status TEXT, to_status TEXT,
        quantity REAL, reason_code TEXT, details_json TEXT NOT NULL DEFAULT '{}', actor_id TEXT NOT NULL, occurred_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_shopfloor_timeline ON mfg_shopfloor_events(session_id,occurred_at);
      CREATE TABLE IF NOT EXISTS mfg_material_flow_requests (
        id TEXT PRIMARY KEY, company_id TEXT NOT NULL, branch_id TEXT, warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
        production_order_id TEXT NOT NULL REFERENCES mfg_production_orders(id), work_order_id TEXT REFERENCES mfg_work_orders(id),
        requirement_id TEXT REFERENCES mfg_material_requirements(id), request_type TEXT NOT NULL
          CHECK(request_type IN ('request','reservation','issue','return','substitution','shortage','backflush','production_receipt','co_product','by_product','putaway')),
        product_id TEXT NOT NULL REFERENCES product_variants(id), substitute_product_id TEXT REFERENCES product_variants(id),
        requested_quantity REAL NOT NULL CHECK(requested_quantity > 0), available_quantity REAL,
        approved_quantity REAL CHECK(approved_quantity IS NULL OR approved_quantity >= 0), fulfilled_quantity REAL NOT NULL DEFAULT 0 CHECK(fulfilled_quantity >= 0),
        source_location_id TEXT REFERENCES stock_locations(id), destination_location_id TEXT REFERENCES stock_locations(id),
        lot_id TEXT REFERENCES stock_lots(id), serial_id TEXT REFERENCES stock_serials(id),
        shortage_quantity REAL, partial_allowed INTEGER NOT NULL DEFAULT 1 CHECK(partial_allowed IN (0,1)),
        backflush_policy_supported INTEGER NOT NULL DEFAULT 0 CHECK(backflush_policy_supported IN (0,1)),
        status TEXT NOT NULL CHECK(status IN ('requested','availability_checked','shortage','awaiting_approval','approved','task_created','awaiting_canonical','completed','rejected','cancelled','exception')),
        reason_code TEXT, canonical_action TEXT, canonical_request_json TEXT NOT NULL DEFAULT '{}', canonical_result_id TEXT,
        requested_by TEXT NOT NULL, approved_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        idempotency_key TEXT UNIQUE
      );
      CREATE INDEX IF NOT EXISTS idx_material_flow_queue ON mfg_material_flow_requests(company_id,warehouse_id,status,request_type);
      CREATE TABLE IF NOT EXISTS mfg_downtime_events (
        id TEXT PRIMARY KEY, company_id TEXT NOT NULL, warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
        session_id TEXT NOT NULL REFERENCES mfg_shopfloor_sessions(id) ON DELETE CASCADE,
        work_order_id TEXT NOT NULL REFERENCES mfg_work_orders(id), work_center_id TEXT NOT NULL REFERENCES work_centers(id),
        resource_id TEXT REFERENCES work_center_resources(id), asset_reference TEXT,
        reason_code TEXT NOT NULL, reason_category TEXT NOT NULL CHECK(reason_category IN ('setup','breakdown','material','quality','operator','planned','other')),
        planned INTEGER NOT NULL DEFAULT 0 CHECK(planned IN (0,1)), starts_at TEXT NOT NULL, ends_at TEXT,
        duration_minutes REAL, notes TEXT, recurring_issue INTEGER NOT NULL DEFAULT 0 CHECK(recurring_issue IN (0,1)),
        maintenance_request_json TEXT NOT NULL DEFAULT '{}', maintenance_request_id TEXT,
        status TEXT NOT NULL CHECK(status IN ('open','ended','maintenance_proposed','closed','cancelled')),
        opened_by TEXT NOT NULL, closed_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_downtime_board ON mfg_downtime_events(company_id,warehouse_id,work_center_id,status,starts_at);
    `);
    const stamp = new Date().toISOString();
    const entity = db.prepare(`INSERT INTO platform_entities(id,module_id,storage_owner,primary_key,label_ar,label_en,section,chatter,fields,relations,scope,lifecycle_policy,query_policy,action_policy,customization_policy,history_policy,api_exposed,migration_owner,created_at,updated_at)
      VALUES(?,'operations_manufacturing','platform.manufacturing.shopfloor','id',?,?,'operations',1,'{}','{}','company','governed','scoped','registered','metadata','audit',1,'079_build09_shopfloor_material_performance',?,?) ON CONFLICT(id) DO NOTHING`);
    ENTITIES.forEach(([id, ar, en]) => entity.run(id, ar, en, stamp, stamp));
    const action = db.prepare(`INSERT INTO platform_actions(id,module_id,entity_id,kind,allowed_states,required_permission,required_scope,input_schema,preconditions,transaction_owner,idempotency_policy,sequence_policy,audit_policy,outbox_policy,error_contract,created_at,updated_at)
      VALUES(?,'operations_manufacturing',?,'domain','[]',?,'warehouse','{}','[]','platform_action_executor','required','none','required','required','{}',?,?) ON CONFLICT(id) DO UPDATE SET required_permission=excluded.required_permission,updated_at=excluded.updated_at`);
    ACTIONS.forEach(([id, entityId, permission]) => action.run(id, entityId, permission, stamp, stamp));
    const permission = db.prepare(`INSERT INTO authorization_permissions(id,module_id,kind,resource,action,label_ar,label_en,sensitive,depends_on,deprecated,created_at,updated_at)
      VALUES(?,'operations_manufacturing','action',?,?,?, ?,?,'[]',0,?,?) ON CONFLICT(id) DO UPDATE SET sensitive=excluded.sensitive,updated_at=excluded.updated_at`);
    PERMISSIONS.forEach(([id, resource, verb, sensitive]) => permission.run(id, resource, verb, id, id, sensitive, stamp, stamp));
  },
  down(db) {
    ACTIONS.forEach(([id]) => db.prepare('DELETE FROM platform_actions WHERE id=?').run(id));
    PERMISSIONS.forEach(([id]) => db.prepare('DELETE FROM authorization_permissions WHERE id=?').run(id));
    ENTITIES.forEach(([id]) => db.prepare('DELETE FROM platform_entities WHERE id=?').run(id));
    db.exec('DROP TABLE IF EXISTS mfg_downtime_events; DROP TABLE IF EXISTS mfg_material_flow_requests; DROP TABLE IF EXISTS mfg_shopfloor_events; DROP TABLE IF EXISTS mfg_shopfloor_sessions;');
  },
};
export default migration;
