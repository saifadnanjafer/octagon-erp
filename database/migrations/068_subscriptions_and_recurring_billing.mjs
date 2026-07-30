// 068_subscriptions_and_recurring_billing.mjs — Wave 2, W2-M2 (Subscriptions and Recurring Billing).
//
// Governed Subscriptions schema over canonical Party, Sales, Finance, and Entitlements.

const MIGRATION_ID = '068_subscriptions_and_recurring_billing';
const MODULE_ID = 'subscriptions';

export const migration = {
  id: MIGRATION_ID,
  owner: 'octagon.subscriptions',
  version: '2.1.0',
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Wave 2 W2-M2 Subscriptions and Recurring Billing',

  up(db, { dialect }) {
    db.exec(`
      -- Subscription Plans
      CREATE TABLE IF NOT EXISTS subscription_plans (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        code TEXT NOT NULL,
        name_ar TEXT NOT NULL,
        name_en TEXT NOT NULL,
        billing_interval TEXT NOT NULL DEFAULT 'monthly', -- monthly, quarterly, annual, custom
        interval_count INTEGER NOT NULL DEFAULT 1,
        trial_period_days INTEGER NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'IQD',
        base_price REAL NOT NULL DEFAULT 0.0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_plan_code ON subscription_plans(company_id, code);

      -- Subscriptions
      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        branch_id TEXT,
        subscription_number TEXT NOT NULL,
        party_id TEXT NOT NULL REFERENCES parties(id),
        plan_id TEXT NOT NULL REFERENCES subscription_plans(id),
        status TEXT NOT NULL DEFAULT 'draft', -- draft, active, billing, renewing, renewed, paused, past_due, cancelled, expired
        current_period_start TEXT NOT NULL,
        current_period_end TEXT NOT NULL,
        cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
        canceled_at TEXT,
        ended_at TEXT,
        trial_start TEXT,
        trial_end TEXT,
        recurring_amount REAL NOT NULL DEFAULT 0.0,
        currency TEXT NOT NULL DEFAULT 'IQD',
        auto_renew INTEGER NOT NULL DEFAULT 1,
        sale_order_id TEXT, -- canonical Sales linkage
        version INTEGER NOT NULL DEFAULT 1,
        created_by TEXT NOT NULL DEFAULT 'system',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_number ON subscriptions(company_id, subscription_number);
      CREATE INDEX IF NOT EXISTS idx_subscription_party ON subscriptions(company_id, party_id);
      CREATE INDEX IF NOT EXISTS idx_subscription_status ON subscriptions(company_id, status);

      -- Subscription Lines
      CREATE TABLE IF NOT EXISTS subscription_lines (
        id TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
        product_id TEXT,
        description TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 1.0,
        unit_price REAL NOT NULL DEFAULT 0.0,
        amount REAL NOT NULL DEFAULT 0.0,
        created_at TEXT NOT NULL
      );

      -- Billing Cycles / Runs
      CREATE TABLE IF NOT EXISTS subscription_billing_cycles (
        id TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL DEFAULT '*',
        cycle_number INTEGER NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', -- pending, billed, paid, failed, skipped
        idempotency_key TEXT NOT NULL, -- prevents duplicate billing runs
        generated_sale_order_id TEXT, -- generated canonical Sale Order ID
        generated_invoice_id TEXT, -- generated canonical Invoice ID
        amount_billed REAL NOT NULL DEFAULT 0.0,
        billed_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_billing_idempotency ON subscription_billing_cycles(subscription_id, idempotency_key);

      -- Recurring Schedules
      CREATE TABLE IF NOT EXISTS subscription_schedules (
        id TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
        next_billing_date TEXT NOT NULL,
        billing_interval TEXT NOT NULL DEFAULT 'monthly',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Usage Metric Foundation
      CREATE TABLE IF NOT EXISTS subscription_usage_metrics (
        id TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
        metric_code TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 0.0,
        recorded_at TEXT NOT NULL,
        billed INTEGER NOT NULL DEFAULT 0
      );

      -- Plan Changes (Upgrades / Downgrades)
      CREATE TABLE IF NOT EXISTS subscription_plan_changes (
        id TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
        previous_plan_id TEXT NOT NULL REFERENCES subscription_plans(id),
        new_plan_id TEXT NOT NULL REFERENCES subscription_plans(id),
        change_type TEXT NOT NULL DEFAULT 'upgrade', -- upgrade, downgrade
        effective_date TEXT NOT NULL,
        proration_amount REAL DEFAULT 0.0,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      -- Subscription Pause Records
      CREATE TABLE IF NOT EXISTS subscription_pause_records (
        id TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
        paused_at TEXT NOT NULL,
        resumed_at TEXT,
        reason TEXT DEFAULT '',
        paused_by TEXT NOT NULL
      );

      -- Subscription Cancellations
      CREATE TABLE IF NOT EXISTS subscription_cancellation_records (
        id TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
        canceled_at TEXT NOT NULL,
        cancellation_reason TEXT DEFAULT '',
        canceled_by TEXT NOT NULL
      );

      -- Billing Attempts & History
      CREATE TABLE IF NOT EXISTS subscription_billing_attempts (
        id TEXT PRIMARY KEY,
        billing_cycle_id TEXT NOT NULL REFERENCES subscription_billing_cycles(id) ON DELETE CASCADE,
        attempt_number INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'successful', -- successful, failed
        failure_reason TEXT DEFAULT '',
        attempted_at TEXT NOT NULL
      );

      -- Dunning Policies
      CREATE TABLE IF NOT EXISTS subscription_dunning_policies (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        max_retry_attempts INTEGER NOT NULL DEFAULT 3,
        retry_interval_days INTEGER NOT NULL DEFAULT 3,
        action_on_failure TEXT NOT NULL DEFAULT 'pause', -- pause, cancel, mark_past_due
        created_at TEXT NOT NULL
      );

      -- Subscription Entitlements
      CREATE TABLE IF NOT EXISTS subscription_entitlements (
        id TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
        entitlement_key TEXT NOT NULL,
        feature_limit INTEGER DEFAULT -1, -- -1 for unlimited
        is_enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
    `);

    // Seed module
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO platform_modules (
        id, name, version, status, kind, owner, created_at, updated_at
      ) VALUES (
        'subscriptions', 'Subscriptions & Recurring Billing', '2.1.0', 'available', 'standard', 'octagon.subscriptions', '${now}', '${now}'
      ) ON CONFLICT(id) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at;
    `).run();
  },

  down(db, { dialect }) {
    db.exec(`
      DROP TABLE IF EXISTS subscription_entitlements;
      DROP TABLE IF EXISTS subscription_dunning_policies;
      DROP TABLE IF EXISTS subscription_billing_attempts;
      DROP TABLE IF EXISTS subscription_cancellation_records;
      DROP TABLE IF EXISTS subscription_pause_records;
      DROP TABLE IF EXISTS subscription_plan_changes;
      DROP TABLE IF EXISTS subscription_usage_metrics;
      DROP TABLE IF EXISTS subscription_schedules;
      DROP TABLE IF EXISTS subscription_billing_cycles;
      DROP TABLE IF EXISTS subscription_lines;
      DROP TABLE IF EXISTS subscriptions;
      DROP TABLE IF EXISTS subscription_plans;
    `);
  }
};
