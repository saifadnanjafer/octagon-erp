// Migration 070: Planning, Treasury, Intercompany & Financial Consolidation
'use strict';

const ENTITIES = [
  ['planning_budget_scenario', 'سيناريو الموازنة والتخطيط', 'Planning Budget Scenario'],
  ['treasury_cash_forecast', 'توقعات الخزينة والسيولة', 'Treasury Cash Forecast'],
  ['intercompany_transaction', 'معاملة بين الشركات', 'Intercompany Transaction'],
  ['financial_consolidation', 'التجميع والتوطيد المالي', 'Financial Consolidation Run'],
];

const ACTIONS = [
  ['planning:scenario_create', 'planning_budget_scenario', 'platform:db:write', ['name', 'fiscal_year']],
  ['planning:scenario_activate', 'planning_budget_scenario', 'platform:db:write', ['scenario_id']],
  ['treasury:forecast_generate', 'treasury_cash_forecast', 'platform:db:write', ['forecast_date']],
  ['intercompany:transaction_create', 'intercompany_transaction', 'platform:db:write', ['source_company_id', 'target_company_id', 'amount']],
  ['intercompany:eliminate', 'intercompany_transaction', 'platform:db:write', ['transaction_id']],
  ['consolidation:run', 'financial_consolidation', 'platform:db:write', ['fiscal_period']],
];

export const migration = {
  id: '070_planning_and_advanced_finance',
  parent: '069_master_data_governance_and_quality',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS planning_budget_scenarios (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        name TEXT NOT NULL,
        fiscal_year INTEGER NOT NULL,
        scenario_type TEXT NOT NULL DEFAULT 'baseline' CHECK(scenario_type IN ('baseline','optimistic','pessimistic','custom')),
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','archived')),
        notes TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_budget_scenarios_scope ON planning_budget_scenarios(company_id, fiscal_year);

      CREATE TABLE IF NOT EXISTS planning_budget_lines (
        id TEXT PRIMARY KEY,
        scenario_id TEXT NOT NULL REFERENCES planning_budget_scenarios(id) ON DELETE CASCADE,
        account_id TEXT NOT NULL,
        cost_center_id TEXT,
        period_name TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0.0,
        currency TEXT NOT NULL DEFAULT 'IQD',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS treasury_cash_forecasts (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        forecast_date TEXT NOT NULL,
        account_id TEXT,
        direction TEXT NOT NULL CHECK(direction IN ('inflow','outflow')),
        estimated_amount REAL NOT NULL DEFAULT 0.0,
        currency TEXT NOT NULL DEFAULT 'IQD',
        source_type TEXT NOT NULL DEFAULT 'manual' CHECK(source_type IN ('ar_invoice','ap_invoice','recurring','manual')),
        confidence_level TEXT NOT NULL DEFAULT 'medium' CHECK(confidence_level IN ('high','medium','low')),
        status TEXT NOT NULL DEFAULT 'projected' CHECK(status IN ('projected','realized','cancelled')),
        notes TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_treasury_forecast_scope ON treasury_cash_forecasts(company_id, forecast_date);

      CREATE TABLE IF NOT EXISTS intercompany_transactions (
        id TEXT PRIMARY KEY,
        source_company_id TEXT NOT NULL,
        target_company_id TEXT NOT NULL,
        transaction_type TEXT NOT NULL DEFAULT 'transfer' CHECK(transaction_type IN ('transfer','recharge','loan')),
        amount REAL NOT NULL DEFAULT 0.0,
        currency TEXT NOT NULL DEFAULT 'IQD',
        reference TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','posted','eliminated')),
        elimination_entry_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS financial_consolidations (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL DEFAULT 'default_group',
        fiscal_period TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','completed')),
        eliminations_count INTEGER NOT NULL DEFAULT 0,
        net_consolidated_income REAL NOT NULL DEFAULT 0.0,
        executed_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    const addEntity = db.prepare(`
      INSERT INTO platform_entities (id,module_id,storage_owner,primary_key,label_ar,label_en,section,chatter,fields,relations,scope,lifecycle_policy,query_policy,action_policy,customization_policy,history_policy,api_exposed,migration_owner,created_at,updated_at)
      VALUES (?, 'platform_kernel', 'platform.kernel', 'id', ?, ?, 'finance', 0, '{}', '{}', 'company', 'generic', 'scoped', 'registered', 'metadata', 'audit', 1, '070_planning_and_advanced_finance', datetime('now'), datetime('now'))
      ON CONFLICT(id) DO NOTHING
    `);
    for (const [entityId, labelAr, labelEn] of ENTITIES) {
      addEntity.run(entityId, labelAr, labelEn);
    }

    const addAction = db.prepare(`
      INSERT INTO platform_actions (id,module_id,entity_id,kind,allowed_states,required_permission,required_scope,input_schema,preconditions,transaction_owner,idempotency_policy,sequence_policy,audit_policy,outbox_policy,reversal_action,result_schema,error_contract,created_at,updated_at)
      VALUES (?, 'platform_kernel', ?, 'domain', '[]', ?, 'company', ?, '[]', 'platform_action_executor', 'required', 'none', 'required', 'required', NULL, NULL, '{"envelope":"stable","rollback":"atomic"}', datetime('now'), datetime('now'))
      ON CONFLICT(id) DO NOTHING
    `);
    const now = new Date().toISOString();
    for (const [actId, entId, perm, req] of ACTIONS) {
      addAction.run(actId, entId, perm, JSON.stringify({ type: 'object', required: req }));
    }
  },

  down(db) {
    db.exec(`
      DROP TABLE IF EXISTS financial_consolidations;
      DROP TABLE IF EXISTS intercompany_transactions;
      DROP TABLE IF EXISTS treasury_cash_forecasts;
      DROP TABLE IF EXISTS planning_budget_lines;
      DROP TABLE IF EXISTS planning_budget_scenarios;
    `);
  },
};
