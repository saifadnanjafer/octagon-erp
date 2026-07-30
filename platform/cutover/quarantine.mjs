// Quarantine engine — Checkpoint I5A.
//
// Governed storage for records explicitly NOT migrated or requiring review.

'use strict';

import crypto from 'node:crypto';

export function quarantineRecord(dialect, {
  batchId,
  companyId = 'co_1781973993479_57h1z8',
  sourceSystem = 'octagon_legacy_json',
  sourceCollection,
  sourceId,
  sourceHash = null,
  sourcePayload,
  domain = null,
  reasonCode,
  reasonDetail = null,
  severity = 'blocking',
  proposedResolution = null,
  selectedCanonicalReplacement = null,
  actor = 'system',
} = {}) {
  if (!batchId || !sourceCollection || !sourceId || !reasonCode || !sourcePayload) {
    throw new TypeError('quarantineRecord requires batchId, sourceCollection, sourceId, reasonCode, and sourcePayload');
  }

  const now = new Date().toISOString();
  const quarantineId = `cq_${crypto.randomBytes(8).toString('hex')}`;
  const payloadStr = typeof sourcePayload === 'string' ? sourcePayload : JSON.stringify(sourcePayload);
  const hash = sourceHash || crypto.createHash('sha256').update(payloadStr).digest('hex');

  const detail = proposedResolution
    ? `${reasonDetail || ''} [Proposed Resolution: ${proposedResolution}]${selectedCanonicalReplacement ? ` [Replacement: ${selectedCanonicalReplacement}]` : ''}`.trim()
    : reasonDetail;

  dialect.prepare(`
    INSERT INTO cutover_quarantine (
      id, batch_id, company_id, source_system, source_collection, source_id,
      source_hash, source_payload, domain, reason_code, reason_detail,
      severity, proposed_resolution, resolved, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    ON CONFLICT(batch_id, source_collection, source_id, reason_code) DO UPDATE SET
      source_hash = excluded.source_hash,
      source_payload = excluded.source_payload,
      reason_detail = excluded.reason_detail,
      severity = excluded.severity,
      proposed_resolution = excluded.proposed_resolution
  `).run(
    quarantineId, batchId, companyId, sourceSystem, sourceCollection, sourceId,
    hash, payloadStr, domain, reasonCode, detail, severity, proposedResolution, now
  );

  // Update domain progress count
  if (domain) {
    dialect.prepare(`
      UPDATE cutover_batch_domains
      SET quarantined_count = (
        SELECT COUNT(DISTINCT source_id) FROM cutover_quarantine
        WHERE batch_id = ? AND domain = ?
      ), updated_at = ?
      WHERE batch_id = ? AND domain = ?
    `).run(batchId, domain, now, batchId, domain);
  }

  return quarantineId;
}

export function getQuarantineRegister(dialect, { batchId = null, domain = null, reasonCode = null } = {}) {
  let sql = 'SELECT * FROM cutover_quarantine WHERE 1=1';
  const params = [];

  if (batchId) {
    sql += ' AND batch_id = ?';
    params.push(batchId);
  }
  if (domain) {
    sql += ' AND domain = ?';
    params.push(domain);
  }
  if (reasonCode) {
    sql += ' AND reason_code = ?';
    params.push(reasonCode);
  }

  sql += ' ORDER BY created_at DESC';
  return dialect.prepare(sql).all(...params);
}
