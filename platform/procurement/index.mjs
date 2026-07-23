import * as governance from './governance.mjs';
import * as rfq from './rfq.mjs';
import * as orders from './orders.mjs';
import * as matching from './matching.mjs';

export { governance, rfq, orders, matching };

export function registerProcurementActions(actionRegistry) {
  if (!actionRegistry || typeof actionRegistry.register !== 'function') return;

  actionRegistry.register('procurement:requisition:create', {
    permission: 'purchase:requisition:write',
    handler: async (ctx, payload) => governance.createRequisition(ctx.db, payload)
  });

  actionRegistry.register('procurement:rfq:create', {
    permission: 'purchase:rfq:write',
    handler: async (ctx, payload) => rfq.createRfq(ctx.db, payload)
  });

  actionRegistry.register('procurement:order:create', {
    permission: 'purchase:order:write',
    handler: async (ctx, payload) => orders.createPurchaseOrder(ctx.db, payload)
  });

  actionRegistry.register('procurement:order:confirm', {
    permission: 'purchase:order:write',
    handler: async (ctx, payload) => orders.confirmPurchaseOrder(ctx.db, payload)
  });

  actionRegistry.register('procurement:threewaymatch:perform', {
    permission: 'purchase:match:write',
    handler: async (ctx, payload) => matching.performThreeWayMatch(ctx.db, payload)
  });

  actionRegistry.register('procurement:bill_request:create', {
    permission: 'purchase:bill:write',
    handler: async (ctx, payload) => matching.createSupplierBillRequest(ctx.db, payload)
  });
}
