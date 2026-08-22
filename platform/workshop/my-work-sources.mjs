'use strict';

export const MY_WORK_SOURCES = Object.freeze([
  {
    id: 'canonical_work', label: 'Canonical Work', labelAr: 'العمل الموحّد', permission: 'platform:db:read', table: 'work_items', target: 'task_manager',
    sql: `SELECT id,title,description,source_type task_family,status,stage,priority,due_date,updated_at,
      assigned_user_id assignee_id,NULL warehouse_id,NULL reference
      FROM work_items WHERE company_id=? AND assigned_user_id=?`,
    params: ({ scope }) => [scope.companyId, scope.userId],
  },
  {
    id: 'warehouse_tasks', label: 'Warehouse Tasks', labelAr: 'مهام المستودع', permission: 'wms:picking:view', table: 'wms_warehouse_tasks', target: 'warehouse_task_queue',
    sql: `SELECT id,(task_type || ' · ' || source_record_id) title,(source_record_type || ' ' || source_record_id) description,task_type task_family,status,NULL stage,
      CAST(priority AS TEXT) priority,NULL due_date,updated_at,assigned_to assignee_id,warehouse_id,source_record_id reference
      FROM wms_warehouse_tasks WHERE company_id=? AND warehouse_id=? AND assigned_to=?`,
    params: ({ scope }) => [scope.companyId, scope.warehouseId, scope.userId], warehouseRequired: true,
  },
  {
    id: 'pick_tasks', label: 'Picking', labelAr: 'الالتقاط', permission: 'wms:picking:view', table: 'wms_pick_tasks_v2', target: 'picking_execution',
    sql: `SELECT id,('Pick · ' || source_document_id) title,exception_reason description,'picking' task_family,status,NULL stage,
      'medium' priority,NULL due_date,updated_at,assigned_to assignee_id,warehouse_id,source_document_id reference
      FROM wms_pick_tasks_v2 WHERE company_id=? AND warehouse_id=? AND assigned_to=?`,
    params: ({ scope }) => [scope.companyId, scope.warehouseId, scope.userId], warehouseRequired: true,
  },
  {
    id: 'count_sessions', label: 'Cycle Counts', labelAr: 'الجرد الدوري', permission: 'wms:cycle_count:view', table: 'wms_count_sessions_v2', target: 'mobile_cycle_count',
    sql: `SELECT id,('Count · ' || id) title,('Session type: ' || session_type) description,'cycle_count' task_family,status,NULL stage,
      'medium' priority,NULL due_date,updated_at,assigned_to assignee_id,warehouse_id,freeze_reference reference
      FROM wms_count_sessions_v2 WHERE company_id=? AND warehouse_id=? AND assigned_to=?`,
    params: ({ scope }) => [scope.companyId, scope.warehouseId, scope.userId], warehouseRequired: true,
  },
  {
    id: 'shopfloor', label: 'Shop Floor', labelAr: 'أرضية المصنع', permission: 'shopfloor:terminal:view', table: 'mfg_shopfloor_sessions', target: 'shopfloor_terminal',
    sql: `SELECT id,('Shopfloor · ' || work_order_id) title,instructions description,'shopfloor' task_family,status,NULL stage,
      'medium' priority,planned_end_at due_date,updated_at,operator_id assignee_id,warehouse_id,work_order_id reference
      FROM mfg_shopfloor_sessions WHERE company_id=? AND warehouse_id=? AND operator_id=?`,
    params: ({ scope }) => [scope.companyId, scope.warehouseId, scope.userId], warehouseRequired: true,
  },
  {
    id: 'quality_ncr', label: 'Quality NCR', labelAr: 'عدم مطابقة الجودة', permission: 'quality:checkpoint:view', table: 'quality_ncrs', target: 'quality_checkpoint',
    sql: `SELECT id,title,root_cause description,'quality_ncr' task_family,state status,NULL stage,
      severity priority,NULL due_date,updated_at,assigned_to assignee_id,NULL warehouse_id,ncr_number reference
      FROM quality_ncrs WHERE company_id=? AND assigned_to=?`,
    params: ({ scope }) => [scope.companyId, scope.userId],
  },
  {
    id: 'device_alerts', label: 'Device Alerts', labelAr: 'تنبيهات الأجهزة', permission: 'iot:telemetry:view', table: 'iot_device_alerts', target: 'device_health_monitor',
    sql: `SELECT id,alert_type title,message description,'device_alert' task_family,status,NULL stage,
      severity priority,NULL due_date,updated_at,assigned_to assignee_id,NULL warehouse_id,NULL reference
      FROM iot_device_alerts WHERE company_id=? AND assigned_to=?`,
    params: ({ scope }) => [scope.companyId, scope.userId],
  },
]);

export const OPEN_STATUSES = new Set(['todo','open','ready','assigned','submitted','approved','in_progress','running','paused','waiting','review','blocked','short','exception','acknowledged']);
export const CLOSED_STATUSES = new Set(['done','completed','closed','resolved','cancelled','rejected','shipped']);
