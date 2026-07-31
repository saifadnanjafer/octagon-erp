// platform/domains/wave2-actions.mjs — Final Page Catalog · Wave 2 action wiring.
//
// Registers every Wave 2 governed action against the REAL kernel contract:
//
//   1. a row in platform_actions  (definition: permission, schema, policies)
//   2. actionExecutor.registerHandler(id, fn)  (runtime handler)
//
// This replaces the two non-functional registration dialects Wave 2 shipped
// (executor.registerAction({...}) and actionRegistry.register(id, fn)); neither
// existed on the kernel, so none of the 106 Wave 2 actions could ever execute.
// Modelled exactly on platform/domains/crm/index.mjs, which is the one Wave
// module that works.
//
// Scope discipline is inherited from registerDomainHandler:
//   - company_id / branch_id / actor come from the verified session, never the
//     request body;
//   - a request that tries to assert a different scope is refused with
//     UNTRUSTED_ACTION_SCOPE (403).
//
// Several Wave 2 services take a third `user` argument (`user.id`). The kernel
// passes only (db, payload), so bindService() supplies `{ id: payload.user_id }`
// from the already-trusted payload. Two-argument services simply ignore it.

'use strict';

import { registerDomainHandler } from '../kernel/actions/domain-handler.mjs';
import { WAVE2_DOMAINS, allActions } from './wave2-registry.mjs';

const ERROR_CONTRACT = JSON.stringify({
  envelope: 'stable',
  rollback: 'business mutation, audit, outbox, and idempotency are atomic',
  codes: [
    'INPUT_MISSING_FIELD', 'IDEMPOTENCY_KEY_REQUIRED', 'UNTRUSTED_ACTION_SCOPE',
    'COMPANY_SCOPE_REQUIRED', 'ACTOR_REQUIRED', 'PRECONDITION_FAILED',
    'MODULE_NOT_ENABLED',
  ],
});

/**
 * Seed/refresh the platform_actions definition row for every Wave 2 action.
 * Idempotent: safe to call on every boot.
 */
export function ensureWave2ActionDefinitions(dialect) {
  if (!dialect || typeof dialect.prepare !== 'function') return 0;

  const now = new Date().toISOString();
  const insert = dialect.prepare(`
    INSERT INTO platform_actions (
      id, module_id, entity_id, kind, allowed_states, required_permission,
      required_scope, input_schema, preconditions, transaction_owner,
      idempotency_policy, sequence_policy, audit_policy, outbox_policy,
      reversal_action, result_schema, error_contract, created_at, updated_at
    ) VALUES (?, ?, ?, 'domain', '[]', ?, 'company', ?, '[]',
      'platform_action_executor', 'required', 'none', 'required', 'required',
      NULL, NULL, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      module_id = excluded.module_id,
      entity_id = excluded.entity_id,
      kind = excluded.kind,
      required_permission = excluded.required_permission,
      required_scope = excluded.required_scope,
      input_schema = excluded.input_schema,
      transaction_owner = excluded.transaction_owner,
      idempotency_policy = excluded.idempotency_policy,
      audit_policy = excluded.audit_policy,
      outbox_policy = excluded.outbox_policy,
      error_contract = excluded.error_contract,
      updated_at = excluded.updated_at
  `);

  let count = 0;
  for (const action of allActions()) {
    insert.run(
      action.id,
      action.moduleId,
      action.entity,
      action.permission,
      JSON.stringify({ type: 'object', required: action.required || [] }),
      ERROR_CONTRACT,
      now,
      now,
    );
    count += 1;
  }
  return count;
}

/**
 * Wrap a domain service so it receives the `user` object some Wave 2 services
 * expect, built from the already-trusted payload rather than from the request.
 */
function bindService(serviceModule, fnName, actionId) {
  const fn = serviceModule[fnName];
  if (typeof fn !== 'function') {
    throw new TypeError(`wave2 action ${actionId} references missing service function ${fnName}()`);
  }
  return (db, payload) => fn(db, payload, { id: payload.user_id || payload.actor || 'system' });
}

/**
 * Register every Wave 2 handler on the canonical ActionExecutor.
 * Returns the number of handlers registered.
 */
export function registerWave2Actions(actionExecutor) {
  if (!actionExecutor || typeof actionExecutor.registerHandler !== 'function') {
    throw new TypeError('canonical ActionExecutor with registerHandler() is required');
  }

  if (actionExecutor.dialect) ensureWave2ActionDefinitions(actionExecutor.dialect);

  let count = 0;
  for (const domain of WAVE2_DOMAINS) {
    for (const action of domain.actions) {
      registerDomainHandler(
        actionExecutor,
        action.id,
        bindService(domain.service, action.fn, action.id),
      );
      count += 1;
    }
  }
  return count;
}

/**
 * Self-check used by the regression suite: every declared action must resolve
 * to a real exported service function. Returns the list of broken references
 * (empty when healthy) instead of throwing, so the test can report all of them.
 */
export function verifyWave2ServiceBindings() {
  const broken = [];
  for (const domain of WAVE2_DOMAINS) {
    for (const action of domain.actions) {
      if (typeof domain.service[action.fn] !== 'function') {
        broken.push({ action: action.id, missing: `${domain.key}.${action.fn}` });
      }
    }
  }
  return broken;
}
