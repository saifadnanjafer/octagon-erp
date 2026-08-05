// Disposable REVIEW-ONLY fixture rows for the Manufacturing / Shop-floor
// feature surface. Every id is prefixed `rev_`, every name/description is
// obviously fictional ("[DEMO] ..."), and every insert is
// `ON CONFLICT(id) DO NOTHING` so this is safe to call more than once
// against the same disposable review database.
//
// Table sources (read from migration source, never guessed — STRICT sqlite
// tables reject wrong types/columns):
//   - uom_categories / uoms / product_templates / product_variants
//       -> database/migrations/036_party_product_uom_pricing_foundation.mjs
//   - warehouses
//       -> database/migrations/037_warehouse_stock_ledger_valuation.mjs
//   - work_centers / boms / bom_versions / bom_lines
//       -> database/migrations/053_engineering_bom_routing_mrp.mjs
//   - mfg_production_orders / mfg_material_requirements
//       -> database/migrations/054_mrp_and_manufacturing_orders.mjs
//   - mfg_work_orders / mfg_material_issues
//       -> database/migrations/055_work_orders_shop_floor_and_production_cost.mjs
//   - mfg_shopfloor_sessions / mfg_shopfloor_events /
//     mfg_material_flow_requests / mfg_downtime_events
//       -> database/migrations/079_build09_shopfloor_material_performance.mjs
//
// Reference rows (product, warehouse) reuse the same `rev_` ids as
// scripts/review/fixtures/quality.mjs on purpose: both files can be run
// independently or together against the same disposable database and the
// demo data stays coherent either way.

const REVIEWER = 'rev_user_reviewer';

/**
 * @param {{prepare: Function}} dialect - synchronous `prepare(sql).run(...)` dialect.
 * @param {{tenantId?: string, companyId: string, branchId?: string, now?: string}} ctx
 */
export async function seedProductionFixtures(dialect, { companyId, branchId, now } = {}) {
  if (!dialect || typeof dialect.prepare !== 'function') {
    throw new Error('seedProductionFixtures requires a database dialect with prepare()');
  }
  if (!companyId) {
    throw new Error('seedProductionFixtures requires companyId');
  }
  const ts = now || new Date().toISOString();
  const branch = branchId || null;

  // ---- Minimum reference data needed to satisfy STRICT foreign keys ----
  dialect.prepare(`INSERT INTO uom_categories (id, name, created_at)
    VALUES ('rev_uomcat_each', '[DEMO] Each', ?) ON CONFLICT(id) DO NOTHING`).run(ts);
  dialect.prepare(`INSERT INTO uoms (id, category_id, name, symbol, uom_type, factor, rounding, is_active, created_at)
    VALUES ('rev_uom_each', 'rev_uomcat_each', '[DEMO] Each', 'ea', 'reference', 1.0, 1.0, 1, ?)
    ON CONFLICT(id) DO NOTHING`).run(ts);

  const insertTemplate = dialect.prepare(`INSERT INTO product_templates
    (id, company_id, name, code, type, category_id, uom_id, list_price, standard_price, is_active, created_at)
    VALUES (?, ?, ?, ?, 'storable', '', 'rev_uom_each', 0, ?, 1, ?) ON CONFLICT(id) DO NOTHING`);
  insertTemplate.run('rev_tmpl_finished', companyId, '[DEMO] Steel Frame Assembly', 'DEMO-TMPL-SF', 450000, ts);
  insertTemplate.run('rev_tmpl_component', companyId, '[DEMO] Steel Tube Raw Stock', 'DEMO-TMPL-TUBE', 18000, ts);

  const insertVariant = dialect.prepare(`INSERT INTO product_variants
    (id, template_id, company_id, sku, name, standard_price, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?) ON CONFLICT(id) DO NOTHING`);
  insertVariant.run('rev_prod_finished', 'rev_tmpl_finished', companyId, 'DEMO-SF-100', '[DEMO] Steel Frame Assembly', 450000, ts);
  insertVariant.run('rev_prod_component', 'rev_tmpl_component', companyId, 'DEMO-TUBE-01', '[DEMO] Steel Tube Raw Stock', 18000, ts);

  dialect.prepare(`INSERT INTO warehouses (id, company_id, name, code, is_active, created_at)
    VALUES ('rev_warehouse_main', ?, '[DEMO] Review Main Warehouse', 'DEMO-WH', 1, ?) ON CONFLICT(id) DO NOTHING`)
    .run(companyId, ts);

  dialect.prepare(`INSERT INTO work_centers
    (id, company_id, code, name_ar, name_en, capacity_per_hour, efficiency_percent, working_hours_per_day, is_active, created_at, updated_at)
    VALUES ('rev_wc_assembly', ?, 'DEMO-WC-ASM', '[DEMO] محطة التجميع', '[DEMO] Assembly Work Center', 4.0, 90.0, 8.0, 1, ?, ?)
    ON CONFLICT(id) DO NOTHING`).run(companyId, ts, ts);

  dialect.prepare(`INSERT INTO boms (id, company_id, code, product_id, name_en, bom_type, uom_id, is_active, created_at, updated_at)
    VALUES ('rev_bom_steel_frame', ?, 'DEMO-BOM-SF', 'rev_prod_finished', '[DEMO] Steel Frame Assembly BOM', 'manufacturing', 'rev_uom_each', 1, ?, ?)
    ON CONFLICT(id) DO NOTHING`).run(companyId, ts, ts);

  dialect.prepare(`INSERT INTO bom_versions (id, company_id, bom_id, revision, quantity, state, approved_by, approved_at, created_at, updated_at)
    VALUES ('rev_bomver_steel_frame_v1', ?, 'rev_bom_steel_frame', 1, 1.0, 'approved', ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`).run(companyId, REVIEWER, ts, ts, ts);

  dialect.prepare(`INSERT INTO bom_lines (id, company_id, bom_version_id, sequence, line_type, component_id, uom_id, quantity, created_at)
    VALUES ('rev_bomline_tube', ?, 'rev_bomver_steel_frame_v1', 10, 'component', 'rev_prod_component', 'rev_uom_each', 4.0, ?)
    ON CONFLICT(id) DO NOTHING`).run(companyId, ts);

  // ---- 1-2 Production Orders ----
  const insertPO = dialect.prepare(`INSERT INTO mfg_production_orders
    (id, company_id, branch_id, order_number, product_id, bom_version_id, planned_quantity, uom_id,
     warehouse_id, wip_location_id, finished_location_id, state, priority, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'rev_prod_finished', 'rev_bomver_steel_frame_v1', ?, 'rev_uom_each',
     'rev_warehouse_main', 'rev_wip_loc_demo', 'rev_fg_loc_demo', ?, 'medium', ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`);
  insertPO.run('rev_po_steel_frame_batch1', companyId, branch, 'DEMO-PO-0001', 20.0, 'in_progress', REVIEWER, ts, ts);
  insertPO.run('rev_po_steel_frame_batch2', companyId, branch, 'DEMO-PO-0002', 15.0, 'planned', REVIEWER, ts, ts);

  // ---- 1-2 Work Orders ----
  const insertWO = dialect.prepare(`INSERT INTO mfg_work_orders
    (id, company_id, production_order_id, operation_sequence, work_center_id, name, quantity_to_produce, quantity_started, state, created_at, updated_at)
    VALUES (?, ?, ?, 10, 'rev_wc_assembly', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`);
  insertWO.run('rev_wo_batch1_op10', companyId, 'rev_po_steel_frame_batch1', '[DEMO] Assemble Frame — Batch 1', 20.0, 8.0, 'in_progress', ts, ts);
  insertWO.run('rev_wo_batch2_op10', companyId, 'rev_po_steel_frame_batch2', '[DEMO] Assemble Frame — Batch 2', 15.0, 0.0, 'ready', ts, ts);

  // ---- 1 material request (MRP-computed requirement) ----
  dialect.prepare(`INSERT INTO mfg_material_requirements
    (id, company_id, production_order_id, bom_line_id, component_id, uom_id, required_quantity, issued_quantity, state, created_at, updated_at)
    VALUES ('rev_matreq_tube_batch1', ?, 'rev_po_steel_frame_batch1', 'rev_bomline_tube', 'rev_prod_component', 'rev_uom_each', 80.0, 76.0, 'issued', ?, ?)
    ON CONFLICT(id) DO NOTHING`).run(companyId, ts, ts);

  // ---- Governed shop-floor material flow: request + production receipt ----
  const insertFlow = dialect.prepare(`INSERT INTO mfg_material_flow_requests
    (id, company_id, branch_id, warehouse_id, production_order_id, work_order_id, requirement_id, request_type,
     product_id, requested_quantity, approved_quantity, fulfilled_quantity, status, requested_by, approved_by, created_at, updated_at)
    VALUES (?, ?, ?, 'rev_warehouse_main', 'rev_po_steel_frame_batch1', 'rev_wo_batch1_op10', ?, ?,
     ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`);
  insertFlow.run(
    'rev_mfr_request_tube', companyId, branch, 'rev_matreq_tube_batch1', 'request',
    'rev_prod_component', 80.0, 80.0, 0.0, 'approved', REVIEWER, REVIEWER, ts, ts,
  );
  insertFlow.run(
    'rev_mfr_receipt_batch1', companyId, branch, null, 'production_receipt',
    'rev_prod_finished', 8.0, 8.0, 8.0, 'completed', REVIEWER, REVIEWER, ts, ts,
  );

  // ---- 1 issue + 1 return (canonical execution layer) ----
  const insertIssue = dialect.prepare(`INSERT INTO mfg_material_issues
    (id, company_id, production_order_id, requirement_id, component_id, uom_id, quantity, issue_type,
     warehouse_id, location_id, wip_location_id, issued_by, issued_at, created_at)
    VALUES (?, ?, 'rev_po_steel_frame_batch1', 'rev_matreq_tube_batch1', 'rev_prod_component', 'rev_uom_each', ?, ?,
     'rev_warehouse_main', 'rev_wip_loc_demo', 'rev_wip_loc_demo', ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`);
  insertIssue.run('rev_issue_tube_batch1', companyId, 76.0, 'issue', REVIEWER, ts, ts);
  insertIssue.run('rev_return_tube_batch1', companyId, 4.0, 'return', REVIEWER, ts, ts);

  // ---- 1 shop-floor session + 1 output record ----
  dialect.prepare(`INSERT INTO mfg_shopfloor_sessions
    (id, company_id, branch_id, warehouse_id, production_order_id, work_order_id, work_center_id, operator_id,
     produced_quantity, status, created_by, created_at, updated_at, actual_start_at)
    VALUES ('rev_sf_session_batch1', ?, ?, 'rev_warehouse_main', 'rev_po_steel_frame_batch1', 'rev_wo_batch1_op10', 'rev_wc_assembly', ?,
     8.0, 'running', ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`).run(companyId, branch, REVIEWER, REVIEWER, ts, ts, ts);

  dialect.prepare(`INSERT INTO mfg_shopfloor_events
    (id, session_id, company_id, event_type, to_status, quantity, details_json, actor_id, occurred_at)
    VALUES ('rev_sf_event_output_batch1', 'rev_sf_session_batch1', ?, 'operation_output', 'running', 8.0, '{"note":"[DEMO] first output count"}', ?, ?)
    ON CONFLICT(id) DO NOTHING`).run(companyId, REVIEWER, ts);

  // ---- 1 downtime record ----
  dialect.prepare(`INSERT INTO mfg_downtime_events
    (id, company_id, warehouse_id, session_id, work_order_id, work_center_id, reason_code, reason_category,
     planned, starts_at, ends_at, duration_minutes, notes, status, opened_by, created_at, updated_at)
    VALUES ('rev_downtime_batch1', ?, 'rev_warehouse_main', 'rev_sf_session_batch1', 'rev_wo_batch1_op10', 'rev_wc_assembly',
     'machine_jam', 'breakdown', 0, ?, NULL, NULL, '[DEMO] Conveyor jam during batch 1 assembly', 'open', ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`).run(companyId, ts, REVIEWER, ts, ts);

  return {
    summary: {
      productionOrders: ['rev_po_steel_frame_batch1', 'rev_po_steel_frame_batch2'],
      workOrders: ['rev_wo_batch1_op10', 'rev_wo_batch2_op10'],
      materialRequirements: ['rev_matreq_tube_batch1'],
      materialRequest: 'rev_mfr_request_tube',
      productionReceipt: 'rev_mfr_receipt_batch1',
      materialIssue: 'rev_issue_tube_batch1',
      materialReturn: 'rev_return_tube_batch1',
      shopfloorSession: 'rev_sf_session_batch1',
      outputEvent: 'rev_sf_event_output_batch1',
      downtimeEvent: 'rev_downtime_batch1',
    },
  };
}
