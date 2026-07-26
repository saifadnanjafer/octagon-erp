// 048_assets_maintenance_and_fleet — Phase 05 Wave C
//
// Source composition:
// - Odoo 19 `addons/account_asset`, `addons/maintenance`, `addons/fleet`
//   (LGPL-3, clean-room reference only): asset lifecycle vocabulary,
//   preventive-maintenance request/order split, and the fleet document-expiry
//   pattern.
// - ERPNext `erpnext/assets` (GPL-3, clean-room reference only): the
//   depreciation-schedule-row model (one row per period, each independently
//   postable) which is what makes a partially posted schedule recoverable.
// - Octagon Phase 03 `032_asset_accounting_interface` already shipped the
//   posting contract (`finance_asset_categories`, `capitalizeAsset`,
//   `postAssetDepreciation`, `disposeAsset`) and deliberately shipped no
//   register. This migration is that register, and nothing more: Phase 05
//   computes and schedules, Phase 03 posts.
//
// Fleet is deliberately NOT a second maintenance system. A vehicle IS an asset
// (`fleet_vehicles.asset_id`), and vehicle servicing IS a maintenance order.

const MODULES = [
  ['asset_core', 'Assets', ['register', 'depreciation', 'assignments', 'warranty', 'disposal']],
  ['maintenance_core', 'Maintenance', ['requests', 'plans', 'orders', 'spare_parts', 'downtime']],
  ['fleet_core', 'Fleet', ['vehicles', 'drivers', 'trips', 'fuel', 'documents', 'telemetry']],
];

const ENTITIES = [
  ['asset', 'asset_core', 'platform.assets', 'Asset'],
  ['asset_category', 'asset_core', 'platform.assets', 'Asset Category'],
  ['depreciation_schedule', 'asset_core', 'platform.assets', 'Depreciation Schedule'],
  ['maintenance_request', 'maintenance_core', 'platform.maintenance', 'Maintenance Request'],
  ['maintenance_plan', 'maintenance_core', 'platform.maintenance', 'Maintenance Plan'],
  ['maintenance_order', 'maintenance_core', 'platform.maintenance', 'Maintenance Order'],
  ['fleet_vehicle', 'fleet_core', 'platform.fleet', 'Vehicle'],
  ['fleet_trip', 'fleet_core', 'platform.fleet', 'Trip'],
  ['fleet_fuel_transaction', 'fleet_core', 'platform.fleet', 'Fuel Transaction'],
];

const ACTIONS = [
  ['asset:category:create', 'asset_core', 'asset_category', 'asset:config:write', ['code', 'name']],
  ['asset:create', 'asset_core', 'asset', 'asset:write', ['name']],
  ['asset:acquire', 'asset_core', 'asset', 'asset:write', ['asset_id']],
  ['asset:capitalize', 'asset_core', 'asset', 'asset:capitalize', ['asset_id']],
  ['asset:schedule:generate', 'asset_core', 'depreciation_schedule', 'asset:write', ['asset_id']],
  ['asset:depreciation:post', 'asset_core', 'depreciation_schedule', 'asset:depreciate', ['asset_id']],
  ['asset:assign', 'asset_core', 'asset', 'asset:write', ['asset_id']],
  ['asset:transfer', 'asset_core', 'asset', 'asset:write', ['asset_id']],
  ['asset:warranty:register', 'asset_core', 'asset', 'asset:write', ['asset_id']],
  ['asset:suspend', 'asset_core', 'asset', 'asset:write', ['asset_id']],
  ['asset:reactivate', 'asset_core', 'asset', 'asset:write', ['asset_id']],
  ['asset:dispose', 'asset_core', 'asset', 'asset:dispose', ['asset_id']],
  ['asset:write_off', 'asset_core', 'asset', 'asset:dispose', ['asset_id']],
  ['asset:meter:record', 'asset_core', 'asset', 'asset:write', ['asset_id', 'reading']],

  ['maintenance:team:create', 'maintenance_core', 'maintenance_request', 'maintenance:config:write', ['code', 'name']],
  ['maintenance:request:create', 'maintenance_core', 'maintenance_request', 'maintenance:write', ['title']],
  ['maintenance:plan:create', 'maintenance_core', 'maintenance_plan', 'maintenance:config:write', ['name', 'trigger_type']],
  ['maintenance:plan:generate', 'maintenance_core', 'maintenance_order', 'maintenance:write', []],
  ['maintenance:order:create', 'maintenance_core', 'maintenance_order', 'maintenance:write', ['title']],
  ['maintenance:order:approve', 'maintenance_core', 'maintenance_order', 'maintenance:approve', ['order_id']],
  ['maintenance:order:start', 'maintenance_core', 'maintenance_order', 'maintenance:write', ['order_id']],
  ['maintenance:part:issue', 'maintenance_core', 'maintenance_order', 'maintenance:write', ['order_id', 'product_id', 'quantity']],
  ['maintenance:labor:record', 'maintenance_core', 'maintenance_order', 'maintenance:write', ['order_id', 'hours']],
  ['maintenance:order:complete', 'maintenance_core', 'maintenance_order', 'maintenance:write', ['order_id']],
  ['maintenance:order:hold', 'maintenance_core', 'maintenance_order', 'maintenance:write', ['order_id']],
  ['maintenance:order:return_to_service', 'maintenance_core', 'maintenance_order', 'maintenance:approve', ['order_id']],
  ['maintenance:order:cancel', 'maintenance_core', 'maintenance_order', 'maintenance:approve', ['order_id']],
  // Meter readings are recorded against the ASSET (`asset:meter:record`); the
  // maintenance meter trigger reads them. There is deliberately no second
  // maintenance-side meter writer.

  ['fleet:vehicle_type:create', 'fleet_core', 'fleet_vehicle', 'fleet:config:write', ['code', 'name']],
  ['fleet:vehicle:create', 'fleet_core', 'fleet_vehicle', 'fleet:write', ['name']],
  ['fleet:telemetry:provider', 'fleet_core', 'fleet_vehicle', 'fleet:config:write', ['provider_code', 'provider_kind']],
  ['fleet:driver:register', 'fleet_core', 'fleet_vehicle', 'fleet:write', ['driver_ref']],
  ['fleet:assignment:create', 'fleet_core', 'fleet_vehicle', 'fleet:write', ['vehicle_id', 'driver_id']],
  ['fleet:document:register', 'fleet_core', 'fleet_vehicle', 'fleet:write', ['vehicle_id', 'document_type']],
  ['fleet:trip:start', 'fleet_core', 'fleet_trip', 'fleet:write', ['vehicle_id']],
  ['fleet:trip:complete', 'fleet_core', 'fleet_trip', 'fleet:write', ['trip_id']],
  ['fleet:fuel:record', 'fleet_core', 'fleet_fuel_transaction', 'fleet:fuel:write', ['vehicle_id', 'quantity']],
  ['fleet:odometer:record', 'fleet_core', 'fleet_vehicle', 'fleet:write', ['vehicle_id', 'reading']],
  ['fleet:incident:record', 'fleet_core', 'fleet_vehicle', 'fleet:write', ['vehicle_id', 'incident_type']],
  ['fleet:telemetry:ingest', 'fleet_core', 'fleet_vehicle', 'fleet:telemetry:write', ['vehicle_id', 'provider', 'event_type']],
];

export const migration = {
  id: '048_assets_maintenance_and_fleet',
  owner: 'asset_core',
  version: '1.24.3',
  parent: '047_projects_and_job_costing',
  dependsOn: ['047_projects_and_job_costing'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Phase 05 Wave C — canonical asset register, maintenance engine and fleet foundation over the Phase 03 asset posting contract; clean-room references: Odoo 19 account_asset/maintenance/fleet, ERPNext assets',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS asset_categories (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        finance_category_id TEXT REFERENCES finance_asset_categories(id),
        default_useful_life_months INTEGER NOT NULL DEFAULT 60 CHECK(default_useful_life_months > 0),
        default_method TEXT NOT NULL DEFAULT 'straight_line' CHECK(default_method IN ('straight_line','declining_balance','units_of_production')),
        default_residual_percent REAL NOT NULL DEFAULT 0 CHECK(default_residual_percent >= 0 AND default_residual_percent < 100),
        asset_class TEXT NOT NULL DEFAULT 'equipment' CHECK(asset_class IN ('equipment','vehicle','building','land','it','furniture','tool','other')),
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        UNIQUE(company_id, code)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        branch_id TEXT,
        category_id TEXT NOT NULL REFERENCES asset_categories(id),
        asset_tag TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        serial_number TEXT,
        product_id TEXT REFERENCES product_variants(id),
        supplier_party_id TEXT REFERENCES parties(id),
        source_purchase_order_id TEXT REFERENCES purchase_orders(id),
        source_project_id TEXT REFERENCES projects(id),
        source_production_order_id TEXT REFERENCES production_orders(id),
        state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','acquired','pending_capitalization','active','under_maintenance','suspended','disposed','written_off')),
        acquisition_date TEXT,
        acquisition_value REAL NOT NULL DEFAULT 0 CHECK(acquisition_value >= 0),
        capitalization_date TEXT,
        capitalized_value REAL NOT NULL DEFAULT 0 CHECK(capitalized_value >= 0),
        capitalization_document_id TEXT REFERENCES finance_documents(id),
        useful_life_months INTEGER NOT NULL DEFAULT 60 CHECK(useful_life_months > 0),
        depreciation_method TEXT NOT NULL DEFAULT 'straight_line' CHECK(depreciation_method IN ('straight_line','declining_balance','units_of_production')),
        declining_rate_percent REAL NOT NULL DEFAULT 0 CHECK(declining_rate_percent >= 0),
        total_expected_units REAL NOT NULL DEFAULT 0 CHECK(total_expected_units >= 0),
        residual_value REAL NOT NULL DEFAULT 0 CHECK(residual_value >= 0),
        accumulated_depreciation REAL NOT NULL DEFAULT 0 CHECK(accumulated_depreciation >= 0),
        impairment_value REAL NOT NULL DEFAULT 0 CHECK(impairment_value >= 0),
        revaluation_value REAL NOT NULL DEFAULT 0,
        location_id TEXT REFERENCES stock_locations(id),
        custodian_ref TEXT,
        department_ref TEXT,
        currency TEXT NOT NULL DEFAULT 'IQD',
        disposal_date TEXT,
        disposal_document_id TEXT REFERENCES finance_documents(id),
        disposal_proceeds REAL NOT NULL DEFAULT 0 CHECK(disposal_proceeds >= 0),
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        UNIQUE(company_id, asset_tag)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_assets_state ON assets(company_id, state);
      CREATE INDEX IF NOT EXISTS idx_assets_category ON assets(company_id, category_id);

      CREATE TABLE IF NOT EXISTS asset_components (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        name TEXT NOT NULL,
        serial_number TEXT,
        product_id TEXT REFERENCES product_variants(id),
        installed_at TEXT,
        removed_at TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS asset_assignments (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        assignment_type TEXT NOT NULL DEFAULT 'custodian' CHECK(assignment_type IN ('custodian','department','location','project','cost_center')),
        employee_ref TEXT,
        department_ref TEXT,
        location_id TEXT REFERENCES stock_locations(id),
        project_id TEXT REFERENCES projects(id),
        assigned_at TEXT NOT NULL,
        released_at TEXT,
        assigned_by TEXT NOT NULL,
        notes TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS asset_warranties (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        provider_party_id TEXT REFERENCES parties(id),
        reference TEXT,
        coverage TEXT,
        starts_on TEXT NOT NULL,
        expires_on TEXT NOT NULL,
        alert_days_before INTEGER NOT NULL DEFAULT 30,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS depreciation_schedules (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        period_index INTEGER NOT NULL CHECK(period_index > 0),
        period_date TEXT NOT NULL,
        depreciation_amount REAL NOT NULL CHECK(depreciation_amount >= 0),
        accumulated_after REAL NOT NULL CHECK(accumulated_after >= 0),
        net_book_value_after REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'IQD',
        status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','posted','skipped','cancelled')),
        finance_document_id TEXT REFERENCES finance_documents(id),
        posted_at TEXT,
        posted_by TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(asset_id, period_index)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_depreciation_due ON depreciation_schedules(company_id, status, period_date);

      CREATE TABLE IF NOT EXISTS asset_meter_readings (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        meter_type TEXT NOT NULL DEFAULT 'hours' CHECK(meter_type IN ('hours','kilometers','cycles','units')),
        reading REAL NOT NULL CHECK(reading >= 0),
        reading_at TEXT NOT NULL,
        recorded_by TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_asset_meter ON asset_meter_readings(asset_id, meter_type, reading_at);

      CREATE TABLE IF NOT EXISTS maintenance_teams (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        members TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        UNIQUE(company_id, code)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS maintenance_requests (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        reference TEXT NOT NULL,
        asset_id TEXT REFERENCES assets(id),
        work_center_id TEXT REFERENCES work_centers(id),
        location_id TEXT REFERENCES stock_locations(id),
        title TEXT NOT NULL,
        description TEXT,
        maintenance_type TEXT NOT NULL DEFAULT 'corrective' CHECK(maintenance_type IN ('preventive','corrective','emergency','inspection','calibration')),
        priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')),
        symptom TEXT,
        failure_code TEXT,
        state TEXT NOT NULL DEFAULT 'new' CHECK(state IN ('new','triaged','converted','rejected','cancelled')),
        requested_by TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        order_id TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, reference)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS maintenance_plans (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        asset_id TEXT REFERENCES assets(id),
        asset_category_id TEXT REFERENCES asset_categories(id),
        maintenance_type TEXT NOT NULL DEFAULT 'preventive' CHECK(maintenance_type IN ('preventive','inspection','calibration')),
        trigger_type TEXT NOT NULL CHECK(trigger_type IN ('calendar','meter','both')),
        interval_days INTEGER NOT NULL DEFAULT 0 CHECK(interval_days >= 0),
        meter_type TEXT CHECK(meter_type IN ('hours','kilometers','cycles','units')),
        meter_interval REAL NOT NULL DEFAULT 0 CHECK(meter_interval >= 0),
        lead_days INTEGER NOT NULL DEFAULT 0 CHECK(lead_days >= 0),
        team_id TEXT REFERENCES maintenance_teams(id),
        checklist TEXT NOT NULL DEFAULT '[]',
        spare_parts TEXT NOT NULL DEFAULT '[]',
        estimated_hours REAL NOT NULL DEFAULT 0 CHECK(estimated_hours >= 0),
        quality_plan_id TEXT REFERENCES quality_plans(id),
        last_generated_at TEXT,
        last_generated_meter REAL,
        next_due_date TEXT,
        next_due_meter REAL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, code)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS maintenance_orders (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        branch_id TEXT,
        reference TEXT NOT NULL,
        request_id TEXT REFERENCES maintenance_requests(id),
        plan_id TEXT REFERENCES maintenance_plans(id),
        asset_id TEXT REFERENCES assets(id),
        vehicle_id TEXT,
        work_center_id TEXT REFERENCES work_centers(id),
        location_id TEXT REFERENCES stock_locations(id),
        project_id TEXT REFERENCES projects(id),
        work_item_id TEXT REFERENCES work_items(id),
        title TEXT NOT NULL,
        description TEXT,
        maintenance_type TEXT NOT NULL DEFAULT 'corrective' CHECK(maintenance_type IN ('preventive','corrective','emergency','inspection','calibration')),
        priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')),
        state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','approved','scheduled','in_progress','waiting_parts','quality_hold','completed','closed','cancelled')),
        team_id TEXT REFERENCES maintenance_teams(id),
        technician_ref TEXT,
        service_provider_party_id TEXT REFERENCES parties(id),
        scheduled_start TEXT,
        scheduled_end TEXT,
        actual_start TEXT,
        actual_end TEXT,
        downtime_minutes REAL NOT NULL DEFAULT 0 CHECK(downtime_minutes >= 0),
        planned_hours REAL NOT NULL DEFAULT 0 CHECK(planned_hours >= 0),
        actual_hours REAL NOT NULL DEFAULT 0 CHECK(actual_hours >= 0),
        checklist TEXT NOT NULL DEFAULT '[]',
        permits TEXT NOT NULL DEFAULT '[]',
        failure_code TEXT,
        symptom TEXT,
        root_cause TEXT,
        corrective_action TEXT,
        parts_cost REAL NOT NULL DEFAULT 0 CHECK(parts_cost >= 0),
        labor_cost REAL NOT NULL DEFAULT 0 CHECK(labor_cost >= 0),
        external_cost REAL NOT NULL DEFAULT 0 CHECK(external_cost >= 0),
        currency TEXT NOT NULL DEFAULT 'IQD',
        quality_inspection_id TEXT REFERENCES quality_inspections(id),
        generation_key TEXT,
        approved_by TEXT,
        approved_at TEXT,
        returned_to_service_at TEXT,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        UNIQUE(company_id, reference)
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_maintenance_generation_key
        ON maintenance_orders(company_id, generation_key) WHERE generation_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_maintenance_orders_state ON maintenance_orders(company_id, state);
      CREATE INDEX IF NOT EXISTS idx_maintenance_orders_asset ON maintenance_orders(company_id, asset_id);

      CREATE TABLE IF NOT EXISTS maintenance_parts (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES maintenance_orders(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        quantity REAL NOT NULL CHECK(quantity > 0),
        value REAL NOT NULL DEFAULT 0,
        stock_move_id TEXT REFERENCES stock_moves(id),
        finance_document_id TEXT REFERENCES finance_documents(id),
        issued_by TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        UNIQUE(stock_move_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS maintenance_labor_entries (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES maintenance_orders(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        technician_ref TEXT NOT NULL,
        hours REAL NOT NULL CHECK(hours > 0),
        rate_per_hour REAL NOT NULL DEFAULT 0 CHECK(rate_per_hour >= 0),
        amount REAL NOT NULL DEFAULT 0 CHECK(amount >= 0),
        currency TEXT NOT NULL DEFAULT 'IQD',
        finance_document_id TEXT REFERENCES finance_documents(id),
        recorded_by TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS fleet_vehicle_types (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'truck',
        expected_consumption_per_100 REAL NOT NULL DEFAULT 0 CHECK(expected_consumption_per_100 >= 0),
        created_at TEXT NOT NULL,
        UNIQUE(company_id, code)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS fleet_vehicles (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        branch_id TEXT,
        asset_id TEXT REFERENCES assets(id),
        vehicle_type_id TEXT REFERENCES fleet_vehicle_types(id),
        name TEXT NOT NULL,
        plate_number TEXT,
        chassis_vin TEXT,
        registration_number TEXT,
        ownership TEXT NOT NULL DEFAULT 'owned' CHECK(ownership IN ('owned','leased','rented','customer')),
        lease_party_id TEXT REFERENCES parties(id),
        lease_start TEXT,
        lease_end TEXT,
        fuel_type TEXT NOT NULL DEFAULT 'diesel',
        tank_capacity REAL NOT NULL DEFAULT 0 CHECK(tank_capacity >= 0),
        expected_consumption_per_100 REAL NOT NULL DEFAULT 0 CHECK(expected_consumption_per_100 >= 0),
        odometer REAL NOT NULL DEFAULT 0 CHECK(odometer >= 0),
        engine_hours REAL NOT NULL DEFAULT 0 CHECK(engine_hours >= 0),
        state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','under_maintenance','suspended','disposed')),
        currency TEXT NOT NULL DEFAULT 'IQD',
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, plate_number)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS fleet_drivers (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        driver_ref TEXT NOT NULL,
        name TEXT NOT NULL,
        licence_number TEXT,
        licence_expiry TEXT,
        phone TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        UNIQUE(company_id, driver_ref)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS fleet_assignments (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        vehicle_id TEXT NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
        driver_id TEXT NOT NULL REFERENCES fleet_drivers(id),
        assigned_at TEXT NOT NULL,
        released_at TEXT,
        assigned_by TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS fleet_documents (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        vehicle_id TEXT NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
        document_type TEXT NOT NULL CHECK(document_type IN ('registration','insurance','licence','inspection','permit','other')),
        reference TEXT,
        provider_party_id TEXT REFERENCES parties(id),
        issued_on TEXT,
        expires_on TEXT NOT NULL,
        alert_days_before INTEGER NOT NULL DEFAULT 30,
        cost REAL NOT NULL DEFAULT 0 CHECK(cost >= 0),
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_fleet_documents_expiry ON fleet_documents(company_id, expires_on);

      CREATE TABLE IF NOT EXISTS fleet_trips (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        vehicle_id TEXT NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
        driver_id TEXT REFERENCES fleet_drivers(id),
        project_id TEXT REFERENCES projects(id),
        reference TEXT NOT NULL,
        route TEXT,
        origin TEXT,
        destination TEXT,
        dispatch_note TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        start_odometer REAL NOT NULL DEFAULT 0 CHECK(start_odometer >= 0),
        end_odometer REAL,
        distance_km REAL NOT NULL DEFAULT 0 CHECK(distance_km >= 0),
        state TEXT NOT NULL DEFAULT 'in_progress' CHECK(state IN ('planned','in_progress','completed','cancelled')),
        created_by TEXT NOT NULL,
        UNIQUE(company_id, reference)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS fleet_fuel_cards (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        card_number TEXT NOT NULL,
        vehicle_id TEXT REFERENCES fleet_vehicles(id),
        driver_id TEXT REFERENCES fleet_drivers(id),
        provider_party_id TEXT REFERENCES parties(id),
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        UNIQUE(company_id, card_number)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS fleet_fuel_tanks (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        location_id TEXT REFERENCES stock_locations(id),
        product_id TEXT REFERENCES product_variants(id),
        capacity REAL NOT NULL DEFAULT 0 CHECK(capacity >= 0),
        current_level REAL NOT NULL DEFAULT 0 CHECK(current_level >= 0),
        sensor_provider TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(company_id, code)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS fleet_fuel_transactions (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        vehicle_id TEXT NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
        driver_id TEXT REFERENCES fleet_drivers(id),
        trip_id TEXT REFERENCES fleet_trips(id),
        tank_id TEXT REFERENCES fleet_fuel_tanks(id),
        fuel_card_id TEXT REFERENCES fleet_fuel_cards(id),
        product_id TEXT REFERENCES product_variants(id),
        quantity REAL NOT NULL CHECK(quantity > 0),
        unit_price REAL NOT NULL DEFAULT 0 CHECK(unit_price >= 0),
        amount REAL NOT NULL DEFAULT 0 CHECK(amount >= 0),
        currency TEXT NOT NULL DEFAULT 'IQD',
        odometer REAL,
        expected_quantity REAL,
        variance_quantity REAL,
        variance_percent REAL,
        source TEXT NOT NULL DEFAULT 'manual',
        external_reference TEXT,
        stock_move_id TEXT REFERENCES stock_moves(id),
        finance_document_id TEXT REFERENCES finance_documents(id),
        recorded_by TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        UNIQUE(company_id, external_reference)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_fleet_fuel_vehicle ON fleet_fuel_transactions(company_id, vehicle_id, recorded_at);

      CREATE TABLE IF NOT EXISTS fleet_incidents (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        vehicle_id TEXT NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
        driver_id TEXT REFERENCES fleet_drivers(id),
        incident_type TEXT NOT NULL CHECK(incident_type IN ('accident','violation','breakdown','theft','damage','other')),
        description TEXT,
        occurred_at TEXT NOT NULL,
        cost REAL NOT NULL DEFAULT 0 CHECK(cost >= 0),
        maintenance_order_id TEXT REFERENCES maintenance_orders(id),
        work_item_id TEXT REFERENCES work_items(id),
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','investigating','resolved','closed')),
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS fleet_telemetry_providers (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        provider_code TEXT NOT NULL,
        provider_kind TEXT NOT NULL CHECK(provider_kind IN ('obd','gps','tank_sensor','tyre','camera','other')),
        config TEXT NOT NULL DEFAULT '{}',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        UNIQUE(company_id, provider_code)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS fleet_telemetry_events (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        vehicle_id TEXT NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
        provider_code TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        odometer REAL,
        engine_hours REAL,
        latitude REAL,
        longitude REAL,
        speed_kph REAL,
        fuel_level REAL,
        occurred_at TEXT NOT NULL,
        external_reference TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(company_id, provider_code, external_reference)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS fleet_alerts (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        vehicle_id TEXT REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
        alert_type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'medium' CHECK(severity IN ('low','medium','high','critical')),
        message TEXT NOT NULL,
        source_reference TEXT,
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','resolved')),
        raised_at TEXT NOT NULL,
        resolved_at TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS fleet_geofences (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        name TEXT NOT NULL,
        centre_latitude REAL NOT NULL,
        centre_longitude REAL NOT NULL,
        radius_metres REAL NOT NULL CHECK(radius_metres > 0),
        speed_limit_kph REAL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS fleet_tyres (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        vehicle_id TEXT NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
        position TEXT NOT NULL,
        serial_number TEXT,
        product_id TEXT REFERENCES product_variants(id),
        fitted_odometer REAL NOT NULL DEFAULT 0,
        removed_odometer REAL,
        state TEXT NOT NULL DEFAULT 'fitted' CHECK(state IN ('fitted','removed','scrapped')),
        created_at TEXT NOT NULL
      ) STRICT;
    `);

    const now = new Date().toISOString();
    const insertFlag = db.prepare(`
      INSERT INTO platform_feature_flags (key, module_id, scope, enabled, audit_policy, created_at, updated_at)
      VALUES (?, ?, 'global', 1, 'required', ?, ?)
      ON CONFLICT(key) DO NOTHING
    `);
    registerCatalogue(db, now);
    insertFlag.run('phase05.assets.enabled', 'asset_core', now, now);
    insertFlag.run('phase05.maintenance.enabled', 'maintenance_core', now, now);
    insertFlag.run('phase05.fleet.enabled', 'fleet_core', now, now);

    const insertPolicy = db.prepare(`
      INSERT INTO phase05_operating_policies (company_id, policy_key, policy_value, updated_at, updated_by)
      VALUES (?, ?, ?, ?, 'migration_048')
      ON CONFLICT(company_id, policy_key) DO NOTHING
    `);
    for (const company of db.prepare('SELECT id FROM platform_companies').all()) {
      insertPolicy.run(company.id, 'depreciation_posting_cadence', 'manual_approved', now);
      insertPolicy.run(company.id, 'asset_capitalization_requires_approval', '1', now);
      insertPolicy.run(company.id, 'fleet_fuel_variance_tolerance_percent', '10', now);
      insertPolicy.run(company.id, 'maintenance_return_to_service_requires_inspection', '1', now);
    }
  },

  down(db) {
    const deleteAction = db.prepare('DELETE FROM platform_actions WHERE id = ?');
    for (const [id] of ACTIONS) deleteAction.run(id);
    const deleteEntity = db.prepare('DELETE FROM platform_entities WHERE id = ?');
    for (const [id] of ENTITIES) deleteEntity.run(id);
    for (const key of ['phase05.assets.enabled', 'phase05.maintenance.enabled', 'phase05.fleet.enabled']) {
      db.prepare('DELETE FROM platform_feature_flags WHERE key = ?').run(key);
    }
    const deleteModule = db.prepare('DELETE FROM platform_modules WHERE id = ?');
    for (const [id] of MODULES.slice().reverse()) deleteModule.run(id);

    db.exec(`
      DROP TABLE IF EXISTS fleet_tyres;
      DROP TABLE IF EXISTS fleet_geofences;
      DROP TABLE IF EXISTS fleet_alerts;
      DROP TABLE IF EXISTS fleet_telemetry_events;
      DROP TABLE IF EXISTS fleet_telemetry_providers;
      DROP TABLE IF EXISTS fleet_incidents;
      DROP TABLE IF EXISTS fleet_fuel_transactions;
      DROP TABLE IF EXISTS fleet_fuel_tanks;
      DROP TABLE IF EXISTS fleet_fuel_cards;
      DROP TABLE IF EXISTS fleet_trips;
      DROP TABLE IF EXISTS fleet_documents;
      DROP TABLE IF EXISTS fleet_assignments;
      DROP TABLE IF EXISTS fleet_drivers;
      DROP TABLE IF EXISTS fleet_vehicles;
      DROP TABLE IF EXISTS fleet_vehicle_types;
      DROP TABLE IF EXISTS maintenance_labor_entries;
      DROP TABLE IF EXISTS maintenance_parts;
      DROP TABLE IF EXISTS maintenance_orders;
      DROP TABLE IF EXISTS maintenance_plans;
      DROP TABLE IF EXISTS maintenance_requests;
      DROP TABLE IF EXISTS maintenance_teams;
      DROP TABLE IF EXISTS asset_meter_readings;
      DROP TABLE IF EXISTS depreciation_schedules;
      DROP TABLE IF EXISTS asset_warranties;
      DROP TABLE IF EXISTS asset_assignments;
      DROP TABLE IF EXISTS asset_components;
      DROP TABLE IF EXISTS assets;
      DROP TABLE IF EXISTS asset_categories;
    `);
  },
};

function registerCatalogue(db, now) {
  const insertModule = db.prepare(`
    INSERT INTO platform_modules (
      id, name, version, status, kind, owner, dependencies, optional_dependencies,
      capabilities, migrations, settings, created_at, updated_at
    ) VALUES (?, ?, '1.24.3', 'enabled', 'standard', 'octagon', ?, '[]', ?, ?, '[]', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, version = excluded.version, status = excluded.status,
      capabilities = excluded.capabilities, migrations = excluded.migrations,
      updated_at = excluded.updated_at
  `);
  for (const [id, name, capabilities] of MODULES) {
    insertModule.run(
      id, name, JSON.stringify(['platform_kernel', 'finance_canonical', 'work_item_canonical']),
      JSON.stringify(capabilities), JSON.stringify(['048_assets_maintenance_and_fleet']), now, now,
    );
  }

  const insertEntity = db.prepare(`
    INSERT INTO platform_entities (
      id, module_id, storage_owner, primary_key, label_ar, label_en, section,
      chatter, fields, relations, scope, lifecycle_policy, query_policy,
      action_policy, customization_policy, history_policy, api_exposed,
      migration_owner, created_at, updated_at
    ) VALUES (?, ?, ?, 'id', ?, ?, 'operations', 1, '{}', '{}', 'company',
      'generic', 'scoped', 'registered', 'metadata', 'audit', 1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      module_id = excluded.module_id, storage_owner = excluded.storage_owner,
      label_en = excluded.label_en, updated_at = excluded.updated_at
  `);
  for (const [id, moduleId, storageOwner, label] of ENTITIES) {
    insertEntity.run(id, moduleId, storageOwner, label, label, moduleId, now, now);
  }

  const errorContract = JSON.stringify({
    envelope: 'stable',
    rollback: 'register mutation, stock consequence, finance consequence, audit, outbox and idempotency are atomic',
    codes: [
      'INPUT_MISSING_FIELD', 'IDEMPOTENCY_KEY_REQUIRED', 'UNTRUSTED_ACTION_SCOPE',
      'ASSET_STATE_INVALID', 'ASSET_CATEGORY_NOT_MAPPED', 'DEPRECIATION_ALREADY_POSTED',
      'MAINTENANCE_STATE_INVALID', 'QUALITY_HOLD_ACTIVE', 'FLEET_DUPLICATE_FUEL_TRANSACTION',
    ],
  });
  const insertAction = db.prepare(`
    INSERT INTO platform_actions (
      id, module_id, entity_id, kind, allowed_states, required_permission,
      required_scope, input_schema, preconditions, transaction_owner,
      idempotency_policy, sequence_policy, audit_policy, outbox_policy,
      reversal_action, result_schema, error_contract, created_at, updated_at
    ) VALUES (?, ?, ?, 'domain', '[]', ?, 'company', ?, '[]',
      'platform_action_executor', 'required', 'none', 'required', 'required',
      ?, NULL, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      module_id = excluded.module_id, entity_id = excluded.entity_id,
      required_permission = excluded.required_permission,
      input_schema = excluded.input_schema, reversal_action = excluded.reversal_action,
      error_contract = excluded.error_contract, updated_at = excluded.updated_at
  `);
  const reversals = {
    'asset:capitalize': 'asset:write_off',
    'asset:suspend': 'asset:reactivate',
    'asset:assign': 'asset:transfer',
    'maintenance:order:create': 'maintenance:order:cancel',
  };
  for (const [id, moduleId, entityId, permission, required] of ACTIONS) {
    insertAction.run(
      id, moduleId, entityId, permission,
      JSON.stringify({ type: 'object', required }),
      reversals[id] || null, errorContract, now, now,
    );
  }
}
