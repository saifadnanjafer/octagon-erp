import * as parties from './parties.mjs';
import * as uom from './uom.mjs';
import * as products from './products.mjs';
import * as pricing from './pricing.mjs';
import { registerDomainHandler } from '../kernel/actions/domain-handler.mjs';

export { parties, uom, products, pricing };

export function registerCommercialActions(actionExecutor) {
  registerDomainHandler(actionExecutor, 'party:create', parties.createParty);
  registerDomainHandler(actionExecutor, 'uom:create', uom.createUom);
  registerDomainHandler(actionExecutor, 'product:template:create', products.createProductTemplate);
  registerDomainHandler(actionExecutor, 'product:variant:create', products.createProductVariant);
  registerDomainHandler(actionExecutor, 'pricing:list:create', pricing.createPricelist);
}
