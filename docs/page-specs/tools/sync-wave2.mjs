import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CATALOG_BASELINE = 'aa730dd23462aab3e90b70ad2db1bf6cc945ca99';
const ENGINEERING_REFERENCE = '25c24df753962bbf3c13301eed71624bc0ee39b6';
const DATE = '2026-08-14';

const pages = {
  warehouse_topology: { title: 'Warehouse Topology', module: 'build09-topology-workspace.js', query: 'hierarchy, zones, locations, capacity', actions: 'wms:zone_create, wms:location_create', domain: 'topology.hierarchy/listZones/listLocations/capacityUtilization/createZone/createLocation', tables: 'wms_zones, wms_location_profiles, stock_locations', goal: 'Define and inspect the warehouse hierarchy, zones, bins, capacity, and restrictions.', upstream: 'warehouse setup and company/warehouse context', downstream: 'zone_bin_management, putaway_rules, putaway_task_queue', status: 'ALREADY_IMPLEMENTED', usability: 'USABLE', tests: 'topology-workspaces-browser.test.mjs, operational-topology-chromium.test.mjs, build09-workspaces-contract.test.mjs', gaps: 'P1 SCOPE — hierarchy and location mutations must reject a warehouse outside the session company; P1 TEST — a browser lifecycle must prove create/update/block/retire rather than route visibility only' },
  zone_bin_management: { title: 'Zone and Bin Management', module: 'build09-topology-workspace.js', query: 'zones, locations, capacity', actions: 'wms:zone_create, wms:location_create', domain: 'topology.createZone/createLocation/updateLocation/setLocationCapacity/setLocationRestrictions/generateLocationBarcode/retireLocation', tables: 'wms_zones, wms_location_profiles, stock_locations', goal: 'Maintain operational zones and bin profiles used by receiving, putaway, picking, and staging.', upstream: 'warehouse_topology', downstream: 'putaway_rules, mobile_receiving, mobile_picking, staging_board', status: 'PARTIALLY_IMPLEMENTED', usability: 'USABLE', tests: 'topology-workspaces-browser.test.mjs, operational-topology-chromium.test.mjs', gaps: 'P1 ACTION — the renderer exposes creation-focused controls while the domain also supports edit, capacity, restriction, barcode, and retirement operations; ownership of those controls is incomplete; P1 TEST — prove retired/blocked bins disappear from governed selectors' },
  putaway_rules: { title: 'Putaway Rules', module: 'build09-putaway-workspace.js', query: 'putaway-rules', actions: 'wms:putaway_rule_create, wms:putaway_rule_update, wms:putaway_recommend', domain: 'putaway.createPutawayRule/updatePutawayRule/recommendPutaway/listPutawayRules', tables: 'wms_putaway_rules_v2, wms_putaway_recommendations', goal: 'Configure deterministic placement rules and generate a governed putaway recommendation for inbound stock.', upstream: 'warehouse_topology, mobile_receiving', downstream: 'putaway_task_queue, replenishment_proposals', status: 'PARTIALLY_IMPLEMENTED', usability: 'USABLE', tests: 'putaway-workspaces-browser.test.mjs, build09r2-bespoke-contract.test.mjs', gaps: 'P1 WORKFLOW — rule creation and recommendation are connected, but the catalog must retain explicit precedence/conflict behavior when several rules match; P1 TEST — prove recommendation selection against restricted, blocked, capacity, and quality-ineligible locations' },
  putaway_task_queue: { title: 'Putaway Task Queue', module: 'build09-putaway-workspace.js', query: 'putaway-queue, tasks', actions: 'wms:task_scan_source, wms:task_scan_destination, wms:task_request_canonical, wms:task_acknowledge_canonical', domain: 'putaway.listPutawayQueue/listWarehouseTasks/scanTaskSource/scanTaskDestination/requestCanonicalMovement/acknowledgeCanonicalMovement', tables: 'wms_putaway_recommendations, wms_putaway_recommendation_lines, wms_warehouse_tasks', goal: 'Execute assigned putaway tasks by scanning source and destination, then hand off the stock movement to canonical Inventory.', upstream: 'putaway_rules, mobile_receiving', downstream: 'canonical inventory stock move, location stock', status: 'ALREADY_IMPLEMENTED', usability: 'USABLE', tests: 'putaway-workspaces-browser.test.mjs, operational-32-page-matrix-chromium.test.mjs, cross-domain-lifecycles.test.mjs', gaps: 'P1 PERMISSION — task visibility and mutation must remain warehouse-scoped for viewer/operator roles; P1 WORKFLOW — canonical posting acknowledgement needs a direct browser proof with an actual completed move ID' },
  replenishment_rules: { title: 'Replenishment Rules', module: 'build09-putaway-workspace.js', query: 'replenishment-rules', actions: 'wms:replenishment_rule_create', domain: 'replenishment.createReplenishmentRule/listReplenishmentRules', tables: 'wms_replenishment_rules_v2', goal: 'Set min/max or demand-driven replenishment policies for warehouse locations.', upstream: 'warehouse_topology', downstream: 'replenishment_proposals', status: 'PARTIALLY_IMPLEMENTED', usability: 'USABLE', tests: 'putaway-workspaces-browser.test.mjs, wms-foundation-domain.test.mjs', gaps: 'P1 ACTION — the visible form is a rule-creation surface; update/activation/deactivation semantics are domain-supported but not fully exposed; P1 TEST — prove rules are filtered to the selected warehouse and company' },
  replenishment_proposals: { title: 'Replenishment Proposals', module: 'build09-putaway-workspace.js', query: 'replenishment-proposals', actions: 'wms:replenishment_calculate, wms:replenishment_cancel', domain: 'replenishment.calculateReplenishment/approveReplenishment/cancelReplenishment/retryReplenishment/listReplenishmentProposals', tables: 'wms_replenishment_proposals_v2, wms_warehouse_tasks', goal: 'Review shortages and proposed moves, then approve/cancel/retry the proposal before canonical execution.', upstream: 'replenishment_rules, location stock', downstream: 'putaway_task_queue, canonical inventory stock move', status: 'PARTIALLY_IMPLEMENTED', usability: 'USABLE', tests: 'putaway-workspaces-browser.test.mjs, wms-foundation-domain.test.mjs, cross-domain-lifecycles.test.mjs', gaps: 'P1 ACTION — domain approval/retry paths must be reconciled with the visible proposal controls; P1 WORKFLOW — proposal-to-task-to-canonical completion needs a direct end-to-end proof' },
  mobile_receiving: { title: 'Mobile Receiving', module: 'build09-mobile-receiving.js', query: 'direct session actions; receiving-sessions is the authoritative list resource', actions: 'wms:receiving_start, wms:receiving_scan_reference, wms:receiving_scan_product, wms:receiving_review, wms:receiving_request_post, wms:receiving_acknowledge_post, wms:receiving_complete', domain: 'receiving.startReceiving/scanReceivingReference/scanReceivingProduct/reviewReceiving/requestReceivingPost/acknowledgeReceivingPost/completeReceiving', tables: 'wms_receiving_sessions, wms_receiving_lines, wms_receiving_discrepancies', goal: 'Scan an inbound reference and products, identify discrepancies, review, request canonical posting, acknowledge Inventory, and complete putaway-pending receipt.', upstream: 'purchase/transfer/return reference, warehouse_topology', downstream: 'receiving_discrepancies, putaway_task_queue, canonical inventory picking', status: 'ALREADY_IMPLEMENTED', usability: 'USABLE', tests: 'mobile-receiving-domain.test.mjs, mobile-receiving-picking-browser.test.mjs, operational-browser-chromium.test.mjs, build09r-form-contract.test.mjs', gaps: 'P1 WORKFLOW — direct browser proof must cover the full scan-to-canonical-posting handoff including over/under receipt; P1 RESPONSIVE — scanner-sized controls and focus behavior need a bounded mobile viewport assertion' },
  receiving_discrepancies: { title: 'Receiving Discrepancies', module: 'build09-receiving-discrepancy-workspace.js', query: 'receiving-discrepancies', actions: 'wms:receiving_discrepancy_approve', domain: 'receiving.listReceivingDiscrepancies/approveReceivingDiscrepancy', tables: 'wms_receiving_discrepancies, wms_receiving_lines, wms_receiving_sessions', goal: 'Review quantity, damage, lot, or reference discrepancies and accept or reject the affected receiving line.', upstream: 'mobile_receiving', downstream: 'receiving session review and canonical posting', status: 'ALREADY_IMPLEMENTED', usability: 'USABLE', tests: 'receiving-discrepancy-browser.test.mjs, mobile-receiving-domain.test.mjs, operational-32-page-matrix-chromium.test.mjs', gaps: 'P1 PERMISSION — approval must enforce reviewer authority and warehouse scope server-side; P1 ERROR_STATE — the UI needs direct proof for stale, already-decided, and missing-line responses' },
  mobile_picking: { title: 'Mobile Picking', module: 'build09-mobile-picking.js', query: 'GET /api/v1/wms/pick-tasks?warehouse_id=...', actions: 'wms:pick_task_assign, wms:pick_scan_source, wms:pick_scan_product, wms:pick_confirm, wms:pick_stage, wms:pick_request_post, wms:pick_acknowledge_post', domain: 'picking.listPickTasks/assignPickTask/scanPickSource/scanPickProduct/confirmPick/stagePick/requestPickPost/acknowledgePickPost', tables: 'wms_pick_tasks_v2, wms_warehouse_tasks', goal: 'Select an eligible task, scan source and product/lot/serial, confirm quantity or short reason, stage, and hand off the stock move.', upstream: 'pick_task_queue, wave_execution', downstream: 'canonical inventory stock move, traceability', status: 'ALREADY_IMPLEMENTED', usability: 'USABLE', tests: 'mobile-picking-wave-domain.test.mjs, mobile-receiving-picking-browser.test.mjs, pick-task-warehouse-isolation.test.mjs, operational-browser-chromium.test.mjs', gaps: 'P1 PERMISSION — queue filtering and assignment must not expose another warehouse; P1 WORKFLOW — a direct Chromium path must prove short-pick exception and canonical acknowledgement, not only scanning contracts' },
  pick_task_queue: { title: 'Pick Task Queue', module: 'build09-pick-task-queue-workspace.js', query: 'pick-tasks', actions: 'wms:pick_task_assign', domain: 'picking.listPickTasks/assignPickTask', tables: 'wms_pick_tasks_v2', goal: 'Dispatch ready and assigned pick work to warehouse operators while showing wave, product, quantity, and exception state.', upstream: 'wave_planning, replenishment_proposals', downstream: 'mobile_picking, wave_execution', status: 'ALREADY_IMPLEMENTED', usability: 'USABLE', tests: 'pick-task-queue-denial-browser.test.mjs, pick-task-warehouse-isolation.test.mjs, operational-32-page-matrix-chromium.test.mjs', gaps: 'P1 PERMISSION — the viewer read path must be demonstrably scoped while mutation remains denied where required; P1 TEST — prove assignment race handling when two operators select the same ready task' },
  wave_planning: { title: 'Wave Planning', module: 'build09-wave-workspace.js', query: 'pick-tasks', actions: 'wms:wave_create, wms:wave_calculate, wms:wave_review', domain: 'waves.createWave/calculateWave/reviewWave', tables: 'wms_pick_waves, wms_pick_wave_tasks', goal: 'Select eligible ready/assigned/pending pick tasks, group them by strategy, calculate the wave, and submit it for independent review.', upstream: 'pick_task_queue', downstream: 'wave_execution, mobile_picking', status: 'ALREADY_IMPLEMENTED', usability: 'USABLE', tests: 'wave-workspaces-browser.test.mjs, mobile-picking-wave-domain.test.mjs, cross-domain-lifecycles.test.mjs', gaps: 'P1 PERMISSION — creator/reviewer separation is enforced by domain logic and needs a browser evidence row; P1 WORKFLOW — cutoff, staging, and recalculation behavior should be demonstrated against real task fixtures' },
  wave_execution: { title: 'Wave Execution', module: 'build09-wave-workspace.js', query: 'waves', actions: 'wms:wave_release, wms:wave_refresh_progress, wms:wave_cancel, wms:wave_complete', domain: 'waves.releaseWave/refreshWaveProgress/cancelWave/completeWave/listWaves', tables: 'wms_pick_waves, wms_pick_wave_tasks, wms_pick_tasks_v2, wms_warehouse_tasks', goal: 'Release reviewed waves, monitor task progress and staging, handle exceptions, and close the wave when work is complete.', upstream: 'wave_planning', downstream: 'mobile_picking, staging_board, canonical inventory', status: 'ALREADY_IMPLEMENTED', usability: 'USABLE', tests: 'wave-workspaces-browser.test.mjs, operational-32-page-matrix-chromium.test.mjs, cross-domain-lifecycles.test.mjs', gaps: 'P1 WORKFLOW — release-to-completion and exception refresh must be proven with task state changes; P1 ERROR_STATE — cancellation and blocked waves need explicit browser-visible reason handling' },
  cycle_count_plans: { title: 'Cycle Count Plans', module: 'build09-count-workspace.js', query: 'count-plans', actions: 'wms:count_plan_create', domain: 'cycleCounting.createCountPlan/listCountPlans', tables: 'wms_count_plans_v2', goal: 'Define blind or directed recurring count policies, tolerance, and next count dates for warehouse locations/products.', upstream: 'warehouse_topology', downstream: 'count_session', status: 'ALREADY_IMPLEMENTED', usability: 'USABLE', tests: 'cycle-counting-domain.test.mjs, count-workspaces-browser.test.mjs, operational-32-page-matrix-chromium.test.mjs', gaps: 'P1 ACTION — plan activation/edit lifecycle is not equivalent to creation and must be explicitly reconciled; P1 FIXTURE — browser evidence needs a plan that produces a non-empty count session' },
  count_session: { title: 'Count Session', module: 'build09-count-workspace.js', query: 'count-sessions', actions: 'wms:count_session_start, wms:count_line_record, wms:count_submit', domain: 'cycleCounting.startCountSession/recordCountLine/submitCount/listCountSessions', tables: 'wms_count_sessions_v2, wms_count_lines_v2', goal: 'Start a scoped count, record observed quantities against theoretical lines, and submit the session for variance review.', upstream: 'cycle_count_plans', downstream: 'variance_review, canonical inventory adjustment', status: 'ALREADY_IMPLEMENTED', usability: 'USABLE', tests: 'cycle-counting-domain.test.mjs, count-workspaces-browser.test.mjs, cross-domain-lifecycles.test.mjs', gaps: 'P1 SCOPE — count session lines must remain warehouse/company scoped even when a product or location ID is supplied; P1 TEST — prove blind-count behavior does not render theoretical quantity before submit' },
  variance_review: { title: 'Variance Review', module: 'build09-count-workspace.js', query: 'count-sessions', actions: 'wms:count_approve_variance, wms:count_recount, wms:count_request_adjustment', domain: 'cycleCounting.requestRecount/approveCountVariance/requestCountAdjustment/acknowledgeCountAdjustment', tables: 'wms_count_sessions_v2, wms_count_lines_v2', goal: 'Review count variance, request a recount or approve it, then request and acknowledge a canonical stock adjustment.', upstream: 'count_session', downstream: 'canonical inventory adjustment', status: 'ALREADY_IMPLEMENTED', usability: 'USABLE', tests: 'cycle-counting-domain.test.mjs, count-workspaces-browser.test.mjs, cross-domain-lifecycles.test.mjs', gaps: 'P1 PERMISSION — maker-checker separation for variance approval must be visible in the spec and browser evidence; P1 WORKFLOW — adjustment acknowledgement must verify every canonical result ID before closing the session' },
  dock_schedule: { title: 'Dock Schedule', module: 'build09-dock-workspace.js', query: 'docks, dock-appointments', actions: 'wms:dock_appointment_create, wms:dock_cancel', domain: 'docks.createDock/createDockAppointment/cancelDockAppointment/listDocks/listDockAppointments', tables: 'wms_docks_v2, wms_dock_appointments_v2', goal: 'Schedule inbound/outbound appointments against active docks and show expected arrival, capacity, and status.', upstream: 'warehouse_topology', downstream: 'dock_checkin, staging_board', status: 'ALREADY_IMPLEMENTED', usability: 'USABLE', tests: 'dock-workspaces-browser.test.mjs, dock-crossdock-domain.test.mjs, operational-32-page-matrix-chromium.test.mjs', gaps: 'P1 SCOPE — appointment creation must validate dock and staging location belong to the active warehouse; P1 TEST — prove conflict/capacity and cancellation behavior with non-empty fixtures' },
  dock_checkin: { title: 'Dock Check-in', module: 'build09-dock-workspace.js', query: 'dock-appointments', actions: 'wms:dock_check_in, wms:dock_assign', domain: 'docks.checkInDockAppointment/assignDock/startDockService/listDockAppointments', tables: 'wms_dock_appointments_v2, wms_docks_v2', goal: 'Check in an arriving vehicle, capture the vehicle reference, assign a dock, and start service.', upstream: 'dock_schedule', downstream: 'staging_board, crossdock_workspace', status: 'ALREADY_IMPLEMENTED', usability: 'USABLE', tests: 'dock-workspaces-browser.test.mjs, dock-crossdock-domain.test.mjs', gaps: 'P1 WORKFLOW — late arrival/detention state needs direct browser proof; P1 PERMISSION — assignment must reject inactive or cross-warehouse docks' },
  staging_board: { title: 'Staging Board', module: 'build09-dock-workspace.js', query: 'staging-allocations, locations', actions: 'wms:staging_allocate, wms:staging_release', domain: 'docks.allocateStaging/releaseStaging/listStagingAllocations', tables: 'wms_staging_allocations, wms_dock_appointments_v2, wms_location_profiles', goal: 'Allocate and release staging capacity for dock, wave, receiving, or cross-dock work.', upstream: 'dock_checkin, wave_execution, mobile_receiving', downstream: 'crossdock_workspace, canonical movements', status: 'ALREADY_IMPLEMENTED', usability: 'USABLE', tests: 'dock-workspaces-browser.test.mjs, dock-crossdock-domain.test.mjs, operational-32-page-matrix-chromium.test.mjs', gaps: 'P1 SCOPE — allocation must prevent over-capacity and cross-warehouse location selection; P1 TEST — prove release does not remove the underlying appointment or wave record' },
  crossdock_workspace: { title: 'Cross-dock Workspace', module: 'build09-dock-workspace.js', query: 'crossdock-matches, locations', actions: 'wms:crossdock_evaluate, wms:crossdock_acknowledge_post', domain: 'crossdock.evaluateCrossDock/approveCrossDock/requestCrossDockPost/acknowledgeCrossDockPost/cancelCrossDock/listCrossDockMatches', tables: 'wms_crossdock_matches, wms_warehouse_tasks', goal: 'Evaluate eligible inbound-to-outbound matches, approve a cross-dock move, and acknowledge its canonical posting.', upstream: 'dock_checkin, mobile_receiving', downstream: 'staging_board, canonical inventory', status: 'PARTIALLY_IMPLEMENTED', usability: 'USABLE', tests: 'dock-crossdock-domain.test.mjs, dock-workspaces-browser.test.mjs, cross-domain-lifecycles.test.mjs', gaps: 'P1 WORKFLOW — evaluation, approval, canonical request, and acknowledgement are distinct domain steps and must not be documented as one button; P1 ERROR_STATE — no-match and cancelled-match evidence needs a direct browser row' },
  lot_serial_traceability: { title: 'Lot and Serial Traceability', module: 'build09-trace-workspace.js', query: 'trace (lot_id or serial_id required)', actions: 'read/query only in this workspace; profile mutation is domain-supported by traceability-ops', domain: 'traceability.queryTrace/upsertTraceProfile', tables: 'wms_trace_profiles, stock_lots, stock_serials, stock_move_lines', goal: 'Trace a lot or serial through receipts, internal moves, production, delivery, and current quality/expiry state.', upstream: 'receiving, production_receipt, canonical inventory', downstream: 'recall_analysis, expiration_queue', status: 'ALREADY_IMPLEMENTED', usability: 'USABLE', tests: 'trace-workspaces-browser.test.mjs, traceability-recall-domain.test.mjs, operational-32-page-matrix-chromium.test.mjs', gaps: 'P1 ERROR_STATE — identity mismatch between lot, serial, and product must be surfaced as a recoverable validation state; P1 TEST — prove trace results are company scoped and include no unrelated lot/serial movements' },
  expiration_queue: { title: 'Expiration Queue', module: 'build09-expiration-workspace.js', query: 'expiration-queue', actions: 'wms:trace_quality_set', domain: 'traceability.expirationQueue/setTraceQualityStatus', tables: 'wms_trace_profiles, stock_lots, stock_serials', goal: 'Prioritize lots/serials approaching expiry and record a governed quality disposition without inventing stock state.', upstream: 'lot_serial_traceability, receiving', downstream: 'quality_hold_queue, recall_analysis', status: 'ALREADY_IMPLEMENTED', usability: 'USABLE', tests: 'expiration-queue-browser.test.mjs, traceability-recall-domain.test.mjs', gaps: 'P1 PERMISSION — quality status changes require maker-checker and must be proven in the browser; P1 DATA — expiry thresholds/timezone and missing-expiry handling need explicit fixture evidence' },
  recall_analysis: { title: 'Recall Analysis', module: 'build09-trace-workspace.js', query: 'recall-cases', actions: 'wms:recall_identify, wms:recall_analyze, wms:recall_propose_holds', domain: 'traceability.identifyRecall/analyzeRecall/proposeRecallHolds/listRecallCases', tables: 'wms_recall_cases, wms_recall_impacts', goal: 'Identify a recall case from a lot/serial, calculate affected inventory/orders/production impacts, and propose holds.', upstream: 'lot_serial_traceability, expiration_queue', downstream: 'quality_hold_queue and operational work items', status: 'ALREADY_IMPLEMENTED', usability: 'USABLE', tests: 'traceability-recall-domain.test.mjs, trace-workspaces-browser.test.mjs, operational-32-page-matrix-chromium.test.mjs', gaps: 'P1 WORKFLOW — impact analysis and hold proposal must be separately evidenced; P1 DATA — duplicate recall reference/idempotency and closed-case behavior need direct tests' },
  shopfloor_terminal: { title: 'Shopfloor Terminal', module: 'build09-shopfloor-workspace.js', query: 'shopfloor-sessions, shopfloor-timeline, shopfloor-board', actions: 'shopfloor:operation_output, shopfloor:operation_acknowledge, shopfloor:operator_assign, shopfloor:operation_handoff', domain: 'shopfloor list sessions/status/timeline plus operation output/acknowledgement/handoff handlers', tables: 'shopfloor_sessions, shopfloor_operations, shopfloor_outputs', goal: 'Run a work-center operation, assign an operator, record output, and hand off or acknowledge the canonical production result.', upstream: 'workcenter_queue, production_material_requests', downstream: 'production_receipt, downtime_board, quality_hold_queue', status: 'ALREADY_IMPLEMENTED', usability: 'USABLE', tests: 'shopfloor-workspaces-browser.test.mjs, production-material-workspaces-browser.test.mjs, operational-production-quality-chromium.test.mjs', gaps: 'P1 WORKFLOW — operation output versus canonical production receipt boundary needs end-to-end proof; P1 PERMISSION — operator assignment/handoff must be tested against session scope and maker-checker rules' },
  workcenter_queue: { title: 'Work-center Queue', module: 'build09-shopfloor-workspace.js', query: 'shopfloor-sessions, shopfloor-board', actions: 'shopfloor:operator_assign, shopfloor:operation_handoff', domain: 'shopfloor.listShopfloorSessions/shopfloorStatusBoard and operation assignment/handoff handlers', tables: 'shopfloor_sessions, work_orders, work_centers', goal: 'Prioritize ready, running, blocked, and quality-held work-center sessions and open the terminal for execution.', upstream: 'production orders and material availability', downstream: 'shopfloor_terminal, downtime_board', status: 'ALREADY_IMPLEMENTED', usability: 'USABLE', tests: 'shopfloor-workspaces-browser.test.mjs, operational-production-quality-chromium.test.mjs', gaps: 'P1 SCOPE — queue state must be warehouse/company scoped; P1 ERROR_STATE — blocked and quality-held sessions need actionable reasons, not just status badges' },
  production_material_requests: { title: 'Production Material Requests', module: 'build09-production-material-workspaces.js', query: 'material-flow', actions: 'shopfloor:material_request, shopfloor:material_availability, shopfloor:material_approve', domain: 'materialFlow.listMaterialFlowRequests/materialShortageBoard and request/availability/approval handlers', tables: 'shopfloor_material_requests, shopfloor_material_request_lines', goal: 'Request components for a production operation, check availability, and approve the material release.', upstream: 'shopfloor_terminal, inventory availability', downstream: 'production_issue_return, canonical material move', status: 'ALREADY_IMPLEMENTED', usability: 'USABLE', tests: 'production-material-workspaces-browser.test.mjs, production-material-flow-domain.test.mjs, production-material-workspaces-contract.test.mjs', gaps: 'P1 WORKFLOW — approval is distinct from canonical issue and must remain so in the spec; P1 DATA — shortage and partial-availability fixture coverage must be explicit' },
  production_issue_return: { title: 'Production Issue and Return', module: 'build09-production-material-workspaces.js', query: 'material-flow', actions: 'shopfloor:material_request_canonical, shopfloor:material_acknowledge', domain: 'materialFlow request/acknowledgement handlers with canonical stock authority', tables: 'shopfloor_material_requests, shopfloor_material_request_lines, shopfloor_material_moves', goal: 'Request canonical component issue or return, then acknowledge the resulting Inventory move.', upstream: 'production_material_requests, shopfloor_terminal', downstream: 'canonical inventory, lot_serial_traceability', status: 'ALREADY_IMPLEMENTED', usability: 'USABLE', tests: 'production-material-workspaces-browser.test.mjs, production-material-flow-domain.test.mjs, cross-domain-lifecycles.test.mjs', gaps: 'P1 WORKFLOW — issue and return are separate request types and need separate lifecycle evidence; P1 PERMISSION — acknowledgement must re-verify the canonical result belongs to the request and scope' },
  production_receipt: { title: 'Production Receipt', module: 'build09-production-material-workspaces.js', query: 'material-flow', actions: 'shopfloor:material_request_canonical, shopfloor:material_acknowledge', domain: 'materialFlow receipt proposals and canonical acknowledgement', tables: 'shopfloor_material_requests, shopfloor_material_request_lines, stock_moves', goal: 'Review production output receipt proposals, request canonical Inventory posting, and expose traceability after acknowledgement.', upstream: 'shopfloor_terminal, quality_hold_queue', downstream: 'canonical inventory, lot_serial_traceability', status: 'ALREADY_IMPLEMENTED', usability: 'USABLE', tests: 'production-material-workspaces-browser.test.mjs, production-material-flow-domain.test.mjs, operational-production-quality-chromium.test.mjs', gaps: 'P1 WORKFLOW — quality verification is consumed, not owned, and the page must not imply it posts stock directly; P1 TEST — prove canonical result reference appears after acknowledgement' },
  quality_hold_queue: { title: 'Quality Hold Queue', module: 'build09-quality-workspace.js', query: 'quality-checkpoints', actions: 'quality:checkpoint_sync, quality:checkpoint_conditional_accept, quality:disposition_request', domain: 'qualityOperations.listOperationalCheckpoints and checkpoint sync/conditional accept/disposition request', tables: 'quality_checkpoints, quality_dispositions, quality_ncrs', goal: 'Review failed/held checkpoints, synchronize canonical inspection state, conditionally accept with a second actor, or request a disposition.', upstream: 'receiving, shopfloor_terminal, production_receipt', downstream: 'rework_workspace, scrap_approval', status: 'ALREADY_IMPLEMENTED', usability: 'USABLE', tests: 'quality-workspaces-browser.test.mjs, quality-rework-scrap-domain.test.mjs, operational-production-quality-chromium.test.mjs', gaps: 'P1 PERMISSION — conditional acceptance and disposition request have maker-checker constraints requiring browser proof; P1 ERROR_STATE — stale canonical checkpoint and missing NCR must be visible as distinct errors' },
  rework_workspace: { title: 'Rework Workspace', module: 'build09-quality-workspace.js', query: 'rework-routes', actions: 'quality:rework_start, quality:rework_complete', domain: 'qualityOperations.listReworkRoutes/startRework/completeRework', tables: 'quality_rework_routes, quality_rework_operations', goal: 'Start an approved rework route, monitor its operations, complete it, and surface the required retest proposal.', upstream: 'quality_hold_queue', downstream: 'quality_hold_queue retest, shopfloor terminal', status: 'ALREADY_IMPLEMENTED', usability: 'USABLE', tests: 'quality-workspaces-browser.test.mjs, quality-rework-scrap-domain.test.mjs, operational-production-quality-chromium.test.mjs', gaps: 'P1 WORKFLOW — completion creates a retest proposal rather than passing quality automatically; P1 TEST — prove route status transitions and retest requirement with a non-empty fixture' },
  scrap_approval: { title: 'Scrap Approval', module: 'build09-quality-workspace.js', query: 'quality-dispositions', actions: 'quality:disposition_approve, quality:scrap_request_canonical, quality:scrap_acknowledge', domain: 'qualityOperations.listDispositions/approveDisposition/requestCanonicalScrap/acknowledgeCanonicalScrap', tables: 'quality_dispositions, quality_ncrs, stock_moves', goal: 'Approve a scrap disposition, request canonical Inventory scrap, and acknowledge the verified result.', upstream: 'quality_hold_queue', downstream: 'canonical inventory and traceability', status: 'ALREADY_IMPLEMENTED', usability: 'USABLE', tests: 'quality-workspaces-browser.test.mjs, quality-rework-scrap-domain.test.mjs, operational-production-quality-chromium.test.mjs', gaps: 'P1 PERMISSION — requester cannot approve own disposition and this must be directly tested; P1 WORKFLOW — canonical acknowledgement must validate product, quantity, and destination before closure' },
  downtime_board: { title: 'Downtime Board', module: 'build09-downtime-workspace.js', query: 'downtime, shopfloor-sessions', actions: 'shopfloor:downtime_start, shopfloor:downtime_end', domain: 'performance.listDowntimeEvents and start/end downtime handlers', tables: 'shopfloor_downtime_events, shopfloor_sessions', goal: 'Log active downtime against a shop-floor session, classify the reason, end it, and preserve duration/history.', upstream: 'shopfloor_terminal, workcenter_queue', downstream: 'operational_performance, maintenance proposal boundary', status: 'ALREADY_IMPLEMENTED', usability: 'USABLE', tests: 'downtime-workspaces-browser.test.mjs, shopfloor-downtime-domain.test.mjs, operational-production-quality-chromium.test.mjs', gaps: 'P1 WORKFLOW — maintenance_required is a proposal only and must not be documented as maintenance creation; P1 TEST — live duration, end event, and filter behavior need direct browser evidence' },
  operational_performance: { title: 'Operational Performance', module: 'build09-downtime-workspace.js', query: 'work-center-performance, shopfloor-sessions', actions: 'read-only analytics; no mutation action exposed', domain: 'performance.workCenterPerformance and evidence-based metric calculation', tables: 'shopfloor_sessions, shopfloor_outputs, shopfloor_downtime_events', goal: 'Show throughput, rejects, queue, downtime, and only those rate metrics for which the server has reliable evidence.', upstream: 'shopfloor_terminal, downtime_board', downstream: 'operational review and planning', status: 'ALREADY_IMPLEMENTED', usability: 'USABLE', tests: 'downtime-workspaces-browser.test.mjs, shopfloor-downtime-domain.test.mjs, operational-production-quality-chromium.test.mjs', gaps: 'P1 DATA — null/unmeasured rates must remain “not available”, never zero or 100%; P1 FIXTURE — performance evidence needs completed-session fixtures with planned windows, timing, and output' },
};

const readFrontmatter = (file) => {
  const text = fs.readFileSync(file, 'utf8');
  const get = (key, fallback = '') => text.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'))?.[1]?.trim() || fallback;
  return { kind: get('kind', 'PAGE'), parent: get('parent_page', 'null'), aliases: get('aliases', '[]') };
};

const testsFor = (entry) => entry.tests.split(', ').map((test) => `tests/build-09/${test}`);
const tick = String.fromCharCode(96);
const list = (text) => text.split(', ').map((value) => `- ${tick}${value}${tick}`).join('\n');
const gapList = (text, id) => text.split('; ').map((gap, index) => {
  const match = gap.match(/^(P[0-3])\\s+([A-Z_]+)\\s+—\\s+(.*)$/);
  const parsed = gap.match(/^(P[0-3])\s+([A-Z_]+)\s+/);
  const severity = parsed?.[1] || match?.[1] || 'P1';
  const type = parsed?.[2] || match?.[2] || 'WORKFLOW';
  const body = parsed ? gap.slice(parsed[0].length).replace(/^[^A-Za-z0-9]+/, '') : (match?.[3] || gap);
  return `- **PAGE-${id}-GAP-${String(index + 1).padStart(3, '0')}** (${severity}, ${type}) — ${body}`;
}).join('\n');

const domainSourceFor = (module) => {
  if (module.includes('topology')) return 'platform/wms/topology.mjs';
  if (module.includes('putaway')) return 'platform/wms/putaway.mjs';
  if (module.includes('mobile-receiving')) return 'platform/wms/receiving.mjs';
  if (module.includes('mobile-picking') || module.includes('pick-task')) return 'platform/wms/picking.mjs';
  if (module.includes('wave')) return 'platform/wms/waves.mjs';
  if (module.includes('count')) return 'platform/wms/cycle-counting.mjs';
  if (module.includes('dock')) return 'platform/wms/docks.mjs';
  if (module.includes('trace') || module.includes('expiration')) return 'platform/wms/traceability-ops.mjs';
  if (module.includes('quality')) return 'platform/quality/operations.mjs';
  if (module.includes('production')) return 'platform/manufacturing/material-flow.mjs';
  return 'platform/manufacturing/downtime-performance.mjs';
};

function renderSpec(id, entry) {
  const file = path.join(ROOT, 'ops', `${id}.md`);
  const old = readFrontmatter(file);
  const modulePath = `modules/${entry.module}`;
  const sourceFiles = [modulePath, 'platform/api/build09.mjs', 'platform/wms/index.mjs', 'services/permissionService.js'];
  const testFiles = testsFor(entry);
  const parent = old.parent === 'null' ? 'null' : old.parent;
  return `---
page_id: "${id}"
title_en: "${entry.title}"
title_ar: ""
domain: "ops"
navigation_group: "ops_inventory"
kind: ${old.kind}
canonical_status: "PRIMARY"
canonical_home: "${id}"
parent_page: ${parent}
aliases: ${old.aliases}
roles: ["workshop.user"]
permission: "workshop.user"
entitlement: "none/global"
renderer_type: "javascript"
renderer_sources: ["${modulePath}"]
view_sources: []
api_sources: ["platform/api/build09.mjs"]
domain_sources: ["${modulePath}", "platform/wms/index.mjs", "${domainSourceFor(entry.module)}"]
tables_or_entities: ["${entry.tables.split(', ').join('", "')}"]
test_sources: ["${testFiles.join('", "')}"]
catalog_baseline_sha: "${CATALOG_BASELINE}"
last_verified_sha: "${ENGINEERING_REFERENCE}"
engineering_reference_sha: "${ENGINEERING_REFERENCE}"
evidence_confidence: "HIGH"
implementation_status: "${entry.status === 'ALREADY_IMPLEMENTED' ? 'IMPLEMENTED_AT_ENGINEERING_REFERENCE' : 'PARTIAL_AT_ENGINEERING_REFERENCE'}"
functional_status: "CONNECTED"
usability_status: "${entry.usability}"
review_status: "REQUIRES_PRODUCT_RECOVERY"
---

# 1. Identity

- Page ID: \`${id}\`; English: ${entry.title}; domain: \`ops\`; navigation group: \`ops_inventory\`.
- Route: \`switchPage('${id}')\`; page-specific renderer is \`${modulePath}\`.
- Canonical status: PRIMARY. Embedded tabs and compatibility aliases are not treated as separate pages.

# 2. Business Purpose

${entry.goal}

# 3. Primary Users

- Declared client gate: \`workshop.user\`.
- Operational roles implied by the renderer/domain boundary: warehouse operator, reviewer/approver, and manager; exact role-to-action matrix remains a server-governance concern.

# 4. Primary User Goal

Complete the named operational workflow inside the active company and warehouse scope, with the page showing the resulting lifecycle state and any canonical handoff reference.

# 5. AS-IS Runtime Surface

- Renderer: \`${modulePath}\`; the module registers a page-specific BUILD-09 workspace/override rather than relying on the generic table shell.
- Data loading: \`${entry.query}\` through the governed Build-09 API/query boundary; mobile picking additionally uses the explicit pick-task GET route.
- Primary actions exposed by this page: ${entry.actions}.
- Visible behavior: page-specific loading, empty/muted, status/badge, validation/error, and success or handoff panels are present where the workflow reaches them.
- The page is operationally connected, but route activation alone is not persistence or isolation proof; this spec attributes those claims only to the cited domain and browser tests.

# 6. Data Sources

- UI → query/action boundary: \`platform/api/build09.mjs\`; every Build-09 query requires company context and an active warehouse belonging to that company.
- Renderer/domain source: \`${modulePath}\` → \`${entry.domain}\`.
- Persisted entities/tables: ${entry.tables}.
- Warehouse scope is injected as \`warehouse_id\`; server code rejects missing or out-of-scope warehouses instead of trusting client labels.

# 7. Actions

${list(entry.actions)}

- Each mutation is routed through \`/api/v1/action/:actionId\` (or the explicit governed API used by the mobile renderer), carries warehouse scope and idempotency where applicable, and is owned by the WMS/shop-floor/quality domain rather than by the page.
- Canonical boundary: where the action is a request or acknowledgement, this page records the request/result reference; canonical Inventory or Quality remains authoritative for the stock/inspection effect.

# 8. Inputs

- Governed selectors are used for warehouse locations/products where the renderer requires them; raw IDs are not sufficient evidence of authorization.
- Operational inputs include the record identifier, barcode/product/lot/serial evidence, quantity/reason, status decision, or canonical result reference according to the page family.
- Validation must reject missing required IDs, invalid quantities, warehouse mismatch, stale state, and maker-checker violations.

# 9. Outputs

- The page renders scoped records from \`${entry.query}\`, lifecycle/status badges, quantities and operational KPIs where applicable.
- Mutations persist into ${entry.tables} and refresh the query result; canonical handoff pages expose the returned request/result reference without claiming ownership of the canonical side effect.

# 10. Workflow Position

- Upstream: ${entry.upstream}.
- Downstream: ${entry.downstream}.
- Workflow edges above are taken from renderer query/action wiring and domain ownership, not from title similarity.

# 11. States

- LOADING: async query/action in progress; controls must be guarded against duplicate submission.
- READY: scoped records or an actionable form are visible.
- EMPTY: the page explains that no records/tasks/proposals exist in the current warehouse scope and offers the next valid action where the renderer supports one.
- DENIED: permission or warehouse-scope failure is rendered as a denied/error state; client navigation is not treated as authorization proof.
- VALIDATION_ERROR: missing required barcode/ID, invalid quantity, stale state, or maker-checker violation.
- SERVER_ERROR: API/domain failure remains visible and recoverable without inventing a success state.
- SUCCESS/HANDOFF: resulting status and canonical reference are shown after the domain operation succeeds.
- Domain status vocabulary is page-specific and is defined by the cited WMS/shop-floor/quality handler; do not collapse request, approved, awaiting_canonical, and completed into one state.

# 12. Permissions & Scope

- Client gate: \`workshop.user\`; server resource permission is mapped in \`BUILD09_RESOURCE_PERMISSIONS\` for the relevant resource family.
- Required server context: \`companyId\` plus an active \`warehouse_id\` that belongs to that company. The handler injects \`company_id\` and \`warehouse_id\` into domain reads.
- Mutations and approvals require action-specific authorization; a visible button is not proof that every role may execute it.

# 13. Arabic / English

- English label: ${entry.title}; Arabic label is owned by the navigation/module localization layer and must remain paired with the visible English action/state label.
- Any mojibake or missing translation in the inspected renderer is a usability defect, not a reason to infer a different business capability.

# 14. Responsive Requirements

- Desktop: list/detail or operational board must preserve scope, status, primary action, and error copy without horizontal loss.
- Mobile/scanner: controls must keep scan inputs, quantity/reason fields, and next action visible; direct mobile behavior is required for the two scanner workspaces and remains an explicit gap elsewhere.

# 15. AS-IS Functional Assessment

**${entry.status} / CONNECTED / ${entry.usability}** — The engineering reference contains a page-specific renderer, the cited Build-09 query/action boundary, and domain persistence evidence. This does not claim that every target contract or browser lifecycle is complete; the gaps below are the remaining proof/reconciliation work.

# 16. Target Business Contract

The page must load data for the active company/warehouse, expose only the actions appropriate to the current lifecycle state, persist through the named domain authority, show explicit loading/empty/denied/validation/server-error/success states, and preserve canonical ownership boundaries. A target implementation is not complete until the relevant lifecycle, permission/isolation, and browser evidence is attached.

# 17. Identified Gaps

${gapList(entry.gaps, id)}

# 18. Consolidation Analysis

- Remain a primary workspace: YES, pending owner review; the source navigation treats this as a primary destination and the renderer owns a distinct operational workflow.
- Do not consolidate solely because another page shares a query or table. Shared WMS resources are expected; independent user goals and lifecycle boundaries remain separate.
- Canonical home: \`${id}\` unless a later owner decision explicitly changes the navigation contract.

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error, page-specific surface in the active warehouse scope.
- Query results and mutation responses are company/warehouse isolated on the server.
- The primary workflow is executable with required validation and explicit state transitions; canonical handoffs show their request/result boundary.
- The cited focused contract/domain/browser tests pass, and a direct browser lifecycle proves the highest-risk transition identified above.

# 20. Test Evidence

- STATIC/CONTRACT: \`${modulePath}\`, \`platform/api/build09.mjs\`, \`platform/wms/index.mjs\`.
- BUILD-09 test sources:
${testFiles.map((test) => `- \`${test}\``).join('\n')}
- The 231-page navigation audit is route/visible-surface evidence only; it is not substituted for action, persistence, or isolation proof.

# 21. Known Limitations

- Catalog baseline: \`${CATALOG_BASELINE}\`; engineering reference researched: \`${ENGINEERING_REFERENCE}\`.
- This is documentation-only reconciliation. It does not modify engineering source, tests, migrations, or product documentation.
- Fixture availability and current server runtime state are not inferred from source wiring; they must be proven by the cited tests or a future direct browser run.

# 22. Source Evidence

${sourceFiles.map((source) => `- \`${source}\``).join('\n')}
- ${entry.domain.split('/').map((part) => `\`${part}\``).join(' → ')}

# 23. Change History

- ${DATE} — Wave 2 continuation: deepened from engineering reference \`${ENGINEERING_REFERENCE}\`; preserved catalog baseline \`${CATALOG_BASELINE}\`.

## CAPABILITIES OWNED

- ${entry.title} page-specific presentation, validation, and lifecycle orchestration at the cited module boundary.

## CAPABILITIES CONSUMED

- Build-09 scoped resources, action executor, domain persistence, canonical Inventory/Quality authority where applicable, and warehouse/company permission enforcement.
`;
}

for (const [id, entry] of Object.entries(pages)) {
  const file = path.join(ROOT, 'ops', `${id}.md`);
  if (!fs.existsSync(file)) throw new Error(`Missing catalog spec: ${file}`);
  fs.writeFileSync(file, renderSpec(id, entry));
}

const specFiles = fs.readdirSync(ROOT, { recursive: true }).filter((file) => file.endsWith('.md') && !file.includes('README') && !file.includes('INDEX') && !file.includes('COVERAGE') && !file.includes('CONTRADICTIONS') && !file.includes('HANDOFF') && !file.includes('STALE'));
const parse = (file) => {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const get = (key, fallback = '') => text.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'))?.[1]?.trim() || fallback;
  const quoted = (value) => value.replace(/^"|"$/g, '');
  const id = quoted(get('page_id'));
  return { id, pageId: id, title: quoted(get('title_en', id)), domain: quoted(get('domain', 'unknown')), kind: get('kind', 'PAGE'), canonicalStatus: quoted(get('canonical_status', 'PRIMARY')), parent: quoted(get('parent_page', 'null')), specPath: `./${file.split(path.sep).join('/')}`, functionalStatus: quoted(get('functional_status', 'NOT_VERIFIED')), usabilityStatus: quoted(get('usability_status', 'THIN')), recommendedDisposition: 'Retain and reconcile', upstream: [], downstream: [], aliases: [], capabilitiesOwned: [`${id}:workspace`], capabilitiesConsumed: ['Build-09 scoped API/domain boundary'], sourceFiles: [], catalogBaselineSha: quoted(get('catalog_baseline_sha', CATALOG_BASELINE)), lastVerifiedSha: quoted(get('last_verified_sha', ENGINEERING_REFERENCE)), engineeringReferenceSha: quoted(get('engineering_reference_sha', ENGINEERING_REFERENCE)) };
};
const manifestPages = specFiles.map(parse).filter((page) => page.id).sort((a, b) => a.id.localeCompare(b.id));
const enriched = manifestPages.map((page) => {
  const entry = pages[page.id];
  if (entry) {
    page.upstream = entry.upstream.split(', ').filter(Boolean);
    page.downstream = entry.downstream.split(', ').filter(Boolean);
    page.capabilitiesOwned = [`${page.id}:workspace`, ...entry.actions.split(', ').map((action) => `action:${action}`)];
    page.capabilitiesConsumed = [entry.query, entry.domain];
    page.sourceFiles = [`modules/${entry.module}`, 'platform/api/build09.mjs', 'platform/wms/index.mjs'];
  }
  return page;
});
const manifest = { schemaVersion: 2, catalogBaselineSha: CATALOG_BASELINE, lastVerifiedSha: ENGINEERING_REFERENCE, engineeringReferenceSha: ENGINEERING_REFERENCE, generatedAt: new Date().toISOString(), primaryWorkspaceCount: enriched.length, embeddedTabs: ['calculator', 'kanban', 'locations', 'workshop_tv'], compatibilityAliases: ['pos_deepening'], pages: enriched.map(({ id, ...page }) => page) };
fs.writeFileSync(path.join(ROOT, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const counts = enriched.reduce((out, page) => { const key = page.functionalStatus; out[key] = (out[key] || 0) + 1; return out; }, {});
const domains = enriched.reduce((out, page) => { out[page.domain] = (out[page.domain] || 0) + 1; return out; }, {});
const rows = enriched.map((page) => `| \`${page.id}\` | ${page.title} | ${page.domain} | ${page.kind} | ${page.canonicalStatus} | ${page.functionalStatus} | ${page.usabilityStatus} | ${page.recommendedDisposition} | [spec](${page.specPath}) |`).join('\n');
const countText = Object.entries(counts).map(([key, value]) => `**${key} ${value}**`).join(', ');
const domainText = Object.entries(domains).map(([key, value]) => `${tick}${key} ${value}${tick}`).join(', ');
fs.writeFileSync(path.join(ROOT, 'INDEX.md'), `# Octagon Page Specification Catalog\n\nCatalog baseline: \`${CATALOG_BASELINE}\`\nEngineering reference: \`${ENGINEERING_REFERENCE}\`\nPrimary workspaces: **${enriched.length}**\n\n## Wave 2 summary\n\n- Specs deepened in this wave: **${Object.keys(pages).length}**\n- Functional status counts: ${countText}\n- Domain counts: ${domainText}\n- Embedded tabs excluded: calculator, kanban, locations, workshop_tv\n- Compatibility alias excluded: pos_deepening\n\n## Primary pages\n\n| Page ID | Title | Domain | Kind | Canonical status | Functional | Usability | Disposition | Spec |\n|---|---|---|---|---|---|---|---|---|\n${rows}\n`);

const deepenedRows = Object.entries(pages).map(([id, entry]) => `| \`${id}\` | ${entry.title} | ${entry.status} | ${entry.query} | ${entry.actions} | \`ops/${id}.md\` |`).join('\n');
fs.writeFileSync(path.join(ROOT, 'COVERAGE.md'), `# Coverage and Wave 2 Reconciliation\n\n## Evidence boundary\n\n- Catalog baseline: \`${CATALOG_BASELINE}\`\n- Engineering reference: \`${ENGINEERING_REFERENCE}\`\n- Primary navigation population: **${enriched.length}** pages; embedded tabs and compatibility aliases remain outside the primary count.\n- This wave deepened **${Object.keys(pages).length}** high-priority BUILD-09 operational pages.\n\n## Wave 2 pages\n\n| Page | Title | AS-IS classification | Query/data path | Primary action path | Spec |\n|---|---|---|---|---|---|\n${deepenedRows}\n\n## Coverage interpretation\n\nThe page is counted as documented when its manifest entry and spec exist. “CONNECTED” means source evidence connects renderer, scoped resource/action boundary, and domain owner; it is not a claim that every target behavior is complete. “ALREADY_IMPLEMENTED” and “PARTIALLY_IMPLEMENTED” are deliberately separate from test completeness. Missing direct lifecycle, fixture, responsive, or role-isolation evidence remains listed in each spec's gaps.\n\n## Not covered by this wave\n\n- No source/product/test implementation was changed.\n- No engineering worktree files were written.\n- Build-12 commercial remediation and unrelated domains remain outside this continuation wave.\n`);

fs.writeFileSync(path.join(ROOT, 'CROSS_PAGE_CONTRADICTIONS.md'), `# Cross-page Contradictions and Boundaries\n\nCatalog baseline: \`${CATALOG_BASELINE}\`  \nEngineering reference: \`${ENGINEERING_REFERENCE}\`\n\n## Findings\n\n| ID | Boundary | Evidence | Required reconciliation |\n|---|---|---|---|\n| C-001 | Canonical stock authority | Receiving, picking, putaway, cross-dock, count adjustment, production material, and scrap modules request/acknowledge canonical results; their WMS tables store workflow state, not a second stock ledger. | Keep request, awaiting_canonical, acknowledged, and completed distinct; never describe a page action as direct stock posting unless the cited canonical handler proves it. |\n| C-002 | Warehouse scope | \`platform/api/build09.mjs\` requires company context and validates active warehouse membership for every resource family. | Client labels and raw IDs are insufficient; every spec and browser proof must show warehouse isolation. |\n| C-003 | Receiving versus putaway | Mobile Receiving completes at \`putaway_pending\`; Putaway Task Queue owns the subsequent physical destination task. | Do not mark a receipt complete merely because canonical Inventory posted the inbound move. |\n| C-004 | Wave Planning versus Wave Execution | Planning creates/calculates/reviews; execution releases, refreshes, cancels, and completes. | Keep creator/reviewer and release boundaries separate in UI and acceptance evidence. |\n| C-005 | Quality versus Inventory | Quality Hold, Rework, and Scrap decide or request dispositions; canonical Inventory owns stock movement. | Quality pages may acknowledge a verified canonical result but must not invent inventory authority. |\n| C-006 | Operational Performance missing data | The performance renderer preserves null/unreliable rates as “not available” and explains the missing evidence. | Never convert absent timing/output evidence into 0% or 100%. |\n| C-007 | Traceability identity | Trace queries require lot_id or serial_id and validate product/lot/serial consistency. | Identity mismatch is a validation error; it is not an empty trace. |\n| C-008 | Mobile scanner flows | Mobile Receiving and Mobile Picking use stepwise scanning, while desktop queues use list/detail workspaces. | Share domain actions, not assumptions about controls or responsive proof. |\n\n## Duplicate or consolidation candidates\n\nNone identified from source evidence. Shared tables/resources are intentional cross-page workflow dependencies, not proof that the primary pages are duplicates.\n`);

fs.writeFileSync(path.join(ROOT, 'ENGINEERING_HANDOFF.md'), `# Engineering Handoff — Page Specification Catalog Wave 2\n\n## Reproducibility\n\n- Documentation branch: \`codex/octagon-page-spec-catalog\`\n- Catalog start/baseline SHA: \`${CATALOG_BASELINE}\`\n- Engineering reference SHA: \`${ENGINEERING_REFERENCE}\`\n- Scope: documentation files under \`docs/page-specs/**\` only.\n\n## Completed documentation batch\n\n- Deepened **${Object.keys(pages).length}** BUILD-09 operational page specifications.\n- Added synchronized coverage, contradiction, and handoff artifacts.\n- Enriched every manifest page with \`pageId/specPath/domain/kind/canonicalStatus/parent/aliases/upstream/downstream/capabilitiesOwned/capabilitiesConsumed/sourceFiles/catalogBaselineSha/lastVerifiedSha/engineeringReferenceSha/functionalStatus/usabilityStatus/recommendedDisposition\`.\n- Regenerated \`INDEX.md\` from the manifest population.\n\n## Engineering facts to preserve\n\n- Build-09 resources are server-scoped by company and active warehouse.\n- Canonical Inventory/Quality remains authoritative for stock and inspection effects; page workflows store orchestration state and canonical references.\n- The highest-risk remaining work is evidence: direct lifecycle browser proof, fixture readiness, maker-checker/role isolation, and responsive scanner behavior.\n\n## Next recommended documentation wave\n\n1. Reconcile the next highest-priority undocumented/THIN ops pages against their real renderer and API/domain modules.\n2. Attach any newly discovered cross-page edges to \`CROSS_PAGE_CONTRADICTIONS.md\` rather than silently changing ownership.\n3. Keep engineering changes in the dedicated engineering worktree and update the reference SHA before researching a later wave.\n`);

console.log(JSON.stringify({ deepened: Object.keys(pages).length, manifestPages: enriched.length, catalogBaseline: CATALOG_BASELINE, engineeringReference: ENGINEERING_REFERENCE }, null, 2));
