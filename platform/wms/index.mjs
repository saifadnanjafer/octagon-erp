import * as operations from './operations.mjs';
import * as counts from './counts.mjs';
import * as landedCost from './landed_cost.mjs';

export { operations, counts, landedCost };

export function registerWmsActions(actionRegistry) {
  if (!actionRegistry || typeof actionRegistry.register !== 'function') return;

  actionRegistry.register('wms:picking:create', {
    permission: 'stock:picking:write',
    handler: async (ctx, payload) => operations.createPicking(ctx.db, payload)
  });

  actionRegistry.register('wms:picking:validate', {
    permission: 'stock:picking:write',
    handler: async (ctx, payload) => operations.validatePicking(ctx.db, payload)
  });

  actionRegistry.register('wms:cyclecount:create', {
    permission: 'stock:count:write',
    handler: async (ctx, payload) => counts.createCycleCount(ctx.db, payload)
  });

  actionRegistry.register('wms:cyclecount:post', {
    permission: 'stock:count:write',
    handler: async (ctx, payload) => counts.postCycleCount(ctx.db, payload)
  });

  actionRegistry.register('wms:landedcost:create', {
    permission: 'stock:landedcost:write',
    handler: async (ctx, payload) => landedCost.createLandedCost(ctx.db, payload)
  });

  actionRegistry.register('wms:landedcost:post', {
    permission: 'stock:landedcost:write',
    handler: async (ctx, payload) => landedCost.postLandedCost(ctx.db, payload)
  });
}
