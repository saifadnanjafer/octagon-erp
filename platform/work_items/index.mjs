import * as workItems from './work_items.mjs';
import * as lifecycle from './lifecycle.mjs';
import { registerDomainHandler, trustedActionInput } from '../kernel/actions/domain-handler.mjs';

export { lifecycle, workItems };

export function registerWorkItemActions(actionExecutor) {
  registerDomainHandler(actionExecutor, 'work_item:create', lifecycle.createWorkItemLifecycle);
  actionExecutor.registerHandler('work_item:update', ({ input, ctx, dialect }) => {
    const scoped = trustedActionInput(input, ctx);
    return lifecycle.updateWorkItemLifecycle(dialect, scoped);
  });
  actionExecutor.registerHandler('work_item:delete', ({ input, ctx, dialect }) => {
    const scoped = trustedActionInput(input, ctx);
    return lifecycle.archiveWorkItem(dialect, scoped);
  });
  actionExecutor.registerHandler('work_item:approve', ({ input, ctx, dialect }) => {
    const scoped = trustedActionInput(input, ctx);
    return workItems.decideWorkItemApproval(dialect, scoped);
  });
  registerDomainHandler(actionExecutor, 'work_item:assign', lifecycle.assignWorkItem);
  registerDomainHandler(actionExecutor, 'work_item:transition', lifecycle.transitionWorkItem);
  registerDomainHandler(actionExecutor, 'work_item:add_subtask', lifecycle.addSubtask);
  registerDomainHandler(actionExecutor, 'work_item:add_dependency', lifecycle.addDependency);
  registerDomainHandler(actionExecutor, 'work_item:complete', lifecycle.completeWorkItem);
  registerDomainHandler(actionExecutor, 'work_item:cancel', lifecycle.cancelWorkItem);
}
