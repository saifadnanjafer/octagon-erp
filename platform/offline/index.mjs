import * as clientRegistry from './client-registry.mjs';
import * as syncEngine from './sync-engine.mjs';
import * as conflictResolution from './conflict-resolution.mjs';
import { registerDomainHandler } from '../kernel/actions/domain-handler.mjs';

export { clientRegistry, syncEngine, conflictResolution };

export function registerOfflineActions(actionExecutor) {
  registerDomainHandler(actionExecutor, 'offline:client_register', clientRegistry.registerOfflineClient);
  registerDomainHandler(actionExecutor, 'offline:client_revoke', clientRegistry.revokeOfflineClient);
  registerDomainHandler(actionExecutor, 'offline:command_queue_local', syncEngine.queueOfflineCommand);
  registerDomainHandler(actionExecutor, 'offline:command_sync_push', syncEngine.pushOfflineSync);
  registerDomainHandler(actionExecutor, 'offline:push_queue_batch', (db, input, ctx) => {
    const queueItems = input.queue_items || input.queueItems || [];
    const commands = queueItems.map(item => ({
      action_name: item.action_type || item.actionName || 'offline_action',
      local_temp_id: item.queue_item_uuid || item.localTempId,
      target_entity: item.entity_name,
      payload: item.payload
    }));
    return syncEngine.pushOfflineSync(db, { ...input, commands }, ctx);
  });
  registerDomainHandler(actionExecutor, 'offline:record_sync_conflict', conflictResolution.recordSyncConflict);
  registerDomainHandler(actionExecutor, 'offline:resolve_sync_conflict', conflictResolution.resolveConflict);
  registerDomainHandler(actionExecutor, 'offline:conflict_resolve', conflictResolution.resolveConflict);
}
