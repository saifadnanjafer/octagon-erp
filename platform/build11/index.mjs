'use strict';

import crypto from 'node:crypto';

export const BUILD11_METRICS = new Set([
  'api_calls', 'ai_usage', 'storage_bytes', 'full_user', 'operational_user',
  'employee_self_service', 'external_portal', 'device_kiosk', 'companies',
  'branches', 'warehouses', 'devices', 'integrations', 'offline_clients',
  'generated_documents', 'reports',
]);

export const TENANT_STATES = ['draft', 'provisioning', 'trial', 'active', 'grace', 'suspended', 'expired', 'cancelled', 'archived', 'provisioning_failed'];
export const SUBSCRIPTION_STATES = ['pending', 'trial', 'active', 'grace', 'suspended', 'expired', 'cancelled', 'archived'];
export const SEAT_TYPES = ['full_user', 'operational_user', 'employee_self_service', 'external_portal', 'device_kiosk'];

const TRANSITIONS = {
  draft: new Set(['provisioning', 'cancelled']),
  provisioning: new Set(['trial', 'active', 'provisioning_failed', 'cancelled']),
  provisioning_failed: new Set(['provisioning', 'cancelled']),
  trial: new Set(['active', 'grace', 'suspended', 'expired', 'cancelled']),
  active: new Set(['grace', 'suspended', 'cancelled', 'archived']),
  grace: new Set(['active', 'suspended', 'expired', 'cancelled']),
  suspended: new Set(['active', 'grace', 'expired', 'cancelled', 'archived']),
  expired: new Set(['active', 'suspended', 'cancelled', 'archived']),
  cancelled: new Set(['archived', 'active']),
  archived: new Set([]),
};

export class Build11Error extends Error {
  constructor(message, code, details = {}, statusCode = 422) {
    super(message);
    this.name = 'Build11Error';
    this.code = code;
    this.details = details;
    this.statusCode = statusCode;
  }
}

function id(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function now(ctx) { return ctx?.now || new Date().toISOString(); }
function json(value, fallback) { try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; } }
function safeString(value, field) {
  const result = String(value ?? '').trim();
  if (!result) throw new Build11Error(`${field} is required`, 'BUILD11_INVALID_INPUT');
  return result;
}
function tenantIdOf(input, ctx) { return String(input.tenant_id || input.tenantId || ctx?.tenantId || '').trim() || null; }
function correlation(ctx) { return ctx?.correlationId || crypto.randomUUID(); }
function actor(ctx) { return ctx?.userId || ctx?.actorId || 'system'; }

function profile(db, tenantId) {
  const row = db.prepare(`SELECT p.*, t.name AS tenant_name, t.status AS legacy_status
    FROM saas_tenant_profiles p JOIN platform_tenants t ON t.id=p.tenant_id WHERE p.tenant_id=?`).get(tenantId);
  if (!row) throw new Build11Error('Tenant was not found', 'TENANT_NOT_FOUND', { tenantId }, 404);
  return row;
}

function assertTenantAccess(db, tenantId, ctx, { platform = false } = {}) {
  if (!tenantId) throw new Build11Error('tenant scope is required', 'TENANT_SCOPE_REQUIRED', {}, 403);
  if (!platform && ctx?.tenantId && ctx.tenantId !== tenantId) {
    throw new Build11Error('The requested tenant is outside the verified session scope', 'TENANT_SCOPE_VIOLATION', { tenantId, sessionTenantId: ctx.tenantId }, 403);
  }
  profile(db, tenantId);
}

function planForSubscription(db, tenantId) {
  return db.prepare(`SELECT s.*, pv.plan_id, pv.version_number, pv.base_price, pv.billing_frequency,
      pv.trial_days, pv.grace_days, p.code AS plan_code, p.name AS plan_name
    FROM saas_subscriptions s JOIN saas_plan_versions pv ON pv.id=s.plan_version_id
    JOIN saas_plans p ON p.id=pv.plan_id
    WHERE s.tenant_id=? ORDER BY CASE s.status WHEN 'active' THEN 1 WHEN 'trial' THEN 2 WHEN 'grace' THEN 3 ELSE 4 END, s.updated_at DESC LIMIT 1`).get(tenantId);
}

function periodFor(subscription, at) {
  const date = new Date(at);
  const start = new Date(subscription.current_period_start);
  const end = new Date(subscription.current_period_end);
  if (date >= start && date < end) return { start: subscription.current_period_start, end: subscription.current_period_end };
  const nextStart = new Date(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const nextEnd = new Date(Date.UTC(nextStart.getUTCFullYear(), nextStart.getUTCMonth() + 1, 1));
  return { start: nextStart.toISOString(), end: nextEnd.toISOString() };
}

function planLimit(db, subscription, metric) {
  const base = db.prepare('SELECT * FROM saas_plan_limits WHERE plan_version_id=? AND metric=?').get(subscription.plan_version_id, metric);
  const addon = db.prepare(`SELECT COALESCE(SUM(l.allowance),0) AS allowance FROM saas_subscription_addons sa
    JOIN saas_addon_limits l ON l.addon_id=sa.addon_id WHERE sa.subscription_id=? AND l.metric=?`).get(subscription.id, metric);
  if (!base && !addon?.allowance) return null;
  return {
    metric,
    allowance: base?.allowance == null ? null : Number(base.allowance) + Number(addon?.allowance || 0),
    unit: base?.unit || 'count',
    policy: base?.policy || 'hard',
    warningThreshold: base?.warning_threshold == null ? null : Number(base.warning_threshold),
    resetPolicy: base?.reset_policy || 'billing_period',
  };
}

export function evaluateEntitlement(db, ctx, capability, options = {}) {
  const tenantId = tenantIdOf(options, ctx);
  if (!tenantId) return { allowed: false, capability, reasonCode: 'TENANT_SCOPE_REQUIRED', explanation: 'A verified tenant context is required.' };
  const result = { allowed: false, capability, tenantId, source: null, plan: null, addon: null, effectiveFrom: null, effectiveUntil: null, quotaState: null, policyState: null, reasonCode: null, explanation: null, correlationId: correlation(ctx) };
  let sub;
  try { sub = planForSubscription(db, tenantId); } catch { sub = null; }
  if (!sub) {
    result.reasonCode = 'NO_ACTIVE_SUBSCRIPTION'; result.explanation = 'The tenant has no commercial subscription.'; return result;
  }
  result.plan = { id: sub.plan_version_id, code: sub.plan_code, version: sub.version_number };
  result.policyState = sub.status;
  result.effectiveFrom = sub.current_period_start;
  result.effectiveUntil = sub.current_period_end;
  const override = db.prepare(`SELECT * FROM saas_entitlement_overrides WHERE tenant_id=? AND capability=?
    AND effective_from<=? AND (effective_until IS NULL OR effective_until>?) ORDER BY created_at DESC LIMIT 1`).get(tenantId, capability, now(ctx), now(ctx));
  if (override) {
    result.source = 'override'; result.reasonCode = override.effect === 'allow' ? 'OVERRIDE_ALLOWED' : 'OVERRIDE_DENIED';
    result.explanation = override.reason;
    result.allowed = override.effect === 'allow';
  } else {
    const fromPlan = db.prepare('SELECT 1 FROM saas_plan_entitlements WHERE plan_version_id=? AND capability=?').get(sub.plan_version_id, capability);
    const fromAddon = db.prepare(`SELECT a.code FROM saas_subscription_addons sa JOIN saas_addons a ON a.id=sa.addon_id
      JOIN saas_addon_entitlements e ON e.addon_id=a.id WHERE sa.subscription_id=? AND e.capability=? LIMIT 1`).get(sub.id, capability);
    result.source = fromAddon ? 'addon' : fromPlan ? 'plan' : null;
    result.addon = fromAddon?.code || null;
    result.allowed = !!(fromPlan || fromAddon);
    result.reasonCode = result.allowed ? 'ENTITLED' : 'CAPABILITY_NOT_INCLUDED';
    result.explanation = result.allowed ? `Capability is included by the ${result.source}.` : 'The active plan and add-ons do not include this capability.';
  }
  if (['suspended', 'expired', 'cancelled', 'archived'].includes(sub.status) && options.mutation !== false) {
    result.allowed = false; result.reasonCode = 'SUBSCRIPTION_STATE_BLOCKED'; result.explanation = `New protected mutations are blocked while subscription is ${sub.status}.`;
  }
  if (sub.status === 'grace' && result.allowed) result.quotaState = 'grace';
  if (options.metric) {
    const limit = planLimit(db, sub, options.metric);
    const period = periodFor(sub, now(ctx));
    const counter = db.prepare('SELECT consumed,remaining,policy,allowance FROM saas_usage_counters WHERE tenant_id=? AND metric=? AND period_start=?').get(tenantId, options.metric, period.start);
    result.quotaState = counter ? { ...counter, consumed: Number(counter.consumed), remaining: counter.remaining == null ? null : Number(counter.remaining) } : { consumed: 0, remaining: limit?.allowance ?? null, allowance: limit?.allowance ?? null, policy: limit?.policy || 'unlimited' };
    if (limit?.allowance != null && limit.policy === 'hard' && Number(result.quotaState.consumed) >= limit.allowance && options.consume) {
      result.allowed = false; result.reasonCode = 'QUOTA_HARD_LIMIT'; result.explanation = `${options.metric} has reached its hard quota.`;
    }
  }
  return result;
}

function requireEntitlement(db, ctx, capability, options = {}) {
  const result = evaluateEntitlement(db, ctx, capability, options);
  if (!result.allowed) throw new Build11Error(result.explanation, result.reasonCode, result, 403);
  return result;
}

export function createTenant(db, input, ctx) {
  const tenantId = safeString(input.tenant_id || input.tenantId || id('tenant'), 'tenant_id');
  const name = safeString(input.name || input.tenant_name, 'name');
  const timestamp = now(ctx);
  if (db.prepare('SELECT 1 FROM platform_tenants WHERE id=?').get(tenantId)) throw new Build11Error('Tenant already exists', 'TENANT_ALREADY_EXISTS', { tenantId }, 409);
  db.prepare("INSERT INTO platform_tenants(id,name,status,created_at) VALUES(?,?, 'active',?)").run(tenantId, name, timestamp);
  db.prepare(`INSERT INTO saas_tenant_profiles(tenant_id,deployment_profile,lifecycle_state,support_status,created_at,updated_at) VALUES(?,?,?,?,?,?)`)
    .run(tenantId, input.deployment_profile || 'managed_saas', 'draft', input.support_status || 'standard', timestamp, timestamp);
  if (input.primary_company_id) attachTenantCompany(db, { tenant_id: tenantId, company_id: input.primary_company_id, is_primary: true }, ctx);
  return profile(db, tenantId);
}

export function attachTenantCompany(db, input, ctx) {
  const tenantId = safeString(input.tenant_id || input.tenantId, 'tenant_id');
  const companyId = safeString(input.company_id || input.companyId, 'company_id');
  assertTenantAccess(db, tenantId, ctx, { platform: true });
  const company = db.prepare('SELECT id,tenant_id FROM platform_companies WHERE id=?').get(companyId);
  if (!company) throw new Build11Error('Company was not found', 'COMPANY_NOT_FOUND', { companyId }, 404);
  if (company.tenant_id !== tenantId) throw new Build11Error('Company belongs to another tenant', 'TENANT_OWNERSHIP_VIOLATION', { companyId, tenantId }, 403);
  const timestamp = now(ctx);
  if (input.is_primary) db.prepare('UPDATE saas_tenant_companies SET is_primary=0 WHERE tenant_id=?').run(tenantId);
  db.prepare(`INSERT INTO saas_tenant_companies(id,tenant_id,company_id,is_primary,attached_at,attached_by) VALUES(?,?,?,?,?,?)
    ON CONFLICT(tenant_id,company_id) DO UPDATE SET is_primary=excluded.is_primary`).run(id('stc'), tenantId, companyId, input.is_primary ? 1 : 0, timestamp, actor(ctx));
  db.prepare('UPDATE saas_tenant_profiles SET primary_company_id=CASE WHEN ?=1 THEN ? ELSE primary_company_id END,updated_at=? WHERE tenant_id=?').run(input.is_primary ? 1 : 0, companyId, timestamp, tenantId);
  return db.prepare('SELECT * FROM saas_tenant_companies WHERE tenant_id=? AND company_id=?').get(tenantId, companyId);
}

export function transitionTenant(db, input, ctx) {
  const tenantId = safeString(input.tenant_id || input.tenantId, 'tenant_id');
  const target = safeString(input.to_state || input.toState, 'to_state');
  const command = safeString(input.command || `tenant:${target}`, 'command');
  if (!TENANT_STATES.includes(target)) throw new Build11Error('Unknown tenant lifecycle state', 'TENANT_STATE_INVALID', { target });
  const current = profile(db, tenantId);
  const key = input.idempotency_key || null;
  if (key) {
    const replay = db.prepare('SELECT * FROM saas_tenant_events WHERE tenant_id=? AND command=? AND idempotency_key=?').get(tenantId, command, key);
    if (replay) return profile(db, tenantId);
  }
  if (current.lifecycle_state !== target && !TRANSITIONS[current.lifecycle_state]?.has(target)) {
    throw new Build11Error(`Tenant cannot transition from ${current.lifecycle_state} to ${target}`, 'TENANT_INVALID_TRANSITION', { from: current.lifecycle_state, to: target });
  }
  const timestamp = now(ctx);
  if (current.lifecycle_state !== target) {
    db.prepare('UPDATE saas_tenant_profiles SET lifecycle_state=?,version=version+1,updated_at=? WHERE tenant_id=?').run(target, timestamp, tenantId);
    db.prepare('UPDATE platform_tenants SET status=? WHERE id=?').run(['suspended', 'expired', 'archived'].includes(target) ? 'suspended' : 'active', tenantId);
  }
  db.prepare(`INSERT INTO saas_tenant_events(id,tenant_id,from_state,to_state,command,reason,actor_id,correlation_id,idempotency_key,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(id('tevent'), tenantId, current.lifecycle_state, target, command, input.reason || null, actor(ctx), correlation(ctx), key, timestamp);
  return profile(db, tenantId);
}

export function provisionTenant(db, input, ctx) {
  const tenantId = safeString(input.tenant_id || input.tenantId, 'tenant_id');
  const current = profile(db, tenantId);
  if (current.lifecycle_state !== 'draft' && current.lifecycle_state !== 'provisioning' && current.lifecycle_state !== 'provisioning_failed') return { tenant: current, resumed: true, steps: db.prepare('SELECT * FROM saas_tenant_provisioning WHERE tenant_id=? ORDER BY id').all(tenantId) };
  if (current.lifecycle_state !== 'provisioning') transitionTenant(db, { tenant_id: tenantId, to_state: 'provisioning', command: 'tenant:provision:begin', reason: input.reason, idempotency_key: input.idempotency_key ? `${input.idempotency_key}:begin` : null }, ctx);
  const steps = ['tenant_registry', 'company_relationship', 'default_subscription', 'safe_role_templates', 'entitlement_assignments'];
  for (const step of steps) {
    const existing = db.prepare('SELECT * FROM saas_tenant_provisioning WHERE tenant_id=? AND step=?').get(tenantId, step);
    if (existing?.status === 'completed') continue;
    const timestamp = now(ctx);
    db.prepare(`INSERT INTO saas_tenant_provisioning(id,tenant_id,step,status,attempts,started_at) VALUES(?,?,?,'pending',1,?)
      ON CONFLICT(tenant_id,step) DO UPDATE SET status='pending',attempts=attempts+1,started_at=?`).run(id('prov'), tenantId, step, timestamp, timestamp);
    if (step === 'company_relationship' && !db.prepare('SELECT 1 FROM saas_tenant_companies WHERE tenant_id=?').get(tenantId)) {
      const company = db.prepare('SELECT id FROM platform_companies WHERE tenant_id=? ORDER BY created_at LIMIT 1').get(tenantId);
      if (company) attachTenantCompany(db, { tenant_id: tenantId, company_id: company.id, is_primary: true }, ctx);
    }
    if (step === 'default_subscription' && !db.prepare('SELECT 1 FROM saas_subscriptions WHERE tenant_id=?').get(tenantId)) {
      createSubscription(db, { tenant_id: tenantId, plan_version_id: 'planv_workshop_core_1', status: 'trial', trial_days: 14 }, ctx);
    }
    db.prepare('UPDATE saas_tenant_provisioning SET status=\'completed\',completed_at=?,error_code=NULL WHERE tenant_id=? AND step=?').run(timestamp, tenantId, step);
  }
  transitionTenant(db, { tenant_id: tenantId, to_state: input.activate_paid ? 'active' : 'trial', command: 'tenant:provision:complete', reason: 'Provisioning completed', idempotency_key: input.idempotency_key ? `${input.idempotency_key}:complete` : null }, ctx);
  return { tenant: profile(db, tenantId), resumed: false, steps: db.prepare('SELECT * FROM saas_tenant_provisioning WHERE tenant_id=? ORDER BY rowid').all(tenantId) };
}

export function createSubscription(db, input, ctx) {
  const tenantId = safeString(input.tenant_id || input.tenantId, 'tenant_id');
  assertTenantAccess(db, tenantId, ctx, { platform: true });
  const planVersionId = safeString(input.plan_version_id || input.planVersionId, 'plan_version_id');
  const plan = db.prepare('SELECT * FROM saas_plan_versions WHERE id=?').get(planVersionId);
  if (!plan || plan.status === 'retired') throw new Build11Error('Plan version is unavailable', 'PLAN_VERSION_NOT_FOUND', { planVersionId }, 404);
  const timestamp = now(ctx); const start = input.starts_at || timestamp; const trialDays = Number(input.trial_days ?? plan.trial_days); const periodEnd = input.current_period_end || new Date(Date.parse(start) + 30 * 86400000).toISOString();
  const status = input.status || (trialDays > 0 ? 'trial' : 'pending');
  const subscriptionId = input.id || id('sub');
  db.prepare(`INSERT INTO saas_subscriptions(id,tenant_id,plan_version_id,status,starts_at,current_period_start,current_period_end,trial_end_at,grace_end_at,cancel_at_period_end,renewal_enabled,seat_limit,currency,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(subscriptionId, tenantId, planVersionId, status, start, start, periodEnd, trialDays ? new Date(Date.parse(start) + trialDays * 86400000).toISOString() : null, null, input.cancel_at_period_end ? 1 : 0, input.renewal_enabled === false ? 0 : 1, input.seat_limit ?? null, input.currency || plan.currency, timestamp, timestamp);
  db.prepare('INSERT INTO saas_subscription_history(id,subscription_id,from_status,to_status,reason,actor_id,correlation_id,occurred_at) VALUES(?,?,?,?,?,?,?,?)').run(id('subhist'), subscriptionId, null, status, 'created', actor(ctx), correlation(ctx), timestamp);
  return db.prepare('SELECT * FROM saas_subscriptions WHERE id=?').get(subscriptionId);
}

export function transitionSubscription(db, input, ctx) {
  const subscriptionId = safeString(input.subscription_id || input.subscriptionId, 'subscription_id');
  const current = db.prepare('SELECT * FROM saas_subscriptions WHERE id=?').get(subscriptionId);
  if (!current) throw new Build11Error('Subscription was not found', 'SUBSCRIPTION_NOT_FOUND', { subscriptionId }, 404);
  assertTenantAccess(db, current.tenant_id, ctx);
  const target = safeString(input.to_status || input.toStatus, 'to_status');
  if (!SUBSCRIPTION_STATES.includes(target)) throw new Build11Error('Unknown subscription state', 'SUBSCRIPTION_STATE_INVALID');
  if (current.status !== target && !new Set({ pending: ['trial','active','cancelled'], trial: ['active','grace','suspended','expired','cancelled'], active: ['grace','suspended','cancelled','archived'], grace: ['active','suspended','expired','cancelled'], suspended: ['active','grace','expired','cancelled','archived'], expired: ['active','cancelled','archived'], cancelled: ['archived','active'], archived: [] }[current.status] || []).has(target)) throw new Build11Error(`Subscription cannot transition from ${current.status} to ${target}`, 'SUBSCRIPTION_INVALID_TRANSITION');
  const timestamp = now(ctx);
  db.prepare(`UPDATE saas_subscriptions SET status=?,grace_end_at=CASE WHEN ?='grace' THEN ? ELSE grace_end_at END,updated_at=? WHERE id=?`).run(target, target, input.grace_end_at || new Date(Date.parse(timestamp) + 7 * 86400000).toISOString(), timestamp, subscriptionId);
  db.prepare('INSERT INTO saas_subscription_history(id,subscription_id,from_status,to_status,reason,actor_id,correlation_id,occurred_at) VALUES(?,?,?,?,?,?,?,?)').run(id('subhist'), subscriptionId, current.status, target, input.reason || null, actor(ctx), correlation(ctx), timestamp);
  return db.prepare('SELECT * FROM saas_subscriptions WHERE id=?').get(subscriptionId);
}

export function publishPlanVersion(db, input, ctx) {
  const planId = safeString(input.plan_id || input.planId, 'plan_id');
  const plan = db.prepare('SELECT * FROM saas_plans WHERE id=?').get(planId);
  if (!plan) throw new Build11Error('Plan was not found', 'PLAN_NOT_FOUND', { planId }, 404);
  const current = db.prepare('SELECT * FROM saas_plan_versions WHERE plan_id=? ORDER BY version_number DESC LIMIT 1').get(planId);
  if (current?.status === 'published' && input.version_id === current.id) throw new Build11Error('Published plan versions are immutable; create a new version', 'PLAN_VERSION_IMMUTABLE');
  const versionNumber = Number(input.version_number || (current?.version_number || 0) + 1);
  const versionId = input.version_id || id('planv'); const timestamp = now(ctx);
  db.prepare(`INSERT INTO saas_plan_versions(id,plan_id,version_number,status,currency,billing_frequency,base_price,trial_days,grace_days,published_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run(versionId, planId, versionNumber, 'published', input.currency || 'USD', input.billing_frequency || 'monthly', Number(input.base_price || 0), Number(input.trial_days || 0), Number(input.grace_days || 7), timestamp, timestamp);
  const capabilities = Array.isArray(input.capabilities) ? input.capabilities : [];
  const insertCap = db.prepare('INSERT INTO saas_plan_entitlements(plan_version_id,capability) VALUES(?,?)'); capabilities.forEach((value) => insertCap.run(versionId, safeString(value, 'capability')));
  const insertLimit = db.prepare('INSERT INTO saas_plan_limits(plan_version_id,metric,allowance,unit,policy,warning_threshold,reset_policy) VALUES(?,?,?,?,?,?,?)');
  for (const row of (Array.isArray(input.limits) ? input.limits : [])) insertLimit.run(versionId, safeString(row.metric, 'metric'), row.allowance == null ? null : Number(row.allowance), row.unit || 'count', row.policy || 'hard', row.warning_threshold ?? null, row.reset_policy || 'billing_period');
  db.prepare("UPDATE saas_plans SET lifecycle_state='published' WHERE id=?").run(planId);
  return db.prepare('SELECT * FROM saas_plan_versions WHERE id=?').get(versionId);
}

function limitForSeat(db, tenantId, seatType) {
  const sub = planForSubscription(db, tenantId); return sub ? planLimit(db, sub, seatType) : null;
}

export function assignSeat(db, input, ctx) {
  const tenantId = safeString(input.tenant_id || input.tenantId || ctx?.tenantId, 'tenant_id');
  assertTenantAccess(db, tenantId, ctx);
  const userId = safeString(input.user_id || input.userId, 'user_id'); const seatType = safeString(input.seat_type || input.seatType || 'full_user', 'seat_type');
  if (!SEAT_TYPES.includes(seatType)) throw new Build11Error('Unknown seat type', 'SEAT_TYPE_INVALID', { seatType });
  const existing = db.prepare('SELECT * FROM saas_seat_assignments WHERE tenant_id=? AND user_id=? AND seat_type=?').get(tenantId, userId, seatType);
  if (existing?.status === 'active') return existing;
  const limit = limitForSeat(db, tenantId, seatType); const used = db.prepare("SELECT COUNT(*) AS n FROM saas_seat_assignments WHERE tenant_id=? AND seat_type=? AND status='active'").get(tenantId, seatType).n;
  if (limit?.allowance != null && used >= limit.allowance) throw new Build11Error('Seat limit reached; existing users were preserved', 'SEAT_LIMIT_REACHED', { seatType, used, allowed: limit.allowance }, 403);
  const timestamp = now(ctx); const assignmentId = existing?.id || id('seat');
  db.prepare(`INSERT INTO saas_seat_assignments(id,tenant_id,user_id,seat_type,status,assigned_at,released_at,assigned_by) VALUES(?,?,?,?, 'active',?,?,?)
    ON CONFLICT(tenant_id,user_id,seat_type) DO UPDATE SET status='active',released_at=NULL,assigned_at=excluded.assigned_at,assigned_by=excluded.assigned_by`).run(assignmentId, tenantId, userId, seatType, timestamp, null, actor(ctx));
  return db.prepare('SELECT * FROM saas_seat_assignments WHERE id=?').get(assignmentId);
}

export function recordUsage(db, input, ctx) {
  const tenantId = safeString(input.tenant_id || input.tenantId || ctx?.tenantId, 'tenant_id'); assertTenantAccess(db, tenantId, ctx);
  const metric = safeString(input.metric, 'metric'); if (!BUILD11_METRICS.has(metric)) throw new Build11Error('Metric is not registered', 'USAGE_METRIC_UNKNOWN', { metric });
  const quantity = Number(input.quantity); if (!Number.isFinite(quantity) || quantity < 0) throw new Build11Error('quantity must be a non-negative number', 'USAGE_QUANTITY_INVALID');
  const key = safeString(input.idempotency_key || input.idempotencyKey, 'idempotency_key'); const existing = db.prepare('SELECT * FROM saas_usage_events WHERE tenant_id=? AND metric=? AND idempotency_key=?').get(tenantId, metric, key); if (existing) return { event: existing, duplicate: true };
  const sub = planForSubscription(db, tenantId); if (!sub) throw new Build11Error('No subscription is available for usage', 'NO_ACTIVE_SUBSCRIPTION', {}, 403);
  const period = periodFor(sub, input.occurred_at || now(ctx)); const limit = planLimit(db, sub, metric); const consumed = Number(db.prepare('SELECT COALESCE(SUM(quantity),0) AS total FROM saas_usage_events WHERE tenant_id=? AND metric=? AND occurred_at>=? AND occurred_at<?').get(tenantId, metric, period.start, period.end).total) + quantity;
  if (limit?.allowance != null && limit.policy === 'hard' && consumed > limit.allowance) throw new Build11Error('Hard quota would be exceeded', 'QUOTA_HARD_LIMIT', { metric, consumed, allowed: limit.allowance, period_start: period.start, period_end: period.end }, 403);
  const timestamp = input.occurred_at || now(ctx); const event = { id: id('usage'), tenant_id: tenantId, metric, quantity, unit: input.unit || limit?.unit || 'count', occurred_at: timestamp, source: safeString(input.source || 'platform', 'source'), idempotency_key: key, correlation_id: correlation(ctx), actor_id: actor(ctx), company_id: input.company_id || ctx.companyId || null, provenance: input.provenance || 'governed_build11_meter' };
  db.prepare(`INSERT INTO saas_usage_events(id,tenant_id,metric,quantity,unit,occurred_at,source,idempotency_key,correlation_id,actor_id,company_id,provenance) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(...Object.values(event));
  const warning = limit?.warningThreshold != null && consumed >= limit.warningThreshold ? 'warning_threshold' : limit?.allowance != null && consumed > limit.allowance ? 'overage' : null;
  if (warning) db.prepare('INSERT INTO saas_quota_warnings(id,tenant_id,metric,period_start,threshold,warning_type,emitted_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING').run(id('qwarn'), tenantId, metric, period.start, warning === 'warning_threshold' ? limit.warningThreshold : limit.allowance, warning, now(ctx));
  db.prepare(`INSERT INTO saas_usage_counters(tenant_id,metric,period_start,period_end,consumed,allowance,warning_threshold,policy,remaining,reconciliation_status,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(tenant_id,metric,period_start) DO UPDATE SET consumed=excluded.consumed,allowance=excluded.allowance,warning_threshold=excluded.warning_threshold,policy=excluded.policy,remaining=excluded.remaining,reconciliation_status='reconciled',updated_at=excluded.updated_at`).run(tenantId, metric, period.start, period.end, consumed, limit?.allowance ?? null, limit?.warningThreshold ?? null, limit?.policy || 'unlimited', limit?.allowance == null ? null : limit.allowance - consumed, 'reconciled', now(ctx));
  return { event: db.prepare('SELECT * FROM saas_usage_events WHERE id=?').get(event.id), counter: db.prepare('SELECT * FROM saas_usage_counters WHERE tenant_id=? AND metric=? AND period_start=?').get(tenantId, metric, period.start), warning };
}

export function reconcileUsage(db, input, ctx) {
  const tenantId = safeString(input.tenant_id || input.tenantId || ctx?.tenantId, 'tenant_id'); assertTenantAccess(db, tenantId, ctx);
  const sub = planForSubscription(db, tenantId); if (!sub) throw new Build11Error('No subscription is available', 'NO_ACTIVE_SUBSCRIPTION');
  const metric = input.metric ? safeString(input.metric, 'metric') : null; const periods = db.prepare(`SELECT metric,substr(occurred_at,1,7) AS month,MIN(occurred_at) AS first_at,MAX(occurred_at) AS last_at,SUM(quantity) AS consumed FROM saas_usage_events WHERE tenant_id=? ${metric ? 'AND metric=?' : ''} GROUP BY metric,month`).all(...(metric ? [tenantId, metric] : [tenantId]));
  return periods.map((row) => ({ metric: row.metric, consumed: Number(row.consumed), month: row.month, status: 'reconciled' }));
}

export function simulateInvoice(db, input, ctx) {
  const tenantId = safeString(input.tenant_id || input.tenantId || ctx?.tenantId, 'tenant_id'); assertTenantAccess(db, tenantId, ctx); const sub = db.prepare('SELECT * FROM saas_subscriptions WHERE id=? AND tenant_id=?').get(input.subscription_id || input.subscriptionId, tenantId); if (!sub) throw new Build11Error('Subscription was not found', 'SUBSCRIPTION_NOT_FOUND', {}, 404);
  const pv = db.prepare('SELECT * FROM saas_plan_versions WHERE id=?').get(sub.plan_version_id); const seats = Number(db.prepare("SELECT COUNT(*) AS n FROM saas_seat_assignments WHERE tenant_id=? AND status='active'").get(tenantId).n); const seatAmount = Number(input.seat_price || 0) * seats; const addonAmount = Number(db.prepare('SELECT COALESCE(SUM(a.price*sa.quantity),0) AS amount FROM saas_subscription_addons sa JOIN saas_addons a ON a.id=sa.addon_id WHERE sa.subscription_id=?').get(sub.id).amount); const usageOverage = Number(input.usage_overage_amount || 0); const discount = Number(input.discount_amount || 0); const total = Number(pv.base_price) + seatAmount + addonAmount + usageOverage - discount; const timestamp = now(ctx); const invoiceId = input.id || id('invoice');
  db.prepare(`INSERT INTO saas_simulated_invoices(id,tenant_id,subscription_id,status,currency,period_start,period_end,base_amount,seat_amount,addon_amount,usage_overage_amount,discount_amount,tax_metadata,total_amount,created_at,updated_at) VALUES(?,?,?,'draft',?,?,?,?,?,?,?,?,?,?,?,?)`).run(invoiceId, tenantId, sub.id, input.currency || sub.currency, sub.current_period_start, sub.current_period_end, pv.base_price, seatAmount, addonAmount, usageOverage, discount, JSON.stringify(input.tax_metadata || {}), total, timestamp, timestamp);
  return db.prepare('SELECT * FROM saas_simulated_invoices WHERE id=?').get(invoiceId);
}

export function issueInvoice(db, input, ctx) { const invoice = db.prepare('SELECT * FROM saas_simulated_invoices WHERE id=?').get(safeString(input.invoice_id || input.invoiceId, 'invoice_id')); if (!invoice) throw new Build11Error('Invoice was not found', 'INVOICE_NOT_FOUND', {}, 404); assertTenantAccess(db, invoice.tenant_id, ctx); db.prepare("UPDATE saas_simulated_invoices SET status='issued',updated_at=? WHERE id=? AND status='draft'").run(now(ctx), invoice.id); return db.prepare('SELECT * FROM saas_simulated_invoices WHERE id=?').get(invoice.id); }

export function simulatePayment(db, input, ctx) { const invoice = db.prepare('SELECT * FROM saas_simulated_invoices WHERE id=?').get(safeString(input.invoice_id || input.invoiceId, 'invoice_id')); if (!invoice) throw new Build11Error('Invoice was not found', 'INVOICE_NOT_FOUND', {}, 404); assertTenantAccess(db, invoice.tenant_id, ctx); const status = input.status || 'succeeded'; if (!['initiated','succeeded','failed','reversed'].includes(status)) throw new Build11Error('Payment status is invalid', 'PAYMENT_STATE_INVALID'); const paymentId = input.id || id('payment'); db.prepare('INSERT INTO saas_simulated_payments(id,tenant_id,invoice_id,status,amount,currency,failure_reason,created_at) VALUES(?,?,?,?,?,?,?,?)').run(paymentId, invoice.tenant_id, invoice.id, status, invoice.total_amount, invoice.currency, input.failure_reason || null, now(ctx)); if (status === 'succeeded') db.prepare("UPDATE saas_simulated_invoices SET status='paid_simulated',updated_at=? WHERE id=?").run(now(ctx), invoice.id); return db.prepare('SELECT * FROM saas_simulated_payments WHERE id=?').get(paymentId); }

const FORBIDDEN_MANIFEST = /(?:runtime\s*ddl|direct\s+table|eval\s*\(|new\s+function|child_process|require\s*\(|execute\s+code|arbitrary\s+(?:javascript|code))/i;
const SAFE_CONTRIBUTIONS = new Set(['terminology_overlay','navigation_page','view_metadata','report_definition','print_template','permission_declaration','safe_role_template','workflow_template','settings_schema','vertical_dependency','controlled_seed','integration_metadata']);
function semver(value) { return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(value || '')); }

export function validateExtensionManifest(manifest, db) {
  const findings = []; const required = ['package_id','publisher','name','version','compatibility_range','manifest_version','provenance']; for (const field of required) if (!manifest?.[field]) findings.push({ code: 'MISSING_FIELD', field, message: `${field} is required` });
  if (manifest?.version && !semver(manifest.version)) findings.push({ code: 'INVALID_VERSION', field: 'version', message: 'version must be semantic x.y.z' });
  if (!manifest?.checksum) findings.push({ code: 'CHECKSUM_REQUIRED', field: 'checksum', message: 'checksum metadata is required' });
  if (!manifest?.signature) findings.push({ code: 'SIGNATURE_REQUIRED', field: 'signature', message: 'signature metadata is required' });
  if (FORBIDDEN_MANIFEST.test(JSON.stringify(manifest))) findings.push({ code: 'UNSAFE_EXECUTION_DECLARATION', message: 'arbitrary executable code and runtime DDL are not supported' });
  const contributions = Array.isArray(manifest?.contributions) ? manifest.contributions : [];
  contributions.forEach((entry) => { if (!SAFE_CONTRIBUTIONS.has(entry.type)) findings.push({ code: 'UNSUPPORTED_CONTRIBUTION', value: entry.type }); });
  const permissions = Array.isArray(manifest?.permissions_requested) ? manifest.permissions_requested : [];
  if (new Set(permissions).size !== permissions.length) findings.push({ code: 'DUPLICATE_PERMISSION' });
  for (const permission of permissions) if (!db.prepare('SELECT 1 FROM authorization_permissions WHERE id=?').get(permission)) findings.push({ code: 'UNKNOWN_PERMISSION', value: permission });
  const dependencies = Array.isArray(manifest?.dependencies) ? manifest.dependencies : [];
  if (new Set(dependencies).size !== dependencies.length) findings.push({ code: 'DUPLICATE_DEPENDENCY' });
  if (dependencies.includes(manifest?.package_id)) findings.push({ code: 'DEPENDENCY_CYCLE', value: manifest.package_id });
  return findings;
}

export function validatePackage(db, input, ctx) {
  const manifest = input.manifest || input; const findings = validateExtensionManifest(manifest, db); const timestamp = now(ctx); const packageId = safeString(manifest.package_id, 'package_id');
  db.prepare(`INSERT INTO saas_extension_packages(id,package_id,publisher,name,version,compatibility_range,manifest_version,dependencies,capability_contributions,permissions_requested,declarations,provenance,license_metadata,checksum,signature,review_state,publication_state,validation_findings,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?,?) ON CONFLICT(package_id) DO UPDATE SET version=excluded.version,dependencies=excluded.dependencies,capability_contributions=excluded.capability_contributions,permissions_requested=excluded.permissions_requested,declarations=excluded.declarations,validation_findings=excluded.validation_findings,publication_state=excluded.publication_state,updated_at=excluded.updated_at`)
    .run(id('pkg'), packageId, manifest.publisher, manifest.name, manifest.version, manifest.compatibility_range, String(manifest.manifest_version), JSON.stringify(manifest.dependencies || []), JSON.stringify(manifest.contributions || []), JSON.stringify(manifest.permissions_requested || []), JSON.stringify(manifest.declarations || {}), manifest.provenance, JSON.stringify(manifest.license_metadata || {}), manifest.checksum || null, manifest.signature || null, findings.length ? 'validation_failed' : 'awaiting_review', JSON.stringify(findings), timestamp, timestamp);
  return { package: db.prepare('SELECT * FROM saas_extension_packages WHERE package_id=?').get(packageId), findings };
}

function packageRow(db, packageId) { const row = db.prepare('SELECT * FROM saas_extension_packages WHERE package_id=?').get(packageId); if (!row) throw new Build11Error('Package was not found', 'PACKAGE_NOT_FOUND', { packageId }, 404); return row; }
export function approvePackage(db, input, ctx) { const row = packageRow(db, safeString(input.package_id || input.packageId, 'package_id')); const findings = json(row.validation_findings, []); if (findings.length) throw new Build11Error('Package has validation findings', 'PACKAGE_VALIDATION_FAILED', { findings }); db.prepare("UPDATE saas_extension_packages SET review_state='approved',publication_state='approved',updated_at=? WHERE package_id=?").run(now(ctx), row.package_id); return packageRow(db, row.package_id); }
export function stagePackage(db, input, ctx) { const packageId = safeString(input.package_id || input.packageId, 'package_id'); const row = packageRow(db, packageId); if (row.review_state !== 'approved' && row.publication_state !== 'published') throw new Build11Error('Package approval is required before staging', 'PACKAGE_NOT_APPROVED', {}, 403); const tenantId = safeString(input.tenant_id || input.tenantId || ctx?.tenantId, 'tenant_id'); assertTenantAccess(db, tenantId, ctx); const timestamp = now(ctx); const installId = id('install'); db.prepare(`INSERT INTO saas_extension_installations(id,tenant_id,package_id,package_version,state,created_at,updated_at) VALUES(?,?,?,?,'staged',?,?) ON CONFLICT(tenant_id,package_id) DO UPDATE SET package_version=excluded.package_version,state='staged',updated_at=excluded.updated_at`).run(installId, tenantId, packageId, row.version, timestamp, timestamp); return db.prepare('SELECT * FROM saas_extension_installations WHERE tenant_id=? AND package_id=?').get(tenantId, packageId); }
export function setPackageState(db, input, ctx, target) { const installationId = safeString(input.installation_id || input.installationId, 'installation_id'); const row = db.prepare('SELECT i.*,p.capability_contributions,p.dependencies FROM saas_extension_installations i JOIN saas_extension_packages p ON p.package_id=i.package_id WHERE i.id=?').get(installationId); if (!row) throw new Build11Error('Installation was not found', 'INSTALLATION_NOT_FOUND', {}, 404); assertTenantAccess(db, row.tenant_id, ctx); if (target === 'enabled') { const contributions = json(row.capability_contributions, []); for (const contribution of contributions) if (contribution.capability) requireEntitlement(db, ctx, contribution.capability, { tenant_id: row.tenant_id, mutation: true }); const deps = json(row.dependencies, []); for (const dep of deps) { const installed = db.prepare("SELECT 1 FROM saas_extension_installations WHERE tenant_id=? AND package_id=? AND state='enabled'").get(row.tenant_id, dep); if (!installed) throw new Build11Error('Package dependency is not enabled', 'PACKAGE_DEPENDENCY_NOT_ENABLED', { dependency: dep }); } } const timestamp = now(ctx); db.prepare('UPDATE saas_extension_installations SET state=?,installed_at=CASE WHEN ? IN (\'enabled\',\'installed_disabled\') THEN COALESCE(installed_at,?) ELSE installed_at END,enabled_at=CASE WHEN ?=\'enabled\' THEN ? ELSE enabled_at END,disabled_at=CASE WHEN ? IN (\'disabled\',\'removed_metadata_only\') THEN ? ELSE disabled_at END,updated_at=? WHERE id=?').run(target, target, timestamp, target, timestamp, target, timestamp, timestamp, installationId); db.prepare('INSERT INTO saas_extension_history(id,installation_id,package_id,from_state,to_state,actor_id,reason,occurred_at) VALUES(?,?,?,?,?,?,?,?)').run(id('exthist'), installationId, row.package_id, row.state, target, actor(ctx), input.reason || null, timestamp); return db.prepare('SELECT * FROM saas_extension_installations WHERE id=?').get(installationId); }

export function listSaas(db, ctx, resource, recordId = null, query = {}, { crossTenant = false } = {}) {
  const tenant = crossTenant ? null : ctx?.tenantId; const where = tenant ? 'WHERE tenant_id=?' : ''; const args = tenant ? [tenant] : [];
  if (resource === 'overview') { const scoped = tenant ? 'WHERE p.tenant_id=?' : ''; const a = tenant ? [tenant] : []; return { data: [{ generated_at: new Date().toISOString(), tenants: db.prepare(`SELECT lifecycle_state AS state,COUNT(*) AS count FROM saas_tenant_profiles p ${scoped} GROUP BY lifecycle_state`).all(...a), trials_ending_soon: db.prepare(`SELECT COUNT(*) AS n FROM saas_subscriptions WHERE status='trial' AND trial_end_at<=datetime('now','+14 day') ${tenant ? 'AND tenant_id=?' : ''}`).get(...a).n, grace: db.prepare(`SELECT COUNT(*) AS n FROM saas_subscriptions WHERE status='grace' ${tenant ? 'AND tenant_id=?' : ''}`).get(...a).n, suspended: db.prepare(`SELECT COUNT(*) AS n FROM saas_subscriptions WHERE status='suspended' ${tenant ? 'AND tenant_id=?' : ''}`).get(...a).n, seat_overages: db.prepare(`SELECT COUNT(*) AS n FROM saas_seat_assignments WHERE status='excess' ${tenant ? 'AND tenant_id=?' : ''}`).get(...a).n, quota_warnings: db.prepare(`SELECT COUNT(*) AS n FROM saas_quota_warnings WHERE warning_type='warning_threshold' ${tenant ? 'AND tenant_id=?' : ''}`).get(...a).n }] }; }
  if (resource === 'tenants' || resource === 'tenant-directory') return { data: db.prepare(`SELECT p.tenant_id AS id,t.name,p.deployment_profile,p.lifecycle_state,p.primary_company_id,p.support_status,p.provisioning_step,p.updated_at FROM saas_tenant_profiles p JOIN platform_tenants t ON t.id=p.tenant_id ${tenant ? 'WHERE p.tenant_id=?' : ''} ORDER BY t.name LIMIT 200`).all(...args) };
  if (resource === 'tenant' && recordId) {
    if (tenant && recordId !== tenant) throw new Build11Error('The requested tenant is outside the verified session scope', 'TENANT_SCOPE_VIOLATION', { tenantId: recordId, sessionTenantId: tenant }, 403);
    return { data: profile(db, recordId) };
  }
  if (resource === 'companies') return { data: db.prepare(`SELECT * FROM saas_tenant_companies ${where} ORDER BY attached_at`).all(...args) };
  if (resource === 'plans') return { data: db.prepare(`SELECT p.*,e.code AS edition_code,(SELECT COUNT(*) FROM saas_plan_versions v WHERE v.plan_id=p.id) AS version_count FROM saas_plans p JOIN saas_editions e ON e.id=p.edition_id ORDER BY p.code`).all() };
  if (resource === 'plan-versions') return { data: db.prepare('SELECT * FROM saas_plan_versions ORDER BY plan_id,version_number DESC').all() };
  if (resource === 'subscriptions') return { data: db.prepare(`SELECT s.*,p.code AS plan_code,p.name AS plan_name,pv.version_number FROM saas_subscriptions s JOIN saas_plan_versions pv ON pv.id=s.plan_version_id JOIN saas_plans p ON p.id=pv.plan_id ${tenant ? 'WHERE s.tenant_id=?' : ''} ORDER BY s.updated_at DESC LIMIT 200`).all(...args) };
  if (resource === 'entitlements') { const targetTenant = tenant || query.tenant_id; if (!targetTenant) return { data: [] }; const sub = planForSubscription(db, targetTenant); return { data: sub ? db.prepare('SELECT capability,\'plan\' AS source FROM saas_plan_entitlements WHERE plan_version_id=? ORDER BY capability').all(sub.plan_version_id) : [] }; }
  if (resource === 'seats' || resource === 'seats-and-limits') return { data: db.prepare(`SELECT * FROM saas_seat_assignments ${where} ORDER BY assigned_at DESC LIMIT 500`).all(...args) };
  if (resource === 'usage' || resource === 'usage-and-quotas') return { data: db.prepare(`SELECT * FROM saas_usage_counters ${where} ORDER BY updated_at DESC LIMIT 500`).all(...args) };
  if (resource === 'usage-events') return { data: db.prepare(`SELECT * FROM saas_usage_events ${where} ORDER BY occurred_at DESC LIMIT 500`).all(...args) };
  if (resource === 'invoices' || resource === 'billing-simulator') return { data: db.prepare(`SELECT * FROM saas_simulated_invoices ${where} ORDER BY created_at DESC LIMIT 200`).all(...args) };
  if (resource === 'packages' || resource === 'extension-marketplace') return { data: db.prepare('SELECT package_id,publisher,name,version,compatibility_range,review_state,publication_state,validation_findings,updated_at FROM saas_extension_packages ORDER BY updated_at DESC LIMIT 200').all() };
  if (resource === 'installations' || resource === 'extension-installations') return { data: db.prepare(`SELECT * FROM saas_extension_installations ${where} ORDER BY updated_at DESC LIMIT 200`).all(...args) };
  if (resource === 'audit') return { data: db.prepare(`SELECT * FROM platform_audit_log WHERE ${tenant ? 'tenant_id=?' : 'tenant_id IS NOT NULL'} ORDER BY occurred_at DESC LIMIT 200`).all(...(tenant ? [tenant] : [])) };
  return { error: 'saas resource not found', status: 404 };
}

export function registerBuild11Actions(actionExecutor, db) {
  const register = (id, handler) => actionExecutor.registerHandler(id, ({ input, ctx }) => handler(db, input, ctx));
  register('saas:tenant_create', createTenant); register('saas:tenant_attach_company', attachTenantCompany); register('saas:tenant_transition', transitionTenant); register('saas:tenant_provision', provisionTenant); register('saas:subscription_create', createSubscription); register('saas:subscription_transition', transitionSubscription); register('saas:seat_assign', assignSeat); register('saas:usage_record', recordUsage); register('saas:usage_reconcile', reconcileUsage); register('saas:plan_publish', publishPlanVersion); register('saas:package_validate', validatePackage); register('saas:package_approve', approvePackage); register('saas:package_stage', stagePackage); register('saas:package_enable', (dbx, input, ctx) => setPackageState(dbx, input, ctx, 'enabled')); register('saas:package_disable', (dbx, input, ctx) => setPackageState(dbx, input, ctx, 'disabled')); register('saas:package_rollback', (dbx, input, ctx) => setPackageState(dbx, input, ctx, 'rollback_pending')); register('saas:invoice_simulate', simulateInvoice); register('saas:invoice_issue', issueInvoice); register('saas:payment_simulate', simulatePayment);
}
