// Review Freeze — commercial/SaaS fixture pack.
//
// Disposable demo rows for the BUILD-11 commercial platform (tenant
// lifecycle, plans, subscriptions, entitlements, seats, usage/quota,
// simulated billing, safe extensions), grounded in the real schema from
// database/migrations/087_build11_commercial_platform.mjs and
// 088_build11_billing_action.mjs. Every id is prefixed `rev_`. Every insert
// is `ON CONFLICT(id) DO NOTHING` (or, for tables with no single-column `id`
// primary key — saas_tenant_profiles, saas_plan_entitlements, saas_plan_limits,
// saas_usage_counters — `ON CONFLICT(<natural key>) DO NOTHING`, matching the
// convention already used by the migration itself).
//
// Rows are written against BOTH the primary review tenant/company
// (tenantId/companyId, normally t_octagon_review / c_alwarsha_demo) and the
// isolation tenant/company imported from ./roles.mjs, so the isolation
// reviewer has real commercial data to prove tenant scoping against.
//
// Never real billing: saas_simulated_invoices carries its built-in
// "SIMULATION / NO EXTERNAL CHARGE / NO GL POSTING" label and nothing here
// ever reaches a payment processor or the GL.

import { ISOLATION_TENANT, ISOLATION_COMPANY } from '../roles.mjs';

function addDays(iso, days) {
  return new Date(new Date(iso).getTime() + days * 86400000).toISOString();
}

export async function seedCommercialSaasFixtures(dialect, { tenantId, companyId, branchId, now }) {
  void branchId; // not needed by the commercial tables; kept for signature parity
  const editionId = 'rev_edition_demo';
  const planId = 'rev_plan_alwarsha_demo';
  const planvOld = 'rev_planv_alwarsha_demo_v1';
  const planvCurrent = 'rev_planv_alwarsha_demo_v2';

  dialect.prepare(`INSERT INTO saas_editions(id,code,name,description,status,created_at)
    VALUES(?,?,?,?, 'active', ?) ON CONFLICT(id) DO NOTHING`)
    .run(editionId, 'rev_demo_edition', '[DEMO] Review Edition', 'Fictional edition for review environment only.', now);

  dialect.prepare(`INSERT INTO saas_plans(id,edition_id,code,name,lifecycle_state,created_at)
    VALUES(?,?,?,?, 'published', ?) ON CONFLICT(id) DO NOTHING`)
    .run(planId, editionId, 'rev_alwarsha_demo_plan', '[DEMO] Al-Warsha Demo Plan', now);

  const planVersions = [
    [planvOld, 1, 'retired', 49, 14, 7, addDays(now, -180)],
    [planvCurrent, 2, 'published', 79, 14, 7, addDays(now, -30)],
  ];
  const insertPlanVersion = dialect.prepare(`INSERT INTO saas_plan_versions
    (id,plan_id,version_number,status,currency,billing_frequency,base_price,trial_days,grace_days,published_at,created_at)
    VALUES(?,?,?,?, 'USD','monthly', ?,?,?,?,?) ON CONFLICT(id) DO NOTHING`);
  for (const [id, versionNumber, status, price, trial, grace, publishedAt] of planVersions) {
    insertPlanVersion.run(id, planId, versionNumber, status, price, trial, grace, publishedAt, publishedAt);
  }

  const entitlement = dialect.prepare('INSERT INTO saas_plan_entitlements(plan_version_id,capability) VALUES(?,?) ON CONFLICT DO NOTHING');
  for (const capability of ['module:core', 'pack:al_warsha', 'capability:ai_operational_briefing']) entitlement.run(planvCurrent, capability);

  const limit = dialect.prepare(`INSERT INTO saas_plan_limits(plan_version_id,metric,allowance,unit,policy,warning_threshold,reset_policy)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`);
  for (const row of [['full_user', 10, 'seats', 'hard', 8, 'billing_period'], ['api_calls', 5000, 'calls', 'warning', 4000, 'billing_period']]) {
    limit.run(planvCurrent, ...row);
  }

  const tenantProfile = dialect.prepare(`INSERT INTO saas_tenant_profiles(tenant_id,deployment_profile,lifecycle_state,primary_company_id,support_status,created_at,updated_at)
    VALUES(?, 'managed_saas', ?, ?, 'standard', ?, ?) ON CONFLICT(tenant_id) DO NOTHING`);
  tenantProfile.run(tenantId, 'active', companyId, now, now);
  tenantProfile.run(ISOLATION_TENANT, 'active', ISOLATION_COMPANY, now, now);

  const tenantCompany = dialect.prepare(`INSERT INTO saas_tenant_companies(id,tenant_id,company_id,is_primary,attached_at,attached_by)
    VALUES(?,?,?,1,?, 'review-fixture') ON CONFLICT(id) DO NOTHING`);
  tenantCompany.run('rev_stc_review', tenantId, companyId, now);
  tenantCompany.run('rev_stc_isolation', ISOLATION_TENANT, ISOLATION_COMPANY, now);

  // trial / active / grace / suspended subscriptions for the review tenant,
  // plus one active subscription for the isolation tenant so isolation
  // review has something real to isolate against.
  const subscriptions = [
    ['rev_sub_trial', tenantId, planvCurrent, 'trial', now, now, addDays(now, 30), addDays(now, 14), null],
    ['rev_sub_active', tenantId, planvCurrent, 'active', addDays(now, -10), addDays(now, -10), addDays(now, 20), null, null],
    ['rev_sub_grace', tenantId, planvOld, 'grace', addDays(now, -40), addDays(now, -10), addDays(now, -2), null, addDays(now, 5)],
    ['rev_sub_suspended', tenantId, planvOld, 'suspended', addDays(now, -60), addDays(now, -30), addDays(now, -20), null, addDays(now, -13)],
    ['rev_sub_isolation_active', ISOLATION_TENANT, planvCurrent, 'active', addDays(now, -5), addDays(now, -5), addDays(now, 25), null, null],
  ];
  const insertSub = dialect.prepare(`INSERT INTO saas_subscriptions
    (id,tenant_id,plan_version_id,status,starts_at,current_period_start,current_period_end,trial_end_at,grace_end_at,seat_limit,currency,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?, 10, 'USD', ?, ?) ON CONFLICT(id) DO NOTHING`);
  for (const [id, tenant, planv, status, starts, periodStart, periodEnd, trialEnd, graceEnd] of subscriptions) {
    insertSub.run(id, tenant, planv, status, starts, periodStart, periodEnd, trialEnd, graceEnd, now, now);
  }

  const override = dialect.prepare(`INSERT INTO saas_entitlement_overrides(id,tenant_id,capability,effect,effective_from,reason,created_by,created_at)
    VALUES(?,?,?,?,?,?, 'review-fixture', ?) ON CONFLICT(id) DO NOTHING`);
  override.run('rev_entov_allow', tenantId, 'capability:ai_marketing_drafts', 'allow', now, '[DEMO] Manual grant for review of gated marketing AI drafts.', now);
  override.run('rev_entov_deny', ISOLATION_TENANT, 'capability:advanced_people_development', 'deny', now, '[DEMO] Explicit deny to review override precedence.', now);

  const seat = dialect.prepare(`INSERT INTO saas_seat_assignments(id,tenant_id,user_id,seat_type,status,assigned_at,assigned_by)
    VALUES(?,?,?,?, 'active', ?, 'review-fixture') ON CONFLICT(id) DO NOTHING`);
  seat.run('rev_seat_review', tenantId, 'usr_review_workshop_manager', 'full_user', now);
  seat.run('rev_seat_isolation', ISOLATION_TENANT, 'usr_review_isolation_viewer', 'full_user', now);

  // Hard-quota row: seats at/over the hard cap for the review tenant.
  dialect.prepare(`INSERT INTO saas_usage_counters(tenant_id,metric,period_start,period_end,consumed,allowance,warning_threshold,policy,remaining,reconciliation_status,updated_at)
    VALUES(?, 'full_user', ?, ?, 10, 10, 8, 'hard', 0, 'reconciled', ?) ON CONFLICT(tenant_id,metric,period_start) DO NOTHING`)
    .run(tenantId, addDays(now, -10), addDays(now, 20), now);

  // Quota-warning row: API usage approaching its warning threshold.
  dialect.prepare(`INSERT INTO saas_quota_warnings(id,tenant_id,metric,period_start,threshold,warning_type,emitted_at)
    VALUES(?,?, 'api_calls', ?, 4000, 'approaching_limit', ?) ON CONFLICT(id) DO NOTHING`)
    .run('rev_quotawarn_api_calls', tenantId, addDays(now, -10), now);

  // One simulated invoice — clearly labelled, never a real charge.
  dialect.prepare(`INSERT INTO saas_simulated_invoices
    (id,tenant_id,subscription_id,status,currency,period_start,period_end,base_amount,seat_amount,total_amount,simulation_label,created_at,updated_at)
    VALUES(?,?,?, 'issued', 'USD', ?, ?, 79, 30, 109, 'SIMULATION / NO EXTERNAL CHARGE / NO GL POSTING', ?, ?) ON CONFLICT(id) DO NOTHING`)
    .run('rev_invoice_demo', tenantId, 'rev_sub_active', addDays(now, -10), addDays(now, 20), now, now);

  // One safe package installation (extension catalog entry + tenant install).
  dialect.prepare(`INSERT INTO saas_extension_packages
    (id,package_id,publisher,name,version,compatibility_range,manifest_version,dependencies,capability_contributions,permissions_requested,declarations,provenance,review_state,publication_state,created_at,updated_at)
    VALUES(?, 'demo:analytics_addon', '[DEMO] Octagon Labs', '[DEMO] Analytics Add-on Package', '1.0.0', '>=11.0.0', '1', '[]', '["capability:analytics_dashboard"]', '[]', '{}', 'demo-fixture', 'approved', 'published', ?, ?) ON CONFLICT(id) DO NOTHING`)
    .run('rev_pkg_demo_addon', now, now);
  dialect.prepare(`INSERT INTO saas_extension_installations(id,tenant_id,package_id,package_version,state,installed_at,enabled_at,created_at,updated_at)
    VALUES(?,?, 'demo:analytics_addon', '1.0.0', 'enabled', ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
    .run('rev_ext_install_demo', tenantId, now, now, now, now);

  return {
    summary: {
      editions: 1,
      plans: 1,
      planVersions: planVersions.length,
      subscriptions: subscriptions.length,
      entitlementOverrides: 2,
      seatAssignments: 2,
      usageCounters: 1,
      quotaWarnings: 1,
      simulatedInvoices: 1,
      packageInstallations: 1,
      tenants: [tenantId, ISOLATION_TENANT],
    },
  };
}
