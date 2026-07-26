import * as maintenance from './maintenance.mjs';
import * as reports from './reports.mjs';
import { registerGatedHandler, PHASE05_MODULE_FLAGS } from '../control_plane/phase05.mjs';

export { maintenance, reports };

const FLAG = PHASE05_MODULE_FLAGS.maintenance;

export function registerMaintenanceActions(actionExecutor) {
  const gate = (actionId, handler) => registerGatedHandler(actionExecutor, actionId, handler, FLAG, 'Maintenance');

  gate('maintenance:team:create', maintenance.createTeam);
  gate('maintenance:request:create', maintenance.createRequest);
  gate('maintenance:plan:create', maintenance.createPlan);
  gate('maintenance:plan:generate', maintenance.generatePreventiveOrders);
  gate('maintenance:order:create', maintenance.createOrder);
  gate('maintenance:order:approve', maintenance.approveOrder);
  gate('maintenance:order:start', maintenance.startOrder);
  gate('maintenance:part:issue', maintenance.issueSparePart);
  gate('maintenance:labor:record', maintenance.recordLabor);
  gate('maintenance:order:complete', maintenance.completeOrder);
  gate('maintenance:order:hold', maintenance.holdOrder);
  gate('maintenance:order:return_to_service', maintenance.returnToService);
  gate('maintenance:order:cancel', maintenance.cancelOrder);
}
