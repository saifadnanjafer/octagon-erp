// platform/domains/collaboration-actions.mjs — Collaboration & Chatter Action Wiring
//
// Registers Collaboration actions (post message, follow/unfollow, create/complete activity,
// snapshot, lineage, retention) against ActionExecutor and platform_actions.

'use strict';

import { registerDomainHandler } from '../kernel/actions/domain-handler.mjs';

export const COLLABORATION_PERMISSIONS = [
  { id: 'collaboration:message_post', module_id: 'platform_kernel', kind: 'action', label_ar: 'نشر رسالة في المحادثة', label_en: 'Post Chatter Message' },
  { id: 'collaboration:record_follow', module_id: 'platform_kernel', kind: 'action', label_ar: 'متابعة سجل', label_en: 'Follow Record' },
  { id: 'collaboration:record_unfollow', module_id: 'platform_kernel', kind: 'action', label_ar: 'إلغاء متابعة سجل', label_en: 'Unfollow Record' },
  { id: 'collaboration:follower_add', module_id: 'platform_kernel', kind: 'action', label_ar: 'إضافة متابع لسجل', label_en: 'Add Record Follower' },
  { id: 'collaboration:activity_create', module_id: 'platform_kernel', kind: 'action', label_ar: 'إنشاء نشاط', label_en: 'Create Activity' },
  { id: 'collaboration:activity_complete', module_id: 'platform_kernel', kind: 'action', label_ar: 'إكمال نشاط', label_en: 'Complete Activity' },
  { id: 'history:snapshot_create', module_id: 'platform_kernel', kind: 'action', label_ar: 'إنشاء لقطة لسجل', label_en: 'Create Record Snapshot' },
  { id: 'history:lineage_link', module_id: 'platform_kernel', kind: 'action', label_ar: 'ربط تسلسل لسجل', label_en: 'Link Record Lineage' },
  { id: 'history:retention_set', module_id: 'platform_kernel', kind: 'action', label_ar: 'تحديد سياسة الحفظ', label_en: 'Set Retention Policy' },
  { id: 'collaboration:read', module_id: 'platform_kernel', kind: 'resource', label_ar: 'قراءة المحادثات والأنشطة', label_en: 'Read Collaboration' },
  { id: 'collaboration:use', module_id: 'platform_kernel', kind: 'action', label_ar: 'استخدام أدوات التعاون', label_en: 'Use Collaboration' },
  { id: 'history:read', module_id: 'platform_kernel', kind: 'resource', label_ar: 'قراءة سجل التغييرات', label_en: 'Read Record History' },
  { id: 'snapshots:create', module_id: 'platform_kernel', kind: 'action', label_ar: 'إدارة اللقطات', label_en: 'Manage Snapshots' },
];

const COLLABORATION_ENTITIES = [
  ['chatter_thread', 'سلسلة محادثات', 'Chatter Thread'],
  ['chatter_message', 'رسالة محادثة', 'Chatter Message'],
  ['chatter_follower', 'متابع سجل', 'Chatter Follower'],
  ['activity', 'نشاط سجل', 'Activity'],
  ['record_history', 'سجل تغييرات', 'Record History'],
  ['record_snapshot', 'لقطة سجل', 'Record Snapshot'],
  ['record_lineage', 'تسلسل نسبي لسجل', 'Record Lineage'],
  ['retention_policy', 'سياسة حفظ البيانات', 'Retention Policy'],
];

const COLLABORATION_ACTIONS = [
  { id: 'collaboration:message_post', entity: 'chatter_message', permission: 'collaboration:message_post', required: ['entity', 'record_id', 'body'] },
  { id: 'collaboration:record_follow', entity: 'chatter_follower', permission: 'collaboration:record_follow', required: ['entity', 'record_id'] },
  { id: 'collaboration:record_unfollow', entity: 'chatter_follower', permission: 'collaboration:record_unfollow', required: ['entity', 'record_id'] },
  { id: 'collaboration:follower_add', entity: 'chatter_follower', permission: 'collaboration:follower_add', required: ['entity', 'record_id', 'user_id'] },
  { id: 'collaboration:activity_create', entity: 'activity', permission: 'collaboration:activity_create', required: ['entity', 'record_id', 'summary_ar'] },
  { id: 'collaboration:activity_complete', entity: 'activity', permission: 'collaboration:activity_complete', required: ['activity_id'] },
  { id: 'history:snapshot_create', entity: 'record_snapshot', permission: 'history:snapshot_create', required: ['entity', 'record_id', 'reason', 'payload'] },
  { id: 'history:lineage_link', entity: 'record_lineage', permission: 'history:lineage_link', required: ['entity', 'record_id', 'relation', 'related_entity', 'related_record_id'] },
  { id: 'history:retention_set', entity: 'retention_policy', permission: 'history:retention_set', required: ['subject', 'retain_days'] },
];

export function ensureCollaborationDefinitions(dialect) {
  if (!dialect || typeof dialect.prepare !== 'function') return;

  const now = new Date().toISOString();

  for (const [id, labelAr, labelEn] of COLLABORATION_ENTITIES) {
    dialect.prepare(`
      INSERT INTO platform_entities (
        id, module_id, storage_owner, primary_key, label_ar, label_en,
        chatter, scope, lifecycle_policy, query_policy, action_policy,
        history_policy, api_exposed, migration_owner, created_at, updated_at
      ) VALUES (
        ?, 'platform_kernel', 'x_records', 'id', ?, ?,
        1, 'company', 'standard', 'scoped', 'registered',
        'audit', 1, 'platform.kernel', ?, ?
      )
      ON CONFLICT(id) DO UPDATE SET label_ar=excluded.label_ar, label_en=excluded.label_en, updated_at=excluded.updated_at
    `).run(id, labelAr, labelEn, now, now);
  }

  const insert = dialect.prepare(`
    INSERT INTO platform_actions (
      id, module_id, entity_id, kind, allowed_states, required_permission,
      required_scope, input_schema, preconditions, transaction_owner,
      idempotency_policy, sequence_policy, audit_policy, outbox_policy,
      reversal_action, result_schema, error_contract, created_at, updated_at
    ) VALUES (?, 'platform_kernel', ?, 'domain', '[]', ?, 'company', ?, '[]',
      'platform_action_executor', 'supported', 'none', 'required', 'required',
      NULL, NULL, '{}', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      entity_id = excluded.entity_id,
      required_permission = excluded.required_permission,
      input_schema = excluded.input_schema,
      updated_at = excluded.updated_at
  `);

  for (const act of COLLABORATION_ACTIONS) {
    const inputSchema = JSON.stringify({ type: 'object', required: act.required });
    insert.run(act.id, act.entity, act.permission, inputSchema, now, now);
  }
}

export function registerCollaborationActions(executor, { historyService, chatterService }) {
  if (!executor || typeof executor.registerHandler !== 'function') return;
  ensureCollaborationDefinitions(executor.db);

  registerDomainHandler(executor, 'collaboration:message_post', (dialect, input) => {
    const ctx = { actorId: input.actor_id, activeCompanyId: input.company_id, userId: input.user_id, companyId: input.company_id };
    return chatterService.post({
      entity: input.entity,
      recordId: input.record_id,
      body: input.body,
      visibility: input.visibility || 'internal',
      mentions: input.mentions || [],
      attachments: input.attachments || [],
      ctx,
    });
  });

  registerDomainHandler(executor, 'collaboration:record_follow', (dialect, input) => {
    const ctx = { actorId: input.actor_id, activeCompanyId: input.company_id, userId: input.user_id, companyId: input.company_id };
    return chatterService.follow(
      input.entity,
      input.record_id,
      input.user_id || input.actor_id,
      ctx
    );
  });

  registerDomainHandler(executor, 'collaboration:record_unfollow', (dialect, input) => {
    const ctx = { actorId: input.actor_id, activeCompanyId: input.company_id, userId: input.user_id, companyId: input.company_id };
    return chatterService.unfollow(
      input.entity,
      input.record_id,
      input.user_id || input.actor_id,
      ctx
    );
  });

  registerDomainHandler(executor, 'collaboration:follower_add', (dialect, input) => {
    const ctx = { actorId: input.actor_id, activeCompanyId: input.company_id, userId: input.user_id, companyId: input.company_id };
    return chatterService.addFollower(
      input.entity,
      input.record_id,
      input.user_id,
      ctx
    );
  });

  registerDomainHandler(executor, 'collaboration:activity_create', (dialect, input) => {
    const ctx = { actorId: input.actor_id, activeCompanyId: input.company_id, userId: input.user_id, companyId: input.company_id };
    return chatterService.createActivity({
      entity: input.entity,
      recordId: input.record_id,
      kind: input.kind || 'todo',
      summaryAr: input.summary_ar,
      assigneeId: input.assignee_id || input.actor_id,
      dueAt: input.due_at || null,
      ctx,
    });
  });

  registerDomainHandler(executor, 'collaboration:activity_complete', (dialect, input) => {
    const ctx = { actorId: input.actor_id, activeCompanyId: input.company_id, userId: input.user_id, companyId: input.company_id };
    return chatterService.completeActivity(input.activity_id, ctx);
  });

  registerDomainHandler(executor, 'history:snapshot_create', (dialect, input) => {
    const ctx = { actorId: input.actor_id, activeCompanyId: input.company_id, userId: input.user_id, companyId: input.company_id };
    return historyService.snapshot({
      entity: input.entity,
      recordId: input.record_id,
      recordVersion: input.record_version || 1,
      reason: input.reason,
      payload: input.payload,
      relations: input.relations || {},
      ctx,
    });
  });

  registerDomainHandler(executor, 'history:lineage_link', (dialect, input) => {
    const ctx = { actorId: input.actor_id, activeCompanyId: input.company_id, userId: input.user_id, companyId: input.company_id };
    return historyService.link({
      entity: input.entity,
      recordId: input.record_id,
      relation: input.relation,
      relatedEntity: input.related_entity,
      relatedRecordId: input.related_record_id,
      reason: input.reason || null,
      ctx,
    });
  });

  registerDomainHandler(executor, 'history:retention_set', (dialect, input) => {
    return historyService.setRetention({
      subject: input.subject,
      entity: input.entity || null,
      retainDays: Number(input.retain_days),
      action: input.action || 'archive',
    });
  });
}
