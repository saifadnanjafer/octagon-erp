// BUILD-10 Slice 3: Fleet Telematics, Trips, Geofences, Speed/Driver Events, Fuel Telemetry & Maintenance Triggers
'use strict';

const MODULE_ID = 'fleet_telematics_exp';

const ENTITIES = [
  ['fleet_device_mapping', 'ربط أجهزة أسطول السيارات', 'Fleet Device Mapping'],
  ['fleet_trip_projection', 'رحلات الأسطول', 'Fleet Trip Projection'],
  ['fleet_location_point', 'نقطة موقع الأسطول', 'Fleet Location Point'],
  ['fleet_geofence', 'النطاق الجغرافي', 'Fleet Geofence'],
  ['fleet_geofence_event', 'حدث النطاق الجغرافي', 'Fleet Geofence Event'],
  ['fleet_speed_event', 'حدث السرعة والسياقة', 'Fleet Speed Event'],
  ['fleet_fuel_telemetry', 'قياس الوقود والاشتباه في الهدر', 'Fleet Fuel Telemetry'],
  ['fleet_maintenance_trigger', 'محفزات الصيانة التلقائية', 'Fleet Maintenance Trigger'],
];

const ACTIONS = [
  ['fleet:device_map', 'fleet_device_mapping', 'fleet:telematics:admin'],
  ['fleet:device_unmap', 'fleet_device_mapping', 'fleet:telematics:admin'],
  ['fleet:calibrate_odometer', 'fleet_device_mapping', 'fleet:telematics:admin'],
  ['fleet:calibrate_fuel_sensor', 'fleet_device_mapping', 'fleet:telematics:admin'],
  ['fleet:location_record', 'fleet_location_point', 'fleet:telematics:write'],
  ['fleet:trip_start', 'fleet_trip_projection', 'fleet:telematics:write'],
  ['fleet:trip_end', 'fleet_trip_projection', 'fleet:telematics:write'],
  ['fleet:geofence_create', 'fleet_geofence', 'fleet:geofence:admin'],
  ['fleet:geofence_update', 'fleet_geofence', 'fleet:geofence:admin'],
  ['fleet:geofence_evaluate', 'fleet_geofence_event', 'fleet:geofence:write'],
  ['fleet:geofence_acknowledge', 'fleet_geofence_event', 'fleet:geofence:write'],
  ['fleet:speed_event_record', 'fleet_speed_event', 'fleet:telematics:write'],
  ['fleet:speed_event_acknowledge', 'fleet_speed_event', 'fleet:telematics:write'],
  ['fleet:fuel_reading_record', 'fleet_fuel_telemetry', 'fleet:fuel:write'],
  ['fleet:fuel_anomaly_investigate', 'fleet_fuel_telemetry', 'fleet:fuel:admin'],
  ['fleet:maintenance_trigger_evaluate', 'fleet_maintenance_trigger', 'fleet:maintenance:admin'],
  ['fleet:maintenance_trigger_acknowledge', 'fleet_maintenance_trigger', 'fleet:maintenance:admin'],
];

const PERMISSIONS = [
  ['fleet:telematics:view', 'fleet_telematics', 'view', 0],
  ['fleet:telematics:write', 'fleet_telematics', 'write', 1],
  ['fleet:telematics:admin', 'fleet_telematics', 'admin', 1],
  ['fleet:geofence:admin', 'fleet_geofence', 'admin', 1],
  ['fleet:geofence:write', 'fleet_geofence', 'write', 1],
  ['fleet:fuel:write', 'fleet_fuel', 'write', 1],
  ['fleet:fuel:admin', 'fleet_fuel', 'admin', 1],
  ['fleet:maintenance:admin', 'fleet_maintenance', 'admin', 1],
];

function registerModule(db, now) {
  db.prepare(`
    INSERT INTO platform_modules (
      id, name, version, status, kind, owner, dependencies, optional_dependencies,
      capabilities, migrations, settings, created_at, updated_at
    ) VALUES (?, 'Fleet Telematics Expansion', '10.2.0', 'enabled', 'standard', 'operations', ?, '[]', ?, ?, '{}', ?, ?)
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
    JSON.stringify(['platform_kernel', 'iot_devices', 'fleet_telematics']),
    JSON.stringify(['fleet_mapping', 'trips', 'geofences', 'speed_events', 'fuel_telemetry', 'maintenance_triggers']),
    JSON.stringify(['081_build10_iot_device_registry', '082_build10_telemetry_health_commands', '083_build10_fleet_telematics_geofences']),
    now, now,
  );

  const companies = db.prepare('SELECT id FROM platform_companies').all();
  const insertAssignment = db.prepare(`
    INSERT INTO platform_module_assignments (
      id, module_id, scope_type, scope_id, enabled, navigation_visible,
      configuration_url, configuration_status, version, created_at, updated_at, updated_by
    ) VALUES (?, ?, 'company', ?, 1, 1, ?, 'ready', 1, ?, ?, 'migration:083')
    ON CONFLICT(module_id, scope_type, scope_id) DO NOTHING
  `);
  for (const company of companies) {
    insertAssignment.run(`pma_${MODULE_ID}_${company.id}`, MODULE_ID, company.id, `/${MODULE_ID}`, now, now);
  }
}

export const migration = {
  id: '083_build10_fleet_telematics_geofences',
  owner: 'fleet_telematics_exp',
  version: '10.2.0',
  parent: '082_build10_telemetry_health_commands',
  dependsOn: ['082_build10_telemetry_health_commands'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'BUILD-10 Fleet telematics mapping, trips, geofences, fuel and maintenance triggers (Slice 3)',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS fleet_device_mappings (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        branch_id TEXT,
        vehicle_id TEXT NOT NULL REFERENCES fleet_vehicles(id),
        asset_id TEXT,
        tracker_device_id TEXT REFERENCES iot_devices(id),
        fuel_sensor_device_id TEXT REFERENCES iot_devices(id),
        driver_id TEXT,
        installation_date TEXT NOT NULL,
        removal_date TEXT,
        odometer_offset_km REAL NOT NULL DEFAULT 0,
        fuel_calibration_json TEXT NOT NULL DEFAULT '{}',
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_fleet_device_mappings_scope ON fleet_device_mappings(company_id,vehicle_id,is_active);

      CREATE TABLE IF NOT EXISTS fleet_location_points (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        vehicle_id TEXT NOT NULL REFERENCES fleet_vehicles(id),
        device_id TEXT REFERENCES iot_devices(id),
        driver_id TEXT,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        speed_kmh REAL NOT NULL DEFAULT 0,
        heading REAL DEFAULT 0,
        accuracy_meters REAL,
        ignition_state INTEGER NOT NULL DEFAULT 1 CHECK(ignition_state IN (0,1)),
        timestamp TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_fleet_location_points_scope ON fleet_location_points(company_id,vehicle_id,timestamp);

      CREATE TABLE IF NOT EXISTS fleet_trip_projections (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        branch_id TEXT,
        vehicle_id TEXT NOT NULL REFERENCES fleet_vehicles(id),
        driver_id TEXT,
        start_location_point_id TEXT,
        end_location_point_id TEXT,
        start_time TEXT NOT NULL,
        end_time TEXT,
        distance_km REAL NOT NULL DEFAULT 0,
        duration_minutes REAL NOT NULL DEFAULT 0,
        idle_duration_minutes REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','completed','cancelled')),
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_fleet_trip_projections_scope ON fleet_trip_projections(company_id,vehicle_id,status);

      CREATE TABLE IF NOT EXISTS fleet_geofences (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        branch_id TEXT,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('circle','polygon','site','warehouse','customer_site','restricted')),
        center_latitude REAL,
        center_longitude REAL,
        radius_meters REAL,
        polygon_coords_json TEXT NOT NULL DEFAULT '[]',
        speed_limit_kmh REAL,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_fleet_geofences_scope ON fleet_geofences(company_id,is_active);

      CREATE TABLE IF NOT EXISTS fleet_geofence_events (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        geofence_id TEXT NOT NULL REFERENCES fleet_geofences(id),
        vehicle_id TEXT NOT NULL REFERENCES fleet_vehicles(id),
        driver_id TEXT,
        event_type TEXT NOT NULL CHECK(event_type IN ('entry','exit','dwell','unauthorized_entry','unauthorized_exit')),
        severity TEXT NOT NULL DEFAULT 'info' CHECK(severity IN ('info','warning','critical')),
        dwell_duration_minutes REAL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','resolved')),
        acknowledged_by TEXT,
        acknowledged_at TEXT,
        work_item_proposal_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_fleet_geofence_events_scope ON fleet_geofence_events(company_id,vehicle_id,status);

      CREATE TABLE IF NOT EXISTS fleet_speed_events (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        vehicle_id TEXT NOT NULL REFERENCES fleet_vehicles(id),
        driver_id TEXT,
        speed_kmh REAL NOT NULL,
        speed_limit_kmh REAL NOT NULL,
        duration_seconds REAL NOT NULL DEFAULT 0,
        event_type TEXT NOT NULL CHECK(event_type IN ('speeding','harsh_acceleration','harsh_braking','excessive_idling','route_deviation','unauthorized_after_hours')),
        severity TEXT NOT NULL DEFAULT 'warning' CHECK(severity IN ('info','warning','critical')),
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','resolved')),
        acknowledged_by TEXT,
        acknowledged_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_fleet_speed_events_scope ON fleet_speed_events(company_id,vehicle_id,status);

      CREATE TABLE IF NOT EXISTS fleet_fuel_telemetry (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        vehicle_id TEXT NOT NULL REFERENCES fleet_vehicles(id),
        sensor_device_id TEXT REFERENCES iot_devices(id),
        raw_fuel_percentage REAL NOT NULL,
        calibrated_liters REAL NOT NULL,
        event_classification TEXT NOT NULL DEFAULT 'normal_consumption' CHECK(event_classification IN ('normal_consumption','refuel','suspected_fuel_loss','sensor_anomaly')),
        drop_liters REAL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'normal' CHECK(status IN ('normal','investigation_required','acknowledged','resolved')),
        investigation_work_item_proposal_json TEXT,
        acknowledged_by TEXT,
        acknowledged_at TEXT,
        timestamp TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_fleet_fuel_telemetry_scope ON fleet_fuel_telemetry(company_id,vehicle_id,status);

      CREATE TABLE IF NOT EXISTS fleet_maintenance_triggers (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        vehicle_id TEXT NOT NULL REFERENCES fleet_vehicles(id),
        trigger_type TEXT NOT NULL CHECK(trigger_type IN ('odometer','engine_hours','calendar','fault_code','critical_alert')),
        threshold_value REAL NOT NULL,
        current_value REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'triggered' CHECK(status IN ('triggered','proposal_created','acknowledged','resolved')),
        canonical_maintenance_request_proposal_json TEXT,
        acknowledged_by TEXT,
        acknowledged_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_fleet_maintenance_triggers_scope ON fleet_maintenance_triggers(company_id,vehicle_id,status);
    `);

    const now = new Date().toISOString();
    registerModule(db, now);

    const entity = db.prepare(`INSERT INTO platform_entities(id,module_id,storage_owner,primary_key,label_ar,label_en,section,chatter,fields,relations,scope,lifecycle_policy,query_policy,action_policy,customization_policy,history_policy,api_exposed,migration_owner,created_at,updated_at)
      VALUES(?,'fleet_telematics_exp','platform.fleet','id',?,?,'fleet',0,'{}','{}','company','governed','scoped','registered','metadata','audit',1,'083_build10_fleet_telematics_geofences',?,?)
      ON CONFLICT(id) DO NOTHING`);
    ENTITIES.forEach(([id, ar, en]) => entity.run(id, ar, en, now, now));

    const action = db.prepare(`INSERT INTO platform_actions(id,module_id,entity_id,kind,allowed_states,required_permission,required_scope,input_schema,preconditions,transaction_owner,idempotency_policy,sequence_policy,audit_policy,outbox_policy,error_contract,created_at,updated_at)
      VALUES(?,'fleet_telematics_exp',?,'domain','[]',?,'company','{}','[]','platform_action_executor','required','none','required','required','{}',?,?)
      ON CONFLICT(id) DO UPDATE SET required_permission=excluded.required_permission,required_scope=excluded.required_scope,updated_at=excluded.updated_at`);
    ACTIONS.forEach(([id, entityId, permission]) => action.run(id, entityId, permission, now, now));

    const permission = db.prepare(`INSERT INTO authorization_permissions(id,module_id,kind,resource,action,label_ar,label_en,sensitive,depends_on,deprecated,created_at,updated_at)
      VALUES(?,'fleet_telematics_exp','action',?,?,?, ?,?,'[]',0,?,?)
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
      DROP TABLE IF EXISTS fleet_maintenance_triggers;
      DROP TABLE IF EXISTS fleet_fuel_telemetry;
      DROP TABLE IF EXISTS fleet_speed_events;
      DROP TABLE IF EXISTS fleet_geofence_events;
      DROP TABLE IF EXISTS fleet_geofences;
      DROP TABLE IF EXISTS fleet_trip_projections;
      DROP TABLE IF EXISTS fleet_location_points;
      DROP TABLE IF EXISTS fleet_device_mappings;
    `);
  },
};

export default migration;
