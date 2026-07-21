// Durable job queue, webhooks, and integration delivery — Phase 02 packet 02.29.
//
// Source composition:
// - Phase 01 platform/kernel/jobs (EXTEND, not replace): platform_jobs remains
//   the DEFINITION registry; this module owns the durable RUN queue.
// - Octagon server-scheduler.js (PRESERVE the cron vocabulary and the rule that
//   a scheduled tick creates work rather than mutating business data directly).
// - VNext modules/r3-infra.js lease/idempotency/retry patterns and
//   modules/governance/integration-engine.js webhook signing (project-owned,
//   MERGE-REFACTOR).
// - Odoo odoo/addons/base/models/ir_cron.py (clean-room): cron rows create jobs.
// - RuoYi Quartz/idempotency/rate-limit/signature starters (MIT reference).
//
// Invariants (§ 23, § 54, § 68):
//   - cron creates a JOB; it never performs a direct business mutation
//   - an external call happens only after commit, from a queued delivery
//   - a webhook is HMAC-signed with a timestamp and nonce; replay is rejected
//   - a job carries tenant/company/service identity and is scope-checked

'use strict';

import crypto from 'node:crypto';
import { redactForLogs } from '../settings/secrets/index.mjs';

export class JobError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'JobError';
    this.code = code;
    this.details = details;
  }
}

export class JobQueue {
  constructor(dialect, deps = {}) {
    this.dialect = dialect;
    this.workerId = deps.workerId || `worker_${crypto.randomUUID().slice(0, 8)}`;
    this.leaseSeconds = deps.leaseSeconds ?? 30;
    this.now = deps.now || (() => new Date());
    /** @type {Map<string, (job:object)=>any>} */
    this.handlers = new Map();
  }

  #now() { return this.now().toISOString(); }

  registerHandler(kind, fn) {
    if (typeof fn !== 'function') throw new JobError('handler must be a function', 'INVALID_HANDLER');
    this.handlers.set(kind, fn);
    return this;
  }

  /** Enqueue. An `idempotencyKey` makes a duplicate enqueue return the original. */
  enqueue({ kind, payload = {}, jobId = null, tenantId = null, companyId = null, actorId = null,
    serviceIdentityId = null, idempotencyKey = null, runAfter = null, maxAttempts = 3 }) {
    if (idempotencyKey) {
      const existing = this.dialect.prepare('SELECT id FROM job_runs WHERE kind = ? AND idempotency_key = ?').get(kind, idempotencyKey);
      if (existing) return this.get(existing.id);
    }
    const id = `job_${crypto.randomUUID()}`;
    this.dialect.prepare(`
      INSERT INTO job_runs (id, job_id, kind, payload, tenant_id, company_id, actor_id, service_identity_id,
        idempotency_key, status, max_attempts, run_after, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)
    `).run(id, jobId, kind, JSON.stringify(payload), tenantId, companyId, actorId, serviceIdentityId,
      idempotencyKey, maxAttempts, runAfter || this.#now(), this.#now());
    return this.get(id);
  }

  get(id) {
    const r = this.dialect.prepare('SELECT * FROM job_runs WHERE id = ?').get(id);
    if (!r) return null;
    return {
      id: r.id, jobId: r.job_id, kind: r.kind, payload: JSON.parse(r.payload || '{}'),
      tenantId: r.tenant_id, companyId: r.company_id, actorId: r.actor_id, serviceIdentityId: r.service_identity_id,
      idempotencyKey: r.idempotency_key, status: r.status, attempts: r.attempts, maxAttempts: r.max_attempts,
      runAfter: r.run_after, leaseId: r.lease_id, leasedUntil: r.leased_until, progress: r.progress,
      result: r.result ? JSON.parse(r.result) : null, lastError: r.last_error,
      createdAt: r.created_at, finishedAt: r.finished_at,
    };
  }

  /** Claim one job under a lease. Two workers cannot claim the same row. */
  claim() {
    const nowIso = this.#now();
    const leaseId = `lease_${crypto.randomUUID()}`;
    const leasedUntil = new Date(this.now().getTime() + this.leaseSeconds * 1000).toISOString();
    this.dialect.exec('BEGIN IMMEDIATE;');
    try {
      const candidate = this.dialect.prepare(`
        SELECT id FROM job_runs
        WHERE status IN ('queued','failed') AND run_after <= ? AND attempts < max_attempts
          AND (leased_until IS NULL OR leased_until <= ?)
        ORDER BY created_at LIMIT 1
      `).get(nowIso, nowIso);
      if (!candidate) { this.dialect.exec('COMMIT;'); return null; }
      const info = this.dialect.prepare(`
        UPDATE job_runs SET status = 'running', lease_id = ?, leased_until = ?, heartbeat_at = ?
        WHERE id = ? AND (leased_until IS NULL OR leased_until <= ?)
      `).run(leaseId, leasedUntil, nowIso, candidate.id, nowIso);
      this.dialect.exec('COMMIT;');
      if (info.changes === 0) return null;
      return { jobId: candidate.id, leaseId };
    } catch (e) {
      this.dialect.exec('ROLLBACK;');
      throw e;
    }
  }

  heartbeat(jobId, leaseId, progress = null) {
    const leasedUntil = new Date(this.now().getTime() + this.leaseSeconds * 1000).toISOString();
    const info = progress === null
      ? this.dialect.prepare('UPDATE job_runs SET heartbeat_at = ?, leased_until = ? WHERE id = ? AND lease_id = ?')
        .run(this.#now(), leasedUntil, jobId, leaseId)
      : this.dialect.prepare('UPDATE job_runs SET heartbeat_at = ?, leased_until = ?, progress = ? WHERE id = ? AND lease_id = ?')
        .run(this.#now(), leasedUntil, progress, jobId, leaseId);
    return info.changes > 0;
  }

  /** Execute one claimed job with retry/backoff and dead-lettering. */
  execute(jobId, leaseId) {
    const job = this.get(jobId);
    if (!job) throw new JobError('job not found', 'JOB_NOT_FOUND', { jobId });
    if (job.leaseId !== leaseId) throw new JobError('lease is not held by this worker', 'STALE_LEASE', { jobId });
    if (job.status === 'cancelled') return { status: 'cancelled' };

    const handler = this.handlers.get(job.kind);
    const attempts = job.attempts + 1;
    if (!handler) {
      this.dialect.prepare("UPDATE job_runs SET status = 'dead', attempts = ?, last_error = ?, finished_at = ?, lease_id = NULL WHERE id = ?")
        .run(attempts, `no handler registered for kind ${job.kind}`, this.#now(), jobId);
      return { status: 'dead', reason: 'NO_HANDLER' };
    }
    try {
      const result = handler(job);
      this.dialect.prepare("UPDATE job_runs SET status = 'succeeded', attempts = ?, result = ?, progress = 100, finished_at = ?, lease_id = NULL, leased_until = NULL WHERE id = ?")
        .run(attempts, JSON.stringify(redactForLogs(result ?? null)), this.#now(), jobId);
      return { status: 'succeeded', result };
    } catch (error) {
      const dead = attempts >= job.maxAttempts;
      const backoffMs = Math.min(300000, 1000 * 2 ** (attempts - 1));
      this.dialect.prepare(`
        UPDATE job_runs SET status = ?, attempts = ?, last_error = ?, run_after = ?, finished_at = ?, lease_id = NULL, leased_until = NULL WHERE id = ?
      `).run(dead ? 'dead' : 'failed', attempts, String(error.message || error),
        dead ? job.runAfter : new Date(this.now().getTime() + backoffMs).toISOString(),
        dead ? this.#now() : null, jobId);
      return { status: dead ? 'dead' : 'failed', error: String(error.message || error), nextAttemptInMs: dead ? null : backoffMs };
    }
  }

  cancel(jobId) {
    this.dialect.prepare("UPDATE job_runs SET status = 'cancelled', finished_at = ?, lease_id = NULL WHERE id = ? AND status IN ('queued','failed','running')")
      .run(this.#now(), jobId);
    return this.get(jobId);
  }

  /** Reclaim jobs whose worker died mid-flight. */
  recoverStaleLeases() {
    const nowIso = this.#now();
    const stale = this.dialect.prepare("SELECT id FROM job_runs WHERE status = 'running' AND leased_until IS NOT NULL AND leased_until <= ?").all(nowIso);
    for (const row of stale) {
      this.dialect.prepare("UPDATE job_runs SET status = 'queued', lease_id = NULL, leased_until = NULL WHERE id = ?").run(row.id);
    }
    return stale.map((r) => r.id);
  }

  /** Drain the queue. Returns a per-status tally. */
  drain({ max = 100 } = {}) {
    const summary = { succeeded: 0, failed: 0, dead: 0, cancelled: 0 };
    for (let i = 0; i < max; i++) {
      const claimed = this.claim();
      if (!claimed) break;
      const outcome = this.execute(claimed.jobId, claimed.leaseId);
      summary[outcome.status] = (summary[outcome.status] || 0) + 1;
    }
    return summary;
  }

  deadLetters() {
    return this.dialect.prepare("SELECT * FROM job_runs WHERE status = 'dead' ORDER BY created_at DESC").all();
  }

  /**
   * A cron tick. Preserved rule from Octagon's scheduler: the tick ENQUEUES work,
   * it never mutates business data itself, so a scheduled action is subject to
   * exactly the same governance as a user action.
   */
  tick({ jobDefinitionIds = null } = {}) {
    const defs = jobDefinitionIds
      ? this.dialect.prepare(`SELECT * FROM platform_jobs WHERE enabled = 1 AND id IN (${jobDefinitionIds.map(() => '?').join(',')})`).all(...jobDefinitionIds)
      : this.dialect.prepare('SELECT * FROM platform_jobs WHERE enabled = 1').all();
    return defs.map((def) => this.enqueue({
      kind: def.handler, jobId: def.id, payload: { schedule: def.schedule },
      idempotencyKey: `${def.id}:${this.#now().slice(0, 16)}`,
    }));
  }
}

// --- webhooks ----------------------------------------------------------------

export class WebhookService {
  constructor(dialect, deps = {}) {
    this.dialect = dialect;
    this.vault = deps.vault || null;
    this.transport = deps.transport || null;
    this.now = deps.now || (() => new Date());
  }

  #now() { return this.now().toISOString(); }

  subscribe({ id, moduleId, eventType, url, secretRef = null, tenantId = null, companyId = null,
    serviceIdentityId = null, headers = {}, mapping = {}, payloadVersion = '1.0.0' }, actor = 'system') {
    if (!/^https:\/\//i.test(url) && !/^http:\/\/(localhost|127\.)/i.test(url)) {
      throw new JobError('a webhook URL must use https', 'WEBHOOK_URL_INSECURE', { url });
    }
    const subId = id || `whs_${crypto.randomUUID()}`;
    this.dialect.prepare(`
      INSERT INTO webhook_subscriptions (id, module_id, event_type, url, secret_ref, tenant_id, company_id,
        service_identity_id, headers, mapping, payload_version, active, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET url=excluded.url, secret_ref=excluded.secret_ref, headers=excluded.headers,
        mapping=excluded.mapping, payload_version=excluded.payload_version
    `).run(subId, moduleId, eventType, url, secretRef, tenantId, companyId, serviceIdentityId,
      JSON.stringify(headers), JSON.stringify(mapping), payloadVersion, this.#now(), actor);
    return this.getSubscription(subId);
  }

  getSubscription(id) {
    const r = this.dialect.prepare('SELECT * FROM webhook_subscriptions WHERE id = ?').get(id);
    if (!r) return null;
    return {
      id: r.id, moduleId: r.module_id, eventType: r.event_type, url: r.url, secretRef: r.secret_ref,
      tenantId: r.tenant_id, companyId: r.company_id, serviceIdentityId: r.service_identity_id,
      headers: JSON.parse(r.headers || '{}'), mapping: JSON.parse(r.mapping || '{}'),
      payloadVersion: r.payload_version, active: r.active === 1,
    };
  }

  deactivate(id) {
    this.dialect.prepare('UPDATE webhook_subscriptions SET active = 0 WHERE id = ?').run(id);
  }

  /** HMAC-SHA256 over `timestamp.nonce.body` — timestamp and nonce defeat replay. */
  static sign(secret, { timestamp, nonce, body }) {
    return crypto.createHmac('sha256', String(secret)).update(`${timestamp}.${nonce}.${body}`).digest('hex');
  }

  /**
   * Queue a delivery. This is called AFTER the business transaction committed
   * (from the outbox), never inside it.
   */
  queue({ eventType, eventId, payload, tenantId = null, companyId = null }) {
    const subs = this.dialect.prepare(`
      SELECT id FROM webhook_subscriptions WHERE event_type = ? AND active = 1
        AND (tenant_id IS NULL OR tenant_id = ?) AND (company_id IS NULL OR company_id = ?)
    `).all(eventType, tenantId, companyId);

    const queued = [];
    for (const { id } of subs) {
      const sub = this.getSubscription(id);
      const body = JSON.stringify({ eventType, eventId, version: sub.payloadVersion, data: redactForLogs(payload) });
      const timestamp = this.#now();
      const nonce = crypto.randomBytes(12).toString('hex');
      let secret = 'unsigned';
      if (sub.secretRef && this.vault) secret = this.vault.use(sub.secretRef, (s) => s);
      const signature = WebhookService.sign(secret, { timestamp, nonce, body });
      try {
        this.dialect.prepare(`
          INSERT INTO webhook_deliveries (id, subscription_id, event_id, payload, signature, timestamp, nonce, status, next_attempt_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
        `).run(`whd_${crypto.randomUUID()}`, sub.id, eventId, body, signature, timestamp, nonce, timestamp, timestamp);
        queued.push(sub.id);
      } catch (e) {
        // Unique (subscription_id, event_id): the same event is never queued twice.
        if (!String(e.message).includes('UNIQUE')) throw e;
      }
    }
    return { eventId, queued };
  }

  /** Deliver pending webhooks with retry/backoff and dead-lettering. */
  dispatch({ batchSize = 50 } = {}) {
    const nowIso = this.#now();
    const pending = this.dialect.prepare(`
      SELECT d.*, s.url, s.headers FROM webhook_deliveries d
      JOIN webhook_subscriptions s ON s.id = d.subscription_id AND s.active = 1
      WHERE d.status IN ('pending','failed') AND d.next_attempt_at <= ? AND d.attempts < d.max_attempts
      ORDER BY d.created_at LIMIT ?
    `).all(nowIso, batchSize);

    const summary = { sent: 0, failed: 0, dead: 0 };
    for (const row of pending) {
      const attempts = row.attempts + 1;
      if (!this.transport) {
        this.dialect.prepare("UPDATE webhook_deliveries SET status = 'dead', attempts = ?, last_error = ? WHERE id = ?")
          .run(attempts, 'no transport configured', row.id);
        summary.dead += 1;
        continue;
      }
      try {
        const response = this.transport({
          url: row.url,
          headers: {
            ...JSON.parse(row.headers || '{}'),
            'content-type': 'application/json',
            'x-octagon-signature': row.signature,
            'x-octagon-timestamp': row.timestamp,
            'x-octagon-nonce': row.nonce,
            'x-octagon-event-id': row.event_id,
          },
          body: row.payload,
        });
        const status = Number(response?.status ?? 200);
        if (status >= 200 && status < 300) {
          this.dialect.prepare("UPDATE webhook_deliveries SET status = 'sent', attempts = ?, response_status = ?, delivered_at = ? WHERE id = ?")
            .run(attempts, status, this.#now(), row.id);
          summary.sent += 1;
        } else {
          throw new JobError(`endpoint returned ${status}`, 'WEBHOOK_HTTP_ERROR', { status });
        }
      } catch (error) {
        const dead = attempts >= row.max_attempts;
        const backoffMs = Math.min(600000, 1000 * 2 ** (attempts - 1));
        this.dialect.prepare(`
          UPDATE webhook_deliveries SET status = ?, attempts = ?, last_error = ?, next_attempt_at = ? WHERE id = ?
        `).run(dead ? 'dead' : 'failed', attempts, String(error.message || error),
          new Date(this.now().getTime() + backoffMs).toISOString(), row.id);
        if (dead) summary.dead += 1; else summary.failed += 1;
      }
    }
    return summary;
  }

  /**
   * Verify an INBOUND webhook: signature, clock skew, and single-use nonce.
   * All three are required — a valid signature alone is replayable.
   */
  verifyInbound({ source, secret, signature, timestamp, nonce, body, toleranceSeconds = 300 }) {
    const expected = WebhookService.sign(secret, { timestamp, nonce, body });
    const a = Buffer.from(String(signature || ''));
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, reasonCode: 'WEBHOOK_BAD_SIGNATURE' };
    }
    const skew = Math.abs(this.now().getTime() - Date.parse(timestamp));
    if (!Number.isFinite(skew) || skew > toleranceSeconds * 1000) {
      return { ok: false, reasonCode: 'WEBHOOK_STALE_TIMESTAMP' };
    }
    try {
      this.dialect.prepare('INSERT INTO webhook_inbound_seen (id, source, nonce, seen_at) VALUES (?, ?, ?, ?)')
        .run(crypto.randomUUID(), source, nonce, this.#now());
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return { ok: false, reasonCode: 'WEBHOOK_REPLAYED' };
      throw e;
    }
    return { ok: true };
  }

  deliveries(subscriptionId, limit = 100) {
    return this.dialect.prepare('SELECT * FROM webhook_deliveries WHERE subscription_id = ? ORDER BY created_at DESC LIMIT ?').all(subscriptionId, limit);
  }

  deadLetters() {
    return this.dialect.prepare("SELECT * FROM webhook_deliveries WHERE status = 'dead' ORDER BY created_at DESC").all();
  }

  /**
   * Bridge Phase 01's outbox to webhook delivery. Registering this consumer is
   * what makes "external effects only after commit" true end to end.
   */
  consumeOutbox(dispatcher, eventTypes = []) {
    for (const eventType of eventTypes) {
      dispatcher.registerConsumer(eventType, (event) => this.queue({
        eventType,
        eventId: `${event.aggregateId}:${event.correlationId || crypto.randomUUID()}`,
        payload: event.payload,
        tenantId: event.tenantId,
        companyId: event.companyId,
      }));
    }
    return dispatcher;
  }
}

export function createJobQueue(dialect, deps) { return new JobQueue(dialect, deps); }
export function createWebhookService(dialect, deps) { return new WebhookService(dialect, deps); }
