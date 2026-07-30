// platform/domains/subscriptions/service.mjs — Subscriptions and Recurring Billing Domain Services.

import { createHash } from 'crypto';

export function getSubscription(db, subscriptionId, companyId) {
  const row = db.prepare(`
    SELECT * FROM subscriptions WHERE id = ? AND (company_id = ? OR company_id = '*')
  `).get(subscriptionId, companyId);
  return row || null;
}

export function generateSubscriptionNumber(db, companyId) {
  const year = new Date().getFullYear();
  const prefix = `SUB-${year}-`;
  const countRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM subscriptions WHERE company_id = ? AND subscription_number LIKE ?
  `).get(companyId, `${prefix}%`);
  const seq = (countRow ? countRow.cnt : 0) + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function createPlan(db, {
  company_id,
  code,
  name_ar,
  name_en,
  billing_interval = 'monthly',
  interval_count = 1,
  trial_period_days = 0,
  currency = 'IQD',
  base_price = 0
}) {
  if (!company_id || !code || !name_ar || !name_en) {
    throw new Error('MISSING_REQUIRED_FIELDS: company_id, code, name_ar, name_en are required');
  }

  const id = `plan-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO subscription_plans (
      id, company_id, code, name_ar, name_en, billing_interval,
      interval_count, trial_period_days, currency, base_price,
      is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, company_id, code, name_ar, name_en, billing_interval, interval_count, trial_period_days, currency, base_price, now, now);

  return db.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(id);
}

export function createSubscription(db, {
  company_id,
  branch_id = null,
  party_id,
  plan_id,
  start_date,
  currency = 'IQD',
  recurring_amount = null,
  lines = []
}, user) {
  if (!company_id || !party_id || !plan_id) {
    throw new Error('MISSING_REQUIRED_FIELDS: company_id, party_id, plan_id are required');
  }

  const plan = db.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(plan_id);
  if (!plan) {
    throw new Error(`PLAN_NOT_FOUND: Subscription plan ${plan_id} not found`);
  }

  const party = db.prepare('SELECT id FROM parties WHERE id = ?').get(party_id);
  if (!party) {
    throw new Error(`PARTY_NOT_FOUND: Party ${party_id} not found`);
  }

  const id = `sub-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const subNumber = generateSubscriptionNumber(db, company_id);
  const now = new Date().toISOString();
  const startDateStr = start_date || now;

  // Calculate period end based on plan interval
  const startDateObj = new Date(startDateStr);
  let endDateObj = new Date(startDateObj);
  if (plan.billing_interval === 'annual') {
    endDateObj.setFullYear(endDateObj.getFullYear() + plan.interval_count);
  } else if (plan.billing_interval === 'quarterly') {
    endDateObj.setMonth(endDateObj.getMonth() + (3 * plan.interval_count));
  } else {
    endDateObj.setMonth(endDateObj.getMonth() + plan.interval_count);
  }

  const amount = recurring_amount !== null ? recurring_amount : plan.base_price;

  db.prepare(`
    INSERT INTO subscriptions (
      id, company_id, branch_id, subscription_number, party_id, plan_id,
      status, current_period_start, current_period_end, recurring_amount,
      currency, auto_renew, version, created_by, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      'draft', ?, ?, ?,
      ?, 1, 1, ?, ?, ?
    )
  `).run(
    id, company_id, branch_id, subNumber, party_id, plan_id,
    startDateStr, endDateObj.toISOString(), amount,
    currency, user.id || 'system', now, now
  );

  // Add Lines
  for (const line of lines) {
    const lineId = `subl-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const qty = line.quantity || 1;
    const price = line.unit_price || 0;
    const lineAmt = qty * price;
    db.prepare(`
      INSERT INTO subscription_lines (id, subscription_id, product_id, description, quantity, unit_price, amount, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(lineId, id, line.product_id || null, line.description || 'Subscription Line', qty, price, lineAmt, now);
  }

  return getSubscription(db, id, company_id);
}

export function activateSubscription(db, { subscription_id, company_id }, user) {
  const sub = getSubscription(db, subscription_id, company_id);
  if (!sub) {
    throw new Error(`SUBSCRIPTION_NOT_FOUND: Subscription ${subscription_id} not found`);
  }

  if (sub.status !== 'draft' && sub.status !== 'paused') {
    throw new Error(`INVALID_SUBSCRIPTION_STATE: Subscription cannot be activated from state ${sub.status}`);
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE subscriptions
    SET status = 'active', updated_at = ?
    WHERE id = ? AND company_id = ?
  `).run(now, subscription_id, company_id);

  // Initialize schedule
  const schId = `sch-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  db.prepare(`
    INSERT OR REPLACE INTO subscription_schedules (id, subscription_id, next_billing_date, billing_interval, is_active, created_at, updated_at)
    VALUES (?, ?, ?, 'monthly', 1, ?, ?)
  `).run(schId, subscription_id, sub.current_period_start, now, now);

  return getSubscription(db, subscription_id, company_id);
}

/**
 * Idempotent Billing Cycle Run.
 * Uses an idempotency_key = `${subId}_${periodStart}_${periodEnd}`.
 * Replaying creates NO duplicate cycle, invoice, or sale order!
 */
export function generateBillingCycle(db, { subscription_id, company_id, period_start, period_end }, user) {
  const sub = getSubscription(db, subscription_id, company_id);
  if (!sub) {
    throw new Error(`SUBSCRIPTION_NOT_FOUND: Subscription ${subscription_id} not found`);
  }

  if (sub.status !== 'active' && sub.status !== 'renewed') {
    throw new Error(`SUBSCRIPTION_NOT_ACTIVE: Subscription ${subscription_id} is not active (current: ${sub.status})`);
  }

  const pStart = period_start || sub.current_period_start;
  const pEnd = period_end || sub.current_period_end;
  const idempotencyKey = `${subscription_id}_${pStart.substring(0, 10)}_${pEnd.substring(0, 10)}`;

  // Check if cycle with this idempotency key already exists
  const existingCycle = db.prepare(`
    SELECT * FROM subscription_billing_cycles WHERE subscription_id = ? AND idempotency_key = ?
  `).get(subscription_id, idempotencyKey);

  if (existingCycle) {
    // Return existing cycle — idempotent replay!
    return {
      cycle: existingCycle,
      replayed: true
    };
  }

  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM subscription_billing_cycles WHERE subscription_id = ?').get(subscription_id);
  const cycleNumber = (countRow ? countRow.cnt : 0) + 1;
  const cycleId = `cyc-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();

  // Create canonical Sale Order for the subscription billing
  const orderId = `so-sub-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const orderName = `SO-SUB-${cycleNumber}-${sub.subscription_number}`;

  db.prepare(`
    INSERT INTO sale_orders (
      id, company_id, name, partner_id, currency_id, state, amount_untaxed, amount_tax, amount_total, order_date, created_at
    ) VALUES (?, ?, ?, ?, ?, 'confirmed', ?, 0.0, ?, ?, ?)
  `).run(orderId, company_id, orderName, sub.party_id, sub.currency, sub.recurring_amount, sub.recurring_amount, now.substring(0, 10), now);

  db.prepare(`
    INSERT INTO subscription_billing_cycles (
      id, subscription_id, company_id, cycle_number, period_start, period_end,
      status, idempotency_key, generated_sale_order_id, amount_billed, billed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'billed', ?, ?, ?, ?, ?)
  `).run(
    cycleId, subscription_id, company_id, cycleNumber, pStart, pEnd,
    idempotencyKey, orderId, sub.recurring_amount, now, now
  );

  // Record Billing Attempt
  const attId = `att-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  db.prepare(`
    INSERT INTO subscription_billing_attempts (id, billing_cycle_id, attempt_number, status, attempted_at)
    VALUES (?, ?, 1, 'successful', ?)
  `).run(attId, cycleId, now);

  const createdCycle = db.prepare('SELECT * FROM subscription_billing_cycles WHERE id = ?').get(cycleId);
  return {
    cycle: createdCycle,
    replayed: false
  };
}

export function pauseSubscription(db, { subscription_id, company_id, reason = '' }, user) {
  const sub = getSubscription(db, subscription_id, company_id);
  if (!sub) {
    throw new Error(`SUBSCRIPTION_NOT_FOUND: Subscription ${subscription_id} not found`);
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE subscriptions SET status = 'paused', updated_at = ? WHERE id = ? AND company_id = ?
  `).run(now, subscription_id, company_id);

  const recId = `pause-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  db.prepare(`
    INSERT INTO subscription_pause_records (id, subscription_id, paused_at, reason, paused_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(recId, subscription_id, now, reason, user.id || 'system');

  return getSubscription(db, subscription_id, company_id);
}

export function cancelSubscription(db, { subscription_id, company_id, reason = '' }, user) {
  const sub = getSubscription(db, subscription_id, company_id);
  if (!sub) {
    throw new Error(`SUBSCRIPTION_NOT_FOUND: Subscription ${subscription_id} not found`);
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE subscriptions SET status = 'cancelled', canceled_at = ?, ended_at = ?, updated_at = ?
    WHERE id = ? AND company_id = ?
  `).run(now, now, now, subscription_id, company_id);

  const recId = `can-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  db.prepare(`
    INSERT INTO subscription_cancellation_records (id, subscription_id, canceled_at, cancellation_reason, canceled_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(recId, subscription_id, now, reason, user.id || 'system');

  return getSubscription(db, subscription_id, company_id);
}

export function listSubscriptions(db, { company_id, status, plan_id, party_id, limit = 100, offset = 0 }) {
  const filters = ['(company_id = ? OR company_id = \'*\')'];
  const params = [company_id];

  if (status) { filters.push('status = ?'); params.push(status); }
  if (plan_id) { filters.push('plan_id = ?'); params.push(plan_id); }
  if (party_id) { filters.push('party_id = ?'); params.push(party_id); }

  const where = filters.join(' AND ');
  const rows = db.prepare(`SELECT * FROM subscriptions WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, Number(limit), Number(offset));
  const total = db.prepare(`SELECT COUNT(*) as n FROM subscriptions WHERE ${where}`).get(...params).n;

  return { rows, total };
}
