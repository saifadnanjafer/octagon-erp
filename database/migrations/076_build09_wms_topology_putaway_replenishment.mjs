// BUILD-09A-C: advanced warehouse topology, putaway and replenishment projections.
'use strict';

const ENTITIES = [
  ['wms_zone', 'منطقة مستودع', 'Warehouse Zone'],
  ['wms_location_profile', 'ملف موقع مستودع', 'Warehouse Location Profile'],
  ['wms_putaway_rule', 'قاعدة توجيه', 'Putaway Rule'],
  ['wms_putaway_recommendation', 'توصية توجيه', 'Putaway Recommendation'],
  ['wms_replenishment_rule', 'قاعدة تغذية', 'Replenishment Rule'],
  ['wms_replenishment_proposal', 'مقترح تغذية', 'Replenishment Proposal'],
  ['wms_warehouse_task', 'مهمة مستودع', 'Warehouse Task'],
];

const ACTIONS = [
  ['wms:zone_create', 'wms_zone', 'wms:topology:admin'],
  ['wms:zone_update', 'wms_zone', 'wms:topology:admin'],
  ['wms:zone_set_active', 'wms_zone', 'wms:topology:admin'],
  ['wms:location_create', 'wms_location_profile', 'wms:topology:admin'],
  ['wms:location_update', 'wms_location_profile', 'wms:topology:admin'],
  ['wms:location_move', 'wms_location_profile', 'wms:topology:admin'],
  ['wms:location_set_capacity', 'wms_location_profile', 'wms:topology:admin'],
  ['wms:location_set_restrictions', 'wms_location_profile', 'wms:topology:admin'],
  ['wms:location_generate_barcode', 'wms_location_profile', 'wms:topology:admin'],
  ['wms:location_retire', 'wms_location_profile', 'wms:topology:admin'],
  ['wms:putaway_rule_create', 'wms_putaway_rule', 'wms:putaway:admin'],
  ['wms:putaway_rule_update', 'wms_putaway_rule', 'wms:putaway:admin'],
  ['wms:putaway_recommend', 'wms_putaway_recommendation', 'wms:receiving:operate'],
  ['wms:putaway_accept', 'wms_putaway_recommendation', 'wms:receiving:operate'],
  ['wms:putaway_override', 'wms_putaway_recommendation', 'wms:putaway:override'],
  ['wms:task_scan_source', 'wms_warehouse_task', 'wms:warehouse_task:operate'],
  ['wms:task_scan_destination', 'wms_warehouse_task', 'wms:warehouse_task:operate'],
  ['wms:task_request_canonical', 'wms_warehouse_task', 'wms:warehouse_task:operate'],
  ['wms:task_acknowledge_canonical', 'wms_warehouse_task', 'wms:warehouse_task:approve'],
  ['wms:replenishment_rule_create', 'wms_replenishment_rule', 'wms:replenishment:admin'],
  ['wms:replenishment_calculate', 'wms_replenishment_proposal', 'wms:replenishment:operate'],
  ['wms:replenishment_approve', 'wms_replenishment_proposal', 'wms:replenishment:approve'],
  ['wms:replenishment_cancel', 'wms_replenishment_proposal', 'wms:replenishment:approve'],
  ['wms:replenishment_retry', 'wms_replenishment_proposal', 'wms:replenishment:operate'],
];

const PERMISSIONS = [
  ['wms:topology:admin', 'topology', 'admin', 1],
  ['wms:putaway:admin', 'putaway', 'admin', 1],
  ['wms:putaway:override', 'putaway', 'override', 1],
  ['wms:replenishment:admin', 'replenishment', 'admin', 1],
  ['wms:replenishment:operate', 'replenishment', 'operate', 0],
  ['wms:replenishment:approve', 'replenishment', 'approve', 1],
  ['wms:receiving:operate', 'receiving', 'operate', 0],
  ['wms:warehouse_task:operate', 'warehouse_task', 'operate', 0],
  ['wms:warehouse_task:approve', 'warehouse_task', 'approve', 1],
  ['wms:topology:view', 'topology', 'view', 0],
  ['wms:putaway:view', 'putaway', 'view', 0],
  ['wms:replenishment:view', 'replenishment', 'view', 0],
];

export const migration = {
  id: '076_build09_wms_topology_putaway_replenishment',
  owner: 'stock_wms',
  version: '9.0.0',
  parent: '075_build08_intercompany_consolidation',
  dependsOn: ['075_build08_intercompany_consolidation'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'BUILD-09 advanced WMS topology, putaway and replenishment',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS wms_zones (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
        parent_zone_id TEXT REFERENCES wms_zones(id),
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        zone_type TEXT NOT NULL CHECK(zone_type IN (
          'storage','receiving','shipping','staging','quarantine','quality_hold',
          'returns','cross_dock','production_supply','scrap','hazardous','restricted'
        )),
        picking_priority INTEGER NOT NULL DEFAULT 100,
        putaway_priority INTEGER NOT NULL DEFAULT 100,
        temperature_min REAL,
        temperature_max REAL,
        hazardous INTEGER NOT NULL DEFAULT 0 CHECK(hazardous IN (0,1)),
        restricted INTEGER NOT NULL DEFAULT 0 CHECK(restricted IN (0,1)),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id,warehouse_id,code)
      );
      CREATE INDEX IF NOT EXISTS idx_wms_zones_scope ON wms_zones(company_id,warehouse_id,is_active);

      CREATE TABLE IF NOT EXISTS wms_location_profiles (
        location_id TEXT PRIMARY KEY REFERENCES stock_locations(id),
        company_id TEXT NOT NULL,
        warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
        zone_id TEXT REFERENCES wms_zones(id),
        location_type TEXT NOT NULL CHECK(location_type IN (
          'site','building','floor','zone','aisle','rack','bay','level','bin',
          'receiving_dock','shipping_dock','staging','quarantine','quality_hold',
          'returns','cross_dock','production_supply','scrap','hazardous','restricted'
        )),
        location_code TEXT NOT NULL,
        barcode TEXT,
        capacity_units REAL,
        weight_limit REAL,
        volume_limit REAL,
        temperature_min REAL,
        temperature_max REAL,
        hazardous INTEGER NOT NULL DEFAULT 0 CHECK(hazardous IN (0,1)),
        restricted INTEGER NOT NULL DEFAULT 0 CHECK(restricted IN (0,1)),
        restrictions_json TEXT NOT NULL DEFAULT '{}',
        replenishment_source_location_id TEXT REFERENCES stock_locations(id),
        picking_priority INTEGER NOT NULL DEFAULT 100,
        putaway_priority INTEGER NOT NULL DEFAULT 100,
        fixed_product_id TEXT,
        is_blocked INTEGER NOT NULL DEFAULT 0 CHECK(is_blocked IN (0,1)),
        block_reason TEXT,
        retired_at TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id,warehouse_id,location_code),
        UNIQUE(company_id,barcode)
      );
      CREATE INDEX IF NOT EXISTS idx_wms_locations_zone ON wms_location_profiles(company_id,warehouse_id,zone_id);
      CREATE INDEX IF NOT EXISTS idx_wms_locations_flags ON wms_location_profiles(company_id,is_blocked,restricted,hazardous);

      CREATE TABLE IF NOT EXISTS wms_putaway_rules (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
        name TEXT NOT NULL,
        rule_type TEXT NOT NULL CHECK(rule_type IN ('fixed_bin','product','category','supplier','receipt_type','fallback')),
        product_id TEXT,
        category_id TEXT,
        supplier_id TEXT,
        receipt_type TEXT,
        lot_pattern TEXT,
        destination_zone_id TEXT REFERENCES wms_zones(id),
        destination_location_id TEXT REFERENCES stock_locations(id),
        temperature_min REAL,
        temperature_max REAL,
        hazard_class TEXT,
        requires_quality_status TEXT,
        strategy TEXT NOT NULL DEFAULT 'priority' CHECK(strategy IN ('priority','affinity','fifo','fefo','nearest')),
        priority INTEGER NOT NULL DEFAULT 100,
        allow_split INTEGER NOT NULL DEFAULT 1 CHECK(allow_split IN (0,1)),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
        conditions_json TEXT NOT NULL DEFAULT '{}',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_wms_putaway_rules ON wms_putaway_rules(company_id,warehouse_id,is_active,priority);

      CREATE TABLE IF NOT EXISTS wms_putaway_recommendations (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
        source_location_id TEXT NOT NULL REFERENCES stock_locations(id),
        product_id TEXT NOT NULL,
        lot_id TEXT,
        serial_id TEXT,
        quantity REAL NOT NULL CHECK(quantity > 0),
        unit_weight REAL NOT NULL DEFAULT 0,
        unit_volume REAL NOT NULL DEFAULT 0,
        quality_status TEXT NOT NULL DEFAULT 'released',
        selected_rule_id TEXT REFERENCES wms_putaway_rules(id),
        status TEXT NOT NULL DEFAULT 'suggested' CHECK(status IN ('suggested','accepted','overridden','task_created','completed','cancelled')),
        exception_reason TEXT,
        requested_by TEXT NOT NULL,
        accepted_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        idempotency_key TEXT UNIQUE
      );

      CREATE TABLE IF NOT EXISTS wms_putaway_recommendation_lines (
        id TEXT PRIMARY KEY,
        recommendation_id TEXT NOT NULL REFERENCES wms_putaway_recommendations(id) ON DELETE CASCADE,
        destination_location_id TEXT NOT NULL REFERENCES stock_locations(id),
        quantity REAL NOT NULL CHECK(quantity > 0),
        capacity_before REAL,
        capacity_after REAL,
        sequence INTEGER NOT NULL,
        restriction_override INTEGER NOT NULL DEFAULT 0 CHECK(restriction_override IN (0,1)),
        UNIQUE(recommendation_id,sequence)
      );

      CREATE TABLE IF NOT EXISTS wms_replenishment_rules_v2 (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
        zone_id TEXT REFERENCES wms_zones(id),
        product_id TEXT,
        category_id TEXT,
        source_location_id TEXT NOT NULL REFERENCES stock_locations(id),
        destination_location_id TEXT NOT NULL REFERENCES stock_locations(id),
        minimum_quantity REAL NOT NULL CHECK(minimum_quantity >= 0),
        maximum_quantity REAL NOT NULL CHECK(maximum_quantity >= minimum_quantity),
        reorder_point REAL NOT NULL CHECK(reorder_point >= 0),
        target_quantity REAL NOT NULL CHECK(target_quantity >= minimum_quantity),
        safety_quantity REAL NOT NULL DEFAULT 0,
        demand_window_days INTEGER NOT NULL DEFAULT 7,
        priority INTEGER NOT NULL DEFAULT 100,
        schedule TEXT NOT NULL DEFAULT 'demand',
        auto_approval_limit REAL NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK(source_location_id <> destination_location_id)
      );
      CREATE INDEX IF NOT EXISTS idx_wms_replenishment_rules ON wms_replenishment_rules_v2(company_id,warehouse_id,is_active,priority);

      CREATE TABLE IF NOT EXISTS wms_replenishment_proposals_v2 (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
        rule_id TEXT NOT NULL REFERENCES wms_replenishment_rules_v2(id),
        product_id TEXT NOT NULL,
        source_location_id TEXT NOT NULL REFERENCES stock_locations(id),
        destination_location_id TEXT NOT NULL REFERENCES stock_locations(id),
        destination_on_hand REAL NOT NULL,
        open_pick_demand REAL NOT NULL DEFAULT 0,
        production_demand REAL NOT NULL DEFAULT 0,
        requested_quantity REAL NOT NULL CHECK(requested_quantity > 0),
        available_quantity REAL NOT NULL,
        proposed_quantity REAL NOT NULL CHECK(proposed_quantity >= 0),
        status TEXT NOT NULL CHECK(status IN ('proposed','auto_approved','approved','partial','blocked','task_created','awaiting_canonical','completed','cancelled','failed')),
        priority INTEGER NOT NULL DEFAULT 100,
        shortage_quantity REAL NOT NULL DEFAULT 0,
        block_reason TEXT,
        created_by TEXT NOT NULL,
        approved_by TEXT,
        approved_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        idempotency_key TEXT UNIQUE
      );
      CREATE INDEX IF NOT EXISTS idx_wms_replenishment_queue ON wms_replenishment_proposals_v2(company_id,warehouse_id,status,priority);

      CREATE TABLE IF NOT EXISTS wms_warehouse_tasks (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        branch_id TEXT,
        warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
        task_type TEXT NOT NULL CHECK(task_type IN ('putaway','replenishment','pick','count','cross_dock','production_issue','production_return','production_receipt')),
        source_record_type TEXT NOT NULL,
        source_record_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        lot_id TEXT,
        serial_id TEXT,
        source_location_id TEXT NOT NULL REFERENCES stock_locations(id),
        destination_location_id TEXT NOT NULL REFERENCES stock_locations(id),
        quantity REAL NOT NULL CHECK(quantity > 0),
        status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','assigned','source_scanned','destination_scanned','awaiting_canonical','completed','blocked','cancelled','failed')),
        priority INTEGER NOT NULL DEFAULT 100,
        assigned_to TEXT,
        source_scan TEXT,
        destination_scan TEXT,
        canonical_action TEXT NOT NULL DEFAULT 'stock:move:post',
        canonical_request_json TEXT NOT NULL DEFAULT '{}',
        canonical_result_id TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(source_record_type,source_record_id,destination_location_id,product_id)
      );
      CREATE INDEX IF NOT EXISTS idx_wms_task_queue ON wms_warehouse_tasks(company_id,warehouse_id,status,priority);
    `);

    const now = new Date().toISOString();
    const entity = db.prepare(`INSERT INTO platform_entities(id,module_id,storage_owner,primary_key,label_ar,label_en,section,chatter,fields,relations,scope,lifecycle_policy,query_policy,action_policy,customization_policy,history_policy,api_exposed,migration_owner,created_at,updated_at)
      VALUES(?,'stock_wms','platform.wms','id',?,?,'wms',0,'{}','{}','company','governed','scoped','registered','metadata','audit',1,'076_build09_wms_topology_putaway_replenishment',?,?)
      ON CONFLICT(id) DO NOTHING`);
    ENTITIES.forEach(([id, ar, en]) => entity.run(id, ar, en, now, now));

    const action = db.prepare(`INSERT INTO platform_actions(id,module_id,entity_id,kind,allowed_states,required_permission,required_scope,input_schema,preconditions,transaction_owner,idempotency_policy,sequence_policy,audit_policy,outbox_policy,error_contract,created_at,updated_at)
      VALUES(?,'stock_wms',?,'domain','[]',?,'warehouse','{}','[]','platform_action_executor','required','none','required','required','{}',?,?)
      ON CONFLICT(id) DO UPDATE SET required_permission=excluded.required_permission,required_scope=excluded.required_scope,updated_at=excluded.updated_at`);
    ACTIONS.forEach(([id, entityId, permission]) => action.run(id, entityId, permission, now, now));

    const permission = db.prepare(`INSERT INTO authorization_permissions(id,module_id,kind,resource,action,label_ar,label_en,sensitive,depends_on,deprecated,created_at,updated_at)
      VALUES(?,'stock_wms','action',?,?,?, ?,?,'[]',0,?,?)
      ON CONFLICT(id) DO UPDATE SET sensitive=excluded.sensitive,updated_at=excluded.updated_at`);
    PERMISSIONS.forEach(([id, resource, verb, sensitive]) => permission.run(id, resource, verb, id, id, sensitive, now, now));
  },

  down(db) {
    ACTIONS.forEach(([id]) => db.prepare('DELETE FROM platform_actions WHERE id=?').run(id));
    ENTITIES.forEach(([id]) => db.prepare('DELETE FROM platform_entities WHERE id=?').run(id));
    PERMISSIONS.forEach(([id]) => db.prepare('DELETE FROM authorization_permissions WHERE id=?').run(id));
    db.exec(`
      DROP TABLE IF EXISTS wms_warehouse_tasks;
      DROP TABLE IF EXISTS wms_replenishment_proposals_v2;
      DROP TABLE IF EXISTS wms_replenishment_rules_v2;
      DROP TABLE IF EXISTS wms_putaway_recommendation_lines;
      DROP TABLE IF EXISTS wms_putaway_recommendations;
      DROP TABLE IF EXISTS wms_putaway_rules;
      DROP TABLE IF EXISTS wms_location_profiles;
      DROP TABLE IF EXISTS wms_zones;
    `);
  },
};

export default migration;
