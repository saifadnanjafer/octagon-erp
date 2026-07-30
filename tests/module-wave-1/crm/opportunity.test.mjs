// CRM Opportunity, Stage, Activity, Sales and Work Item suite.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { freshInstall, openMigrationDatabase } from '../../../database/migration-runner/index.mjs';
import {
  createOpportunity, updateOpportunity, assignOpportunity, changeStage, changePipeline,
  addCompetitor, removeCompetitor, markWon, markLost, reopenOpportunity,
  archiveOpportunity, restoreOpportunity, getOpportunity, weighted,
} from '../../../platform/domains/crm/opportunity-service.mjs';
import { linkQuotation, linkSalesOrder, buildQuotationRequest, getLinkedSales } from '../../../platform/domains/crm/sales-integration.mjs';
import {
  scheduleActivity, completeActivity, cancelActivity, reopenActivity, assignActivity,
  createWorkItemFromActivity, linkWorkItem, onWorkItemCompleted, listActivities, getActivity,
} from '../../../platform/domains/crm/activity-service.mjs';

const CO = 'co_test';
const CTX = { company_id: CO, actor: 'system_admin' };

function tmp(n) { return path.join(os.tmpdir(), `octagon-crmopp-${n}-${Date.now()}-${process.pid}.db`); }

async function setup(name) {
  const p = tmp(name);
  await freshInstall({ dbPath: p });
  const db = openMigrationDatabase(p);
  const ts = new Date().toISOString();
  db.prepare(`INSERT INTO parties (id,company_id,is_company,name,status,phone,email,created_at,updated_at)
              VALUES ('party_1',?,1,'عميل','active','0770','c@x.iq',?,?)`).run(CO, ts, ts);
  return { db, path: p };
}
function done(env) {
  env.db.close();
  for (const s of ['', '-wal', '-shm']) { try { if (fs.existsSync(env.path + s)) fs.unlinkSync(env.path + s); } catch {} }
}
const mkOpp = (db, over = {}) => createOpportunity(db, { ...CTX, party_id: 'party_1', name: 'صفقة', expected_value: 1000000, ...over }).opportunity;

/** An opportunity carrying a source lead — required for activities, since
 *  crm_activities.lead_id is NOT NULL (migration 039). */
function mkOppWithLead(db, over = {}) {
  const ts = new Date().toISOString();
  const leadId = 'lead_for_act_' + Math.random().toString(36).slice(2, 8);
  db.prepare(`INSERT INTO crm_leads (id,company_id,name,contact_name,email,phone,stage,expected_revenue,probability,created_at,updated_at)
              VALUES (?,?,'عميل محتمل','أحمد','a@x.iq','0770','qualified',1000000,10,?,?)`).run(leadId, CO, ts, ts);
  return createOpportunity(db, { ...CTX, party_id: 'party_1', name: 'صفقة', expected_value: 1000000, lead_id: leadId, ...over }).opportunity;
}

function mkOrder(db, id, party = 'party_1') {
  const ts = new Date().toISOString();
  db.prepare(`INSERT INTO sale_orders (id,company_id,name,partner_id,state,order_date,created_at)
              VALUES (?,?,?,?, 'draft',?,?)`).run(id, CO, id.toUpperCase(), party, ts, ts);
  return id;
}

// ---------------------------------------------------------------------------

async function testCreateAndWeightedRevenue() {
  const env = await setup('create');
  const { db } = env;
  const opp = mkOpp(db);
  assert.match(opp.reference, /^OPP-\d{4}-\d{5}$/);
  assert.strictEqual(opp.status, 'open');
  assert.strictEqual(opp.probability, 10, 'probability from the opening stage');
  assert.strictEqual(opp.weighted_revenue, 100000, 'weighted = expected x probability');

  // Weighted revenue is server-derived: a client value is ignored.
  const tampered = updateOpportunity(db, { ...CTX, opportunity_id: opp.id, expected_value: 2000000, weighted_revenue: 999999999 }).opportunity;
  assert.strictEqual(tampered.weighted_revenue, 200000, 'client-supplied weighted revenue must be ignored');
  assert.strictEqual(weighted(2000000, 10), 200000);

  assert.throws(() => createOpportunity(db, { ...CTX, name: 'x' }), (e) => e.code === 'VALIDATION_FAILED');
  assert.throws(() => createOpportunity(db, { ...CTX, party_id: 'nope' }), (e) => e.code === 'PARTY_NOT_FOUND');
  done(env);
  console.log('PASS: createAndWeightedRevenue');
}

async function testStageTransitions() {
  const env = await setup('stages');
  const { db } = env;
  const opp = mkOpp(db);

  const moved = changeStage(db, { ...CTX, opportunity_id: opp.id, stage_id: 'crm_stage_proposal' });
  assert.strictEqual(moved.changed, true);
  assert.strictEqual(moved.opportunity.probability, 50);
  assert.strictEqual(moved.opportunity.weighted_revenue, 500000, 'weighted recalculated on stage change');
  assert.strictEqual(moved.opportunity.stage, 'PROPOSAL', 'legacy stage column kept in sync');

  // Idempotent: same stage again writes no second history row.
  const before = db.prepare('SELECT COUNT(*) n FROM crm_stage_history WHERE opportunity_id=?').get(opp.id).n;
  const again = changeStage(db, { ...CTX, opportunity_id: opp.id, stage_id: 'crm_stage_proposal' });
  assert.strictEqual(again.changed, false);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM crm_stage_history WHERE opportunity_id=?').get(opp.id).n, before, 'no duplicate stage history');

  // Won/Lost stages cannot be reached by dragging — they need their commands.
  assert.throws(() => changeStage(db, { ...CTX, opportunity_id: opp.id, stage_id: 'crm_stage_won' }), (e) => e.code === 'WON_EVIDENCE_REQUIRED');
  assert.throws(() => changeStage(db, { ...CTX, opportunity_id: opp.id, stage_id: 'crm_stage_lost' }), (e) => e.code === 'WON_EVIDENCE_REQUIRED');

  // Cross-pipeline stage denied.
  const ts = new Date().toISOString();
  db.prepare(`INSERT INTO crm_pipelines (id,company_id,code,name_ar,name_en,is_default,is_active,created_at,updated_at)
              VALUES ('pl2',?,'ALT','بديل','Alt',0,1,?,?)`).run(CO, ts, ts);
  db.prepare(`INSERT INTO crm_pipeline_stages (id,pipeline_id,code,name_ar,name_en,sequence,probability,colour_token,is_won,is_lost,is_active,created_at,updated_at)
              VALUES ('pl2_s1','pl2','S1','مرحلة','Stage',0,20,'info',0,0,1,?,?)`).run(ts, ts);
  assert.throws(() => changeStage(db, { ...CTX, opportunity_id: opp.id, stage_id: 'pl2_s1' }), (e) => e.code === 'STAGE_PIPELINE_MISMATCH');

  // Archived stage denied.
  db.prepare("UPDATE crm_pipeline_stages SET is_active=0 WHERE id='crm_stage_negotiation'").run();
  assert.throws(() => changeStage(db, { ...CTX, opportunity_id: opp.id, stage_id: 'crm_stage_negotiation' }), (e) => e.code === 'STAGE_INACTIVE');

  // Version conflict.
  const v = getOpportunity(db, opp.id).version;
  changeStage(db, { ...CTX, opportunity_id: opp.id, stage_id: 'crm_stage_qualify', expected_version: v });
  assert.throws(() => changeStage(db, { ...CTX, opportunity_id: opp.id, stage_id: 'crm_stage_proposal', expected_version: v }), (e) => e.code === 'VERSION_CONFLICT');

  done(env);
  console.log('PASS: stageTransitions');
}

async function testChangePipeline() {
  const env = await setup('pipeline');
  const { db } = env;
  const opp = mkOpp(db);
  const ts = new Date().toISOString();
  db.prepare(`INSERT INTO crm_pipelines (id,company_id,code,name_ar,name_en,is_default,is_active,created_at,updated_at)
              VALUES ('pl2',?,'ALT','بديل','Alt',0,1,?,?)`).run(CO, ts, ts);
  db.prepare(`INSERT INTO crm_pipeline_stages (id,pipeline_id,code,name_ar,name_en,sequence,probability,colour_token,is_won,is_lost,is_active,created_at,updated_at)
              VALUES ('pl2_s1','pl2','S1','مرحلة','Stage',0,20,'info',0,0,1,?,?)`).run(ts, ts);

  const r = changePipeline(db, { ...CTX, opportunity_id: opp.id, pipeline_id: 'pl2' });
  assert.strictEqual(r.opportunity.pipeline_id, 'pl2');
  assert.strictEqual(r.opportunity.stage_id, 'pl2_s1', 'lands on the target pipeline first open stage');
  assert.strictEqual(r.opportunity.probability, 20);
  assert.strictEqual(r.opportunity.weighted_revenue, 200000);

  // A pipeline with no open stage cannot be a target.
  db.prepare(`INSERT INTO crm_pipelines (id,company_id,code,name_ar,name_en,is_default,is_active,created_at,updated_at)
              VALUES ('pl3',?,'EMPTY','فارغ','Empty',0,1,?,?)`).run(CO, ts, ts);
  assert.throws(() => changePipeline(db, { ...CTX, opportunity_id: opp.id, pipeline_id: 'pl3' }), (e) => e.code === 'PIPELINE_HAS_NO_OPEN_STAGE');
  done(env);
  console.log('PASS: changePipeline');
}

async function testWonRequiresEvidence() {
  const env = await setup('won');
  const { db } = env;
  const opp = mkOpp(db);

  // No evidence, no override → refused.
  assert.throws(() => markWon(db, { ...CTX, opportunity_id: opp.id }), (e) => e.code === 'WON_EVIDENCE_REQUIRED');
  assert.strictEqual(getOpportunity(db, opp.id).status, 'open', 'refusal leaves it open');

  // Override without a reason → still refused.
  assert.throws(() => markWon(db, { ...CTX, opportunity_id: opp.id, allow_override: true }), (e) => e.code === 'WON_EVIDENCE_REQUIRED');

  // Override with a reason → allowed and recorded.
  const ov = markWon(db, { ...CTX, opportunity_id: opp.id, allow_override: true, override_reason: 'اتفاق شفهي موثق' });
  assert.strictEqual(ov.evidence, 'override');
  assert.strictEqual(ov.opportunity.status, 'won');
  assert.strictEqual(ov.opportunity.probability, 100);
  assert.strictEqual(ov.opportunity.stage, 'WON');
  assert.ok(ov.opportunity.won_override_reason.length > 0, 'override reason stored');

  // Idempotent.
  assert.strictEqual(markWon(db, { ...CTX, opportunity_id: opp.id }).changed, false);

  // Won is final.
  assert.throws(() => reopenOpportunity(db, { ...CTX, opportunity_id: opp.id }), (e) => e.code === 'OPPORTUNITY_WON_IS_FINAL');

  // With a linked sales order, no override is needed.
  const opp2 = mkOpp(db, { name: 'صفقة ٢' });
  mkOrder(db, 'so_evidence');
  linkSalesOrder(db, { ...CTX, opportunity_id: opp2.id, sale_order_id: 'so_evidence' });
  const won2 = markWon(db, { ...CTX, opportunity_id: opp2.id });
  assert.strictEqual(won2.evidence, 'sale_order');
  done(env);
  console.log('PASS: wonRequiresEvidence');
}

async function testLostAndReopen() {
  const env = await setup('lost');
  const { db } = env;
  const opp = mkOpp(db);

  assert.throws(() => markLost(db, { ...CTX, opportunity_id: opp.id }), (e) => e.code === 'LOST_REASON_REQUIRED');
  assert.throws(() => markLost(db, { ...CTX, opportunity_id: opp.id, lost_reason_id: 'nope' }), (e) => e.code === 'LOST_REASON_NOT_FOUND');

  db.prepare(`INSERT INTO crm_competitors (id,company_id,name,notes,is_active,created_at)
              VALUES ('comp_1',?,'منافس','',1,?)`).run(CO, new Date().toISOString());
  const lost = markLost(db, { ...CTX, opportunity_id: opp.id, lost_reason_id: 'crm_lost_price', competitor_id: 'comp_1', note: 'سعر أقل' });
  assert.strictEqual(lost.opportunity.status, 'lost');
  assert.strictEqual(lost.opportunity.probability, 0);
  assert.strictEqual(lost.opportunity.weighted_revenue, 0);
  assert.strictEqual(lost.opportunity.lost_reason, 'PRICE', 'legacy lost_reason column carries the code');
  assert.strictEqual(db.prepare('SELECT threat_level FROM crm_opportunity_competitors WHERE opportunity_id=?').get(opp.id).threat_level, 'won_against_us');

  assert.strictEqual(markLost(db, { ...CTX, opportunity_id: opp.id, lost_reason_id: 'crm_lost_price' }).changed, false, 'idempotent');

  const re = reopenOpportunity(db, { ...CTX, opportunity_id: opp.id });
  assert.strictEqual(re.opportunity.status, 'open');
  assert.strictEqual(re.opportunity.reopen_count, 1);
  assert.strictEqual(re.opportunity.lost_reason_id, null, 'active lost reason cleared');
  assert.ok(re.opportunity.probability > 0, 'probability restored from the open stage');

  // History retains why it was lost.
  const hist = db.prepare('SELECT note FROM crm_stage_history WHERE opportunity_id=? ORDER BY changed_at').all(opp.id);
  assert.ok(hist.some((h) => /reopened/.test(h.note)), 'reopen recorded in history');
  assert.ok(hist.some((h) => /سعر أقل|PRICE/.test(h.note)), 'the lost reason survives in history');
  done(env);
  console.log('PASS: lostAndReopen');
}

async function testArchiveRestoreAndCompetitors() {
  const env = await setup('archive');
  const { db } = env;
  const opp = mkOpp(db);
  db.prepare(`INSERT INTO crm_competitors (id,company_id,name,notes,is_active,created_at) VALUES ('c1',?,'منافس','',1,?)`).run(CO, new Date().toISOString());

  addCompetitor(db, { ...CTX, opportunity_id: opp.id, competitor_id: 'c1', threat_level: 'high' });
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM crm_opportunity_competitors WHERE opportunity_id=?').get(opp.id).n, 1);
  addCompetitor(db, { ...CTX, opportunity_id: opp.id, competitor_id: 'c1', threat_level: 'low' });
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM crm_opportunity_competitors WHERE opportunity_id=?').get(opp.id).n, 1, 'no duplicate competitor row');
  removeCompetitor(db, { ...CTX, opportunity_id: opp.id, competitor_id: 'c1' });
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM crm_opportunity_competitors WHERE opportunity_id=?').get(opp.id).n, 0);

  archiveOpportunity(db, { ...CTX, opportunity_id: opp.id });
  assert.throws(() => changeStage(db, { ...CTX, opportunity_id: opp.id, stage_id: 'crm_stage_proposal' }), (e) => e.code === 'OPPORTUNITY_NOT_OPEN');
  restoreOpportunity(db, { ...CTX, opportunity_id: opp.id });
  assert.strictEqual(changeStage(db, { ...CTX, opportunity_id: opp.id, stage_id: 'crm_stage_proposal' }).changed, true);
  done(env);
  console.log('PASS: archiveRestoreAndCompetitors');
}

async function testSalesIntegration() {
  const env = await setup('sales');
  const { db } = env;
  const opp = mkOpp(db);

  // CRM builds a request payload; it does not price it.
  const req = buildQuotationRequest(db, getOpportunity(db, opp.id));
  assert.strictEqual(req.partner_id, 'party_1');
  assert.strictEqual(req.source_opportunity_id, opp.id);
  assert.ok(!('amount_total' in req) && !('tax' in req) && !('discount' in req), 'CRM must not carry pricing or tax');

  mkOrder(db, 'so_q1');
  const linked = linkQuotation(db, { ...CTX, opportunity_id: opp.id, sale_order_id: 'so_q1' });
  assert.strictEqual(linked.linked, true);
  assert.strictEqual(db.prepare("SELECT source_opportunity_id FROM sale_orders WHERE id='so_q1'").get().source_opportunity_id, opp.id,
    'canonical Sales records the back-link on its own column');

  // Replay: no duplicate.
  const replay = linkQuotation(db, { ...CTX, opportunity_id: opp.id, sale_order_id: 'so_q1' });
  assert.strictEqual(replay.replayed, true);
  assert.strictEqual(replay.linked, false);

  // A different quotation cannot silently displace the first.
  mkOrder(db, 'so_q2');
  assert.throws(() => linkQuotation(db, { ...CTX, opportunity_id: opp.id, sale_order_id: 'so_q2' }), (e) => e.code === 'QUOTATION_ALREADY_LINKED');

  // Party mismatch denied.
  const ts = new Date().toISOString();
  db.prepare(`INSERT INTO parties (id,company_id,is_company,name,status,created_at,updated_at) VALUES ('party_2',?,1,'آخر','active',?,?)`).run(CO, ts, ts);
  mkOrder(db, 'so_other', 'party_2');
  assert.throws(() => linkSalesOrder(db, { ...CTX, opportunity_id: opp.id, sale_order_id: 'so_other' }), (e) => e.code === 'QUOTATION_PARTY_MISMATCH');
  assert.throws(() => linkQuotation(db, { ...CTX, opportunity_id: opp.id, sale_order_id: 'missing' }), (e) => e.code === 'SALE_ORDER_NOT_FOUND');

  const sales = getLinkedSales(db, opp.id);
  assert.strictEqual(sales.quotation.id, 'so_q1');
  done(env);
  console.log('PASS: salesIntegration');
}

async function testActivityLifecycle() {
  const env = await setup('activity');
  const { db } = env;
  const opp = mkOppWithLead(db);

  assert.throws(() => scheduleActivity(db, { ...CTX, summary: 'x' }), (e) => e.code === 'VALIDATION_FAILED');
  assert.throws(() => scheduleActivity(db, { ...CTX, opportunity_id: opp.id }), (e) => e.code === 'VALIDATION_FAILED');
  // Migration 066 unified the Activity authority: crm_activities.lead_id is now
  // nullable and a subject_type CHECK enforces exactly one primary subject. An
  // Opportunity with NO source lead can now carry an Activity directly — this
  // used to fail loudly (see docs/evidence/.../activity-schema-limitation.md).
  const orphan = mkOpp(db, { name: 'بلا عميل محتمل' });
  const direct = scheduleActivity(db, { ...CTX, opportunity_id: orphan.id, summary: 'متابعة مباشرة' }).activity;
  assert.strictEqual(direct.opportunity_id, orphan.id);
  assert.strictEqual(direct.lead_id, null, 'a direct opportunity has no source lead to resolve');
  assert.strictEqual(db.prepare('SELECT subject_type FROM crm_activities WHERE id = ?').get(direct.id).subject_type, 'opportunity');

  // A caller cannot supply more than one subject reference at once.
  assert.throws(
    () => scheduleActivity(db, { ...CTX, opportunity_id: opp.id, lead_id: 'lead_x', summary: 'x' }),
    (e) => e.code === 'VALIDATION_FAILED'
  );

  // A direct Party-linked activity (no lead, no opportunity) is also supported.
  const partyActivity = scheduleActivity(db, { ...CTX, party_id: 'party_1', summary: 'زيارة عميل' }).activity;
  assert.strictEqual(partyActivity.party_id, 'party_1');
  assert.strictEqual(db.prepare('SELECT subject_type FROM crm_activities WHERE id = ?').get(partyActivity.id).subject_type, 'party');

  assert.throws(() => scheduleActivity(db, { ...CTX, opportunity_id: opp.id, summary: 'x', activity_type: 'telepathy' }), (e) => e.code === 'VALIDATION_FAILED');

  const past = new Date(Date.now() - 86400000).toISOString();
  const a = scheduleActivity(db, { ...CTX, opportunity_id: opp.id, summary: 'اتصال', activity_type: 'call', due_at: past }).activity;
  assert.strictEqual(a.state, 'planned');
  assert.strictEqual(a.overdue, true, 'overdue is derived from due date and state, not stored');
  // Activities for an opportunity converted from a lead still carry lead_id for
  // lineage, even though the primary subject is the opportunity.
  assert.strictEqual(a.lead_id, opp.lead_id, 'converted-lead opportunity activities keep lead lineage');
  assert.strictEqual(db.prepare('SELECT subject_type FROM crm_activities WHERE id = ?').get(a.id).subject_type, 'opportunity');

  assignActivity(db, { ...CTX, activity_id: a.id, assigned_user_id: 'sales_1' });
  assert.strictEqual(getActivity(db, a.id).assigned_user_id, 'sales_1');

  const c = completeActivity(db, { ...CTX, activity_id: a.id, outcome: 'تم' });
  assert.strictEqual(c.activity.state, 'completed');
  assert.strictEqual(c.activity.overdue, false, 'a completed activity is not overdue');
  assert.strictEqual(completeActivity(db, { ...CTX, activity_id: a.id }).changed, false, 'idempotent');
  assert.throws(() => cancelActivity(db, { ...CTX, activity_id: a.id }), (e) => e.code === 'ACTIVITY_ALREADY_CLOSED');

  reopenActivity(db, { ...CTX, activity_id: a.id });
  assert.strictEqual(getActivity(db, a.id).state, 'planned');

  // Views.
  scheduleActivity(db, { ...CTX, opportunity_id: opp.id, summary: 'قادم', due_at: new Date(Date.now() + 86400000).toISOString() });
  assert.ok(listActivities(db, { companyId: CO, view: 'overdue' }).items.length >= 1);
  assert.ok(listActivities(db, { companyId: CO, view: 'upcoming' }).items.length >= 1);
  assert.strictEqual(listActivities(db, { companyId: 'co_other', view: 'all' }).total, 0, 'company scoped');
  done(env);
  console.log('PASS: activityLifecycle');
}

async function testWorkItemIntegration() {
  const env = await setup('workitem');
  const { db } = env;
  const opp = mkOppWithLead(db);
  const a = scheduleActivity(db, { ...CTX, opportunity_id: opp.id, summary: 'زيارة موقع', activity_type: 'visit', due_at: new Date().toISOString() }).activity;

  const r = createWorkItemFromActivity(db, { ...CTX, activity_id: a.id });
  assert.strictEqual(r.created, true);
  assert.strictEqual(r.workItem.source_type, 'crm_activity');
  assert.strictEqual(r.workItem.source_id, a.id, 'canonical Work Item points back via its own source columns');
  assert.strictEqual(r.activity.state, 'in_progress');

  // Replay returns the existing Work Item — at most one per activity.
  const again = createWorkItemFromActivity(db, { ...CTX, activity_id: a.id });
  assert.strictEqual(again.created, false);
  assert.strictEqual(again.replayed, true);
  assert.strictEqual(again.workItem.id, r.workItem.id);
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM work_items WHERE source_id=?").get(a.id).n, 1, 'no duplicate work item');

  // A different work item cannot displace the link.
  const ts = new Date().toISOString();
  db.prepare(`INSERT INTO work_items (id,company_id,title,status,stage,progress,version,created_at,updated_at)
              VALUES ('wi_other',?,'آخر','open','todo',0,1,?,?)`).run(CO, ts, ts);
  assert.throws(() => linkWorkItem(db, { ...CTX, activity_id: a.id, work_item_id: 'wi_other' }), (e) => e.code === 'WORK_ITEM_ALREADY_LINKED');

  // Cancelling the activity does NOT delete the work item.
  const cancelled = cancelActivity(db, { ...CTX, activity_id: a.id });
  assert.strictEqual(cancelled.workItemRetained, true);
  assert.ok(db.prepare('SELECT id FROM work_items WHERE id=?').get(r.workItem.id), 'work item survives activity cancellation');

  // Work Item completion closes the activity through the governed event.
  const a2 = scheduleActivity(db, { ...CTX, opportunity_id: opp.id, summary: 'تنفيذ' }).activity;
  const w2 = createWorkItemFromActivity(db, { ...CTX, activity_id: a2.id });
  const ev = onWorkItemCompleted(db, { workItemId: w2.workItem.id, actor: 'system', companyId: CO });
  assert.strictEqual(ev.updated, true);
  assert.strictEqual(getActivity(db, a2.id).state, 'completed', 'Work Item remains authoritative for execution');
  done(env);
  console.log('PASS: workItemIntegration');
}

async function testCrossCompanyDenied() {
  const env = await setup('crosscompany');
  const { db } = env;
  const opp = mkOpp(db);
  for (const fn of [
    () => updateOpportunity(db, { company_id: 'co_other', actor: 'u', opportunity_id: opp.id, name: 'x' }),
    () => changeStage(db, { company_id: 'co_other', actor: 'u', opportunity_id: opp.id, stage_id: 'crm_stage_proposal' }),
    () => markLost(db, { company_id: 'co_other', actor: 'u', opportunity_id: opp.id, lost_reason_id: 'crm_lost_price' }),
  ]) {
    assert.throws(fn, (e) => e.code === 'OPPORTUNITY_NOT_FOUND', 'cross-company access must be denied');
  }
  done(env);
  console.log('PASS: crossCompanyDenied');
}

async function testAtomicityOfStageChange() {
  const env = await setup('atomic');
  const { db } = env;
  const opp = mkOpp(db);
  const historyBefore = db.prepare('SELECT COUNT(*) n FROM crm_stage_history WHERE opportunity_id=?').get(opp.id).n;
  const stageBefore = getOpportunity(db, opp.id).stage_id;

  db.exec('BEGIN IMMEDIATE;');
  let threw = false;
  try {
    changeStage(db, { ...CTX, opportunity_id: opp.id, stage_id: 'stage_does_not_exist' });
  } catch (e) {
    threw = true;
    assert.strictEqual(e.code, 'STAGE_NOT_FOUND');
  } finally {
    db.exec('ROLLBACK;');
  }
  assert.ok(threw);
  assert.strictEqual(getOpportunity(db, opp.id).stage_id, stageBefore, 'stage unchanged after rollback');
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM crm_stage_history WHERE opportunity_id=?').get(opp.id).n, historyBefore, 'no stage history written');
  done(env);
  console.log('PASS: atomicityOfStageChange');
}

async function main() {
  await testCreateAndWeightedRevenue();
  await testStageTransitions();
  await testChangePipeline();
  await testWonRequiresEvidence();
  await testLostAndReopen();
  await testArchiveRestoreAndCompetitors();
  await testSalesIntegration();
  await testActivityLifecycle();
  await testWorkItemIntegration();
  await testCrossCompanyDenied();
  await testAtomicityOfStageChange();
  console.log('\nAll CRM opportunity/activity tests passed.');
}

main().catch((e) => { console.error('FAIL:', e); process.exitCode = 1; });
