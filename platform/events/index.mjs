// Typed event registry — Phase 01 foundation.
//
// Source composition:
// - VNext vnext/server/modules/r3-infra.js publish() and event shape.
// - VNext vnext/server/events/events.js (project-owned) for event schema and
//   consumer registration patterns.
// - NocoBase workflow registry (clean-room reference) for typed event schemas.
// - Frappe hooks / enqueue patterns (MIT reference) for document hooks.
//
// Responsibilities:
//   - register and version event schemas in platform_events
//   - validate event payloads against schema
//   - provide event metadata for outbox and audit correlation

'use strict';

export const DELIVERY_GUARANTEES = ['at-least-once', 'at-most-once', 'exactly-once'];
export const PRIVACY_CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'];

export class EventRegistryError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'EventRegistryError';
    this.code = code;
    this.details = details;
  }
}

export function validateEventType(input) {
  if (!input || typeof input !== 'object') throw new EventRegistryError('event type must be an object', 'EVENT_INVALID');
  if (!input.id || typeof input.id !== 'string') throw new EventRegistryError('event id is required', 'EVENT_INVALID_ID');
  if (!input.event_type || typeof input.event_type !== 'string') throw new EventRegistryError('event_type is required', 'EVENT_MISSING_TYPE');
  if (!input.module_id) throw new EventRegistryError('module_id is required', 'EVENT_MISSING_MODULE');
  if (input.delivery_guarantee && !DELIVERY_GUARANTEES.includes(input.delivery_guarantee)) {
    throw new EventRegistryError(`delivery_guarantee must be one of ${DELIVERY_GUARANTEES.join(', ')}`, 'EVENT_INVALID_DELIVERY');
  }
  if (input.privacy_classification && !PRIVACY_CLASSIFICATIONS.includes(input.privacy_classification)) {
    throw new EventRegistryError(`privacy_classification must be one of ${PRIVACY_CLASSIFICATIONS.join(', ')}`, 'EVENT_INVALID_PRIVACY');
  }
  return {
    id: input.id,
    event_type: input.event_type,
    schema_version: input.schema_version || '1.0.0',
    module_id: input.module_id,
    aggregate_entity: input.aggregate_entity || null,
    tenant_scoped: input.tenant_scoped !== false,
    company_scoped: input.company_scoped !== false,
    payload_schema: input.payload_schema || null,
    delivery_guarantee: input.delivery_guarantee || 'at-least-once',
    retention_policy: input.retention_policy || null,
    privacy_classification: input.privacy_classification || 'internal',
  };
}

export function validatePayload(eventType, payload) {
  if (!eventType.payload_schema) return true;
  if (!payload || typeof payload !== 'object') throw new EventRegistryError('payload must be an object', 'PAYLOAD_INVALID');
  const schema = eventType.payload_schema;
  if (schema.required && Array.isArray(schema.required)) {
    for (const key of schema.required) {
      if (payload[key] === undefined) throw new EventRegistryError(`payload missing required field: ${key}`, 'PAYLOAD_MISSING_FIELD');
    }
  }
  return true;
}

export class EventRegistry {
  constructor(dialect) {
    if (!dialect || typeof dialect.prepare !== 'function') {
      throw new EventRegistryError('dialect with prepare() is required', 'DIALECT_REQUIRED');
    }
    this.dialect = dialect;
  }

  #now() {
    return new Date().toISOString();
  }

  #assertModuleEnabled(moduleId) {
    const row = this.dialect.prepare('SELECT status FROM platform_modules WHERE id = ?').get(moduleId);
    if (!row) throw new EventRegistryError(`module ${moduleId} not installed`, 'MODULE_NOT_FOUND');
    if (row.status !== 'enabled') throw new EventRegistryError(`module ${moduleId} is not enabled`, 'MODULE_NOT_ENABLED');
  }

  register(input, actor = 'system') {
    const event = validateEventType(input);
    this.#assertModuleEnabled(event.module_id);
    this.dialect.prepare(`
      INSERT INTO platform_events (id, event_type, schema_version, module_id, aggregate_entity, tenant_scoped, company_scoped, payload_schema, delivery_guarantee, retention_policy, privacy_classification, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        event_type = excluded.event_type,
        schema_version = excluded.schema_version,
        module_id = excluded.module_id,
        aggregate_entity = excluded.aggregate_entity,
        tenant_scoped = excluded.tenant_scoped,
        company_scoped = excluded.company_scoped,
        payload_schema = excluded.payload_schema,
        delivery_guarantee = excluded.delivery_guarantee,
        retention_policy = excluded.retention_policy,
        privacy_classification = excluded.privacy_classification
    `).run(
      event.id, event.event_type, event.schema_version, event.module_id, event.aggregate_entity,
      event.tenant_scoped ? 1 : 0, event.company_scoped ? 1 : 0,
      event.payload_schema ? JSON.stringify(event.payload_schema) : null,
      event.delivery_guarantee, event.retention_policy, event.privacy_classification,
      this.#now()
    );
    return event;
  }

  get(id) {
    const row = this.dialect.prepare('SELECT * FROM platform_events WHERE id = ?').get(id);
    if (!row) return null;
    return {
      id: row.id,
      event_type: row.event_type,
      schema_version: row.schema_version,
      module_id: row.module_id,
      aggregate_entity: row.aggregate_entity,
      tenant_scoped: row.tenant_scoped === 1,
      company_scoped: row.company_scoped === 1,
      payload_schema: row.payload_schema ? JSON.parse(row.payload_schema) : null,
      delivery_guarantee: row.delivery_guarantee,
      retention_policy: row.retention_policy,
      privacy_classification: row.privacy_classification,
    };
  }

  list() {
    return this.dialect.prepare('SELECT * FROM platform_events ORDER BY id').all().map((row) => ({
      id: row.id,
      event_type: row.event_type,
      schema_version: row.schema_version,
      module_id: row.module_id,
    }));
  }
}

export function createEventRegistry(dialect) {
  return new EventRegistry(dialect);
}
