// BUILD-09 operational quality orchestration over canonical inspections, NCR/CAPA, manufacturing, and inventory.
'use strict';

const ENTITIES = [
  ['quality_operational_checkpoint', 'نقطة جودة تشغيلية', 'Operational Quality Checkpoint'],
  ['quality_disposition_request', 'طلب قرار جودة', 'Quality Disposition Request'],
  ['quality_rework_route', 'مسار إعادة عمل', 'Quality Rework Route'],
];
const ACTIONS = [
  ['quality:checkpoint_open', 'quality_operational_checkpoint', 'quality:operational:inspect'],
  ['quality:checkpoint_sync', 'quality_operational_checkpoint', 'quality:operational:inspect'],
  ['quality:checkpoint_conditional_accept', 'quality_operational_checkpoint', 'quality:operational:hold'],
  ['quality:disposition_request', 'quality_disposition_request', 'quality:disposition:request'],
  ['quality:disposition_approve', 'quality_disposition_request', 'quality:disposition:approve'],
  ['quality:scrap_request_canonical', 'quality_disposition_request', 'quality:scrap:approve'],
  ['quality:scrap_acknowledge', 'quality_disposition_request', 'quality:scrap:approve'],
  ['quality:rework_start', 'quality_rework_route', 'quality:rework:approve'],
  ['quality:rework_complete', 'quality_rework_route', 'quality:rework:approve'],
  ['quality:disposition_close', 'quality_disposition_request', 'quality:disposition:approve'],
];
const PERMISSIONS = [
  ['quality:operational:view', 'quality_operational', 'view', 0],
  ['quality:operational:inspect', 'quality_operational', 'inspect', 0],
  ['quality:operational:hold', 'quality_operational', 'hold', 1],
  ['quality:disposition:request', 'quality_disposition', 'request', 0],
  ['quality:disposition:approve', 'quality_disposition', 'approve', 1],
  ['quality:rework:approve', 'quality_rework', 'approve', 1],
  ['quality:scrap:request', 'quality_scrap', 'request', 1],
  ['quality:scrap:approve', 'quality_scrap', 'approve', 1],
];

export const migration = {
  id: '080_build09_quality_rework_scrap', owner: 'platform.kernel', version: '9.4.0',
  parent: '079_build09_shopfloor_material_performance', dependsOn: ['079_build09_shopfloor_material_performance'],
  dialect: ['sqlite'], transactionPolicy: 'required', reversible: true,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS quality_operational_checkpoints (
        id TEXT PRIMARY KEY, company_id TEXT NOT NULL, warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
        checkpoint_type TEXT NOT NULL CHECK(checkpoint_type IN ('incoming','in_process','final','retest')),
        source_type TEXT NOT NULL CHECK(source_type IN ('receiving_session','shopfloor_session','production_order','work_order','purchase_receipt','customer_return')),
        source_id TEXT NOT NULL, inspection_id TEXT NOT NULL REFERENCES quality_inspections(id), plan_id TEXT REFERENCES quality_plans(id),
        product_id TEXT NOT NULL REFERENCES product_variants(id), lot_id TEXT REFERENCES stock_lots(id), serial_id TEXT REFERENCES stock_serials(id),
        sampling_plan_reference TEXT, sample_size REAL NOT NULL CHECK(sample_size > 0),
        accepted_quantity REAL NOT NULL DEFAULT 0 CHECK(accepted_quantity >= 0), rejected_quantity REAL NOT NULL DEFAULT 0 CHECK(rejected_quantity >= 0),
        status TEXT NOT NULL CHECK(status IN ('pending','in_progress','pass','fail','conditional','hold','quarantine','ncr','rework','scrap','released','closed')),
        hold_location_id TEXT REFERENCES stock_locations(id), reason_code TEXT, evidence_json TEXT NOT NULL DEFAULT '[]',
        ncr_id TEXT REFERENCES quality_ncrs(id), capa_id TEXT REFERENCES quality_capas(id),
        opened_by TEXT NOT NULL, decided_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        idempotency_key TEXT UNIQUE, UNIQUE(company_id,inspection_id)
      );
      CREATE INDEX IF NOT EXISTS idx_quality_operational_queue ON quality_operational_checkpoints(company_id,warehouse_id,status,checkpoint_type);
      CREATE TABLE IF NOT EXISTS quality_disposition_requests (
        id TEXT PRIMARY KEY, company_id TEXT NOT NULL, warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
        checkpoint_id TEXT NOT NULL REFERENCES quality_operational_checkpoints(id) ON DELETE CASCADE,
        disposition_type TEXT NOT NULL CHECK(disposition_type IN ('conditional_acceptance','quarantine','rework','retest','scrap','return_to_vendor')),
        quantity REAL NOT NULL CHECK(quantity > 0), source_location_id TEXT REFERENCES stock_locations(id),
        destination_location_id TEXT REFERENCES stock_locations(id), reason_code TEXT NOT NULL,
        ncr_id TEXT REFERENCES quality_ncrs(id), capa_id TEXT REFERENCES quality_capas(id),
        status TEXT NOT NULL CHECK(status IN ('requested','approved','rejected','route_created','awaiting_canonical','completed','closed','cancelled','exception')),
        evidence_json TEXT NOT NULL DEFAULT '[]', decision_notes TEXT,
        canonical_action TEXT, canonical_request_json TEXT NOT NULL DEFAULT '{}', canonical_result_id TEXT,
        requested_by TEXT NOT NULL, approved_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        idempotency_key TEXT UNIQUE
      );
      CREATE INDEX IF NOT EXISTS idx_quality_disposition_queue ON quality_disposition_requests(company_id,warehouse_id,status,disposition_type);
      CREATE TABLE IF NOT EXISTS quality_rework_routes (
        id TEXT PRIMARY KEY, company_id TEXT NOT NULL, disposition_request_id TEXT NOT NULL REFERENCES quality_disposition_requests(id) ON DELETE CASCADE,
        production_order_id TEXT REFERENCES mfg_production_orders(id), source_work_order_id TEXT REFERENCES mfg_work_orders(id),
        route_reference TEXT NOT NULL, operations_json TEXT NOT NULL DEFAULT '[]', retest_required INTEGER NOT NULL DEFAULT 1 CHECK(retest_required IN (0,1)),
        status TEXT NOT NULL CHECK(status IN ('planned','released','running','retest','completed','cancelled')),
        canonical_action TEXT, canonical_request_json TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL,
        started_at TEXT, completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(company_id,route_reference)
      );
    `);
    const stamp = new Date().toISOString();
    const entity = db.prepare(`INSERT INTO platform_entities(id,module_id,storage_owner,primary_key,label_ar,label_en,section,chatter,fields,relations,scope,lifecycle_policy,query_policy,action_policy,customization_policy,history_policy,api_exposed,migration_owner,created_at,updated_at)
      VALUES(?,'operations_quality','platform.quality.operations','id',?,?,'operations',1,'{}','{}','company','governed','scoped','registered','metadata','audit',1,'080_build09_quality_rework_scrap',?,?) ON CONFLICT(id) DO NOTHING`);
    ENTITIES.forEach(([id, ar, en]) => entity.run(id, ar, en, stamp, stamp));
    const action = db.prepare(`INSERT INTO platform_actions(id,module_id,entity_id,kind,allowed_states,required_permission,required_scope,input_schema,preconditions,transaction_owner,idempotency_policy,sequence_policy,audit_policy,outbox_policy,error_contract,created_at,updated_at)
      VALUES(?,'operations_quality',?,'domain','[]',?,'warehouse','{}','[]','platform_action_executor','required','none','required','required','{}',?,?) ON CONFLICT(id) DO UPDATE SET required_permission=excluded.required_permission,updated_at=excluded.updated_at`);
    ACTIONS.forEach(([id, entityId, permission]) => action.run(id, entityId, permission, stamp, stamp));
    const permission = db.prepare(`INSERT INTO authorization_permissions(id,module_id,kind,resource,action,label_ar,label_en,sensitive,depends_on,deprecated,created_at,updated_at)
      VALUES(?,'operations_quality','action',?,?,?, ?,?,'[]',0,?,?) ON CONFLICT(id) DO UPDATE SET sensitive=excluded.sensitive,updated_at=excluded.updated_at`);
    PERMISSIONS.forEach(([id, resource, verb, sensitive]) => permission.run(id, resource, verb, id, id, sensitive, stamp, stamp));
  },
  down(db) {
    ACTIONS.forEach(([id]) => db.prepare('DELETE FROM platform_actions WHERE id=?').run(id));
    PERMISSIONS.forEach(([id]) => db.prepare('DELETE FROM authorization_permissions WHERE id=?').run(id));
    ENTITIES.forEach(([id]) => db.prepare('DELETE FROM platform_entities WHERE id=?').run(id));
    db.exec('DROP TABLE IF EXISTS quality_rework_routes; DROP TABLE IF EXISTS quality_disposition_requests; DROP TABLE IF EXISTS quality_operational_checkpoints;');
  },
};
export default migration;
