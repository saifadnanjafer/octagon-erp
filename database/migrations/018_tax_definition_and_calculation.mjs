// 018_tax_definition_and_calculation — Wave C
//
// Source composition:
// - VNext tax-engine.js computeTaxes/repartition-line model (project-owned) MERGE-REFACTOR.
// - Odoo account_tax.py price-include/repartition behavior (clean-room reference).
// - ERPNext withholding-category threshold model (clean-room reference).
//
// What this migration does:
//   1. Creates finance_taxes, finance_tax_repartition_lines, finance_tax_group_members,
//      finance_withholding_categories, finance_withholding_certificates.
//   2. Registers tax authority actions. Tax calculation is declarative and separate
//      from posting: finance_tax:quote never writes journal lines by itself.
//
// Invariants:
//   - Tax versions are immutable once referenced by a posted document line
//     (tax_refs on finance_document_lines/finance_journal_lines snapshot the
//     tax id + computed amounts at post time; the definition itself may still
//     evolve for future documents without touching posted history).

const MODULE_ID = 'finance_canonical';
const now = new Date().toISOString();

export const migration = {
  id: '018_tax_definition_and_calculation',
  owner: MODULE_ID,
  version: '1.4.0',
  dependsOn: ['017_currency_and_exchange_rates'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'VNext tax-engine.js computeTaxes/repartition + Odoo account_tax.py (clean-room) + ERPNext withholding_category (clean-room) mapped to finance_* tables',

  up(dialect) {
    dialect.exec(`
      CREATE TABLE IF NOT EXISTS finance_taxes (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        name_ar TEXT,
        amount_type TEXT NOT NULL CHECK (amount_type IN ('percent','fixed','group')),
        amount REAL NOT NULL DEFAULT 0,
        price_include INTEGER NOT NULL DEFAULT 0,
        is_withholding INTEGER NOT NULL DEFAULT 0,
        is_reverse_charge INTEGER NOT NULL DEFAULT 0,
        is_recoverable INTEGER NOT NULL DEFAULT 1,
        rounding TEXT NOT NULL DEFAULT 'line' CHECK (rounding IN ('line','global')),
        version INTEGER NOT NULL DEFAULT 1,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_taxes_company_code ON finance_taxes(company_id, code);

      CREATE TABLE IF NOT EXISTS finance_tax_repartition_lines (
        id TEXT PRIMARY KEY,
        tax_id TEXT NOT NULL REFERENCES finance_taxes(id),
        repartition_type TEXT NOT NULL CHECK (repartition_type IN ('base','tax')),
        factor_percent REAL NOT NULL DEFAULT 100,
        account_id TEXT REFERENCES finance_accounts(id),
        tag_ids TEXT,
        sign INTEGER NOT NULL DEFAULT 1,
        sequence INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_finance_tax_repartition_lines_tax ON finance_tax_repartition_lines(tax_id, sequence);

      CREATE TABLE IF NOT EXISTS finance_tax_group_members (
        id TEXT PRIMARY KEY,
        group_tax_id TEXT NOT NULL REFERENCES finance_taxes(id),
        child_tax_id TEXT NOT NULL REFERENCES finance_taxes(id),
        sequence INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_tax_group_members_unique ON finance_tax_group_members(group_tax_id, child_tax_id);

      CREATE TABLE IF NOT EXISTS finance_withholding_categories (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        rate REAL NOT NULL DEFAULT 0,
        threshold REAL NOT NULL DEFAULT 0,
        cumulative_threshold REAL NOT NULL DEFAULT 0,
        cumulative_window TEXT NOT NULL DEFAULT 'none' CHECK (cumulative_window IN ('none','monthly','yearly')),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_withholding_categories_company_code ON finance_withholding_categories(company_id, code);

      CREATE TABLE IF NOT EXISTS finance_withholding_certificates (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        partner_id TEXT,
        withholding_category_id TEXT NOT NULL REFERENCES finance_withholding_categories(id),
        base_amount REAL NOT NULL,
        tax_amount REAL NOT NULL,
        doc_date TEXT NOT NULL,
        reference_document_id TEXT REFERENCES finance_documents(id),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_finance_withholding_certificates_partner ON finance_withholding_certificates(company_id, partner_id, withholding_category_id, doc_date);
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
      { id: 'finance_tax', label_ar: 'ضريبة', label_en: 'Tax' },
      { id: 'finance_tax_repartition_line', label_ar: 'سطر توزيع الضريبة', label_en: 'Tax Repartition Line' },
      { id: 'finance_tax_quote', label_ar: 'عرض حساب الضريبة', label_en: 'Tax Quote' },
      { id: 'finance_withholding_category', label_ar: 'فئة الاستقطاع الضريبي', label_en: 'Withholding Category' },
      { id: 'finance_withholding_certificate', label_ar: 'شهادة استقطاع ضريبي', label_en: 'Withholding Certificate' },
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
      { id: 'finance_tax:create', entity_id: 'finance_tax', kind: 'domain', required_permission: 'finance_tax:manage', input_schema: { required: ['code', 'name', 'amount_type'] } },
      { id: 'finance_tax:repartition_set', entity_id: 'finance_tax_repartition_line', kind: 'domain', required_permission: 'finance_tax:manage', input_schema: { required: ['tax_id', 'lines'] } },
      { id: 'finance_tax:quote', entity_id: 'finance_tax_quote', kind: 'domain', required_permission: 'finance_tax:quote', input_schema: { required: ['lines'] } },
      { id: 'finance_withholding:category_create', entity_id: 'finance_withholding_category', kind: 'domain', required_permission: 'finance_tax:manage', input_schema: { required: ['code', 'name', 'rate'] } },
      { id: 'finance_withholding:evaluate', entity_id: 'finance_withholding_certificate', kind: 'domain', required_permission: 'finance_tax:quote', input_schema: { required: ['partner_id', 'amount', 'doc_date'] } },
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
    if (!existing.includes('018_tax_definition_and_calculation')) {
      existing.push('018_tax_definition_and_calculation');
      dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(existing), now, MODULE_ID);
    }
  },

  down(dialect) {
    dialect.exec(`
      DROP TABLE IF EXISTS finance_withholding_certificates;
      DROP TABLE IF EXISTS finance_withholding_categories;
      DROP TABLE IF EXISTS finance_tax_group_members;
      DROP TABLE IF EXISTS finance_tax_repartition_lines;
      DROP TABLE IF EXISTS finance_taxes;
    `);
    const actions = ['finance_tax:create', 'finance_tax:repartition_set', 'finance_tax:quote', 'finance_withholding:category_create', 'finance_withholding:evaluate'];
    const placeholders = actions.map(() => '?').join(',');
    dialect.prepare(`DELETE FROM platform_actions WHERE id IN (${placeholders})`).run(...actions);
    const entities = ['finance_tax', 'finance_tax_repartition_line', 'finance_tax_quote', 'finance_withholding_category', 'finance_withholding_certificate'];
    dialect.prepare(`DELETE FROM platform_entities WHERE id IN (${entities.map(() => '?').join(',')})`).run(...entities);
    const existing = JSON.parse(dialect.prepare('SELECT migrations FROM platform_modules WHERE id = ?').get(MODULE_ID)?.migrations || '[]');
    const next = existing.filter(id => id !== '018_tax_definition_and_calculation');
    dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), new Date().toISOString(), MODULE_ID);
  }
};
