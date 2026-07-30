// Cutover batch engine — Checkpoint I5A.
//
// Manages cutover batches, domain progress, and safety assertions.

'use strict';

import crypto from 'node:crypto';
import { assessSafetyGuards, CutoverError } from './canonical-cutover-controller.mjs';

export const ALL_DOMAINS = ['IDENTITY', 'MASTER_DATA', 'INVENTORY', 'FINANCE', 'OPERATIONS'];

export function createCutoverBatch(dialect, {
  companyId = 'co_1781973993479_57h1z8',
  branchId = null,
  label = 'Staged Legacy Migration Batch',
  sourceSystem = 'octagon_legacy_json',
  actor = 'system',
  executingModel = 'Gemini 3.6 Flash',
  dbPath = null,
  env = process.env,
  notes = null,
} = {}) {
  const safety = assessSafetyGuards({ dbPath, env });
  if (!safety.allPassed) {
    throw new CutoverError(
      `Cannot create cutover batch: safety guards failed (${safety.failed.join(', ')})`,
      'CUTOVER_SAFETY_GUARD_FAILED',
      { safety }
    );
  }

  const now = new Date().toISOString();
  const batchId = `cut_batch_${crypto.randomBytes(6).toString('hex')}`;

  dialect.exec('BEGIN IMMEDIATE;');
  try {
    dialect.prepare(`
      INSERT INTO cutover_batches (
        id, company_id, branch_id, label, source_system, is_staged, state,
        executing_model, actor, created_at, updated_at, notes
      ) VALUES (?, ?, ?, ?, ?, 1, 'draft', ?, ?, ?, ?, ?)
    `).run(batchId, companyId, branchId, label, sourceSystem, executingModel, actor, now, now, notes);

    for (const domain of ALL_DOMAINS) {
      const domainId = `cbd_${crypto.randomBytes(6).toString('hex')}`;
      dialect.prepare(`
        INSERT INTO cutover_batch_domains (
          id, batch_id, domain, state, source_count, migrated_count, merged_count,
          skipped_count, quarantined_count, updated_at
        ) VALUES (?, ?, ?, 'pending', 0, 0, 0, 0, 0, ?)
      `).run(domainId, batchId, domain, now);
    }

    dialect.exec('COMMIT;');
  } catch (err) {
    dialect.exec('ROLLBACK;');
    throw err;
  }

  return getCutoverBatch(dialect, batchId);
}

export function getCutoverBatch(dialect, batchId) {
  const batch = dialect.prepare('SELECT * FROM cutover_batches WHERE id = ?').get(batchId);
  if (!batch) return null;

  const domains = dialect.prepare('SELECT * FROM cutover_batch_domains WHERE batch_id = ? ORDER BY domain').all(batchId);
  const domainMap = {};
  for (const d of domains) {
    domainMap[d.domain] = d;
  }

  return { ...batch, domains: domainMap };
}

export function updateBatchState(dialect, batchId, state, { notes = null } = {}) {
  const now = new Date().toISOString();
  const completedAt = ['completed', 'reconciled', 'staged_activated'].includes(state) ? now : null;

  dialect.prepare(`
    UPDATE cutover_batches
    SET state = ?, updated_at = ?, completed_at = COALESCE(?, completed_at), notes = COALESCE(?, notes)
    WHERE id = ?
  `).run(state, now, completedAt, notes, batchId);

  return getCutoverBatch(dialect, batchId);
}

export function updateDomainProgress(dialect, batchId, domain, updates = {}) {
  const now = new Date().toISOString();
  const existing = dialect.prepare('SELECT * FROM cutover_batch_domains WHERE batch_id = ? AND domain = ?').get(batchId, domain);
  if (!existing) return null;

  const state = updates.state || existing.state;
  const startedAt = existing.startedAt || (state === 'migrating' ? now : null);
  const completedAt = ['completed', 'reconciled'].includes(state) ? now : existing.completed_at;

  dialect.prepare(`
    UPDATE cutover_batch_domains
    SET state = ?,
        source_count = COALESCE(?, source_count),
        migrated_count = COALESCE(?, migrated_count),
        merged_count = COALESCE(?, merged_count),
        skipped_count = COALESCE(?, skipped_count),
        quarantined_count = COALESCE(?, quarantined_count),
        started_at = COALESCE(?, started_at),
        completed_at = COALESCE(?, completed_at),
        updated_at = ?
    WHERE batch_id = ? AND domain = ?
  `).run(
    state,
    updates.source_count ?? null,
    updates.migrated_count ?? null,
    updates.merged_count ?? null,
    updates.skipped_count ?? null,
    updates.quarantined_count ?? null,
    startedAt,
    completedAt,
    now,
    batchId,
    domain
  );

  return dialect.prepare('SELECT * FROM cutover_batch_domains WHERE batch_id = ? AND domain = ?').get(batchId, domain);
}
