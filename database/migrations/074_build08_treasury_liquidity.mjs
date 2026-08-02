// BUILD-08B: treasury projections, governed proposals and financing foundations.
'use strict';

const ENTITIES = [
  ['treasury_cash_position', 'مركز النقد', 'Treasury Cash Position'],
  ['liquidity_forecast', 'توقع السيولة', 'Liquidity Forecast'],
  ['treasury_alert', 'تنبيه الخزينة', 'Treasury Alert'],
  ['treasury_proposal', 'مقترح الخزينة', 'Treasury Proposal'],
  ['financing_facility', 'تسهيل تمويلي', 'Financing Facility'],
  ['bank_instrument', 'أداة مصرفية', 'Bank Instrument'],
];

const ACTIONS = [
  ['treasury:position_capture', 'treasury_cash_position'],
  ['treasury:liquidity_generate', 'liquidity_forecast'],
  ['treasury:alert_acknowledge', 'treasury_alert'],
  ['treasury:proposal_create', 'treasury_proposal'],
  ['treasury:proposal_approve', 'treasury_proposal'],
  ['treasury:facility_create', 'financing_facility'],
  ['treasury:facility_utilize', 'financing_facility'],
  ['treasury:instrument_register', 'bank_instrument'],
];

export const migration = {
  id: '074_build08_treasury_liquidity', parent: '073_build08_planning_mps_sop',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS treasury_cash_positions (
        id TEXT PRIMARY KEY, company_id TEXT NOT NULL, as_of_date TEXT NOT NULL,
        reporting_currency TEXT NOT NULL, total_cash REAL NOT NULL DEFAULT 0,
        restricted_cash REAL NOT NULL DEFAULT 0, available_cash REAL NOT NULL DEFAULT 0,
        pending_receipts REAL NOT NULL DEFAULT 0, pending_payments REAL NOT NULL DEFAULT 0,
        overdue_ar REAL NOT NULL DEFAULT 0, overdue_ap REAL NOT NULL DEFAULT 0,
        source_digest TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'sealed' CHECK(status='sealed'),
        created_by TEXT NOT NULL, created_at TEXT NOT NULL, idempotency_key TEXT UNIQUE
      );
      CREATE INDEX IF NOT EXISTS idx_cash_position_scope ON treasury_cash_positions(company_id,as_of_date);

      CREATE TABLE IF NOT EXISTS treasury_cash_position_lines (
        id TEXT PRIMARY KEY, position_id TEXT NOT NULL REFERENCES treasury_cash_positions(id) ON DELETE CASCADE,
        account_id TEXT NOT NULL, account_type TEXT NOT NULL CHECK(account_type IN ('bank','cash','restricted')),
        currency TEXT NOT NULL, balance REAL NOT NULL, reporting_balance REAL NOT NULL,
        fx_rate REAL NOT NULL DEFAULT 1, counterparty_id TEXT, UNIQUE(position_id,account_id,currency)
      );

      CREATE TABLE IF NOT EXISTS liquidity_forecasts_v2 (
        id TEXT PRIMARY KEY, company_id TEXT NOT NULL,
        position_id TEXT NOT NULL REFERENCES treasury_cash_positions(id),
        name TEXT NOT NULL, grain TEXT NOT NULL CHECK(grain IN ('daily','weekly','monthly')),
        start_date TEXT NOT NULL, end_date TEXT NOT NULL, currency TEXT NOT NULL,
        minimum_cash_threshold REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'calculated' CHECK(status IN ('calculated','review','published','superseded')),
        assumptions_json TEXT NOT NULL DEFAULT '[]', created_by TEXT NOT NULL,
        created_at TEXT NOT NULL, published_at TEXT, immutable_digest TEXT,
        idempotency_key TEXT UNIQUE
      );

      CREATE TABLE IF NOT EXISTS liquidity_forecast_buckets (
        id TEXT PRIMARY KEY, forecast_id TEXT NOT NULL REFERENCES liquidity_forecasts_v2(id) ON DELETE CASCADE,
        bucket_start TEXT NOT NULL, opening_cash REAL NOT NULL, expected_collections REAL NOT NULL DEFAULT 0,
        expected_payments REAL NOT NULL DEFAULT 0, financing_inflow REAL NOT NULL DEFAULT 0,
        transfer_net REAL NOT NULL DEFAULT 0, closing_cash REAL NOT NULL,
        restricted_cash REAL NOT NULL DEFAULT 0, available_cash REAL NOT NULL,
        currency_exposure_json TEXT NOT NULL DEFAULT '{}', counterparty_exposure_json TEXT NOT NULL DEFAULT '{}',
        UNIQUE(forecast_id,bucket_start)
      );

      CREATE TABLE IF NOT EXISTS treasury_alerts (
        id TEXT PRIMARY KEY, company_id TEXT NOT NULL, forecast_id TEXT REFERENCES liquidity_forecasts_v2(id),
        bucket_id TEXT REFERENCES liquidity_forecast_buckets(id), alert_type TEXT NOT NULL,
        severity TEXT NOT NULL CHECK(severity IN ('info','warning','critical')),
        threshold_amount REAL, observed_amount REAL, currency TEXT NOT NULL,
        message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','resolved')),
        acknowledged_by TEXT, acknowledged_at TEXT, created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS treasury_proposals (
        id TEXT PRIMARY KEY, company_id TEXT NOT NULL,
        proposal_type TEXT NOT NULL CHECK(proposal_type IN ('payment','collection','transfer','funding')),
        source_alert_id TEXT REFERENCES treasury_alerts(id), counterparty_id TEXT,
        source_account_id TEXT, target_account_id TEXT, amount REAL NOT NULL CHECK(amount > 0),
        currency TEXT NOT NULL, requested_date TEXT NOT NULL, rationale TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending_approval','approved','rejected','release_requested')),
        approved_by TEXT, approved_at TEXT, canonical_action TEXT, canonical_request_id TEXT,
        created_by TEXT NOT NULL, created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS financing_facilities (
        id TEXT PRIMARY KEY, company_id TEXT NOT NULL, lender_party_id TEXT NOT NULL,
        name TEXT NOT NULL, facility_type TEXT NOT NULL CHECK(facility_type IN ('overdraft','revolver','term_loan','trade_finance')),
        currency TEXT NOT NULL, limit_amount REAL NOT NULL CHECK(limit_amount >= 0),
        utilized_amount REAL NOT NULL DEFAULT 0 CHECK(utilized_amount >= 0),
        available_amount REAL NOT NULL DEFAULT 0 CHECK(available_amount >= 0),
        interest_rate REAL NOT NULL DEFAULT 0, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('draft','active','suspended','closed')),
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS financing_facility_utilizations (
        id TEXT PRIMARY KEY, facility_id TEXT NOT NULL REFERENCES financing_facilities(id),
        amount REAL NOT NULL CHECK(amount > 0), utilization_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','approved','cancelled')),
        reason TEXT NOT NULL, approved_by TEXT, approved_at TEXT, created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bank_instruments (
        id TEXT PRIMARY KEY, company_id TEXT NOT NULL,
        instrument_type TEXT NOT NULL CHECK(instrument_type IN ('letter_of_credit','bank_guarantee')),
        reference TEXT NOT NULL, bank_party_id TEXT NOT NULL, beneficiary_party_id TEXT NOT NULL,
        amount REAL NOT NULL CHECK(amount > 0), currency TEXT NOT NULL,
        issue_date TEXT, expiry_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','active','expired','released')),
        terms_json TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(company_id,reference)
      );
    `);
    const entity = db.prepare(`INSERT INTO platform_entities(id,module_id,storage_owner,primary_key,label_ar,label_en,section,chatter,fields,relations,scope,lifecycle_policy,query_policy,action_policy,customization_policy,history_policy,api_exposed,migration_owner,created_at,updated_at) VALUES(?,'platform_kernel','platform.treasury','id',?,?,'treasury',0,'{}','{}','company','governed','scoped','registered','metadata','audit',1,'074_build08_treasury_liquidity',datetime('now'),datetime('now')) ON CONFLICT(id) DO NOTHING`);
    ENTITIES.forEach(([entityId, ar, en]) => entity.run(entityId, ar, en));
    const action = db.prepare(`INSERT INTO platform_actions(id,module_id,entity_id,kind,allowed_states,required_permission,required_scope,input_schema,preconditions,transaction_owner,idempotency_policy,sequence_policy,audit_policy,outbox_policy,error_contract,created_at,updated_at) VALUES(?,'platform_kernel',?,'domain','[]','platform:db:write','company','{}','[]','platform_action_executor','required','none','required','required','{}',datetime('now'),datetime('now')) ON CONFLICT(id) DO NOTHING`);
    ACTIONS.forEach(([actionId, entityId]) => action.run(actionId, entityId));
  },
  down(db) {
    db.exec('DROP TABLE IF EXISTS bank_instruments; DROP TABLE IF EXISTS financing_facility_utilizations; DROP TABLE IF EXISTS financing_facilities; DROP TABLE IF EXISTS treasury_proposals; DROP TABLE IF EXISTS treasury_alerts; DROP TABLE IF EXISTS liquidity_forecast_buckets; DROP TABLE IF EXISTS liquidity_forecasts_v2; DROP TABLE IF EXISTS treasury_cash_position_lines; DROP TABLE IF EXISTS treasury_cash_positions;');
  },
};
