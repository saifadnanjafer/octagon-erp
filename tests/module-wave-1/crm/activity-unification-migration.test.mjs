// 066_crm_activity_subject_unification — migration suite.
//
// Central assertions: no lost Activity, no duplicated Activity, direct-Opportunity
// Activities work post-migration, crm_opportunity_activities is retired as a
// writable table (only a read-only compatibility view survives), and the
// rollback policy is honest — it restores pre-migration shape when possible and
// refuses outright rather than silently dropping rows it cannot split back.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { freshInstall, runMigrations, openMigrationDatabase } from '../../../database/migration-runner/index.mjs';
import { IrreversibleActivityDataError } from '../../../database/migrations/066_crm_activity_subject_unification.mjs';

const MIG = '066_crm_activity_subject_unification';
const MIG_065 = '065_crm_pipeline_leads_opportunities_and_activities';
const CO = 'co_test';

function tmp(n) { return path.join(os.tmpdir(), `octagon-actunify-${n}-${Date.now()}-${process.pid}.db`); }
function open(p) { return new DatabaseSync(p, { readOnly: true }); }
function drop(p) { for (const s of ['', '-wal', '-shm']) { try { if (fs.existsSync(p + s)) fs.unlinkSync(p + s); } catch {} } }

/** A fresh-installed db already carries seed rows only; build a realistic
 * pre-066 fixture by rolling back to the 065 tip, then inserting rows exactly
 * as the pre-066 world would have: crm_activities (lead_id mandatory) and a
 * real, writable crm_opportunity_activities table. */
async function buildPre066Fixture(name) {
  const p = tmp(name);
  await freshInstall({ dbPath: p });
  // Land at the 065 tip.
  //
  // This was `steps: 1`, which was correct only while 066 was the newest
  // migration in the tree. Wave 2 (067-082) and the Final Page Catalog (083)
  // now sit above it, so a single step rolls back 083 and leaves the fixture in
  // a post-066 state — which then fails on a foreign key. Roll back TO 065
  // explicitly so the fixture is independent of how much work lands above it.
  await runMigrations({ dbPath: p, direction: 'down', target: MIG_065, allowFullChain: true });
  const db = openMigrationDatabase(p);
  const ts = new Date().toISOString();

  db.prepare(`INSERT INTO parties (id,company_id,is_company,name,status,phone,email,created_at,updated_at)
              VALUES ('party_1',?,1,'عميل','active','0770','c@x.iq',?,?)`).run(CO, ts, ts);
  db.prepare(`INSERT INTO crm_leads (id,company_id,name,contact_name,email,phone,stage,expected_revenue,probability,created_at,updated_at)
              VALUES ('lead_1',?,'عميل محتمل','أحمد','a@x.iq','0770','qualified',1000000,10,?,?)`).run(CO, ts, ts);
  db.prepare(`INSERT INTO crm_opportunities (id,company_id,lead_id,party_id,name,stage,expected_value,probability,status,version,created_at,updated_at)
              VALUES ('opp_with_lead',?,'lead_1','party_1','صفقة','new',1000000,10,'open',1,?,?)`).run(CO, ts, ts);
  db.prepare(`INSERT INTO crm_opportunities (id,company_id,lead_id,party_id,name,stage,expected_value,probability,status,version,created_at,updated_at)
              VALUES ('opp_no_lead',?,NULL,'party_1','صفقة مباشرة','new',500000,10,'open',1,?,?)`).run(CO, ts, ts);

  // Pre-066: a lead-subject activity, and — because activity-service.mjs
  // resolved the opportunity's source lead — an opportunity-subject activity
  // that ALSO carries lead_id for the converted-lead opportunity.
  db.prepare(`INSERT INTO crm_activities (id,company_id,lead_id,opportunity_id,activity_type,summary,done,state,created_at,created_by)
              VALUES ('act_lead_only',?,'lead_1',NULL,'call','مكالمة مع العميل المحتمل',0,'planned',?,'system')`).run(CO, ts);
  db.prepare(`INSERT INTO crm_activities (id,company_id,lead_id,opportunity_id,activity_type,summary,done,state,created_at,created_by)
              VALUES ('act_opp_with_lineage',?,'lead_1','opp_with_lead','call','متابعة الفرصة المحوّلة',0,'planned',?,'system')`).run(CO, ts);

  // Pre-066: a direct-opportunity row in the SEPARATE legacy table (no lead
  // lineage possible there at all), written by platform/sales/lifecycle.mjs.
  db.prepare(`INSERT INTO crm_opportunity_activities (id,opportunity_id,activity_type,summary,done,due_date,created_at)
              VALUES ('legacy_act_1','opp_no_lead','converted','تم إنشاء الفرصة مباشرة',1,NULL,?)`).run(ts);

  db.close();
  return p;
}

async function testPopulatedUpgradePreservesEveryRow() {
  const p = await buildPre066Fixture('populated');
  await runMigrations({ dbPath: p, direction: 'up' }); // apply 066

  const db = open(p);
  const rows = db.prepare('SELECT * FROM crm_activities ORDER BY id').all();
  assert.strictEqual(rows.length, 3, 'all 2 crm_activities rows + 1 imported crm_opportunity_activities row must survive');

  const leadOnly = rows.find((r) => r.id === 'act_lead_only');
  assert.strictEqual(leadOnly.subject_type, 'lead');
  assert.strictEqual(leadOnly.lead_id, 'lead_1');
  assert.strictEqual(leadOnly.opportunity_id, null);
  assert.strictEqual(leadOnly.legacy_source, 'crm_activities');

  const oppWithLineage = rows.find((r) => r.id === 'act_opp_with_lineage');
  assert.strictEqual(oppWithLineage.subject_type, 'opportunity', 'opportunity is the primary subject even though lead_id is also set');
  assert.strictEqual(oppWithLineage.opportunity_id, 'opp_with_lead');
  assert.strictEqual(oppWithLineage.lead_id, 'lead_1', 'lineage to the source lead is preserved');

  const imported = rows.find((r) => r.id === 'legacy_act_1');
  assert.ok(imported, 'the row imported from crm_opportunity_activities must survive under its original id');
  assert.strictEqual(imported.subject_type, 'opportunity');
  assert.strictEqual(imported.opportunity_id, 'opp_no_lead');
  assert.strictEqual(imported.lead_id, null, 'no lineage is invented for a legacy row that never recorded one');
  assert.strictEqual(imported.done, 1);
  assert.strictEqual(imported.state, 'completed');
  assert.strictEqual(imported.legacy_source, 'crm_opportunity_activities');

  db.close();
  drop(p);
  console.log('PASS: populatedUpgradePreservesEveryRow');
}

async function testCrmOpportunityActivitiesBecomesReadOnlyView() {
  const p = await buildPre066Fixture('view');
  await runMigrations({ dbPath: p, direction: 'up' });
  const db = openMigrationDatabase(p);

  const kind = db.prepare("SELECT type FROM sqlite_master WHERE name = 'crm_opportunity_activities'").get();
  assert.strictEqual(kind.type, 'view', 'crm_opportunity_activities must no longer be a writable table');

  // The view still serves the exact shape platform/sales/lifecycle.mjs reads.
  const viaView = db.prepare('SELECT * FROM crm_opportunity_activities WHERE opportunity_id = ?').all('opp_no_lead');
  assert.strictEqual(viaView.length, 1);
  assert.strictEqual(viaView[0].summary, 'تم إنشاء الفرصة مباشرة');

  assert.throws(
    () => db.prepare("INSERT INTO crm_opportunity_activities (id,opportunity_id,activity_type,summary,done,due_date,created_at) VALUES ('x','opp_no_lead','note','x',0,NULL,'2026-01-01')").run(),
    /view/i,
    'writes through the compatibility view must fail — it is read-only by construction'
  );

  db.close();
  drop(p);
  console.log('PASS: crmOpportunityActivitiesBecomesReadOnlyView');
}

async function testDirectOpportunityActivityAfterMigration() {
  const p = await buildPre066Fixture('direct');
  await runMigrations({ dbPath: p, direction: 'up' });
  const db = openMigrationDatabase(p);
  const ts = new Date().toISOString();

  // This INSERT would have violated the pre-066 NOT NULL lead_id constraint.
  db.prepare(`INSERT INTO crm_activities (id,company_id,subject_type,lead_id,opportunity_id,activity_type,summary,done,state,created_at,created_by)
              VALUES ('act_direct_new',?,'opportunity',NULL,'opp_no_lead','call','نشاط جديد بلا عميل',0,'planned',?,'system')`).run(CO, ts);
  const row = db.prepare("SELECT * FROM crm_activities WHERE id='act_direct_new'").get();
  assert.strictEqual(row.opportunity_id, 'opp_no_lead');
  assert.strictEqual(row.lead_id, null);

  assert.throws(
    () => db.prepare(`INSERT INTO crm_activities (id,company_id,subject_type,lead_id,opportunity_id,party_id,activity_type,summary,done,state,created_at,created_by)
                      VALUES ('act_bad',?,'lead',NULL,NULL,NULL,'call','x',0,'planned',?,'system')`).run(CO, ts),
    /CHECK/i,
    'the subject_type CHECK constraint rejects a row claiming to be lead-subject with no lead_id'
  );

  db.close();
  drop(p);
  console.log('PASS: directOpportunityActivityAfterMigration');
}

async function testRerunIsIdempotentAndForeignKeysClean() {
  const p = await buildPre066Fixture('rerun');
  const first = await runMigrations({ dbPath: p, direction: 'up' });
  // The fixture sits at the 065 tip, so applying `up` replays 066 AND
  // everything above it (Wave 2 067-082, Final Page Catalog 083). This test
  // owns 066: assert it was applied and applied first, not that it was alone.
  assert.strictEqual(first.migrations[0], MIG, '066 must be the first migration re-applied from the 065 tip');

  const again = await runMigrations({ dbPath: p, direction: 'up' });
  assert.deepStrictEqual(again.migrations, [], 'rerun applies nothing once at tip');

  const db = openMigrationDatabase(p);
  const violations = db.prepare('PRAGMA foreign_key_check').all();
  assert.deepStrictEqual(violations, [], 'no dangling foreign keys after migration');
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM crm_activities').get().n, 3, 'no duplicate import on rerun (rerun is a no-op, not a second apply)');
  db.close();
  drop(p);
  console.log('PASS: rerunIsIdempotentAndForeignKeysClean');
}

async function testRollbackRestoresOriginalShapeWhenPossible() {
  const p = await buildPre066Fixture('rollback');
  await runMigrations({ dbPath: p, direction: 'up' });

  // Unwind 066 specifically, not "one step" — see buildPre066Fixture.
  await runMigrations({ dbPath: p, direction: 'down', target: MIG_065, allowFullChain: true });
  const db = openMigrationDatabase(p);

  const kind = db.prepare("SELECT type FROM sqlite_master WHERE name = 'crm_opportunity_activities'").get();
  assert.strictEqual(kind.type, 'table', 'rollback restores crm_opportunity_activities as a real writable table');

  const restoredLegacy = db.prepare("SELECT * FROM crm_opportunity_activities WHERE id = 'legacy_act_1'").get();
  assert.ok(restoredLegacy, 'the originally-imported legacy row returns to crm_opportunity_activities');
  assert.strictEqual(restoredLegacy.summary, 'تم إنشاء الفرصة مباشرة');

  const cols = db.prepare('PRAGMA table_info(crm_activities)').all().map((c) => c.name);
  assert.ok(!cols.includes('subject_type'), 'subject_type is removed on rollback');
  assert.ok(cols.includes('opportunity_id'), '065 columns are untouched by 066 rollback');

  const restoredLead = db.prepare("SELECT * FROM crm_activities WHERE id = 'act_lead_only'").get();
  assert.strictEqual(restoredLead.lead_id, 'lead_1');
  const restoredOppLineage = db.prepare("SELECT * FROM crm_activities WHERE id = 'act_opp_with_lineage'").get();
  assert.strictEqual(restoredOppLineage.lead_id, 'lead_1', 'lineage-carrying row returns to crm_activities, not crm_opportunity_activities');

  const violations = db.prepare('PRAGMA foreign_key_check').all();
  assert.deepStrictEqual(violations, [], 'no dangling foreign keys after rollback');
  db.close();

  // Forward round trip: re-apply and land on the same logical state.
  const reapplied = await runMigrations({ dbPath: p, direction: 'up' });
  assert.strictEqual(reapplied.migrations[0], MIG, '066 must be the first migration re-applied after its rollback');
  const db2 = openMigrationDatabase(p);
  assert.strictEqual(db2.prepare('SELECT COUNT(*) n FROM crm_activities').get().n, 3, 'round trip returns to the same row count');
  db2.close();

  drop(p);
  console.log('PASS: rollbackRestoresOriginalShapeWhenPossible');
}

async function testRollbackRefusesOnIrreversiblePartyData() {
  const p = await buildPre066Fixture('irreversible');
  await runMigrations({ dbPath: p, direction: 'up' });
  const db = openMigrationDatabase(p);
  const ts = new Date().toISOString();
  // A direct Party activity — this subject was unreachable before 066, so
  // neither original table has anywhere to put it back.
  db.prepare(`INSERT INTO crm_activities (id,company_id,subject_type,lead_id,opportunity_id,party_id,activity_type,summary,done,state,created_at,created_by)
              VALUES ('act_party_only',?,'party',NULL,NULL,'party_1','visit','زيارة عميل مباشرة',0,'planned',?,'system')`).run(CO, ts);
  db.close();

  await assert.rejects(
    () => runMigrations({ dbPath: p, direction: 'down', target: MIG_065, allowFullChain: true }),
    (e) => {
      // The runner wraps migration errors; the cause carries the typed error.
      const cause = e.details?.cause ?? e;
      return cause instanceof IrreversibleActivityDataError || cause.code === 'IRREVERSIBLE_ACTIVITY_DATA';
    },
    'rollback must refuse rather than silently drop the party-subject activity'
  );

  // The refusal must be atomic: nothing was changed by the failed attempt.
  const db2 = openMigrationDatabase(p);
  assert.strictEqual(db2.prepare("SELECT type FROM sqlite_master WHERE name='crm_opportunity_activities'").get().type, 'view', 'a failed rollback leaves the view untouched');
  assert.ok(db2.prepare("SELECT 1 FROM crm_activities WHERE id='act_party_only'").get(), 'the party-subject row is still present after the refused rollback');
  db2.close();
  drop(p);
  console.log('PASS: rollbackRefusesOnIrreversiblePartyData');
}

async function main() {
  await testPopulatedUpgradePreservesEveryRow();
  await testCrmOpportunityActivitiesBecomesReadOnlyView();
  await testDirectOpportunityActivityAfterMigration();
  await testRerunIsIdempotentAndForeignKeysClean();
  await testRollbackRestoresOriginalShapeWhenPossible();
  await testRollbackRefusesOnIrreversiblePartyData();
  console.log('\nAll CRM activity-unification migration tests passed.');
}

main().catch((e) => { console.error('FAIL:', e); process.exitCode = 1; });
