// 026_cashboxes_and_petty_cash — Wave D
//
// Source composition:
// - Current Octagon `services/financeService.js` cashbox-effect/category fields
//   (cashboxEffect(), 'cashbox' sourceType) — PRESERVE the concept (cash moves
//   are already a first-class idea in the legacy writer) while replacing the
//   free-form category field with a canonical custodian/shift/count model.
// - ERPNext Cash/Bank + POS opening/closing-entry behavior (clean-room
//   reference) for the shift-open/count/close/variance shape.
// - SPEC-IMPLEMENT: the custodian/shift/count/variance/replenishment/close
//   lifecycle itself is not copied from any donor; it is built directly from
//   the Phase 03 governing document's Packet 03.19 requirement list.
//
// What this migration does:
//   1. Creates finance_cashboxes, finance_cash_shifts, finance_cash_counts.
//   2. Registers cashbox/shift authority actions.
//
// Invariants:
//   - Only one shift may be 'open' per cashbox at a time (enforced by the
//     engine, not a DB constraint, to keep the error message actionable).
//   - A closed shift's counted totals are immutable; correction requires a new
//     shift and a linked adjustment, matching the same "no editing history"
//     invariant every other Phase 03 fact follows.

const MODULE_ID = 'finance_canonical';
const now = new Date().toISOString();

export const migration = {
  id: '026_cashboxes_and_petty_cash',
  owner: MODULE_ID,
  version: '1.12.0',
  dependsOn: ['025_banking_and_statement_import'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Current Octagon financeService.js cashbox-effect concept (PRESERVE) + ERPNext cash/POS shift shape (clean-room) + SPEC-IMPLEMENT custodian/shift/count lifecycle mapped to finance_cashboxes/finance_cash_shifts/finance_cash_counts',

  up(dialect) {
    dialect.exec(`
      CREATE TABLE IF NOT EXISTS finance_cashboxes (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        branch_id TEXT,
        name TEXT NOT NULL,
        gl_account_id TEXT NOT NULL REFERENCES finance_accounts(id),
        custodian_user_id TEXT,
        currency TEXT NOT NULL DEFAULT 'IQD',
        max_balance REAL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS finance_cash_shifts (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        cashbox_id TEXT NOT NULL REFERENCES finance_cashboxes(id),
        opened_by TEXT NOT NULL,
        opening_balance REAL NOT NULL,
        expected_closing_balance REAL,
        actual_closing_balance REAL,
        variance REAL,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
        opened_at TEXT NOT NULL,
        closed_at TEXT,
        closed_by TEXT
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_finance_cash_shifts_cashbox_status ON finance_cash_shifts(cashbox_id, status);

      CREATE TABLE IF NOT EXISTS finance_cash_counts (
        id TEXT PRIMARY KEY,
        shift_id TEXT NOT NULL REFERENCES finance_cash_shifts(id),
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        counted_amount REAL NOT NULL,
        expected_amount REAL NOT NULL,
        variance REAL NOT NULL,
        counted_by TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_finance_cash_counts_shift ON finance_cash_counts(shift_id);
    `);

    const insEntity = dialect.prepare(`
      INSERT INTO platform_entities (
        id, module_id, storage_owner, primary_key, label_ar, label_en, section,
        sequence, seq_field, chatter, acl, status_key, fields, relations, scope,
        lifecycle_policy, query_policy, action_policy, customization_policy,
        history_policy, api_exposed, migration_owner, created_at, updated_at
      ) VALUES (?, ?, ?, 'id', ?, ?, 'finance', NULL, NULL, 0, NULL, ?, '{}', '{}', 'branch', ?, 'scoped', 'registered', 'metadata', 'audit', 1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET module_id = excluded.module_id, label_ar = excluded.label_ar, label_en = excluded.label_en, updated_at = excluded.updated_at
    `);
    for (const e of [
      { id: 'finance_cashbox', label_ar: 'صندوق نقدي', label_en: 'Cashbox', status_key: null, lifecycle: 'generic' },
      { id: 'finance_cash_shift', label_ar: 'وردية صندوق', label_en: 'Cash Shift', status_key: 'status', lifecycle: 'state_machine' },
      { id: 'finance_cash_count', label_ar: 'جرد نقدي', label_en: 'Cash Count', status_key: null, lifecycle: 'immutable' },
    ]) {
      insEntity.run(e.id, MODULE_ID, 'platform.finance', e.label_ar, e.label_en, e.status_key, e.lifecycle, MODULE_ID, now, now);
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
      { id: 'finance_cashbox:create', entity_id: 'finance_cashbox', kind: 'domain', required_permission: 'finance_cashbox:manage', input_schema: { required: ['name', 'gl_account_id'] } },
      { id: 'finance_cash_shift:open', entity_id: 'finance_cash_shift', kind: 'domain', required_permission: 'finance_cash_shift:open', input_schema: { required: ['cashbox_id', 'opening_balance'] } },
      { id: 'finance_cash_shift:count', entity_id: 'finance_cash_count', kind: 'domain', required_permission: 'finance_cash_shift:count', allowed_states: ['open'], input_schema: { required: ['shift_id', 'counted_amount'] } },
      { id: 'finance_cash_shift:close', entity_id: 'finance_cash_shift', kind: 'domain', required_permission: 'finance_cash_shift:close', allowed_states: ['open'], input_schema: { required: ['shift_id', 'actual_closing_balance'] } },
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
    if (!existing.includes('026_cashboxes_and_petty_cash')) {
      existing.push('026_cashboxes_and_petty_cash');
      dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(existing), now, MODULE_ID);
    }
  },

  down(dialect) {
    dialect.exec(`
      DROP TABLE IF EXISTS finance_cash_counts;
      DROP TABLE IF EXISTS finance_cash_shifts;
      DROP TABLE IF EXISTS finance_cashboxes;
    `);
    const actions = ['finance_cashbox:create', 'finance_cash_shift:open', 'finance_cash_shift:count', 'finance_cash_shift:close'];
    dialect.prepare(`DELETE FROM platform_actions WHERE id IN (${actions.map(() => '?').join(',')})`).run(...actions);
    const entities = ['finance_cashbox', 'finance_cash_shift', 'finance_cash_count'];
    dialect.prepare(`DELETE FROM platform_entities WHERE id IN (${entities.map(() => '?').join(',')})`).run(...entities);
    const existing = JSON.parse(dialect.prepare('SELECT migrations FROM platform_modules WHERE id = ?').get(MODULE_ID)?.migrations || '[]');
    const next = existing.filter(id => id !== '026_cashboxes_and_petty_cash');
    dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), new Date().toISOString(), MODULE_ID);
  }
};
