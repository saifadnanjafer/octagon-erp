import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openMigrationDatabase, freshInstall } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';

function tmpDb() {
  return path.join(os.tmpdir(), `octagon-b07a-lifecycle-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

test('BUILD-07A/B Master Data Governance & Data Quality Full Lifecycle', async () => {
  const dbPath = tmpDb();
  await freshInstall({ dbPath });
  const dialect = openMigrationDatabase(dbPath);
  const authority = createPlatformAuthority(dialect);

  const ctx = {
    userId: 'steward-user-1',
    companyId: 'default',
    tenantId: 'default',
  };

  // Seed 2 synthetic parties with duplicate name
  dialect.prepare(`
    INSERT INTO parties (id, company_id, name, created_at, updated_at)
    VALUES ('prt_dup_1', 'default', 'شركة الفرات الوطنية', datetime('now'), datetime('now'))
  `).run();

  dialect.prepare(`
    INSERT INTO parties (id, company_id, name, created_at, updated_at)
    VALUES ('prt_dup_2', 'default', 'شركة الفرات الوطنية', datetime('now'), datetime('now'))
  `).run();

  // 1. Scenario A: MDG Duplicate Candidate Detection & Governed Merge Flow
  const candidates = authority.masterDataGovernanceService.detectDuplicates({ companyId: ctx.companyId, entityType: 'party' }, ctx);
  assert.ok(candidates.length >= 1);
  const cand = candidates[0];
  assert.equal(cand.entityType, 'party');
  assert.ok(cand.confidenceScore >= 0.80);

  const proposal = authority.masterDataGovernanceService.proposeMerge({
    candidateId: cand.id,
    survivingRecordId: 'prt_dup_1',
    mergedRecordId: 'prt_dup_2',
    fieldResolutions: { name: 'prt_dup_1' },
  }, ctx);
  assert.ok(proposal.id);
  assert.equal(proposal.status, 'proposed');

  const approvedMerge = authority.masterDataGovernanceService.approveMerge(proposal.id, ctx);
  assert.equal(approvedMerge.status, 'executed');

  // Verify alias lineage record was generated
  const aliasRow = dialect.prepare('SELECT * FROM x_records WHERE id = ?').get('alias_prt_dup_2');
  assert.ok(aliasRow);
  assert.ok(aliasRow.data.includes('prt_dup_1'));

  // 2. Scenario B: Data Quality Rule Execution & Waiver Approval Flow
  const rule = authority.dataQualityService.publishRule({
    ruleCode: 'DQ_PARTY_NAME_NOT_EMPTY',
    name: 'التحقق من وجود اسم الطرف القومي',
    entityType: 'party',
    dimension: 'completeness',
    severity: 'high',
    conditionExpression: 'name != NULL AND name != ""',
  }, ctx);
  assert.ok(rule.id);

  // Add invalid record
  dialect.prepare(`
    INSERT INTO parties (id, company_id, name, created_at, updated_at)
    VALUES ('prt_invalid_1', 'default', '', datetime('now'), datetime('now'))
  `).run();

  const scanResult = authority.dataQualityService.runScan({ companyId: ctx.companyId, entityType: 'party' }, ctx);
  assert.ok(scanResult.recordsScanned >= 3);
  assert.ok(scanResult.exceptionsFound >= 1);

  const exceptions = authority.dataQualityService.listExceptions({ companyId: ctx.companyId, status: 'open' });
  assert.ok(exceptions.length >= 1);
  const exc = exceptions[0];

  const assignedExc = authority.dataQualityService.assignException(exc.id, 'steward-user-2', '2026-08-30', ctx);
  assert.equal(assignedExc.status, 'in_remediation');

  const waiver = authority.dataQualityService.requestWaiver({
    exceptionId: exc.id,
    reason: 'جهة حكومية مؤقتة بدون اسم رسمي مكتمل',
  }, ctx);
  assert.ok(waiver.id);

  const approvedWaiver = authority.dataQualityService.approveWaiver(waiver.id, ctx);
  assert.equal(approvedWaiver.status, 'approved');

  const updatedExc = authority.dataQualityService.getException(exc.id);
  assert.equal(updatedExc.status, 'waived');

  dialect.close();
  fs.unlinkSync(dbPath);
});
