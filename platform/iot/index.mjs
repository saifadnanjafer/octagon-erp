import * as deviceRegistry from './device-registry.mjs';
import * as gateways from './gateways.mjs';
import * as sensors from './sensors.mjs';
import { registerDomainHandler } from '../kernel/actions/domain-handler.mjs';

export { deviceRegistry, gateways, sensors };

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
}
