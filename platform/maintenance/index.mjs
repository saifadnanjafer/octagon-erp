// platform/maintenance/index.mjs — Maintenance Action Registration and Query Handler.

'use strict';

import { registerDomainHandler } from '../kernel/actions/domain-handler.mjs';

import * as orders from './maintenance-orders.mjs';
import * as preventive from './preventive-plans.mjs';

export { orders, preventive };
export { MaintenanceError } from './maintenance-orders.mjs';

export function registerMaintenanceActions(actionExecutor) {
  if (!actionExecutor || typeof actionExecutor.registerHandler !== 'function') {
    throw new TypeError('canonical ActionExecutor with registerHandler() is required');
  }

  registerDomainHandler(actionExecutor, 'maintenance:request:create', orders.createMaintenanceRequest);
  registerDomainHandler(actionExecutor, 'maintenance:request:approve', orders.approveMaintenanceRequest);
  registerDomainHandler(actionExecutor, 'maintenance:plan:create', preventive.createPreventivePlan);
  registerDomainHandler(actionExecutor, 'maintenance:order:create', orders.createMaintenanceOrder);
  registerDomainHandler(actionExecutor, 'maintenance:order:reserve_parts', orders.reserveSpareParts);
  registerDomainHandler(actionExecutor, 'maintenance:order:issue_parts', orders.issueSpareParts);
  registerDomainHandler(actionExecutor, 'maintenance:order:complete', orders.completeMaintenanceOrder);

  return actionExecutor;
}

export function handleMaintenanceQuery({ dialect, ctx, resource, recordId, query }) {
  if (resource === 'requests' || resource === 'maintenance_requests') {
    const rows = dialect.prepare('SELECT * FROM maintenance_requests ORDER BY created_at DESC').all();
    return { data: rows, meta: { total: rows.length } };
  }

  if (resource === 'plans' || resource === 'preventive_plans') {
    const rows = dialect.prepare('SELECT * FROM maintenance_preventive_plans ORDER BY created_at DESC').all();
    return { data: rows, meta: { total: rows.length } };
  }

  if (resource === 'orders' || resource === 'maintenance_orders') {
    if (recordId) {
      const doc = dialect.prepare('SELECT * FROM maintenance_orders WHERE id = ?').get(recordId);
      return doc ? { data: doc } : { error: 'maintenance order not found', status: 404 };
    }
    const rows = dialect.prepare('SELECT * FROM maintenance_orders ORDER BY created_at DESC').all();
    return { data: rows, meta: { total: rows.length } };
  }

  if (resource === 'spare-parts' || resource === 'spare_parts') {
    const rows = dialect.prepare('SELECT * FROM maintenance_spare_parts ORDER BY created_at DESC').all();
    return { data: rows, meta: { total: rows.length } };
  }

  return { error: `unknown maintenance resource ${resource}`, status: 404 };
}
