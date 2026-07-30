// platform/domains/procurement/index.mjs — Advanced Procurement Module Registration.

import * as service from './service.mjs';

export const id = 'procurement';
export const name = 'Advanced Procurement and Supplier Portal';

export function registerActions(actionRegistry) {
  actionRegistry.register('procurement:create-requisition', async (ctx, params) => {
    return service.createRequisition(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('procurement:add-requisition-line', async (ctx, params) => {
    return service.addRequisitionLine(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('procurement:approve-requisition', async (ctx, params) => {
    return service.approveRequisition(ctx.db, { ...params, company_id: ctx.companyId, approved_by: ctx.userId });
  });

  actionRegistry.register('procurement:create-rfq', async (ctx, params) => {
    return service.createRFQ(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('procurement:invite-supplier', async (ctx, params) => {
    return service.inviteSupplierToRFQ(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('procurement:publish-rfq', async (ctx, params) => {
    return service.publishRFQ(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('procurement:submit-bid', async (ctx, params) => {
    return service.submitSupplierBid(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('procurement:award-rfq', async (ctx, params) => {
    return service.awardRFQ(ctx.db, { ...params, company_id: ctx.companyId, awarded_by: ctx.userId });
  });

  actionRegistry.register('procurement:evaluate-supplier', async (ctx, params) => {
    return service.evaluateSupplierPerformance(ctx.db, { ...params, company_id: ctx.companyId, evaluator_id: ctx.userId });
  });
}

export const permissions = [
  'procurement.manage',
  'procurement.requisition',
  'procurement.rfq',
  'procurement.bid',
  'procurement.award',
  'supplier.portal'
];
