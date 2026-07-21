// Transactional outbox dispatcher — Phase 01 foundation.
//
// Source composition:
// - VNext vnext/server/events/outbox.js (project-owned) for outbox table shape
//   and delivery states.
// - VNext vnext/server/modules/r3-infra.js publish() for event fan-out.
// - Frappe background-job enqueue patterns (MIT reference) for durable delivery.
// - NocoBase workflow/event registry (clean-room reference) for consumer semantics.
//
// Responsibilities:
//   - poll platform_outbox for pending rows
//   - deliver each event to registered consumers idempotently
//   - retry with explicit max attempts, then dead-letter
//   - preserve the business commit: outbox delivery failure does not rollback the
//     business transaction that already committed
//   - support replay and record delivery audit

'use strict';

import { EventRegistryError } from '../events/index.mjs';

export class OutboxError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'OutboxError';
    this.code = code;
    this.details = details;
  }
}

export class OutboxDispatcher {
  constructor(dialect, options = {}) {
    if (!dialect || typeof dialect.prepare !== 'function') {
      throw new OutboxError('dialect with prepare() is required', 'DIALECT_REQUIRED');
    }
    this.dialect = dialect;
    this.maxAttempts = options.maxAttempts || 3;
    this.consumers = new Map();
  }

  #now() {
    return new Date().toISOString();
  }

  registerConsumer(eventType, handler) {
    if (typeof handler !== 'function') throw new OutboxError('handler must be a function', 'INVALID_HANDLER');
    if (!this.consumers.has(eventType)) this.consumers.set(eventType, []);
    this.consumers.get(eventType).push(handler);
    return this;
  }

  pollPending(batchSize = 100) {
    return this.dialect.prepare(`
      SELECT * FROM platform_outbox
      WHERE status IN ('pending', 'failed')
        AND scheduled_at <= ?
        AND attempts < ?
      ORDER BY created_at ASC
      LIMIT ?
    `).all(this.#now(), this.maxAttempts, batchSize);
  }

  deliver(row, consumers) {
    const payload = JSON.parse(row.payload || '{}');
    const results = [];
    for (const handler of consumers) {
      try {
        const result = handler({
          eventType: row.event_type,
          schemaVersion: row.schema_version,
          aggregateId: row.aggregate_id,
          tenantId: row.tenant_id,
          companyId: row.company_id,
          actorId: row.actor_id,
          correlationId: row.correlation_id,
          payload,
        });
        results.push({ ok: true, result });
      } catch (error) {
        results.push({ ok: false, error: error.message || String(error) });
      }
    }
    const allOk = results.every((r) => r.ok);
    return { allOk, results };
  }

  dispatch(batchSize = 100) {
    const rows = this.pollPending(batchSize);
    const summary = { processed: 0, delivered: 0, failed: 0, dead: 0 };
    for (const row of rows) {
      const consumers = this.consumers.get(row.event_type) || [];
      this.dialect.exec('BEGIN IMMEDIATE;');
      let status;
      let errorLog = null;
      let deliveredAt = null;
      try {
        if (consumers.length === 0) {
          status = 'delivered';
          deliveredAt = this.#now();
        } else {
          const outcome = this.deliver(row, consumers);
          if (outcome.allOk) {
            status = 'delivered';
            deliveredAt = this.#now();
          } else {
            status = row.attempts + 1 >= this.maxAttempts ? 'dead' : 'failed';
            errorLog = JSON.stringify(outcome.results);
          }
        }
        this.dialect.prepare(`
          UPDATE platform_outbox
          SET status = ?, attempts = attempts + 1, error_log = ?, delivered_at = ?
          WHERE id = ?
        `).run(status, errorLog, deliveredAt, row.id);
        this.dialect.exec('COMMIT;');
      } catch (error) {
        this.dialect.exec('ROLLBACK;');
        throw error;
      }
      summary.processed += 1;
      if (status === 'delivered') summary.delivered += 1;
      else if (status === 'failed') summary.failed += 1;
      else if (status === 'dead') summary.dead += 1;
    }
    return summary;
  }

  replay(outboxId, consumers) {
    const row = this.dialect.prepare('SELECT * FROM platform_outbox WHERE id = ?').get(outboxId);
    if (!row) throw new OutboxError('outbox row not found', 'ROW_NOT_FOUND');
    this.dialect.prepare('UPDATE platform_outbox SET status = ?, attempts = 0, error_log = NULL, delivered_at = NULL WHERE id = ?').run('pending', outboxId);
    return this.dispatch(1);
  }

  getDeadLetters() {
    return this.dialect.prepare('SELECT * FROM platform_outbox WHERE status = ? ORDER BY created_at DESC').all('dead');
  }
}

export function createOutboxDispatcher(dialect, options) {
  return new OutboxDispatcher(dialect, options);
}
