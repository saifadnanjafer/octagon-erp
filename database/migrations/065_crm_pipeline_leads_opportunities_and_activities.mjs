// 065_crm_pipeline_leads_opportunities_and_activities.mjs — Wave 1, M2 (CRM).
//
// EXTENDS the CRM that already exists. It does not replace it.
//
// `crm_leads` and `crm_activities` were created by 039_crm_sales_contracts_commissions;
// `crm_opportunities` and `crm_opportunity_activities` by 046_sales_lifecycle_expansion.
// A previous attempt at this migration used CREATE TABLE IF NOT EXISTS and would
// have built a second, parallel CRM with a different column vocabulary — two lead
// tables, two answers to "who is this customer". That draft was withdrawn; see
// docs/evidence/module-expansion-wave-1/crm.md.
//
// So: ALTER the three existing tables to carry the facts they lack, and CREATE
// only the configuration and lineage tables that genuinely do not exist. The
// existing vocabulary is preserved — `name`, `stage`, `status`, `expected_value`,
// `version` all keep their meaning, and nothing already reading them breaks.
//
// `crm_opportunities.version` already exists and is the optimistic-concurrency
// token; the concurrency suite uses it rather than inventing a second guard.
// `sale_orders.source_opportunity_id` already exists and is the Sales linkage.
//
// Migrations 001-064 are historical and are not edited.
// Dialect: SQLite and PostgreSQL — ADD COLUMN with constant defaults only.

const MIGRATION_ID = '065_crm_pipeline_leads_opportunities_and_activities';
const MODULE_ID = 'crm';

/** Idempotent ADD COLUMN — safe to re-run and safe on databases that already have it. */
function addColumn(db, table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name);
  if (cols.includes(column)) return false;
  db.exec(`ALTER TABLE "${table}" ADD COLUMN ${column} ${definition};`);
  return true;
}

const LEAD_COLUMNS = [
  ['reference', "TEXT NOT NULL DEFAULT ''"],
  ['branch_id', 'TEXT'],
  ['organization_name', "TEXT NOT NULL DEFAULT ''"],
  ['alt_contact', "TEXT NOT NULL DEFAULT ''"],
  ['city', "TEXT NOT NULL DEFAULT ''"],
  ['country', "TEXT NOT NULL DEFAULT ''"],
  ['address', "TEXT NOT NULL DEFAULT ''"],
  ['currency', "TEXT NOT NULL DEFAULT 'IQD'"],
  ['source_id', 'TEXT'],
  ['campaign_id', 'TEXT'],
  ['team_id', 'TEXT'],
  ['product_interest', "TEXT NOT NULL DEFAULT '[]'"],
  ['score', 'INTEGER NOT NULL DEFAULT 0'],
  ['score_explanation', "TEXT NOT NULL DEFAULT '[]'"],
  ['qualification_status', "TEXT NOT NULL DEFAULT 'pending'"],
  ['qualified_at', 'TEXT'],
  ['qualified_by', 'TEXT'],
  ['disqualified_at', 'TEXT'],
  ['disqualify_reason_id', 'TEXT'],
  ['converted_at', 'TEXT'],
  ['converted_by', 'TEXT'],
  ['converted_party_id', 'TEXT'],
  ['converted_opportunity_id', 'TEXT'],
  ['duplicate_state', "TEXT NOT NULL DEFAULT 'unchecked'"],
  ['duplicate_of_lead_id', 'TEXT'],
  ['merged_into_lead_id', 'TEXT'],
  ['notes', "TEXT NOT NULL DEFAULT ''"],
  ['last_interaction_at', 'TEXT'],
  ['next_activity_at', 'TEXT'],
  ['archived', 'INTEGER NOT NULL DEFAULT 0'],
  ['archived_at', 'TEXT'],
  ['version', 'INTEGER NOT NULL DEFAULT 1'],
  ['created_by', "TEXT NOT NULL DEFAULT 'system'"],
  ['updated_by', "TEXT NOT NULL DEFAULT 'system'"],
];

const OPPORTUNITY_COLUMNS = [
  ['reference', "TEXT NOT NULL DEFAULT ''"],
  ['pipeline_id', 'TEXT'],
  ['stage_id', 'TEXT'],
  ['team_id', 'TEXT'],
  ['source_id', 'TEXT'],
  ['campaign_id', 'TEXT'],
  ['segment_id', 'TEXT'],
  ['currency', "TEXT NOT NULL DEFAULT 'IQD'"],
  ['weighted_revenue', 'REAL NOT NULL DEFAULT 0'],
  ['product_interest', "TEXT NOT NULL DEFAULT '[]'"],
  ['quotation_order_id', 'TEXT'],
  ['sale_order_id', 'TEXT'],
  ['quotation_requested_at', 'TEXT'],
  ['won_at', 'TEXT'],
  ['won_evidence', "TEXT NOT NULL DEFAULT ''"],
  ['won_override_reason', "TEXT NOT NULL DEFAULT ''"],
  ['lost_at', 'TEXT'],
  ['lost_reason_id', 'TEXT'],
  ['reopened_at', 'TEXT'],
  ['reopen_count', 'INTEGER NOT NULL DEFAULT 0'],
  ['archived', 'INTEGER NOT NULL DEFAULT 0'],
  ['archived_at', 'TEXT'],
  ['created_by', "TEXT NOT NULL DEFAULT 'system'"],
  ['updated_by', "TEXT NOT NULL DEFAULT 'system'"],
];

const ACTIVITY_COLUMNS = [
  ['company_id', "TEXT NOT NULL DEFAULT '*'"],
  ['opportunity_id', 'TEXT'],
  ['party_id', 'TEXT'],
  ['detail', "TEXT NOT NULL DEFAULT ''"],
  ['assigned_user_id', 'TEXT'],
  ['state', "TEXT NOT NULL DEFAULT 'planned'"],
  ['priority', "TEXT NOT NULL DEFAULT 'normal'"],
  ['due_at', 'TEXT'],
  ['completed_at', 'TEXT'],
  ['completed_by', 'TEXT'],
  ['outcome', "TEXT NOT NULL DEFAULT ''"],
  ['work_item_id', 'TEXT'],
  ['cancelled_at', 'TEXT'],
  ['created_by', "TEXT NOT NULL DEFAULT 'system'"],
  ['updated_at', 'TEXT'],
];

export const migration = {
  id: MIGRATION_ID,
  owner: 'octagon.crm',
  version: '1.44.0',
  parent: '064_module_expansion_wave1_registry',
  dependsOn: ['064_module_expansion_wave1_registry'],
  dialect: ['sqlite', 'postgres'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance:
    'Wave 1 M2 — extends the CRM created by migrations 039 and 046 with pipelines, stages, teams, sources, campaigns, segments, competitors, lost reasons, tags, interactions, stage history, conversion lineage and scoring; adds the missing columns to crm_leads, crm_opportunities and crm_activities without replacing them.',

  up(db) {
    const now = new Date().toISOString();

    // ---- Extend the existing tables ---------------------------------------
    for (const [c, d] of LEAD_COLUMNS) addColumn(db, 'crm_leads', c, d);
    for (const [c, d] of OPPORTUNITY_COLUMNS) addColumn(db, 'crm_opportunities', c, d);
    for (const [c, d] of ACTIVITY_COLUMNS) addColumn(db, 'crm_activities', c, d);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_crm_lead_reference ON crm_leads(company_id, reference);
      CREATE INDEX IF NOT EXISTS idx_crm_lead_stage ON crm_leads(company_id, stage, archived);
      CREATE INDEX IF NOT EXISTS idx_crm_lead_email ON crm_leads(company_id, email);
      CREATE INDEX IF NOT EXISTS idx_crm_lead_phone ON crm_leads(company_id, phone);
      CREATE INDEX IF NOT EXISTS idx_crm_lead_owner ON crm_leads(salesperson_id, stage);
      CREATE INDEX IF NOT EXISTS idx_crm_opp_reference ON crm_opportunities(company_id, reference);
      CREATE INDEX IF NOT EXISTS idx_crm_opp_stage ON crm_opportunities(pipeline_id, stage_id);
      CREATE INDEX IF NOT EXISTS idx_crm_opp_party ON crm_opportunities(party_id);
      CREATE INDEX IF NOT EXISTS idx_crm_opp_status ON crm_opportunities(company_id, status, archived);
      CREATE INDEX IF NOT EXISTS idx_crm_activity_assignee ON crm_activities(assigned_user_id, state, due_at);
      CREATE INDEX IF NOT EXISTS idx_crm_activity_opp ON crm_activities(opportunity_id);
    `);

    // ---- Configuration -----------------------------------------------------
    db.exec(`
      CREATE TABLE IF NOT EXISTS crm_sales_teams (
        id TEXT PRIMARY KEY, company_id TEXT NOT NULL DEFAULT '*', branch_id TEXT,
        code TEXT NOT NULL, name_ar TEXT NOT NULL, name_en TEXT NOT NULL,
        leader_user_id TEXT, is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_team_code ON crm_sales_teams(company_id, code);

      CREATE TABLE IF NOT EXISTS crm_team_members (
        id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES crm_sales_teams(id),
        user_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member',
        is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_team_member ON crm_team_members(team_id, user_id);

      CREATE TABLE IF NOT EXISTS crm_pipelines (
        id TEXT PRIMARY KEY, company_id TEXT NOT NULL DEFAULT '*', branch_id TEXT,
        code TEXT NOT NULL, name_ar TEXT NOT NULL, name_en TEXT NOT NULL,
        team_id TEXT REFERENCES crm_sales_teams(id),
        is_default INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_pipeline_code ON crm_pipelines(company_id, code);

      CREATE TABLE IF NOT EXISTS crm_pipeline_stages (
        id TEXT PRIMARY KEY, pipeline_id TEXT NOT NULL REFERENCES crm_pipelines(id),
        code TEXT NOT NULL, name_ar TEXT NOT NULL, name_en TEXT NOT NULL,
        sequence INTEGER NOT NULL DEFAULT 0, probability REAL NOT NULL DEFAULT 0,
        colour_token TEXT NOT NULL DEFAULT 'neutral',
        is_won INTEGER NOT NULL DEFAULT 0, is_lost INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_stage_code ON crm_pipeline_stages(pipeline_id, code);
      CREATE INDEX IF NOT EXISTS idx_crm_stage_seq ON crm_pipeline_stages(pipeline_id, sequence);

      CREATE TABLE IF NOT EXISTS crm_lead_sources (
        id TEXT PRIMARY KEY, company_id TEXT NOT NULL DEFAULT '*', code TEXT NOT NULL,
        name_ar TEXT NOT NULL, name_en TEXT NOT NULL, score_weight INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_source_code ON crm_lead_sources(company_id, code);

      CREATE TABLE IF NOT EXISTS crm_campaigns (
        id TEXT PRIMARY KEY, company_id TEXT NOT NULL DEFAULT '*', code TEXT NOT NULL,
        name_ar TEXT NOT NULL, name_en TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'other',
        start_date TEXT, end_date TEXT, budget REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'IQD', state TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_campaign_code ON crm_campaigns(company_id, code);

      CREATE TABLE IF NOT EXISTS crm_customer_segments (
        id TEXT PRIMARY KEY, company_id TEXT NOT NULL DEFAULT '*', code TEXT NOT NULL,
        name_ar TEXT NOT NULL, name_en TEXT NOT NULL, criteria TEXT NOT NULL DEFAULT '{}',
        score_weight INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_segment_code ON crm_customer_segments(company_id, code);

      CREATE TABLE IF NOT EXISTS crm_competitors (
        id TEXT PRIMARY KEY, company_id TEXT NOT NULL DEFAULT '*', name TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '', is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_competitor_name ON crm_competitors(company_id, name);

      CREATE TABLE IF NOT EXISTS crm_lost_reasons (
        id TEXT PRIMARY KEY, company_id TEXT NOT NULL DEFAULT '*', code TEXT NOT NULL,
        name_ar TEXT NOT NULL, name_en TEXT NOT NULL, applies_to TEXT NOT NULL DEFAULT 'both',
        is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_lost_reason_code ON crm_lost_reasons(company_id, code);

      CREATE TABLE IF NOT EXISTS crm_tags (
        id TEXT PRIMARY KEY, company_id TEXT NOT NULL DEFAULT '*', name TEXT NOT NULL,
        colour_token TEXT NOT NULL DEFAULT 'neutral', created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_tag_name ON crm_tags(company_id, name);

      CREATE TABLE IF NOT EXISTS crm_lead_tags (
        lead_id TEXT NOT NULL, tag_id TEXT NOT NULL REFERENCES crm_tags(id),
        created_at TEXT NOT NULL, PRIMARY KEY (lead_id, tag_id)
      );
      CREATE TABLE IF NOT EXISTS crm_opportunity_tags (
        opportunity_id TEXT NOT NULL, tag_id TEXT NOT NULL REFERENCES crm_tags(id),
        created_at TEXT NOT NULL, PRIMARY KEY (opportunity_id, tag_id)
      );
      CREATE TABLE IF NOT EXISTS crm_opportunity_competitors (
        opportunity_id TEXT NOT NULL, competitor_id TEXT NOT NULL REFERENCES crm_competitors(id),
        threat_level TEXT NOT NULL DEFAULT 'unknown', notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL, PRIMARY KEY (opportunity_id, competitor_id)
      );
    `);

    // ---- Lineage, history, interactions, scoring ---------------------------
    db.exec(`
      CREATE TABLE IF NOT EXISTS crm_interactions (
        id TEXT PRIMARY KEY, company_id TEXT NOT NULL DEFAULT '*',
        party_id TEXT, lead_id TEXT, opportunity_id TEXT,
        channel TEXT NOT NULL DEFAULT 'note', direction TEXT NOT NULL DEFAULT 'outbound',
        occurred_at TEXT NOT NULL, summary TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
        recorded_by TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_crm_interaction_party ON crm_interactions(party_id, occurred_at);
      CREATE INDEX IF NOT EXISTS idx_crm_interaction_lead ON crm_interactions(lead_id, occurred_at);

      CREATE TABLE IF NOT EXISTS crm_stage_history (
        id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL,
        from_stage_id TEXT, to_stage_id TEXT NOT NULL,
        from_probability REAL, to_probability REAL,
        from_status TEXT, to_status TEXT,
        duration_seconds INTEGER,
        changed_at TEXT NOT NULL, changed_by TEXT NOT NULL, note TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_crm_stage_history_opp ON crm_stage_history(opportunity_id, changed_at);

      CREATE TABLE IF NOT EXISTS crm_conversion_links (
        id TEXT PRIMARY KEY, company_id TEXT NOT NULL DEFAULT '*',
        lead_id TEXT NOT NULL, party_id TEXT NOT NULL, opportunity_id TEXT NOT NULL,
        party_was_created INTEGER NOT NULL DEFAULT 0, match_basis TEXT NOT NULL DEFAULT 'none',
        idempotency_key TEXT, converted_at TEXT NOT NULL, converted_by TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_conversion_lead ON crm_conversion_links(lead_id);
      CREATE INDEX IF NOT EXISTS idx_crm_conversion_party ON crm_conversion_links(party_id);

      CREATE TABLE IF NOT EXISTS crm_scoring_rules (
        id TEXT PRIMARY KEY, company_id TEXT NOT NULL DEFAULT '*', code TEXT NOT NULL,
        name_ar TEXT NOT NULL, name_en TEXT NOT NULL, factor TEXT NOT NULL,
        comparator TEXT NOT NULL DEFAULT 'present', operand TEXT NOT NULL DEFAULT '',
        points INTEGER NOT NULL DEFAULT 0, sequence INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_scoring_code ON crm_scoring_rules(company_id, code);

      CREATE TABLE IF NOT EXISTS crm_score_history (
        id TEXT PRIMARY KEY, lead_id TEXT NOT NULL,
        old_score INTEGER NOT NULL DEFAULT 0, new_score INTEGER NOT NULL DEFAULT 0,
        explanation TEXT NOT NULL DEFAULT '[]', source TEXT NOT NULL DEFAULT 'rules',
        changed_at TEXT NOT NULL, changed_by TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_crm_score_history_lead ON crm_score_history(lead_id, changed_at);
    `);

    // ---- Seed the default pipeline -----------------------------------------
    // A CRM with no pipeline cannot accept a conversion, so one is seeded. Codes
    // are stable; labels are bilingual.
    const seedPipeline = db.prepare(`
      INSERT INTO crm_pipelines (id, company_id, code, name_ar, name_en, is_default, is_active, created_at, updated_at)
      VALUES ('crm_pipe_default', '*', 'DEFAULT', 'مسار المبيعات الافتراضي', 'Default Sales Pipeline', 1, 1, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `);
    seedPipeline.run(now, now);

    const seedStage = db.prepare(`
      INSERT INTO crm_pipeline_stages
        (id, pipeline_id, code, name_ar, name_en, sequence, probability, colour_token, is_won, is_lost, is_active, created_at, updated_at)
      VALUES (?, 'crm_pipe_default', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `);
    for (const [id, code, ar, en, seq, prob, colour, won, lost] of [
      ['crm_stage_new', 'NEW', 'جديد', 'New', 0, 10, 'info', 0, 0],
      ['crm_stage_qualify', 'QUALIFY', 'تأهيل', 'Qualification', 1, 25, 'info', 0, 0],
      ['crm_stage_proposal', 'PROPOSAL', 'عرض سعر', 'Proposal', 2, 50, 'warning', 0, 0],
      ['crm_stage_negotiation', 'NEGOTIATION', 'تفاوض', 'Negotiation', 3, 75, 'warning', 0, 0],
      ['crm_stage_won', 'WON', 'مكسوبة', 'Won', 4, 100, 'success', 1, 0],
      ['crm_stage_lost', 'LOST', 'خاسرة', 'Lost', 5, 0, 'danger', 0, 1],
    ]) {
      seedStage.run(id, code, ar, en, seq, prob, colour, won, lost, now, now);
    }

    const seedSource = db.prepare(`
      INSERT INTO crm_lead_sources (id, company_id, code, name_ar, name_en, score_weight, is_active, created_at)
      VALUES (?, '*', ?, ?, ?, ?, 1, ?) ON CONFLICT(id) DO NOTHING
    `);
    for (const [id, code, ar, en, w] of [
      ['crm_src_walkin', 'WALK_IN', 'زيارة مباشرة', 'Walk-in', 15],
      ['crm_src_referral', 'REFERRAL', 'ترشيح عميل', 'Referral', 20],
      ['crm_src_phone', 'PHONE', 'اتصال هاتفي', 'Phone', 10],
      ['crm_src_whatsapp', 'WHATSAPP', 'واتساب', 'WhatsApp', 10],
      ['crm_src_website', 'WEBSITE', 'الموقع الإلكتروني', 'Website', 8],
      ['crm_src_other', 'OTHER', 'أخرى', 'Other', 0],
    ]) seedSource.run(id, code, ar, en, w, now);

    const seedLost = db.prepare(`
      INSERT INTO crm_lost_reasons (id, company_id, code, name_ar, name_en, applies_to, is_active, created_at)
      VALUES (?, '*', ?, ?, ?, 'both', 1, ?) ON CONFLICT(id) DO NOTHING
    `);
    for (const [id, code, ar, en] of [
      ['crm_lost_price', 'PRICE', 'السعر مرتفع', 'Price too high'],
      ['crm_lost_competitor', 'COMPETITOR', 'اختار منافساً', 'Chose a competitor'],
      ['crm_lost_timing', 'TIMING', 'التوقيت غير مناسب', 'Timing not right'],
      ['crm_lost_no_budget', 'NO_BUDGET', 'لا توجد ميزانية', 'No budget'],
      ['crm_lost_no_response', 'NO_RESPONSE', 'لا يوجد رد', 'No response'],
      ['crm_lost_capability', 'CAPABILITY', 'خارج قدرات الورشة', 'Outside our capability'],
    ]) seedLost.run(id, code, ar, en, now);

    // Deterministic, explainable default scoring rules.
    const seedRule = db.prepare(`
      INSERT INTO crm_scoring_rules
        (id, company_id, code, name_ar, name_en, factor, comparator, operand, points, sequence, is_active, created_at, updated_at)
      VALUES (?, '*', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?) ON CONFLICT(id) DO NOTHING
    `);
    for (const [id, code, ar, en, factor, cmp, operand, pts, seq] of [
      ['crm_rule_email', 'HAS_EMAIL', 'يوجد بريد إلكتروني', 'Has email', 'email', 'present', '', 10, 0],
      ['crm_rule_phone', 'HAS_PHONE', 'يوجد رقم هاتف', 'Has phone', 'phone', 'present', '', 15, 1],
      ['crm_rule_org', 'HAS_ORG', 'جهة/شركة معروفة', 'Has organization', 'organization_name', 'present', '', 10, 2],
      ['crm_rule_value_high', 'VALUE_HIGH', 'قيمة متوقعة عالية', 'High expected value', 'expected_revenue', 'gte', '1000000', 25, 3],
      ['crm_rule_value_mid', 'VALUE_MID', 'قيمة متوقعة متوسطة', 'Medium expected value', 'expected_revenue', 'gte', '250000', 15, 4],
      ['crm_rule_source', 'SOURCE_WEIGHT', 'وزن مصدر العميل', 'Lead source weight', 'source_weight', 'weight', '', 0, 5],
      ['crm_rule_interaction', 'HAS_INTERACTION', 'يوجد تواصل مسجّل', 'Has recorded interaction', 'interaction_count', 'gte', '1', 10, 6],
      ['crm_rule_duplicate', 'DUPLICATE_RISK', 'اشتباه تكرار', 'Duplicate risk', 'duplicate_state', 'equals', 'suspected', -20, 7],
    ]) seedRule.run(id, code, ar, en, factor, cmp, operand, pts, seq, now, now);

    // ---- Entity registration + lifecycle -----------------------------------
    const entity = db.prepare(`
      INSERT INTO platform_entities (
        id, module_id, storage_owner, primary_key, label_ar, label_en, section,
        chatter, fields, relations, scope, lifecycle_policy, query_policy,
        action_policy, customization_policy, history_policy, api_exposed,
        migration_owner, created_at, updated_at
      ) VALUES (?, ?, ?, 'id', ?, ?, 'commercial', 1, '{}', '{}', 'company',
        'generic', 'scoped', 'registered', 'metadata', 'audit', 1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET module_id = excluded.module_id, updated_at = excluded.updated_at
    `);
    for (const [id, store, ar, en] of [
      ['crm_lead', 'crm_leads', 'عميل محتمل', 'Lead'],
      ['crm_opportunity', 'crm_opportunities', 'فرصة بيع', 'Opportunity'],
      ['crm_pipeline', 'crm_pipelines', 'مسار المبيعات', 'Pipeline'],
      ['crm_pipeline_stage', 'crm_pipeline_stages', 'مرحلة', 'Pipeline Stage'],
      ['crm_activity', 'crm_activities', 'نشاط', 'Activity'],
      ['crm_campaign', 'crm_campaigns', 'حملة تسويقية', 'Campaign'],
      ['crm_sales_team', 'crm_sales_teams', 'فريق المبيعات', 'Sales Team'],
    ]) entity.run(id, MODULE_ID, store, ar, en, MIGRATION_ID, now, now);

    db.prepare(`UPDATE module_expansion_registry SET lifecycle='available', schema_migration=?, updated_at=? WHERE module_id=?`)
      .run(MIGRATION_ID, now, MODULE_ID);
    db.prepare(`UPDATE platform_modules SET status='installed', updated_at=? WHERE id=?`).run(now, MODULE_ID);
  },

  down(db) {
    const now = new Date().toISOString();
    db.prepare(`UPDATE module_expansion_registry SET lifecycle='planned', schema_migration=NULL, updated_at=? WHERE module_id=?`)
      .run(now, MODULE_ID);
    db.prepare(`UPDATE platform_modules SET status='available', updated_at=? WHERE id=?`).run(now, MODULE_ID);
    db.prepare('DELETE FROM platform_entities WHERE module_id=? AND migration_owner=?').run(MODULE_ID, MIGRATION_ID);

    // Drop only what this migration created. The tables from 039 and 046 stay —
    // SQLite cannot DROP COLUMN portably, and removing them would destroy data
    // that predates this migration. Rollback therefore restores the module
    // lifecycle and removes the new tables; the added columns remain as inert
    // defaults, which re-running `up` reclaims idempotently.
    db.exec(`
      DROP TABLE IF EXISTS crm_score_history;
      DROP TABLE IF EXISTS crm_scoring_rules;
      DROP TABLE IF EXISTS crm_conversion_links;
      DROP TABLE IF EXISTS crm_stage_history;
      DROP TABLE IF EXISTS crm_interactions;
      DROP TABLE IF EXISTS crm_opportunity_competitors;
      DROP TABLE IF EXISTS crm_opportunity_tags;
      DROP TABLE IF EXISTS crm_lead_tags;
      DROP TABLE IF EXISTS crm_tags;
      DROP TABLE IF EXISTS crm_lost_reasons;
      DROP TABLE IF EXISTS crm_competitors;
      DROP TABLE IF EXISTS crm_customer_segments;
      DROP TABLE IF EXISTS crm_campaigns;
      DROP TABLE IF EXISTS crm_lead_sources;
      DROP TABLE IF EXISTS crm_pipeline_stages;
      DROP TABLE IF EXISTS crm_pipelines;
      DROP TABLE IF EXISTS crm_team_members;
      DROP TABLE IF EXISTS crm_sales_teams;
    `);
  },
};

export const CRM_ADDED_COLUMNS = {
  crm_leads: LEAD_COLUMNS.map((c) => c[0]),
  crm_opportunities: OPPORTUNITY_COLUMNS.map((c) => c[0]),
  crm_activities: ACTIVITY_COLUMNS.map((c) => c[0]),
};
