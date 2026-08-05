// Review Freeze — disposable warehouse (WMS) fixtures.
//
// Fictional demo rows grounded in the real BUILD-09 warehouse schema:
//   database/migrations/037_warehouse_stock_ledger_valuation.mjs   (warehouses, stock_locations)
//   database/migrations/043_phase04_canonical_registry_and_lineage.mjs (stock_lots, STRICT)
//   database/migrations/076_build09_wms_topology_putaway_replenishment.mjs
//     (wms_zones, wms_location_profiles, wms_putaway_recommendations,
//      wms_replenishment_rules_v2, wms_replenishment_proposals_v2)
//   database/migrations/077_build09_mobile_execution.mjs
//     (wms_receiving_sessions, wms_receiving_lines, wms_receiving_discrepancies,
//      wms_pick_tasks_v2)
//   database/migrations/078_build09_dock_crossdock_traceability.mjs (wms_trace_profiles)
//
// Never real data, never written outside a disposable review database. All
// invented ids are prefixed `rev_` and every insert is idempotent via
// ON CONFLICT(id) DO NOTHING. A single lot (`rev_lot_gate_hinges_01`) links
// the receiving line, the trace profile, and the second pick task, so the
// review environment has one concrete lot-traceability example plus the
// near-expiration row on the same lot.
//
// Attribution: rows are attributed to the disposable review identities from
// scripts/review/roles.mjs (usr_review_<role_key>) — none of the WMS tables
// below carry an FK on their actor columns, so this is safe regardless of
// fixture run order.

'use strict';

const WAREHOUSE_OPERATOR = 'usr_review_warehouse_operator';
const OPS_COORDINATOR = 'usr_review_ops_coordinator';

const WAREHOUSE_ID = 'rev_wh_alwarsha_main';
const DAY_MS = 86400000;

/**
 * @returns {Promise<{summary: object}>}
 */
export async function seedWarehouseFixtures(dialect, { tenantId, companyId, branchId, now } = {}) {
  const ts = now || new Date().toISOString();
  const nowMs = Date.parse(ts);
  const iso = (offsetDays) => new Date(nowMs + offsetDays * DAY_MS).toISOString();

  dialect.prepare(`INSERT INTO warehouses (id, company_id, name, code, is_active, created_at)
    VALUES (?, ?, ?, ?, 1, ?) ON CONFLICT(id) DO NOTHING`)
    .run(WAREHOUSE_ID, companyId, '[DEMO] Al-Warsha Main Warehouse', 'REV-WH-01', ts);

  // 1. Products (>= 2)
  const TEMPLATES = [
    { id: 'rev_prod_tmpl_gate_hinge', name: '[DEMO] Heavy Gate Hinge Set' },
    { id: 'rev_prod_tmpl_steel_tube', name: '[DEMO] 40mm Square Steel Tube' },
  ];
  const insertTemplate = dialect.prepare(`INSERT INTO product_templates (id, company_id, name, created_at)
    VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`);
  for (const t of TEMPLATES) insertTemplate.run(t.id, companyId, t.name, ts);

  const VARIANTS = [
    { id: 'rev_prod_var_gate_hinge_01', templateId: 'rev_prod_tmpl_gate_hinge', sku: 'REV-HINGE-01', name: '[DEMO] Heavy Gate Hinge Set - Standard' },
    { id: 'rev_prod_var_steel_tube_01', templateId: 'rev_prod_tmpl_steel_tube', sku: 'REV-TUBE-01', name: '[DEMO] 40mm Square Steel Tube - 6m' },
  ];
  const insertVariant = dialect.prepare(`INSERT INTO product_variants (id, template_id, company_id, sku, name, created_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`);
  for (const v of VARIANTS) insertVariant.run(v.id, v.templateId, companyId, v.sku, v.name, ts);

  // 2. Zones (>= 2)
  const ZONES = [
    { id: 'rev_wms_zone_storage', code: 'REV-Z-STORAGE', name: '[DEMO] Bulk Storage Zone', type: 'storage' },
    { id: 'rev_wms_zone_receiving', code: 'REV-Z-RECEIVING', name: '[DEMO] Receiving Zone', type: 'receiving' },
  ];
  const insertZone = dialect.prepare(`INSERT INTO wms_zones (id, company_id, warehouse_id, code, name, zone_type, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`);
  for (const z of ZONES) insertZone.run(z.id, companyId, WAREHOUSE_ID, z.code, z.name, z.type, WAREHOUSE_OPERATOR, ts, ts);

  // 3. Locations (a handful, spread across the two zones)
  const LOCATIONS = [
    { id: 'rev_loc_receiving_dock', name: '[DEMO] Receiving Dock A', usage: 'internal', zoneId: 'rev_wms_zone_receiving', code: 'REV-LOC-RECV-A', type: 'receiving_dock' },
    { id: 'rev_loc_storage_bin_a', name: '[DEMO] Storage Bin A1', usage: 'internal', zoneId: 'rev_wms_zone_storage', code: 'REV-LOC-BIN-A1', type: 'bin' },
    { id: 'rev_loc_storage_bin_b', name: '[DEMO] Storage Bin A2', usage: 'internal', zoneId: 'rev_wms_zone_storage', code: 'REV-LOC-BIN-A2', type: 'bin' },
    { id: 'rev_loc_staging', name: '[DEMO] Outbound Staging', usage: 'internal', zoneId: 'rev_wms_zone_receiving', code: 'REV-LOC-STAGE-A', type: 'staging' },
  ];
  const insertLocation = dialect.prepare(`INSERT INTO stock_locations (id, company_id, warehouse_id, name, complete_name, usage, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`);
  const insertLocationProfile = dialect.prepare(`INSERT INTO wms_location_profiles
    (location_id, company_id, warehouse_id, zone_id, location_type, location_code, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(location_id) DO NOTHING`);
  for (const l of LOCATIONS) {
    insertLocation.run(l.id, companyId, WAREHOUSE_ID, l.name, `[DEMO] Al-Warsha Main Warehouse / ${l.name}`, l.usage, ts);
    insertLocationProfile.run(l.id, companyId, WAREHOUSE_ID, l.zoneId, l.type, l.code, WAREHOUSE_OPERATOR, ts, ts);
  }

  // Shared lot: ties the receiving line, the trace profile, and pick task #2
  // together as one concrete lot-traceability example, and carries the
  // near-expiration date.
  const LOT_ID = 'rev_lot_gate_hinges_01';
  const nearExpiry = iso(6);
  dialect.prepare(`INSERT INTO stock_lots (id, company_id, product_id, lot_number, manufactured_at, expires_at, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?) ON CONFLICT(id) DO NOTHING`)
    .run(LOT_ID, companyId, 'rev_prod_var_gate_hinge_01', 'REV-LOT-HINGE-0001', iso(-20), nearExpiry, ts);

  // 4. Receiving (one session, one line, one discrepancy)
  const RECEIVING_SESSION_ID = 'rev_wms_receiving_session_01';
  dialect.prepare(`INSERT INTO wms_receiving_sessions
    (id, company_id, branch_id, warehouse_id, receipt_type, reference, status, expected_line_count, scanned_line_count, started_by, started_at, updated_at)
    VALUES (?, ?, ?, ?, 'purchase_order', ?, 'discrepancy_review', 1, 1, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
    .run(RECEIVING_SESSION_ID, companyId, branchId, WAREHOUSE_ID, '[DEMO] REV-PO-1001 Gate Hinge Delivery', WAREHOUSE_OPERATOR, ts, ts);

  const RECEIVING_LINE_ID = 'rev_wms_receiving_line_01';
  dialect.prepare(`INSERT INTO wms_receiving_lines
    (id, session_id, product_id, expected_quantity, received_quantity, lot_id, lot_code, expiry_date,
     destination_location_id, status, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'discrepancy', ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
    .run(RECEIVING_LINE_ID, RECEIVING_SESSION_ID, 'rev_prod_var_gate_hinge_01', 40, 36, LOT_ID, 'REV-LOT-HINGE-0001', nearExpiry,
      'rev_loc_receiving_dock', WAREHOUSE_OPERATOR, ts, ts);

  dialect.prepare(`INSERT INTO wms_receiving_discrepancies
    (id, session_id, line_id, discrepancy_type, expected_value, actual_value, reason, status, requested_by, requested_at)
    VALUES (?, ?, ?, 'under', '40', '36', ?, 'open', ?, ?) ON CONFLICT(id) DO NOTHING`)
    .run('rev_wms_receiving_discrepancy_01', RECEIVING_SESSION_ID, RECEIVING_LINE_ID,
      '[DEMO] Fictional review fixture - 4 units short versus the purchase order line.', WAREHOUSE_OPERATOR, ts);

  // 5. Putaway
  dialect.prepare(`INSERT INTO wms_putaway_recommendations
    (id, company_id, warehouse_id, source_location_id, product_id, lot_id, quantity, status, requested_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'suggested', ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
    .run('rev_wms_putaway_reco_01', companyId, WAREHOUSE_ID, 'rev_loc_receiving_dock', 'rev_prod_var_gate_hinge_01', LOT_ID, 36, WAREHOUSE_OPERATOR, ts, ts);

  // 6. Replenishment (rule, then proposal against it)
  const REPL_RULE_ID = 'rev_wms_replenishment_rule_01';
  dialect.prepare(`INSERT INTO wms_replenishment_rules_v2
    (id, company_id, warehouse_id, product_id, source_location_id, destination_location_id,
     minimum_quantity, maximum_quantity, reorder_point, target_quantity, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
    .run(REPL_RULE_ID, companyId, WAREHOUSE_ID, 'rev_prod_var_steel_tube_01', 'rev_loc_storage_bin_b', 'rev_loc_storage_bin_a',
      10, 100, 20, 80, OPS_COORDINATOR, ts, ts);

  dialect.prepare(`INSERT INTO wms_replenishment_proposals_v2
    (id, company_id, warehouse_id, rule_id, product_id, source_location_id, destination_location_id,
     destination_on_hand, requested_quantity, available_quantity, proposed_quantity, status, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
    .run('rev_wms_replenishment_proposal_01', companyId, WAREHOUSE_ID, REPL_RULE_ID, 'rev_prod_var_steel_tube_01',
      'rev_loc_storage_bin_b', 'rev_loc_storage_bin_a', 15, 60, 60, 60, OPS_COORDINATOR, ts, ts);

  // 7. Pick tasks (>= 2) — the second one carries the shared lot, completing
  // the receipt -> trace -> pick traceability chain.
  const PICK_TASKS = [
    {
      id: 'rev_wms_pick_task_01', productId: 'rev_prod_var_steel_tube_01', lotId: null,
      source: 'rev_loc_storage_bin_a', dest: 'rev_loc_staging', qty: 12, status: 'ready',
    },
    {
      id: 'rev_wms_pick_task_02', productId: 'rev_prod_var_gate_hinge_01', lotId: LOT_ID,
      source: 'rev_loc_storage_bin_b', dest: 'rev_loc_staging', qty: 6, status: 'picked',
    },
  ];
  const insertPickTask = dialect.prepare(`INSERT INTO wms_pick_tasks_v2
    (id, company_id, branch_id, warehouse_id, picking_type, source_document_id, product_id, lot_id,
     source_location_id, destination_location_id, requested_quantity, picked_quantity, strategy, status,
     assigned_to, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'sales_delivery', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`);
  for (const p of PICK_TASKS) {
    insertPickTask.run(
      p.id, companyId, branchId, WAREHOUSE_ID, `[DEMO] REV-SO-${p.id.slice(-2)} Sales Delivery`, p.productId, p.lotId,
      p.source, p.dest, p.qty, p.status === 'picked' ? p.qty : 0, p.lotId ? 'fefo' : 'fifo', p.status,
      WAREHOUSE_OPERATOR, WAREHOUSE_OPERATOR, ts, ts,
    );
  }

  // 8. Traceability + near-expiration example, on the shared lot.
  dialect.prepare(`INSERT INTO wms_trace_profiles
    (id, company_id, product_id, lot_id, internal_lot, manufacture_date, expiry_date, quality_status,
     source_receipt_type, source_receipt_id, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'released', 'wms_receiving_session', ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
    .run('rev_wms_trace_profile_01', companyId, 'rev_prod_var_gate_hinge_01', LOT_ID, 'REV-LOT-HINGE-0001',
      iso(-20), nearExpiry, RECEIVING_SESSION_ID, WAREHOUSE_OPERATOR, ts, ts);

  return {
    summary: {
      productsCreated: VARIANTS.length,
      zonesCreated: ZONES.length,
      locationsCreated: LOCATIONS.length,
      receivingSessions: 1,
      discrepancies: 1,
      putawayRecommendations: 1,
      replenishmentProposals: 1,
      pickTasksCreated: PICK_TASKS.length,
      nearExpirationRows: 1,
      traceabilityExamples: 1,
      traceabilityNote: 'rev_lot_gate_hinges_01 links wms_receiving_lines -> wms_trace_profiles -> wms_pick_tasks_v2 (task 02)',
      warehouseId: WAREHOUSE_ID,
      tenantId, companyId, branchId,
    },
  };
}

export default seedWarehouseFixtures;
