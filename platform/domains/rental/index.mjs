// platform/domains/rental/index.mjs — Rental Domain Registrations & Permissions.

import * as rentalService from './service.mjs';

export const RENTAL_PERMISSIONS = [
  'rental.view',
  'rental.create',
  'rental.handover',
  'rental.extend',
  'rental.return',
  'rental.maintenance.manage'
];

export function registerRentalActions(executor) {
  if (!executor) return;

  executor.registerAction('rental:product:configure', {
    permission: 'rental.create',
    handler: async ({ db, payload, context }) => {
      return rentalService.configureRentalProduct(db, payload);
    }
  });

  executor.registerAction('rental:agreement:create', {
    permission: 'rental.create',
    handler: async ({ db, payload, context }) => {
      return rentalService.createAgreement(db, payload, context.user);
    }
  });

  executor.registerAction('rental:handover', {
    permission: 'rental.handover',
    handler: async ({ db, payload, context }) => {
      return rentalService.handoverRental(db, payload, context.user);
    }
  });

  executor.registerAction('rental:extend', {
    permission: 'rental.extend',
    handler: async ({ db, payload, context }) => {
      return rentalService.extendRental(db, payload, context.user);
    }
  });

  executor.registerAction('rental:return', {
    permission: 'rental.return',
    handler: async ({ db, payload, context }) => {
      return rentalService.returnRental(db, payload, context.user);
    }
  });

  executor.registerAction('rental:maintenance-hold:set', {
    permission: 'rental.maintenance.manage',
    handler: async ({ db, payload, context }) => {
      return rentalService.setMaintenanceHold(db, payload);
    }
  });
}
