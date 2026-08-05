(function () {
  'use strict';

  const root = window;
  const services = root.PentagonServices || {};
  root.PentagonServices = services;

  const GROUPS = {
    'system.admin': { implies: ['workshop.manager', 'finance.manager'] },
    'workshop.manager': { implies: ['workshop.user'] },
    'finance.manager': { implies: ['finance.user'] },
    'workshop.user': { implies: [] },
    'finance.user': { implies: [] },
  };

  const ROLE_GROUPS = {
    system: ['system.admin'],
    system_admin: ['system.admin'],
    admin: ['system.admin'],
    manager: ['workshop.manager', 'finance.manager'],
    finance_manager: ['finance.manager'],
    finance_user: ['finance.user'],
    workshop_manager: ['workshop.manager'],
    workshop_user: ['workshop.user'],
    operator: ['workshop.user'],
    operator_user: ['workshop.user'],
    employee: [],
    employee_user: [],
    viewer: [],
    mgr_finance: ['finance.manager'],
    user_finance: ['finance.user'],
    mgr_workshop: ['workshop.manager'],
    user_workshop: ['workshop.user'],
    role_test_sysadmin: ['system.admin'],
    role_test_workshop: ['workshop.manager'],
    role_test_finance: ['finance.manager'],
    role_test_inventory: ['workshop.user'],
    role_test_sales: ['workshop.user'],
    role_test_procurement: ['workshop.user'],
    role_test_pos: ['workshop.user'],
    role_test_viewer: [],
  };

  const MODEL_PERMISSIONS = {
    employees: { read: ['workshop.user'], create: ['workshop.manager'], update: ['workshop.manager'], delete: ['system.admin'] },
    'omni.materials': { read: ['workshop.user'], create: ['workshop.manager'], update: ['workshop.manager'], delete: ['system.admin'] },
    'omni.suppliers': { read: ['workshop.user'], create: ['workshop.manager'], update: ['workshop.manager'], delete: ['system.admin'] },
    'omni.machines': { read: ['workshop.user'], create: ['workshop.manager'], update: ['workshop.manager'], delete: ['system.admin'] },
    'omni.equipment': { read: ['workshop.user'], create: ['workshop.manager'], update: ['workshop.manager'], delete: ['system.admin'] },
    'finance.transactions': { read: ['finance.user'], create: ['finance.user'], update: ['finance.manager'], delete: ['system.admin'] },
    account_moves: { read: ['finance.user'], create: ['finance.user'], update: ['finance.manager'], delete: ['system.admin'] },
    account_payments: { read: ['finance.user'], create: ['finance.manager'], update: ['finance.manager'], delete: ['system.admin'] },
    account_partial_reconciles: { read: ['finance.user'], create: ['finance.manager'], update: ['finance.manager'], delete: ['system.admin'] },
    'finance.accounts': { read: ['finance.user'], create: ['system.admin'], update: ['system.admin'], delete: ['system.admin'] },
    'omni.banking': { read: ['finance.user'], create: ['finance.user'], update: ['finance.user'], delete: ['finance.manager'] },
    'omni.locationStock': { read: ['workshop.user'], create: ['workshop.manager'], update: ['workshop.manager'], delete: ['system.admin'] },
    journal_entries: { read: ['finance.user'], create: ['finance.user'], update: ['finance.manager'], delete: ['system.admin'] },
    stock_moves: { read: ['workshop.user'], create: ['workshop.manager'], update: ['workshop.manager'], delete: ['system.admin'] },
  };

  const ACTION_PERMISSIONS = {
    'banking.reconciliation.create': ['finance.user'],
    'banking.reconciliation.match': ['finance.user'],
    'banking.reconciliation.unmatch': ['finance.user'],
    'banking.reconciliation.finalize': ['finance.manager'],
    'banking.reconciliation.adjustment_request': ['finance.user'],
    'inventory.location.create': ['workshop.manager'],
    'inventory.location.transfer': ['workshop.user'],
    'inventory.location.adjust': ['workshop.manager'],
    'inventory.location.issue': ['workshop.user'],
    'inventory.location.receive': ['workshop.user'],
    'accounting.coa.create': ['finance.manager'],
    'accounting.coa.edit_safe': ['finance.manager'],
    'accounting.coa.edit_used': ['system.admin'],
    'accounting.coa.deactivate': ['finance.manager'],
    'accounting.coa.deactivate_used': ['system.admin'],
    'risk_compliance.write': ['workshop.manager', 'finance.manager'],
    'hr.salary.change': ['system.admin'],
    'hr.attendance.locked_period_edit': ['system.admin'],
    'hr.payroll.reopen_period': ['system.admin'],
    'hr.deduction_fine.create': ['system.admin'],
    'hr.advance_loan.create': ['workshop.manager', 'finance.manager'],
    'hr.employee.terminate': ['system.admin'],
    'hr.role_permission.change': ['system.admin'],
    'hr.leave.payroll_affecting_approve': ['workshop.manager'],
    'hr.employee.delete': ['system.admin'],
  };

  const ACTION_METADATA = {
    'banking.reconciliation.create': { page: 'banking', module: 'phase6a_core', riskLevel: 'medium', label: 'اضافة سطر كشف بنكي' },
    'banking.reconciliation.match': { page: 'banking', module: 'phase6a_core', riskLevel: 'medium', label: 'مطابقة سطر بنكي' },
    'banking.reconciliation.unmatch': { page: 'banking', module: 'phase6a_core', riskLevel: 'medium', label: 'الغاء مطابقة بنكية' },
    'banking.reconciliation.finalize': { page: 'banking', module: 'phase6a_core', riskLevel: 'high', approvalRequired: true, label: 'اعتماد تسوية بنكية نهائية' },
    'banking.reconciliation.adjustment_request': { page: 'banking', module: 'phase6a_core', riskLevel: 'high', approvalRequired: true, label: 'طلب تسوية فرق بنكي' },
    'banking.reconciliation.legacy_finance_movement': { page: 'banking', module: 'phase6a_core', riskLevel: 'critical', approvalRequired: true, label: 'انشاء حركة مالية مباشرة من البنك' },
    'inventory.location.create': { page: 'inventory', module: 'phase6a_core', riskLevel: 'medium', label: 'انشاء موقع تخزين' },
    'inventory.location.transfer': { page: 'inventory', module: 'phase6a_core', riskLevel: 'medium', label: 'تحويل مخزون بين مواقع' },
    'inventory.location.adjust': { page: 'inventory', module: 'phase6a_core', riskLevel: 'high', approvalRequired: true, label: 'تسوية كمية موقعية' },
    'inventory.location.issue': { page: 'inventory', module: 'phase6a_core', riskLevel: 'medium', label: 'صرف مخزون من موقع' },
    'inventory.location.receive': { page: 'inventory', module: 'phase6a_core', riskLevel: 'medium', label: 'استلام مخزون في موقع' },
    'inventory.location.negative_issue': { page: 'inventory', module: 'phase6a_core', riskLevel: 'critical', approvalRequired: true, label: 'صرف مخزون سالب' },
    'inventory.location.delete_with_stock': { page: 'inventory', module: 'phase6a_core', riskLevel: 'critical', label: 'حذف موقع عليه رصيد او حركة' },
    'accounting.coa.create': { page: 'admin_panel', module: 'phase6a_core', riskLevel: 'medium', label: 'انشاء حساب دليل حسابات' },
    'accounting.coa.edit_safe': { page: 'admin_panel', module: 'phase6a_core', riskLevel: 'medium', label: 'تعديل بيانات حساب غير مستخدم' },
    'accounting.coa.edit_used': { page: 'admin_panel', module: 'phase6a_core', riskLevel: 'critical', approvalRequired: true, label: 'تعديل حساب مستخدم في قيود' },
    'accounting.coa.deactivate': { page: 'admin_panel', module: 'phase6a_core', riskLevel: 'high', label: 'تعطيل حساب غير مستخدم' },
    'accounting.coa.deactivate_used': { page: 'admin_panel', module: 'phase6a_core', riskLevel: 'critical', approvalRequired: true, label: 'تعطيل حساب مستخدم' },
    'accounting.coa.delete_used': { page: 'admin_panel', module: 'phase6a_core', riskLevel: 'critical', label: 'حذف حساب مستخدم' },
    'finance.direct_posting.external': { page: 'finance', module: 'finance', riskLevel: 'critical', approvalRequired: true, label: 'ترحيل مالي مباشر من مصدر خارجي' },
    'risk_compliance.write': { page: 'risk_compliance', module: 'risk_compliance', riskLevel: 'high', label: 'كتابة سجل مخاطر او رقابة' },
    'risk_compliance.delete': { page: 'risk_compliance', module: 'risk_compliance', riskLevel: 'critical', label: 'حذف سجل مخاطر او رقابة' },
    'ai.high_risk_write': { page: 'intelligence', module: 'jarvis', riskLevel: 'critical', approvalRequired: true, label: 'كتابة عالية الخطورة عبر الذكاء' },
    'hr.salary.change': { page: 'employees', module: 'hr_payroll', riskLevel: 'critical', approvalRequired: true, label: 'تغيير راتب موظف' },
    'hr.attendance.locked_period_edit': { page: 'timesheet', module: 'hr_payroll', riskLevel: 'critical', approvalRequired: true, label: 'تعديل حضور فترة رواتب مقفلة' },
    'hr.payroll.reopen_period': { page: 'employees', module: 'hr_payroll', riskLevel: 'critical', approvalRequired: true, label: 'إعادة فتح فترة رواتب مرحّلة' },
    'hr.deduction_fine.create': { page: 'employees', module: 'hr_payroll', riskLevel: 'high', approvalRequired: true, label: 'إضافة خصم أو غرامة' },
    'hr.advance_loan.create': { page: 'employees', module: 'hr_payroll', riskLevel: 'high', approvalRequired: true, label: 'إضافة سلفة أو قرض' },
    'hr.employee.terminate': { page: 'employees', module: 'hr', riskLevel: 'critical', approvalRequired: true, label: 'إنهاء أو تعطيل موظف' },
    'hr.role_permission.change': { page: 'admin_panel', module: 'security', riskLevel: 'critical', approvalRequired: true, label: 'تغيير دور أو صلاحيات' },
    'hr.leave.payroll_affecting_approve': { page: 'employees', module: 'hr_payroll', riskLevel: 'high', approvalRequired: true, label: 'اعتماد إجازة مؤثرة على الرواتب' },
    'hr.employee.delete': { page: 'employees', module: 'hr', riskLevel: 'critical', approvalRequired: true, label: 'حذف سجل موظف' },
  };

  const SENSITIVE_FIELDS = {
    employees: {
      salary: ['workshop.manager', 'finance.user'],
      baseSalary: ['workshop.manager', 'finance.user'],
      nominalSalary: ['workshop.manager', 'finance.user'],
      prevAdvance: ['workshop.manager', 'finance.user'],
      advance: ['workshop.manager', 'finance.user'],
      bonus: ['workshop.manager', 'finance.user'],
      damage: ['workshop.manager', 'finance.user'],
      penalty: ['workshop.manager', 'finance.user'],
    },
    'finance.transactions': {
      amount: ['finance.user'],
    },
    journal_entries: {
      debit: ['finance.user'],
      credit: ['finance.user'],
    },
    account_moves: {
      debit: ['finance.user'],
      credit: ['finance.user'],
    }
  };

  const BOOTSTRAP_ACTION_ID_MAP = {
    'db_write': 'db_write',
    'platform:db:write': 'db_write',
    'backup_verify': 'backup_verify',
    'platform:backup:verify': 'backup_verify',
    'backup_restore': 'backup_restore',
    'platform:backup:restore': 'backup_restore',
    'tts': 'tts',
    'platform:tts:use': 'tts',
    'review_report': 'review_report',
    'platform:review_report:save': 'review_report',
  };
  
  const PAGE_METADATA = {
    home: { sensitivity: 'system/home', riskLevel: 'low', phase: 'core', label: 'Home dashboard' },
    finance: { sensitivity: 'finance', riskLevel: 'high', phase: 'core', label: 'Finance dashboard' },
    cashbox: { sensitivity: 'finance', riskLevel: 'high', phase: 'core', label: 'Cashbox' },
    expenses: { sensitivity: 'finance', riskLevel: 'high', phase: 'core', label: 'Expenses' },
    income: { sensitivity: 'finance', riskLevel: 'high', phase: 'core', label: 'Income' },
    customers: { sensitivity: 'finance', riskLevel: 'medium', phase: 'core', label: 'Customer balances' },
    receipt: { sensitivity: 'finance', riskLevel: 'medium', phase: 'core', label: 'Receipts' },
    report: { sensitivity: 'finance/payroll', riskLevel: 'high', phase: 'core', label: 'Payroll report' },
    ar_ap: { sensitivity: 'finance', riskLevel: 'high', phase: 'phase6e', label: 'AR/AP workbench' },
    banking: { sensitivity: 'finance', riskLevel: 'high', phase: 'phase6a', label: 'Banking and treasury' },
    budgeting: { sensitivity: 'finance', riskLevel: 'high', phase: 'phase6e', label: 'Budgeting' },
    tax_compliance: { sensitivity: 'finance/compliance', riskLevel: 'high', phase: 'phase6b', label: 'Tax compliance' },
    import: { sensitivity: 'hr/payroll', riskLevel: 'high', phase: 'phase6e', label: 'Attendance import' },
    timesheet: { sensitivity: 'hr/payroll', riskLevel: 'high', phase: 'phase6e', label: 'Timesheet' },
    calendar: { sensitivity: 'hr/payroll', riskLevel: 'medium', phase: 'phase6e', label: 'Attendance calendar' },
    employees: { sensitivity: 'hr/payroll', riskLevel: 'high', phase: 'core', label: 'Employees and balances' },
    people_ops: { sensitivity: 'hr/people', riskLevel: 'high', phase: 'phase6e', label: 'People operations' },
    employee_ui: { sensitivity: 'employee_self_service', riskLevel: 'low', phase: 'phase6e', label: 'Employee self service' },
    employee_mobile: { sensitivity: 'employee_self_service', riskLevel: 'low', phase: 'phase6e', label: 'Employee mobile' },
    command_center: { sensitivity: 'manager/system', riskLevel: 'high', phase: 'core', label: 'Command Center' },
    workshop_command_center: { sensitivity: 'workshop/operations', riskLevel: 'medium', phase: 'internal-workshop-wave', label: 'Workshop Command Center' },
    my_work: { sensitivity: 'workshop/operations', riskLevel: 'low', phase: 'internal-workshop-wave', label: 'My Work' },
    workshop_readiness: { sensitivity: 'workshop/setup', riskLevel: 'medium', phase: 'internal-workshop-wave', label: 'Workshop Readiness' },
    analytics: { sensitivity: 'manager/reporting', riskLevel: 'medium', phase: 'core', label: 'Analytics' },
    nl_reports: { sensitivity: 'manager/reporting', riskLevel: 'medium', phase: 'core', label: 'Natural language reports' },
    intelligence: { sensitivity: 'ai/system', riskLevel: 'high', phase: 'core', label: 'AI intelligence' },
    automation: { sensitivity: 'ai/system', riskLevel: 'critical', phase: 'core', label: 'Automation engine' },
    whatsapp: { sensitivity: 'ai/customer_comms', riskLevel: 'high', phase: 'core', label: 'WhatsApp control' },
    telegram: { sensitivity: 'ai/customer_comms', riskLevel: 'high', phase: 'core', label: 'Telegram connector' },
    ai_queue: { sensitivity: 'ai/system', riskLevel: 'high', phase: 'phase6e', label: 'AI approval queue' },
    ai_factory: { sensitivity: 'ai/system', riskLevel: 'critical', phase: 'phase6e', label: 'AI factory' },
    ai_tools: { sensitivity: 'ai/system', riskLevel: 'critical', phase: 'phase6e', label: 'AI tools' },
    ai_status: { sensitivity: 'ai/system', riskLevel: 'medium', phase: 'phase6e', label: 'AI status' },
    deploy_ready: { sensitivity: 'system/readiness', riskLevel: 'high', phase: 'phase6e', label: 'Deployment readiness' },
    admin_panel: { sensitivity: 'admin/security', riskLevel: 'critical', phase: 'core', label: 'Admin panel' },
    settings: { sensitivity: 'admin/security', riskLevel: 'critical', phase: 'core', label: 'Settings' },
    multi_entity: { sensitivity: 'admin/tenant', riskLevel: 'critical', phase: 'phase6e', label: 'Multi-entity control' },
    integration_hub: { sensitivity: 'admin/integration', riskLevel: 'critical', phase: 'phase6e', label: 'Integration hub' },
    security_center: { sensitivity: 'admin/security', riskLevel: 'critical', phase: 'phase6e', label: 'Security center' },
    data_quality: { sensitivity: 'admin/data', riskLevel: 'high', phase: 'phase6e', label: 'Data quality' },
    route_health: { sensitivity: 'system/diagnostic', riskLevel: 'medium', phase: 'phase6e', label: 'Route health' },
    system_check: { sensitivity: 'system/diagnostic', riskLevel: 'medium', phase: 'phase5', label: 'System check' },
    scenario_planner: { sensitivity: 'manager/planning', riskLevel: 'medium', phase: 'phase6e', label: 'Scenario planner' },
    device_center: { sensitivity: 'admin/device', riskLevel: 'high', phase: 'phase6e', label: 'Device center' },
    training_lms: { sensitivity: 'hr/training', riskLevel: 'medium', phase: 'phase6e', label: 'Training LMS' },
    risk_compliance: { sensitivity: 'compliance', riskLevel: 'high', phase: 'phase6b', label: 'Risk compliance' },
    procurement: { sensitivity: 'procurement/finance', riskLevel: 'high', phase: 'phase6e', label: 'Procurement' },
    supplier_portal: { sensitivity: 'procurement/finance', riskLevel: 'high', phase: 'phase6e', label: 'Supplier portal' },
    approvals: { sensitivity: 'manager/approval', riskLevel: 'high', phase: 'phase6e', label: 'Approvals' },
    customer_portal: { sensitivity: 'public/customer', riskLevel: 'low', phase: 'core', label: 'Customer portal' },
    calculator: { sensitivity: 'employee_self_service', riskLevel: 'low', phase: 'phase6h', label: 'Smart Calculator' },
    inventory: { sensitivity: 'workshop/inventory', riskLevel: 'high', phase: 'core', label: 'Inventory and stock' },
    canonical_console: { sensitivity: 'platform/canonical', riskLevel: 'high', phase: 'visible-expansion', label: 'Canonical Operations console' },
    canonical_inventory: { sensitivity: 'workshop/inventory', riskLevel: 'high', phase: 'visible-expansion', label: 'Canonical Inventory and Warehouses' },
    sales: { sensitivity: 'sales/commerce', riskLevel: 'medium', phase: 'core', label: 'Sales' },
    machines: { sensitivity: 'workshop/production', riskLevel: 'medium', phase: 'core', label: 'Machines' },
    equipment: { sensitivity: 'workshop/production', riskLevel: 'medium', phase: 'core', label: 'Equipment' },
    op_packs: { sensitivity: 'workshop/production', riskLevel: 'medium', phase: 'core', label: 'Operation packs' },
    qc_center: { sensitivity: 'workshop/quality', riskLevel: 'medium', phase: 'core', label: 'QC center' },
    sop: { sensitivity: 'workshop/quality', riskLevel: 'low', phase: 'core', label: 'SOP library' },
    workflow: { sensitivity: 'workshop/operations', riskLevel: 'medium', phase: 'core', label: 'Workflow designer' },
    kanban: { sensitivity: 'workshop/operations', riskLevel: 'low', phase: 'core', label: 'Kanban board' },
    task_manager: { sensitivity: 'workshop/operations', riskLevel: 'low', phase: 'core', label: 'Task manager' },
    mrp: { sensitivity: 'workshop/production', riskLevel: 'medium', phase: 'phase6h', label: 'Manufacturing MRP II' },
    work_orders: { sensitivity: 'workshop/production', riskLevel: 'medium', phase: 'phase6h', label: 'Work Orders' },
    wfl_home: { sensitivity: 'employee_self_service', riskLevel: 'low', phase: 'phase6h', label: 'Role Home' },
    workshop_tv: { sensitivity: 'public/display', riskLevel: 'low', phase: 'phase6h', label: 'Workshop TV' },
    kiosk: { sensitivity: 'public/display', riskLevel: 'low', phase: 'phase6h', label: 'Kiosk Terminal' },
    pos: { sensitivity: 'workshop/pos', riskLevel: 'medium', phase: 'phase6h', label: 'Point of Sale' },
    sales_price_lists: { sensitivity: 'sales/pricing', riskLevel: 'medium', phase: 'phase7j', label: 'Sales price lists' },
    sales_commission: { sensitivity: 'sales/commission', riskLevel: 'high', phase: 'phase7j', label: 'Sales commission' },
    sales_contracts: { sensitivity: 'sales/contracts', riskLevel: 'high', phase: 'phase7j', label: 'Sales contracts' },
    finance_installments: { sensitivity: 'finance/installments', riskLevel: 'high', phase: 'phase7j', label: 'Finance installments' },
    pos_deepening: { sensitivity: 'workshop/pos', riskLevel: 'medium', phase: 'phase7j', label: 'POS deepening' },
    omni_communications: { sensitivity: 'ai/customer_comms', riskLevel: 'high', phase: 'phase7j', label: 'Omni communications' },
    pharmacy: { sensitivity: 'vertical/pharmacy', riskLevel: 'medium', phase: 'phase6h', label: 'Pharmacy vertical' },
    retail: { sensitivity: 'vertical/retail', riskLevel: 'medium', phase: 'phase6h', label: 'Retail vertical' },
    clinic: { sensitivity: 'vertical/clinic', riskLevel: 'medium', phase: 'phase6h', label: 'Clinic vertical' },
    restaurant: { sensitivity: 'vertical/restaurant', riskLevel: 'medium', phase: 'phase6h', label: 'Restaurant vertical' },
    'real-estate': { sensitivity: 'vertical/real_estate', riskLevel: 'medium', phase: 'phase6h', label: 'Real Estate vertical' },
    hotel: { sensitivity: 'vertical/hotel', riskLevel: 'medium', phase: 'phase6h', label: 'Hotel vertical' },
    assets: { sensitivity: 'workshop/maintenance', riskLevel: 'medium', phase: 'phase6h', label: 'Fixed Assets' },
    subscriptions: { sensitivity: 'finance/billing', riskLevel: 'medium', phase: 'phase6h', label: 'Subscriptions' },
    appointments: { sensitivity: 'workshop/operations', riskLevel: 'medium', phase: 'phase6h', label: 'Appointments' },
    loyalty: { sensitivity: 'workshop/operations', riskLevel: 'medium', phase: 'phase6h', label: 'Loyalty programs' },
    events: { sensitivity: 'workshop/operations', riskLevel: 'medium', phase: 'phase6h', label: 'Events Hub' },
    helpdesk: { sensitivity: 'workshop/operations', riskLevel: 'medium', phase: 'phase6h', label: 'Helpdesk' },
    fleet: { sensitivity: 'workshop/logistics', riskLevel: 'medium', phase: 'phase6h', label: 'Fleet Management' },
    documents: { sensitivity: 'workshop/operations', riskLevel: 'medium', phase: 'phase6h', label: 'Document Library' },
    esign: { sensitivity: 'workshop/operations', riskLevel: 'medium', phase: 'phase6h', label: 'E-Signatures' },
    knowledge: { sensitivity: 'workshop/operations', riskLevel: 'low', phase: 'phase6h', label: 'Knowledge Base' },
    knowledge_base: { sensitivity: 'workshop/operations', riskLevel: 'low', phase: 'phase8d', label: 'Knowledge Base & FAQ' },
    surveys: { sensitivity: 'workshop/operations', riskLevel: 'low', phase: 'phase6h', label: 'Surveys' },
    visitors: { sensitivity: 'workshop/operations', riskLevel: 'low', phase: 'phase6h', label: 'Visitor Logs' },
    marketing: { sensitivity: 'workshop/operations', riskLevel: 'medium', phase: 'phase6h', label: 'Marketing' },
    projects: { sensitivity: 'workshop/operations', riskLevel: 'medium', phase: 'phase6h', label: 'Project Hub' },
    field_service: { sensitivity: 'workshop/operations', riskLevel: 'medium', phase: 'phase6h', label: 'Field Service' },
    rental: { sensitivity: 'workshop/operations', riskLevel: 'medium', phase: 'phase6h', label: 'Rental Hub' },
    warranty: { sensitivity: 'workshop/operations', riskLevel: 'medium', phase: 'phase6h', label: 'Warranty & RMA' },
    workshop_ledger: { sensitivity: 'finance/workshop', riskLevel: 'high', phase: 'phase6h', label: 'Workshop ledger' },
    contracts: { sensitivity: 'finance/compliance', riskLevel: 'high', phase: 'phase6h', label: 'Contracts Hub' },
    logistics: { sensitivity: 'workshop/logistics', riskLevel: 'medium', phase: 'phase6h', label: 'Logistics cargo' },
    help_manual: { sensitivity: 'employee_self_service', riskLevel: 'low', phase: 'phase6h', label: 'Help manual' },
    demand_planning: { sensitivity: 'planning', riskLevel: 'high', phase: 'build08', label: 'Demand planning' },
    forecast_versions: { sensitivity: 'planning', riskLevel: 'high', phase: 'build08', label: 'Forecast versions' },
    forecast_overrides: { sensitivity: 'planning', riskLevel: 'high', phase: 'build08', label: 'Forecast overrides' },
    forecast_accuracy: { sensitivity: 'planning', riskLevel: 'medium', phase: 'build08', label: 'Forecast accuracy' },
    planning_exceptions: { sensitivity: 'planning', riskLevel: 'high', phase: 'build08', label: 'Planning exceptions' },
    mps: { sensitivity: 'planning/production', riskLevel: 'high', phase: 'build08', label: 'Master production schedule' },
    mps_proposals: { sensitivity: 'planning/production', riskLevel: 'high', phase: 'build08', label: 'MPS proposals' },
    supply_demand_balance: { sensitivity: 'planning/production', riskLevel: 'medium', phase: 'build08', label: 'Supply demand balance' },
    sop_scenarios: { sensitivity: 'planning/finance', riskLevel: 'high', phase: 'build08', label: 'S and OP scenarios' },
    sop_review: { sensitivity: 'planning/finance', riskLevel: 'high', phase: 'build08', label: 'S and OP review' },
    treasury_cash_position: { sensitivity: 'finance/treasury', riskLevel: 'high', phase: 'build08', label: 'Treasury cash position' },
    liquidity_forecast: { sensitivity: 'finance/treasury', riskLevel: 'high', phase: 'build08', label: 'Liquidity forecast' },
    treasury_alerts: { sensitivity: 'finance/treasury', riskLevel: 'high', phase: 'build08', label: 'Treasury alerts' },
    payment_funding_proposals: { sensitivity: 'finance/treasury', riskLevel: 'critical', phase: 'build08', label: 'Payment funding proposals' },
    financing_facilities: { sensitivity: 'finance/treasury', riskLevel: 'high', phase: 'build08', label: 'Financing facilities' },
    intercompany_transactions: { sensitivity: 'finance/intercompany', riskLevel: 'critical', phase: 'build08', label: 'Intercompany transactions' },
    mismatch_queue: { sensitivity: 'finance/intercompany', riskLevel: 'high', phase: 'build08', label: 'Intercompany mismatch queue' },
    intercompany_reconciliation: { sensitivity: 'finance/intercompany', riskLevel: 'critical', phase: 'build08', label: 'Intercompany reconciliation' },
    consolidation_groups: { sensitivity: 'finance/consolidation', riskLevel: 'critical', phase: 'build08', label: 'Consolidation groups' },
    account_mapping: { sensitivity: 'finance/consolidation', riskLevel: 'critical', phase: 'build08', label: 'Consolidation account mapping' },
    consolidation_runs: { sensitivity: 'finance/consolidation', riskLevel: 'critical', phase: 'build08', label: 'Consolidation runs' },
    eliminations: { sensitivity: 'finance/consolidation', riskLevel: 'critical', phase: 'build08', label: 'Consolidation eliminations' },
    consolidated_reports: { sensitivity: 'finance/consolidation', riskLevel: 'high', phase: 'build08', label: 'Consolidated reports' },
    consolidation_lineage: { sensitivity: 'finance/consolidation', riskLevel: 'high', phase: 'build08', label: 'Consolidation lineage' },
    warehouse_topology: { sensitivity: 'workshop/inventory', riskLevel: 'medium', phase: 'build09', label: 'Warehouse topology' },
    zone_bin_management: { sensitivity: 'workshop/inventory', riskLevel: 'high', phase: 'build09', label: 'Zone and bin management' },
    putaway_rules: { sensitivity: 'workshop/inventory', riskLevel: 'high', phase: 'build09', label: 'Putaway rules' },
    putaway_task_queue: { sensitivity: 'workshop/inventory', riskLevel: 'medium', phase: 'build09', label: 'Putaway task queue' },
    replenishment_rules: { sensitivity: 'workshop/inventory', riskLevel: 'high', phase: 'build09', label: 'Replenishment rules' },
    replenishment_proposals: { sensitivity: 'workshop/inventory', riskLevel: 'high', phase: 'build09', label: 'Replenishment proposals' },
    mobile_receiving: { sensitivity: 'workshop/inventory', riskLevel: 'high', phase: 'build09', label: 'Mobile receiving' },
    receiving_discrepancies: { sensitivity: 'workshop/inventory', riskLevel: 'high', phase: 'build09', label: 'Receiving discrepancies' },
    mobile_picking: { sensitivity: 'workshop/inventory', riskLevel: 'high', phase: 'build09', label: 'Mobile picking' },
    pick_task_queue: { sensitivity: 'workshop/inventory', riskLevel: 'medium', phase: 'build09', label: 'Pick task queue' },
    wave_planning: { sensitivity: 'workshop/inventory', riskLevel: 'high', phase: 'build09', label: 'Wave planning' },
    wave_execution: { sensitivity: 'workshop/inventory', riskLevel: 'high', phase: 'build09', label: 'Wave execution' },
    cycle_count_plans: { sensitivity: 'workshop/inventory', riskLevel: 'high', phase: 'build09', label: 'Cycle count plans' },
    count_session: { sensitivity: 'workshop/inventory', riskLevel: 'high', phase: 'build09', label: 'Count session' },
    variance_review: { sensitivity: 'workshop/inventory', riskLevel: 'critical', phase: 'build09', label: 'Variance review' },
    dock_schedule: { sensitivity: 'workshop/logistics', riskLevel: 'high', phase: 'build09', label: 'Dock schedule' },
    dock_checkin: { sensitivity: 'workshop/logistics', riskLevel: 'medium', phase: 'build09', label: 'Dock check-in' },
    staging_board: { sensitivity: 'workshop/logistics', riskLevel: 'medium', phase: 'build09', label: 'Staging board' },
    crossdock_workspace: { sensitivity: 'workshop/logistics', riskLevel: 'high', phase: 'build09', label: 'Cross-dock workspace' },
    lot_serial_traceability: { sensitivity: 'workshop/inventory', riskLevel: 'high', phase: 'build09', label: 'Lot and serial traceability' },
    expiration_queue: { sensitivity: 'workshop/quality', riskLevel: 'high', phase: 'build09', label: 'Expiration queue' },
    recall_analysis: { sensitivity: 'workshop/quality', riskLevel: 'critical', phase: 'build09', label: 'Recall analysis' },
    shopfloor_terminal: { sensitivity: 'workshop/production', riskLevel: 'high', phase: 'build09', label: 'Shop-floor terminal' },
    workcenter_queue: { sensitivity: 'workshop/production', riskLevel: 'medium', phase: 'build09', label: 'Work-center queue' },
    production_material_requests: { sensitivity: 'workshop/production', riskLevel: 'high', phase: 'build09', label: 'Production material requests' },
    production_issue_return: { sensitivity: 'workshop/production', riskLevel: 'high', phase: 'build09', label: 'Production issue and return' },
    production_receipt: { sensitivity: 'workshop/production', riskLevel: 'high', phase: 'build09', label: 'Production receipt' },
    quality_hold_queue: { sensitivity: 'workshop/quality', riskLevel: 'high', phase: 'build09', label: 'Quality hold queue' },
    rework_workspace: { sensitivity: 'workshop/quality', riskLevel: 'high', phase: 'build09', label: 'Rework workspace' },
    scrap_approval: { sensitivity: 'workshop/quality', riskLevel: 'critical', phase: 'build09', label: 'Scrap approval' },
    downtime_board: { sensitivity: 'workshop/production', riskLevel: 'high', phase: 'build09', label: 'Downtime board' },
    operational_performance: { sensitivity: 'workshop/production', riskLevel: 'medium', phase: 'build09', label: 'Operational performance' },
    device_registry: { sensitivity: 'iot/devices', riskLevel: 'medium', phase: 'build10', label: 'Device registry' },
    device_detail: { sensitivity: 'iot/devices', riskLevel: 'low', phase: 'build10', label: 'Device detail' },
    device_enrollment: { sensitivity: 'iot/devices', riskLevel: 'high', phase: 'build10', label: 'Device enrollment' },
    gateway_management: { sensitivity: 'iot/gateways', riskLevel: 'high', phase: 'build10', label: 'Gateway management' },
    sensor_management: { sensitivity: 'iot/sensors', riskLevel: 'medium', phase: 'build10', label: 'Sensor management' },
    telemetry_explorer: { sensitivity: 'iot/telemetry', riskLevel: 'low', phase: 'build10', label: 'Telemetry explorer' },
    device_health_center: { sensitivity: 'iot/health', riskLevel: 'medium', phase: 'build10', label: 'Device health center' },
    device_alerts: { sensitivity: 'iot/alerts', riskLevel: 'high', phase: 'build10', label: 'Device alerts' },
    firmware_catalogue: { sensitivity: 'iot/firmware', riskLevel: 'high', phase: 'build10', label: 'Firmware catalogue' },
    rollout_simulator: { sensitivity: 'iot/firmware', riskLevel: 'high', phase: 'build10', label: 'Rollout simulator' },
    configuration_profiles: { sensitivity: 'iot/config', riskLevel: 'high', phase: 'build10', label: 'Configuration profiles' },
    device_command_center: { sensitivity: 'iot/commands', riskLevel: 'critical', phase: 'build10', label: 'Device command center' },
    fleet_device_mapping: { sensitivity: 'fleet/devices', riskLevel: 'medium', phase: 'build10', label: 'Fleet device mapping' },
    fleet_live_map_simulator: { sensitivity: 'fleet/map', riskLevel: 'low', phase: 'build10', label: 'Fleet live map simulator' },
    vehicle_trip_timeline: { sensitivity: 'fleet/trips', riskLevel: 'low', phase: 'build10', label: 'Vehicle trip timeline' },
    geofence_management: { sensitivity: 'fleet/geofences', riskLevel: 'medium', phase: 'build10', label: 'Geofence management' },
    geofence_events: { sensitivity: 'fleet/geofences', riskLevel: 'medium', phase: 'build10', label: 'Geofence events' },
    speed_and_driver_events: { sensitivity: 'fleet/speed', riskLevel: 'medium', phase: 'build10', label: 'Speed and driver events' },
    fuel_telemetry: { sensitivity: 'fleet/fuel', riskLevel: 'medium', phase: 'build10', label: 'Fuel telemetry' },
    suspected_fuel_loss_queue: { sensitivity: 'fleet/fuel', riskLevel: 'high', phase: 'build10', label: 'Suspected fuel loss queue' },
    maintenance_triggers: { sensitivity: 'fleet/maintenance', riskLevel: 'high', phase: 'build10', label: 'Maintenance triggers' },
    offline_client_registry: { sensitivity: 'offline/clients', riskLevel: 'high', phase: 'build10', label: 'Offline client registry' },
    offline_queue: { sensitivity: 'offline/queue', riskLevel: 'medium', phase: 'build10', label: 'Offline queue' },
    sync_sessions: { sensitivity: 'offline/sessions', riskLevel: 'low', phase: 'build10', label: 'Sync sessions' },
    sync_conflicts: { sensitivity: 'offline/conflicts', riskLevel: 'high', phase: 'build10', label: 'Sync conflicts' },
    conflict_resolution: { sensitivity: 'offline/conflicts', riskLevel: 'high', phase: 'build10', label: 'Conflict resolution' },
    offline_capability_policies: { sensitivity: 'offline/policies', riskLevel: 'high', phase: 'build10', label: 'Offline capability policies' },
    kiosk_device_registry: { sensitivity: 'kiosk/registry', riskLevel: 'high', phase: 'build10', label: 'Kiosk device registry' },
    employee_kiosk: { sensitivity: 'kiosk/employee', riskLevel: 'low', phase: 'build10', label: 'Employee kiosk' },
    warehouse_kiosk: { sensitivity: 'kiosk/warehouse', riskLevel: 'medium', phase: 'build10', label: 'Warehouse kiosk' },
    shop_floor_kiosk: { sensitivity: 'kiosk/shopfloor', riskLevel: 'medium', phase: 'build10', label: 'Shop floor kiosk' },
    service_kiosk: { sensitivity: 'kiosk/service', riskLevel: 'low', phase: 'build10', label: 'Service kiosk' },
    fleet_operations_board: { sensitivity: 'boards/fleet', riskLevel: 'low', phase: 'build10', label: 'Fleet operations board' },
    device_health_board: { sensitivity: 'boards/health', riskLevel: 'low', phase: 'build10', label: 'Device health board' },
    warehouse_large_screen: { sensitivity: 'boards/warehouse', riskLevel: 'low', phase: 'build10', label: 'Warehouse large screen' },
    production_large_screen: { sensitivity: 'boards/production', riskLevel: 'low', phase: 'build10', label: 'Production large screen' },
    service_queue_board: { sensitivity: 'boards/service', riskLevel: 'low', phase: 'build10', label: 'Service queue board' },
    alert_board: { sensitivity: 'boards/alerts', riskLevel: 'low', phase: 'build10', label: 'Alert board' }
  };

  const PAGE_PERMISSIONS = {
    home: [],
    finance: ['finance.user'],
    cashbox: ['finance.user'],
    expenses: ['finance.user'],
    income: ['finance.user'],
    customers: ['finance.user'],
    receipt: ['finance.user'],
    report: ['finance.user'],
    ar_ap: ['finance.user'],
    banking: ['finance.user'],
    budgeting: ['finance.manager'],
    tax_compliance: ['finance.manager', 'system.admin'],
    inventory: ['workshop.user'],
    // Canonical Operations console reads and writes governed Phase 04 facts
    // through /api/v1; the server enforces the real grant, this is the
    // page-level gate.
    canonical_console: ['workshop.manager', 'finance.manager', 'system.admin'],
    canonical_inventory: ['workshop.user', 'workshop.manager', 'system.admin'],
    products: ['workshop.user', 'workshop.manager', 'system.admin'],
    parties: ['workshop.user', 'workshop.manager', 'system.admin'],
    warehouses: ['workshop.user', 'workshop.manager', 'system.admin'],
    locations: ['workshop.user', 'workshop.manager', 'system.admin'],
    employees: ['workshop.user'],
    import: ['workshop.manager'],
    timesheet: ['workshop.user'],
    calendar: ['workshop.user'],
    people_ops: ['workshop.manager'],
    employee_ui: [],
    employee_mobile: [],
    workflow: ['workshop.user'],
    kanban: ['workshop.user'],
    machines: ['workshop.user'],
    equipment: ['workshop.user'],
    op_packs: ['workshop.user'],
    task_manager: ['workshop.user'],
    sop: ['workshop.user'],
    qc_center: ['workshop.user'],
    sales: ['workshop.user', 'finance.user'],
    sales_price_lists: ['workshop.user', 'finance.user'],
    sales_commission: ['workshop.manager', 'finance.manager'],
    sales_contracts: ['workshop.manager', 'finance.manager'],
    finance_installments: ['finance.manager', 'finance.user'],
    pos_deepening: ['workshop.user', 'finance.user'],
    omni_communications: ['workshop.manager', 'finance.manager'],
    command_center: ['workshop.manager', 'finance.manager'],
    workshop_command_center: ['workshop.user', 'workshop.manager', 'finance.manager'],
    my_work: ['workshop.user', 'workshop.manager', 'finance.user', 'finance.manager'],
    workshop_readiness: ['workshop.manager', 'system.admin'],
    analytics: ['workshop.manager', 'finance.manager'],
    nl_reports: ['workshop.manager', 'finance.manager'],
    intelligence: ['workshop.manager', 'finance.manager'],
    whatsapp: ['workshop.manager', 'finance.manager'],
    telegram: ['workshop.manager', 'finance.manager'],
    automation: ['system.admin'],
    ai_queue: ['workshop.manager', 'finance.manager'],
    ai_factory: ['system.admin'],
    ai_tools: ['system.admin'],
    ai_status: ['workshop.manager', 'finance.manager'],
    deploy_ready: ['system.admin', 'workshop.manager', 'finance.manager'],
    risk_compliance: ['workshop.manager', 'finance.manager'],
    procurement: ['workshop.manager', 'finance.user'],
    supplier_portal: ['workshop.manager', 'finance.user'],
    approvals: ['workshop.manager', 'finance.manager'],
    multi_entity: ['system.admin'],
    integration_hub: ['system.admin'],
    security_center: ['system.admin'],
    data_quality: ['system.admin'],
    route_health: ['system.admin', 'workshop.manager', 'finance.manager'],
    system_check: ['system.admin', 'workshop.manager', 'finance.manager'],
    scenario_planner: ['workshop.manager', 'finance.manager'],
    device_center: ['system.admin', 'workshop.manager'],
    training_lms: ['workshop.manager'],
    admin_panel: ['system.admin'],
    settings: ['system.admin'],
    customer_portal: [],
    calculator: [],
    mrp: ['workshop.user'],
    work_orders: ['workshop.user'],
    wfl_home: [],
    workshop_tv: [],
    kiosk: [],
    pos: ['workshop.user', 'finance.user'],
    pharmacy: ['workshop.user'],
    retail: ['workshop.user'],
    clinic: ['workshop.user'],
    restaurant: ['workshop.user'],
    'real-estate': ['workshop.user'],
    hotel: ['workshop.user'],
    assets: ['workshop.user'],
    subscriptions: ['finance.user'],
    appointments: ['workshop.user'],
    loyalty: ['workshop.user'],
    events: ['workshop.user'],
    helpdesk: ['workshop.user'],
    fleet: ['workshop.user'],
    documents: ['workshop.user'],
    esign: ['workshop.user'],
    knowledge: ['workshop.user'],
    knowledge_base: [], // public/internal (available for all authenticated roles)
    surveys: ['workshop.user'],
    visitors: ['workshop.user'],
    marketing: ['workshop.user'],
    projects: ['workshop.user'],
    field_service: ['workshop.user'],
    rental: ['workshop.user'],
    warranty: ['workshop.user'],
    workshop_ledger: ['workshop.manager', 'finance.user'],
    contracts: ['workshop.manager', 'finance.manager'],
    logistics: ['workshop.user'],
    help_manual: [],
    demand_planning: ['workshop.manager', 'finance.manager'],
    forecast_versions: ['workshop.manager', 'finance.manager'],
    forecast_overrides: ['workshop.manager', 'finance.manager'],
    forecast_accuracy: ['workshop.manager', 'finance.manager'],
    planning_exceptions: ['workshop.manager', 'finance.manager'],
    mps: ['workshop.manager', 'finance.manager'],
    mps_proposals: ['workshop.manager', 'finance.manager'],
    supply_demand_balance: ['workshop.manager', 'finance.manager'],
    sop_scenarios: ['workshop.manager', 'finance.manager'],
    sop_review: ['workshop.manager', 'finance.manager'],
    treasury_cash_position: ['finance.user'],
    liquidity_forecast: ['finance.user'],
    treasury_alerts: ['finance.user'],
    payment_funding_proposals: ['finance.manager'],
    financing_facilities: ['finance.manager'],
    intercompany_transactions: ['finance.manager'],
    mismatch_queue: ['finance.manager'],
    intercompany_reconciliation: ['finance.manager'],
    consolidation_groups: ['finance.manager'],
    account_mapping: ['finance.manager'],
    consolidation_runs: ['finance.manager'],
    eliminations: ['finance.manager'],
    consolidated_reports: ['finance.manager'],
    consolidation_lineage: ['finance.manager'],
    warehouse_topology: ['workshop.user'],
    zone_bin_management: ['workshop.user'],
    putaway_rules: ['workshop.manager'],
    putaway_task_queue: ['workshop.user'],
    replenishment_rules: ['workshop.manager'],
    replenishment_proposals: ['workshop.manager'],
    mobile_receiving: ['workshop.user'],
    receiving_discrepancies: ['workshop.user'],
    mobile_picking: ['workshop.user'],
    pick_task_queue: ['workshop.user'],
    wave_planning: ['workshop.manager'],
    wave_execution: ['workshop.user'],
    cycle_count_plans: ['workshop.manager'],
    count_session: ['workshop.user'],
    variance_review: ['workshop.manager'],
    dock_schedule: ['workshop.manager'],
    dock_checkin: ['workshop.user'],
    staging_board: ['workshop.user'],
    crossdock_workspace: ['workshop.manager'],
    lot_serial_traceability: ['workshop.user'],
    expiration_queue: ['workshop.user'],
    recall_analysis: ['workshop.manager'],
    shopfloor_terminal: ['workshop.user'],
    workcenter_queue: ['workshop.user'],
    production_material_requests: ['workshop.user'],
    production_issue_return: ['workshop.user'],
    production_receipt: ['workshop.user'],
    quality_hold_queue: ['workshop.user'],
    rework_workspace: ['workshop.user'],
    scrap_approval: ['workshop.manager'],
    downtime_board: ['workshop.user'],
    operational_performance: ['workshop.user'],
    device_registry: ['workshop.user'],
    device_detail: ['workshop.user'],
    device_enrollment: ['workshop.manager'],
    gateway_management: ['workshop.manager'],
    sensor_management: ['workshop.manager'],
    telemetry_explorer: ['workshop.user'],
    device_health_center: ['workshop.user'],
    device_alerts: ['workshop.user'],
    firmware_catalogue: ['workshop.manager'],
    rollout_simulator: ['workshop.manager'],
    configuration_profiles: ['workshop.manager'],
    device_command_center: ['workshop.manager'],
    fleet_device_mapping: ['workshop.manager'],
    fleet_live_map_simulator: ['workshop.user'],
    vehicle_trip_timeline: ['workshop.user'],
    geofence_management: ['workshop.manager'],
    geofence_events: ['workshop.user'],
    speed_and_driver_events: ['workshop.user'],
    fuel_telemetry: ['workshop.user'],
    suspected_fuel_loss_queue: ['workshop.manager'],
    maintenance_triggers: ['workshop.manager'],
    offline_client_registry: ['workshop.manager'],
    offline_queue: ['workshop.user'],
    sync_sessions: ['workshop.user'],
    sync_conflicts: ['workshop.manager'],
    conflict_resolution: ['workshop.manager'],
    offline_capability_policies: ['workshop.manager'],
    kiosk_device_registry: ['workshop.manager'],
    employee_kiosk: [],
    warehouse_kiosk: ['workshop.user'],
    shop_floor_kiosk: ['workshop.user'],
    service_kiosk: [],
    fleet_operations_board: [],
    device_health_board: [],
    warehouse_large_screen: [],
    production_large_screen: [],
    service_queue_board: [],
    alert_board: []
  };

  function expandGroups(groups) {
    const resolved = new Set(groups || []);
    let changed = true;
    while (changed) {
      changed = false;
      [...resolved].forEach(group => {
        (GROUPS[group]?.implies || []).forEach(implied => {
          if (!resolved.has(implied)) {
            resolved.add(implied);
            changed = true;
          }
        });
      });
    }
    return [...resolved];
  }

  function groupsFromRole(roleId) {
    const key = String(roleId || '').trim();
    if (!key) return [];
    if (Array.isArray(ROLE_GROUPS[key])) return ROLE_GROUPS[key].slice();
    try {
      const roles = Array.isArray(root.omni?.roles) ? root.omni.roles : [];
      const role = roles.find(r => r.id === key);
      if (role && Array.isArray(role.groups)) return role.groups.slice();
      if (role && Array.isArray(role.permissions) && role.permissions.includes('all')) return ['system.admin'];
    } catch (_) {}
    return key.includes('.') ? [key] : [];
  }

  function normalizeUser(user = {}) {
    if (!user || typeof user !== 'object') return user;
    const roleId = user.roleId || user.role || '';
    const groups = Array.isArray(user.groups) ? user.groups.slice() : groupsFromRole(roleId);
    return {
      ...user,
      name: user.name || user.displayName || user.id || '',
      displayName: user.displayName || user.name || user.id || '',
      role: user.role || roleId,
      roleId,
      groups,
    };
  }

  const PermissionService = {
    groups: GROUPS,
    modelPermissions: MODEL_PERMISSIONS,
    actionPermissions: ACTION_PERMISSIONS,
    actionMetadata: ACTION_METADATA,
    pagePermissions: PAGE_PERMISSIONS,
    pageMetadata: PAGE_METADATA,

    resolveGroups(user = root.PentagonAuth.getCurrentUser()) {
      return expandGroups(normalizeUser(user)?.groups || []);
    },

    checkPage(page, user = root.PentagonAuth.getCurrentUser()) {
      const userGroups = this.resolveGroups(user);
      if (root.OCTAGON_DEBUG_PERMISSIONS || root.PENTAGON_DEBUG_PERMISSIONS) {
        console.debug(`Permission: Checking page "${page}" for user "${user?.id}" with groups:`, userGroups);
      }
      if (userGroups.includes('system.admin')) return true;
      const mapped = Object.prototype.hasOwnProperty.call(this.pagePermissions, page);
      if (!mapped) return true;
      const allowedGroups = this.pagePermissions[page] || [];
      if (!allowedGroups.length) return true;
      const result = allowedGroups.some(group => userGroups.includes(group));
      if (root.OCTAGON_DEBUG_PERMISSIONS || root.PENTAGON_DEBUG_PERMISSIONS) {
        console.debug(`Permission: Page "${page}" access: ${result}`);
      }
      return result;
    },

    explainPage(page, userOrRole = root.PentagonAuth.getCurrentUser()) {
      let user = userOrRole || {};
      if (typeof userOrRole === 'string') {
        user = { id: userOrRole, name: userOrRole, role: userOrRole, groups: groupsFromRole(userOrRole) };
      }
      user = normalizeUser(user);
      const mapped = Object.prototype.hasOwnProperty.call(this.pagePermissions, page);
      const allowedGroups = mapped ? (this.pagePermissions[page] || []) : [];
      const userGroups = this.resolveGroups(user);
      const systemAdmin = userGroups.includes('system.admin');
      const directAllowed = systemAdmin || !mapped || !allowedGroups.length || allowedGroups.some(group => userGroups.includes(group));
      const meta = this.pageMetadata[page] || {};
      const outcome = !mapped ? 'default_allowed' : directAllowed ? 'allowed' : 'blocked';
      const reason = !mapped
        ? 'local_dev_unmapped_default_allow'
        : (!allowedGroups.length ? 'explicit_public_or_self_service' : (directAllowed ? 'explicit_permission_match' : 'missing_required_page_permission'));

      return {
        page,
        label: meta.label || page,
        mapped,
        allowedGroups,
        userId: user?.id || '',
        userName: user?.name || user?.id || '',
        userGroups,
        sensitivity: meta.sensitivity || 'normal business',
        riskLevel: meta.riskLevel || 'low',
        phase: meta.phase || (mapped ? 'explicit' : 'unmapped'),
        defaultPolicy: mapped ? 'explicit_page_policy' : 'allow_local_dev_unmapped',
        outcome,
        allowed: directAllowed,
        reason,
      };
    },

    check(collection, action, user = root.PentagonAuth.getCurrentUser()) {
      const userGroups = this.resolveGroups(user);
      if (userGroups.includes('system.admin')) return true;
      const allowedGroups = this.modelPermissions[collection]?.[action] || [];
      if (!allowedGroups.length) return true;
      return allowedGroups.some(group => userGroups.includes(group));
    },

    checkAction(actionKey, context = {}, user = root.PentagonAuth.getCurrentUser()) {
      const explained = this.explainAction(actionKey, context, user);
      return explained.allowed === true;
    },

    explainAction(actionKey, context = {}, userOrRole = root.PentagonAuth.getCurrentUser()) {
      let user = userOrRole || {};
      if (typeof userOrRole === 'string') {
        user = { id: userOrRole, name: userOrRole, role: userOrRole, groups: groupsFromRole(userOrRole) };
      }
      user = normalizeUser(user);
      const mapped = Object.prototype.hasOwnProperty.call(this.actionPermissions, actionKey);
      const meta = { ...(this.actionMetadata[actionKey] || {}), ...(context?.riskLevel ? { riskLevel: context.riskLevel } : {}) };
      const riskLevel = meta.riskLevel || 'low';
      const highRisk = ['high', 'critical'].includes(riskLevel);
      const allowedGroups = mapped ? (this.actionPermissions[actionKey] || []) : [];
      const userGroups = this.resolveGroups(user);

      const bootstrap = typeof window !== 'undefined' && window.__octagonBootstrap ? window.__octagonBootstrap : null;
      const bootstrapActionId = bootstrap && BOOTSTRAP_ACTION_ID_MAP[actionKey] ? BOOTSTRAP_ACTION_ID_MAP[actionKey] : null;
      const bootstrapAction = bootstrapActionId && Array.isArray(bootstrap.actions) ? bootstrap.actions.find(a => a.id === bootstrapActionId) : null;
      if (bootstrapAction && bootstrapAction.enabled === false) {
        return {
          actionKey,
          label: meta.label || actionKey,
          page: meta.page || context?.page || '',
          module: meta.module || context?.module || '',
          mapped: false,
          allowedGroups: [],
          userId: user?.id || '',
          userName: user?.name || user?.id || '',
          userGroups,
          riskLevel: meta.riskLevel || 'low',
          approvalRequired: false,
          defaultPolicy: 'server_bootstrap',
          outcome: 'blocked',
          allowed: false,
          reason: bootstrapAction.reasonCode || 'server_bootstrap_action_disabled',
        };
      }

      const systemAdmin = userGroups.includes('system.admin');
      const directAllowed = systemAdmin || (mapped && allowedGroups.some(group => userGroups.includes(group)));
      let outcome = directAllowed ? 'allowed' : 'blocked';
      let reason = directAllowed ? 'explicit_permission_match' : 'missing_required_permission';

      if (!mapped && highRisk) {
        outcome = meta.approvalRequired ? 'approval_required' : 'blocked';
        reason = meta.approvalRequired ? 'high_risk_unmapped_approval_required' : 'high_risk_unmapped_default_deny';
      } else if (!mapped) {
        outcome = 'allowed';
        reason = 'local_dev_unmapped_default_allow';
      } else if (!directAllowed && meta.approvalRequired) {
        outcome = 'approval_required';
        reason = 'approval_required_for_sensitive_action';
      }

      return {
        actionKey,
        label: meta.label || actionKey,
        page: meta.page || context?.page || '',
        module: meta.module || context?.module || '',
        mapped,
        allowedGroups,
        userId: user?.id || '',
        userName: user?.name || user?.id || '',
        userGroups,
        riskLevel,
        approvalRequired: !!meta.approvalRequired || outcome === 'approval_required',
        defaultPolicy: (!mapped && highRisk) ? 'deny_high_risk_unmapped' : (!mapped ? 'allow_local_dev_unmapped' : 'explicit'),
        outcome,
        allowed: outcome === 'allowed',
        reason,
      };
    },

    requireAction(actionKey, context = {}, user) {
      if (!this.checkAction(actionKey, context, user)) {
        throw new Error(`هذا الإجراء يحتاج صلاحية مدير. [${actionKey}]`);
      }
      return true;
    },

    checkField(collection, field, user = root.PentagonAuth.getCurrentUser()) {
      const bootstrap = typeof window !== 'undefined' && window.__octagonBootstrap ? window.__octagonBootstrap : null;
      const entityFields = bootstrap && bootstrap.fields ? bootstrap.fields[collection] : null;
      if (entityFields) {
        if (Array.isArray(entityFields.hidden) && entityFields.hidden.includes(field)) return false;
        if (Array.isArray(entityFields.masked) && entityFields.masked.includes(field)) return true;
        if (Array.isArray(entityFields.readOnly) && entityFields.readOnly.includes(field)) return true;
        return true;
      }
      const userGroups = this.resolveGroups(user);
      if (userGroups.includes('system.admin')) return true;
      const allowedGroups = SENSITIVE_FIELDS[collection]?.[field] || [];
      if (!allowedGroups.length) return true; // Not sensitive
      return allowedGroups.some(group => userGroups.includes(group));
    },

    require(collection, action, user) {
      if (!this.check(collection, action, user)) {
        throw new Error(`⚠️ عذراً، لا تمتلك صلاحية [${action}] على [${collection}]`);
      }
      return true;
    },
  };

  root.PermissionService = PermissionService;
  services.permission = PermissionService;
})();
