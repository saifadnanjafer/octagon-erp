// Cutover report generator — Checkpoint I6.
//
// Generates structured audit summaries for cutover batches, source lineage,
// quarantine, reconciliation, and staged activation readiness.

'use strict';

import { getCutoverBatch } from './batch-engine.mjs';
import { getSourceInventorySummary } from './source-inventory.mjs';
import { listBatchLineage } from './lineage.mjs';
import { getQuarantineRegister } from './quarantine.mjs';
import { reconcileAll } from './reconciliation.mjs';
import { assessStagedActivationReadiness } from './staged-activation.mjs';

export function generateCutoverSummaryReport(dialect, batchId, { dbPath = null, env = process.env } = {}) {
  const batch = getCutoverBatch(dialect, batchId);
  if (!batch) return null;

  const invSummary = getSourceInventorySummary(dialect, batchId);
  const lineage = listBatchLineage(dialect, batchId);
  const quarantine = getQuarantineRegister(dialect, { batchId });
  const reconciliation = reconcileAll(dialect, batchId);
  const readiness = assessStagedActivationReadiness(dialect, batchId, { dbPath, env });

  return {
    batch,
    inventorySummary: invSummary,
    lineageCount: lineage.length,
    quarantineCount: quarantine.length,
    reconciliation,
    readiness,
    generatedAt: new Date().toISOString(),
  };
}
