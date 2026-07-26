import * as quality from './quality.mjs';
import { registerGatedHandler, PHASE05_MODULE_FLAGS } from '../control_plane/phase05.mjs';

export { quality };

const FLAG = PHASE05_MODULE_FLAGS.quality;

export function registerQualityActions(actionExecutor) {
  const gate = (actionId, handler) => registerGatedHandler(actionExecutor, actionId, handler, FLAG, 'Quality');

  gate('quality:plan:create', quality.createQualityPlan);
  gate('quality:inspection:create', quality.createInspection);
  gate('quality:inspection:record', quality.recordMeasurements);
  gate('quality:inspection:decide', quality.decideInspection);
  gate('quality:deviation:approve', quality.approveDeviation);
  gate('quality:nonconformance:create', quality.createNonconformance);
  gate('quality:nonconformance:resolve', quality.resolveNonconformance);
}
