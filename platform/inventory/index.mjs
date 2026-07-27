import * as warehouses from './warehouses.mjs';
import * as ledger from './ledger.mjs';
import * as valuation from './valuation.mjs';
import * as reservations from './reservations.mjs';
import * as traceability from './traceability.mjs';
import * as operations from './operations.mjs';
import * as wmsWorkflows from './wms_workflows.mjs';
import { registerDomainHandler } from '../kernel/actions/domain-handler.mjs';

export { warehouses, ledger, valuation, reservations, traceability, operations, wmsWorkflows };

export function registerInventoryActions(actionExecutor) {
  // Warehouses
  registerDomainHandler(actionExecutor, 'warehouse:create', warehouses.createWarehouse);
  registerDomainHandler(actionExecutor, 'warehouse:update', warehouses.updateWarehouse);
  registerDomainHandler(actionExecutor, 'warehouse:archive', warehouses.archiveWarehouse);
  registerDomainHandler(actionExecutor, 'warehouse:restore', warehouses.restoreWarehouse);

  // Locations
  registerDomainHandler(actionExecutor, 'stock:location:create', warehouses.createStockLocation);
  registerDomainHandler(actionExecutor, 'stock:location:update', warehouses.updateStockLocation);
  registerDomainHandler(actionExecutor, 'stock:location:archive', warehouses.archiveStockLocation);
  registerDomainHandler(actionExecutor, 'stock:location:restore', warehouses.restoreStockLocation);
  registerDomainHandler(actionExecutor, 'stock:location:move', warehouses.moveStockLocation);

  // Stock Receipts
  registerDomainHandler(actionExecutor, 'stock:receipt:create_draft', wmsWorkflows.createReceiptDraft);
  registerDomainHandler(actionExecutor, 'stock:receipt:update_draft', wmsWorkflows.updateReceiptDraft);
  registerDomainHandler(actionExecutor, 'stock:receipt:validate', wmsWorkflows.validateReceipt);
  registerDomainHandler(actionExecutor, 'stock:receipt:cancel', wmsWorkflows.cancelReceipt);

  // Stock Transfers
  registerDomainHandler(actionExecutor, 'stock:transfer:create_draft', wmsWorkflows.createTransferDraft);
  registerDomainHandler(actionExecutor, 'stock:transfer:validate', wmsWorkflows.validateTransfer);
  registerDomainHandler(actionExecutor, 'stock:transfer:cancel', wmsWorkflows.cancelReceipt);

  // Stock Deliveries
  registerDomainHandler(actionExecutor, 'stock:delivery:create_draft', wmsWorkflows.createDeliveryDraft);
  registerDomainHandler(actionExecutor, 'stock:delivery:validate', wmsWorkflows.validateDelivery);
  registerDomainHandler(actionExecutor, 'stock:delivery:cancel', wmsWorkflows.cancelReceipt);

  // Stock Returns
  registerDomainHandler(actionExecutor, 'stock:return:create_draft', wmsWorkflows.createReturnDraft);
  registerDomainHandler(actionExecutor, 'stock:return:validate', wmsWorkflows.validateReturn);

  // Replenishment
  registerDomainHandler(actionExecutor, 'replenishment:proposal:create', wmsWorkflows.createReplenishmentProposal);
  registerDomainHandler(actionExecutor, 'replenishment:proposal:approve', wmsWorkflows.approveReplenishmentProposal);

  // Moves, Ledger & Reservations
  registerDomainHandler(actionExecutor, 'stock:move:post', operations.executeStockOperation);
  registerDomainHandler(actionExecutor, 'stock:quants:rebuild', ledger.rebuildStockQuants);
  registerDomainHandler(actionExecutor, 'stock:reservation:reserve', reservations.reserveStock);
  registerDomainHandler(actionExecutor, 'stock:reservation:release', reservations.releaseReservation);
  registerDomainHandler(actionExecutor, 'stock:reservation:expire', reservations.expireReservation);
  registerDomainHandler(actionExecutor, 'stock:reservation:reallocate', reservations.reallocateReservation);
  registerDomainHandler(actionExecutor, 'stock:reservation:consume', reservations.consumeReservation);
  registerDomainHandler(actionExecutor, 'stock:reservation:reverse', reservations.reverseReservationConsumption);

  // Traceability
  registerDomainHandler(actionExecutor, 'stock:lot:create', traceability.createLot);
  registerDomainHandler(actionExecutor, 'stock:serial:create', traceability.createSerial);
  registerDomainHandler(actionExecutor, 'stock:package:create', traceability.createPackage);
}
