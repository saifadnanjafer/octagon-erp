import * as crm from './crm.mjs';
import * as orders from './orders.mjs';
import * as contracts from './contracts.mjs';
import { registerDomainHandler } from '../kernel/actions/domain-handler.mjs';

export { crm, orders, contracts };

export function registerSalesActions(actionExecutor) {
  registerDomainHandler(actionExecutor, 'crm:lead:create', crm.createLead);
  registerDomainHandler(actionExecutor, 'crm:lead:update_stage', crm.updateLeadStage);
  registerDomainHandler(actionExecutor, 'sales:quotation:create', orders.createQuotation);
  registerDomainHandler(actionExecutor, 'sales:order:confirm', orders.confirmSalesOrder);
  registerDomainHandler(actionExecutor, 'sales:invoice_request:create', orders.createFiscalInvoiceRequest);
}
