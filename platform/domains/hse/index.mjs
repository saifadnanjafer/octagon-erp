// platform/domains/hse/index.mjs — HSE & Safety Module Registration.

import * as service from './service.mjs';

export const id = 'hse';
export const name = 'HSE, Safety, Permits, and Incident Management';

export function registerActions(actionRegistry) {
  actionRegistry.register('hse:report-incident', async (ctx, params) => {
    return service.reportIncident(ctx.db, { ...params, company_id: ctx.companyId, reporter_id: ctx.userId });
  });

  actionRegistry.register('hse:investigate-incident', async (ctx, params) => {
    return service.investigateIncident(ctx.db, { ...params, company_id: ctx.companyId, investigator_id: ctx.userId });
  });

  actionRegistry.register('hse:create-capa', async (ctx, params) => {
    return service.createCAPA(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('hse:request-permit', async (ctx, params) => {
    return service.requestSafetyPermit(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('hse:issue-permit', async (ctx, params) => {
    return service.issueSafetyPermit(ctx.db, { ...params, company_id: ctx.companyId, issuer_id: ctx.userId });
  });

  actionRegistry.register('hse:record-inspection', async (ctx, params) => {
    return service.recordSafetyInspection(ctx.db, { ...params, company_id: ctx.companyId, inspector_id: ctx.userId });
  });
}

export const permissions = [
  'hse.manage',
  'hse.incident.report',
  'hse.incident.investigate',
  'hse.permit.issue',
  'hse.inspection.record'
];
