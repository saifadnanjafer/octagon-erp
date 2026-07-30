// tests/module-wave-2/integration/integration.test.mjs — Integration tests for W2-M14 Integration Hub & API Management.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../../database/migration-runner/index.mjs';
import { migration as m080 } from '../../../database/migrations/080_integration_hub_and_api_management.mjs';
import * as integrationService from '../../../platform/domains/integration/service.mjs';

function tmp(n) { return path.join(os.tmpdir(), `octagon-hub-${n}-${Date.now()}-${process.pid}.db`); }

async function setup(name) {
  const p = tmp(name);
  await freshInstall({ dbPath: p });
  const db = openMigrationDatabase(p);
  return { db, path: p };
}

function cleanup(env) {
  env.db.close();
  for (const s of ['', '-wal', '-shm']) {
    try { if (fs.existsSync(env.path + s)) fs.unlinkSync(env.path + s); } catch {}
  }
}

test('1. Migration 080: Up, rerun, and schema verification', async () => {
  const env = await setup('m080-schema');
  try {
    await m080.up(env.db);

    const tables = env.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name IN ('api_endpoints', 'api_keys', 'webhook_subscriptions', 'webhook_deliveries', 'integration_connectors')
    `).all().map(r => r.name);

    assert.equal(tables.length, 5);

    // Rerun check
    await m080.up(env.db);
  } finally {
    cleanup(env);
  }
});

test('2. API Endpoint Registration & API Key Provisioning', async () => {
  const env = await setup('api-key-test');
  try {
    await m080.up(env.db);

    const ep = integrationService.registerEndpoint(env.db, {
      company_id: 'company-alpha',
      path: '/api/v1/sales/orders',
      http_method: 'GET',
      domain_module: 'sales',
      rate_limit_per_min: 120
    });
    assert.equal(ep.path, '/api/v1/sales/orders');
    assert.ok(ep.endpoint_number.startsWith('API-2026-'));

    const key = integrationService.createAPIKey(env.db, {
      company_id: 'company-alpha',
      client_name: 'External ERP Sync Partner',
      scopes: ['sales:read', 'inventory:read'],
      rate_limit_quota: 5000
    });
    assert.equal(key.client_name, 'External ERP Sync Partner');
    assert.ok(key.raw_key.startsWith('oct_'));
    assert.ok(key.key_number.startsWith('KEY-2026-'));
  } finally {
    cleanup(env);
  }
});

test('3. Webhook Subscription & Delivery Logging', async () => {
  const env = await setup('whk-test');
  try {
    await m080.up(env.db);

    const whk = integrationService.subscribeWebhook(env.db, {
      company_id: 'company-alpha',
      event_type: 'sales.order.created',
      target_url: 'https://partner.external-sys.com/webhooks/sales'
    });
    assert.equal(whk.event_type, 'sales.order.created');
    assert.ok(whk.webhook_number.startsWith('WHK-2026-'));

    const dlv = integrationService.recordWebhookDelivery(env.db, {
      company_id: 'company-alpha',
      webhook_id: whk.id,
      event_type: 'sales.order.created',
      payload: { order_id: 'SO-2026-0001', amount: 15400.00 },
      response_status_code: 200,
      execution_time_ms: 85
    });
    assert.equal(dlv.status, 'sent');
    assert.ok(dlv.delivery_number.startsWith('DLV-2026-'));
  } finally {
    cleanup(env);
  }
});

test('4. External System Integration Connector Registration', async () => {
  const env = await setup('conn-test');
  try {
    await m080.up(env.db);

    const conn = integrationService.registerConnector(env.db, {
      company_id: 'company-alpha',
      name: 'Legacy Odoo 16 Sync Bridge',
      connector_type: 'odoo',
      config_json: JSON.stringify({ host: 'https://odoo-legacy.internal', db: 'corp_db' })
    });
    assert.equal(conn.connector_type, 'odoo');
    assert.ok(conn.connector_number.startsWith('CONN-2026-'));
  } finally {
    cleanup(env);
  }
});
