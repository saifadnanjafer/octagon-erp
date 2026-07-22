// 032_asset_accounting_interface — Wave E
//
// Source composition:
// - Current Octagon asset/maintenance pages inspected: no depreciation
//   posting exists today (the "Asset & Maintenance module" tracks fixed
//   assets and depreciation figures in its own store; it does not post to
//   finance_documents). Nothing to preserve here structurally — this packet
//   establishes the finance-side contract that module (or its Phase 05
//   successor) will call.
// - VNext migration 705_r7_maintenance.mjs exists but is a maintenance-
//   scheduling migration, not an asset-depreciation-accounting one; no
//   VNext asset-accounting engine exists to port from (confirmed by search).
// - ERPNext Asset / Depreciation Schedule (clean-room reference) for the
//   category -> account-mapping and capitalize/depreciate/dispose contract
//   shape.
//
// What this migration does:
//   1. Creates finance_asset_categories (account mapping only — no asset
//      register, no depreciation scheduler; those are explicitly Phase 05).
//   2. Registers three posting COMMAND CONTRACTS: capitalize, post
//      depreciation, and dispose. Each posts through the existing
//      finance_document pipeline; none of them introduces a second posting
//      authority or duplicates GL logic.
//
// Invariants:
//   - This migration intentionally does not create an asset register table.
//     Phase 05 owns the asset entity itself; Phase 03 only owns the finance
//     posting contract an asset lifecycle event calls into.

const MODULE_ID = 'finance_canonical';
const now = new Date().toISOString();

export const migration = {
  id: '032_asset_accounting_interface',
  owner: MODULE_ID,
  version: '1.18.0',
  dependsOn: ['031_canonical_financial_reports'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Current Octagon asset/maintenance module (no depreciation posting today) + ERPNext Asset/Depreciation Schedule (clean-room) mapped to finance_asset_categories + posting command contracts; no VNext asset-accounting engine exists to port',

  up(dialect) {
    dialect.exec(`
      CREATE TABLE IF NOT EXISTS finance_asset_categories (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        asset_account_id TEXT NOT NULL REFERENCES finance_accounts(id),
        depreciation_expense_account_id TEXT NOT NULL REFERENCES finance_accounts(id),
        accumulated_depreciation_account_id TEXT NOT NULL REFERENCES finance_accounts(id),
        disposal_gain_account_id TEXT REFERENCES finance_accounts(id),
        disposal_loss_account_id TEXT REFERENCES finance_accounts(id),
        default_method TEXT NOT NULL DEFAULT 'straight_line' CHECK (default_method IN ('straight_line','declining_balance')),
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_asset_categories_company_code ON finance_asset_categories(company_id, code);
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
    insEntity.run('finance_asset_category', MODULE_ID, 'platform.finance', 'فئة أصول', 'Asset Category', MODULE_ID, now, now);

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
      { id: 'finance_asset_category:create', entity_id: 'finance_asset_category', kind: 'domain', required_permission: 'finance_asset:manage', input_schema: { required: ['code', 'name', 'asset_account_id', 'depreciation_expense_account_id', 'accumulated_depreciation_account_id'] } },
      { id: 'finance_asset:capitalize', entity_id: 'finance_document', kind: 'domain', required_permission: 'finance_asset:post', input_schema: { required: ['category_id', 'amount', 'asset_reference'] }, reversal_action: 'finance_document:reverse' },
      { id: 'finance_asset:post_depreciation', entity_id: 'finance_document', kind: 'domain', required_permission: 'finance_asset:post', input_schema: { required: ['category_id', 'amount', 'asset_reference'] }, reversal_action: 'finance_document:reverse' },
      { id: 'finance_asset:dispose', entity_id: 'finance_document', kind: 'domain', required_permission: 'finance_asset:post', input_schema: { required: ['category_id', 'asset_reference', 'net_book_value', 'proceeds'] }, reversal_action: 'finance_document:reverse' },
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
    if (!existing.includes('032_asset_accounting_interface')) {
      existing.push('032_asset_accounting_interface');
      dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(existing), now, MODULE_ID);
    }
  },

  down(dialect) {
    dialect.exec(`DROP TABLE IF EXISTS finance_asset_categories;`);
    const actions = ['finance_asset_category:create', 'finance_asset:capitalize', 'finance_asset:post_depreciation', 'finance_asset:dispose'];
    dialect.prepare(`DELETE FROM platform_actions WHERE id IN (${actions.map(() => '?').join(',')})`).run(...actions);
    dialect.prepare('DELETE FROM platform_entities WHERE id = ?').run('finance_asset_category');
    const existing = JSON.parse(dialect.prepare('SELECT migrations FROM platform_modules WHERE id = ?').get(MODULE_ID)?.migrations || '[]');
    const next = existing.filter(id => id !== '032_asset_accounting_interface');
    dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), new Date().toISOString(), MODULE_ID);
  }
};
