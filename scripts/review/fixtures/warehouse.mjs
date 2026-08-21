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
//      wms_pick_tasks_v2, wms_pick_waves, wms_pick_wave_tasks,
//      wms_count_plans_v2, wms_count_sessions_v2, wms_count_lines_v2)
//   database/migrations/078_build09_dock_crossdock_traceability.mjs
//     (wms_trace_profiles, wms_docks_v2, wms_dock_appointments_v2,
//      wms_staging_allocations, wms_crossdock_matches)
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

  // is_default=1: platform-runtime-bridge.mjs's resolveApiContext() fills
  // ctx.warehouseId from this flag so the many WMS query resources that
  // require warehouse_id (platform/api/build09.mjs) can resolve it without
  // a warehouse-picker UI that doesn't exist on any of those pages yet.
  dialect.prepare(`INSERT INTO warehouses (id, company_id, name, code, is_active, is_default, created_at)
    VALUES (?, ?, ?, ?, 1, 1, ?) ON CONFLICT(id) DO NOTHING`)
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
    // Production fixtures reference these two location ids (WIP line-side and
    // finished goods); they live in the same default warehouse so shop-floor,
    // material-flow and quality pages join real location names instead of
    // rendering raw ids.
    { id: 'rev_wip_loc_demo', name: '[DEMO] WIP Line-Side', usage: 'production', zoneId: 'rev_wms_zone_storage', code: 'REV-LOC-WIP-01', type: 'production_supply' },
    { id: 'rev_fg_loc_demo', name: '[DEMO] Finished Goods', usage: 'internal', zoneId: 'rev_wms_zone_storage', code: 'REV-LOC-FG-01', type: 'bin' },
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

  // 9. Docks, appointments, staging, cross-dock — one physical inbound flow:
  // an inbound appointment checked in at a dock, its stock staged, and a
  // candidate cross-dock match against an outbound appointment. Grounded in
  // database/migrations/078_build09_dock_crossdock_traceability.mjs.
  const DOCK_ID = 'rev_wms_dock_inbound_01';
  dialect.prepare(`INSERT INTO wms_docks_v2
    (id, company_id, warehouse_id, code, name, dock_type, capacity_units, staging_location_id, is_active, created_by, created_at, updated_at)
    VALUES (?, ?, ?, 'REV-DOCK-01', '[DEMO] Inbound Dock 1', 'inbound', 2, ?, 1, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
    .run(DOCK_ID, companyId, WAREHOUSE_ID, 'rev_loc_staging', WAREHOUSE_OPERATOR, ts, ts);

  const APPT_IN_ID = 'rev_wms_dock_appt_in_01';
  dialect.prepare(`INSERT INTO wms_dock_appointments_v2
    (id, company_id, branch_id, warehouse_id, appointment_type, source_document_type, source_document_id,
     carrier_name, vehicle_reference, supplier_id, expected_arrival, expected_departure, actual_arrival,
     dock_id, staging_location_id, expected_units, status, created_by, checked_in_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'inbound', 'purchase_order', ?, '[DEMO] Review Carrier Co.', 'REV-TRUCK-01', NULL,
      ?, ?, ?, ?, ?, 40, 'checked_in', ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
    .run(APPT_IN_ID, companyId, branchId, WAREHOUSE_ID, RECEIVING_SESSION_ID,
      iso(-0.02), iso(0.02), iso(-0.01), DOCK_ID, 'rev_loc_staging',
      WAREHOUSE_OPERATOR, WAREHOUSE_OPERATOR, ts, ts);

  const APPT_OUT_ID = 'rev_wms_dock_appt_out_01';
  dialect.prepare(`INSERT INTO wms_dock_appointments_v2
    (id, company_id, branch_id, warehouse_id, appointment_type, source_document_type, source_document_id,
     carrier_name, vehicle_reference, customer_id, expected_arrival, expected_departure,
     staging_location_id, expected_units, status, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'outbound', 'sales_delivery', ?, '[DEMO] Review Carrier Co.', 'REV-TRUCK-02', NULL,
      ?, ?, ?, 12, 'scheduled', ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
    .run(APPT_OUT_ID, companyId, branchId, WAREHOUSE_ID, '[DEMO] REV-SO-01 Sales Delivery',
      iso(1), iso(1.05), 'rev_loc_staging', OPS_COORDINATOR, ts, ts);

  // One more inbound appointment still only expected, so dock_schedule has a
  // future booking as well as a live one.
  dialect.prepare(`INSERT INTO wms_dock_appointments_v2
    (id, company_id, branch_id, warehouse_id, appointment_type, source_document_type, source_document_id,
     carrier_name, vehicle_reference, expected_arrival, expected_departure, expected_units, status,
     created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'inbound', 'purchase_order', '[DEMO] REV-PO-1002 Steel Tube Delivery',
      '[DEMO] Review Carrier Co.', 'REV-TRUCK-03', ?, ?, 60, 'expected', ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
    .run('rev_wms_dock_appt_in_02', companyId, branchId, WAREHOUSE_ID, iso(1.1), iso(1.2), OPS_COORDINATOR, ts, ts);

  dialect.prepare(`INSERT INTO wms_staging_allocations
    (id, company_id, warehouse_id, staging_location_id, source_type, source_id, product_id, quantity,
     capacity_before, capacity_after, status, allocated_by, allocated_at)
    VALUES (?, ?, ?, ?, 'pick_task', ?, ?, 6, 0, 6, 'occupied', ?, ?) ON CONFLICT(id) DO NOTHING`)
    .run('rev_wms_staging_alloc_01', companyId, WAREHOUSE_ID, 'rev_loc_staging', 'rev_wms_pick_task_02',
      'rev_prod_var_gate_hinge_01', WAREHOUSE_OPERATOR, ts);

  dialect.prepare(`INSERT INTO wms_crossdock_matches
    (id, company_id, branch_id, warehouse_id, inbound_appointment_id, outbound_appointment_id,
     inbound_source_type, inbound_source_id, outbound_source_type, outbound_source_id,
     product_id, lot_id, available_quantity, demand_quantity, matched_quantity,
     staging_location_id, outbound_location_id, eligibility_score, status, proposed_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'purchase_order', ?, 'sales_delivery', ?, ?, ?, 36, 6, 6, ?, ?, 0.8, 'candidate', ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`)
    .run('rev_wms_crossdock_match_01', companyId, branchId, WAREHOUSE_ID, APPT_IN_ID, APPT_OUT_ID,
      RECEIVING_SESSION_ID, '[DEMO] REV-SO-02 Sales Delivery', 'rev_prod_var_gate_hinge_01', LOT_ID,
      'rev_loc_staging', 'rev_loc_staging', OPS_COORDINATOR, ts, ts);

  // 10. A released pick wave containing both pick tasks, so wave_planning and
  // wave_execution have a real wave to review and drive.
  const WAVE_ID = 'rev_wms_wave_01';
  dialect.prepare(`INSERT INTO wms_pick_waves
    (id, company_id, branch_id, warehouse_id, name, wave_type, grouping_strategy, staging_location_id,
     status, operator_id, task_count, completed_task_count, created_by, released_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, '[DEMO] Morning Outbound Wave', 'wave', 'route', ?, 'released', ?, 2, 1, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`)
    .run(WAVE_ID, companyId, branchId, WAREHOUSE_ID, 'rev_loc_staging', WAREHOUSE_OPERATOR,
      OPS_COORDINATOR, WAREHOUSE_OPERATOR, ts, ts);

  const insertWaveTask = dialect.prepare(`INSERT INTO wms_pick_wave_tasks
    (wave_id, pick_task_id, zone_id, sequence) VALUES (?, ?, ?, ?) ON CONFLICT(wave_id,pick_task_id) DO NOTHING`);
  insertWaveTask.run(WAVE_ID, 'rev_wms_pick_task_01', 'rev_wms_zone_storage', 1);
  insertWaveTask.run(WAVE_ID, 'rev_wms_pick_task_02', 'rev_wms_zone_storage', 2);

  // 11. Cycle counting: one active plan, one session already in
  // variance_review with a single out-of-tolerance line, so cycle_count_plans,
  // count_session and variance_review each have a real record to work with.
  const COUNT_PLAN_ID = 'rev_wms_count_plan_01';
  dialect.prepare(`INSERT INTO wms_count_plans_v2
    (id, company_id, warehouse_id, name, count_scope, zone_id, frequency_days, tolerance_quantity,
     tolerance_percent, blind_count, directed_count, is_active, next_count_date, created_by, created_at, updated_at)
    VALUES (?, ?, ?, '[DEMO] Weekly Bulk Zone Cycle Count', 'zone', ?, 7, 0, 2, 1, 1, 1, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`)
    .run(COUNT_PLAN_ID, companyId, WAREHOUSE_ID, 'rev_wms_zone_storage', iso(2), OPS_COORDINATOR, ts, ts);

  const COUNT_SESSION_ID = 'rev_wms_count_session_01';
  dialect.prepare(`INSERT INTO wms_count_sessions_v2
    (id, company_id, branch_id, warehouse_id, plan_id, session_type, status, assigned_to, blind_count,
     snapshot_at, variance_count, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'planned', 'variance_review', ?, 1, ?, 1, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
    .run(COUNT_SESSION_ID, companyId, branchId, WAREHOUSE_ID, COUNT_PLAN_ID, WAREHOUSE_OPERATOR, ts,
      OPS_COORDINATOR, ts, ts);

  dialect.prepare(`INSERT INTO wms_count_lines_v2
    (id, session_id, location_id, product_id, theoretical_quantity, counted_quantity, variance_quantity,
     variance_percent, tolerance_exceeded, discrepancy_reason, counted_by, counted_at, status)
    VALUES (?, ?, ?, ?, 100, 97, -3, -3, 1, ?, ?, ?, 'variance') ON CONFLICT(id) DO NOTHING`)
    .run('rev_wms_count_line_01', COUNT_SESSION_ID, 'rev_loc_storage_bin_a', 'rev_prod_var_steel_tube_01',
      '[DEMO] Fictional review fixture - 3 tubes short of book stock.', WAREHOUSE_OPERATOR, ts);

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
      docksCreated: 1,
      dockAppointments: 3,
      stagingAllocations: 1,
      crossdockMatches: 1,
      pickWaves: 1,
      countPlans: 1,
      countSessions: 1,
      traceabilityNote: 'rev_lot_gate_hinges_01 links wms_receiving_lines -> wms_trace_profiles -> wms_pick_tasks_v2 (task 02)',
      warehouseId: WAREHOUSE_ID,
      tenantId, companyId, branchId,
    },
  };
}

export default seedWarehouseFixtures;
