// BUILD-10 Slice 2: IoT telemetry ingestion, device health/diagnostics,
// firmware/configuration governance and simulated device commands.
'use strict';

const MODULE_ID = 'iot_devices';

const ENTITIES = [
  ['iot_telemetry_raw', 'بيانات القياس الخام', 'IoT Raw Telemetry'],
  ['iot_telemetry_event', 'حدث قياس', 'IoT Telemetry Event'],
  ['iot_device_health', 'صحة الجهاز', 'IoT Device Health'],
  ['iot_device_alert', 'تنبيه الجهاز', 'IoT Device Alert'],
  ['iot_firmware', 'البرنامج الثابت', 'IoT Firmware'],
  ['iot_firmware_rollout', 'نشر البرنامج الثابت', 'IoT Firmware Rollout'],
  ['iot_config_profile', 'ملف الإعدادات', 'IoT Config Profile'],
  ['iot_device_config_state', 'حالة إعدادات الجهاز', 'IoT Device Config State'],
  ['iot_device_command', 'أمر الجهاز', 'IoT Device Command'],
];

const ACTIONS = [
  ['iot:telemetry_ingest_simulated', 'iot_telemetry_raw', 'iot:telemetry:ingest'],
  ['iot:telemetry_ingest_batch', 'iot_telemetry_raw', 'iot:telemetry:ingest'],
  ['iot:health_calculate', 'iot_device_health', 'iot:device:write'],
  ['iot:alert_acknowledge', 'iot_device_alert', 'iot:alert:acknowledge'],
  ['iot:alert_assign', 'iot_device_alert', 'iot:alert:acknowledge'],
  ['iot:alert_resolve', 'iot_device_alert', 'iot:alert:acknowledge'],
  ['iot:alert_suppress', 'iot_device_alert', 'iot:alert:acknowledge'],
  ['iot:alert_resume', 'iot_device_alert', 'iot:alert:acknowledge'],
  ['iot:firmware_register', 'iot_firmware', 'iot:firmware:admin'],
  ['iot:firmware_approve', 'iot_firmware', 'iot:firmware:admin'],
  ['iot:firmware_rollout_simulated', 'iot_firmware_rollout', 'iot:firmware:admin'],
  ['iot:firmware_rollback_request', 'iot_firmware_rollout', 'iot:firmware:admin'],
  ['iot:config_profile_upsert', 'iot_config_profile', 'iot:config:admin'],
  ['iot:config_evaluate_drift', 'iot_device_config_state', 'iot:config:admin'],
  ['iot:command_request', 'iot_device_command', 'iot:command:request'],
  ['iot:command_approve', 'iot_device_command', 'iot:command:approve'],
  ['iot:command_reject', 'iot_device_command', 'iot:command:approve'],
  ['iot:command_dispatch_simulated', 'iot_device_command', 'iot:command:request'],
  ['iot:command_retry', 'iot_device_command', 'iot:command:request'],
  ['iot:command_cancel', 'iot_device_command', 'iot:command:request'],
];

const PERMISSIONS = [
  ['iot:telemetry:view', 'iot_telemetry', 'view', 0],
  ['iot:telemetry:ingest', 'iot_telemetry', 'ingest', 1],
  ['iot:health:view', 'iot_device_health', 'view', 0],
  ['iot:alert:acknowledge', 'iot_device_alert', 'acknowledge', 0],
  ['iot:firmware:admin', 'iot_firmware', 'admin', 1],
  ['iot:config:admin', 'iot_config_profile', 'admin', 1],
  ['iot:command:request', 'iot_device_command', 'request', 1],
  ['iot:command:approve', 'iot_device_command', 'approve', 1],
];

function registerModule(db, now) {
  db.prepare(`
    INSERT INTO platform_modules (
      id, name, version, status, kind, owner, dependencies, optional_dependencies,
      capabilities, migrations, settings, created_at, updated_at
    ) VALUES (?, 'IoT Device Registry', '10.1.0', 'enabled', 'standard', 'operations', ?, '[]', ?, ?, '{}', ?, ?)
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
    JSON.stringify(['platform_kernel', 'fleet_telematics']),
    JSON.stringify(['devices', 'gateways', 'sensors', 'telemetry', 'health', 'alerts', 'firmware', 'configuration', 'commands']),
    JSON.stringify(['081_build10_iot_device_registry', '082_build10_telemetry_health_commands']),
    now, now,
  );

  const companies = db.prepare('SELECT id FROM platform_companies').all();
  const insertAssignment = db.prepare(`
    INSERT INTO platform_module_assignments (
      id, module_id, scope_type, scope_id, enabled, navigation_visible,
      configuration_url, configuration_status, version, created_at, updated_at, updated_by
    ) VALUES (?, ?, 'company', ?, 1, 1, ?, 'ready', 1, ?, ?, 'migration:082')
    ON CONFLICT(module_id, scope_type, scope_id) DO NOTHING
  `);
  for (const company of companies) {
    insertAssignment.run(`pma_${MODULE_ID}_${company.id}`, MODULE_ID, company.id, `/${MODULE_ID}`, now, now);
  }
}

export const migration = {
  id: '082_build10_telemetry_health_commands',
  owner: 'iot_devices',
  version: '10.1.0',
  parent: '081_build10_iot_device_registry',
  dependsOn: ['081_build10_iot_device_registry'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'BUILD-10 IoT telemetry, health, firmware/config governance and simulated commands (Slice 2)',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS iot_telemetry_raw (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        gateway_id TEXT,
        sensor_id TEXT,
        correlation_id TEXT,
        sequence INTEGER,
        device_timestamp TEXT,
        gateway_timestamp TEXT,
        received_at TEXT NOT NULL,
        payload_checksum TEXT NOT NULL,
        raw_payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'received' CHECK(status IN ('received','validated','normalized','rejected','duplicate')),
        rejection_reason TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id,device_id,payload_checksum)
      );
      CREATE INDEX IF NOT EXISTS idx_iot_telemetry_raw_scope ON iot_telemetry_raw(company_id,device_id,status);
      CREATE INDEX IF NOT EXISTS idx_iot_telemetry_raw_received ON iot_telemetry_raw(company_id,received_at);

      CREATE TABLE IF NOT EXISTS iot_telemetry_events (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        raw_id TEXT REFERENCES iot_telemetry_raw(id),
        device_id TEXT NOT NULL,
        sensor_id TEXT,
        measurement_type TEXT NOT NULL,
        value REAL,
        value_text TEXT,
        unit TEXT,
        normalized_value REAL,
        normalized_unit TEXT,
        device_timestamp TEXT NOT NULL,
        received_at TEXT NOT NULL,
        sequence INTEGER,
        quality TEXT NOT NULL DEFAULT 'good' CHECK(quality IN ('good','suspect','bad')),
        quality_flags_json TEXT NOT NULL DEFAULT '[]',
        is_late INTEGER NOT NULL DEFAULT 0,
        is_out_of_order INTEGER NOT NULL DEFAULT 0,
        clock_skew_seconds REAL,
        correlation_id TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id,device_id,sensor_id,sequence,measurement_type)
      );
      CREATE INDEX IF NOT EXISTS idx_iot_telemetry_events_scope ON iot_telemetry_events(company_id,device_id,sensor_id,measurement_type);
      CREATE INDEX IF NOT EXISTS idx_iot_telemetry_events_time ON iot_telemetry_events(company_id,device_timestamp);

      CREATE TABLE IF NOT EXISTS iot_device_health (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        device_id TEXT NOT NULL UNIQUE,
        health_state TEXT NOT NULL DEFAULT 'unknown' CHECK(health_state IN ('online','offline','degraded','warning','critical','unknown')),
        health_score REAL,
        missed_interval_count INTEGER NOT NULL DEFAULT 0,
        battery_condition TEXT,
        signal_condition TEXT,
        clock_skew_seconds REAL,
        sensor_fault INTEGER NOT NULL DEFAULT 0,
        gateway_fault INTEGER NOT NULL DEFAULT 0,
        data_quality_fault INTEGER NOT NULL DEFAULT 0,
        firmware_mismatch INTEGER NOT NULL DEFAULT 0,
        config_mismatch INTEGER NOT NULL DEFAULT 0,
        restart_count INTEGER NOT NULL DEFAULT 0,
        communication_error_count INTEGER NOT NULL DEFAULT 0,
        last_seen_at TEXT,
        evaluated_at TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id,device_id)
      );
      CREATE INDEX IF NOT EXISTS idx_iot_device_health_scope ON iot_device_health(company_id,health_state);

      CREATE TABLE IF NOT EXISTS iot_device_alerts (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        sensor_id TEXT,
        alert_type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'warning' CHECK(severity IN ('info','warning','critical')),
        message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','assigned','resolved','suppressed')),
        rule_id TEXT,
        acknowledged_by TEXT,
        acknowledged_at TEXT,
        assigned_to TEXT,
        resolved_by TEXT,
        resolved_at TEXT,
        resolution_note TEXT,
        suppressed_until TEXT,
        work_item_proposal_json TEXT,
        notification_proposal_json TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_iot_device_alerts_scope ON iot_device_alerts(company_id,device_id,status,severity);

      CREATE TABLE IF NOT EXISTS iot_firmware_catalogue (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        version TEXT NOT NULL,
        checksum TEXT NOT NULL,
        device_model TEXT NOT NULL,
        compatibility_json TEXT NOT NULL DEFAULT '[]',
        release_notes TEXT,
        approval_state TEXT NOT NULL DEFAULT 'draft' CHECK(approval_state IN ('draft','approved','rejected','archived')),
        approved_by TEXT,
        approved_at TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id,device_model,version)
      );
      CREATE INDEX IF NOT EXISTS idx_iot_firmware_catalogue_scope ON iot_firmware_catalogue(company_id,device_model,approval_state);

      CREATE TABLE IF NOT EXISTS iot_firmware_rollouts (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        firmware_id TEXT NOT NULL REFERENCES iot_firmware_catalogue(id),
        target_group_json TEXT NOT NULL DEFAULT '{}',
        staged_plan_json TEXT NOT NULL DEFAULT '{}',
        simulator INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','in_progress','completed','failed','rolled_back')),
        success_count INTEGER NOT NULL DEFAULT 0,
        failure_count INTEGER NOT NULL DEFAULT 0,
        rollback_reason TEXT,
        started_at TEXT,
        completed_at TEXT,
        idempotency_key TEXT UNIQUE,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_iot_firmware_rollouts_scope ON iot_firmware_rollouts(company_id,firmware_id,status);

      CREATE TABLE IF NOT EXISTS iot_config_profiles (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        name TEXT NOT NULL,
        profile_version INTEGER NOT NULL DEFAULT 1,
        device_model TEXT,
        desired_config_json TEXT NOT NULL DEFAULT '{}',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id,name,profile_version)
      );
      CREATE INDEX IF NOT EXISTS idx_iot_config_profiles_scope ON iot_config_profiles(company_id,device_model,is_active);

      CREATE TABLE IF NOT EXISTS iot_device_config_state (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        device_id TEXT NOT NULL UNIQUE,
        profile_id TEXT,
        desired_config_json TEXT NOT NULL DEFAULT '{}',
        reported_config_json TEXT NOT NULL DEFAULT '{}',
        drift INTEGER NOT NULL DEFAULT 0,
        drift_details_json TEXT NOT NULL DEFAULT '[]',
        remediation_proposal_json TEXT,
        evaluated_at TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id,device_id)
      );
      CREATE INDEX IF NOT EXISTS idx_iot_device_config_state_scope ON iot_device_config_state(company_id,drift);

      CREATE TABLE IF NOT EXISTS iot_device_commands (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        command_type TEXT CHECK(command_type IN ('request_status','request_telemetry_sample','refresh_configuration','reboot_simulation','activate_simulated_output','deactivate_simulated_output','locate_device_simulation','ping')),
        parameters_json TEXT NOT NULL DEFAULT '{}',
        risk_level TEXT NOT NULL DEFAULT 'low' CHECK(risk_level IN ('low','high')),
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','rejected','queued','dispatched','acknowledged','completed','failed','expired','cancelled')),
        requires_approval INTEGER NOT NULL DEFAULT 0,
        requested_by TEXT,
        approved_by TEXT,
        approved_at TEXT,
        rejected_reason TEXT,
        dispatched_at TEXT,
        acknowledged_at TEXT,
        completed_at TEXT,
        result_json TEXT,
        failure_reason TEXT,
        retry_of TEXT,
        correlation_id TEXT,
        expires_at TEXT,
        idempotency_key TEXT UNIQUE,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_iot_device_commands_scope ON iot_device_commands(company_id,device_id,status);
    `);

    const now = new Date().toISOString();
    registerModule(db, now);

    const entity = db.prepare(`INSERT INTO platform_entities(id,module_id,storage_owner,primary_key,label_ar,label_en,section,chatter,fields,relations,scope,lifecycle_policy,query_policy,action_policy,customization_policy,history_policy,api_exposed,migration_owner,created_at,updated_at)
      VALUES(?,'iot_devices','platform.iot','id',?,?,'iot',0,'{}','{}','company','governed','scoped','registered','metadata','audit',1,'082_build10_telemetry_health_commands',?,?)
      ON CONFLICT(id) DO NOTHING`);
    ENTITIES.forEach(([id, ar, en]) => entity.run(id, ar, en, now, now));

    const action = db.prepare(`INSERT INTO platform_actions(id,module_id,entity_id,kind,allowed_states,required_permission,required_scope,input_schema,preconditions,transaction_owner,idempotency_policy,sequence_policy,audit_policy,outbox_policy,error_contract,created_at,updated_at)
      VALUES(?,'iot_devices',?,'domain','[]',?,'company','{}','[]','platform_action_executor','required','none','required','required','{}',?,?)
      ON CONFLICT(id) DO UPDATE SET required_permission=excluded.required_permission,required_scope=excluded.required_scope,updated_at=excluded.updated_at`);
    ACTIONS.forEach(([id, entityId, permission]) => action.run(id, entityId, permission, now, now));

    const permission = db.prepare(`INSERT INTO authorization_permissions(id,module_id,kind,resource,action,label_ar,label_en,sensitive,depends_on,deprecated,created_at,updated_at)
      VALUES(?,'iot_devices','action',?,?,?, ?,?,'[]',0,?,?)
      ON CONFLICT(id) DO UPDATE SET sensitive=excluded.sensitive,updated_at=excluded.updated_at`);
    PERMISSIONS.forEach(([id, resource, verb, sensitive]) => permission.run(id, resource, verb, id, id, sensitive, now, now));
  },

  down(db) {
    ACTIONS.forEach(([id]) => db.prepare('DELETE FROM platform_actions WHERE id=?').run(id));
    PERMISSIONS.forEach(([id]) => db.prepare('DELETE FROM authorization_permissions WHERE id=?').run(id));
    ENTITIES.forEach(([id]) => db.prepare('DELETE FROM platform_entities WHERE id=?').run(id));
    const now = new Date().toISOString();
    db.prepare(`UPDATE platform_modules SET version='10.0.0',capabilities=?,migrations=?,updated_at=? WHERE id=?`).run(
      JSON.stringify(['devices', 'gateways', 'sensors']),
      JSON.stringify(['081_build10_iot_device_registry']),
      now, MODULE_ID,
    );
    db.exec(`
      DROP TABLE IF EXISTS iot_device_commands;
      DROP TABLE IF EXISTS iot_device_config_state;
      DROP TABLE IF EXISTS iot_config_profiles;
      DROP TABLE IF EXISTS iot_firmware_rollouts;
      DROP TABLE IF EXISTS iot_firmware_catalogue;
      DROP TABLE IF EXISTS iot_device_alerts;
      DROP TABLE IF EXISTS iot_device_health;
      DROP TABLE IF EXISTS iot_telemetry_events;
      DROP TABLE IF EXISTS iot_telemetry_raw;
    `);
  },
};

export default migration;
