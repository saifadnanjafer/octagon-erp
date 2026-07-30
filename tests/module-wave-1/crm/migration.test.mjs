// CRM M2 — migration suite.
//
// The central assertion is NON-DUPLICATION: migration 065 must extend the CRM
// created by 039 and 046, not build a parallel one. A previous draft used
// CREATE TABLE IF NOT EXISTS and silently no-op'd; these tests exist so that
// cannot recur unnoticed.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { freshInstall, runMigrations, migrationStatus } from '../../../database/migration-runner/index.mjs';
import { CRM_ADDED_COLUMNS } from '../../../database/migrations/065_crm_pipeline_leads_opportunities_and_activities.mjs';

const MIG = '065_crm_pipeline_leads_opportunities_and_activities';

function tmp(n) {
  return path.join(os.tmpdir(), `octagon-crmmig-${n}-${Date.now()}-${process.pid}.db`);
}
function open(p) { return new DatabaseSync(p, { readOnly: true }); }
function drop(p) { for (const s of ['', '-wal', '-shm']) { try { if (fs.existsSync(p + s)) fs.unlinkSync(p + s); } catch {} } }
function cols(db, t) { return db.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name); }

async function testAppliesAsTip() {
  const p = tmp('tip');
  await freshInstall({ dbPath: p });
  const applied = (await migrationStatus({ dbPath: p })).filter((s) => s.status === 'applied').map((s) => s.id);
  assert.ok(applied.includes(MIG));
  assert.strictEqual(applied.at(-1), MIG, 'CRM migration must be the tip');
  drop(p);
  console.log(`PASS: appliesAsTip (${applied.length} migrations)`);
}

async function testExtendsExistingTablesRatherThanDuplicating() {
  const p = tmp('extend');
  await freshInstall({ dbPath: p });
  const db = open(p);

  // Exactly one lead table and one opportunity table exist — no parallel CRM.
  const crmTables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'crm%' ORDER BY name"
  ).all().map((r) => r.name);
  // Semantic check rather than a name match: crm_lead_sources and crm_lead_tags
  // legitimately contain "lead". A lead STORE is a table carrying both a contact
  // and a stage. There must be exactly one.
  const leadStores = crmTables.filter((n) => {
    const c = cols(db, n);
    return c.includes('contact_name') && c.includes('stage');
  });
  assert.deepStrictEqual(leadStores, ['crm_leads'],
    `expected exactly one lead store, found: ${leadStores.join(', ')}`);

  const oppStores = crmTables.filter((n) => {
    const c = cols(db, n);
    return c.includes('party_id') && c.includes('expected_value');
  });
  assert.deepStrictEqual(oppStores, ['crm_opportunities'],
    `expected exactly one opportunity store, found: ${oppStores.join(', ')}`);

  // The ORIGINAL columns from 039/046 survive — nothing reading them breaks.
  const lead = cols(db, 'crm_leads');
  for (const original of ['name', 'partner_id', 'contact_name', 'stage', 'expected_revenue', 'probability', 'salesperson_id']) {
    assert.ok(lead.includes(original), `039 column "${original}" must survive`);
  }
  const opp = cols(db, 'crm_opportunities');
  for (const original of ['name', 'stage', 'expected_value', 'status', 'lost_reason', 'version', 'owner_user_id']) {
    assert.ok(opp.includes(original), `046 column "${original}" must survive`);
  }

  // Every declared new column was actually added.
  for (const [table, added] of Object.entries(CRM_ADDED_COLUMNS)) {
    const have = cols(db, table);
    for (const c of added) assert.ok(have.includes(c), `${table}.${c} must be added`);
  }

  db.close();
  drop(p);
  console.log(`PASS: extendsExistingTablesRatherThanDuplicating (${crmTables.length} crm tables)`);
}

async function testNewConfigurationTablesExist() {
  const p = tmp('config');
  await freshInstall({ dbPath: p });
  const db = open(p);
  const required = [
    'crm_pipelines', 'crm_pipeline_stages', 'crm_sales_teams', 'crm_team_members',
    'crm_lead_sources', 'crm_campaigns', 'crm_customer_segments', 'crm_competitors',
    'crm_lost_reasons', 'crm_tags', 'crm_lead_tags', 'crm_opportunity_tags',
    'crm_opportunity_competitors', 'crm_interactions', 'crm_stage_history',
    'crm_conversion_links', 'crm_scoring_rules', 'crm_score_history',
  ];
  const have = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
  for (const t of required) assert.ok(have.has(t), `missing table ${t}`);
  db.close();
  drop(p);
  console.log(`PASS: newConfigurationTablesExist (${required.length} tables)`);
}

async function testSeedData() {
  const p = tmp('seed');
  await freshInstall({ dbPath: p });
  const db = open(p);

  const pipe = db.prepare("SELECT * FROM crm_pipelines WHERE id='crm_pipe_default'").get();
  assert.ok(pipe, 'a default pipeline must exist — a CRM without one cannot accept a conversion');
  assert.strictEqual(pipe.is_default, 1);

  const stages = db.prepare("SELECT * FROM crm_pipeline_stages WHERE pipeline_id='crm_pipe_default' ORDER BY sequence").all();
  assert.strictEqual(stages.length, 6);
  assert.strictEqual(stages[0].code, 'NEW');
  assert.strictEqual(stages.find((s) => s.is_won === 1).code, 'WON');
  assert.strictEqual(stages.find((s) => s.is_lost === 1).code, 'LOST');
  // Probability must climb with sequence, or weighted forecast is meaningless.
  for (let i = 1; i < 5; i++) {
    assert.ok(stages[i].probability >= stages[i - 1].probability, 'probability must not regress across stages');
  }

  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM crm_lead_sources').get().n, 6);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM crm_lost_reasons').get().n, 6);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM crm_scoring_rules').get().n, 8);

  // Bilingual labels everywhere a user will see them.
  for (const t of ['crm_pipeline_stages', 'crm_lead_sources', 'crm_lost_reasons', 'crm_scoring_rules']) {
    for (const r of db.prepare(`SELECT name_ar, name_en FROM ${t}`).all()) {
      assert.ok(/[؀-ۿ]/.test(r.name_ar), `${t} needs a real Arabic label`);
      assert.ok(r.name_en && r.name_en.length > 1, `${t} needs an English label`);
    }
  }

  db.close();
  drop(p);
  console.log('PASS: seedData (1 pipeline, 6 stages, 6 sources, 6 lost reasons, 8 scoring rules)');
}

async function testModuleLifecycleFlips() {
  const p = tmp('lifecycle');
  await freshInstall({ dbPath: p });
  let db = open(p);
  assert.strictEqual(db.prepare("SELECT lifecycle FROM module_expansion_registry WHERE module_id='crm'").get().lifecycle, 'available');
  assert.strictEqual(db.prepare("SELECT schema_migration FROM module_expansion_registry WHERE module_id='crm'").get().schema_migration, MIG);
  assert.strictEqual(db.prepare("SELECT status FROM platform_modules WHERE id='crm'").get().status, 'installed');
  // 065 registers 6 entities. It must NOT claim `crm_lead`, which migration 039
  // already registered under platform.kernel — hijacking a pre-existing row is
  // what caused the deep-rollback foreign-key regression.
  const owned = db.prepare(
    "SELECT id FROM platform_entities WHERE module_id='crm' AND migration_owner=?"
  ).all(MIG).map((r) => r.id).sort();
  assert.deepStrictEqual(owned, [
    'crm_activity', 'crm_campaign', 'crm_opportunity',
    'crm_pipeline', 'crm_pipeline_stage', 'crm_sales_team',
  ], '065 must own exactly its own six entities');

  const lead = db.prepare("SELECT migration_owner FROM platform_entities WHERE id='crm_lead'").get();
  assert.ok(lead, 'crm_lead entity must still exist');
  assert.notStrictEqual(lead.migration_owner, MIG, 'crm_lead predates 065 and must not be reassigned to it');
  db.close();
  drop(p);
  console.log('PASS: moduleLifecycleFlips');
}

async function testRerunIsIdempotent() {
  const p = tmp('rerun');
  await freshInstall({ dbPath: p });
  let db = open(p);
  const before = {
    pipelines: db.prepare('SELECT COUNT(*) n FROM crm_pipelines').get().n,
    stages: db.prepare('SELECT COUNT(*) n FROM crm_pipeline_stages').get().n,
    rules: db.prepare('SELECT COUNT(*) n FROM crm_scoring_rules').get().n,
    leadCols: cols(db, 'crm_leads').length,
  };
  db.close();

  const again = await runMigrations({ dbPath: p, direction: 'up' });
  assert.deepStrictEqual(again.migrations, [], 'rerun applies nothing');

  db = open(p);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM crm_pipelines').get().n, before.pipelines, 'no duplicate seed');
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM crm_pipeline_stages').get().n, before.stages);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM crm_scoring_rules').get().n, before.rules);
  assert.strictEqual(cols(db, 'crm_leads').length, before.leadCols, 'no duplicate columns');
  db.close();
  drop(p);
  console.log('PASS: rerunIsIdempotent');
}

async function testRollbackAndReapply() {
  const p = tmp('rollback');
  await freshInstall({ dbPath: p });
  await runMigrations({ dbPath: p, direction: 'down', steps: 1 });

  let db = open(p);
  const after = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
  // New tables gone...
  for (const t of ['crm_pipelines', 'crm_pipeline_stages', 'crm_stage_history', 'crm_conversion_links', 'crm_scoring_rules']) {
    assert.ok(!after.has(t), `${t} must be dropped on rollback`);
  }
  // ...but the pre-existing tables from 039/046 survive. Dropping them would
  // destroy data that predates this migration.
  for (const t of ['crm_leads', 'crm_opportunities', 'crm_activities']) {
    assert.ok(after.has(t), `${t} predates this migration and must survive rollback`);
  }
  assert.strictEqual(db.prepare("SELECT lifecycle FROM module_expansion_registry WHERE module_id='crm'").get().lifecycle, 'planned');
  db.close();

  const up = await runMigrations({ dbPath: p, direction: 'up' });
  assert.deepStrictEqual(up.migrations, [MIG], 're-apply restores CRM');

  db = open(p);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM crm_pipeline_stages').get().n, 6, 'seed restored exactly once');
  assert.strictEqual(db.prepare("SELECT lifecycle FROM module_expansion_registry WHERE module_id='crm'").get().lifecycle, 'available');
  db.close();
  drop(p);
  console.log('PASS: rollbackAndReapply');
}

async function testExistingDataSurvivesTheUpgrade() {
  // The realistic case: a database that already carries 039/046 CRM rows.
  const p = tmp('upgrade');
  await runMigrations({ dbPath: p, direction: 'up', target: '064_module_expansion_wave1_registry' })
    .catch(async () => { await freshInstall({ dbPath: p }); });

  // Build the "already has data" state at tip 064.
  const p2 = tmp('upgrade2');
  await freshInstall({ dbPath: p2 });
  await runMigrations({ dbPath: p2, direction: 'down', steps: 1 });

  let w = new DatabaseSync(p2);
  const now = new Date().toISOString();
  w.prepare(`INSERT INTO crm_leads (id,company_id,name,contact_name,email,phone,stage,expected_revenue,probability,created_at,updated_at)
             VALUES ('legacy_lead_1','co_x','عميل قديم','سالم','s@x.iq','0770','new',500000,10,?,?)`).run(now, now);
  w.close();

  await runMigrations({ dbPath: p2, direction: 'up' });

  const db = open(p2);
  const lead = db.prepare("SELECT * FROM crm_leads WHERE id='legacy_lead_1'").get();
  assert.ok(lead, 'pre-existing lead must survive the upgrade');
  assert.strictEqual(lead.name, 'عميل قديم', 'original data intact');
  assert.strictEqual(lead.expected_revenue, 500000);
  // New columns arrive with their defaults rather than nulling the row.
  assert.strictEqual(lead.score, 0);
  assert.strictEqual(lead.archived, 0);
  assert.strictEqual(lead.duplicate_state, 'unchecked');
  assert.strictEqual(lead.currency, 'IQD');
  db.close();
  drop(p); drop(p2);
  console.log('PASS: existingDataSurvivesTheUpgrade');
}

async function main() {
  await testAppliesAsTip();
  await testExtendsExistingTablesRatherThanDuplicating();
  await testNewConfigurationTablesExist();
  await testSeedData();
  await testModuleLifecycleFlips();
  await testRerunIsIdempotent();
  await testRollbackAndReapply();
  await testExistingDataSurvivesTheUpgrade();
  console.log('\nAll CRM migration tests passed.');
}

main().catch((e) => { console.error('FAIL:', e); process.exitCode = 1; });
