// platform/domains/ai_copilot/index.mjs — ActionExecutor for AI Copilot & JARVIS Governance Foundation.

import * as aiService from './service.mjs';

export function registerAICopilotActions(actionRegistry) {
  actionRegistry.register('ai_copilot:register-agent', async (context, payload) => {
    context.checkPermission('ai.agent.manage');
    return aiService.registerAgent(context.db, {
      ...payload,
      company_id: context.companyId
    });
  });

  actionRegistry.register('ai_copilot:start-session', async (context, payload) => {
    context.checkPermission('ai.session.create');
    return aiService.startSession(context.db, {
      ...payload,
      company_id: context.companyId,
      user_id: context.userId
    });
  });

  actionRegistry.register('ai_copilot:record-message', async (context, payload) => {
    context.checkPermission('ai.message.record');
    return aiService.recordMessage(context.db, {
      ...payload,
      company_id: context.companyId
    });
  });

  actionRegistry.register('ai_copilot:audit-tool-call', async (context, payload) => {
    context.checkPermission('ai.tool.audit');
    return aiService.auditToolCall(context.db, {
      ...payload,
      company_id: context.companyId
    });
  });

  actionRegistry.register('ai_copilot:configure-guardrail-rule', async (context, payload) => {
    context.checkPermission('ai.guardrail.manage');
    return aiService.configureGuardrailRule(context.db, {
      ...payload,
      company_id: context.companyId
    });
  });
}
