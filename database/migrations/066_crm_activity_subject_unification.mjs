// 066_crm_activity_subject_unification.mjs — Module Expansion Wave 1, M2.5E.
//
// Fixes the known CRM Activity schema limitation recorded in
// docs/evidence/module-expansion-wave-1/crm/activity-schema-limitation.md:
//
//   `crm_activities.lead_id` has been NOT NULL since 039_crm_sales_contracts_commissions.
//   Migration 065 added a nullable `opportunity_id` column to the same table but
//   could not lift the NOT NULL constraint with ADD COLUMN (SQLite limitation),
//   so an Opportunity created directly (no source Lead) still could not carry an
//   Activity: platform/domains/crm/activity-service.mjs#scheduleActivity fails
//   loudly for that case rather than inventing a sentinel Lead.
//
//   Separately, 046_sales_lifecycle_expansion created a SECOND, competing
//   Activity store — `crm_opportunity_activities` — written by the pre-Wave-1
//   `platform/sales/lifecycle.mjs` (logOpportunityActivity, addOpportunityActivity).
//   Two tables answering "what happened on this opportunity" is exactly the
//   kind of split authority migration 065's header warns against for leads.
//
// This migration rebuilds `crm_activities` (SQLite cannot ALTER a column's
// NOT NULL or add a CHECK constraint in place) so that:
//   - lead_id becomes nullable;
//   - a `subject_type` column ('lead' | 'opportunity' | 'party') names the
//     PRIMARY subject and is enforced by a CHECK constraint;
//   - an Opportunity-subject activity may ALSO carry lead_id for lineage when
//     the opportunity came from a conversion — this is existing, tested
//     behaviour (activity-service.mjs resolves the opportunity's source lead)
//     and must keep working, so "exactly one subject" is enforced on
//     `subject_type` + its corresponding column, not on "only one FK column is
//     ever non-null";
//   - rows from `crm_opportunity_activities` are imported with their
//     provenance recorded in `legacy_source`, then that table is retired as a
//     writable authority and replaced by a read-only compatibility VIEW of the
//     same name and shape, because platform/sales/lifecycle.mjs#getOpportunity
//     still reads `SELECT * FROM crm_opportunity_activities WHERE opportunity_id = ?`.
//
// SCOPE HONESTY: this migration touches only the Activity subject model. It
// does NOT consolidate `platform/sales/lifecycle.mjs`'s own Opportunity write
// path (convertLead/updateOpportunityStage/closeOpportunity, registered as
// `crm:opportunity:*`) with the newer `platform/domains/crm/opportunity-service.mjs`
// (unregistered as of this migration) — that is a second, pre-existing
// competing-authority problem discovered while investigating this one, and is
// out of this migration's scope. See docs/evidence/.../unresolved-risks.md.
//
// Dialect: SQLite only. The rebuild introspects `PRAGMA table_info` and runs
// `PRAGMA foreign_key_check`, both of which database/dialects/sql-portability.mjs
// documents as untranslatable to PostgreSQL. Declaring 'postgres' support here
// would be a claim this migration cannot back up.

const MIGRATION_ID = '066_crm_activity_subject_unification';
const PARENT = '065_crm_pipeline_leads_opportunities_and_activities';

export class IrreversibleActivityDataError extends Error {
  constructor(count) {
    super(
      `Refusing to roll back ${MIGRATION_ID}: ${count} Activity row(s) have subject_type='party' ` +
      '(a direct Party-linked Activity with no Lead or Opportunity). Neither pre-migration table ' +
      '(crm_activities with NOT NULL lead_id, or crm_opportunity_activities) has a column to hold ' +
      'these rows, so splitting them back would silently drop data. This is the declared, honest ' +
      'rollback policy from docs/evidence/module-expansion-wave-1/crm/activity-unification-migration.md: ' +
      'refuse rather than lose rows.'
    );
    this.name = 'IrreversibleActivityDataError';
    this.code = 'IRREVERSIBLE_ACTIVITY_DATA';
    this.count = count;
  }
}

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name);
}

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(table));
}

function assertNoForeignKeyViolations(db, context) {
  const violations = db.prepare('PRAGMA foreign_key_check').all();
  if (violations.length) {
    throw new Error(`${MIGRATION_ID}: foreign_key_check found ${violations.length} violation(s) ${context}: ${JSON.stringify(violations)}`);
  }
}

// The 22 columns crm_activities carries at the 065 tip (039 originals + 065 additions).
const ACT_065_COLUMNS = [
  'id', 'company_id', 'lead_id', 'activity_type', 'summary', 'done', 'due_date', 'created_at',
  'opportunity_id', 'party_id', 'detail', 'assigned_user_id', 'state', 'priority', 'due_at',
  'completed_at', 'completed_by', 'outcome', 'work_item_id', 'cancelled_at', 'created_by', 'updated_at',
];

export const ACTIVITY_UNIFICATION_ADDED_COLUMNS = ['subject_type', 'legacy_source'];

export const migration = {
  id: MIGRATION_ID,
  owner: 'octagon.crm',
  version: '1.44.0',
  parent: PARENT,
  dependsOn: [PARENT],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance:
    'Wave 1 M2.5E — rebuilds crm_activities so lead_id is nullable and a subject_type CHECK ' +
    'enforces exactly one primary subject (lead, opportunity, or party); imports and retires ' +
    'crm_opportunity_activities as a writable table, replacing it with a read-only compatibility view.',

  up(db) {
    if (!tableExists(db, 'crm_activities')) {
      throw new Error(`${MIGRATION_ID}: crm_activities does not exist; expected it from 039/065`);
    }
    const haveCols = new Set(tableColumns(db, 'crm_activities'));
    const copyCols = ACT_065_COLUMNS.filter((c) => haveCols.has(c));
    const missing = ACT_065_COLUMNS.filter((c) => !haveCols.has(c));
    if (missing.length) {
      throw new Error(`${MIGRATION_ID}: crm_activities is missing expected 065 column(s): ${missing.join(', ')}`);
    }

    const beforeActivities = db.prepare('SELECT COUNT(*) n FROM crm_activities').get().n;
    const hasLegacyOppActivities = tableExists(db, 'crm_opportunity_activities');
    const beforeOppActivities = hasLegacyOppActivities
      ? db.prepare('SELECT COUNT(*) n FROM crm_opportunity_activities').get().n
      : 0;

    // ---- 1. Build the replacement table -------------------------------------
    db.exec(`
      CREATE TABLE crm_activities_v066 (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        subject_type TEXT NOT NULL,
        lead_id TEXT REFERENCES crm_leads(id) ON DELETE CASCADE,
        opportunity_id TEXT REFERENCES crm_opportunities(id) ON DELETE CASCADE,
        party_id TEXT REFERENCES parties(id) ON DELETE CASCADE,
        activity_type TEXT NOT NULL DEFAULT 'note',
        summary TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        done INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL DEFAULT 'planned',
        priority TEXT NOT NULL DEFAULT 'normal',
        due_date TEXT,
        due_at TEXT,
        assigned_user_id TEXT,
        completed_at TEXT,
        completed_by TEXT,
        outcome TEXT NOT NULL DEFAULT '',
        work_item_id TEXT,
        cancelled_at TEXT,
        legacy_source TEXT,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL DEFAULT 'system',
        updated_at TEXT,
        CHECK (
          (subject_type = 'lead' AND lead_id IS NOT NULL AND opportunity_id IS NULL AND party_id IS NULL)
          OR (subject_type = 'opportunity' AND opportunity_id IS NOT NULL AND party_id IS NULL)
          OR (subject_type = 'party' AND party_id IS NOT NULL AND lead_id IS NULL AND opportunity_id IS NULL)
        )
      );
    `);

    // ---- 2. Copy existing crm_activities rows --------------------------------
    // Primary-subject priority for pre-existing rows: an Opportunity reference is
    // more specific than the Lead lineage activity-service.mjs also resolves onto
    // the row, so a row carrying both is classified 'opportunity'. lead_id was
    // NOT NULL before this migration, so every existing row has at least one of
    // opportunity_id/lead_id populated; the party_id branch is defensive only.
    db.prepare(`
      INSERT INTO crm_activities_v066 (
        id, company_id, subject_type, lead_id, opportunity_id, party_id,
        activity_type, summary, detail, done, state, priority, due_date, due_at,
        assigned_user_id, completed_at, completed_by, outcome, work_item_id,
        cancelled_at, legacy_source, created_at, created_by, updated_at
      )
      SELECT
        id, company_id,
        CASE
          WHEN opportunity_id IS NOT NULL THEN 'opportunity'
          WHEN lead_id IS NOT NULL THEN 'lead'
          ELSE 'party'
        END,
        lead_id,
        opportunity_id,
        CASE WHEN opportunity_id IS NULL AND lead_id IS NULL THEN party_id ELSE NULL END,
        activity_type, summary, detail, done, state, priority, due_date, due_at,
        assigned_user_id, completed_at, completed_by, outcome, work_item_id,
        cancelled_at, 'crm_activities', created_at, created_by, updated_at
      FROM crm_activities
    `).run();

    // ---- 3. Import crm_opportunity_activities, skipping any id already copied ---
    // No lead lineage is invented for imported rows: the legacy table never
    // recorded one, so leaving lead_id NULL is the honest representation of what
    // was actually known at the time each row was created.
    let importedOppActivities = 0;
    if (hasLegacyOppActivities) {
      const result = db.prepare(`
        INSERT INTO crm_activities_v066 (
          id, company_id, subject_type, lead_id, opportunity_id, party_id,
          activity_type, summary, detail, done, state, priority, due_date, due_at,
          assigned_user_id, completed_at, completed_by, outcome, work_item_id,
          cancelled_at, legacy_source, created_at, created_by, updated_at
        )
        SELECT
          coa.id,
          COALESCE((SELECT o.company_id FROM crm_opportunities o WHERE o.id = coa.opportunity_id), '*'),
          'opportunity',
          NULL,
          coa.opportunity_id,
          NULL,
          coa.activity_type, coa.summary, '', coa.done,
          CASE WHEN coa.done = 1 THEN 'completed' ELSE 'planned' END,
          'normal', coa.due_date, NULL,
          NULL, NULL, NULL, '', NULL,
          NULL, 'crm_opportunity_activities', coa.created_at, 'system', coa.created_at
        FROM crm_opportunity_activities coa
        WHERE coa.id NOT IN (SELECT id FROM crm_activities_v066)
      `).run();
      importedOppActivities = result.changes;
    }

    // ---- 4. Row-count proof: nothing lost, nothing duplicated ------------------
    const afterCount = db.prepare('SELECT COUNT(*) n FROM crm_activities_v066').get().n;
    const expected = beforeActivities + importedOppActivities;
    if (afterCount !== expected) {
      throw new Error(
        `${MIGRATION_ID}: row count mismatch after import — expected ${expected} ` +
        `(${beforeActivities} existing + ${importedOppActivities} imported), got ${afterCount}`
      );
    }

    // ---- 5. Swap the table, retire crm_opportunity_activities as writable -----
    db.exec('DROP TABLE crm_activities;');
    db.exec('ALTER TABLE crm_activities_v066 RENAME TO crm_activities;');
    if (hasLegacyOppActivities) db.exec('DROP TABLE crm_opportunity_activities;');

    db.exec(`
      CREATE INDEX idx_crm_activity_assignee ON crm_activities(assigned_user_id, state, due_at);
      CREATE INDEX idx_crm_activity_opp ON crm_activities(opportunity_id);
      CREATE INDEX idx_crm_activity_lead ON crm_activities(lead_id);
      CREATE INDEX idx_crm_activity_party ON crm_activities(party_id);
      CREATE INDEX idx_crm_activity_subject ON crm_activities(company_id, subject_type);
    `);

    // Read-only compatibility view: same 7 columns platform/sales/lifecycle.mjs
    // (getOpportunity) already selects, transitional until that reader is moved
    // onto the unified table directly.
    db.exec(`
      CREATE VIEW crm_opportunity_activities AS
      SELECT id, opportunity_id, activity_type, summary, done, due_date, created_at
      FROM crm_activities
      WHERE opportunity_id IS NOT NULL;
    `);

    assertNoForeignKeyViolations(db, 'after crm_activities rebuild (up)');
  },

  down(db) {
    const irreversible = db.prepare("SELECT COUNT(*) n FROM crm_activities WHERE subject_type = 'party'").get().n;
    if (irreversible > 0) {
      throw new IrreversibleActivityDataError(irreversible);
    }

    const haveCols = new Set(tableColumns(db, 'crm_activities'));
    const restoreCols = ACT_065_COLUMNS.filter((c) => haveCols.has(c));

    // ---- 1. Restore crm_opportunity_activities as a real, writable table ------
    db.exec('DROP VIEW IF EXISTS crm_opportunity_activities;');
    db.exec(`
      CREATE TABLE crm_opportunity_activities (
        id TEXT PRIMARY KEY,
        opportunity_id TEXT NOT NULL REFERENCES crm_opportunities(id) ON DELETE CASCADE,
        activity_type TEXT NOT NULL DEFAULT 'note',
        summary TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        due_date TEXT,
        created_at TEXT NOT NULL
      );
    `);
    db.prepare(`
      INSERT INTO crm_opportunity_activities (id, opportunity_id, activity_type, summary, done, due_date, created_at)
      SELECT id, opportunity_id, activity_type, summary, done, due_date, created_at
      FROM crm_activities
      WHERE opportunity_id IS NOT NULL AND lead_id IS NULL
    `).run();

    // ---- 2. Restore crm_activities to its pre-066 (065-tip) shape -------------
    db.exec(`CREATE TABLE crm_activities_v065restore (
      ${restoreCols.map((c) => {
        if (c === 'id') return 'id TEXT PRIMARY KEY';
        if (c === 'lead_id') return 'lead_id TEXT NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE';
        if (c === 'company_id') return "company_id TEXT NOT NULL DEFAULT '*'";
        if (c === 'activity_type') return "activity_type TEXT NOT NULL DEFAULT 'note'";
        if (c === 'summary') return 'summary TEXT NOT NULL';
        if (c === 'done') return 'done INTEGER NOT NULL DEFAULT 0';
        if (c === 'created_at') return 'created_at TEXT NOT NULL';
        if (c === 'created_by') return "created_by TEXT NOT NULL DEFAULT 'system'";
        if (c === 'detail') return "detail TEXT NOT NULL DEFAULT ''";
        if (c === 'state') return "state TEXT NOT NULL DEFAULT 'planned'";
        if (c === 'priority') return "priority TEXT NOT NULL DEFAULT 'normal'";
        if (c === 'outcome') return "outcome TEXT NOT NULL DEFAULT ''";
        return `${c} TEXT`;
      }).join(',\n      ')}
    );`);

    db.prepare(`
      INSERT INTO crm_activities_v065restore (${restoreCols.join(', ')})
      SELECT ${restoreCols.join(', ')} FROM crm_activities WHERE lead_id IS NOT NULL
    `).run();

    db.exec('DROP TABLE crm_activities;');
    db.exec('ALTER TABLE crm_activities_v065restore RENAME TO crm_activities;');
    db.exec(`
      CREATE INDEX idx_crm_activity_assignee ON crm_activities(assigned_user_id, state, due_at);
      CREATE INDEX idx_crm_activity_opp ON crm_activities(opportunity_id);
    `);

    assertNoForeignKeyViolations(db, 'after crm_activities restore (down)');
  },
};
