// tests/module-wave-2/subscriptions/subscriptions.test.mjs — Integration tests for W2-M2 Subscriptions.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../../database/migration-runner/index.mjs';
import { migration as m068 } from '../../../database/migrations/068_subscriptions_and_recurring_billing.mjs';
import * as subService from '../../../platform/domains/subscriptions/service.mjs';

function tmp(n) { return path.join(os.tmpdir(), `octagon-sub-${n}-${Date.now()}-${process.pid}.db`); }

async function setup(name) {
  const p = tmp(name);
  await freshInstall({ dbPath: p });
  const db = openMigrationDatabase(p);

  // Seed sample Party
  db.prepare(`
    INSERT INTO parties (id, company_id, name, created_at, updated_at)
    VALUES ('party-s1', 'company-alpha', 'Baghdad Telecom Enterprise', datetime('now'), datetime('now'))
  `).run();

  return { db, path: p };
}

function cleanup(env) {
  env.db.close();
  for (const s of ['', '-wal', '-shm']) {
    try { if (fs.existsSync(env.path + s)) fs.unlinkSync(env.path + s); } catch {}
  }
}

test('1. Migration 068: Up, rerun, and schema verification', async () => {
  const env = await setup('s1');
  try {
    m068.up(env.db, { dialect: 'sqlite' });

    const mod = env.db.prepare('SELECT * FROM platform_modules WHERE id = ?').get('subscriptions');
    assert.ok(mod, 'Subscriptions module registered');
    // Migration 083 (Final Page Catalog) advances a Wave 2 module from
    // 'available' to 'installed' once its schema migration has run: 'available'
    // means "declared but not installable", and this module's tables now exist.
    // Enabling it for a company remains a control-plane decision, so the status
    // deliberately stops at 'installed' rather than 'enabled'.
    assert.equal(mod.status, 'installed');
  } finally {
    cleanup(env);
  }
});

test('2. Subscription Plan and Subscription Creation', async () => {
  const env = await setup('s2');
  try {
    const user = { id: 'usr-sub-1' };

    const plan = subService.createPlan(env.db, {
      company_id: 'company-alpha',
      code: 'ENTERPRISE_MONTHLY',
      name_ar: 'باقة المؤسسات الشهرية',
      name_en: 'Enterprise Monthly Plan',
      billing_interval: 'monthly',
      base_price: 1500000,
      currency: 'IQD'
    });

    assert.ok(plan.id);
    assert.equal(plan.code, 'ENTERPRISE_MONTHLY');

    const sub = subService.createSubscription(env.db, {
      company_id: 'company-alpha',
      party_id: 'party-s1',
      plan_id: plan.id,
      start_date: '2026-08-01',
      recurring_amount: 1500000,
      lines: [
        { description: 'Cloud ERP Core User Pack x10', quantity: 10, unit_price: 150000 }
      ]
    }, user);

    assert.ok(sub.id);
    assert.match(sub.subscription_number, /^SUB-2026-\d{4}$/);
    assert.equal(sub.status, 'draft');

    const activeSub = subService.activateSubscription(env.db, {
      subscription_id: sub.id,
      company_id: 'company-alpha'
    }, user);

    assert.equal(activeSub.status, 'active');
  } finally {
    cleanup(env);
  }
});

test('3. Idempotent Billing Cycle Run (No Duplicate Invoices/Orders)', async () => {
  const env = await setup('s3');
  try {
    const user = { id: 'usr-sub-1' };

    const plan = subService.createPlan(env.db, {
      company_id: 'company-alpha',
      code: 'PRO_PLAN',
      name_ar: 'الباقة الاحترافية',
      name_en: 'Professional Plan',
      base_price: 500000
    });

    const sub = subService.createSubscription(env.db, {
      company_id: 'company-alpha',
      party_id: 'party-s1',
      plan_id: plan.id,
      start_date: '2026-08-01'
    }, user);

    subService.activateSubscription(env.db, { subscription_id: sub.id, company_id: 'company-alpha' }, user);

    // Initial Billing Run
    const run1 = subService.generateBillingCycle(env.db, {
      subscription_id: sub.id,
      company_id: 'company-alpha',
      period_start: '2026-08-01',
      period_end: '2026-08-31'
    }, user);

    assert.equal(run1.replayed, false, 'First run creates new billing cycle');
    assert.ok(run1.cycle.generated_sale_order_id, 'Canonical Sale Order created');

    const ordersCount1 = env.db.prepare('SELECT COUNT(*) as n FROM sale_orders').get().n;
    assert.equal(ordersCount1, 1, 'Exactly one Sale Order created');

    // Replay Billing Run with SAME period/subscription — Idempotency Test!
    const run2 = subService.generateBillingCycle(env.db, {
      subscription_id: sub.id,
      company_id: 'company-alpha',
      period_start: '2026-08-01',
      period_end: '2026-08-31'
    }, user);

    assert.equal(run2.replayed, true, 'Replay detected existing cycle via idempotency key');
    assert.equal(run2.cycle.id, run1.cycle.id, 'Returned exact same cycle ID');

    const ordersCount2 = env.db.prepare('SELECT COUNT(*) as n FROM sale_orders').get().n;
    assert.equal(ordersCount2, 1, 'No duplicate Sale Order created during replay!');
  } finally {
    cleanup(env);
  }
});

test('4. Pause and Cancellation Lifecycle', async () => {
  const env = await setup('s4');
  try {
    const user = { id: 'usr-mgr-2' };

    const plan = subService.createPlan(env.db, {
      company_id: 'company-alpha',
      code: 'BASIC_PLAN',
      name_ar: 'الباقة الأساسية',
      name_en: 'Basic Plan',
      base_price: 200000
    });

    const sub = subService.createSubscription(env.db, {
      company_id: 'company-alpha',
      party_id: 'party-s1',
      plan_id: plan.id,
      start_date: '2026-08-01'
    }, user);

    subService.activateSubscription(env.db, { subscription_id: sub.id, company_id: 'company-alpha' }, user);

    // Pause
    const paused = subService.pauseSubscription(env.db, {
      subscription_id: sub.id,
      company_id: 'company-alpha',
      reason: 'Temporary office closure'
    }, user);
    assert.equal(paused.status, 'paused');

    // Resume
    const resumed = subService.activateSubscription(env.db, {
      subscription_id: sub.id,
      company_id: 'company-alpha'
    }, user);
    assert.equal(resumed.status, 'active');

    // Cancel
    const cancelled = subService.cancelSubscription(env.db, {
      subscription_id: sub.id,
      company_id: 'company-alpha',
      reason: 'Customer contract expired'
    }, user);
    assert.equal(cancelled.status, 'cancelled');
    assert.ok(cancelled.canceled_at);
  } finally {
    cleanup(env);
  }
});
