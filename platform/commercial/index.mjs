import * as parties from './parties.mjs';
import * as uom from './uom.mjs';
import * as products from './products.mjs';
import * as pricing from './pricing.mjs';
import { registerDomainHandler } from '../kernel/actions/domain-handler.mjs';

export { parties, uom, products, pricing };

export function registerCommercialActions(actionExecutor) {
  // Parties
  registerDomainHandler(actionExecutor, 'party:create', parties.createParty);
  registerDomainHandler(actionExecutor, 'party:update', parties.updateParty);
  registerDomainHandler(actionExecutor, 'party:archive', parties.archiveParty);
  registerDomainHandler(actionExecutor, 'party:restore', parties.restoreParty);
  registerDomainHandler(actionExecutor, 'party_role:add', parties.addPartyRole);
  registerDomainHandler(actionExecutor, 'party_role:remove', parties.removePartyRole);
  registerDomainHandler(actionExecutor, 'party_contact:create', parties.createPartyContact);
  registerDomainHandler(actionExecutor, 'party_contact:update', parties.updatePartyContact);
  registerDomainHandler(actionExecutor, 'party_contact:archive', parties.archivePartyContact);
  registerDomainHandler(actionExecutor, 'party_address:create', parties.createPartyAddress);
  registerDomainHandler(actionExecutor, 'party_address:update', parties.updatePartyAddress);
  registerDomainHandler(actionExecutor, 'party_address:archive', parties.archivePartyAddress);

  // UOM & UOM Categories
  registerDomainHandler(actionExecutor, 'uom_category:create', uom.createUomCategory);
  registerDomainHandler(actionExecutor, 'uom_category:update', uom.updateUomCategory);
  registerDomainHandler(actionExecutor, 'uom_category:archive', uom.archiveUomCategory);
  registerDomainHandler(actionExecutor, 'uom_category:restore', uom.restoreUomCategory);

  registerDomainHandler(actionExecutor, 'uom:create', uom.createUom);
  registerDomainHandler(actionExecutor, 'uom:update', uom.updateUom);
  registerDomainHandler(actionExecutor, 'uom:archive', uom.archiveUom);
  registerDomainHandler(actionExecutor, 'uom:restore', uom.restoreUom);

  // Product Categories & Products
  registerDomainHandler(actionExecutor, 'product_category:create', products.createProductCategory);
  registerDomainHandler(actionExecutor, 'product_category:update', products.updateProductCategory);
  registerDomainHandler(actionExecutor, 'product_category:archive', products.archiveProductCategory);
  registerDomainHandler(actionExecutor, 'product_category:restore', products.restoreProductCategory);

  registerDomainHandler(actionExecutor, 'product:template:create', products.createProductTemplate);
  registerDomainHandler(actionExecutor, 'product:variant:create', products.createProductVariant);
  registerDomainHandler(actionExecutor, 'product:create', products.createProductTemplate);
  registerDomainHandler(actionExecutor, 'product:update', products.updateProduct);
  registerDomainHandler(actionExecutor, 'product:archive', products.archiveProduct);
  registerDomainHandler(actionExecutor, 'product:restore', products.restoreProduct);

  // Pricing
  registerDomainHandler(actionExecutor, 'pricing:list:create', pricing.createPricelist);
}
