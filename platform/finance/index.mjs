import * as engine from './engine.mjs';

export function registerFinanceActions(executor) {
  if (!executor || typeof executor.registerHandler !== 'function') {
    throw new Error('ActionExecutor with registerHandler is required');
  }

  executor
    .registerHandler('finance_account:create', ({ dialect, ctx, input }) => engine.createAccount(dialect, ctx, input))
    .registerHandler('finance_account:update', ({ dialect, ctx, input }) => engine.updateAccount(dialect, ctx, input))
    .registerHandler('finance_account:deactivate', ({ dialect, ctx, input }) => engine.deactivateAccount(dialect, ctx, input))
    .registerHandler('finance_journal:create', ({ dialect, ctx, input }) => engine.createJournal(dialect, ctx, input))
    .registerHandler('finance_document:create', ({ dialect, ctx, input }) => engine.createDocument(dialect, ctx, input))
    .registerHandler('finance_document:submit', ({ dialect, ctx, input }) => engine.submitDocument(dialect, ctx, input))
    .registerHandler('finance_document:approve', ({ dialect, ctx, input }) => engine.approveDocument(dialect, ctx, input))
    .registerHandler('finance_document:post', ({ dialect, ctx, input }) => engine.postDocument(dialect, ctx, input))
    .registerHandler('finance_document:reverse', ({ dialect, ctx, input }) => engine.reverseDocument(dialect, ctx, input))
    .registerHandler('finance_document:amend', ({ dialect, ctx, input }) => engine.amendDocument(dialect, ctx, input))
    .registerHandler('finance_document:cancel', ({ dialect, ctx, input }) => engine.cancelDocument(dialect, ctx, input))
    .registerHandler('finance_period:open', ({ dialect, ctx, input }) => engine.openPeriod(dialect, ctx, input))
    .registerHandler('finance_period:soft_close', ({ dialect, ctx, input }) => engine.softClosePeriod(dialect, ctx, input))
    .registerHandler('finance_period:hard_close', ({ dialect, ctx, input }) => engine.hardClosePeriod(dialect, ctx, input))
    .registerHandler('finance_period:reopen', ({ dialect, ctx, input }) => engine.reopenPeriod(dialect, ctx, input))
    .registerHandler('finance_dimension:create', ({ dialect, ctx, input }) => engine.createDimension(dialect, ctx, input))
    .registerHandler('finance_dimension:value_create', ({ dialect, ctx, input }) => engine.createDimensionValue(dialect, ctx, input))
    .registerHandler('finance_dimension:policy_set', ({ dialect, ctx, input }) => engine.setAccountDimensionPolicy(dialect, ctx, input))
    .registerHandler('finance_journal:verify_integrity', ({ dialect, ctx, input }) => engine.verifyHashChain(dialect, ctx, input))
    .registerHandler('finance_currency:upsert', ({ dialect, ctx, input }) => engine.upsertCurrency(dialect, ctx, input))
    .registerHandler('finance_exchange_rate:upsert', ({ dialect, ctx, input }) => engine.upsertExchangeRate(dialect, ctx, input))
    .registerHandler('finance_fx:revalue', ({ dialect, ctx, input }) => engine.revalueForeignBalances(dialect, ctx, input))
    .registerHandler('finance_tax:create', ({ dialect, ctx, input }) => engine.createTax(dialect, ctx, input))
    .registerHandler('finance_tax:repartition_set', ({ dialect, ctx, input }) => engine.setTaxRepartitionLines(dialect, ctx, input))
    .registerHandler('finance_tax:quote', ({ dialect, ctx, input }) => engine.computeTax(dialect, ctx, input))
    .registerHandler('finance_withholding:category_create', ({ dialect, ctx, input }) => engine.createWithholdingCategory(dialect, ctx, input))
    .registerHandler('finance_withholding:evaluate', ({ dialect, ctx, input }) => engine.evaluateWithholding(dialect, ctx, input))
    .registerHandler('finance_fiscal_position:create', ({ dialect, ctx, input }) => engine.createFiscalPosition(dialect, ctx, input))
    .registerHandler('finance_fiscal_position:map_tax', ({ dialect, ctx, input }) => engine.mapFiscalPositionTax(dialect, ctx, input))
    .registerHandler('finance_fiscal_position:map_account', ({ dialect, ctx, input }) => engine.mapFiscalPositionAccount(dialect, ctx, input))
    .registerHandler('finance_localization:install', ({ dialect, ctx, input }) => engine.installLocalizationPack(dialect, ctx, input))
    .registerHandler('finance_due_schedule:set', ({ dialect, ctx, input }) => engine.setDueSchedule(dialect, ctx, input))
    .registerHandler('finance_ar:open_items', ({ dialect, ctx, input }) => engine.getCustomerOpenItems(dialect, ctx, input))
    .registerHandler('finance_ar:aging', ({ dialect, ctx, input }) => engine.getCustomerAging(dialect, ctx, input))
    .registerHandler('finance_ap:open_items', ({ dialect, ctx, input }) => engine.getSupplierOpenItems(dialect, ctx, input))
    .registerHandler('finance_ap:aging', ({ dialect, ctx, input }) => engine.getSupplierAging(dialect, ctx, input))
    .registerHandler('finance_ap:hold', ({ dialect, ctx, input }) => engine.holdPayment(dialect, ctx, input))
    .registerHandler('finance_ap:release_hold', ({ dialect, ctx, input }) => engine.releasePaymentHold(dialect, ctx, input))
    .registerHandler('finance_authority_limit:set', ({ dialect, ctx, input }) => engine.setApprovalAuthorityLimit(dialect, ctx, input));

  return executor;
}

export * from './engine.mjs';
