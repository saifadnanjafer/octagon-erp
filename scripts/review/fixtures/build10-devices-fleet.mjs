// Disposable BUILD-10 device, fleet and edge fixtures.
//
// The BUILD-10 workspaces (IoT device registry and health, gateways, alerts,
// fleet vehicles/drivers/telemetry, kiosks and offline sync) are wired to real
// governed tables, but no review fixture ever seeded a single row into any of
// them. Around thirty primary pages therefore rendered an honest empty state and
// could not demonstrate the workflow they implement.
//
// This seeds the smallest fictional set that lets each family show its real
// shape: one gateway with one device behind it, that device's health record and
// one open alert, one vehicle with a driver and one recorded location point, one
// kiosk, and one registered offline client. Everything is explicitly marked as a
// disposable review fixture and is never operational truth.
//
// Telemetry deliberately stays sparse: a location point is a recorded fact, but
// no fabricated speed/fuel history is invented here — that is the pattern the
// Fleet page was fixed for.

'use strict';

const NOW = () => new Date().toISOString();

export function seedBuild10DeviceFleetFixtures(dialect, { tenantId, companyId, branchId, now } = {}) {
  const ts = now || NOW();
  const actor = 'disposable-review-fixture';
  const run = (sql, ...args) => dialect.prepare(sql).run(...args);

  const gatewayId = 'rev_iot_gw_01';
  run(`INSERT INTO iot_gateways (id, company_id, branch_id, code, name, site, connectivity_type,
        protocol_metadata_json, buffering_json, simulator_config_json, lifecycle_state,
        last_seen_at, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO NOTHING`,
    gatewayId, companyId, branchId, 'REV-GW-01', 'بوابة المراجعة — الورشة', 'Al-Warsha Main',
    'ethernet', '{}', '{}', '{}', 'active', ts, actor, ts, ts);

  const deviceId = 'rev_iot_dev_01';
  run(`INSERT INTO iot_devices (id, company_id, branch_id, site, external_ref, device_type,
        manufacturer, model, serial_number, gateway_id, connectivity_type,
        protocol_metadata_json, installation_date, activation_date, last_seen_at,
        health_state, lifecycle_state, provider, firmware_version, ownership, tags_json,
        notes, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO NOTHING`,
    deviceId, companyId, branchId, 'Al-Warsha Main', 'REV-DEV-01', 'sensor',
    'ReviewCo', 'RV-100', 'SN-REV-0001', gatewayId, 'ethernet',
    '{}', ts.slice(0, 10), ts.slice(0, 10), ts,
    'online', 'active', 'review-fixture', '1.0.0', 'owned', '[]',
    'سجل مراجعة تجريبي', actor, ts, ts);

  run(`INSERT INTO iot_device_health (id, company_id, device_id, health_state, health_score,
        missed_interval_count, sensor_fault, gateway_fault, data_quality_fault,
        firmware_mismatch, config_mismatch, restart_count, communication_error_count,
        last_seen_at, evaluated_at, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO NOTHING`,
    'rev_iot_health_01', companyId, deviceId, 'online', 98,
    0, 0, 0, 0, 0, 0, 0, 0, ts, ts, actor, ts, ts);

  run(`INSERT INTO iot_device_alerts (id, company_id, device_id, alert_type, severity, message,
        status, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO NOTHING`,
    'rev_iot_alert_01', companyId, deviceId, 'missed_heartbeat', 'warning',
    'نبضة متأخرة من جهاز المراجعة — سجل تجريبي', 'open', actor, ts, ts);

  const driverId = 'rev_fleet_driver_01';
  run(`INSERT INTO fleet_drivers (id, company_id, driver_number, name, license_number,
        license_class, license_expiry, mobile, is_active, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO NOTHING`,
    driverId, companyId, 'REV-DRV-01', 'سائق المراجعة', 'LIC-REV-0001',
    'C', null, '0000000000', 1, ts, ts);

  const vehicleId = 'rev_fleet_vehicle_01';
  run(`INSERT INTO fleet_vehicles (id, company_id, branch_id, vehicle_number, name,
        registration_number, vin, make, model, year, vehicle_type, license_plate,
        current_driver_id, current_odometer, current_engine_hours, fuel_type,
        fuel_tank_capacity, expected_consumption_per_100km, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO NOTHING`,
    vehicleId, companyId, branchId, 'REV-VEH-01', 'شاحنة المراجعة',
    'REV-1234', 'VINREVIEW00000001', 'ReviewMotors', 'RM-7', 2024, 'truck', 'REV-1234',
    driverId, 12000, 480, 'diesel',
    200, 22, 'active', ts, ts);

  run(`INSERT INTO fleet_location_points (id, company_id, vehicle_id, device_id, driver_id,
        latitude, longitude, speed_kmh, heading, accuracy_meters, ignition_state, timestamp, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO NOTHING`,
    'rev_fleet_point_01', companyId, vehicleId, deviceId, driverId,
    33.3152, 44.3661, 0, 0, 5, 0, ts, ts);

  run(`INSERT INTO kiosk_device_registries (id, company_id, branch_id, site, code, name,
        kiosk_type, assigned_role_profile, allowed_actions_json, allowed_pages_json,
        status, session_timeout_seconds, last_heartbeat_at, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO NOTHING`,
    'rev_kiosk_01', companyId, branchId, 'Al-Warsha Main', 'REV-KIOSK-01', 'كشك المراجعة',
    'warehouse', 'review.warehouse_operator', '[]', '[]',
    'active', 900, ts, actor, ts, ts);

  run(`INSERT INTO offline_client_registries (id, company_id, branch_id, client_uuid, user_id,
        device_name, device_trust_state, local_schema_version, sync_cursor,
        last_successful_sync_at, supported_capabilities_json, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO NOTHING`,
    'rev_offline_client_01', companyId, branchId, 'rev-client-uuid-0001', 'usr_review_warehouse_operator',
    'جهاز مراجعة متنقل', 'trusted', 1, null,
    ts, '[]', ts, ts);

  return {
    summary: {
      gateways: 1,
      devices: 1,
      deviceHealthRecords: 1,
      openDeviceAlerts: 1,
      fleetDrivers: 1,
      fleetVehicles: 1,
      fleetLocationPoints: 1,
      kiosks: 1,
      offlineClients: 1,
      tenantId,
      companyId,
      branchId,
    },
  };
}

export default seedBuild10DeviceFleetFixtures;
