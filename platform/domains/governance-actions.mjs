// platform/domains/governance-actions.mjs — Final Page Catalog · FP-2 governance wiring.
//
// WHY THIS FILE EXISTS
//
// Four real, sophisticated engines already existed in this codebase and were
// completely disconnected from the running server:
//
//   platform/workflow    WorkflowRegistry + WorkflowRuntime — visual-designer-
//                         ready state machines, durable instances, leases,
//                         timers, compensation. Not imported anywhere except
//                         a test file.
//   platform/approvals   ApprovalEngine — five approval modes, maker-checker,
//                         nine work queues, escalation, bulk decide. The
//                         engine was INSTANTIATED in platform-runtime-bridge.mjs
//                         (as `approvals`) but no route or action ever called it.
//   platform/automation  AutomationEngine — event/schedule triggers, boundary-
//                         crossing semantics, rate limiting, dry-run explain.
//                         Not imported anywhere except a test file.
//   platform/policies    PolicyEngine — authority limits, delegation,
//                         segregation of duties. INSTANTIATED (as `policyEngine`)
//                         and used internally by the evaluator, but none of its
//                         own mutations (delegate, setAuthorityLimit,
//                         defineSodRule) were reachable from outside.
//
// This is the same class of defect Wave 2 had: real backend, zero reachable
// surface. This file is the fix — one place that registers every governed
// mutation these four engines expose, modelled on
// platform/domains/wave2-actions.mjs.
//
// Read access is the separate file platform/api/governance.mjs.

'use strict';

/**
 * Every governance action, declared once.
 *
 * This is not decoration. `ActionExecutor.execute()` starts with
 * `SELECT * FROM platform_actions WHERE id = ?` — with no row the action does
 * not exist at all, regardless of whether registerHandler() was called. And
 * the ONLY place `required_permission` is ever checked is the HTTP router
 * (platform/api/index.mjs); ActionExecutor itself enforces module access and
 * scope, never the permission string. Skipping this step would have shipped
 * governance actions that were both non-functional (ACTION_NOT_REGISTERED)
 * and, had a platform_actions row been added without a permission, reachable
 * by any authenticated user. Same lesson as Wave 2 — see
 * platform/domains/wave2-actions.mjs.
 *
 * `entity` must exist in platform_entities (platform_actions.entity_id is a
 * foreign key); GOVERNANCE_ENTITIES below registers all of them under
 * module_id 'platform_kernel' — these are core engines, not a toggleable
 * module, so `assertModuleAccess` always allows them and the real gate is the
 * permission check.
 */
const GOVERNANCE_ACTIONS = [
  { id: 'workflow:define', entity: 'workflow_definition', permission: 'governance:workflow:manage', required: ['name', 'entity'] },
  { id: 'workflow:version:add', entity: 'workflow_definition', permission: 'governance:workflow:manage', required: ['definition_id', 'initial_state', 'states'] },
  { id: 'workflow:activate', entity: 'workflow_definition', permission: 'governance:workflow:manage', required: ['definition_id', 'version'] },
  { id: 'workflow:retire', entity: 'workflow_definition', permission: 'governance:workflow:manage', required: ['definition_id'] },
  { id: 'workflow:instance:start', entity: 'workflow_instance', permission: 'governance:workflow:execute', required: ['definition_id', 'entity', 'record_id'] },
  { id: 'workflow:instance:step', entity: 'workflow_instance', permission: 'governance:workflow:execute', required: ['instance_id', 'lease_id'] },
  { id: 'workflow:instance:cancel', entity: 'workflow_instance', permission: 'governance:workflow:execute', required: ['instance_id'] },

  { id: 'approval:policy:define', entity: 'approval_policy', permission: 'governance:approval:configure', required: ['entity', 'action', 'chain'] },
  { id: 'approval:request', entity: 'approval_request', permission: 'governance:approval:request', required: ['entity', 'record_id', 'action'] },
  { id: 'approval:decide', entity: 'approval_request', permission: 'governance:approval:decide', required: ['request_id', 'decision'] },
  { id: 'approval:bulk_decide', entity: 'approval_request', permission: 'governance:approval:decide', required: ['request_ids', 'decision'] },

  { id: 'automation:rule:define', entity: 'automation_rule', permission: 'governance:automation:manage', required: ['name', 'entity', 'trigger_kind', 'action_id'] },
  { id: 'automation:rule:set_enabled', entity: 'automation_rule', permission: 'governance:automation:manage', required: ['rule_id', 'enabled'] },

  { id: 'policy:authority_limit:set', entity: 'policy_authority_limit', permission: 'governance:policy:manage', required: ['permission', 'max_amount'] },
  { id: 'policy:delegate', entity: 'policy_delegation', permission: 'governance:policy:delegate', required: ['to_user_id', 'permissions'] },
  { id: 'policy:delegation:revoke', entity: 'policy_delegation', permission: 'governance:policy:delegate', required: ['delegation_id'] },
  { id: 'policy:sod:define', entity: 'policy_sod_rule', permission: 'governance:policy:manage', required: ['name', 'left_permission', 'right_permission'] },
  { id: 'policy:override:record', entity: 'policy_override', permission: 'governance:policy:manage', required: ['reason'] },
];

const GOVERNANCE_ENTITIES = [
  ['workflow_definition', 'تعريف سير عمل', 'Workflow Definition'],
  ['workflow_instance', 'مثيل سير عمل', 'Workflow Instance'],
  ['approval_policy', 'سياسة اعتماد', 'Approval Policy'],
  ['approval_request', 'طلب اعتماد', 'Approval Request'],
  ['automation_rule', 'قاعدة أتمتة', 'Automation Rule'],
  ['policy_authority_limit', 'حد صلاحية مالية', 'Authority Limit'],
  ['policy_delegation', 'تفويض صلاحية', 'Authority Delegation'],
  ['policy_sod_rule', 'قاعدة فصل مهام', 'Segregation of Duties Rule'],
  ['policy_override', 'تجاوز استثنائي موثّق', 'Recorded Policy Override'],
];

/** Read-side permission per namespace, for the router's gate. */
const GOVERNANCE_READ_PERMISSIONS = {
  workflow: 'governance:workflow:view',
  approvals: 'governance:approval:view',
  automation: 'governance:automation:view',
  policy: 'governance:policy:view',
  permissions: 'governance:permissions:explain',
};

/** All governance permission tokens, for registration into the permission registry. */
export const GOVERNANCE_PERMISSIONS = [
  ...new Set([...GOVERNANCE_ACTIONS.map((a) => a.permission), ...Object.values(GOVERNANCE_READ_PERMISSIONS)]),
].map((id) => ({ id, module_id: 'platform_kernel', kind: 'action', label_ar: id, label_en: id }));

const ERROR_CONTRACT = JSON.stringify({
  envelope: 'stable',
  rollback: 'business mutation, audit, and idempotency are atomic',
  codes: ['INPUT_MISSING_FIELD', 'IDEMPOTENCY_KEY_REQUIRED', 'PRECONDITION_FAILED'],
});

/** Seed/refresh platform_actions + platform_entities for every governance action. Idempotent. */
export function ensureGovernanceActionDefinitions(dialect) {
  if (!dialect || typeof dialect.prepare !== 'function') return 0;
  const now = new Date().toISOString();

  const insertEntity = dialect.prepare(`
    INSERT INTO platform_entities (
      id, module_id, storage_owner, primary_key, label_ar, label_en, section, sequence, seq_field,
      chatter, acl, status_key, fields, relations, scope, lifecycle_policy, query_policy, action_policy,
      customization_policy, history_policy, api_exposed, migration_owner, created_at, updated_at
    ) VALUES (?, 'platform_kernel', 'platform_kernel', 'id', ?, ?, NULL, NULL, NULL, 0, NULL, NULL, '{}',
      '{}', 'company', 'generic', 'scoped', 'registered', 'metadata', 'audit', 1, 'governance-actions', ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);
  for (const [id, labelAr, labelEn] of GOVERNANCE_ENTITIES) insertEntity.run(id, labelAr, labelEn, now, now);

  const insertAction = dialect.prepare(`
    INSERT INTO platform_actions (
      id, module_id, entity_id, kind, allowed_states, required_permission, required_scope,
      input_schema, preconditions, transaction_owner, idempotency_policy, sequence_policy,
      audit_policy, outbox_policy, reversal_action, result_schema, error_contract, created_at, updated_at
    ) VALUES (?, 'platform_kernel', ?, 'domain', '[]', ?, 'company', ?, '[]',
      'platform_action_executor', 'required', 'none', 'required', 'required', NULL, NULL, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      entity_id = excluded.entity_id, required_permission = excluded.required_permission,
      input_schema = excluded.input_schema, updated_at = excluded.updated_at
  `);
  let count = 0;
  for (const action of GOVERNANCE_ACTIONS) {
    insertAction.run(
      action.id, action.entity, action.permission,
      JSON.stringify({ type: 'object', required: action.required || [] }),
      ERROR_CONTRACT, now, now,
    );
    count += 1;
  }
  return count;
}

export function governanceReadPermission(namespace) {
  return GOVERNANCE_READ_PERMISSIONS[namespace] || null;
}

function actorFrom(ctx) {
  return ctx?.userId || ctx?.actorId || 'system';
}

/**
 * Build the `ctx` shape ApprovalEngine.worklist/decide expect
 * (`actorId`, `activeCompanyId`, `companyMemberships`) from the standard
 * request ctx (`userId`, `companyId`, `branchId`). Company scope still comes
 * only from the server-derived request ctx — this is a field-name adapter,
 * not a new trust boundary.
 */
function approvalCtx(ctx) {
  return {
    actorId: ctx.userId,
    activeCompanyId: ctx.companyId,
    companyMemberships: ctx.companyId ? [ctx.companyId] : [],
  };
}

export function registerGovernanceActions(actionExecutor, deps) {
  const { workflowRegistry, workflowRuntime, approvalEngine, automationEngine, policyEngine } = deps;

  if (actionExecutor.dialect) ensureGovernanceActionDefinitions(actionExecutor.dialect);

  // ------------------------------------------------------------- workflow --
  if (workflowRegistry && workflowRuntime) {
    actionExecutor.registerHandler('workflow:define', ({ input, ctx }) => workflowRegistry.define({
      id: input.id, moduleId: input.module_id || 'platform_kernel', name: input.name, labelAr: input.label_ar, entity: input.entity,
    }, actorFrom(ctx)));

    actionExecutor.registerHandler('workflow:version:add', ({ input, ctx }) => workflowRegistry.addVersion(
      input.definition_id,
      {
        initialState: input.initial_state, states: input.states || [], transitions: input.transitions || [],
        nodes: input.nodes || [], triggers: input.triggers || [], requiredPermission: input.required_permission || null,
        approvalPolicyId: input.approval_policy_id || null, compensation: input.compensation || [],
        instanceMigrationPolicy: input.instance_migration_policy || 'pin',
      },
      actorFrom(ctx),
    ));

    actionExecutor.registerHandler('workflow:activate', ({ input, ctx }) => workflowRegistry.activate(input.definition_id, input.version, actorFrom(ctx)));
    actionExecutor.registerHandler('workflow:retire', ({ input, ctx }) => workflowRegistry.retire(input.definition_id, actorFrom(ctx)));

    actionExecutor.registerHandler('workflow:instance:start', ({ input, ctx }) => workflowRuntime.start({
      definitionId: input.definition_id, entity: input.entity, recordId: input.record_id,
      context: input.context || {}, ctx, idempotencyKey: input.idempotency_key || null,
      timeoutMinutes: input.timeout_minutes || null,
    }));

    actionExecutor.registerHandler('workflow:instance:step', ({ input, ctx }) => workflowRuntime.step(input.instance_id, input.lease_id, ctx));
    actionExecutor.registerHandler('workflow:instance:cancel', ({ input, ctx }) => workflowRuntime.cancel(input.instance_id, input.reason || 'cancelled', ctx));
  }

  // ------------------------------------------------------------ approvals --
  if (approvalEngine) {
    actionExecutor.registerHandler('approval:policy:define', ({ input, ctx }) => approvalEngine.definePolicy({
      id: input.id, moduleId: input.module_id || 'platform_kernel', entity: input.entity, action: input.action, labelAr: input.label_ar,
      mode: input.mode || 'sequential', chain: input.chain || [], quorum: input.quorum ?? null,
      amountThreshold: input.amount_threshold ?? null, escalateRole: input.escalate_role || null,
      escalationTimeoutMinutes: input.escalation_timeout_minutes ?? null,
      makerChecker: input.maker_checker !== false, allowReturn: input.allow_return !== false,
      calendarId: input.calendar_id || null, companyId: ctx.companyId || null,
    }, actorFrom(ctx)));

    actionExecutor.registerHandler('approval:request', ({ input, ctx }) => approvalEngine.request({
      entity: input.entity, recordId: input.record_id, action: input.action, payload: input.payload || {},
      amount: input.amount ?? null, requesterId: ctx.userId, companyId: ctx.companyId || null,
      tenantId: ctx.tenantId || null, cc: input.cc || [], expiresAt: input.expires_at || null,
      workflowInstanceId: input.workflow_instance_id || null, correlationId: ctx.correlationId || null,
    }));

    actionExecutor.registerHandler('approval:decide', ({ input, ctx }) => approvalEngine.decide({
      requestId: input.request_id, deciderId: ctx.userId, decision: input.decision,
      comment: input.comment || null, attachments: input.attachments || [],
      expectedVersion: input.expected_version ?? null,
    }));

    actionExecutor.registerHandler('approval:bulk_decide', ({ input, ctx }) => approvalEngine.bulkDecide({
      requestIds: input.request_ids || [], deciderId: ctx.userId, decision: input.decision, comment: input.comment || null,
    }));
  }

  // ----------------------------------------------------------- automation --
  if (automationEngine) {
    actionExecutor.registerHandler('automation:rule:define', ({ input, ctx }) => automationEngine.defineRule({
      id: input.id, moduleId: input.module_id || 'platform_kernel', name: input.name, labelAr: input.label_ar, entity: input.entity,
      triggerKind: input.trigger_kind, triggerConfig: input.trigger_config || {}, precondition: input.precondition || {},
      postcondition: input.postcondition || {}, boundaryField: input.boundary_field || null, actionId: input.action_id,
      actionInput: input.action_input || {}, rateLimitPerMinute: input.rate_limit_per_minute ?? 60,
      maxDepth: input.max_depth ?? 5, tenantId: ctx.tenantId || null, companyId: ctx.companyId || null,
      enabled: input.enabled !== false,
    }, actorFrom(ctx)));

    actionExecutor.registerHandler('automation:rule:set_enabled', ({ input }) => automationEngine.setEnabled(input.rule_id, !!input.enabled));
  }

  // -------------------------------------------------------------- policy --
  if (policyEngine) {
    actionExecutor.registerHandler('policy:authority_limit:set', ({ input, ctx }) => {
      policyEngine.setAuthorityLimit({
        id: input.id || null, roleId: input.role_id || null, userId: input.user_id || null,
        companyId: ctx.companyId || null, permission: input.permission, maxAmount: input.max_amount, currency: input.currency || 'IQD',
      });
      return { ok: true };
    });

    actionExecutor.registerHandler('policy:delegate', ({ input, ctx }) => policyEngine.delegate({
      fromUserId: ctx.userId, toUserId: input.to_user_id, permissions: input.permissions || [],
      companyId: ctx.companyId || null, maxAmount: input.max_amount ?? null, reason: input.reason || null,
      validFrom: input.valid_from || null, validTo: input.valid_to,
    }, actorFrom(ctx), ctx));

    actionExecutor.registerHandler('policy:delegation:revoke', ({ input, ctx }) => {
      policyEngine.revokeDelegation(input.delegation_id, actorFrom(ctx));
      return { id: input.delegation_id, status: 'revoked' };
    });

    actionExecutor.registerHandler('policy:sod:define', ({ input, ctx }) => policyEngine.defineSodRule({
      id: input.id || null, name: input.name, labelAr: input.label_ar || null,
      leftPermission: input.left_permission, rightPermission: input.right_permission,
      enforceAtAssignment: input.enforce_at_assignment !== false, enforceAtTransaction: input.enforce_at_transaction !== false,
      allowEmergencyOverride: !!input.allow_emergency_override,
    }, actorFrom(ctx)));

    actionExecutor.registerHandler('policy:override:record', ({ input, ctx }) => policyEngine.recordOverride({
      policyId: input.policy_id || null, sodRuleId: input.sod_rule_id || null, actorId: ctx.userId,
      reason: input.reason, recordRef: input.record_ref || null, approvedBy: input.approved_by || null,
    }));
  }

  return actionExecutor;
}

export { approvalCtx };
