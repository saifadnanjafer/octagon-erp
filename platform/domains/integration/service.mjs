// platform/domains/integration/service.mjs — Integration Hub & API Management Domain Service.

import crypto from 'node:crypto';

function uid(prefix = 'hub') {
  return `${prefix}-${crypto.randomBytes(8).toString('hex')}`;
}

export function registerEndpoint(db, {
  company_id,
  path,
  http_method = 'GET',
  domain_module,
  rate_limit_per_min = 60,
  auth_required = 1
}) {
  if (!company_id || !path || !domain_module) {
    throw new Error('company_id, path, and domain_module are required');
  }

  const id = uid('ep');
  const count = db.prepare('SELECT COUNT(*) as c FROM api_endpoints WHERE company_id = ?').get(company_id).c + 1;
  const endpoint_number = `API-2026-${String(count).padStart(4, '0')}`;

  db.prepare(`
    INSERT INTO api_endpoints (id, company_id, endpoint_number, path, http_method, domain_module, rate_limit_per_min, auth_required)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, company_id, endpoint_number, path, http_method, domain_module, rate_limit_per_min, auth_required ? 1 : 0);

  return db.prepare('SELECT * FROM api_endpoints WHERE id = ?').get(id);
}

export function createAPIKey(db, {
  company_id,
  client_name,
  scopes = [],
  rate_limit_quota = 1000,
  expires_at = null
}) {
  if (!company_id || !client_name) {
    throw new Error('company_id and client_name are required');
  }

  const rawKey = `oct_${crypto.randomBytes(24).toString('hex')}`;
  const key_prefix = rawKey.substring(0, 8);
  const key_hash = crypto.createHash('sha256').update(rawKey).digest('hex');

  const id = uid('key');
  const count = db.prepare('SELECT COUNT(*) as c FROM api_keys WHERE company_id = ?').get(company_id).c + 1;
  const key_number = `KEY-2026-${String(count).padStart(4, '0')}`;
  const scopes_json = typeof scopes === 'string' ? scopes : JSON.stringify(scopes);

  db.prepare(`
    INSERT INTO api_keys (id, company_id, key_number, client_name, key_prefix, key_hash, scopes, rate_limit_quota, status, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
  `).run(id, company_id, key_number, client_name, key_prefix, key_hash, scopes_json, rate_limit_quota, expires_at);

  const record = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id);
  return { ...record, raw_key: rawKey };
}

export function subscribeWebhook(db, {
  company_id,
  event_type,
  target_url,
  secret = null
}) {
  if (!company_id || !event_type || !target_url) {
    throw new Error('company_id, event_type, and target_url are required');
  }

  const sec = secret || crypto.randomBytes(16).toString('hex');
  const secret_hash = crypto.createHash('sha256').update(sec).digest('hex');

  const id = uid('whk');
  const count = db.prepare('SELECT COUNT(*) as c FROM webhook_subscriptions WHERE company_id = ?').get(company_id).c + 1;
  const webhook_number = `WHK-2026-${String(count).padStart(4, '0')}`;

  const columns = db.prepare('PRAGMA table_info(webhook_subscriptions)').all().map(c => c.name);

  const insertCols = ['id', 'company_id', 'webhook_number', 'event_type', 'target_url', 'secret_hash', 'is_active'];
  const insertVals = [id, company_id, webhook_number, event_type, target_url, secret_hash, 1];

  // If legacy columns exist from migration 010
  if (columns.includes('module_id')) { insertCols.push('module_id'); insertVals.push('integration'); }
  if (columns.includes('url')) { insertCols.push('url'); insertVals.push(target_url); }
  if (columns.includes('active')) { insertCols.push('active'); insertVals.push(1); }
  if (columns.includes('created_at')) { insertCols.push('created_at'); insertVals.push(new Date().toISOString()); }

  const placeholders = insertVals.map(() => '?').join(', ');
  db.prepare(`
    INSERT INTO webhook_subscriptions (${insertCols.join(', ')})
    VALUES (${placeholders})
  `).run(...insertVals);

  return db.prepare('SELECT * FROM webhook_subscriptions WHERE id = ?').get(id);
}

export function recordWebhookDelivery(db, {
  company_id,
  webhook_id,
  event_type,
  payload,
  response_status_code = 200,
  execution_time_ms = 120
}) {
  if (!company_id || !webhook_id || !event_type || !payload) {
    throw new Error('company_id, webhook_id, event_type, and payload are required');
  }

  const id = uid('dlv');
  const count = db.prepare('SELECT COUNT(*) as c FROM webhook_deliveries WHERE company_id = ?').get(company_id).c + 1;
  const delivery_number = `DLV-2026-${String(count).padStart(4, '0')}`;
  const payload_json = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const status = (response_status_code >= 200 && response_status_code < 300) ? 'sent' : 'failed';

  const columns = db.prepare('PRAGMA table_info(webhook_deliveries)').all().map(c => c.name);

  const insertCols = ['id', 'company_id', 'webhook_id', 'delivery_number', 'event_type', 'payload_json', 'response_status_code', 'execution_time_ms', 'status'];
  const insertVals = [id, company_id, webhook_id, delivery_number, event_type, payload_json, response_status_code, execution_time_ms, status];

  // If legacy columns exist from migration 010
  if (columns.includes('subscription_id')) { insertCols.push('subscription_id'); insertVals.push(webhook_id); }
  if (columns.includes('event_id')) { insertCols.push('event_id'); insertVals.push(id); }
  if (columns.includes('payload')) { insertCols.push('payload'); insertVals.push(payload_json); }
  if (columns.includes('signature')) { insertCols.push('signature'); insertVals.push('sha256-sig'); }
  if (columns.includes('timestamp')) { insertCols.push('timestamp'); insertVals.push(new Date().toISOString()); }
  if (columns.includes('nonce')) { insertCols.push('nonce'); insertVals.push(crypto.randomBytes(8).toString('hex')); }
  if (columns.includes('created_at')) { insertCols.push('created_at'); insertVals.push(new Date().toISOString()); }

  const placeholders = insertVals.map(() => '?').join(', ');
  db.prepare(`
    INSERT INTO webhook_deliveries (${insertCols.join(', ')})
    VALUES (${placeholders})
  `).run(...insertVals);

  return db.prepare('SELECT * FROM webhook_deliveries WHERE id = ?').get(id);
}

export function registerConnector(db, {
  company_id,
  name,
  connector_type,
  config_json = null
}) {
  if (!company_id || !name || !connector_type) {
    throw new Error('company_id, name, and connector_type are required');
  }

  const id = uid('conn');
  const count = db.prepare('SELECT COUNT(*) as c FROM integration_connectors WHERE company_id = ?').get(company_id).c + 1;
  const connector_number = `CONN-2026-${String(count).padStart(4, '0')}`;

  db.prepare(`
    INSERT INTO integration_connectors (id, company_id, connector_number, name, connector_type, config_json, status)
    VALUES (?, ?, ?, ?, ?, ?, 'active')
  `).run(id, company_id, connector_number, name, connector_type, config_json);

  return db.prepare('SELECT * FROM integration_connectors WHERE id = ?').get(id);
}
