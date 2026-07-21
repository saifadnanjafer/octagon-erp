// Phase 02 Wave C — typed settings, inheritance, secrets, policies, authority
// limits, delegation, SoD, custom fields, views, configuration packages.
// Packets 02.12 – 02.16 and 02.22. Disposable databases only.

import assert from 'node:assert';
import crypto from 'node:crypto';
import { setup, cleanup, run, seedOrg } from './harness.mjs';
import { createSettingsAuthority, SettingsError, SCOPE_ORDER } from '../../platform/settings/index.mjs';
import { createSecretVault, SecretError, redactForLogs, resolveMasterKey } from '../../platform/settings/secrets/index.mjs';
import { createPolicyEngine, PolicyError } from '../../platform/policies/index.mjs';
import { createConfigurationAuthority, ConfigurationError, ConfigurationAuthority } from '../../platform/configuration/index.mjs';
import { createPermissionRegistry } from '../../platform/authorization/registry/index.mjs';
import { createPermissionEvaluator, AuthorizationError, REASON } from '../../platform/authorization/evaluator/index.mjs';
import { createRoleAdministration } from '../../platform/authorization/roles/index.mjs';
import { createMembershipDirectory } from '../../platform/organizations/memberships/index.mjs';
import { buildDecisionContext, stripUntrustedContext } from '../../platform/identity/context/index.mjs';

const TEST_KEY = crypto.randomBytes(32).toString('base64');

const PERMS = [
  { id: 'inventory:settings:manage', module_id: 'platform_kernel', kind: 'settings', label_ar: 'إدارة إعدادات المخزون' },
  { id: 'platform:configuration:manage', module_id: 'platform_kernel', kind: 'configuration', label_ar: 'إدارة الإعدادات' },
  { id: 'platform:configuration:share_view', module_id: 'platform_kernel', kind: 'configuration', label_ar: 'مشاركة العروض' },
  { id: 'platform:secrets:reveal', module_id: 'platform_kernel', kind: 'settings', label_ar: 'كشف السر' },
  { id: 'finance:invoice:create', module_id: 'platform_kernel', kind: 'action', label_ar: 'إنشاء فاتورة' },
  { id: 'finance:invoice:approve', module_id: 'platform_kernel', kind: 'action', label_ar: 'اعتماد فاتورة' },
  { id: 'finance:payment:execute', module_id: 'platform_kernel', kind: 'action', label_ar: 'تنفيذ دفعة' },
];

function bootstrap(dialect) {
  const org = seedOrg(dialect);
  const registry = createPermissionRegistry(dialect);
  registry.registerMany(PERMS);
  const policies = createPolicyEngine(dialect);
  const evaluator = createPermissionEvaluator(dialect, { permissionRegistry: registry, policyEngine: policies });
  policies.evaluator = evaluator;
  const roles = createRoleAdministration(dialect, { permissionRegistry: registry, evaluator });
  const memberships = createMembershipDirectory(dialect);
  const settings = createSettingsAuthority(dialect, { evaluator });
  const config = createConfigurationAuthority(dialect, { evaluator });
  const ctxFor = (userId, request = {}) =>
    buildDecisionContext(dialect, { actorId: userId, actorType: 'user' }, stripUntrustedContext(request), { membershipDirectory: memberships });
  return { org, registry, evaluator, roles, memberships, settings, config, policies, ctxFor };
}

function defineNegativeStock(settings) {
  return settings.define({
    key: 'inventory.allow_negative_stock',
    module_id: 'platform_kernel',
    type: 'boolean',
    default_value: 'false',
    scopes: ['tenant', 'company'],
    overridable_scopes: { tenant: true, company: true },
    required_permission: 'inventory:settings:manage',
    audit_policy: 'required',
    validation_rules: [],
  });
}

// --- 02.13 typed settings and inheritance -----------------------------------

async function testInheritancePrecedence() {
  const { dialect, dbPath } = await setup();
  const { org, settings } = bootstrap(dialect);
  settings.define({
    key: 'ui.rows_per_page', module_id: 'platform_kernel', type: 'integer', default_value: '25',
    scopes: ['system', 'tenant', 'company', 'user'],
    overridable_scopes: { tenant: true, company: true, user: true },
    validation_rules: [{ type: 'min', value: 5 }, { type: 'max', value: 200 }],
  });
  const ctx = { tenantId: org.tenantA, companyId: org.companyA1, userId: org.userClerk };
  assert.strictEqual(settings.effective('ui.rows_per_page', ctx).value, 25, 'falls back to the definition default');

  settings.set('ui.rows_per_page', 'tenant', org.tenantA, 50);
  assert.strictEqual(settings.effective('ui.rows_per_page', ctx).value, 50);

  settings.set('ui.rows_per_page', 'company', org.companyA1, 75);
  assert.strictEqual(settings.effective('ui.rows_per_page', ctx).value, 75, 'company beats tenant');

  settings.set('ui.rows_per_page', 'user', org.userClerk, 100);
  const eff = settings.effective('ui.rows_per_page', ctx);
  assert.strictEqual(eff.value, 100, 'user beats company');
  assert.strictEqual(eff.scope, 'user');
  assert.strictEqual(eff.source, 'override');

  // another company is unaffected
  assert.strictEqual(settings.effective('ui.rows_per_page', { tenantId: org.tenantA, companyId: org.companyA2 }).value, 50);
  await cleanup(dialect, dbPath);
}

async function testProhibitedOverrideAndInvalidValue() {
  const { dialect, dbPath } = await setup();
  const { org, settings } = bootstrap(dialect);
  settings.define({
    key: 'finance.lock_period', module_id: 'platform_kernel', type: 'boolean', default_value: 'true',
    scopes: ['tenant', 'company'],
    overridable_scopes: { company: false },
  });
  settings.set('finance.lock_period', 'tenant', org.tenantA, false);
  assert.throws(() => settings.set('finance.lock_period', 'company', org.companyA1, true),
    (e) => e instanceof SettingsError && e.code === 'SETTING_OVERRIDE_FORBIDDEN');
  // an unsupported scope is refused too
  assert.throws(() => settings.set('finance.lock_period', 'user', org.userClerk, true),
    (e) => e.code === 'SETTING_SCOPE_NOT_SUPPORTED');
  // an unknown key cannot be set at all
  assert.throws(() => settings.set('nope.not.defined', 'tenant', org.tenantA, 1), (e) => e.code === 'SETTING_UNKNOWN');

  settings.define({
    key: 'ui.page_size', module_id: 'platform_kernel', type: 'integer', default_value: '10',
    scopes: ['company'], overridable_scopes: { company: true },
    validation_rules: [{ type: 'min', value: 5 }, { type: 'max', value: 100 }],
  });
  assert.throws(() => settings.set('ui.page_size', 'company', org.companyA1, 500), (e) => e.code === 'SETTING_VALUE_INVALID');
  assert.throws(() => settings.set('ui.page_size', 'company', org.companyA1, 1), (e) => e.code === 'SETTING_VALUE_INVALID');
  await cleanup(dialect, dbPath);
}

async function testDisabledModuleBlocksSettingWrite() {
  const { dialect, dbPath } = await setup();
  const { org, settings } = bootstrap(dialect);
  defineNegativeStock(settings);
  dialect.prepare("UPDATE platform_modules SET status = 'installed' WHERE id = 'platform_kernel'").run();
  assert.throws(() => settings.set('inventory.allow_negative_stock', 'company', org.companyA1, true),
    (e) => e.code === 'SETTING_MODULE_DISABLED');
  await cleanup(dialect, dbPath);
}

async function testSettingsPermissionEnforced() {
  const { dialect, dbPath } = await setup();
  const { org, settings, roles, ctxFor } = bootstrap(dialect);
  defineNegativeStock(settings);
  const clerkCtx = ctxFor(org.userClerk);
  assert.throws(() => settings.set('inventory.allow_negative_stock', 'company', org.companyA1, true, { ctx: clerkCtx }),
    (e) => e instanceof AuthorizationError);

  roles.createRole({ id: 'r_inv', tenantId: org.tenantA, name: 'inventory_admin' });
  roles.setGrants('r_inv', [{ permission: 'inventory:settings:manage', scope: 'company' }]);
  roles.assign({ userId: org.userManager, roleId: 'r_inv', companyId: org.companyA1 });
  const mgrCtx = ctxFor(org.userManager);
  const result = settings.set('inventory.allow_negative_stock', 'company', org.companyA1, true, { ctx: mgrCtx, actor: org.userManager });
  assert.strictEqual(result.value, true);
  await cleanup(dialect, dbPath);
}

async function testVersioningRollbackAndConflict() {
  const { dialect, dbPath } = await setup();
  const { org, settings } = bootstrap(dialect);
  settings.define({ key: 'ui.theme', module_id: 'platform_kernel', type: 'string', default_value: 'light', scopes: ['company'], overridable_scopes: { company: true } });
  const v1 = settings.set('ui.theme', 'company', org.companyA1, 'dark', { actor: org.userOwner });
  assert.strictEqual(v1.version, 1);
  const v2 = settings.set('ui.theme', 'company', org.companyA1, 'neumorphism', { actor: org.userOwner });
  assert.strictEqual(v2.version, 2);

  // optimistic concurrency
  assert.throws(() => settings.set('ui.theme', 'company', org.companyA1, 'x', { expectedVersion: 1 }),
    (e) => e.code === 'SETTING_VERSION_CONFLICT');

  // history and revert
  const history = settings.history('ui.theme');
  assert.strictEqual(history.length, 2);
  settings.revert('ui.theme', 'company', org.companyA1, 2);
  assert.strictEqual(settings.effective('ui.theme', { companyId: org.companyA1 }).value, 'dark', 'revert restores the pre-v2 value');

  // effective-value cache is invalidated by every write
  settings.set('ui.theme', 'company', org.companyA1, 'paper');
  assert.strictEqual(settings.effective('ui.theme', { companyId: org.companyA1 }).value, 'paper');
  await cleanup(dialect, dbPath);
}

async function testSettingsPreviewAndAudit() {
  const { dialect, dbPath } = await setup();
  const { org, settings } = bootstrap(dialect);
  settings.define({ key: 'ui.density', module_id: 'platform_kernel', type: 'string', default_value: 'normal', scopes: ['tenant', 'company'], overridable_scopes: { company: false } });
  settings.set('ui.density', 'tenant', org.tenantA, 'compact');

  const allowed = settings.preview('ui.density', 'tenant', org.tenantA, 'roomy', { tenantId: org.tenantA });
  assert.strictEqual(allowed.wouldApply, true);
  assert.strictEqual(allowed.before, 'compact');
  assert.strictEqual(allowed.after, 'roomy');

  const forbidden = settings.preview('ui.density', 'company', org.companyA1, 'roomy', { tenantId: org.tenantA, companyId: org.companyA1 });
  assert.strictEqual(forbidden.wouldApply, false);
  assert.strictEqual(forbidden.overrideForbidden, 'SETTING_OVERRIDE_FORBIDDEN');
  // preview mutated nothing
  assert.strictEqual(settings.effective('ui.density', { tenantId: org.tenantA }).value, 'compact');

  const audits = dialect.prepare("SELECT COUNT(*) AS n FROM platform_audit_log WHERE action = 'settings.set'").get();
  assert.ok(Number(audits.n) >= 1, 'setting changes are audited');
  await cleanup(dialect, dbPath);
}

// --- 02.14 secrets ----------------------------------------------------------

function vaultFor(dialect, evaluator) {
  return createSecretVault(dialect, { key: TEST_KEY, evaluator });
}

async function testSecretNotInDatabaseOrApi() {
  const { dialect, dbPath } = await setup();
  const { evaluator } = bootstrap(dialect);
  const vault = vaultFor(dialect, evaluator);
  const PLAINTEXT = 'wa-token-SUPER-SECRET-9911';
  vault.declare({ ref: 'secret://integrations.whatsapp.access_token', moduleId: 'platform_kernel', label: 'WhatsApp token', requiredPermission: 'platform:secrets:reveal', rotationRequired: true });
  vault.set('secret://integrations.whatsapp.access_token', PLAINTEXT);

  // database inspection finds no plaintext anywhere
  const tables = dialect.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  for (const { name } of tables) {
    const rows = dialect.prepare(`SELECT * FROM "${name}"`).all();
    assert.ok(!JSON.stringify(rows).includes(PLAINTEXT), `plaintext secret leaked into table ${name}`);
  }
  // the metadata surface a config UI sees never carries it
  const described = vault.describe('secret://integrations.whatsapp.access_token');
  assert.strictEqual(described.display, '••••••••');
  assert.strictEqual(described.isSet, true);
  assert.ok(!JSON.stringify(described).includes(PLAINTEXT));
  // export for backup carries no value
  assert.ok(vault.exportSafe().every((s) => s.value === null));
  // but a server-side consumer can use it
  assert.strictEqual(vault.use('secret://integrations.whatsapp.access_token', (p) => p), PLAINTEXT);
  await cleanup(dialect, dbPath);
}

async function testSecretRevealIsRefusedByDefault() {
  const { dialect, dbPath } = await setup();
  const { org, evaluator, roles, ctxFor } = bootstrap(dialect);
  const vault = vaultFor(dialect, evaluator);
  vault.declare({ ref: 'secret://a.b', moduleId: 'platform_kernel', requiredPermission: 'platform:secrets:reveal' });
  vault.set('secret://a.b', 'value-1');

  roles.createRole({ id: 'r_sec', tenantId: org.tenantA, name: 'sec' });
  roles.setGrants('r_sec', [{ permission: 'platform:secrets:reveal', scope: 'all' }]);
  roles.assign({ userId: org.userOwner, roleId: 'r_sec', companyId: org.companyA1 });
  const ownerCtx = ctxFor(org.userOwner);

  // reveal_policy defaults to 'never' — even a permitted admin is refused
  assert.throws(() => vault.reveal('secret://a.b', { ctx: ownerCtx, reason: 'debugging the integration' }),
    (e) => e.code === 'SECRET_REVEAL_FORBIDDEN');

  // an explicitly restricted secret can be revealed with permission + reason, and is audited
  vault.declare({ ref: 'secret://c.d', moduleId: 'platform_kernel', requiredPermission: 'platform:secrets:reveal', revealPolicy: 'restricted' });
  vault.set('secret://c.d', 'value-2');
  assert.throws(() => vault.reveal('secret://c.d', { ctx: ownerCtx, reason: 'x' }), (e) => e.code === 'SECRET_REVEAL_REASON_REQUIRED');
  assert.strictEqual(vault.reveal('secret://c.d', { ctx: ownerCtx, reason: 'rotating at the provider' }), 'value-2');
  const events = dialect.prepare("SELECT * FROM secret_events WHERE event = 'reveal'").all();
  assert.strictEqual(events.length, 1);
  assert.ok(JSON.parse(events[0].detail).reason.includes('rotating'));

  // an unauthorized actor is refused
  const clerkCtx = ctxFor(org.userClerk);
  assert.throws(() => vault.reveal('secret://c.d', { ctx: clerkCtx, reason: 'curiosity is a reason' }), (e) => e instanceof AuthorizationError);
  await cleanup(dialect, dbPath);
}

async function testSecretRotationAndCorruption() {
  const { dialect, dbPath } = await setup();
  const { evaluator } = bootstrap(dialect);
  const vault = vaultFor(dialect, evaluator);
  vault.declare({ ref: 'secret://rot.key', moduleId: 'platform_kernel' });
  vault.set('secret://rot.key', 'original-value');

  const newKey = crypto.randomBytes(32).toString('base64');
  const result = vault.rotateKey(newKey);
  assert.strictEqual(result.keyVersion, 2);
  assert.ok(result.rotated.includes('secret://rot.key'));
  assert.strictEqual(vault.use('secret://rot.key', (p) => p), 'original-value', 'the value survives key rotation');
  assert.strictEqual(vault.describe('secret://rot.key').keyVersion, 2);

  // corrupted ciphertext is a hard failure, never a silent empty credential
  dialect.prepare("UPDATE secret_values SET ciphertext = ? WHERE ref = ? AND active = 1").run(Buffer.from('tampered').toString('base64'), 'secret://rot.key');
  assert.throws(() => vault.use('secret://rot.key', (p) => p), (e) => e.code === 'SECRET_CORRUPT');
  assert.ok(dialect.prepare("SELECT COUNT(*) AS n FROM secret_events WHERE event = 'decrypt_failed'").get().n >= 1);
  await cleanup(dialect, dbPath);
}

async function testSecretKeyFailsClosed() {
  const { dialect, dbPath } = await setup();
  const previous = process.env.OCTAGON_SECRET_KEY;
  delete process.env.OCTAGON_SECRET_KEY;
  try {
    const vault = createSecretVault(dialect, {});
    vault.declare({ ref: 'secret://x.y', moduleId: 'platform_kernel' });
    assert.throws(() => vault.set('secret://x.y', 'anything'), (e) => e.code === 'SECRET_KEY_UNAVAILABLE',
      'without a key the vault refuses to write, it never falls back to plaintext');
    assert.throws(() => resolveMasterKey(Buffer.from('too-short').toString('base64')), (e) => e.code === 'SECRET_KEY_INVALID');
    // a settings write of a secret-typed key is refused as well
    const { settings } = bootstrap(dialect);
    settings.define({ key: 'integrations.token', module_id: 'platform_kernel', type: 'string', secret: true, scopes: ['tenant'], overridable_scopes: { tenant: true } });
    assert.throws(() => settings.set('integrations.token', 'tenant', 't_alpha', 'leak-me'), (e) => e.code === 'SETTING_IS_SECRET');
  } finally {
    if (previous !== undefined) process.env.OCTAGON_SECRET_KEY = previous;
  }
  await cleanup(dialect, dbPath);
}

async function testLogAndSupportBundleRedaction() {
  const { dialect, dbPath } = await setup();
  const bundle = {
    request: { headers: { authorization: ['Bearer', 'eyJhbGciOiJIUzI1NiJ9.payloadpayloadpayload.signature'].join(' ') } },
    integration: { client_secret: 'abc123secret', ref: 'secret://integrations.whatsapp.access_token' },
    trace: 'issued key ok_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345',
    harmless: 'order 4711 completed',
  };
  const clean = redactForLogs(bundle);
  assert.strictEqual(clean.request.headers.authorization, '***REDACTED***');
  assert.strictEqual(clean.integration.client_secret, '***REDACTED***');
  assert.strictEqual(clean.integration.ref, 'secret://integrations.whatsapp.access_token', 'a reference is safe and stays readable');
  assert.ok(!clean.trace.includes('ok_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'));
  assert.strictEqual(clean.harmless, 'order 4711 completed');
  await cleanup(dialect, dbPath);
}

// --- 02.12 authority limits, delegation, SoD --------------------------------

async function testAuthorityLimitThresholdBoundary() {
  const { dialect, dbPath } = await setup();
  const { org, evaluator, roles, policies, ctxFor } = bootstrap(dialect);
  roles.createRole({ id: 'r_fin', tenantId: org.tenantA, name: 'finance' });
  roles.setGrants('r_fin', [{ permission: 'finance:invoice:create', scope: 'company' }]);
  roles.assign({ userId: org.userClerk, roleId: 'r_fin', companyId: org.companyA1 });
  policies.setAuthorityLimit({ roleId: 'r_fin', permission: 'finance:invoice:create', maxAmount: 1000 });

  const ctx = ctxFor(org.userClerk);
  assert.strictEqual(evaluator.evaluate({ permission: 'finance:invoice:create', ctx, amount: 999 }).allowed, true);
  assert.strictEqual(evaluator.evaluate({ permission: 'finance:invoice:create', ctx, amount: 1000 }).allowed, true, 'the boundary itself is allowed');
  const over = evaluator.evaluate({ permission: 'finance:invoice:create', ctx, amount: 1001 });
  assert.strictEqual(over.allowed, false);
  assert.strictEqual(over.reasonCode, 'AUTHORITY_LIMIT_EXCEEDED');
  assert.ok(over.policyReferences.some((p) => p.startsWith('authority_limit:')));
  await cleanup(dialect, dbPath);
}

async function testAuthorityLimitEscalatesToApproval() {
  const { dialect, dbPath } = await setup();
  const { org, evaluator, roles, policies, ctxFor } = bootstrap(dialect);
  roles.createRole({ id: 'r_fin', tenantId: org.tenantA, name: 'finance' });
  roles.setGrants('r_fin', [{ permission: 'finance:invoice:create', scope: 'company' }]);
  roles.assign({ userId: org.userClerk, roleId: 'r_fin', companyId: org.companyA1 });
  policies.setAuthorityLimit({ roleId: 'r_fin', permission: 'finance:invoice:create', maxAmount: 1000 });
  policies.define({ id: 'pol_escalate', moduleId: 'platform_kernel', category: 'authority_limit', name: 'escalate_over_limit', severity: 'require_approval', priority: 10 });
  policies.addVersion('pol_escalate', { rule: { amountAbove: 1000 }, appliesTo: ['finance:invoice:create'] });

  const d = evaluator.evaluate({ permission: 'finance:invoice:create', ctx: ctxFor(org.userClerk), amount: 5000 });
  assert.strictEqual(d.allowed, true, 'over the limit it becomes an approval, not a hard denial');
  assert.strictEqual(d.requiredApproval, true);
  await cleanup(dialect, dbPath);
}

async function testDelegationLifecycle() {
  const { dialect, dbPath } = await setup();
  const { org, evaluator, roles, policies, ctxFor } = bootstrap(dialect);
  roles.createRole({ id: 'r_appr', tenantId: org.tenantA, name: 'approver' });
  roles.setGrants('r_appr', [{ permission: 'finance:invoice:approve', scope: 'company' }]);
  roles.assign({ userId: org.userManager, roleId: 'r_appr', companyId: org.companyA1 });

  // the clerk cannot approve
  assert.strictEqual(evaluator.evaluate({ permission: 'finance:invoice:approve', ctx: ctxFor(org.userClerk) }).allowed, false);

  const del = policies.delegate({
    fromUserId: org.userManager, toUserId: org.userClerk,
    permissions: ['finance:invoice:approve'], companyId: org.companyA1,
    reason: 'annual leave cover',
    validFrom: '2026-07-01T00:00:00.000Z', validTo: '2027-07-01T00:00:00.000Z',
  }, org.userManager, ctxFor(org.userManager));
  assert.strictEqual(evaluator.evaluate({ permission: 'finance:invoice:approve', ctx: ctxFor(org.userClerk) }).allowed, true);

  // self-delegation and unbounded delegation are refused
  assert.throws(() => policies.delegate({ fromUserId: org.userClerk, toUserId: org.userClerk, permissions: [], validTo: '2027-01-01T00:00:00.000Z' }), (e) => e.code === 'DELEGATION_SELF');
  assert.throws(() => policies.delegate({ fromUserId: org.userManager, toUserId: org.userClerk, permissions: [] }), (e) => e.code === 'DELEGATION_UNBOUNDED');
  assert.throws(() => policies.delegate({ fromUserId: org.userManager, toUserId: org.userBeta, permissions: [], validTo: '2027-01-01T00:00:00.000Z' }), (e) => e.code === 'DELEGATION_CROSS_TENANT');

  // no escalation: you cannot delegate what you do not hold
  assert.throws(() => policies.delegate({
    fromUserId: org.userClerk, toUserId: org.userOutsider, permissions: ['finance:payment:execute'],
    validTo: '2027-01-01T00:00:00.000Z',
  }, org.userClerk, ctxFor(org.userClerk)), (e) => e.code === 'DELEGATION_ESCALATION');

  // revocation is immediate
  policies.revokeDelegation(del.id);
  assert.strictEqual(evaluator.evaluate({ permission: 'finance:invoice:approve', ctx: ctxFor(org.userClerk) }).allowed, false);
  await cleanup(dialect, dbPath);
}

async function testExpiredAndOverlappingDelegations() {
  const { dialect, dbPath } = await setup();
  const { org, evaluator, roles, policies, ctxFor } = bootstrap(dialect);
  roles.createRole({ id: 'r_appr', tenantId: org.tenantA, name: 'approver' });
  roles.setGrants('r_appr', [{ permission: 'finance:invoice:approve', scope: 'company' }]);
  roles.assign({ userId: org.userManager, roleId: 'r_appr', companyId: org.companyA1 });
  roles.assign({ userId: org.userOwner, roleId: 'r_appr', companyId: org.companyA1 });

  // already expired
  policies.delegate({
    fromUserId: org.userManager, toUserId: org.userClerk, permissions: ['finance:invoice:approve'],
    validFrom: '2020-01-01T00:00:00.000Z', validTo: '2020-02-01T00:00:00.000Z',
  }, org.userManager, ctxFor(org.userManager));
  assert.strictEqual(evaluator.evaluate({ permission: 'finance:invoice:approve', ctx: ctxFor(org.userClerk) }).allowed, false, 'an expired delegation grants nothing');

  // two overlapping live delegations both resolve; the union applies
  policies.delegate({ fromUserId: org.userManager, toUserId: org.userClerk, permissions: ['finance:invoice:approve'], validFrom: '2026-01-01T00:00:00.000Z', validTo: '2027-01-01T00:00:00.000Z' }, org.userManager, ctxFor(org.userManager));
  policies.delegate({ fromUserId: org.userOwner, toUserId: org.userClerk, permissions: ['finance:invoice:approve'], validFrom: '2026-06-01T00:00:00.000Z', validTo: '2027-06-01T00:00:00.000Z' }, org.userOwner, ctxFor(org.userOwner));
  const ctx = ctxFor(org.userClerk);
  assert.strictEqual(ctx.delegations.length, 2);
  assert.strictEqual(evaluator.evaluate({ permission: 'finance:invoice:approve', ctx }).allowed, true);
  await cleanup(dialect, dbPath);
}

async function testDelegationCarriesItsOwnAmountCap() {
  const { dialect, dbPath } = await setup();
  const { org, evaluator, roles, policies, ctxFor } = bootstrap(dialect);
  roles.createRole({ id: 'r_appr', tenantId: org.tenantA, name: 'approver' });
  roles.setGrants('r_appr', [{ permission: 'finance:invoice:approve', scope: 'company' }]);
  roles.assign({ userId: org.userManager, roleId: 'r_appr', companyId: org.companyA1 });
  policies.delegate({
    fromUserId: org.userManager, toUserId: org.userClerk, permissions: ['finance:invoice:approve'],
    maxAmount: 500, companyId: org.companyA1,
    validFrom: '2026-01-01T00:00:00.000Z', validTo: '2027-01-01T00:00:00.000Z',
  }, org.userManager, ctxFor(org.userManager));
  const ctx = ctxFor(org.userClerk);
  assert.strictEqual(evaluator.evaluate({ permission: 'finance:invoice:approve', ctx, amount: 400 }).allowed, true);
  const over = evaluator.evaluate({ permission: 'finance:invoice:approve', ctx, amount: 900 });
  assert.strictEqual(over.allowed, false);
  assert.strictEqual(over.reasonCode, 'AUTHORITY_LIMIT_EXCEEDED');
  await cleanup(dialect, dbPath);
}

async function testSegregationOfDuties() {
  const { dialect, dbPath } = await setup();
  const { org, evaluator, roles, policies, ctxFor } = bootstrap(dialect);
  policies.defineSodRule({
    id: 'sod_create_approve', name: 'create_vs_approve', labelAr: 'الإنشاء مقابل الاعتماد',
    leftPermission: 'finance:invoice:create', rightPermission: 'finance:invoice:approve',
  });
  policies.defineSodRule({
    id: 'sod_approve_pay', name: 'approve_vs_pay', labelAr: 'الاعتماد مقابل الدفع',
    leftPermission: 'finance:invoice:approve', rightPermission: 'finance:payment:execute',
    allowEmergencyOverride: true,
  });

  roles.createRole({ id: 'r_maker', tenantId: org.tenantA, name: 'maker' });
  roles.setGrants('r_maker', [{ permission: 'finance:invoice:create', scope: 'company' }]);
  roles.createRole({ id: 'r_checker', tenantId: org.tenantA, name: 'checker' });
  roles.setGrants('r_checker', [{ permission: 'finance:invoice:approve', scope: 'company' }]);
  roles.assign({ userId: org.userClerk, roleId: 'r_maker', companyId: org.companyA1 });

  // assignment-time conflict is detected BEFORE the grant is made
  const conflicts = policies.checkAssignmentSod(org.userClerk, 'r_checker', org.companyA1);
  assert.strictEqual(conflicts.length, 1);
  assert.strictEqual(conflicts[0].id, 'sod_create_approve');

  // transaction-time: the same actor cannot approve what they created
  seedRecordFor(dialect, 'invoice', 'inv_1', org.companyA1, org.userClerk);
  roles.assign({ userId: org.userClerk, roleId: 'r_checker', companyId: org.companyA1 });
  const ctx = ctxFor(org.userClerk);
  assert.strictEqual(evaluator.evaluate({ permission: 'finance:invoice:create', ctx, entity: 'invoice', recordId: 'inv_1' }).allowed, true);
  const approve = evaluator.evaluate({ permission: 'finance:invoice:approve', ctx, entity: 'invoice', recordId: 'inv_1' });
  assert.strictEqual(approve.allowed, false, 'maker cannot be checker on the same record');
  assert.strictEqual(approve.reasonCode, 'SOD_CONFLICT');

  // a different actor is unaffected
  roles.assign({ userId: org.userManager, roleId: 'r_checker', companyId: org.companyA1 });
  assert.strictEqual(evaluator.evaluate({ permission: 'finance:invoice:approve', ctx: ctxFor(org.userManager), entity: 'invoice', recordId: 'inv_1' }).allowed, true);
  await cleanup(dialect, dbPath);
}

function seedRecordFor(dialect, entity, id, companyId, createdBy) {
  const now = new Date().toISOString();
  dialect.prepare(`INSERT INTO x_records (entity, id, company_id, data, created_at, updated_at, created_by, removed, version) VALUES (?,?,?,?,?,?,?,0,1)`)
    .run(entity, id, companyId, '{}', now, now, createdBy);
}

async function testEmergencyOverrideIsRecorded() {
  const { dialect, dbPath } = await setup();
  const { org, policies } = bootstrap(dialect);
  assert.throws(() => policies.recordOverride({ sodRuleId: 'sod_x', actorId: org.userOwner, reason: 'no' }), (e) => e.code === 'OVERRIDE_REASON_REQUIRED');
  const id = policies.recordOverride({ sodRuleId: 'sod_x', actorId: org.userOwner, reason: 'production incident 88, CFO approved verbally', recordRef: 'invoice:inv_1', approvedBy: org.userOwner });
  const row = dialect.prepare('SELECT * FROM policy_overrides WHERE id = ?').get(id);
  assert.ok(row.reason.includes('production incident 88'));
  const audit = dialect.prepare("SELECT COUNT(*) AS n FROM platform_audit_log WHERE action = 'policy.override'").get();
  assert.strictEqual(Number(audit.n), 1);
  await cleanup(dialect, dbPath);
}

// --- 02.22 policy engine ----------------------------------------------------

async function testPolicyPrecedenceConflictAndExplain() {
  const { dialect, dbPath } = await setup();
  const { org, policies, roles, ctxFor } = bootstrap(dialect);
  roles.createRole({ id: 'r_fin', tenantId: org.tenantA, name: 'finance' });
  roles.setGrants('r_fin', [{ permission: 'finance:invoice:create', scope: 'company' }]);
  roles.assign({ userId: org.userClerk, roleId: 'r_fin', companyId: org.companyA1 });

  policies.define({ id: 'pol_deny', moduleId: 'platform_kernel', category: 'export_restriction', name: 'deny_big', severity: 'deny', priority: 10 });
  policies.addVersion('pol_deny', { rule: { amountAbove: 10000 }, appliesTo: ['finance:invoice:create'] });
  policies.define({ id: 'pol_appr', moduleId: 'platform_kernel', category: 'approval_requirement', name: 'approve_medium', severity: 'require_approval', priority: 20 });
  policies.addVersion('pol_appr', { rule: { amountAbove: 1000 }, appliesTo: ['finance:invoice:create'] });

  const ctx = ctxFor(org.userClerk);
  assert.strictEqual(policies.evaluate({ permission: 'finance:invoice:create', ctx, amount: 500 }).requiresApproval, false);
  assert.strictEqual(policies.evaluate({ permission: 'finance:invoice:create', ctx, amount: 5000 }).requiresApproval, true);
  const denied = policies.evaluate({ permission: 'finance:invoice:create', ctx, amount: 50000 });
  assert.strictEqual(denied.denied, true, 'the lower-priority deny policy wins');

  const conflict = policies.conflictReport();
  assert.strictEqual(conflict.hasConflicts, true);
  assert.strictEqual(conflict.conflicts[0].resolvedBy, 'pol_deny');

  const explanation = policies.explain({ permission: 'finance:invoice:create', ctx, amount: 50000 });
  assert.strictEqual(explanation.outcome, 'denied');
  assert.ok(explanation.policyReferences.includes('pol_deny@v1'));
  assert.ok(explanation.evaluatedPolicies.length >= 2);
  await cleanup(dialect, dbPath);
}

async function testPolicyVersioningAndCoverage() {
  const { dialect, dbPath } = await setup();
  const { org, policies, roles, ctxFor } = bootstrap(dialect);
  policies.define({ id: 'pol_v', moduleId: 'platform_kernel', category: 'approval_requirement', name: 'v', severity: 'require_approval' });
  policies.addVersion('pol_v', { rule: { amountAbove: 100 }, appliesTo: ['finance:invoice:create'] });
  policies.addVersion('pol_v', { rule: { amountAbove: 5000 }, appliesTo: ['finance:invoice:create'] });
  assert.strictEqual(policies.getPolicy('pol_v').activeVersion, 2);
  // the v1 row is still on record — policies are append-only
  assert.strictEqual(dialect.prepare("SELECT COUNT(*) AS n FROM policy_versions WHERE policy_id = 'pol_v'").get().n, 2);

  roles.createRole({ id: 'r_fin', tenantId: org.tenantA, name: 'finance' });
  roles.setGrants('r_fin', [{ permission: 'finance:invoice:create', scope: 'company' }]);
  roles.assign({ userId: org.userClerk, roleId: 'r_fin', companyId: org.companyA1 });
  const ctx = ctxFor(org.userClerk);
  assert.strictEqual(policies.evaluate({ permission: 'finance:invoice:create', ctx, amount: 1000 }).requiresApproval, false, 'only the active version applies');

  const coverage = policies.coverageReport(['finance:invoice:create', 'finance:payment:execute']);
  assert.strictEqual(coverage.allSensitiveCovered, false);
  assert.ok(coverage.sensitivePermissions.find((s) => s.permission === 'finance:invoice:create').covered);
  assert.ok(!coverage.sensitivePermissions.find((s) => s.permission === 'finance:payment:execute').covered);
  await cleanup(dialect, dbPath);
}

// --- 02.15 controlled configuration ------------------------------------------

async function testProtectedEntitiesAndFieldsRefused() {
  const { dialect, dbPath } = await setup();
  const { config } = bootstrap(dialect);
  for (const entity of ['account_moves', 'identity_users', 'authorization_grants', 'employees', 'timesheet']) {
    assert.throws(() => config.defineCustomField({ entity, field: 'sneaky', dataType: 'string', labelAr: 'خ' }),
      (e) => e instanceof ConfigurationError && e.code === 'CONFIGURATION_PROTECTED', `${entity} must be protected`);
  }
  assert.throws(() => config.defineCustomField({ entity: 'crm_lead', field: 'company_id', dataType: 'string', labelAr: 'خ' }),
    (e) => e.code === 'CONFIGURATION_PROTECTED');
  // a normal entity/field is fine
  const field = config.defineCustomField({ entity: 'crm_lead', field: 'referral_code', dataType: 'string', labelAr: 'رمز الإحالة', labelEn: 'Referral code' });
  assert.strictEqual(field.field, 'referral_code');
  await cleanup(dialect, dbPath);
}

async function testCustomFieldIssuesNoDdl() {
  const { dialect, dbPath } = await setup();
  const { config } = bootstrap(dialect);
  const before = dialect.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='x_records'").get().sql;
  config.defineCustomField({ entity: 'crm_lead', field: 'lead_score', dataType: 'integer', labelAr: 'درجة العميل', validation: [{ type: 'min', value: 0 }, { type: 'max', value: 100 }] });
  const after = dialect.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='x_records'").get().sql;
  assert.strictEqual(before, after, 'declaring a custom field must not alter any table');

  const valid = config.validateCustomValues('crm_lead', { lead_score: 50 });
  assert.strictEqual(valid.ok, true);
  const invalid = config.validateCustomValues('crm_lead', { lead_score: 500 });
  assert.strictEqual(invalid.ok, false);
  assert.strictEqual(invalid.errors[0].code, 'MAX');
  await cleanup(dialect, dbPath);
}

async function testCustomFieldValidationAndArchival() {
  const { dialect, dbPath } = await setup();
  const { org, config } = bootstrap(dialect);
  assert.throws(() => config.defineCustomField({ entity: 'crm_lead', field: 'Bad-Name', dataType: 'string', labelAr: 'x' }), (e) => e.code === 'CUSTOM_FIELD_NAME_INVALID');
  assert.throws(() => config.defineCustomField({ entity: 'crm_lead', field: 'ok_field', dataType: 'blob', labelAr: 'x' }), (e) => e.code === 'CUSTOM_FIELD_TYPE_INVALID');
  assert.throws(() => config.defineCustomField({ entity: 'crm_lead', field: 'ok_field', dataType: 'string' }), (e) => e.code === 'CUSTOM_FIELD_LABEL_REQUIRED');
  assert.throws(() => config.defineCustomField({ entity: 'crm_lead', field: 'ok_field', dataType: 'select', labelAr: 'x', options: [] }), (e) => e.code === 'CUSTOM_FIELD_OPTIONS_REQUIRED');

  // archiving keeps data readable
  config.defineCustomField({ entity: 'crm_lead', field: 'legacy_code', dataType: 'string', labelAr: 'رمز قديم' });
  seedRecordFor(dialect, 'crm_lead', 'lead_1', org.companyA1, org.userClerk);
  dialect.prepare("UPDATE x_records SET data = ? WHERE id = 'lead_1'").run(JSON.stringify({ legacy_code: 'ABC' }));
  const archived = config.archiveCustomField('crm_lead', 'legacy_code');
  assert.strictEqual(archived.recordsRetainingValue, 1, 'data is retained, not destroyed');
  assert.ok(!config.customFields('crm_lead').some((f) => f.field === 'legacy_code'));
  const stillThere = JSON.parse(dialect.prepare("SELECT data FROM x_records WHERE id = 'lead_1'").get().data);
  assert.strictEqual(stillThere.legacy_code, 'ABC');
  await cleanup(dialect, dbPath);
}

async function testUnsafeFilterRejected() {
  const { dialect, dbPath } = await setup();
  const { config } = bootstrap(dialect);
  assert.throws(() => config.assertSafeFilters("1=1; DROP TABLE x_records"), (e) => e.code === 'FILTER_UNSAFE');
  assert.throws(() => config.assertSafeFilters({ 'name; DROP TABLE': { op: 'eq', value: 1 } }), (e) => e.code === 'FILTER_UNSAFE');
  assert.throws(() => config.assertSafeFilters({ name: { op: 'raw_sql', value: '1=1' } }), (e) => e.code === 'FILTER_UNSAFE');
  assert.strictEqual(config.assertSafeFilters({ status: { op: 'in', value: ['new', 'won'] }, amount: { op: 'gte', value: 100 } }), true);
  await cleanup(dialect, dbPath);
}

async function testSharedViewRequiresPermissionAndScope() {
  const { dialect, dbPath } = await setup();
  const { org, config, roles, ctxFor } = bootstrap(dialect);
  const clerkCtx = ctxFor(org.userClerk);
  // a personal view needs nothing extra
  const personal = config.saveView({ entity: 'crm_lead', name: 'قائمتي', ownerId: org.userClerk, filters: { status: { op: 'eq', value: 'new' } } }, org.userClerk, clerkCtx);
  assert.strictEqual(personal.shared, false);
  // sharing is a governed act
  assert.throws(() => config.saveView({ entity: 'crm_lead', name: 'للجميع', ownerId: org.userClerk, shared: true }, org.userClerk, clerkCtx),
    (e) => e instanceof AuthorizationError);

  roles.createRole({ id: 'r_share', tenantId: org.tenantA, name: 'sharer' });
  roles.setGrants('r_share', [{ permission: 'platform:configuration:share_view', scope: 'company' }]);
  roles.assign({ userId: org.userManager, roleId: 'r_share', companyId: org.companyA1 });
  const mgrCtx = ctxFor(org.userManager);
  const shared = config.saveView({ entity: 'crm_lead', name: 'عروض الفريق', ownerId: org.userManager, shared: true, companyId: org.companyA1 }, org.userManager, mgrCtx);
  assert.strictEqual(shared.shared, true);
  assert.strictEqual(shared.sharedApprovedBy, org.userManager);

  // scope leakage: a user in another company does not see the shared view
  const outsiderViews = config.listViews('crm_lead', ctxFor(org.userOutsider));
  assert.ok(!outsiderViews.some((v) => v.id === shared.id), 'a company-scoped shared view does not leak across companies');
  const clerkViews = config.listViews('crm_lead', clerkCtx);
  assert.ok(clerkViews.some((v) => v.id === shared.id));
  assert.ok(clerkViews.some((v) => v.id === personal.id));
  await cleanup(dialect, dbPath);
}

async function testArabicAndEnglishLabels() {
  const { dialect, dbPath } = await setup();
  const { config } = bootstrap(dialect);
  const f = config.defineCustomField({ entity: 'crm_lead', field: 'branch_note', dataType: 'text', labelAr: 'ملاحظة الفرع', labelEn: 'Branch note' });
  assert.strictEqual(f.labelAr, 'ملاحظة الفرع');
  assert.strictEqual(f.labelEn, 'Branch note');
  const errors = config.validateCustomValues('crm_lead', {}).errors;
  assert.strictEqual(errors.length, 0);
  config.defineCustomField({ entity: 'crm_lead', field: 'req_field', dataType: 'string', labelAr: 'حقل مطلوب', required: true });
  const missing = config.validateCustomValues('crm_lead', {});
  assert.strictEqual(missing.ok, false);
  assert.ok(missing.errors[0].messageAr.includes('حقل مطلوب'), 'validation messages are Arabic-first');
  await cleanup(dialect, dbPath);
}

// --- 02.16 configuration packages -------------------------------------------

async function testPackageManifestChecksumAndForbiddenItems() {
  const { dialect, dbPath } = await setup();
  const { config } = bootstrap(dialect);
  const pkg = config.buildPackage({
    name: 'retail-pack', version: '1.2.0', targetMinVersion: '1.0.0',
    items: [
      { kind: 'custom_field', key: 'crm_lead.referral_code', payload: { dataType: 'string', labelAr: 'رمز الإحالة' } },
      { kind: 'view_schema', key: 'crm_lead.list.default', payload: { columns: ['name', 'status'] } },
    ],
  });
  assert.ok(pkg.checksum && pkg.checksum.length === 64);
  assert.strictEqual(pkg.manifest.items.length, 2);

  // ledgers, audit, secrets, and sessions can never be packaged
  for (const kind of ['account_moves', 'stock_moves', 'platform_audit_log', 'api_key', 'secret', 'employee']) {
    assert.throws(() => config.buildPackage({ name: 'bad', version: '1', items: [{ kind, key: 'x', payload: {} }] }),
      (e) => e.code === 'PACKAGE_FORBIDDEN_ITEM', `${kind} must be refused`);
  }
  // a credential hidden inside a payload is caught
  assert.throws(() => config.buildPackage({ name: 'bad', version: '1', items: [{ kind: 'view_schema', key: 'x', payload: { client_secret: 'abc' } }] }),
    (e) => e.code === 'PACKAGE_SECRET_LEAK');
  await cleanup(dialect, dbPath);
}

async function testPackageDryRunConflictAndVersionGate() {
  const { dialect, dbPath } = await setup();
  const { config } = bootstrap(dialect);
  config.defineCustomField({ entity: 'crm_lead', field: 'referral_code', dataType: 'string', labelAr: 'قديم' });
  const pkg = config.buildPackage({
    name: 'retail-pack', version: '1.2.0', targetMinVersion: '2.0.0',
    items: [
      { kind: 'custom_field', key: 'crm_lead.referral_code', payload: { dataType: 'string', labelAr: 'رمز الإحالة' } },
      { kind: 'setting_value', key: 'not.installed.setting', payload: { value: 1 } },
    ],
  });
  const plan = config.dryRun(pkg.id, { currentVersion: '1.5.0' });
  assert.strictEqual(plan.canApply, false);
  assert.strictEqual(plan.versionIncompatible, true, 'target-version incompatibility is reported');
  assert.ok(plan.conflicts.some((c) => c.reason.includes('already exists')));
  assert.ok(plan.missingDependencies.some((d) => d.key === 'not.installed.setting'));
  assert.throws(() => config.apply(pkg.id, { currentVersion: '1.5.0' }), (e) => e.code === 'PACKAGE_NOT_APPLICABLE');
  // nothing was applied
  assert.strictEqual(config.customFields('crm_lead')[0].labelAr, 'قديم');
  await cleanup(dialect, dbPath);
}

async function testPackageApplyAndRollback() {
  const { dialect, dbPath } = await setup();
  const { config } = bootstrap(dialect);
  config.defineCustomField({ entity: 'crm_lead', field: 'referral_code', dataType: 'string', labelAr: 'قديم' });
  const pkg = config.buildPackage({
    name: 'retail-pack', version: '1.0.0',
    items: [{ kind: 'custom_field', key: 'crm_lead.referral_code', payload: { dataType: 'string', labelAr: 'رمز الإحالة' } }],
  });
  config.apply(pkg.id, { force: true });
  assert.strictEqual(config.customFields('crm_lead').find((f) => f.field === 'referral_code').labelAr, 'رمز الإحالة');
  config.rollback(pkg.id);
  assert.strictEqual(config.customFields('crm_lead').find((f) => f.field === 'referral_code').labelAr, 'قديم', 'rollback restores the previous payload');
  assert.strictEqual(dialect.prepare('SELECT status FROM configuration_packages WHERE id = ?').get(pkg.id).status, 'rolled_back');
  await cleanup(dialect, dbPath);
}

// --- runner -----------------------------------------------------------------

await run('Phase 02 / settings, secrets, policies, delegation, SoD, configuration', [
  ['02.13 inheritance precedence', testInheritancePrecedence],
  ['02.13 prohibited override and invalid value', testProhibitedOverrideAndInvalidValue],
  ['02.13 disabled module blocks a setting write', testDisabledModuleBlocksSettingWrite],
  ['02.13 settings permission enforced', testSettingsPermissionEnforced],
  ['02.13 versioning, rollback, version conflict', testVersioningRollbackAndConflict],
  ['02.13 preview mutates nothing and changes are audited', testSettingsPreviewAndAudit],
  ['02.14 secret absent from database and API surfaces', testSecretNotInDatabaseOrApi],
  ['02.14 reveal is refused by default, restricted reveal is audited', testSecretRevealIsRefusedByDefault],
  ['02.14 key rotation and corrupted ciphertext', testSecretRotationAndCorruption],
  ['02.14 missing key fails closed', testSecretKeyFailsClosed],
  ['02.14 log and support-bundle redaction', testLogAndSupportBundleRedaction],
  ['02.12 authority limit threshold boundary', testAuthorityLimitThresholdBoundary],
  ['02.12 authority limit escalates to approval', testAuthorityLimitEscalatesToApproval],
  ['02.12 delegation lifecycle and no escalation', testDelegationLifecycle],
  ['02.12 expired and overlapping delegations', testExpiredAndOverlappingDelegations],
  ['02.12 delegation carries its own amount cap', testDelegationCarriesItsOwnAmountCap],
  ['02.12 segregation of duties at assignment and transaction', testSegregationOfDuties],
  ['02.12 emergency override is recorded', testEmergencyOverrideIsRecorded],
  ['02.22 policy precedence, conflict report, explainability', testPolicyPrecedenceConflictAndExplain],
  ['02.22 policy versioning and coverage report', testPolicyVersioningAndCoverage],
  ['02.15 protected entities and fields refused', testProtectedEntitiesAndFieldsRefused],
  ['02.15 custom field issues no DDL', testCustomFieldIssuesNoDdl],
  ['02.15 custom field validation and archival keeps data', testCustomFieldValidationAndArchival],
  ['02.15 unsafe filter rejected', testUnsafeFilterRejected],
  ['02.15 shared view needs permission and respects scope', testSharedViewRequiresPermissionAndScope],
  ['02.15 Arabic and English labels', testArabicAndEnglishLabels],
  ['02.16 package manifest, checksum, forbidden items', testPackageManifestChecksumAndForbiddenItems],
  ['02.16 dry run: conflicts, dependencies, version gate', testPackageDryRunConflictAndVersionGate],
  ['02.16 atomic apply and rollback', testPackageApplyAndRollback],
]);
