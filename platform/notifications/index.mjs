// Notification center and durable channel delivery — Phase 02 packet 02.26.
//
// Source composition:
// - VNext vnext/server/notify/notify.js + client/inbox.js (project-owned,
//   MERGE-CANONICAL): in-app notification rows, read state, the inbox contract.
// - Octagon WhatsApp/notification routes in server.js (PRESERVE the channel
//   vocabulary: inapp / email / whatsapp / webhook).
// - Phase 01 platform/outbox (CONSUME): external effects only after commit.
// - Frappe/RuoYi/NocoBase notification patterns (references, behavior only).
//
// Invariants (§ 12.2, § 12.3):
//   - deduplicated by an explicit dedupe key (unique index does the work)
//   - a preference can silence informational/operational notices but NEVER a
//     security or legal one
//   - a payload is masked before it is stored, so a notification cannot become a
//     field-masking bypass
//   - delivery is a durable, retryable job with backoff and dead-lettering

'use strict';

import crypto from 'node:crypto';
import { redactForLogs } from '../settings/secrets/index.mjs';

export class NotificationError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'NotificationError';
    this.code = code;
    this.details = details;
  }
}

/** Categories a user preference may never switch off. */
export const MANDATORY_CATEGORIES = Object.freeze(['security', 'legal']);
export const CHANNELS = Object.freeze(['inapp', 'email', 'whatsapp', 'webhook']);

/** In-memory channel used by tests and as the local development transport. */
export function createMemoryChannel(name, { failTimes = 0, alwaysFail = false, latencyMs = 0 } = {}) {
  const sent = [];
  let remainingFailures = failTimes;
  return {
    name,
    sent,
    reset() { sent.length = 0; remainingFailures = failTimes; },
    send(delivery) {
      if (alwaysFail) throw new NotificationError(`${name} provider is unavailable`, 'PROVIDER_UNAVAILABLE');
      if (remainingFailures > 0) { remainingFailures -= 1; throw new NotificationError(`${name} provider timed out`, 'PROVIDER_TIMEOUT'); }
      if (latencyMs) { /* deterministic: latency is recorded, never slept */ }
      sent.push(delivery);
      return { providerMessageId: `${name}_${crypto.randomUUID()}` };
    },
  };
}

export class NotificationService {
  constructor(dialect, deps = {}) {
    this.dialect = dialect;
    this.evaluator = deps.evaluator || null;
    this.now = deps.now || (() => new Date());
    /** @type {Map<string, {send:(d:object)=>object}>} */
    this.channels = new Map();
    for (const channel of deps.channels || []) this.channels.set(channel.name, channel);
  }

  #now() { return this.now().toISOString(); }

  registerChannel(channel) { this.channels.set(channel.name, channel); return this; }

  defineTemplate({ id, moduleId, eventKey, locale = 'ar', channel = 'inapp', subject = null, body, category = 'informational' }) {
    this.dialect.prepare(`
      INSERT INTO notification_templates (id, module_id, event_key, locale, channel, subject, body, category, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET subject=excluded.subject, body=excluded.body, category=excluded.category
    `).run(id || `tpl_${eventKey}_${locale}_${channel}`, moduleId, eventKey, locale, channel, subject, body, category, this.#now());
  }

  template(eventKey, locale = 'ar', channel = 'inapp') {
    return this.dialect.prepare('SELECT * FROM notification_templates WHERE event_key = ? AND locale = ? AND channel = ?').get(eventKey, locale, channel)
      || this.dialect.prepare("SELECT * FROM notification_templates WHERE event_key = ? AND locale = 'ar' AND channel = 'inapp'").get(eventKey);
  }

  /** Simple, injection-free interpolation: values are substituted, never evaluated. */
  static render(text, payload = {}) {
    return String(text || '').replace(/{{\s*([a-zA-Z0-9_.]+)\s*}}/g, (_, path) => {
      const value = path.split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), payload);
      return value == null ? '' : String(value);
    });
  }

  setPreference(userId, eventKey, channel, enabled) {
    this.dialect.prepare(`
      INSERT INTO notification_preferences (id, user_id, event_key, channel, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, event_key, channel) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at
    `).run(`pref_${crypto.randomUUID()}`, userId, eventKey, channel, enabled ? 1 : 0, this.#now());
  }

  /**
   * Is a channel permitted for this recipient/event? A mandatory category always
   * returns true — a user cannot opt out of a security or legal notice.
   */
  isChannelEnabled(userId, eventKey, channel, category) {
    if (MANDATORY_CATEGORIES.includes(category)) return true;
    const pref = this.dialect.prepare('SELECT enabled FROM notification_preferences WHERE user_id = ? AND event_key = ? AND channel = ?').get(userId, eventKey, channel);
    return pref ? pref.enabled === 1 : true;
  }

  /**
   * Mask a payload with the recipient's own field partition before storing it,
   * so a notification can never reveal a field the recipient cannot read.
   */
  #maskPayload(recipientId, payload) {
    if (!this.evaluator || !payload?.entity) return payload;
    const memberships = this.dialect.prepare("SELECT company_id, branch_id FROM organization_memberships WHERE user_id = ? AND status='active'").all(recipientId);
    if (!memberships.length) return payload;
    const probe = {
      actorId: recipientId, actorType: 'user', userId: recipientId,
      activeCompanyId: memberships[0].company_id, companyMemberships: memberships.map((m) => m.company_id),
      activeBranchId: memberships[0].branch_id, branchMemberships: [], operatingScopes: [],
      delegations: [], apiKeyScopes: [], enabledModules: [], now: this.#now(),
    };
    const roleIds = this.evaluator.effectiveRoleIds(probe);
    return { ...payload, data: this.evaluator.maskRecord(payload.entity, payload.data || {}, roleIds) };
  }

  /**
   * Create a notification and queue its deliveries. Returns `{created:false}`
   * when the dedupe key has already been seen.
   */
  notify({ recipientId, eventKey, category = 'informational', subject = null, body = null, link = null,
    payload = {}, dedupeKey = null, channels = ['inapp'], tenantId = null, companyId = null, correlationId = null, locale = 'ar' }) {
    const template = this.template(eventKey, locale, 'inapp');
    const resolvedCategory = template?.category || category;
    const masked = this.#maskPayload(recipientId, payload);
    const renderedSubject = subject ?? (template ? NotificationService.render(template.subject, masked) : null);
    const renderedBody = body ?? (template ? NotificationService.render(template.body, masked) : '');

    const id = `ntf_${crypto.randomUUID()}`;
    try {
      this.dialect.prepare(`
        INSERT INTO notifications (id, recipient_id, tenant_id, company_id, event_key, dedupe_key, category,
          subject, body, link, payload, correlation_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, recipientId, tenantId, companyId, eventKey, dedupeKey, resolvedCategory,
        renderedSubject, renderedBody, link, JSON.stringify(redactForLogs(masked)), correlationId, this.#now());
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return { created: false, deduped: true, dedupeKey };
      throw e;
    }

    const queued = [];
    for (const channel of channels) {
      if (!CHANNELS.includes(channel)) throw new NotificationError(`unknown channel ${channel}`, 'CHANNEL_UNKNOWN', { channel });
      if (!this.isChannelEnabled(recipientId, eventKey, channel, resolvedCategory)) {
        this.dialect.prepare(`
          INSERT INTO notification_deliveries (id, notification_id, channel, status, created_at) VALUES (?, ?, ?, 'suppressed', ?)
        `).run(`del_${crypto.randomUUID()}`, id, channel, this.#now());
        continue;
      }
      this.dialect.prepare(`
        INSERT INTO notification_deliveries (id, notification_id, channel, target, status, next_attempt_at, created_at)
        VALUES (?, ?, ?, ?, 'pending', ?, ?)
      `).run(`del_${crypto.randomUUID()}`, id, channel, recipientId, this.#now(), this.#now());
      queued.push(channel);
    }
    return { created: true, id, queuedChannels: queued, category: resolvedCategory };
  }

  /**
   * Deliver pending rows. In-app "delivery" is the row itself. External channels
   * go through a registered provider with retry/backoff and dead-lettering.
   */
  dispatch({ batchSize = 50 } = {}) {
    const nowIso = this.#now();
    const pending = this.dialect.prepare(`
      SELECT d.*, n.recipient_id, n.subject, n.body, n.event_key, n.payload
      FROM notification_deliveries d JOIN notifications n ON n.id = d.notification_id
      WHERE d.status IN ('pending','failed') AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= ?)
        AND d.attempts < d.max_attempts
      ORDER BY d.created_at LIMIT ?
    `).all(nowIso, batchSize);

    const summary = { delivered: 0, failed: 0, dead: 0 };
    for (const row of pending) {
      if (row.channel === 'inapp') {
        this.dialect.prepare("UPDATE notification_deliveries SET status = 'sent', delivered_at = ?, attempts = attempts + 1 WHERE id = ?").run(nowIso, row.id);
        summary.delivered += 1;
        continue;
      }
      const provider = this.channels.get(row.channel);
      const attempts = row.attempts + 1;
      if (!provider) {
        this.dialect.prepare("UPDATE notification_deliveries SET status = 'dead', attempts = ?, last_error = ? WHERE id = ?")
          .run(attempts, `no provider registered for ${row.channel}`, row.id);
        summary.dead += 1;
        continue;
      }
      try {
        const result = provider.send({
          channel: row.channel, target: row.target, recipientId: row.recipient_id,
          subject: row.subject, body: row.body, eventKey: row.event_key, payload: JSON.parse(row.payload || '{}'),
        });
        this.dialect.prepare("UPDATE notification_deliveries SET status = 'sent', delivered_at = ?, attempts = ?, provider = ? WHERE id = ?")
          .run(nowIso, attempts, result?.providerMessageId || row.channel, row.id);
        this.#recordProviderHealth(row.channel, true, null);
        summary.delivered += 1;
      } catch (error) {
        const dead = attempts >= row.max_attempts;
        const backoffMs = Math.min(300000, 1000 * 2 ** (attempts - 1));
        this.dialect.prepare(`
          UPDATE notification_deliveries SET status = ?, attempts = ?, last_error = ?, next_attempt_at = ? WHERE id = ?
        `).run(dead ? 'dead' : 'failed', attempts, String(error.message || error),
          dead ? null : new Date(this.now().getTime() + backoffMs).toISOString(), row.id);
        this.#recordProviderHealth(row.channel, false, String(error.message || error));
        if (dead) summary.dead += 1; else summary.failed += 1;
      }
    }
    return summary;
  }

  #recordProviderHealth(channel, ok, error) {
    const existing = this.dialect.prepare('SELECT * FROM provider_health WHERE provider = ?').get(channel);
    const failures = ok ? 0 : Number(existing?.consecutive_failures || 0) + 1;
    const status = failures === 0 ? 'healthy' : (failures >= 5 ? 'down' : 'degraded');
    this.dialect.prepare(`
      INSERT INTO provider_health (provider, channel, consecutive_failures, last_success_at, last_failure_at, last_error, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider) DO UPDATE SET consecutive_failures = excluded.consecutive_failures,
        last_success_at = COALESCE(excluded.last_success_at, provider_health.last_success_at),
        last_failure_at = COALESCE(excluded.last_failure_at, provider_health.last_failure_at),
        last_error = excluded.last_error, status = excluded.status
    `).run(channel, channel, failures, ok ? this.#now() : null, ok ? null : this.#now(), error, status);
  }

  providerHealth() {
    return this.dialect.prepare('SELECT * FROM provider_health ORDER BY provider').all();
  }

  deadLetters() {
    return this.dialect.prepare("SELECT * FROM notification_deliveries WHERE status = 'dead' ORDER BY created_at DESC").all();
  }

  /** Inbox for an actor. Scope-checked: you only ever see your own. */
  inbox(ctx, { unreadOnly = false, limit = 50 } = {}) {
    const sql = `SELECT * FROM notifications WHERE recipient_id = ? AND archived_at IS NULL${unreadOnly ? ' AND read_at IS NULL' : ''} ORDER BY created_at DESC LIMIT ?`;
    return this.dialect.prepare(sql).all(ctx.actorId, limit).map((n) => ({
      id: n.id, eventKey: n.event_key, category: n.category, subject: n.subject, body: n.body,
      link: n.link, payload: JSON.parse(n.payload || '{}'), readAt: n.read_at, createdAt: n.created_at,
    }));
  }

  unreadCount(ctx) {
    return Number(this.dialect.prepare('SELECT COUNT(*) AS n FROM notifications WHERE recipient_id = ? AND read_at IS NULL AND archived_at IS NULL').get(ctx.actorId).n);
  }

  markRead(notificationId, ctx) {
    const info = this.dialect.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND recipient_id = ?')
      .run(this.#now(), notificationId, ctx.actorId);
    if (info.changes === 0) throw new NotificationError('notification not found for this recipient', 'NOTIFICATION_NOT_FOUND');
    return true;
  }

  archive(notificationId, ctx) {
    this.dialect.prepare('UPDATE notifications SET archived_at = ? WHERE id = ? AND recipient_id = ?').run(this.#now(), notificationId, ctx.actorId);
    return true;
  }

  /**
   * Consume Phase 01 outbox rows that workflow/domain code queued. This is the
   * bridge that guarantees an external notification happens only AFTER the
   * business transaction committed (§ 68).
   */
  consumeOutbox(dispatcher) {
    dispatcher.registerConsumer('workflow.notify', (event) => {
      const payload = event.payload || {};
      return this.notify({
        recipientId: payload.to || event.actorId,
        eventKey: payload.eventKey || 'workflow.notify',
        subject: payload.title || null,
        body: payload.body || payload.title || '',
        channels: payload.channel ? [payload.channel] : ['inapp'],
        payload,
        dedupeKey: `outbox:${event.aggregateId}:${payload.node || ''}`,
        tenantId: event.tenantId, companyId: event.companyId, correlationId: event.correlationId,
      });
    });
    return dispatcher;
  }
}

export function createNotificationService(dialect, deps) { return new NotificationService(dialect, deps); }
