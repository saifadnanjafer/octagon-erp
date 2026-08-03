// BUILD-10 Follow-Up Additive Migration: Actions, Permissions, and Module Alias Registration
'use strict';

const MODULE_ID = 'build10_governed_actions';

const ENTITIES = [
  ['fleet_device_mapping', 'ربط أجهزة أسطول السيارات', 'Fleet Device Mapping'],
  ['fleet_trip_projection', 'رحلات الأسطول', 'Fleet Trip Projection'],
  ['fleet_location_point', 'نقطة موقع الأسطول', 'Fleet Location Point'],
  ['fleet_geofence', 'النطاق الجغرافي', 'Fleet Geofence'],
  ['fleet_geofence_event', 'حدث النطاق الجغرافي', 'Fleet Geofence Event'],
  ['fleet_speed_event', 'حدث السرعة والسياقة', 'Fleet Speed Event'],
  ['fleet_fuel_telemetry', 'قياس الوقود والاشتباه في الهدر', 'Fleet Fuel Telemetry'],
  ['fleet_maintenance_trigger', 'محفزات الصيانة التلقائية', 'Fleet Maintenance Trigger'],
  ['offline_client_registry', 'سجل أجهزة العمل بدون اتصال', 'Offline Client Registry'],
  ['offline_command_queue', 'طابور أوامر الأوفلاين', 'Offline Command Queue'],
  ['offline_sync_session', 'جلسة مزامنة الأوفلاين', 'Offline Sync Session'],
  ['offline_conflict_record', 'سجل تعارضات المزامنة', 'Offline Conflict Record'],
  ['kiosk_device_registry', 'سجل أجهزة الكشك', 'Kiosk Device Registry'],
  ['kiosk_session_log', 'سجل جلسات الكشك', 'Kiosk Session Log'],
  ['operational_board_config', 'تكوين اللوحات التشغيلية', 'Operational Board Config'],
];

const ACTIONS = [
  ['fleet:device_map', 'fleet_device_mapping', 'fleet:telematics:admin'],
  ['fleet:device_unmap', 'fleet_device_mapping', 'fleet:telematics:admin'],
  ['fleet:calibrate_odometer', 'fleet_device_mapping', 'fleet:telematics:admin'],
  ['fleet:calibrate_fuel_sensor', 'fleet_device_mapping', 'fleet:telematics:admin'],
  ['fleet:location_record', 'fleet_location_point', 'fleet:telematics:write'],
  ['iot:record_location_point', 'fleet_location_point', 'fleet:telematics:write'],
  ['fleet:trip_start', 'fleet_trip_projection', 'fleet:telematics:write'],
  ['iot:start_or_project_trip', 'fleet_trip_projection', 'fleet:telematics:write'],
  ['fleet:trip_end', 'fleet_trip_projection', 'fleet:telematics:write'],
  ['fleet:geofence_create', 'fleet_geofence', 'fleet:geofence:admin'],
  ['iot:define_geofence', 'fleet_geofence', 'fleet:geofence:admin'],
  ['fleet:geofence_update', 'fleet_geofence', 'fleet:geofence:admin'],
  ['fleet:geofence_evaluate', 'fleet_geofence_event', 'fleet:geofence:write'],
  ['iot:evaluate_geofence_breach', 'fleet_geofence_event', 'fleet:geofence:write'],
  ['fleet:geofence_acknowledge', 'fleet_geofence_event', 'fleet:geofence:write'],
  ['fleet:vehicle_register', 'fleet_vehicle', 'fleet:admin'],
  ['fleet:vehicle:create', 'fleet_vehicle', 'fleet:admin'],
  ['fleet:driver_assign', 'fleet_assignment', 'fleet:admin'],
  ['fleet:driver:assign', 'fleet_assignment', 'fleet:admin'],
  ['fleet:driver_create', 'fleet_driver', 'fleet:admin'],
  ['fleet:driver:create', 'fleet_driver', 'fleet:admin'],
  ['fleet:telemetry_ingest', 'fleet_telemetry_event', 'fleet:driver'],
  ['fleet:telemetry:ingest', 'fleet_telemetry_event', 'fleet:driver'],
  ['fleet:geofence_exit_breach', 'fleet_telemetry_event', 'fleet:driver'],
  ['fleet:trip_log_create', 'fleet_trip', 'fleet:driver'],
  ['fleet:trip:record', 'fleet_trip', 'fleet:driver'],
  ['fleet:fuel_log_create', 'fleet_fuel_log', 'fleet:driver'],
  ['fleet:fuel:record', 'fleet_fuel_log', 'fleet:driver'],
  ['fleet:speed_event_record', 'fleet_speed_event', 'fleet:telematics:write'],
  ['fleet:speed_event_acknowledge', 'fleet_speed_event', 'fleet:telematics:write'],
  ['fleet:fuel_reading_record', 'fleet_fuel_telemetry', 'fleet:fuel:write'],
  ['fleet:fuel_anomaly_investigate', 'fleet_fuel_telemetry', 'fleet:fuel:admin'],
  ['fleet:maintenance_trigger_evaluate', 'fleet_maintenance_trigger', 'fleet:maintenance:admin'],
  ['fleet:maintenance_trigger_acknowledge', 'fleet_maintenance_trigger', 'fleet:maintenance:admin'],
  ['offline:client_register', 'offline_client_registry', 'offline:admin'],
  ['offline:client_revoke', 'offline_client_registry', 'offline:admin'],
  ['offline:client_unregister', 'offline_client_registry', 'offline:admin'],
  ['offline:command_queue_local', 'offline_command_queue', 'offline:sync'],
  ['offline:command_sync_push', 'offline_command_queue', 'offline:sync'],
  ['offline:push_queue_batch', 'offline_command_queue', 'offline:sync'],
  ['offline:record_sync_conflict', 'offline_conflict_record', 'offline:sync'],
  ['offline:resolve_sync_conflict', 'offline_conflict_record', 'offline:sync'],
  ['offline:conflict_resolve', 'offline_conflict_record', 'offline:sync'],
  ['offline:sync_start', 'offline_sync_session', 'offline:sync'],
  ['offline:sync_complete', 'offline_sync_session', 'offline:sync'],
  ['offline:sync_fail', 'offline_sync_session', 'offline:sync'],
  ['offline:record_conflict', 'offline_conflict_record', 'offline:sync'],
  ['offline:resolve_conflict', 'offline_conflict_record', 'offline:admin'],
  ['kiosk:register', 'kiosk_device_registry', 'kiosk:admin'],
  ['kiosk:configure', 'kiosk_device_registry', 'kiosk:admin'],
  ['kiosk:suspend', 'kiosk_device_registry', 'kiosk:admin'],
  ['kiosk:heartbeat', 'kiosk_device_registry', 'kiosk:operate'],
  ['kiosk:session_start', 'kiosk_session_log', 'kiosk:operate'],
  ['kiosk:session_end', 'kiosk_session_log', 'kiosk:operate'],
  ['kiosk:evaluate_kiosk_permission', 'kiosk_device_registry', 'kiosk:admin'],
  ['board:config_upsert', 'operational_board_config', 'board:admin'],
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
  ['offline:sync', 'offline_pwa', 'sync', 0],
  ['offline:admin', 'offline_pwa', 'admin', 1],
  ['kiosk:view', 'kiosk_device', 'view', 0],
  ['kiosk:operate', 'kiosk_device', 'operate', 0],
  ['kiosk:admin', 'kiosk_device', 'admin', 1],
  ['board:view', 'operational_board', 'view', 0],
  ['board:admin', 'operational_board', 'admin', 1],
];

export const migration = {
  id: '086_build10_actions_and_permissions_followup',
  owner: 'build10_followup',
  version: '10.5.0',
  parent: '085_build10_kiosk_operational_boards',
  dependsOn: ['085_build10_kiosk_operational_boards'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'BUILD-10 Governed additive migration for actions, permissions, and entity aliases',

  up(db) {
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO platform_modules (
        id, name, version, status, kind, owner, dependencies, optional_dependencies,
        capabilities, migrations, settings, created_at, updated_at
      ) VALUES (?, 'BUILD-10 Governed Actions Followup', '10.5.0', 'enabled', 'standard', 'operations', '["platform_kernel"]', '[]', '["build10_actions"]', '["086_build10_actions_and_permissions_followup"]', '{}', ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        version = excluded.version,
        updated_at = excluded.updated_at
    `).run(MODULE_ID, now, now);

    const entity = db.prepare(`
      INSERT INTO platform_entities(id,module_id,storage_owner,primary_key,label_ar,label_en,section,chatter,fields,relations,scope,lifecycle_policy,query_policy,action_policy,customization_policy,history_policy,api_exposed,migration_owner,created_at,updated_at)
      VALUES(?,?,'platform.build10','id',?,?,'operations',0,'{}','{}','company','governed','scoped','registered','metadata','audit',1,'086_build10_actions_and_permissions_followup',?,?)
      ON CONFLICT(id) DO NOTHING
    `);
    ENTITIES.forEach(([id, ar, en]) => entity.run(id, MODULE_ID, ar, en, now, now));

    const permission = db.prepare(`
      INSERT INTO authorization_permissions(id,module_id,kind,resource,action,label_ar,label_en,sensitive,depends_on,deprecated,created_at,updated_at)
      VALUES(?,?,'action',?,?,?, ?,?,'[]',0,?,?)
      ON CONFLICT(id) DO UPDATE SET sensitive=excluded.sensitive,updated_at=excluded.updated_at
    `);
    PERMISSIONS.forEach(([id, resource, verb, sensitive]) => permission.run(id, MODULE_ID, resource, verb, id, id, sensitive, now, now));

    const action = db.prepare(`
      INSERT INTO platform_actions(id,module_id,entity_id,kind,allowed_states,required_permission,required_scope,input_schema,preconditions,transaction_owner,idempotency_policy,sequence_policy,audit_policy,outbox_policy,error_contract,created_at,updated_at)
      VALUES(?, ?, ?, 'domain', '[]', ?, 'company', '{}', '[]', 'platform_action_executor', 'required', 'none', 'required', 'required', '{}', ?, ?)
      ON CONFLICT(id) DO UPDATE SET required_permission=excluded.required_permission,required_scope=excluded.required_scope,updated_at=excluded.updated_at
    `);
    ACTIONS.forEach(([id, entityId, permission]) => action.run(id, MODULE_ID, entityId, permission, now, now));
  },

  down(db) {
    ACTIONS.forEach(([id]) => db.prepare('DELETE FROM platform_actions WHERE id=?').run(id));
    PERMISSIONS.forEach(([id]) => db.prepare('DELETE FROM authorization_permissions WHERE id=?').run(id));
    ENTITIES.forEach(([id]) => db.prepare('DELETE FROM platform_entities WHERE id=?').run(id));
    db.prepare('DELETE FROM platform_modules WHERE id=?').run(MODULE_ID);
  },
};

export default migration;
