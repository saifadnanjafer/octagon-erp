'use strict';

function drilldown(id, permission, target, table, sql, params, options = {}) {
  return Object.freeze({ id, permission, target, table, sql, params, warehouseRequired: Boolean(options.warehouseRequired), description: options.description || '' });
}

const OPEN_WORK = "status NOT IN ('done','completed','closed','cancelled','rejected')";

export const WORKSHOP_DRILLDOWNS = Object.freeze({
  today_open_work: drilldown('today_open_work', 'platform:db:read', 'task_manager', 'work_items', `
    SELECT id,title,source_type type,status,priority,due_date due_at,assigned_user_id owner_id,updated_at,NULL reference
    FROM work_items WHERE company_id=? AND ${OPEN_WORK}
    ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,due_date,updated_at DESC LIMIT ?`,
    ({ scope, limit }) => [scope.companyId, limit], { description: 'Open canonical work in the active company' }),
  today_due: drilldown('today_due', 'platform:db:read', 'my_work', 'work_items', `
    SELECT id,title,source_type type,status,priority,due_date due_at,assigned_user_id owner_id,updated_at,NULL reference
    FROM work_items WHERE company_id=? AND date(due_date)=date('now') AND ${OPEN_WORK}
    ORDER BY due_date,priority LIMIT ?`, ({ scope, limit }) => [scope.companyId, limit]),
  today_production: drilldown('today_production', 'manufacturing:order:read', 'production_order_board', 'mfg_production_orders', `
    SELECT id,order_number title,'production_order' type,state status,priority,planned_end_date due_at,NULL owner_id,updated_at,order_number reference
    FROM mfg_production_orders WHERE company_id=? AND state NOT IN ('completed','closed','cancelled','reversed')
    ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,planned_end_date LIMIT ?`, ({ scope, limit }) => [scope.companyId, limit]),
  today_receiving: drilldown('today_receiving', 'wms:receiving:view', 'receiving_session', 'wms_receiving_sessions', `
    SELECT id,reference title,receipt_type type,status,'medium' priority,started_at due_at,started_by owner_id,updated_at,reference
    FROM wms_receiving_sessions WHERE company_id=? AND warehouse_id=? AND status NOT IN ('completed','cancelled','posted')
    ORDER BY started_at LIMIT ?`, ({ scope, limit }) => [scope.companyId, scope.warehouseId, limit], { warehouseRequired: true }),
  urgent_overdue: drilldown('urgent_overdue', 'platform:db:read', 'my_work', 'work_items', `
    SELECT id,title,source_type type,status,priority,due_date due_at,assigned_user_id owner_id,updated_at,NULL reference
    FROM work_items WHERE company_id=? AND due_date<datetime('now') AND ${OPEN_WORK}
    ORDER BY due_date LIMIT ?`, ({ scope, limit }) => [scope.companyId, limit]),
  urgent_blocked: drilldown('urgent_blocked', 'platform:db:read', 'my_work', 'work_items', `
    SELECT id,title,source_type type,status,priority,due_date due_at,assigned_user_id owner_id,updated_at,NULL reference
    FROM work_items WHERE company_id=? AND (status='blocked' OR stage='blocked' OR sla_status='breached')
    ORDER BY updated_at DESC LIMIT ?`, ({ scope, limit }) => [scope.companyId, limit]),
  urgent_shortages: drilldown('urgent_shortages', 'shopfloor:material:view', 'shopfloor_material_flow', 'mfg_material_flow_requests', `
    SELECT id,('Material '||product_id) title,request_type type,status,'high' priority,NULL due_at,requested_by owner_id,updated_at,production_order_id reference
    FROM mfg_material_flow_requests WHERE company_id=? AND warehouse_id=? AND status IN ('shortage','exception')
    ORDER BY shortage_quantity DESC,updated_at LIMIT ?`, ({ scope, limit }) => [scope.companyId, scope.warehouseId, limit], { warehouseRequired: true }),
  urgent_quality: drilldown('urgent_quality', 'quality:checkpoint:view', 'quality_checkpoint', 'quality_operational_checkpoints', `
    SELECT id,('Checkpoint '||id) title,checkpoint_type type,status,'high' priority,updated_at due_at,opened_by owner_id,updated_at,source_id reference
    FROM quality_operational_checkpoints WHERE company_id=? AND warehouse_id=? AND status IN ('fail','hold','quarantine','ncr','rework','scrap')
    ORDER BY updated_at DESC LIMIT ?`, ({ scope, limit }) => [scope.companyId, scope.warehouseId, limit], { warehouseRequired: true }),
  queue_warehouse: drilldown('queue_warehouse', 'wms:picking:view', 'warehouse_task_queue', 'wms_warehouse_tasks', `
    SELECT id,(task_type||' · '||source_record_id) title,task_type type,status,CAST(priority AS TEXT) priority,NULL due_at,assigned_to owner_id,updated_at,source_record_id reference
    FROM wms_warehouse_tasks WHERE company_id=? AND warehouse_id=? AND status NOT IN ('completed','cancelled','failed')
    ORDER BY priority,created_at LIMIT ?`, ({ scope, limit }) => [scope.companyId, scope.warehouseId, limit], { warehouseRequired: true }),
  queue_picking: drilldown('queue_picking', 'wms:picking:view', 'picking_execution', 'wms_pick_tasks_v2', `
    SELECT id,('Pick · '||source_document_id) title,picking_type type,status,'medium' priority,NULL due_at,assigned_to owner_id,updated_at,source_document_id reference
    FROM wms_pick_tasks_v2 WHERE company_id=? AND warehouse_id=? AND status NOT IN ('completed','cancelled','shipped')
    ORDER BY route_sequence,created_at LIMIT ?`, ({ scope, limit }) => [scope.companyId, scope.warehouseId, limit], { warehouseRequired: true }),
  queue_shopfloor: drilldown('queue_shopfloor', 'shopfloor:terminal:view', 'shopfloor_terminal', 'mfg_shopfloor_sessions', `
    SELECT id,('Shopfloor · '||work_order_id) title,'shopfloor' type,status,'medium' priority,planned_end_at due_at,operator_id owner_id,updated_at,work_order_id reference
    FROM mfg_shopfloor_sessions WHERE company_id=? AND warehouse_id=? AND status NOT IN ('completed','cancelled')
    ORDER BY planned_start_at,updated_at LIMIT ?`, ({ scope, limit }) => [scope.companyId, scope.warehouseId, limit], { warehouseRequired: true }),
  queue_maintenance: drilldown('queue_maintenance', 'maintenance:request:read', 'maintenance_request', 'maintenance_requests', `
    SELECT id,title,request_type type,state status,priority,reported_at due_at,reported_by owner_id,updated_at,request_number reference
    FROM maintenance_requests WHERE company_id=? AND state NOT IN ('rejected','cancelled','work_order_created')
    ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,reported_at LIMIT ?`, ({ scope, limit }) => [scope.companyId, limit]),
  health_migrations: drilldown('health_migrations', 'platform:db:read', 'system_check', 'schema_migrations', `
    SELECT migration_id id,migration_id title,'migration' type,'applied' status,'normal' priority,applied_at due_at,actor owner_id,applied_at updated_at,checksum reference
    FROM schema_migrations ORDER BY applied_at DESC LIMIT ?`, ({ limit }) => [limit]),
  health_devices: drilldown('health_devices', 'iot:telemetry:view', 'device_health_monitor', 'iot_device_alerts', `
    SELECT id,alert_type title,'device_alert' type,status,severity priority,NULL due_at,assigned_to owner_id,updated_at,device_id reference
    FROM iot_device_alerts WHERE company_id=? AND status IN ('open','acknowledged','assigned') ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,updated_at DESC LIMIT ?`, ({ scope, limit }) => [scope.companyId, limit]),
  health_modules: drilldown('health_modules', 'platform:db:read', 'admin_panel', 'platform_modules', `
    SELECT id,name title,kind type,status,'normal' priority,NULL due_at,owner owner_id,updated_at,version reference
    FROM platform_modules WHERE status='enabled' ORDER BY name LIMIT ?`, ({ limit }) => [limit]),
  health_freshness: drilldown('health_freshness', 'platform:db:read', 'task_manager', 'work_items', `
    SELECT id,title,source_type type,status,priority,due_date due_at,assigned_user_id owner_id,updated_at,NULL reference
    FROM work_items WHERE company_id=? ORDER BY updated_at DESC LIMIT ?`, ({ scope, limit }) => [scope.companyId, limit]),
  mine_assigned: drilldown('mine_assigned', 'platform:db:read', 'my_work', 'work_items', `
    SELECT id,title,source_type type,status,priority,due_date due_at,assigned_user_id owner_id,updated_at,NULL reference
    FROM work_items WHERE company_id=? AND assigned_user_id=? AND ${OPEN_WORK} ORDER BY due_date,updated_at DESC LIMIT ?`, ({ scope, limit }) => [scope.companyId, scope.userId, limit]),
  mine_waiting: drilldown('mine_waiting', 'platform:db:read', 'my_work', 'work_items', `
    SELECT id,title,source_type type,status,priority,due_date due_at,assigned_user_id owner_id,updated_at,NULL reference
    FROM work_items WHERE company_id=? AND assigned_user_id=? AND (status IN ('waiting','blocked') OR stage IN ('waiting','blocked'))
    ORDER BY due_date,updated_at DESC LIMIT ?`, ({ scope, limit }) => [scope.companyId, scope.userId, limit]),
});
