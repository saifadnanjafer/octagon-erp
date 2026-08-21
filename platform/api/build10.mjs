// BUILD-10 read models. These are deliberately read-only projections over
// the canonical platform tables; the UI must never invent rows for a page
// whose scoped source is empty.
'use strict';

const TABLE_BY_PAGE = Object.freeze({
  device_registry: 'iot_devices', device_detail: 'iot_devices', device_enrollment: 'iot_devices',
  gateway_management: 'iot_gateways', sensor_management: 'iot_sensors',
  telemetry_explorer: 'iot_telemetry_events', device_health_center: 'iot_device_health',
  device_alerts: 'iot_device_alerts', firmware_catalogue: 'iot_firmware_catalogue',
  rollout_simulator: 'iot_firmware_rollouts', configuration_profiles: 'iot_config_profiles',
  device_command_center: 'iot_device_commands', fleet_device_mapping: 'fleet_device_mappings',
  fleet_live_map_simulator: 'fleet_location_points', vehicle_trip_timeline: 'fleet_trip_projections',
  geofence_management: 'fleet_geofences', geofence_events: 'fleet_geofence_events',
  speed_and_driver_events: 'fleet_speed_events', fuel_telemetry: 'fleet_fuel_telemetry',
  // Fuel-loss investigation is a classified fuel telemetry event, not a
  // separate authority/table.  The UI filters that same canonical source.
  suspected_fuel_loss_queue: 'fleet_fuel_telemetry', maintenance_triggers: 'fleet_maintenance_triggers',
  offline_client_registry: 'offline_client_registries', offline_queue: 'offline_command_queues',
  sync_sessions: 'offline_sync_sessions', sync_conflicts: 'offline_conflict_records',
  conflict_resolution: 'offline_conflict_records',
  kiosk_device_registry: 'kiosk_device_registries', employee_kiosk: 'kiosk_device_registries',
  warehouse_kiosk: 'kiosk_device_registries', shop_floor_kiosk: 'kiosk_device_registries', service_kiosk: 'kiosk_device_registries',
});

export function handleBuild10Query({ dialect, ctx, resource, query = {} }) {
  const pageId = resource;
  const table = TABLE_BY_PAGE[pageId];
  // A page without a registered projection remains visibly empty.  This is
  // intentional: do not substitute fixture rows or infer an authority.
  if (!table) return { data: [], meta: { total: 0, source: null, readOnly: true, unimplemented: true } };
  const companyId = ctx.companyId || ctx.company_id;
  if (!companyId) return { error: 'Company scope required', status: 400 };
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  const fuelLossOnly = pageId === 'suspected_fuel_loss_queue';
  const rows = dialect.prepare(`SELECT * FROM ${table} WHERE company_id = ?${fuelLossOnly ? " AND event_classification = 'suspected_fuel_loss'" : ''} ORDER BY rowid DESC LIMIT ?`).all(companyId, limit);
  return { data: rows, meta: { total: rows.length, source: table, readOnly: true } };
}
