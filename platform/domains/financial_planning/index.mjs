// platform/domains/financial_planning/index.mjs — Budgeting & Financial Planning Module Registration.

import * as service from './service.mjs';

export const id = 'financial_planning';
export const name = 'Budgeting, Forecasting, and Financial Planning';

export function registerActions(actionRegistry) {
  actionRegistry.register('financial_planning:create-cost-center', async (ctx, params) => {
    return service.createCostCenter(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('financial_planning:create-budget', async (ctx, params) => {
    return service.createFiscalBudget(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('financial_planning:add-budget-line', async (ctx, params) => {
    return service.addBudgetLine(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('financial_planning:approve-budget', async (ctx, params) => {
    return service.approveFiscalBudget(ctx.db, { ...params, company_id: ctx.companyId, approved_by: ctx.userId });
  });

  actionRegistry.register('financial_planning:commit-amount', async (ctx, params) => {
    return service.commitBudgetAmount(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('financial_planning:reallocate', async (ctx, params) => {
    return service.reallocateBudget(ctx.db, { ...params, company_id: ctx.companyId, requested_by: ctx.userId });
  });

  actionRegistry.register('financial_planning:create-forecast', async (ctx, params) => {
    return service.createFinancialForecast(ctx.db, { ...params, company_id: ctx.companyId });
  });
}

export const permissions = [
  'budgeting.manage',
  'budgeting.create',
  'budgeting.approve',
  'budgeting.reallocate',
  'forecasting.manage',
  'cost_center.manage'
];
