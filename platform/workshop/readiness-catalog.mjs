'use strict';

import { count, tableExists, validateWarehouse } from './query-utils.mjs';

export const READINESS_STATES = Object.freeze(['READY','WARNING','MISSING','BLOCKED','OPTIONAL','PERMISSION_DENIED','NOT_SUPPORTED']);

function check(id, label, labelAr, permission, target, mandatory, evaluate) {
  return Object.freeze({ id, label, labelAr, permission, target, mandatory, evaluate });
}

function tableCount(table, where = '', params = () => [], options = {}) {
  return ({ dialect, scope }) => {
    if (!tableExists(dialect, table)) return { state: options.notSupported ? 'NOT_SUPPORTED' : 'MISSING', value: 0, detail: `${table} authority is not installed` };
    const value = count(dialect, `SELECT COUNT(*) value FROM ${table}${where ? ` WHERE ${where}` : ''}`, ...params(scope));
    if (value >= (options.readyAt ?? 1)) return { state: 'READY', value, detail: options.readyDetail || `${value} configured` };
    return { state: options.emptyState || 'MISSING', value, detail: options.emptyDetail || 'Required configuration is missing' };
  };
}

export const READINESS_CATEGORIES = Object.freeze([
  {
    id: 'organization', label: 'Organization', labelAr: 'المؤسسة', icon: 'building',
    checks: [
      check('active_company', 'Active company', 'الشركة النشطة', 'platform:db:read', 'multi_entity', true, ({ dialect, scope }) => {
        if (!scope.companyId) return { state: 'BLOCKED', value: 0, detail: 'No active company in session scope' };
        if (!tableExists(dialect, 'platform_companies')) return { state: 'MISSING', value: 0, detail: 'Company authority unavailable' };
        const value = count(dialect, 'SELECT COUNT(*) value FROM platform_companies WHERE id=?', scope.companyId);
        return value ? { state: 'READY', value, detail: `Active company ${scope.companyId}` } : { state: 'BLOCKED', value, detail: 'Active company is outside the company authority' };
      }),
      check('branches', 'Operating branch', 'فرع تشغيلي', 'platform:db:read', 'multi_entity', false, tableCount('platform_branches', 'company_id=?', (scope) => [scope.companyId], { emptyState: 'OPTIONAL', emptyDetail: 'Branch segmentation is optional for a single-site workshop' })),
      check('company_modules', 'Enabled company modules', 'وحدات الشركة المفعلة', 'platform:db:read', 'admin_panel', true, tableCount('platform_module_assignments', "scope_type='company' AND scope_id=? AND enabled=1", (scope) => [scope.companyId], { emptyState: 'WARNING' })),
    ],
  },
  {
    id: 'users', label: 'Users & Roles', labelAr: 'المستخدمون والأدوار', icon: 'users',
    checks: [
      check('identities', 'Active identities', 'الهويات النشطة', 'identity:user:read', 'admin_panel', true, tableCount('platform_identities', "status='active'", () => [], { emptyState: 'MISSING' })),
      check('roles', 'Role definitions', 'تعريفات الأدوار', 'identity:role:read', 'admin_panel', true, tableCount('platform_roles', '', () => [], { emptyState: 'MISSING' })),
      check('role_assignments', 'Role assignments', 'إسناد الأدوار', 'identity:role:read', 'admin_panel', true, tableCount('platform_role_assignments', "company_id=?", (scope) => [scope.companyId], { emptyState: 'BLOCKED' })),
    ],
  },
  {
    id: 'products', label: 'Products', labelAr: 'المنتجات', icon: 'box',
    checks: [
      check('uoms', 'Units of measure', 'وحدات القياس', 'platform:db:read', 'products', true, tableCount('uoms', "company_id IN (?, '*')", (scope) => [scope.companyId], { emptyState: 'MISSING' })),
      check('product_templates', 'Product templates', 'قوالب المنتجات', 'platform:db:read', 'products', true, tableCount('product_templates', "company_id IN (?, '*')", (scope) => [scope.companyId], { emptyState: 'MISSING' })),
      check('product_variants', 'Sellable or consumable variants', 'متغيرات قابلة للاستخدام', 'platform:db:read', 'products', true, tableCount('product_variants', '', () => [], { emptyState: 'MISSING' })),
    ],
  },
  {
    id: 'warehouse', label: 'Warehouse', labelAr: 'المستودع', icon: 'warehouse',
    checks: [
      check('active_warehouse', 'Active scoped warehouse', 'المستودع النشط ضمن النطاق', 'wms:topology:view', 'warehouse_topology', true, ({ dialect, scope }) => {
        const result = validateWarehouse(dialect, scope);
        return result.valid ? { state: 'READY', value: 1, detail: result.row.code || result.row.name } : { state: scope.warehouseId ? 'BLOCKED' : 'MISSING', value: 0, detail: result.reason };
      }),
      check('stock_locations', 'Stock locations', 'مواقع المخزون', 'wms:locations:view', 'zone_bin_management', true, tableCount('stock_locations', 'company_id=?', (scope) => [scope.companyId], { emptyState: 'MISSING' })),
      check('wms_profiles', 'WMS location profiles', 'ملفات مواقع WMS', 'wms:locations:view', 'zone_bin_management', false, tableCount('wms_location_profiles', 'company_id=? AND warehouse_id=?', (scope) => [scope.companyId, scope.warehouseId], { emptyState: 'OPTIONAL', emptyDetail: 'Advanced WMS profiles are optional until warehouse execution is enabled' })),
    ],
  },
  {
    id: 'production', label: 'Production', labelAr: 'الإنتاج', icon: 'gears',
    checks: [
      check('work_centers', 'Work centers', 'مراكز العمل', 'manufacturing:order:read', 'work_center_registry', true, tableCount('work_centers', 'company_id=?', (scope) => [scope.companyId], { emptyState: 'MISSING' })),
      check('approved_boms', 'Approved BOM versions', 'إصدارات قوائم المواد المعتمدة', 'manufacturing:order:read', 'bom_version_management', true, tableCount('bom_versions', "company_id=? AND status='approved'", (scope) => [scope.companyId], { emptyState: 'WARNING', emptyDetail: 'No approved BOM is ready for production' })),
      check('approved_routings', 'Approved routing versions', 'مسارات الإنتاج المعتمدة', 'manufacturing:order:read', 'routing_version_management', true, tableCount('routing_versions', "company_id=? AND status='approved'", (scope) => [scope.companyId], { emptyState: 'WARNING', emptyDetail: 'No approved routing is ready for production' })),
    ],
  },
  {
    id: 'quality', label: 'Quality', labelAr: 'الجودة', icon: 'shield',
    checks: [
      check('quality_plans', 'Approved quality plans', 'خطط الجودة المعتمدة', 'quality:checkpoint:view', 'quality_plan_registry', true, tableCount('quality_plans', "company_id=? AND state='approved'", (scope) => [scope.companyId], { emptyState: 'WARNING' })),
      check('inspection_points', 'Inspection points', 'نقاط الفحص', 'quality:checkpoint:view', 'quality_checkpoint', true, tableCount('quality_inspection_points', 'company_id=?', (scope) => [scope.companyId], { emptyState: 'WARNING' })),
      check('operational_checkpoints', 'Operational checkpoint authority', 'سلطة نقاط الفحص التشغيلية', 'quality:checkpoint:view', 'quality_checkpoint', false, ({ dialect }) => tableExists(dialect, 'quality_operational_checkpoints') ? { state: 'READY', value: 1, detail: 'Operational quality authority installed' } : { state: 'NOT_SUPPORTED', value: 0, detail: 'Operational checkpoints are not installed' }),
    ],
  },
  {
    id: 'delivery', label: 'Delivery', labelAr: 'التسليم', icon: 'truck',
    checks: [
      check('sales_authority', 'Sales order authority', 'سلطة أوامر البيع', 'platform:db:read', 'sales_order_list', true, ({ dialect }) => tableExists(dialect, 'sales_orders') ? { state: 'READY', value: 1, detail: 'Canonical sales orders installed' } : { state: 'MISSING', value: 0, detail: 'Sales order authority unavailable' }),
      check('delivery_locations', 'Customer delivery locations', 'مواقع تسليم العملاء', 'wms:locations:view', 'zone_bin_management', true, tableCount('stock_locations', "company_id=? AND usage IN ('customer','transit')", (scope) => [scope.companyId], { emptyState: 'WARNING' })),
      check('picking_authority', 'Delivery picking authority', 'سلطة التقاط التسليم', 'wms:picking:view', 'picking_execution', false, ({ dialect }) => tableExists(dialect, 'wms_pick_tasks_v2') ? { state: 'READY', value: 1, detail: 'Mobile picking authority installed' } : { state: 'OPTIONAL', value: 0, detail: 'Advanced picking is optional' }),
    ],
  },
  {
    id: 'maintenance_fleet', label: 'Maintenance & Fleet', labelAr: 'الصيانة والأسطول', icon: 'wrench',
    checks: [
      check('assets', 'Registered assets', 'الأصول المسجلة', 'maintenance:request:read', 'assets', true, tableCount('assets', 'company_id=?', (scope) => [scope.companyId], { emptyState: 'WARNING' })),
      check('preventive_plans', 'Preventive maintenance plans', 'خطط الصيانة الوقائية', 'maintenance:request:read', 'maintenance_plan', false, tableCount('maintenance_preventive_plans', 'company_id=?', (scope) => [scope.companyId], { emptyState: 'OPTIONAL' })),
      check('fleet_vehicles', 'Active fleet vehicles', 'مركبات الأسطول النشطة', 'fleet:vehicle:read', 'fleet_vehicle_registry', false, tableCount('fleet_vehicles', "company_id=? AND status='active'", (scope) => [scope.companyId], { emptyState: 'OPTIONAL' })),
    ],
  },
  {
    id: 'devices', label: 'Devices, Kiosk & Offline', labelAr: 'الأجهزة والكشك والعمل دون اتصال', icon: 'tablet',
    checks: [
      check('iot_devices', 'Active IoT devices', 'أجهزة إنترنت الأشياء النشطة', 'iot:device:view', 'device_registry', false, tableCount('iot_devices', "company_id=? AND lifecycle_state='active'", (scope) => [scope.companyId], { emptyState: 'OPTIONAL', notSupported: true })),
      check('kiosks', 'Active kiosk registrations', 'تسجيلات الكشك النشطة', 'kiosk:registry:view', 'kiosk_registry', false, tableCount('kiosk_device_registries', "company_id=? AND status='active'", (scope) => [scope.companyId], { emptyState: 'OPTIONAL', notSupported: true })),
      check('offline_clients', 'Offline client registrations', 'تسجيلات عملاء دون اتصال', 'offline:client:view', 'offline_client_registry', false, tableCount('offline_clients', 'company_id=?', (scope) => [scope.companyId], { emptyState: 'OPTIONAL', notSupported: true })),
    ],
  },
  {
    id: 'governance', label: 'Governance', labelAr: 'الحوكمة', icon: 'lock',
    checks: [
      check('migration_registry', 'Migration registry', 'سجل الترحيلات', 'platform:db:read', 'system_check', true, tableCount('schema_migrations', '', () => [], { readyAt: 1, emptyState: 'BLOCKED' })),
      check('audit_authority', 'Audit event authority', 'سلطة أحداث التدقيق', 'platform:audit:read', 'security_center', true, ({ dialect }) => tableExists(dialect, 'platform_audit_events') ? { state: 'READY', value: 1, detail: 'Append-only audit authority installed' } : { state: 'BLOCKED', value: 0, detail: 'Audit authority unavailable' }),
      check('authorization_grants', 'Authorization grants', 'منح الصلاحيات', 'identity:role:read', 'security_center', true, tableCount('platform_permission_grants', '', () => [], { emptyState: 'BLOCKED' })),
    ],
  },
]);

