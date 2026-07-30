import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../../database/migration-runner/index.mjs';

import * as legacySales from '../../../platform/sales/lifecycle.mjs';
import * as legacyCrm from '../../../platform/sales/crm.mjs';
import * as oppService from '../../../platform/domains/crm/opportunity-service.mjs';
import * as leadService from '../../../platform/domains/crm/lead-service.mjs';
import * as activityService from '../../../platform/domains/crm/activity-service.mjs';
import * as conversionService from '../../../platform/domains/crm/conversion-service.mjs';

function tmpDb(name) {
  return path.join(os.tmpdir(), `octagon-crm-swa-${name}-${Date.now()}-${process.pid}.db`);
}

async function setupDb(name) {
  const p = tmpDb(name);
  await freshInstall({ dbPath: p });
  const db = openMigrationDatabase(p);
  return { db, path: p };
}

function cleanupDb(env) {
  try { env.db.close(); } catch {}
  for (const s of ['', '-wal', '-shm']) {
    try { if (fs.existsSync(env.path + s)) fs.unlinkSync(env.path + s); } catch {}
  }
}

test('1. Repository Scan: Only platform/domains/crm/* contains direct CRM mutation SQL', () => {
  const platformDir = path.resolve('platform');
  const crmDomainDir = path.resolve('platform/domains/crm');

  function getAllJsFiles(dir) {
    let files = [];
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        files = files.concat(getAllJsFiles(fullPath));
      } else if (item.name.endsWith('.mjs') || item.name.endsWith('.js')) {
        files.push(fullPath);
      }
    }
    return files;
  }

  const allFiles = getAllJsFiles(platformDir);
  const nonCrmFiles = allFiles.filter(f => !path.resolve(f).startsWith(crmDomainDir));

  const forbiddenPatterns = [
    /INSERT\s+INTO\s+crm_opportunities\b/i,
    /UPDATE\s+crm_opportunities\s+SET\b/i,
    /DELETE\s+FROM\s+crm_opportunities\b/i,
    /INSERT\s+INTO\s+crm_leads\b/i,
    /UPDATE\s+crm_leads\s+SET\b/i,
    /DELETE\s+FROM\s+crm_leads\b/i,
  ];

  const violations = [];
  for (const file of nonCrmFiles) {
    const content = fs.readFileSync(file, 'utf8');
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(content)) {
        violations.push({ file: path.relative(process.cwd(), file), pattern: pattern.toString() });
      }
    }
  }

  assert.equal(
    violations.length,
    0,
    `Found competing CRM mutation SQL outside platform/domains/crm/*:\n${JSON.stringify(violations, null, 2)}`
  );
});

test('2. Legacy crm:lead:create delegates to Wave 1 lead-service', async () => {
  const env = await setupDb('lead_create');
  try {
    const created = legacyCrm.createLead(env.db, {
      company_id: 'cmp_test',
      actor: 'usr_actor',
      name: 'Legacy Lead Test',
      contact_name: 'Contact Lead',
      email: 'legacy@example.com',
      phone: '+9647700000000',
      expected_revenue: 500000,
      probability: 20,
      salesperson_id: 'usr_sales',
    });

    assert.ok(created);
    assert.ok(created.id);
    assert.ok(created.reference.startsWith('LEAD-'));

    const audit = env.db.prepare("SELECT * FROM platform_audit_log WHERE resource = 'crm_lead' AND resource_id = ?").get(created.id);
    assert.ok(audit);
    assert.equal(audit.action, 'crm.lead.create');
  } finally {
    cleanupDb(env);
  }
});

test('3. Legacy convertLead delegates to Wave 1 conversion-service', async () => {
  const env = await setupDb('convert');
  try {
    const partyId = 'pty_test_conv';
    env.db.prepare(`
      INSERT INTO parties (id, company_id, is_company, name, status, created_at, updated_at)
      VALUES (?, 'cmp_test', 0, 'Party Conv Test', 'active', ?, ?)
    `).run(partyId, new Date().toISOString(), new Date().toISOString());

    const { lead } = leadService.createLead(env.db, {
      company_id: 'cmp_test',
      actor: 'usr_actor',
      name: 'Convert Lead Test',
      contact_name: 'Contact Conv',
      email: 'conv@example.com',
    });

    leadService.qualifyLead(env.db, { lead_id: lead.id, company_id: 'cmp_test', actor: 'usr_actor' });

    const res = legacySales.convertLead(env.db, {
      id: lead.id,
      partner_id: partyId,
      name: 'Opp from Legacy Convert',
      expected_value: 750000,
      company_id: 'cmp_test',
      actor: 'usr_actor',
    });

    assert.ok(res.opportunity);
    assert.ok(res.opportunity.id.startsWith('opp_'));
    assert.equal(res.lead.stage, 'converted');

    const link = env.db.prepare('SELECT * FROM crm_conversion_links WHERE lead_id = ?').get(lead.id);
    assert.ok(link);
    assert.equal(link.opportunity_id, res.opportunity.id);
  } finally {
    cleanupDb(env);
  }
});

test('4. Legacy updateOpportunityStage delegates to Wave 1 opportunity-service changeStage', async () => {
  const env = await setupDb('stage');
  try {
    const partyId = 'pty_test_stage';
    env.db.prepare(`
      INSERT INTO parties (id, company_id, is_company, name, status, created_at, updated_at)
      VALUES (?, 'cmp_test', 0, 'Party Stage Test', 'active', ?, ?)
    `).run(partyId, new Date().toISOString(), new Date().toISOString());

    const { lead } = leadService.createLead(env.db, {
      company_id: 'cmp_test', actor: 'usr_actor', name: 'Stage Lead Test',
    });
    leadService.qualifyLead(env.db, { lead_id: lead.id, company_id: 'cmp_test', actor: 'usr_actor' });

    const { opportunity } = oppService.createOpportunity(env.db, {
      company_id: 'cmp_test', actor: 'usr_actor', party_id: partyId, name: 'Stage Opp',
    });

    const updated = legacySales.updateOpportunityStage(env.db, {
      id: opportunity.id,
      stage: 'qualified',
      company_id: 'cmp_test',
      actor: 'usr_actor',
    });

    assert.equal(updated.stage, 'QUALIFY');

    const history = env.db.prepare('SELECT * FROM crm_stage_history WHERE opportunity_id = ?').all(opportunity.id);
    assert.ok(history.length >= 2);
  } finally {
    cleanupDb(env);
  }
});

test('5. Legacy closeOpportunity (Won/Lost) delegates and enforces evidence/reasons', async () => {
  const env = await setupDb('close');
  try {
    const partyId = 'pty_test_close';
    env.db.prepare(`
      INSERT INTO parties (id, company_id, is_company, name, status, created_at, updated_at)
      VALUES (?, 'cmp_test', 0, 'Party Close Test', 'active', ?, ?)
    `).run(partyId, new Date().toISOString(), new Date().toISOString());

    const { opportunity } = oppService.createOpportunity(env.db, {
      company_id: 'cmp_test', actor: 'usr_actor', party_id: partyId, name: 'Close Opp',
    });

    const wonRes = legacySales.closeOpportunity(env.db, {
      id: opportunity.id,
      outcome: 'won',
      company_id: 'cmp_test',
      actor: 'usr_actor',
    });

    assert.equal(wonRes.opportunity.status, 'won');
    assert.equal(wonRes.opportunity.probability, 100);

    assert.throws(
      () => legacySales.closeOpportunity(env.db, { id: opportunity.id, outcome: 'lost', lost_reason: 'Price', company_id: 'cmp_test', actor: 'usr_actor' }),
      (err) => err.code === 'OPPORTUNITY_CLOSED' || err.message?.includes('closed')
    );
  } finally {
    cleanupDb(env);
  }
});

test('6. Idempotency & No Duplicate Records when using Wave 1 and legacy callers', async () => {
  const env = await setupDb('idem');
  try {
    const partyId = 'pty_test_idem';
    env.db.prepare(`
      INSERT INTO parties (id, company_id, is_company, name, status, created_at, updated_at)
      VALUES (?, 'cmp_test', 0, 'Party Idem Test', 'active', ?, ?)
    `).run(partyId, new Date().toISOString(), new Date().toISOString());

    const { lead } = leadService.createLead(env.db, {
      company_id: 'cmp_test', actor: 'usr_actor', name: 'Idem Lead Test',
    });
    leadService.qualifyLead(env.db, { lead_id: lead.id, company_id: 'cmp_test', actor: 'usr_actor' });

    const key = 'idem_key_123';
    const res1 = conversionService.convertLead(env.db, {
      lead_id: lead.id, party_id: partyId, company_id: 'cmp_test', actor: 'usr_actor', idempotency_key: key,
    });

    const res2 = conversionService.convertLead(env.db, {
      lead_id: lead.id, party_id: partyId, company_id: 'cmp_test', actor: 'usr_actor', idempotency_key: key,
    });

    assert.equal(res2.replayed, true);
    assert.equal(res1.opportunityId, res2.opportunityId);

    const links = env.db.prepare('SELECT COUNT(*) as n FROM crm_conversion_links WHERE lead_id = ?').get(lead.id).n;
    assert.equal(links, 1);
  } finally {
    cleanupDb(env);
  }
});
