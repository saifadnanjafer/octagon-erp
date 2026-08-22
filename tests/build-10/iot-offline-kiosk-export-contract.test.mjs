import test from 'node:test';
import assert from 'node:assert/strict';
import * as deviceRegistry from '../../platform/iot/device-registry.mjs';
import * as gateways from '../../platform/iot/gateways.mjs';
import * as sensors from '../../platform/iot/sensors.mjs';
import * as telemetry from '../../platform/iot/telemetry.mjs';
import * as health from '../../platform/iot/health-diagnostics.mjs';
import * as firmwareConfig from '../../platform/iot/firmware-config.mjs';
import * as deviceCommands from '../../platform/iot/device-commands.mjs';
import * as fleetMapping from '../../platform/iot/fleet-telematics-mapping.mjs';
import * as locationTrips from '../../platform/iot/location-trips.mjs';
import * as geofences from '../../platform/iot/geofences.mjs';
import * as fleetEvents from '../../platform/iot/fleet-events.mjs';
import * as fuelTelemetry from '../../platform/iot/fuel-telemetry.mjs';
import * as maintenanceTriggers from '../../platform/iot/maintenance-triggers.mjs';
import * as clientRegistry from '../../platform/offline/client-registry.mjs';
import * as syncEngine from '../../platform/offline/sync-engine.mjs';
import * as conflictResolution from '../../platform/offline/conflict-resolution.mjs';
import * as kioskRegistry from '../../platform/kiosk/kiosk-registry.mjs';
import * as operationalBoards from '../../platform/kiosk/operational-boards.mjs';
import { registerIotActions } from '../../platform/iot/index.mjs';
import { registerOfflineActions } from '../../platform/offline/index.mjs';
import { registerKioskActions } from '../../platform/kiosk/index.mjs';

// This test exists because BUILD-10's own fixtures (cross-domain-scenarios.test.mjs, browser-harness.mjs)
// were once written against function names that did not match what these modules actually export
// (fleetMapping.mapDeviceToVehicle vs the real mapFleetDevice, clientRegistry.registerClientDevice vs
// the real registerOfflineClient, geofences.defineGeofence vs the real createGeofence, etc). A namespace-
// import call to a nonexistent function only fails at the exact runtime call site it's exercised from,
// not at import time - so a rename or removal can silently strand every other caller until someone
// happens to hit that code path. Assert the canonical exported surface explicitly, in one place, so a
// rename/removal fails loudly here instead of as a stray "X is not a function" three files away.
const CANONICAL_EXPORTS = {
  'platform/iot/device-registry.mjs': [deviceRegistry, ['requiredScope', 'deviceInScope', 'assertLifecycle', 'mapDevice', 'registerDevice', 'updateDraftDevice', 'assignAsset', 'assignVehicle', 'assignSite', 'assignGateway', 'enrollDeviceSimulated', 'enrollDevice', 'updateDeviceStatus', 'activateDevice', 'suspendDevice', 'resumeDevice', 'revokeDevice', 'markDeviceLost', 'replaceDevice', 'retireDevice', 'rotateCredentialReference', 'updateDeviceConfiguration', 'recordInstallation', 'recordHealthCheck', 'getDevice', 'listDevices']],
  'platform/iot/gateways.mjs': [gateways, ['mapGateway', 'registerGateway', 'updateGateway', 'assignDeviceToGateway', 'suspendGateway', 'resumeGateway', 'getGateway', 'listGateways']],
  'platform/iot/sensors.mjs': [sensors, ['mapSensor', 'registerSensor', 'configureSensor', 'calibrateSensor', 'setSensorThresholds', 'setSensorActive', 'recordSensorReadingMeta', 'getSensor', 'listSensors']],
  'platform/iot/telemetry.mjs': [telemetry, ['ingestTelemetrySimulated', 'listTelemetryEvents']],
  'platform/iot/health-diagnostics.mjs': [health, ['calculateDeviceHealth', 'acknowledgeAlert', 'listAlerts']],
  'platform/iot/firmware-config.mjs': [firmwareConfig, ['registerFirmware', 'approveFirmware', 'rolloutFirmwareSimulated', 'evaluateConfigDrift', 'upsertConfigProfile']],
  'platform/iot/device-commands.mjs': [deviceCommands, ['requestCommand', 'approveCommand', 'dispatchSimulatedCommand', 'listDeviceCommands']],
  'platform/iot/fleet-telematics-mapping.mjs': [fleetMapping, ['mapFleetDevice', 'calibrateOdometer', 'listFleetDeviceMappings']],
  'platform/iot/location-trips.mjs': [locationTrips, ['recordLocationPoint', 'startTrip', 'endTrip', 'listTrips']],
  'platform/iot/geofences.mjs': [geofences, ['createGeofence', 'evaluateGeofenceEvent', 'acknowledgeGeofenceEvent', 'listGeofences']],
  'platform/iot/fleet-events.mjs': [fleetEvents, ['recordSpeedEvent', 'acknowledgeSpeedEvent', 'listSpeedEvents']],
  'platform/iot/fuel-telemetry.mjs': [fuelTelemetry, ['recordFuelReading', 'investigateFuelAnomaly', 'listFuelTelemetry']],
  'platform/iot/maintenance-triggers.mjs': [maintenanceTriggers, ['evaluateMaintenanceTrigger', 'acknowledgeMaintenanceTrigger', 'listMaintenanceTriggers']],
  'platform/offline/client-registry.mjs': [clientRegistry, ['registerOfflineClient', 'revokeOfflineClient', 'getClientScope']],
  'platform/offline/sync-engine.mjs': [syncEngine, ['queueOfflineCommand', 'pushOfflineSync', 'listOfflineQueues']],
  'platform/offline/conflict-resolution.mjs': [conflictResolution, ['resolveConflict', 'listConflicts']],
  'platform/kiosk/kiosk-registry.mjs': [kioskRegistry, ['registerKiosk', 'recordKioskHeartbeat', 'startKioskSession', 'evaluateKioskActionPermission', 'listKiosks']],
  'platform/kiosk/operational-boards.mjs': [operationalBoards, ['upsertBoardConfig', 'getBoardData']],
};

test('BUILD-10 iot/offline/kiosk modules export their documented canonical function names', () => {
  for (const [modulePath, [mod, names]] of Object.entries(CANONICAL_EXPORTS)) {
    for (const name of names) {
      assert.equal(typeof mod[name], 'function', `${modulePath} must export a function named '${name}'`);
    }
  }
});

test('BUILD-10 action registries only bind action ids to real exported functions', () => {
  const seen = [];
  const fakeExecutor = { registerHandler(actionId, fn) { seen.push([actionId, typeof fn]); } };
  registerIotActions(fakeExecutor);
  registerOfflineActions(fakeExecutor);
  registerKioskActions(fakeExecutor);
  assert.ok(seen.length > 0, 'expected at least one action to be registered');
  for (const [actionId, fnType] of seen) {
    assert.equal(fnType, 'function', `action '${actionId}' must bind to a function`);
  }
});
