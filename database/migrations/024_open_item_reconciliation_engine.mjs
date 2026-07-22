// 024_open_item_reconciliation_engine — Wave D
//
// Source composition:
// - VNext bank-engine.js matchBankLine/manualReconcile/unreconcile shape
//   (project-owned) MERGE-REFACTOR, generalized from "bank line vs payment"
//   to "unallocated payment vs AR/AP open item" candidate matching.
// - Odoo account.partial.reconcile / account.full.reconcile (clean-room
//   reference) for exact/partial reconciliation status semantics.
// - ERPNext Payment Reconciliation tool (clean-room reference) for the
//   session + candidate-list + confirm workflow shape.
//
// What this migration does:
//   1. Creates finance_reconciliation_sessions and finance_reconciliation_matches.
//   2. Registers reconciliation-session authority actions.
//
// Invariants:
//   - A confirmed match never mutates ledger evidence; it creates a
//     finance_payment_allocations row (Wave D Packet 03.16) through the same
//     allocatePayment() path a manual allocation would use.
//   - Undo inserts a reversing allocation (via unallocatePayment) and marks the
//     match undone; it never deletes the original match row.

const MODULE_ID = 'finance_canonical';
const now = new Date().toISOString();

export const migration = {
  id: '024_open_item_reconciliation_engine',
  owner: MODULE_ID,
  version: '1.10.0',
  dependsOn: ['023_payment_allocation_and_writeoffs'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'VNext bank-engine.js matchBankLine/manualReconcile/unreconcile (project-owned) MERGE-REFACTOR generalized to AR/AP candidate matching, + Odoo/ERPNext reconciliation session shape (clean-room)',

  up(dialect) {
    dialect.exec(`
      CREATE TABLE IF NOT EXISTS finance_reconciliation_sessions (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        target_type TEXT NOT NULL CHECK (target_type IN ('ar','ap')),
        partner_id TEXT,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
        opened_by TEXT NOT NULL,
        closed_by TEXT,
        created_at TEXT NOT NULL,
        closed_at TEXT
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_finance_reconciliation_sessions_company ON finance_reconciliation_sessions(company_id, status);

      CREATE TABLE IF NOT EXISTS finance_reconciliation_matches (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES finance_reconciliation_sessions(id),
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        document_id TEXT NOT NULL REFERENCES finance_documents(id),
        payment_id TEXT NOT NULL REFERENCES finance_payments(id),
        allocation_id TEXT REFERENCES finance_payment_allocations(id),
        amount REAL NOT NULL,
        method TEXT NOT NULL CHECK (method IN ('exact','tolerance','manual')),
        confidence REAL NOT NULL DEFAULT 1,
        explain TEXT,
        status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','undone')),
        created_at TEXT NOT NULL,
        created_by TEXT,
        undone_at TEXT,
        undone_by TEXT
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_finance_reconciliation_matches_session ON finance_reconciliation_matches(session_id);
    `);

    const insEntity = dialect.prepare(`
      INSERT INTO platform_entities (
        id, module_id, storage_owner, primary_key, label_ar, label_en, section,
        sequence, seq_field, chatter, acl, status_key, fields, relations, scope,
        lifecycle_policy, query_policy, action_policy, customization_policy,
        history_policy, api_exposed, migration_owner, created_at, updated_at
      ) VALUES (?, ?, ?, 'id', ?, ?, 'finance', NULL, NULL, 0, NULL, 'status', '{}', '{}', 'company', 'state_machine', 'scoped', 'registered', 'metadata', 'audit', 1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET module_id = excluded.module_id, label_ar = excluded.label_ar, label_en = excluded.label_en, updated_at = excluded.updated_at
    `);
    for (const e of [
      { id: 'finance_reconciliation_session', label_ar: 'جلسة مطابقة', label_en: 'Reconciliation Session' },
      { id: 'finance_reconciliation_match', label_ar: 'مطابقة تسوية', label_en: 'Reconciliation Match' },
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
      { id: 'finance_reconciliation:open_session', entity_id: 'finance_reconciliation_session', kind: 'domain', required_permission: 'finance_reconciliation:manage', input_schema: { required: ['target_type'] } },
      { id: 'finance_reconciliation:confirm_match', entity_id: 'finance_reconciliation_match', kind: 'domain', required_permission: 'finance_reconciliation:manage', input_schema: { required: ['session_id', 'document_id', 'payment_id', 'amount'] } },
      { id: 'finance_reconciliation:undo_match', entity_id: 'finance_reconciliation_match', kind: 'domain', required_permission: 'finance_reconciliation:manage', input_schema: { required: ['match_id'] } },
      { id: 'finance_reconciliation:close_session', entity_id: 'finance_reconciliation_session', kind: 'domain', required_permission: 'finance_reconciliation:manage', input_schema: { required: ['session_id'] } },
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
    if (!existing.includes('024_open_item_reconciliation_engine')) {
      existing.push('024_open_item_reconciliation_engine');
      dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(existing), now, MODULE_ID);
    }
  },

  down(dialect) {
    dialect.exec(`
      DROP TABLE IF EXISTS finance_reconciliation_matches;
      DROP TABLE IF EXISTS finance_reconciliation_sessions;
    `);
    const actions = ['finance_reconciliation:open_session', 'finance_reconciliation:confirm_match', 'finance_reconciliation:undo_match', 'finance_reconciliation:close_session'];
    dialect.prepare(`DELETE FROM platform_actions WHERE id IN (${actions.map(() => '?').join(',')})`).run(...actions);
    const entities = ['finance_reconciliation_session', 'finance_reconciliation_match'];
    dialect.prepare(`DELETE FROM platform_entities WHERE id IN (${entities.map(() => '?').join(',')})`).run(...entities);
    const existing = JSON.parse(dialect.prepare('SELECT migrations FROM platform_modules WHERE id = ?').get(MODULE_ID)?.migrations || '[]');
    const next = existing.filter(id => id !== '024_open_item_reconciliation_engine');
    dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), new Date().toISOString(), MODULE_ID);
  }
};
