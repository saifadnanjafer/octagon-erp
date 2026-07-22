// 021_accounts_payable_subledger — Wave C
//
// Source composition:
// - VNext arap-engine.js supplier-side document_kind handling (project-owned) MERGE-REFACTOR.
// - Odoo/ERPNext/Aureus supplier-bill duplicate-reference detection (clean-room reference).
// - Phase 04 purchase-match extension is a forward hook only (three-way match is
//   explicitly deferred to Phase 04 per PHASE_03 Section 4.3); this packet exposes
//   the hold/duplicate-detection/authority-limit primitives the future match will call.
//
// What this migration does:
//   1. Creates finance_payment_holds (supplier payment holds with reason/release).
//   2. Creates finance_approval_authority_limits (per-role/user posting/payment ceilings).
//   3. Registers AP authority actions.
//
// Invariants:
//   - Duplicate supplier invoice detection uses (partner_id, source_canonical_key)
//     on finance_documents, which is already unique-checked at the application layer
//     in engine.mjs (createDocument) — this migration adds the supporting index.

const MODULE_ID = 'finance_canonical';
const now = new Date().toISOString();

export const migration = {
  id: '021_accounts_payable_subledger',
  owner: MODULE_ID,
  version: '1.7.0',
  dependsOn: ['020_accounts_receivable_subledger'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'VNext arap-engine.js supplier document_kind handling + Odoo/ERPNext/Aureus duplicate-bill detection (clean-room) mapped to finance_payment_holds/finance_approval_authority_limits',

  up(dialect) {
    dialect.exec(`
      CREATE TABLE IF NOT EXISTS finance_payment_holds (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        document_id TEXT NOT NULL REFERENCES finance_documents(id),
        reason TEXT NOT NULL,
        held_by TEXT NOT NULL,
        held_at TEXT NOT NULL,
        released_by TEXT,
        released_at TEXT,
        status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held','released'))
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_finance_payment_holds_document ON finance_payment_holds(document_id, status);

      CREATE TABLE IF NOT EXISTS finance_approval_authority_limits (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        role_or_user TEXT NOT NULL,
        limit_type TEXT NOT NULL CHECK (limit_type IN ('post','payment')),
        max_amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'IQD',
        created_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_approval_authority_limits_unique ON finance_approval_authority_limits(company_id, role_or_user, limit_type);

      CREATE INDEX IF NOT EXISTS idx_finance_documents_dup_ref ON finance_documents(company_id, partner_id, move_type, source_canonical_key);
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
      { id: 'finance_payment_hold', label_ar: 'إيقاف دفع', label_en: 'Payment Hold' },
      { id: 'finance_ap_open_items', label_ar: 'بنود دائنون مفتوحة', label_en: 'AP Open Items' },
      { id: 'finance_ap_aging', label_ar: 'تقادم الدائنين', label_en: 'AP Aging' },
      { id: 'finance_approval_authority_limit', label_ar: 'حد صلاحية الاعتماد', label_en: 'Approval Authority Limit' },
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
      { id: 'finance_ap:hold', entity_id: 'finance_payment_hold', kind: 'domain', required_permission: 'finance_ap:manage', input_schema: { required: ['document_id', 'reason'] } },
      { id: 'finance_ap:release_hold', entity_id: 'finance_payment_hold', kind: 'domain', required_permission: 'finance_ap:manage', input_schema: { required: ['hold_id'] } },
      { id: 'finance_ap:open_items', entity_id: 'finance_ap_open_items', kind: 'domain', required_permission: 'finance_ap:read', input_schema: {} },
      { id: 'finance_ap:aging', entity_id: 'finance_ap_aging', kind: 'domain', required_permission: 'finance_ap:read', input_schema: {} },
      { id: 'finance_authority_limit:set', entity_id: 'finance_approval_authority_limit', kind: 'domain', required_permission: 'finance_ap:manage', input_schema: { required: ['role_or_user', 'limit_type', 'max_amount'] } },
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
    if (!existing.includes('021_accounts_payable_subledger')) {
      existing.push('021_accounts_payable_subledger');
      dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(existing), now, MODULE_ID);
    }
  },

  down(dialect) {
    dialect.exec(`
      DROP INDEX IF EXISTS idx_finance_documents_dup_ref;
      DROP TABLE IF EXISTS finance_approval_authority_limits;
      DROP TABLE IF EXISTS finance_payment_holds;
    `);
    const actions = ['finance_ap:hold', 'finance_ap:release_hold', 'finance_ap:open_items', 'finance_ap:aging', 'finance_authority_limit:set'];
    const placeholders = actions.map(() => '?').join(',');
    dialect.prepare(`DELETE FROM platform_actions WHERE id IN (${placeholders})`).run(...actions);
    const entities = ['finance_payment_hold', 'finance_ap_open_items', 'finance_ap_aging', 'finance_approval_authority_limit'];
    dialect.prepare(`DELETE FROM platform_entities WHERE id IN (${entities.map(() => '?').join(',')})`).run(...entities);
    const existing = JSON.parse(dialect.prepare('SELECT migrations FROM platform_modules WHERE id = ?').get(MODULE_ID)?.migrations || '[]');
    const next = existing.filter(id => id !== '021_accounts_payable_subledger');
    dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), new Date().toISOString(), MODULE_ID);
  }
};
