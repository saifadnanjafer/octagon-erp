import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const workspace = fs.readFileSync('modules/build12-workspaces.js', 'utf8');
const styles = fs.readFileSync('modules/build12-workspaces.css', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');
const authority = fs.readFileSync('platform/build12/index.mjs', 'utf8');
const migration = fs.readFileSync('database/migrations/089_build12_ai_people_marketing_events_pack.mjs', 'utf8');
const pages = ['ai_overview','ai_assistant','ai_proposal_inbox','ai_run_history','ai_policy_registry','ai_prompt_templates','ai_context_sources','people_development_overview','skills_catalog','competency_profiles','person_skill_evidence','development_plans','learning_and_certifications','marketing_overview','campaigns','content_calendar','content_approvals','attribution_insights','events_overview','event_planner','event_registrations','event_checkin','vertical_packs','workshop_pack_setup'];
const renderers = ['renderAiOverview','renderAiAssistant','renderAiProposalInbox','renderAiRunHistory','renderAiPolicyRegistry','renderAiPromptTemplates','renderAiContextSources','renderPeopleOverview','renderSkillsCatalog','renderCompetencyProfiles','renderSkillEvidence','renderDevelopmentPlans','renderLearningCertifications','renderMarketingOverview','renderCampaigns','renderContentCalendar','renderContentApprovals','renderAttributionInsights','renderEventsOverview','renderEventPlanner','renderEventRegistrations','renderEventCheckin','renderVerticalPacks','renderWorkshopPackSetup'];

test('BUILD-12 exposes 24 distinct purpose-built renderers and nav entries', () => {
  assert.equal(pages.length, 24);
  assert.equal(new Set(renderers).size, pages.length);
  for (const page of pages) { assert.match(workspace, new RegExp(`${page}:`)); assert.match(index, new RegExp(`data-page="${page}"`)); }
  for (const renderer of renderers) assert.match(workspace, new RegExp(`function ${renderer}\\b`));
  assert.match(workspace, /const RENDERERS = \{/);
});

test('BUILD-12 normal UI is guided and does not expose raw JSON authority input', () => {
  assert.doesNotMatch(workspace, /<textarea|Manifest JSON|name=["']manifest["']/i);
  for (const marker of ['deterministic simulator','Bounded context','No autonomous execution','Human review','SIMULATION']) assert.match(workspace, new RegExp(marker, 'i'));
  for (const field of ['context_refs','risk_class','max_context_rows','employee_id','audience_id','attendee_email','registration_id','tenant_id']) assert.match(workspace, new RegExp(`['"]${field}['"]`));
  assert.match(styles, /focus-visible/); assert.match(styles, /max-width:720px/);
});

test('BUILD-12 visible actions are registered, permissioned, and bounded', () => {
  const actions = ['ai:task_run','ai:proposal_create','ai:proposal_approve','ai:proposal_reject','people:skill_create','people:evidence_record','people:development_plan_create','marketing:campaign_create','marketing:content_approve','marketing:attribution_simulate','events:event_create','events:registration_create','events:checkin','packs:validate','packs:stage','packs:enable','packs:disable','packs:rollback'];
  for (const action of actions) { assert.match(authority, new RegExp(`register\\('${action.replace(':', '\\:')}`)); assert.match(migration, new RegExp(`\\['${action.replace(':', '\\:')}`)); }
  assert.match(authority, /autonomous_execution: false/); assert.match(authority, /ai_usage/); assert.match(authority, /blocked_instructions/);
});

test('BUILD-12 preserves vertical and cross-domain safety boundaries', () => {
  assert.match(workspace, /Simulation only/); assert.match(workspace, /employee attendance/); assert.match(workspace, /No arbitrary code/);
  assert.match(authority, /canonical sales data unchanged/i); assert.match(authority, /assertSelfOrManager/);
  assert.match(migration, /build12_pack_profiles/); assert.match(migration, /ai_proposal_reviews/);
});
