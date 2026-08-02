// Migration 069: Master Data Governance & Data Quality Management
'use strict';

const ENTITIES = [
  ['mdg_stewardship_policy', 'سياسات حوكمة البيانات الأساسية', 'Master Data Stewardship Policy'],
  ['mdg_duplicate_candidate', 'مرشحات السجلات المكررة', 'MDG Duplicate Candidate'],
  ['mdg_merge_proposal', 'مقترحات دمج السجلات', 'MDG Merge Proposal'],
  ['dq_rule', 'قواعد جودة البيانات', 'Data Quality Rule'],
  ['dq_scan_run', 'دورات فحص جودة البيانات', 'Data Quality Scan Run'],
  ['dq_exception', 'استثناءات وأخطاء جودة البيانات', 'Data Quality Exception'],
  ['dq_waiver', 'اعفاءات وتجاوزات جودة البيانات', 'Data Quality Waiver'],
];

const ACTIONS = [
  ['mdg:candidate_detect', 'mdg_duplicate_candidate', 'platform:db:write', ['entity_type']],
  ['mdg:survivorship_propose', 'mdg_merge_proposal', 'platform:db:write', ['candidate_id']],
  ['mdg:merge_approve', 'mdg_merge_proposal', 'platform:db:write', ['proposal_id']],
  ['mdg:merge_reject', 'mdg_merge_proposal', 'platform:db:write', ['proposal_id']],
  ['dq:rule_publish', 'dq_rule', 'platform:db:write', ['rule_code']],
  ['dq:scan_run', 'dq_scan_run', 'platform:db:write', ['entity_type']],
  ['dq:exception_assign', 'dq_exception', 'platform:db:write', ['exception_id']],
  ['dq:waiver_request', 'dq_waiver', 'platform:db:write', ['exception_id']],
  ['dq:waiver_approve', 'dq_waiver', 'platform:db:write', ['waiver_id']],
];

export const migration = {
  id: '069_master_data_governance_and_quality',
  parent: '068_platform_services_and_commercial_expansion',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS mdg_stewardship_policies (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        entity_type TEXT NOT NULL,
        data_owner_id TEXT NOT NULL,
        data_steward_id TEXT NOT NULL,
        required_fields TEXT NOT NULL DEFAULT '[]',
        duplicate_rules TEXT NOT NULL DEFAULT '{}',
        survivorship_policy TEXT NOT NULL DEFAULT 'newest',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mdg_duplicate_candidates (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        entity_type TEXT NOT NULL,
        primary_record_id TEXT NOT NULL,
        candidate_record_id TEXT NOT NULL,
        confidence_score REAL NOT NULL DEFAULT 0.0,
        match_evidence TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed_duplicate','rejected','merged')),
        steward_notes TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mdg_duplicates_scope ON mdg_duplicate_candidates(company_id, entity_type, status);

      CREATE TABLE IF NOT EXISTS mdg_merge_proposals (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        entity_type TEXT NOT NULL,
        surviving_record_id TEXT NOT NULL,
        merged_record_id TEXT NOT NULL,
        field_resolutions TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','approved','rejected','executed')),
        proposed_by TEXT NOT NULL,
        approved_by TEXT,
        rejection_reason TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS dq_rules (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        rule_code TEXT NOT NULL,
        name TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        dimension TEXT NOT NULL CHECK(dimension IN ('completeness','validity','uniqueness','consistency','timeliness')),
        severity TEXT NOT NULL DEFAULT 'medium' CHECK(severity IN ('low','medium','high','critical')),
        condition_expression TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('draft','active','retired')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_dq_rules_code ON dq_rules(company_id, rule_code);

      CREATE TABLE IF NOT EXISTS dq_scan_runs (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        scanned_entities TEXT NOT NULL DEFAULT '[]',
        records_scanned INTEGER NOT NULL DEFAULT 0,
        exceptions_found INTEGER NOT NULL DEFAULT 0,
        overall_score REAL NOT NULL DEFAULT 100.0,
        triggered_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS dq_exceptions (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        rule_id TEXT NOT NULL REFERENCES dq_rules(id),
        entity_type TEXT NOT NULL,
        record_id TEXT NOT NULL,
        severity TEXT NOT NULL,
        assigned_owner TEXT,
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_remediation','waived','resolved')),
        due_date TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_dq_exceptions_scope ON dq_exceptions(company_id, entity_type, status);

      CREATE TABLE IF NOT EXISTS dq_waivers (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        exception_id TEXT NOT NULL REFERENCES dq_exceptions(id),
        requested_by TEXT NOT NULL,
        approved_by TEXT,
        reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','approved','rejected')),
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    const addEntity = db.prepare(`
      INSERT INTO platform_entities (id,module_id,storage_owner,primary_key,label_ar,label_en,section,chatter,fields,relations,scope,lifecycle_policy,query_policy,action_policy,customization_policy,history_policy,api_exposed,migration_owner,created_at,updated_at)
      VALUES (?, 'platform_kernel', 'platform.kernel', 'id', ?, ?, 'platform', 0, '{}', '{}', 'company', 'generic', 'scoped', 'registered', 'metadata', 'audit', 1, '069_master_data_governance_and_quality', datetime('now'), datetime('now'))
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
      DROP TABLE IF EXISTS dq_waivers;
      DROP TABLE IF EXISTS dq_exceptions;
      DROP TABLE IF EXISTS dq_scan_runs;
      DROP TABLE IF EXISTS dq_rules;
      DROP TABLE IF EXISTS mdg_merge_proposals;
      DROP TABLE IF EXISTS mdg_duplicate_candidates;
      DROP TABLE IF EXISTS mdg_stewardship_policies;
    `);
  },
};
