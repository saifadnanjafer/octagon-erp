'use strict';

import { count, first, tableExists, validateWarehouse } from './query-utils.mjs';

const OPEN_WORK = "status NOT IN ('done','completed','closed','cancelled','rejected')";
const OPEN_PRODUCTION = "state NOT IN ('completed','closed','cancelled','reversed')";

export const WORKSHOP_SECTIONS = Object.freeze([
  { id: 'today', label: 'Today', labelAr: 'اليوم', order: 10 },
  { id: 'urgent', label: 'Urgent', labelAr: 'عاجل', order: 20 },
  { id: 'operational_queues', label: 'Operational Queues', labelAr: 'طوابير التشغيل', order: 30 },
  { id: 'system_health', label: 'System Health', labelAr: 'صحة النظام', order: 40 },
  { id: 'my_work', label: 'My Work', labelAr: 'عملي', order: 50 },
]);

function metric(id, section, label, labelAr, permission, target, load, tone = 'neutral') {
  return Object.freeze({ id, section, label, labelAr, permission, target, load, tone });
}

export const COMMAND_CENTER_METRICS = Object.freeze([
  metric('today_open_work', 'today', 'Open work items', 'عناصر العمل المفتوحة', 'platform:db:read', 'task_manager', ({ dialect, scope }) => ({
    value: count(dialect, `SELECT COUNT(*) value FROM work_items WHERE company_id=? AND ${OPEN_WORK}`, scope.companyId),
    detail: 'Canonical work items in the active company',
  })),
  metric('today_due', 'today', 'Due today', 'مستحق اليوم', 'platform:db:read', 'my_work', ({ dialect, scope }) => ({
    value: count(dialect, `SELECT COUNT(*) value FROM work_items WHERE company_id=? AND date(due_date)=date('now') AND ${OPEN_WORK}`, scope.companyId),
    detail: 'Open canonical work due today',
  }), 'attention'),
  metric('today_production', 'today', 'Active production', 'الإنتاج النشط', 'manufacturing:order:read', 'production_order_board', ({ dialect, scope }) => ({
    value: count(dialect, `SELECT COUNT(*) value FROM mfg_production_orders WHERE company_id=? AND ${OPEN_PRODUCTION}`, scope.companyId),
    detail: 'Production orders not completed or cancelled',
  })),
  metric('today_receiving', 'today', 'Receiving in progress', 'الاستلام قيد التنفيذ', 'wms:receiving:view', 'receiving_session', ({ dialect, scope }) => {
    const check = validateWarehouse(dialect, scope); if (!check.valid) throw new Error(check.reason);
    return { value: count(dialect, "SELECT COUNT(*) value FROM wms_receiving_sessions WHERE company_id=? AND warehouse_id=? AND status NOT IN ('completed','cancelled','posted')", scope.companyId, scope.warehouseId), detail: `Warehouse ${check.row.code || check.row.name}` };
  }),
  metric('urgent_overdue', 'urgent', 'Overdue work', 'عمل متأخر', 'platform:db:read', 'my_work', ({ dialect, scope }) => ({
    value: count(dialect, `SELECT COUNT(*) value FROM work_items WHERE company_id=? AND due_date < datetime('now') AND ${OPEN_WORK}`, scope.companyId),
    detail: 'Open work past its due date',
  }), 'danger'),
  metric('urgent_blocked', 'urgent', 'Blocked work', 'عمل محظور', 'platform:db:read', 'my_work', ({ dialect, scope }) => ({
    value: count(dialect, "SELECT COUNT(*) value FROM work_items WHERE company_id=? AND (status='blocked' OR stage='blocked' OR sla_status='breached')", scope.companyId),
    detail: 'Blocked or SLA-breached canonical work',
  }), 'danger'),
  metric('urgent_shortages', 'urgent', 'Material shortages', 'نقص المواد', 'shopfloor:material:view', 'shopfloor_material_flow', ({ dialect, scope }) => {
    const check = validateWarehouse(dialect, scope); if (!check.valid) throw new Error(check.reason);
    return { value: count(dialect, "SELECT COUNT(*) value FROM mfg_material_flow_requests WHERE company_id=? AND warehouse_id=? AND status IN ('shortage','blocked','exception')", scope.companyId, scope.warehouseId), detail: 'Unresolved shopfloor material exceptions' };
  }, 'danger'),
  metric('urgent_quality', 'urgent', 'Quality holds', 'حالات حجز الجودة', 'quality:checkpoint:view', 'quality_checkpoint', ({ dialect, scope }) => {
    const check = validateWarehouse(dialect, scope); if (!check.valid) throw new Error(check.reason);
    return { value: count(dialect, "SELECT COUNT(*) value FROM quality_operational_checkpoints WHERE company_id=? AND warehouse_id=? AND status IN ('fail','hold','quarantine','ncr','rework','scrap')", scope.companyId, scope.warehouseId), detail: 'Quality exceptions awaiting disposition' };
  }, 'danger'),
  metric('queue_warehouse', 'operational_queues', 'Warehouse tasks', 'مهام المستودع', 'wms:picking:view', 'warehouse_task_queue', ({ dialect, scope }) => {
    const check = validateWarehouse(dialect, scope); if (!check.valid) throw new Error(check.reason);
    return { value: count(dialect, "SELECT COUNT(*) value FROM wms_warehouse_tasks WHERE company_id=? AND warehouse_id=? AND status NOT IN ('completed','cancelled','failed')", scope.companyId, scope.warehouseId), detail: 'Bounded active warehouse execution queue' };
  }),
  metric('queue_picking', 'operational_queues', 'Pick tasks', 'مهام الالتقاط', 'wms:picking:view', 'picking_execution', ({ dialect, scope }) => ({
    value: count(dialect, "SELECT COUNT(*) value FROM wms_pick_tasks_v2 WHERE company_id=? AND warehouse_id=? AND status NOT IN ('completed','cancelled','shipped')", scope.companyId, scope.warehouseId),
    detail: 'Active pick execution queue',
  })),
  metric('queue_shopfloor', 'operational_queues', 'Shopfloor sessions', 'جلسات أرضية المصنع', 'shopfloor:terminal:view', 'shopfloor_terminal', ({ dialect, scope }) => ({
    value: count(dialect, "SELECT COUNT(*) value FROM mfg_shopfloor_sessions WHERE company_id=? AND warehouse_id=? AND status NOT IN ('completed','cancelled')", scope.companyId, scope.warehouseId),
    detail: 'Active and waiting operator sessions',
  })),
  metric('queue_maintenance', 'operational_queues', 'Maintenance queue', 'طابور الصيانة', 'maintenance:request:read', 'maintenance_request', ({ dialect, scope }) => ({
    value: count(dialect, "SELECT COUNT(*) value FROM maintenance_requests WHERE company_id=? AND state NOT IN ('rejected','cancelled','work_order_created')", scope.companyId),
    detail: 'Open maintenance requests',
  })),
  metric('health_migrations', 'system_health', 'Applied migrations', 'الترحيلات المطبقة', 'platform:db:read', 'system_check', ({ dialect }) => {
    if (!tableExists(dialect, 'schema_migrations')) throw new Error('Migration registry unavailable');
    const applied = count(dialect, 'SELECT COUNT(*) value FROM schema_migrations');
    return { value: applied, unit: 'migrations', detail: 'Immutable migration registry entries' };
  }, 'health'),
  metric('health_devices', 'system_health', 'Device alerts', 'تنبيهات الأجهزة', 'iot:telemetry:view', 'device_health_monitor', ({ dialect, scope }) => ({
    value: count(dialect, "SELECT COUNT(*) value FROM iot_device_alerts WHERE company_id=? AND status IN ('open','acknowledged','assigned')", scope.companyId),
    detail: 'Open IoT health alerts',
  }), 'health'),
  metric('health_modules', 'system_health', 'Enabled modules', 'الوحدات المفعلة', 'platform:db:read', 'admin_panel', ({ dialect }) => ({
    value: count(dialect, "SELECT COUNT(*) value FROM platform_modules WHERE status='enabled'"),
    detail: 'Platform module registry',
  }), 'health'),
  metric('health_freshness', 'system_health', 'Latest work update', 'آخر تحديث للعمل', 'platform:db:read', 'task_manager', ({ dialect, scope }) => {
    const row = first(dialect, 'SELECT MAX(updated_at) value FROM work_items WHERE company_id=?', scope.companyId);
    return { value: row?.value || null, display: row?.value ? new Date(row.value).toLocaleString('en-GB') : 'No records', detail: 'Freshness of canonical work authority' };
  }, 'health'),
  metric('mine_assigned', 'my_work', 'Assigned to me', 'مسند إليّ', 'platform:db:read', 'my_work', ({ dialect, scope }) => ({
    value: scope.userId ? count(dialect, `SELECT COUNT(*) value FROM work_items WHERE company_id=? AND assigned_user_id=? AND ${OPEN_WORK}`, scope.companyId, scope.userId) : 0,
    detail: scope.userId ? 'Canonical work assigned to the signed-in actor' : 'No signed-in actor identifier',
  })),
  metric('mine_waiting', 'my_work', 'Waiting on me', 'بانتظاري', 'platform:db:read', 'my_work', ({ dialect, scope }) => ({
    value: scope.userId ? count(dialect, "SELECT COUNT(*) value FROM work_items WHERE company_id=? AND assigned_user_id=? AND (status IN ('waiting','blocked') OR stage IN ('waiting','blocked'))", scope.companyId, scope.userId) : 0,
    detail: 'Assigned work requiring actor attention',
  }), 'attention'),
]);
