// BUILD-10 Slice 4: Offline Client Registry, Command Queue, Sync Engine & Conflicts
'use strict';

const MODULE_ID = 'offline_sync';

const ENTITIES = [
  ['offline_client_registry', 'سجل الأجهزة المستقلة', 'Offline Client Registry'],
  ['offline_command_queue', 'طابور الأوامر المستقلة', 'Offline Command Queue'],
  ['offline_sync_session', 'جلسة المزامنة', 'Offline Sync Session'],
  ['offline_conflict_record', 'سجل التعارضات والمزامنة', 'Offline Conflict Record'],
];

const ACTIONS = [
  ['offline:client_register', 'offline_client_registry', 'offline:admin'],
  ['offline:client_revoke', 'offline_client_registry', 'offline:admin'],
  ['offline:command_queue_local', 'offline_command_queue', 'offline:sync'],
  ['offline:command_sync_push', 'offline_command_queue', 'offline:sync'],
  ['offline:sync_session_start', 'offline_sync_session', 'offline:sync'],
  ['offline:sync_session_complete', 'offline_sync_session', 'offline:sync'],
  ['offline:conflict_resolve', 'offline_conflict_record', 'offline:admin'],
];

const PERMISSIONS = [
  ['offline:view', 'offline_sync', 'view', 0],
  ['offline:sync', 'offline_sync', 'sync', 1],
  ['offline:admin', 'offline_sync', 'admin', 1],
];

function registerModule(db, now) {
  db.prepare(`
    INSERT INTO platform_modules (
      id, name, version, status, kind, owner, dependencies, optional_dependencies,
      capabilities, migrations, settings, created_at, updated_at
    ) VALUES (?, 'Offline Synchronization Engine', '10.3.0', 'enabled', 'standard', 'platform', ?, '[]', ?, ?, '{}', ?, ?)
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
    JSON.stringify(['offline_queue', 'sync_engine', 'conflict_resolution', 'client_registry']),
    JSON.stringify(['081_build10_iot_device_registry', '082_build10_telemetry_health_commands', '083_build10_fleet_telematics_geofences', '084_build10_offline_sync_engine']),
    now, now,
  );

  const companies = db.prepare('SELECT id FROM platform_companies').all();
  const insertAssignment = db.prepare(`
    INSERT INTO platform_module_assignments (
      id, module_id, scope_type, scope_id, enabled, navigation_visible,
      configuration_url, configuration_status, version, created_at, updated_at, updated_by
    ) VALUES (?, ?, 'company', ?, 1, 1, ?, 'ready', 1, ?, ?, 'migration:084')
    ON CONFLICT(module_id, scope_type, scope_id) DO NOTHING
  `);
  for (const company of companies) {
    insertAssignment.run(`pma_${MODULE_ID}_${company.id}`, MODULE_ID, company.id, `/${MODULE_ID}`, now, now);
  }
}

export const migration = {
  id: '084_build10_offline_sync_engine',
  owner: 'offline_sync',
  version: '10.3.0',
  parent: '083_build10_fleet_telematics_geofences',
  dependsOn: ['083_build10_fleet_telematics_geofences'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'BUILD-10 Governed offline client registry, command queue, sync engine and conflicts (Slice 4)',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS offline_client_registries (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        branch_id TEXT,
        client_uuid TEXT NOT NULL,
        user_id TEXT NOT NULL,
        device_name TEXT,
        device_trust_state TEXT NOT NULL DEFAULT 'trusted' CHECK(device_trust_state IN ('trusted','untrusted','revoked')),
        local_schema_version INTEGER NOT NULL DEFAULT 1,
        sync_cursor TEXT,
        last_successful_sync_at TEXT,
        supported_capabilities_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id,client_uuid)
      );
      CREATE INDEX IF NOT EXISTS idx_offline_client_scope ON offline_client_registries(company_id,user_id,device_trust_state);

      CREATE TABLE IF NOT EXISTS offline_command_queues (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        client_id TEXT NOT NULL REFERENCES offline_client_registries(id),
        user_id TEXT NOT NULL,
        local_temp_id TEXT NOT NULL,
        server_mapped_id TEXT,
        action_name TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('local_draft','queued','syncing','accepted','conflict','rejected','failed')),
        conflict_strategy TEXT DEFAULT 'server_wins',
        retry_count INTEGER NOT NULL DEFAULT 0,
        rejection_reason TEXT,
        idempotency_key TEXT UNIQUE,
        client_timestamp TEXT NOT NULL,
        server_received_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_offline_queue_scope ON offline_command_queues(company_id,client_id,status);

      CREATE TABLE IF NOT EXISTS offline_sync_sessions (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        client_id TEXT NOT NULL REFERENCES offline_client_registries(id),
        user_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','completed','failed')),
        pushed_command_count INTEGER NOT NULL DEFAULT 0,
        accepted_command_count INTEGER NOT NULL DEFAULT 0,
        conflict_count INTEGER NOT NULL DEFAULT 0,
        rejected_count INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_offline_sessions_scope ON offline_sync_sessions(company_id,client_id,status);

      CREATE TABLE IF NOT EXISTS offline_conflict_records (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        client_id TEXT NOT NULL REFERENCES offline_client_registries(id),
        command_id TEXT NOT NULL REFERENCES offline_command_queues(id),
        target_entity TEXT NOT NULL,
        target_entity_id TEXT NOT NULL,
        client_payload_json TEXT NOT NULL,
        server_state_json TEXT NOT NULL,
        resolution_strategy TEXT NOT NULL DEFAULT 'server_wins' CHECK(resolution_strategy IN ('server_wins','client_wins','field_merge','manual_review')),
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','ignored')),
        resolved_by TEXT,
        resolved_at TEXT,
        resolution_note TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_offline_conflicts_scope ON offline_conflict_records(company_id,client_id,status);
    `);

    const now = new Date().toISOString();
    registerModule(db, now);

    const entity = db.prepare(`INSERT INTO platform_entities(id,module_id,storage_owner,primary_key,label_ar,label_en,section,chatter,fields,relations,scope,lifecycle_policy,query_policy,action_policy,customization_policy,history_policy,api_exposed,migration_owner,created_at,updated_at)
      VALUES(?,'offline_sync','platform.offline','id',?,?,'system',0,'{}','{}','company','governed','scoped','registered','metadata','audit',1,'084_build10_offline_sync_engine',?,?)
      ON CONFLICT(id) DO NOTHING`);
    ENTITIES.forEach(([id, ar, en]) => entity.run(id, ar, en, now, now));

    const action = db.prepare(`INSERT INTO platform_actions(id,module_id,entity_id,kind,allowed_states,required_permission,required_scope,input_schema,preconditions,transaction_owner,idempotency_policy,sequence_policy,audit_policy,outbox_policy,error_contract,created_at,updated_at)
      VALUES(?,'offline_sync',?,'domain','[]',?,'company','{}','[]','platform_action_executor','required','none','required','required','{}',?,?)
      ON CONFLICT(id) DO UPDATE SET required_permission=excluded.required_permission,required_scope=excluded.required_scope,updated_at=excluded.updated_at`);
    ACTIONS.forEach(([id, entityId, permission]) => action.run(id, entityId, permission, now, now));

    const permission = db.prepare(`INSERT INTO authorization_permissions(id,module_id,kind,resource,action,label_ar,label_en,sensitive,depends_on,deprecated,created_at,updated_at)
      VALUES(?,'offline_sync','action',?,?,?, ?,?,'[]',0,?,?)
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
      DROP TABLE IF EXISTS offline_conflict_records;
      DROP TABLE IF EXISTS offline_sync_sessions;
      DROP TABLE IF EXISTS offline_command_queues;
      DROP TABLE IF EXISTS offline_client_registries;
    `);
  },
};

export default migration;
