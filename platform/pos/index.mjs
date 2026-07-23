import * as session from './session.mjs';

export { session };

export function registerPosActions(actionRegistry) {
  if (!actionRegistry || typeof actionRegistry.register !== 'function') return;

  actionRegistry.register('pos:session:open', {
    permission: 'pos:session:write',
    handler: async (ctx, payload) => session.openPosSession(ctx.db, payload)
  });

  actionRegistry.register('pos:order:process', {
    permission: 'pos:order:write',
    handler: async (ctx, payload) => session.processPosOrder(ctx.db, payload)
  });
}
