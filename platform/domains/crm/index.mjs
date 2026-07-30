// platform/domains/crm/index.mjs — Wave 1 CRM domain entry point and action registration.

import { registerDomainHandler } from '../../kernel/actions/domain-handler.mjs';
import { ActionRegistry } from '../../kernel/actions/index.mjs';

import * as leadService from './lead-service.mjs';
import * as conversionService from './conversion-service.mjs';
import * as oppService from './opportunity-service.mjs';
import * as activityService from './activity-service.mjs';
import * as scoringService from './scoring-service.mjs';
import * as duplicateService from './duplicate-service.mjs';
import * as salesIntegration from './sales-integration.mjs';
import * as queryService from './query-service.mjs';

export {
  leadService,
  conversionService,
  oppService,
  activityService,
  scoringService,
  duplicateService,
  salesIntegration,
  queryService,
};

const CRM_ACTION_DEFINITIONS = [
  // Leads
  { id: 'crm:lead:create', entity_id: 'crm_lead', required: ['name'] },
  { id: 'crm:lead:update', entity_id: 'crm_lead', required: ['id'] },
  { id: 'crm:lead:assign', entity_id: 'crm_lead', required: ['lead_id'] },
  { id: 'crm:lead:contact', entity_id: 'crm_lead', required: ['lead_id'] },
  { id: 'crm:lead:qualify', entity_id: 'crm_lead', required: ['lead_id'] },
  { id: 'crm:lead:disqualify', entity_id: 'crm_lead', required: ['lead_id'] },
  { id: 'crm:lead:reopen', entity_id: 'crm_lead', required: ['lead_id'] },
  { id: 'crm:lead:archive', entity_id: 'crm_lead', required: ['lead_id'] },
  { id: 'crm:lead:restore', entity_id: 'crm_lead', required: ['lead_id'] },
  { id: 'crm:lead:merge', entity_id: 'crm_lead', required: ['target_lead_id', 'source_lead_ids'] },
  { id: 'crm:lead:override_score', entity_id: 'crm_lead', required: ['lead_id', 'new_score'] },
  { id: 'crm:lead:convert', entity_id: 'crm_lead', required: ['lead_id', 'party_id'] },

  // Opportunities
  { id: 'crm:opportunity:create', entity_id: 'crm_opportunity', required: ['name', 'party_id'] },
  { id: 'crm:opportunity:update', entity_id: 'crm_opportunity', required: ['id'] },
  { id: 'crm:opportunity:assign', entity_id: 'crm_opportunity', required: ['opportunity_id'] },
  { id: 'crm:opportunity:change_stage', entity_id: 'crm_opportunity', required: ['opportunity_id', 'stage_id'] },
  { id: 'crm:opportunity:change_pipeline', entity_id: 'crm_opportunity', required: ['opportunity_id', 'pipeline_id'] },
  { id: 'crm:opportunity:mark_won', entity_id: 'crm_opportunity', required: ['opportunity_id'] },
  { id: 'crm:opportunity:mark_lost', entity_id: 'crm_opportunity', required: ['opportunity_id', 'lost_reason_id'] },
  { id: 'crm:opportunity:reopen', entity_id: 'crm_opportunity', required: ['opportunity_id'] },
  { id: 'crm:opportunity:archive', entity_id: 'crm_opportunity', required: ['opportunity_id'] },
  { id: 'crm:opportunity:restore', entity_id: 'crm_opportunity', required: ['opportunity_id'] },
  { id: 'crm:opportunity:add_competitor', entity_id: 'crm_opportunity', required: ['opportunity_id', 'competitor_id'] },
  { id: 'crm:opportunity:remove_competitor', entity_id: 'crm_opportunity', required: ['opportunity_id', 'competitor_id'] },
  { id: 'crm:opportunity:create_quotation', entity_id: 'crm_opportunity', required: ['opportunity_id'] },

  // Activities
  { id: 'crm:activity:create', entity_id: 'crm_activity', required: ['activity_type', 'subject'] },
  { id: 'crm:activity:complete', entity_id: 'crm_activity', required: ['activity_id'] },
  { id: 'crm:activity:reschedule', entity_id: 'crm_activity', required: ['activity_id', 'new_due_date'] },
  { id: 'crm:activity:cancel', entity_id: 'crm_activity', required: ['activity_id'] },
];

export function ensureCrmActionDefinitions(dialect) {
  const now = new Date().toISOString();
  dialect.prepare(`UPDATE platform_modules SET status = 'enabled' WHERE id = 'crm'`).run();

  const insertAction = dialect.prepare(`
    INSERT INTO platform_actions (
      id, module_id, entity_id, kind, allowed_states, required_permission,
      required_scope, input_schema, preconditions, transaction_owner,
      idempotency_policy, sequence_policy, audit_policy, outbox_policy,
      reversal_action, result_schema, error_contract, created_at, updated_at
    ) VALUES (?, 'crm', ?, 'domain', '[]', ?, 'company', ?, '[]',
      'platform_action_executor', 'required', 'none', 'required', 'required',
      NULL, NULL, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET input_schema = excluded.input_schema
  `);

  const errorContract = JSON.stringify({
    envelope: 'stable',
    rollback: 'business mutation, audit, outbox, and idempotency are atomic',
    codes: ['INPUT_MISSING_FIELD', 'IDEMPOTENCY_KEY_REQUIRED', 'UNTRUSTED_ACTION_SCOPE', 'PRECONDITION_FAILED'],
  });

  for (const def of CRM_ACTION_DEFINITIONS) {
    insertAction.run(
      def.id,
      def.entity_id,
      def.id, // permission matches action id
      JSON.stringify({ type: 'object', required: def.required }),
      errorContract,
      now,
      now,
    );
  }
}

export function registerCrmActions(actionExecutor) {
  if (actionExecutor.dialect) {
    ensureCrmActionDefinitions(actionExecutor.dialect);
  }

  // Lead actions
  registerDomainHandler(actionExecutor, 'crm:lead:create', leadService.createLead);
  registerDomainHandler(actionExecutor, 'crm:lead:update', leadService.updateLead);
  registerDomainHandler(actionExecutor, 'crm:lead:assign', leadService.assignLead);
  registerDomainHandler(actionExecutor, 'crm:lead:contact', leadService.contactLead);
  registerDomainHandler(actionExecutor, 'crm:lead:qualify', leadService.qualifyLead);
  registerDomainHandler(actionExecutor, 'crm:lead:disqualify', leadService.disqualifyLead);
  registerDomainHandler(actionExecutor, 'crm:lead:reopen', leadService.reopenLead);
  registerDomainHandler(actionExecutor, 'crm:lead:archive', leadService.archiveLead);
  registerDomainHandler(actionExecutor, 'crm:lead:restore', leadService.restoreLead);
  registerDomainHandler(actionExecutor, 'crm:lead:merge', leadService.mergeLeads);
  registerDomainHandler(actionExecutor, 'crm:lead:override_score', scoringService.overrideLeadScore);

  // Conversion action
  registerDomainHandler(actionExecutor, 'crm:lead:convert', conversionService.convertLead);

  // Opportunity actions
  registerDomainHandler(actionExecutor, 'crm:opportunity:create', oppService.createOpportunity);
  registerDomainHandler(actionExecutor, 'crm:opportunity:update', oppService.updateOpportunity);
  registerDomainHandler(actionExecutor, 'crm:opportunity:assign', oppService.assignOpportunity);
  registerDomainHandler(actionExecutor, 'crm:opportunity:change_stage', oppService.changeStage);
  registerDomainHandler(actionExecutor, 'crm:opportunity:change_pipeline', oppService.changePipeline);
  registerDomainHandler(actionExecutor, 'crm:opportunity:mark_won', oppService.markWon);
  registerDomainHandler(actionExecutor, 'crm:opportunity:mark_lost', oppService.markLost);
  registerDomainHandler(actionExecutor, 'crm:opportunity:reopen', oppService.reopenOpportunity);
  registerDomainHandler(actionExecutor, 'crm:opportunity:archive', oppService.archiveOpportunity);
  registerDomainHandler(actionExecutor, 'crm:opportunity:restore', oppService.restoreOpportunity);
  registerDomainHandler(actionExecutor, 'crm:opportunity:add_competitor', oppService.addCompetitor);
  registerDomainHandler(actionExecutor, 'crm:opportunity:remove_competitor', oppService.removeCompetitor);
  registerDomainHandler(actionExecutor, 'crm:opportunity:create_quotation', salesIntegration.createQuotationFromOpportunity);

  // Activity actions
  registerDomainHandler(actionExecutor, 'crm:activity:create', activityService.createActivity);
  registerDomainHandler(actionExecutor, 'crm:activity:complete', activityService.completeActivity);
  registerDomainHandler(actionExecutor, 'crm:activity:reschedule', activityService.rescheduleActivity);
  registerDomainHandler(actionExecutor, 'crm:activity:cancel', activityService.cancelActivity);
}
