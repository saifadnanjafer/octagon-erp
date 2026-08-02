import * as operations from './operations.mjs';
import * as counts from './counts.mjs';
import * as landedCost from './landed_cost.mjs';
import * as topology from './topology.mjs';
import * as putaway from './putaway.mjs';
import * as replenishment from './replenishment.mjs';
import { registerDomainHandler } from '../kernel/actions/domain-handler.mjs';

export { operations, counts, landedCost, topology, putaway, replenishment };

export function registerWmsActions(actionExecutor) {
  registerDomainHandler(actionExecutor, 'wms:picking:create', operations.createPicking);
  registerDomainHandler(actionExecutor, 'wms:picking:validate', operations.validatePickingGoverned);
  registerDomainHandler(actionExecutor, 'wms:cyclecount:create', counts.createCycleCount);
  registerDomainHandler(actionExecutor, 'wms:cyclecount:post', counts.postCycleCount);
  registerDomainHandler(actionExecutor, 'wms:landedcost:create', landedCost.createLandedCost);
  registerDomainHandler(actionExecutor, 'wms:landedcost:post', landedCost.postLandedCost);
  registerDomainHandler(actionExecutor, 'wms:zone_create', topology.createZone);
  registerDomainHandler(actionExecutor, 'wms:zone_update', topology.updateZone);
  registerDomainHandler(actionExecutor, 'wms:zone_set_active', topology.setZoneActive);
  registerDomainHandler(actionExecutor, 'wms:location_create', topology.createLocation);
  registerDomainHandler(actionExecutor, 'wms:location_update', topology.updateLocation);
  registerDomainHandler(actionExecutor, 'wms:location_move', topology.moveLocation);
  registerDomainHandler(actionExecutor, 'wms:location_set_capacity', topology.setLocationCapacity);
  registerDomainHandler(actionExecutor, 'wms:location_set_restrictions', topology.setLocationRestrictions);
  registerDomainHandler(actionExecutor, 'wms:location_generate_barcode', topology.generateLocationBarcode);
  registerDomainHandler(actionExecutor, 'wms:location_retire', topology.retireLocation);
  registerDomainHandler(actionExecutor, 'wms:putaway_rule_create', putaway.createPutawayRule);
  registerDomainHandler(actionExecutor, 'wms:putaway_rule_update', putaway.updatePutawayRule);
  registerDomainHandler(actionExecutor, 'wms:putaway_recommend', putaway.recommendPutaway);
  registerDomainHandler(actionExecutor, 'wms:putaway_accept', putaway.acceptPutaway);
  registerDomainHandler(actionExecutor, 'wms:putaway_override', putaway.overridePutaway);
  registerDomainHandler(actionExecutor, 'wms:task_scan_source', putaway.scanTaskSource);
  registerDomainHandler(actionExecutor, 'wms:task_scan_destination', putaway.scanTaskDestination);
  registerDomainHandler(actionExecutor, 'wms:task_request_canonical', putaway.requestCanonicalMovement);
  registerDomainHandler(actionExecutor, 'wms:task_acknowledge_canonical', putaway.acknowledgeCanonicalMovement);
  registerDomainHandler(actionExecutor, 'wms:replenishment_rule_create', replenishment.createReplenishmentRule);
  registerDomainHandler(actionExecutor, 'wms:replenishment_calculate', replenishment.calculateReplenishment);
  registerDomainHandler(actionExecutor, 'wms:replenishment_approve', replenishment.approveReplenishment);
  registerDomainHandler(actionExecutor, 'wms:replenishment_cancel', replenishment.cancelReplenishment);
  registerDomainHandler(actionExecutor, 'wms:replenishment_retry', replenishment.retryReplenishment);
}
