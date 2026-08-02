// BUILD-08A: governed demand planning, MPS and S&OP projections.
'use strict';

const ENTITIES = [
  ['planning_horizon', 'أفق التخطيط', 'Planning Horizon'],
  ['demand_history_snapshot', 'لقطة تاريخ الطلب', 'Demand History Snapshot'],
  ['forecast_version', 'إصدار التوقع', 'Forecast Version'],
  ['forecast_override', 'تجاوز التوقع', 'Forecast Override'],
  ['planning_exception', 'استثناء التخطيط', 'Planning Exception'],
  ['mps_run', 'تشغيل الجدول الرئيسي', 'Master Production Schedule Run'],
  ['supply_proposal', 'مقترح التوريد', 'Supply Proposal'],
  ['sop_cycle', 'دورة تخطيط المبيعات والعمليات', 'S&OP Cycle'],
];

const ACTIONS = [
  ['forecast:history_snapshot', 'demand_history_snapshot'],
  ['forecast:version_create', 'forecast_version'],
  ['forecast:calculate', 'forecast_version'],
  ['forecast:override_submit', 'forecast_override'],
  ['forecast:override_approve', 'forecast_override'],
  ['forecast:publish', 'forecast_version'],
  ['mps:run', 'mps_run'],
  ['mps:proposal_approve', 'supply_proposal'],
  ['mps:proposal_release_request', 'supply_proposal'],
  ['sop:cycle_create', 'sop_cycle'],
  ['sop:scenario_create', 'sop_cycle'],
  ['sop:review_approve', 'sop_cycle'],
  ['sop:publish', 'sop_cycle'],
];

export const migration = {
  id: '073_build08_planning_mps_sop',
  parent: '072_electronic_signature',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS planning_horizons (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        name TEXT NOT NULL,
        bucket_type TEXT NOT NULL CHECK(bucket_type IN ('day','week','month')),
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        frozen_until TEXT,
        planning_fence_until TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed')),
        created_at TEXT NOT NULL,
        UNIQUE(company_id,name,start_date)
      );

      CREATE TABLE IF NOT EXISTS demand_history_snapshots (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        horizon_id TEXT REFERENCES planning_horizons(id),
        source_cutoff TEXT NOT NULL,
        source_digest TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'sealed' CHECK(status = 'sealed'),
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        idempotency_key TEXT UNIQUE
      );
      CREATE INDEX IF NOT EXISTS idx_demand_snapshot_scope ON demand_history_snapshots(company_id,source_cutoff);

      CREATE TABLE IF NOT EXISTS demand_history_lines (
        id TEXT PRIMARY KEY,
        snapshot_id TEXT NOT NULL REFERENCES demand_history_snapshots(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL,
        bucket_start TEXT NOT NULL,
        quantity REAL NOT NULL CHECK(quantity >= 0),
        source_type TEXT NOT NULL DEFAULT 'sales_history',
        source_reference TEXT,
        UNIQUE(snapshot_id,product_id,bucket_start,source_reference)
      );

      CREATE TABLE IF NOT EXISTS forecast_versions (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        horizon_id TEXT NOT NULL REFERENCES planning_horizons(id),
        snapshot_id TEXT NOT NULL REFERENCES demand_history_snapshots(id),
        name TEXT NOT NULL,
        method TEXT NOT NULL CHECK(method IN ('manual','moving_average','weighted_moving_average','exponential_smoothing')),
        parameters_json TEXT NOT NULL DEFAULT '{}',
        assumptions_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','calculated','review','published','superseded')),
        revision INTEGER NOT NULL DEFAULT 1,
        published_at TEXT,
        published_by TEXT,
        immutable_digest TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id,name,revision)
      );
      CREATE INDEX IF NOT EXISTS idx_forecast_scope ON forecast_versions(company_id,status,horizon_id);

      CREATE TABLE IF NOT EXISTS forecast_lines (
        id TEXT PRIMARY KEY,
        version_id TEXT NOT NULL REFERENCES forecast_versions(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL,
        bucket_start TEXT NOT NULL,
        baseline_quantity REAL NOT NULL DEFAULT 0,
        approved_quantity REAL NOT NULL DEFAULT 0,
        actual_quantity REAL,
        absolute_error REAL,
        percentage_error REAL,
        bias REAL,
        UNIQUE(version_id,product_id,bucket_start)
      );

      CREATE TABLE IF NOT EXISTS forecast_overrides (
        id TEXT PRIMARY KEY,
        version_id TEXT NOT NULL REFERENCES forecast_versions(id) ON DELETE CASCADE,
        line_id TEXT NOT NULL REFERENCES forecast_lines(id) ON DELETE CASCADE,
        requested_quantity REAL NOT NULL CHECK(requested_quantity >= 0),
        reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
        requested_by TEXT NOT NULL,
        approved_by TEXT,
        requested_at TEXT NOT NULL,
        decided_at TEXT
      );

      CREATE TABLE IF NOT EXISTS planning_exceptions (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        exception_type TEXT NOT NULL,
        severity TEXT NOT NULL CHECK(severity IN ('info','warning','critical')),
        message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','resolved')),
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );

      CREATE TABLE IF NOT EXISTS mps_runs (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        horizon_id TEXT NOT NULL REFERENCES planning_horizons(id),
        forecast_version_id TEXT NOT NULL REFERENCES forecast_versions(id),
        status TEXT NOT NULL DEFAULT 'calculated' CHECK(status IN ('calculated','review','approved','superseded')),
        frozen_zone_end TEXT,
        planning_fence_end TEXT,
        assumptions_json TEXT NOT NULL DEFAULT '{}',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        idempotency_key TEXT UNIQUE
      );

      CREATE TABLE IF NOT EXISTS mps_lines (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES mps_runs(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL,
        bucket_start TEXT NOT NULL,
        beginning_inventory REAL NOT NULL DEFAULT 0,
        confirmed_demand REAL NOT NULL DEFAULT 0,
        forecast_demand REAL NOT NULL DEFAULT 0,
        safety_stock REAL NOT NULL DEFAULT 0,
        scheduled_receipts REAL NOT NULL DEFAULT 0,
        open_procurement REAL NOT NULL DEFAULT 0,
        open_production REAL NOT NULL DEFAULT 0,
        projected_available REAL NOT NULL DEFAULT 0,
        gross_requirement REAL NOT NULL DEFAULT 0,
        net_requirement REAL NOT NULL DEFAULT 0,
        capacity_required REAL NOT NULL DEFAULT 0,
        capacity_available REAL NOT NULL DEFAULT 0,
        warning_code TEXT,
        UNIQUE(run_id,product_id,bucket_start)
      );

      CREATE TABLE IF NOT EXISTS supply_proposals (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        mps_line_id TEXT NOT NULL REFERENCES mps_lines(id),
        proposal_type TEXT NOT NULL CHECK(proposal_type IN ('procurement','production')),
        product_id TEXT NOT NULL,
        quantity REAL NOT NULL CHECK(quantity > 0),
        required_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','approved','rejected','release_requested')),
        approval_reason TEXT,
        approved_by TEXT,
        approved_at TEXT,
        canonical_action TEXT,
        canonical_request_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sop_cycles (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        name TEXT NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','review','approved','published','revised')),
        revision INTEGER NOT NULL DEFAULT 1,
        published_at TEXT,
        published_by TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(company_id,name,revision)
      );

      CREATE TABLE IF NOT EXISTS sop_scenarios (
        id TEXT PRIMARY KEY,
        cycle_id TEXT NOT NULL REFERENCES sop_cycles(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        demand_quantity REAL NOT NULL DEFAULT 0,
        supply_quantity REAL NOT NULL DEFAULT 0,
        inventory_projection REAL NOT NULL DEFAULT 0,
        capacity_required REAL NOT NULL DEFAULT 0,
        capacity_available REAL NOT NULL DEFAULT 0,
        revenue_projection REAL NOT NULL DEFAULT 0,
        cost_projection REAL NOT NULL DEFAULT 0,
        actual_demand REAL,
        actual_supply REAL,
        assumptions_json TEXT NOT NULL DEFAULT '[]',
        gaps_json TEXT NOT NULL DEFAULT '[]',
        resolutions_json TEXT NOT NULL DEFAULT '[]',
        selected INTEGER NOT NULL DEFAULT 0 CHECK(selected IN (0,1)),
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sop_reviews (
        id TEXT PRIMARY KEY,
        cycle_id TEXT NOT NULL REFERENCES sop_cycles(id) ON DELETE CASCADE,
        decision TEXT NOT NULL CHECK(decision IN ('approve','revise','reject')),
        notes TEXT NOT NULL,
        reviewed_by TEXT NOT NULL,
        reviewed_at TEXT NOT NULL
      );
    `);

    const addEntity = db.prepare(`
      INSERT INTO platform_entities (id,module_id,storage_owner,primary_key,label_ar,label_en,section,chatter,fields,relations,scope,lifecycle_policy,query_policy,action_policy,customization_policy,history_policy,api_exposed,migration_owner,created_at,updated_at)
      VALUES (?, 'platform_kernel', 'platform.planning', 'id', ?, ?, 'planning', 0, '{}', '{}', 'company', 'governed', 'scoped', 'registered', 'metadata', 'audit', 1, '073_build08_planning_mps_sop', datetime('now'), datetime('now'))
      ON CONFLICT(id) DO NOTHING
    `);
    for (const [id, ar, en] of ENTITIES) addEntity.run(id, ar, en);

    const addAction = db.prepare(`
      INSERT INTO platform_actions(id,module_id,entity_id,kind,allowed_states,required_permission,required_scope,input_schema,preconditions,transaction_owner,idempotency_policy,sequence_policy,audit_policy,outbox_policy,error_contract,created_at,updated_at)
      VALUES(?,'platform_kernel',?,'domain','[]','platform:db:write','company','{}','[]','platform_action_executor','required','none','required','required','{}',datetime('now'),datetime('now'))
      ON CONFLICT(id) DO NOTHING
    `);
    for (const [id, entity] of ACTIONS) addAction.run(id, entity);
  },

  down(db) {
    db.exec(`
      DROP TABLE IF EXISTS sop_reviews;
      DROP TABLE IF EXISTS sop_scenarios;
      DROP TABLE IF EXISTS sop_cycles;
      DROP TABLE IF EXISTS supply_proposals;
      DROP TABLE IF EXISTS mps_lines;
      DROP TABLE IF EXISTS mps_runs;
      DROP TABLE IF EXISTS planning_exceptions;
      DROP TABLE IF EXISTS forecast_overrides;
      DROP TABLE IF EXISTS forecast_lines;
      DROP TABLE IF EXISTS forecast_versions;
      DROP TABLE IF EXISTS demand_history_lines;
      DROP TABLE IF EXISTS demand_history_snapshots;
      DROP TABLE IF EXISTS planning_horizons;
    `);
  },
};
