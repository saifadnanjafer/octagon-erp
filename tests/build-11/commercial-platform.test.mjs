import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import {
  createTenant, provisionTenant, attachTenantCompany, transitionTenant, createSubscription,
  transitionSubscription, publishPlanVersion, evaluateEntitlement, assignSeat, recordUsage,
  reconcileUsage, simulateInvoice, simulatePayment, validatePackage, approvePackage, stagePackage,
  setPackageState, listSaas, Build11Error,
} from '../../platform/build11/index.mjs';

function disposable(name) {
  const path = `${process.env.TEMP || process.env.TMP || '.'}/octagon-build11-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`;
  return path;
}

async function setup(name) {
  const path = disposable(name);
  await freshInstall({ dbPath: path });
  const db = openMigrationDatabase(path);
  createPlatformAuthority(db);
  const ctx = { tenantId: 'default', companyId: 'default', branchId: 'default', userId: 'build11-platform', correlationId: `build11-${name}`, sourceChannel: 'node-test' };
  return { db, path, ctx };
}

function close(fixture) { fixture.db.close(); fs.rmSync(fixture.path, { force: true }); }

test('BUILD-11 tenant lifecycle, ownership, and isolation are server-scoped', async () => {
  const f = await setup('tenancy');
  try {
    createTenant(f.db, { tenant_id: 'tenant_a', name: 'Tenant A' }, f.ctx);
    createTenant(f.db, { tenant_id: 'tenant_b', name: 'Tenant B' }, f.ctx);
    f.db.prepare("INSERT INTO platform_companies(id,tenant_id,name,status,fiscal_year_start,created_at) VALUES('company-a','tenant_a','Company A','active',1,?)").run(new Date().toISOString());
    f.db.prepare("INSERT INTO platform_companies(id,tenant_id,name,status,fiscal_year_start,created_at) VALUES('company-b','tenant_b','Company B','active',1,?)").run(new Date().toISOString());
    attachTenantCompany(f.db, { tenant_id: 'tenant_a', company_id: 'company-a', is_primary: true }, f.ctx);
    attachTenantCompany(f.db, { tenant_id: 'tenant_b', company_id: 'company-b', is_primary: true }, f.ctx);
    provisionTenant(f.db, { tenant_id: 'tenant_a', idempotency_key: 'prov-a' }, f.ctx);
    provisionTenant(f.db, { tenant_id: 'tenant_b', idempotency_key: 'prov-b' }, f.ctx);
    const aRows = listSaas(f.db, { tenantId: 'tenant_a' }, 'tenants').data;
    assert.deepEqual(aRows.map((row) => row.id), ['tenant_a']);
    assert.throws(() => listSaas(f.db, { tenantId: 'tenant_a' }, 'tenant', 'tenant_b'), (e) => e.code === 'TENANT_SCOPE_VIOLATION');
    assert.throws(() => attachTenantCompany(f.db, { tenant_id: 'tenant_a', company_id: 'company-b' }, f.ctx), (e) => e.code === 'TENANT_OWNERSHIP_VIOLATION');
    const replay = provisionTenant(f.db, { tenant_id: 'tenant_a', idempotency_key: 'prov-a' }, f.ctx);
    assert.equal(replay.tenant.lifecycle_state, 'trial');
    transitionTenant(f.db, { tenant_id: 'tenant_a', to_state: 'active', command: 'tenant:activate', idempotency_key: 'activate-a' }, f.ctx);
    assert.equal(f.db.prepare('SELECT lifecycle_state FROM saas_tenant_profiles WHERE tenant_id=?').get('tenant_a').lifecycle_state, 'active');
  } finally { close(f); }
});

test('BUILD-11 immutable plan versions and explainable subscription entitlement', async () => {
  const f = await setup('commercial');
  try {
    const version = publishPlanVersion(f.db, { plan_id: 'plan_workshop_core', base_price: 25, capabilities: ['module:core', 'capability:premium_reporting'], limits: [{ metric: 'api_calls', allowance: 2, unit: 'calls', policy: 'hard', warning_threshold: 1 }] }, f.ctx);
    assert.equal(version.status, 'published');
    assert.throws(() => publishPlanVersion(f.db, { plan_id: 'plan_workshop_core', version_id: version.id }, f.ctx), (e) => e.code === 'PLAN_VERSION_IMMUTABLE');
    createTenant(f.db, { tenant_id: 'tenant_commercial', name: 'Commercial Tenant' }, f.ctx);
    createSubscription(f.db, { tenant_id: 'tenant_commercial', plan_version_id: version.id, status: 'active', trial_days: 0 }, f.ctx);
    const allowed = evaluateEntitlement(f.db, { tenantId: 'tenant_commercial', userId: 'u1' }, 'capability:premium_reporting', { mutation: true });
    assert.equal(allowed.allowed, true);
    assert.equal(allowed.source, 'plan');
    assert.equal(allowed.reasonCode, 'ENTITLED');
    transitionSubscription(f.db, { subscription_id: f.db.prepare('SELECT id FROM saas_subscriptions WHERE tenant_id=?').get('tenant_commercial').id, to_status: 'suspended', reason: 'test' }, { ...f.ctx, tenantId: 'tenant_commercial' });
    const denied = evaluateEntitlement(f.db, { tenantId: 'tenant_commercial', userId: 'u1' }, 'capability:premium_reporting', { mutation: true });
    assert.equal(denied.allowed, false);
    assert.equal(denied.reasonCode, 'SUBSCRIPTION_STATE_BLOCKED');
    assert.match(denied.explanation, /suspended/);
  } finally { close(f); }
});

test('BUILD-11 seats, usage idempotency, hard quotas, and reconciliation', async () => {
  const f = await setup('usage');
  try {
    createTenant(f.db, { tenant_id: 'tenant_usage', name: 'Usage Tenant' }, f.ctx);
    const version = publishPlanVersion(f.db, { plan_id: 'plan_workshop_core', base_price: 10, capabilities: ['module:core'], limits: [{ metric: 'full_user', allowance: 1, unit: 'seats', policy: 'hard', warning_threshold: 1 }, { metric: 'api_calls', allowance: 2, unit: 'calls', policy: 'hard', warning_threshold: 1 }] }, f.ctx);
    createSubscription(f.db, { tenant_id: 'tenant_usage', plan_version_id: version.id, status: 'active', trial_days: 0 }, f.ctx);
    const tenantCtx = { ...f.ctx, tenantId: 'tenant_usage' };
    assignSeat(f.db, { tenant_id: 'tenant_usage', user_id: 'u1', seat_type: 'full_user' }, tenantCtx);
    assert.throws(() => assignSeat(f.db, { tenant_id: 'tenant_usage', user_id: 'u2', seat_type: 'full_user' }, tenantCtx), (e) => e.code === 'SEAT_LIMIT_REACHED');
    const first = recordUsage(f.db, { tenant_id: 'tenant_usage', metric: 'api_calls', quantity: 1, unit: 'calls', source: 'test', idempotency_key: 'usage-1' }, tenantCtx);
    const duplicate = recordUsage(f.db, { tenant_id: 'tenant_usage', metric: 'api_calls', quantity: 1, unit: 'calls', source: 'test', idempotency_key: 'usage-1' }, tenantCtx);
    assert.equal(duplicate.duplicate, true);
    recordUsage(f.db, { tenant_id: 'tenant_usage', metric: 'api_calls', quantity: 1, unit: 'calls', source: 'test', idempotency_key: 'usage-2' }, tenantCtx);
    assert.throws(() => recordUsage(f.db, { tenant_id: 'tenant_usage', metric: 'api_calls', quantity: 1, unit: 'calls', source: 'test', idempotency_key: 'usage-3' }, tenantCtx), (e) => e.code === 'QUOTA_HARD_LIMIT');
    const reconciliation = reconcileUsage(f.db, { tenant_id: 'tenant_usage', metric: 'api_calls' }, tenantCtx);
    assert.equal(reconciliation[0].status, 'reconciled');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM saas_usage_events WHERE tenant_id=?').get('tenant_usage').n, 2);
    assert.equal(first.counter.remaining, 1);
  } finally { close(f); }
});

test('BUILD-11 billing remains simulation-only and never writes Finance', async () => {
  const f = await setup('billing');
  try {
    createTenant(f.db, { tenant_id: 'tenant_billing', name: 'Billing Tenant' }, f.ctx);
    const sub = createSubscription(f.db, { tenant_id: 'tenant_billing', plan_version_id: 'planv_workshop_core_1', status: 'active', trial_days: 0 }, f.ctx);
    const financeBefore = f.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'finance_%'").get().n;
    const invoice = simulateInvoice(f.db, { tenant_id: 'tenant_billing', subscription_id: sub.id, discount_amount: 2, tax_metadata: { mode: 'simulated' } }, { ...f.ctx, tenantId: 'tenant_billing' });
    assert.match(invoice.simulation_label, /NO GL POSTING/);
    const payment = simulatePayment(f.db, { invoice_id: invoice.id, status: 'succeeded' }, { ...f.ctx, tenantId: 'tenant_billing' });
    assert.equal(payment.status, 'succeeded');
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'finance_%'").get().n, financeBefore);
  } finally { close(f); }
});

test('BUILD-11 invalid extensions are rejected and safe packages stage before entitlement-gated enablement', async () => {
  const f = await setup('extensions');
  try {
    const invalid = validatePackage(f.db, { manifest: { package_id: 'bad_pkg', publisher: 'bad', name: 'Bad', version: '1.0.0', compatibility_range: '*', manifest_version: '1', provenance: 'unknown', contributions: [{ type: 'arbitrary_code', source: 'eval()' }] } }, f.ctx);
    assert.ok(invalid.findings.some((finding) => finding.code === 'UNSAFE_EXECUTION_DECLARATION'));
    assert.throws(() => approvePackage(f.db, { package_id: 'bad_pkg' }, f.ctx), (e) => e.code === 'PACKAGE_VALIDATION_FAILED');
    const safe = validatePackage(f.db, { manifest: { package_id: 'safe_pkg', publisher: 'octagon', name: 'Terminology Pack', version: '1.0.0', compatibility_range: '*', manifest_version: '1', provenance: 'curated', checksum: 'sha256:test', signature: 'signed:test', permissions_requested: ['platform:saas:read'], contributions: [{ type: 'terminology_overlay', capability: 'module:core' }] } }, f.ctx);
    assert.deepEqual(safe.findings, []);
    approvePackage(f.db, { package_id: 'safe_pkg' }, f.ctx);
    createTenant(f.db, { tenant_id: 'tenant_ext', name: 'Extension Tenant' }, f.ctx);
    provisionTenant(f.db, { tenant_id: 'tenant_ext', idempotency_key: 'prov-ext' }, f.ctx);
    const staged = stagePackage(f.db, { package_id: 'safe_pkg', tenant_id: 'tenant_ext' }, { ...f.ctx, tenantId: 'tenant_ext' });
    assert.equal(staged.state, 'staged');
    const enabled = setPackageState(f.db, { installation_id: staged.id }, { ...f.ctx, tenantId: 'tenant_ext' }, 'enabled');
    assert.equal(enabled.state, 'enabled');
    const disabled = setPackageState(f.db, { installation_id: staged.id, reason: 'test rollback' }, { ...f.ctx, tenantId: 'tenant_ext' }, 'disabled');
    assert.equal(disabled.state, 'disabled');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM saas_extension_history WHERE installation_id=?').get(staged.id).n, 2);
  } finally { close(f); }
});

test('BUILD-11 rejects unregistered metrics and never returns a generic permission-only denial', async () => {
  const f = await setup('errors');
  try {
    createTenant(f.db, { tenant_id: 'tenant_errors', name: 'Error Tenant' }, f.ctx);
    createSubscription(f.db, { tenant_id: 'tenant_errors', plan_version_id: 'planv_workshop_core_1', status: 'active', trial_days: 0 }, f.ctx);
    assert.throws(() => recordUsage(f.db, { tenant_id: 'tenant_errors', metric: 'made_up_metric', quantity: 1, idempotency_key: 'x' }, { ...f.ctx, tenantId: 'tenant_errors' }), (e) => e instanceof Build11Error && e.code === 'USAGE_METRIC_UNKNOWN');
    const decision = evaluateEntitlement(f.db, { tenantId: 'tenant_errors' }, 'capability:not-in-plan', { mutation: true });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reasonCode, 'CAPABILITY_NOT_INCLUDED');
    assert.ok(decision.capability);
  } finally { close(f); }
});
