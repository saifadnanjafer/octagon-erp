// 017_currency_and_exchange_rates — Wave C
//
// Source composition:
// - VNext arap-engine.js fx_rate/fxDelta handling (project-owned) MERGE-REFACTOR
//   for the realized-FX-on-settlement shape.
// - Odoo res_currency / res_currency_rate (clean-room reference) for dated-rate
//   lookup and rate-type modeling.
// - ERPNext currency exchange doctype (clean-room reference) for revaluation shape.
//
// What this migration does:
//   1. Creates finance_currencies, finance_exchange_rates, finance_fx_revaluation_runs.
//   2. Registers currency/exchange-rate/revaluation authority actions.
//
// Invariants:
//   - Rates are dated and company-scoped; posted documents freeze their own
//     currency_debit/currency_credit at post time (see engine.mjs postDocument).
//   - Revaluation only ever adds new documents/lines; it never edits posted lines.

const MODULE_ID = 'finance_canonical';
const now = new Date().toISOString();

export const migration = {
  id: '017_currency_and_exchange_rates',
  owner: MODULE_ID,
  version: '1.3.0',
  dependsOn: ['016_accounting_dimensions'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'VNext arap-engine.js fx handling + Odoo res_currency/res_currency_rate (clean-room) + ERPNext currency exchange (clean-room) mapped to finance_* tables',

  up(dialect) {
    dialect.exec(`
      CREATE TABLE IF NOT EXISTS finance_currencies (
        code TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        name_ar TEXT,
        symbol TEXT,
        decimal_places INTEGER NOT NULL DEFAULT 2,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS finance_exchange_rates (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        from_currency TEXT NOT NULL REFERENCES finance_currencies(code),
        to_currency TEXT NOT NULL REFERENCES finance_currencies(code),
        rate_date TEXT NOT NULL,
        rate REAL NOT NULL,
        rate_type TEXT NOT NULL DEFAULT 'spot' CHECK (rate_type IN ('spot','average','custom')),
        source TEXT,
        created_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_exchange_rates_unique
        ON finance_exchange_rates(company_id, from_currency, to_currency, rate_date, rate_type);
      CREATE INDEX IF NOT EXISTS idx_finance_exchange_rates_lookup
        ON finance_exchange_rates(company_id, from_currency, to_currency, rate_type, rate_date);

      CREATE TABLE IF NOT EXISTS finance_fx_revaluation_runs (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        as_of_date TEXT NOT NULL,
        document_id TEXT REFERENCES finance_documents(id),
        gain_account_id TEXT REFERENCES finance_accounts(id),
        loss_account_id TEXT REFERENCES finance_accounts(id),
        total_gain REAL NOT NULL DEFAULT 0,
        total_loss REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_finance_fx_revaluation_runs_company ON finance_fx_revaluation_runs(company_id, as_of_date);

      INSERT OR IGNORE INTO finance_currencies (code, name, name_ar, symbol, decimal_places, is_active, created_at)
      VALUES
        ('IQD', 'Iraqi Dinar', 'دينار عراقي', 'ID', 0, 1, '${now}'),
        ('USD', 'US Dollar', 'دولار أمريكي', '$', 2, 1, '${now}'),
        ('EUR', 'Euro', 'يورو', '€', 2, 1, '${now}');
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
      { id: 'finance_currency', label_ar: 'عملة', label_en: 'Currency' },
      { id: 'finance_exchange_rate', label_ar: 'سعر صرف', label_en: 'Exchange Rate' },
      { id: 'finance_fx_revaluation_run', label_ar: 'إعادة تقييم عملة أجنبية', label_en: 'FX Revaluation Run' },
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
      { id: 'finance_currency:upsert', entity_id: 'finance_currency', kind: 'domain', required_permission: 'finance_currency:manage', input_schema: { required: ['code', 'name'] } },
      { id: 'finance_exchange_rate:upsert', entity_id: 'finance_exchange_rate', kind: 'domain', required_permission: 'finance_currency:manage', input_schema: { required: ['from_currency', 'to_currency', 'rate_date', 'rate'] } },
      { id: 'finance_fx:revalue', entity_id: 'finance_fx_revaluation_run', kind: 'domain', required_permission: 'finance_fx:revalue', input_schema: { required: ['as_of_date', 'account_ids', 'gain_account_id', 'loss_account_id'] }, reversal_action: 'finance_document:reverse' },
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
    if (!existing.includes('017_currency_and_exchange_rates')) {
      existing.push('017_currency_and_exchange_rates');
      dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(existing), now, MODULE_ID);
    }
  },

  down(dialect) {
    dialect.exec(`
      DROP TABLE IF EXISTS finance_fx_revaluation_runs;
      DROP TABLE IF EXISTS finance_exchange_rates;
      DROP TABLE IF EXISTS finance_currencies;
    `);
    const actions = ['finance_currency:upsert', 'finance_exchange_rate:upsert', 'finance_fx:revalue'];
    const placeholders = actions.map(() => '?').join(',');
    dialect.prepare(`DELETE FROM platform_actions WHERE id IN (${placeholders})`).run(...actions);
    const entities = ['finance_currency', 'finance_exchange_rate', 'finance_fx_revaluation_run'];
    dialect.prepare(`DELETE FROM platform_entities WHERE id IN (${entities.map(() => '?').join(',')})`).run(...entities);
    const existing = JSON.parse(dialect.prepare('SELECT migrations FROM platform_modules WHERE id = ?').get(MODULE_ID)?.migrations || '[]');
    const next = existing.filter(id => id !== '017_currency_and_exchange_rates');
    dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), new Date().toISOString(), MODULE_ID);
  }
};
