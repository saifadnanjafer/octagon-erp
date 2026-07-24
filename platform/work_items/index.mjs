import * as workItems from './work_items.mjs';
import { registerDomainHandler, trustedActionInput } from '../kernel/actions/domain-handler.mjs';

export { workItems };

export function registerWorkItemActions(actionExecutor) {
  registerDomainHandler(actionExecutor, 'work_item:create', workItems.createWorkItem);
  actionExecutor.registerHandler('work_item:update', ({ input, ctx, dialect }) => {
    const scoped = trustedActionInput(input, ctx);
    return workItems.updateWorkItem(dialect, scoped.id, scoped);
  });
  actionExecutor.registerHandler('work_item:delete', ({ input, ctx, dialect }) => {
    const scoped = trustedActionInput(input, ctx);
    return workItems.deleteWorkItem(dialect, scoped.id, scoped.company_id);
  });
  actionExecutor.registerHandler('work_item:approve', ({ input, ctx, dialect }) => {
    const scoped = trustedActionInput(input, ctx);
    return workItems.decideWorkItemApproval(dialect, scoped);
  });
}
