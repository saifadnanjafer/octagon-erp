// Canonical Projects domain registration — Checkpoint D1.
//
// Every mutation is a governed ActionExecutor command. Actor, company, and
// branch scope are applied by registerDomainHandler from the verified session
// context, so an HTTP caller can never assert its own scope.

'use strict';

import { registerDomainHandler, trustedActionInput } from '../kernel/actions/domain-handler.mjs';
import { postSourceFact } from '../finance/engine.mjs';

import * as projects from './projects.mjs';
import * as budget from './budget.mjs';
import * as billing from './billing.mjs';
import * as effort from './effort.mjs';
import * as costing from './costing.mjs';

export { projects, budget, billing, effort, costing };
export { ProjectError } from './errors.mjs';

export function registerProjectActions(actionExecutor) {
  if (!actionExecutor || typeof actionExecutor.registerHandler !== 'function') {
    throw new TypeError('canonical ActionExecutor with registerHandler() is required');
  }

  // Projects
  registerDomainHandler(actionExecutor, 'projects:project:create', projects.createProject);
  registerDomainHandler(actionExecutor, 'projects:project:update', projects.updateProject);
  registerDomainHandler(actionExecutor, 'projects:project:set_status', projects.setProjectStatus);
  registerDomainHandler(actionExecutor, 'projects:project:archive', projects.archiveProject);
  registerDomainHandler(actionExecutor, 'projects:project:apply_template', projects.applyTemplate);
  registerDomainHandler(actionExecutor, 'projects:template:create', projects.createTemplate);

  // Structure
  registerDomainHandler(actionExecutor, 'projects:phase:create', projects.createPhase);
  registerDomainHandler(actionExecutor, 'projects:phase:update', projects.updatePhase);
  registerDomainHandler(actionExecutor, 'projects:milestone:create', projects.createMilestone);
  registerDomainHandler(actionExecutor, 'projects:milestone:achieve', projects.achieveMilestone);

  // Tasks delegate to the canonical Work Item authority
  registerDomainHandler(actionExecutor, 'projects:task:create', projects.createProjectTask);

  // Budget and commitments
  registerDomainHandler(actionExecutor, 'projects:cost_code:create', budget.createCostCode);
  registerDomainHandler(actionExecutor, 'projects:budget:set_line', budget.setBudgetLine);
  registerDomainHandler(actionExecutor, 'projects:budget:approve', budget.approveBudget);
  registerDomainHandler(actionExecutor, 'projects:budget:revise', budget.reviseBudget);
  registerDomainHandler(actionExecutor, 'projects:commitment:record', budget.recordCommitment);
  registerDomainHandler(actionExecutor, 'projects:commitment:release', budget.releaseCommitment);

  // Governance
  registerDomainHandler(actionExecutor, 'projects:change_order:create', budget.createChangeOrder);
  registerDomainHandler(actionExecutor, 'projects:change_order:approve', budget.approveChangeOrder);
  registerDomainHandler(actionExecutor, 'projects:change_order:reject', budget.rejectChangeOrder);
  registerDomainHandler(actionExecutor, 'projects:risk:create', budget.createRisk);
  registerDomainHandler(actionExecutor, 'projects:risk:update', budget.updateRisk);
  registerDomainHandler(actionExecutor, 'projects:issue:create', budget.createIssue);
  registerDomainHandler(actionExecutor, 'projects:issue:resolve', budget.resolveIssue);

  // Effort — frozen-zone safe, configured standard rates only
  registerDomainHandler(actionExecutor, 'projects:effort:record', effort.recordEffort);

  // Billing — Finance stays the only GL writer
  registerDomainHandler(actionExecutor, 'projects:billing:request', billing.requestBilling);
  // Bound directly rather than via registerDomainHandler because this one
  // handler also needs the injected Finance posting dependency. The same
  // trustedActionInput scope guard still applies.
  actionExecutor.registerHandler('projects:billing:approve', ({ input, ctx, dialect }) => (
    billing.approveBilling(dialect, trustedActionInput(input, ctx), { postSourceFact })
  ));

  return actionExecutor;
}
