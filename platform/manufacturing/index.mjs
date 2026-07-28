// platform/manufacturing/index.mjs — Manufacturing Domain Action Registration.

'use strict';

import { registerDomainHandler } from '../kernel/actions/domain-handler.mjs';

import * as orders from './manufacturing-orders.mjs';
import * as workOrders from './work-orders.mjs';
import * as material from './material-issues.mjs';
import * as subcontracting from './subcontracting.mjs';

export { orders, workOrders, material, subcontracting };
export { ManufacturingError } from './manufacturing-orders.mjs';

export function registerManufacturingActions(actionExecutor) {
  if (!actionExecutor || typeof actionExecutor.registerHandler !== 'function') {
    throw new TypeError('canonical ActionExecutor with registerHandler() is required');
  }

  // Manufacturing orders
  registerDomainHandler(actionExecutor, 'manufacturing:order:create', orders.createProductionOrder);
  registerDomainHandler(actionExecutor, 'manufacturing:order:plan', orders.planProductionOrder);
  registerDomainHandler(actionExecutor, 'manufacturing:order:release', orders.releaseProductionOrder);
  registerDomainHandler(actionExecutor, 'manufacturing:order:reserve_materials', orders.reserveMaterials);
  registerDomainHandler(actionExecutor, 'manufacturing:order:hold', orders.holdProductionOrder);
  registerDomainHandler(actionExecutor, 'manufacturing:order:cancel', orders.cancelProductionOrder);
  registerDomainHandler(actionExecutor, 'manufacturing:order:complete', material.completeProductionOrder);
  registerDomainHandler(actionExecutor, 'manufacturing:order:close', material.closeProductionOrder);

  // Work orders & shop floor
  registerDomainHandler(actionExecutor, 'manufacturing:work_order:start', workOrders.startWorkOrder);
  registerDomainHandler(actionExecutor, 'manufacturing:work_order:pause', workOrders.pauseWorkOrder);
  registerDomainHandler(actionExecutor, 'manufacturing:work_order:resume', workOrders.resumeWorkOrder);
  registerDomainHandler(actionExecutor, 'manufacturing:work_order:complete', workOrders.completeWorkOrder);
  registerDomainHandler(actionExecutor, 'manufacturing:work_order:record_labor', workOrders.recordLabor);

  // Material issues & returns
  registerDomainHandler(actionExecutor, 'manufacturing:material:issue', material.issueMaterial);
  registerDomainHandler(actionExecutor, 'manufacturing:material:return', material.returnMaterial);

  // Subcontracting
  registerDomainHandler(actionExecutor, 'manufacturing:subcontract:create', subcontracting.createSubcontractOrder);
  registerDomainHandler(actionExecutor, 'manufacturing:subcontract:dispatch_components', subcontracting.dispatchSubcontractComponents);
  registerDomainHandler(actionExecutor, 'manufacturing:subcontract:receive_goods', subcontracting.receiveSubcontractGoods);
  registerDomainHandler(actionExecutor, 'manufacturing:subcontract:reconcile', subcontracting.reconcileSubcontract);

  return actionExecutor;
}

export function handleManufacturingQuery({ dialect, ctx, resource, recordId, query }) {
  const companyId = ctx.companyId || '*';

  if (resource === 'production-orders' || resource === 'production_orders') {
    if (recordId) {
      const doc = dialect.prepare('SELECT * FROM mfg_production_orders WHERE id = ?').get(recordId);
      return doc ? { data: doc } : { error: 'production order not found', status: 404 };
    }
    const rows = dialect.prepare('SELECT * FROM mfg_production_orders ORDER BY created_at DESC').all();
    return { data: rows, meta: { total: rows.length } };
  }

  if (resource === 'work-orders' || resource === 'work_orders') {
    if (recordId) {
      const doc = dialect.prepare('SELECT * FROM mfg_work_orders WHERE id = ?').get(recordId);
      return doc ? { data: doc } : { error: 'work order not found', status: 404 };
    }
    const rows = dialect.prepare('SELECT * FROM mfg_work_orders ORDER BY created_at DESC').all();
    return { data: rows, meta: { total: rows.length } };
  }

  if (resource === 'material-requirements' || resource === 'material_requirements') {
    const rows = dialect.prepare('SELECT * FROM mfg_material_requirements ORDER BY created_at DESC').all();
    return { data: rows, meta: { total: rows.length } };
  }

  if (resource === 'cost-summaries' || resource === 'cost_summaries') {
    const rows = dialect.prepare('SELECT * FROM mfg_production_cost_summaries ORDER BY created_at DESC').all();
    return { data: rows, meta: { total: rows.length } };
  }

  if (resource === 'subcontract-orders' || resource === 'subcontract_orders') {
    const rows = dialect.prepare('SELECT * FROM mfg_subcontract_orders ORDER BY created_at DESC').all();
    return { data: rows, meta: { total: rows.length } };
  }

  return { error: `unknown manufacturing resource ${resource}`, status: 404 };
}
