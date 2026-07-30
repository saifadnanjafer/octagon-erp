| Page ID | Section ID | View fragment | Nav group | Nav btn | Permission | Controller(s) | Status |
|---|---|---|---|---|---|---|---|
| `admin_panel` | `pageAdminPanel` | `views/admin_panel.html` | admin_org | yes | `system.admin` | `modules/canonical-administration.js` | COMPLETE |
| `ai_factory` | `pageAiFactory` | `views/ai_factory.html` | intelligence_ai | yes | `system.admin` | — | COMPLETE |
| `ai_queue` | `pageAiQueue` | `views/ai_queue.html` | intelligence_ai | yes | `workshop.manager, finance.manager` | — | COMPLETE |
| `ai_status` | `pageAiStatus` | `views/ai_status.html` | intelligence_ai | yes | `workshop.manager, finance.manager` | `modules/ai-governance.js` | COMPLETE |
| `ai_tools` | `pageAiTools` | `views/ai_tools.html` | intelligence_ai | yes | `system.admin` | — | COMPLETE |
| `analytics` | `pageAnalytics` | `views/analytics.html` | intelligence_core | yes | `workshop.manager, finance.manager` | — | COMPLETE |
| `appointments` | `pageAppointments` | `views/appointments.html` | commercial_sales | yes | `workshop.user` | `modules/appointments.js` | COMPLETE |
| `approvals` | `pageApprovals` | `views/approvals.html` | resources_supply | yes | `workshop.manager, finance.manager` | `modules/approvals.js` | COMPLETE |
| `ar_ap` | `pageArAp` | `views/ar_ap.html` | finance_accounts | yes | `finance.user` | — | COMPLETE |
| `assets` | `pageAssets` | `views/assets.html` | resources_org | yes | `workshop.user` | `modules/asset-maintenance.js`<br>`modules/canonical-assets.js` | COMPLETE |
| `automation` | `pageAutomation` | `views/automation.html` | intelligence_core | yes | `system.admin` | — | COMPLETE |
| `banking` | `pageBanking` | `views/banking.html` | finance_accounts | yes | `finance.user` | — | COMPLETE |
| `budgeting` | `pageBudgeting` | `views/budgeting.html` | finance_accounts | yes | `finance.manager` | `modules/budgeting.js` | COMPLETE |
| `calculator` | `pageCalculator` | `views/calculator.html` | core_daily | yes | `public` | — | COMPLETE |
| `calendar` | `pageCalendar` | `views/calendar.html` | core_daily | yes | `workshop.user` | — | COMPLETE |
| `canonical_console` | `pageCanonicalConsole` | `views/canonical_console.html` | — | yes | `workshop.manager, finance.manager, system.admin` | `modules/canonical-console.js` | EXISTING — NEEDS UPGRADE |
| `canonical_inventory` | `pageCanonicalInventory` | `views/canonical_inventory.html` | — | yes | `workshop.user, workshop.manager, system.admin` | `modules/canonical-inventory.js` | EXISTING — NEEDS UPGRADE |
| `cashbox` | `pageCashbox` | `views/cashbox.html` | finance_accounts | yes | `finance.user` | — | COMPLETE |
| `clinic` | `pageClinic` | `views/clinic.html` | commercial_verticals | yes | `workshop.user` | `modules/vertical-clinic.js` | COMPLETE |
| `command_center` | `pageCommandCenter` | `views/command_center.html` | ops_control | yes | `workshop.manager, finance.manager` | — | COMPLETE |
| `contracts` | `pageContracts` | `views/contracts.html` | resources_supply | yes | `workshop.manager, finance.manager` | — | COMPLETE |
| `customer_portal` | `pageCustomerPortal` | `views/customer_portal.html` | commercial_sales | yes | `public` | — | COMPLETE |
| `customers` | `pageCustomers` | `views/customers.html` | finance_accounts | yes | `finance.user` | — | COMPLETE |
| `data_quality` | `pageDataQuality` | `views/data_quality.html` | admin_org | yes | `system.admin` | — | COMPLETE |
| `deploy_ready` | `pageDeployReady` | `views/deploy_ready.html` | admin_org | yes | `system.admin, workshop.manager, finance.manager` | `modules/implementation-methodology.js` | COMPLETE |
| `device_center` | `pageDeviceCenter` | `views/device_center.html` | admin_org | yes | `system.admin, workshop.manager` | — | COMPLETE |
| `documents` | `pageDocuments` | `views/documents.html` | resources_org | yes | `workshop.user` | `modules/documents.js` | COMPLETE |
| `employee_mobile` | `pageEmployeeMobile` | `views/employee_mobile.html` | core_daily | yes | `public` | `modules/enterprise-suite.js` | COMPLETE |
| `employee_ui` | `pageEmployee_ui` | `views/employee_ui.html` | admin_org | yes | `public` | — | COMPLETE |
| `employees` | `pageEmployees` | `views/employees.html` | core_daily | yes | `workshop.user` | — | COMPLETE |
| `equipment` | `pageEquipment` | `views/equipment.html` | ops_production | yes | `workshop.user` | `modules/canonical-maintenance.js` | COMPLETE |
| `esign` | `pageEsign` | `views/esign.html` | resources_org | yes | `workshop.user` | `modules/esign.js` | COMPLETE |
| `events` | `pageEvents` | `views/events.html` | commercial_sales | yes | `workshop.user` | `modules/events.js` | COMPLETE |
| `expenses` | `pageExpenses` | `views/expenses.html` | finance_accounts | yes | `finance.user` | — | COMPLETE |
| `field_service` | `pageFieldService` | `views/field_service.html` | commercial_verticals | yes | `workshop.user` | `modules/field-service.js` | COMPLETE |
| `finance` | `pageFinance` | `views/finance.html` | finance_accounts | yes | `finance.user` | `modules/finance-close.js`<br>`modules/phase7a-stabilization.js` | COMPLETE |
| `finance_installments` | `pageFinanceInstallments` | `views/finance_installments.html` | — | yes | `finance.manager, finance.user` | `modules/finance-installments.js` | EXISTING — NEEDS UPGRADE |
| `fleet` | `pageFleet` | `views/fleet.html` | resources_org | yes | `workshop.user` | `modules/canonical-fleet.js`<br>`modules/fleet.js` | COMPLETE |
| `help_manual` | `pageHelpManual` | `views/help_manual.html` | core_records | yes | `public` | — | COMPLETE |
| `helpdesk` | `pageHelpdesk` | `views/helpdesk.html` | commercial_sales | yes | `workshop.user` | `modules/helpdesk.js` | COMPLETE |
| `home` | `pageHome` | `views/home.html` | — | yes | `public` | — | EXISTING — NEEDS UPGRADE |
| `hotel` | `pageHotel` | `views/hotel.html` | commercial_verticals | yes | `workshop.user` | `modules/vertical-hotel.js` | COMPLETE |
| `import` | `pageImport` | `views/import.html` | core_records | yes | `workshop.manager` | `modules/implementation-methodology.js` | COMPLETE |
| `import_center` | `pageImportCenter` | — | — | no | **missing** | — | EXISTING — NEEDS UPGRADE |
| `income` | `pageIncome` | `views/income.html` | finance_accounts | yes | `finance.user` | — | COMPLETE |
| `integration_hub` | `pageIntegrationHub` | `views/integration_hub.html` | admin_org | yes | `system.admin` | — | COMPLETE |
| `intelligence` | `pageIntelligence` | `views/intelligence.html` | intelligence_core | yes | `workshop.manager, finance.manager` | — | COMPLETE |
| `inventory` | `pageInventory` | `views/inventory.html` | ops_production | yes | `workshop.user` | `modules/advanced-inventory.js` | COMPLETE |
| `kanban` | `pageKanban` | `views/kanban.html` | ops_control | yes | `workshop.user` | — | COMPLETE |
| `kiosk` | `pageKiosk` | `views/kiosk.html` | ops_frontline | yes | `public` | `modules/enterprise-suite.js` | COMPLETE |
| `knowledge` | `pageKnowledge` | `views/knowledge.html` | resources_org | yes | `workshop.user` | `modules/knowledge.js` | COMPLETE |
| `knowledge_base` | `pageKnowledgeBase` | `views/knowledge_base.html` | — | yes | `public` | `modules/knowledge-base.js` | EXISTING — NEEDS UPGRADE |
| `locations` | `pageLocations` | `views/warehouses_and_locations.html` | — | yes | `workshop.user, workshop.manager, system.admin` | — | EXISTING — NEEDS UPGRADE |
| `logistics` | `pageLogistics` | `views/logistics.html` | resources_supply | yes | `workshop.user` | — | COMPLETE |
| `loyalty` | `pageLoyalty` | `views/loyalty.html` | commercial_sales | yes | `workshop.user` | `modules/loyalty.js` | COMPLETE |
| `machines` | `pageMachines` | `views/machines.html` | ops_production | yes | `workshop.user` | `modules/canonical-maintenance.js` | COMPLETE |
| `manager_approvals` | `pageManagerApprovals` | `views/manager_approvals.html` | — | no | **missing** | — | EXISTING — NEEDS UPGRADE |
| `marketing` | `pageMarketing` | `views/marketing.html` | commercial_sales | yes | `workshop.user` | `modules/marketing.js` | COMPLETE |
| `mobile_inventory_count` | `pageMobileInventoryCount` | `views/mobile_inventory_count.html` | — | no | **missing** | — | EXISTING — NEEDS UPGRADE |
| `mrp` | `pageMrp` | `views/mrp.html` | ops_production | yes | `workshop.user` | `modules/canonical-engineering.js`<br>`modules/canonical-manufacturing.js`<br>`modules/mrp.js` | COMPLETE |
| `multi_entity` | `pageMultiEntity` | `views/multi_entity.html` | admin_org | yes | `system.admin` | `modules/multi-entity.js` | COMPLETE |
| `nl_reports` | `pageNlReports` | `views/nl_reports.html` | intelligence_core | yes | `workshop.manager, finance.manager` | `modules/nl-reporting.js` | COMPLETE |
| `omni_communications` | `pageOmniCommunications` | `views/omni_communications.html` | — | yes | `workshop.manager, finance.manager` | `modules/omni-communications.js` | EXISTING — NEEDS UPGRADE |
| `op_packs` | `pageOpPacks` | `views/op_packs.html` | ops_production | yes | `workshop.user` | — | COMPLETE |
| `parties` | `pageCustomersAndSuppliers` | `views/customers_and_suppliers.html` | — | yes | `workshop.user, workshop.manager, system.admin` | `modules/customers-and-suppliers.js` | EXISTING — NEEDS UPGRADE |
| `people_ops` | `pagePeopleOps` | `views/people_ops.html` | resources_org | yes | `workshop.manager` | `modules/people-ops.js` | COMPLETE |
| `pharmacy` | `pagePharmacy` | `views/pharmacy.html` | commercial_verticals | yes | `workshop.user` | `modules/vertical-pharmacy.js` | COMPLETE |
| `pos` | `pagePOS` | `views/pos.html` | commercial_sales | yes | `workshop.user, finance.user` | `modules/canonical-pos.js`<br>`modules/pos.js` | COMPLETE |
| `pos_deepening` | `pagePOSDeepening` | `views/pos_deepening.html` | — | yes | `workshop.user, finance.user` | `modules/pos-deepening.js` | EXISTING — NEEDS UPGRADE |
| `procurement` | `pageProcurement` | `views/procurement.html` | resources_supply | yes | `workshop.manager, finance.user` | `modules/canonical-procurement.js`<br>`modules/procurement.js` | COMPLETE |
| `products` | `pageProductsAndMaterials` | `views/products_and_materials.html` | — | yes | `workshop.user, workshop.manager, system.admin` | `modules/products-and-materials.js` | EXISTING — NEEDS UPGRADE |
| `projects` | `pageProjects` | `views/projects.html` | resources_supply | yes | `workshop.user` | `modules/canonical-projects.js`<br>`modules/project-management.js` | COMPLETE |
| `qc_center` | `pageQcCenter` | `views/qc_center.html` | ops_production | yes | `workshop.user` | `modules/canonical-quality.js`<br>`modules/page-qc.js` | COMPLETE |
| `real-estate` | `pageRealEstate` | `views/real-estate.html` | commercial_verticals | yes | `workshop.user` | `modules/vertical-real-estate.js` | COMPLETE |
| `receipt` | `pageReceipt` | `views/receipt.html` | core_records | yes | `finance.user` | — | COMPLETE |
| `rental` | `pageRental` | `views/rental.html` | commercial_verticals | yes | `workshop.user` | `modules/rental.js` | COMPLETE |
| `report` | `pageReport` | `views/report.html` | core_records | yes | `finance.user` | — | COMPLETE |
| `restaurant` | `pageRestaurant` | `views/restaurant.html` | commercial_verticals | yes | `workshop.user` | `modules/vertical-restaurant.js` | COMPLETE |
| `retail` | `pageRetail` | `views/retail.html` | commercial_verticals | yes | `workshop.user` | `modules/vertical-retail.js` | COMPLETE |
| `risk_compliance` | `pageRiskCompliance` | `views/risk_compliance.html` | admin_org | yes | `workshop.manager, finance.manager` | `modules/risk-compliance.js` | COMPLETE |
| `route_health` | `pageRouteHealth` | `views/route_health.html` | intelligence_core | yes | `system.admin, workshop.manager, finance.manager` | `modules/route-health.js` | COMPLETE |
| `sales` | `pageSales` | `views/sales.html` | commercial_sales | yes | `workshop.user, finance.user` | `modules/canonical-sales.js`<br>`modules/sales-commercial-pack.js` | COMPLETE |
| `sales_commission` | `pageSalesCommission` | `views/sales_commission.html` | — | yes | `workshop.manager, finance.manager` | `modules/sales-commission.js` | EXISTING — NEEDS UPGRADE |
| `sales_contracts` | `pageSalesContracts` | `views/sales_contracts.html` | — | yes | `workshop.manager, finance.manager` | `modules/sales-contracts.js` | EXISTING — NEEDS UPGRADE |
| `sales_price_lists` | `pageSalesPriceLists` | `views/sales_price_lists.html` | — | yes | `workshop.user, finance.user` | `modules/sales-price-lists.js` | EXISTING — NEEDS UPGRADE |
| `scenario_planner` | `pageScenarioPlanner` | `views/scenario_planner.html` | intelligence_ai | yes | `workshop.manager, finance.manager` | — | COMPLETE |
| `security_center` | `pageSecurityCenter` | `views/security_center.html` | admin_org | yes | `system.admin` | `modules/phase6c-security-matrix.js` | COMPLETE |
| `settings` | — | — | — | no | `system.admin` | — | BLOCKED |
| `sop` | `pageSop` | `views/sop.html` | ops_control | yes | `workshop.user` | — | COMPLETE |
| `subscriptions` | `pageSubscriptions` | `views/subscriptions.html` | commercial_sales | yes | `finance.user` | `modules/subscriptions.js` | COMPLETE |
| `supplier_portal` | `pageSupplierPortal` | `views/supplier_portal.html` | resources_supply | yes | `workshop.manager, finance.user` | — | COMPLETE |
| `surveys` | `pageSurveys` | `views/surveys.html` | resources_org | yes | `workshop.user` | `modules/surveys.js` | COMPLETE |
| `system_check` | — | — | — | no | `system.admin, workshop.manager, finance.manager` | — | BLOCKED |
| `system_settings` | `pageSystemSettings` | — | — | no | **missing** | — | EXISTING — NEEDS UPGRADE |
| `task_manager` | `pageTaskManager` | `views/task_manager.html` | ops_control | yes | `workshop.user` | `modules/canonical-work-management.js` | COMPLETE |
| `tax_compliance` | `pageTaxCompliance` | `views/tax_compliance.html` | finance_accounts | yes | `finance.manager, system.admin` | `modules/tax-compliance.js` | COMPLETE |
| `telegram` | `pageTelegram` | `views/telegram.html` | — | yes | `workshop.manager, finance.manager` | — | EXISTING — NEEDS UPGRADE |
| `timesheet` | `pageTimesheet` | `views/timesheet.html` | core_daily | yes | `workshop.user` | — | COMPLETE |
| `training_lms` | `pageTrainingLms` | `views/training_lms.html` | admin_org | yes | `workshop.manager` | — | COMPLETE |
| `visitors` | `pageVisitors` | `views/visitors.html` | resources_org | yes | `workshop.user` | `modules/visitors.js` | COMPLETE |
| `warehouses` | `pageWarehouses` | `views/warehouses_and_locations.html` | — | yes | `workshop.user, workshop.manager, system.admin` | `modules/warehouses-and-locations.js` | EXISTING — NEEDS UPGRADE |
| `warranty` | `pageWarranty` | `views/warranty.html` | commercial_sales | yes | `workshop.user` | `modules/warranty-rma.js` | COMPLETE |
| `wfl_home` | `pageWflHome` | `views/wfl_home.html` | core_daily | yes | `public` | — | COMPLETE |
| `whatsapp` | `pageWhatsapp` | `views/whatsapp.html` | intelligence_core | yes | `workshop.manager, finance.manager` | — | COMPLETE |
| `work_orders` | `pageWorkOrders` | `views/work_orders.html` | ops_production | yes | `workshop.user` | `modules/work-orders.js` | COMPLETE |
| `workflow` | `pageWorkflow` | `views/workflow.html` | ops_control | yes | `workshop.user` | — | COMPLETE |
| `workshop_ledger` | `pageWorkshopLedger` | `views/workshop_ledger.html` | finance_accounts | yes | `workshop.manager, finance.user` | `modules/workshop-ledger.js` | COMPLETE |
| `workshop_tv` | `pageWorkshopTv` | `views/workshop_tv.html` | ops_frontline | yes | `public` | `modules/enterprise-suite.js`<br>`modules/workshop-frontline.js` | COMPLETE |
