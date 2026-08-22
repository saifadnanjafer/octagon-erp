import * as deviceRegistry from './device-registry.mjs';
import * as gateways from './gateways.mjs';
import * as sensors from './sensors.mjs';
import * as telemetry from './telemetry.mjs';
import * as health from './health-diagnostics.mjs';
import * as firmware from './firmware-config.mjs';
import * as commands from './device-commands.mjs';
import * as fleetMapping from './fleet-telematics-mapping.mjs';
import * as locationTrips from './location-trips.mjs';
import * as geofences from './geofences.mjs';
import * as fleetEvents from './fleet-events.mjs';
import * as fuelTelemetry from './fuel-telemetry.mjs';
import * as maintenanceTriggers from './maintenance-triggers.mjs';
import { registerDomainHandler } from '../kernel/actions/domain-handler.mjs';

export { deviceRegistry, gateways, sensors, telemetry, health, firmware, commands, fleetMapping, locationTrips, geofences, fleetEvents, fuelTelemetry, maintenanceTriggers };

export function registerIotActions(actionExecutor) {
  registerDomainHandler(actionExecutor, 'iot:device_register', deviceRegistry.registerDevice);
  registerDomainHandler(actionExecutor, 'iot:device_update_draft', deviceRegistry.updateDraftDevice);
  registerDomainHandler(actionExecutor, 'iot:device_assign_asset', deviceRegistry.assignAsset);
  registerDomainHandler(actionExecutor, 'iot:device_assign_vehicle', deviceRegistry.assignVehicle);
  registerDomainHandler(actionExecutor, 'iot:device_assign_site', deviceRegistry.assignSite);
  registerDomainHandler(actionExecutor, 'iot:device_assign_gateway', deviceRegistry.assignGateway);
  registerDomainHandler(actionExecutor, 'iot:device_enroll_simulated', deviceRegistry.enrollDeviceSimulated);
  registerDomainHandler(actionExecutor, 'iot:device_activate', deviceRegistry.activateDevice);
  registerDomainHandler(actionExecutor, 'iot:device_suspend', deviceRegistry.suspendDevice);
  registerDomainHandler(actionExecutor, 'iot:device_resume', deviceRegistry.resumeDevice);
  registerDomainHandler(actionExecutor, 'iot:device_revoke', deviceRegistry.revokeDevice);
  registerDomainHandler(actionExecutor, 'iot:device_mark_lost', deviceRegistry.markDeviceLost);
  registerDomainHandler(actionExecutor, 'iot:device_replace', deviceRegistry.replaceDevice);
  registerDomainHandler(actionExecutor, 'iot:device_retire', deviceRegistry.retireDevice);
  registerDomainHandler(actionExecutor, 'iot:device_rotate_credential', deviceRegistry.rotateCredentialReference);
  registerDomainHandler(actionExecutor, 'iot:device_update_configuration', deviceRegistry.updateDeviceConfiguration);
  registerDomainHandler(actionExecutor, 'iot:device_record_installation', deviceRegistry.recordInstallation);
  registerDomainHandler(actionExecutor, 'iot:device_record_health_check', deviceRegistry.recordHealthCheck);
  registerDomainHandler(actionExecutor, 'iot:gateway_register', gateways.registerGateway);
  registerDomainHandler(actionExecutor, 'iot:gateway_update', gateways.updateGateway);
  registerDomainHandler(actionExecutor, 'iot:gateway_assign_device', gateways.assignDeviceToGateway);
  registerDomainHandler(actionExecutor, 'iot:gateway_suspend', gateways.suspendGateway);
  registerDomainHandler(actionExecutor, 'iot:gateway_resume', gateways.resumeGateway);
  registerDomainHandler(actionExecutor, 'iot:sensor_register', sensors.registerSensor);
  registerDomainHandler(actionExecutor, 'iot:sensor_configure', sensors.configureSensor);
  registerDomainHandler(actionExecutor, 'iot:sensor_calibrate', sensors.calibrateSensor);
  registerDomainHandler(actionExecutor, 'iot:sensor_set_thresholds', sensors.setSensorThresholds);
  registerDomainHandler(actionExecutor, 'iot:sensor_set_active', sensors.setSensorActive);

  // Slice 2 actions
  registerDomainHandler(actionExecutor, 'iot:telemetry_ingest_simulated', telemetry.ingestTelemetrySimulated);
  registerDomainHandler(actionExecutor, 'iot:health_calculate', health.calculateDeviceHealth);
  registerDomainHandler(actionExecutor, 'iot:alert_acknowledge', health.acknowledgeAlert);
  registerDomainHandler(actionExecutor, 'iot:firmware_register', firmware.registerFirmware);
  registerDomainHandler(actionExecutor, 'iot:firmware_approve', firmware.approveFirmware);
  registerDomainHandler(actionExecutor, 'iot:firmware_rollout_simulated', firmware.rolloutFirmwareSimulated);
  registerDomainHandler(actionExecutor, 'iot:config_profile_upsert', firmware.upsertConfigProfile);
  registerDomainHandler(actionExecutor, 'iot:command_request', commands.requestCommand);
  registerDomainHandler(actionExecutor, 'iot:command_approve', commands.approveCommand);
  registerDomainHandler(actionExecutor, 'iot:command_dispatch_simulated', commands.dispatchSimulatedCommand);

  // Slice 3 actions (fleet telematics)
  registerDomainHandler(actionExecutor, 'iot:fleet_device_map', fleetMapping.mapFleetDevice);
  registerDomainHandler(actionExecutor, 'iot:fleet_odometer_calibrate', fleetMapping.calibrateOdometer);
  registerDomainHandler(actionExecutor, 'iot:location_point_record', locationTrips.recordLocationPoint);
  registerDomainHandler(actionExecutor, 'iot:record_location_point', locationTrips.recordLocationPoint);
  registerDomainHandler(actionExecutor, 'iot:trip_start', locationTrips.startTrip);
  registerDomainHandler(actionExecutor, 'iot:start_or_project_trip', locationTrips.startTrip);
  registerDomainHandler(actionExecutor, 'iot:trip_end', locationTrips.endTrip);
  registerDomainHandler(actionExecutor, 'iot:geofence_create', geofences.createGeofence);
  registerDomainHandler(actionExecutor, 'iot:define_geofence', geofences.createGeofence);
  registerDomainHandler(actionExecutor, 'iot:geofence_event_evaluate', geofences.evaluateGeofenceEvent);
  registerDomainHandler(actionExecutor, 'iot:evaluate_geofence_breach', geofences.evaluateGeofenceEvent);
  registerDomainHandler(actionExecutor, 'iot:geofence_event_acknowledge', geofences.acknowledgeGeofenceEvent);
  registerDomainHandler(actionExecutor, 'iot:speed_event_record', fleetEvents.recordSpeedEvent);
  registerDomainHandler(actionExecutor, 'iot:speed_event_acknowledge', fleetEvents.acknowledgeSpeedEvent);
  registerDomainHandler(actionExecutor, 'iot:fuel_reading_record', fuelTelemetry.recordFuelReading);
  registerDomainHandler(actionExecutor, 'iot:fuel_anomaly_investigate', fuelTelemetry.investigateFuelAnomaly);
  registerDomainHandler(actionExecutor, 'iot:maintenance_trigger_evaluate', maintenanceTriggers.evaluateMaintenanceTrigger);
  registerDomainHandler(actionExecutor, 'iot:maintenance_trigger_acknowledge', maintenanceTriggers.acknowledgeMaintenanceTrigger);
}
