(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  if (!root) return;

  const FORM_DEFINITIONS = {
    'iot:register_device': {
      titleAr: 'تسجيل جهاز جديد',
      titleEn: 'Register New IoT Device',
      actionId: 'iot:register_device',
      fields: [
        { name: 'device_code', labelAr: 'كود الجهاز', labelEn: 'Device Code', type: 'text', required: true, default: 'DEV-1001' },
        { name: 'name', labelAr: 'اسم الجهاز', labelEn: 'Device Name', type: 'text', required: true, default: 'GPS Tracker Unit' },
        { name: 'device_type', labelAr: 'نوع الجهاز', labelEn: 'Device Type', type: 'select', options: ['tracker', 'gateway', 'sensor_hub', 'telematics_unit'] }
      ]
    },
    'iot:enroll_device': {
      titleAr: 'تفعيل وتسجيل جهاز',
      titleEn: 'Enroll Device',
      actionId: 'iot:enroll_device',
      fields: [
        { name: 'device_code', labelAr: 'كود الجهاز', labelEn: 'Device Code', type: 'text', required: true },
        { name: 'name', labelAr: 'اسم الجهاز', labelEn: 'Device Name', type: 'text', required: true },
        { name: 'device_type', labelAr: 'النوع', labelEn: 'Type', type: 'text', default: 'tracker' }
      ]
    },
    'iot:confirm_enrollment': {
      titleAr: 'تأكيد تفعيل الجهاز',
      titleEn: 'Confirm Enrollment',
      actionId: 'iot:confirm_enrollment',
      fields: [
        { name: 'device_id', labelAr: 'معرف الجهاز', labelEn: 'Device ID', type: 'text', required: true },
        { name: 'enrollment_code', labelAr: 'كود التفعيل', labelEn: 'Enrollment Code', type: 'text', required: true }
      ]
    },
    'iot:update_device_status': {
      titleAr: 'تحديث حالة الجهاز',
      titleEn: 'Update Device Status',
      actionId: 'iot:update_device_status',
      fields: [
        { name: 'device_id', labelAr: 'معرف الجهاز', labelEn: 'Device ID', type: 'text', required: true },
        { name: 'status', labelAr: 'الحالة الجديدة', labelEn: 'New Status', type: 'select', options: ['active', 'suspended', 'retired', 'revoked'] }
      ]
    },
    'iot:register_gateway': {
      titleAr: 'تسجيل بوابة IoT',
      titleEn: 'Register Gateway',
      actionId: 'iot:register_gateway',
      fields: [
        { name: 'gateway_code', labelAr: 'كود البوابة', labelEn: 'Gateway Code', type: 'text', required: true, default: 'GW-HQ-01' },
        { name: 'name', labelAr: 'اسم البوابة', labelEn: 'Gateway Name', type: 'text', required: true, default: 'Depot Gateway' },
        { name: 'ip_address', labelAr: 'عنوان IP', labelEn: 'IP Address', type: 'text', default: '192.168.1.100' }
      ]
    },
    'iot:attach_sensor': {
      titleAr: 'ربط حساس بجهاز',
      titleEn: 'Attach Sensor',
      actionId: 'iot:attach_sensor',
      fields: [
        { name: 'device_id', labelAr: 'معرف الجهاز', labelEn: 'Device ID', type: 'text', required: true },
        { name: 'sensor_code', labelAr: 'كود الحساس', labelEn: 'Sensor Code', type: 'text', required: true, default: 'SNS-TEMP-01' },
        { name: 'sensor_type', labelAr: 'نوع الحساس', labelEn: 'Sensor Type', type: 'select', options: ['temperature', 'humidity', 'pressure', 'gps', 'fuel'] },
        { name: 'unit', labelAr: 'وحدة القياس', labelEn: 'Unit', type: 'text', default: 'C' }
      ]
    },
    'iot:ingest_telemetry': {
      titleAr: 'إدخال قراءة قياس سريعة',
      titleEn: 'Ingest Telemetry Reading',
      actionId: 'iot:ingest_telemetry',
      fields: [
        { name: 'device_id', labelAr: 'معرف الجهاز', labelEn: 'Device ID', type: 'text', required: true },
        { name: 'metric', labelAr: 'المقياس', labelEn: 'Metric', type: 'text', required: true, default: 'temperature' },
        { name: 'value', labelAr: 'القيمة', labelEn: 'Value', type: 'number', required: true, default: 25.5 },
        { name: 'unit', labelAr: 'الوحدة', labelEn: 'Unit', type: 'text', default: 'C' }
      ]
    },
    'iot:define_geofence': {
      titleAr: 'تعريف نطاق جغرافي',
      titleEn: 'Define Geofence',
      actionId: 'iot:define_geofence',
      fields: [
        { name: 'code', labelAr: 'كود النطاق', labelEn: 'Geofence Code', type: 'text', required: true, default: 'GF-HQ-01' },
        { name: 'name', labelAr: 'اسم النطاق', labelEn: 'Geofence Name', type: 'text', required: true, default: 'Central Warehouse Depot' },
        { name: 'fence_type', labelAr: 'نوع النطاق', labelEn: 'Fence Type', type: 'select', options: ['circular', 'polygon'] },
        { name: 'center_lat', labelAr: 'دائرة العرض', labelEn: 'Center Lat', type: 'number', default: 33.3152 },
        { name: 'center_lng', labelAr: 'خط الطول', labelEn: 'Center Lng', type: 'number', default: 44.3661 },
        { name: 'radius_m', labelAr: 'نصف القطر (متر)', labelEn: 'Radius (meters)', type: 'number', default: 500 }
      ]
    },
    'iot:record_location_point': {
      titleAr: 'تسجيل نقطة تتبع',
      titleEn: 'Record Location Point',
      actionId: 'iot:record_location_point',
      fields: [
        { name: 'device_id', labelAr: 'معرف الجهاز', labelEn: 'Device ID', type: 'text', required: true },
        { name: 'latitude', labelAr: 'خط العرض', labelEn: 'Latitude', type: 'number', required: true, default: 33.3152 },
        { name: 'longitude', labelAr: 'خط الطول', labelEn: 'Longitude', type: 'number', required: true, default: 44.3661 },
        { name: 'speed_kmh', labelAr: 'السرعة (كم/س)', labelEn: 'Speed (km/h)', type: 'number', default: 60 }
      ]
    },
    'iot:start_or_project_trip': {
      titleAr: 'حساب وبدء رحلة مركبة',
      titleEn: 'Start or Project Trip',
      actionId: 'iot:start_or_project_trip',
      fields: [
        { name: 'vehicle_id', labelAr: 'معرف المركبة', labelEn: 'Vehicle ID', type: 'text', required: true },
        { name: 'device_id', labelAr: 'معرف الجهاز', labelEn: 'Device ID', type: 'text', required: true },
        { name: 'distance_km', labelAr: 'المسافة (كم)', labelEn: 'Distance (km)', type: 'number', default: 15 },
        { name: 'max_speed_kmh', labelAr: 'أقصى سرعة', labelEn: 'Max Speed (km/h)', type: 'number', default: 90 }
      ]
    },
    'iot:investigate_fuel_anomaly': {
      titleAr: 'تحقيق في هدر الوقود',
      titleEn: 'Investigate Fuel Anomaly',
      actionId: 'iot:investigate_fuel_anomaly',
      fields: [
        { name: 'anomaly_id', labelAr: 'معرف الحالة', labelEn: 'Anomaly ID', type: 'text', required: true },
        { name: 'investigation_notes', labelAr: 'ملاحظات التحقيق', labelEn: 'Notes', type: 'textarea', default: 'Under review by fleet manager' }
      ]
    },
    'offline:register_client': {
      titleAr: 'تسجيل تطبيق ميداني غير متصل',
      titleEn: 'Register Offline Client',
      actionId: 'offline:register_client',
      fields: [
        { name: 'client_uuid', labelAr: 'معرف التطبيق', labelEn: 'Client UUID', type: 'text', required: true, default: 'PWA-FIELD-01' },
        { name: 'device_name', labelAr: 'اسم الجهاز الميداني', labelEn: 'Device Name', type: 'text', required: true, default: 'Handheld Scanner Alpha' },
        { name: 'app_version', labelAr: 'إصدار التطبيق', labelEn: 'App Version', type: 'text', default: 'v1.0.4' }
      ]
    },
    'offline:push_queue_batch': {
      titleAr: 'دفع طابور المزامنة',
      titleEn: 'Push Queue Batch',
      actionId: 'offline:push_queue_batch',
      fields: [
        { name: 'client_id', labelAr: 'معرف التطبيق', labelEn: 'Client ID', type: 'text', required: true },
        { name: 'session_uuid', labelAr: 'معرف الجلسة', labelEn: 'Session UUID', type: 'text', required: true, default: 'SYNC-SESSION-001' }
      ]
    },
    'offline:resolve_sync_conflict': {
      titleAr: 'معالجة تعارض المزامنة',
      titleEn: 'Resolve Sync Conflict',
      actionId: 'offline:resolve_sync_conflict',
      fields: [
        { name: 'conflict_id', labelAr: 'معرف التعارض', labelEn: 'Conflict ID', type: 'text', required: true },
        { name: 'strategy', labelAr: 'استراتيجية الحل', labelEn: 'Strategy', type: 'select', options: ['server_wins', 'client_wins', 'manual_merge'] },
        { name: 'notes', labelAr: 'ملاحظات', labelEn: 'Notes', type: 'text', default: 'Resolved by manager' }
      ]
    },
    'kiosk:register_kiosk': {
      titleAr: 'تسجيل كشك خدمة',
      titleEn: 'Register Kiosk Device',
      actionId: 'kiosk:register_kiosk',
      fields: [
        { name: 'code', labelAr: 'كود الكشك', labelEn: 'Kiosk Code', type: 'text', required: true, default: 'KIOSK-WH-01' },
        { name: 'name', labelAr: 'اسم الكشك', labelEn: 'Kiosk Name', type: 'text', required: true, default: 'Warehouse Main Kiosk' },
        { name: 'kiosk_type', labelAr: 'نوع الكشك', labelEn: 'Kiosk Type', type: 'select', options: ['warehouse', 'shopfloor', 'employee', 'service'] }
      ]
    }
  };

  root.Build10Forms = {
    FORM_DEFINITIONS,
    getForm: (actionId) => FORM_DEFINITIONS[actionId] || null
  };
})();
