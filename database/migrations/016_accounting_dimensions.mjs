// 016_accounting_dimensions — Wave C
//
// Source composition:
// - VNext finance-engine.js validateDimensionDistribution and dimension reporting
//   (project-owned) MERGE-REFACTOR.
// - Odoo analytic.mixin / analytic_plan (clean-room reference) for dimension policies.
// - ERPNext accounting_dimension (clean-room reference) for dimension value behavior.
//
// What this migration does:
//   1. Creates finance_dimensions, finance_dimension_values, and finance_account_dimension_policies.
//   2. Registers dimension authority actions.
//
// Invariants:
//   - Dimension values are company-scoped.
//   - Account policies enforce required/optional/blocked per dimension.
//   - Posted distributions are immutable (stored on finance_journal_lines.dims).

import crypto from 'node:crypto';

const MODULE_ID = 'finance_canonical';
const now = new Date().toISOString();

export const migration = {
  id: '016_accounting_dimensions',
  owner: MODULE_ID,
  version: '1.2.0',
  dependsOn: ['015_finance_document_lifecycle'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'VNext finance-engine.js validateDimensionDistribution + Odoo analytic.mixin + ERPNext accounting_dimension mapped to finance_* tables',

  up(dialect) {
    dialect.exec(`
      CREATE TABLE IF NOT EXISTS finance_dimensions (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        applies_to TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_dimensions_company_code ON finance_dimensions(company_id, code);
      CREATE INDEX IF NOT EXISTS idx_finance_dimensions_company ON finance_dimensions(company_id);

      CREATE TABLE IF NOT EXISTS finance_dimension_values (
        id TEXT PRIMARY KEY,
        dimension_id TEXT NOT NULL REFERENCES finance_dimensions(id),
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_dimension_values_company_code ON finance_dimension_values(company_id, code);
      CREATE INDEX IF NOT EXISTS idx_finance_dimension_values_dimension ON finance_dimension_values(dimension_id);

      CREATE TABLE IF NOT EXISTS finance_account_dimension_policies (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        account_id TEXT NOT NULL REFERENCES finance_accounts(id),
        dimension_id TEXT NOT NULL REFERENCES finance_dimensions(id),
        policy TEXT NOT NULL CHECK (policy IN ('required','optional','blocked')),
        created_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_account_dimension_policies ON finance_account_dimension_policies(company_id, account_id, dimension_id);
    `);

    const insEntity = dialect.prepare(`
      INSERT INTO platform_entities (
        id, module_id, storage_owner, primary_key, label_ar, label_en, section,
        sequence, seq_field, chatter, acl, status_key, fields, relations, scope,
        lifecycle_policy, query_policy, action_policy, customization_policy,
        history_policy, api_exposed, migration_owner, created_at, updated_at
      ) VALUES (?, ?, ?, 'id', ?, ?, 'finance', NULL, NULL, 0, NULL, NULL, '{}', '{}', 'company', 'generic', 'scoped', 'registered', 'metadata', 'audit', 1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET module_id = excluded.module_id, label_ar = excluded.label_ar, label_en = excluded.label_en, updated_at = excluded.updated_at
    `);
    for (const e of [
      { id: 'finance_dimension', label_ar: 'بُعد محاسبي', label_en: 'Accounting Dimension' },
      { id: 'finance_dimension_value', label_ar: 'قيمة البُعد', label_en: 'Dimension Value' },
      { id: 'finance_account_dimension_policy', label_ar: 'سياسة بُعد الحساب', label_en: 'Account Dimension Policy' },
    ]) {
      insEntity.run(e.id, MODULE_ID, 'platform.finance', e.label_ar, e.label_en, MODULE_ID, now, now);
    }

    const ins = dialect.prepare(`
      INSERT INTO platform_actions (
        id, module_id, entity_id, kind, allowed_states, required_permission, required_scope,
        input_schema, preconditions, transaction_owner, idempotency_policy, sequence_policy,
        audit_policy, outbox_policy, reversal_action, result_schema, error_contract, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        module_id = excluded.module_id,
        entity_id = excluded.entity_id,
        kind = excluded.kind,
        allowed_states = excluded.allowed_states,
        required_permission = excluded.required_permission,
        required_scope = excluded.required_scope,
        input_schema = excluded.input_schema,
        preconditions = excluded.preconditions,
        transaction_owner = excluded.transaction_owner,
        idempotency_policy = excluded.idempotency_policy,
        sequence_policy = excluded.sequence_policy,
        audit_policy = excluded.audit_policy,
        outbox_policy = excluded.outbox_policy,
        reversal_action = excluded.reversal_action,
        result_schema = excluded.result_schema,
        error_contract = excluded.error_contract,
        updated_at = excluded.updated_at
    `);

    const actions = [
      {
        id: 'finance_dimension:create', entity_id: 'finance_dimension', kind: 'domain',
        required_permission: 'finance_dimension:create', input_schema: { required: ['code', 'name'] },
      },
      {
        id: 'finance_dimension:value_create', entity_id: 'finance_dimension_value', kind: 'domain',
        required_permission: 'finance_dimension:create', input_schema: { required: ['dimension_id', 'code', 'name'] },
      },
      {
        id: 'finance_dimension:policy_set', entity_id: 'finance_account_dimension_policy', kind: 'domain',
        required_permission: 'finance_dimension:policy_set', input_schema: { required: ['account_id', 'dimension_id', 'policy'] },
      },
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

    // Record migration in module manifest.
    const existing = JSON.parse(dialect.prepare('SELECT migrations FROM platform_modules WHERE id = ?').get(MODULE_ID)?.migrations || '[]');
    if (!existing.includes('016_accounting_dimensions')) {
      existing.push('016_accounting_dimensions');
      dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(existing), now, MODULE_ID);
    }
  },

  down(dialect) {
    dialect.exec(`
      DROP TABLE IF EXISTS finance_account_dimension_policies;
      DROP TABLE IF EXISTS finance_dimension_values;
      DROP TABLE IF EXISTS finance_dimensions;
    `);
    const actions = ['finance_dimension:create', 'finance_dimension:value_create', 'finance_dimension:policy_set'];
    const placeholders = actions.map(() => '?').join(',');
    dialect.prepare(`DELETE FROM platform_actions WHERE id IN (${placeholders})`).run(...actions);
    const entities = ['finance_dimension', 'finance_dimension_value', 'finance_account_dimension_policy'];
    dialect.prepare(`DELETE FROM platform_entities WHERE id IN (${entities.map(() => '?').join(',')})`).run(...entities);
    const existing = JSON.parse(dialect.prepare('SELECT migrations FROM platform_modules WHERE id = ?').get(MODULE_ID)?.migrations || '[]');
    const next = existing.filter(id => id !== '016_accounting_dimensions');
    dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), new Date().toISOString(), MODULE_ID);
  }
};
