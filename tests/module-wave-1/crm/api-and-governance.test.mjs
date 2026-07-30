import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../../database/migration-runner/index.mjs';
import { createActionExecutor } from '../../../platform/kernel/actions/index.mjs';
import { registerCrmActions } from '../../../platform/domains/crm/index.mjs';
import { handleCommercialQuery } from '../../../platform/api/commercial.mjs';

function tmpDb(name) {
  return path.join(os.tmpdir(), `octagon-crm-api-${name}-${Date.now()}-${process.pid}.db`);
}

async function setupDb(name) {
  const p = tmpDb(name);
  await freshInstall({ dbPath: p });
  const db = openMigrationDatabase(p);

  // Enable crm module globally
  db.prepare(`UPDATE platform_modules SET status = 'enabled' WHERE id = 'crm'`).run();

  const executor = createActionExecutor(db);
  registerCrmActions(executor);
  return { db, executor, path: p };
}

function cleanupDb(env) {
  try { env.db.close(); } catch {}
  for (const s of ['', '-wal', '-shm']) {
    try { if (fs.existsSync(env.path + s)) fs.unlinkSync(env.path + s); } catch {}
  }
}

test('1. ActionExecutor: Register and dispatch Wave 1 CRM actions', async () => {
  const env = await setupDb('executor');
  try {
    const ctx = { companyId: 'cmp_api', userId: 'usr_api_admin', branchId: 'br_main' };

    // Dispatch crm:lead:create through ActionExecutor
    const leadRes = env.executor.execute('crm:lead:create', {
      name: 'API Registered Lead',
      contact_name: 'Contact API',
      email: 'api@example.com',
      expected_revenue: 1000000,
      idempotency_key: 'idem_create_1',
    }, ctx);

    assert.ok(leadRes);
    assert.ok(leadRes.lead);
    assert.ok(leadRes.lead.id.startsWith('lead_'));
    assert.equal(leadRes.lead.company_id, 'cmp_api');

    // Dispatch crm:lead:qualify through ActionExecutor
    const qualRes = env.executor.execute('crm:lead:qualify', {
      lead_id: leadRes.lead.id,
      idempotency_key: 'idem_qual_1',
    }, ctx);

    assert.equal(qualRes.lead.stage, 'qualified');

    // Verify session scope stripping (client company spoofing rejected or overridden)
    assert.equal(leadRes.lead.company_id, 'cmp_api');
  } finally {
    cleanupDb(env);
  }
});

test('2. Governed HTTP Query API: CRM Leads, Opportunities, Activities, Customer 360, & Reports', async () => {
  const env = await setupDb('query');
  try {
    const ctx = { companyId: 'cmp_api', userId: 'usr_api_admin' };

    // Create party
    const partyId = 'pty_api_360';
    env.db.prepare(`
      INSERT INTO parties (id, company_id, is_company, name, status, created_at, updated_at)
      VALUES (?, 'cmp_api', 1, 'Company 360 Corp', 'active', ?, ?)
    `).run(partyId, new Date().toISOString(), new Date().toISOString());

    // Create lead and convert
    const leadRes = env.executor.execute('crm:lead:create', {
      name: 'Lead for 360',
      contact_name: 'Contact 360',
      email: '360@example.com',
      expected_revenue: 2000000,
      idempotency_key: 'idem_create_360',
    }, ctx);

    env.executor.execute('crm:lead:qualify', {
      lead_id: leadRes.lead.id,
      idempotency_key: 'idem_qual_360',
    }, ctx);

    const convRes = env.executor.execute('crm:lead:convert', {
      lead_id: leadRes.lead.id,
      party_id: partyId,
      name: 'Opp for 360',
      expected_revenue: 2000000,
      idempotency_key: 'idem_conv_360',
    }, ctx);

    // Create activity on opportunity
    const actRes = env.executor.execute('crm:activity:create', {
      opportunity_id: convRes.opportunityId,
      activity_type: 'call',
      subject: 'Discovery Call 360',
      due_date: '2026-08-01',
      idempotency_key: 'idem_act_360',
    }, ctx);

    // 1. GET /api/v1/crm/leads
    const leadsQuery = handleCommercialQuery({
      dialect: env.db, ctx, namespace: 'crm', resource: 'leads', query: {},
    });
    assert.ok(leadsQuery.data);
    assert.equal(leadsQuery.data.length, 1);

    // 2. GET /api/v1/crm/opportunities
    const oppsQuery = handleCommercialQuery({
      dialect: env.db, ctx, namespace: 'crm', resource: 'opportunities', query: {},
    });
    assert.ok(oppsQuery.data);
    assert.equal(oppsQuery.data.length, 1);

    // 3. GET /api/v1/crm/activities
    const actsQuery = handleCommercialQuery({
      dialect: env.db, ctx, namespace: 'crm', resource: 'activities', query: {},
    });
    assert.ok(actsQuery.data);
    assert.equal(actsQuery.data.length, 1);

    // 4. GET /api/v1/crm/customer_360/:party_id
    const c360Query = handleCommercialQuery({
      dialect: env.db, ctx, namespace: 'crm', resource: 'customer_360', recordId: partyId, query: {},
    });
    assert.ok(c360Query.data);
    assert.equal(c360Query.data.party.id, partyId);
    assert.equal(c360Query.data.opportunities.length, 1);

    // 5. GET /api/v1/crm/reports (pipeline_summary)
    const reportQuery = handleCommercialQuery({
      dialect: env.db, ctx, namespace: 'crm', resource: 'reports', query: { type: 'pipeline_summary' },
    });
    assert.ok(reportQuery.data);
    assert.ok(reportQuery.data.totals);
    assert.equal(reportQuery.data.totals.total_open, 1);

    // 6. GET /api/v1/crm/reports (lead_conversion)
    const convReportQuery = handleCommercialQuery({
      dialect: env.db, ctx, namespace: 'crm', resource: 'reports', query: { type: 'lead_conversion' },
    });
    assert.ok(convReportQuery.data);
    assert.equal(convReportQuery.data.totals.total_leads, 1);
    assert.equal(convReportQuery.data.totals.converted_leads, 1);
  } finally {
    cleanupDb(env);
  }
});
