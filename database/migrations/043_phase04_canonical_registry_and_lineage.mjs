// Phase 04 canonical registry, traceability, and work-governance closure.
//
// This is intentionally a new migration. It does not rewrite any migration
// that may already have been applied to a disposable or review database.

const MODULES = [
  ['commercial_core', 'Commercial Core', ['parties', 'products', 'uom', 'pricing']],
  ['stock_inventory', 'Inventory', ['warehouses', 'locations', 'ledger', 'valuation', 'reservations']],
  ['stock_wms', 'Warehouse Management', ['pickings', 'counts', 'lots', 'serials', 'landed_cost']],
  ['commercial_sales', 'Sales', ['crm', 'quotations', 'orders', 'contracts', 'commissions']],
  ['commercial_procurement', 'Procurement', ['requisitions', 'rfq', 'orders', 'three_way_match']],
  ['commercial_cutover', 'Point of Sale', ['pos', 'commercial_cutover']],
  ['work_item_canonical', 'Work Items', ['tasks', 'dependencies', 'watchers', 'approvals']],
];

const ENTITIES = [
  ['party', 'commercial_core', 'platform.commercial', 'Party'],
  ['uom', 'commercial_core', 'platform.commercial', 'Unit of Measure'],
  ['product_template', 'commercial_core', 'platform.commercial', 'Product Template'],
  ['product_variant', 'commercial_core', 'platform.commercial', 'Product Variant'],
  ['price_list', 'commercial_core', 'platform.commercial', 'Price List'],
  ['warehouse', 'stock_inventory', 'platform.inventory', 'Warehouse'],
  ['stock_location', 'stock_inventory', 'platform.inventory', 'Stock Location'],
  ['stock_move', 'stock_inventory', 'platform.inventory', 'Stock Move'],
  ['stock_quant', 'stock_inventory', 'platform.inventory', 'Stock Balance'],
  ['stock_reservation', 'stock_inventory', 'platform.inventory', 'Stock Reservation'],
  ['stock_lot', 'stock_wms', 'platform.wms', 'Stock Lot'],
  ['stock_serial', 'stock_wms', 'platform.wms', 'Stock Serial'],
  ['stock_package', 'stock_wms', 'platform.wms', 'Stock Package'],
  ['stock_picking', 'stock_wms', 'platform.wms', 'Stock Picking'],
  ['stock_cycle_count', 'stock_wms', 'platform.wms', 'Cycle Count'],
  ['landed_cost', 'stock_wms', 'platform.wms', 'Landed Cost'],
  ['commercial_crm_lead', 'commercial_sales', 'platform.sales', 'CRM Lead'],
  ['sale_order', 'commercial_sales', 'platform.sales', 'Sales Order'],
  ['purchase_requisition', 'commercial_procurement', 'platform.procurement', 'Purchase Requisition'],
  ['purchase_rfq', 'commercial_procurement', 'platform.procurement', 'Request for Quotation'],
  ['purchase_order', 'commercial_procurement', 'platform.procurement', 'Purchase Order'],
  ['three_way_match', 'commercial_procurement', 'platform.procurement', 'Three Way Match'],
  ['pos_session', 'commercial_cutover', 'platform.pos', 'POS Session'],
  ['pos_order', 'commercial_cutover', 'platform.pos', 'POS Order'],
  ['work_item', 'work_item_canonical', 'platform.work_items', 'Work Item'],
];

const ACTIONS = [
  ['party:create', 'commercial_core', 'party', 'commercial:party:write', ['name']],
  ['uom:create', 'commercial_core', 'uom', 'commercial:product:write', ['category_id', 'name']],
  ['product:template:create', 'commercial_core', 'product_template', 'commercial:product:write', ['name']],
  ['product:variant:create', 'commercial_core', 'product_variant', 'commercial:product:write', ['template_id', 'sku', 'name']],
  ['pricing:list:create', 'commercial_core', 'price_list', 'commercial:pricing:write', ['name']],
  ['warehouse:create', 'stock_inventory', 'warehouse', 'stock:warehouse:write', ['name', 'code']],
  ['stock:location:create', 'stock_inventory', 'stock_location', 'stock:location:write', ['name']],
  ['stock:move:post', 'stock_inventory', 'stock_move', 'stock:move:write', ['reference', 'product_id', 'uom_id', 'product_qty', 'location_id', 'location_dest_id']],
  ['stock:quants:rebuild', 'stock_inventory', 'stock_quant', 'stock:quants:write', []],
  ['stock:reservation:reserve', 'stock_inventory', 'stock_reservation', 'stock:reservation:write', ['warehouse_id', 'location_id', 'product_id', 'source_document_type', 'source_document_id', 'quantity']],
  ['stock:reservation:release', 'stock_inventory', 'stock_reservation', 'stock:reservation:write', ['reservation_id']],
  ['stock:reservation:expire', 'stock_inventory', 'stock_reservation', 'stock:reservation:write', ['reservation_id']],
  ['stock:reservation:reallocate', 'stock_inventory', 'stock_reservation', 'stock:reservation:write', ['reservation_id', 'warehouse_id', 'location_id']],
  ['stock:reservation:consume', 'stock_inventory', 'stock_reservation', 'stock:reservation:write', ['reservation_id', 'quantity']],
  ['stock:reservation:reverse', 'stock_inventory', 'stock_reservation', 'stock:reservation:write', ['reservation_id', 'quantity']],
  ['stock:lot:create', 'stock_wms', 'stock_lot', 'stock:traceability:write', ['product_id', 'lot_number']],
  ['stock:serial:create', 'stock_wms', 'stock_serial', 'stock:traceability:write', ['product_id', 'serial_number']],
  ['stock:package:create', 'stock_wms', 'stock_package', 'stock:traceability:write', ['name']],
  ['wms:picking:create', 'stock_wms', 'stock_picking', 'stock:picking:write', ['picking_type_id', 'reference', 'location_id', 'location_dest_id']],
  ['wms:picking:validate', 'stock_wms', 'stock_picking', 'stock:picking:write', ['picking_id']],
  ['wms:cyclecount:create', 'stock_wms', 'stock_cycle_count', 'stock:count:write', ['name', 'location_id']],
  ['wms:cyclecount:post', 'stock_wms', 'stock_cycle_count', 'stock:count:write', ['count_id']],
  ['wms:landedcost:create', 'stock_wms', 'landed_cost', 'stock:landedcost:write', ['name']],
  ['wms:landedcost:post', 'stock_wms', 'landed_cost', 'stock:landedcost:write', ['landed_cost_id']],
  ['crm:lead:create', 'commercial_sales', 'commercial_crm_lead', 'crm:lead:write', ['name']],
  ['crm:lead:update_stage', 'commercial_sales', 'commercial_crm_lead', 'crm:lead:write', ['id', 'stage']],
  ['sales:quotation:create', 'commercial_sales', 'sale_order', 'sales:order:write', ['partner_id']],
  ['sales:order:confirm', 'commercial_sales', 'sale_order', 'sales:order:write', ['order_id', 'warehouse_id']],
  ['sales:invoice_request:create', 'commercial_sales', 'sale_order', 'sales:invoice:write', ['order_id']],
  ['procurement:requisition:create', 'commercial_procurement', 'purchase_requisition', 'purchase:requisition:write', ['name']],
  ['procurement:rfq:create', 'commercial_procurement', 'purchase_rfq', 'purchase:rfq:write', ['name']],
  ['procurement:order:create', 'commercial_procurement', 'purchase_order', 'purchase:order:write', ['supplier_id']],
  ['procurement:order:confirm', 'commercial_procurement', 'purchase_order', 'purchase:order:write', ['order_id', 'warehouse_id']],
  ['procurement:threewaymatch:perform', 'commercial_procurement', 'three_way_match', 'purchase:match:write', ['purchase_order_id']],
  ['procurement:bill_request:create', 'commercial_procurement', 'purchase_order', 'purchase:bill:write', ['purchase_order_id']],
  ['pos:session:open', 'commercial_cutover', 'pos_session', 'pos:session:write', ['cash_shift_id']],
  ['pos:order:process', 'commercial_cutover', 'pos_order', 'pos:order:write', ['session_id', 'warehouse_id', 'lines', 'payments']],
  ['pos:session:close', 'commercial_cutover', 'pos_session', 'pos:session:write', ['session_id', 'counted_amount']],
  ['work_item:create', 'work_item_canonical', 'work_item', 'task:write', ['title']],
  ['work_item:update', 'work_item_canonical', 'work_item', 'task:write', ['id']],
  ['work_item:delete', 'work_item_canonical', 'work_item', 'task:write', ['id']],
  ['work_item:approve', 'work_item_canonical', 'work_item', 'task:approve', ['approval_id', 'decision']],
];

export const migration = {
  id: '043_phase04_canonical_registry_and_lineage',
  owner: 'platform.kernel',
  version: '1.23.0',
  dependsOn: ['042_canonical_work_item_and_authority_retirement'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Independent Phase 04 remediation: canonical module/entity/action registry plus stock and work-item lineage',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS stock_lots (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        lot_number TEXT NOT NULL,
        manufactured_at TEXT,
        expires_at TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        UNIQUE(company_id, product_id, lot_number)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS warehouse_branch_scopes (
        warehouse_id TEXT PRIMARY KEY REFERENCES warehouses(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(company_id, branch_id, warehouse_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS stock_serials (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        serial_number TEXT NOT NULL,
        lot_id TEXT REFERENCES stock_lots(id),
        status TEXT NOT NULL DEFAULT 'available',
        created_at TEXT NOT NULL,
        UNIQUE(company_id, serial_number)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS stock_move_lines (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        move_id TEXT NOT NULL REFERENCES stock_moves(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        lot_id TEXT REFERENCES stock_lots(id),
        serial_id TEXT REFERENCES stock_serials(id),
        package_id TEXT REFERENCES stock_packages(id),
        source_document_type TEXT,
        source_document_id TEXT,
        source_line_id TEXT,
        quantity REAL NOT NULL CHECK(quantity > 0),
        uom_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        reversal_of_line_id TEXT REFERENCES stock_move_lines(id),
        created_at TEXT NOT NULL,
        UNIQUE(company_id, idempotency_key)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS stock_reservation_events (
        id TEXT PRIMARY KEY,
        reservation_id TEXT NOT NULL REFERENCES stock_reservations(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        event_type TEXT NOT NULL CHECK(event_type IN ('reserved','partially_reserved','released','expired','reallocated','consumed','reversed')),
        quantity REAL NOT NULL CHECK(quantity > 0),
        from_location_id TEXT,
        to_location_id TEXT,
        serial_id TEXT REFERENCES stock_serials(id),
        source_document_type TEXT NOT NULL,
        source_document_id TEXT NOT NULL,
        source_line_id TEXT,
        idempotency_key TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        UNIQUE(company_id, idempotency_key)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS stock_reservation_traceability (
        reservation_id TEXT PRIMARY KEY REFERENCES stock_reservations(id) ON DELETE CASCADE,
        serial_id TEXT REFERENCES stock_serials(id),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS stock_valuation_facts (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        stock_move_id TEXT REFERENCES stock_moves(id),
        fact_type TEXT NOT NULL CHECK(fact_type IN ('receipt','issue','return','adjustment','landed_cost','reversal')),
        quantity REAL NOT NULL,
        unit_cost REAL NOT NULL,
        value REAL NOT NULL,
        costing_method TEXT NOT NULL CHECK(costing_method IN ('avco','fifo')),
        currency TEXT NOT NULL DEFAULT 'IQD',
        reversal_of_fact_id TEXT REFERENCES stock_valuation_facts(id),
        effective_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS stock_fifo_consumptions (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        issue_fact_id TEXT NOT NULL REFERENCES stock_valuation_facts(id) ON DELETE CASCADE,
        receipt_fact_id TEXT NOT NULL REFERENCES stock_valuation_facts(id),
        quantity REAL NOT NULL CHECK(quantity > 0),
        unit_cost REAL NOT NULL,
        value REAL NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(issue_fact_id, receipt_fact_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS landed_cost_allocations (
        id TEXT PRIMARY KEY,
        landed_cost_id TEXT NOT NULL REFERENCES landed_costs(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        receipt_move_id TEXT NOT NULL REFERENCES stock_moves(id),
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        basis_type TEXT NOT NULL,
        basis_value REAL NOT NULL,
        allocated_value REAL NOT NULL,
        valuation_fact_id TEXT NOT NULL REFERENCES stock_valuation_facts(id),
        created_at TEXT NOT NULL,
        UNIQUE(landed_cost_id, receipt_move_id, product_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS stock_accounting_links (
        stock_move_id TEXT PRIMARY KEY REFERENCES stock_moves(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        valuation_fact_id TEXT NOT NULL REFERENCES stock_valuation_facts(id),
        finance_document_id TEXT NOT NULL REFERENCES finance_documents(id),
        accounting_event TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS work_item_dependencies (
        work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
        blocker_work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
        dependency_type TEXT NOT NULL DEFAULT 'blocks',
        created_at TEXT NOT NULL,
        PRIMARY KEY(work_item_id, blocker_work_item_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS work_item_watchers (
        work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(work_item_id, user_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS work_item_approvals (
        id TEXT PRIMARY KEY,
        work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        approver_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
        reason TEXT,
        requested_at TEXT NOT NULL,
        decided_at TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS work_item_governance (
        work_item_id TEXT PRIMARY KEY REFERENCES work_items(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        stable_source_key TEXT,
        recurrence_rule TEXT,
        transparency_projection TEXT NOT NULL DEFAULT '{}',
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, stable_source_key)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS phase04_legacy_migration_runs (
        id TEXT PRIMARY KEY,
        source_path TEXT NOT NULL,
        source_sha256 TEXT NOT NULL,
        source_size INTEGER NOT NULL,
        source_modified_at TEXT NOT NULL,
        disposable_path TEXT NOT NULL,
        disposable_sha256_before TEXT NOT NULL,
        company_id TEXT,
        status TEXT NOT NULL CHECK(status IN ('running','passed','blocked','failed','rolled_back')),
        source_counts_json TEXT NOT NULL DEFAULT '{}',
        result_json TEXT NOT NULL DEFAULT '{}',
        started_at TEXT NOT NULL,
        completed_at TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS phase04_legacy_source_map (
        source_collection TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_sha256 TEXT NOT NULL,
        target_entity TEXT NOT NULL,
        target_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(source_collection, source_id, target_entity),
        UNIQUE(target_entity, target_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS phase04_legacy_quarantine (
        id TEXT PRIMARY KEY,
        source_collection TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_sha256 TEXT NOT NULL,
        reason_code TEXT NOT NULL,
        reason_detail TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','ignored')),
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        UNIQUE(source_collection, source_id, reason_code)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS commercial_finance_line_facts (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        finance_document_id TEXT NOT NULL REFERENCES finance_documents(id) ON DELETE CASCADE,
        source_document_type TEXT NOT NULL,
        source_document_id TEXT NOT NULL,
        source_line_id TEXT NOT NULL,
        product_id TEXT,
        quantity REAL NOT NULL CHECK(quantity > 0),
        fact_state TEXT NOT NULL DEFAULT 'posted' CHECK(fact_state IN ('posted','reversed')),
        created_at TEXT NOT NULL,
        UNIQUE(company_id, finance_document_id, source_line_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS sale_fulfilment_demands (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        sale_order_id TEXT NOT NULL REFERENCES sale_orders(id) ON DELETE CASCADE,
        sale_order_line_id TEXT NOT NULL REFERENCES sale_order_lines(id) ON DELETE CASCADE,
        warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        demanded_quantity REAL NOT NULL CHECK(demanded_quantity > 0),
        reservation_id TEXT REFERENCES stock_reservations(id),
        picking_id TEXT REFERENCES stock_pickings(id),
        status TEXT NOT NULL DEFAULT 'reserved',
        created_at TEXT NOT NULL,
        UNIQUE(company_id, sale_order_line_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS purchase_fulfilment_demands (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
        purchase_order_line_id TEXT NOT NULL REFERENCES purchase_order_lines(id) ON DELETE CASCADE,
        warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        demanded_quantity REAL NOT NULL CHECK(demanded_quantity > 0),
        picking_id TEXT REFERENCES stock_pickings(id),
        status TEXT NOT NULL DEFAULT 'awaiting_receipt',
        created_at TEXT NOT NULL,
        UNIQUE(company_id, purchase_order_line_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS three_way_match_lines (
        id TEXT PRIMARY KEY,
        match_id TEXT NOT NULL REFERENCES three_way_matches(id) ON DELETE CASCADE,
        purchase_order_line_id TEXT NOT NULL REFERENCES purchase_order_lines(id),
        ordered_quantity REAL NOT NULL,
        received_quantity REAL NOT NULL,
        billed_quantity REAL NOT NULL,
        ordered_unit_price REAL NOT NULL,
        billed_unit_price REAL NOT NULL,
        currency TEXT NOT NULL,
        freight REAL NOT NULL DEFAULT 0,
        tolerance REAL NOT NULL DEFAULT 0,
        service_accepted INTEGER NOT NULL DEFAULT 1,
        line_status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(match_id, purchase_order_line_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS three_way_match_exceptions (
        id TEXT PRIMARY KEY,
        match_id TEXT NOT NULL REFERENCES three_way_matches(id) ON DELETE CASCADE,
        purchase_order_line_id TEXT REFERENCES purchase_order_lines(id),
        exception_code TEXT NOT NULL,
        expected_value TEXT,
        actual_value TEXT,
        approval_status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS procurement_match_policies (
        company_id TEXT PRIMARY KEY,
        quantity_tolerance REAL NOT NULL DEFAULT 0,
        price_tolerance REAL NOT NULL DEFAULT 0,
        freight_tolerance REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'IQD',
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS supplier_invoice_registry (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        supplier_id TEXT NOT NULL REFERENCES parties(id),
        supplier_invoice_number TEXT NOT NULL,
        match_id TEXT NOT NULL REFERENCES three_way_matches(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        UNIQUE(company_id, supplier_id, supplier_invoice_number)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS commercial_fiscal_requests (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        request_type TEXT NOT NULL CHECK(request_type IN ('customer_invoice','customer_credit_note','supplier_bill','supplier_debit_note','pos_fiscal')),
        source_document_type TEXT NOT NULL,
        source_document_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        finance_document_id TEXT REFERENCES finance_documents(id),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','posted','failed','reversed')),
        request_payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, request_type, source_document_id),
        UNIQUE(company_id, idempotency_key)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS pos_session_finance_links (
        session_id TEXT PRIMARY KEY REFERENCES pos_sessions(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        cashbox_id TEXT NOT NULL REFERENCES finance_cashboxes(id),
        cash_shift_id TEXT NOT NULL REFERENCES finance_cash_shifts(id),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS pos_payment_method_configs (
        company_id TEXT NOT NULL,
        payment_method_id TEXT NOT NULL,
        gl_account_id TEXT NOT NULL REFERENCES finance_accounts(id),
        active INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(company_id, payment_method_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS pos_product_tax_configs (
        company_id TEXT NOT NULL,
        product_id TEXT NOT NULL REFERENCES product_variants(id),
        tax_id TEXT NOT NULL REFERENCES finance_taxes(id),
        updated_at TEXT NOT NULL,
        PRIMARY KEY(company_id, product_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS pos_order_finance_links (
        pos_order_id TEXT PRIMARY KEY REFERENCES pos_orders(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        finance_document_id TEXT NOT NULL REFERENCES finance_documents(id),
        cash_shift_id TEXT NOT NULL REFERENCES finance_cash_shifts(id),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS pos_order_line_tax_traces (
        pos_order_line_id TEXT PRIMARY KEY REFERENCES pos_order_lines(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        tax_id TEXT,
        pricing_source TEXT NOT NULL,
        tax_quote TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE VIEW IF NOT EXISTS sale_order_line_fulfilment AS
      SELECT
        sol.id AS sale_order_line_id,
        sol.order_id,
        COALESCE(SUM(CASE WHEN sml.source_document_type = 'sale_order' THEN sml.quantity ELSE 0 END), 0) AS delivered_quantity,
        COALESCE((
          SELECT SUM(cff.quantity)
          FROM commercial_finance_line_facts cff
          WHERE cff.source_document_type = 'sale_order'
            AND cff.source_document_id = sol.order_id
            AND cff.source_line_id = sol.id
            AND cff.fact_state = 'posted'
        ), 0) AS invoiced_quantity
      FROM sale_order_lines sol
      LEFT JOIN stock_move_lines sml ON sml.source_line_id = sol.id
      GROUP BY sol.id, sol.order_id;

      CREATE VIEW IF NOT EXISTS purchase_order_line_fulfilment AS
      SELECT
        pol.id AS purchase_order_line_id,
        pol.order_id,
        COALESCE(SUM(CASE WHEN sml.source_document_type = 'purchase_order' THEN sml.quantity ELSE 0 END), 0) AS received_quantity,
        COALESCE((
          SELECT SUM(cff.quantity)
          FROM commercial_finance_line_facts cff
          WHERE cff.source_document_type = 'purchase_order'
            AND cff.source_document_id = pol.order_id
            AND cff.source_line_id = pol.id
            AND cff.fact_state = 'posted'
        ), 0) AS billed_quantity
      FROM purchase_order_lines pol
      LEFT JOIN stock_move_lines sml ON sml.source_line_id = pol.id
      GROUP BY pol.id, pol.order_id;
    `);

    const now = new Date().toISOString();
    db.prepare(`
      INSERT OR IGNORE INTO procurement_match_policies (
        company_id, quantity_tolerance, price_tolerance,
        freight_tolerance, currency, updated_at
      ) VALUES ('default', 0, 0, 0, 'IQD', ?)
    `).run(now);
    const insertModule = db.prepare(`
      INSERT INTO platform_modules (
        id, name, version, status, kind, owner, dependencies, optional_dependencies,
        capabilities, migrations, settings, created_at, updated_at
      ) VALUES (?, ?, '1.23.0', 'enabled', 'standard', 'octagon', ?, '[]', ?, ?, '[]', ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        version = excluded.version,
        status = excluded.status,
        capabilities = excluded.capabilities,
        migrations = excluded.migrations,
        updated_at = excluded.updated_at
    `);
    for (const [id, name, capabilities] of MODULES) {
      insertModule.run(
        id,
        name,
        JSON.stringify(['platform_kernel']),
        JSON.stringify(capabilities),
        JSON.stringify(['043_phase04_canonical_registry_and_lineage']),
        now,
        now,
      );
    }
    db.prepare(`
      INSERT INTO platform_feature_flags (
        key, module_id, scope, enabled, audit_policy, created_at, updated_at
      ) VALUES (
        'phase04.canonical_cutover', 'commercial_core', 'global', 0,
        'required', ?, ?
      ) ON CONFLICT(key) DO NOTHING
    `).run(now, now);

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
        required_permission = excluded.required_permission,
        required_scope = excluded.required_scope,
        input_schema = excluded.input_schema,
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
    for (const [id, moduleId, entityId, permission, required] of ACTIONS) {
      insertAction.run(
        id,
        moduleId,
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
    const actionIds = ACTIONS.map(([id]) => id);
    const deleteAction = db.prepare('DELETE FROM platform_actions WHERE id = ?');
    for (const id of actionIds) deleteAction.run(id);
    const deleteEntity = db.prepare('DELETE FROM platform_entities WHERE id = ?');
    for (const [id] of ENTITIES) deleteEntity.run(id);
    db.prepare("DELETE FROM platform_feature_flags WHERE key = 'phase04.canonical_cutover'").run();
    const deleteModule = db.prepare('DELETE FROM platform_modules WHERE id = ?');
    for (const [id] of MODULES.slice().reverse()) deleteModule.run(id);

    db.exec(`
      DROP VIEW IF EXISTS purchase_order_line_fulfilment;
      DROP VIEW IF EXISTS sale_order_line_fulfilment;
      DROP TABLE IF EXISTS pos_order_finance_links;
      DROP TABLE IF EXISTS pos_order_line_tax_traces;
      DROP TABLE IF EXISTS pos_product_tax_configs;
      DROP TABLE IF EXISTS pos_payment_method_configs;
      DROP TABLE IF EXISTS pos_session_finance_links;
      DROP TABLE IF EXISTS commercial_fiscal_requests;
      DROP TABLE IF EXISTS supplier_invoice_registry;
      DROP TABLE IF EXISTS procurement_match_policies;
      DROP TABLE IF EXISTS three_way_match_exceptions;
      DROP TABLE IF EXISTS three_way_match_lines;
      DROP TABLE IF EXISTS purchase_fulfilment_demands;
      DROP TABLE IF EXISTS sale_fulfilment_demands;
      DROP TABLE IF EXISTS commercial_finance_line_facts;
      DROP TABLE IF EXISTS work_item_governance;
      DROP TABLE IF EXISTS work_item_approvals;
      DROP TABLE IF EXISTS work_item_watchers;
      DROP TABLE IF EXISTS work_item_dependencies;
      DROP TABLE IF EXISTS phase04_legacy_quarantine;
      DROP TABLE IF EXISTS phase04_legacy_source_map;
      DROP TABLE IF EXISTS phase04_legacy_migration_runs;
      DROP TABLE IF EXISTS stock_accounting_links;
      DROP TABLE IF EXISTS landed_cost_allocations;
      DROP TABLE IF EXISTS stock_fifo_consumptions;
      DROP TABLE IF EXISTS stock_valuation_facts;
      DROP TABLE IF EXISTS stock_reservation_traceability;
      DROP TABLE IF EXISTS stock_reservation_events;
      DROP TABLE IF EXISTS stock_move_lines;
      DROP TABLE IF EXISTS warehouse_branch_scopes;
      DROP TABLE IF EXISTS stock_serials;
      DROP TABLE IF EXISTS stock_lots;
    `);
  },
};
