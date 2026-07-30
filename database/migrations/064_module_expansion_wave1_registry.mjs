// 064_module_expansion_wave1_registry.mjs — Module Expansion Wave 1, M1.
//
// Registers the eight Wave 1 modules and their permission namespaces in the
// EXISTING control plane. This migration deliberately creates NO business
// tables: it is the registry and entitlement foundation that every Wave 1
// module depends on, so that a module can be enabled, disabled, scoped to a
// company, and permission-checked before any of its domain schema exists.
//
// Registering the modules first also means a half-finished wave is visible and
// governable rather than invisible: a module registered with lifecycle
// 'planned' shows up in Administration as not-yet-installed instead of simply
// being absent.
//
// Canonical authorities are REUSED, never duplicated. Each module declares its
// dependencies on the existing Party, Product, Inventory, Sales, Finance,
// Work Item, Asset, Maintenance, File and Identity authorities.
//
// Migrations 001-063 are historical and are not edited.
// Dialect: SQLite and PostgreSQL — no SQLite-only construct.

const MIGRATION_ID = '064_module_expansion_wave1_registry';

/**
 * The eight Wave 1 modules.
 *
 * `lifecycle` is 'planned' for every module whose domain schema does not exist
 * yet. It becomes 'available' in the migration that creates that module's
 * tables. This keeps the registry honest — a module is never advertised as
 * installable before it can actually run.
 */
const WAVE1_MODULES = [
  {
    id: 'crm',
    nameAr: 'إدارة علاقات العملاء',
    nameEn: 'CRM',
    dependencies: ['platform_kernel', 'commercial_core', 'commercial_sales'],
    capabilities: ['CRM-LEAD', 'CRM-OPPORTUNITY', 'CRM-PIPELINE', 'CRM-ACTIVITY', 'CRM-CAMPAIGN'],
    licenseKey: 'octagon.crm',
    navGroup: 'crm',
  },
  {
    id: 'service_helpdesk',
    nameAr: 'خدمة العملاء والدعم',
    nameEn: 'Service & Helpdesk',
    dependencies: ['platform_kernel', 'commercial_core', 'work_item_canonical'],
    capabilities: ['SVC-TICKET', 'SVC-SLA', 'SVC-QUEUE', 'SVC-ESCALATION', 'SVC-CSAT'],
    licenseKey: 'octagon.service',
    navGroup: 'service',
  },
  {
    id: 'documents',
    nameAr: 'إدارة الوثائق',
    nameEn: 'Documents',
    dependencies: ['platform_kernel'],
    capabilities: ['DOC-STORE', 'DOC-VERSION', 'DOC-APPROVAL', 'DOC-RETENTION', 'DOC-SHARE'],
    licenseKey: 'octagon.documents',
    navGroup: 'documents',
  },
  {
    id: 'knowledge',
    nameAr: 'قاعدة المعرفة',
    nameEn: 'Knowledge & SOP',
    dependencies: ['platform_kernel', 'documents'],
    capabilities: ['KB-ARTICLE', 'KB-SOP', 'KB-REVISION', 'KB-PUBLICATION', 'KB-FEEDBACK'],
    licenseKey: 'octagon.knowledge',
    navGroup: 'knowledge',
  },
  {
    id: 'appointments',
    nameAr: 'المواعيد والحجوزات',
    nameEn: 'Appointments',
    dependencies: ['platform_kernel', 'commercial_core', 'work_item_canonical'],
    capabilities: ['APT-TYPE', 'APT-AVAILABILITY', 'APT-BOOKING', 'APT-REMINDER', 'APT-WAITLIST'],
    licenseKey: 'octagon.appointments',
    navGroup: 'appointments',
  },
  {
    id: 'field_service',
    nameAr: 'الخدمة الميدانية',
    nameEn: 'Field Service',
    dependencies: [
      'platform_kernel', 'work_item_canonical', 'stock_inventory',
      'assets_management', 'operations_maintenance', 'service_helpdesk',
    ],
    capabilities: ['FS-ORDER', 'FS-DISPATCH', 'FS-PARTS', 'FS-REPORT', 'FS-BILLING'],
    licenseKey: 'octagon.field_service',
    navGroup: 'field_service',
  },
  {
    id: 'customer_portal',
    nameAr: 'بوابة العملاء',
    nameEn: 'Customer Portal',
    dependencies: ['platform_kernel', 'commercial_core', 'commercial_sales', 'finance_canonical'],
    capabilities: ['PORTAL-AUTH', 'PORTAL-ORDERS', 'PORTAL-TICKETS', 'PORTAL-DOCS', 'PORTAL-BOOKING'],
    licenseKey: 'octagon.portal',
    navGroup: 'customer_portal',
  },
  {
    id: 'ecommerce',
    nameAr: 'المتجر الإلكتروني',
    nameEn: 'E-commerce',
    dependencies: [
      'platform_kernel', 'commercial_core', 'commercial_sales',
      'stock_inventory', 'finance_canonical', 'customer_portal',
    ],
    capabilities: ['ECOM-CATALOG', 'ECOM-CART', 'ECOM-CHECKOUT', 'ECOM-WEBORDER', 'ECOM-RETURN'],
    licenseKey: 'octagon.ecommerce',
    navGroup: 'ecommerce',
  },
];

/**
 * Permission namespaces.
 *
 * `sensitive = 1` marks a permission that changes money, stock, customer-visible
 * state, or another party's data — those are the ones a permission regression
 * must assert are denied to viewers and portal users.
 */
const WAVE1_PERMISSIONS = [
  ['crm', 'crm', 'read', 'قراءة', 'Read', 0],
  ['crm', 'crm', 'create', 'إنشاء', 'Create', 0],
  ['crm', 'crm', 'update', 'تعديل', 'Update', 0],
  ['crm', 'crm', 'assign', 'إسناد', 'Assign', 0],
  ['crm', 'crm', 'convert', 'تحويل إلى فرصة', 'Convert', 1],
  ['crm', 'crm', 'manage', 'إدارة', 'Manage', 1],

  ['service_helpdesk', 'service', 'read', 'قراءة', 'Read', 0],
  ['service_helpdesk', 'service', 'create', 'إنشاء تذكرة', 'Create', 0],
  ['service_helpdesk', 'service', 'assign', 'إسناد', 'Assign', 0],
  ['service_helpdesk', 'service', 'respond', 'رد', 'Respond', 0],
  ['service_helpdesk', 'service', 'resolve', 'حل', 'Resolve', 1],
  ['service_helpdesk', 'service', 'manage', 'إدارة', 'Manage', 1],

  ['documents', 'documents', 'read', 'قراءة', 'Read', 0],
  ['documents', 'documents', 'upload', 'رفع', 'Upload', 0],
  ['documents', 'documents', 'update', 'تعديل', 'Update', 0],
  ['documents', 'documents', 'approve', 'اعتماد', 'Approve', 1],
  ['documents', 'documents', 'share', 'مشاركة خارجية', 'Share', 1],
  ['documents', 'documents', 'archive', 'أرشفة', 'Archive', 1],
  ['documents', 'documents', 'manage', 'إدارة', 'Manage', 1],

  ['knowledge', 'knowledge', 'read', 'قراءة', 'Read', 0],
  ['knowledge', 'knowledge', 'create', 'إنشاء', 'Create', 0],
  ['knowledge', 'knowledge', 'review', 'مراجعة', 'Review', 0],
  ['knowledge', 'knowledge', 'publish', 'نشر', 'Publish', 1],
  ['knowledge', 'knowledge', 'manage', 'إدارة', 'Manage', 1],

  ['appointments', 'appointments', 'read', 'قراءة', 'Read', 0],
  ['appointments', 'appointments', 'create', 'حجز', 'Create', 0],
  ['appointments', 'appointments', 'reschedule', 'إعادة جدولة', 'Reschedule', 0],
  ['appointments', 'appointments', 'cancel', 'إلغاء', 'Cancel', 1],
  ['appointments', 'appointments', 'manage', 'إدارة', 'Manage', 1],

  ['field_service', 'field_service', 'read', 'قراءة', 'Read', 0],
  ['field_service', 'field_service', 'dispatch', 'توزيع', 'Dispatch', 1],
  ['field_service', 'field_service', 'execute', 'تنفيذ', 'Execute', 1],
  ['field_service', 'field_service', 'complete', 'إنهاء', 'Complete', 1],
  ['field_service', 'field_service', 'bill', 'طلب فوترة', 'Bill', 1],
  ['field_service', 'field_service', 'manage', 'إدارة', 'Manage', 1],

  ['customer_portal', 'portal', 'read_own', 'قراءة سجلاتي', 'Read own records', 0],
  ['customer_portal', 'portal', 'submit_ticket', 'إرسال تذكرة', 'Submit ticket', 0],
  ['customer_portal', 'portal', 'book_appointment', 'حجز موعد', 'Book appointment', 0],
  ['customer_portal', 'portal', 'approve_quotation', 'اعتماد عرض سعر', 'Approve quotation', 1],
  ['customer_portal', 'portal', 'download', 'تنزيل ملف', 'Download file', 1],
  ['customer_portal', 'portal', 'manage', 'إدارة البوابة', 'Manage portal', 1],

  ['ecommerce', 'ecommerce', 'read', 'قراءة', 'Read', 0],
  ['ecommerce', 'ecommerce', 'publish_product', 'نشر منتج', 'Publish product', 1],
  ['ecommerce', 'ecommerce', 'checkout', 'إتمام الشراء', 'Checkout', 1],
  ['ecommerce', 'ecommerce', 'refund_request', 'طلب إرجاع', 'Return request', 1],
  ['ecommerce', 'ecommerce', 'manage', 'إدارة المتجر', 'Manage store', 1],
];

export const migration = {
  id: MIGRATION_ID,
  owner: 'platform.kernel',
  version: '1.43.0',
  parent: '063_cutover_lineage_quarantine_and_mapping',
  dependsOn: ['063_cutover_lineage_quarantine_and_mapping'],
  dialect: ['sqlite', 'postgres'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance:
    'Module Expansion Wave 1 M1 — control-plane registration and permission namespaces for CRM, Service/Helpdesk, Documents, Knowledge, Appointments, Field Service, Customer Portal and E-commerce, ahead of their domain schema.',

  up(db) {
    const now = new Date().toISOString();

    // Wave 1 entitlement + navigation facts, kept beside the module row so the
    // control plane can answer "what does this module cost, where does it appear,
    // and is it installable" without a second registry.
    db.exec(`
      CREATE TABLE IF NOT EXISTS module_expansion_registry (
        module_id TEXT PRIMARY KEY,
        wave TEXT NOT NULL,
        name_ar TEXT NOT NULL,
        name_en TEXT NOT NULL,
        license_key TEXT NOT NULL,
        nav_group TEXT NOT NULL,
        permission_namespace TEXT NOT NULL,
        lifecycle TEXT NOT NULL DEFAULT 'planned',
        schema_migration TEXT,
        feature_flags TEXT NOT NULL DEFAULT '{}',
        health_check TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_module_expansion_wave
        ON module_expansion_registry(wave, lifecycle);
    `);

    const insertModule = db.prepare(`
      INSERT INTO platform_modules (
        id, name, version, status, kind, owner, dependencies, optional_dependencies,
        capabilities, migrations, settings, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        version = excluded.version,
        capabilities = excluded.capabilities,
        dependencies = excluded.dependencies,
        updated_at = excluded.updated_at
    `);

    const insertRegistry = db.prepare(`
      INSERT INTO module_expansion_registry (
        module_id, wave, name_ar, name_en, license_key, nav_group,
        permission_namespace, lifecycle, schema_migration, feature_flags,
        health_check, created_at, updated_at
      ) VALUES (?, 'wave_1', ?, ?, ?, ?, ?, 'planned', NULL, '{}', ?, ?, ?)
      ON CONFLICT(module_id) DO UPDATE SET
        name_ar = excluded.name_ar,
        name_en = excluded.name_en,
        license_key = excluded.license_key,
        nav_group = excluded.nav_group,
        updated_at = excluded.updated_at
    `);

    for (const m of WAVE1_MODULES) {
      insertModule.run(
        m.id,
        m.nameEn,
        '1.0.0',
        // `platform_modules.status` is constrained by migration 007 to
        // available|installed|licensed|enabled|visible|authorized. 007 is
        // historical and immutable, so 'available' is used — the least-committed
        // state the existing enum offers. It means "registered and known", NOT
        // installed or enabled. The precise lifecycle ('planned' until the
        // module's domain schema exists) is tracked in
        // module_expansion_registry.lifecycle, which this migration owns.
        'available',
        'optional',
        'octagon',
        JSON.stringify(m.dependencies),
        JSON.stringify([]),
        JSON.stringify(m.capabilities),
        JSON.stringify([MIGRATION_ID]),
        JSON.stringify([]),
        now,
        now
      );
      insertRegistry.run(
        m.id, m.nameAr, m.nameEn, m.licenseKey, m.navGroup,
        m.id === 'customer_portal' ? 'portal' : (m.id === 'service_helpdesk' ? 'service' : m.id),
        `${m.id}:health`, now, now
      );
    }

    const insertPermission = db.prepare(`
      INSERT INTO authorization_permissions (
        id, module_id, kind, resource, action, label_ar, label_en,
        sensitive, depends_on, deprecated, replaced_by, created_at, updated_at
      ) VALUES (?, ?, 'action', ?, ?, ?, ?, ?, '[]', 0, NULL, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        label_ar = excluded.label_ar,
        label_en = excluded.label_en,
        sensitive = excluded.sensitive,
        updated_at = excluded.updated_at
    `);

    for (const [moduleId, resource, action, labelAr, labelEn, sensitive] of WAVE1_PERMISSIONS) {
      insertPermission.run(
        `perm_${resource}_${action}`, moduleId, resource, action,
        labelAr, labelEn, sensitive, now, now
      );
    }
  },

  down(db) {
    const moduleIds = WAVE1_MODULES.map((m) => m.id);
    const placeholders = moduleIds.map(() => '?').join(',');

    // Permissions and role assignments referencing them go before the modules.
    db.prepare(`DELETE FROM authorization_permissions WHERE module_id IN (${placeholders})`).run(...moduleIds);
    db.exec('DROP TABLE IF EXISTS module_expansion_registry;');
    db.prepare(`DELETE FROM platform_modules WHERE id IN (${placeholders})`).run(...moduleIds);
  },
};

export const WAVE1_MODULE_IDS = WAVE1_MODULES.map((m) => m.id);
export const WAVE1_PERMISSION_COUNT = WAVE1_PERMISSIONS.length;
