// platform/domains/plm/index.mjs — PLM Module Registration.

import * as service from './service.mjs';

export const id = 'plm';
export const name = 'PLM and Engineering Change Control';

export function registerActions(actionRegistry) {
  actionRegistry.register('plm:create-revision', async (ctx, params) => {
    return service.createEngineeringRevision(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('plm:create-eco', async (ctx, params) => {
    return service.createECO(ctx.db, { ...params, company_id: ctx.companyId, initiator_id: ctx.userId });
  });

  actionRegistry.register('plm:add-affected-item', async (ctx, params) => {
    return service.addAffectedItemToECO(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('plm:add-approval-requirement', async (ctx, params) => {
    return service.addECOApprovalRequirement(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('plm:approve-department', async (ctx, params) => {
    return service.approveECODepartment(ctx.db, { ...params, company_id: ctx.companyId, approver_id: ctx.userId });
  });

  actionRegistry.register('plm:implement-eco', async (ctx, params) => {
    return service.implementECO(ctx.db, { ...params, company_id: ctx.companyId, implemented_by: ctx.userId });
  });
}

export const permissions = [
  'plm.manage',
  'plm.revision.create',
  'plm.eco.create',
  'plm.eco.approve',
  'plm.eco.implement'
];
