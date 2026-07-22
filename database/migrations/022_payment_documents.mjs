// 022_payment_documents — Wave D
//
// Source composition:
// - VNext arap-engine.js createPayment (project-owned) MERGE-REFACTOR: one
//   payment/receipt/transfer document model, idempotency-key dedup, cash/bank/
//   clearing methods, fee lines, GL effect via the existing posting pipeline.
// - Odoo account.payment (clean-room reference) for payer/payee + method shape.
// - ERPNext Payment Entry (clean-room reference) for reference/provider-hook shape.
//
// What this migration does:
//   1. Creates finance_payments (the one payment/receipt/transfer document model).
//   2. Registers payment authority actions.
//
// Invariants:
//   - Every payment posts through the existing finance_document pipeline (one
//     posting authority; see engine.mjs postDocument) — this table stores
//     payment-specific metadata (method, payer/payee, provider reference) and
//     links to the finance_documents row that carries the actual GL effect.
//   - idempotency_key is unique per company: replaying the same key returns the
//     existing payment rather than creating a duplicate (defense in depth on top
//     of the Phase 01 action-executor's own idempotency handling).

const MODULE_ID = 'finance_canonical';
const now = new Date().toISOString();

export const migration = {
  id: '022_payment_documents',
  owner: MODULE_ID,
  version: '1.8.0',
  dependsOn: ['021_accounts_payable_subledger'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'VNext arap-engine.js createPayment (project-owned) MERGE-REFACTOR + Odoo account.payment / ERPNext Payment Entry (clean-room) mapped to finance_payments',

  up(dialect) {
    dialect.exec(`
      CREATE TABLE IF NOT EXISTS finance_payments (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        document_id TEXT NOT NULL REFERENCES finance_documents(id),
        payment_type TEXT NOT NULL CHECK (payment_type IN ('receive','pay','transfer')),
        method TEXT NOT NULL CHECK (method IN ('cash','bank','clearing')),
        partner_id TEXT,
        cash_or_bank_account_id TEXT NOT NULL REFERENCES finance_accounts(id),
        counter_account_id TEXT REFERENCES finance_accounts(id),
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'IQD',
        fx_rate REAL NOT NULL DEFAULT 1,
        fee_amount REAL NOT NULL DEFAULT 0,
        fee_account_id TEXT REFERENCES finance_accounts(id),
        payment_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','cancelled')),
        idempotency_key TEXT NOT NULL,
        reference TEXT,
        provider_reference TEXT,
        unallocated_amount REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_payments_idempotency ON finance_payments(company_id, idempotency_key);
      CREATE INDEX IF NOT EXISTS idx_finance_payments_partner ON finance_payments(company_id, partner_id, status);
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
    insEntity.run('finance_payment', MODULE_ID, 'platform.finance', 'دفعة', 'Payment', MODULE_ID, now, now);

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
      { id: 'finance_payment:create', entity_id: 'finance_payment', kind: 'domain', required_permission: 'finance_payment:create', input_schema: { required: ['payment_type', 'method', 'amount', 'cash_or_bank_account_id', 'idempotency_key'] } },
      { id: 'finance_payment:post', entity_id: 'finance_payment', kind: 'domain', required_permission: 'finance_payment:post', allowed_states: ['draft'], input_schema: { required: ['payment_id'] } },
      { id: 'finance_payment:reverse', entity_id: 'finance_payment', kind: 'domain', required_permission: 'finance_payment:reverse', allowed_states: ['posted'], input_schema: { required: ['payment_id'] }, reversal_action: null },
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
    if (!existing.includes('022_payment_documents')) {
      existing.push('022_payment_documents');
      dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(existing), now, MODULE_ID);
    }
  },

  down(dialect) {
    dialect.exec(`DROP TABLE IF EXISTS finance_payments;`);
    const actions = ['finance_payment:create', 'finance_payment:post', 'finance_payment:reverse'];
    dialect.prepare(`DELETE FROM platform_actions WHERE id IN (${actions.map(() => '?').join(',')})`).run(...actions);
    dialect.prepare('DELETE FROM platform_entities WHERE id = ?').run('finance_payment');
    const existing = JSON.parse(dialect.prepare('SELECT migrations FROM platform_modules WHERE id = ?').get(MODULE_ID)?.migrations || '[]');
    const next = existing.filter(id => id !== '022_payment_documents');
    dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), new Date().toISOString(), MODULE_ID);
  }
};
