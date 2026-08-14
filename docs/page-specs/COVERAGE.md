# Coverage and Forensic Deep Review — Wave 4

## Evidence boundary

- Wave 4 starting catalog SHA: `10152af1772bf9efba43cc42bb4226b73b63abca`.
- Moving engineering reference SHA: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Primary specs present: **231/231**.
- Prior deep reviews preserved: Wave 2 **32**, Wave 3 **26**.
- Wave 4 deep review: **26** pages.
- Total deep review: **84/231**; shallow remaining: **147**.

## Wave 4 pages

| Page | Evidence group | AS-IS classification | Disposition | View | Domain authority | Spec |
|---|---|---|---|---|---|---|
| `account_mapping` | consolidation | THIN | STRENGTHEN | views/account_mapping.html | platform/consolidation/index.mjs; platform/finance/engine.mjs | [spec](./finance/account_mapping.md) |
| `banking` | finance | THIN | STRENGTHEN | views/banking.html | platform/finance/engine.mjs; platform/finance/index.mjs; platform/api/finance.mjs | [spec](./finance/banking.md) |
| `budgeting` | finance | THIN | STRENGTHEN | views/budgeting.html | platform/finance/engine.mjs; platform/finance/index.mjs; platform/api/finance.mjs | [spec](./finance/budgeting.md) |
| `cashbox` | legacyFinance | PARTIALLY_CONNECTED | RETIRE_OR_MIGRATE | views/cashbox.html | platform/finance/engine.mjs; app.js legacy finance helpers | [spec](./finance/cashbox.md) |
| `consolidated_reports` | consolidation | THIN | STRENGTHEN | views/consolidated_reports.html | platform/consolidation/index.mjs; platform/finance/engine.mjs | [spec](./finance/consolidated_reports.md) |
| `consolidation_groups` | consolidation | THIN | STRENGTHEN | views/consolidation_groups.html | platform/consolidation/index.mjs; platform/finance/engine.mjs | [spec](./finance/consolidation_groups.md) |
| `consolidation_lineage` | consolidation | THIN | STRENGTHEN | views/consolidation_lineage.html | platform/consolidation/index.mjs; platform/finance/engine.mjs | [spec](./finance/consolidation_lineage.md) |
| `consolidation_runs` | consolidation | THIN | STRENGTHEN | views/consolidation_runs.html | platform/consolidation/index.mjs; platform/finance/engine.mjs | [spec](./finance/consolidation_runs.md) |
| `content_approvals` | workflow | PARTIALLY_CONNECTED | CONSOLIDATE_WITH_CANONICAL_RUNTIME | views/approvals.html | platform/workflow/index.mjs; app.js workflow canvas helpers | [spec](./commercial/content_approvals.md) |
| `eliminations` | consolidation | THIN | STRENGTHEN | views/eliminations.html | platform/consolidation/index.mjs; platform/finance/engine.mjs | [spec](./finance/eliminations.md) |
| `expenses` | legacyFinance | PARTIALLY_CONNECTED | RETIRE_OR_MIGRATE | views/expenses.html | platform/finance/engine.mjs; app.js legacy finance helpers | [spec](./finance/expenses.md) |
| `financing_facilities` | treasury | THIN | STRENGTHEN | views/financing_facilities.html | platform/finance/planning-treasury-intercompany.mjs; platform/treasury/liquidity.mjs | [spec](./finance/financing_facilities.md) |
| `income` | legacyFinance | PARTIALLY_CONNECTED | RETIRE_OR_MIGRATE | views/income.html | platform/finance/engine.mjs; app.js legacy finance helpers | [spec](./finance/income.md) |
| `intercompany_reconciliation` | intercompany | THIN | STRENGTHEN | views/intercompany_reconciliation.html | platform/intercompany/operations.mjs; platform/finance/planning-treasury-intercompany.mjs | [spec](./finance/intercompany_reconciliation.md) |
| `intercompany_transactions` | intercompany | THIN | STRENGTHEN | views/intercompany_transactions.html | platform/intercompany/operations.mjs; platform/finance/planning-treasury-intercompany.mjs | [spec](./finance/intercompany_transactions.md) |
| `liquidity_forecast` | treasury | THIN | STRENGTHEN | views/liquidity_forecast.html | platform/finance/planning-treasury-intercompany.mjs; platform/treasury/liquidity.mjs | [spec](./finance/liquidity_forecast.md) |
| `mismatch_queue` | intercompany | THIN | STRENGTHEN | views/mismatch_queue.html | platform/intercompany/operations.mjs; platform/finance/planning-treasury-intercompany.mjs | [spec](./finance/mismatch_queue.md) |
| `payment_funding_proposals` | treasury | THIN | STRENGTHEN | views/payment_funding_proposals.html | platform/finance/planning-treasury-intercompany.mjs; platform/treasury/liquidity.mjs | [spec](./finance/payment_funding_proposals.md) |
| `service_kiosk` | service | CONNECTED | KEEP_PRIMARY | views/kiosk.html | platform/kiosk/index.mjs; platform/kiosk/kiosk-registry.mjs; platform/kiosk/operational-boards.mjs; platform/service/index.mjs | [spec](./ops/service_kiosk.md) |
| `employee_kiosk` | service | CONNECTED | KEEP_PRIMARY | views/kiosk.html | platform/kiosk/index.mjs; platform/kiosk/kiosk-registry.mjs; platform/kiosk/operational-boards.mjs; platform/service/index.mjs | [spec](./ops/employee_kiosk.md) |
| `warehouse_kiosk` | service | CONNECTED | KEEP_PRIMARY | views/kiosk.html | platform/kiosk/index.mjs; platform/kiosk/kiosk-registry.mjs; platform/kiosk/operational-boards.mjs; platform/service/index.mjs | [spec](./ops/warehouse_kiosk.md) |
| `kiosk_device_registry` | service | CONNECTED | KEEP_PRIMARY | views/kiosk.html | platform/kiosk/index.mjs; platform/kiosk/kiosk-registry.mjs; platform/kiosk/operational-boards.mjs; platform/service/index.mjs | [spec](./ops/kiosk_device_registry.md) |
| `tax_compliance` | tax | PARTIALLY_CONNECTED | KEEP_PRIMARY | views/tax_compliance.html | platform/finance/engine.mjs; platform/finance/index.mjs; modules/tax-compliance.js | [spec](./finance/tax_compliance.md) |
| `treasury_alerts` | treasury | THIN | STRENGTHEN | views/treasury_alerts.html | platform/finance/planning-treasury-intercompany.mjs; platform/treasury/liquidity.mjs | [spec](./finance/treasury_alerts.md) |
| `treasury_cash_position` | treasury | THIN | STRENGTHEN | views/treasury_cash_position.html | platform/finance/planning-treasury-intercompany.mjs; platform/treasury/liquidity.mjs | [spec](./finance/treasury_cash_position.md) |
| `workflow` | workflow | PARTIALLY_CONNECTED | CONSOLIDATE_WITH_CANONICAL_RUNTIME | views/workflow.html | platform/workflow/index.mjs; app.js workflow canvas helpers | [spec](./ops/workflow.md) |

## Coverage by domain

| Domain | Specs present | Deep reviewed | Shallow remaining |
|---|---:|---:|---:|
| `admin` | 13 | 0 | 13 |
| `commercial` | 43 | 8 | 35 |
| `core` | 11 | 1 | 10 |
| `finance` | 25 | 25 | 0 |
| `intelligence` | 19 | 0 | 19 |
| `ops` | 72 | 44 | 28 |
| `resources` | 48 | 6 | 42 |

## Wave 2 historical record

Wave 2 deepened 32 BUILD-09 pages; those pages were not redone.

| Page | Title | Domain | Functional | Usability | Spec |
|---|---|---|---|---|---|
| `count_session` | Count Session | ops | CONNECTED | USABLE | [spec](./ops/count_session.md) |
| `crossdock_workspace` | Cross-dock Workspace | ops | CONNECTED | USABLE | [spec](./ops/crossdock_workspace.md) |
| `cycle_count_plans` | Cycle Count Plans | ops | CONNECTED | USABLE | [spec](./ops/cycle_count_plans.md) |
| `dock_checkin` | Dock Check-in | ops | CONNECTED | USABLE | [spec](./ops/dock_checkin.md) |
| `dock_schedule` | Dock Schedule | ops | CONNECTED | USABLE | [spec](./ops/dock_schedule.md) |
| `downtime_board` | Downtime Board | ops | CONNECTED | USABLE | [spec](./ops/downtime_board.md) |
| `expiration_queue` | Expiration Queue | ops | CONNECTED | USABLE | [spec](./ops/expiration_queue.md) |
| `lot_serial_traceability` | Lot and Serial Traceability | ops | CONNECTED | USABLE | [spec](./ops/lot_serial_traceability.md) |
| `mobile_picking` | Mobile Picking | ops | CONNECTED | USABLE | [spec](./ops/mobile_picking.md) |
| `mobile_receiving` | Mobile Receiving | ops | CONNECTED | USABLE | [spec](./ops/mobile_receiving.md) |
| `operational_performance` | Operational Performance | ops | CONNECTED | USABLE | [spec](./ops/operational_performance.md) |
| `pick_task_queue` | Pick Task Queue | ops | CONNECTED | USABLE | [spec](./ops/pick_task_queue.md) |
| `production_issue_return` | Production Issue and Return | ops | CONNECTED | USABLE | [spec](./ops/production_issue_return.md) |
| `production_material_requests` | Production Material Requests | ops | CONNECTED | USABLE | [spec](./ops/production_material_requests.md) |
| `production_receipt` | Production Receipt | ops | CONNECTED | USABLE | [spec](./ops/production_receipt.md) |
| `putaway_rules` | Putaway Rules | ops | CONNECTED | USABLE | [spec](./ops/putaway_rules.md) |
| `putaway_task_queue` | Putaway Task Queue | ops | CONNECTED | USABLE | [spec](./ops/putaway_task_queue.md) |
| `quality_hold_queue` | Quality Hold Queue | ops | CONNECTED | USABLE | [spec](./ops/quality_hold_queue.md) |
| `recall_analysis` | Recall Analysis | ops | CONNECTED | USABLE | [spec](./ops/recall_analysis.md) |
| `receiving_discrepancies` | Receiving Discrepancies | ops | CONNECTED | USABLE | [spec](./ops/receiving_discrepancies.md) |
| `replenishment_proposals` | Replenishment Proposals | ops | CONNECTED | USABLE | [spec](./ops/replenishment_proposals.md) |
| `replenishment_rules` | Replenishment Rules | ops | CONNECTED | USABLE | [spec](./ops/replenishment_rules.md) |
| `rework_workspace` | Rework Workspace | ops | CONNECTED | USABLE | [spec](./ops/rework_workspace.md) |
| `scrap_approval` | Scrap Approval | ops | CONNECTED | USABLE | [spec](./ops/scrap_approval.md) |
| `shopfloor_terminal` | Shopfloor Terminal | ops | CONNECTED | USABLE | [spec](./ops/shopfloor_terminal.md) |
| `staging_board` | Staging Board | ops | CONNECTED | USABLE | [spec](./ops/staging_board.md) |
| `variance_review` | Variance Review | ops | CONNECTED | USABLE | [spec](./ops/variance_review.md) |
| `warehouse_topology` | Warehouse Topology | ops | CONNECTED | USABLE | [spec](./ops/warehouse_topology.md) |
| `wave_execution` | Wave Execution | ops | CONNECTED | USABLE | [spec](./ops/wave_execution.md) |
| `wave_planning` | Wave Planning | ops | CONNECTED | USABLE | [spec](./ops/wave_planning.md) |
| `workcenter_queue` | Work-center Queue | ops | CONNECTED | USABLE | [spec](./ops/workcenter_queue.md) |
| `zone_bin_management` | Zone and Bin Management | ops | CONNECTED | USABLE | [spec](./ops/zone_bin_management.md) |

## Wave 3 historical record

Wave 3 deepened 26 workshop, commercial, procurement, project, service, and finance-handoff pages; those pages were not redone.

| Page | Title | Domain | Functional | Usability | Spec |
|---|---|---|---|---|---|
| `approvals` | Approvals | resources | CONNECTED | STRONG | [spec](./resources/approvals.md) |
| `ar_ap` | Ar Ap | finance | CONNECTED | USABLE | [spec](./finance/ar_ap.md) |
| `contracts` | Contracts | resources | THIN | THIN | [spec](./resources/contracts.md) |
| `customer_portal` | Customer Portal | commercial | CONNECTED | USABLE | [spec](./commercial/customer_portal.md) |
| `customers` | Customers | finance | CONNECTED | USABLE | [spec](./finance/customers.md) |
| `field_service` | Field Service | commercial | PARTIALLY_CONNECTED | THIN | [spec](./commercial/field_service.md) |
| `finance` | Finance | finance | CONNECTED | USABLE | [spec](./finance/finance.md) |
| `finance_installments` | Finance Installments | finance | SIMULATED_BY_DESIGN | THIN | [spec](./finance/finance_installments.md) |
| `fleet_operations_board` | Fleet Operations Board | ops | THIN | THIN | [spec](./ops/fleet_operations_board.md) |
| `logistics` | Logistics | resources | THIN | THIN | [spec](./resources/logistics.md) |
| `my_work` | My Work | core | CONNECTED | USABLE | [spec](./core/my_work.md) |
| `parties` | Customers &amp; Suppliers | ops | CONNECTED | USABLE | [spec](./ops/parties.md) |
| `procurement` | Procurement | resources | CONNECTED | USABLE | [spec](./resources/procurement.md) |
| `projects` | Projects | resources | CONNECTED | USABLE | [spec](./resources/projects.md) |
| `sales` | Sales | commercial | CONNECTED | USABLE | [spec](./commercial/sales.md) |
| `sales_contracts` | Sales Contracts | commercial | SIMULATED_BY_DESIGN | THIN | [spec](./commercial/sales_contracts.md) |
| `sales_price_lists` | Sales Price Lists | commercial | CONNECTED | USABLE | [spec](./commercial/sales_price_lists.md) |
| `service_queue_board` | Service Queue Board | ops | CONNECTED | STRONG | [spec](./ops/service_queue_board.md) |
| `supplier_portal` | Supplier Portal | resources | THIN | THIN | [spec](./resources/supplier_portal.md) |
| `task_manager` | Task Manager | ops | CONNECTED | USABLE | [spec](./ops/task_manager.md) |
| `warranty` | Warranty | commercial | CONNECTED | THIN | [spec](./commercial/warranty.md) |
| `work_orders` | Work Orders | ops | THIN | THIN | [spec](./ops/work_orders.md) |
| `workshop_command_center` | Workshop Command Center | ops | CONNECTED | USABLE | [spec](./ops/workshop_command_center.md) |
| `workshop_ledger` | Workshop Ledger | finance | SIMULATED_BY_DESIGN | THIN | [spec](./finance/workshop_ledger.md) |
| `workshop_pack_setup` | Workshop Pack Setup | commercial | CONNECTED | USABLE | [spec](./commercial/workshop_pack_setup.md) |
| `workshop_readiness` | Workshop Readiness | ops | CONNECTED | USABLE | [spec](./ops/workshop_readiness.md) |

## Interpretation

Wave 4 intentionally selected the remaining shallow pages in the finance, treasury, intercompany/consolidation, workflow, tax, approval, and service-kiosk boundary set. A domain source or test is not attributed to a page as functional proof unless the page renderer/API wiring is also evidenced.
