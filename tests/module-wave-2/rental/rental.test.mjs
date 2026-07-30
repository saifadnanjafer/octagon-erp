// tests/module-wave-2/rental/rental.test.mjs — Integration tests for W2-M3 Rental.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../../database/migration-runner/index.mjs';
import { migration as m069 } from '../../../database/migrations/069_rental_and_equipment_hire.mjs';
import * as rentalService from '../../../platform/domains/rental/service.mjs';

function tmp(n) { return path.join(os.tmpdir(), `octagon-rnt-${n}-${Date.now()}-${process.pid}.db`); }

async function setup(name) {
  const p = tmp(name);
  await freshInstall({ dbPath: p });
  const db = openMigrationDatabase(p);

  // Seed Party & Product
  db.prepare(`
    INSERT INTO parties (id, company_id, name, created_at, updated_at)
    VALUES ('party-r1', 'company-alpha', 'Basra Heavy Lifting Inc.', datetime('now'), datetime('now'))
  `).run();

  db.prepare(`
    INSERT INTO product_templates (id, company_id, name, created_at, updated_at)
    VALUES ('tmpl-crane-01', 'company-alpha', '50-Ton Mobile Crane', datetime('now'), datetime('now'))
  `).run();

  db.prepare(`
    INSERT INTO product_variants (id, template_id, company_id, name, sku, created_at, updated_at)
    VALUES ('prod-crane-01', 'tmpl-crane-01', 'company-alpha', '50-Ton Mobile Crane', 'CRANE-50T', datetime('now'), datetime('now'))
  `).run();

  return { db, path: p };
}

function cleanup(env) {
  env.db.close();
  for (const s of ['', '-wal', '-shm']) {
    try { if (fs.existsSync(env.path + s)) fs.unlinkSync(env.path + s); } catch {}
  }
}

test('1. Migration 069: Up, rerun, and schema verification', async () => {
  const env = await setup('r1');
  try {
    m069.up(env.db, { dialect: 'sqlite' });

    const mod = env.db.prepare('SELECT * FROM platform_modules WHERE id = ?').get('rental');
    assert.ok(mod, 'Rental module registered');
    assert.equal(mod.status, 'available');
  } finally {
    cleanup(env);
  }
});

test('2. Rental Product Configuration and Availability Check', async () => {
  const env = await setup('r2');
  try {
    const cfg = rentalService.configureRentalProduct(env.db, {
      company_id: 'company-alpha',
      product_id: 'prod-crane-01',
      daily_rate: 750000,
      deposit_amount: 2000000,
      is_serialized: 1
    });

    assert.ok(cfg.id);
    assert.equal(cfg.daily_rate, 750000);

    const avail = rentalService.checkAvailability(env.db, {
      product_id: 'prod-crane-01',
      start_date: '2026-08-10',
      end_date: '2026-08-20'
    });

    assert.equal(avail.available, true);
  } finally {
    cleanup(env);
  }
});

test('3. Double Booking Prevention (Overlapping Reservations Refused)', async () => {
  const env = await setup('r3');
  try {
    const user = { id: 'usr-agent-1' };

    rentalService.configureRentalProduct(env.db, {
      company_id: 'company-alpha',
      product_id: 'prod-crane-01',
      daily_rate: 750000
    });

    // Create Agreement 1: Aug 1 to Aug 10
    const ag1 = rentalService.createAgreement(env.db, {
      company_id: 'company-alpha',
      party_id: 'party-r1',
      planned_start: '2026-08-01T00:00:00Z',
      planned_end: '2026-08-10T00:00:00Z',
      lines: [{ product_id: 'prod-crane-01', quantity: 1 }]
    }, user);

    assert.ok(ag1.id);
    assert.equal(ag1.status, 'reserved');

    // Attempt overlapping Agreement 2: Aug 5 to Aug 15 (MUST fail double booking guard!)
    assert.throws(() => {
      rentalService.createAgreement(env.db, {
        company_id: 'company-alpha',
        party_id: 'party-r1',
        planned_start: '2026-08-05T00:00:00Z',
        planned_end: '2026-08-15T00:00:00Z',
        lines: [{ product_id: 'prod-crane-01', quantity: 1 }]
      }, user);
    }, /UNAVAILABLE_FOR_RENT/);
  } finally {
    cleanup(env);
  }
});

test('4. Maintenance Hold Block', async () => {
  const env = await setup('r4');
  try {
    const user = { id: 'usr-agent-1' };

    rentalService.configureRentalProduct(env.db, {
      company_id: 'company-alpha',
      product_id: 'prod-crane-01',
      daily_rate: 750000
    });

    // Set maintenance hold Aug 15 to Aug 20
    rentalService.setMaintenanceHold(env.db, {
      product_id: 'prod-crane-01',
      start_date: '2026-08-15T00:00:00Z',
      end_date: '2026-08-20T00:00:00Z',
      reason: 'Scheduled hydraulic overhaul'
    });

    // Attempt booking during maintenance window (MUST fail!)
    assert.throws(() => {
      rentalService.createAgreement(env.db, {
        company_id: 'company-alpha',
        party_id: 'party-r1',
        planned_start: '2026-08-16T00:00:00Z',
        planned_end: '2026-08-18T00:00:00Z',
        lines: [{ product_id: 'prod-crane-01', quantity: 1 }]
      }, user);
    }, /UNAVAILABLE_FOR_RENT/);
  } finally {
    cleanup(env);
  }
});

test('5. Full Lifecycle: Handover, Extension, Return', async () => {
  const env = await setup('r5');
  try {
    const user = { id: 'usr-agent-1' };

    rentalService.configureRentalProduct(env.db, {
      company_id: 'company-alpha',
      product_id: 'prod-crane-01',
      daily_rate: 500000
    });

    const ag = rentalService.createAgreement(env.db, {
      company_id: 'company-alpha',
      party_id: 'party-r1',
      planned_start: '2026-09-01T00:00:00Z',
      planned_end: '2026-09-05T00:00:00Z',
      lines: [{ product_id: 'prod-crane-01', quantity: 1 }]
    }, user);

    // Handover
    const active = rentalService.handoverRental(env.db, {
      agreement_id: ag.id,
      company_id: 'company-alpha',
      received_by_person: 'Ali Hassan (Site Engineer)'
    }, user);
    assert.equal(active.status, 'active');

    // Extend 2 days
    const extended = rentalService.extendRental(env.db, {
      agreement_id: ag.id,
      company_id: 'company-alpha',
      extension_days: 2,
      additional_amount: 1000000
    }, user);
    assert.equal(extended.status, 'extended');

    // Return
    const returned = rentalService.returnRental(env.db, {
      agreement_id: ag.id,
      company_id: 'company-alpha',
      is_damaged: 0
    }, user);
    assert.equal(returned.status, 'returned');
  } finally {
    cleanup(env);
  }
});
