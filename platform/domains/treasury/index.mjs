// platform/domains/treasury/index.mjs — Treasury & Banking Module Registration.

import * as service from './service.mjs';

export const id = 'treasury';
export const name = 'Treasury, Banking, Cash Management, and Reconciliation';

export function registerActions(actionRegistry) {
  actionRegistry.register('treasury:create-bank-account', async (ctx, params) => {
    return service.createBankAccount(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('treasury:import-statement', async (ctx, params) => {
    return service.importBankStatement(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('treasury:add-statement-line', async (ctx, params) => {
    return service.addStatementLine(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('treasury:match-line', async (ctx, params) => {
    return service.matchStatementLine(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('treasury:finalize-reconciliation', async (ctx, params) => {
    return service.finalizeReconciliation(ctx.db, { ...params, company_id: ctx.companyId, reconciled_by: ctx.userId });
  });

  actionRegistry.register('treasury:execute-transfer', async (ctx, params) => {
    return service.executeCashTransfer(ctx.db, { ...params, company_id: ctx.companyId, initiated_by: ctx.userId });
  });
}

export const permissions = [
  'treasury.manage',
  'bank.account.manage',
  'bank.statement.import',
  'bank.reconcile',
  'cash.transfer'
];
