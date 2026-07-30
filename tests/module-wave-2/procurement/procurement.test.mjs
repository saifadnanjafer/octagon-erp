// tests/module-wave-2/procurement/procurement.test.mjs — Integration tests for W2-M5 Procurement.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../../database/migration-runner/index.mjs';
import { migration as m071 } from '../../../database/migrations/071_advanced_procurement_and_supplier_portal.mjs';
import * as procService from '../../../platform/domains/procurement/service.mjs';

function tmp(n) { return path.join(os.tmpdir(), `octagon-prc-${n}-${Date.now()}-${process.pid}.db`); }

async function setup(name) {
  const p = tmp(name);
  await freshInstall({ dbPath: p });
  const db = openMigrationDatabase(p);

  // Seed Requester, Suppliers & Product Variants
  db.prepare(`
    INSERT INTO parties (id, company_id, name, created_at, updated_at)
    VALUES ('sup-alpha', 'company-alpha', 'Basra Steel Corp', datetime('now'), datetime('now'))
  `).run();

  db.prepare(`
    INSERT INTO parties (id, company_id, name, created_at, updated_at)
    VALUES ('sup-beta', 'company-alpha', 'Tigris Metals LLC', datetime('now'), datetime('now'))
  `).run();

  db.prepare(`
    INSERT INTO product_templates (id, company_id, name, created_at, updated_at)
    VALUES ('tmpl-steel-beam', 'company-alpha', 'I-Beam Steel 12m', datetime('now'), datetime('now'))
  `).run();

  db.prepare(`
    INSERT INTO product_variants (id, template_id, company_id, name, sku, created_at, updated_at)
    VALUES ('prod-beam-12m', 'tmpl-steel-beam', 'company-alpha', 'I-Beam Steel 12m', 'BEAM-12M', datetime('now'), datetime('now'))
  `).run();

  return { db, path: p };
}

function cleanup(env) {
  env.db.close();
  for (const s of ['', '-wal', '-shm']) {
    try { if (fs.existsSync(env.path + s)) fs.unlinkSync(env.path + s); } catch {}
  }
}

test('1. Migration 071: Up, rerun, and schema verification', async () => {
  const env = await setup('m071-schema');
  try {
    await m071.up(env.db);

    const tables = env.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name IN ('purchase_requisitions', 'rfq_headers', 'supplier_bids', 'supplier_evaluations')
    `).all().map(r => r.name);

    assert.equal(tables.length, 4);

    // Rerun check
    await m071.up(env.db);
  } finally {
    cleanup(env);
  }
});

test('2. Purchase Requisition Lifecycle', async () => {
  const env = await setup('pr-life');
  try {
    await m071.up(env.db);

    const pr = procService.createRequisition(env.db, {
      company_id: 'company-alpha',
      requester_id: 'user-eng-01',
      title: 'Structural Steel Supply for Warehouse Project'
    });
    assert.equal(pr.status, 'draft');
    assert.ok(pr.requisition_number.startsWith('PR-2026-'));

    const line = procService.addRequisitionLine(env.db, {
      company_id: 'company-alpha',
      requisition_id: pr.id,
      product_id: 'prod-beam-12m',
      quantity: 50,
      estimated_unit_cost: 300.0,
      required_date: '2026-09-01'
    });
    assert.equal(line.quantity, 50);

    const updatedPR = env.db.prepare('SELECT total_estimated_cost FROM purchase_requisitions WHERE id = ?').get(pr.id);
    assert.equal(updatedPR.total_estimated_cost, 15000.0);

    const approved = procService.approveRequisition(env.db, {
      id: pr.id,
      company_id: 'company-alpha',
      approved_by: 'mgr-procurement'
    });
    assert.equal(approved.status, 'approved');
  } finally {
    cleanup(env);
  }
});

test('3. RFQ Creation, Supplier Bidding, and Award Workflow', async () => {
  const env = await setup('rfq-award');
  try {
    await m071.up(env.db);

    const pr = procService.createRequisition(env.db, {
      company_id: 'company-alpha',
      requester_id: 'user-eng-01',
      title: 'Steel Beams RFQ Target'
    });
    procService.approveRequisition(env.db, { id: pr.id, company_id: 'company-alpha', approved_by: 'mgr' });

    const rfq = procService.createRFQ(env.db, {
      company_id: 'company-alpha',
      requisition_id: pr.id,
      title: 'RFQ 2026-001 Steel Supply',
      bid_submission_deadline: '2026-08-15',
      delivery_location: 'Basra Port Yard 4'
    });
    assert.equal(rfq.status, 'draft');

    procService.inviteSupplierToRFQ(env.db, { company_id: 'company-alpha', rfq_id: rfq.id, supplier_id: 'sup-alpha' });
    procService.inviteSupplierToRFQ(env.db, { company_id: 'company-alpha', rfq_id: rfq.id, supplier_id: 'sup-beta' });

    procService.publishRFQ(env.db, { id: rfq.id, company_id: 'company-alpha' });

    // Bid 1 from sup-alpha ($280/unit = $14,000)
    const bidAlpha = procService.submitSupplierBid(env.db, {
      company_id: 'company-alpha',
      rfq_id: rfq.id,
      supplier_id: 'sup-alpha',
      validity_end_date: '2026-08-30',
      lines: [
        { product_id: 'prod-beam-12m', quantity: 50, unit_price: 280.0 }
      ]
    });
    assert.equal(bidAlpha.total_bid_amount, 14000.0);

    // Bid 2 from sup-beta ($260/unit = $13,000 - Winner)
    const bidBeta = procService.submitSupplierBid(env.db, {
      company_id: 'company-alpha',
      rfq_id: rfq.id,
      supplier_id: 'sup-beta',
      validity_end_date: '2026-08-30',
      lines: [
        { product_id: 'prod-beam-12m', quantity: 50, unit_price: 260.0 }
      ]
    });
    assert.equal(bidBeta.total_bid_amount, 13000.0);

    // Award to Bid Beta
    const awardedRFQ = procService.awardRFQ(env.db, {
      company_id: 'company-alpha',
      rfq_id: rfq.id,
      winning_bid_id: bidBeta.id,
      awarded_by: 'proc-director'
    });
    assert.equal(awardedRFQ.status, 'awarded');
    assert.equal(awardedRFQ.awarded_bid_id, bidBeta.id);

    const bBeta = env.db.prepare('SELECT status FROM supplier_bids WHERE id = ?').get(bidBeta.id);
    const bAlpha = env.db.prepare('SELECT status FROM supplier_bids WHERE id = ?').get(bidAlpha.id);
    assert.equal(bBeta.status, 'accepted');
    assert.equal(bAlpha.status, 'rejected');
  } finally {
    cleanup(env);
  }
});

test('4. Supplier Performance Evaluation Rating', async () => {
  const env = await setup('sup-eval');
  try {
    await m071.up(env.db);

    const evalResult = procService.evaluateSupplierPerformance(env.db, {
      company_id: 'company-alpha',
      supplier_id: 'sup-beta',
      evaluation_period: '2026-Q2',
      quality_score: 95.0,
      delivery_score: 90.0,
      price_competitiveness_score: 100.0,
      evaluator_id: 'qa-mgr-01',
      comments: 'Excellent lead times and competitive pricing on structural steel'
    });

    // Weighted average: (95 * 0.4) + (90 * 0.4) + (100 * 0.2) = 38 + 36 + 20 = 94.0
    assert.equal(evalResult.overall_rating, 94.0);
  } finally {
    cleanup(env);
  }
});
