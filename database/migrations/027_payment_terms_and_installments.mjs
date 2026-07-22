// 027_payment_terms_and_installments — Wave D
//
// Source composition:
// - VNext typed-document due-date field (project-owned) — the single due_date
//   VNext carried on arap_document is generalized here into a versioned,
//   rule-based term template that generates a multi-line finance_due_schedules
//   set (Wave C, Packet 03.13) at document-creation time.
// - Odoo account.payment.term / account.payment.term.line (clean-room
//   reference) for percentage/fixed/balance line types and day/month-end rules.
// - ERPNext Payment Terms Template (clean-room reference) confirming the
//   installment + early-payment-discount shape.
//
// What this migration does:
//   1. Creates finance_payment_term_templates and finance_payment_term_lines.
//   2. Registers payment-term authority actions.
//
// Invariants:
//   - A term template only ever *generates* a finance_due_schedules set; it is
//     never itself a live pointer a posted document depends on, so editing a
//     template after documents were generated from it cannot retroactively
//     change any posted document's schedule (matches Wave C's existing
//     "schedule can only be set before posting" rule).

const MODULE_ID = 'finance_canonical';
const now = new Date().toISOString();

export const migration = {
  id: '027_payment_terms_and_installments',
  owner: MODULE_ID,
  version: '1.13.0',
  dependsOn: ['026_cashboxes_and_petty_cash'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'VNext due-date field (project-owned) generalized + Odoo account.payment.term / ERPNext Payment Terms Template (clean-room) mapped to finance_payment_term_templates/finance_payment_term_lines',

  up(dialect) {
    dialect.exec(`
      CREATE TABLE IF NOT EXISTS finance_payment_term_templates (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        name_ar TEXT,
        early_discount_percent REAL NOT NULL DEFAULT 0,
        early_discount_days INTEGER NOT NULL DEFAULT 0,
        retainage_percent REAL NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_payment_term_templates_company_code ON finance_payment_term_templates(company_id, code);

      CREATE TABLE IF NOT EXISTS finance_payment_term_lines (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL REFERENCES finance_payment_term_templates(id),
        sequence INTEGER NOT NULL DEFAULT 0,
        line_type TEXT NOT NULL CHECK (line_type IN ('percent','fixed','balance')),
        value REAL NOT NULL DEFAULT 0,
        due_rule TEXT NOT NULL DEFAULT 'days_after_date' CHECK (due_rule IN ('days_after_date','days_after_month_end','fixed_day_next_month')),
        due_days INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_finance_payment_term_lines_template ON finance_payment_term_lines(template_id, sequence);
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
      { id: 'finance_payment_term_template', label_ar: 'قالب شروط دفع', label_en: 'Payment Term Template' },
      { id: 'finance_payment_term_line', label_ar: 'سطر شرط دفع', label_en: 'Payment Term Line' },
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
      { id: 'finance_payment_term:create', entity_id: 'finance_payment_term_template', kind: 'domain', required_permission: 'finance_payment_term:manage', input_schema: { required: ['code', 'name', 'lines'] } },
      { id: 'finance_payment_term:generate_schedule', entity_id: 'finance_due_schedule', kind: 'domain', required_permission: 'finance_document:create', input_schema: { required: ['document_id', 'template_id'] } },
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
    if (!existing.includes('027_payment_terms_and_installments')) {
      existing.push('027_payment_terms_and_installments');
      dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(existing), now, MODULE_ID);
    }
  },

  down(dialect) {
    dialect.exec(`
      DROP TABLE IF EXISTS finance_payment_term_lines;
      DROP TABLE IF EXISTS finance_payment_term_templates;
    `);
    const actions = ['finance_payment_term:create', 'finance_payment_term:generate_schedule'];
    dialect.prepare(`DELETE FROM platform_actions WHERE id IN (${actions.map(() => '?').join(',')})`).run(...actions);
    const entities = ['finance_payment_term_template', 'finance_payment_term_line'];
    dialect.prepare(`DELETE FROM platform_entities WHERE id IN (${entities.map(() => '?').join(',')})`).run(...entities);
    const existing = JSON.parse(dialect.prepare('SELECT migrations FROM platform_modules WHERE id = ?').get(MODULE_ID)?.migrations || '[]');
    const next = existing.filter(id => id !== '027_payment_terms_and_installments');
    dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), new Date().toISOString(), MODULE_ID);
  }
};
