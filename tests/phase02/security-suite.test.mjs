// Phase 02 Wave F — the mandatory adversarial suite (packet 02.33), the security
// evidence views (02.30), and the Octagon shell bootstrap (02.31).
//
// Section 58 lists fourteen mandatory adversarial cases. Each has a test here
// whose name states the attack. Failure-injection and concurrency cases follow.

import assert from 'node:assert';
import crypto from 'node:crypto';
import { setup, cleanup, run, seedOrg, STRONG_PASSWORD } from './harness.mjs';
import { createPermissionRegistry } from '../../platform/authorization/registry/index.mjs';
import { createPermissionEvaluator, AuthorizationError, REASON } from '../../platform/authorization/evaluator/index.mjs';
import { createRoleAdministration } from '../../platform/authorization/roles/index.mjs';
import { createRouteCoverageRegistry } from '../../platform/authorization/route-coverage/index.mjs';
import { createMembershipDirectory } from '../../platform/organizations/memberships/index.mjs';
import { buildDecisionContext, stripUntrustedContext, systemContext, UNTRUSTED_CONTEXT_FIELDS } from '../../platform/identity/context/index.mjs';
import { createSessionAuthority } from '../../platform/identity/sessions/index.mjs';
import { createServiceIdentityAuthority } from '../../platform/identity/service-identities/index.mjs';
import { createMfaAuthority, generateHOTP, _internal as mfaInternal } from '../../platform/identity/mfa/index.mjs';
import { createPasswordReset, consumePasswordReset } from '../../platform/identity/passwords/index.mjs';
import { createPolicyEngine } from '../../platform/policies/index.mjs';
import { createSecretVault, redactForLogs } from '../../platform/settings/secrets/index.mjs';
import { createApprovalEngine } from '../../platform/approvals/index.mjs';
import { createWorkflowRegistry, createWorkflowRuntime } from '../../platform/workflow/index.mjs';
import { createFileService, createMemoryStorage } from '../../platform/files/index.mjs';
import { createDataExchangeService } from '../../platform/data-exchange/index.mjs';
import { createJobQueue, createWebhookService, WebhookService } from '../../platform/jobs/index.mjs';
import { createNotificationService, createMemoryChannel } from '../../platform/notifications/index.mjs';
import { createSecurityEvidenceService, EVIDENCE_VIEWS } from '../../platform/security-evidence/index.mjs';
import { createGovernanceBootstrap, DEFAULT_PAGE_CATALOGUE } from '../../platform/client/governance-bootstrap.mjs';
import { createActionRegistry, createActionExecutor } from '../../platform/kernel/actions/index.mjs';
import { createSettingsAuthority } from '../../platform/settings/index.mjs';
import { openMigrationDatabase, runMigrations, freshInstall } from '../../database/migration-runner/index.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TEST_KEY = crypto.randomBytes(32).toString('base64');

const PERMS = [
  { id: 'crm:crm_lead:read', module_id: 'platform_kernel', kind: 'resource', label_ar: 'قراءة' },
  { id: 'crm:crm_lead:update', module_id: 'platform_kernel', kind: 'action', label_ar: 'تعديل' },
  { id: 'crm:crm_lead:delete', module_id: 'platform_kernel', kind: 'action', label_ar: 'حذف' },
  { id: 'crm:crm_lead:export', module_id: 'platform_kernel', kind: 'export', label_ar: 'تصدير' },
  { id: 'crm:crm_lead:import', module_id: 'platform_kernel', kind: 'import', label_ar: 'استيراد' },
  { id: 'finance:invoice:approve', module_id: 'platform_kernel', kind: 'action', label_ar: 'اعتماد' },
  { id: 'platform:file:share', module_id: 'platform_kernel', kind: 'share', label_ar: 'مشاركة' },
  { id: 'platform:security:read', module_id: 'platform_kernel', kind: 'settings', label_ar: 'قراءة التدقيق' },
  { id: 'platform:security:export', module_id: 'platform_kernel', kind: 'export', label_ar: 'تصدير التدقيق' },
  { id: 'platform:security:revoke_session', module_id: 'platform_kernel', kind: 'action', label_ar: 'إنهاء جلسة' },
  { id: 'ai:tool:query_records', module_id: 'platform_kernel', kind: 'ai_tool', label_ar: 'أداة ذكاء' },
  ...DEFAULT_PAGE_CATALOGUE.map((p) => ({ id: p.permission, module_id: 'platform_kernel', kind: 'page', label_ar: p.labelAr })),
];

function bootstrap(dialect, { now } = {}) {
  const org = seedOrg(dialect);
  const registry = createPermissionRegistry(dialect);
  registry.registerMany(PERMS);
  const policyEngine = createPolicyEngine(dialect, { now });
  const evaluator = createPermissionEvaluator(dialect, { permissionRegistry: registry, policyEngine });
  policyEngine.evaluator = evaluator;
  const roles = createRoleAdministration(dialect, { permissionRegistry: registry, evaluator });
  const memberships = createMembershipDirectory(dialect);
  const sessions = createSessionAuthority(dialect, { now });
  const svc = createServiceIdentityAuthority(dialect, { now });
  const vault = createSecretVault(dialect, { key: TEST_KEY, evaluator });
  const approvals = createApprovalEngine(dialect, { evaluator, policyEngine, now });
  const files = createFileService(dialect, { storage: createMemoryStorage(), evaluator, now });
  const notifications = createNotificationService(dialect, { evaluator, now });
  const jobs = createJobQueue(dialect, { now });
  const settings = createSettingsAuthority(dialect, { evaluator });

  const actionRegistry = createActionRegistry(dialect);
  const actionExecutor = createActionExecutor(dialect);
  actionRegistry.register({ id: 'crm:import_lead', module_id: 'platform_kernel', entity_id: 'crm_lead', kind: 'domain', transaction_owner: 'action', idempotency_policy: 'supported' });
  actionExecutor.registerHandler('crm:import_lead', ({ input }) => ({ record_id: `lead_${crypto.randomUUID().slice(0, 6)}`, data: input.data }));
  const exchange = createDataExchangeService(dialect, { evaluator, actionExecutor, now });
  const routes = createRouteCoverageRegistry(dialect, { evaluator, permissionRegistry: registry });
  const evidence = createSecurityEvidenceService(dialect, { evaluator, sessions, now });

  const ctxFor = (userId, request = {}) =>
    buildDecisionContext(dialect, { actorId: userId, actorType: 'user' }, stripUntrustedContext(request), { membershipDirectory: memberships });

  roles.createRole({ id: 'r_ops', tenantId: org.tenantA, name: 'ops' });
  roles.setGrants('r_ops', [
    { permission: 'crm:*', scope: 'all' }, { permission: 'platform:file:share', scope: 'all' },
    { permission: 'platform:security:*', scope: 'all' }, { permission: 'platform:page:*', scope: 'all' },
  ]);
  roles.assign({ userId: org.userManager, roleId: 'r_ops', companyId: org.companyA1 });
  roles.createRole({ id: 'r_read', tenantId: org.tenantA, name: 'reader' });
  roles.setGrants('r_read', [{ permission: 'crm:crm_lead:read', scope: 'company' }, { permission: 'platform:page:home', scope: 'company' }]);
  roles.assign({ userId: org.userClerk, roleId: 'r_read', companyId: org.companyA1 });

  return { org, registry, evaluator, roles, memberships, sessions, svc, vault, approvals, files, notifications, jobs, settings, exchange, routes, evidence, policyEngine, actionRegistry, actionExecutor, ctxFor };
}

function seedRecord(dialect, { entity = 'crm_lead', id, companyId, createdBy = 'u_manager', data = {} }) {
  const now = new Date().toISOString();
  dialect.prepare(`INSERT INTO x_records (entity, id, company_id, data, created_at, updated_at, created_by, removed, version) VALUES (?,?,?,?,?,?,?,0,1)`)
    .run(entity, id, companyId, JSON.stringify(data), now, now, createdBy);
  return id;
}

// ===========================================================================
// § 58 mandatory adversarial cases
// ===========================================================================

async function attack01_directApiCallToHiddenAction() {
  const { dialect, dbPath } = await setup();
  const { org, evaluator, routes, ctxFor } = bootstrap(dialect);
  seedRecord(dialect, { id: 'lead_1', companyId: org.companyA1 });
  routes.register({ method: 'DELETE', route: '/api/v1/crm_lead/:id', moduleId: 'platform_kernel', permission: 'crm:crm_lead:delete' });
  const bootstrapper = createGovernanceBootstrap({ evaluator, dialect });
  const payload = bootstrapper.build(ctxFor(org.userClerk), { actions: [{ id: 'delete', permission: 'crm:crm_lead:delete', entity: 'crm_lead' }] });
  assert.strictEqual(payload.actions[0].enabled, false, 'the UI is told the button is disabled');
  // The attacker ignores the UI and calls the endpoint directly.
  assert.throws(() => routes.authorizeRoute({ method: 'DELETE', route: '/api/v1/crm_lead/:id', ctx: ctxFor(org.userClerk), entity: 'crm_lead', recordId: 'lead_1' }),
    (e) => e instanceof AuthorizationError && e.decision.reasonCode === REASON.NO_GRANT);
  await cleanup(dialect, dbPath);
}

async function attack02_bodySuppliedTenantCompanyRole() {
  const { dialect, dbPath } = await setup();
  const { org, evaluator, memberships, ctxFor } = bootstrap(dialect);
  const hostileBody = {
    userId: org.userManager, actorId: org.userManager, tenantId: org.tenantB,
    roles: ['ops'], grants: ['*'], isOwner: true, bypass: true,
    permissions: ['crm:crm_lead:delete'], approved: true, delegations: [{ permissions: ['*'] }],
    companyId: org.companyA2,
  };
  const stripped = stripUntrustedContext(hostileBody);
  for (const field of UNTRUSTED_CONTEXT_FIELDS) {
    assert.ok(!(field in stripped), `${field} must never survive stripping`);
  }
  // Even the surviving companyId is only a REQUEST, validated against membership.
  assert.throws(
    () => buildDecisionContext(dialect, { actorId: org.userClerk, actorType: 'user' }, stripped, { membershipDirectory: memberships }),
    (e) => e.code === 'COMPANY_NOT_A_MEMBERSHIP'
  );
  const ctx = ctxFor(org.userClerk);
  assert.deepStrictEqual(ctx.roles, ['r_read']);
  assert.strictEqual(ctx.isOwner, false);
  assert.strictEqual(evaluator.evaluate({ permission: 'crm:crm_lead:delete', ctx }).allowed, false);
  await cleanup(dialect, dbPath);
}

async function attack03_loopbackAndInternalBypass() {
  const { dialect, dbPath } = await setup();
  const { org, evaluator, ctxFor } = bootstrap(dialect);
  // No module on the canonical path contains an IP/env/header trust branch.
  const files = ['evaluator', 'registry', 'route-coverage'].map((m) =>
    fs.readFileSync(new URL(`../../platform/authorization/${m}/index.mjs`, import.meta.url), 'utf8'));
  files.push(fs.readFileSync(new URL('../../platform/identity/sessions/index.mjs', import.meta.url), 'utf8'));
  files.push(fs.readFileSync(new URL('../../platform/identity/context/index.mjs', import.meta.url), 'utf8'));
  for (const source of files) {
    const code = source.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    for (const token of ['127.0.0.1', 'remoteAddress', 'OCTAGON_TRUST_LOCALHOST', 'allowLocalDev', 'x-octagon-user', 'NODE_ENV']) {
      assert.ok(!code.includes(token), `the canonical path must contain no ${token} branch`);
    }
  }
  // A hand-forged "internal" actor still has no grants.
  const forged = { actorId: 'internal', actorType: 'user', tenantId: org.tenantA, companyMemberships: [org.companyA1], activeCompanyId: org.companyA1, roles: ['ops'], delegations: [], apiKeyScopes: [], enabledModules: ['platform_kernel'], now: new Date().toISOString() };
  assert.strictEqual(evaluator.evaluate({ permission: 'crm:crm_lead:delete', ctx: forged }).allowed, false,
    'a ctx.roles array is not a grant; grants are read from the database');
  await cleanup(dialect, dbPath);
}

async function attack04_crossTenantListDetailExportFile() {
  const { dialect, dbPath } = await setup();
  const { org, evaluator, files, exchange, ctxFor } = bootstrap(dialect);
  seedRecord(dialect, { id: 'lead_alpha', companyId: org.companyA1, data: { name: 'Alpha' } });
  seedRecord(dialect, { id: 'lead_beta', companyId: org.companyB1, data: { name: 'Beta' } });
  const mgrCtx = ctxFor(org.userManager);
  const file = files.upload({ filename: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4'), entity: 'crm_lead', recordId: 'lead_alpha', ctx: mgrCtx, writePermission: 'crm:crm_lead:update' });

  // list
  const list = evaluator.listScoped({ entity: 'crm_lead', ctx: mgrCtx, permission: 'crm:crm_lead:read' });
  assert.deepStrictEqual(list.rows.map((r) => r.id), ['lead_alpha']);
  // count
  assert.strictEqual(evaluator.countScoped({ entity: 'crm_lead', ctx: mgrCtx, permission: 'crm:crm_lead:read' }), 1);
  // detail
  assert.strictEqual(evaluator.evaluate({ permission: 'crm:crm_lead:read', ctx: mgrCtx, entity: 'crm_lead', recordId: 'lead_beta' }).allowed, false);
  // export
  assert.ok(!exchange.export({ entity: 'crm_lead', ctx: mgrCtx, exportPermission: 'crm:crm_lead:export' }).content.includes('Beta'));
  // file
  assert.throws(() => files.download(file.id, ctxFor(org.userBeta), { readPermission: 'crm:crm_lead:read' }), (e) => e.code === 'FILE_NOT_FOUND');
  await cleanup(dialect, dbPath);
}

async function attack05_maskedFieldViaReportHistoryNotification() {
  const { dialect, dbPath } = await setup();
  const { org, evaluator, roles, notifications, exchange, ctxFor } = bootstrap(dialect);
  roles.setFieldRules('r_read', [{ entity: 'crm_lead', field: 'national_id', access: 'masked' }]);
  const SECRET_PII = '199012345678';
  seedRecord(dialect, { id: 'lead_1', companyId: org.companyA1, data: { name: 'Acme', national_id: SECRET_PII } });
  const clerkCtx = ctxFor(org.userClerk);

  // export
  assert.ok(!exchange.export({ entity: 'crm_lead', ctx: clerkCtx, exportPermission: 'crm:crm_lead:read' }).content.includes(SECRET_PII));
  // print template
  exchange.registerPrintTemplate({ moduleId: 'platform_kernel', entity: 'crm_lead', name: 'card', body: '{{national_id}}', requiredPermission: 'crm:crm_lead:read' });
  assert.ok(!exchange.render({ entity: 'crm_lead', name: 'card', recordId: 'lead_1', data: { national_id: SECRET_PII }, ctx: clerkCtx }).html.includes(SECRET_PII));
  // notification payload
  notifications.notify({ recipientId: org.userClerk, eventKey: 'lead.updated', body: 'x', payload: { entity: 'crm_lead', data: { national_id: SECRET_PII } } });
  assert.ok(!dialect.prepare('SELECT payload FROM notifications').get().payload.includes(SECRET_PII));
  // list surface
  const list = evaluator.listScoped({ entity: 'crm_lead', ctx: clerkCtx, permission: 'crm:crm_lead:read' });
  assert.ok(!JSON.stringify(list.rows).includes(SECRET_PII));
  await cleanup(dialect, dbPath);
}

async function attack06_duplicateApprovalDecision() {
  const { dialect, dbPath } = await setup();
  const { org, approvals, roles } = bootstrap(dialect);
  roles.createRole({ id: 'r_appr', tenantId: org.tenantA, name: 'approver' });
  roles.setGrants('r_appr', [{ permission: 'finance:invoice:approve', scope: 'company' }]);
  roles.assign({ userId: org.userManager, roleId: 'r_appr', companyId: org.companyA1 });
  roles.assign({ userId: org.userOwner, roleId: 'r_appr', companyId: org.companyA1 });
  approvals.definePolicy({ id: 'ap1', moduleId: 'platform_kernel', entity: 'invoice', action: 'post', mode: 'quorum', quorum: 2, chain: [['approver']] });
  const req = approvals.request({ entity: 'invoice', recordId: 'inv_1', action: 'post', requesterId: org.userClerk, companyId: org.companyA1 });

  approvals.decide({ requestId: req.id, deciderId: org.userManager, decision: 'approve' });
  // the same decider replaying their decision cannot count twice toward quorum
  assert.throws(() => approvals.decide({ requestId: req.id, deciderId: org.userManager, decision: 'approve' }), (e) => e.code === 'APPROVAL_DUPLICATE_DECISION');
  assert.strictEqual(approvals.get(req.id).status, 'pending', 'the quorum was not reached by a replay');
  approvals.decide({ requestId: req.id, deciderId: org.userOwner, decision: 'approve' });
  assert.strictEqual(approvals.get(req.id).status, 'approved');
  assert.strictEqual(Number(dialect.prepare('SELECT COUNT(*) AS n FROM approval_decisions WHERE request_id = ?').get(req.id).n), 2);
  await cleanup(dialect, dbPath);
}

async function attack07_duplicateWorkflowDispatchAndWorkerCrash() {
  const { dialect, dbPath } = await setup();
  const { org, evaluator, actionRegistry, actionExecutor, ctxFor } = bootstrap(dialect);
  const calls = [];
  actionRegistry.register({ id: 'crm:touch', module_id: 'platform_kernel', entity_id: 'crm_lead', kind: 'domain', transaction_owner: 'action', idempotency_policy: 'supported' });
  actionExecutor.registerHandler('crm:touch', ({ input }) => { calls.push(input.record_id); return { ok: true }; });
  const wfRegistry = createWorkflowRegistry(dialect, { actionRegistry, permissionRegistry: null });
  const runtime = createWorkflowRuntime(dialect, { registry: wfRegistry, actionExecutor, evaluator });
  wfRegistry.define({ id: 'wf', moduleId: 'platform_kernel', name: 'wf', entity: 'crm_lead' });
  const spec = {
    initialState: 'a', states: ['a', 'b'], transitions: [{ from: 'a', to: 'b' }],
    nodes: [{ id: 'n1', type: 'action', actionId: 'crm:touch', requiredPermission: 'crm:crm_lead:update' },
      { id: 'n2', type: 'action', actionId: 'crm:touch', requiredPermission: 'crm:crm_lead:update' }],
  };
  const { version } = wfRegistry.addVersion('wf', spec);
  wfRegistry.activate('wf', version);
  seedRecord(dialect, { id: 'lead_1', companyId: org.companyA1 });
  const ctx = ctxFor(org.userManager);
  const inst = runtime.start({ definitionId: 'wf', entity: 'crm_lead', recordId: 'lead_1', ctx });

  const leaseA = runtime.claim();
  assert.strictEqual(runtime.claim(), null, 'a second worker cannot claim the same instance');
  runtime.step(inst.id, leaseA.leaseId, ctx);
  // simulate a crash mid-flight
  dialect.prepare('UPDATE workflow_instances SET leased_until = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', inst.id);
  runtime.recoverStaleLeases();
  runtime.run(inst.id, ctx);
  assert.strictEqual(runtime.get(inst.id).status, 'completed');
  assert.strictEqual(calls.length, 2, 'each node executed exactly once despite the crash');
  await cleanup(dialect, dbPath);
}

async function attack08_webhookReplay() {
  const { dialect, dbPath } = await setup();
  let clock = new Date('2026-07-21T09:00:00.000Z');
  bootstrap(dialect, { now: () => clock });
  const webhooks = createWebhookService(dialect, { now: () => clock });
  const secret = 's3cr3t';
  const body = JSON.stringify({ amount: 100 });
  const timestamp = clock.toISOString();
  const sig = WebhookService.sign(secret, { timestamp, nonce: 'n1', body });
  assert.strictEqual(webhooks.verifyInbound({ source: 'p', secret, signature: sig, timestamp, nonce: 'n1', body }).ok, true);
  assert.strictEqual(webhooks.verifyInbound({ source: 'p', secret, signature: sig, timestamp, nonce: 'n1', body }).reasonCode, 'WEBHOOK_REPLAYED');
  await cleanup(dialect, dbPath);
}

async function attack09_resetAndMfaTokenReplay() {
  const { dialect, dbPath } = await setup();
  let clock = new Date('2026-07-21T09:00:00.000Z');
  const { org } = bootstrap(dialect, { now: () => clock });
  // reset-token replay
  const reset = createPasswordReset(dialect, org.userClerk, { now: clock });
  consumePasswordReset(dialect, reset.token, 'Recovered#9Pass', { now: clock });
  assert.throws(() => consumePasswordReset(dialect, reset.token, 'Another#9Pass', { now: clock }), (e) => e.code === 'RESET_TOKEN_CONSUMED');

  // TOTP replay inside the same window
  const mfa = createMfaAuthority(dialect, { now: () => clock });
  const enrollment = mfa.beginTotpEnrollment(org.userClerk);
  const code = generateHOTP(mfaInternal.base32Decode(enrollment.secret), Math.floor(clock.getTime() / 30000));
  mfa.confirmTotpEnrollment(org.userClerk, code);
  clock = new Date('2026-07-21T09:00:40.000Z');
  const live = generateHOTP(mfaInternal.base32Decode(enrollment.secret), Math.floor(clock.getTime() / 30000));
  assert.strictEqual(mfa.verifyTotpChallenge(org.userClerk, live).ok, true);
  assert.strictEqual(mfa.verifyTotpChallenge(org.userClerk, live).reasonCode, 'MFA_CODE_REPLAYED');
  await cleanup(dialect, dbPath);
}

async function attack10_apiKeyRotationAndRevocation() {
  const { dialect, dbPath } = await setup();
  let clock = new Date('2026-07-21T09:00:00.000Z');
  const { org } = bootstrap(dialect, { now: () => clock });
  const svc = createServiceIdentityAuthority(dialect, { now: () => clock });
  const account = svc.createServiceAccount({ tenantId: org.tenantA, companyId: org.companyA1, name: 'partner' });
  const key = svc.issueApiKey({ serviceAccountId: account.id, scopes: ['crm:crm_lead:read'] });
  assert.ok(svc.authenticateApiKey(key.key));
  const rotated = svc.rotateApiKey(key.id, { overlapSeconds: 60 });
  assert.ok(svc.authenticateApiKey(rotated.key));
  clock = new Date('2026-07-21T09:05:00.000Z');
  assert.throws(() => svc.authenticateApiKey(key.key), (e) => e.code === 'API_KEY_EXPIRED', 'the old key dies after the overlap');
  svc.revokeApiKey(rotated.id);
  assert.throws(() => svc.authenticateApiKey(rotated.key), (e) => e.code === 'API_KEY_REVOKED');
  await cleanup(dialect, dbPath);
}

async function attack11_secretLeakInLogsAndSupportBundle() {
  const { dialect, dbPath } = await setup();
  const { org, vault, evidence, ctxFor } = bootstrap(dialect);
  const PLAINTEXT = 'wa-token-DO-NOT-LEAK-4471';
  vault.declare({ ref: 'secret://integrations.whatsapp.token', moduleId: 'platform_kernel' });
  vault.set('secret://integrations.whatsapp.token', PLAINTEXT);

  const bundle = evidence.supportBundle(ctxFor(org.userManager));
  assert.ok(!JSON.stringify(bundle).includes(PLAINTEXT), 'a support bundle carries references, never values');
  assert.ok(JSON.stringify(bundle).includes('secret://integrations.whatsapp.token'));
  // every table
  for (const { name } of dialect.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
    const rows = dialect.prepare(`SELECT * FROM "${name}"`).all();
    assert.ok(!JSON.stringify(rows).includes(PLAINTEXT), `plaintext leaked into ${name}`);
  }
  // log redaction
  assert.ok(!JSON.stringify(redactForLogs({ error: `call failed with token ${PLAINTEXT}`, client_secret: PLAINTEXT })).includes(PLAINTEXT));
  await cleanup(dialect, dbPath);
}

async function attack12_publicLinkGuessing() {
  const { dialect, dbPath } = await setup();
  const { org, files, ctxFor } = bootstrap(dialect);
  seedRecord(dialect, { id: 'lead_1', companyId: org.companyA1 });
  const ctx = ctxFor(org.userManager);
  const file = files.upload({ filename: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 x'), entity: 'crm_lead', recordId: 'lead_1', ctx, writePermission: 'crm:crm_lead:update' });
  const share = files.share(file.id, { expiresInMinutes: 30, ctx, readPermission: 'crm:crm_lead:read' });
  // a guessed token, a truncated token, and an empty token are all identical failures
  for (const guess of ['', 'x', share.token.slice(0, -1), `${share.token}x`, crypto.randomBytes(32).toString('base64url')]) {
    assert.throws(() => files.redeemShare(guess), (e) => e.code === 'SHARE_INVALID');
  }
  assert.ok(files.redeemShare(share.token).buffer.length > 0);
  await cleanup(dialect, dbPath);
}

async function attack13_importPermissionBypass() {
  const { dialect, dbPath } = await setup();
  const { org, exchange, roles, ctxFor } = bootstrap(dialect);
  roles.setFieldRules('r_ops', [{ entity: 'crm_lead', field: 'internal_score', access: 'none' }]);
  // an actor without import permission
  assert.throws(() => exchange.import({ entity: 'crm_lead', actionId: 'crm:import_lead', rows: [{ name: 'X' }], ctx: ctxFor(org.userClerk), mode: 'execute', importPermission: 'crm:crm_lead:import' }),
    (e) => e instanceof AuthorizationError);
  // a permitted actor still cannot write a protected field through an import
  const result = exchange.import({ entity: 'crm_lead', actionId: 'crm:import_lead', rows: [{ name: 'X', internal_score: 99 }], ctx: ctxFor(org.userManager), mode: 'execute', importPermission: 'crm:crm_lead:import' });
  assert.strictEqual(result.failedRows, 1);
  await cleanup(dialect, dbPath);
}

async function attack14_aiToolAndServiceIdentityOverreach() {
  const { dialect, dbPath } = await setup();
  const { org, evaluator, svc, roles } = bootstrap(dialect);
  seedRecord(dialect, { id: 'lead_1', companyId: org.companyA1 });
  const aiAccount = svc.createServiceAccount({ tenantId: org.tenantA, companyId: org.companyA1, name: 'ai-assistant' });
  const key = svc.issueApiKey({ serviceAccountId: aiAccount.id, scopes: ['ai:tool:query_records', 'crm:crm_lead:read'] });
  const actor = svc.authenticateApiKey(key.key);
  const aiCtx = buildDecisionContext(dialect, actor, {}, {});

  // Even inside its key scope, the AI identity has no role grants -> denied.
  assert.strictEqual(evaluator.evaluate({ permission: 'crm:crm_lead:read', ctx: aiCtx }).reasonCode, REASON.NO_GRANT);
  // Outside the key scope it is refused earlier.
  assert.strictEqual(evaluator.evaluate({ permission: 'crm:crm_lead:delete', ctx: aiCtx }).reasonCode, REASON.API_KEY_SCOPE_DENIED);

  // Grant a narrow role: it can now read, but retrieval is still row-scoped.
  roles.createRole({ id: 'r_ai', tenantId: org.tenantA, name: 'ai_reader' });
  roles.setGrants('r_ai', [{ permission: 'crm:crm_lead:read', scope: 'company' }]);
  // Migration 011 makes a service identity a first-class grantee, so this goes
  // through the canonical writer rather than raw SQL.
  roles.assign({ userId: aiAccount.id, roleId: 'r_ai', companyId: org.companyA1, actorType: 'service' });
  const aiCtx2 = buildDecisionContext(dialect, svc.authenticateApiKey(key.key), {}, {});
  assert.strictEqual(evaluator.evaluate({ permission: 'crm:crm_lead:read', ctx: aiCtx2 }).allowed, true);
  seedRecord(dialect, { id: 'lead_beta', companyId: org.companyB1 });
  assert.strictEqual(evaluator.evaluate({ permission: 'crm:crm_lead:read', ctx: aiCtx2, entity: 'crm_lead', recordId: 'lead_beta' }).allowed, false,
    'AI retrieval obeys the same row scope as a human read');
  await cleanup(dialect, dbPath);
}

// ===========================================================================
// Concurrency and failure injection (§ 63)
// ===========================================================================

async function concurrency_sessionRevocationRace() {
  const { dialect, dbPath } = await setup();
  const { org, sessions } = bootstrap(dialect);
  const s = sessions.createSession(org.userClerk, { activeCompanyId: org.companyA1 });
  // revocation lands between two resolves
  assert.ok(sessions.resolve(s.token));
  sessions.revokeAllForUser(org.userClerk, 'race');
  assert.throws(() => sessions.resolve(s.token), (e) => e.code === 'SESSION_REVOKED');
  // a rotate on a revoked session cannot resurrect it
  assert.throws(() => sessions.rotate(s.token), (e) => e.code === 'SESSION_REVOKED');
  await cleanup(dialect, dbPath);
}

async function concurrency_settingsVersionConflict() {
  const { dialect, dbPath } = await setup();
  const { org, settings } = bootstrap(dialect);
  settings.define({ key: 'ui.theme', module_id: 'platform_kernel', type: 'string', default_value: 'light', scopes: ['company'], overridable_scopes: { company: true } });
  const v1 = settings.set('ui.theme', 'company', org.companyA1, 'dark');
  // two editors loaded version 1; the second write must be refused
  settings.set('ui.theme', 'company', org.companyA1, 'paper', { expectedVersion: v1.version });
  assert.throws(() => settings.set('ui.theme', 'company', org.companyA1, 'neumorphism', { expectedVersion: v1.version }),
    (e) => e.code === 'SETTING_VERSION_CONFLICT');
  await cleanup(dialect, dbPath);
}

async function concurrency_jobLeaseAndDoubleExecution() {
  const { dialect, dbPath } = await setup();
  const { jobs } = bootstrap(dialect);
  let runs = 0;
  jobs.registerHandler('once', () => { runs += 1; return { ok: true }; });
  jobs.enqueue({ kind: 'once', idempotencyKey: 'k1' });
  jobs.enqueue({ kind: 'once', idempotencyKey: 'k1' });
  const a = jobs.claim();
  assert.strictEqual(jobs.claim(), null);
  jobs.execute(a.jobId, a.leaseId);
  jobs.drain();
  assert.strictEqual(runs, 1, 'an idempotent job runs exactly once');
  await cleanup(dialect, dbPath);
}

async function failure_migrationRollbackLeavesNothingHalfApplied() {
  const dbPath = path.join(os.tmpdir(), `octagon-p02-mig-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.db`);
  await freshInstall({ dbPath });
  const dialect = openMigrationDatabase(dbPath);
  const applied = dialect.prepare('SELECT migration_id FROM schema_migrations ORDER BY migration_id').all().map((r) => r.migration_id);
  assert.ok(applied.includes('010_collaboration_files_jobs'), 'all Phase 02 migrations applied on a fresh install');
  const tablesBefore = dialect.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get().n;
  dialect.close();

  // full down then up again — every Phase 02 migration is reversible
  await runMigrations({ dbPath, direction: 'down' });
  const afterDown = openMigrationDatabase(dbPath);
  assert.strictEqual(Number(afterDown.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n), 0);
  afterDown.close();

  await runMigrations({ dbPath, direction: 'up' });
  const afterUp = openMigrationDatabase(dbPath);
  assert.strictEqual(Number(afterUp.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get().n), Number(tablesBefore));
  assert.ok(afterUp.prepare('SELECT id FROM identity_users').all().length >= 1, 'the seeded system user survives a down/up cycle');
  afterUp.close();
  for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbPath + suffix); } catch { /* absent */ } }
}

async function failure_encryptionUnavailableFailsClosed() {
  const { dialect, dbPath } = await setup();
  const previous = process.env.OCTAGON_SECRET_KEY;
  delete process.env.OCTAGON_SECRET_KEY;
  try {
    const vault = createSecretVault(dialect, {});
    vault.declare({ ref: 'secret://x.y', moduleId: 'platform_kernel' });
    assert.throws(() => vault.set('secret://x.y', 'value'), (e) => e.code === 'SECRET_KEY_UNAVAILABLE');
    assert.strictEqual(Number(dialect.prepare('SELECT COUNT(*) AS n FROM secret_values').get().n), 0, 'nothing was stored in the clear');
  } finally {
    if (previous !== undefined) process.env.OCTAGON_SECRET_KEY = previous;
  }
  await cleanup(dialect, dbPath);
}

async function failure_providerOutageIsObservableAndRecoverable() {
  const { dialect, dbPath } = await setup();
  let clock = new Date('2026-07-21T09:00:00.000Z');
  const { org, notifications } = bootstrap(dialect, { now: () => clock });
  const email = createMemoryChannel('email', { failTimes: 10 });
  notifications.registerChannel(email);
  notifications.notify({ recipientId: org.userClerk, eventKey: 'x', body: 'y', channels: ['email'], dedupeKey: 'd1' });
  for (let i = 0; i < 4; i++) { clock = new Date(clock.getTime() + 600000); notifications.dispatch(); }
  assert.strictEqual(notifications.deadLetters().length, 1, 'the failure is visible, not silent');
  const health = notifications.providerHealth().find((p) => p.provider === 'email');
  assert.ok(['degraded', 'down'].includes(health.status));
  assert.ok(health.last_error);
  await cleanup(dialect, dbPath);
}

// ===========================================================================
// § 55 evidence views and § 56 UI integration
// ===========================================================================

async function evidence_viewsAreScopedMaskedAndGated() {
  const { dialect, dbPath } = await setup();
  const { org, evidence, sessions, evaluator, ctxFor } = bootstrap(dialect);
  // generate some evidence
  sessions.createSession(org.userManager, { activeCompanyId: org.companyA1 });
  try { sessions.authenticate({ tenantId: org.tenantA, login: 'clerk', password: 'wrong' }); } catch { /* expected */ }
  evaluator.evaluate({ permission: 'crm:crm_lead:delete', ctx: ctxFor(org.userClerk) });

  const mgrCtx = ctxFor(org.userManager);
  for (const view of EVIDENCE_VIEWS) {
    const result = evidence.view(view, mgrCtx);
    assert.strictEqual(result.scoped, true, `${view} must declare itself scoped`);
    assert.ok(Array.isArray(result.rows));
  }
  assert.ok(evidence.view('failed_authentication', mgrCtx).rows.length >= 1);
  assert.ok(evidence.view('permission_denials', mgrCtx).rows.length >= 1);
  assert.ok(evidence.view('active_sessions', mgrCtx).rows.length >= 1);
  // API-key view never carries a hash
  const keys = evidence.view('api_keys', mgrCtx);
  assert.ok(keys.rows.every((r) => !('key_hash' in r)));

  // an actor without the permission sees nothing at all
  assert.throws(() => evidence.view('permission_denials', ctxFor(org.userClerk)), (e) => e instanceof AuthorizationError);
  assert.throws(() => evidence.export('permission_denials', ctxFor(org.userClerk)), (e) => e instanceof AuthorizationError);
  assert.throws(() => evidence.view('nonsense', mgrCtx), (e) => e.code === 'VIEW_UNKNOWN');

  const summary = evidence.summary(mgrCtx);
  assert.strictEqual(Object.keys(summary.counts).length, EVIDENCE_VIEWS.length);
  await cleanup(dialect, dbPath);
}

async function ui_bootstrapIsRoleSpecificAndRtl() {
  const { dialect, dbPath } = await setup();
  const { org, evaluator, settings, notifications, approvals, memberships, ctxFor } = bootstrap(dialect);
  const bootstrapper = createGovernanceBootstrap({ evaluator, dialect, settings, notifications, approvals, membershipDirectory: memberships });

  const clerk = bootstrapper.build(ctxFor(org.userClerk));
  const manager = bootstrapper.build(ctxFor(org.userManager));
  assert.deepStrictEqual(clerk.navigation.pages.map((p) => p.id), ['home'], 'the clerk sees only what they hold');
  assert.ok(manager.navigation.pages.length > clerk.navigation.pages.length);
  assert.ok(clerk.navigation.hiddenPageCount > 0);
  assert.strictEqual(clerk.actor.direction, 'rtl', 'Arabic identity is preserved');
  assert.strictEqual(clerk.actor.locale, 'ar');
  assert.ok(manager.navigation.pages.find((p) => p.id === 'security').labelAr === 'الأمن والتدقيق');

  // the payload never leaks a token the actor does not hold
  const serialized = JSON.stringify(clerk);
  assert.ok(!serialized.includes('crm:crm_lead:delete'));
  assert.ok(!serialized.includes('platform:security'));

  // deep-link protection
  assert.strictEqual(bootstrapper.canOpen(ctxFor(org.userClerk), 'security').allowed, false);
  assert.strictEqual(bootstrapper.canOpen(ctxFor(org.userManager), 'security').allowed, true);
  assert.strictEqual(bootstrapper.canOpen(ctxFor(org.userManager), 'not_a_page').reasonCode, 'PAGE_UNKNOWN');

  // context switch is membership-derived
  const switched = bootstrapper.switchCompany(org.userOwner, org.companyA2, {
    buildContext: (req) => buildDecisionContext(dialect, { actorId: org.userOwner, actorType: 'user' }, req, { membershipDirectory: memberships }),
  });
  assert.strictEqual(switched.scope.activeCompanyId, org.companyA2);
  assert.throws(() => bootstrapper.switchCompany(org.userClerk, org.companyA2, { buildContext: () => {} }), (e) => e.code === 'COMPANY_NOT_A_MEMBERSHIP');
  await cleanup(dialect, dbPath);
}

async function ui_impersonationBannerAndFieldMetadata() {
  const { dialect, dbPath } = await setup();
  const { org, evaluator, roles, memberships } = bootstrap(dialect);
  roles.setFieldRules('r_read', [
    { entity: 'crm_lead', field: 'national_id', access: 'masked' },
    { entity: 'crm_lead', field: 'internal_score', access: 'none' },
    { entity: 'crm_lead', field: 'source', access: 'read' },
  ]);
  const bootstrapper = createGovernanceBootstrap({ evaluator, dialect, membershipDirectory: memberships });
  const impersonated = buildDecisionContext(dialect,
    { actorId: org.userClerk, actorType: 'impersonated', impersonatorId: org.userOwner }, {}, { membershipDirectory: memberships });
  const payload = bootstrapper.build(impersonated, { actions: [{ id: 'edit', permission: 'crm:crm_lead:read', entity: 'crm_lead' }] });
  assert.strictEqual(payload.impersonation.active, true);
  assert.strictEqual(payload.impersonation.by, org.userOwner);
  assert.ok(payload.impersonation.bannerAr.length > 0, 'the shell is told to show a visible banner');

  const fields = payload.fields.crm_lead;
  assert.deepStrictEqual(fields.hidden, ['internal_score']);
  assert.deepStrictEqual(fields.masked, ['national_id']);
  assert.ok(fields.readOnly.includes('source'), 'a form disables rather than silently drops');
  await cleanup(dialect, dbPath);
}

async function integration_unrelatedOctagonPagesUnaffected() {
  const { dialect, dbPath } = await setup();
  bootstrap(dialect);
  // Phase 02 touched no frozen payroll/attendance file and created no table for them.
  const tables = dialect.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const frozen of ['employees', 'timesheet', 'attendance', 'payroll_periods', 'employee_advances']) {
    assert.ok(!tables.includes(frozen), `Phase 02 must not create a ${frozen} table`);
  }
  // Phase 01 kernel tables are all still present and untouched in shape.
  for (const kernelTable of ['platform_modules', 'platform_entities', 'platform_actions', 'platform_views',
    'platform_settings', 'platform_sequences', 'platform_audit_log', 'platform_outbox', 'x_records']) {
    assert.ok(tables.includes(kernelTable), `Phase 01 table ${kernelTable} must survive Phase 02`);
  }
  // platform_users is now a derived view with exactly one writer beneath it.
  const views = dialect.prepare("SELECT name FROM sqlite_master WHERE type='view'").all().map((r) => r.name);
  assert.ok(views.includes('platform_users'));
  assert.throws(() => dialect.prepare("INSERT INTO platform_users (id, company_id, name, status, roles, created_at) VALUES ('x','c','n','active','[]','t')").run(),
    /view/, 'the retired legacy writer is structurally impossible');
  await cleanup(dialect, dbPath);
}

await run('Phase 02 / security, concurrency, failure injection, evidence, UI integration', [
  ['§58.1 direct API call to a hidden action', attack01_directApiCallToHiddenAction],
  ['§58.2 body-supplied tenant/company/role', attack02_bodySuppliedTenantCompanyRole],
  ['§58.3 loopback / internal bypass', attack03_loopbackAndInternalBypass],
  ['§58.4 cross-tenant list/detail/export/file', attack04_crossTenantListDetailExportFile],
  ['§58.5 masked field via report/history/notification', attack05_maskedFieldViaReportHistoryNotification],
  ['§58.6 duplicate approval decision', attack06_duplicateApprovalDecision],
  ['§58.7 duplicate workflow dispatch + worker crash', attack07_duplicateWorkflowDispatchAndWorkerCrash],
  ['§58.8 webhook replay', attack08_webhookReplay],
  ['§58.9 reset and MFA token replay', attack09_resetAndMfaTokenReplay],
  ['§58.10 API key rotation and revocation', attack10_apiKeyRotationAndRevocation],
  ['§58.11 secret leakage in logs / support bundle', attack11_secretLeakInLogsAndSupportBundle],
  ['§58.12 public link guessing', attack12_publicLinkGuessing],
  ['§58.13 import permission bypass', attack13_importPermissionBypass],
  ['§58.14 AI tool / service identity overreach', attack14_aiToolAndServiceIdentityOverreach],
  ['concurrency: session revocation race', concurrency_sessionRevocationRace],
  ['concurrency: settings version conflict', concurrency_settingsVersionConflict],
  ['concurrency: job lease and double execution', concurrency_jobLeaseAndDoubleExecution],
  ['failure: migration down/up leaves nothing half-applied', failure_migrationRollbackLeavesNothingHalfApplied],
  ['failure: encryption unavailable fails closed', failure_encryptionUnavailableFailsClosed],
  ['failure: provider outage is observable and recoverable', failure_providerOutageIsObservableAndRecoverable],
  ['§55 evidence views are scoped, masked, gated', evidence_viewsAreScopedMaskedAndGated],
  ['§56 bootstrap is role-specific and RTL', ui_bootstrapIsRoleSpecificAndRtl],
  ['§56 impersonation banner and field metadata', ui_impersonationBannerAndFieldMetadata],
  ['§56 unrelated Octagon pages and frozen zones unaffected', integration_unrelatedOctagonPagesUnaffected],
]);
