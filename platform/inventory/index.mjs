import * as warehouses from './warehouses.mjs';
import * as ledger from './ledger.mjs';
import * as valuation from './valuation.mjs';

export { warehouses, ledger, valuation };

export function registerInventoryActions(actionRegistry) {
  if (!actionRegistry || typeof actionRegistry.register !== 'function') return;

  actionRegistry.register('warehouse:create', {
    permission: 'stock:warehouse:write',
    handler: async (ctx, payload) => warehouses.createWarehouse(ctx.db, payload)
  });

  actionRegistry.register('stock:location:create', {
    permission: 'stock:location:write',
    handler: async (ctx, payload) => warehouses.createStockLocation(ctx.db, payload)
  });

  actionRegistry.register('stock:move:post', {
    permission: 'stock:move:write',
    handler: async (ctx, payload) => ledger.postStockMove(ctx.db, payload)
  });

  actionRegistry.register('stock:quants:rebuild', {
    permission: 'stock:quants:write',
    handler: async (ctx, payload) => ledger.rebuildStockQuants(ctx.db, payload)
  });
}
