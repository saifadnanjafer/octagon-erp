import * as crm from './crm.mjs';
import * as orders from './orders.mjs';
import * as contracts from './contracts.mjs';
import * as lifecycle from './lifecycle.mjs';
import { registerDomainHandler } from '../kernel/actions/domain-handler.mjs';

export { crm, orders, contracts, lifecycle };

export function registerSalesActions(actionExecutor) {
  registerDomainHandler(actionExecutor, 'crm:lead:create', crm.createLead);
  registerDomainHandler(actionExecutor, 'crm:lead:update_stage', crm.updateLeadStage);
  registerDomainHandler(actionExecutor, 'crm:lead:convert', lifecycle.convertLead);
  registerDomainHandler(actionExecutor, 'crm:opportunity:update_stage', lifecycle.updateOpportunityStage);
  registerDomainHandler(actionExecutor, 'crm:opportunity:add_activity', lifecycle.addOpportunityActivity);
  registerDomainHandler(actionExecutor, 'crm:opportunity:close', lifecycle.closeOpportunity);
  registerDomainHandler(actionExecutor, 'sales:quotation:create', orders.createQuotation);
  registerDomainHandler(actionExecutor, 'sales:quotation:submit', lifecycle.submitQuotation);
  registerDomainHandler(actionExecutor, 'sales:quotation:approve', lifecycle.approveQuotation);
  registerDomainHandler(actionExecutor, 'sales:quotation:revise', lifecycle.reviseQuotation);
  registerDomainHandler(actionExecutor, 'sales:quotation:accept', lifecycle.acceptQuotation);
  registerDomainHandler(actionExecutor, 'sales:order:confirm', orders.confirmSalesOrder);
  registerDomainHandler(actionExecutor, 'sales:order:cancel', lifecycle.cancelSalesOrder);
  registerDomainHandler(actionExecutor, 'sales:order:reserve', lifecycle.reserveSalesOrder);
  registerDomainHandler(actionExecutor, 'sales:delivery:post', lifecycle.postSalesDelivery);
  registerDomainHandler(actionExecutor, 'sales:return:create', lifecycle.createSalesReturn);
  registerDomainHandler(actionExecutor, 'sales:invoice_request:create', orders.createFiscalInvoiceRequest);
  registerDomainHandler(actionExecutor, 'sales:commission:accrue', lifecycle.accrueCommission);
  registerDomainHandler(actionExecutor, 'sales:commission:approve', lifecycle.approveCommission);
  registerDomainHandler(actionExecutor, 'sales:commission:mark_paid', lifecycle.markCommissionPaid);
}
