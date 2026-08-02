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
  registerDomainHandler(actionExecutor, 'offline:conflict_resolve', conflictResolution.resolveConflict);
}
