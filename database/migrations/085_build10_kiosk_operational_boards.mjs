// BUILD-10 Slice 5: Kiosk Device Registry, Restricted Kiosks & Large-Screen Boards
'use strict';

const MODULE_ID = 'kiosk_boards';

const ENTITIES = [
  ['kiosk_device_registry', 'سجل أجهزة الكشك الخدمي', 'Kiosk Device Registry'],
  ['kiosk_session_log', 'جلسة استخدام الكشك', 'Kiosk Session Log'],
  ['operational_board_config', 'إعدادات الشاشات التفاعلية', 'Operational Board Config'],
];

const ACTIONS = [
  ['kiosk:register', 'kiosk_device_registry', 'kiosk:admin'],
  ['kiosk:configure', 'kiosk_device_registry', 'kiosk:admin'],
  ['kiosk:suspend', 'kiosk_device_registry', 'kiosk:admin'],
  ['kiosk:heartbeat', 'kiosk_device_registry', 'kiosk:operate'],
  ['kiosk:session_start', 'kiosk_session_log', 'kiosk:operate'],
  ['kiosk:session_end', 'kiosk_session_log', 'kiosk:operate'],
  ['board:config_upsert', 'operational_board_config', 'board:admin'],
];

const PERMISSIONS = [
  ['kiosk:view', 'kiosk_device', 'view', 0],
  ['kiosk:operate', 'kiosk_device', 'operate', 0],
  ['kiosk:admin', 'kiosk_device', 'admin', 1],
  ['board:view', 'operational_board', 'view', 0],
  ['board:admin', 'operational_board', 'admin', 1],
];

function registerModule(db, now) {
  db.prepare(`
    INSERT INTO platform_modules (
      id, name, version, status, kind, owner, dependencies, optional_dependencies,
      capabilities, migrations, settings, created_at, updated_at
    ) VALUES (?, 'Kiosks and Operational Boards', '10.4.0', 'enabled', 'standard', 'operations', ?, '[]', ?, ?, '{}', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      version = excluded.version,
      status = excluded.status,
      dependencies = excluded.dependencies,
      capabilities = excluded.capabilities,
      migrations = excluded.migrations,
      updated_at = excluded.updated_at
  `).run(
    MODULE_ID,
    JSON.stringify(['platform_kernel']),
    JSON.stringify(['kiosks', 'employee_kiosk', 'warehouse_kiosk', 'shopfloor_kiosk', 'service_kiosk', 'large_screen_boards']),
    JSON.stringify(['081_build10_iot_device_registry', '082_build10_telemetry_health_commands', '083_build10_fleet_telematics_geofences', '084_build10_offline_sync_engine', '085_build10_kiosk_operational_boards']),
    now, now,
  );

  const companies = db.prepare('SELECT id FROM platform_companies').all();
  const insertAssignment = db.prepare(`
    INSERT INTO platform_module_assignments (
      id, module_id, scope_type, scope_id, enabled, navigation_visible,
      configuration_url, configuration_status, version, created_at, updated_at, updated_by
    ) VALUES (?, ?, 'company', ?, 1, 1, ?, 'ready', 1, ?, ?, 'migration:085')
    ON CONFLICT(module_id, scope_type, scope_id) DO NOTHING
  `);
  for (const company of companies) {
    insertAssignment.run(`pma_${MODULE_ID}_${company.id}`, MODULE_ID, company.id, `/${MODULE_ID}`, now, now);
  }
}

export const migration = {
  id: '085_build10_kiosk_operational_boards',
  owner: 'kiosk_boards',
  version: '10.4.0',
  parent: '084_build10_offline_sync_engine',
  dependsOn: ['084_build10_offline_sync_engine'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'BUILD-10 Governed kiosk device registry, restricted employee/warehouse/shopfloor/service kiosks and operational boards (Slice 5)',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS kiosk_device_registries (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        branch_id TEXT,
        site TEXT,
        warehouse_id TEXT,
        work_center_id TEXT,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        kiosk_type TEXT NOT NULL CHECK(kiosk_type IN ('employee','warehouse','shopfloor','service')),
        assigned_role_profile TEXT NOT NULL DEFAULT 'kiosk_restricted',
        allowed_actions_json TEXT NOT NULL DEFAULT '[]',
        allowed_pages_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','locked')),
        session_timeout_seconds INTEGER NOT NULL DEFAULT 120,
        last_heartbeat_at TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id,code)
      );
      CREATE INDEX IF NOT EXISTS idx_kiosk_registries_scope ON kiosk_device_registries(company_id,kiosk_type,status);

      CREATE TABLE IF NOT EXISTS kiosk_session_logs (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        kiosk_id TEXT NOT NULL REFERENCES kiosk_device_registries(id),
        actor_id TEXT,
        kiosk_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','timeout','locked')),
        started_at TEXT NOT NULL,
        ended_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kiosk_sessions_scope ON kiosk_session_logs(company_id,kiosk_id,status);

      CREATE TABLE IF NOT EXISTS operational_board_configs (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        branch_id TEXT,
        board_key TEXT NOT NULL CHECK(board_key IN ('fleet_ops','device_health','warehouse_ops','production_ops','service_queue','maintenance_ops','quality_hold','alert_center','branch_ops')),
        title_ar TEXT NOT NULL,
        title_en TEXT NOT NULL,
        auto_refresh_seconds INTEGER NOT NULL DEFAULT 15,
        layout_config_json TEXT NOT NULL DEFAULT '{}',
        is_read_only INTEGER NOT NULL DEFAULT 1 CHECK(is_read_only IN (0,1)),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id,board_key)
      );
      CREATE INDEX IF NOT EXISTS idx_board_configs_scope ON operational_board_configs(company_id,board_key,is_active);
    `);

    const now = new Date().toISOString();
    registerModule(db, now);

    const entity = db.prepare(`INSERT INTO platform_entities(id,module_id,storage_owner,primary_key,label_ar,label_en,section,chatter,fields,relations,scope,lifecycle_policy,query_policy,action_policy,customization_policy,history_policy,api_exposed,migration_owner,created_at,updated_at)
      VALUES(?,'kiosk_boards','platform.kiosk','id',?,?,'operations',0,'{}','{}','company','governed','scoped','registered','metadata','audit',1,'085_build10_kiosk_operational_boards',?,?)
      ON CONFLICT(id) DO NOTHING`);
    ENTITIES.forEach(([id, ar, en]) => entity.run(id, ar, en, now, now));

    const action = db.prepare(`INSERT INTO platform_actions(id,module_id,entity_id,kind,allowed_states,required_permission,required_scope,input_schema,preconditions,transaction_owner,idempotency_policy,sequence_policy,audit_policy,outbox_policy,error_contract,created_at,updated_at)
      VALUES(?,'kiosk_boards',?,'domain','[]',?,'company','{}','[]','platform_action_executor','required','none','required','required','{}',?,?)
      ON CONFLICT(id) DO UPDATE SET required_permission=excluded.required_permission,required_scope=excluded.required_scope,updated_at=excluded.updated_at`);
    ACTIONS.forEach(([id, entityId, permission]) => action.run(id, entityId, permission, now, now));

    const permission = db.prepare(`INSERT INTO authorization_permissions(id,module_id,kind,resource,action,label_ar,label_en,sensitive,depends_on,deprecated,created_at,updated_at)
      VALUES(?,'kiosk_boards','action',?,?,?, ?,?,'[]',0,?,?)
      ON CONFLICT(id) DO UPDATE SET sensitive=excluded.sensitive,updated_at=excluded.updated_at`);
    PERMISSIONS.forEach(([id, resource, verb, sensitive]) => permission.run(id, resource, verb, id, id, sensitive, now, now));
  },

  down(db) {
    ACTIONS.forEach(([id]) => db.prepare('DELETE FROM platform_actions WHERE id=?').run(id));
    PERMISSIONS.forEach(([id]) => db.prepare('DELETE FROM authorization_permissions WHERE id=?').run(id));
    ENTITIES.forEach(([id]) => db.prepare('DELETE FROM platform_entities WHERE id=?').run(id));
    db.prepare('DELETE FROM platform_module_assignments WHERE module_id=?').run(MODULE_ID);
    db.prepare('DELETE FROM platform_modules WHERE id=?').run(MODULE_ID);
    db.exec(`
      DROP TABLE IF EXISTS operational_board_configs;
      DROP TABLE IF EXISTS kiosk_session_logs;
      DROP TABLE IF EXISTS kiosk_device_registries;
    `);
  },
};

export default migration;
