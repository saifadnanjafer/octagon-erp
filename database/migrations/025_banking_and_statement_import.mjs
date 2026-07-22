// 025_banking_and_statement_import — Wave D
//
// Source composition:
// - VNext bank-engine.js (project-owned) MERGE-REFACTOR: bank_account,
//   bank_match_rule, bank_statement/bank_statement_line (hash-deduped import),
//   bank_reconciliation, recordBankDifference, unreconcile — ported near-verbatim
//   onto finance_* table names and the existing finance_documents posting path.
// - Odoo account.bank.statement / account.bank.statement.line (clean-room
//   reference) for opening/closing-balance and statement-batch shape.
// - ERPNext Bank Transaction + Bank Reconciliation Tool (clean-room reference)
//   confirming the import-fingerprint-dedup pattern.
//
// What this migration does:
//   1. Creates finance_bank_accounts, finance_bank_match_rules,
//      finance_bank_statement_batches, finance_bank_statement_lines,
//      finance_bank_reconciliations.
//   2. Registers banking authority actions.
//
// Invariants:
//   - Imported statement evidence is immutable: no UPDATE/DELETE path exists on
//     finance_bank_statement_lines; every line carries a content hash
//     (company + external id + date + amount + currency + description) that
//     makes duplicate re-import of the same line a no-op rather than a
//     duplicate row (import_key dedups whole-batch reruns; line_hash dedups
//     individual duplicate lines even across differently-keyed imports).

const MODULE_ID = 'finance_canonical';
const now = new Date().toISOString();

export const migration = {
  id: '025_banking_and_statement_import',
  owner: MODULE_ID,
  version: '1.11.0',
  dependsOn: ['024_open_item_reconciliation_engine'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'VNext bank-engine.js (project-owned) MERGE-REFACTOR + Odoo account.bank.statement / ERPNext Bank Transaction (clean-room) mapped to finance_bank_* tables',

  up(dialect) {
    dialect.exec(`
      CREATE TABLE IF NOT EXISTS finance_bank_accounts (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        name TEXT NOT NULL,
        gl_account_id TEXT NOT NULL REFERENCES finance_accounts(id),
        currency TEXT NOT NULL DEFAULT 'IQD',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS finance_bank_match_rules (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        name TEXT NOT NULL,
        description_pattern TEXT,
        amount_tolerance REAL NOT NULL DEFAULT 0,
        target_account_id TEXT REFERENCES finance_accounts(id),
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS finance_bank_statement_batches (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        bank_account_id TEXT NOT NULL REFERENCES finance_bank_accounts(id),
        statement_date TEXT NOT NULL,
        opening_balance REAL NOT NULL DEFAULT 0,
        closing_balance REAL,
        import_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_bank_statement_batches_import_key ON finance_bank_statement_batches(company_id, import_key);

      CREATE TABLE IF NOT EXISTS finance_bank_statement_lines (
        id TEXT PRIMARY KEY,
        statement_id TEXT NOT NULL REFERENCES finance_bank_statement_batches(id),
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        line_number INTEGER NOT NULL,
        transaction_date TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'IQD',
        description TEXT,
        external_id TEXT,
        line_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'unmatched' CHECK (status IN ('unmatched','reconciled')),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_bank_statement_lines_hash ON finance_bank_statement_lines(company_id, line_hash);
      CREATE INDEX IF NOT EXISTS idx_finance_bank_statement_lines_statement ON finance_bank_statement_lines(statement_id);

      CREATE TABLE IF NOT EXISTS finance_bank_reconciliations (
        id TEXT PRIMARY KEY,
        statement_line_id TEXT NOT NULL REFERENCES finance_bank_statement_lines(id),
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        target_type TEXT NOT NULL CHECK (target_type IN ('payment','document','difference')),
        target_id TEXT NOT NULL,
        amount REAL NOT NULL,
        method TEXT NOT NULL CHECK (method IN ('exact','tolerance','manual')),
        status TEXT NOT NULL DEFAULT 'reconciled' CHECK (status IN ('reconciled','reversed')),
        created_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_finance_bank_reconciliations_line ON finance_bank_reconciliations(statement_line_id, status);
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
      { id: 'finance_bank_account', label_ar: 'حساب بنكي', label_en: 'Bank Account' },
      { id: 'finance_bank_match_rule', label_ar: 'قاعدة مطابقة بنكية', label_en: 'Bank Match Rule' },
      { id: 'finance_bank_statement_batch', label_ar: 'كشف حساب بنكي', label_en: 'Bank Statement Batch' },
      { id: 'finance_bank_statement_line', label_ar: 'سطر كشف بنكي', label_en: 'Bank Statement Line' },
      { id: 'finance_bank_reconciliation', label_ar: 'تسوية بنكية', label_en: 'Bank Reconciliation' },
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
      { id: 'finance_bank_account:create', entity_id: 'finance_bank_account', kind: 'domain', required_permission: 'finance_bank:manage', input_schema: { required: ['name', 'gl_account_id'] } },
      { id: 'finance_bank_match_rule:create', entity_id: 'finance_bank_match_rule', kind: 'domain', required_permission: 'finance_bank:manage', input_schema: { required: ['name'] } },
      { id: 'finance_bank_statement:import', entity_id: 'finance_bank_statement_batch', kind: 'domain', required_permission: 'finance_bank:import', input_schema: { required: ['bank_account_id', 'import_key', 'lines'] } },
      { id: 'finance_bank_statement:match', entity_id: 'finance_bank_reconciliation', kind: 'domain', required_permission: 'finance_bank:reconcile', input_schema: { required: ['line_id'] } },
      { id: 'finance_bank_statement:manual_reconcile', entity_id: 'finance_bank_reconciliation', kind: 'domain', required_permission: 'finance_bank:reconcile', input_schema: { required: ['line_id', 'target_type', 'target_id'] } },
      { id: 'finance_bank_statement:record_difference', entity_id: 'finance_bank_reconciliation', kind: 'domain', required_permission: 'finance_bank:reconcile', input_schema: { required: ['line_id', 'account_id'] } },
      { id: 'finance_bank_statement:unreconcile', entity_id: 'finance_bank_reconciliation', kind: 'domain', required_permission: 'finance_bank:reconcile', input_schema: { required: ['reconciliation_id'] } },
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
    if (!existing.includes('025_banking_and_statement_import')) {
      existing.push('025_banking_and_statement_import');
      dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(existing), now, MODULE_ID);
    }
  },

  down(dialect) {
    dialect.exec(`
      DROP TABLE IF EXISTS finance_bank_reconciliations;
      DROP TABLE IF EXISTS finance_bank_statement_lines;
      DROP TABLE IF EXISTS finance_bank_statement_batches;
      DROP TABLE IF EXISTS finance_bank_match_rules;
      DROP TABLE IF EXISTS finance_bank_accounts;
    `);
    const actions = ['finance_bank_account:create', 'finance_bank_match_rule:create', 'finance_bank_statement:import', 'finance_bank_statement:match', 'finance_bank_statement:manual_reconcile', 'finance_bank_statement:record_difference', 'finance_bank_statement:unreconcile'];
    dialect.prepare(`DELETE FROM platform_actions WHERE id IN (${actions.map(() => '?').join(',')})`).run(...actions);
    const entities = ['finance_bank_account', 'finance_bank_match_rule', 'finance_bank_statement_batch', 'finance_bank_statement_line', 'finance_bank_reconciliation'];
    dialect.prepare(`DELETE FROM platform_entities WHERE id IN (${entities.map(() => '?').join(',')})`).run(...entities);
    const existing = JSON.parse(dialect.prepare('SELECT migrations FROM platform_modules WHERE id = ?').get(MODULE_ID)?.migrations || '[]');
    const next = existing.filter(id => id !== '025_banking_and_statement_import');
    dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), new Date().toISOString(), MODULE_ID);
  }
};
