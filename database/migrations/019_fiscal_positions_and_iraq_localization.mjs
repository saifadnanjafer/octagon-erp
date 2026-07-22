// 019_fiscal_positions_and_iraq_localization — Wave C
//
// Source composition:
// - VNext tax-engine.js fiscal_position_tax_map/fiscal_position_account_map
//   (project-owned) MERGE-REFACTOR.
// - Odoo account_fiscal_position + l10n_* chart-template/localization structure
//   (clean-room reference) for the pack install/version shape.
// - Current Octagon Arabic/English chart-of-accounts labels (finance_accounts
//   already carries name_ar) — preserved, not replaced.
//
// What this migration does:
//   1. Creates finance_fiscal_positions, finance_fiscal_position_tax_map,
//      finance_fiscal_position_account_map, finance_localization_packs.
//   2. Registers fiscal-position and localization-pack authority actions.
//
// Legal safety rule (binding, see docs/evidence/phase-03/donor-license-ledger.md):
//   No Iraqi tax rate, legal form, filing form, e-invoice requirement, or
//   statutory interpretation is final because it appears here. This is a
//   configurable foundation pending accountant/legal validation.

const MODULE_ID = 'finance_canonical';
const now = new Date().toISOString();

export const migration = {
  id: '019_fiscal_positions_and_iraq_localization',
  owner: MODULE_ID,
  version: '1.5.0',
  dependsOn: ['018_tax_definition_and_calculation'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'VNext tax-engine.js fiscal position maps + Odoo account_fiscal_position/l10n_* structure (clean-room) mapped to finance_* tables',

  up(dialect) {
    dialect.exec(`
      CREATE TABLE IF NOT EXISTS finance_fiscal_positions (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        name_ar TEXT,
        criteria TEXT,
        exemption_reason TEXT,
        allow_manual_override INTEGER NOT NULL DEFAULT 1,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_fiscal_positions_company_code ON finance_fiscal_positions(company_id, code);

      CREATE TABLE IF NOT EXISTS finance_fiscal_position_tax_map (
        id TEXT PRIMARY KEY,
        fiscal_position_id TEXT NOT NULL REFERENCES finance_fiscal_positions(id),
        tax_src_id TEXT NOT NULL REFERENCES finance_taxes(id),
        tax_dest_id TEXT REFERENCES finance_taxes(id),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_fiscal_position_tax_map_unique ON finance_fiscal_position_tax_map(fiscal_position_id, tax_src_id);

      CREATE TABLE IF NOT EXISTS finance_fiscal_position_account_map (
        id TEXT PRIMARY KEY,
        fiscal_position_id TEXT NOT NULL REFERENCES finance_fiscal_positions(id),
        account_src_id TEXT NOT NULL REFERENCES finance_accounts(id),
        account_dest_id TEXT NOT NULL REFERENCES finance_accounts(id),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_fiscal_position_account_map_unique ON finance_fiscal_position_account_map(fiscal_position_id, account_src_id);

      CREATE TABLE IF NOT EXISTS finance_localization_packs (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        pack_code TEXT NOT NULL,
        version TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'installed' CHECK (status IN ('installed','upgraded','uninstalled')),
        installed_at TEXT NOT NULL,
        installed_by TEXT,
        legal_validation_status TEXT NOT NULL DEFAULT 'pending' CHECK (legal_validation_status IN ('pending','accountant_reviewed','legally_approved'))
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_localization_packs_company_pack ON finance_localization_packs(company_id, pack_code);
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
      { id: 'finance_fiscal_position', label_ar: 'موقف مالي', label_en: 'Fiscal Position' },
      { id: 'finance_fiscal_position_tax_map', label_ar: 'خريطة ضريبة الموقف المالي', label_en: 'Fiscal Position Tax Map' },
      { id: 'finance_fiscal_position_account_map', label_ar: 'خريطة حساب الموقف المالي', label_en: 'Fiscal Position Account Map' },
      { id: 'finance_localization_pack', label_ar: 'حزمة التوطين', label_en: 'Localization Pack' },
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
      { id: 'finance_fiscal_position:create', entity_id: 'finance_fiscal_position', kind: 'domain', required_permission: 'finance_fiscal_position:manage', input_schema: { required: ['code', 'name'] } },
      { id: 'finance_fiscal_position:map_tax', entity_id: 'finance_fiscal_position_tax_map', kind: 'domain', required_permission: 'finance_fiscal_position:manage', input_schema: { required: ['fiscal_position_id', 'tax_src_id'] } },
      { id: 'finance_fiscal_position:map_account', entity_id: 'finance_fiscal_position_account_map', kind: 'domain', required_permission: 'finance_fiscal_position:manage', input_schema: { required: ['fiscal_position_id', 'account_src_id', 'account_dest_id'] } },
      { id: 'finance_localization:install', entity_id: 'finance_localization_pack', kind: 'domain', required_permission: 'finance_localization:install', input_schema: { required: ['pack_code', 'version'] } },
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
    if (!existing.includes('019_fiscal_positions_and_iraq_localization')) {
      existing.push('019_fiscal_positions_and_iraq_localization');
      dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(existing), now, MODULE_ID);
    }
  },

  down(dialect) {
    dialect.exec(`
      DROP TABLE IF EXISTS finance_localization_packs;
      DROP TABLE IF EXISTS finance_fiscal_position_account_map;
      DROP TABLE IF EXISTS finance_fiscal_position_tax_map;
      DROP TABLE IF EXISTS finance_fiscal_positions;
    `);
    const actions = ['finance_fiscal_position:create', 'finance_fiscal_position:map_tax', 'finance_fiscal_position:map_account', 'finance_localization:install'];
    const placeholders = actions.map(() => '?').join(',');
    dialect.prepare(`DELETE FROM platform_actions WHERE id IN (${placeholders})`).run(...actions);
    const entities = ['finance_fiscal_position', 'finance_fiscal_position_tax_map', 'finance_fiscal_position_account_map', 'finance_localization_pack'];
    dialect.prepare(`DELETE FROM platform_entities WHERE id IN (${entities.map(() => '?').join(',')})`).run(...entities);
    const existing = JSON.parse(dialect.prepare('SELECT migrations FROM platform_modules WHERE id = ?').get(MODULE_ID)?.migrations || '[]');
    const next = existing.filter(id => id !== '019_fiscal_positions_and_iraq_localization');
    dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), new Date().toISOString(), MODULE_ID);
  }
};
