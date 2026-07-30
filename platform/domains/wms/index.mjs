// platform/domains/wms/index.mjs — Advanced Warehouse Management Module Registration.

import * as service from './service.mjs';

export const id = 'wms';
export const name = 'Advanced Warehouse Management System';

export function registerActions(actionRegistry) {
  actionRegistry.register('wms:create-warehouse', async (ctx, params) => {
    return service.createWarehouse(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('wms:create-zone', async (ctx, params) => {
    return service.createZone(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('wms:create-bin', async (ctx, params) => {
    return service.createBin(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('wms:receive-inventory', async (ctx, params) => {
    return service.receiveInventoryToBin(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('wms:create-wave', async (ctx, params) => {
    return service.createWavePicking(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('wms:add-pick-task', async (ctx, params) => {
    return service.addPickTask(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('wms:execute-bin-transfer', async (ctx, params) => {
    return service.executeBinTransfer(ctx.db, { ...params, company_id: ctx.companyId, transferred_by: ctx.userId });
  });

  actionRegistry.register('wms:create-cycle-count', async (ctx, params) => {
    return service.createCycleCount(ctx.db, { ...params, company_id: ctx.companyId, counter_id: ctx.userId });
  });
}

export const permissions = [
  'wms.manage',
  'wms.warehouse.manage',
  'wms.bin.manage',
  'wms.picking.wave',
  'wms.bin.transfer',
  'wms.cycle_count'
];
