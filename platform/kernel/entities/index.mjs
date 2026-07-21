// Entity registry — Phase 01 kernel.
//
// Source composition:
// - VNext 101_r1_lane_a_tables collection_registry + field_registry
//   (project-owned) used as the behavioral base for legacy entity metadata.
// - VNext crud-engine.js getRegistry() and entity config validation.
// - NocoBase collection.ts / resourcer.ts (clean-room reference) for
//   typed entity registration and relation ownership.
// - Frappe model/meta.py (MIT reference) for label and field metadata.
//
// Responsibilities:
//   - load, validate, and persist entity descriptors in platform_entities
//   - provide metadata to repositories, views, and actions
//   - protect reserved names and enforce migration ownership
//   - version metadata changes through the migration ledger (no runtime DDL)

'use strict';

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EntityDescriptorError,
  normalizeDescriptor,
  descriptorToRow,
  rowToDescriptor,
} from './schemas/entity-descriptor.mjs';

export { EntityDescriptorError } from './schemas/entity-descriptor.mjs';
export class EntityRegistryError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'EntityRegistryError';
    this.code = code;
    this.details = details;
  }
}

export const RESERVED_ENTITY_NAMES = new Set([
  'audit', 'schema_migrations', 'platform_modules', 'platform_entities',
  'platform_actions', 'platform_views', 'platform_events', 'platform_settings',
  'platform_sequences', 'platform_audit_log', 'platform_outbox',
]);

export class EntityRegistry {
  constructor(dialect) {
    if (!dialect || typeof dialect.prepare !== 'function') {
      throw new EntityRegistryError('dialect with prepare() is required', 'DIALECT_REQUIRED');
    }
    this.dialect = dialect;
    this.#cache = new Map();
  }

  #cache;
  #now() {
    return new Date().toISOString();
  }

  #assertModuleEnabled(moduleId) {
    const row = this.dialect.prepare('SELECT id, status FROM platform_modules WHERE id = ?').get(moduleId);
    if (!row) {
      throw new EntityRegistryError(`module "${moduleId}" is not installed`, 'MODULE_NOT_FOUND', { moduleId });
    }
    if (row.status !== 'enabled') {
      throw new EntityRegistryError(`module "${moduleId}" is not enabled`, 'MODULE_NOT_ENABLED', { moduleId, status: row.status });
    }
  }

  register(descriptor, actor = 'system') {
    const normalized = normalizeDescriptor(descriptor);
    if (RESERVED_ENTITY_NAMES.has(normalized.id)) {
      throw new EntityRegistryError(`entity name "${normalized.id}" is reserved`, 'RESERVED_NAME', { entityId: normalized.id });
    }
    this.#assertModuleEnabled(normalized.module_id);

    const row = descriptorToRow(normalized);
    this.dialect.exec('BEGIN IMMEDIATE;');
    try {
      this.dialect.prepare(`
        INSERT INTO platform_entities (
          id, module_id, storage_owner, primary_key, label_ar, label_en, section,
          sequence, seq_field, chatter, acl, status_key, fields, relations, scope,
          lifecycle_policy, query_policy, action_policy, customization_policy,
          history_policy, api_exposed, migration_owner, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          module_id = excluded.module_id,
          storage_owner = excluded.storage_owner,
          primary_key = excluded.primary_key,
          label_ar = excluded.label_ar,
          label_en = excluded.label_en,
          section = excluded.section,
          sequence = excluded.sequence,
          seq_field = excluded.seq_field,
          chatter = excluded.chatter,
          acl = excluded.acl,
          status_key = excluded.status_key,
          fields = excluded.fields,
          relations = excluded.relations,
          scope = excluded.scope,
          lifecycle_policy = excluded.lifecycle_policy,
          query_policy = excluded.query_policy,
          action_policy = excluded.action_policy,
          customization_policy = excluded.customization_policy,
          history_policy = excluded.history_policy,
          api_exposed = excluded.api_exposed,
          migration_owner = excluded.migration_owner,
          updated_at = excluded.updated_at
      `).run(
        row.id, row.module_id, row.storage_owner, row.primary_key, row.label_ar, row.label_en, row.section,
        row.sequence, row.seq_field, row.chatter, row.acl, row.status_key, row.fields, row.relations, row.scope,
        row.lifecycle_policy, row.query_policy, row.action_policy, row.customization_policy,
        row.history_policy, row.api_exposed, row.migration_owner,
        this.#now(), this.#now()
      );
      this.dialect.prepare(`
        INSERT INTO platform_audit_log (
          id, actor_id, actor_type, action, resource, resource_id, occurred_at, source_channel, result
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(), actor, 'user', 'entity.register', 'platform_entities', normalized.id,
        this.#now(), 'registry', 'success'
      );
      this.dialect.exec('COMMIT;');
    } catch (error) {
      this.dialect.exec('ROLLBACK;');
      throw error;
    }
    this.#cache.set(normalized.id, normalized);
    return normalized;
  }

  get(entityId) {
    if (this.#cache.has(entityId)) return this.#cache.get(entityId);
    const row = this.dialect.prepare('SELECT * FROM platform_entities WHERE id = ?').get(entityId);
    if (!row) return null;
    const descriptor = rowToDescriptor(row);
    this.#cache.set(entityId, descriptor);
    return descriptor;
  }

  list() {
    const rows = this.dialect.prepare('SELECT * FROM platform_entities ORDER BY id').all();
    return rows.map((row) => rowToDescriptor(row));
  }

  listByModule(moduleId) {
    const rows = this.dialect.prepare('SELECT * FROM platform_entities WHERE module_id = ? ORDER BY id').all(moduleId);
    return rows.map((row) => rowToDescriptor(row));
  }

  unregister(entityId, actor = 'system') {
    const row = this.dialect.prepare('SELECT id FROM platform_entities WHERE id = ?').get(entityId);
    if (!row) {
      throw new EntityRegistryError(`entity "${entityId}" not found`, 'ENTITY_NOT_FOUND', { entityId });
    }
    this.dialect.exec('BEGIN IMMEDIATE;');
    try {
      this.dialect.prepare('DELETE FROM platform_entities WHERE id = ?').run(entityId);
      this.dialect.prepare(`
        INSERT INTO platform_audit_log (
          id, actor_id, actor_type, action, resource, resource_id, occurred_at, source_channel, result
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(), actor, 'user', 'entity.unregister', 'platform_entities', entityId,
        this.#now(), 'registry', 'success'
      );
      this.dialect.exec('COMMIT;');
    } catch (error) {
      this.dialect.exec('ROLLBACK;');
      throw error;
    }
    this.#cache.delete(entityId);
    return { id: entityId, unregistered: true };
  }

  loadFromFile(filePath, actor = 'system') {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const results = [];
    for (const descriptor of Object.values(raw)) {
      results.push(this.register(descriptor, actor));
    }
    return results;
  }

  clearCache() {
    this.#cache.clear();
  }
}

export function defaultEntitiesPath() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'default-entities.json');
}

export function loadDefaultEntities() {
  return JSON.parse(fs.readFileSync(defaultEntitiesPath(), 'utf8'));
}
