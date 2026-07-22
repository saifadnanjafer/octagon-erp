// 030_expense_claims_and_advances — Wave E
//
// Source composition:
// - Current Octagon payroll-finance bridge and expense pages inspected
//   (services/financeService.js has no expense-claim model; expense recording
//   today is a generic finance-transaction category, not a governed claim
//   lifecycle) — PRESERVE nothing structural, this is new canonical capability
//   layered next to (never modifying) payroll/attendance behavior.
// - ERPNext Expense Claim + Employee Advance doctypes (clean-room reference)
//   for the claim-header/lines/policy/duplicate-fingerprint shape.
// - Binding rule (Phase 03 Section 5 / this packet's own outcome statement):
//   no modification of payroll or attendance source behavior; any payroll
//   settlement is an optional, inactive-by-default adapter contract.
//
// What this migration does:
//   1. Creates finance_expense_claims, finance_expense_claim_lines,
//      finance_employee_advances.
//   2. Registers expense/advance authority actions.
//
// Invariants:
//   - Duplicate receipt detection is enforced via a unique index on
//     (company_id, employee_id, receipt_fingerprint) — a real database
//     constraint, not just an application-level check.
//   - The payroll adapter hook (finance_expense_claim.payroll_settlement_ref)
//     is a nullable reference column only; nothing in this migration or its
//     engine functions writes to payroll/attendance tables.

const MODULE_ID = 'finance_canonical';
const now = new Date().toISOString();

export const migration = {
  id: '030_expense_claims_and_advances',
  owner: MODULE_ID,
  version: '1.16.0',
  dependsOn: ['029_budgeting_foundation'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Current Octagon expense/payroll-bridge inspection (no prior claim model) + ERPNext Expense Claim / Employee Advance (clean-room) mapped to finance_expense_claims/finance_employee_advances',

  up(dialect) {
    dialect.exec(`
      CREATE TABLE IF NOT EXISTS finance_expense_claims (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        employee_id TEXT NOT NULL,
        project_dimension_value_id TEXT REFERENCES finance_dimension_values(id),
        currency TEXT NOT NULL DEFAULT 'IQD',
        total_amount REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected','reimbursed')),
        rejection_reason TEXT,
        document_id TEXT REFERENCES finance_documents(id),
        payroll_settlement_ref TEXT,
        submitted_at TEXT,
        approved_by TEXT,
        approved_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_finance_expense_claims_employee ON finance_expense_claims(company_id, employee_id, status);

      CREATE TABLE IF NOT EXISTS finance_expense_claim_lines (
        id TEXT PRIMARY KEY,
        claim_id TEXT NOT NULL REFERENCES finance_expense_claims(id),
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        category TEXT NOT NULL,
        expense_account_id TEXT NOT NULL REFERENCES finance_accounts(id),
        amount REAL NOT NULL,
        tax_id TEXT REFERENCES finance_taxes(id),
        tax_amount REAL NOT NULL DEFAULT 0,
        expense_date TEXT NOT NULL,
        receipt_fingerprint TEXT,
        description TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_expense_lines_receipt ON finance_expense_claim_lines(company_id, receipt_fingerprint) WHERE receipt_fingerprint IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_finance_expense_claim_lines_claim ON finance_expense_claim_lines(claim_id);

      CREATE TABLE IF NOT EXISTS finance_employee_advances (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        employee_id TEXT NOT NULL,
        amount REAL NOT NULL,
        applied_amount REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'IQD',
        status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','partially_settled','settled')),
        document_id TEXT REFERENCES finance_documents(id),
        issued_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_finance_employee_advances_employee ON finance_employee_advances(company_id, employee_id, status);
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
    insEntity.run('finance_expense_claim', MODULE_ID, 'platform.finance', 'مطالبة مصروفات', 'Expense Claim', 'status', 'state_machine', MODULE_ID, now, now);
    insEntity.run('finance_employee_advance', MODULE_ID, 'platform.finance', 'سلفة موظف', 'Employee Advance', 'status', 'state_machine', MODULE_ID, now, now);

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
      { id: 'finance_expense_claim:create', entity_id: 'finance_expense_claim', kind: 'domain', required_permission: 'finance_expense_claim:create', input_schema: { required: ['employee_id', 'lines'] } },
      { id: 'finance_expense_claim:submit', entity_id: 'finance_expense_claim', kind: 'domain', required_permission: 'finance_expense_claim:submit', allowed_states: ['draft'], input_schema: { required: ['claim_id'] } },
      { id: 'finance_expense_claim:approve', entity_id: 'finance_expense_claim', kind: 'domain', required_permission: 'finance_expense_claim:approve', allowed_states: ['submitted'], input_schema: { required: ['claim_id'] } },
      { id: 'finance_expense_claim:reject', entity_id: 'finance_expense_claim', kind: 'domain', required_permission: 'finance_expense_claim:approve', allowed_states: ['submitted'], input_schema: { required: ['claim_id', 'reason'] } },
      { id: 'finance_employee_advance:issue', entity_id: 'finance_employee_advance', kind: 'domain', required_permission: 'finance_advance:issue', input_schema: { required: ['employee_id', 'amount', 'cash_or_bank_account_id'] } },
      { id: 'finance_employee_advance:settle', entity_id: 'finance_employee_advance', kind: 'domain', required_permission: 'finance_advance:issue', input_schema: { required: ['advance_id', 'claim_id'] } },
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
    if (!existing.includes('030_expense_claims_and_advances')) {
      existing.push('030_expense_claims_and_advances');
      dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(existing), now, MODULE_ID);
    }
  },

  down(dialect) {
    dialect.exec(`
      DROP TABLE IF EXISTS finance_employee_advances;
      DROP TABLE IF EXISTS finance_expense_claim_lines;
      DROP TABLE IF EXISTS finance_expense_claims;
    `);
    const actions = ['finance_expense_claim:create', 'finance_expense_claim:submit', 'finance_expense_claim:approve', 'finance_expense_claim:reject', 'finance_employee_advance:issue', 'finance_employee_advance:settle'];
    dialect.prepare(`DELETE FROM platform_actions WHERE id IN (${actions.map(() => '?').join(',')})`).run(...actions);
    const entities = ['finance_expense_claim', 'finance_employee_advance'];
    dialect.prepare(`DELETE FROM platform_entities WHERE id IN (${entities.map(() => '?').join(',')})`).run(...entities);
    const existing = JSON.parse(dialect.prepare('SELECT migrations FROM platform_modules WHERE id = ?').get(MODULE_ID)?.migrations || '[]');
    const next = existing.filter(id => id !== '030_expense_claims_and_advances');
    dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), new Date().toISOString(), MODULE_ID);
  }
};
