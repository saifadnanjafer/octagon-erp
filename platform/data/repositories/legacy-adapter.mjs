// Legacy JSON collection adapter — Phase 01 compatibility.
//
// Source composition:
// - Octagon legacy RecordService (browser-side, project-owned) used as the
//   behavioral reference for collection-path nesting and audit-field shape.
// - VNext LegacyEntityAdapter.mjs (project-owned) used as the salvage base for
//   read-only bridging between legacy JSON collections and the new repository.
//
// Responsibilities:
//   - read legacy JSON collection files (e.g. database.json fragments) without
//     mutating the legacy store
//   - present legacy records using the same document shape as x_records
//   - allow migration scripts to compare legacy data before canonical migration
//   - never perform generic create/update/delete on legacy data

'use strict';

import fs from 'node:fs';

export class LegacyAdapterError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'LegacyAdapterError';
    this.code = code;
    this.details = details;
  }
}

export function readLegacyCollection(filePath, collectionPath) {
  if (!fs.existsSync(filePath)) {
    throw new LegacyAdapterError(`legacy file not found: ${filePath}`, 'LEGACY_FILE_NOT_FOUND', { filePath });
  }
  let db;
  try {
    db = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new LegacyAdapterError(`legacy file is not valid JSON: ${error.message}`, 'LEGACY_FILE_INVALID', { filePath });
  }

  const parts = String(collectionPath || '').split('.').filter(Boolean);
  let cursor = db;
  for (let i = 0; i < parts.length; i += 1) {
    const key = parts[i];
    if (cursor === null || typeof cursor !== 'object') {
      return [];
    }
    cursor = cursor[key];
  }
  if (!Array.isArray(cursor)) return [];
  return cursor.map((record) => legacyToDoc(record));
}

export function getLegacyRecord(filePath, collectionPath, recordId) {
  const records = readLegacyCollection(filePath, collectionPath);
  return records.find((record) => String(record.id) === String(recordId)) || null;
}

export function legacyToDoc(record) {
  if (!record || typeof record !== 'object') return null;
  return {
    ...record,
    id: record.id || null,
    company_id: null,
    created_at: record.created_at || null,
    updated_at: record.updated_at || null,
    created_by: record.created_by || record.updated_by || 'legacy',
    removed: record.is_active === false ? 1 : 0,
    version: 1,
    _legacy: true,
  };
}

export class LegacyCollectionAdapter {
  constructor(filePath, collectionPath) {
    this.filePath = filePath;
    this.collectionPath = collectionPath;
  }

  list() {
    return readLegacyCollection(this.filePath, this.collectionPath);
  }

  read(recordId) {
    return getLegacyRecord(this.filePath, this.collectionPath, recordId);
  }

  // Legacy data is read-only through the adapter. Writes must go through the
  // canonical repository after explicit migration/authorization.
  create() {
    throw new LegacyAdapterError('legacy adapter is read-only', 'LEGACY_READ_ONLY');
  }

  update() {
    throw new LegacyAdapterError('legacy adapter is read-only', 'LEGACY_READ_ONLY');
  }

  delete() {
    throw new LegacyAdapterError('legacy adapter is read-only', 'LEGACY_READ_ONLY');
  }
}

export function createLegacyAdapter(filePath, collectionPath) {
  return new LegacyCollectionAdapter(filePath, collectionPath);
}
