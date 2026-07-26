import * as fleet from './fleet.mjs';
import * as reports from './reports.mjs';
import { registerGatedHandler, PHASE05_MODULE_FLAGS } from '../control_plane/phase05.mjs';

export { fleet, reports };

const FLAG = PHASE05_MODULE_FLAGS.fleet;

export function registerFleetActions(actionExecutor) {
  const gate = (actionId, handler) => registerGatedHandler(actionExecutor, actionId, handler, FLAG, 'Fleet');

  gate('fleet:vehicle_type:create', fleet.createVehicleType);
  gate('fleet:vehicle:create', fleet.createVehicle);
  gate('fleet:driver:register', fleet.registerDriver);
  gate('fleet:assignment:create', fleet.assignDriver);
  gate('fleet:document:register', fleet.registerDocument);
  gate('fleet:trip:start', fleet.startTrip);
  gate('fleet:trip:complete', fleet.completeTrip);
  gate('fleet:odometer:record', fleet.recordOdometer);
  gate('fleet:fuel:record', fleet.recordFuelTransaction);
  gate('fleet:incident:record', fleet.recordIncident);
  gate('fleet:telemetry:provider', fleet.registerTelemetryProvider);
  gate('fleet:telemetry:ingest', fleet.ingestTelemetry);
}
