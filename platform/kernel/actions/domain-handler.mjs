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
  if (!ctx.companyId) {
    throw new DomainScopeError('an active company scope is required', 'COMPANY_SCOPE_REQUIRED');
  }
  if (!ctx.userId) {
    throw new DomainScopeError('an authenticated actor is required', 'ACTOR_REQUIRED');
  }

  assertCompatible(input, ['company_id', 'companyId'], ctx.companyId, 'company scope');
  assertCompatible(input, ['branch_id', 'branchId'], ctx.branchId, 'branch scope');
  assertCompatible(input, ['actor', 'actor_id', 'created_by', 'requested_by', 'user_id'], ctx.userId, 'actor identity');

  const scoped = { ...input };
  for (const key of [
    'company_id', 'companyId', 'branch_id', 'branchId',
    'actor', 'actor_id', 'created_by', 'requested_by', 'user_id',
  ]) {
    delete scoped[key];
  }

  scoped.company_id = ctx.companyId;
  if (ctx.branchId) scoped.branch_id = ctx.branchId;
  scoped.actor = ctx.userId;
  scoped.actor_id = ctx.userId;
  scoped.created_by = ctx.userId;
  scoped.requested_by = ctx.userId;
  scoped.user_id = ctx.userId;
  return scoped;
}

export function registerDomainHandler(actionExecutor, actionId, handler) {
  if (!actionExecutor || typeof actionExecutor.registerHandler !== 'function') {
    throw new TypeError('canonical ActionExecutor with registerHandler() is required');
  }
  actionExecutor.registerHandler(actionId, ({ input, ctx, dialect }) => {
    const scoped = trustedActionInput(input, ctx);
    // Handlers written as (db, input) ignore this 3rd argument; handlers written as
    // (db, input, ctx) receive the same trusted, scoped object both ways so ctx.company_id /
    // ctx.actor are always populated from the verified session, never from raw caller input.
    return handler(dialect, scoped, scoped);
  });
}
