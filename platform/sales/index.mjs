import * as crm from './crm.mjs';
import * as orders from './orders.mjs';
import * as contracts from './contracts.mjs';

export { crm, orders, contracts };

export function registerSalesActions(actionRegistry) {
  if (!actionRegistry || typeof actionRegistry.register !== 'function') return;

  actionRegistry.register('crm:lead:create', {
    permission: 'crm:lead:write',
    handler: async (ctx, payload) => crm.createLead(ctx.db, payload)
  });

  actionRegistry.register('crm:lead:update_stage', {
    permission: 'crm:lead:write',
    handler: async (ctx, payload) => crm.updateLeadStage(ctx.db, payload)
  });

  actionRegistry.register('sales:quotation:create', {
    permission: 'sales:order:write',
    handler: async (ctx, payload) => orders.createQuotation(ctx.db, payload)
  });

  actionRegistry.register('sales:order:confirm', {
    permission: 'sales:order:write',
    handler: async (ctx, payload) => orders.confirmSalesOrder(ctx.db, payload)
  });

  actionRegistry.register('sales:invoice_request:create', {
    permission: 'sales:invoice:write',
    handler: async (ctx, payload) => orders.createFiscalInvoiceRequest(ctx.db, payload)
  });
}
