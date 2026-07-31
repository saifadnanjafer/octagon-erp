// 084_returns_rma_consolidation.mjs — Returns / RMA / Repair / Warranty orchestration authority.
//
// This migration creates ONE governed orchestration authority for returns.
// It owns the RMA lifecycle, lines, and timeline only. It does NOT own stock
// balances, posted stock movements, GL entries, credit notes, payments,
// Service Tickets, Assets, serial masters, or Quality NCR/CAPA facts — those
// remain canonical in platform/inventory, platform/finance, platform/quality,
// platform/work_items, and platform/procurement respectively. The domain
// service (platform/domains/returns/rma.mjs) calls those authorities directly
// instead of re-implementing their effects.
//
// Replaces the runtime `CREATE TABLE IF NOT EXISTS` that had been called from
// application code on every request — schema now owned by one forward
// migration, per program rule "no runtime DDL".

const MODULE_ID = 'platform.kernel';
const RETURNS_MODULE = 'returns_rma';
const migrationIdSelf = '084_returns_rma_consolidation';

const ENTITIES = [
  ['return_rma', RETURNS_MODULE, 'platform.returns', 'Return / RMA'],
  ['return_rma_line', RETURNS_MODULE, 'platform.returns', 'Return / RMA Line'],
];

const ACTIONS = [
  ['returns:rma_create', 'return_rma', 'returns:write', ['customer_id', 'source_type', 'lines']],
  ['returns:rma_submit', 'return_rma', 'returns:write', ['id']],
  ['returns:rma_approve', 'return_rma', 'returns:approve', ['id']],
  ['returns:rma_reject', 'return_rma', 'returns:approve', ['id', 'reason']],
  ['returns:record_receipt', 'return_rma', 'returns:write', ['id']],
  ['returns:record_inspection', 'return_rma', 'returns:write', ['id', 'condition', 'passes']],
  ['returns:record_disposition', 'return_rma', 'returns:approve', ['id', 'disposition']],
  ['returns:rma_close', 'return_rma', 'returns:approve', ['id']],
];

function registerModule(db, now) {
  db.prepare(`
    INSERT INTO platform_modules (
      id, name, version, status, kind, owner, dependencies, optional_dependencies,
      capabilities, migrations, settings, created_at, updated_at
    ) VALUES (?, ?, '1.0.0', 'enabled', 'standard', 'operations', ?, '[]', ?, ?, '{}', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      version = excluded.version,
      status = excluded.status,
      dependencies = excluded.dependencies,
      capabilities = excluded.capabilities,
      migrations = excluded.migrations,
      updated_at = excluded.updated_at
  `).run(
    RETURNS_MODULE, 'Returns / RMA / Repair / Warranty',
    JSON.stringify(['platform_kernel', 'commercial_core']),
    JSON.stringify(['returns.rma', 'returns.warranty']),
    JSON.stringify([migrationIdSelf]),
    now, now,
  );

  const companies = db.prepare('SELECT id FROM platform_companies').all();
  const insertAssignment = db.prepare(`
    INSERT INTO platform_module_assignments (
      id, module_id, scope_type, scope_id, enabled, navigation_visible,
      configuration_url, configuration_status, version, created_at, updated_at, updated_by
    ) VALUES (?, ?, 'company', ?, 1, 1, ?, 'ready', 1, ?, ?, 'migration:084')
    ON CONFLICT(module_id, scope_type, scope_id) DO NOTHING
  `);
  for (const company of companies) {
    insertAssignment.run(`pma_${RETURNS_MODULE}_${company.id}`, RETURNS_MODULE, company.id, `/${RETURNS_MODULE}`, now, now);
  }
}

export const migration = {
  id: migrationIdSelf,
  owner: MODULE_ID,
  version: '1.37.0',
  parent: '083_final_page_catalog_registry',
  dependsOn: ['083_final_page_catalog_registry'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Clean-room implementation, orchestrating existing canonical Inventory/Quality/Finance/Procurement/WorkItem authorities.',

  up(db) {
    const now = new Date().toISOString();

    db.exec(`
      CREATE TABLE IF NOT EXISTS returns_rma (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        branch_id TEXT,
        rma_number TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'customer_return'
          CHECK(source_type IN ('customer_return','supplier_return','internal')),
        customer_id TEXT,
        customer_name TEXT NOT NULL DEFAULT '',
        supplier_id TEXT,
        source_document_id TEXT,
        source_document_number TEXT NOT NULL DEFAULT '',
        purchase_order_id TEXT,
        warehouse_id TEXT,
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN (
          'draft','submitted','under_review','approved','awaiting_receipt',
          'received','under_inspection','disposition_pending','resolved',
          'closed','rejected','cancelled','blocked'
        )),
        disposition TEXT CHECK(disposition IS NULL OR disposition IN (
          'repair','replace','refund','return_to_supplier','refurbish','scrap'
        )),
        inspection_condition TEXT,
        inspection_notes TEXT NOT NULL DEFAULT '',
        ncr_id TEXT,
        work_item_id TEXT,
        credit_note_document_id TEXT,
        supplier_return_id TEXT,
        receipt_picking_id TEXT,
        blocked_reason TEXT,
        created_by TEXT NOT NULL,
        assigned_to TEXT,
        notes TEXT NOT NULL DEFAULT '',
        idempotency_key TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, rma_number)
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS ux_returns_rma_idempotency
        ON returns_rma(company_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_returns_rma_company_status ON returns_rma(company_id, status);
      CREATE INDEX IF NOT EXISTS idx_returns_rma_customer ON returns_rma(company_id, customer_id);

      CREATE TABLE IF NOT EXISTS returns_rma_lines (
        id TEXT PRIMARY KEY,
        rma_id TEXT NOT NULL REFERENCES returns_rma(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL,
        product_name TEXT NOT NULL,
        qty_requested REAL NOT NULL CHECK(qty_requested > 0),
        qty_received REAL NOT NULL DEFAULT 0.0 CHECK(qty_received >= 0),
        unit_price REAL NOT NULL DEFAULT 0.0 CHECK(unit_price >= 0),
        reason TEXT NOT NULL DEFAULT '',
        serial_number TEXT NOT NULL DEFAULT '',
        condition TEXT,
        disposition TEXT,
        purchase_order_line_id TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_returns_rma_lines_rma ON returns_rma_lines(rma_id);

      CREATE TABLE IF NOT EXISTS returns_rma_timeline (
        id TEXT PRIMARY KEY,
        rma_id TEXT NOT NULL REFERENCES returns_rma(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_returns_rma_timeline_rma ON returns_rma_timeline(rma_id, created_at);
    `);

    registerModule(db, now);

    const insertEntity = db.prepare(`
      INSERT INTO platform_entities (
        id, module_id, storage_owner, primary_key, label_ar, label_en, section,
        chatter, fields, relations, scope, lifecycle_policy, query_policy,
        action_policy, customization_policy, history_policy, api_exposed,
        migration_owner, created_at, updated_at
      ) VALUES (?, ?, ?, 'id', ?, ?, 'operations', 1, '{}', '{}', 'company',
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
        'platform_action_executor', 'supported', 'none', 'required', 'required',
        NULL, NULL, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        module_id = excluded.module_id,
        entity_id = excluded.entity_id,
        required_permission = excluded.required_permission,
        input_schema = excluded.input_schema,
        idempotency_policy = excluded.idempotency_policy,
        updated_at = excluded.updated_at
    `);
    const errorContract = JSON.stringify({
      envelope: 'stable',
      rollback: 'atomic',
      codes: ['MISSING_CUSTOMER', 'EMPTY_LINES', 'INVALID_LINE', 'INVALID_QUANTITY', 'RMA_NOT_FOUND', 'INVALID_STATE', 'INVALID_DISPOSITION'],
    });
    for (const [actionId, entityId, permission, required] of ACTIONS) {
      insertAction.run(
        actionId, RETURNS_MODULE, entityId, permission,
        JSON.stringify({ type: 'object', required }),
        errorContract, now, now,
      );
    }
  },

  down(db) {
    const deleteAction = db.prepare('DELETE FROM platform_actions WHERE id = ?');
    for (const [actionId] of ACTIONS) deleteAction.run(actionId);
    const deleteEntity = db.prepare('DELETE FROM platform_entities WHERE id = ?');
    for (const [id] of ENTITIES) deleteEntity.run(id);

    db.prepare('DELETE FROM platform_module_assignments WHERE module_id = ?').run(RETURNS_MODULE);
    db.prepare('DELETE FROM platform_modules WHERE id = ?').run(RETURNS_MODULE);

    db.exec(`
      DROP TABLE IF EXISTS returns_rma_timeline;
      DROP TABLE IF EXISTS returns_rma_lines;
      DROP TABLE IF EXISTS returns_rma;
    `);
  },
};
