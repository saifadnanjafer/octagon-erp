import * as session from './session.mjs';
import * as refunds from './refunds.mjs';
import { registerDomainHandler } from '../kernel/actions/domain-handler.mjs';

export { session, refunds };

export function registerPosActions(actionExecutor) {
  registerDomainHandler(actionExecutor, 'pos:terminal:configure', session.configurePosTerminal);
  registerDomainHandler(actionExecutor, 'pos:payment_method:configure', session.configurePaymentMethod);
  registerDomainHandler(actionExecutor, 'pos:session:open', session.openPosSession);
  registerDomainHandler(actionExecutor, 'pos:order:process', session.processPosOrder);
  registerDomainHandler(actionExecutor, 'pos:order:refund', refunds.refundPosOrder);
  registerDomainHandler(actionExecutor, 'pos:session:close', session.closePosSession);
}
