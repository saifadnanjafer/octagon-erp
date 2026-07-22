// 029_budgeting_foundation — Wave E
//
// Source composition:
// - Current Octagon has no budgeting model (confirmed by inspection of
//   services/financeService.js — no budget table or function exists); this is
//   new canonical capability, not a migration of legacy data.
// - VNext budgeting exploration (project-owned, foundation-level) informed the
//   draft/submit/approve/immutable-version shape.
// - ERPNext Budget doctype (clean-room reference) for account/dimension scope
//   and variance/threshold-alert concepts.
//
// What this migration does:
//   1. Creates finance_budgets (versioned header with revision lineage) and
//      finance_budget_lines (account + optional dimension scope + period amount).
//   2. Registers budgeting authority actions.
//
// Invariants:
//   - An approved budget version is immutable; a correction creates a new
//     version linked via parent_budget_id (copy/reforecast with lineage),
//     never an edit to an approved row.

const MODULE_ID = 'finance_canonical';
const now = new Date().toISOString();

export const migration = {
  id: '029_budgeting_foundation',
  owner: MODULE_ID,
  version: '1.15.0',
  dependsOn: ['028_credit_exposure_and_policy'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'VNext budgeting exploration (project-owned foundation) + ERPNext Budget doctype (clean-room) mapped to finance_budgets/finance_budget_lines',

  up(dialect) {
    dialect.exec(`
      CREATE TABLE IF NOT EXISTS finance_budgets (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        fiscal_year_id TEXT NOT NULL REFERENCES finance_fiscal_years(id),
        version INTEGER NOT NULL DEFAULT 1,
        parent_budget_id TEXT REFERENCES finance_budgets(id),
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected')),
        threshold_warn_percent REAL NOT NULL DEFAULT 80,
        threshold_block_percent REAL,
        submitted_by TEXT,
        submitted_at TEXT,
        approved_by TEXT,
        approved_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_finance_budgets_company_year ON finance_budgets(company_id, fiscal_year_id, status);

      CREATE TABLE IF NOT EXISTS finance_budget_lines (
        id TEXT PRIMARY KEY,
        budget_id TEXT NOT NULL REFERENCES finance_budgets(id),
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        account_id TEXT NOT NULL REFERENCES finance_accounts(id),
        dimension_value_id TEXT REFERENCES finance_dimension_values(id),
        period_id TEXT NOT NULL REFERENCES finance_periods(id),
        amount REAL NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_finance_budget_lines_budget ON finance_budget_lines(budget_id);
      CREATE INDEX IF NOT EXISTS idx_finance_budget_lines_account_period ON finance_budget_lines(company_id, account_id, period_id);
    `);

    const insEntity = dialect.prepare(`
      INSERT INTO platform_entities (
        id, module_id, storage_owner, primary_key, label_ar, label_en, section,
        sequence, seq_field, chatter, acl, status_key, fields, relations, scope,
        lifecycle_policy, query_policy, action_policy, customization_policy,
        history_policy, api_exposed, migration_owner, created_at, updated_at
      ) VALUES (?, ?, ?, 'id', ?, ?, 'finance', NULL, NULL, 0, NULL, ?, '{}', '{}', 'company', ?, 'scoped', 'registered', 'metadata', 'audit', 1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET module_id = excluded.module_id, label_ar = excluded.label_ar, label_en = excluded.label_en, updated_at = excluded.updated_at
    `);
    insEntity.run('finance_budget', MODULE_ID, 'platform.finance', 'موازنة', 'Budget', 'status', 'state_machine', MODULE_ID, now, now);
    insEntity.run('finance_budget_line', MODULE_ID, 'platform.finance', 'سطر موازنة', 'Budget Line', null, 'immutable', MODULE_ID, now, now);

    const ins = dialect.prepare(`
      INSERT INTO platform_actions (
        id, module_id, entity_id, kind, allowed_states, required_permission, required_scope,
        input_schema, preconditions, transaction_owner, idempotency_policy, sequence_policy,
        audit_policy, outbox_policy, reversal_action, result_schema, error_contract, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        module_id = excluded.module_id, entity_id = excluded.entity_id, kind = excluded.kind,
        allowed_states = excluded.allowed_states, required_permission = excluded.required_permission,
        required_scope = excluded.required_scope, input_schema = excluded.input_schema,
        preconditions = excluded.preconditions, transaction_owner = excluded.transaction_owner,
        idempotency_policy = excluded.idempotency_policy, sequence_policy = excluded.sequence_policy,
        audit_policy = excluded.audit_policy, outbox_policy = excluded.outbox_policy,
        reversal_action = excluded.reversal_action, result_schema = excluded.result_schema,
        error_contract = excluded.error_contract, updated_at = excluded.updated_at
    `);

    const actions = [
      { id: 'finance_budget:create', entity_id: 'finance_budget', kind: 'domain', required_permission: 'finance_budget:manage', input_schema: { required: ['code', 'name', 'fiscal_year_id', 'lines'] } },
      { id: 'finance_budget:submit', entity_id: 'finance_budget', kind: 'domain', required_permission: 'finance_budget:submit', allowed_states: ['draft'], input_schema: { required: ['budget_id'] } },
      { id: 'finance_budget:approve', entity_id: 'finance_budget', kind: 'domain', required_permission: 'finance_budget:approve', allowed_states: ['submitted'], input_schema: { required: ['budget_id'] } },
      { id: 'finance_budget:reject', entity_id: 'finance_budget', kind: 'domain', required_permission: 'finance_budget:approve', allowed_states: ['submitted'], input_schema: { required: ['budget_id'] } },
      { id: 'finance_budget:revise', entity_id: 'finance_budget', kind: 'domain', required_permission: 'finance_budget:manage', input_schema: { required: ['budget_id', 'lines'] } },
      { id: 'finance_budget:variance', entity_id: 'finance_budget', kind: 'domain', required_permission: 'finance_budget:read', input_schema: { required: ['budget_id'] } },
    ];

    for (const a of actions) {
      ins.run(
        a.id, MODULE_ID, a.entity_id, a.kind, JSON.stringify(a.allowed_states || []),
        a.required_permission, a.required_scope || 'company',
        a.input_schema ? JSON.stringify(a.input_schema) : null,
        JSON.stringify(a.preconditions || []), MODULE_ID, 'required', 'none',
        'required', 'required', a.reversal_action || null,
        null, null, now, now
      );
    }

    const existing = JSON.parse(dialect.prepare('SELECT migrations FROM platform_modules WHERE id = ?').get(MODULE_ID)?.migrations || '[]');
    if (!existing.includes('029_budgeting_foundation')) {
      existing.push('029_budgeting_foundation');
      dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(existing), now, MODULE_ID);
    }
  },

  down(dialect) {
    dialect.exec(`
      DROP TABLE IF EXISTS finance_budget_lines;
      DROP TABLE IF EXISTS finance_budgets;
    `);
    const actions = ['finance_budget:create', 'finance_budget:submit', 'finance_budget:approve', 'finance_budget:reject', 'finance_budget:revise', 'finance_budget:variance'];
    dialect.prepare(`DELETE FROM platform_actions WHERE id IN (${actions.map(() => '?').join(',')})`).run(...actions);
    const entities = ['finance_budget', 'finance_budget_line'];
    dialect.prepare(`DELETE FROM platform_entities WHERE id IN (${entities.map(() => '?').join(',')})`).run(...entities);
    const existing = JSON.parse(dialect.prepare('SELECT migrations FROM platform_modules WHERE id = ?').get(MODULE_ID)?.migrations || '[]');
    const next = existing.filter(id => id !== '029_budgeting_foundation');
    dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), new Date().toISOString(), MODULE_ID);
  }
};
