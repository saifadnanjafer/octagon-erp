// 047_procurement_lifecycle_expansion — Checkpoint C2
//
// Extends the existing canonical procurement authority. Behavior is adapted
// from the project-owned frozen VNext procurement engine and clean-room review
// of Odoo 19 Purchase (LGPLv3) and ERPNext Buying (GPLv3). No donor code is
// copied into this migration.

const MODULE_ID = 'commercial_procurement';

const ENTITIES = [
  ['purchase_request', MODULE_ID, 'platform.procurement', 'Purchase Request'],
  ['purchase_receipt_event', MODULE_ID, 'platform.procurement', 'Purchase Receipt'],
  ['purchase_return', MODULE_ID, 'platform.procurement', 'Purchase Return'],
  ['supplier_scorecard', MODULE_ID, 'platform.procurement', 'Supplier Scorecard'],
];

const ACTIONS = [
  ['procurement:request:create', 'purchase_request', 'purchase:requisition:write', ['name', 'lines']],
  ['procurement:request:submit', 'purchase_request', 'purchase:requisition:write', ['request_id']],
  ['procurement:request:approve', 'purchase_request', 'purchase:requisition:approve', ['request_id']],
  ['procurement:requisition:approve', 'purchase_requisition', 'purchase:requisition:approve', ['requisition_id']],
  ['procurement:supplier_quotation:record', 'purchase_rfq', 'purchase:rfq:write', ['rfq_id', 'supplier_id', 'lines']],
  ['procurement:supplier_quotation:award', 'purchase_rfq', 'purchase:rfq:write', ['quotation_id']],
  ['procurement:order:approve', 'purchase_order', 'purchase:order:approve', ['order_id']],
  ['procurement:receipt:post', 'purchase_receipt_event', 'purchase:order:write', ['purchase_order_id', 'lines']],
  ['procurement:return:create', 'purchase_return', 'purchase:bill:write', ['purchase_order_id', 'warehouse_id', 'lines']],
  ['procurement:score:record', 'supplier_scorecard', 'purchase:order:write', ['supplier_id']],
];

const COLUMNS = {
  purchase_requisitions: [
    'source_request_id TEXT',
    'needed_by TEXT',
    'notes TEXT NOT NULL DEFAULT ""',
    'attachments TEXT NOT NULL DEFAULT "[]"',
    'approved_by TEXT',
    'approved_at TEXT',
  ],
  purchase_requisition_lines: [
    'quality_required INTEGER NOT NULL DEFAULT 0',
  ],
  purchase_rfqs: [
    'comments TEXT NOT NULL DEFAULT ""',
    'attachments TEXT NOT NULL DEFAULT "[]"',
    'issued_at TEXT',
  ],
  supplier_quotations: [
    'lead_time_days INTEGER NOT NULL DEFAULT 0',
    'tax_amount REAL NOT NULL DEFAULT 0',
    'delivery_date TEXT',
    'attachments TEXT NOT NULL DEFAULT "[]"',
    'comments TEXT NOT NULL DEFAULT ""',
    'state TEXT NOT NULL DEFAULT "received"',
  ],
  purchase_orders: [
    'selected_quotation_id TEXT',
    'expected_date TEXT',
    'quality_required INTEGER NOT NULL DEFAULT 0',
    'attachments TEXT NOT NULL DEFAULT "[]"',
    'comments TEXT NOT NULL DEFAULT ""',
    'approved_by TEXT',
    'approved_at TEXT',
    'commitment_amount REAL NOT NULL DEFAULT 0',
    'closed_at TEXT',
  ],
  purchase_order_lines: [
    'tax_amount REAL NOT NULL DEFAULT 0',
    'price_total REAL NOT NULL DEFAULT 0',
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
  id: '047_procurement_lifecycle_expansion',
  owner: MODULE_ID,
  version: '1.26.0',
  parent: '046_sales_lifecycle_expansion',
  dependsOn: ['046_sales_lifecycle_expansion'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Frozen VNext procurement behavior plus clean-room Odoo 19 Purchase and ERPNext Buying review, integrated into canonical Octagon Procurement/Inventory/Finance',

  up(db) {
    for (const [table, definitions] of Object.entries(COLUMNS)) {
      for (const definition of definitions) addColumn(db, table, definition);
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS purchase_requests (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        branch_id TEXT,
        name TEXT NOT NULL,
        requested_by TEXT,
        state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','submitted','approved','rejected','converted','cancelled')),
        needed_by TEXT,
        justification TEXT NOT NULL DEFAULT '',
        comments TEXT NOT NULL DEFAULT '',
        attachments TEXT NOT NULL DEFAULT '[]',
        approved_by TEXT,
        approved_at TEXT,
        requisition_id TEXT REFERENCES purchase_requisitions(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS purchase_request_lines (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        quantity REAL NOT NULL CHECK(quantity > 0),
        uom_id TEXT NOT NULL,
        estimated_unit_cost REAL NOT NULL DEFAULT 0,
        quality_required INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS purchase_rfq_lines (
        id TEXT PRIMARY KEY,
        rfq_id TEXT NOT NULL REFERENCES purchase_rfqs(id) ON DELETE CASCADE,
        requisition_line_id TEXT REFERENCES purchase_requisition_lines(id),
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        quantity REAL NOT NULL CHECK(quantity > 0),
        uom_id TEXT NOT NULL,
        target_date TEXT,
        quality_required INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS purchase_rfq_suppliers (
        id TEXT PRIMARY KEY,
        rfq_id TEXT NOT NULL REFERENCES purchase_rfqs(id) ON DELETE CASCADE,
        supplier_id TEXT NOT NULL REFERENCES parties(id),
        status TEXT NOT NULL DEFAULT 'invited' CHECK(status IN ('invited','responded','declined','awarded')),
        invited_at TEXT NOT NULL,
        UNIQUE(rfq_id, supplier_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS supplier_quotation_lines (
        id TEXT PRIMARY KEY,
        quotation_id TEXT NOT NULL REFERENCES supplier_quotations(id) ON DELETE CASCADE,
        rfq_line_id TEXT NOT NULL REFERENCES purchase_rfq_lines(id),
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        quantity REAL NOT NULL,
        unit_price REAL NOT NULL,
        tax_amount REAL NOT NULL DEFAULT 0,
        lead_time_days INTEGER NOT NULL DEFAULT 0,
        delivery_date TEXT,
        line_total REAL NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(quotation_id, rfq_line_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS purchase_commitments (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
        amount REAL NOT NULL,
        currency_id TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','released','closed','cancelled')),
        created_at TEXT NOT NULL,
        UNIQUE(company_id, purchase_order_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS purchase_receipt_events (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
        picking_id TEXT NOT NULL REFERENCES stock_pickings(id),
        backorder_picking_id TEXT REFERENCES stock_pickings(id),
        state TEXT NOT NULL CHECK(state IN ('partial','received','quality_hold')),
        received_quantities TEXT NOT NULL,
        actor TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS purchase_quality_checks (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        receipt_event_id TEXT NOT NULL REFERENCES purchase_receipt_events(id) ON DELETE CASCADE,
        purchase_order_line_id TEXT NOT NULL REFERENCES purchase_order_lines(id),
        inspected_quantity REAL NOT NULL,
        accepted_quantity REAL NOT NULL,
        rejected_quantity REAL NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('passed','failed','pending')),
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS purchase_returns (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
        picking_id TEXT NOT NULL REFERENCES stock_pickings(id),
        debit_note_request_id TEXT,
        reason TEXT NOT NULL DEFAULT '',
        state TEXT NOT NULL DEFAULT 'done' CHECK(state IN ('draft','done','cancelled')),
        actor TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS purchase_return_lines (
        id TEXT PRIMARY KEY,
        purchase_return_id TEXT NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        purchase_order_line_id TEXT NOT NULL REFERENCES purchase_order_lines(id),
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        quantity REAL NOT NULL CHECK(quantity > 0),
        stock_move_id TEXT NOT NULL REFERENCES stock_moves(id),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS supplier_scorecards (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        supplier_id TEXT NOT NULL REFERENCES parties(id),
        purchase_order_id TEXT REFERENCES purchase_orders(id),
        on_time_score REAL NOT NULL DEFAULT 0,
        quality_score REAL NOT NULL DEFAULT 0,
        price_score REAL NOT NULL DEFAULT 0,
        overall_score REAL NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_purchase_requests_company_state ON purchase_requests(company_id, state);
      CREATE INDEX IF NOT EXISTS idx_purchase_receipt_events_order ON purchase_receipt_events(purchase_order_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_purchase_returns_order ON purchase_returns(purchase_order_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_supplier_scorecards_supplier ON supplier_scorecards(company_id, supplier_id, created_at);
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
        kind='domain', required_permission=excluded.required_permission,
        required_scope='company', input_schema=excluded.input_schema,
        transaction_owner='platform_action_executor',
        idempotency_policy='required', audit_policy='required',
        outbox_policy='required', error_contract=excluded.error_contract,
        updated_at=excluded.updated_at
    `);
    const errorContract = JSON.stringify({
      envelope: 'stable',
      rollback: 'business mutation, audit, outbox, and idempotency are atomic',
      codes: ['INPUT_MISSING_FIELD', 'IDEMPOTENCY_KEY_REQUIRED', 'UNTRUSTED_ACTION_SCOPE', 'PRECONDITION_FAILED'],
    });
    for (const [actionId, entityId, permission, required] of ACTIONS) {
      insertAction.run(
        actionId,
        MODULE_ID,
        entityId,
        permission,
        JSON.stringify({ type: 'object', required }),
        errorContract,
        now,
        now,
      );
    }
  },

  down(db) {
    const deleteAction = db.prepare('DELETE FROM platform_actions WHERE id = ?');
    for (const [id] of ACTIONS) deleteAction.run(id);
    const deleteEntity = db.prepare('DELETE FROM platform_entities WHERE id = ?');
    for (const [id] of ENTITIES) deleteEntity.run(id);
    db.exec(`
      DROP TABLE IF EXISTS supplier_scorecards;
      DROP TABLE IF EXISTS purchase_return_lines;
      DROP TABLE IF EXISTS purchase_returns;
      DROP TABLE IF EXISTS purchase_quality_checks;
      DROP TABLE IF EXISTS purchase_receipt_events;
      DROP TABLE IF EXISTS purchase_commitments;
      DROP TABLE IF EXISTS supplier_quotation_lines;
      DROP TABLE IF EXISTS purchase_rfq_suppliers;
      DROP TABLE IF EXISTS purchase_rfq_lines;
      DROP TABLE IF EXISTS purchase_request_lines;
      DROP TABLE IF EXISTS purchase_requests;
    `);
  },
};

export default migration;
