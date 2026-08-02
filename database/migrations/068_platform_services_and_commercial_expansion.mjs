// 068_platform_services_and_commercial_expansion — BUILD-05 platform closure & BUILD-06 commercial expansion tables.
const MODULE_ID = 'platform_kernel';

const ENTITIES = [
  ['notification_provider', 'مزوّد إشعارات', 'Notification Provider'],
  ['notification_delivery', 'تسليم إشعار', 'Notification Delivery'],
  ['platform_saved_view', 'عرض محفوظ', 'Saved View'],
  ['customer_credit_profile', 'ملف ائتمان العميل', 'Customer Credit Profile'],
  ['collection_promise', 'وعد بالسداد', 'Collection Promise'],
  ['commission_plan', 'خطة العمولات', 'Commission Plan'],
  ['commission_accrual', 'استحقاق عمولة', 'Commission Accrual'],
  ['governed_document_template', 'قالب مستند مالي', 'Document Template'],
];

const ACTIONS = [
  // Notification delivery
  ['notification:provider:configure', 'notification_provider', 'platform:db:write', ['channel', 'provider_name']],
  ['notification:provider:toggle', 'notification_provider', 'platform:db:write', ['provider_id', 'is_enabled']],
  ['notification:send_test', 'notification_delivery', 'platform:db:write', ['channel', 'recipient_id']],
  ['notification:retry_delivery', 'notification_delivery', 'platform:db:write', ['delivery_id']],

  // Saved Views
  ['saved_view:delete', 'platform_saved_view', 'platform:db:write', ['view_id']],

  // Commercial RMA Extensions
  ['sales:rma:receive', 'commercial_rma_case', 'sales:order:write', ['rma_id', 'warehouse_id']],
  ['sales:rma:inspect', 'commercial_rma_case', 'sales:order:write', ['rma_id', 'result', 'disposition']],
  ['sales:rma:resolve', 'commercial_rma_case', 'sales:order:write', ['rma_id', 'resolution_type']],
  ['sales:rma:close', 'commercial_rma_case', 'sales:order:write', ['rma_id']],

  // Credit & Collections
  ['credit:profile:update', 'customer_credit_profile', 'finance:credit:write', ['customer_id', 'credit_limit']],
  ['credit:hold:apply', 'customer_credit_profile', 'finance:credit:write', ['customer_id', 'reason']],
  ['credit:hold:release', 'customer_credit_profile', 'finance:credit:write', ['customer_id']],
  ['credit:override:grant', 'customer_credit_profile', 'finance:credit:write', ['customer_id', 'override_amount', 'expires_at']],
  ['collection:promise:create', 'collection_promise', 'finance:credit:write', ['customer_id', 'amount', 'promise_date']],
  ['collection:promise:fulfill', 'collection_promise', 'finance:credit:write', ['promise_id']],
  ['collection:promise:break', 'collection_promise', 'finance:credit:write', ['promise_id']],

  // Printing & Templates
  ['template:create', 'governed_document_template', 'platform:db:write', ['name', 'doc_type', 'body_html']],
  ['template:publish', 'governed_document_template', 'platform:db:write', ['template_id']],
  ['template:render', 'governed_document_template', 'platform:db:read', ['template_id', 'record_id']],

  // Sales Commissions
  ['commission:plan:create', 'commission_plan', 'sales:commission:write', ['name', 'basis', 'default_rate_pct']],
  ['commission:accrue', 'commission_accrual', 'sales:commission:write', ['salesperson_id', 'sale_order_id', 'basis_amount']],
  ['commission:approve', 'commission_accrual', 'sales:commission:write', ['accrual_id']],
  ['commission:reverse', 'commission_accrual', 'sales:commission:write', ['accrual_id', 'reason']],
  ['commission:settle', 'commission_accrual', 'sales:commission:write', ['accrual_ids']],
];

export const migration = {
  id: '068_platform_services_and_commercial_expansion',
  owner: 'platform.kernel',
  version: '1.47.0',
  parent: '067_scheduled_reports',
  dependsOn: ['067_scheduled_reports'],
  dialect: ['sqlite', 'postgres'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'BUILD-05 Platform closure and BUILD-06 Commercial Operations expansion.',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS notification_providers (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        channel TEXT NOT NULL CHECK(channel IN ('inapp','email','sms','whatsapp','webhook')),
        provider_name TEXT NOT NULL,
        is_enabled INTEGER NOT NULL DEFAULT 1,
        config TEXT NOT NULL DEFAULT '{}',
        health_status TEXT NOT NULL DEFAULT 'healthy' CHECK(health_status IN ('healthy','degraded','down')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_providers_comp_channel
        ON notification_providers(company_id, channel, provider_name);

      CREATE TABLE IF NOT EXISTS platform_saved_views (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        entity TEXT NOT NULL,
        name TEXT NOT NULL,
        filters TEXT NOT NULL DEFAULT '{}',
        columns TEXT NOT NULL DEFAULT '[]',
        sort TEXT NOT NULL DEFAULT '[]',
        is_shared INTEGER NOT NULL DEFAULT 0,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_saved_views_scope
        ON platform_saved_views(company_id, entity, owner_id);

      CREATE TABLE IF NOT EXISTS commercial_rma_inspections (
        id TEXT PRIMARY KEY,
        rma_id TEXT NOT NULL REFERENCES commercial_rma_cases(id) ON DELETE CASCADE,
        inspector_id TEXT NOT NULL,
        result TEXT NOT NULL CHECK(result IN ('pass','fail','conditional_pass','scrap','rework')),
        disposition TEXT NOT NULL DEFAULT 'pending' CHECK(disposition IN ('pending','restock','scrap','repair','replacement','credit')),
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS customer_credit_profiles (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        company_id TEXT NOT NULL,
        credit_limit REAL NOT NULL DEFAULT 0,
        open_ar REAL NOT NULL DEFAULT 0,
        overdue_exposure REAL NOT NULL DEFAULT 0,
        unbilled_exposure REAL NOT NULL DEFAULT 0,
        credit_hold INTEGER NOT NULL DEFAULT 0,
        hold_reason TEXT DEFAULT '',
        hold_expires_at TEXT,
        override_amount REAL DEFAULT 0,
        override_expires_at TEXT,
        dunning_stage INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_credit_scope
        ON customer_credit_profiles(company_id, customer_id);

      CREATE TABLE IF NOT EXISTS collection_promises (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        company_id TEXT NOT NULL,
        collector_id TEXT NOT NULL,
        amount REAL NOT NULL,
        promise_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','fulfilled','broken','cancelled')),
        notes TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_collection_promises
        ON collection_promises(company_id, customer_id, promise_date);

      CREATE TABLE IF NOT EXISTS commission_plans (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        name TEXT NOT NULL,
        basis TEXT NOT NULL DEFAULT 'invoice' CHECK(basis IN ('invoice','collected','gross_margin')),
        default_rate_pct REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('draft','active','retired')),
        effective_at TEXT NOT NULL,
        expiry_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS commission_accruals (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        salesperson_id TEXT NOT NULL,
        sale_order_id TEXT,
        invoice_id TEXT,
        basis_amount REAL NOT NULL,
        commission_amount REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'accrued' CHECK(status IN ('accrued','approved','rejected','reversed','settled')),
        notes TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_commissions_salesperson
        ON commission_accruals(company_id, salesperson_id, status);

      CREATE TABLE IF NOT EXISTS governed_document_templates (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        name TEXT NOT NULL,
        doc_type TEXT NOT NULL,
        body_html TEXT NOT NULL,
        locale TEXT NOT NULL DEFAULT 'ar',
        barcode_type TEXT DEFAULT 'QR',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    const addEntity = db.prepare(`
      INSERT INTO platform_entities (id,module_id,storage_owner,primary_key,label_ar,label_en,section,chatter,fields,relations,scope,lifecycle_policy,query_policy,action_policy,customization_policy,history_policy,api_exposed,migration_owner,created_at,updated_at)
      VALUES (?, 'platform_kernel', 'platform.kernel', 'id', ?, ?, 'platform', 0, '{}', '{}', 'company', 'generic', 'scoped', 'registered', 'metadata', 'audit', 1, '068_platform_services_and_commercial_expansion', datetime('now'), datetime('now'))
      ON CONFLICT(id) DO NOTHING
    `);
    for (const [id, labelAr, labelEn] of ENTITIES) {
      addEntity.run(id, labelAr, labelEn);
    }

    const addAction = db.prepare(`
      INSERT INTO platform_actions (id,module_id,entity_id,kind,allowed_states,required_permission,required_scope,input_schema,preconditions,transaction_owner,idempotency_policy,sequence_policy,audit_policy,outbox_policy,reversal_action,result_schema,error_contract,created_at,updated_at)
      VALUES (?, 'platform_kernel', ?, 'domain', '[]', ?, 'company', ?, '[]', 'platform_action_executor', 'required', 'none', 'required', 'required', NULL, NULL, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `);
    const now = new Date().toISOString();
    const errorContract = JSON.stringify({ envelope: 'stable', rollback: 'atomic' });
    for (const [id, entity, permission, required] of ACTIONS) {
      addAction.run(id, entity, permission, JSON.stringify({ type: 'object', required }), errorContract, now, now);
    }
  },
  down(db) {
    for (const [id] of ACTIONS) {
      db.prepare('DELETE FROM platform_actions WHERE id = ?').run(id);
    }
    for (const [id] of ENTITIES) {
      db.prepare('DELETE FROM platform_entities WHERE id = ?').run(id);
    }
    db.exec(`
      DROP TABLE IF EXISTS governed_document_templates;
      DROP TABLE IF EXISTS commission_accruals;
      DROP TABLE IF EXISTS commission_plans;
      DROP TABLE IF EXISTS collection_promises;
      DROP TABLE IF EXISTS customer_credit_profiles;
      DROP TABLE IF EXISTS commercial_rma_inspections;
      DROP TABLE IF EXISTS platform_saved_views;
      DROP TABLE IF EXISTS notification_providers;
    `);
  },
};
