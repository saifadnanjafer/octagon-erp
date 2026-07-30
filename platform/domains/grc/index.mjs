// platform/domains/grc/index.mjs — GRC & Internal Audit Module Registration.

import * as service from './service.mjs';

export const id = 'grc';
export const name = 'Governance, Risk, Compliance, and Internal Audit';

export function registerActions(actionRegistry) {
  actionRegistry.register('grc:create-risk', async (ctx, params) => {
    return service.createRisk(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('grc:add-risk-mitigation', async (ctx, params) => {
    return service.addRiskMitigation(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('grc:create-framework', async (ctx, params) => {
    return service.createComplianceFramework(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('grc:create-control', async (ctx, params) => {
    return service.createControl(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('grc:evaluate-control', async (ctx, params) => {
    return service.evaluateControl(ctx.db, { ...params, company_id: ctx.companyId, tester_id: ctx.userId });
  });

  actionRegistry.register('grc:create-internal-audit', async (ctx, params) => {
    return service.createInternalAudit(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('grc:log-audit-finding', async (ctx, params) => {
    return service.logAuditFinding(ctx.db, { ...params, company_id: ctx.companyId });
  });
}

export const permissions = [
  'grc.manage',
  'risk.manage',
  'compliance.manage',
  'audit.internal',
  'audit.findings'
];
