// 046_sales_lifecycle_expansion — Sales lifecycle expansion (Checkpoint C)
//
// What this migration does:
//   1. Adds the CRM opportunity entity (lead -> opportunity -> quotation pipeline).
//   2. Extends sale_orders / sale_order_lines with the quotation lifecycle
//      (submit/approve/revise/accept), tax, discount, validity, and cancel columns.
//   3. Adds customer sales returns (sale_returns + sale_return_lines).
//   4. Extends the commission foundation (rules table + approved/paid lifecycle columns).
//   5. Registers the new governed sales actions in platform_actions.
//
// The lifecycle logic implemented against this schema is a clean-room
// adaptation of the project-owned VNext sales engine
// (octagon-erp-commercial-vnext/vnext/server/modules/sales/sales-engine.js and
// octagon-erp-commercial-vnext/migrations/612_r3_sales_core.mjs), re-expressed
// on this repository's canonical authorities (parties, finance credit/tax/AR,
// inventory reservations, WMS pickings). No VNext finance/stock kernel calls
// were copied.

const MODULE_ID = 'platform.kernel';
const SALES_MODULE = 'commercial_sales';

const ENTITIES = [
  ['commercial_crm_opportunity', 'commercial_sales', 'platform.sales', 'CRM Opportunity'],
  ['sale_delivery', 'commercial_sales', 'platform.sales', 'Sales Delivery'],
  ['sale_return', 'commercial_sales', 'platform.sales', 'Sales Return'],
  ['sales_commission_event', 'commercial_sales', 'platform.sales', 'Sales Commission Event'],
];

const ACTIONS = [
  ['crm:lead:convert', 'commercial_crm_lead', 'crm:lead:write', ['id', 'partner_id']],
  ['crm:opportunity:update_stage', 'commercial_crm_opportunity', 'crm:lead:write', ['id', 'stage']],
  ['crm:opportunity:add_activity', 'commercial_crm_opportunity', 'crm:lead:write', ['id', 'summary']],
  ['crm:opportunity:close', 'commercial_crm_opportunity', 'crm:lead:write', ['id', 'outcome']],
  ['sales:quotation:submit', 'sale_order', 'sales:order:write', ['order_id']],
  ['sales:quotation:approve', 'sale_order', 'sales:order:approve', ['order_id']],
  ['sales:quotation:revise', 'sale_order', 'sales:order:write', ['order_id']],
  ['sales:quotation:accept', 'sale_order', 'sales:order:write', ['order_id']],
  ['sales:order:cancel', 'sale_order', 'sales:order:write', ['order_id']],
  ['sales:order:reserve', 'sale_order', 'sales:order:write', ['order_id', 'warehouse_id']],
  ['sales:delivery:post', 'sale_delivery', 'sales:order:write', ['order_id', 'lines']],
  ['sales:return:create', 'sale_return', 'sales:invoice:write', ['order_id', 'warehouse_id', 'lines']],
  ['sales:commission:accrue', 'sales_commission_event', 'sales:commission:write', ['order_id', 'salesperson_id']],
  ['sales:commission:approve', 'sales_commission_event', 'sales:commission:write', ['commission_id']],
  ['sales:commission:mark_paid', 'sales_commission_event', 'sales:commission:write', ['commission_id']],
];

const SALE_ORDER_COLUMNS = [
  'revision_no INTEGER NOT NULL DEFAULT 0',
  'quotation_state TEXT NOT NULL DEFAULT "draft"',
  'validity_date TEXT',
  'approved_by TEXT',
  'approved_at TEXT',
  'accepted_at TEXT',
  'superseded_by TEXT',
  'cancelled_at TEXT',
  'cancel_reason TEXT NOT NULL DEFAULT ""',
  'source_opportunity_id TEXT',
  'discount_total REAL NOT NULL DEFAULT 0.0',
  'tax_total REAL NOT NULL DEFAULT 0.0',
  'notes TEXT NOT NULL DEFAULT ""',
  'attachments TEXT NOT NULL DEFAULT "[]"',
  'project_ref TEXT',
];

const SALE_ORDER_LINE_COLUMNS = [
  'tax_amount REAL NOT NULL DEFAULT 0.0',
];

const COMMISSION_COLUMNS = [
  'basis_amount REAL NOT NULL DEFAULT 0.0',
  'rate REAL NOT NULL DEFAULT 0.0',
  'approved_by TEXT',
  'approved_at TEXT',
  'paid_by TEXT',
  'paid_at TEXT',
];

function addColumnIfNotExists(db, table, columnDef) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef};`);
  } catch (err) {
    if (!String(err && err.message ? err.message : err).includes('duplicate column')) {
      throw err;
    }
  }
}

export const migration = {
  id: '046_sales_lifecycle_expansion',
  owner: MODULE_ID,
  version: '1.25.0',
  parent: '045_governed_master_data_and_inventory_actions',
  dependsOn: ['045_governed_master_data_and_inventory_actions'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Clean-room adaptation of the project-owned VNext sales engine (octagon-erp-commercial-vnext/vnext/server/modules/sales/sales-engine.js, migrations/612_r3_sales_core.mjs) onto the canonical sales/finance/inventory authorities',

  up(db) {
    // 1. CRM opportunities + activity log
    db.exec(`
      CREATE TABLE IF NOT EXISTS crm_opportunities (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        branch_id TEXT,
        lead_id TEXT REFERENCES crm_leads(id) ON DELETE SET NULL,
        party_id TEXT NOT NULL REFERENCES parties(id),
        name TEXT NOT NULL,
        stage TEXT NOT NULL DEFAULT 'new',
        expected_value REAL NOT NULL DEFAULT 0.0,
        probability REAL NOT NULL DEFAULT 10.0,
        owner_user_id TEXT,
        expected_close_date TEXT,
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'won', 'lost')),
        lost_reason TEXT NOT NULL DEFAULT '',
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS crm_opportunity_activities (
        id TEXT PRIMARY KEY,
        opportunity_id TEXT NOT NULL REFERENCES crm_opportunities(id) ON DELETE CASCADE,
        activity_type TEXT NOT NULL DEFAULT 'note',
        summary TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        due_date TEXT,
        created_at TEXT NOT NULL
      ) STRICT;
    `);

    // 2. Quotation lifecycle + tax/discount columns
    for (const columnDef of SALE_ORDER_COLUMNS) {
      addColumnIfNotExists(db, 'sale_orders', columnDef);
    }
    for (const columnDef of SALE_ORDER_LINE_COLUMNS) {
      addColumnIfNotExists(db, 'sale_order_lines', columnDef);
    }
    // Backfill: orders confirmed before this migration are past the quotation stage.
    db.exec(`UPDATE sale_orders SET quotation_state = 'accepted' WHERE state = 'sale' AND quotation_state = 'draft';`);

    // 3. Delivery execution/backorder lineage + customer sales returns
    db.exec(`
      CREATE TABLE IF NOT EXISTS sale_delivery_events (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        sale_order_id TEXT NOT NULL REFERENCES sale_orders(id),
        picking_id TEXT NOT NULL REFERENCES stock_pickings(id),
        backorder_picking_id TEXT REFERENCES stock_pickings(id),
        state TEXT NOT NULL CHECK(state IN ('done','partial')),
        delivered_quantities TEXT NOT NULL DEFAULT '{}',
        actor TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS sale_returns (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        sale_order_id TEXT NOT NULL REFERENCES sale_orders(id),
        picking_id TEXT REFERENCES stock_pickings(id),
        credit_note_request_id TEXT,
        reason TEXT NOT NULL DEFAULT '',
        state TEXT NOT NULL DEFAULT 'done' CHECK(state IN ('done', 'cancelled')),
        actor TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS sale_return_lines (
        id TEXT PRIMARY KEY,
        sale_return_id TEXT NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        sale_order_line_id TEXT NOT NULL REFERENCES sale_order_lines(id),
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        quantity REAL NOT NULL CHECK(quantity > 0),
        stock_move_id TEXT REFERENCES stock_moves(id),
        created_at TEXT NOT NULL
      ) STRICT;
    `);

    // 4. Commission foundation: configurable rules + lifecycle columns
    db.exec(`
      CREATE TABLE IF NOT EXISTS sales_commission_rules (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        salesperson_id TEXT NOT NULL DEFAULT '*',
        rate REAL NOT NULL DEFAULT 0.0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, salesperson_id)
      ) STRICT;
    `);
    for (const columnDef of COMMISSION_COLUMNS) {
      addColumnIfNotExists(db, 'sales_commission_events', columnDef);
    }

    // 5. Register entities + governed actions
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
        module_id = excluded.module_id,
        storage_owner = excluded.storage_owner,
        label_en = excluded.label_en,
        query_policy = 'scoped',
        action_policy = 'registered',
        history_policy = 'audit',
        updated_at = excluded.updated_at
    `);
    for (const [id, moduleId, storageOwner, label] of ENTITIES) {
      insertEntity.run(id, moduleId, storageOwner, label, label, moduleId, now, now);
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
        audit_policy = excluded.audit_policy,
        outbox_policy = excluded.outbox_policy,
        error_contract = excluded.error_contract,
        updated_at = excluded.updated_at
    `);
    const errorContract = JSON.stringify({
      envelope: 'stable',
      rollback: 'business mutation, audit, outbox, and idempotency are atomic',
      codes: ['INPUT_MISSING_FIELD', 'IDEMPOTENCY_KEY_REQUIRED', 'UNTRUSTED_ACTION_SCOPE', 'PRECONDITION_FAILED'],
    });
    for (const [actionId, entityId, permission, required] of ACTIONS) {
      insertAction.run(
        actionId,
        SALES_MODULE,
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
    for (const [actionId] of ACTIONS) deleteAction.run(actionId);
    const deleteEntity = db.prepare('DELETE FROM platform_entities WHERE id = ?');
    for (const [id] of ENTITIES) deleteEntity.run(id);

    db.exec(`
      DROP TABLE IF EXISTS sales_commission_rules;
      DROP TABLE IF EXISTS sale_return_lines;
      DROP TABLE IF EXISTS sale_returns;
      DROP TABLE IF EXISTS sale_delivery_events;
      DROP TABLE IF EXISTS crm_opportunity_activities;
      DROP TABLE IF EXISTS crm_opportunities;
    `);

    const dropColumn = (table, columnDef) => {
      const column = columnDef.split(' ')[0];
      db.exec(`ALTER TABLE ${table} DROP COLUMN ${column};`);
    };
    for (const columnDef of COMMISSION_COLUMNS) dropColumn('sales_commission_events', columnDef);
    for (const columnDef of SALE_ORDER_LINE_COLUMNS) dropColumn('sale_order_lines', columnDef);
    for (const columnDef of SALE_ORDER_COLUMNS) dropColumn('sale_orders', columnDef);
  }
};
