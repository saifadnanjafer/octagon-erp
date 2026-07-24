import * as warehouses from './warehouses.mjs';
import * as ledger from './ledger.mjs';
import * as valuation from './valuation.mjs';
import * as reservations from './reservations.mjs';
import * as traceability from './traceability.mjs';
import * as operations from './operations.mjs';
import { registerDomainHandler } from '../kernel/actions/domain-handler.mjs';

export { warehouses, ledger, valuation, reservations, traceability, operations };

export function registerInventoryActions(actionExecutor) {
  registerDomainHandler(actionExecutor, 'warehouse:create', warehouses.createWarehouse);
  registerDomainHandler(actionExecutor, 'stock:location:create', warehouses.createStockLocation);
  registerDomainHandler(actionExecutor, 'stock:move:post', operations.executeStockOperation);
  registerDomainHandler(actionExecutor, 'stock:quants:rebuild', ledger.rebuildStockQuants);
  registerDomainHandler(actionExecutor, 'stock:reservation:reserve', reservations.reserveStock);
  registerDomainHandler(actionExecutor, 'stock:reservation:release', reservations.releaseReservation);
  registerDomainHandler(actionExecutor, 'stock:reservation:expire', reservations.expireReservation);
  registerDomainHandler(actionExecutor, 'stock:reservation:reallocate', reservations.reallocateReservation);
  registerDomainHandler(actionExecutor, 'stock:reservation:consume', reservations.consumeReservation);
  registerDomainHandler(actionExecutor, 'stock:reservation:reverse', reservations.reverseReservationConsumption);
  registerDomainHandler(actionExecutor, 'stock:lot:create', traceability.createLot);
  registerDomainHandler(actionExecutor, 'stock:serial:create', traceability.createSerial);
  registerDomainHandler(actionExecutor, 'stock:package:create', traceability.createPackage);
}
