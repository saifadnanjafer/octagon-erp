// 059_fleet_and_telematics.mjs — Fleet Management & Telematics Adapters (Checkpoint E3).

const MODULE_ID = 'platform.kernel';
const FLEET_MODULE = 'fleet_telematics';
const migrationIdSelf = '059_fleet_and_telematics';

const ENTITIES = [
  ['fleet_vehicle', FLEET_MODULE, 'platform.fleet', 'Fleet Vehicle'],
  ['fleet_driver', FLEET_MODULE, 'platform.fleet', 'Fleet Driver'],
  ['fleet_assignment', FLEET_MODULE, 'platform.fleet', 'Driver Assignment'],
  ['fleet_trip', FLEET_MODULE, 'platform.fleet', 'Fleet Trip'],
  ['fleet_fuel_log', FLEET_MODULE, 'platform.fleet', 'Fuel Log'],
  ['fleet_telemetry_event', FLEET_MODULE, 'platform.fleet', 'Telemetry Event'],
];

const ACTIONS = [
  ['fleet:vehicle:create', 'fleet_vehicle', 'fleet:vehicle:write', ['name', 'registration_number']],
  ['fleet:driver:create', 'fleet_driver', 'fleet:driver:write', ['name', 'license_number']],
  ['fleet:driver:assign', 'fleet_assignment', 'fleet:vehicle:write', ['vehicle_id', 'driver_id']],
  ['fleet:trip:record', 'fleet_trip', 'fleet:trip:write', ['vehicle_id', 'driver_id', 'start_odometer', 'end_odometer']],
  ['fleet:fuel:record', 'fleet_fuel_log', 'fleet:fuel:write', ['vehicle_id', 'fuel_qty', 'total_cost']],
  ['fleet:telemetry:ingest', 'fleet_telemetry_event', 'fleet:telemetry:write', ['vehicle_id', 'provider_type', 'event_type']],
];

function registerModule(db, id, name, capabilities, now) {
  db.prepare(`
    INSERT INTO platform_modules (
      id, name, version, status, kind, owner, dependencies, optional_dependencies,
      capabilities, migrations, settings, created_at, updated_at
    ) VALUES (?, ?, '1.0.0', 'enabled', 'standard', 'operations', ?, '[]', ?, ?, '{}', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      version = excluded.version,
      status = excluded.status,
      dependencies = excluded.dependencies,
      capabilities = excluded.capabilities,
      migrations = excluded.migrations,
      updated_at = excluded.updated_at
  `).run(
    id, name,
    JSON.stringify(['platform_kernel', 'assets_management', 'operations_maintenance']),
    JSON.stringify(capabilities),
    JSON.stringify([migrationIdSelf]),
    now, now,
  );

  const companies = db.prepare('SELECT id FROM platform_companies').all();
  const insertAssignment = db.prepare(`
    INSERT INTO platform_module_assignments (
      id, module_id, scope_type, scope_id, enabled, navigation_visible,
      configuration_url, configuration_status, version, created_at, updated_at, updated_by
    ) VALUES (?, ?, 'company', ?, 1, 1, ?, 'ready', 1, ?, ?, 'migration:059')
    ON CONFLICT(module_id, scope_type, scope_id) DO NOTHING
  `);
  for (const company of companies) {
    insertAssignment.run(`pma_${id}_${company.id}`, id, company.id, `/${id}`, now, now);
  }
}

export const migration = {
  id: migrationIdSelf,
  owner: MODULE_ID,
  version: '1.38.0',
  parent: '058_maintenance_management',
  dependsOn: ['058_maintenance_management'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Clean-room implementation on Assets, Maintenance, Work Items, Inventory, and Telematics adapter foundations.',

  up(db) {
    const now = new Date().toISOString();

    db.exec(`
      CREATE TABLE IF NOT EXISTS fleet_vehicles (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        branch_id TEXT,
        asset_id TEXT REFERENCES assets(id),
        vehicle_number TEXT NOT NULL,
        name TEXT NOT NULL,
        registration_number TEXT NOT NULL,
        vin TEXT NOT NULL DEFAULT '',
        make TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        year INTEGER NOT NULL DEFAULT 2024,
        vehicle_type TEXT NOT NULL DEFAULT 'car'
          CHECK(vehicle_type IN ('car','truck','van','bus','machinery')),
        license_plate TEXT NOT NULL DEFAULT '',
        current_driver_id TEXT,
        current_odometer REAL NOT NULL DEFAULT 0.0 CHECK(current_odometer >= 0),
        current_engine_hours REAL NOT NULL DEFAULT 0.0 CHECK(current_engine_hours >= 0),
        fuel_type TEXT NOT NULL DEFAULT 'diesel' CHECK(fuel_type IN ('diesel','gasoline','electric','hybrid')),
        fuel_tank_capacity REAL NOT NULL DEFAULT 60.0 CHECK(fuel_tank_capacity > 0),
        expected_consumption_per_100km REAL NOT NULL DEFAULT 10.0 CHECK(expected_consumption_per_100km > 0),
        status TEXT NOT NULL DEFAULT 'active'
          CHECK(status IN ('active','in_service','out_of_service','disposed')),
        license_expiry TEXT,
        insurance_expiry TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, vehicle_number)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS fleet_drivers (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        driver_number TEXT NOT NULL,
        name TEXT NOT NULL,
        license_number TEXT NOT NULL,
        license_class TEXT NOT NULL DEFAULT 'C',
        license_expiry TEXT,
        mobile TEXT NOT NULL DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, driver_number)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS fleet_assignments (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        vehicle_id TEXT NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
        driver_id TEXT NOT NULL REFERENCES fleet_drivers(id),
        start_date TEXT NOT NULL,
        end_date TEXT,
        start_odometer REAL NOT NULL DEFAULT 0.0,
        end_odometer REAL,
        notes TEXT NOT NULL DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS fleet_trips (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        trip_number TEXT NOT NULL,
        vehicle_id TEXT NOT NULL REFERENCES fleet_vehicles(id),
        driver_id TEXT NOT NULL REFERENCES fleet_drivers(id),
        project_id TEXT REFERENCES projects(id),
        work_item_id TEXT REFERENCES work_items(id),
        route_name TEXT NOT NULL DEFAULT '',
        origin TEXT NOT NULL DEFAULT '',
        destination TEXT NOT NULL DEFAULT '',
        start_time TEXT NOT NULL,
        end_time TEXT,
        start_odometer REAL NOT NULL DEFAULT 0.0,
        end_odometer REAL,
        distance_km REAL NOT NULL DEFAULT 0.0 CHECK(distance_km >= 0),
        start_engine_hours REAL NOT NULL DEFAULT 0.0,
        end_engine_hours REAL,
        engine_hours REAL NOT NULL DEFAULT 0.0 CHECK(engine_hours >= 0),
        state TEXT NOT NULL DEFAULT 'planned' CHECK(state IN ('planned','in_progress','completed','cancelled')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, trip_number)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS fleet_fuel_logs (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        vehicle_id TEXT NOT NULL REFERENCES fleet_vehicles(id),
        driver_id TEXT REFERENCES fleet_drivers(id),
        trip_id TEXT REFERENCES fleet_trips(id),
        fuel_card_number TEXT NOT NULL DEFAULT '',
        transaction_date TEXT NOT NULL,
        odometer REAL NOT NULL DEFAULT 0.0,
        fuel_qty REAL NOT NULL CHECK(fuel_qty > 0),
        unit_price REAL NOT NULL DEFAULT 0.0,
        total_cost REAL NOT NULL DEFAULT 0.0,
        vendor TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        expected_consumption REAL NOT NULL DEFAULT 0.0,
        variance_qty REAL NOT NULL DEFAULT 0.0,
        variance_percent REAL NOT NULL DEFAULT 0.0,
        anomaly_flag INTEGER NOT NULL DEFAULT 0,
        anomaly_notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_fleet_fuel_vehicle ON fleet_fuel_logs(company_id, vehicle_id);

      CREATE TABLE IF NOT EXISTS fleet_telemetry_events (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        vehicle_id TEXT NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
        provider_type TEXT NOT NULL DEFAULT 'gps' CHECK(provider_type IN ('gps','obd','geofence','tank_sensor')),
        event_type TEXT NOT NULL CHECK(event_type IN ('location','speed_alert','geofence_enter','geofence_exit','fuel_drop','dtc_code')),
        timestamp TEXT NOT NULL,
        latitude REAL,
        longitude REAL,
        speed REAL,
        odometer REAL,
        engine_hours REAL,
        fuel_level REAL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_fleet_telemetry_vehicle ON fleet_telemetry_events(vehicle_id, timestamp);
    `);

    registerModule(db, FLEET_MODULE, 'Fleet Operations & Telematics', ['fleet.vehicle', 'fleet.trip', 'fleet.fuel'], now);

    const insertEntity = db.prepare(`
      INSERT INTO platform_entities (
        id, module_id, storage_owner, primary_key, label_ar, label_en, section,
        chatter, fields, relations, scope, lifecycle_policy, query_policy,
        action_policy, customization_policy, history_policy, api_exposed,
        migration_owner, created_at, updated_at
      ) VALUES (?, ?, ?, 'id', ?, ?, 'operations', 1, '{}', '{}', 'company',
        'generic', 'scoped', 'registered', 'metadata', 'audit', 1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        module_id = excluded.module_id,
        storage_owner = excluded.storage_owner,
        label_en = excluded.label_en,
        query_policy = 'scoped',
        action_policy = 'registered',
        history_policy = 'audit',
        updated_at = excluded.updated_at
    `);
    for (const [id, moduleId, storageOwner, label] of ENTITIES) {
      insertEntity.run(id, moduleId, storageOwner, label, label, moduleId, now, now);
    }

    const insertAction = db.prepare(`
      INSERT INTO platform_actions (
        id, module_id, entity_id, kind, allowed_states, required_permission,
        required_scope, input_schema, preconditions, transaction_owner,
        idempotency_policy, sequence_policy, audit_policy, outbox_policy,
        reversal_action, result_schema, error_contract, created_at, updated_at
      ) VALUES (?, ?, ?, 'domain', '[]', ?, 'company', ?, '[]',
        'platform_action_executor', 'required', 'none', 'required', 'required',
        NULL, NULL, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        module_id = excluded.module_id,
        entity_id = excluded.entity_id,
        required_permission = excluded.required_permission,
        input_schema = excluded.input_schema,
        transaction_owner = excluded.transaction_owner,
        idempotency_policy = excluded.idempotency_policy,
        audit_policy = excluded.audit_policy,
        outbox_policy = excluded.outbox_policy,
        error_contract = excluded.error_contract,
        updated_at = excluded.updated_at
    `);
    const errorContract = JSON.stringify({
      envelope: 'stable',
      rollback: 'atomic',
      codes: ['INPUT_MISSING_FIELD', 'PRECONDITION_FAILED', 'VEHICLE_NOT_FOUND'],
    });
    for (const [actionId, entityId, permission, required] of ACTIONS) {
      insertAction.run(
        actionId, FLEET_MODULE, entityId, permission,
        JSON.stringify({ type: 'object', required }),
        errorContract, now, now,
      );
    }
  },

  down(db) {
    const deleteAction = db.prepare('DELETE FROM platform_actions WHERE id = ?');
    for (const [actionId] of ACTIONS) deleteAction.run(actionId);
    const deleteEntity = db.prepare('DELETE FROM platform_entities WHERE id = ?');
    for (const [id] of ENTITIES) deleteEntity.run(id);

    db.prepare('DELETE FROM platform_module_assignments WHERE module_id = ?').run(FLEET_MODULE);
    db.prepare('DELETE FROM platform_modules WHERE id = ?').run(FLEET_MODULE);

    db.exec(`
      DROP TABLE IF EXISTS fleet_telemetry_events;
      DROP TABLE IF EXISTS fleet_fuel_logs;
      DROP TABLE IF EXISTS fleet_trips;
      DROP TABLE IF EXISTS fleet_assignments;
      DROP TABLE IF EXISTS fleet_drivers;
      DROP TABLE IF EXISTS fleet_vehicles;
    `);
  },
};
