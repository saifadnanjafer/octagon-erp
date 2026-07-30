// platform/domains/contracts/index.mjs — Contracts Domain Action Registrations & Permissions.

import * as contractService from './service.mjs';

export const CONTRACTS_PERMISSIONS = [
  'contracts.view',
  'contracts.create',
  'contracts.update',
  'contracts.approve',
  'contracts.amend',
  'contracts.renew',
  'contracts.terminate',
  'contracts.obligations.manage',
  'contracts.legal.manage'
];

export function registerContractsActions(executor) {
  if (!executor) return;

  executor.registerAction('contracts:create', {
    permission: 'contracts.create',
    handler: async ({ db, payload, context }) => {
      return contractService.createContract(db, payload, context.user);
    }
  });

  executor.registerAction('contracts:transition-status', {
    permission: 'contracts.update',
    handler: async ({ db, payload, context }) => {
      return contractService.transitionContractStatus(db, payload, context.user);
    }
  });

  executor.registerAction('contracts:amend', {
    permission: 'contracts.amend',
    handler: async ({ db, payload, context }) => {
      return contractService.amendContract(db, payload, context.user);
    }
  });

  executor.registerAction('contracts:renew', {
    permission: 'contracts.renew',
    handler: async ({ db, payload, context }) => {
      return contractService.renewContract(db, payload, context.user);
    }
  });

  executor.registerAction('contracts:obligation:add', {
    permission: 'contracts.obligations.manage',
    handler: async ({ db, payload, context }) => {
      return contractService.addContractObligation(db, payload);
    }
  });

  executor.registerAction('contracts:obligation:fulfill', {
    permission: 'contracts.obligations.manage',
    handler: async ({ db, payload, context }) => {
      return contractService.fulfillContractObligation(db, payload, context.user);
    }
  });

  executor.registerAction('contracts:guarantee:add', {
    permission: 'contracts.update',
    handler: async ({ db, payload, context }) => {
      return contractService.addContractGuarantee(db, payload);
    }
  });

  executor.registerAction('contracts:legal-matter:create', {
    permission: 'contracts.legal.manage',
    handler: async ({ db, payload, context }) => {
      return contractService.createLegalMatter(db, payload, context.user);
    }
  });
}
