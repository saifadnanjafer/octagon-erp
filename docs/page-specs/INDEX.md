# Octagon Page Specification Catalog

Baseline: `25c24df753962bbf3c13301eed71624bc0ee39b6`  
Primary workspaces: **231**  
Embedded tabs excluded from primary specs: **calculator, kanban, locations, workshop_tv**  
Compatibility alias excluded from primary specs: **pos_deepening**

## Counts

- STRONG: 84
- USABLE: 58
- THIN: 89
- EMPTY: 0
- CONFUSING: 0
- BROKEN: 0
- Generic-shell risks: 0
- Consolidation candidates: 0
- Missing meaningful primary action: 90
- No verified backend path: 146
- Fixture-empty or fixture not verified: 3

## Domains

- admin: 13
- commercial: 43
- core: 11
- finance: 25
- intelligence: 19
- ops: 72
- resources: 48

### admin

| Page ID | English | Arabic | Kind | Status | Functional | Usability | Recommended disposition | Spec |
|---|---|---|---|---|---|---|---|---|
| `admin_panel` | Admin Panel | لوحة تحكم الأدمن | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./admin/admin_panel.md) |
| `data_quality` | Data Quality | جودة البيانات | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./admin/data_quality.md) |
| `deploy_ready` | Deploy Ready | جاهزية التشغيل | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./admin/deploy_ready.md) |
| `device_center` | Device Center | مركز الأجهزة وإنترنت الأشياء | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./admin/device_center.md) |
| `employee_ui` | Employee Ui | لوحة الموظف | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./admin/employee_ui.md) |
| `import_center` | Data Import | استيراد البيانات | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./admin/import_center.md) |
| `integration_hub` | Integration Hub | مركز التكامل | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./admin/integration_hub.md) |
| `multi_entity` | Multi Entity | الفروع والعملات | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./admin/multi_entity.md) |
| `risk_compliance` | Risk Compliance | المخاطر والامتثال | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./admin/risk_compliance.md) |
| `security_center` | Security Center | التدقيق والأمن | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./admin/security_center.md) |
| `system_check` | System Check | فحص النظام | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./admin/system_check.md) |
| `system_settings` | System Settings | إعدادات النظام | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./admin/system_settings.md) |
| `training_lms` | Training Lms | التدريب والتعلم | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./admin/training_lms.md) |

### commercial

| Page ID | English | Arabic | Kind | Status | Functional | Usability | Recommended disposition | Spec |
|---|---|---|---|---|---|---|---|---|
| `appointments` | Appointments | المواعيد والحجوزات | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./commercial/appointments.md) |
| `attribution_insights` | Attribution Insights | تحليلات الإسناد | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./commercial/attribution_insights.md) |
| `billing_simulator` | Billing Simulator | محاكي الفوترة | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./commercial/billing_simulator.md) |
| `campaigns` | Campaigns | الحملات | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./commercial/campaigns.md) |
| `clinic` | Clinic | العيادة | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./commercial/clinic.md) |
| `commercial_plans` | Commercial Plans | الخطط التجارية | SETUP | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./commercial/commercial_plans.md) |
| `content_approvals` | Content Approvals | اعتمادات المحتوى | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./commercial/content_approvals.md) |
| `content_calendar` | Content Calendar | تقويم المحتوى | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./commercial/content_calendar.md) |
| `customer_portal` | Customer Portal | بوابة العميل | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./commercial/customer_portal.md) |
| `entitlements` | Entitlements | الاستحقاقات | SETUP | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./commercial/entitlements.md) |
| `event_checkin` | Event Check-in | تسجيل حضور الفعالية | TRANSACTION | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./commercial/event_checkin.md) |
| `event_planner` | Event Planner | مخطط الفعاليات | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./commercial/event_planner.md) |
| `event_registrations` | Event Registrations | تسجيلات الفعاليات | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./commercial/event_registrations.md) |
| `events` | Events | الفعاليات | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./commercial/events.md) |
| `events_overview` | Events Overview | نظرة عامة على الفعاليات | DASHBOARD | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./commercial/events_overview.md) |
| `extension_installations` | Extension Installations | تثبيت الإضافات | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./commercial/extension_installations.md) |
| `extension_marketplace` | Extension Marketplace | سوق الإضافات | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./commercial/extension_marketplace.md) |
| `field_service` | Field Service | الخدمة الميدانية | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./commercial/field_service.md) |
| `helpdesk` | Helpdesk | خدمة العملاء | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./commercial/helpdesk.md) |
| `hotel` | Hotel | الفندق | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./commercial/hotel.md) |
| `loyalty` | Loyalty | برنامج الولاء والمكافآت | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./commercial/loyalty.md) |
| `marketing` | Marketing | التسويق والحملات | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./commercial/marketing.md) |
| `marketing_overview` | Marketing Overview | نظرة عامة على التسويق | DASHBOARD | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./commercial/marketing_overview.md) |
| `omni_communications` | Omni Communications | مشاركة وإرسال | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./commercial/omni_communications.md) |
| `pharmacy` | Pharmacy | الصيدلية | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./commercial/pharmacy.md) |
| `pos` | Pos | نقطة البيع | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./commercial/pos.md) |
| `real-estate` | Real Estate | العقارات | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./commercial/real-estate.md) |
| `rental` | Rental | تأجير المعدات | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./commercial/rental.md) |
| `restaurant` | Restaurant | المطعم | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./commercial/restaurant.md) |
| `retail` | Retail | المتجر | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./commercial/retail.md) |
| `saas_overview` | SaaS Overview | نظرة عامة على البرمجيات كخدمة | DASHBOARD | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./commercial/saas_overview.md) |
| `sales` | Sales | المبيعات والعملاء | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./commercial/sales.md) |
| `sales_commission` | Sales Commission | العمولات | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./commercial/sales_commission.md) |
| `sales_contracts` | Sales Contracts | العقود والموافقات | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./commercial/sales_contracts.md) |
| `sales_price_lists` | Sales Price Lists | قوائم الأسعار | LIST | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./commercial/sales_price_lists.md) |
| `seats_and_limits` | Seats and Limits | المقاعد والحدود | SETUP | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./commercial/seats_and_limits.md) |
| `subscriptions` | Subscriptions | الاشتراكات | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./commercial/subscriptions.md) |
| `tenant_detail` | Tenant Detail | تفاصيل المستأجر | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./commercial/tenant_detail.md) |
| `tenant_directory` | Tenant Directory | دليل المستأجرين | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./commercial/tenant_directory.md) |
| `usage_and_quotas` | Usage and Quotas | الاستخدام والحصص | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./commercial/usage_and_quotas.md) |
| `vertical_packs` | Vertical Packs | حزم القطاعات | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./commercial/vertical_packs.md) |
| `warranty` | Warranty | الضمان والمرتجعات | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./commercial/warranty.md) |
| `workshop_pack_setup` | Workshop Pack Setup | إعداد حزمة الورشة | SETUP | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./commercial/workshop_pack_setup.md) |

### core

| Page ID | English | Arabic | Kind | Status | Functional | Usability | Recommended disposition | Spec |
|---|---|---|---|---|---|---|---|---|
| `calendar` | Calendar | تقويم الدوام | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./core/calendar.md) |
| `employee_mobile` | Employee Mobile | مهامي اليوم (موبايل) | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./core/employee_mobile.md) |
| `employees` | Employees | الموظفين والأرصدة | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./core/employees.md) |
| `help_manual` | Help Manual | دليل الاستخدام | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./core/help_manual.md) |
| `home` | Home | الرئيسية | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./core/home.md) |
| `import` | Import | استيراد البيانات | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./core/import.md) |
| `my_work` | My Work | عملي | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./core/my_work.md) |
| `receipt` | Receipt | إنشاء وصل | TRANSACTION | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./core/receipt.md) |
| `report` | Report | التقرير النهائي | ANALYTICS | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./core/report.md) |
| `timesheet` | Timesheet | التايم شيت الذكي | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./core/timesheet.md) |
| `wfl_home` | Wfl Home | الرئيسية حسب الدور | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./core/wfl_home.md) |

### finance

| Page ID | English | Arabic | Kind | Status | Functional | Usability | Recommended disposition | Spec |
|---|---|---|---|---|---|---|---|---|
| `account_mapping` | Account Mapping | · ربط الحسابات | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/account_mapping.md) |
| `ar_ap` | Ar Ap | الذمم المدينة والدائنة | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/ar_ap.md) |
| `banking` | Banking | البنوك والخزينة | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/banking.md) |
| `budgeting` | Budgeting | الموازنات | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/budgeting.md) |
| `cashbox` | Cashbox | قاصة الورشة | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./finance/cashbox.md) |
| `consolidated_reports` | Consolidated Reports | · التقارير الموحدة | ANALYTICS | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/consolidated_reports.md) |
| `consolidation_groups` | Consolidation Groups | · مجموعات التوحيد | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/consolidation_groups.md) |
| `consolidation_lineage` | Consolidation Lineage | · تتبع التوحيد | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/consolidation_lineage.md) |
| `consolidation_runs` | Consolidation Runs | · عمليات التوحيد | TRANSACTION | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/consolidation_runs.md) |
| `customers` | Customers | أرصدة العملاء | LIST | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./finance/customers.md) |
| `eliminations` | Eliminations | · قيود الاستبعاد | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/eliminations.md) |
| `expenses` | Expenses | المصروفات | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./finance/expenses.md) |
| `finance` | Finance | الداشبورد المالي | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./finance/finance.md) |
| `finance_installments` | Finance Installments | خطط التقسيط | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/finance_installments.md) |
| `financing_facilities` | Financing Facilities | · تسهيلات التمويل | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/financing_facilities.md) |
| `income` | Income | الواردات | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./finance/income.md) |
| `intercompany_reconciliation` | Intercompany Reconciliation | · التسوية والمطابقة | TRANSACTION | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/intercompany_reconciliation.md) |
| `intercompany_transactions` | Intercompany Transactions | · المعاملات المتبادلة | TRANSACTION | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/intercompany_transactions.md) |
| `liquidity_forecast` | Liquidity Forecast | · تنبؤ السيولة | ANALYTICS | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/liquidity_forecast.md) |
| `mismatch_queue` | Mismatch Queue | · قائمة عدم التطابق | QUEUE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/mismatch_queue.md) |
| `payment_funding_proposals` | Payment Funding Proposals | · مقترحات الدفع والتمويل | TRANSACTION | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/payment_funding_proposals.md) |
| `tax_compliance` | Tax Compliance | الضرائب والفوترة | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/tax_compliance.md) |
| `treasury_alerts` | Treasury Alerts | · تنبيهات الخزينة | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/treasury_alerts.md) |
| `treasury_cash_position` | Treasury Cash Position | · مركز النقد | DASHBOARD | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/treasury_cash_position.md) |
| `workshop_ledger` | Workshop Ledger | محاسبة ودوام الورشة | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./finance/workshop_ledger.md) |

### intelligence

| Page ID | English | Arabic | Kind | Status | Functional | Usability | Recommended disposition | Spec |
|---|---|---|---|---|---|---|---|---|
| `ai_assistant` | AI Assistant | مساعد الذكاء الاصطناعي | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./intelligence/ai_assistant.md) |
| `ai_context_sources` | AI Context Sources | مصادر سياق الذكاء الاصطناعي | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./intelligence/ai_context_sources.md) |
| `ai_factory` | Ai Factory | مصنع التطوير | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./intelligence/ai_factory.md) |
| `ai_overview` | AI Overview | نظرة عامة على الذكاء الاصطناعي | DASHBOARD | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./intelligence/ai_overview.md) |
| `ai_policy_registry` | AI Policy Registry | سجل سياسات الذكاء الاصطناعي | SETUP | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./intelligence/ai_policy_registry.md) |
| `ai_prompt_templates` | AI Prompt Templates | قوالب أوامر الذكاء الاصطناعي | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./intelligence/ai_prompt_templates.md) |
| `ai_proposal_inbox` | AI Proposal Inbox | صندوق مقترحات الذكاء الاصطناعي | QUEUE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./intelligence/ai_proposal_inbox.md) |
| `ai_queue` | Ai Queue | طابور الذكاء | QUEUE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./intelligence/ai_queue.md) |
| `ai_run_history` | AI Run History | سجل تشغيل الذكاء الاصطناعي | TRANSACTION | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./intelligence/ai_run_history.md) |
| `ai_status` | Ai Status | حالة الذكاء الصناعي | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./intelligence/ai_status.md) |
| `ai_tools` | Ai Tools | سجل أدوات الذكاء | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./intelligence/ai_tools.md) |
| `analytics` | Analytics | التحليلات والذكاء | ANALYTICS | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./intelligence/analytics.md) |
| `automation` | Automation | محرك الأتمتة | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./intelligence/automation.md) |
| `intelligence` | Intelligence | لوحة الذكاء | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./intelligence/intelligence.md) |
| `nl_reports` | Nl Reports | التقارير الذكية | ANALYTICS | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./intelligence/nl_reports.md) |
| `route_health` | Route Health | فحص صحة النظام | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./intelligence/route_health.md) |
| `scenario_planner` | Scenario Planner | مخطط سيناريوهات الذكاء | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./intelligence/scenario_planner.md) |
| `telegram` | Telegram | بوابة Telegram | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./intelligence/telegram.md) |
| `whatsapp` | Whatsapp | استقبال واتساب | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./intelligence/whatsapp.md) |

### ops

| Page ID | English | Arabic | Kind | Status | Functional | Usability | Recommended disposition | Spec |
|---|---|---|---|---|---|---|---|---|
| `alert_board` | Alert Board | لوحة التنبيهات | DASHBOARD | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./ops/alert_board.md) |
| `canonical_console` | Canonical Operations | العمليات الموحّدة | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/canonical_console.md) |
| `canonical_inventory` | Canonical Inventory | المخزون القانوني | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/canonical_inventory.md) |
| `command_center` | Command Center | مركز القيادة | DASHBOARD | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./ops/command_center.md) |
| `count_session` | Count Session | جلسة الجرد | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/count_session.md) |
| `crossdock_workspace` | Cross-Dock Workspace | مساحة العبور المباشر | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/crossdock_workspace.md) |
| `cycle_count_plans` | Cycle Count Plans | خطط الجرد الدوري | SETUP | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/cycle_count_plans.md) |
| `demand_planning` | Demand Planning | · تخطيط الطلب | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./ops/demand_planning.md) |
| `device_health_board` | Device Health Board | لوحة صحة الأجهزة | DASHBOARD | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./ops/device_health_board.md) |
| `dock_checkin` | Dock Check-In | تسجيل وصول الرصيف | TRANSACTION | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/dock_checkin.md) |
| `dock_schedule` | Dock Schedule | جدول الأرصفة | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/dock_schedule.md) |
| `downtime_board` | Downtime Board | لوحة التوقفات | DASHBOARD | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/downtime_board.md) |
| `employee_kiosk` | Employee Kiosk | كشك الموظف | KIOSK | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./ops/employee_kiosk.md) |
| `equipment` | Equipment | معدات الورشة | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/equipment.md) |
| `expiration_queue` | Expiration Queue | طابور تواريخ الانتهاء | QUEUE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/expiration_queue.md) |
| `fleet_operations_board` | Fleet Operations Board | لوحة عمليات الأسطول | DASHBOARD | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./ops/fleet_operations_board.md) |
| `forecast_accuracy` | Forecast Accuracy | · دقة التنبؤ | ANALYTICS | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./ops/forecast_accuracy.md) |
| `forecast_overrides` | Forecast Overrides | · تعديلات التنبؤ | ANALYTICS | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./ops/forecast_overrides.md) |
| `forecast_versions` | Forecast Versions | · إصدارات التنبؤ | ANALYTICS | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./ops/forecast_versions.md) |
| `inventory` | Inventory | المخزون والمواد | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/inventory.md) |
| `kiosk` | Kiosk | روح النظام (كيوسك) | KIOSK | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./ops/kiosk.md) |
| `kiosk_device_registry` | Kiosk Device Registry | سجل أجهزة الأكشاك | KIOSK | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./ops/kiosk_device_registry.md) |
| `lot_serial_traceability` | Lot / Serial Traceability | تتبع الدفعات والأرقام التسلسلية | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/lot_serial_traceability.md) |
| `machines` | Machines | المكائن | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/machines.md) |
| `mobile_picking` | Mobile Picking | الالتقاط المتنقل | KIOSK | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./ops/mobile_picking.md) |
| `mobile_receiving` | Mobile Receiving | الاستلام المتنقل | KIOSK | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./ops/mobile_receiving.md) |
| `mps` | Mps | · جدول الإنتاج الرئيسي | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./ops/mps.md) |
| `mps_proposals` | Mps Proposals | · مقترحات الإنتاج | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./ops/mps_proposals.md) |
| `mrp` | Mrp | تخطيط موارد التصنيع | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./ops/mrp.md) |
| `op_packs` | Op Packs | باقات العمليات | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/op_packs.md) |
| `operational_performance` | Operational Performance | الأداء التشغيلي | ANALYTICS | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/operational_performance.md) |
| `parties` | Customers &amp; Suppliers | العملاء والموردون | LIST | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/parties.md) |
| `pick_task_queue` | Pick Task Queue | طابور مهام الالتقاط | QUEUE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/pick_task_queue.md) |
| `planning_exceptions` | Planning Exceptions | · استثناءات التخطيط | QUEUE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./ops/planning_exceptions.md) |
| `production_issue_return` | Production Issue / Return | صرف وإرجاع الإنتاج | TRANSACTION | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/production_issue_return.md) |
| `production_large_screen` | Production Large Screen | شاشة الإنتاج الكبيرة | DASHBOARD | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./ops/production_large_screen.md) |
| `production_material_requests` | Production Material Requests | طلبات مواد الإنتاج | TRANSACTION | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/production_material_requests.md) |
| `production_receipt` | Production Receipt | استلام الإنتاج | TRANSACTION | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/production_receipt.md) |
| `products` | Products &amp; Materials | المنتجات والمواد | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./ops/products.md) |
| `putaway_rules` | Putaway Rules | قواعد التخزين | SETUP | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/putaway_rules.md) |
| `putaway_task_queue` | Putaway Task Queue | طابور مهام التخزين | QUEUE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/putaway_task_queue.md) |
| `qc_center` | Qc Center | مركز الجودة | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./ops/qc_center.md) |
| `quality_hold_queue` | Quality Hold Queue | طابور تعليق الجودة | QUEUE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/quality_hold_queue.md) |
| `recall_analysis` | Recall Analysis | تحليل الاستدعاءات | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/recall_analysis.md) |
| `receiving_discrepancies` | Receiving Discrepancies | فروقات الاستلام | QUEUE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/receiving_discrepancies.md) |
| `replenishment_proposals` | Replenishment Proposals | مقترحات التجديد | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/replenishment_proposals.md) |
| `replenishment_rules` | Replenishment Rules | قواعد التجديد | SETUP | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/replenishment_rules.md) |
| `rework_workspace` | Rework Workspace | مساحة إعادة العمل | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/rework_workspace.md) |
| `scrap_approval` | Scrap Approval | اعتماد الهدر | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/scrap_approval.md) |
| `service_kiosk` | Service Kiosk | كشك الخدمة | KIOSK | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./ops/service_kiosk.md) |
| `service_queue_board` | Service Queue Board | لوحة طابور الخدمة | QUEUE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./ops/service_queue_board.md) |
| `shop_floor_kiosk` | Shop Floor Kiosk | كشك أرضية الإنتاج | KIOSK | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./ops/shop_floor_kiosk.md) |
| `shopfloor_terminal` | Shop-Floor Terminal | محطة أرضية الإنتاج | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/shopfloor_terminal.md) |
| `sop` | Sop | مكتبة SOP | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./ops/sop.md) |
| `sop_review` | Sop Review | · مراجعة S&OP | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./ops/sop_review.md) |
| `sop_scenarios` | Sop Scenarios | · سيناريوهات S&OP | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./ops/sop_scenarios.md) |
| `staging_board` | Staging Board | لوحة التجهيز | DASHBOARD | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/staging_board.md) |
| `supply_demand_balance` | Supply Demand Balance | · توازن العرض والطلب | ANALYTICS | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./ops/supply_demand_balance.md) |
| `task_manager` | Task Manager | إدارة المهام | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/task_manager.md) |
| `variance_review` | Variance Review | مراجعة الفروقات | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/variance_review.md) |
| `warehouse_kiosk` | Warehouse Kiosk | كشك المستودع | KIOSK | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./ops/warehouse_kiosk.md) |
| `warehouse_large_screen` | Warehouse Large Screen | شاشة المستودع الكبيرة | DASHBOARD | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./ops/warehouse_large_screen.md) |
| `warehouse_topology` | Warehouse Topology | هيكل المستودع | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/warehouse_topology.md) |
| `warehouses` | Warehouses | المستودعات | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./ops/warehouses.md) |
| `wave_execution` | Wave Execution | تنفيذ الموجات | TRANSACTION | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/wave_execution.md) |
| `wave_planning` | Wave Planning | تخطيط الموجات | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/wave_planning.md) |
| `work_orders` | Work Orders | أوامر العمل | TRANSACTION | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./ops/work_orders.md) |
| `workcenter_queue` | Work-Center Queue | طابور مركز العمل | QUEUE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/workcenter_queue.md) |
| `workflow` | Workflow | مصمم العمليات | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/workflow.md) |
| `workshop_command_center` | Workshop Command Center | مركز قيادة الورشة | DASHBOARD | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/workshop_command_center.md) |
| `workshop_readiness` | Workshop Readiness | جاهزية الورشة | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/workshop_readiness.md) |
| `zone_bin_management` | Zone and Bin Management | إدارة المناطق والخانات | PAGE | PRIMARY | USABLE | USABLE | Retain and reconcile | [spec](./ops/zone_bin_management.md) |

### resources

| Page ID | English | Arabic | Kind | Status | Functional | Usability | Recommended disposition | Spec |
|---|---|---|---|---|---|---|---|---|
| `approvals` | Approvals | الموافقات | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/approvals.md) |
| `assets` | Assets | الأصول والصيانة | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./resources/assets.md) |
| `competency_profiles` | Competency Profiles | ملفات الكفاءات | SETUP | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/competency_profiles.md) |
| `configuration_profiles` | Configuration Profiles | ملفات الإعداد | SETUP | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/configuration_profiles.md) |
| `conflict_resolution` | Conflict Resolution | حل التعارضات | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/conflict_resolution.md) |
| `contracts` | Contracts | العقود والشؤون القانونية | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./resources/contracts.md) |
| `development_plans` | Development Plans | خطط التطوير | SETUP | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/development_plans.md) |
| `device_alerts` | Device Alerts | تنبيهات الأجهزة | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/device_alerts.md) |
| `device_command_center` | Device Command Center | مركز أوامر الأجهزة | DASHBOARD | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/device_command_center.md) |
| `device_detail` | Device Detail | تفاصيل الجهاز | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/device_detail.md) |
| `device_enrollment` | Device Enrollment | تسجيل الأجهزة | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/device_enrollment.md) |
| `device_health_center` | Device Health Center | مركز صحة الأجهزة | DASHBOARD | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/device_health_center.md) |
| `device_registry` | Device Registry | سجل الأجهزة | SETUP | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/device_registry.md) |
| `documents` | Documents | الوثائق | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./resources/documents.md) |
| `esign` | Esign | التوقيع الإلكتروني | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./resources/esign.md) |
| `firmware_catalogue` | Firmware Catalogue | دليل البرامج الثابتة | SETUP | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/firmware_catalogue.md) |
| `fleet` | Fleet | المركبات | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/fleet.md) |
| `fleet_device_mapping` | Fleet Device Mapping | ربط الأسطول بالأجهزة | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/fleet_device_mapping.md) |
| `fleet_live_map_simulator` | Fleet Live Map Simulator | محاكي الخريطة الحية للأسطول | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/fleet_live_map_simulator.md) |
| `fuel_telemetry` | Fuel Telemetry | بيانات الوقود | ANALYTICS | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/fuel_telemetry.md) |
| `gateway_management` | Gateway Management | إدارة البوابات | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/gateway_management.md) |
| `geofence_events` | Geofence Events | أحداث السياج الجغرافي | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/geofence_events.md) |
| `geofence_management` | Geofence Management | إدارة السياج الجغرافي | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/geofence_management.md) |
| `knowledge` | Knowledge | قاعدة المعرفة | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./resources/knowledge.md) |
| `knowledge_base` | Knowledge Base | قاعدة المعرفة (الفنية) | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./resources/knowledge_base.md) |
| `learning_and_certifications` | Learning & Certifications | التعلم والشهادات | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/learning_and_certifications.md) |
| `logistics` | Logistics | اللوجستيات والتوصيل | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./resources/logistics.md) |
| `maintenance_triggers` | Maintenance Triggers | محفزات الصيانة | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/maintenance_triggers.md) |
| `offline_capability_policies` | Offline Capability Policies | سياسات العمل دون اتصال | SETUP | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/offline_capability_policies.md) |
| `offline_client_registry` | Offline Client Registry | سجل عملاء دون اتصال | SETUP | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/offline_client_registry.md) |
| `offline_queue` | Offline Queue | طابور العمل دون اتصال | QUEUE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/offline_queue.md) |
| `people_development_overview` | People Development | نظرة عامة على تطوير الأفراد | DASHBOARD | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/people_development_overview.md) |
| `people_ops` | People Ops | التوظيف والإجازات | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./resources/people_ops.md) |
| `person_skill_evidence` | Skill Evidence | أدلة المهارات | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/person_skill_evidence.md) |
| `procurement` | Procurement | المشتريات | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./resources/procurement.md) |
| `projects` | Projects | المشاريع | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./resources/projects.md) |
| `rollout_simulator` | Rollout Simulator | محاكي النشر | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/rollout_simulator.md) |
| `sensor_management` | Sensor Management | إدارة المستشعرات | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/sensor_management.md) |
| `skills_catalog` | Skills Catalog | دليل المهارات | SETUP | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/skills_catalog.md) |
| `speed_and_driver_events` | Speed and Driver Events | أحداث السرعة والسائق | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/speed_and_driver_events.md) |
| `supplier_portal` | Supplier Portal | بوابة الموردين | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./resources/supplier_portal.md) |
| `surveys` | Surveys | الاستبيانات والتقييمات | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./resources/surveys.md) |
| `suspected_fuel_loss_queue` | Suspected Fuel Loss Queue | طابور فاقد الوقود المشتبه | QUEUE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/suspected_fuel_loss_queue.md) |
| `sync_conflicts` | Sync Conflicts | تعارضات المزامنة | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/sync_conflicts.md) |
| `sync_sessions` | Sync Sessions | جلسات المزامنة | PAGE | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/sync_sessions.md) |
| `telemetry_explorer` | Telemetry Explorer | مستكشف القياسات | ANALYTICS | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/telemetry_explorer.md) |
| `vehicle_trip_timeline` | Vehicle Trip Timeline | الخط الزمني لرحلات المركبة | ANALYTICS | PRIMARY | STRONG | STRONG | Retain and reconcile | [spec](./resources/vehicle_trip_timeline.md) |
| `visitors` | Visitors | إدارة الزوّار والاستقبال | PAGE | PRIMARY | THIN | THIN | Retain and reconcile | [spec](./resources/visitors.md) |
