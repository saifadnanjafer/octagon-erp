import * as workItems from './work_items.mjs';

export { workItems };

export function registerWorkItemActions(actionRegistry) {
  if (!actionRegistry || typeof actionRegistry.register !== 'function') return;

  actionRegistry.register('work_item:create', {
    permission: 'task:write',
    handler: async (ctx, payload) => workItems.createWorkItem(ctx.db, payload)
  });

  actionRegistry.register('work_item:update', {
    permission: 'task:write',
    handler: async (ctx, payload) => workItems.updateWorkItem(ctx.db, payload.id, payload)
  });

  actionRegistry.register('work_item:delete', {
    permission: 'task:write',
    handler: async (ctx, payload) => workItems.deleteWorkItem(ctx.db, payload.id)
  });
}
