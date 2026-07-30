// platform/domains/expenses/index.mjs — Expenses and Business Travel Module Registration.

import * as service from './service.mjs';

export const id = 'expenses';
export const name = 'Expenses and Business Travel';

export function registerActions(actionRegistry) {
  actionRegistry.register('expenses:create-category', async (ctx, params) => {
    return service.createCategory(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('expenses:create-travel-request', async (ctx, params) => {
    return service.createTravelRequest(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('expenses:approve-travel-request', async (ctx, params) => {
    return service.approveTravelRequest(ctx.db, { ...params, company_id: ctx.companyId, approved_by: ctx.userId });
  });

  actionRegistry.register('expenses:create-report', async (ctx, params) => {
    return service.createExpenseReport(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('expenses:add-line', async (ctx, params) => {
    return service.addExpenseLine(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('expenses:submit-report', async (ctx, params) => {
    return service.submitExpenseReport(ctx.db, { ...params, company_id: ctx.companyId, submitted_by: ctx.userId });
  });

  actionRegistry.register('expenses:approve-report', async (ctx, params) => {
    return service.approveExpenseReport(ctx.db, { ...params, company_id: ctx.companyId, approved_by: ctx.userId });
  });

  actionRegistry.register('expenses:pay-report', async (ctx, params) => {
    return service.payExpenseReport(ctx.db, { ...params, company_id: ctx.companyId, paid_by: ctx.userId });
  });
}

export const permissions = [
  'expenses.manage',
  'expenses.create',
  'expenses.approve',
  'expenses.pay',
  'travel.request',
  'travel.approve'
];
