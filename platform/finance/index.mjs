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
    .registerHandler('finance_document:submit', ({ dialect, ctx, input }) => ({ submitted: input.document_id })) // no-op state change for Wave A
    .registerHandler('finance_document:post', ({ dialect, ctx, input }) => engine.postDocument(dialect, ctx, input))
    .registerHandler('finance_document:reverse', ({ dialect, ctx, input }) => engine.reverseDocument(dialect, ctx, input))
    .registerHandler('finance_document:amend', ({ dialect, ctx, input }) => engine.amendDocument(dialect, ctx, input))
    .registerHandler('finance_period:open', ({ dialect, ctx, input }) => engine.openPeriod(dialect, ctx, input))
    .registerHandler('finance_period:soft_close', ({ dialect, ctx, input }) => engine.softClosePeriod(dialect, ctx, input))
    .registerHandler('finance_period:hard_close', ({ dialect, ctx, input }) => engine.hardClosePeriod(dialect, ctx, input))
    .registerHandler('finance_period:reopen', ({ dialect, ctx, input }) => engine.reopenPeriod(dialect, ctx, input))
    .registerHandler('finance_journal:verify_integrity', ({ dialect, ctx, input }) => engine.verifyHashChain(dialect, ctx, input));

  return executor;
}

export * from './engine.mjs';
