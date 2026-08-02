// BUILD-09 dock, staging, cross-dock, and traceability for original Octagon.
'use strict';

const ENTITIES = [
  ['wms_dock', 'رصيف مستودع', 'Warehouse Dock'],
  ['wms_dock_appointment', 'موعد رصيف', 'Dock Appointment'],
  ['wms_staging_allocation', 'تخصيص تجهيز', 'Staging Allocation'],
  ['wms_crossdock_match', 'مطابقة عبور مباشر', 'Cross-dock Match'],
  ['wms_trace_profile', 'ملف تتبع', 'Trace Profile'],
  ['wms_recall_case', 'حالة سحب', 'Recall Case'],
];

const ACTIONS = [
  ['wms:dock_create', 'wms_dock', 'wms:dock:admin'],
  ['wms:dock_appointment_create', 'wms_dock_appointment', 'wms:dock:schedule'],
  ['wms:dock_check_in', 'wms_dock_appointment', 'wms:dock:operate'],
  ['wms:dock_assign', 'wms_dock_appointment', 'wms:dock:assign'],
  ['wms:dock_start_service', 'wms_dock_appointment', 'wms:dock:operate'],
  ['wms:dock_depart', 'wms_dock_appointment', 'wms:dock:operate'],
  ['wms:dock_cancel', 'wms_dock_appointment', 'wms:dock:schedule'],
  ['wms:staging_allocate', 'wms_staging_allocation', 'wms:staging:operate'],
  ['wms:staging_release', 'wms_staging_allocation', 'wms:staging:operate'],
  ['wms:crossdock_evaluate', 'wms_crossdock_match', 'wms:crossdock:plan'],
  ['wms:crossdock_approve', 'wms_crossdock_match', 'wms:crossdock:approve'],
  ['wms:crossdock_request_post', 'wms_crossdock_match', 'wms:crossdock:operate'],
  ['wms:crossdock_acknowledge_post', 'wms_crossdock_match', 'wms:crossdock:operate'],
  ['wms:crossdock_cancel', 'wms_crossdock_match', 'wms:crossdock:approve'],
  ['wms:trace_profile_upsert', 'wms_trace_profile', 'wms:trace:admin'],
  ['wms:trace_quality_set', 'wms_trace_profile', 'wms:trace:quality'],
  ['wms:recall_identify', 'wms_recall_case', 'wms:recall:plan'],
  ['wms:recall_analyze', 'wms_recall_case', 'wms:recall:analyze'],
  ['wms:recall_propose_holds', 'wms_recall_case', 'wms:recall:approve'],
  ['wms:recall_close', 'wms_recall_case', 'wms:recall:approve'],
];

const PERMISSIONS = [
  ['wms:dock:admin', 'dock', 'admin', 1], ['wms:dock:schedule', 'dock', 'schedule', 0],
  ['wms:dock:operate', 'dock', 'operate', 0], ['wms:dock:assign', 'dock', 'assign', 1],
  ['wms:staging:operate', 'staging', 'operate', 0], ['wms:crossdock:plan', 'crossdock', 'plan', 0],
  ['wms:crossdock:approve', 'crossdock', 'approve', 1], ['wms:crossdock:operate', 'crossdock', 'operate', 0],
  ['wms:trace:admin', 'trace', 'admin', 1], ['wms:trace:quality', 'trace', 'quality', 1],
  ['wms:recall:plan', 'recall', 'plan', 1], ['wms:recall:analyze', 'recall', 'analyze', 1],
  ['wms:recall:approve', 'recall', 'approve', 1], ['wms:trace:view', 'trace', 'view', 0],
];

export const migration = {
  id: '078_build09_dock_crossdock_traceability', owner: 'stock_wms', version: '9.2.0',
  parent: '077_build09_mobile_execution', dependsOn: ['077_build09_mobile_execution'],
  dialect: ['sqlite'], transactionPolicy: 'required', reversible: true,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS wms_docks_v2 (
        id TEXT PRIMARY KEY, company_id TEXT NOT NULL, warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
        code TEXT NOT NULL, name TEXT NOT NULL, dock_type TEXT NOT NULL CHECK(dock_type IN ('inbound','outbound','mixed')),
        capacity_units REAL NOT NULL DEFAULT 1 CHECK(capacity_units > 0), staging_location_id TEXT REFERENCES stock_locations(id),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)), created_by TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(company_id,warehouse_id,code)
      );
      CREATE TABLE IF NOT EXISTS wms_dock_appointments_v2 (
        id TEXT PRIMARY KEY, company_id TEXT NOT NULL, branch_id TEXT, warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
        appointment_type TEXT NOT NULL CHECK(appointment_type IN ('inbound','outbound')),
        source_document_type TEXT, source_document_id TEXT, carrier_name TEXT, vehicle_reference TEXT,
        supplier_id TEXT, customer_id TEXT, expected_arrival TEXT NOT NULL, expected_departure TEXT NOT NULL,
        actual_arrival TEXT, actual_departure TEXT, dock_id TEXT REFERENCES wms_docks_v2(id),
        staging_location_id TEXT REFERENCES stock_locations(id), expected_units REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK(status IN ('expected','scheduled','checked_in','dock_assigned','unloading','loading','staged','crossdock_review','ready_to_depart','departed','cancelled','conflict','blocked')),
        detention_started_at TEXT, detention_ended_at TEXT, notes TEXT, created_by TEXT NOT NULL,
        checked_in_by TEXT, assigned_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        idempotency_key TEXT UNIQUE, CHECK(expected_departure > expected_arrival)
      );
      CREATE INDEX IF NOT EXISTS idx_wms_dock_schedule ON wms_dock_appointments_v2(company_id,warehouse_id,expected_arrival,expected_departure,status);
      CREATE INDEX IF NOT EXISTS idx_wms_dock_assignment ON wms_dock_appointments_v2(dock_id,expected_arrival,expected_departure,status);
      CREATE TABLE IF NOT EXISTS wms_staging_allocations (
        id TEXT PRIMARY KEY, company_id TEXT NOT NULL, warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
        staging_location_id TEXT NOT NULL REFERENCES stock_locations(id), source_type TEXT NOT NULL, source_id TEXT NOT NULL,
        product_id TEXT REFERENCES product_variants(id), quantity REAL NOT NULL CHECK(quantity > 0),
        capacity_before REAL NOT NULL DEFAULT 0, capacity_after REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK(status IN ('reserved','occupied','partially_released','released','cancelled','blocked')),
        allocated_by TEXT NOT NULL, allocated_at TEXT NOT NULL, released_at TEXT,
        UNIQUE(source_type,source_id,staging_location_id,product_id)
      );
      CREATE INDEX IF NOT EXISTS idx_wms_staging_board ON wms_staging_allocations(company_id,warehouse_id,staging_location_id,status);
      CREATE TABLE IF NOT EXISTS wms_crossdock_matches (
        id TEXT PRIMARY KEY, company_id TEXT NOT NULL, branch_id TEXT, warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
        inbound_appointment_id TEXT REFERENCES wms_dock_appointments_v2(id), outbound_appointment_id TEXT REFERENCES wms_dock_appointments_v2(id),
        inbound_source_type TEXT NOT NULL, inbound_source_id TEXT NOT NULL, outbound_source_type TEXT NOT NULL, outbound_source_id TEXT NOT NULL,
        product_id TEXT NOT NULL REFERENCES product_variants(id), lot_id TEXT REFERENCES stock_lots(id), serial_id TEXT REFERENCES stock_serials(id),
        available_quantity REAL NOT NULL CHECK(available_quantity >= 0), demand_quantity REAL NOT NULL CHECK(demand_quantity > 0),
        matched_quantity REAL NOT NULL CHECK(matched_quantity >= 0), staging_location_id TEXT REFERENCES stock_locations(id),
        outbound_location_id TEXT NOT NULL REFERENCES stock_locations(id), eligibility_score REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK(status IN ('candidate','partial','approved','task_created','awaiting_canonical','completed','rejected','cancelled','exception')),
        exception_reason TEXT, canonical_action TEXT NOT NULL DEFAULT 'stock:move:post', canonical_request_json TEXT NOT NULL DEFAULT '{}',
        canonical_result_id TEXT, proposed_by TEXT NOT NULL, approved_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        idempotency_key TEXT UNIQUE, CHECK(matched_quantity <= available_quantity AND matched_quantity <= demand_quantity)
      );
      CREATE INDEX IF NOT EXISTS idx_wms_crossdock_queue ON wms_crossdock_matches(company_id,warehouse_id,status,product_id);
      CREATE TABLE IF NOT EXISTS wms_trace_profiles (
        id TEXT PRIMARY KEY, company_id TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES product_variants(id),
        lot_id TEXT REFERENCES stock_lots(id), serial_id TEXT REFERENCES stock_serials(id), supplier_lot TEXT, internal_lot TEXT,
        manufacture_date TEXT, expiry_date TEXT, retest_date TEXT,
        quality_status TEXT NOT NULL CHECK(quality_status IN ('released','inspection','conditional','hold','quarantine','rejected','expired')),
        recall_flag INTEGER NOT NULL DEFAULT 0 CHECK(recall_flag IN (0,1)), source_receipt_type TEXT, source_receipt_id TEXT,
        asset_id TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', updated_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        CHECK(lot_id IS NOT NULL OR serial_id IS NOT NULL), UNIQUE(company_id,lot_id,serial_id)
      );
      CREATE INDEX IF NOT EXISTS idx_wms_trace_expiry ON wms_trace_profiles(company_id,expiry_date,quality_status,recall_flag);
      CREATE TABLE IF NOT EXISTS wms_recall_cases (
        id TEXT PRIMARY KEY, company_id TEXT NOT NULL, reference TEXT NOT NULL, lot_id TEXT REFERENCES stock_lots(id), serial_id TEXT REFERENCES stock_serials(id),
        reason TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('identified','analyzing','analyzed','hold_proposed','approved','closed','cancelled')),
        impact_summary_json TEXT NOT NULL DEFAULT '{}', notification_proposals_json TEXT NOT NULL DEFAULT '[]',
        work_item_proposals_json TEXT NOT NULL DEFAULT '[]', identified_by TEXT NOT NULL, approved_by TEXT,
        identified_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT, UNIQUE(company_id,reference),
        CHECK(lot_id IS NOT NULL OR serial_id IS NOT NULL)
      );
      CREATE TABLE IF NOT EXISTS wms_recall_impacts (
        id TEXT PRIMARY KEY, recall_case_id TEXT NOT NULL REFERENCES wms_recall_cases(id) ON DELETE CASCADE,
        impact_type TEXT NOT NULL CHECK(impact_type IN ('stock','production_consumption','production_output','delivery','customer','supplier','return','rma','asset')),
        record_type TEXT NOT NULL, record_id TEXT NOT NULL, product_id TEXT, quantity REAL, company_id TEXT NOT NULL,
        details_json TEXT NOT NULL DEFAULT '{}', hold_status TEXT NOT NULL DEFAULT 'proposed' CHECK(hold_status IN ('proposed','approved','rejected','not_applicable')),
        UNIQUE(recall_case_id,impact_type,record_type,record_id)
      );
    `);
    const stamp = new Date().toISOString();
    const entity = db.prepare(`INSERT INTO platform_entities(id,module_id,storage_owner,primary_key,label_ar,label_en,section,chatter,fields,relations,scope,lifecycle_policy,query_policy,action_policy,customization_policy,history_policy,api_exposed,migration_owner,created_at,updated_at)
      VALUES(?,'stock_wms','platform.wms.operations','id',?,?,'wms',0,'{}','{}','company','governed','scoped','registered','metadata','audit',1,'078_build09_dock_crossdock_traceability',?,?) ON CONFLICT(id) DO NOTHING`);
    ENTITIES.forEach(([id, ar, en]) => entity.run(id, ar, en, stamp, stamp));
    const action = db.prepare(`INSERT INTO platform_actions(id,module_id,entity_id,kind,allowed_states,required_permission,required_scope,input_schema,preconditions,transaction_owner,idempotency_policy,sequence_policy,audit_policy,outbox_policy,error_contract,created_at,updated_at)
      VALUES(?,'stock_wms',?,'domain','[]',?,'warehouse','{}','[]','platform_action_executor','required','none','required','required','{}',?,?) ON CONFLICT(id) DO UPDATE SET required_permission=excluded.required_permission,updated_at=excluded.updated_at`);
    ACTIONS.forEach(([id, entityId, permission]) => action.run(id, entityId, permission, stamp, stamp));
    const permission = db.prepare(`INSERT INTO authorization_permissions(id,module_id,kind,resource,action,label_ar,label_en,sensitive,depends_on,deprecated,created_at,updated_at)
      VALUES(?,'stock_wms','action',?,?,?, ?,?,'[]',0,?,?) ON CONFLICT(id) DO UPDATE SET sensitive=excluded.sensitive,updated_at=excluded.updated_at`);
    PERMISSIONS.forEach(([id, resource, verb, sensitive]) => permission.run(id, resource, verb, id, id, sensitive, stamp, stamp));
  },
  down(db) {
    ACTIONS.forEach(([id]) => db.prepare('DELETE FROM platform_actions WHERE id=?').run(id));
    PERMISSIONS.forEach(([id]) => db.prepare('DELETE FROM authorization_permissions WHERE id=?').run(id));
    ENTITIES.forEach(([id]) => db.prepare('DELETE FROM platform_entities WHERE id=?').run(id));
    db.exec(`DROP TABLE IF EXISTS wms_recall_impacts; DROP TABLE IF EXISTS wms_recall_cases; DROP TABLE IF EXISTS wms_trace_profiles;
      DROP TABLE IF EXISTS wms_crossdock_matches; DROP TABLE IF EXISTS wms_staging_allocations;
      DROP TABLE IF EXISTS wms_dock_appointments_v2; DROP TABLE IF EXISTS wms_docks_v2;`);
  },
};
export default migration;
