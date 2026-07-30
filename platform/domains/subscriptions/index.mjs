// platform/domains/subscriptions/index.mjs — Subscriptions Domain Registrations & Permissions.

import * as subService from './service.mjs';

export const SUBSCRIPTIONS_PERMISSIONS = [
  'subscriptions.view',
  'subscriptions.create',
  'subscriptions.update',
  'subscriptions.billing.run',
  'subscriptions.pause',
  'subscriptions.cancel'
];

export function registerSubscriptionsActions(executor) {
  if (!executor) return;

  executor.registerAction('subscriptions:plan:create', {
    permission: 'subscriptions.create',
    handler: async ({ db, payload, context }) => {
      return subService.createPlan(db, payload);
    }
  });

  executor.registerAction('subscriptions:create', {
    permission: 'subscriptions.create',
    handler: async ({ db, payload, context }) => {
      return subService.createSubscription(db, payload, context.user);
    }
  });

  executor.registerAction('subscriptions:activate', {
    permission: 'subscriptions.update',
    handler: async ({ db, payload, context }) => {
      return subService.activateSubscription(db, payload, context.user);
    }
  });

  executor.registerAction('subscriptions:billing:run', {
    permission: 'subscriptions.billing.run',
    handler: async ({ db, payload, context }) => {
      return subService.generateBillingCycle(db, payload, context.user);
    }
  });

  executor.registerAction('subscriptions:pause', {
    permission: 'subscriptions.pause',
    handler: async ({ db, payload, context }) => {
      return subService.pauseSubscription(db, payload, context.user);
    }
  });

  executor.registerAction('subscriptions:cancel', {
    permission: 'subscriptions.cancel',
    handler: async ({ db, payload, context }) => {
      return subService.cancelSubscription(db, payload, context.user);
    }
  });
}
