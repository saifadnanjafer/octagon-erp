// tests/module-wave-2/plm/plm.test.mjs — Integration tests for W2-M10 PLM.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../../database/migration-runner/index.mjs';
import { migration as m076 } from '../../../database/migrations/076_plm_and_engineering_change_control.mjs';
import * as plmService from '../../../platform/domains/plm/service.mjs';

function tmp(n) { return path.join(os.tmpdir(), `octagon-plm-${n}-${Date.now()}-${process.pid}.db`); }

async function setup(name) {
  const p = tmp(name);
  await freshInstall({ dbPath: p });
  const db = openMigrationDatabase(p);

  // Seed Product Variant
  db.prepare(`
    INSERT INTO product_templates (id, company_id, name, created_at, updated_at)
    VALUES ('tmpl-turbine', 'company-alpha', 'Industrial Gas Turbine V4', datetime('now'), datetime('now'))
  `).run();

  db.prepare(`
    INSERT INTO product_variants (id, template_id, company_id, name, sku, created_at, updated_at)
    VALUES ('prod-turb-v4', 'tmpl-turbine', 'company-alpha', 'Industrial Gas Turbine V4 50MW', 'TURB-50MW', datetime('now'), datetime('now'))
  `).run();

  return { db, path: p };
}

function cleanup(env) {
  env.db.close();
  for (const s of ['', '-wal', '-shm']) {
    try { if (fs.existsSync(env.path + s)) fs.unlinkSync(env.path + s); } catch {}
  }
}

test('1. Migration 076: Up, rerun, and schema verification', async () => {
  const env = await setup('m076-schema');
  try {
    await m076.up(env.db);

    const tables = env.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name IN ('plm_engineering_revisions', 'plm_engineering_change_orders', 'plm_eco_affected_items', 'plm_eco_approvals', 'plm_cad_documents')
    `).all().map(r => r.name);

    assert.equal(tables.length, 5);

    // Rerun check
    await m076.up(env.db);
  } finally {
    cleanup(env);
  }
});

test('2. Initial Engineering Revision Setup (Rev A)', async () => {
  const env = await setup('rev-setup');
  try {
    await m076.up(env.db);

    const revA = plmService.createEngineeringRevision(env.db, {
      company_id: 'company-alpha',
      product_id: 'prod-turb-v4',
      revision_code: 'Rev A',
      change_summary: 'Initial baseline release'
    });

    assert.equal(revA.revision_code, 'Rev A');
    assert.equal(revA.status, 'active');
    assert.ok(revA.revision_number.startsWith('REV-2026-'));
  } finally {
    cleanup(env);
  }
});

test('3. Full ECO Lifecycle: Draft -> Multi-Department Approval -> Implementation (Rev A -> Rev B)', async () => {
  const env = await setup('eco-lifecycle');
  try {
    await m076.up(env.db);

    // Initial Rev A
    plmService.createEngineeringRevision(env.db, {
      company_id: 'company-alpha',
      product_id: 'prod-turb-v4',
      revision_code: 'Rev A',
      change_summary: 'Initial release'
    });

    // Create ECO for Turbine Alloy Upgrade
    const eco = plmService.createECO(env.db, {
      company_id: 'company-alpha',
      title: 'Upgrade Turbine Blade Alloy Composition',
      change_type: 'design_update',
      priority: 'high',
      change_reason: 'Thermal stress tolerance improvement',
      initiator_id: 'lead-engineer'
    });
    assert.equal(eco.status, 'draft');
    assert.ok(eco.eco_number.startsWith('ECO-2026-'));

    // Link Affected Item (Rev A -> Rev B)
    const item = plmService.addAffectedItemToECO(env.db, {
      company_id: 'company-alpha',
      eco_id: eco.id,
      product_id: 'prod-turb-v4',
      current_revision_code: 'Rev A',
      new_revision_code: 'Rev B',
      action_type: 'modify'
    });
    assert.equal(item.new_revision_code, 'Rev B');

    // Add 2 approval requirements: Engineering and Quality
    plmService.addECOApprovalRequirement(env.db, { company_id: 'company-alpha', eco_id: eco.id, department: 'engineering', approver_id: 'eng-head' });
    plmService.addECOApprovalRequirement(env.db, { company_id: 'company-alpha', eco_id: eco.id, department: 'quality', approver_id: 'qa-head' });

    // Approve Dept 1: Engineering (ECO remains in_review/pending)
    const afterEng = plmService.approveECODepartment(env.db, { company_id: 'company-alpha', eco_id: eco.id, department: 'engineering', approver_id: 'eng-head' });
    assert.equal(afterEng.status, 'draft');

    // Approve Dept 2: Quality (All approved -> ECO becomes 'approved')
    const afterQA = plmService.approveECODepartment(env.db, { company_id: 'company-alpha', eco_id: eco.id, department: 'quality', approver_id: 'qa-head' });
    assert.equal(afterQA.status, 'approved');

    // Implement ECO
    const implementedECO = plmService.implementECO(env.db, {
      company_id: 'company-alpha',
      eco_id: eco.id,
      implemented_by: 'prod-mgr-01'
    });
    assert.equal(implementedECO.status, 'implemented');

    // Verify Rev A status is superseded
    const oldRev = env.db.prepare("SELECT status FROM plm_engineering_revisions WHERE product_id = ? AND revision_code = 'Rev A'").get('prod-turb-v4');
    assert.equal(oldRev.status, 'superseded');

    // Verify Rev B is now created and active
    const newRev = env.db.prepare("SELECT status FROM plm_engineering_revisions WHERE product_id = ? AND revision_code = 'Rev B'").get('prod-turb-v4');
    assert.equal(newRev.status, 'active');
  } finally {
    cleanup(env);
  }
});
