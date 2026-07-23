// 035_governed_finance_cutover_and_tax_attribution — Final Cutover
//
// Source composition:
// - SPEC-IMPLEMENT: Built directly from Phase 03 Final Cutover Specification
//
// What this migration does:
//   1. Creates finance_cutover_settings table for server-side governed cutover states per company:
//      (LEGACY_READ_WRITE, SHADOW_READ, CANONICAL_WRITE_SHADOW_COMPARE, CANONICAL_READ_WRITE, LEGACY_READ_ONLY, CANONICAL_ONLY)
//   2. Creates finance_cutover_history table to record permission-protected state transitions with audit.
//   3. Adds canonical tax attribution columns to account_move_lines and fiscal_document_lines.
//   4. Adds early discount and retainage tracking columns to account_moves, fiscal_documents, and account_move_lines.
//   5. Ensures unified period-lock table finance_locks contains journal_id and tax_lock support.
//   6. Default cutover state for fresh databases and disposable cutover DBs is CANONICAL_ONLY.

const MODULE_ID = 'finance_canonical';
const now = new Date().toISOString();

export const migration = {
  id: '035_governed_finance_cutover_and_tax_attribution',
  owner: MODULE_ID,
  version: '1.21.0',
  dependsOn: ['034_cross_module_source_fact_adapters'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'SPEC-IMPLEMENT directly from Phase 03 Final Cutover specification',

  up(dialect) {
    dialect.exec(`
      CREATE TABLE IF NOT EXISTS finance_cutover_settings (
        company_id TEXT PRIMARY KEY,
        state TEXT NOT NULL DEFAULT 'CANONICAL_ONLY',
        previous_state TEXT,
        transitioned_at TEXT NOT NULL,
        transitioned_by TEXT NOT NULL,
        reason TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS finance_cutover_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id TEXT NOT NULL,
        from_state TEXT NOT NULL,
        to_state TEXT NOT NULL,
        reason TEXT,
        actor_id TEXT NOT NULL,
        transitioned_at TEXT NOT NULL
      ) STRICT;

      INSERT OR IGNORE INTO finance_cutover_settings (company_id, state, previous_state, transitioned_at, transitioned_by, reason)
      VALUES ('c1', 'CANONICAL_ONLY', 'LEGACY_READ_WRITE', '${now}', 'system', 'Default CANONICAL_ONLY baseline for company c1');
    `);

    // Helper for adding column if not exists in sqlite
    const safeAddColumn = (table, colDef) => {
      try {
        dialect.exec(`ALTER TABLE ${table} ADD COLUMN ${colDef};`);
      } catch (err) {
        // Column may already exist
      }
    };

    // Tax Attribution columns on account_move_lines and finance_journal_lines
    const taxCols = [
      'tax_id TEXT', 'tax_version_id TEXT', 'fiscal_position_id TEXT',
      'tax_base_amount REAL DEFAULT 0', 'tax_amount REAL DEFAULT 0',
      'tax_currency_id TEXT', 'tax_company_amount REAL DEFAULT 0',
      'withholding_id TEXT', 'exemption_reason TEXT', 'reverse_charge_id TEXT',
      'tax_jurisdiction TEXT', 'tax_date TEXT'
    ];
    for (const col of taxCols) {
      safeAddColumn('account_move_lines', col);
      safeAddColumn('finance_journal_lines', col);
    }

    // Tax Attribution columns on fiscal_document_lines and finance_document_lines
    const docLineCols = [
      'tax_id TEXT', 'tax_version_id TEXT', 'tax_base_amount REAL DEFAULT 0',
      'tax_amount REAL DEFAULT 0', 'withholding_id TEXT', 'exemption_reason TEXT',
      'reverse_charge_id TEXT', 'tax_jurisdiction TEXT'
    ];
    for (const col of docLineCols) {
      safeAddColumn('fiscal_document_lines', col);
      safeAddColumn('finance_document_lines', col);
    }

    // Early discount & retainage on account_moves, fiscal_documents & finance_documents
    const docCols = [
      'early_discount_percent REAL DEFAULT 0', 'early_discount_days INTEGER DEFAULT 0',
      'early_discount_date TEXT', 'early_discount_amount REAL DEFAULT 0',
      'retainage_percent REAL DEFAULT 0', 'retainage_amount REAL DEFAULT 0',
      'retainage_due_date TEXT', 'retainage_released INTEGER DEFAULT 0',
      'retainage_release_date TEXT'
    ];
    for (const col of docCols) {
      safeAddColumn('account_moves', col);
      safeAddColumn('fiscal_documents', col);
      safeAddColumn('finance_documents', col);
    }

    // Unified period-lock columns on finance_locks
    safeAddColumn('finance_locks', 'journal_id TEXT');
    safeAddColumn('finance_locks', 'tax_lock INTEGER DEFAULT 0');
    safeAddColumn('finance_locks', 'approved_by TEXT');

    // Register platform_entities for cutover settings if needed
    const insEntity = dialect.prepare(`
      INSERT INTO platform_entities (
        id, module_id, storage_owner, primary_key, label_ar, label_en, section,
        sequence, seq_field, chatter, acl, status_key, fields, relations, scope,
        lifecycle_policy, query_policy, action_policy, customization_policy,
        history_policy, api_exposed, migration_owner, created_at, updated_at
      ) VALUES (?, ?, ?, 'company_id', ?, ?, 'finance', NULL, NULL, 0, NULL, NULL, '{}', '{}', 'company', 'generic', 'scoped', 'registered', 'metadata', 'audit', 1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET module_id = excluded.module_id, label_ar = excluded.label_ar, label_en = excluded.label_en, updated_at = excluded.updated_at
    `);
    insEntity.run('finance_cutover_settings', MODULE_ID, 'platform.finance', 'حالة تحويل النظام المالي', 'Finance Cutover State', MODULE_ID, now, now);

    // Register platform_actions for cutover transitions
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
      { id: 'finance_cutover:transition', entity_id: 'finance_cutover_settings', kind: 'domain', required_permission: 'finance_cutover:transition', input_schema: { required: ['target_state', 'reason'] } },
      { id: 'finance_cutover:get_status', entity_id: 'finance_cutover_settings', kind: 'query', required_permission: 'finance:view' }
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
    if (!existing.includes('035_governed_finance_cutover_and_tax_attribution')) {
      existing.push('035_governed_finance_cutover_and_tax_attribution');
      dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(existing), now, MODULE_ID);
    }
  },

  down(dialect) {
    dialect.exec(`
      DROP TABLE IF EXISTS finance_cutover_history;
      DROP TABLE IF EXISTS finance_cutover_settings;
    `);
    const actions = ['finance_cutover:transition', 'finance_cutover:get_status'];
    dialect.prepare(`DELETE FROM platform_actions WHERE id IN (${actions.map(() => '?').join(',')})`).run(...actions);
    dialect.prepare('DELETE FROM platform_entities WHERE id = ?').run('finance_cutover_settings');
    const existing = JSON.parse(dialect.parse ? dialect.parse('SELECT migrations FROM platform_modules WHERE id = ?') : dialect.prepare('SELECT migrations FROM platform_modules WHERE id = ?').get(MODULE_ID)?.migrations || '[]');
    const next = existing.filter(id => id !== '035_governed_finance_cutover_and_tax_attribution');
    dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), new Date().toISOString(), MODULE_ID);
  }
};
