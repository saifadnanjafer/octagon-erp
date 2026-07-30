// platform/domains/integration/index.mjs — ActionExecutor for Integration Hub & API Management.

import * as integrationService from './service.mjs';

export function registerIntegrationActions(actionRegistry) {
  actionRegistry.register('integration:register-endpoint', async (context, payload) => {
    context.checkPermission('integration.api.manage');
    return integrationService.registerEndpoint(context.db, {
      ...payload,
      company_id: context.companyId
    });
  });

  actionRegistry.register('integration:create-api-key', async (context, payload) => {
    context.checkPermission('integration.key.manage');
    return integrationService.createAPIKey(context.db, {
      ...payload,
      company_id: context.companyId
    });
  });

  actionRegistry.register('integration:subscribe-webhook', async (context, payload) => {
    context.checkPermission('integration.webhook.manage');
    return integrationService.subscribeWebhook(context.db, {
      ...payload,
      company_id: context.companyId
    });
  });

  actionRegistry.register('integration:record-webhook-delivery', async (context, payload) => {
    context.checkPermission('integration.webhook.manage');
    return integrationService.recordWebhookDelivery(context.db, {
      ...payload,
      company_id: context.companyId
    });
  });

  actionRegistry.register('integration:register-connector', async (context, payload) => {
    context.checkPermission('integration.connector.manage');
    return integrationService.registerConnector(context.db, {
      ...payload,
      company_id: context.companyId
    });
  });
}
