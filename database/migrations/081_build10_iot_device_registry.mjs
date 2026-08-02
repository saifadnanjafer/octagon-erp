// BUILD-10 Slice 1: IoT device registry, gateways and sensors.
'use strict';

const MODULE_ID = 'iot_devices';

const ENTITIES = [
  ['iot_device', 'جهاز إنترنت الأشياء', 'IoT Device'],
  ['iot_gateway', 'بوابة إنترنت الأشياء', 'IoT Gateway'],
  ['iot_sensor', 'حساس إنترنت الأشياء', 'IoT Sensor'],
];

const ACTIONS = [
  ['iot:device_register', 'iot_device', 'iot:device:write'],
  ['iot:device_update_draft', 'iot_device', 'iot:device:write'],
  ['iot:device_assign_asset', 'iot_device', 'iot:device:write'],
  ['iot:device_assign_vehicle', 'iot_device', 'iot:device:write'],
  ['iot:device_assign_site', 'iot_device', 'iot:device:write'],
  ['iot:device_assign_gateway', 'iot_device', 'iot:device:write'],
  ['iot:device_enroll_simulated', 'iot_device', 'iot:device:enroll'],
  ['iot:device_activate', 'iot_device', 'iot:device:activate'],
  ['iot:device_suspend', 'iot_device', 'iot:device:activate'],
  ['iot:device_resume', 'iot_device', 'iot:device:activate'],
  ['iot:device_revoke', 'iot_device', 'iot:device:revoke'],
  ['iot:device_mark_lost', 'iot_device', 'iot:device:revoke'],
  ['iot:device_replace', 'iot_device', 'iot:device:revoke'],
  ['iot:device_retire', 'iot_device', 'iot:device:revoke'],
  ['iot:device_rotate_credential', 'iot_device', 'iot:device:revoke'],
  ['iot:device_update_configuration', 'iot_device', 'iot:device:write'],
  ['iot:device_record_installation', 'iot_device', 'iot:device:write'],
  ['iot:device_record_health_check', 'iot_device', 'iot:device:write'],
  ['iot:gateway_register', 'iot_gateway', 'iot:gateway:admin'],
  ['iot:gateway_update', 'iot_gateway', 'iot:gateway:admin'],
  ['iot:gateway_assign_device', 'iot_gateway', 'iot:gateway:admin'],
  ['iot:gateway_suspend', 'iot_gateway', 'iot:gateway:admin'],
  ['iot:gateway_resume', 'iot_gateway', 'iot:gateway:admin'],
  ['iot:sensor_register', 'iot_sensor', 'iot:sensor:admin'],
  ['iot:sensor_configure', 'iot_sensor', 'iot:sensor:admin'],
  ['iot:sensor_calibrate', 'iot_sensor', 'iot:sensor:admin'],
  ['iot:sensor_set_thresholds', 'iot_sensor', 'iot:sensor:admin'],
  ['iot:sensor_set_active', 'iot_sensor', 'iot:sensor:admin'],
];

const PERMISSIONS = [
  ['iot:device:view', 'iot_device', 'view', 0],
  ['iot:device:write', 'iot_device', 'write', 1],
  ['iot:device:enroll', 'iot_device', 'enroll', 1],
  ['iot:device:activate', 'iot_device', 'activate', 1],
  ['iot:device:revoke', 'iot_device', 'revoke', 1],
  ['iot:gateway:admin', 'iot_gateway', 'admin', 1],
  ['iot:sensor:admin', 'iot_sensor', 'admin', 1],
];

function registerModule(db, now) {
  db.prepare(`
    INSERT INTO platform_modules (
      id, name, version, status, kind, owner, dependencies, optional_dependencies,
      capabilities, migrations, settings, created_at, updated_at
    ) VALUES (?, 'IoT Device Registry', '10.0.0', 'enabled', 'standard', 'operations', ?, '[]', ?, ?, '{}', ?, ?)
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
    JSON.stringify(['devices', 'gateways', 'sensors']),
    JSON.stringify(['081_build10_iot_device_registry']),
    now, now,
  );

  const companies = db.prepare('SELECT id FROM platform_companies').all();
  const insertAssignment = db.prepare(`
    INSERT INTO platform_module_assignments (
      id, module_id, scope_type, scope_id, enabled, navigation_visible,
      configuration_url, configuration_status, version, created_at, updated_at, updated_by
    ) VALUES (?, ?, 'company', ?, 1, 1, ?, 'ready', 1, ?, ?, 'migration:081')
    ON CONFLICT(module_id, scope_type, scope_id) DO NOTHING
  `);
  for (const company of companies) {
    insertAssignment.run(`pma_${MODULE_ID}_${company.id}`, MODULE_ID, company.id, `/${MODULE_ID}`, now, now);
  }
}

export const migration = {
  id: '081_build10_iot_device_registry',
  owner: 'iot_devices',
  version: '10.0.0',
  parent: '080_build09_quality_rework_scrap',
  dependsOn: ['080_build09_quality_rework_scrap'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'BUILD-10 IoT device registry, gateways and sensors (Slice 1)',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS iot_devices (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        branch_id TEXT,
        site TEXT,
        external_ref TEXT NOT NULL,
        device_type TEXT NOT NULL CHECK(device_type IN ('gateway','sensor','tracker','kiosk','display')),
        manufacturer TEXT,
        model TEXT,
        hardware_revision TEXT,
        serial_number TEXT,
        gateway_id TEXT,
        asset_id TEXT,
        vehicle_id TEXT REFERENCES fleet_vehicles(id),
        warehouse_id TEXT,
        work_center_id TEXT,
        employee_id TEXT,
        timezone TEXT,
        connectivity_type TEXT,
        protocol_metadata_json TEXT NOT NULL DEFAULT '{}',
        installation_date TEXT,
        activation_date TEXT,
        last_seen_at TEXT,
        health_state TEXT NOT NULL DEFAULT 'unknown' CHECK(health_state IN ('online','offline','degraded','warning','critical','unknown')),
        lifecycle_state TEXT NOT NULL DEFAULT 'draft' CHECK(lifecycle_state IN ('draft','enrollment_pending','enrolled','active','suspended','offline','degraded','retired','revoked','lost','replaced')),
        provider TEXT,
        simulator_provider TEXT,
        firmware_version TEXT,
        configuration_version TEXT,
        ownership TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        notes TEXT,
        credential_ref TEXT,
        replaced_by_device_id TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id,external_ref)
      );
      CREATE INDEX IF NOT EXISTS idx_iot_devices_scope ON iot_devices(company_id,branch_id,lifecycle_state);
      CREATE INDEX IF NOT EXISTS idx_iot_devices_links ON iot_devices(company_id,gateway_id,vehicle_id,device_type);

      CREATE TABLE IF NOT EXISTS iot_gateways (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        branch_id TEXT,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        site TEXT,
        connectivity_type TEXT,
        protocol_metadata_json TEXT NOT NULL DEFAULT '{}',
        buffering_json TEXT NOT NULL DEFAULT '{}',
        simulator_config_json TEXT NOT NULL DEFAULT '{}',
        lifecycle_state TEXT NOT NULL DEFAULT 'active' CHECK(lifecycle_state IN ('active','suspended','offline','retired')),
        last_seen_at TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id,code)
      );
      CREATE INDEX IF NOT EXISTS idx_iot_gateways_scope ON iot_gateways(company_id,branch_id,lifecycle_state);

      CREATE TABLE IF NOT EXISTS iot_sensors (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        branch_id TEXT,
        device_id TEXT NOT NULL REFERENCES iot_devices(id),
        gateway_id TEXT,
        channel TEXT NOT NULL,
        measurement_type TEXT CHECK(measurement_type IN ('latitude','longitude','speed','heading','odometer','engine_hours','fuel_level','tank_level','voltage','temperature','humidity','vibration','pressure','runtime','machine_state','door_state','binary_alarm')),
        engineering_unit TEXT,
        calibration_date TEXT,
        calibration_status TEXT NOT NULL DEFAULT 'valid' CHECK(calibration_status IN ('valid','due','overdue','unknown')),
        expected_interval_seconds INTEGER,
        range_min REAL,
        range_max REAL,
        warning_min REAL,
        warning_max REAL,
        critical_min REAL,
        critical_max REAL,
        data_quality_state TEXT NOT NULL DEFAULT 'unknown' CHECK(data_quality_state IN ('good','suspect','bad','unknown')),
        last_reading_json TEXT,
        last_good_reading_json TEXT,
        connectivity_state TEXT NOT NULL DEFAULT 'unknown',
        battery_level REAL,
        signal_strength REAL,
        clock_skew_seconds REAL NOT NULL DEFAULT 0,
        last_sequence INTEGER,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id,device_id,channel)
      );
      CREATE INDEX IF NOT EXISTS idx_iot_sensors_scope ON iot_sensors(company_id,branch_id,is_active);
      CREATE INDEX IF NOT EXISTS idx_iot_sensors_device ON iot_sensors(company_id,device_id,gateway_id);
    `);

    const now = new Date().toISOString();
    registerModule(db, now);

    const entity = db.prepare(`INSERT INTO platform_entities(id,module_id,storage_owner,primary_key,label_ar,label_en,section,chatter,fields,relations,scope,lifecycle_policy,query_policy,action_policy,customization_policy,history_policy,api_exposed,migration_owner,created_at,updated_at)
      VALUES(?,'iot_devices','platform.iot','id',?,?,'iot',0,'{}','{}','company','governed','scoped','registered','metadata','audit',1,'081_build10_iot_device_registry',?,?)
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
    db.prepare('DELETE FROM platform_module_assignments WHERE module_id=?').run(MODULE_ID);
    db.prepare('DELETE FROM platform_modules WHERE id=?').run(MODULE_ID);
    db.exec(`
      DROP TABLE IF EXISTS iot_sensors;
      DROP TABLE IF EXISTS iot_gateways;
      DROP TABLE IF EXISTS iot_devices;
    `);
  },
};

export default migration;
