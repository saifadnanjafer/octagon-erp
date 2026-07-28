// 048_pos_atomic_workflows — Checkpoint C3
//
// Extends the canonical POS authority with terminal/session configuration,
// receipt and refund lineage, and durable reconciliation facts. Behaviour is
// clean-room adapted from the project-owned frozen VNext POS engine plus
// targeted review of Odoo 19 POS (LGPLv3) and ERPNext POS (GPLv3).

const MODULE_ID = 'commercial_cutover';

const ENTITIES = [
  ['pos_refund', MODULE_ID, 'platform.pos', 'POS Refund'],
  ['pos_reconciliation', MODULE_ID, 'platform.pos', 'POS Reconciliation'],
  ['pos_terminal', MODULE_ID, 'platform.pos', 'POS Terminal'],
];

const ACTIONS = [
  ['pos:terminal:configure', 'pos_terminal', 'pos:session:write', ['name', 'warehouse_id', 'cash_account_id']],
  ['pos:payment_method:configure', 'pos_terminal', 'pos:session:write', ['payment_method_id', 'gl_account_id']],
  ['pos:order:refund', 'pos_refund', 'pos:order:write', ['original_order_id', 'session_id', 'lines', 'payments']],
];

const COLUMNS = {
  pos_sessions: [
    'terminal_id TEXT',
    'branch_id TEXT',
    'warehouse_id TEXT',
    'cash_shift_id TEXT',
    'opening_cash REAL NOT NULL DEFAULT 0',
    'expected_cash REAL',
    'counted_cash REAL',
    'variance REAL',
    'closed_by TEXT',
  ],
  pos_orders: [
    "order_kind TEXT NOT NULL DEFAULT 'sale'",
    'original_order_id TEXT',
    'warehouse_id TEXT',
    'cashier_id TEXT',
    "currency_id TEXT NOT NULL DEFAULT 'IQD'",
    'amount_untaxed REAL NOT NULL DEFAULT 0',
    'amount_tax REAL NOT NULL DEFAULT 0',
    'amount_discount REAL NOT NULL DEFAULT 0',
    'receipt_number TEXT',
    'completed_at TEXT',
  ],
  pos_order_lines: [
    'tax_amount REAL NOT NULL DEFAULT 0',
    'price_total REAL NOT NULL DEFAULT 0',
    'original_order_line_id TEXT',
  ],
  pos_payments: [
    'payment_reference TEXT',
    "state TEXT NOT NULL DEFAULT 'posted'",
  ],
};

function addColumn(db, table, definition) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition};`);
  } catch (error) {
    if (!String(error?.message || error).includes('duplicate column')) throw error;
  }
}

export const migration = {
  id: '048_pos_atomic_workflows',
  owner: MODULE_ID,
  version: '1.27.0',
  parent: '047_procurement_lifecycle_expansion',
  dependsOn: ['047_procurement_lifecycle_expansion'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Frozen VNext POS behaviour plus clean-room Odoo 19 POS and ERPNext POS review, integrated into canonical Octagon POS/Inventory/Finance',

  up(db) {
    for (const [table, definitions] of Object.entries(COLUMNS)) {
      for (const definition of definitions) addColumn(db, table, definition);
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS pos_terminals (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        branch_id TEXT,
        name TEXT NOT NULL,
        warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
        cashbox_id TEXT NOT NULL REFERENCES finance_cashboxes(id),
        currency_id TEXT NOT NULL DEFAULT 'IQD',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, name)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS pos_refunds (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        original_order_id TEXT NOT NULL REFERENCES pos_orders(id),
        refund_order_id TEXT NOT NULL UNIQUE REFERENCES pos_orders(id),
        reason TEXT NOT NULL,
        stock_picking_id TEXT,
        finance_document_id TEXT NOT NULL REFERENCES finance_documents(id),
        actor TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS pos_refund_lines (
        id TEXT PRIMARY KEY,
        refund_id TEXT NOT NULL REFERENCES pos_refunds(id) ON DELETE CASCADE,
        original_order_line_id TEXT NOT NULL REFERENCES pos_order_lines(id),
        refund_order_line_id TEXT NOT NULL REFERENCES pos_order_lines(id),
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        quantity REAL NOT NULL CHECK(quantity > 0),
        stock_move_id TEXT NOT NULL REFERENCES stock_moves(id),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS pos_session_events (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        session_id TEXT NOT NULL REFERENCES pos_sessions(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL CHECK(event_type IN ('opened','sale','refund','cash_count','closed')),
        reference_type TEXT,
        reference_id TEXT,
        amount REAL NOT NULL DEFAULT 0,
        details TEXT NOT NULL DEFAULT '{}',
        actor TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS pos_reconciliations (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        session_id TEXT NOT NULL UNIQUE REFERENCES pos_sessions(id) ON DELETE CASCADE,
        cash_shift_id TEXT NOT NULL REFERENCES finance_cash_shifts(id),
        opening_amount REAL NOT NULL,
        sales_amount REAL NOT NULL,
        refunds_amount REAL NOT NULL,
        expected_amount REAL NOT NULL,
        counted_amount REAL NOT NULL,
        variance REAL NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('balanced','variance')),
        actor TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_pos_orders_company_kind ON pos_orders(company_id, order_kind, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_orders_receipt ON pos_orders(company_id, receipt_number) WHERE receipt_number IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_pos_refunds_original ON pos_refunds(company_id, original_order_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_pos_session_events_session ON pos_session_events(session_id, created_at);
    `);

    const now = new Date().toISOString();
    const insertEntity = db.prepare(`
      INSERT INTO platform_entities (
        id, module_id, storage_owner, primary_key, label_ar, label_en, section,
        chatter, fields, relations, scope, lifecycle_policy, query_policy,
        action_policy, customization_policy, history_policy, api_exposed,
        migration_owner, created_at, updated_at
      ) VALUES (?, ?, ?, 'id', ?, ?, 'commercial', 1, '{}', '{}', 'company',
        'generic', 'scoped', 'registered', 'metadata', 'audit', 1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        module_id=excluded.module_id, storage_owner=excluded.storage_owner,
        label_en=excluded.label_en, query_policy='scoped',
        action_policy='registered', history_policy='audit', updated_at=excluded.updated_at
    `);
    for (const [id, moduleId, owner, label] of ENTITIES) {
      insertEntity.run(id, moduleId, owner, label, label, moduleId, now, now);
    }

    const insertAction = db.prepare(`
      INSERT INTO platform_actions (
        id, module_id, entity_id, kind, allowed_states, required_permission,
        required_scope, input_schema, preconditions, transaction_owner,
        idempotency_policy, sequence_policy, audit_policy, outbox_policy,
        reversal_action, result_schema, error_contract, created_at, updated_at
      ) VALUES (?, ?, ?, 'domain', '[]', ?, 'company', ?, '[]',
        'platform_action_executor', 'required', 'none', 'required', 'required',
        NULL, NULL, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        module_id=excluded.module_id, entity_id=excluded.entity_id,
        required_permission=excluded.required_permission,
        input_schema=excluded.input_schema, transaction_owner='platform_action_executor',
        idempotency_policy='required', audit_policy='required',
        outbox_policy='required', error_contract=excluded.error_contract,
        updated_at=excluded.updated_at
    `);
    const errorContract = JSON.stringify({
      envelope: 'stable',
      rollback: 'POS payment, stock, valuation, finance, cashbox, audit, outbox, and idempotency are atomic',
      codes: ['INPUT_MISSING_FIELD', 'IDEMPOTENCY_KEY_REQUIRED', 'UNTRUSTED_ACTION_SCOPE', 'PRECONDITION_FAILED'],
    });
    for (const [actionId, entityId, permission, required] of ACTIONS) {
      insertAction.run(actionId, MODULE_ID, entityId, permission, JSON.stringify({ type: 'object', required }), errorContract, now, now);
    }
    // Session opening accepts either a governed terminal_id (which owns the
    // cashbox and opens the canonical cash shift) or the legacy cash_shift_id
    // compatibility path. Runtime preconditions enforce the alternative.
    db.prepare(`
      UPDATE platform_actions SET input_schema = ?, updated_at = ?
      WHERE id = 'pos:session:open'
    `).run(JSON.stringify({ type: 'object', required: [] }), now);
  },

  down(db) {
    db.prepare(`
      UPDATE platform_actions SET input_schema = ?
      WHERE id = 'pos:session:open'
    `).run(JSON.stringify({ type: 'object', required: ['cash_shift_id'] }));
    const deleteAction = db.prepare('DELETE FROM platform_actions WHERE id = ?');
    for (const [id] of ACTIONS) deleteAction.run(id);
    const deleteEntity = db.prepare('DELETE FROM platform_entities WHERE id = ?');
    for (const [id] of ENTITIES) deleteEntity.run(id);
    db.exec(`
      DROP TABLE IF EXISTS pos_reconciliations;
      DROP TABLE IF EXISTS pos_session_events;
      DROP TABLE IF EXISTS pos_refund_lines;
      DROP TABLE IF EXISTS pos_refunds;
      DROP TABLE IF EXISTS pos_terminals;
      DROP INDEX IF EXISTS idx_pos_orders_receipt;
      DROP INDEX IF EXISTS idx_pos_orders_company_kind;
    `);
  },
};

export default migration;
