import * as config from './config.mjs';
import * as engineering from './engineering.mjs';
import * as orders from './orders.mjs';
import * as materials from './materials.mjs';
import * as execution from './execution.mjs';
import * as completion from './completion.mjs';
import * as planning from './planning.mjs';
import * as subcontracting from './subcontracting.mjs';
import * as reports from './reports.mjs';
import { registerGatedHandler, PHASE05_MODULE_FLAGS } from '../control_plane/phase05.mjs';

export {
  config, engineering, orders, materials, execution, completion,
  planning, subcontracting, reports,
};

const MFG = PHASE05_MODULE_FLAGS.manufacturing;
const PLAN = PHASE05_MODULE_FLAGS.planning;

export function registerManufacturingActions(actionExecutor) {
  const mfg = (actionId, handler) => registerGatedHandler(actionExecutor, actionId, handler, MFG, 'Manufacturing');
  const plan = (actionId, handler) => registerGatedHandler(actionExecutor, actionId, handler, PLAN, 'Production planning');

  mfg('manufacturing:work_center:create', config.createWorkCenter);
  mfg('manufacturing:account_mapping:set', config.setAccountMapping);

  mfg('manufacturing:bom:create', engineering.createBom);
  mfg('manufacturing:bom:revise', engineering.reviseBom);
  mfg('manufacturing:bom:approve', engineering.approveBom);
  mfg('manufacturing:bom:update_lines', engineering.updateBomLines);
  mfg('manufacturing:routing:create', engineering.createRouting);
  mfg('manufacturing:routing:approve', engineering.approveRouting);
  mfg('manufacturing:engineering_change:create', engineering.createEngineeringChange);
  mfg('manufacturing:engineering_change:approve', engineering.approveEngineeringChange);

  mfg('manufacturing:order:create', orders.createProductionOrder);
  mfg('manufacturing:order:plan', orders.planProductionOrder);
  mfg('manufacturing:order:approve', orders.approveProductionOrder);
  mfg('manufacturing:order:release', orders.releaseProductionOrder);
  mfg('manufacturing:order:cancel', orders.cancelProductionOrder);
  mfg('manufacturing:order:close', orders.closeProductionOrder);

  mfg('manufacturing:material:issue', materials.issueMaterial);
  mfg('manufacturing:material:return', materials.returnMaterial);
  mfg('manufacturing:material:scrap', materials.scrapMaterial);

  mfg('manufacturing:work_order:start', execution.startWorkOrder);
  mfg('manufacturing:work_order:pause', execution.pauseWorkOrder);
  mfg('manufacturing:work_order:resume', execution.resumeWorkOrder);
  mfg('manufacturing:work_order:hold', execution.holdWorkOrder);
  mfg('manufacturing:work_order:complete', execution.completeWorkOrder);
  mfg('manufacturing:work_order:time_entry', execution.recordTimeEntry);

  mfg('manufacturing:order:complete', completion.completeProduction);
  mfg('manufacturing:order:variance', completion.postProductionVariance);

  plan('manufacturing:planning:policy', planning.setPlanningPolicy);
  plan('manufacturing:planning:run', planning.runMaterialPlanning);
  plan('manufacturing:planning:accept', planning.acceptPlanningProposal);
  plan('manufacturing:planning:reject', planning.rejectPlanningProposal);

  plan('manufacturing:subcontract:transfer', subcontracting.transferComponentsToSubcontractor);
  plan('manufacturing:subcontract:receive', subcontracting.receiveSubcontractOutput);
  plan('manufacturing:subcontract:return', subcontracting.returnComponentsFromSubcontractor);
}
