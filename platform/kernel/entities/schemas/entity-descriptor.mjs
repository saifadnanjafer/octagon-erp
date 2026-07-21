// Entity descriptor schema and validation.
//
// Source composition:
// - VNext 101_r1_lane_a_tables collection_registry + field_registry
//   (project-owned) used as the behavioral base for the legacy-style entity
//   definition (fields as object, sequence, status_key, acl, chatter).
// - NocoBase collection.ts / field.ts (clean-room reference) for the separation
//   between entity metadata, fields, and relations.
// - Frappe meta.py (MIT reference) for label/localization and required fields.
//
// The target descriptor extends the legacy file format with governance metadata
// (scope, lifecycle_policy, query_policy, action_policy, customization_policy,
// history_policy, migration_owner) and a relation map.

'use strict';

export const ENTITY_ID_RE = /^[a-z][a-z0-9_]{1,63}$/;
export const FIELD_NAME_RE = /^[a-z_][a-z0-9_]{0,63}$/;

export const ENTITY_SCOPES = ['tenant', 'company', 'branch', 'none'];
export const ENTITY_LIFECYCLE_POLICIES = ['generic', 'state_machine', 'workflow', 'immutable', 'append_only'];
export const ENTITY_QUERY_POLICIES = ['open', 'scoped', 'tenant_scoped'];
export const ENTITY_ACTION_POLICIES = ['registered', 'generic', 'none'];
export const ENTITY_CUSTOMIZATION_POLICIES = ['metadata', 'code', 'none'];
export const ENTITY_HISTORY_POLICIES = ['audit', 'none', 'full'];
export const ENTITY_FIELD_TYPES = ['text', 'number', 'integer', 'boolean', 'date', 'datetime', 'select', 'multiselect', 'textarea', 'richtext', 'email', 'phone', 'url', 'reference', 'attachment'];
export const RELATION_TYPES = ['belongs_to', 'has_one', 'has_many', 'many_to_many'];
export const RELATION_CARDINALITIES = ['one', 'many'];

export class EntityDescriptorError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'EntityDescriptorError';
    this.code = code;
    this.details = details;
  }
}

export function normalizeField(fieldId, spec) {
  if (typeof spec === 'string') {
    spec = { type: spec };
  }
  if (!spec || typeof spec !== 'object') {
    throw new EntityDescriptorError(`field "${fieldId}" must be an object or type string`, 'FIELD_INVALID', { fieldId });
  }
  if (!spec.type || !ENTITY_FIELD_TYPES.includes(spec.type)) {
    throw new EntityDescriptorError(`field "${fieldId}" has unsupported type "${spec.type}"`, 'FIELD_INVALID_TYPE', { fieldId, type: spec.type });
  }
  return {
    id: fieldId,
    type: spec.type,
    label_ar: spec.label_ar || spec.label || fieldId,
    label_en: spec.label_en || spec.label || fieldId,
    required: spec.required === true,
    options: Array.isArray(spec.options) ? spec.options : null,
    default: spec.default !== undefined ? spec.default : null,
    validation: spec.validation || null,
  };
}

export function normalizeRelation(name, spec) {
  if (!spec || typeof spec !== 'object') {
    throw new EntityDescriptorError(`relation "${name}" must be an object`, 'RELATION_INVALID', { relation: name });
  }
  if (!spec.target || !ENTITY_ID_RE.test(spec.target)) {
    throw new EntityDescriptorError(`relation "${name}" target must be a valid entity id`, 'RELATION_INVALID_TARGET', { relation: name, target: spec.target });
  }
  const type = spec.type || 'belongs_to';
  if (!RELATION_TYPES.includes(type)) {
    throw new EntityDescriptorError(`relation "${name}" has unsupported type "${type}"`, 'RELATION_INVALID_TYPE', { relation: name, type });
  }
  const cardinality = spec.cardinality || (type === 'has_many' || type === 'many_to_many' ? 'many' : 'one');
  if (!RELATION_CARDINALITIES.includes(cardinality)) {
    throw new EntityDescriptorError(`relation "${name}" has unsupported cardinality "${cardinality}"`, 'RELATION_INVALID_CARDINALITY', { relation: name, cardinality });
  }
  if (!spec.foreign_key || !FIELD_NAME_RE.test(spec.foreign_key)) {
    throw new EntityDescriptorError(`relation "${name}" foreign_key must be a valid field name`, 'RELATION_INVALID_FOREIGN_KEY', { relation: name, foreign_key: spec.foreign_key });
  }
  return {
    name,
    type,
    target: spec.target,
    foreign_key: spec.foreign_key,
    cardinality,
    inverse: spec.inverse || null,
    required: spec.required === true,
  };
}

export function normalizeDescriptor(input) {
  if (!input || typeof input !== 'object') {
    throw new EntityDescriptorError('descriptor must be a non-null object', 'DESCRIPTOR_INVALID');
  }
  const id = input.id || input.collection;
  if (!id || !ENTITY_ID_RE.test(id)) {
    throw new EntityDescriptorError(`entity id must match ${ENTITY_ID_RE}`, 'DESCRIPTOR_INVALID_ID', { id });
  }
  if (!input.module_id || !ENTITY_ID_RE.test(input.module_id)) {
    throw new EntityDescriptorError('module_id is required and must be a valid module id', 'DESCRIPTOR_MISSING_MODULE', { module_id: input.module_id });
  }
  if (!input.storage_owner || typeof input.storage_owner !== 'string') {
    throw new EntityDescriptorError('storage_owner is required', 'DESCRIPTOR_MISSING_STORAGE_OWNER');
  }
  if (!input.primary_key || !FIELD_NAME_RE.test(input.primary_key)) {
    throw new EntityDescriptorError('primary_key is required and must be a valid field name', 'DESCRIPTOR_MISSING_PRIMARY_KEY', { primary_key: input.primary_key });
  }
  if (!input.label_ar || typeof input.label_ar !== 'string') {
    throw new EntityDescriptorError('label_ar is required', 'DESCRIPTOR_MISSING_LABEL_AR');
  }

  const scope = input.scope || 'company';
  if (!ENTITY_SCOPES.includes(scope)) {
    throw new EntityDescriptorError(`scope must be one of ${ENTITY_SCOPES.join(', ')}`, 'DESCRIPTOR_INVALID_SCOPE', { scope });
  }
  const lifecyclePolicy = input.lifecycle_policy || 'generic';
  if (!ENTITY_LIFECYCLE_POLICIES.includes(lifecyclePolicy)) {
    throw new EntityDescriptorError(`lifecycle_policy must be one of ${ENTITY_LIFECYCLE_POLICIES.join(', ')}`, 'DESCRIPTOR_INVALID_LIFECYCLE', { lifecycle_policy: lifecyclePolicy });
  }
  const queryPolicy = input.query_policy || 'scoped';
  if (!ENTITY_QUERY_POLICIES.includes(queryPolicy)) {
    throw new EntityDescriptorError(`query_policy must be one of ${ENTITY_QUERY_POLICIES.join(', ')}`, 'DESCRIPTOR_INVALID_QUERY_POLICY', { query_policy: queryPolicy });
  }
  const actionPolicy = input.action_policy || 'registered';
  if (!ENTITY_ACTION_POLICIES.includes(actionPolicy)) {
    throw new EntityDescriptorError(`action_policy must be one of ${ENTITY_ACTION_POLICIES.join(', ')}`, 'DESCRIPTOR_INVALID_ACTION_POLICY', { action_policy: actionPolicy });
  }
  const customizationPolicy = input.customization_policy || 'metadata';
  if (!ENTITY_CUSTOMIZATION_POLICIES.includes(customizationPolicy)) {
    throw new EntityDescriptorError(`customization_policy must be one of ${ENTITY_CUSTOMIZATION_POLICIES.join(', ')}`, 'DESCRIPTOR_INVALID_CUSTOMIZATION_POLICY', { customization_policy: customizationPolicy });
  }
  const historyPolicy = input.history_policy || 'audit';
  if (!ENTITY_HISTORY_POLICIES.includes(historyPolicy)) {
    throw new EntityDescriptorError(`history_policy must be one of ${ENTITY_HISTORY_POLICIES.join(', ')}`, 'DESCRIPTOR_INVALID_HISTORY_POLICY', { history_policy: historyPolicy });
  }

  const fields = {};
  const rawFields = input.fields || {};
  if (typeof rawFields !== 'object' || Array.isArray(rawFields)) {
    throw new EntityDescriptorError('fields must be an object', 'DESCRIPTOR_INVALID_FIELDS');
  }
  for (const [fieldId, spec] of Object.entries(rawFields)) {
    if (!FIELD_NAME_RE.test(fieldId)) {
      throw new EntityDescriptorError(`field name "${fieldId}" is invalid`, 'FIELD_INVALID_NAME', { fieldId });
    }
    fields[fieldId] = normalizeField(fieldId, spec);
  }
  if (!fields[input.primary_key]) {
    fields[input.primary_key] = normalizeField(input.primary_key, { type: 'text', label_ar: 'المعرف', required: true });
  }

  const relations = {};
  const rawRelations = input.relations || {};
  for (const [name, spec] of Object.entries(rawRelations)) {
    if (!FIELD_NAME_RE.test(name)) {
      throw new EntityDescriptorError(`relation name "${name}" is invalid`, 'RELATION_INVALID_NAME', { relation: name });
    }
    relations[name] = normalizeRelation(name, spec);
  }

  return {
    id,
    module_id: input.module_id,
    storage_owner: input.storage_owner,
    primary_key: input.primary_key,
    label_ar: input.label_ar,
    label_en: input.label_en || input.label_ar,
    section: input.section || null,
    sequence: input.sequence || null,
    seq_field: input.seq_field || 'seq',
    chatter: input.chatter === true,
    acl: input.acl || `${input.module_id}:${id}`,
    status_key: input.status_key || 'status',
    fields,
    relations,
    scope,
    lifecycle_policy: lifecyclePolicy,
    query_policy: queryPolicy,
    action_policy: actionPolicy,
    customization_policy: customizationPolicy,
    history_policy: historyPolicy,
    api_exposed: input.api_exposed !== false,
    migration_owner: input.migration_owner || input.module_id,
    meta: input.meta || null,
  };
}

export function descriptorToRow(descriptor) {
  return {
    id: descriptor.id,
    module_id: descriptor.module_id,
    storage_owner: descriptor.storage_owner,
    primary_key: descriptor.primary_key,
    label_ar: descriptor.label_ar,
    label_en: descriptor.label_en,
    section: descriptor.section,
    sequence: descriptor.sequence,
    seq_field: descriptor.seq_field,
    chatter: descriptor.chatter ? 1 : 0,
    acl: descriptor.acl,
    status_key: descriptor.status_key,
    fields: JSON.stringify(descriptor.fields),
    relations: JSON.stringify(descriptor.relations),
    scope: descriptor.scope,
    lifecycle_policy: descriptor.lifecycle_policy,
    query_policy: descriptor.query_policy,
    action_policy: descriptor.action_policy,
    customization_policy: descriptor.customization_policy,
    history_policy: descriptor.history_policy,
    api_exposed: descriptor.api_exposed ? 1 : 0,
    migration_owner: descriptor.migration_owner,
  };
}

export function rowToDescriptor(row) {
  return normalizeDescriptor({
    id: row.id,
    module_id: row.module_id,
    storage_owner: row.storage_owner,
    primary_key: row.primary_key,
    label_ar: row.label_ar,
    label_en: row.label_en,
    section: row.section,
    sequence: row.sequence,
    seq_field: row.seq_field,
    chatter: row.chatter === 1 || row.chatter === true,
    acl: row.acl,
    status_key: row.status_key,
    fields: JSON.parse(row.fields || '{}'),
    relations: JSON.parse(row.relations || '{}'),
    scope: row.scope,
    lifecycle_policy: row.lifecycle_policy,
    query_policy: row.query_policy,
    action_policy: row.action_policy,
    customization_policy: row.customization_policy,
    history_policy: row.history_policy,
    api_exposed: row.api_exposed === 1 || row.api_exposed === true,
    migration_owner: row.migration_owner,
  });
}

export function validateDescriptor(input) {
  normalizeDescriptor(input);
  return true;
}
