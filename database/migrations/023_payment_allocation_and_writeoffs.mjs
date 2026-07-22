// 023_payment_allocation_and_writeoffs — Wave D
//
// Source composition:
// - VNext arap-engine.js payment_allocation table + allocation-target validation
//   (project-owned) MERGE-REFACTOR.
// - Odoo account.partial.reconcile (clean-room reference) for many-to-many
//   allocation lineage.
// - ERPNext Payment Entry references (clean-room reference) for
//   advance/unallocated-credit handling.
//
// What this migration does:
//   1. Creates finance_payment_allocations (immutable many-to-many settlement
//      lineage between a payment and an AR/AP document) and finance_write_offs.
//   2. Registers allocation/write-off authority actions.
//
// Invariants:
//   - Allocations are append-only; "unallocate" inserts a reversing allocation
//     row (negative amount, linked via reversed_allocation_id) rather than
//     deleting the original — full lineage survives, matching the ledger
//     invariant that posted facts are never edited or deleted.

const MODULE_ID = 'finance_canonical';
const now = new Date().toISOString();

export const migration = {
  id: '023_payment_allocation_and_writeoffs',
  owner: MODULE_ID,
  version: '1.9.0',
  dependsOn: ['022_payment_documents'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'VNext arap-engine.js payment_allocation (project-owned) MERGE-REFACTOR + Odoo account.partial.reconcile / ERPNext Payment Entry references (clean-room) mapped to finance_payment_allocations',

  up(dialect) {
    dialect.exec(`
      CREATE TABLE IF NOT EXISTS finance_payment_allocations (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        payment_id TEXT NOT NULL REFERENCES finance_payments(id),
        document_id TEXT NOT NULL REFERENCES finance_documents(id),
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'IQD',
        fx_difference REAL NOT NULL DEFAULT 0,
        reversed_allocation_id TEXT REFERENCES finance_payment_allocations(id),
        created_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_finance_payment_allocations_payment ON finance_payment_allocations(payment_id);
      CREATE INDEX IF NOT EXISTS idx_finance_payment_allocations_document ON finance_payment_allocations(document_id);

      CREATE TABLE IF NOT EXISTS finance_write_offs (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        document_id TEXT NOT NULL REFERENCES finance_documents(id),
        write_off_document_id TEXT NOT NULL REFERENCES finance_documents(id),
        amount REAL NOT NULL,
        write_off_account_id TEXT NOT NULL REFERENCES finance_accounts(id),
        reason TEXT NOT NULL,
        approved_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_finance_write_offs_document ON finance_write_offs(document_id);
    `);

    const insEntity = dialect.prepare(`
      INSERT INTO platform_entities (
        id, module_id, storage_owner, primary_key, label_ar, label_en, section,
        sequence, seq_field, chatter, acl, status_key, fields, relations, scope,
        lifecycle_policy, query_policy, action_policy, customization_policy,
        history_policy, api_exposed, migration_owner, created_at, updated_at
      ) VALUES (?, ?, ?, 'id', ?, ?, 'finance', NULL, NULL, 0, NULL, NULL, '{}', '{}', 'company', 'immutable', 'scoped', 'registered', 'metadata', 'audit', 1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET module_id = excluded.module_id, label_ar = excluded.label_ar, label_en = excluded.label_en, updated_at = excluded.updated_at
    `);
    for (const e of [
      { id: 'finance_payment_allocation', label_ar: 'تخصيص دفعة', label_en: 'Payment Allocation' },
      { id: 'finance_write_off', label_ar: 'شطب رصيد', label_en: 'Write-off' },
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
      { id: 'finance_payment:allocate', entity_id: 'finance_payment_allocation', kind: 'domain', required_permission: 'finance_payment:allocate', input_schema: { required: ['payment_id', 'document_id', 'amount'] } },
      { id: 'finance_payment:unallocate', entity_id: 'finance_payment_allocation', kind: 'domain', required_permission: 'finance_payment:allocate', input_schema: { required: ['allocation_id'] } },
      { id: 'finance_document:write_off', entity_id: 'finance_write_off', kind: 'domain', required_permission: 'finance_document:write_off', input_schema: { required: ['document_id', 'write_off_account_id', 'reason'] } },
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
    if (!existing.includes('023_payment_allocation_and_writeoffs')) {
      existing.push('023_payment_allocation_and_writeoffs');
      dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(existing), now, MODULE_ID);
    }
  },

  down(dialect) {
    dialect.exec(`
      DROP TABLE IF EXISTS finance_write_offs;
      DROP TABLE IF EXISTS finance_payment_allocations;
    `);
    const actions = ['finance_payment:allocate', 'finance_payment:unallocate', 'finance_document:write_off'];
    dialect.prepare(`DELETE FROM platform_actions WHERE id IN (${actions.map(() => '?').join(',')})`).run(...actions);
    const entities = ['finance_payment_allocation', 'finance_write_off'];
    dialect.prepare(`DELETE FROM platform_entities WHERE id IN (${entities.map(() => '?').join(',')})`).run(...entities);
    const existing = JSON.parse(dialect.prepare('SELECT migrations FROM platform_modules WHERE id = ?').get(MODULE_ID)?.migrations || '[]');
    const next = existing.filter(id => id !== '023_payment_allocation_and_writeoffs');
    dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), new Date().toISOString(), MODULE_ID);
  }
};
