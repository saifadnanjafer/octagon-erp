# Final Page Architecture

Current product structure at `255be8aa7c2c9faa6b9d7afbd73ea64f82591729`. Group names are business concepts,
not build waves. Entries marked THIN remain visible only as tracked gaps and do
not make this product ready for internal use.

## finance → finance_consolidation

- **Account Mapping** (`account_mapping`) — Consolidation account mapping — finance/consolidation (risk: critical, phase: build08); STRONG.
- **Consolidated Reports** (`consolidated_reports`) — Consolidated reports — finance/consolidation (risk: high, phase: build08); USABLE.
- **Consolidation Groups** (`consolidation_groups`) — Consolidation groups — finance/consolidation (risk: critical, phase: build08); STRONG.
- **Eliminations** (`eliminations`) — Consolidation eliminations — finance/consolidation (risk: critical, phase: build08); STRONG.

## admin → admin_org

- **Admin Panel** (`admin_panel`) — Admin panel — admin/security (risk: critical, phase: core); USABLE.
- **Data Quality** (`data_quality`) — Data quality — admin/data (risk: high, phase: phase6e); STRONG.
- **Deploy Ready** (`deploy_ready`) — Deployment readiness — system/readiness (risk: high, phase: phase6e); USABLE.
- **Device Center** (`device_center`) — Device center — admin/device (risk: high, phase: phase6e); USABLE.
- **Employee Ui** (`employee_ui`) — Employee self service — employee_self_service (risk: low, phase: phase6e); THIN.
- **Data Import** (`import_center`) — null; USABLE.
- **Integration Hub** (`integration_hub`) — Integration hub — admin/integration (risk: critical, phase: phase6e); USABLE.
- **Multi Entity** (`multi_entity`) — Multi-entity control — admin/tenant (risk: critical, phase: phase6e); STRONG.
- **Risk Compliance** (`risk_compliance`) — Risk compliance — compliance (risk: high, phase: phase6b); STRONG.
- **Security Center** (`security_center`) — Security center — admin/security (risk: critical, phase: phase6e); USABLE.
- **System Check** (`system_check`) — null; USABLE.
- **System Settings** (`system_settings`) — null; USABLE.
- **Training Lms** (`training_lms`) — Training LMS — hr/training (risk: medium, phase: phase6e); USABLE.

## intelligence → intelligence_ai

- **AI Assistant** (`ai_assistant`) — Governed AI assistant — build12/ai (risk: high, phase: build12); USABLE.
- **Ai Factory** (`ai_factory`) — AI factory — ai/system (risk: critical, phase: phase6e); USABLE.
- **AI Overview** (`ai_overview`) — Governed AI overview — build12/ai (risk: medium, phase: build12); USABLE.
- **Ai Queue** (`ai_queue`) — AI approval queue — ai/system (risk: high, phase: phase6e); USABLE.
- **Ai Status** (`ai_status`) — AI status — ai/system (risk: medium, phase: phase6e); STRONG.
- **Ai Tools** (`ai_tools`) — AI tools — ai/system (risk: critical, phase: phase6e); USABLE.
- **Scenario Planner** (`scenario_planner`) — Scenario planner — manager/planning (risk: medium, phase: phase6e); THIN.

## intelligence → intelligence_governance

- **AI Context Sources** (`ai_context_sources`) — AI context sources — build12/ai-context (risk: high, phase: build12); USABLE.
- **AI Policy Registry** (`ai_policy_registry`) — AI policy registry — build12/ai-policy (risk: high, phase: build12); USABLE.
- **AI Prompt Templates** (`ai_prompt_templates`) — AI prompt templates — build12/ai-tasks (risk: medium, phase: build12); USABLE.
- **AI Proposal Inbox** (`ai_proposal_inbox`) — AI proposal inbox — build12/ai-proposals (risk: high, phase: build12); USABLE.
- **AI Run History** (`ai_run_history`) — AI run history — build12/ai-runs (risk: medium, phase: build12); USABLE.

## ops → ops_boards

- **Alert Board** (`alert_board`) — Alert board — boards/alerts (risk: low, phase: build10); THIN.
- **Device Health Board** (`device_health_board`) — Device health board — boards/health (risk: low, phase: build10); THIN.
- **Fleet Operations Board** (`fleet_operations_board`) — Fleet operations board — boards/fleet (risk: low, phase: build10); USABLE.
- **Production Large Screen** (`production_large_screen`) — Production large screen — boards/production (risk: low, phase: build10); THIN.
- **Service Queue Board** (`service_queue_board`) — Service queue board — boards/service (risk: low, phase: build10); THIN.
- **Warehouse Large Screen** (`warehouse_large_screen`) — Warehouse large screen — boards/warehouse (risk: low, phase: build10); THIN.

## intelligence → intelligence_core

- **Analytics** (`analytics`) — Analytics — manager/reporting (risk: medium, phase: core); USABLE.
- **Automation** (`automation`) — Automation engine — ai/system (risk: critical, phase: core); STRONG.
- **Intelligence** (`intelligence`) — AI intelligence — ai/system (risk: high, phase: core); STRONG.
- **Nl Reports** (`nl_reports`) — Natural language reports — manager/reporting (risk: medium, phase: core); STRONG.
- **Route Health** (`route_health`) — Route health — system/diagnostic (risk: medium, phase: phase6e); THIN.
- **Telegram** (`telegram`) — Telegram connector — ai/customer_comms (risk: high, phase: core); STRONG.
- **Whatsapp** (`whatsapp`) — WhatsApp control — ai/customer_comms (risk: high, phase: core); USABLE.

## commercial → commercial_relationships

- **Appointments** (`appointments`) — Appointments — workshop/operations (risk: medium, phase: phase6h); USABLE.
- **Customer Portal** (`customer_portal`) — Customer portal — public/customer (risk: low, phase: core); USABLE.
- **Helpdesk** (`helpdesk`) — Helpdesk — workshop/operations (risk: medium, phase: phase6h); USABLE.
- **Omni Communications** (`omni_communications`) — Omni communications — ai/customer_comms (risk: high, phase: phase7j); USABLE.
- **Sales Contracts** (`sales_contracts`) — Sales contracts — sales/contracts (risk: high, phase: phase7j); USABLE.
- **Subscriptions** (`subscriptions`) — Subscriptions — commercial/subscriptions (risk: high, phase: build11); STRONG.
- **Warranty** (`warranty`) — Warranty & RMA — workshop/operations (risk: medium, phase: phase6h); USABLE.

## resources → resources_supply

- **Approvals** (`approvals`) — Approvals — manager/approval (risk: high, phase: phase6e); USABLE.
- **Contracts** (`contracts`) — Contracts Hub — finance/compliance (risk: high, phase: phase6h); USABLE.
- **Logistics** (`logistics`) — Logistics cargo — workshop/logistics (risk: medium, phase: phase6h); USABLE.
- **Procurement** (`procurement`) — Procurement — procurement/finance (risk: high, phase: phase6e); USABLE.
- **Projects** (`projects`) — Project Hub — workshop/operations (risk: medium, phase: phase6h); USABLE.
- **Supplier Portal** (`supplier_portal`) — Supplier portal — procurement/finance (risk: high, phase: phase6e); THIN.

## finance → finance_accounts

- **Ar Ap** (`ar_ap`) — AR/AP workbench — finance (risk: high, phase: phase6e); USABLE.
- **Banking** (`banking`) — Banking and treasury — finance (risk: high, phase: phase6a); STRONG.
- **Budgeting** (`budgeting`) — Budgeting — finance (risk: high, phase: phase6e); USABLE.
- **Cashbox** (`cashbox`) — Cashbox — finance (risk: high, phase: core); STRONG.
- **Customers** (`customers`) — Customer balances — finance (risk: medium, phase: core); STRONG.
- **Expenses** (`expenses`) — Expenses — finance (risk: high, phase: core); STRONG.
- **Finance** (`finance`) — Finance dashboard — finance (risk: high, phase: core); STRONG.
- **Finance Installments** (`finance_installments`) — Finance installments — finance/installments (risk: high, phase: phase7j); USABLE.
- **Income** (`income`) — Income — finance (risk: high, phase: core); STRONG.
- **Tax Compliance** (`tax_compliance`) — Tax compliance — finance/compliance (risk: high, phase: phase6b); USABLE.
- **Workshop Ledger** (`workshop_ledger`) — Workshop ledger — finance/workshop (risk: high, phase: phase6h); USABLE.

## resources → resources_assets

- **Assets** (`assets`) — Fixed Assets — workshop/maintenance (risk: medium, phase: phase6h); USABLE.
- **Fleet** (`fleet`) — Fleet Management — workshop/logistics (risk: medium, phase: phase6h); USABLE.

## commercial → commercial_marketing

- **Attribution Insights** (`attribution_insights`) — Attribution insights — build12/attribution (risk: low, phase: build12); USABLE.
- **Campaigns** (`campaigns`) — Marketing campaigns — build12/campaigns (risk: high, phase: build12); STRONG.
- **Content Approvals** (`content_approvals`) — Content approvals — build12/content-review (risk: high, phase: build12); USABLE.
- **Content Calendar** (`content_calendar`) — Content calendar — build12/content (risk: medium, phase: build12); USABLE.
- **Event Check-in** (`event_checkin`) — Event check-in — build12/checkin (risk: high, phase: build12); USABLE.
- **Event Planner** (`event_planner`) — Event planner — build12/event-planner (risk: high, phase: build12); USABLE.
- **Event Registrations** (`event_registrations`) — Event registrations — build12/registrations (risk: medium, phase: build12); USABLE.
- **Events** (`events`) — Events Hub — workshop/operations (risk: medium, phase: phase6h); USABLE.
- **Events Overview** (`events_overview`) — Events overview — build12/events (risk: medium, phase: build12); USABLE.
- **Marketing** (`marketing`) — Marketing — workshop/operations (risk: medium, phase: phase6h); USABLE.
- **Marketing Overview** (`marketing_overview`) — Marketing overview — build12/marketing (risk: medium, phase: build12); USABLE.

## commercial → commercial_saas

- **Billing Simulator** (`billing_simulator`) — Billing simulator — commercial/billing (risk: high, phase: build11); USABLE.
- **Commercial Plans** (`commercial_plans`) — Commercial plans — commercial/plans (risk: high, phase: build11); USABLE.
- **Entitlements** (`entitlements`) — Entitlements — commercial/entitlements (risk: high, phase: build11); USABLE.
- **Extension Installations** (`extension_installations`) — Extension installations — commercial/extensions (risk: high, phase: build11); THIN.
- **Extension Marketplace** (`extension_marketplace`) — Extension marketplace — commercial/extensions (risk: high, phase: build11); USABLE.
- **SaaS Overview** (`saas_overview`) — SaaS overview — commercial/saas (risk: medium, phase: build11); USABLE.
- **Seats and Limits** (`seats_and_limits`) — Seats and limits — commercial/seats (risk: high, phase: build11); USABLE.
- **Tenant Detail** (`tenant_detail`) — Tenant detail — commercial/tenant (risk: high, phase: build11); USABLE.
- **Tenant Directory** (`tenant_directory`) — Tenant directory — commercial/tenant (risk: high, phase: build11); STRONG.
- **Usage and Quotas** (`usage_and_quotas`) — Usage and quotas — commercial/usage (risk: high, phase: build11); USABLE.

## core → core_daily

- **Calendar** (`calendar`) — Attendance calendar — hr/payroll (risk: medium, phase: phase6e); USABLE.
- **Employee Mobile** (`employee_mobile`) — Employee mobile — employee_self_service (risk: low, phase: phase6e); USABLE.
- **Employees** (`employees`) — Employees and balances — hr/payroll (risk: high, phase: core); USABLE.
- **Home** (`home`) — Home dashboard — system/home (risk: low, phase: core); USABLE.
- **My Work** (`my_work`) — My Work — workshop/operations (risk: low, phase: internal-workshop-wave); USABLE.
- **Timesheet** (`timesheet`) — Timesheet — hr/payroll (risk: high, phase: phase6e); USABLE.
- **Wfl Home** (`wfl_home`) — Role Home — employee_self_service (risk: low, phase: phase6h); USABLE.

## ops → ops_inventory

- **Canonical Operations** (`canonical_console`) — Canonical Operations console — platform/canonical (risk: high, phase: visible-expansion); USABLE.
- **Canonical Inventory** (`canonical_inventory`) — Canonical Inventory and Warehouses — workshop/inventory (risk: high, phase: visible-expansion); USABLE.
- **Equipment** (`equipment`) — Equipment — workshop/production (risk: medium, phase: core); STRONG.
- **Inventory** (`inventory`) — Inventory and stock — workshop/inventory (risk: high, phase: core); STRONG.
- **Customers &amp; Suppliers** (`parties`) — (no PAGE_METADATA entry — inferred label only: Customers & Suppliers); USABLE.
- **Products &amp; Materials** (`products`) — (no PAGE_METADATA entry — inferred label only: Products & Materials); USABLE.
- **Qc Center** (`qc_center`) — QC center — workshop/quality (risk: medium, phase: core); USABLE.
- **Warehouse Topology** (`warehouse_topology`) — Warehouse topology — workshop/inventory (risk: medium, phase: build09); THIN.
- **Warehouses** (`warehouses`) — (no PAGE_METADATA entry — inferred label only: Warehouses); USABLE.
- **Zone and Bin Management** (`zone_bin_management`) — Zone and bin management — workshop/inventory (risk: high, phase: build09); THIN.

## commercial → commercial_verticals

- **Clinic** (`clinic`) — Clinic vertical — vertical/clinic (risk: medium, phase: phase6h); USABLE.
- **Field Service** (`field_service`) — Field Service — workshop/operations (risk: medium, phase: phase6h); USABLE.
- **Hotel** (`hotel`) — Hotel vertical — vertical/hotel (risk: medium, phase: phase6h); USABLE.
- **Pharmacy** (`pharmacy`) — Pharmacy vertical — vertical/pharmacy (risk: medium, phase: phase6h); USABLE.
- **Real Estate** (`real-estate`) — Real Estate vertical — vertical/real_estate (risk: medium, phase: phase6h); USABLE.
- **Rental** (`rental`) — Rental Hub — workshop/operations (risk: medium, phase: phase6h); USABLE.
- **Restaurant** (`restaurant`) — Restaurant vertical — vertical/restaurant (risk: medium, phase: phase6h); USABLE.
- **Retail** (`retail`) — Retail vertical — vertical/retail (risk: medium, phase: phase6h); USABLE.
- **Vertical Packs** (`vertical_packs`) — Vertical packs — build12/packs (risk: high, phase: build12); USABLE.
- **Workshop Pack Setup** (`workshop_pack_setup`) — Workshop pack setup — build12/pack-installations (risk: high, phase: build12); STRONG.

## ops → ops_control

- **Command Center** (`command_center`) — Command Center — manager/system (risk: high, phase: core); STRONG.
- **Sop** (`sop`) — SOP library — workshop/quality (risk: low, phase: core); USABLE.
- **Task Manager** (`task_manager`) — Task manager — workshop/operations (risk: low, phase: core); USABLE.
- **Workflow** (`workflow`) — Workflow designer — workshop/operations (risk: medium, phase: core); USABLE.
- **Workshop Command Center** (`workshop_command_center`) — Workshop Command Center — workshop/operations (risk: medium, phase: internal-workshop-wave); USABLE.
- **Workshop Readiness** (`workshop_readiness`) — Workshop Readiness — workshop/setup (risk: medium, phase: internal-workshop-wave); USABLE.

## resources → resources_people

- **Competency Profiles** (`competency_profiles`) — Competency profiles — build12/competencies (risk: medium, phase: build12); USABLE.
- **Development Plans** (`development_plans`) — Development plans — build12/development-plans (risk: high, phase: build12); USABLE.
- **Learning & Certifications** (`learning_and_certifications`) — Learning and certifications — build12/learning (risk: medium, phase: build12); USABLE.
- **People Development** (`people_development_overview`) — People development — build12/people (risk: medium, phase: build12); USABLE.
- **People Ops** (`people_ops`) — People operations — hr/people (risk: high, phase: phase6e); USABLE.
- **Skill Evidence** (`person_skill_evidence`) — Skill evidence — build12/evidence (risk: high, phase: build12); USABLE.
- **Skills Catalog** (`skills_catalog`) — Skills catalog — build12/skills (risk: medium, phase: build12); USABLE.

## resources → resources_devices

- **Configuration Profiles** (`configuration_profiles`) — Configuration profiles — iot/config (risk: high, phase: build10); STRONG.
- **Device Alerts** (`device_alerts`) — Device alerts — iot/alerts (risk: high, phase: build10); STRONG.
- **Device Command Center** (`device_command_center`) — Device command center — iot/commands (risk: critical, phase: build10); STRONG.
- **Device Detail** (`device_detail`) — Device detail — iot/devices (risk: low, phase: build10); STRONG.
- **Device Health Center** (`device_health_center`) — Device health center — iot/health (risk: medium, phase: build10); STRONG.
- **Device Registry** (`device_registry`) — Device registry — iot/devices (risk: medium, phase: build10); STRONG.
- **Firmware Catalogue** (`firmware_catalogue`) — Firmware catalogue — iot/firmware (risk: high, phase: build10); STRONG.
- **Gateway Management** (`gateway_management`) — Gateway management — iot/gateways (risk: high, phase: build10); STRONG.
- **Rollout Simulator** (`rollout_simulator`) — Rollout simulator — iot/firmware (risk: high, phase: build10); STRONG.
- **Sensor Management** (`sensor_management`) — Sensor management — iot/sensors (risk: medium, phase: build10); STRONG.
- **Telemetry Explorer** (`telemetry_explorer`) — Telemetry explorer — iot/telemetry (risk: low, phase: build10); STRONG.

## resources → resources_offline

- **Conflict Resolution** (`conflict_resolution`) — Conflict resolution — offline/conflicts (risk: high, phase: build10); STRONG.
- **Offline Capability Policies** (`offline_capability_policies`) — Offline capability policies — offline/policies (risk: high, phase: build10); STRONG.
- **Offline Client Registry** (`offline_client_registry`) — Offline client registry — offline/clients (risk: high, phase: build10); STRONG.
- **Offline Queue** (`offline_queue`) — Offline queue — offline/queue (risk: medium, phase: build10); STRONG.
- **Sync Conflicts** (`sync_conflicts`) — Sync conflicts — offline/conflicts (risk: high, phase: build10); STRONG.
- **Sync Sessions** (`sync_sessions`) — Sync sessions — offline/sessions (risk: low, phase: build10); STRONG.

## ops → ops_warehouse_fulfillment

- **Count Session** (`count_session`) — Count session — workshop/inventory (risk: high, phase: build09); THIN.
- **Cycle Count Plans** (`cycle_count_plans`) — Cycle count plans — workshop/inventory (risk: high, phase: build09); THIN.
- **Mobile Picking** (`mobile_picking`) — Mobile picking — workshop/inventory (risk: high, phase: build09); USABLE.
- **Pick Task Queue** (`pick_task_queue`) — Pick task queue — workshop/inventory (risk: medium, phase: build09); USABLE.
- **Variance Review** (`variance_review`) — Variance review — workshop/inventory (risk: critical, phase: build09); THIN.
- **Wave Execution** (`wave_execution`) — Wave execution — workshop/inventory (risk: high, phase: build09); USABLE.
- **Wave Planning** (`wave_planning`) — Wave planning — workshop/inventory (risk: high, phase: build09); USABLE.

## ops → ops_warehouse_traceability

- **Cross-Dock Workspace** (`crossdock_workspace`) — Cross-dock workspace — workshop/logistics (risk: high, phase: build09); THIN.
- **Dock Check-In** (`dock_checkin`) — Dock check-in — workshop/logistics (risk: medium, phase: build09); USABLE.
- **Dock Schedule** (`dock_schedule`) — Dock schedule — workshop/logistics (risk: high, phase: build09); USABLE.
- **Expiration Queue** (`expiration_queue`) — Expiration queue — workshop/quality (risk: high, phase: build09); USABLE.
- **Lot / Serial Traceability** (`lot_serial_traceability`) — Lot and serial traceability — workshop/inventory (risk: high, phase: build09); THIN.
- **Recall Analysis** (`recall_analysis`) — Recall analysis — workshop/quality (risk: critical, phase: build09); USABLE.
- **Staging Board** (`staging_board`) — Staging board — workshop/logistics (risk: medium, phase: build09); THIN.

## ops → ops_planning

- **Demand Planning** (`demand_planning`) — Demand planning — planning (risk: high, phase: build08); STRONG.
- **Forecast Overrides** (`forecast_overrides`) — Forecast overrides — planning (risk: high, phase: build08); STRONG.
- **Mps** (`mps`) — Master production schedule — planning/production (risk: high, phase: build08); STRONG.
- **Planning Exceptions** (`planning_exceptions`) — Planning exceptions — planning (risk: high, phase: build08); USABLE.
- **Sop Review** (`sop_review`) — S and OP review — planning/finance (risk: high, phase: build08); STRONG.
- **Sop Scenarios** (`sop_scenarios`) — S and OP scenarios — planning/finance (risk: high, phase: build08); STRONG.
- **Supply Demand Balance** (`supply_demand_balance`) — Supply demand balance — planning/production (risk: medium, phase: build08); STRONG.

## resources → resources_knowledge

- **Documents** (`documents`) — Document Library — workshop/operations (risk: medium, phase: phase6h); USABLE.
- **Esign** (`esign`) — E-Signatures — workshop/operations (risk: medium, phase: phase6h); STRONG.
- **Knowledge Base** (`knowledge_base`) — Knowledge Base & FAQ — workshop/operations (risk: low, phase: phase8d); STRONG.
- **Surveys** (`surveys`) — Surveys — workshop/operations (risk: low, phase: phase6h); USABLE.
- **Visitors** (`visitors`) — Visitor Logs — workshop/operations (risk: low, phase: phase6h); STRONG.

## ops → ops_production

- **Downtime Board** (`downtime_board`) — Downtime board — workshop/production (risk: high, phase: build09); THIN.
- **Machines** (`machines`) — Machines — workshop/production (risk: medium, phase: core); USABLE.
- **Mrp** (`mrp`) — Manufacturing MRP II — workshop/production (risk: medium, phase: phase6h); USABLE.
- **Op Packs** (`op_packs`) — Operation packs — workshop/production (risk: medium, phase: core); USABLE.
- **Operational Performance** (`operational_performance`) — Operational performance — workshop/production (risk: medium, phase: build09); THIN.
- **Production Issue / Return** (`production_issue_return`) — Production issue and return — workshop/production (risk: high, phase: build09); USABLE.
- **Production Material Requests** (`production_material_requests`) — Production material requests — workshop/production (risk: high, phase: build09); USABLE.
- **Production Receipt** (`production_receipt`) — Production receipt — workshop/production (risk: high, phase: build09); USABLE.
- **Quality Hold Queue** (`quality_hold_queue`) — Quality hold queue — workshop/quality (risk: high, phase: build09); USABLE.
- **Rework Workspace** (`rework_workspace`) — Rework workspace — workshop/quality (risk: high, phase: build09); USABLE.
- **Scrap Approval** (`scrap_approval`) — Scrap approval — workshop/quality (risk: critical, phase: build09); USABLE.
- **Shop-Floor Terminal** (`shopfloor_terminal`) — Shop-floor terminal — workshop/production (risk: high, phase: build09); USABLE.
- **Work Orders** (`work_orders`) — Work Orders — workshop/production (risk: medium, phase: phase6h); THIN.
- **Work-Center Queue** (`workcenter_queue`) — Work-center queue — workshop/production (risk: medium, phase: build09); USABLE.

## ops → ops_kiosks

- **Employee Kiosk** (`employee_kiosk`) — Employee kiosk — kiosk/employee (risk: low, phase: build10); STRONG.
- **Kiosk** (`kiosk`) — Kiosk Terminal — public/display (risk: low, phase: phase6h); USABLE.
- **Kiosk Device Registry** (`kiosk_device_registry`) — Kiosk device registry — kiosk/registry (risk: high, phase: build10); STRONG.
- **Service Kiosk** (`service_kiosk`) — Service kiosk — kiosk/service (risk: low, phase: build10); STRONG.
- **Shop Floor Kiosk** (`shop_floor_kiosk`) — Shop floor kiosk — kiosk/shopfloor (risk: medium, phase: build10); STRONG.
- **Warehouse Kiosk** (`warehouse_kiosk`) — Warehouse kiosk — kiosk/warehouse (risk: medium, phase: build10); STRONG.

## finance → finance_treasury

- **Financing Facilities** (`financing_facilities`) — Financing facilities — finance/treasury (risk: high, phase: build08); STRONG.
- **Liquidity Forecast** (`liquidity_forecast`) — Liquidity forecast — finance/treasury (risk: high, phase: build08); STRONG.
- **Payment Funding Proposals** (`payment_funding_proposals`) — Payment funding proposals — finance/treasury (risk: critical, phase: build08); STRONG.
- **Treasury Alerts** (`treasury_alerts`) — Treasury alerts — finance/treasury (risk: high, phase: build08); STRONG.
- **Treasury Cash Position** (`treasury_cash_position`) — Treasury cash position — finance/treasury (risk: high, phase: build08); STRONG.

## resources → resources_fleet

- **Fleet Device Mapping** (`fleet_device_mapping`) — Fleet device mapping — fleet/devices (risk: medium, phase: build10); STRONG.
- **Fleet Live Map Simulator** (`fleet_live_map_simulator`) — Fleet live map simulator — fleet/map (risk: low, phase: build10); STRONG.
- **Fuel Telemetry** (`fuel_telemetry`) — Fuel telemetry — fleet/fuel (risk: medium, phase: build10); STRONG.
- **Geofence Management** (`geofence_management`) — Geofence management — fleet/geofences (risk: medium, phase: build10); STRONG.
- **Maintenance Triggers** (`maintenance_triggers`) — Maintenance triggers — fleet/maintenance (risk: high, phase: build10); STRONG.
- **Speed and Driver Events** (`speed_and_driver_events`) — Speed and driver events — fleet/speed (risk: medium, phase: build10); STRONG.
- **Suspected Fuel Loss Queue** (`suspected_fuel_loss_queue`) — Suspected fuel loss queue — fleet/fuel (risk: high, phase: build10); STRONG.
- **Vehicle Trip Timeline** (`vehicle_trip_timeline`) — Vehicle trip timeline — fleet/trips (risk: low, phase: build10); STRONG.

## core → core_records

- **Help Manual** (`help_manual`) — Help manual — employee_self_service (risk: low, phase: phase6h); USABLE.
- **Import** (`import`) — Attendance import — hr/payroll (risk: high, phase: phase6e); STRONG.
- **Receipt** (`receipt`) — Receipts — finance (risk: medium, phase: core); STRONG.
- **Report** (`report`) — Payroll report — finance/payroll (risk: high, phase: core); USABLE.

## finance → finance_intercompany

- **Intercompany Reconciliation** (`intercompany_reconciliation`) — Intercompany reconciliation — finance/intercompany (risk: critical, phase: build08); STRONG.
- **Intercompany Transactions** (`intercompany_transactions`) — Intercompany transactions — finance/intercompany (risk: critical, phase: build08); STRONG.
- **Mismatch Queue** (`mismatch_queue`) — Intercompany mismatch queue — finance/intercompany (risk: high, phase: build08); STRONG.

## commercial → commercial_sales

- **Loyalty** (`loyalty`) — Loyalty programs — workshop/operations (risk: medium, phase: phase6h); STRONG.
- **Pos** (`pos`) — Point of Sale — workshop/pos (risk: medium, phase: phase6h); USABLE.
- **Sales** (`sales`) — Sales — sales/commerce (risk: medium, phase: core); USABLE.
- **Sales Commission** (`sales_commission`) — Sales commission — sales/commission (risk: high, phase: phase7j); USABLE.
- **Sales Price Lists** (`sales_price_lists`) — Sales price lists — sales/pricing (risk: medium, phase: phase7j); THIN.

## ops → ops_warehouse_inbound

- **Mobile Receiving** (`mobile_receiving`) — Mobile receiving — workshop/inventory (risk: high, phase: build09); USABLE.
- **Putaway Rules** (`putaway_rules`) — Putaway rules — workshop/inventory (risk: high, phase: build09); THIN.
- **Putaway Task Queue** (`putaway_task_queue`) — Putaway task queue — workshop/inventory (risk: medium, phase: build09); USABLE.
- **Replenishment Proposals** (`replenishment_proposals`) — Replenishment proposals — workshop/inventory (risk: high, phase: build09); USABLE.

## Canonical hierarchy

Primary workspace → tabs / detail surfaces / dialogs / actions. Compatibility
identifiers are listed in [FINAL_PAGE_CONSOLIDATION_MAP.md](FINAL_PAGE_CONSOLIDATION_MAP.md); the owning primary workspace is the business authority.
