import * as governance from './governance.mjs';
import * as rfq from './rfq.mjs';
import * as orders from './orders.mjs';
import * as matching from './matching.mjs';
import * as lifecycle from './lifecycle.mjs';
import { registerDomainHandler } from '../kernel/actions/domain-handler.mjs';

export { governance, rfq, orders, matching, lifecycle };

export function registerProcurementActions(actionExecutor) {
  registerDomainHandler(actionExecutor, 'procurement:requisition:create', governance.createRequisition);
  registerDomainHandler(actionExecutor, 'procurement:request:create', lifecycle.createPurchaseRequest);
  registerDomainHandler(actionExecutor, 'procurement:request:submit', lifecycle.submitPurchaseRequest);
  registerDomainHandler(actionExecutor, 'procurement:request:approve', lifecycle.approvePurchaseRequest);
  registerDomainHandler(actionExecutor, 'procurement:requisition:approve', governance.approveRequisition);
  registerDomainHandler(actionExecutor, 'procurement:rfq:create', rfq.createRfq);
  registerDomainHandler(actionExecutor, 'procurement:supplier_quotation:record', rfq.submitSupplierQuotation);
  registerDomainHandler(actionExecutor, 'procurement:supplier_quotation:award', rfq.awardSupplierQuotation);
  registerDomainHandler(actionExecutor, 'procurement:order:create', orders.createPurchaseOrder);
  registerDomainHandler(actionExecutor, 'procurement:order:approve', orders.approvePurchaseOrder);
  registerDomainHandler(actionExecutor, 'procurement:order:confirm', orders.confirmPurchaseOrder);
  registerDomainHandler(actionExecutor, 'procurement:receipt:post', lifecycle.postPurchaseReceipt);
  registerDomainHandler(actionExecutor, 'procurement:threewaymatch:perform', matching.performThreeWayMatch);
  registerDomainHandler(actionExecutor, 'procurement:bill_request:create', matching.createSupplierBillRequest);
  registerDomainHandler(actionExecutor, 'procurement:return:create', lifecycle.createPurchaseReturn);
  registerDomainHandler(actionExecutor, 'procurement:score:record', lifecycle.recordSupplierScore);
}
