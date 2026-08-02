'use strict';

import { createServiceEntitlementService } from './entitlements.mjs';
import { createElectronicSignatureService } from './esignatures.mjs';

export { createServiceEntitlementService, createElectronicSignatureService };
export function registerServiceActions(actionExecutor, services) {
  const { serviceEntitlementService: entitlements, electronicSignatureService: signatures } = services;
  const bind = (action, handler) => actionExecutor.registerHandler(action, ({ input, ctx }) => handler(input, ctx));
  bind('service_contract:create', (input, ctx) => entitlements.createContract(input, ctx));
  for (const state of ['validate', 'submit', 'approve', 'activate', 'suspend', 'resume']) bind(`service_contract:${state}`, (input, ctx) => entitlements.transition(input.contract_id || input.contractId, ({ validate: 'validated', submit: 'submitted', approve: 'approved', activate: 'active', suspend: 'suspended', resume: 'active' })[state], ctx));
  bind('entitlement:policy_create', (input, ctx) => entitlements.createPolicy(input, ctx)); bind('entitlement:policy_publish', (input, ctx) => entitlements.publishPolicy(input.policy_id || input.policyId, ctx)); bind('entitlement:evaluate', (input, ctx) => entitlements.evaluate(input, ctx)); bind('entitlement:consume', (input, ctx) => entitlements.consume(input, ctx)); bind('entitlement:reverse', (input, ctx) => entitlements.reverse(input, ctx));
  bind('signature:provider_enable', (input, ctx) => signatures.provider(input, ctx)); bind('signature:request_create', (input, ctx) => signatures.create(input, ctx)); bind('signature:signer_add', (input, ctx) => signatures.addSigner(input.request_id || input.requestId, input, ctx)); bind('signature:prepare', (input, ctx) => signatures.prepare(input.request_id || input.requestId, ctx)); bind('signature:send', (input, ctx) => signatures.send(input.request_id || input.requestId, ctx)); bind('signature:simulate_view', (input, ctx) => signatures.view(input.request_id || input.requestId, input.event_key || input.eventKey, ctx)); bind('signature:simulate_sign', (input, ctx) => signatures.sign(input.request_id || input.requestId, input.order, input.event_key || input.eventKey, ctx)); bind('signature:verify_evidence', (input, ctx) => signatures.verify(input.request_id || input.requestId, ctx));
}
