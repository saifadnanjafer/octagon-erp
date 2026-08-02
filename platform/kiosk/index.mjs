import * as registry from './kiosk-registry.mjs';
import * as boards from './operational-boards.mjs';
import { registerDomainHandler } from '../kernel/actions/domain-handler.mjs';

export { registry, boards };

export function registerKioskActions(actionExecutor) {
  registerDomainHandler(actionExecutor, 'kiosk:register', registry.registerKiosk);
  registerDomainHandler(actionExecutor, 'kiosk:heartbeat', registry.recordKioskHeartbeat);
  registerDomainHandler(actionExecutor, 'kiosk:session_start', registry.startKioskSession);
  registerDomainHandler(actionExecutor, 'board:config_upsert', boards.upsertBoardConfig);
}
