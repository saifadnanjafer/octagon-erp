// Lineage engine — Checkpoint I5A.
//
// Governed provenance mapping between legacy source records and canonical target tables.

'use strict';

import crypto from 'node:crypto';

export function recordLineage(dialect, {
  batchId,
  companyId = 'co_1781973993479_57h1z8',
  branchId = null,
  sourceSystem = 'octagon_legacy_json',
  sourceCollection,
  sourceId,
  sourceHash,
  destinationAuthority,
  destinationTable,
  destinationId,
  migrationStatus = 'migrated',
  executingModel = 'Gemini 3.6 Flash',
  actor = 'system',
  notes = null,
} = {}) {
  if (!batchId || !sourceCollection || !sourceId || !sourceHash || !destinationAuthority || !destinationTable || !destinationId) {
    throw new TypeError('recordLineage requires batchId, sourceCollection, sourceId, sourceHash, destinationAuthority, destinationTable, and destinationId');
  }

  const now = new Date().toISOString();
  const lineageId = `lin_${crypto.randomBytes(8).toString('hex')}`;

  dialect.prepare(`
    INSERT INTO cutover_lineage (
      id, batch_id, company_id, branch_id, source_system, source_collection,
      source_id, source_hash, destination_authority, destination_table,
      destination_id, migration_status, reconciliation_status, executing_model,
      actor, migrated_at, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
    ON CONFLICT(batch_id, source_collection, source_id) DO UPDATE SET
      source_hash = excluded.source_hash,
      destination_authority = excluded.destination_authority,
      destination_table = excluded.destination_table,
      destination_id = excluded.destination_id,
      migration_status = excluded.migration_status,
      migrated_at = excluded.migrated_at,
      notes = excluded.notes
  `).run(
    lineageId, batchId, companyId, branchId, sourceSystem, sourceCollection,
    sourceId, sourceHash, destinationAuthority, destinationTable,
    destinationId, migrationStatus, executingModel, actor, now, notes
  );

  return lineageId;
}

export function getLineageBySource(dialect, batchId, sourceCollection, sourceId) {
  return dialect.prepare(`
    SELECT * FROM cutover_lineage
    WHERE batch_id = ? AND source_collection = ? AND source_id = ?
  `).get(batchId, sourceCollection, sourceId) || null;
}

export function getLineageByDestination(dialect, destinationTable, destinationId) {
  return dialect.prepare(`
    SELECT * FROM cutover_lineage
    WHERE destination_table = ? AND destination_id = ?
  `).get(destinationTable, destinationId) || null;
}

export function listBatchLineage(dialect, batchId) {
  return dialect.prepare('SELECT * FROM cutover_lineage WHERE batch_id = ? ORDER BY migrated_at ASC').all(batchId);
}
