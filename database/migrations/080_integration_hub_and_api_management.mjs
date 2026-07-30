// database/migrations/080_integration_hub_and_api_management.mjs — Integration Hub & API Management Migration.

function addColumnIfNotExists(db, table, columnDef) {
  const columnName = columnDef.trim().split(/\s+/)[0];
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(c => c.name === columnName)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`).run();
  }
}

export const migration = {
  id: '080_integration_hub_and_api_management',
  description: 'Migration 080: Integration Hub & API Management (API Endpoints, API Keys, Webhook Subscriptions, Webhook Deliveries, Connectors)',

  async up(db) {
    // 1. API Endpoints
    db.prepare(`
      CREATE TABLE IF NOT EXISTS api_endpoints (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        endpoint_number TEXT NOT NULL,
        path TEXT NOT NULL,
        http_method TEXT NOT NULL DEFAULT 'GET', -- GET, POST, PUT, DELETE
        domain_module TEXT NOT NULL,
        rate_limit_per_min INTEGER NOT NULL DEFAULT 60,
        auth_required INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_api_endpoints_path
      ON api_endpoints(company_id, path, http_method)
    `).run();

    // 2. API Keys
    db.prepare(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        key_number TEXT NOT NULL,
        client_name TEXT NOT NULL,
        key_prefix TEXT NOT NULL,
        key_hash TEXT NOT NULL,
        scopes TEXT NOT NULL DEFAULT '[]', -- JSON array of allowed permissions/actions
        rate_limit_quota INTEGER NOT NULL DEFAULT 1000,
        status TEXT NOT NULL DEFAULT 'active', -- active, revoked, expired
        expires_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_api_keys_hash
      ON api_keys(key_hash)
    `).run();

    // 3. Webhook Subscriptions (Extended if existing from migration 010)
    db.prepare(`
      CREATE TABLE IF NOT EXISTS webhook_subscriptions (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        webhook_number TEXT NOT NULL,
        event_type TEXT NOT NULL,
        target_url TEXT NOT NULL,
        secret_hash TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    addColumnIfNotExists(db, 'webhook_subscriptions', 'webhook_number TEXT');
    addColumnIfNotExists(db, 'webhook_subscriptions', 'target_url TEXT');
    addColumnIfNotExists(db, 'webhook_subscriptions', 'secret_hash TEXT');
    addColumnIfNotExists(db, 'webhook_subscriptions', 'is_active INTEGER DEFAULT 1');

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_webhooks_company_event
      ON webhook_subscriptions(company_id, event_type)
    `).run();

    // 4. Webhook Deliveries (Extended if existing from migration 010)
    db.prepare(`
      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        webhook_id TEXT NOT NULL,
        delivery_number TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        response_status_code INTEGER,
        execution_time_ms INTEGER,
        status TEXT NOT NULL DEFAULT 'pending',
        delivered_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    addColumnIfNotExists(db, 'webhook_deliveries', 'company_id TEXT');
    addColumnIfNotExists(db, 'webhook_deliveries', 'webhook_id TEXT');
    addColumnIfNotExists(db, 'webhook_deliveries', 'delivery_number TEXT');
    addColumnIfNotExists(db, 'webhook_deliveries', 'event_type TEXT');
    addColumnIfNotExists(db, 'webhook_deliveries', 'payload_json TEXT');
    addColumnIfNotExists(db, 'webhook_deliveries', 'response_status_code INTEGER');
    addColumnIfNotExists(db, 'webhook_deliveries', 'execution_time_ms INTEGER');
    addColumnIfNotExists(db, 'webhook_deliveries', 'delivered_at TEXT');

    // 5. Integration Connectors
    db.prepare(`
      CREATE TABLE IF NOT EXISTS integration_connectors (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        connector_number TEXT NOT NULL,
        name TEXT NOT NULL,
        connector_type TEXT NOT NULL, -- sap, salesforce, odoo, custom_http, bank_api
        config_json TEXT, -- Auth tokens, host URLs, certificates
        status TEXT NOT NULL DEFAULT 'active', -- active, disabled, error
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();
  },

  async down(db) {
    const tables = [
      'integration_connectors',
      'api_keys',
      'api_endpoints'
    ];
    for (const table of tables) {
      db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
    }
  }
};
