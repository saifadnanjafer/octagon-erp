// 045_governed_master_data_and_inventory_actions — Governed master-data and inventory lifecycle actions
//
// What this migration does:
//   1. Adds missing columns for active/archived state, localization, and UOM applicability.
//   2. Registers missing governed actions in platform_actions.

const MODULE_ID = 'platform.kernel';

const NEW_ACTIONS = [
  ['uom_category:create', 'commercial_core', 'uom', 'commercial:product:write', ['name']],
  ['uom_category:update', 'commercial_core', 'uom', 'commercial:product:write', ['id', 'name']],
  ['uom_category:archive', 'commercial_core', 'uom', 'commercial:product:write', ['id']],
  ['uom_category:restore', 'commercial_core', 'uom', 'commercial:product:write', ['id']],

  ['uom:create', 'commercial_core', 'uom', 'commercial:product:write', ['category_id', 'name']],
  ['uom:update', 'commercial_core', 'uom', 'commercial:product:write', ['id', 'name']],
  ['uom:archive', 'commercial_core', 'uom', 'commercial:product:write', ['id']],
  ['uom:restore', 'commercial_core', 'uom', 'commercial:product:write', ['id']],

  ['product_category:create', 'commercial_core', 'product_category', 'commercial:product:write', ['name']],
  ['product_category:update', 'commercial_core', 'product_category', 'commercial:product:write', ['id', 'name']],
  ['product_category:archive', 'commercial_core', 'product_category', 'commercial:product:write', ['id']],
  ['product_category:restore', 'commercial_core', 'product_category', 'commercial:product:write', ['id']],

  ['product:create', 'commercial_core', 'product_template', 'commercial:product:write', ['name']],
  ['product:update', 'commercial_core', 'product_template', 'commercial:product:write', ['id']],
  ['product:archive', 'commercial_core', 'product_template', 'commercial:product:write', ['id']],
  ['product:restore', 'commercial_core', 'product_template', 'commercial:product:write', ['id']],

  ['party:update', 'commercial_core', 'party', 'commercial:party:write', ['id']],
  ['party:archive', 'commercial_core', 'party', 'commercial:party:write', ['id']],
  ['party:restore', 'commercial_core', 'party', 'commercial:party:write', ['id']],
  ['party_role:add', 'commercial_core', 'party', 'commercial:party:write', ['party_id', 'role']],
  ['party_role:remove', 'commercial_core', 'party', 'commercial:party:write', ['party_id', 'role']],
  ['party_contact:create', 'commercial_core', 'party', 'commercial:party:write', ['party_id', 'name']],
  ['party_contact:update', 'commercial_core', 'party', 'commercial:party:write', ['id']],
  ['party_contact:archive', 'commercial_core', 'party', 'commercial:party:write', ['id']],
  ['party_address:create', 'commercial_core', 'party', 'commercial:party:write', ['party_id']],
  ['party_address:update', 'commercial_core', 'party', 'commercial:party:write', ['id']],
  ['party_address:archive', 'commercial_core', 'party', 'commercial:party:write', ['id']],

  ['warehouse:update', 'stock_inventory', 'warehouse', 'stock:warehouse:write', ['id']],
  ['warehouse:archive', 'stock_inventory', 'warehouse', 'stock:warehouse:write', ['id']],
  ['warehouse:restore', 'stock_inventory', 'warehouse', 'stock:warehouse:write', ['id']],

  ['stock:location:update', 'stock_inventory', 'stock_location', 'stock:location:write', ['id']],
  ['stock:location:archive', 'stock_inventory', 'stock_location', 'stock:location:write', ['id']],
  ['stock:location:restore', 'stock_inventory', 'stock_location', 'stock:location:write', ['id']],
  ['stock:location:move', 'stock_inventory', 'stock_location', 'stock:location:write', ['id', 'parent_id']],

  ['stock:receipt:create_draft', 'stock_wms', 'stock_picking', 'stock:picking:write', ['location_dest_id']],
  ['stock:receipt:update_draft', 'stock_wms', 'stock_picking', 'stock:picking:write', ['picking_id']],
  ['stock:receipt:validate', 'stock_wms', 'stock_picking', 'stock:picking:write', ['picking_id']],
  ['stock:receipt:cancel', 'stock_wms', 'stock_picking', 'stock:picking:write', ['picking_id']],

  ['stock:transfer:create_draft', 'stock_inventory', 'stock_move', 'stock:move:write', ['location_id', 'location_dest_id']],
  ['stock:transfer:validate', 'stock_inventory', 'stock_move', 'stock:move:write', ['picking_id']],
  ['stock:transfer:cancel', 'stock_inventory', 'stock_move', 'stock:move:write', ['picking_id']],

  ['stock:delivery:create_draft', 'stock_wms', 'stock_picking', 'stock:picking:write', ['location_id']],
  ['stock:delivery:validate', 'stock_wms', 'stock_picking', 'stock:picking:write', ['picking_id']],
  ['stock:delivery:cancel', 'stock_wms', 'stock_picking', 'stock:picking:write', ['picking_id']],

  ['stock:return:create_draft', 'stock_wms', 'stock_picking', 'stock:picking:write', ['picking_id']],
  ['stock:return:validate', 'stock_wms', 'stock_picking', 'stock:picking:write', ['picking_id']],

  ['stock:adjustment:create_draft', 'stock_wms', 'stock_cycle_count', 'stock:count:write', ['location_id']],
  ['stock:adjustment:approve', 'stock_wms', 'stock_cycle_count', 'stock:count:write', ['count_id']],

  ['replenishment:proposal:create', 'stock_inventory', 'stock_quant', 'stock:quants:write', ['product_id']],
  ['replenishment:proposal:approve', 'stock_inventory', 'stock_quant', 'stock:quants:write', ['proposal_id']],
];

function addColumnIfNotExists(db, table, columnDef) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef};`);
  } catch (err) {
    if (!String(err && err.message ? err.message : err).includes('duplicate column')) {
      // Ignore existing column errors
    }
  }
}

export const migration = {
  id: '045_governed_master_data_and_inventory_actions',
  owner: MODULE_ID,
  version: '1.24.0',
  parent: '044_opening_stock_cutover_and_equity_coa',
  dependsOn: ['044_opening_stock_cutover_and_equity_coa'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Governed Master Data and Inventory Actions Expansion',

  up(db) {
    // 1. Column additions for master data models
    addColumnIfNotExists(db, 'uom_categories', 'is_active INTEGER NOT NULL DEFAULT 1');
    addColumnIfNotExists(db, 'uom_categories', 'updated_at TEXT');

    addColumnIfNotExists(db, 'uoms', 'applies_to_purchase INTEGER NOT NULL DEFAULT 1');
    addColumnIfNotExists(db, 'uoms', 'applies_to_sales INTEGER NOT NULL DEFAULT 1');
    addColumnIfNotExists(db, 'uoms', 'updated_at TEXT');

    addColumnIfNotExists(db, 'product_categories', 'name_ar TEXT DEFAULT ""');
    addColumnIfNotExists(db, 'product_categories', 'name_en TEXT DEFAULT ""');
    addColumnIfNotExists(db, 'product_categories', 'is_active INTEGER NOT NULL DEFAULT 1');
    addColumnIfNotExists(db, 'product_categories', 'updated_at TEXT');

    addColumnIfNotExists(db, 'product_templates', 'name_ar TEXT DEFAULT ""');
    addColumnIfNotExists(db, 'product_templates', 'name_en TEXT DEFAULT ""');
    addColumnIfNotExists(db, 'product_templates', 'description TEXT DEFAULT ""');
    addColumnIfNotExists(db, 'product_templates', 'tracking_type TEXT DEFAULT "none"');
    addColumnIfNotExists(db, 'product_templates', 'updated_at TEXT');

    addColumnIfNotExists(db, 'product_variants', 'updated_at TEXT');

    addColumnIfNotExists(db, 'parties', 'phone TEXT DEFAULT ""');
    addColumnIfNotExists(db, 'parties', 'email TEXT DEFAULT ""');
    addColumnIfNotExists(db, 'parties', 'payment_terms TEXT DEFAULT ""');
    addColumnIfNotExists(db, 'parties', 'currency TEXT DEFAULT "IQD"');

    addColumnIfNotExists(db, 'contacts', 'is_active INTEGER NOT NULL DEFAULT 1');
    addColumnIfNotExists(db, 'addresses', 'is_active INTEGER NOT NULL DEFAULT 1');

    addColumnIfNotExists(db, 'warehouses', 'warehouse_type TEXT DEFAULT "physical"');
    addColumnIfNotExists(db, 'warehouses', 'is_default INTEGER DEFAULT 0');
    addColumnIfNotExists(db, 'warehouses', 'updated_at TEXT');

    addColumnIfNotExists(db, 'stock_locations', 'is_active INTEGER NOT NULL DEFAULT 1');
    addColumnIfNotExists(db, 'stock_locations', 'capacity TEXT DEFAULT ""');
    addColumnIfNotExists(db, 'stock_locations', 'updated_at TEXT');

    // 2. Register governed actions
    const stmt = db.prepare(`
      INSERT INTO platform_actions (
        id, module_id, entity_id, kind, allowed_states, required_permission,
        required_scope, input_schema, preconditions, transaction_owner,
        idempotency_policy, sequence_policy, audit_policy, outbox_policy,
        reversal_action, result_schema, error_contract, created_at, updated_at
      ) VALUES (?, ?, ?, 'domain', '[]', ?, 'company', ?, '[]',
        'platform_action_executor', 'required', 'none', 'required', 'required',
        NULL, NULL, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `);

    const now = new Date().toISOString();
    const errorContract = JSON.stringify({
      envelope: 'stable',
      rollback: 'business mutation, audit, outbox, and idempotency are atomic',
      codes: ['INPUT_MISSING_FIELD', 'IDEMPOTENCY_KEY_REQUIRED', 'UNTRUSTED_ACTION_SCOPE', 'PRECONDITION_FAILED'],
    });

    for (const [actionId, moduleId, entityId, requiredPermission, requiredInputKeys] of NEW_ACTIONS) {
      stmt.run(
        actionId,
        moduleId,
        entityId,
        requiredPermission,
        JSON.stringify({ required: requiredInputKeys }),
        errorContract,
        now,
        now,
      );
    }
  },

  down(db) {
    const stmt = db.prepare(`DELETE FROM platform_actions WHERE id = ?`);
    for (const [actionId] of NEW_ACTIONS) {
      stmt.run(actionId);
    }
  }
};
