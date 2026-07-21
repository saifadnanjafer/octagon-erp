// Record history, snapshots, lineage, chatter, followers, and activities.
// Phase 02 packets 02.24 and 02.25.
//
// Source composition:
// - VNext vnext/server/audit/audit.js + fields/snapshot-fields.js (project-owned,
//   MERGE-CANONICAL): append-only history rows and the snapshot-the-relations
//   idea (a posted document must keep the customer name/address/price it was
//   posted with, even if the master record later changes).
// - VNext vnext/server/chatter/chatter.js (project-owned, MERGE-REFACTOR):
//   thread-per-record, mentions, internal visibility. Hardened here: permission
//   inheritance from the attached record is now enforced through the canonical
//   evaluator instead of a local role check.
// - Odoo addons/mail/models/{mail_thread,mail_activity,mail_followers}.py
//   (clean-room): the thread/follower/activity triple and tracked-field history.
// - Aureus plugins/webkul/chatter/src/Traits/HasChatter.php (MIT reference,
//   behavior only): attach-chatter-to-any-resource pattern.
//
// Invariants (§ 12.1, § 49):
//   - chatter NEVER mutates protected business state; it is a side channel
//   - history and chatter apply the SAME field masking as the record itself
//   - a snapshot of a posted document is immutable

'use strict';

import crypto from 'node:crypto';
import { AuthorizationError } from '../authorization/evaluator/index.mjs';

export class CollaborationError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'CollaborationError';
    this.code = code;
    this.details = details;
  }
}

export class HistoryService {
  constructor(dialect, deps = {}) {
    this.dialect = dialect;
    this.evaluator = deps.evaluator || null;
    this.now = deps.now || (() => new Date());
  }

  #now() { return this.now().toISOString(); }

  /**
   * Record meaningful field changes. Only tracked fields are stored, and a
   * no-op change writes nothing — history must stay readable, not exhaustive.
   */
  track({ entity, recordId, recordVersion, before = {}, after = {}, trackedFields = null, ctx }) {
    const fields = trackedFields || [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])];
    const ins = this.dialect.prepare(`
      INSERT INTO record_history (id, entity, record_id, record_version, field, old_value, new_value,
        actor_id, actor_type, source_channel, correlation_id, company_id, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const written = [];
    for (const field of fields) {
      const oldValue = before?.[field];
      const newValue = after?.[field];
      if (JSON.stringify(oldValue ?? null) === JSON.stringify(newValue ?? null)) continue;
      ins.run(`hist_${crypto.randomUUID()}`, entity, recordId, recordVersion || 1, field,
        oldValue === undefined ? null : JSON.stringify(oldValue),
        newValue === undefined ? null : JSON.stringify(newValue),
        ctx?.actorId || 'system', ctx?.actorType || 'system', ctx?.sourceChannel || 'ui',
        ctx?.correlationId || null, ctx?.activeCompanyId || null, this.#now());
      written.push(field);
    }
    return written;
  }

  /**
   * Read history with the SAME field partition the record read would apply, so
   * history can never become a masking bypass (§ 9.4).
   */
  read(entity, recordId, ctx, { limit = 200 } = {}) {
    const rows = this.dialect.prepare(
      'SELECT * FROM record_history WHERE entity = ? AND record_id = ? ORDER BY occurred_at DESC LIMIT ?'
    ).all(entity, recordId, limit);
    if (!this.evaluator) return rows;
    const roleIds = this.evaluator.effectiveRoleIds(ctx);
    const { hidden, masked } = this.evaluator.fieldPartition(entity, roleIds);
    return rows
      .filter((r) => !hidden.includes(r.field))
      .map((r) => (masked.includes(r.field)
        ? { ...r, old_value: r.old_value ? '"****"' : null, new_value: r.new_value ? '"****"' : null, masked: true }
        : r));
  }

  /**
   * Take an immutable snapshot. `relations` captures the denormalized copies
   * (customer name, address, tax rate, unit price) that must not drift.
   */
  snapshot({ entity, recordId, recordVersion, reason, payload, relations = {}, ctx }) {
    const checksum = crypto.createHash('sha256').update(JSON.stringify({ payload, relations })).digest('hex');
    const id = `snap_${crypto.randomUUID()}`;
    try {
      this.dialect.prepare(`
        INSERT INTO record_snapshots (id, entity, record_id, record_version, reason, payload, relations, checksum, immutable, company_id, taken_by, taken_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
      `).run(id, entity, recordId, recordVersion, reason, JSON.stringify(payload), JSON.stringify(relations),
        checksum, ctx?.activeCompanyId || null, ctx?.actorId || 'system', this.#now());
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        throw new CollaborationError('a snapshot for this version and reason already exists', 'SNAPSHOT_IMMUTABLE', { entity, recordId, recordVersion, reason });
      }
      throw e;
    }
    return this.getSnapshot(id);
  }

  getSnapshot(id) {
    const r = this.dialect.prepare('SELECT * FROM record_snapshots WHERE id = ?').get(id);
    if (!r) return null;
    return {
      id: r.id, entity: r.entity, recordId: r.record_id, recordVersion: r.record_version, reason: r.reason,
      payload: JSON.parse(r.payload), relations: JSON.parse(r.relations || '{}'), checksum: r.checksum,
      immutable: r.immutable === 1, takenBy: r.taken_by, takenAt: r.taken_at,
    };
  }

  snapshots(entity, recordId) {
    return this.dialect.prepare('SELECT id FROM record_snapshots WHERE entity = ? AND record_id = ? ORDER BY taken_at')
      .all(entity, recordId).map((r) => this.getSnapshot(r.id));
  }

  /** Verify a snapshot has not been altered in place. */
  verifySnapshot(id) {
    const s = this.getSnapshot(id);
    if (!s) return { valid: false, reasonCode: 'SNAPSHOT_NOT_FOUND' };
    const recomputed = crypto.createHash('sha256').update(JSON.stringify({ payload: s.payload, relations: s.relations })).digest('hex');
    return { valid: recomputed === s.checksum, expected: s.checksum, actual: recomputed };
  }

  /** Amendment / reversal lineage, recorded in both directions. */
  link({ entity, recordId, relation, relatedEntity, relatedRecordId, reason = null, ctx }) {
    const INVERSE = { amends: 'amended_by', reverses: 'reversed_by', replaces: 'replaced_by' };
    const inverse = INVERSE[relation];
    if (!inverse) throw new CollaborationError(`unsupported lineage relation ${relation}`, 'LINEAGE_RELATION_INVALID', { relation });
    const now = this.#now();
    const ins = this.dialect.prepare(`
      INSERT INTO record_lineage (id, entity, record_id, relation, related_entity, related_record_id, reason, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    ins.run(`lin_${crypto.randomUUID()}`, entity, recordId, relation, relatedEntity, relatedRecordId, reason, now, ctx?.actorId || 'system');
    ins.run(`lin_${crypto.randomUUID()}`, relatedEntity, relatedRecordId, inverse, entity, recordId, reason, now, ctx?.actorId || 'system');
    return this.lineage(entity, recordId);
  }

  lineage(entity, recordId) {
    return this.dialect.prepare('SELECT relation, related_entity, related_record_id, reason, created_at FROM record_lineage WHERE entity = ? AND record_id = ? ORDER BY created_at')
      .all(entity, recordId);
  }

  setRetention({ subject, entity = null, retainDays, action = 'archive' }) {
    this.dialect.prepare(`
      INSERT INTO retention_policies (id, subject, entity, retain_days, action, created_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET retain_days = excluded.retain_days, action = excluded.action
    `).run(`ret_${subject}_${entity || 'all'}`, subject, entity, retainDays, action, this.#now());
  }

  /** Apply retention. Snapshots of governed documents are never purged. */
  applyRetention() {
    const results = [];
    for (const policy of this.dialect.prepare('SELECT * FROM retention_policies').all()) {
      const cutoff = new Date(this.now().getTime() - policy.retain_days * 86400000).toISOString();
      if (policy.subject === 'record_history' && policy.action === 'purge') {
        const info = policy.entity
          ? this.dialect.prepare('DELETE FROM record_history WHERE entity = ? AND occurred_at < ?').run(policy.entity, cutoff)
          : this.dialect.prepare('DELETE FROM record_history WHERE occurred_at < ?').run(cutoff);
        results.push({ subject: policy.subject, removed: info.changes });
      }
      // record_snapshots is deliberately excluded: an immutable snapshot of a
      // posted document is evidence and outlives a retention window.
    }
    return results;
  }
}

export class ChatterService {
  constructor(dialect, deps = {}) {
    this.dialect = dialect;
    this.evaluator = deps.evaluator || null;
    this.notifications = deps.notifications || null;
    this.files = deps.files || null;
    this.now = deps.now || (() => new Date());
  }

  #now() { return this.now().toISOString(); }

  /**
   * Every chatter operation inherits the attached record's permission. Reading a
   * thread you cannot read the record of is refused with the same reason code.
   */
  #assertRecordAccess(entity, recordId, ctx, permission) {
    if (!this.evaluator) return;
    const decision = this.evaluator.evaluate({ permission, ctx, entity, recordId });
    if (!decision.allowed) throw new AuthorizationError(decision);
  }

  thread(entity, recordId, ctx, { create = true } = {}) {
    const existing = this.dialect.prepare('SELECT * FROM chatter_threads WHERE entity = ? AND record_id = ?').get(entity, recordId);
    if (existing) return { id: existing.id, entity, recordId, companyId: existing.company_id };
    if (!create) return null;
    const id = `thr_${crypto.randomUUID()}`;
    this.dialect.prepare('INSERT INTO chatter_threads (id, entity, record_id, company_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, entity, recordId, ctx?.activeCompanyId || null, this.#now());
    return { id, entity, recordId, companyId: ctx?.activeCompanyId || null };
  }

  post({ entity, recordId, body, visibility = 'internal', mentions = [], attachments = [], ctx, readPermission }) {
    this.#assertRecordAccess(entity, recordId, ctx, readPermission || `${entity}:read`);
    if (!body || !String(body).trim()) throw new CollaborationError('a message needs a body', 'MESSAGE_EMPTY');

    // A mention only reaches someone who could read the record anyway.
    const reachable = [];
    for (const userId of mentions) {
      if (this.#canRead(entity, recordId, userId, readPermission || `${entity}:read`)) reachable.push(userId);
    }

    // Attachments must already be attached to THIS record — a message cannot
    // smuggle a file from another record into view.
    for (const fileId of attachments) {
      const ok = this.dialect.prepare('SELECT 1 FROM file_attachments WHERE file_id = ? AND entity = ? AND record_id = ?').get(fileId, entity, recordId);
      if (!ok) throw new CollaborationError('attachment does not belong to this record', 'ATTACHMENT_NOT_ON_RECORD', { fileId });
    }

    const thread = this.thread(entity, recordId, ctx);
    const id = `msg_${crypto.randomUUID()}`;
    this.dialect.prepare(`
      INSERT INTO chatter_messages (id, thread_id, author_id, body, visibility, mentions, attachments, source_channel, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, thread.id, ctx.actorId, String(body).slice(0, 8000), visibility,
      JSON.stringify(reachable), JSON.stringify(attachments), ctx.sourceChannel || 'ui', this.#now());

    // The author follows what they comment on; mentioned users are notified.
    this.follow(entity, recordId, ctx.actorId, ctx);
    if (this.notifications) {
      for (const userId of reachable) {
        this.notifications.notify({
          recipientId: userId, eventKey: 'chatter.mention', category: 'informational',
          subject: 'تمت الإشارة إليك', body: String(body).slice(0, 200),
          payload: { entity, recordId, messageId: id },
          dedupeKey: `mention:${id}:${userId}`,
          tenantId: ctx.tenantId, companyId: ctx.activeCompanyId, correlationId: ctx.correlationId,
        });
      }
    }
    return { id, threadId: thread.id, mentions: reachable, droppedMentions: mentions.filter((m) => !reachable.includes(m)) };
  }

  #canRead(entity, recordId, userId, permission) {
    if (!this.evaluator) return true;
    const memberships = this.dialect.prepare("SELECT company_id, branch_id FROM organization_memberships WHERE user_id = ? AND status = 'active'").all(userId);
    if (!memberships.length) return false;
    const probe = {
      actorId: userId, actorType: 'user', userId,
      tenantId: this.dialect.prepare('SELECT tenant_id FROM identity_users WHERE id = ?').get(userId)?.tenant_id || null,
      companyMemberships: memberships.map((m) => m.company_id),
      activeCompanyId: memberships[0].company_id, activeBranchId: memberships[0].branch_id,
      branchMemberships: memberships.filter((m) => m.branch_id).map((m) => m.branch_id),
      operatingScopes: [], delegations: [], apiKeyScopes: [],
      enabledModules: this.dialect.prepare("SELECT id FROM platform_modules WHERE status='enabled'").all().map((r) => r.id),
      now: this.#now(), sourceChannel: 'mention-check',
    };
    return this.evaluator.evaluate({ permission, ctx: probe, entity, recordId }).allowed;
  }

  messages(entity, recordId, ctx, { readPermission, limit = 100 } = {}) {
    this.#assertRecordAccess(entity, recordId, ctx, readPermission || `${entity}:read`);
    const thread = this.thread(entity, recordId, ctx, { create: false });
    if (!thread) return [];
    const rows = this.dialect.prepare('SELECT * FROM chatter_messages WHERE thread_id = ? AND removed = 0 ORDER BY created_at LIMIT ?').all(thread.id, limit);
    // 'private' messages are visible only to their author and to followers who
    // were explicitly mentioned.
    return rows
      .filter((m) => m.visibility !== 'private' || m.author_id === ctx.actorId || JSON.parse(m.mentions || '[]').includes(ctx.actorId))
      .map((m) => ({
        id: m.id, authorId: m.author_id, body: m.body, visibility: m.visibility,
        mentions: JSON.parse(m.mentions || '[]'), attachments: JSON.parse(m.attachments || '[]'),
        createdAt: m.created_at,
      }));
  }

  follow(entity, recordId, userId, ctx) {
    const thread = this.thread(entity, recordId, ctx);
    this.dialect.prepare(`
      INSERT INTO chatter_followers (id, thread_id, user_id, subscribed_by, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(thread_id, user_id) DO NOTHING
    `).run(`fol_${crypto.randomUUID()}`, thread.id, userId, ctx?.actorId || userId, this.#now());
    return this.followers(entity, recordId);
  }

  /** Subscribing SOMEONE ELSE requires that they could read the record. */
  addFollower(entity, recordId, userId, ctx, { readPermission } = {}) {
    if (userId !== ctx.actorId && !this.#canRead(entity, recordId, userId, readPermission || `${entity}:read`)) {
      throw new CollaborationError('that user cannot access this record', 'FOLLOWER_NOT_AUTHORIZED', { userId });
    }
    return this.follow(entity, recordId, userId, ctx);
  }

  unfollow(entity, recordId, userId, ctx) {
    const thread = this.thread(entity, recordId, ctx, { create: false });
    if (!thread) return [];
    this.dialect.prepare('DELETE FROM chatter_followers WHERE thread_id = ? AND user_id = ?').run(thread.id, userId);
    return this.followers(entity, recordId);
  }

  followers(entity, recordId) {
    const thread = this.dialect.prepare('SELECT id FROM chatter_threads WHERE entity = ? AND record_id = ?').get(entity, recordId);
    if (!thread) return [];
    return this.dialect.prepare('SELECT user_id, muted FROM chatter_followers WHERE thread_id = ?').all(thread.id)
      .map((f) => ({ userId: f.user_id, muted: f.muted === 1 }));
  }

  // --- activities -----------------------------------------------------------

  createActivity({ entity, recordId, kind = 'todo', summaryAr, assigneeId, dueAt = null, ctx, readPermission }) {
    this.#assertRecordAccess(entity, recordId, ctx, readPermission || `${entity}:read`);
    if (assigneeId && !this.#canRead(entity, recordId, assigneeId, readPermission || `${entity}:read`)) {
      throw new CollaborationError('the assignee cannot access this record', 'ASSIGNEE_NOT_AUTHORIZED', { assigneeId });
    }
    const id = `act_${crypto.randomUUID()}`;
    this.dialect.prepare(`
      INSERT INTO activities (id, entity, record_id, company_id, kind, summary_ar, assignee_id, due_at, status, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
    `).run(id, entity, recordId, ctx?.activeCompanyId || null, kind, summaryAr, assigneeId, dueAt, ctx.actorId, this.#now());
    if (this.notifications && assigneeId && assigneeId !== ctx.actorId) {
      this.notifications.notify({
        recipientId: assigneeId, eventKey: 'activity.assigned', category: 'operational',
        subject: 'مهمة جديدة', body: summaryAr, payload: { entity, recordId, activityId: id },
        dedupeKey: `activity:${id}`, tenantId: ctx.tenantId, companyId: ctx.activeCompanyId,
      });
    }
    return this.getActivity(id);
  }

  getActivity(id) {
    const r = this.dialect.prepare('SELECT * FROM activities WHERE id = ?').get(id);
    if (!r) return null;
    return {
      id: r.id, entity: r.entity, recordId: r.record_id, kind: r.kind, summaryAr: r.summary_ar,
      assigneeId: r.assignee_id, dueAt: r.due_at, status: r.status, createdBy: r.created_by,
      createdAt: r.created_at, completedAt: r.completed_at,
    };
  }

  completeActivity(id, ctx) {
    this.dialect.prepare("UPDATE activities SET status = 'done', completed_at = ? WHERE id = ?").run(this.#now(), id);
    return this.getActivity(id);
  }

  /** Open activities for an actor, scoped to their companies. */
  myActivities(ctx, { overdueOnly = false } = {}) {
    const companies = ctx.companyMemberships?.length ? ctx.companyMemberships : [ctx.activeCompanyId];
    const placeholders = companies.map(() => '?').join(',');
    const sql = `SELECT id FROM activities WHERE assignee_id = ? AND status = 'open' AND (company_id IS NULL OR company_id IN (${placeholders}))${overdueOnly ? ' AND due_at IS NOT NULL AND due_at <= ?' : ''} ORDER BY due_at`;
    const params = overdueOnly ? [ctx.actorId, ...companies, this.#now()] : [ctx.actorId, ...companies];
    return this.dialect.prepare(sql).all(...params).map((r) => this.getActivity(r.id));
  }
}

export function createHistoryService(dialect, deps) { return new HistoryService(dialect, deps); }
export function createChatterService(dialect, deps) { return new ChatterService(dialect, deps); }
