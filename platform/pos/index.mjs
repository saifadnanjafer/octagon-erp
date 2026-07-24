import * as session from './session.mjs';
import { registerDomainHandler } from '../kernel/actions/domain-handler.mjs';

export { session };

export function registerPosActions(actionExecutor) {
  registerDomainHandler(actionExecutor, 'pos:session:open', session.openPosSession);
  registerDomainHandler(actionExecutor, 'pos:order:process', session.processPosOrder);
  registerDomainHandler(actionExecutor, 'pos:session:close', session.closePosSession);
}
