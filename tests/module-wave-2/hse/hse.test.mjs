// tests/module-wave-2/hse/hse.test.mjs — Integration tests for W2-M12 HSE.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../../database/migration-runner/index.mjs';
import { migration as m078 } from '../../../database/migrations/078_hse_and_safety_management.mjs';
import * as hseService from '../../../platform/domains/hse/service.mjs';

function tmp(n) { return path.join(os.tmpdir(), `octagon-hse-${n}-${Date.now()}-${process.pid}.db`); }

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

test('1. Migration 078: Up, rerun, and schema verification', async () => {
  const env = await setup('m078-schema');
  try {
    await m078.up(env.db);

    const tables = env.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name IN ('hse_incidents', 'hse_incident_investigations', 'hse_corrective_actions', 'hse_safety_permits', 'hse_safety_inspections')
    `).all().map(r => r.name);

    assert.equal(tables.length, 5);

    // Rerun check
    await m078.up(env.db);
  } finally {
    cleanup(env);
  }
});

test('2. Incident Reporting, Investigation, and CAPA Creation', async () => {
  const env = await setup('inc-life');
  try {
    await m078.up(env.db);

    const inc = hseService.reportIncident(env.db, {
      company_id: 'company-alpha',
      incident_date: '2026-07-29',
      location: 'Refinery Unit 4',
      category: 'environmental_spill',
      severity: 'major',
      title: 'Minor Hydraulic Oil Spill during Pump Maintenance',
      description: 'Gasket failure caused 15 liters of hydraulic oil release',
      reporter_id: 'hse-officer-01'
    });
    assert.equal(inc.status, 'reported');
    assert.ok(inc.incident_number.startsWith('INC-2026-'));

    const inv = hseService.investigateIncident(env.db, {
      company_id: 'company-alpha',
      incident_id: inc.id,
      investigator_id: 'lead-investigator',
      root_cause_analysis: 'Worn-out synthetic O-ring seal failed under operating pressure',
      immediate_action_taken: 'Spill containment kit deployed, area neutralized with absorbent'
    });
    assert.equal(inv.root_cause_analysis.includes('seal failed'), true);

    const incStatus = env.db.prepare('SELECT status FROM hse_incidents WHERE id = ?').get(inc.id);
    assert.equal(incStatus.status, 'investigating');

    const capa = hseService.createCAPA(env.db, {
      company_id: 'company-alpha',
      incident_id: inc.id,
      action_description: 'Replace all Unit 4 pump gaskets with high-temp fluorocarbon seals',
      assigned_to: 'maintenance-lead',
      target_date: '2026-08-15'
    });
    assert.equal(capa.status, 'open');
    assert.ok(capa.capa_number.startsWith('CAPA-2026-'));
  } finally {
    cleanup(env);
  }
});

test('3. Safety Permit to Work (PTW) Request & Issuance', async () => {
  const env = await setup('ptw-test');
  try {
    await m078.up(env.db);

    const ptw = hseService.requestSafetyPermit(env.db, {
      company_id: 'company-alpha',
      permit_type: 'confined_space',
      location: 'Storage Tank T-102',
      work_description: 'Internal wall thickness ultrasonic inspection',
      valid_from: '2026-08-01 08:00',
      valid_until: '2026-08-01 17:00'
    });
    assert.equal(ptw.status, 'requested');
    assert.ok(ptw.permit_number.startsWith('PTW-2026-'));

    const issued = hseService.issueSafetyPermit(env.db, {
      id: ptw.id,
      company_id: 'company-alpha',
      issuer_id: 'hse-manager'
    });
    assert.equal(issued.status, 'issued');
    assert.equal(issued.issuer_id, 'hse-manager');
  } finally {
    cleanup(env);
  }
});

test('4. Safety Inspection Score Calculation', async () => {
  const env = await setup('insp-test');
  try {
    await m078.up(env.db);

    const insp = hseService.recordSafetyInspection(env.db, {
      company_id: 'company-alpha',
      facility_location: 'Central Workshop',
      inspector_id: 'safety-auditor',
      inspection_date: '2026-07-30',
      passed_items: 45,
      failed_items: 5,
      summary: 'Overall good compliance; 5 minor PPE/labeling non-conformances'
    });

    // 45 / (45 + 5) = 45 / 50 = 90%
    assert.equal(insp.compliance_score_pct, 90.0);
  } finally {
    cleanup(env);
  }
});
