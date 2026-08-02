// BUILD-08C: strict intercompany operations and isolated consolidation ledger.
'use strict';

const ENTITIES = [
  ['intercompany_relationship', 'علاقة بين الشركات', 'Intercompany Relationship'],
  ['intercompany_operation', 'عملية بين الشركات', 'Intercompany Operation'],
  ['intercompany_mismatch', 'عدم تطابق بين الشركات', 'Intercompany Mismatch'],
  ['intercompany_reconciliation', 'تسوية بين الشركات', 'Intercompany Reconciliation'],
  ['consolidation_group', 'مجموعة التوحيد', 'Consolidation Group'],
  ['consolidation_account_mapping', 'خريطة حسابات التوحيد', 'Consolidation Account Mapping'],
  ['consolidation_run_v2', 'تشغيل التوحيد', 'Consolidation Run'],
  ['consolidation_elimination', 'قيد استبعاد توحيدي', 'Consolidation Elimination'],
];

const ACTIONS = [
  ['intercompany:relationship_create', 'intercompany_relationship'],
  ['intercompany:operation_create', 'intercompany_operation'],
  ['intercompany:operation_approve', 'intercompany_operation'],
  ['intercompany:mismatch_detect', 'intercompany_mismatch'],
  ['intercompany:reconcile', 'intercompany_reconciliation'],
  ['intercompany:settlement_propose', 'intercompany_reconciliation'],
  ['consolidation:group_create', 'consolidation_group'],
  ['consolidation:member_add', 'consolidation_group'],
  ['consolidation:mapping_upsert', 'consolidation_account_mapping'],
  ['consolidation:period_create', 'consolidation_run_v2'],
  ['consolidation:snapshot_capture', 'consolidation_run_v2'],
  ['consolidation:run_calculate', 'consolidation_run_v2'],
  ['consolidation:elimination_approve', 'consolidation_elimination'],
  ['consolidation:adjustment_add', 'consolidation_elimination'],
  ['consolidation:adjustment_approve', 'consolidation_elimination'],
  ['consolidation:finalize', 'consolidation_run_v2'],
];

export const migration = {
  id: '075_build08_intercompany_consolidation', parent: '074_build08_treasury_liquidity',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS intercompany_relationships_v2 (
        id TEXT PRIMARY KEY, company_a_id TEXT NOT NULL, company_b_id TEXT NOT NULL,
        relationship_type TEXT NOT NULL DEFAULT 'affiliate', allowed_types_json TEXT NOT NULL DEFAULT '[]',
        due_to_account_a TEXT NOT NULL, due_from_account_a TEXT NOT NULL,
        due_to_account_b TEXT NOT NULL, due_from_account_b TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('draft','active','suspended','closed')),
        created_by TEXT NOT NULL, created_at TEXT NOT NULL,
        CHECK(company_a_id <> company_b_id), UNIQUE(company_a_id,company_b_id)
      );

      CREATE TABLE IF NOT EXISTS intercompany_operations_v2 (
        id TEXT PRIMARY KEY, relationship_id TEXT NOT NULL REFERENCES intercompany_relationships_v2(id),
        source_company_id TEXT NOT NULL, target_company_id TEXT NOT NULL,
        transaction_type TEXT NOT NULL, source_document_type TEXT NOT NULL,
        source_document_id TEXT NOT NULL, reciprocal_document_type TEXT NOT NULL,
        reciprocal_document_id TEXT NOT NULL, reference TEXT NOT NULL,
        source_amount REAL NOT NULL CHECK(source_amount >= 0), reciprocal_amount REAL NOT NULL CHECK(reciprocal_amount >= 0),
        currency TEXT NOT NULL, service_allocation_json TEXT NOT NULL DEFAULT '{}',
        due_from_amount REAL NOT NULL, due_to_amount REAL NOT NULL,
        source_status TEXT NOT NULL DEFAULT 'pending' CHECK(source_status IN ('pending','approved','rejected')),
        reciprocal_status TEXT NOT NULL DEFAULT 'pending' CHECK(reciprocal_status IN ('pending','approved','rejected')),
        status TEXT NOT NULL DEFAULT 'pending_approval' CHECK(status IN ('pending_approval','approved','mismatched','reconciled','settlement_proposed','closed')),
        created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        idempotency_key TEXT UNIQUE
      );
      CREATE INDEX IF NOT EXISTS idx_ic_operation_source ON intercompany_operations_v2(source_company_id,status);
      CREATE INDEX IF NOT EXISTS idx_ic_operation_target ON intercompany_operations_v2(target_company_id,status);

      CREATE TABLE IF NOT EXISTS intercompany_mismatches_v2 (
        id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES intercompany_operations_v2(id),
        mismatch_type TEXT NOT NULL, source_value TEXT, reciprocal_value TEXT,
        difference_amount REAL NOT NULL DEFAULT 0, severity TEXT NOT NULL CHECK(severity IN ('warning','critical')),
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','reconciled','waived')),
        detected_at TEXT NOT NULL, resolved_at TEXT, UNIQUE(operation_id,mismatch_type,status)
      );

      CREATE TABLE IF NOT EXISTS intercompany_reconciliations_v2 (
        id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES intercompany_operations_v2(id),
        mismatch_id TEXT REFERENCES intercompany_mismatches_v2(id), resolution_type TEXT NOT NULL,
        resolution_amount REAL NOT NULL DEFAULT 0, notes TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('draft','approved','reversed')),
        approved_by TEXT NOT NULL, approved_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS intercompany_settlement_proposals (
        id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES intercompany_operations_v2(id),
        payer_company_id TEXT NOT NULL, payee_company_id TEXT NOT NULL,
        amount REAL NOT NULL CHECK(amount > 0), currency TEXT NOT NULL, requested_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','approved','release_requested','cancelled')),
        canonical_request_id TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS consolidation_groups_v2 (
        id TEXT PRIMARY KEY, parent_company_id TEXT NOT NULL, name TEXT NOT NULL,
        reporting_currency TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed')),
        created_by TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(parent_company_id,name)
      );

      CREATE TABLE IF NOT EXISTS consolidation_members_v2 (
        id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES consolidation_groups_v2(id),
        company_id TEXT NOT NULL, ownership_percentage REAL NOT NULL CHECK(ownership_percentage >= 0 AND ownership_percentage <= 100),
        consolidation_method TEXT NOT NULL CHECK(consolidation_method IN ('full','proportional','equity')),
        effective_from TEXT NOT NULL, effective_to TEXT, status TEXT NOT NULL DEFAULT 'active',
        UNIQUE(group_id,company_id,effective_from)
      );

      CREATE TABLE IF NOT EXISTS consolidation_account_mappings_v2 (
        id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES consolidation_groups_v2(id),
        company_id TEXT NOT NULL, source_account_code TEXT NOT NULL,
        target_account_code TEXT NOT NULL, target_account_name TEXT NOT NULL,
        statement_type TEXT NOT NULL CHECK(statement_type IN ('asset','liability','equity','income','expense')),
        intercompany_flag INTEGER NOT NULL DEFAULT 0 CHECK(intercompany_flag IN (0,1)),
        created_at TEXT NOT NULL, UNIQUE(group_id,company_id,source_account_code)
      );

      CREATE TABLE IF NOT EXISTS consolidation_translation_policies_v2 (
        id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES consolidation_groups_v2(id),
        statement_type TEXT NOT NULL, rate_type TEXT NOT NULL CHECK(rate_type IN ('closing','average','historical')),
        created_at TEXT NOT NULL, UNIQUE(group_id,statement_type)
      );

      CREATE TABLE IF NOT EXISTS consolidation_periods_v2 (
        id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES consolidation_groups_v2(id),
        period_name TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
        closing_rate_json TEXT NOT NULL DEFAULT '{}', average_rate_json TEXT NOT NULL DEFAULT '{}', historical_rate_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','review','locked')),
        created_at TEXT NOT NULL, UNIQUE(group_id,period_name)
      );

      CREATE TABLE IF NOT EXISTS consolidation_tb_snapshots_v2 (
        id TEXT PRIMARY KEY, period_id TEXT NOT NULL REFERENCES consolidation_periods_v2(id),
        company_id TEXT NOT NULL, source_currency TEXT NOT NULL, source_digest TEXT NOT NULL,
        debit_total REAL NOT NULL, credit_total REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'validated' CHECK(status IN ('validated','locked','rejected')),
        created_by TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(period_id,company_id)
      );

      CREATE TABLE IF NOT EXISTS consolidation_tb_lines_v2 (
        id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL REFERENCES consolidation_tb_snapshots_v2(id) ON DELETE CASCADE,
        source_account_code TEXT NOT NULL, debit REAL NOT NULL DEFAULT 0, credit REAL NOT NULL DEFAULT 0,
        counterparty_company_id TEXT, reference TEXT, UNIQUE(snapshot_id,source_account_code,counterparty_company_id,reference)
      );

      CREATE TABLE IF NOT EXISTS consolidation_runs_v2 (
        id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES consolidation_groups_v2(id),
        period_id TEXT NOT NULL REFERENCES consolidation_periods_v2(id), version INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'review' CHECK(status IN ('review','approved','locked','superseded')),
        validation_json TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL, created_at TEXT NOT NULL,
        finalized_by TEXT, finalized_at TEXT, UNIQUE(group_id,period_id,version)
      );

      CREATE TABLE IF NOT EXISTS consolidation_eliminations_v2 (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES consolidation_runs_v2(id),
        elimination_type TEXT NOT NULL, source_company_id TEXT, target_company_id TEXT,
        target_account_code TEXT NOT NULL, debit REAL NOT NULL DEFAULT 0, credit REAL NOT NULL DEFAULT 0,
        reference TEXT, status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','approved','rejected')),
        approved_by TEXT, approved_at TEXT, created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS consolidation_adjustments_v2 (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES consolidation_runs_v2(id),
        target_account_code TEXT NOT NULL, debit REAL NOT NULL DEFAULT 0, credit REAL NOT NULL DEFAULT 0,
        reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','approved','rejected')),
        approved_by TEXT, approved_at TEXT, created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS consolidation_balances_v2 (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES consolidation_runs_v2(id),
        target_account_code TEXT NOT NULL, target_account_name TEXT NOT NULL, statement_type TEXT NOT NULL,
        translated_debit REAL NOT NULL DEFAULT 0, translated_credit REAL NOT NULL DEFAULT 0,
        elimination_debit REAL NOT NULL DEFAULT 0, elimination_credit REAL NOT NULL DEFAULT 0,
        adjustment_debit REAL NOT NULL DEFAULT 0, adjustment_credit REAL NOT NULL DEFAULT 0,
        consolidated_balance REAL NOT NULL DEFAULT 0, UNIQUE(run_id,target_account_code)
      );

      CREATE TABLE IF NOT EXISTS consolidation_lineage_v2 (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES consolidation_runs_v2(id),
        balance_id TEXT NOT NULL REFERENCES consolidation_balances_v2(id), snapshot_id TEXT,
        source_line_id TEXT, elimination_id TEXT, adjustment_id TEXT,
        contribution_amount REAL NOT NULL, lineage_type TEXT NOT NULL, created_at TEXT NOT NULL
      );
    `);
    const entity = db.prepare(`INSERT INTO platform_entities(id,module_id,storage_owner,primary_key,label_ar,label_en,section,chatter,fields,relations,scope,lifecycle_policy,query_policy,action_policy,customization_policy,history_policy,api_exposed,migration_owner,created_at,updated_at) VALUES(?,'platform_kernel','platform.consolidation','id',?,?,'consolidation',0,'{}','{}','company','governed','scoped','registered','metadata','audit',1,'075_build08_intercompany_consolidation',datetime('now'),datetime('now')) ON CONFLICT(id) DO NOTHING`);
    ENTITIES.forEach(([entityId, ar, en]) => entity.run(entityId, ar, en));
    const action = db.prepare(`INSERT INTO platform_actions(id,module_id,entity_id,kind,allowed_states,required_permission,required_scope,input_schema,preconditions,transaction_owner,idempotency_policy,sequence_policy,audit_policy,outbox_policy,error_contract,created_at,updated_at) VALUES(?,'platform_kernel',?,'domain','[]','platform:db:write','company','{}','[]','platform_action_executor','required','none','required','required','{}',datetime('now'),datetime('now')) ON CONFLICT(id) DO NOTHING`);
    ACTIONS.forEach(([actionId, entityId]) => action.run(actionId, entityId));
  },
  down(db) {
    db.exec('DROP TABLE IF EXISTS consolidation_lineage_v2; DROP TABLE IF EXISTS consolidation_balances_v2; DROP TABLE IF EXISTS consolidation_adjustments_v2; DROP TABLE IF EXISTS consolidation_eliminations_v2; DROP TABLE IF EXISTS consolidation_runs_v2; DROP TABLE IF EXISTS consolidation_tb_lines_v2; DROP TABLE IF EXISTS consolidation_tb_snapshots_v2; DROP TABLE IF EXISTS consolidation_periods_v2; DROP TABLE IF EXISTS consolidation_translation_policies_v2; DROP TABLE IF EXISTS consolidation_account_mappings_v2; DROP TABLE IF EXISTS consolidation_members_v2; DROP TABLE IF EXISTS consolidation_groups_v2; DROP TABLE IF EXISTS intercompany_settlement_proposals; DROP TABLE IF EXISTS intercompany_reconciliations_v2; DROP TABLE IF EXISTS intercompany_mismatches_v2; DROP TABLE IF EXISTS intercompany_operations_v2; DROP TABLE IF EXISTS intercompany_relationships_v2;');
  },
};
