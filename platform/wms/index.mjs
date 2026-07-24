import * as operations from './operations.mjs';
import * as counts from './counts.mjs';
import * as landedCost from './landed_cost.mjs';
import { registerDomainHandler } from '../kernel/actions/domain-handler.mjs';

export { operations, counts, landedCost };

export function registerWmsActions(actionExecutor) {
  registerDomainHandler(actionExecutor, 'wms:picking:create', operations.createPicking);
  registerDomainHandler(actionExecutor, 'wms:picking:validate', operations.validatePickingGoverned);
  registerDomainHandler(actionExecutor, 'wms:cyclecount:create', counts.createCycleCount);
  registerDomainHandler(actionExecutor, 'wms:cyclecount:post', counts.postCycleCount);
  registerDomainHandler(actionExecutor, 'wms:landedcost:create', landedCost.createLandedCost);
  registerDomainHandler(actionExecutor, 'wms:landedcost:post', landedCost.postLandedCost);
}
