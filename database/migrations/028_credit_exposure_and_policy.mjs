// 028_credit_exposure_and_policy — Wave D
//
// Source composition:
// - VNext AR/sales policy exploration (project-owned, foundation-level) —
//   informed the "profile + limit + hold reason" shape.
// - Odoo res.partner credit-limit fields + ERPNext Customer Credit Limit
//   (clean-room reference) for the limit/overdue-policy/override-approval shape.
// - SPEC-IMPLEMENT: the real-time exposure query itself is built directly
//   against Wave C's `getCustomerOpenItems`/`getCustomerAging` — it is a
//   composition of already-canonical Phase 03 queries, not a new balance
//   authority.
//
// What this migration does:
//   1. Creates finance_credit_profiles and finance_credit_holds.
//   2. Registers credit-policy authority actions.
//
// Invariants:
//   - Finance supplies exactly one exposure query (`getCreditExposure`); Phase
//     04 sales-order blocking/release consumes it but does not duplicate the
//     underlying balance computation (Section 5: "one canonical authority").

const MODULE_ID = 'finance_canonical';
const now = new Date().toISOString();

export const migration = {
  id: '028_credit_exposure_and_policy',
  owner: MODULE_ID,
  version: '1.14.0',
  dependsOn: ['027_payment_terms_and_installments'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'VNext AR/sales policy exploration (project-owned foundation) + Odoo res.partner credit limit / ERPNext Customer Credit Limit (clean-room) + SPEC-IMPLEMENT exposure query composed from Wave C AR queries, mapped to finance_credit_profiles/finance_credit_holds',

  up(dialect) {
    dialect.exec(`
      CREATE TABLE IF NOT EXISTS finance_credit_profiles (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        partner_id TEXT NOT NULL,
        credit_limit REAL NOT NULL DEFAULT 0,
        overdue_grace_days INTEGER NOT NULL DEFAULT 0,
        temporary_limit_override REAL,
        temporary_limit_expires_at TEXT,
        include_guarantees REAL NOT NULL DEFAULT 0,
        include_disputed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_credit_profiles_partner ON finance_credit_profiles(company_id, partner_id);

      CREATE TABLE IF NOT EXISTS finance_credit_holds (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        partner_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        held_by TEXT NOT NULL,
        held_at TEXT NOT NULL,
        released_by TEXT,
        released_at TEXT,
        released_reason TEXT,
        status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held','released'))
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_finance_credit_holds_partner ON finance_credit_holds(company_id, partner_id, status);
    `);

    const insEntity = dialect.prepare(`
      INSERT INTO platform_entities (
        id, module_id, storage_owner, primary_key, label_ar, label_en, section,
        sequence, seq_field, chatter, acl, status_key, fields, relations, scope,
        lifecycle_policy, query_policy, action_policy, customization_policy,
        history_policy, api_exposed, migration_owner, created_at, updated_at
      ) VALUES (?, ?, ?, 'id', ?, ?, 'finance', NULL, NULL, 0, NULL, ?, '{}', '{}', 'company', 'generic', 'scoped', 'registered', 'metadata', 'audit', 1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET module_id = excluded.module_id, label_ar = excluded.label_ar, label_en = excluded.label_en, updated_at = excluded.updated_at
    `);
    insEntity.run('finance_credit_profile', MODULE_ID, 'platform.finance', 'ملف ائتماني', 'Credit Profile', null, MODULE_ID, now, now);
    insEntity.run('finance_credit_hold', MODULE_ID, 'platform.finance', 'إيقاف ائتماني', 'Credit Hold', 'status', MODULE_ID, now, now);

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
      { id: 'finance_credit_profile:set', entity_id: 'finance_credit_profile', kind: 'domain', required_permission: 'finance_credit:manage', input_schema: { required: ['partner_id', 'credit_limit'] } },
      { id: 'finance_credit:hold', entity_id: 'finance_credit_hold', kind: 'domain', required_permission: 'finance_credit:manage', input_schema: { required: ['partner_id', 'reason'] } },
      { id: 'finance_credit:release_hold', entity_id: 'finance_credit_hold', kind: 'domain', required_permission: 'finance_credit:manage', input_schema: { required: ['hold_id'] } },
      { id: 'finance_credit:exposure', entity_id: 'finance_credit_profile', kind: 'domain', required_permission: 'finance_credit:read', input_schema: { required: ['partner_id'] } },
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
    if (!existing.includes('028_credit_exposure_and_policy')) {
      existing.push('028_credit_exposure_and_policy');
      dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(existing), now, MODULE_ID);
    }
  },

  down(dialect) {
    dialect.exec(`
      DROP TABLE IF EXISTS finance_credit_holds;
      DROP TABLE IF EXISTS finance_credit_profiles;
    `);
    const actions = ['finance_credit_profile:set', 'finance_credit:hold', 'finance_credit:release_hold', 'finance_credit:exposure'];
    dialect.prepare(`DELETE FROM platform_actions WHERE id IN (${actions.map(() => '?').join(',')})`).run(...actions);
    const entities = ['finance_credit_profile', 'finance_credit_hold'];
    dialect.prepare(`DELETE FROM platform_entities WHERE id IN (${entities.map(() => '?').join(',')})`).run(...entities);
    const existing = JSON.parse(dialect.prepare('SELECT migrations FROM platform_modules WHERE id = ?').get(MODULE_ID)?.migrations || '[]');
    const next = existing.filter(id => id !== '028_credit_exposure_and_policy');
    dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), new Date().toISOString(), MODULE_ID);
  }
};
