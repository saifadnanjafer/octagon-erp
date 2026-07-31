// Shared binder for canonical domain-action handlers.
//
// HTTP callers are never an authority for actor, company, or branch scope.
// The verified session context is applied here at the final boundary before
// the domain function receives its payload.

'use strict';

export class DomainScopeError extends Error {
  constructor(message, code = 'UNTRUSTED_ACTION_SCOPE') {
    super(message);
    this.name = 'DomainScopeError';
    this.code = code;
    this.statusCode = 403;
  }
}

function assertCompatible(input, keys, trustedValue, label) {
  for (const key of keys) {
    if (input[key] === undefined || input[key] === null || input[key] === '') continue;
    if (!trustedValue || String(input[key]) !== String(trustedValue)) {
      throw new DomainScopeError(`${label} must come from the verified session`);
    }
  }
}

export function trustedActionInput(input = {}, ctx = {}) {
  const effectiveCtx = { ...ctx };
  if (!effectiveCtx.companyId && effectiveCtx.activeCompanyId) effectiveCtx.companyId = effectiveCtx.activeCompanyId;
  if (!effectiveCtx.userId && effectiveCtx.actorId) effectiveCtx.userId = effectiveCtx.actorId;

  if (!effectiveCtx.companyId) {
    throw new DomainScopeError('an active company scope is required', 'COMPANY_SCOPE_REQUIRED');
  }
  if (!effectiveCtx.userId) {
    throw new DomainScopeError('an authenticated actor is required', 'ACTOR_REQUIRED');
  }

  assertCompatible(input, ['company_id', 'companyId'], effectiveCtx.companyId, 'company scope');
  assertCompatible(input, ['branch_id', 'branchId'], effectiveCtx.branchId, 'branch scope');
  assertCompatible(input, ['actor', 'actor_id', 'created_by', 'requested_by'], effectiveCtx.userId, 'actor identity');

  const scoped = { ...input };
  for (const key of [
    'company_id', 'companyId', 'branch_id', 'branchId',
    'actor', 'actor_id', 'created_by', 'requested_by', 'user_id',
  ]) {
    delete scoped[key];
  }

  scoped.company_id = effectiveCtx.companyId;
  if (effectiveCtx.branchId) scoped.branch_id = effectiveCtx.branchId;
  scoped.actor = effectiveCtx.userId;
  scoped.actor_id = effectiveCtx.userId;
  scoped.created_by = effectiveCtx.userId;
  scoped.requested_by = effectiveCtx.userId;
  scoped.user_id = effectiveCtx.userId;
  return scoped;
}

export function registerDomainHandler(actionExecutor, actionId, handler) {
  if (!actionExecutor || typeof actionExecutor.registerHandler !== 'function') {
    throw new TypeError('canonical ActionExecutor with registerHandler() is required');
  }
  actionExecutor.registerHandler(actionId, (opts, maybeCtx) => {
    const input = opts?.input !== undefined ? opts.input : opts;
    const ctx = opts?.ctx || maybeCtx || {};
    const dialect = opts?.dialect || actionExecutor.db;
    const trustedInput = trustedActionInput(input, ctx);
    return handler(dialect, trustedInput);
  });
}
