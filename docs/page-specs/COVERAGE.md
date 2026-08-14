# Coverage and Wave 2 Reconciliation

## Evidence boundary

- Catalog baseline: `aa730dd23462aab3e90b70ad2db1bf6cc945ca99`
- Engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`
- Primary navigation population: **231** pages; embedded tabs and compatibility aliases remain outside the primary count.
- This wave deepened **32** high-priority BUILD-09 operational pages.

## Wave 2 pages

| Page | Title | AS-IS classification | Query/data path | Primary action path | Spec |
|---|---|---|---|---|---|
| `warehouse_topology` | Warehouse Topology | ALREADY_IMPLEMENTED | hierarchy, zones, locations, capacity | wms:zone_create, wms:location_create | `ops/warehouse_topology.md` |
| `zone_bin_management` | Zone and Bin Management | PARTIALLY_IMPLEMENTED | zones, locations, capacity | wms:zone_create, wms:location_create | `ops/zone_bin_management.md` |
| `putaway_rules` | Putaway Rules | PARTIALLY_IMPLEMENTED | putaway-rules | wms:putaway_rule_create, wms:putaway_rule_update, wms:putaway_recommend | `ops/putaway_rules.md` |
| `putaway_task_queue` | Putaway Task Queue | ALREADY_IMPLEMENTED | putaway-queue, tasks | wms:task_scan_source, wms:task_scan_destination, wms:task_request_canonical, wms:task_acknowledge_canonical | `ops/putaway_task_queue.md` |
| `replenishment_rules` | Replenishment Rules | PARTIALLY_IMPLEMENTED | replenishment-rules | wms:replenishment_rule_create | `ops/replenishment_rules.md` |
| `replenishment_proposals` | Replenishment Proposals | PARTIALLY_IMPLEMENTED | replenishment-proposals | wms:replenishment_calculate, wms:replenishment_cancel | `ops/replenishment_proposals.md` |
| `mobile_receiving` | Mobile Receiving | ALREADY_IMPLEMENTED | direct session actions; receiving-sessions is the authoritative list resource | wms:receiving_start, wms:receiving_scan_reference, wms:receiving_scan_product, wms:receiving_review, wms:receiving_request_post, wms:receiving_acknowledge_post, wms:receiving_complete | `ops/mobile_receiving.md` |
| `receiving_discrepancies` | Receiving Discrepancies | ALREADY_IMPLEMENTED | receiving-discrepancies | wms:receiving_discrepancy_approve | `ops/receiving_discrepancies.md` |
| `mobile_picking` | Mobile Picking | ALREADY_IMPLEMENTED | GET /api/v1/wms/pick-tasks?warehouse_id=... | wms:pick_task_assign, wms:pick_scan_source, wms:pick_scan_product, wms:pick_confirm, wms:pick_stage, wms:pick_request_post, wms:pick_acknowledge_post | `ops/mobile_picking.md` |
| `pick_task_queue` | Pick Task Queue | ALREADY_IMPLEMENTED | pick-tasks | wms:pick_task_assign | `ops/pick_task_queue.md` |
| `wave_planning` | Wave Planning | ALREADY_IMPLEMENTED | pick-tasks | wms:wave_create, wms:wave_calculate, wms:wave_review | `ops/wave_planning.md` |
| `wave_execution` | Wave Execution | ALREADY_IMPLEMENTED | waves | wms:wave_release, wms:wave_refresh_progress, wms:wave_cancel, wms:wave_complete | `ops/wave_execution.md` |
| `cycle_count_plans` | Cycle Count Plans | ALREADY_IMPLEMENTED | count-plans | wms:count_plan_create | `ops/cycle_count_plans.md` |
| `count_session` | Count Session | ALREADY_IMPLEMENTED | count-sessions | wms:count_session_start, wms:count_line_record, wms:count_submit | `ops/count_session.md` |
| `variance_review` | Variance Review | ALREADY_IMPLEMENTED | count-sessions | wms:count_approve_variance, wms:count_recount, wms:count_request_adjustment | `ops/variance_review.md` |
| `dock_schedule` | Dock Schedule | ALREADY_IMPLEMENTED | docks, dock-appointments | wms:dock_appointment_create, wms:dock_cancel | `ops/dock_schedule.md` |
| `dock_checkin` | Dock Check-in | ALREADY_IMPLEMENTED | dock-appointments | wms:dock_check_in, wms:dock_assign | `ops/dock_checkin.md` |
| `staging_board` | Staging Board | ALREADY_IMPLEMENTED | staging-allocations, locations | wms:staging_allocate, wms:staging_release | `ops/staging_board.md` |
| `crossdock_workspace` | Cross-dock Workspace | PARTIALLY_IMPLEMENTED | crossdock-matches, locations | wms:crossdock_evaluate, wms:crossdock_acknowledge_post | `ops/crossdock_workspace.md` |
| `lot_serial_traceability` | Lot and Serial Traceability | ALREADY_IMPLEMENTED | trace (lot_id or serial_id required) | read/query only in this workspace; profile mutation is domain-supported by traceability-ops | `ops/lot_serial_traceability.md` |
| `expiration_queue` | Expiration Queue | ALREADY_IMPLEMENTED | expiration-queue | wms:trace_quality_set | `ops/expiration_queue.md` |
| `recall_analysis` | Recall Analysis | ALREADY_IMPLEMENTED | recall-cases | wms:recall_identify, wms:recall_analyze, wms:recall_propose_holds | `ops/recall_analysis.md` |
| `shopfloor_terminal` | Shopfloor Terminal | ALREADY_IMPLEMENTED | shopfloor-sessions, shopfloor-timeline, shopfloor-board | shopfloor:operation_output, shopfloor:operation_acknowledge, shopfloor:operator_assign, shopfloor:operation_handoff | `ops/shopfloor_terminal.md` |
| `workcenter_queue` | Work-center Queue | ALREADY_IMPLEMENTED | shopfloor-sessions, shopfloor-board | shopfloor:operator_assign, shopfloor:operation_handoff | `ops/workcenter_queue.md` |
| `production_material_requests` | Production Material Requests | ALREADY_IMPLEMENTED | material-flow | shopfloor:material_request, shopfloor:material_availability, shopfloor:material_approve | `ops/production_material_requests.md` |
| `production_issue_return` | Production Issue and Return | ALREADY_IMPLEMENTED | material-flow | shopfloor:material_request_canonical, shopfloor:material_acknowledge | `ops/production_issue_return.md` |
| `production_receipt` | Production Receipt | ALREADY_IMPLEMENTED | material-flow | shopfloor:material_request_canonical, shopfloor:material_acknowledge | `ops/production_receipt.md` |
| `quality_hold_queue` | Quality Hold Queue | ALREADY_IMPLEMENTED | quality-checkpoints | quality:checkpoint_sync, quality:checkpoint_conditional_accept, quality:disposition_request | `ops/quality_hold_queue.md` |
| `rework_workspace` | Rework Workspace | ALREADY_IMPLEMENTED | rework-routes | quality:rework_start, quality:rework_complete | `ops/rework_workspace.md` |
| `scrap_approval` | Scrap Approval | ALREADY_IMPLEMENTED | quality-dispositions | quality:disposition_approve, quality:scrap_request_canonical, quality:scrap_acknowledge | `ops/scrap_approval.md` |
| `downtime_board` | Downtime Board | ALREADY_IMPLEMENTED | downtime, shopfloor-sessions | shopfloor:downtime_start, shopfloor:downtime_end | `ops/downtime_board.md` |
| `operational_performance` | Operational Performance | ALREADY_IMPLEMENTED | work-center-performance, shopfloor-sessions | read-only analytics; no mutation action exposed | `ops/operational_performance.md` |

## Coverage interpretation

The page is counted as documented when its manifest entry and spec exist. “CONNECTED” means source evidence connects renderer, scoped resource/action boundary, and domain owner; it is not a claim that every target behavior is complete. “ALREADY_IMPLEMENTED” and “PARTIALLY_IMPLEMENTED” are deliberately separate from test completeness. Missing direct lifecycle, fixture, responsive, or role-isolation evidence remains listed in each spec's gaps.

## Not covered by this wave

- No source/product/test implementation was changed.
- No engineering worktree files were written.
- Build-12 commercial remediation and unrelated domains remain outside this continuation wave.
