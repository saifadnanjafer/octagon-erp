import * as governance from './governance.mjs';
import * as rfq from './rfq.mjs';
import * as orders from './orders.mjs';
import * as matching from './matching.mjs';
import { registerDomainHandler } from '../kernel/actions/domain-handler.mjs';

export { governance, rfq, orders, matching };

export function registerProcurementActions(actionExecutor) {
  registerDomainHandler(actionExecutor, 'procurement:requisition:create', governance.createRequisition);
  registerDomainHandler(actionExecutor, 'procurement:rfq:create', rfq.createRfq);
  registerDomainHandler(actionExecutor, 'procurement:order:create', orders.createPurchaseOrder);
  registerDomainHandler(actionExecutor, 'procurement:order:confirm', orders.confirmPurchaseOrder);
  registerDomainHandler(actionExecutor, 'procurement:threewaymatch:perform', matching.performThreeWayMatch);
  registerDomainHandler(actionExecutor, 'procurement:bill_request:create', matching.createSupplierBillRequest);
}
