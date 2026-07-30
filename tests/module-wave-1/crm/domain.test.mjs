// CRM domain suite — Lead lifecycle, duplicate detection, merge, scoring, and
// atomic Party conversion. Disposable databases only.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { freshInstall, openMigrationDatabase } from '../../../database/migration-runner/index.mjs';
import {
  createLead, updateLead, assignLead, contactLead, qualifyLead, disqualifyLead,
  reopenLead, archiveLead, restoreLead, mergeLeads, detectLeadDuplicates, getLead,
} from '../../../platform/domains/crm/lead-service.mjs';
import { convertLead } from '../../../platform/domains/crm/conversion-service.mjs';
import { detectDuplicates, CONFIDENCE } from '../../../platform/domains/crm/duplicate-service.mjs';
import { computeScore, scoreLead, overrideLeadScore, getScoreHistory } from '../../../platform/domains/crm/scoring-service.mjs';
import { normalisePhone, normaliseOrg } from '../../../platform/domains/crm/shared.mjs';

const CO = 'co_test';
const CTX = { company_id: CO, actor: 'system_admin' };

function tmp(n) { return path.join(os.tmpdir(), `octagon-crmdom-${n}-${Date.now()}-${process.pid}.db`); }

async function setup(name) {
  const p = tmp(name);
  await freshInstall({ dbPath: p });
  return { db: openMigrationDatabase(p), path: p };
}
function done(env) {
  env.db.close();
  for (const s of ['', '-wal', '-shm']) { try { if (fs.existsSync(env.path + s)) fs.unlinkSync(env.path + s); } catch {} }
}
const mk = (db, over = {}) => createLead(db, { ...CTX, name: 'لوحة أكريلك', contact_name: 'أحمد', ...over }).lead;

// ---------------------------------------------------------------------------

async function testScopeIsRequired() {
  const env = await setup('scope');
  assert.throws(() => createLead(env.db, { company_id: CO, name: 'x' }), (e) => e.code === 'ACTOR_REQUIRED');
  assert.throws(() => createLead(env.db, { actor: 'u', name: 'x' }), (e) => e.code === 'COMPANY_SCOPE_REQUIRED');
  done(env);
  console.log('PASS: scopeIsRequired');
}

async function testValidation() {
  const env = await setup('validation');
  // A lead with no title, contact or organisation is not a lead.
  assert.throws(() => createLead(env.db, { ...CTX }), (e) => e.code === 'VALIDATION_FAILED');
  assert.throws(() => createLead(env.db, { ...CTX, name: 'x', email: 'not-an-email' }),
    (e) => e.details.errors.some((x) => x.code === 'INVALID_EMAIL'));
  assert.throws(() => createLead(env.db, { ...CTX, name: 'x', phone: '12' }),
    (e) => e.details.errors.some((x) => x.code === 'INVALID_PHONE'));
  assert.throws(() => createLead(env.db, { ...CTX, name: 'x', expected_revenue: -5 }),
    (e) => e.details.errors.some((x) => x.code === 'INVALID_AMOUNT'));
  done(env);
  console.log('PASS: validation');
}

async function testNumberingIsScopedAndSequential() {
  const env = await setup('numbering');
  const a = mk(env.db);
  const b = mk(env.db);
  const year = new Date().getUTCFullYear();
  assert.strictEqual(a.reference, `LEAD-${year}-00001`);
  assert.strictEqual(b.reference, `LEAD-${year}-00002`);

  // A different company restarts its own series.
  const other = createLead(env.db, { company_id: 'co_other', actor: 'u2', name: 'آخر' }).lead;
  assert.strictEqual(other.reference, `LEAD-${year}-00001`, 'numbering is company-scoped');

  // Numbering uses the existing platform_sequences authority, not a new table.
  const seqs = env.db.prepare("SELECT scope_key FROM platform_sequences WHERE module_id='crm'").all().map((r) => r.scope_key);
  assert.ok(seqs.includes(`${CO}:lead`) && seqs.includes('co_other:lead'));
  done(env);
  console.log('PASS: numberingIsScopedAndSequential');
}

async function testLeadLifecycle() {
  const env = await setup('lifecycle');
  const { db } = env;
  const lead = mk(db, { email: 'a@x.iq', phone: '07701234567' });
  assert.strictEqual(lead.stage, 'new');

  assert.strictEqual(contactLead(db, { ...CTX, lead_id: lead.id }).lead.stage, 'contacted');
  assert.strictEqual(contactLead(db, { ...CTX, lead_id: lead.id }).lead.stage, 'contacted', 'contact is idempotent');
  assert.strictEqual(qualifyLead(db, { ...CTX, lead_id: lead.id }).lead.stage, 'qualified');
  assert.strictEqual(qualifyLead(db, { ...CTX, lead_id: lead.id }).lead.stage, 'qualified', 'qualify is idempotent');

  // Disqualify needs a reason.
  const l2 = mk(db, { name: 'ثانٍ' });
  assert.throws(() => disqualifyLead(db, { ...CTX, lead_id: l2.id }), (e) => e.code === 'LOST_REASON_REQUIRED');
  assert.throws(() => disqualifyLead(db, { ...CTX, lead_id: l2.id, lost_reason_id: 'nope' }), (e) => e.code === 'LOST_REASON_NOT_FOUND');
  assert.strictEqual(disqualifyLead(db, { ...CTX, lead_id: l2.id, lost_reason_id: 'crm_lost_price' }).lead.stage, 'unqualified');
  assert.strictEqual(reopenLead(db, { ...CTX, lead_id: l2.id }).lead.stage, 'contacted');

  // Archive blocks mutation until restored.
  archiveLead(db, { ...CTX, lead_id: l2.id });
  assert.throws(() => qualifyLead(db, { ...CTX, lead_id: l2.id }), (e) => e.code === 'LEAD_ARCHIVED');
  restoreLead(db, { ...CTX, lead_id: l2.id });
  assert.strictEqual(getLead(db, l2.id).archived, 0);

  done(env);
  console.log('PASS: leadLifecycle');
}

async function testOptimisticConcurrency() {
  const env = await setup('version');
  const { db } = env;
  const lead = mk(db);
  const v = getLead(db, lead.id).version;

  updateLead(db, { ...CTX, lead_id: lead.id, notes: 'first writer', expected_version: v });
  // Second writer still holds the stale version.
  assert.throws(
    () => updateLead(db, { ...CTX, lead_id: lead.id, notes: 'second writer', expected_version: v }),
    (e) => e.code === 'VERSION_CONFLICT' && e.details.expected === v
  );
  assert.strictEqual(getLead(db, lead.id).notes, 'first writer', 'the loser must not overwrite');
  done(env);
  console.log('PASS: optimisticConcurrency');
}

async function testDuplicateDetectionBands() {
  const env = await setup('dupes');
  const { db } = env;
  const ts = new Date().toISOString();
  db.prepare(`INSERT INTO parties (id,company_id,is_company,name,status,phone,email,created_at,updated_at)
              VALUES ('party_x',?,1,'شركة الرافدين','active','07705555555','info@rafidain.iq',?,?)`).run(CO, ts, ts);

  // Exact on email, regardless of case.
  const byEmail = detectDuplicates(db, { companyId: CO, email: 'INFO@Rafidain.IQ' });
  assert.strictEqual(byEmail.bestPartyMatch.confidence, CONFIDENCE.EXACT);
  assert.ok(byEmail.autoReusableParty, 'exact match may be reused automatically');

  // Exact on phone, regardless of formatting.
  const byPhone = detectDuplicates(db, { companyId: CO, phone: '0770-555 5555' });
  assert.strictEqual(byPhone.bestPartyMatch.confidence, CONFIDENCE.EXACT);

  // Organisation alone is only "possible" and must NOT auto-reuse.
  const byOrg = detectDuplicates(db, { companyId: CO, organizationName: 'شركة الرافدين' });
  assert.strictEqual(byOrg.bestPartyMatch.confidence, CONFIDENCE.POSSIBLE);
  assert.strictEqual(byOrg.autoReusableParty, null, 'ambiguous match must not auto-reuse');
  assert.strictEqual(byOrg.requiresUserChoice, true);

  // Nothing at all.
  assert.strictEqual(detectDuplicates(db, { companyId: CO, email: 'nobody@x.iq' }).bestPartyMatch, null);

  // Company isolation.
  assert.strictEqual(detectDuplicates(db, { companyId: 'co_other', email: 'info@rafidain.iq' }).parties.length, 0);

  // Normalisation helpers behave as the bands assume.
  assert.strictEqual(normalisePhone('٠٧٧٠ ١٢٣ ٤٥٦٧'), '07701234567', 'Arabic-Indic digits fold to ASCII');
  assert.strictEqual(normaliseOrg('Rafidain Co.'), 'rafidain');

  done(env);
  console.log('PASS: duplicateDetectionBands');
}

async function testLeadMergeKeepsHistory() {
  const env = await setup('merge');
  const { db } = env;
  const survivor = mk(db, { name: 'الناجي', email: 'dup@x.iq' });
  const loser = mk(db, { name: 'المكرر', phone: '07709998888', organization_name: 'ورشة' });

  db.prepare(`INSERT INTO crm_activities (id,company_id,lead_id,activity_type,summary,done,state,created_at,created_by)
              VALUES ('act_1',?,?,'call','مكالمة',0,'planned',?,?)`).run(CO, loser.id, new Date().toISOString(), 'u');
  db.prepare(`INSERT INTO crm_interactions (id,company_id,lead_id,channel,direction,occurred_at,summary,recorded_by,created_at)
              VALUES ('int_1',?,?,'phone','inbound',?,'اتصال','u',?)`).run(CO, loser.id, new Date().toISOString(), new Date().toISOString());

  const res = mergeLeads(db, { ...CTX, survivor_lead_id: survivor.id, duplicate_lead_ids: [loser.id] });
  assert.deepStrictEqual(res.merged, [loser.id]);

  // History moved, not destroyed.
  assert.strictEqual(db.prepare("SELECT lead_id FROM crm_activities WHERE id='act_1'").get().lead_id, survivor.id);
  assert.strictEqual(db.prepare("SELECT lead_id FROM crm_interactions WHERE id='int_1'").get().lead_id, survivor.id);

  // Loser is kept as `duplicate`, never deleted.
  const l = getLead(db, loser.id);
  assert.strictEqual(l.stage, 'duplicate');
  assert.strictEqual(l.merged_into_lead_id, survivor.id);

  // Blank survivor fields filled from the loser; decided fields untouched.
  const s = getLead(db, survivor.id);
  assert.strictEqual(s.phone, '07709998888', 'blank survivor field filled from loser');
  assert.strictEqual(s.email, 'dup@x.iq', 'existing survivor field not overwritten');

  assert.throws(() => mergeLeads(db, { ...CTX, survivor_lead_id: survivor.id, duplicate_lead_ids: [survivor.id] }),
    (e) => e.code === 'LEAD_MERGE_SELF');
  done(env);
  console.log('PASS: leadMergeKeepsHistory');
}

async function testScoringIsExplainable() {
  const env = await setup('scoring');
  const { db } = env;
  const lead = mk(db, { email: 'a@x.iq', phone: '07701234567', organization_name: 'ورشة', expected_revenue: 1500000, source_id: 'crm_src_referral' });

  const scored = getLead(db, lead.id);
  assert.ok(scored.score > 0, 'a lead is scored on creation');
  const explanation = JSON.parse(scored.score_explanation);
  assert.ok(explanation.length >= 4, 'every contributing rule is listed');
  for (const e of explanation) {
    assert.ok(e.rule_code && e.label_ar && e.label_en, 'each contribution is explainable in both languages');
    assert.ok(Number.isFinite(e.points));
  }
  // Points are traceable: email + phone + org + high value + source weight.
  const codes = explanation.map((e) => e.rule_code);
  for (const c of ['HAS_EMAIL', 'HAS_PHONE', 'HAS_ORG', 'VALUE_HIGH', 'SOURCE_WEIGHT']) {
    assert.ok(codes.includes(c), `expected rule ${c} to fire`);
  }
  assert.ok(scored.score <= 100, 'score is bounded');

  // A sparse lead scores lower than a complete one — the ordering is the point.
  const sparse = mk(db, { name: 'قليل المعلومات' });
  assert.ok(getLead(db, sparse.id).score < scored.score);

  // Manual override is gated on a reason and recorded.
  assert.throws(() => overrideLeadScore(db, { ...CTX, lead_id: lead.id, score: 90 }), (e) => e.code === 'VALIDATION_FAILED');
  assert.throws(() => overrideLeadScore(db, { ...CTX, lead_id: lead.id, score: 150, reason: 'x' }), (e) => e.code === 'VALIDATION_FAILED');
  const ov = overrideLeadScore(db, { ...CTX, lead_id: lead.id, score: 90, reason: 'عميل استراتيجي' });
  assert.strictEqual(ov.score, 90);

  const hist = getScoreHistory(db, lead.id);
  assert.ok(hist.length >= 2, 'score history is retained');
  assert.strictEqual(hist[0].source, 'manual');
  done(env);
  console.log('PASS: scoringIsExplainable');
}

async function testConversionCreatesParty() {
  const env = await setup('convnew');
  const { db } = env;
  const lead = mk(db, { email: 'new@x.iq', phone: '07700000001', organization_name: 'ورشة جديدة', expected_revenue: 800000 });
  qualifyLead(db, { ...CTX, lead_id: lead.id });

  const r = convertLead(db, { ...CTX, lead_id: lead.id });
  assert.strictEqual(r.partyCreated, true);
  assert.strictEqual(r.matchBasis, 'created');

  const party = db.prepare('SELECT * FROM parties WHERE id = ?').get(r.partyId);
  assert.strictEqual(party.name, 'ورشة جديدة');
  assert.strictEqual(party.is_company, 1);
  assert.deepStrictEqual(db.prepare('SELECT role FROM party_roles WHERE party_id=?').all(r.partyId).map((x) => x.role), ['customer']);

  const opp = r.opportunity;
  assert.strictEqual(opp.status, 'open');
  assert.strictEqual(opp.party_id, r.partyId);
  assert.strictEqual(opp.lead_id, lead.id);
  assert.match(opp.reference, /^OPP-\d{4}-\d{5}$/);
  assert.strictEqual(opp.expected_value, 800000);
  assert.strictEqual(opp.probability, 10, 'probability comes from the opening stage');
  assert.strictEqual(opp.weighted_revenue, 80000, 'weighted = expected x probability');

  assert.strictEqual(getLead(db, lead.id).stage, 'converted');
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM crm_conversion_links WHERE lead_id=?').get(lead.id).n, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM crm_stage_history WHERE opportunity_id=?').get(opp.id).n, 1);
  assert.ok(db.prepare("SELECT COUNT(*) n FROM platform_audit_log WHERE action='crm.lead.convert'").get().n >= 1, 'audit written');
  assert.ok(db.prepare("SELECT COUNT(*) n FROM platform_outbox WHERE event_type='crm.lead.converted'").get().n >= 1, 'outbox emitted');
  done(env);
  console.log('PASS: conversionCreatesParty');
}

async function testConversionReusesExactParty() {
  const env = await setup('convreuse');
  const { db } = env;
  const ts = new Date().toISOString();
  db.prepare(`INSERT INTO parties (id,company_id,is_company,name,status,phone,email,created_at,updated_at)
              VALUES ('party_known',?,1,'عميل معروف','active','07705555555','known@x.iq',?,?)`).run(CO, ts, ts);
  db.prepare(`INSERT INTO party_roles (id,party_id,role,company_id,created_at) VALUES ('pr_s','party_known','supplier',?,?)`).run(CO, ts);

  const before = db.prepare('SELECT COUNT(*) n FROM parties').get().n;
  const lead = mk(db, { email: 'known@x.iq' });
  qualifyLead(db, { ...CTX, lead_id: lead.id });
  const r = convertLead(db, { ...CTX, lead_id: lead.id });

  assert.strictEqual(r.partyId, 'party_known', 'exact email match reuses the canonical Party');
  assert.strictEqual(r.partyCreated, false);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM parties').get().n, before, 'no duplicate customer created');
  assert.deepStrictEqual(
    db.prepare('SELECT role FROM party_roles WHERE party_id=? ORDER BY role').all('party_known').map((x) => x.role),
    ['customer', 'supplier'], 'customer role is additive'
  );
  done(env);
  console.log('PASS: conversionReusesExactParty');
}

async function testConversionRefusesAmbiguousMatch() {
  const env = await setup('convambig');
  const { db } = env;
  const ts = new Date().toISOString();
  db.prepare(`INSERT INTO parties (id,company_id,is_company,name,status,phone,email,created_at,updated_at)
              VALUES ('party_amb',?,1,'ورشة النور','active','','',?,?)`).run(CO, ts, ts);

  const lead = mk(db, { name: 'استفسار', organization_name: 'ورشة النور' });
  qualifyLead(db, { ...CTX, lead_id: lead.id });

  // Organisation-only is "possible": refuse rather than guess.
  assert.throws(() => convertLead(db, { ...CTX, lead_id: lead.id }), (e) => e.code === 'PARTY_AMBIGUOUS');
  assert.strictEqual(getLead(db, lead.id).stage, 'qualified', 'refusal leaves the lead retryable');
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM crm_opportunities').get().n, 0, 'no opportunity created');

  // An explicit choice resolves it.
  const r = convertLead(db, { ...CTX, lead_id: lead.id, party_id: 'party_amb' });
  assert.strictEqual(r.partyId, 'party_amb');
  assert.strictEqual(r.matchBasis, 'explicit');
  done(env);
  console.log('PASS: conversionRefusesAmbiguousMatch');
}

async function testConversionGuardsAndAtomicity() {
  const env = await setup('convatomic');
  const { db } = env;

  // Unqualified leads cannot convert.
  const raw = mk(db, { name: 'غير مؤهل' });
  assert.throws(() => convertLead(db, { ...CTX, lead_id: raw.id }), (e) => e.code === 'LEAD_NOT_QUALIFIED');

  // Double conversion is refused.
  const lead = mk(db, { email: 'once@x.iq' });
  qualifyLead(db, { ...CTX, lead_id: lead.id });
  convertLead(db, { ...CTX, lead_id: lead.id });
  assert.throws(() => convertLead(db, { ...CTX, lead_id: lead.id }), (e) => e.code === 'LEAD_ALREADY_CONVERTED');
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM crm_opportunities WHERE lead_id=?').get(lead.id).n, 1);

  // Atomicity: a failure part-way leaves no Party, no Opportunity, no state change.
  const l2 = mk(db, { email: 'fail@x.iq' });
  qualifyLead(db, { ...CTX, lead_id: l2.id });
  const parties = db.prepare('SELECT COUNT(*) n FROM parties').get().n;
  const opps = db.prepare('SELECT COUNT(*) n FROM crm_opportunities').get().n;
  const roles = db.prepare('SELECT COUNT(*) n FROM party_roles').get().n;

  db.exec('BEGIN IMMEDIATE;');
  let threw = false;
  try {
    convertLead(db, { ...CTX, lead_id: l2.id, pipeline_id: 'pipeline_does_not_exist' });
  } catch (e) {
    threw = true;
    assert.strictEqual(e.code, 'PIPELINE_NOT_FOUND');
  } finally {
    db.exec('ROLLBACK;');
  }
  assert.ok(threw);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM parties').get().n, parties, 'no orphan Party');
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM party_roles').get().n, roles, 'no orphan role');
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM crm_opportunities').get().n, opps, 'no orphan Opportunity');
  assert.strictEqual(getLead(db, l2.id).stage, 'qualified', 'lead stays retryable');
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM crm_conversion_links WHERE lead_id=?').get(l2.id).n, 0);
  done(env);
  console.log('PASS: conversionGuardsAndAtomicity');
}

async function testConversionIdempotencyKey() {
  const env = await setup('convidem');
  const { db } = env;
  const lead = mk(db, { email: 'idem@x.iq' });
  qualifyLead(db, { ...CTX, lead_id: lead.id });

  const first = convertLead(db, { ...CTX, lead_id: lead.id, idempotency_key: 'key-123' });
  assert.strictEqual(first.replayed, false);
  const replay = convertLead(db, { ...CTX, lead_id: lead.id, idempotency_key: 'key-123' });
  assert.strictEqual(replay.replayed, true, 'replay returns the original result');
  assert.strictEqual(replay.opportunityId, first.opportunityId);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM crm_opportunities WHERE lead_id=?').get(lead.id).n, 1, 'no duplicate opportunity');
  done(env);
  console.log('PASS: conversionIdempotencyKey');
}

async function testCrossCompanyLeadIsInvisible() {
  const env = await setup('crosscompany');
  const { db } = env;
  const mine = mk(db, { email: 'mine@x.iq' });
  qualifyLead(db, { ...CTX, lead_id: mine.id });
  // Another company cannot convert it even knowing the id.
  assert.throws(
    () => convertLead(db, { company_id: 'co_other', actor: 'u2', lead_id: mine.id }),
    (e) => e.code === 'LEAD_NOT_FOUND'
  );
  done(env);
  console.log('PASS: crossCompanyLeadIsInvisible');
}

async function main() {
  await testScopeIsRequired();
  await testValidation();
  await testNumberingIsScopedAndSequential();
  await testLeadLifecycle();
  await testOptimisticConcurrency();
  await testDuplicateDetectionBands();
  await testLeadMergeKeepsHistory();
  await testScoringIsExplainable();
  await testConversionCreatesParty();
  await testConversionReusesExactParty();
  await testConversionRefusesAmbiguousMatch();
  await testConversionGuardsAndAtomicity();
  await testConversionIdempotencyKey();
  await testCrossCompanyLeadIsInvisible();
  console.log('\nAll CRM domain tests passed.');
}

main().catch((e) => { console.error('FAIL:', e); process.exitCode = 1; });
