// 020_accounts_receivable_subledger — Wave C
//
// Source composition:
// - VNext arap-engine.js documentOpenAmount/due-date shape (project-owned) MERGE-REFACTOR
//   (payment-allocation-based residual arrives in Wave D once finance_payments exists;
//   this packet covers the subledger foundation: due schedules, credit-note linkage, aging).
// - Odoo account_move residual/payment_state behavior (clean-room reference).
// - ERPNext receivables/payment-terms (clean-room reference) for due-schedule/aging shape.
//
// What this migration does:
//   1. Creates finance_due_schedules (installment due dates per document).
//   2. Registers AR due-schedule authority actions.
//   Customer open items and aging are computed from finance_documents +
//   finance_journal_lines + finance_due_schedules (no separate AR ledger copy —
//   one canonical GL authority, per Section 5 of the Phase 03 spec).
//
// Invariants:
//   - Due dates may only change before posting (post-time the schedule is frozen).
//   - Aging always reconciles to the receivable control-account GL balance
//     because it is derived, not duplicated (see engine.mjs getCustomerAging).

const MODULE_ID = 'finance_canonical';
const now = new Date().toISOString();

export const migration = {
  id: '020_accounts_receivable_subledger',
  owner: MODULE_ID,
  version: '1.6.0',
  dependsOn: ['019_fiscal_positions_and_iraq_localization'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'VNext arap-engine.js due-date/open-amount shape + Odoo account_move residual (clean-room) + ERPNext receivables (clean-room) mapped to finance_due_schedules',

  up(dialect) {
    dialect.exec(`
      CREATE TABLE IF NOT EXISTS finance_due_schedules (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        document_id TEXT NOT NULL REFERENCES finance_documents(id),
        partner_id TEXT,
        sequence INTEGER NOT NULL DEFAULT 1,
        due_date TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'IQD',
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_finance_due_schedules_document ON finance_due_schedules(document_id);
      CREATE INDEX IF NOT EXISTS idx_finance_due_schedules_partner_due ON finance_due_schedules(company_id, partner_id, due_date);
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
      { id: 'finance_due_schedule', label_ar: 'جدول استحقاق', label_en: 'Due Schedule' },
      { id: 'finance_ar_open_items', label_ar: 'بنود مدينون مفتوحة', label_en: 'AR Open Items' },
      { id: 'finance_ar_aging', label_ar: 'تقادم المدينين', label_en: 'AR Aging' },
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
      { id: 'finance_due_schedule:set', entity_id: 'finance_due_schedule', kind: 'domain', required_permission: 'finance_document:create', input_schema: { required: ['document_id', 'schedule'] } },
      { id: 'finance_ar:open_items', entity_id: 'finance_ar_open_items', kind: 'domain', required_permission: 'finance_ar:read', input_schema: {} },
      { id: 'finance_ar:aging', entity_id: 'finance_ar_aging', kind: 'domain', required_permission: 'finance_ar:read', input_schema: {} },
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
    if (!existing.includes('020_accounts_receivable_subledger')) {
      existing.push('020_accounts_receivable_subledger');
      dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(existing), now, MODULE_ID);
    }
  },

  down(dialect) {
    dialect.exec(`DROP TABLE IF EXISTS finance_due_schedules;`);
    const actions = ['finance_due_schedule:set', 'finance_ar:open_items', 'finance_ar:aging'];
    const placeholders = actions.map(() => '?').join(',');
    dialect.prepare(`DELETE FROM platform_actions WHERE id IN (${placeholders})`).run(...actions);
    const entities = ['finance_due_schedule', 'finance_ar_open_items', 'finance_ar_aging'];
    dialect.prepare(`DELETE FROM platform_entities WHERE id IN (${entities.map(() => '?').join(',')})`).run(...entities);
    const existing = JSON.parse(dialect.prepare('SELECT migrations FROM platform_modules WHERE id = ?').get(MODULE_ID)?.migrations || '[]');
    const next = existing.filter(id => id !== '020_accounts_receivable_subledger');
    dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), new Date().toISOString(), MODULE_ID);
  }
};
