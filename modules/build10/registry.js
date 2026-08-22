(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  if (!root) return;

  const PAGES = {
    device_registry: {
      category: 'devices',
      titleAr: 'سجل أجهزة IoT',
      titleEn: 'IoT Device Registry',
      icon: 'fa-microchip',
      api: '/api/v1/iot/devices',
      actions: ['iot:register_device', 'iot:enroll_device', 'iot:update_device_status'],
      columns: ['device_code', 'name', 'device_type', 'status', 'gateway_id', 'last_seen_at'],
      emptyStateAr: 'لا توجد أجهزة سريعة مسجلة في هذا النطاق.',
      emptyStateEn: 'No IoT devices registered in this scope.'
    },
    device_detail: {
      category: 'devices',
      titleAr: 'تفاصيل الجهاز',
      titleEn: 'Device Detail',
      icon: 'fa-circle-info',
      api: '/api/v1/iot/devices',
      actions: ['iot:update_device_status', 'iot:assign_gateway', 'iot:attach_sensor'],
      columns: ['id', 'device_code', 'name', 'status', 'assigned_vehicle_id', 'updated_at'],
      emptyStateAr: 'اختر جهازاً لمعرض تفاصيله التشغيلية.',
      emptyStateEn: 'Select a device to view operational details.'
    },
    device_enrollment: {
      category: 'devices',
      titleAr: 'تسجيل وتفعيل الأجهزة',
      titleEn: 'Device Enrollment',
      icon: 'fa-barcode',
      api: '/api/v1/iot/devices',
      actions: ['iot:enroll_device', 'iot:confirm_enrollment', 'iot:activate_device'],
      columns: ['device_code', 'enrollment_code', 'token_status', 'created_at'],
      emptyStateAr: 'لا توجد عمليات تسجيل قيد الانتظار.',
      emptyStateEn: 'No pending enrollment sessions.'
    },
    gateway_management: {
      category: 'devices',
      titleAr: 'إدارة البوابات',
      titleEn: 'Gateway Management',
      icon: 'fa-network-wired',
      api: '/api/v1/iot/gateways',
      actions: ['iot:register_gateway', 'iot:attach_sensor', 'iot:detach_sensor'],
      columns: ['gateway_code', 'name', 'ip_address', 'connected_devices_count', 'status'],
      emptyStateAr: 'لا توجد بوابات IoT مسجلة حالياً.',
      emptyStateEn: 'No IoT gateways configured yet.'
    },
    sensor_management: {
      category: 'devices',
      titleAr: 'إدارة الحساسات',
      titleEn: 'Sensor Management',
      icon: 'fa-temperature-high',
      api: '/api/v1/iot/sensors',
      actions: ['iot:attach_sensor', 'iot:calibrate_sensor', 'iot:detach_sensor'],
      columns: ['sensor_code', 'sensor_type', 'unit', 'min_limit', 'max_limit', 'status'],
      emptyStateAr: 'لا توجد حساسات مرتبطة بالأجهزة.',
      emptyStateEn: 'No sensors attached to devices.'
    },
    telemetry_explorer: {
      category: 'telemetry',
      titleAr: 'مستكشف بيانات القياس',
      titleEn: 'Telemetry Explorer',
      icon: 'fa-chart-line',
      api: '/api/v1/iot/telemetry',
      actions: ['iot:ingest_telemetry'],
      columns: ['device_id', 'metric', 'value', 'unit', 'quality_flag', 'timestamp'],
      emptyStateAr: 'لا توجد قراءات قياس مسجلة حديثاً.',
      emptyStateEn: 'No telemetry readings logged recently.'
    },
    device_health_center: {
      category: 'telemetry',
      titleAr: 'مركز صحة الأجهزة',
      titleEn: 'Device Health Center',
      icon: 'fa-heart-pulse',
      api: '/api/v1/iot/health',
      actions: ['iot:evaluate_config_drift', 'iot:acknowledge_alert'],
      columns: ['device_code', 'health_score', 'last_heartbeat', 'drift_status', 'status'],
      emptyStateAr: 'جميع الأجهزة تعمل بحالة صحية ممتازة.',
      emptyStateEn: 'All devices are operating in optimal health condition.'
    },
    device_alerts: {
      category: 'telemetry',
      titleAr: 'تنبيهات وأعطال الأجهزة',
      titleEn: 'Device Alerts',
      icon: 'fa-triangle-exclamation',
      api: '/api/v1/iot/alerts',
      actions: ['iot:acknowledge_alert', 'iot:resolve_alert'],
      columns: ['alert_code', 'severity', 'device_code', 'message', 'occurred_at', 'status'],
      emptyStateAr: 'لا توجد تنبيهات نشطة حالياً.',
      emptyStateEn: 'No active device alerts logged.'
    },
    firmware_catalogue: {
      category: 'telemetry',
      titleAr: 'كتالوج البرامج الثابتة',
      titleEn: 'Firmware Catalogue',
      icon: 'fa-file-code',
      api: '/api/v1/iot/firmware',
      actions: ['iot:register_firmware', 'iot:create_rollout_plan'],
      columns: ['version', 'hardware_model', 'checksum', 'release_notes', 'created_at'],
      emptyStateAr: 'كتالوج البرامج الثابتة فارغ.',
      emptyStateEn: 'Firmware catalogue is empty.'
    },
    rollout_simulator: {
      category: 'telemetry',
      titleAr: 'محاكي التحديث الميداني',
      titleEn: 'Rollout Simulator',
      icon: 'fa-cloud-arrow-up',
      api: '/api/v1/iot/rollouts',
      actions: ['iot:create_rollout_plan', 'iot:simulate_rollout_step'],
      columns: ['rollout_code', 'firmware_version', 'target_count', 'success_rate', 'status'],
      emptyStateAr: 'لا توجد حملات تحديث ميداني نشطة.',
      emptyStateEn: 'No firmware rollout campaigns running.'
    },
    configuration_profiles: {
      category: 'telemetry',
      titleAr: 'ملفات إعدادات الأجهزة',
      titleEn: 'Configuration Profiles',
      icon: 'fa-sliders',
      api: '/api/v1/iot/config-profiles',
      actions: ['iot:create_config_profile', 'iot:apply_config_profile', 'iot:evaluate_config_drift'],
      columns: ['profile_code', 'name', 'target_device_type', 'drift_count', 'updated_at'],
      emptyStateAr: 'لا توجد ملفات إعدادات معرفة.',
      emptyStateEn: 'No configuration profiles created.'
    },
    device_command_center: {
      category: 'telemetry',
      titleAr: 'مركز أوامر الأجهزة',
      titleEn: 'Device Command Center',
      icon: 'fa-terminal',
      api: '/api/v1/iot/commands',
      actions: ['iot:dispatch_device_command', 'iot:acknowledge_command'],
      columns: ['command_uuid', 'device_code', 'command_type', 'payload', 'dispatch_status', 'created_at'],
      emptyStateAr: 'طابور الأمر فارغ.',
      emptyStateEn: 'Device command queue is clear.'
    },
    fleet_device_mapping: {
      category: 'fleet',
      titleAr: 'ربط أجهزة أسطول السيارات',
      titleEn: 'Fleet Device Mapping',
      icon: 'fa-truck-gear',
      api: '/api/v1/fleet/mappings',
      actions: ['iot:map_fleet_device', 'iot:unmap_fleet_device'],
      columns: ['vehicle_number', 'registration_number', 'tracker_device_id', 'odometer_offset_km', 'status'],
      emptyStateAr: 'لا توجد عمليات ربط بين السيارات والأجهزة.',
      emptyStateEn: 'No fleet device mappings established.'
    },
    fleet_live_map_simulator: {
      category: 'fleet',
      titleAr: 'خريطة التتبع المباشر',
      titleEn: 'Fleet Live Map Simulator',
      icon: 'fa-map-location-dot',
      api: '/api/v1/fleet/locations',
      actions: ['iot:record_location_point'],
      columns: ['vehicle_id', 'latitude', 'longitude', 'speed_kmh', 'freshness', 'timestamp'],
      emptyStateAr: 'لا توجد مركبات متصلة بالبث المباشر.',
      emptyStateEn: 'No vehicles broadcasting live telemetry.'
    },
    vehicle_trip_timeline: {
      category: 'fleet',
      titleAr: 'خط زمني لرحلات السيارات',
      titleEn: 'Vehicle Trip Timeline',
      icon: 'fa-route',
      api: '/api/v1/fleet/trips',
      actions: ['iot:start_or_project_trip'],
      columns: ['trip_code', 'vehicle_id', 'start_time', 'end_time', 'distance_km', 'max_speed_kmh', 'status'],
      emptyStateAr: 'لا توجد رحلات مسجلة في الخط الزمني.',
      emptyStateEn: 'No trips recorded in the timeline.'
    },
    geofence_management: {
      category: 'fleet',
      titleAr: 'إدارة النطاقات الجغرافية',
      titleEn: 'Geofence Management',
      icon: 'fa-draw-polygon',
      api: '/api/v1/fleet/geofences',
      actions: ['iot:define_geofence', 'iot:toggle_geofence_status'],
      columns: ['code', 'name', 'fence_type', 'center_lat', 'center_lng', 'radius_m', 'active'],
      emptyStateAr: 'لا توجد نطاقات جغرافية معرفة.',
      emptyStateEn: 'No geofence boundaries defined.'
    },
    geofence_events: {
      category: 'fleet',
      titleAr: 'أحداث دخول وخروج النطاقات',
      titleEn: 'Geofence Events',
      icon: 'fa-bell',
      api: '/api/v1/fleet/geofence-events',
      actions: ['iot:evaluate_geofence_breach', 'iot:acknowledge_geofence_event'],
      columns: ['event_uuid', 'device_id', 'geofence_id', 'event_type', 'breach_flag', 'timestamp'],
      emptyStateAr: 'لم تسجل أي اختراقات أو أحداث نطاق جغرافي.',
      emptyStateEn: 'No geofence breach events recorded.'
    },
    speed_and_driver_events: {
      category: 'fleet',
      titleAr: 'أحداث السرعة والسياقة',
      titleEn: 'Speed and Driver Events',
      icon: 'fa-gauge-high',
      api: '/api/v1/fleet/speed-events',
      actions: ['iot:record_speed_event', 'iot:acknowledge_driver_event'],
      columns: ['event_uuid', 'vehicle_id', 'recorded_speed_kmh', 'speed_limit_kmh', 'severity', 'timestamp'],
      emptyStateAr: 'لم تسجل أي مخالفت سرعة أو سياقة قاسية.',
      emptyStateEn: 'No harsh driving or speeding events logged.'
    },
    fuel_telemetry: {
      category: 'fleet',
      titleAr: 'قياسات واستهلاك الوقود',
      titleEn: 'Fuel Telemetry',
      icon: 'fa-gas-pump',
      api: '/api/v1/fleet/fuel',
      actions: ['iot:record_fuel_reading'],
      columns: ['device_id', 'fuel_level_liters', 'percentage', 'delta_liters', 'anomaly_flag', 'timestamp'],
      emptyStateAr: 'لا توجد قياسات وقود سريعة.',
      emptyStateEn: 'No fuel level readings logged.'
    },
    suspected_fuel_loss_queue: {
      category: 'fleet',
      titleAr: 'طابور الاشتباه في هدر الوقود',
      titleEn: 'Suspected Fuel Loss Queue',
      icon: 'fa-shield-cat',
      api: '/api/v1/fleet/fuel-anomalies',
      actions: ['iot:investigate_fuel_anomaly', 'iot:resolve_fuel_anomaly'],
      columns: ['case_code', 'vehicle_id', 'fuel_drop_liters', 'suspected_reason', 'investigation_status', 'updated_at'],
      emptyStateAr: 'طابور الاشتباه في الوقود خالي من الثغرات.',
      emptyStateEn: 'No suspected fuel anomalies pending investigation.'
    },
    maintenance_triggers: {
      category: 'fleet',
      titleAr: 'محفزات الصيانة التلقائية',
      titleEn: 'Maintenance Triggers',
      icon: 'fa-wrench',
      api: '/api/v1/fleet/maintenance-triggers',
      actions: ['iot:create_maintenance_trigger', 'iot:generate_maintenance_proposal'],
      columns: ['trigger_code', 'vehicle_id', 'trigger_type', 'threshold_value', 'current_value', 'status'],
      emptyStateAr: 'لا توجد محفزات صيانة تلقائية مستدعاة.',
      emptyStateEn: 'No automatic maintenance triggers active.'
    },
    offline_client_registry: {
      category: 'offline',
      titleAr: 'سجل التطبيقات الميدانية المستقلة',
      titleEn: 'Offline Client Registry',
      icon: 'fa-mobile-screen',
      api: '/api/v1/offline/clients',
      actions: ['offline:register_client', 'offline:revoke_client'],
      columns: ['client_uuid', 'device_name', 'app_version', 'sync_status', 'last_sync_at'],
      emptyStateAr: 'لا توجد تطبيقات ميدانية مستقبِلة مسجلة.',
      emptyStateEn: 'No offline field clients registered.'
    },
    offline_queue: {
      category: 'offline',
      titleAr: 'طابور الأوامر غير المتصلة',
      titleEn: 'Offline Queue',
      icon: 'fa-list-check',
      api: '/api/v1/offline/queue',
      actions: ['offline:push_queue_batch', 'offline:clear_rejected_items'],
      columns: ['queue_item_uuid', 'client_id', 'entity_name', 'action_type', 'status', 'client_timestamp'],
      emptyStateAr: 'طابور الأوامر غير المتصلة فارغ.',
      emptyStateEn: 'Offline queue is completely synced.'
    },
    sync_sessions: {
      category: 'offline',
      titleAr: 'جلسات المزامنة الميدانية',
      titleEn: 'Sync Sessions',
      icon: 'fa-rotate',
      api: '/api/v1/offline/sessions',
      actions: ['offline:start_sync_session', 'offline:complete_sync_session'],
      columns: ['session_uuid', 'client_id', 'processed_count', 'rejected_count', 'status', 'started_at'],
      emptyStateAr: 'لا توجد جلسات مزامنة مكتملة أو جارية.',
      emptyStateEn: 'No sync sessions executed yet.'
    },
    sync_conflicts: {
      category: 'offline',
      titleAr: 'تعارضات المزامنة',
      titleEn: 'Sync Conflicts',
      icon: 'fa-code-compare',
      api: '/api/v1/offline/conflicts',
      actions: ['offline:record_sync_conflict', 'offline:resolve_sync_conflict'],
      columns: ['id', 'client_id', 'entity_name', 'conflict_type', 'resolution_status', 'created_at'],
      emptyStateAr: 'لا توجد تعارضات مزامنة معلقة.',
      emptyStateEn: 'No sync conflicts requiring resolution.'
    },
    conflict_resolution: {
      category: 'offline',
      titleAr: 'معالجة وتصفية التعارضات',
      titleEn: 'Conflict Resolution',
      icon: 'fa-check-double',
      api: '/api/v1/offline/resolutions',
      actions: ['offline:resolve_sync_conflict'],
      columns: ['conflict_id', 'strategy', 'applied_by', 'status', 'resolved_at'],
      emptyStateAr: 'سجل التصفيات فارغ.',
      emptyStateEn: 'No conflict resolutions recorded.'
    },
    offline_capability_policies: {
      category: 'offline',
      titleAr: 'سياسات الصلاحيات الميدانية',
      titleEn: 'Offline Capability Policies',
      icon: 'fa-shield-halved',
      api: '/api/v1/offline/policies',
      actions: ['offline:set_capability_policy'],
      columns: ['role_id', 'allowed_actions', 'max_offline_hours', 'requires_reauth', 'updated_at'],
      emptyStateAr: 'لا توجد سياسات صلاحيات غير متصلة معرفة.',
      emptyStateEn: 'No offline capability policies configured.'
    },
    kiosk_device_registry: {
      category: 'kiosk',
      titleAr: 'سجل أجهزة الكشك الخدمي',
      titleEn: 'Kiosk Device Registry',
      icon: 'fa-desktop',
      api: '/api/v1/kiosk/registry',
      actions: ['kiosk:register_kiosk', 'kiosk:deactivate_kiosk'],
      columns: ['code', 'name', 'kiosk_type', 'status', 'last_ping_at'],
      emptyStateAr: 'لا توجد أجهزة كشك مسجلة.',
      emptyStateEn: 'No kiosk devices registered.'
    },
    employee_kiosk: {
      category: 'kiosk',
      titleAr: 'كشك الموظفين الذاتي',
      titleEn: 'Employee Kiosk',
      icon: 'fa-user-gear',
      api: '/api/v1/kiosk/employee',
      actions: ['kiosk:employee_checkin', 'kiosk:evaluate_kiosk_permission'],
      columns: ['employee_code', 'name', 'shift_status', 'checkin_time', 'kiosk_session'],
      emptyStateAr: 'كشك الموظفين جاهز لعمليات الاستخدام الذاتي.',
      emptyStateEn: 'Employee self-service kiosk is active.'
    },
    warehouse_kiosk: {
      category: 'kiosk',
      titleAr: 'كشك العمليات المخزنية',
      titleEn: 'Warehouse Kiosk',
      icon: 'fa-boxes-packing',
      api: '/api/v1/kiosk/warehouse',
      actions: ['kiosk:warehouse_quick_scan', 'kiosk:evaluate_kiosk_permission'],
      columns: ['operator_id', 'active_task', 'scan_mode', 'scanned_count', 'status'],
      emptyStateAr: 'كشك المخزن جاهز لمسح الاستلام والالتقاط.',
      emptyStateEn: 'Warehouse kiosk ready for rapid scan execution.'
    },
    shop_floor_kiosk: {
      category: 'kiosk',
      titleAr: 'كشك صالة الإنتاج',
      titleEn: 'Shop Floor Kiosk',
      icon: 'fa-industry',
      api: '/api/v1/kiosk/shopfloor',
      actions: ['kiosk:shopfloor_quick_output', 'kiosk:evaluate_kiosk_permission'],
      columns: ['work_center', 'active_wo', 'produced_qty', 'scrap_qty', 'status'],
      emptyStateAr: 'كشك صالة الإنتاج جاهز لتسجيل الإنتاج والتوقف.',
      emptyStateEn: 'Shop floor kiosk ready for operator entries.'
    },
    service_kiosk: {
      category: 'kiosk',
      titleAr: 'كشك الخدمة والصيانة',
      titleEn: 'Service Kiosk',
      icon: 'fa-headset',
      api: '/api/v1/kiosk/service',
      actions: ['kiosk:service_checkin', 'kiosk:evaluate_kiosk_permission'],
      columns: ['ticket_code', 'customer_ref', 'service_type', 'queue_num', 'status'],
      emptyStateAr: 'كشك الخدمة جاهز لاستقبال طلبات الصيانة.',
      emptyStateEn: 'Service kiosk ready for reception.'
    },
    fleet_operations_board: {
      category: 'boards',
      titleAr: 'لوحة عمليات الأسطول',
      titleEn: 'Fleet Operations Board',
      icon: 'fa-tv',
      api: '/api/v1/boards/fleet-ops',
      actions: [],
      columns: ['metric', 'value', 'status', 'trend'],
      emptyStateAr: 'شاشة الأسطول تعرض الأحداث والمؤشرات الحية.',
      emptyStateEn: 'Fleet board displays real-time operational status.'
    },
    device_health_board: {
      category: 'boards',
      titleAr: 'لوحة صحة وشبكة الأجهزة',
      titleEn: 'Device Health Board',
      icon: 'fa-tv',
      api: '/api/v1/boards/device-health',
      actions: [],
      columns: ['device_class', 'total_online', 'total_offline', 'degraded_count'],
      emptyStateAr: 'شاشة صحة الأجهزة تعرض حالة الاتصال والشبكات.',
      emptyStateEn: 'Device health board active.'
    },
    warehouse_large_screen: {
      category: 'boards',
      titleAr: 'شاشة المخزن الكبيرة',
      titleEn: 'Warehouse Large Screen',
      icon: 'fa-tv',
      api: '/api/v1/boards/warehouse-ops',
      actions: [],
      columns: ['dock_status', 'receiving_throughput', 'picking_throughput', 'backlog'],
      emptyStateAr: 'شاشة المستودع الكبيرة تعرض إنتاجية الاستلام والالتقاط.',
      emptyStateEn: 'Warehouse large screen board active.'
    },
    production_large_screen: {
      category: 'boards',
      titleAr: 'شاشة خط الإنتاج الكبيرة',
      titleEn: 'Production Large Screen',
      icon: 'fa-tv',
      api: '/api/v1/boards/production-ops',
      actions: [],
      columns: ['line_name', 'current_oee', 'output_rate', 'downtime_minutes'],
      emptyStateAr: 'شاشة صالة الإنتاج الكبيرة تعرض كفاءة OEE والتوقفات.',
      emptyStateEn: 'Production line board active.'
    },
    service_queue_board: {
      category: 'boards',
      titleAr: 'شاشة طابور الصيانة',
      titleEn: 'Service Queue Board',
      icon: 'fa-tv',
      api: '/api/v1/boards/service-queue',
      actions: [],
      columns: ['queue_position', 'ticket_code', 'assigned_tech', 'est_wait_min'],
      emptyStateAr: 'شاشة طابور الصيانة تعرض الانتظار والفنيين.',
      emptyStateEn: 'Service queue display active.'
    },
    alert_board: {
      category: 'boards',
      titleAr: 'شاشة التنبيهات المركزية',
      titleEn: 'Alert Board',
      icon: 'fa-tv',
      api: '/api/v1/boards/alerts',
      actions: [],
      columns: ['severity', 'source_domain', 'alert_message', 'timestamp'],
      emptyStateAr: 'شاشة التنبيهات الكبيرة تعرض كافة التنبيهات الحرجة.',
      emptyStateEn: 'Central alert board active.'
    }
  };

  root.Build10Registry = {
    PAGES,
    getPage: (id) => PAGES[id] || null,
    getAllPages: () => Object.keys(PAGES)
  };
})();
