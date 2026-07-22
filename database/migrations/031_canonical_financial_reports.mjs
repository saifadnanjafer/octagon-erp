// 031_canonical_financial_reports — Wave E
//
// Source composition:
// - VNext report-engine.js (project-owned) MERGE-REFACTOR: profitLoss,
//   balanceSheet, cashFlow, partnerLedger, aging, tax, dimensionPnl — all
//   ported onto finance_* tables; trialBalance/generalLedger/customer-and-
//   supplier-aging already exist from Waves A/C and are reused, not duplicated.
// - Odoo Community account report views (clean-room reference) for the
//   opening/movement/closing column convention.
// - ERPNext Financial Statements (clean-room reference) confirming the P&L/
//   Balance Sheet grouping shape independently.
//
// What this migration does:
//   1. Creates finance_report_definitions (registered report catalog) and
//      finance_report_snapshots (cached/reference report runs).
//   2. Registers report-query authority actions. Every report is a read-only
//      query over finance_journal_lines/finance_documents — none of them
//      write GL data, so none of them are a second reporting authority.
//
// Invariants:
//   - A snapshot is an immutable point-in-time copy (data_json) with the
//     parameters and generation timestamp that produced it; it is evidence of
//     what a report showed, never a live value re-read on access.

const MODULE_ID = 'finance_canonical';
const now = new Date().toISOString();

export const migration = {
  id: '031_canonical_financial_reports',
  owner: MODULE_ID,
  version: '1.17.0',
  dependsOn: ['030_expense_claims_and_advances'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'VNext report-engine.js (project-owned) MERGE-REFACTOR + Odoo account reports / ERPNext Financial Statements (clean-room) mapped to finance_report_definitions/finance_report_snapshots',

  up(dialect) {
    dialect.exec(`
      CREATE TABLE IF NOT EXISTS finance_report_definitions (
        code TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        name_ar TEXT,
        category TEXT NOT NULL,
        formula_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS finance_report_snapshots (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        report_code TEXT NOT NULL REFERENCES finance_report_definitions(code),
        params_hash TEXT NOT NULL,
        params_json TEXT NOT NULL,
        data_json TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        generated_by TEXT
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_finance_report_snapshots_lookup ON finance_report_snapshots(company_id, report_code, params_hash, generated_at);

      INSERT OR IGNORE INTO finance_report_definitions (code, name, name_ar, category, formula_version, created_at) VALUES
        ('trial_balance', 'Trial Balance', 'ميزان المراجعة', 'ledger', 1, '${now}'),
        ('general_ledger', 'General Ledger', 'دفتر الأستاذ العام', 'ledger', 1, '${now}'),
        ('journal', 'Journal', 'دفتر اليومية', 'ledger', 1, '${now}'),
        ('profit_loss', 'Profit & Loss', 'قائمة الدخل', 'statement', 1, '${now}'),
        ('balance_sheet', 'Balance Sheet', 'الميزانية العمومية', 'statement', 1, '${now}'),
        ('cash_flow', 'Cash Flow', 'التدفقات النقدية', 'statement', 1, '${now}'),
        ('ar_aging', 'AR Aging', 'تقادم المدينين', 'subledger', 1, '${now}'),
        ('ap_aging', 'AP Aging', 'تقادم الدائنين', 'subledger', 1, '${now}'),
        ('partner_ledger', 'Customer/Supplier Ledger', 'دفتر العميل والمورد', 'subledger', 1, '${now}'),
        ('tax_report', 'Tax Report', 'التقرير الضريبي', 'tax', 1, '${now}'),
        ('dimension_pnl', 'Dimension / Analytic P&L', 'ربحية حسب البُعد', 'analytic', 1, '${now}'),
        ('currency_revaluation', 'Currency Revaluation', 'إعادة تقييم العملة', 'currency', 1, '${now}'),
        ('bank_reconciliation_status', 'Bank & Cash Reconciliation Status', 'حالة التسوية البنكية والنقدية', 'banking', 1, '${now}'),
        ('budget_vs_actual', 'Budget vs Actual', 'الموازنة مقابل الفعلي', 'budget', 1, '${now}'),
        ('period_close_status', 'Period Close / Reconciliation Status', 'حالة إغلاق الفترة', 'period', 1, '${now}');
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
    insEntity.run('finance_report_snapshot', MODULE_ID, 'platform.finance', 'لقطة تقرير', 'Report Snapshot', MODULE_ID, now, now);

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
      { id: 'finance_report:run', entity_id: 'finance_report_snapshot', kind: 'domain', required_permission: 'finance_report:read', input_schema: { required: ['report_code'] } },
      { id: 'finance_report:snapshot', entity_id: 'finance_report_snapshot', kind: 'domain', required_permission: 'finance_report:read', input_schema: { required: ['report_code'] } },
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
    if (!existing.includes('031_canonical_financial_reports')) {
      existing.push('031_canonical_financial_reports');
      dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(existing), now, MODULE_ID);
    }
  },

  down(dialect) {
    dialect.exec(`
      DROP TABLE IF EXISTS finance_report_snapshots;
      DROP TABLE IF EXISTS finance_report_definitions;
    `);
    const actions = ['finance_report:run', 'finance_report:snapshot'];
    dialect.prepare(`DELETE FROM platform_actions WHERE id IN (${actions.map(() => '?').join(',')})`).run(...actions);
    dialect.prepare('DELETE FROM platform_entities WHERE id = ?').run('finance_report_snapshot');
    const existing = JSON.parse(dialect.prepare('SELECT migrations FROM platform_modules WHERE id = ?').get(MODULE_ID)?.migrations || '[]');
    const next = existing.filter(id => id !== '031_canonical_financial_reports');
    dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), new Date().toISOString(), MODULE_ID);
  }
};
