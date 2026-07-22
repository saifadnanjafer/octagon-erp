// 033_legacy_finance_migration_registry — Wave F
//
// Source composition:
// - Current Octagon legacy finance store inspected: services/financeService.js
//   reads/writes `PentagonDB.getCached().finance.accounts` (array) and
//   `db.account_moves` (array) — a JSON document store, not a relational
//   legacy schema. This migration's tables exist to make importing THAT shape
//   idempotent, reconciled, and quarantine-aware; the extraction/validation
//   logic lives in engine.mjs and takes legacy records as plain JS input
//   (never reaches into PentagonDB itself), so it can be fully tested against
//   synthetic fixtures without touching the live application database.
// - VNext legacy finance bridge/reconciliation report concepts (project-owned
//   foundation) informed the run/source-map/quarantine shape.
//
// What this migration does:
//   1. Creates finance_migration_runs, finance_migration_source_map (the
//      idempotency key: source_system + source_id -> canonical_id, unique per
//      company), and finance_migration_quarantine.
//   2. Registers migration authority actions.
//
// Invariants:
//   - finance_migration_source_map has a UNIQUE(company_id, source_system,
//     source_id) index — re-running an import against the same legacy record
//     is a guaranteed no-op lookup, not a re-insert, at the database level.

const MODULE_ID = 'finance_canonical';
const now = new Date().toISOString();

export const migration = {
  id: '033_legacy_finance_migration_registry',
  owner: MODULE_ID,
  version: '1.19.0',
  dependsOn: ['032_asset_accounting_interface'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Current Octagon legacy finance store (PentagonDB finance.accounts/account_moves) shape inspection + VNext legacy-bridge concepts (project-owned foundation) mapped to finance_migration_runs/finance_migration_source_map/finance_migration_quarantine',

  up(dialect) {
    dialect.exec(`
      CREATE TABLE IF NOT EXISTS finance_migration_runs (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        run_type TEXT NOT NULL CHECK (run_type IN ('accounts','moves','opening_balances')),
        status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed','rolled_back')),
        source_count INTEGER NOT NULL DEFAULT 0,
        imported_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        quarantined_count INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        started_by TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_finance_migration_runs_company ON finance_migration_runs(company_id, run_type, status);

      CREATE TABLE IF NOT EXISTS finance_migration_source_map (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        source_system TEXT NOT NULL CHECK (source_system IN ('legacy_account','legacy_move')),
        source_id TEXT NOT NULL,
        canonical_id TEXT NOT NULL,
        canonical_table TEXT NOT NULL,
        migration_run_id TEXT NOT NULL REFERENCES finance_migration_runs(id),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_migration_source_map_unique ON finance_migration_source_map(company_id, source_system, source_id);

      CREATE TABLE IF NOT EXISTS finance_migration_quarantine (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        migration_run_id TEXT NOT NULL REFERENCES finance_migration_runs(id),
        source_system TEXT NOT NULL,
        source_id TEXT,
        reason TEXT NOT NULL,
        raw_data_json TEXT NOT NULL,
        resolved INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_finance_migration_quarantine_run ON finance_migration_quarantine(migration_run_id, resolved);
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
    insEntity.run('finance_migration_run', MODULE_ID, 'platform.finance', 'عملية ترحيل بيانات', 'Migration Run', 'status', 'state_machine', MODULE_ID, now, now);
    insEntity.run('finance_migration_quarantine', MODULE_ID, 'platform.finance', 'سجلات محجوزة للترحيل', 'Migration Quarantine', null, 'generic', MODULE_ID, now, now);

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
      { id: 'finance_migration:import_accounts', entity_id: 'finance_migration_run', kind: 'domain', required_permission: 'finance_migration:run', input_schema: { required: ['legacy_accounts'] } },
      { id: 'finance_migration:import_moves', entity_id: 'finance_migration_run', kind: 'domain', required_permission: 'finance_migration:run', input_schema: { required: ['legacy_moves'] } },
      { id: 'finance_migration:reconcile', entity_id: 'finance_migration_run', kind: 'domain', required_permission: 'finance_migration:run', input_schema: { required: ['legacy_trial_balance'] } },
      { id: 'finance_migration:rollback_run', entity_id: 'finance_migration_run', kind: 'domain', required_permission: 'finance_migration:run', input_schema: { required: ['migration_run_id'] } },
      { id: 'finance_migration:quarantine_list', entity_id: 'finance_migration_quarantine', kind: 'domain', required_permission: 'finance_migration:run', input_schema: { required: ['migration_run_id'] } },
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
    if (!existing.includes('033_legacy_finance_migration_registry')) {
      existing.push('033_legacy_finance_migration_registry');
      dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(existing), now, MODULE_ID);
    }
  },

  down(dialect) {
    dialect.exec(`
      DROP TABLE IF EXISTS finance_migration_quarantine;
      DROP TABLE IF EXISTS finance_migration_source_map;
      DROP TABLE IF EXISTS finance_migration_runs;
    `);
    const actions = ['finance_migration:import_accounts', 'finance_migration:import_moves', 'finance_migration:reconcile', 'finance_migration:rollback_run', 'finance_migration:quarantine_list'];
    dialect.prepare(`DELETE FROM platform_actions WHERE id IN (${actions.map(() => '?').join(',')})`).run(...actions);
    const entities = ['finance_migration_run', 'finance_migration_quarantine'];
    dialect.prepare(`DELETE FROM platform_entities WHERE id IN (${entities.map(() => '?').join(',')})`).run(...entities);
    const existing = JSON.parse(dialect.prepare('SELECT migrations FROM platform_modules WHERE id = ?').get(MODULE_ID)?.migrations || '[]');
    const next = existing.filter(id => id !== '033_legacy_finance_migration_registry');
    dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), new Date().toISOString(), MODULE_ID);
  }
};
