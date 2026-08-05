'use strict';

import crypto from 'node:crypto';
import {
  evaluateEntitlement,
  recordUsage,
  validatePackage,
  approvePackage,
  stagePackage,
  setPackageState,
} from '../build11/index.mjs';

export const AI_RISK_CLASSES = ['LOW', 'MEDIUM', 'HIGH', 'PROHIBITED'];
export const AI_RUN_STATES = ['requested', 'context_preparing', 'blocked', 'queued', 'running', 'completed', 'failed', 'cancelled', 'expired'];
export const PROPOSAL_STATES = ['draft', 'generated', 'review_required', 'approved', 'rejected', 'expired', 'withdrawn', 'applied', 'application_failed'];
export const CONTENT_STATES = ['draft', 'submitted', 'approved', 'rejected', 'withdrawn'];
export const EVENT_STATES = ['draft', 'published', 'ongoing', 'completed', 'cancelled'];
export const PACK_STATES = ['staged', 'installed_disabled', 'enabled', 'disabled', 'rollback_pending', 'rolled_back'];

export class Build12Error extends Error {
  constructor(message, code, details = {}, statusCode = 422) {
    super(message);
    this.name = 'Build12Error';
    this.code = code;
    this.details = details;
    this.statusCode = statusCode;
  }
}

function id(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function timestamp(ctx) { return ctx?.now || new Date().toISOString(); }
function actor(ctx) { return String(ctx?.userId || ctx?.actorId || 'system'); }
function tenant(input, ctx) {
  const value = String(input?.tenant_id || input?.tenantId || ctx?.tenantId || '').trim();
  if (!value) throw new Build12Error('tenant scope is required', 'TENANT_SCOPE_REQUIRED', {}, 403);
  if (ctx?.tenantId && ctx.tenantId !== value) throw new Build12Error('tenant is outside the verified session scope', 'TENANT_SCOPE_VIOLATION', { tenantId: value }, 403);
  return value;
}
function required(value, field) {
  const result = String(value ?? '').trim();
  if (!result) throw new Build12Error(`${field} is required`, 'BUILD12_INVALID_INPUT', { field });
  return result;
}
function parse(value, fallback) { try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; } }
function json(value) { return JSON.stringify(value == null ? {} : value); }
function sha(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function row(db, sql, ...args) { return db.prepare(sql).get(...args); }
function rows(db, sql, ...args) { return db.prepare(sql).all(...args); }
function tenantExists(db, tenantId) {
  if (!row(db, 'SELECT 1 FROM platform_tenants WHERE id=?', tenantId)) throw new Build12Error('Tenant was not found', 'TENANT_NOT_FOUND', { tenantId }, 404);
}
function assertTenant(db, input, ctx) { const tenantId = tenant(input, ctx); tenantExists(db, tenantId); return tenantId; }
function assertSelfOrManager(input, ctx) {
  const personId = required(input.person_id || input.personId, 'person_id');
  if (ctx?.isManager || ctx?.isPlatformAdmin || ctx?.role === 'manager') return personId;
  if (ctx?.userId !== personId) throw new Build12Error('Only the person or an authorized manager may view this record', 'PEOPLE_SCOPE_DENIED', {}, 403);
  return personId;
}
function entitlement(db, ctx, capability, options = {}) {
  const result = evaluateEntitlement(db, ctx, capability, { ...options, mutation: options.mutation !== false });
  if (!result.allowed) throw new Build12Error(result.explanation, result.reasonCode, result, 403);
  return result;
}
function taskFor(db, taskId) {
  const task = row(db, 'SELECT * FROM ai_tasks WHERE task_id=?', taskId);
  if (!task) throw new Build12Error('Unknown AI task', 'AI_TASK_UNKNOWN', { taskId }, 403);
  return task;
}
function providerFor(db, providerId) {
  const provider = row(db, 'SELECT * FROM ai_providers WHERE id=? OR provider_id=?', providerId, providerId);
  if (!provider || !provider.enabled) throw new Build12Error('Provider/model is disabled', 'AI_PROVIDER_DISABLED', { providerId }, 403);
  return provider;
}
function taskClassification(task) { return parse(task.allowed_data_classifications, ['public', 'internal']); }
function containsInjection(value) {
  return /ignore\s+(all\s+)?previous|system\s+prompt|reveal\s+(the\s+)?secret|password|api[_ -]?key|access\s+token|grant\s+permission|execute\s+code/i.test(String(value || ''));
}
function contextPolicy(task, input, ctx) {
  const sources = Array.isArray(input.context_sources || input.contextSources) ? (input.context_sources || input.contextSources) : [];
  const allowed = taskClassification(task);
  const max = Math.min(Number(task.max_context) || 50, 50);
  if (sources.length > max) throw new Build12Error('AI context exceeds the registered bound', 'AI_CONTEXT_TOO_LARGE', { maxContext: max }, 422);
  const accepted = [];
  const blocked = [];
  for (const source of sources) {
    const classification = String(source.classification || 'internal');
    const content = String(source.content || source.text || '');
    const injection = containsInjection(content);
    if (!allowed.includes(classification) || injection || source.tenant_id && source.tenant_id !== ctx.tenantId) {
      blocked.push({ source_label: String(source.source_label || source.sourceLabel || 'unlabelled'), reason: injection ? 'UNTRUSTED_INSTRUCTION' : 'CLASSIFICATION_OR_SCOPE_DENIED' });
      continue;
    }
    accepted.push({ source_type: String(source.source_type || 'registered'), source_label: String(source.source_label || source.sourceLabel || 'source'), classification, row_count: Math.min(Number(source.row_count) || 1, 100), content_hash: sha(content), redacted_fields: Array.isArray(source.redacted_fields) ? source.redacted_fields : ['password', 'token', 'secret'], blocked_instructions: [] });
  }
  if (blocked.length && input.require_all_context) throw new Build12Error('One or more context sources were blocked by AI policy', 'AI_CONTEXT_BLOCKED', { blocked }, 403);
  return { accepted, blocked };
}
function deterministicOutput(task, input, accepted, ctx) {
  const labels = accepted.map((source) => source.source_label);
  const summary = labels.length ? `Deterministic ${task.task_id} completed for ${labels.length} authorized source(s).` : `Deterministic ${task.task_id} completed with no external source rows.`;
  return { task: task.task_id, summary, references: labels, recommendation: task.risk_class === 'LOW' ? 'Informational only.' : 'Review required before any canonical action.', generated_at: timestamp(ctx), simulator: 'octagon-deterministic-v1', autonomous_execution: false };
}

export function upsertAiProvider(db, input, ctx) {
  const providerId = required(input.provider_id || input.providerId, 'provider_id');
  const modelId = required(input.model_id || input.modelId, 'model_id');
  const now = timestamp(ctx);
  db.prepare(`INSERT INTO ai_providers(id,provider_id,model_id,display_name,capability_class,context_window,cost_unit,enabled,deployment_profile,data_residency,allowed_data_classifications,simulator_state,health_state,supported_modalities,rate_policy,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(provider_id,model_id) DO UPDATE SET display_name=excluded.display_name,enabled=excluded.enabled,updated_at=excluded.updated_at`)
    .run(input.id || id('ai_provider'), providerId, modelId, required(input.display_name || input.displayName || modelId, 'display_name'), input.capability_class || 'advisory', Number(input.context_window || 4096), input.cost_unit || 'simulated_unit', input.enabled === true ? 1 : 0, input.deployment_profile || 'simulator', input.data_residency || 'internal', json(input.allowed_data_classifications || ['public', 'internal']), input.simulator_state || 'deterministic', input.health_state || 'healthy', json(input.supported_modalities || ['text']), json(input.rate_policy || {}), now, now);
  return row(db, 'SELECT * FROM ai_providers WHERE provider_id=? AND model_id=?', providerId, modelId);
}

export function upsertAiPolicy(db, input, ctx) {
  const tenantId = assertTenant(db, input, ctx);
  const now = timestamp(ctx);
  const risk = String(input.risk_class || input.riskClass || 'LOW').toUpperCase();
  if (!AI_RISK_CLASSES.includes(risk)) throw new Build12Error('Unknown AI risk class', 'AI_RISK_INVALID');
  db.prepare(`INSERT INTO ai_policies(id,tenant_id,name,risk_class,allow_external_content,max_context_rows,require_review,blocked_actions,enabled,created_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,risk_class=excluded.risk_class,allow_external_content=excluded.allow_external_content,max_context_rows=excluded.max_context_rows,require_review=excluded.require_review,blocked_actions=excluded.blocked_actions,enabled=excluded.enabled,updated_at=excluded.updated_at`)
    .run(input.id || id('ai_policy'), tenantId, required(input.name, 'name'), risk, input.allow_external_content === true ? 1 : 0, Math.min(Number(input.max_context_rows || 50), 50), input.require_review === false ? 0 : 1, json(input.blocked_actions || []), input.enabled === false ? 0 : 1, actor(ctx), now, now);
  return row(db, 'SELECT * FROM ai_policies WHERE tenant_id=? ORDER BY updated_at DESC LIMIT 1', tenantId);
}

export function runAiTask(db, input, ctx) {
  const tenantId = assertTenant(db, input, ctx);
  const taskId = required(input.task_id || input.taskId, 'task_id');
  const task = taskFor(db, taskId);
  if (task.risk_class === 'PROHIBITED') throw new Build12Error('Prohibited AI task cannot run', 'AI_TASK_PROHIBITED', { taskId }, 403);
  entitlement(db, ctx, task.required_entitlement || 'module:ai');
  const key = required(input.idempotency_key || input.idempotencyKey || ctx?.idempotencyKey, 'idempotency_key');
  const existing = row(db, 'SELECT * FROM ai_runs WHERE tenant_id=? AND task_id=? AND idempotency_key=?', tenantId, taskId, key);
  if (existing) return { ...existing, context_references: parse(existing.context_references, []), output_payload: parse(existing.output_payload, null), replayed: true };
  const provider = providerFor(db, input.provider_id || input.providerId || 'ai_provider_simulator');
  const policy = contextPolicy(task, input, ctx);
  const now = timestamp(ctx);
  const runId = input.run_id || id('ai_run');
  const inputUnits = Math.max(1, Number(input.input_units || JSON.stringify(input).length));
  const outputUnits = 1;
  const runBase = { id: runId, tenant_id: tenantId, actor_id: actor(ctx), task_id: taskId, provider_id: provider.provider_id, model_id: provider.model_id, prompt_template_version: input.prompt_template_version || '1.0.0', context_references: policy.accepted, input_hash: sha(input), output_hash: null, policy_decision: { risk_class: task.risk_class, blocked_sources: policy.blocked, review_required: task.human_review_policy !== 'none', autonomous_execution: false }, risk_class: task.risk_class, status: 'blocked', input_units: inputUnits, output_units: 0, simulated_cost_units: 0, idempotency_key: key, correlation_id: ctx?.correlationId || id('corr'), error_code: null, started_at: now, ended_at: now, created_at: now };
  if (!policy.accepted.length && policy.blocked.length) {
    db.prepare(`INSERT INTO ai_runs(id,tenant_id,actor_id,task_id,provider_id,model_id,prompt_template_version,context_references,input_hash,output_hash,output_payload,policy_decision,risk_class,status,input_units,output_units,simulated_cost_units,idempotency_key,correlation_id,error_code,started_at,ended_at,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(runBase.id,runBase.tenant_id,runBase.actor_id,runBase.task_id,runBase.provider_id,runBase.model_id,runBase.prompt_template_version,json(runBase.context_references),runBase.input_hash,null,null,json(runBase.policy_decision),runBase.risk_class,'blocked',runBase.input_units,0,0,runBase.idempotency_key,runBase.correlation_id,'AI_CONTEXT_BLOCKED',now,now,now);
    return row(db, 'SELECT * FROM ai_runs WHERE id=?', runId);
  }
  const usage = recordUsage(db, { tenant_id: tenantId, metric: 'ai_usage', quantity: inputUnits + outputUnits, unit: 'simulated_units', source: 'build12_ai_simulator', idempotency_key: `ai_usage:${key}` }, ctx);
  const output = deterministicOutput(task, input, policy.accepted, ctx);
  db.prepare(`INSERT INTO ai_runs(id,tenant_id,actor_id,task_id,provider_id,model_id,prompt_template_version,context_references,input_hash,output_hash,output_payload,policy_decision,risk_class,status,input_units,output_units,simulated_cost_units,idempotency_key,correlation_id,error_code,started_at,ended_at,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(runBase.id,runBase.tenant_id,runBase.actor_id,runBase.task_id,runBase.provider_id,runBase.model_id,runBase.prompt_template_version,json(runBase.context_references),runBase.input_hash,sha(output),json(output),json({ ...runBase.policy_decision, usage: usage.counter || usage }),runBase.risk_class,'completed',inputUnits,outputUnits,Number(inputUnits + outputUnits),runBase.idempotency_key,runBase.correlation_id,null,now,now,now);
  for (const source of policy.accepted) db.prepare(`INSERT INTO ai_context_sources(id,tenant_id,run_id,source_type,source_label,classification,content_hash,row_count,redacted_fields,blocked_instructions,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id('ai_context'), tenantId, runId, source.source_type, source.source_label, source.classification, source.content_hash, source.row_count, json(source.redacted_fields), json(source.blocked_instructions), now);
  return { ...row(db, 'SELECT * FROM ai_runs WHERE id=?', runId), output_payload: output, context_references: policy.accepted };
}

export function createAiProposal(db, input, ctx) {
  const tenantId = assertTenant(db, input, ctx);
  const run = row(db, 'SELECT * FROM ai_runs WHERE id=? AND tenant_id=?', required(input.run_id || input.runId, 'run_id'), tenantId);
  if (!run || run.status !== 'completed') throw new Build12Error('A completed AI run is required', 'AI_RUN_NOT_COMPLETED', {}, 409);
  const task = taskFor(db, run.task_id);
  const now = timestamp(ctx);
  const status = task.risk_class === 'LOW' ? 'generated' : 'review_required';
  const proposal = { id: input.id || id('ai_proposal'), tenant_id: tenantId, run_id: run.id, proposal_type: input.proposal_type || task.proposal_type || run.task_id, summary: required(input.summary || parse(run.output_payload, {}).summary || 'AI-generated proposal', 'summary'), payload: json(input.payload || parse(run.output_payload, {})), target_authority: input.target_authority || task.canonical_target, risk_class: task.risk_class, reviewer_required: status === 'review_required' ? 1 : 0, expires_at: input.expires_at || new Date(Date.now() + Number(task.retention_days || 30) * 86400000).toISOString(), status, created_by: actor(ctx), reviewer_id: null, decision_reason: null, created_at: now, updated_at: now };
  db.prepare(`INSERT INTO ai_proposals(id,tenant_id,run_id,proposal_type,summary,payload,target_authority,risk_class,reviewer_required,expires_at,status,created_by,reviewer_id,decision_reason,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(proposal.id,proposal.tenant_id,proposal.run_id,proposal.proposal_type,proposal.summary,proposal.payload,proposal.target_authority,proposal.risk_class,proposal.reviewer_required,proposal.expires_at,proposal.status,proposal.created_by,null,null,now,now);
  return row(db, 'SELECT * FROM ai_proposals WHERE id=?', proposal.id);
}

export function reviewAiProposal(db, input, ctx, decision) {
  const tenantId = assertTenant(db, input, ctx);
  const proposal = row(db, 'SELECT * FROM ai_proposals WHERE id=? AND tenant_id=?', required(input.proposal_id || input.proposalId, 'proposal_id'), tenantId);
  if (!proposal) throw new Build12Error('AI proposal was not found', 'AI_PROPOSAL_NOT_FOUND', {}, 404);
  if (proposal.created_by === actor(ctx)) throw new Build12Error('AI proposal maker cannot self-approve', 'AI_SELF_APPROVAL_DENIED', {}, 403);
  if (!['review_required', 'generated'].includes(proposal.status)) throw new Build12Error('AI proposal is not awaiting review', 'AI_PROPOSAL_STATE_INVALID', { status: proposal.status }, 409);
  const result = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'revision_requested';
  const now = timestamp(ctx);
  db.prepare('INSERT INTO ai_proposal_reviews(id,proposal_id,tenant_id,reviewer_id,decision,reason,created_at) VALUES(?,?,?,?,?,?,?)').run(id('ai_review'), proposal.id, tenantId, actor(ctx), result, required(input.reason || (result === 'approved' ? 'Approved after human review' : 'Review decision'), 'reason'), now);
  db.prepare('UPDATE ai_proposals SET status=?,reviewer_id=?,decision_reason=?,updated_at=? WHERE id=?').run(result === 'revision_requested' ? 'review_required' : result, actor(ctx), input.reason || null, now, proposal.id);
  return row(db, 'SELECT * FROM ai_proposals WHERE id=?', proposal.id);
}
export function withdrawAiProposal(db, input, ctx) { const tenantId = assertTenant(db, input, ctx); const p = row(db, 'SELECT * FROM ai_proposals WHERE id=? AND tenant_id=?', required(input.proposal_id || input.proposalId, 'proposal_id'), tenantId); if (!p) throw new Build12Error('AI proposal not found', 'AI_PROPOSAL_NOT_FOUND', {}, 404); if (p.created_by !== actor(ctx)) throw new Build12Error('Only the proposal author can withdraw it', 'AI_PROPOSAL_SCOPE_DENIED', {}, 403); db.prepare('UPDATE ai_proposals SET status=\'withdrawn\',updated_at=? WHERE id=?').run(timestamp(ctx), p.id); return row(db, 'SELECT * FROM ai_proposals WHERE id=?', p.id); }
export function recordAiFeedback(db, input, ctx) { const tenantId = assertTenant(db, input, ctx); const rating = required(input.rating, 'rating'); if (!['useful','partially_useful','incorrect','unsafe','outdated','missing_context'].includes(rating)) throw new Build12Error('Invalid AI feedback rating', 'AI_FEEDBACK_INVALID'); const now = timestamp(ctx); db.prepare('INSERT INTO ai_feedback(id,tenant_id,run_id,proposal_id,actor_id,rating,comment,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id('ai_feedback'),tenantId,input.run_id || null,input.proposal_id || null,actor(ctx),rating,input.comment || null,now); return row(db,'SELECT * FROM ai_feedback WHERE tenant_id=? ORDER BY created_at DESC LIMIT 1',tenantId); }

export function createSkill(db, input, ctx) { const tenantId=assertTenant(db,input,ctx); const now=timestamp(ctx); const code=required(input.code,'code'); db.prepare('INSERT INTO people_skills(id,tenant_id,code,name,description,level_scale,status,version,created_at,updated_at) VALUES(?,?,?,?,?,?,\'active\',1,?,?)').run(input.id||id('skill'),tenantId,code,required(input.name,'name'),input.description||null,json(input.level_scale||{min:0,max:5}),now,now); return row(db,'SELECT * FROM people_skills WHERE tenant_id=? AND code=?',tenantId,code); }
export function recordSkillEvidence(db,input,ctx) { const tenantId=assertTenant(db,input,ctx); const personId=assertSelfOrManager(input,ctx); const skill=required(input.skill_id||input.skillId,'skill_id'); if(!row(db,'SELECT 1 FROM people_skills WHERE id=? AND tenant_id=?',skill,tenantId)) throw new Build12Error('Skill not found','PEOPLE_SKILL_NOT_FOUND',{},404); const now=timestamp(ctx); const evidence={id:input.id||id('skill_evidence'),tenant_id:tenantId,person_id:personId,skill_id:skill,evidence_type:required(input.evidence_type||input.evidenceType,'evidence_type'),description:required(input.description,'description'),source_ref:input.source_ref||null,observed_at:input.observed_at||now,created_by:actor(ctx),created_at:now}; db.prepare('INSERT INTO people_skill_evidence(id,tenant_id,person_id,skill_id,evidence_type,description,source_ref,observed_at,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(...Object.values(evidence)); db.prepare(`INSERT INTO people_competencies(id,tenant_id,person_id,skill_id,level,visibility,version,updated_at) VALUES(?,?,?,?,?,?,1,?) ON CONFLICT(tenant_id,person_id,skill_id) DO UPDATE SET level=MIN(people_competencies.level+1,5),version=people_competencies.version+1,updated_at=excluded.updated_at`).run(id('competency'),tenantId,personId,skill,Number(input.level||1),input.visibility||'team',now); return evidence; }
export function createDevelopmentPlan(db,input,ctx) { const tenantId=assertTenant(db,input,ctx); const personId=assertSelfOrManager(input,ctx); entitlement(db,ctx,'capability:advanced_people_development'); const now=timestamp(ctx); const plan={id:input.id||id('development_plan'),tenant_id:tenantId,person_id:personId,title:required(input.title,'title'),objective:required(input.objective,'objective'),status:'draft',due_at:input.due_at||null,owner_id:actor(ctx),ai_proposal_id:input.ai_proposal_id||null,created_at:now,updated_at:now}; db.prepare('INSERT INTO people_development_plans(id,tenant_id,person_id,title,objective,status,due_at,owner_id,ai_proposal_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(...Object.values(plan)); for(const step of (input.steps||[])) db.prepare('INSERT INTO people_development_steps(id,plan_id,title,status,due_at,evidence_required,created_at) VALUES(?,?,?,\'planned\',?,?,?)').run(id('development_step'),plan.id,required(step.title,'step.title'),step.due_at||null,step.evidence_required?1:0,now); return row(db,'SELECT * FROM people_development_plans WHERE id=?',plan.id); }
export function transitionDevelopmentPlan(db,input,ctx) { const tenantId=assertTenant(db,input,ctx); const p=row(db,'SELECT * FROM people_development_plans WHERE id=? AND tenant_id=?',required(input.plan_id||input.planId,'plan_id'),tenantId); if(!p) throw new Build12Error('Development plan not found','PEOPLE_PLAN_NOT_FOUND',{},404); assertSelfOrManager({person_id:p.person_id},ctx); const next=required(input.to_status||input.toStatus,'to_status'); if(!['draft','active','completed','cancelled'].includes(next)) throw new Build12Error('Invalid development plan state','PEOPLE_PLAN_STATE_INVALID'); db.prepare('UPDATE people_development_plans SET status=?,updated_at=? WHERE id=?').run(next,timestamp(ctx),p.id); return row(db,'SELECT * FROM people_development_plans WHERE id=?',p.id); }
export function createLearningRecord(db,input,ctx) { const tenantId=assertTenant(db,input,ctx); const personId=assertSelfOrManager(input,ctx); const now=timestamp(ctx); db.prepare('INSERT INTO people_learning_records(id,tenant_id,person_id,course,provider,status,completed_at,evidence_ref,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(input.id||id('learning'),tenantId,personId,required(input.course,'course'),input.provider||null,input.status||'planned',input.completed_at||null,input.evidence_ref||null,actor(ctx),now); return row(db,'SELECT * FROM people_learning_records WHERE tenant_id=? ORDER BY created_at DESC LIMIT 1',tenantId); }
export function createCertification(db,input,ctx) { const tenantId=assertTenant(db,input,ctx); const personId=assertSelfOrManager(input,ctx); const now=timestamp(ctx); db.prepare('INSERT INTO people_certifications(id,tenant_id,person_id,name,expires_at,status,evidence_ref,created_by,created_at) VALUES(?,?,?,?,?,\'active\',?,?,?)').run(input.id||id('certification'),tenantId,personId,required(input.name,'name'),required(input.expires_at||input.expiresAt,'expires_at'),input.evidence_ref||null,actor(ctx),now); return row(db,'SELECT * FROM people_certifications WHERE tenant_id=? ORDER BY created_at DESC LIMIT 1',tenantId); }

export function createAudience(db,input,ctx) { const tenantId=assertTenant(db,input,ctx); const now=timestamp(ctx); db.prepare('INSERT INTO marketing_audiences(id,tenant_id,name,consent_basis,criteria,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,\'draft\',?,?,?)').run(input.id||id('audience'),tenantId,required(input.name,'name'),required(input.consent_basis||input.consentBasis,'consent_basis'),json(input.criteria||{}),actor(ctx),now,now); return row(db,'SELECT * FROM marketing_audiences WHERE tenant_id=? ORDER BY created_at DESC LIMIT 1',tenantId); }
export function createCampaign(db,input,ctx) { const tenantId=assertTenant(db,input,ctx); const now=timestamp(ctx); const c={id:input.id||id('campaign'),tenant_id:tenantId,name:required(input.name,'name'),status:'draft',audience_id:input.audience_id||null,objective:required(input.objective,'objective'),budget:Number(input.budget||0),simulation_label:'SIMULATION ONLY - NO EXTERNAL PUBLISHING',starts_at:input.starts_at||null,ends_at:input.ends_at||null,created_by:actor(ctx),created_at:now,updated_at:now}; db.prepare('INSERT INTO marketing_campaigns(id,tenant_id,name,status,audience_id,objective,budget,simulation_label,starts_at,ends_at,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...Object.values(c)); return row(db,'SELECT * FROM marketing_campaigns WHERE id=?',c.id); }
export function submitCampaign(db,input,ctx) { const tenantId=assertTenant(db,input,ctx); const c=row(db,'SELECT * FROM marketing_campaigns WHERE id=? AND tenant_id=?',required(input.campaign_id||input.campaignId,'campaign_id'),tenantId); if(!c) throw new Build12Error('Campaign not found','MARKETING_CAMPAIGN_NOT_FOUND',{},404); db.prepare('UPDATE marketing_campaigns SET status=\'review\',updated_at=? WHERE id=?').run(timestamp(ctx),c.id); return row(db,'SELECT * FROM marketing_campaigns WHERE id=?',c.id); }
export function createContent(db,input,ctx) { const tenantId=assertTenant(db,input,ctx); const now=timestamp(ctx); if(!row(db,'SELECT 1 FROM marketing_campaigns WHERE id=? AND tenant_id=?',required(input.campaign_id||input.campaignId,'campaign_id'),tenantId)) throw new Build12Error('Campaign not found','MARKETING_CAMPAIGN_NOT_FOUND',{},404); const c={id:input.id||id('content'),tenant_id:tenantId,campaign_id:input.campaign_id||input.campaignId,title:required(input.title,'title'),body:required(input.body,'body'),channel:required(input.channel,'channel'),status:'draft',created_by:actor(ctx),approved_by:null,created_at:now,updated_at:now}; db.prepare('INSERT INTO marketing_content(id,tenant_id,campaign_id,title,body,channel,status,created_by,approved_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(...Object.values(c)); return row(db,'SELECT * FROM marketing_content WHERE id=?',c.id); }
export function submitContent(db,input,ctx) { const tenantId=assertTenant(db,input,ctx); const c=row(db,'SELECT * FROM marketing_content WHERE id=? AND tenant_id=?',required(input.content_id||input.contentId,'content_id'),tenantId); if(!c) throw new Build12Error('Content not found','MARKETING_CONTENT_NOT_FOUND',{},404); db.prepare('UPDATE marketing_content SET status=\'submitted\',updated_at=? WHERE id=?').run(timestamp(ctx),c.id); return row(db,'SELECT * FROM marketing_content WHERE id=?',c.id); }
export function reviewContent(db,input,ctx,decision='approved') { const tenantId=assertTenant(db,input,ctx); const c=row(db,'SELECT * FROM marketing_content WHERE id=? AND tenant_id=?',required(input.content_id||input.contentId,'content_id'),tenantId); if(!c) throw new Build12Error('Content not found','MARKETING_CONTENT_NOT_FOUND',{},404); if(c.created_by===actor(ctx)) throw new Build12Error('Content maker cannot self-approve','MARKETING_SELF_APPROVAL_DENIED',{},403); const now=timestamp(ctx); db.prepare('INSERT INTO marketing_content_reviews(id,tenant_id,content_id,reviewer_id,decision,reason,created_at) VALUES(?,?,?,?,?,?,?)').run(id('content_review'),tenantId,c.id,actor(ctx),decision,required(input.reason||'Human content review','reason'),now); db.prepare('UPDATE marketing_content SET status=?,approved_by=?,updated_at=? WHERE id=?').run(decision==='approved'?'approved':decision==='rejected'?'rejected':'submitted',decision==='approved'?actor(ctx):null,now,c.id); return row(db,'SELECT * FROM marketing_content WHERE id=?',c.id); }
export function simulateAttribution(db,input,ctx) { const tenantId=assertTenant(db,input,ctx); const now=timestamp(ctx); if(!row(db,'SELECT 1 FROM marketing_campaigns WHERE id=? AND tenant_id=?',required(input.campaign_id||input.campaignId,'campaign_id'),tenantId)) throw new Build12Error('Campaign not found','MARKETING_CAMPAIGN_NOT_FOUND',{},404); db.prepare('INSERT INTO marketing_attribution(id,tenant_id,campaign_id,source,medium,leads,conversions,simulated_revenue,simulation_label,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id('attribution'),tenantId,input.campaign_id||input.campaignId,required(input.source,'source'),required(input.medium,'medium'),Number(input.leads||0),Number(input.conversions||0),Number(input.simulated_revenue||0),'SIMULATION ONLY - CANONICAL SALES DATA UNCHANGED',now); db.prepare('UPDATE marketing_campaigns SET status=\'simulated\',updated_at=? WHERE id=?').run(now,input.campaign_id||input.campaignId); return row(db,'SELECT * FROM marketing_attribution WHERE tenant_id=? ORDER BY created_at DESC LIMIT 1',tenantId); }

export function createEvent(db,input,ctx) { const tenantId=assertTenant(db,input,ctx); const now=timestamp(ctx); const e={id:input.id||id('event'),tenant_id:tenantId,name:required(input.name,'name'),status:'draft',description:input.description||null,venue:input.venue||null,capacity:Math.max(0,Number(input.capacity||0)),starts_at:required(input.starts_at||input.startsAt,'starts_at'),ends_at:required(input.ends_at||input.endsAt,'ends_at'),created_by:actor(ctx),created_at:now,updated_at:now}; if(new Date(e.ends_at)<=new Date(e.starts_at)) throw new Build12Error('Event end must follow start','EVENT_TIME_INVALID'); db.prepare('INSERT INTO build12_events(id,tenant_id,name,status,description,venue,capacity,starts_at,ends_at,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(...Object.values(e)); return row(db,'SELECT * FROM build12_events WHERE id=?',e.id); }
export function createSession(db,input,ctx) { const tenantId=assertTenant(db,input,ctx); const eventId=required(input.event_id||input.eventId,'event_id'); if(!row(db,'SELECT 1 FROM build12_events WHERE id=? AND tenant_id=?',eventId,tenantId)) throw new Build12Error('Event not found','EVENT_NOT_FOUND',{},404); const now=timestamp(ctx); const s={id:input.id||id('event_session'),tenant_id:tenantId,event_id:eventId,title:required(input.title,'title'),speaker:input.speaker||null,starts_at:required(input.starts_at||input.startsAt,'starts_at'),ends_at:required(input.ends_at||input.endsAt,'ends_at'),capacity:input.capacity==null?null:Number(input.capacity),created_at:now}; if(new Date(s.ends_at)<=new Date(s.starts_at)) throw new Build12Error('Session end must follow start','EVENT_SESSION_TIME_INVALID'); db.prepare('INSERT INTO build12_event_sessions(id,tenant_id,event_id,title,speaker,starts_at,ends_at,capacity,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(...Object.values(s)); return row(db,'SELECT * FROM build12_event_sessions WHERE id=?',s.id); }
export function registerAttendee(db,input,ctx) { const tenantId=assertTenant(db,input,ctx); const eventId=required(input.event_id||input.eventId,'event_id'); const e=row(db,'SELECT * FROM build12_events WHERE id=? AND tenant_id=?',eventId,tenantId); if(!e) throw new Build12Error('Event not found','EVENT_NOT_FOUND',{},404); const email=String(input.attendee_email||input.attendeeEmail||'').trim()||null; if(email && row(db,'SELECT 1 FROM build12_event_registrations WHERE tenant_id=? AND event_id=? AND attendee_email=? AND status<>\'cancelled\'',tenantId,eventId,email)) throw new Build12Error('Attendee is already registered','EVENT_DUPLICATE_REGISTRATION',{},409); const booked=Number(row(db,"SELECT COUNT(*) AS n FROM build12_event_registrations WHERE event_id=? AND status IN ('registered','checked_in')",eventId)?.n||0); const status=booked>=Number(e.capacity)?'waitlisted':'registered'; const now=timestamp(ctx); const r={id:input.id||id('registration'),tenant_id:tenantId,event_id:eventId,session_id:input.session_id||null,attendee_name:required(input.attendee_name||input.attendeeName,'attendee_name'),attendee_email:email,status,checked_in_at:null,registered_at:now}; db.prepare('INSERT INTO build12_event_registrations(id,tenant_id,event_id,session_id,attendee_name,attendee_email,status,checked_in_at,registered_at) VALUES(?,?,?,?,?,?,?,?,?)').run(...Object.values(r)); return row(db,'SELECT * FROM build12_event_registrations WHERE id=?',r.id); }
export function checkinAttendee(db,input,ctx) { const tenantId=assertTenant(db,input,ctx); const r=row(db,'SELECT * FROM build12_event_registrations WHERE id=? AND tenant_id=?',required(input.registration_id||input.registrationId,'registration_id'),tenantId); if(!r) throw new Build12Error('Registration not found','EVENT_REGISTRATION_NOT_FOUND',{},404); if(r.status==='checked_in') return r; if(r.status==='waitlisted' || r.status==='cancelled') throw new Build12Error('Only an active registration can check in','EVENT_CHECKIN_NOT_ALLOWED',{},409); db.prepare('UPDATE build12_event_registrations SET status=\'checked_in\',checked_in_at=? WHERE id=?').run(timestamp(ctx),r.id); return row(db,'SELECT * FROM build12_event_registrations WHERE id=?',r.id); }

function warshaManifest(input) { return { package_id: 'pack:al_warsha', publisher: 'octagon', name: 'Al-Warsha Vertical Operating Pack', version: input.version || '1.0.0', compatibility_range: input.compatibility_range || '>=12.0.0', manifest_version: '1', provenance: 'curated', checksum: input.checksum || 'sha256:al-warsha-curated', signature: input.signature || 'signed:octagon-curated', permissions_requested: ['platform:packs:install','platform:packs:enable'], contributions: [{ type: 'terminology_overlay' }, { type: 'workflow_template' }, { type: 'view_metadata' }] }; }
export function validateWarshaPack(db,input,ctx) { assertTenant(db,input,ctx); const result=validatePackage(db,{manifest:warshaManifest(input)},ctx); return { ...result, package_id:'pack:al_warsha', safety:'No arbitrary code, runtime DDL, stock, GL, production, quality, or employee attendance mutation.' }; }
export function approveWarshaPack(db,input,ctx) { assertTenant(db,input,ctx); return approvePackage(db,{package_id:'pack:al_warsha'},ctx); }
export function stageWarshaPack(db,input,ctx) { const tenantId=assertTenant(db,input,ctx); const extension=stagePackage(db,{package_id:'pack:al_warsha',tenant_id:tenantId},ctx); const now=timestamp(ctx); db.prepare(`INSERT INTO build12_pack_installations(id,tenant_id,package_id,extension_installation_id,version,state,created_at,updated_at) VALUES(?,?,?,?,?,\'staged\',?,?) ON CONFLICT(tenant_id,package_id) DO UPDATE SET extension_installation_id=excluded.extension_installation_id,version=excluded.version,state=\'staged\',updated_at=excluded.updated_at`).run(id('pack_installation'),tenantId,'pack:al_warsha',extension.id,'1.0.0',now,now); return row(db,'SELECT * FROM build12_pack_installations WHERE tenant_id=? AND package_id=?',tenantId,'pack:al_warsha'); }
export function setWarshaPackState(db,input,ctx,state) { const tenantId=assertTenant(db,input,ctx); const installation=row(db,'SELECT * FROM build12_pack_installations WHERE id=? AND tenant_id=?',required(input.installation_id||input.installationId,'installation_id'),tenantId); if(!installation) throw new Build12Error('Pack installation not found','PACK_INSTALLATION_NOT_FOUND',{},404); const allowed={enable:['staged','installed_disabled','disabled'],disable:['enabled'],rollback:['enabled','disabled','installed_disabled']}[state]; if(!allowed?.includes(installation.state)) throw new Build12Error('Pack lifecycle transition is not allowed','PACK_STATE_INVALID',{from:installation.state,to:state},409); const next=state==='enable'?'enabled':state==='disable'?'disabled':'rollback_pending'; db.prepare('UPDATE build12_pack_installations SET state=?,previous_version=CASE WHEN ?=\'rollback_pending\' THEN version ELSE previous_version END,updated_at=? WHERE id=?').run(next,state,timestamp(ctx),installation.id); if(state==='enable') setPackageState(db,{installation_id:installation.extension_installation_id,tenant_id:tenantId},ctx,'enabled'); if(state==='disable') setPackageState(db,{installation_id:installation.extension_installation_id,tenant_id:tenantId},ctx,'disabled'); if(state==='rollback') { setPackageState(db,{installation_id:installation.extension_installation_id,tenant_id:tenantId},ctx,'rollback_pending'); db.prepare('UPDATE build12_pack_installations SET state=\'rolled_back\',updated_at=? WHERE id=?').run(timestamp(ctx),installation.id); } return row(db,'SELECT * FROM build12_pack_installations WHERE id=?',installation.id); }

function scoped(db, table, tenantId, order='created_at DESC', limit=200) { return rows(db, `SELECT * FROM ${table} WHERE tenant_id=? ORDER BY ${order} LIMIT ?`, tenantId, limit); }
export function listBuild12(db, ctx, resource, recordId, query = {}) {
  const tenantId = tenant(query, ctx);
  const read = (table, order) => recordId ? row(db, `SELECT * FROM ${table} WHERE id=? AND tenant_id=?`, recordId, tenantId) : scoped(db, table, tenantId, order);
  const globalRead = (table, order, key = 'id') => recordId ? row(db, `SELECT * FROM ${table} WHERE ${key}=?`, recordId) : rows(db, `SELECT * FROM ${table} ORDER BY ${order}`);
  if (resource === 'overview' || resource === 'ai-overview') return { data: { generated_at: timestamp(ctx), simulator: 'deterministic-v1', ai: { providers: rows(db,'SELECT * FROM ai_providers ORDER BY display_name'), tasks: rows(db,'SELECT * FROM ai_tasks ORDER BY task_id'), recent_runs: scoped(db,'ai_runs','tenant_id,created_at DESC',20), proposals: scoped(db,'ai_proposals','created_at DESC',20) }, people: { skills: scoped(db,'people_skills','name'), plans: scoped(db,'people_development_plans','updated_at DESC',20), certification_warnings: rows(db,"SELECT * FROM people_certifications WHERE tenant_id=? AND status='active' AND expires_at<=datetime('now','+30 day') ORDER BY expires_at",tenantId) }, marketing: { campaigns: scoped(db,'marketing_campaigns','updated_at DESC',20), content: scoped(db,'marketing_content','updated_at DESC',20) }, events: scoped(db,'build12_events','starts_at',20), pack: row(db,'SELECT * FROM build12_pack_profiles WHERE package_id=\'pack:al_warsha\'') } };
  const map = { 'ai-providers':'ai_providers','ai-tasks':'ai_tasks','ai-runs':'ai_runs','ai-context':'ai_context_sources','ai-policies':'ai_policies','ai-proposals':'ai_proposals','ai-feedback':'ai_feedback','people-skills':'people_skills','people-competencies':'people_competencies','people-evidence':'people_skill_evidence','development-plans':'people_development_plans','learning':'people_learning_records','certifications':'people_certifications','marketing-audiences':'marketing_audiences','marketing-campaigns':'marketing_campaigns','marketing-content':'marketing_content','marketing-attribution':'marketing_attribution','events':'build12_events','event-sessions':'build12_event_sessions','event-registrations':'build12_event_registrations','packs':'build12_pack_profiles','pack-installations':'build12_pack_installations' };
  if (map[resource]) {
    if (resource === 'ai-providers') return { data: globalRead('ai_providers', 'display_name') };
    if (resource === 'ai-tasks') return { data: globalRead('ai_tasks', 'task_id', 'task_id') };
    if (resource === 'packs') return { data: globalRead('build12_pack_profiles', 'name', 'package_id') };
    return { data: read(map[resource], resource.includes('events') ? 'starts_at' : 'created_at DESC') };
  }
  if (resource === 'readiness-profile') return { data: row(db,"SELECT readiness_categories,workflow_templates,terminology_overlay FROM build12_pack_profiles WHERE package_id='pack:al_warsha'") };
  if (resource === 'pack-kpis') return { data: parse(row(db,"SELECT kpi_catalog FROM build12_pack_profiles WHERE package_id='pack:al_warsha'")?.kpi_catalog,'[]') };
  return { error: 'BUILD-12 resource not found', status: 404 };
}

export function registerBuild12Actions(actionExecutor, db) {
  const register = (actionId, handler) => actionExecutor.registerHandler(actionId, ({ input, ctx }) => handler(db, input, ctx));
  register('ai:provider_upsert', upsertAiProvider); register('ai:policy_upsert', upsertAiPolicy); register('ai:task_run', runAiTask); register('ai:proposal_create', createAiProposal);
  register('ai:proposal_approve', (dbx,input,ctx)=>reviewAiProposal(dbx,input,ctx,'approve')); register('ai:proposal_reject',(dbx,input,ctx)=>reviewAiProposal(dbx,input,ctx,'reject')); register('ai:proposal_withdraw',withdrawAiProposal); register('ai:feedback_record',recordAiFeedback);
  register('people:skill_create',createSkill); register('people:evidence_record',recordSkillEvidence); register('people:development_plan_create',createDevelopmentPlan); register('people:development_transition',transitionDevelopmentPlan); register('people:learning_record',createLearningRecord); register('people:certification_record',createCertification);
  register('marketing:audience_create',createAudience); register('marketing:campaign_create',createCampaign); register('marketing:campaign_submit',submitCampaign); register('marketing:content_create',createContent); register('marketing:content_submit',submitContent); register('marketing:content_approve',(dbx,input,ctx)=>reviewContent(dbx,input,ctx,'approved')); register('marketing:attribution_simulate',simulateAttribution);
  register('events:event_create',createEvent); register('events:session_create',createSession); register('events:registration_create',registerAttendee); register('events:checkin',checkinAttendee);
  register('packs:validate',validateWarshaPack); register('packs:approve',approveWarshaPack); register('packs:stage',stageWarshaPack); register('packs:enable',(dbx,input,ctx)=>setWarshaPackState(dbx,input,ctx,'enable')); register('packs:disable',(dbx,input,ctx)=>setWarshaPackState(dbx,input,ctx,'disable')); register('packs:rollback',(dbx,input,ctx)=>setWarshaPackState(dbx,input,ctx,'rollback'));
}
