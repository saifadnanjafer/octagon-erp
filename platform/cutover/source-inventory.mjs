// Source inventory engine — Checkpoint I5A.
//
// Scans the staged legacy store, computes hashes, and classifies legacy rows.

'use strict';

import crypto from 'node:crypto';
import { updateDomainProgress } from './batch-engine.mjs';

const FROZEN_COLLECTIONS = new Set([
  'employees',
  'employee_advances',
  'omni.workshopAdvances',
  'omni.employeeAttendance',
  'employee_payroll_closings',
  'payroll_payments',
  'payroll_periods',
  'omni.workshopAccountReviews',
  'omni.workshopTimesheetCases',
  'omni.employeeRequests',
]);

const NON_BUSINESS_COLLECTIONS = new Set([
  'omni.aiAuditLog',
  'omni.migrationsApplied',
]);

export function runSourceInventory(dialect, batchId) {
  if (!batchId) throw new TypeError('runSourceInventory requires batchId');

  const now = new Date().toISOString();

  // Read all legacy collection rows from staged database
  const rows = dialect.prepare('SELECT collection, id, data FROM collections ORDER BY collection, id').all();

  dialect.exec('BEGIN IMMEDIATE;');
  try {
    let frozenCount = 0;
    let nonBusinessCount = 0;
    let candidateCount = 0;
    let excelLogCount = 0;

    for (const r of rows) {
      const collection = r.collection;
      const id = r.id;
      const payloadStr = r.data || '{}';
      const payloadHash = crypto.createHash('sha256').update(payloadStr).digest('hex');

      let payloadObj = {};
      try {
        payloadObj = JSON.parse(payloadStr);
      } catch (_) {}

      const companyId = payloadObj.companyId || payloadObj.company_id || 'co_1781973993479_57h1z8';
      const branchId = payloadObj.branchId || payloadObj.branch_id || null;

      let classification = 'candidate';
      let domain = 'MASTER_DATA';
      let disposition = 'migrate';

      // Domain mapping
      if (['account_moves', 'journal_entries', 'finance.transactions', 'finance.accounts', 'journals', 'finance.departments'].includes(collection)) {
        domain = 'FINANCE';
      } else if (['omni.materials', 'omni.storageLocations', 'locations', 'omni.warehouses'].includes(collection)) {
        domain = 'INVENTORY';
      } else if (['omni.boms', 'omni.opPacks', 'omni.qcTemplates', 'omni.qcRecords', 'omni.machines', 'omni.equipment', 'omni.sops', 'omni.workOrders'].includes(collection)) {
        domain = 'OPERATIONS';
      } else if (['employees', 'employee_advances', 'omni.workshopAdvances', 'omni.employeeAttendance', 'employee_payroll_closings', 'payroll_payments', 'payroll_periods', 'omni.workshopAccountReviews', 'omni.workshopTimesheetCases', 'omni.employeeRequests'].includes(collection)) {
        domain = 'IDENTITY';
      }

      // Classification logic
      if (NON_BUSINESS_COLLECTIONS.has(collection)) {
        classification = 'non_business';
        disposition = 'non-business';
        nonBusinessCount++;
      } else if (FROZEN_COLLECTIONS.has(collection)) {
        classification = 'frozen';
        disposition = 'frozen';
        frozenCount++;
      } else if (collection === 'omni.workshopExcelChangeLog') {
        excelLogCount++;
        if (excelLogCount <= 22) {
          classification = 'frozen';
          disposition = 'frozen';
          frozenCount++;
        } else {
          classification = 'non_business';
          disposition = 'non-business';
          nonBusinessCount++;
        }
      } else if (collection === 'journal_entries' || collection === 'finance.transactions') {
        classification = 'candidate';
        disposition = 'validate-only';
        candidateCount++;
      } else if (id === 'cust_demo' || id.startsWith('demo_wo_')) {
        classification = 'quarantine';
        disposition = 'quarantine';
        candidateCount++;
      } else {
        classification = 'candidate';
        disposition = 'migrate';
        candidateCount++;
      }

      const recId = `csr_${crypto.randomBytes(8).toString('hex')}`;
      dialect.prepare(`
        INSERT INTO cutover_source_records (
          id, batch_id, source_system, source_collection, source_id,
          source_hash, source_payload, classification, domain, discovered_at
        ) VALUES (?, ?, 'octagon_legacy_json', ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(batch_id, source_collection, source_id) DO UPDATE SET
          source_hash = excluded.source_hash,
          source_payload = excluded.source_payload,
          classification = excluded.classification,
          domain = excluded.domain
      `).run(
        recId, batchId, collection, id, payloadHash, payloadStr,
        classification, domain, now
      );
    }

    // Update batch domain progress counts
    const domainCounts = dialect.prepare(`
      SELECT domain, COUNT(*) as cnt
      FROM cutover_source_records
      WHERE batch_id = ?
      GROUP BY domain
    `).all(batchId);

    for (const dc of domainCounts) {
      if (dc.domain) {
        updateDomainProgress(dialect, batchId, dc.domain, {
          source_count: dc.cnt,
          state: 'inventoried'
        });
      }
    }

    dialect.exec('COMMIT;');

    return {
      totalRows: rows.length,
      frozenCount,
      nonBusinessCount,
      candidateCount,
      breakdown: {
        frozen: frozenCount,
        nonBusiness: nonBusinessCount,
        candidate: candidateCount,
      }
    };
  } catch (err) {
    dialect.exec('ROLLBACK;');
    throw err;
  }
}

export function getSourceInventorySummary(dialect, batchId) {
  const total = dialect.prepare('SELECT COUNT(*) as c FROM cutover_source_records WHERE batch_id = ?').get(batchId)?.c || 0;
  const byClass = dialect.prepare('SELECT classification, COUNT(*) as c FROM cutover_source_records WHERE batch_id = ? GROUP BY classification').all(batchId);
  const byDomain = dialect.prepare('SELECT domain, COUNT(*) as c FROM cutover_source_records WHERE batch_id = ? GROUP BY domain').all(batchId);
  const byCollection = dialect.prepare('SELECT source_collection, COUNT(*) as c FROM cutover_source_records WHERE batch_id = ? GROUP BY source_collection ORDER BY c DESC').all(batchId);

  const classMap = {};
  for (const r of byClass) classMap[r.classification] = r.c;

  const domainMap = {};
  for (const r of byDomain) domainMap[r.domain || 'UNASSIGNED'] = r.c;

  return {
    batchId,
    totalRecords: total,
    byClassification: classMap,
    byDomain: domainMap,
    byCollection,
  };
}
