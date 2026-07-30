// tests/module-wave-2/grc/grc.test.mjs — Integration tests for W2-M11 GRC.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../../database/migration-runner/index.mjs';
import { migration as m077 } from '../../../database/migrations/077_grc_and_internal_audit.mjs';
import * as grcService from '../../../platform/domains/grc/service.mjs';

function tmp(n) { return path.join(os.tmpdir(), `octagon-grc-${n}-${Date.now()}-${process.pid}.db`); }

async function setup(name) {
  const p = tmp(name);
  await freshInstall({ dbPath: p });
  const db = openMigrationDatabase(p);
  return { db, path: p };
}

function cleanup(env) {
  env.db.close();
  for (const s of ['', '-wal', '-shm']) {
    try { if (fs.existsSync(env.path + s)) fs.unlinkSync(env.path + s); } catch {}
  }
}

test('1. Migration 077: Up, rerun, and schema verification', async () => {
  const env = await setup('m077-schema');
  try {
    await m077.up(env.db);

    const tables = env.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name IN ('grc_risk_registers', 'grc_risk_mitigations', 'grc_compliance_controls', 'grc_internal_audits', 'grc_audit_findings')
    `).all().map(r => r.name);

    assert.equal(tables.length, 5);

    // Rerun check
    await m077.up(env.db);
  } finally {
    cleanup(env);
  }
});

test('2. Risk Register & Matrix Score Calculation', async () => {
  const env = await setup('risk-score');
  try {
    await m077.up(env.db);

    // Likelihood 5 * Impact 4 = 20 -> 'critical'
    const rskCritical = grcService.createRisk(env.db, {
      company_id: 'company-alpha',
      title: 'Unencrypted Offshore Data Transfer Risk',
      category: 'IT',
      likelihood_rating: 5,
      impact_rating: 4,
      risk_owner_id: 'ciso-admin'
    });

    assert.equal(rskCritical.risk_score, 20);
    assert.equal(rskCritical.risk_level, 'critical');
    assert.ok(rskCritical.risk_number.startsWith('RSK-2026-'));

    // Likelihood 2 * Impact 2 = 4 -> 'low'
    const rskLow = grcService.createRisk(env.db, {
      company_id: 'company-alpha',
      title: 'Office Stationery Shortage',
      category: 'operational',
      likelihood_rating: 2,
      impact_rating: 2,
      risk_owner_id: 'office-mgr'
    });

    assert.equal(rskLow.risk_score, 4);
    assert.equal(rskLow.risk_level, 'low');
  } finally {
    cleanup(env);
  }
});

test('3. Compliance Control Testing & Audit Finding Logging', async () => {
  const env = await setup('audit-test');
  try {
    await m077.up(env.db);

    const fw = grcService.createComplianceFramework(env.db, {
      company_id: 'company-alpha',
      code: 'ISO-27001',
      name: 'Information Security Management System',
      version: '2022'
    });

    const ctrl = grcService.createControl(env.db, {
      company_id: 'company-alpha',
      framework_id: fw.id,
      control_code: 'A.9.2.1',
      title: 'User Access Provisioning and Deprovisioning',
      control_type: 'preventive',
      control_owner_id: 'iam-lead'
    });

    const evaluation = grcService.evaluateControl(env.db, {
      company_id: 'company-alpha',
      control_id: ctrl.id,
      result: 'partially_effective',
      evidence_notes: 'Terminated employee access revoked with 24-hour delay in 2 out of 50 sampled cases',
      tester_id: 'auditor-02'
    });
    assert.equal(evaluation.result, 'partially_effective');

    const audit = grcService.createInternalAudit(env.db, {
      company_id: 'company-alpha',
      title: 'Q2 2026 IT Security & Access Control Audit',
      scope: 'User Offboarding & Access Logs',
      lead_auditor_id: 'auditor-lead',
      start_date: '2026-06-01',
      end_date: '2026-06-15'
    });
    assert.ok(audit.audit_number.startsWith('AUD-2026-'));

    const finding = grcService.logAuditFinding(env.db, {
      company_id: 'company-alpha',
      audit_id: audit.id,
      title: 'Delayed Access Revocation for Terminated Personnel',
      severity: 'high',
      description: 'System offboarding checklist not automatically triggered upon HR termination event',
      recommendation: 'Integrate HRIS webhook directly into IAM directory',
      target_closure_date: '2026-08-30'
    });
    assert.equal(finding.severity, 'high');
    assert.ok(finding.finding_number.startsWith('FND-2026-'));
  } finally {
    cleanup(env);
  }
});
