# Octagon Page Specification Catalog

Catalog baseline: `aa730dd23462aab3e90b70ad2db1bf6cc945ca99`
Engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`
Primary workspaces: **231**

## Wave 2 summary

- Specs deepened in this wave: **32**
- Functional status counts: **THIN 89**, **CONNECTED 142**
- Domain counts: `finance 25`, `admin 13`, `intelligence 19`, `ops 72`, `commercial 43`, `resources 48`, `core 11`
- Embedded tabs excluded: calculator, kanban, locations, workshop_tv
- Compatibility alias excluded: pos_deepening

## Primary pages

| Page ID | Title | Domain | Kind | Canonical status | Functional | Usability | Disposition | Spec |
|---|---|---|---|---|---|---|---|---|
| `account_mapping` | Account Mapping | finance | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/account_mapping.md) |
| `admin_panel` | Admin Panel | admin | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./admin/admin_panel.md) |
| `ai_assistant` | AI Assistant | intelligence | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./intelligence/ai_assistant.md) |
| `ai_context_sources` | AI Context Sources | intelligence | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./intelligence/ai_context_sources.md) |
| `ai_factory` | Ai Factory | intelligence | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./intelligence/ai_factory.md) |
| `ai_overview` | AI Overview | intelligence | DASHBOARD | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./intelligence/ai_overview.md) |
| `ai_policy_registry` | AI Policy Registry | intelligence | SETUP | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./intelligence/ai_policy_registry.md) |
| `ai_prompt_templates` | AI Prompt Templates | intelligence | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./intelligence/ai_prompt_templates.md) |
| `ai_proposal_inbox` | AI Proposal Inbox | intelligence | QUEUE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./intelligence/ai_proposal_inbox.md) |
| `ai_queue` | Ai Queue | intelligence | QUEUE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./intelligence/ai_queue.md) |
| `ai_run_history` | AI Run History | intelligence | TRANSACTION | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./intelligence/ai_run_history.md) |
| `ai_status` | Ai Status | intelligence | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./intelligence/ai_status.md) |
| `ai_tools` | Ai Tools | intelligence | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./intelligence/ai_tools.md) |
| `alert_board` | Alert Board | ops | DASHBOARD | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./ops/alert_board.md) |
| `analytics` | Analytics | intelligence | ANALYTICS | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./intelligence/analytics.md) |
| `appointments` | Appointments | commercial | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./commercial/appointments.md) |
| `approvals` | Approvals | resources | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/approvals.md) |
| `ar_ap` | Ar Ap | finance | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/ar_ap.md) |
| `assets` | Assets | resources | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./resources/assets.md) |
| `attribution_insights` | Attribution Insights | commercial | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./commercial/attribution_insights.md) |
| `automation` | Automation | intelligence | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./intelligence/automation.md) |
| `banking` | Banking | finance | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/banking.md) |
| `billing_simulator` | Billing Simulator | commercial | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./commercial/billing_simulator.md) |
| `budgeting` | Budgeting | finance | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/budgeting.md) |
| `calendar` | Calendar | core | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./core/calendar.md) |
| `campaigns` | Campaigns | commercial | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./commercial/campaigns.md) |
| `canonical_console` | Canonical Operations | ops | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/canonical_console.md) |
| `canonical_inventory` | Canonical Inventory | ops | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/canonical_inventory.md) |
| `cashbox` | Cashbox | finance | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./finance/cashbox.md) |
| `clinic` | Clinic | commercial | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./commercial/clinic.md) |
| `command_center` | Command Center | ops | DASHBOARD | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./ops/command_center.md) |
| `commercial_plans` | Commercial Plans | commercial | SETUP | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./commercial/commercial_plans.md) |
| `competency_profiles` | Competency Profiles | resources | SETUP | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/competency_profiles.md) |
| `configuration_profiles` | Configuration Profiles | resources | SETUP | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/configuration_profiles.md) |
| `conflict_resolution` | Conflict Resolution | resources | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/conflict_resolution.md) |
| `consolidated_reports` | Consolidated Reports | finance | ANALYTICS | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/consolidated_reports.md) |
| `consolidation_groups` | Consolidation Groups | finance | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/consolidation_groups.md) |
| `consolidation_lineage` | Consolidation Lineage | finance | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/consolidation_lineage.md) |
| `consolidation_runs` | Consolidation Runs | finance | TRANSACTION | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/consolidation_runs.md) |
| `content_approvals` | Content Approvals | commercial | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./commercial/content_approvals.md) |
| `content_calendar` | Content Calendar | commercial | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./commercial/content_calendar.md) |
| `contracts` | Contracts | resources | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./resources/contracts.md) |
| `count_session` | Count Session | ops | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/count_session.md) |
| `crossdock_workspace` | Cross-dock Workspace | ops | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/crossdock_workspace.md) |
| `customer_portal` | Customer Portal | commercial | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./commercial/customer_portal.md) |
| `customers` | Customers | finance | LIST | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./finance/customers.md) |
| `cycle_count_plans` | Cycle Count Plans | ops | SETUP | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/cycle_count_plans.md) |
| `data_quality` | Data Quality | admin | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./admin/data_quality.md) |
| `demand_planning` | Demand Planning | ops | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./ops/demand_planning.md) |
| `deploy_ready` | Deploy Ready | admin | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./admin/deploy_ready.md) |
| `development_plans` | Development Plans | resources | SETUP | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/development_plans.md) |
| `device_alerts` | Device Alerts | resources | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/device_alerts.md) |
| `device_center` | Device Center | admin | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./admin/device_center.md) |
| `device_command_center` | Device Command Center | resources | DASHBOARD | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/device_command_center.md) |
| `device_detail` | Device Detail | resources | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/device_detail.md) |
| `device_enrollment` | Device Enrollment | resources | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/device_enrollment.md) |
| `device_health_board` | Device Health Board | ops | DASHBOARD | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./ops/device_health_board.md) |
| `device_health_center` | Device Health Center | resources | DASHBOARD | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/device_health_center.md) |
| `device_registry` | Device Registry | resources | SETUP | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/device_registry.md) |
| `dock_checkin` | Dock Check-in | ops | TRANSACTION | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/dock_checkin.md) |
| `dock_schedule` | Dock Schedule | ops | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/dock_schedule.md) |
| `documents` | Documents | resources | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./resources/documents.md) |
| `downtime_board` | Downtime Board | ops | DASHBOARD | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/downtime_board.md) |
| `eliminations` | Eliminations | finance | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/eliminations.md) |
| `employee_kiosk` | Employee Kiosk | ops | KIOSK | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./ops/employee_kiosk.md) |
| `employee_mobile` | Employee Mobile | core | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./core/employee_mobile.md) |
| `employee_ui` | Employee Ui | admin | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./admin/employee_ui.md) |
| `employees` | Employees | core | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./core/employees.md) |
| `entitlements` | Entitlements | commercial | SETUP | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./commercial/entitlements.md) |
| `equipment` | Equipment | ops | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/equipment.md) |
| `esign` | Esign | resources | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./resources/esign.md) |
| `event_checkin` | Event Check-in | commercial | TRANSACTION | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./commercial/event_checkin.md) |
| `event_planner` | Event Planner | commercial | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./commercial/event_planner.md) |
| `event_registrations` | Event Registrations | commercial | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./commercial/event_registrations.md) |
| `events` | Events | commercial | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./commercial/events.md) |
| `events_overview` | Events Overview | commercial | DASHBOARD | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./commercial/events_overview.md) |
| `expenses` | Expenses | finance | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./finance/expenses.md) |
| `expiration_queue` | Expiration Queue | ops | QUEUE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/expiration_queue.md) |
| `extension_installations` | Extension Installations | commercial | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./commercial/extension_installations.md) |
| `extension_marketplace` | Extension Marketplace | commercial | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./commercial/extension_marketplace.md) |
| `field_service` | Field Service | commercial | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./commercial/field_service.md) |
| `finance` | Finance | finance | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./finance/finance.md) |
| `finance_installments` | Finance Installments | finance | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/finance_installments.md) |
| `financing_facilities` | Financing Facilities | finance | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/financing_facilities.md) |
| `firmware_catalogue` | Firmware Catalogue | resources | SETUP | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/firmware_catalogue.md) |
| `fleet` | Fleet | resources | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/fleet.md) |
| `fleet_device_mapping` | Fleet Device Mapping | resources | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/fleet_device_mapping.md) |
| `fleet_live_map_simulator` | Fleet Live Map Simulator | resources | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/fleet_live_map_simulator.md) |
| `fleet_operations_board` | Fleet Operations Board | ops | DASHBOARD | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./ops/fleet_operations_board.md) |
| `forecast_accuracy` | Forecast Accuracy | ops | ANALYTICS | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./ops/forecast_accuracy.md) |
| `forecast_overrides` | Forecast Overrides | ops | ANALYTICS | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./ops/forecast_overrides.md) |
| `forecast_versions` | Forecast Versions | ops | ANALYTICS | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./ops/forecast_versions.md) |
| `fuel_telemetry` | Fuel Telemetry | resources | ANALYTICS | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/fuel_telemetry.md) |
| `gateway_management` | Gateway Management | resources | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/gateway_management.md) |
| `geofence_events` | Geofence Events | resources | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/geofence_events.md) |
| `geofence_management` | Geofence Management | resources | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/geofence_management.md) |
| `help_manual` | Help Manual | core | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./core/help_manual.md) |
| `helpdesk` | Helpdesk | commercial | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./commercial/helpdesk.md) |
| `home` | Home | core | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./core/home.md) |
| `hotel` | Hotel | commercial | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./commercial/hotel.md) |
| `import` | Import | core | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./core/import.md) |
| `import_center` | Data Import | admin | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./admin/import_center.md) |
| `income` | Income | finance | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./finance/income.md) |
| `integration_hub` | Integration Hub | admin | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./admin/integration_hub.md) |
| `intelligence` | Intelligence | intelligence | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./intelligence/intelligence.md) |
| `intercompany_reconciliation` | Intercompany Reconciliation | finance | TRANSACTION | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/intercompany_reconciliation.md) |
| `intercompany_transactions` | Intercompany Transactions | finance | TRANSACTION | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/intercompany_transactions.md) |
| `inventory` | Inventory | ops | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/inventory.md) |
| `kiosk` | Kiosk | ops | KIOSK | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./ops/kiosk.md) |
| `kiosk_device_registry` | Kiosk Device Registry | ops | KIOSK | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./ops/kiosk_device_registry.md) |
| `knowledge` | Knowledge | resources | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./resources/knowledge.md) |
| `knowledge_base` | Knowledge Base | resources | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./resources/knowledge_base.md) |
| `learning_and_certifications` | Learning & Certifications | resources | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/learning_and_certifications.md) |
| `liquidity_forecast` | Liquidity Forecast | finance | ANALYTICS | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/liquidity_forecast.md) |
| `logistics` | Logistics | resources | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./resources/logistics.md) |
| `lot_serial_traceability` | Lot and Serial Traceability | ops | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/lot_serial_traceability.md) |
| `loyalty` | Loyalty | commercial | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./commercial/loyalty.md) |
| `machines` | Machines | ops | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/machines.md) |
| `maintenance_triggers` | Maintenance Triggers | resources | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/maintenance_triggers.md) |
| `marketing` | Marketing | commercial | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./commercial/marketing.md) |
| `marketing_overview` | Marketing Overview | commercial | DASHBOARD | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./commercial/marketing_overview.md) |
| `mismatch_queue` | Mismatch Queue | finance | QUEUE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/mismatch_queue.md) |
| `mobile_picking` | Mobile Picking | ops | KIOSK | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/mobile_picking.md) |
| `mobile_receiving` | Mobile Receiving | ops | KIOSK | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/mobile_receiving.md) |
| `mps` | Mps | ops | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./ops/mps.md) |
| `mps_proposals` | Mps Proposals | ops | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./ops/mps_proposals.md) |
| `mrp` | Mrp | ops | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./ops/mrp.md) |
| `multi_entity` | Multi Entity | admin | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./admin/multi_entity.md) |
| `my_work` | My Work | core | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./core/my_work.md) |
| `nl_reports` | Nl Reports | intelligence | ANALYTICS | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./intelligence/nl_reports.md) |
| `offline_capability_policies` | Offline Capability Policies | resources | SETUP | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/offline_capability_policies.md) |
| `offline_client_registry` | Offline Client Registry | resources | SETUP | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/offline_client_registry.md) |
| `offline_queue` | Offline Queue | resources | QUEUE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/offline_queue.md) |
| `omni_communications` | Omni Communications | commercial | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./commercial/omni_communications.md) |
| `op_packs` | Op Packs | ops | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/op_packs.md) |
| `operational_performance` | Operational Performance | ops | ANALYTICS | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/operational_performance.md) |
| `parties` | Customers &amp; Suppliers | ops | LIST | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/parties.md) |
| `payment_funding_proposals` | Payment Funding Proposals | finance | TRANSACTION | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/payment_funding_proposals.md) |
| `people_development_overview` | People Development | resources | DASHBOARD | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/people_development_overview.md) |
| `people_ops` | People Ops | resources | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./resources/people_ops.md) |
| `person_skill_evidence` | Skill Evidence | resources | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/person_skill_evidence.md) |
| `pharmacy` | Pharmacy | commercial | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./commercial/pharmacy.md) |
| `pick_task_queue` | Pick Task Queue | ops | QUEUE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/pick_task_queue.md) |
| `planning_exceptions` | Planning Exceptions | ops | QUEUE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./ops/planning_exceptions.md) |
| `pos` | Pos | commercial | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./commercial/pos.md) |
| `procurement` | Procurement | resources | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./resources/procurement.md) |
| `production_issue_return` | Production Issue and Return | ops | TRANSACTION | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/production_issue_return.md) |
| `production_large_screen` | Production Large Screen | ops | DASHBOARD | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./ops/production_large_screen.md) |
| `production_material_requests` | Production Material Requests | ops | TRANSACTION | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/production_material_requests.md) |
| `production_receipt` | Production Receipt | ops | TRANSACTION | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/production_receipt.md) |
| `products` | Products &amp; Materials | ops | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./ops/products.md) |
| `projects` | Projects | resources | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./resources/projects.md) |
| `putaway_rules` | Putaway Rules | ops | SETUP | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/putaway_rules.md) |
| `putaway_task_queue` | Putaway Task Queue | ops | QUEUE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/putaway_task_queue.md) |
| `qc_center` | Qc Center | ops | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./ops/qc_center.md) |
| `quality_hold_queue` | Quality Hold Queue | ops | QUEUE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/quality_hold_queue.md) |
| `real-estate` | Real Estate | commercial | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./commercial/real-estate.md) |
| `recall_analysis` | Recall Analysis | ops | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/recall_analysis.md) |
| `receipt` | Receipt | core | TRANSACTION | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./core/receipt.md) |
| `receiving_discrepancies` | Receiving Discrepancies | ops | QUEUE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/receiving_discrepancies.md) |
| `rental` | Rental | commercial | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./commercial/rental.md) |
| `replenishment_proposals` | Replenishment Proposals | ops | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/replenishment_proposals.md) |
| `replenishment_rules` | Replenishment Rules | ops | SETUP | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/replenishment_rules.md) |
| `report` | Report | core | ANALYTICS | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./core/report.md) |
| `restaurant` | Restaurant | commercial | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./commercial/restaurant.md) |
| `retail` | Retail | commercial | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./commercial/retail.md) |
| `rework_workspace` | Rework Workspace | ops | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/rework_workspace.md) |
| `risk_compliance` | Risk Compliance | admin | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./admin/risk_compliance.md) |
| `rollout_simulator` | Rollout Simulator | resources | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/rollout_simulator.md) |
| `route_health` | Route Health | intelligence | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./intelligence/route_health.md) |
| `saas_overview` | SaaS Overview | commercial | DASHBOARD | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./commercial/saas_overview.md) |
| `sales` | Sales | commercial | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./commercial/sales.md) |
| `sales_commission` | Sales Commission | commercial | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./commercial/sales_commission.md) |
| `sales_contracts` | Sales Contracts | commercial | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./commercial/sales_contracts.md) |
| `sales_price_lists` | Sales Price Lists | commercial | LIST | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./commercial/sales_price_lists.md) |
| `scenario_planner` | Scenario Planner | intelligence | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./intelligence/scenario_planner.md) |
| `scrap_approval` | Scrap Approval | ops | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/scrap_approval.md) |
| `seats_and_limits` | Seats and Limits | commercial | SETUP | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./commercial/seats_and_limits.md) |
| `security_center` | Security Center | admin | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./admin/security_center.md) |
| `sensor_management` | Sensor Management | resources | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/sensor_management.md) |
| `service_kiosk` | Service Kiosk | ops | KIOSK | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./ops/service_kiosk.md) |
| `service_queue_board` | Service Queue Board | ops | QUEUE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./ops/service_queue_board.md) |
| `shop_floor_kiosk` | Shop Floor Kiosk | ops | KIOSK | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./ops/shop_floor_kiosk.md) |
| `shopfloor_terminal` | Shopfloor Terminal | ops | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/shopfloor_terminal.md) |
| `skills_catalog` | Skills Catalog | resources | SETUP | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/skills_catalog.md) |
| `sop` | Sop | ops | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./ops/sop.md) |
| `sop_review` | Sop Review | ops | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./ops/sop_review.md) |
| `sop_scenarios` | Sop Scenarios | ops | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./ops/sop_scenarios.md) |
| `speed_and_driver_events` | Speed and Driver Events | resources | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/speed_and_driver_events.md) |
| `staging_board` | Staging Board | ops | DASHBOARD | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/staging_board.md) |
| `subscriptions` | Subscriptions | commercial | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./commercial/subscriptions.md) |
| `supplier_portal` | Supplier Portal | resources | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./resources/supplier_portal.md) |
| `supply_demand_balance` | Supply Demand Balance | ops | ANALYTICS | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./ops/supply_demand_balance.md) |
| `surveys` | Surveys | resources | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./resources/surveys.md) |
| `suspected_fuel_loss_queue` | Suspected Fuel Loss Queue | resources | QUEUE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/suspected_fuel_loss_queue.md) |
| `sync_conflicts` | Sync Conflicts | resources | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/sync_conflicts.md) |
| `sync_sessions` | Sync Sessions | resources | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/sync_sessions.md) |
| `system_check` | System Check | admin | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./admin/system_check.md) |
| `system_settings` | System Settings | admin | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./admin/system_settings.md) |
| `task_manager` | Task Manager | ops | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/task_manager.md) |
| `tax_compliance` | Tax Compliance | finance | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/tax_compliance.md) |
| `telegram` | Telegram | intelligence | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./intelligence/telegram.md) |
| `telemetry_explorer` | Telemetry Explorer | resources | ANALYTICS | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/telemetry_explorer.md) |
| `tenant_detail` | Tenant Detail | commercial | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./commercial/tenant_detail.md) |
| `tenant_directory` | Tenant Directory | commercial | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./commercial/tenant_directory.md) |
| `timesheet` | Timesheet | core | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./core/timesheet.md) |
| `training_lms` | Training Lms | admin | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./admin/training_lms.md) |
| `treasury_alerts` | Treasury Alerts | finance | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/treasury_alerts.md) |
| `treasury_cash_position` | Treasury Cash Position | finance | DASHBOARD | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/treasury_cash_position.md) |
| `usage_and_quotas` | Usage and Quotas | commercial | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./commercial/usage_and_quotas.md) |
| `variance_review` | Variance Review | ops | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/variance_review.md) |
| `vehicle_trip_timeline` | Vehicle Trip Timeline | resources | ANALYTICS | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./resources/vehicle_trip_timeline.md) |
| `vertical_packs` | Vertical Packs | commercial | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./commercial/vertical_packs.md) |
| `visitors` | Visitors | resources | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./resources/visitors.md) |
| `warehouse_kiosk` | Warehouse Kiosk | ops | KIOSK | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./ops/warehouse_kiosk.md) |
| `warehouse_large_screen` | Warehouse Large Screen | ops | DASHBOARD | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./ops/warehouse_large_screen.md) |
| `warehouse_topology` | Warehouse Topology | ops | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/warehouse_topology.md) |
| `warehouses` | Warehouses | ops | PAGE | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./ops/warehouses.md) |
| `warranty` | Warranty | commercial | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./commercial/warranty.md) |
| `wave_execution` | Wave Execution | ops | TRANSACTION | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/wave_execution.md) |
| `wave_planning` | Wave Planning | ops | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/wave_planning.md) |
| `wfl_home` | Wfl Home | core | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./core/wfl_home.md) |
| `whatsapp` | Whatsapp | intelligence | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./intelligence/whatsapp.md) |
| `work_orders` | Work Orders | ops | TRANSACTION | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./ops/work_orders.md) |
| `workcenter_queue` | Work-center Queue | ops | QUEUE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/workcenter_queue.md) |
| `workflow` | Workflow | ops | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/workflow.md) |
| `workshop_command_center` | Workshop Command Center | ops | DASHBOARD | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/workshop_command_center.md) |
| `workshop_ledger` | Workshop Ledger | finance | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/workshop_ledger.md) |
| `workshop_pack_setup` | Workshop Pack Setup | commercial | SETUP | PRIMARY | CONNECTED | STRONG | Retain and reconcile | [spec](./commercial/workshop_pack_setup.md) |
| `workshop_readiness` | Workshop Readiness | ops | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/workshop_readiness.md) |
| `zone_bin_management` | Zone and Bin Management | ops | PAGE | PRIMARY | CONNECTED | USABLE | Retain and reconcile | [spec](./ops/zone_bin_management.md) |
