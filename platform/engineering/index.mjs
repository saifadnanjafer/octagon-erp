// Engineering + MRP domain registration — Checkpoint D2.
//
// Every mutation is a governed ActionExecutor command. Actor, company, and
// branch scope are applied by registerDomainHandler from the verified session
// context.

'use strict';

import { registerDomainHandler } from '../kernel/actions/domain-handler.mjs';

import * as bom from './bom.mjs';
import * as routing from './routing.mjs';
import * as mrp from './mrp.mjs';

export { bom, routing, mrp };
export { EngineeringError } from './bom.mjs';

export function registerEngineeringActions(actionExecutor) {
  if (!actionExecutor || typeof actionExecutor.registerHandler !== 'function') {
    throw new TypeError('canonical ActionExecutor with registerHandler() is required');
  }

  // BOM
  registerDomainHandler(actionExecutor, 'engineering:bom:create', bom.createBom);
  registerDomainHandler(actionExecutor, 'engineering:bom:add_line', bom.addBomLine);
  registerDomainHandler(actionExecutor, 'engineering:bom:remove_line', bom.removeBomLine);
  registerDomainHandler(actionExecutor, 'engineering:bom:submit', bom.submitBom);
  registerDomainHandler(actionExecutor, 'engineering:bom:approve', bom.approveBom);
  registerDomainHandler(actionExecutor, 'engineering:bom:reject', bom.rejectBom);
  registerDomainHandler(actionExecutor, 'engineering:bom:new_revision', bom.newBomRevision);
  registerDomainHandler(actionExecutor, 'engineering:bom:supersede', bom.supersedeBom);

  // Engineering change orders
  registerDomainHandler(actionExecutor, 'engineering:eco:create', routing.createEco);
  registerDomainHandler(actionExecutor, 'engineering:eco:approve', routing.approveEco);
  registerDomainHandler(actionExecutor, 'engineering:eco:reject', routing.rejectEco);

  // Work centers
  registerDomainHandler(actionExecutor, 'engineering:work_center:create', routing.createWorkCenter);
  registerDomainHandler(actionExecutor, 'engineering:work_center:update', routing.updateWorkCenter);
  registerDomainHandler(actionExecutor, 'engineering:work_center:add_resource', routing.addWorkCenterResource);

  // Routing
  registerDomainHandler(actionExecutor, 'engineering:routing:create', routing.createRouting);
  registerDomainHandler(actionExecutor, 'engineering:routing:add_operation', routing.addRoutingOperation);
  registerDomainHandler(actionExecutor, 'engineering:routing:submit', routing.submitRouting);
  registerDomainHandler(actionExecutor, 'engineering:routing:approve', routing.approveRouting);
  registerDomainHandler(actionExecutor, 'engineering:routing:new_revision', routing.newRoutingRevision);

  // MRP — proposals only, never a commitment
  registerDomainHandler(actionExecutor, 'mrp:policy:set', mrp.setItemPolicy);
  registerDomainHandler(actionExecutor, 'mrp:demand:record', mrp.recordDemand);
  registerDomainHandler(actionExecutor, 'mrp:run:execute', mrp.runMrp);
  registerDomainHandler(actionExecutor, 'mrp:proposal:approve', mrp.approveProposal);
  registerDomainHandler(actionExecutor, 'mrp:proposal:reject', mrp.rejectProposal);

  return actionExecutor;
}
