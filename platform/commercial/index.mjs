import * as parties from './parties.mjs';
import * as uom from './uom.mjs';
import * as products from './products.mjs';
import * as pricing from './pricing.mjs';

export { parties, uom, products, pricing };

export function registerCommercialActions(actionRegistry) {
  if (!actionRegistry || typeof actionRegistry.register !== 'function') return;

  actionRegistry.register('party:create', {
    permission: 'commercial:party:write',
    handler: async (ctx, payload) => parties.createParty(ctx.db, payload)
  });

  actionRegistry.register('uom:create', {
    permission: 'commercial:product:write',
    handler: async (ctx, payload) => uom.createUom(ctx.db, payload)
  });

  actionRegistry.register('product:template:create', {
    permission: 'commercial:product:write',
    handler: async (ctx, payload) => products.createProductTemplate(ctx.db, payload)
  });

  actionRegistry.register('product:variant:create', {
    permission: 'commercial:product:write',
    handler: async (ctx, payload) => products.createProductVariant(ctx.db, payload)
  });

  actionRegistry.register('pricing:list:create', {
    permission: 'commercial:pricing:write',
    handler: async (ctx, payload) => pricing.createPricelist(ctx.db, payload)
  });
}
