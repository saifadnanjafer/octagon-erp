import * as projects from './projects.mjs';
import * as costing from './costing.mjs';
import * as billing from './billing.mjs';
import * as reports from './reports.mjs';
import { registerGatedHandler, PHASE05_MODULE_FLAGS } from '../control_plane/phase05.mjs';

export { projects, costing, billing, reports };

const FLAG = PHASE05_MODULE_FLAGS.projects;

export function registerProjectActions(actionExecutor) {
  const gate = (actionId, handler) => registerGatedHandler(actionExecutor, actionId, handler, FLAG, 'Projects');

  gate('project:create', projects.createProject);
  gate('project:update', projects.updateProject);
  gate('project:plan', projects.planProject);
  gate('project:approve', projects.approveProject);
  gate('project:activate', projects.activateProject);
  gate('project:hold', projects.holdProject);
  gate('project:complete', projects.completeProject);
  gate('project:close', projects.closeProject);
  gate('project:cancel', projects.cancelProject);

  gate('project:template:create', projects.createTemplate);
  gate('project:template:apply', projects.applyTemplateDefinition);
  gate('project:phase:create', projects.createPhase);
  gate('project:milestone:create', projects.createMilestone);
  gate('project:milestone:achieve', projects.achieveMilestone);
  gate('project:member:assign', projects.assignMember);
  gate('project:work_item:create', projects.createProjectWorkItem);
  gate('project:change_order:create', projects.createChangeOrder);
  gate('project:change_order:approve', projects.approveChangeOrder);
  gate('project:risk:record', projects.recordRisk);
  gate('project:issue:record', projects.recordIssue);
  gate('project:document:attach', projects.attachDocument);

  gate('project:cost_code:create', costing.createCostCode);
  gate('project:budget:create', costing.createBudget);
  gate('project:budget:approve', costing.approveBudget);
  gate('project:budget:revise', costing.reviseBudget);
  gate('project:commitment:record', costing.recordCommitment);
  gate('project:commitment:release', costing.releaseCommitment);
  gate('project:effort:record', costing.recordEffort);
  gate('project:expense:record', costing.recordExpense);
  gate('project:material:issue', costing.issueMaterialToProject);
  gate('project:manufacturing:absorb', costing.absorbManufacturingCost);

  gate('project:billing_rule:set', billing.setBillingRule);
  gate('project:bill', billing.billProject);
  gate('project:retainage:release', billing.releaseRetainage);

  gate('project:snapshot:profitability', reports.snapshotProfitability);
}
