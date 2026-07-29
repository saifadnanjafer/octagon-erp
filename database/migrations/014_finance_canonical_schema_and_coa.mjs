// 014_finance_canonical_schema_and_coa — Wave A
//
// Source composition:
// - VNext 601_r2_finance_baseline.mjs (project-owned) MERGE-REFACTOR: table schema,
//   CoA seed pattern, and append-only GL triggers adapted to Octagon platform.
// - VNext 602_r2_period_locks.mjs (project-owned) MERGE-REFACTOR: period and lock
//   tables merged into the finance schema.
// - Odoo account_move.py / account_move_line.py (clean-room reference) for
//   balance, immutability, and reversal semantics.
//
// What this migration does:
//   1. Registers the `finance_canonical` module and its entities in platform_*.
//   2. Creates the canonical finance tables: accounts, journals, fiscal years,
//      periods, locks, documents, document lines, journal entries, journal lines,
//      reversal links, and integrity hashes.
//   3. Seeds a default Iraq-style chart of accounts for the default company.
//   4. Seeds default journals and the 2026 fiscal year/periods for the default company.
//   5. Registers canonical finance actions in platform_actions.
//   6. Defines the finance_document lifecycle in x_doc_state_defs.
//
// Invariants:
//   - Append-only GL: finance_journal_lines cannot be UPDATEd or DELETEd.
//   - Posted finance_journal_entries cannot be UPDATEd or DELETEd.
//   - No generic CRUD action is registered for posted documents; all posting uses
//     finance.document:post or finance.document:reverse.
//   - Migration is idempotent (ON CONFLICT / INSERT OR IGNORE).

import crypto from 'node:crypto';

const MODULE_ID = 'finance_canonical';
const now = new Date().toISOString();

export const migration = {
  id: '014_finance_canonical_schema_and_coa',
  owner: MODULE_ID,
  version: '1.0.0',
  dependsOn: ['013_governance_collection_cutover'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'VNext 601_r2_finance_baseline.mjs + 602_r2_period_locks.mjs mapped to Octagon platform/finance tables and Phase 01 action registry',

  up(dialect) {
    createModule(dialect);
    createEntities(dialect);
    createActions(dialect);
    createTables(dialect);
    createDocumentLifecycle(dialect);
    seedDefaultCoA(dialect);
    seedDefaultJournals(dialect);
    seedDefaultFiscalYear(dialect);
  },

  down(dialect) {
    dialect.exec(`
      DROP TRIGGER IF EXISTS t_finance_journal_lines_no_delete;
      DROP TRIGGER IF EXISTS t_finance_journal_lines_no_update;
      DROP TRIGGER IF EXISTS t_finance_journal_entries_no_delete;
      DROP TRIGGER IF EXISTS t_finance_journal_entries_no_update;
      DROP TABLE IF EXISTS finance_integrity_hashes;
      DROP TABLE IF EXISTS finance_reversal_links;
      DROP TABLE IF EXISTS finance_journal_lines;
      DROP TABLE IF EXISTS finance_journal_entries;
      DROP TABLE IF EXISTS finance_document_lines;
      DROP TABLE IF EXISTS finance_documents;
      DROP TABLE IF EXISTS finance_locks;
      DROP TABLE IF EXISTS finance_periods;
      DROP TABLE IF EXISTS finance_fiscal_years;
      DROP TABLE IF EXISTS finance_journals;
      DROP TABLE IF EXISTS finance_accounts;
    `);
    dialect.prepare('DELETE FROM platform_actions WHERE module_id = ?').run(MODULE_ID);
    dialect.prepare('DELETE FROM x_doc_state_defs WHERE entity = ?').run('finance_document');
    dialect.prepare('DELETE FROM platform_entities WHERE module_id = ?').run(MODULE_ID);
    dialect.prepare('DELETE FROM platform_modules WHERE id = ?').run(MODULE_ID);
  }
};

function createModule(dialect) {
  dialect.prepare(`
    INSERT INTO platform_modules (
      id, name, version, status, kind, owner, dependencies, optional_dependencies,
      capabilities, migrations, settings, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      version = excluded.version,
      status = excluded.status,
      kind = excluded.kind,
      owner = excluded.owner,
      dependencies = excluded.dependencies,
      optional_dependencies = excluded.optional_dependencies,
      capabilities = excluded.capabilities,
      migrations = excluded.migrations,
      settings = excluded.settings,
      updated_at = excluded.updated_at
  `).run(
    MODULE_ID, 'Finance', '1.0.0', 'enabled', 'core', 'finance',
    JSON.stringify(['platform_kernel']), JSON.stringify([]),
    JSON.stringify(['FN-001','FN-002','FN-003','FN-004','FN-005','FN-006','FN-007']),
    JSON.stringify(['014_finance_canonical_schema_and_coa']),
    JSON.stringify([]),
    now, now
  );
}

function createEntities(dialect) {
  const ins = dialect.prepare(`
    INSERT INTO platform_entities (
      id, module_id, storage_owner, primary_key, label_ar, label_en, section,
      sequence, seq_field, chatter, acl, status_key, fields, relations, scope,
      lifecycle_policy, query_policy, action_policy, customization_policy,
      history_policy, api_exposed, migration_owner, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      module_id = excluded.module_id,
      storage_owner = excluded.storage_owner,
      primary_key = excluded.primary_key,
      label_ar = excluded.label_ar,
      label_en = excluded.label_en,
      section = excluded.section,
      sequence = excluded.sequence,
      seq_field = excluded.seq_field,
      chatter = excluded.chatter,
      acl = excluded.acl,
      status_key = excluded.status_key,
      fields = excluded.fields,
      relations = excluded.relations,
      scope = excluded.scope,
      lifecycle_policy = excluded.lifecycle_policy,
      query_policy = excluded.query_policy,
      action_policy = excluded.action_policy,
      customization_policy = excluded.customization_policy,
      history_policy = excluded.history_policy,
      api_exposed = excluded.api_exposed,
      migration_owner = excluded.migration_owner,
      updated_at = excluded.updated_at
  `);

  const entities = [
    {
      id: 'finance_account', label_ar: 'حساب مالي', label_en: 'Finance Account',
      scope: 'company', lifecycle_policy: 'generic', action_policy: 'registered',
      history_policy: 'audit', storage_owner: 'platform.finance',
    },
    {
      id: 'finance_journal', label_ar: 'يومنية', label_en: 'Journal',
      scope: 'company', lifecycle_policy: 'generic', action_policy: 'registered',
      history_policy: 'audit', storage_owner: 'platform.finance',
    },
    {
      id: 'finance_document', label_ar: 'مستند مالي', label_en: 'Financial Document',
      scope: 'company', lifecycle_policy: 'state_machine', action_policy: 'registered',
      history_policy: 'audit', storage_owner: 'platform.finance', status_key: 'state',
    },
    {
      id: 'finance_fiscal_year', label_ar: 'سنة مالية', label_en: 'Fiscal Year',
      scope: 'company', lifecycle_policy: 'generic', action_policy: 'registered',
      history_policy: 'audit', storage_owner: 'platform.finance',
    },
    {
      id: 'finance_period', label_ar: 'فترة مالية', label_en: 'Fiscal Period',
      scope: 'company', lifecycle_policy: 'generic', action_policy: 'registered',
      history_policy: 'audit', storage_owner: 'platform.finance',
    },
    {
      id: 'finance_journal_entry', label_ar: 'قيد يومية', label_en: 'Journal Entry',
      scope: 'company', lifecycle_policy: 'immutable', action_policy: 'registered',
      history_policy: 'audit', storage_owner: 'platform.finance',
    },
  ];

  for (const e of entities) {
    ins.run(
      e.id, MODULE_ID, e.storage_owner, 'id', e.label_ar, e.label_en, 'finance',
      null, null, 0, null, e.status_key || null, '{}', '{}', e.scope,
      e.lifecycle_policy, 'scoped', e.action_policy, 'metadata', e.history_policy,
      1, MODULE_ID, now, now
    );
  }
}

function createActions(dialect) {
  const ins = dialect.prepare(`
    INSERT INTO platform_actions (
      id, module_id, entity_id, kind, allowed_states, required_permission, required_scope,
      input_schema, preconditions, transaction_owner, idempotency_policy, sequence_policy,
      audit_policy, outbox_policy, reversal_action, result_schema, error_contract, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      module_id = excluded.module_id,
      entity_id = excluded.entity_id,
      kind = excluded.kind,
      allowed_states = excluded.allowed_states,
      required_permission = excluded.required_permission,
      required_scope = excluded.required_scope,
      input_schema = excluded.input_schema,
      preconditions = excluded.preconditions,
      transaction_owner = excluded.transaction_owner,
      idempotency_policy = excluded.idempotency_policy,
      sequence_policy = excluded.sequence_policy,
      audit_policy = excluded.audit_policy,
      outbox_policy = excluded.outbox_policy,
      reversal_action = excluded.reversal_action,
      result_schema = excluded.result_schema,
      error_contract = excluded.error_contract,
      updated_at = excluded.updated_at
  `);

  const actions = [
    { id: 'finance_account:create', entity_id: 'finance_account', kind: 'domain', required_permission: 'finance_account:create', input_schema: { required: ['code','name','type'] } },
    { id: 'finance_account:update', entity_id: 'finance_account', kind: 'domain', required_permission: 'finance_account:update', input_schema: { required: ['account_id'] } },
    { id: 'finance_account:deactivate', entity_id: 'finance_account', kind: 'domain', required_permission: 'finance_account:update', input_schema: { required: ['account_id'] } },
    { id: 'finance_journal:create', entity_id: 'finance_journal', kind: 'domain', required_permission: 'finance_journal:create', input_schema: { required: ['code','name','type'] } },
    { id: 'finance_document:submit', entity_id: 'finance_document', kind: 'domain', required_permission: 'finance_document:submit', input_schema: { required: ['document_id'] }, allowed_states: ['draft'] },
    { id: 'finance_document:post', entity_id: 'finance_document', kind: 'domain', required_permission: 'finance_document:post', input_schema: { required: ['document_id'] }, allowed_states: ['approved'] },
    { id: 'finance_document:reverse', entity_id: 'finance_document', kind: 'domain', required_permission: 'finance_document:reverse', input_schema: { required: ['document_id'] }, allowed_states: ['posted'] },
    { id: 'finance_document:amend', entity_id: 'finance_document', kind: 'domain', required_permission: 'finance_document:amend', input_schema: { required: ['document_id'] }, allowed_states: ['posted','reversed'] },
    { id: 'finance_period:open', entity_id: 'finance_period', kind: 'domain', required_permission: 'finance_period:open', input_schema: { required: ['period_id'] } },
    { id: 'finance_period:soft_close', entity_id: 'finance_period', kind: 'domain', required_permission: 'finance_period:close', input_schema: { required: ['period_id'] } },
    { id: 'finance_period:hard_close', entity_id: 'finance_period', kind: 'domain', required_permission: 'finance_period:close', input_schema: { required: ['period_id'] } },
    { id: 'finance_period:reopen', entity_id: 'finance_period', kind: 'domain', required_permission: 'finance_period:reopen', input_schema: { required: ['period_id'] } },
    { id: 'finance_journal:verify_integrity', entity_id: 'finance_journal_entry', kind: 'domain', required_permission: 'finance_journal:verify', input_schema: { required: [] } },
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
}

function createDocumentLifecycle(dialect) {
  dialect.prepare(`
    INSERT INTO x_doc_state_defs (entity, definition, updated_at, updated_by)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(entity) DO UPDATE SET
      definition = excluded.definition,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `).run(
    'finance_document',
    JSON.stringify({
      states: ['draft', 'submitted', 'approved', { name: 'posted', terminal: true }, 'cancelled', 'reversed'],
      initial: 'draft',
      transitions: [
        { from: 'draft', to: 'submitted', action: 'finance_document:submit' },
        { from: 'submitted', to: 'approved', action: 'finance_document:approve' },
        { from: 'approved', to: 'posted', action: 'finance_document:post' },
        { from: 'draft', to: 'cancelled', action: 'finance_document:cancel' },
        { from: 'submitted', to: 'cancelled', action: 'finance_document:cancel' },
        { from: 'approved', to: 'cancelled', action: 'finance_document:cancel' },
        { from: 'posted', to: 'reversed', action: 'finance_document:reverse' },
      ],
    }),
    now, MODULE_ID
  );
}

function createTables(dialect) {
  dialect.exec(`
    CREATE TABLE IF NOT EXISTS finance_accounts (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES platform_companies(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      name_ar TEXT,
      type TEXT NOT NULL CHECK (type IN ('asset','liability','equity','income','expense','receivable','payable','liquidity','off_balance')),
      parent_id TEXT REFERENCES finance_accounts(id),
      normal_balance TEXT NOT NULL CHECK (normal_balance IN ('debit','credit')),
      is_reconcilable INTEGER NOT NULL DEFAULT 0,
      currency_restriction TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_control INTEGER NOT NULL DEFAULT 0,
      tax_role TEXT,
      bank_role TEXT,
      cash_role TEXT,
      retained_earnings_role INTEGER DEFAULT 0,
      localization_origin TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT,
      updated_by TEXT
    ) STRICT;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_accounts_company_code ON finance_accounts(company_id, code);
    CREATE INDEX IF NOT EXISTS idx_finance_accounts_company ON finance_accounts(company_id);
    CREATE INDEX IF NOT EXISTS idx_finance_accounts_parent ON finance_accounts(parent_id);

    CREATE TABLE IF NOT EXISTS finance_journals (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES platform_companies(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('sale','purchase','cash','bank','general','opening','period_close','tax_adjustment')),
      sequence_id TEXT,
      default_debit_account_id TEXT REFERENCES finance_accounts(id),
      default_credit_account_id TEXT REFERENCES finance_accounts(id),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT
    ) STRICT;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_journals_company_code ON finance_journals(company_id, code);
    CREATE INDEX IF NOT EXISTS idx_finance_journals_company ON finance_journals(company_id);

    CREATE TABLE IF NOT EXISTS finance_fiscal_years (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES platform_companies(id),
      name TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','locked')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_finance_fiscal_years_company ON finance_fiscal_years(company_id);

    CREATE TABLE IF NOT EXISTS finance_periods (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES platform_companies(id),
      fiscal_year_id TEXT NOT NULL REFERENCES finance_fiscal_years(id),
      name TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','soft_closed','hard_closed','locked')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT,
      updated_by TEXT
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_finance_periods_company_date ON finance_periods(company_id, start_date, end_date);

    CREATE TABLE IF NOT EXISTS finance_locks (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES platform_companies(id),
      module TEXT NOT NULL,
      lock_date TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL,
      created_by TEXT
    ) STRICT;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_locks_company_module ON finance_locks(company_id, module);

    CREATE TABLE IF NOT EXISTS finance_documents (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES platform_companies(id),
      journal_id TEXT REFERENCES finance_journals(id),
      doc_number TEXT,
      move_type TEXT NOT NULL,
      partner_id TEXT,
      doc_date TEXT NOT NULL,
      post_date TEXT,
      currency TEXT NOT NULL DEFAULT 'IQD',
      state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','submitted','approved','posted','cancelled','reversed')),
      reversal_of_id TEXT REFERENCES finance_documents(id),
      reversal_id TEXT REFERENCES finance_documents(id),
      source_type TEXT,
      source_id TEXT,
      source_canonical_key TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT,
      updated_by TEXT
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_finance_documents_company ON finance_documents(company_id);
    CREATE INDEX IF NOT EXISTS idx_finance_documents_date ON finance_documents(company_id, doc_date);
    CREATE INDEX IF NOT EXISTS idx_finance_documents_state ON finance_documents(company_id, state);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_documents_number ON finance_documents(company_id, doc_number) WHERE doc_number IS NOT NULL;

    CREATE TABLE IF NOT EXISTS finance_document_lines (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES finance_documents(id) ON DELETE CASCADE,
      company_id TEXT NOT NULL REFERENCES platform_companies(id),
      account_id TEXT NOT NULL REFERENCES finance_accounts(id),
      debit REAL NOT NULL DEFAULT 0 CHECK (debit >= 0),
      credit REAL NOT NULL DEFAULT 0 CHECK (credit >= 0),
      currency_code TEXT,
      currency_debit REAL DEFAULT 0,
      currency_credit REAL DEFAULT 0,
      tax_refs TEXT,
      dims TEXT,
      partner_id TEXT,
      description TEXT,
      created_at TEXT NOT NULL,
      created_by TEXT
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_finance_document_lines_document ON finance_document_lines(document_id);

    CREATE TABLE IF NOT EXISTS finance_journal_entries (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL UNIQUE REFERENCES finance_documents(id),
      company_id TEXT NOT NULL REFERENCES platform_companies(id),
      journal_id TEXT REFERENCES finance_journals(id),
      entry_number TEXT NOT NULL,
      posting_date TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'IQD',
      total_debit REAL NOT NULL DEFAULT 0,
      total_credit REAL NOT NULL DEFAULT 0,
      hash TEXT,
      prev_hash TEXT,
      created_at TEXT NOT NULL,
      created_by TEXT
    ) STRICT;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_journal_entries_number ON finance_journal_entries(company_id, entry_number);

    CREATE TABLE IF NOT EXISTS finance_journal_lines (
      id TEXT PRIMARY KEY,
      journal_entry_id TEXT NOT NULL REFERENCES finance_journal_entries(id),
      company_id TEXT NOT NULL REFERENCES platform_companies(id),
      document_id TEXT NOT NULL REFERENCES finance_documents(id),
      document_line_id TEXT REFERENCES finance_document_lines(id),
      account_id TEXT NOT NULL REFERENCES finance_accounts(id),
      posting_date TEXT NOT NULL,
      debit REAL NOT NULL DEFAULT 0 CHECK (debit >= 0),
      credit REAL NOT NULL DEFAULT 0 CHECK (credit >= 0),
      currency_code TEXT,
      currency_debit REAL DEFAULT 0,
      currency_credit REAL DEFAULT 0,
      dims TEXT,
      partner_id TEXT,
      description TEXT,
      created_at TEXT NOT NULL,
      created_by TEXT
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_finance_journal_lines_entry ON finance_journal_lines(journal_entry_id);
    CREATE INDEX IF NOT EXISTS idx_finance_journal_lines_company_account ON finance_journal_lines(company_id, account_id);
    CREATE INDEX IF NOT EXISTS idx_finance_journal_lines_document ON finance_journal_lines(document_id);

    CREATE TABLE IF NOT EXISTS finance_reversal_links (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES platform_companies(id),
      original_document_id TEXT NOT NULL REFERENCES finance_documents(id),
      reversal_document_id TEXT NOT NULL UNIQUE REFERENCES finance_documents(id),
      reversal_type TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL,
      created_by TEXT
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_finance_reversal_links_original ON finance_reversal_links(original_document_id);

    CREATE TABLE IF NOT EXISTS finance_integrity_hashes (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES platform_companies(id),
      journal_entry_id TEXT NOT NULL REFERENCES finance_journal_entries(id),
      hash_input TEXT NOT NULL,
      hash TEXT NOT NULL,
      prev_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_finance_integrity_hashes_entry ON finance_integrity_hashes(journal_entry_id);

    -- Append-only enforcement for the general ledger
    CREATE TRIGGER IF NOT EXISTS t_finance_journal_lines_no_update BEFORE UPDATE ON finance_journal_lines
    BEGIN
      SELECT RAISE(FAIL, 'Updates not allowed on append-only GL lines');
    END;

    CREATE TRIGGER IF NOT EXISTS t_finance_journal_lines_no_delete BEFORE DELETE ON finance_journal_lines
    BEGIN
      SELECT RAISE(FAIL, 'Deletes not allowed on append-only GL lines');
    END;

    CREATE TRIGGER IF NOT EXISTS t_finance_journal_entries_no_update BEFORE UPDATE ON finance_journal_entries
    BEGIN
      SELECT RAISE(FAIL, 'Updates not allowed on immutable journal entries');
    END;

    CREATE TRIGGER IF NOT EXISTS t_finance_journal_entries_no_delete BEFORE DELETE ON finance_journal_entries
    BEGIN
      SELECT RAISE(FAIL, 'Deletes not allowed on immutable journal entries');
    END;
  `);
}

function seedDefaultCoA(dialect) {
  const defaultCompany = dialect.prepare('SELECT id FROM platform_companies WHERE id = ?').get('default');
  if (!defaultCompany) return;

  const accounts = [
    ['acc_100000', '100000', 'Assets / الأصول', 'asset', null, 'debit', 0],
    ['acc_101000', '101000', 'Cash / الصندوق', 'liquidity', 'acc_100000', 'debit', 1],
    ['acc_102000', '102000', 'Bank / البنك', 'liquidity', 'acc_100000', 'debit', 1],
    ['acc_103000', '103000', 'Receivables / المدينون', 'receivable', 'acc_100000', 'debit', 1],
    ['acc_104000', '104000', 'Stock Valuation / تقييم المخزون', 'asset', 'acc_100000', 'debit', 0],
    ['acc_200000', '200000', 'Liabilities / الالتزامات', 'liability', null, 'credit', 0],
    ['acc_201000', '201000', 'Payables / الدائنون', 'payable', 'acc_200000', 'credit', 1],
    ['acc_202000', '202000', 'VAT Payable / ضريبة القيمة المضافة المستحقة', 'liability', 'acc_200000', 'credit', 0],
    ['acc_300000', '300000', 'Equity / حقوق الملكية', 'equity', null, 'credit', 0],
    ['acc_301000', '301000', 'Retained Earnings / الأرباح المحتجزة', 'equity', 'acc_300000', 'credit', 0],
    ['acc_400000', '400000', 'Income / الإيرادات', 'income', null, 'credit', 0],
    ['acc_401000', '401000', 'Sales / المبيعات', 'income', 'acc_400000', 'credit', 0],
    ['acc_500000', '500000', 'Expenses / المصاريف', 'expense', null, 'debit', 0],
    ['acc_501000', '501000', 'Cost of Goods Sold / كلفة المبيعات', 'expense', 'acc_500000', 'debit', 0],
    ['acc_502000', '502000', 'General Expenses / المصاريف العمومية', 'expense', 'acc_500000', 'debit', 0],
  ];

  const ins = dialect.prepare(`
    INSERT OR IGNORE INTO finance_accounts (
      id, company_id, code, name, type, parent_id, normal_balance, is_reconcilable, is_active, created_at, updated_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const a of accounts) {
    ins.run(a[0], 'default', a[1], a[2], a[3], a[4], a[5], a[6], 1, now, now, 'migration:014');
  }
}

function seedDefaultJournals(dialect) {
  const defaultCompany = dialect.prepare('SELECT id FROM platform_companies WHERE id = ?').get('default');
  if (!defaultCompany) return;

  const journals = [
    ['jnl_general', 'general', 'General Journal / يومنية عامة', 'acc_101000', 'acc_101000'],
    ['jnl_sales', 'sale', 'Sales Journal / يومنية المبيعات', 'acc_103000', 'acc_401000'],
    ['jnl_purchase', 'purchase', 'Purchase Journal / يومنية المشتريات', 'acc_501000', 'acc_201000'],
    ['jnl_cash', 'cash', 'Cash Journal / يومنية الصندوق', 'acc_101000', 'acc_101000'],
    ['jnl_bank', 'bank', 'Bank Journal / يومنية البنك', 'acc_102000', 'acc_102000'],
  ];

  const ins = dialect.prepare(`
    INSERT OR IGNORE INTO finance_journals (
      id, company_id, code, name, type, default_debit_account_id, default_credit_account_id, created_at, updated_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const j of journals) {
    ins.run(j[0], 'default', j[0], j[2], j[1], j[3], j[4], now, now, 'migration:014');
  }
}

function seedDefaultFiscalYear(dialect) {
  const defaultCompany = dialect.prepare('SELECT id FROM platform_companies WHERE id = ?').get('default');
  if (!defaultCompany) return;

  const yearId = 'fy_default_2026';
  dialect.prepare(`
    INSERT OR IGNORE INTO finance_fiscal_years (id, company_id, name, start_date, end_date, status, created_at, updated_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(yearId, 'default', '2026 / ٢٠٢٦', '2026-01-01', '2026-12-31', 'open', now, now, 'migration:014');

  const ins = dialect.prepare(`
    INSERT OR IGNORE INTO finance_periods (id, company_id, fiscal_year_id, name, start_date, end_date, status, created_at, updated_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (let m = 1; m <= 12; m++) {
    const ms = String(m).padStart(2, '0');
    const periodId = `period_default_2026_${ms}`;
    const start = `2026-${ms}-01`;
    const end = new Date(2026, m, 0).toISOString().split('T')[0];
    ins.run(periodId, 'default', yearId, `2026-${ms}`, start, end, 'open', now, now, 'migration:014');
  }
}
