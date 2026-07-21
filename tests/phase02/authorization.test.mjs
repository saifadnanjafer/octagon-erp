// Phase 02 Wave B — permission registry, evaluator, record scope, field masking,
// route/menu authorization, and role administration.
// Packets 02.06 – 02.11. Disposable databases only.

import assert from 'node:assert';
import crypto from 'node:crypto';
import { setup, cleanup, run, seedOrg } from './harness.mjs';
import { createPermissionRegistry, permissionMatches, PermissionRegistryError } from '../../platform/authorization/registry/index.mjs';
import { createPermissionEvaluator, AuthorizationError, REASON, PermissionEvaluator } from '../../platform/authorization/evaluator/index.mjs';
import { createRoleAdministration, RoleError } from '../../platform/authorization/roles/index.mjs';
import { createRouteCoverageRegistry, RouteCoverageError } from '../../platform/authorization/route-coverage/index.mjs';
import { createMembershipDirectory } from '../../platform/organizations/memberships/index.mjs';
import { buildDecisionContext, stripUntrustedContext, systemContext } from '../../platform/identity/context/index.mjs';
import { createServiceIdentityAuthority } from '../../platform/identity/service-identities/index.mjs';

const PERMS = [
  { id: 'crm:crm_lead:read', module_id: 'platform_kernel', kind: 'resource', label_ar: 'قراءة العملاء المحتملين' },
  { id: 'crm:crm_lead:create', module_id: 'platform_kernel', kind: 'action', label_ar: 'إنشاء عميل محتمل' },
  { id: 'crm:crm_lead:update', module_id: 'platform_kernel', kind: 'action', label_ar: 'تعديل عميل محتمل' },
  { id: 'crm:crm_lead:delete', module_id: 'platform_kernel', kind: 'action', label_ar: 'حذف عميل محتمل' },
  { id: 'crm:crm_lead:qualify', module_id: 'platform_kernel', kind: 'document_state', label_ar: 'ترشيح عميل محتمل' },
  { id: 'crm:crm_lead:export', module_id: 'platform_kernel', kind: 'export', label_ar: 'تصدير العملاء المحتملين' },
  { id: 'crm:page:leads', module_id: 'platform_kernel', kind: 'page', label_ar: 'صفحة العملاء المحتملين' },
  { id: 'crm:page:admin', module_id: 'platform_kernel', kind: 'page', label_ar: 'صفحة الإدارة' },
];

function bootstrap(dialect) {
  const org = seedOrg(dialect);
  const registry = createPermissionRegistry(dialect);
  registry.registerMany(PERMS);
  const evaluator = createPermissionEvaluator(dialect, { permissionRegistry: registry });
  const roles = createRoleAdministration(dialect, { permissionRegistry: registry, evaluator });
  const memberships = createMembershipDirectory(dialect);
  const ctxFor = (userId, request = {}) =>
    buildDecisionContext(dialect, { actorId: userId, actorType: 'user' }, stripUntrustedContext(request), { membershipDirectory: memberships });
  return { org, registry, evaluator, roles, memberships, ctxFor };
}

function seedRecord(dialect, { entity = 'crm_lead', id, companyId, createdBy, data = {} }) {
  const now = new Date().toISOString();
  dialect.prepare(`
    INSERT INTO x_records (entity, id, company_id, data, created_at, updated_at, created_by, removed, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)
  `).run(entity, id, companyId, JSON.stringify(data), now, now, createdBy);
  return id;
}

// --- 02.06 permission registry ----------------------------------------------

async function testRegistryTokensAndDuplicates() {
  const { dialect, dbPath } = await setup();
  const { registry } = bootstrap(dialect);
  assert.strictEqual(registry.get('crm:crm_lead:read').moduleId, 'platform_kernel');
  // malformed token
  assert.throws(() => registry.register({ id: 'NotAToken', module_id: 'platform_kernel', kind: 'action' }),
    (e) => e.code === 'PERMISSION_ID_INVALID');
  // duplicate id claimed by a different module
  assert.throws(() => registry.register({ id: 'crm:crm_lead:read', module_id: 'other_module', kind: 'resource' }),
    (e) => e.code === 'PERMISSION_DUPLICATE_OWNER');
  // unknown dependency
  assert.throws(() => registry.register({ id: 'crm:crm_lead:merge', module_id: 'platform_kernel', kind: 'action', depends_on: ['crm:crm_lead:nope'] }),
    (e) => e.code === 'PERMISSION_DEPENDENCY_MISSING');
  await cleanup(dialect, dbPath);
}

async function testUnknownAndRetiredTokensFailClosed() {
  const { dialect, dbPath } = await setup();
  const { org, registry, evaluator, roles, ctxFor } = bootstrap(dialect);
  roles.createRole({ id: 'r_all', tenantId: org.tenantA, name: 'all_access' });
  roles.setGrants('r_all', [{ permission: '*', scope: 'all' }]);
  roles.assign({ userId: org.userManager, roleId: 'r_all', companyId: org.companyA1 });
  const ctx = ctxFor(org.userManager);

  // an unregistered token is denied even for a wildcard grant holder
  const unknown = evaluator.evaluate({ permission: 'ghost:module:action', ctx });
  assert.strictEqual(unknown.allowed, false);
  assert.strictEqual(unknown.reasonCode, REASON.PERMISSION_UNKNOWN);
  assert.strictEqual(unknown.auditClassification, 'security');

  // retired token without a replacement is denied
  registry.register({ id: 'crm:crm_lead:legacy', module_id: 'platform_kernel', kind: 'action', label_ar: 'قديم' });
  registry.deprecate('crm:crm_lead:legacy');
  const retired = evaluator.evaluate({ permission: 'crm:crm_lead:legacy', ctx });
  assert.strictEqual(retired.reasonCode, REASON.PERMISSION_RETIRED);
  await cleanup(dialect, dbPath);
}

async function testWildcardMatching() {
  const { dialect, dbPath } = await setup();
  assert.strictEqual(permissionMatches('*', 'crm:crm_lead:read'), true);
  assert.strictEqual(permissionMatches('crm:*', 'crm:crm_lead:read'), true);
  assert.strictEqual(permissionMatches('crm:crm_lead:*', 'crm:crm_lead:read'), true);
  assert.strictEqual(permissionMatches('crm:crm_lead:read', 'crm:crm_lead:read'), true);
  assert.strictEqual(permissionMatches('crm:crm_lead:read', 'crm:crm_lead:delete'), false);
  assert.strictEqual(permissionMatches('finance:*', 'crm:crm_lead:read'), false);
  assert.strictEqual(permissionMatches('crm:*:read', 'crm:crm_lead:read'), true);
  await cleanup(dialect, dbPath);
}

async function testDisabledModuleDenies() {
  const { dialect, dbPath } = await setup();
  const { org, evaluator, roles, ctxFor } = bootstrap(dialect);
  roles.createRole({ id: 'r_all', tenantId: org.tenantA, name: 'all_access' });
  roles.setGrants('r_all', [{ permission: '*', scope: 'all' }]);
  roles.assign({ userId: org.userManager, roleId: 'r_all', companyId: org.companyA1 });
  const ctx = ctxFor(org.userManager);
  assert.strictEqual(evaluator.evaluate({ permission: 'crm:crm_lead:read', ctx }).allowed, true);

  // 'installed' is a real non-enabled state in the Phase 01 module lifecycle.
  dialect.prepare("UPDATE platform_modules SET status = 'installed' WHERE id = 'platform_kernel'").run();
  const ctx2 = ctxFor(org.userManager);
  const d = evaluator.evaluate({ permission: 'crm:crm_lead:read', ctx: ctx2 });
  assert.strictEqual(d.allowed, false);
  assert.strictEqual(d.reasonCode, REASON.MODULE_DISABLED);
  await cleanup(dialect, dbPath);
}

async function testRegistryConsistencyAndSnapshot() {
  const { dialect, dbPath } = await setup();
  const { registry } = bootstrap(dialect);
  const report = registry.consistencyReport();
  assert.strictEqual(report.consistent, true, JSON.stringify(report.problems));
  assert.strictEqual(report.total, PERMS.length);
  const snapshot = registry.snapshot();
  assert.strictEqual(snapshot.length, PERMS.length);
  assert.ok(snapshot.every((l) => l.split('|').length === 5));

  // a grant to an unregistered permission is caught by the consistency check
  const roles = createRoleAdministration(dialect);
  roles.createRole({ id: 'r_bad', tenantId: 't_alpha', name: 'bad' });
  dialect.prepare(`INSERT INTO authorization_grants (id, role_id, permission, effect, scope, created_at) VALUES (?,?,?,?,?,?)`)
    .run('g_bad', 'r_bad', 'ghost:thing:do', 'allow', 'all', new Date().toISOString());
  const after = createPermissionRegistry(dialect).consistencyReport();
  assert.strictEqual(after.consistent, false);
  assert.ok(after.problems.some((p) => p.problem === 'GRANT_TO_UNREGISTERED_PERMISSION'));
  await cleanup(dialect, dbPath);
}

// --- 02.07 evaluator --------------------------------------------------------

async function testAllowDenyPrecedence() {
  const { dialect, dbPath } = await setup();
  const { org, evaluator, roles, ctxFor } = bootstrap(dialect);
  roles.createRole({ id: 'r_broad', tenantId: org.tenantA, name: 'broad' });
  roles.setGrants('r_broad', [{ permission: 'crm:*', scope: 'all' }]);
  roles.createRole({ id: 'r_restricted', tenantId: org.tenantA, name: 'restricted' });
  roles.setGrants('r_restricted', [{ permission: 'crm:crm_lead:delete', effect: 'deny', scope: 'all' }]);
  roles.assign({ userId: org.userManager, roleId: 'r_broad', companyId: org.companyA1 });
  const ctx1 = ctxFor(org.userManager);
  assert.strictEqual(evaluator.evaluate({ permission: 'crm:crm_lead:delete', ctx: ctx1 }).allowed, true);

  roles.assign({ userId: org.userManager, roleId: 'r_restricted', companyId: org.companyA1 });
  const ctx2 = ctxFor(org.userManager);
  const d = evaluator.evaluate({ permission: 'crm:crm_lead:delete', ctx: ctx2 });
  assert.strictEqual(d.allowed, false, 'an explicit deny beats a wildcard allow');
  assert.strictEqual(d.reasonCode, REASON.EXPLICIT_DENY);
  assert.ok(d.matchedDenies.length === 1);
  // the broad allow still works for other actions
  assert.strictEqual(evaluator.evaluate({ permission: 'crm:crm_lead:read', ctx: ctx2 }).allowed, true);
  await cleanup(dialect, dbPath);
}

async function testStaleCacheInvalidation() {
  const { dialect, dbPath } = await setup();
  const { org, evaluator, roles, ctxFor } = bootstrap(dialect);
  roles.createRole({ id: 'r1', tenantId: org.tenantA, name: 'r1' });
  roles.setGrants('r1', [{ permission: 'crm:crm_lead:read', scope: 'all' }]);
  roles.assign({ userId: org.userClerk, roleId: 'r1', companyId: org.companyA1 });
  const ctx = ctxFor(org.userClerk);
  assert.strictEqual(evaluator.evaluate({ permission: 'crm:crm_lead:read', ctx }).allowed, true);

  // revoke through the canonical writer; the SAME evaluator instance must not
  // serve a cached allow.
  roles.unassign(org.userClerk, 'r1');
  const ctx2 = ctxFor(org.userClerk);
  assert.strictEqual(evaluator.evaluate({ permission: 'crm:crm_lead:read', ctx: ctx2 }).allowed, false);

  // a direct grant deletion (no evaluator.invalidate() call) is also caught
  roles.assign({ userId: org.userClerk, roleId: 'r1', companyId: org.companyA1 });
  assert.strictEqual(evaluator.evaluate({ permission: 'crm:crm_lead:read', ctx: ctxFor(org.userClerk) }).allowed, true);
  dialect.prepare('DELETE FROM authorization_grants WHERE role_id = ?').run('r1');
  assert.strictEqual(evaluator.evaluate({ permission: 'crm:crm_lead:read', ctx: ctxFor(org.userClerk) }).allowed, false,
    'version-stamped cache detects an out-of-band grant change');
  await cleanup(dialect, dbPath);
}

async function testSameResultAcrossInvocationSurfaces() {
  const { dialect, dbPath } = await setup();
  const { org, evaluator, roles, registry, ctxFor } = bootstrap(dialect);
  roles.createRole({ id: 'r_read', tenantId: org.tenantA, name: 'reader' });
  roles.setGrants('r_read', [{ permission: 'crm:crm_lead:read', scope: 'company' }]);
  roles.assign({ userId: org.userClerk, roleId: 'r_read', companyId: org.companyA1 });
  const ctx = ctxFor(org.userClerk);
  const routes = createRouteCoverageRegistry(dialect, { evaluator, permissionRegistry: registry });
  routes.register({ method: 'GET', route: '/api/v1/crm_lead', moduleId: 'platform_kernel', permission: 'crm:crm_lead:read' });
  routes.register({ method: 'DELETE', route: '/api/v1/crm_lead/:id', moduleId: 'platform_kernel', permission: 'crm:crm_lead:delete' });

  const direct = evaluator.evaluate({ permission: 'crm:crm_lead:read', ctx });
  const viaRoute = routes.authorizeRoute({ method: 'GET', route: '/api/v1/crm_lead', ctx });
  assert.strictEqual(direct.allowed, viaRoute.allowed);
  assert.deepStrictEqual(direct.effectiveScopes, viaRoute.effectiveScopes);

  // the denied path is identical too
  const deniedDirect = evaluator.evaluate({ permission: 'crm:crm_lead:delete', ctx });
  assert.strictEqual(deniedDirect.allowed, false);
  assert.throws(() => routes.authorizeRoute({ method: 'DELETE', route: '/api/v1/crm_lead/:id', ctx }),
    (e) => e instanceof AuthorizationError && e.decision.reasonCode === deniedDirect.reasonCode);
  await cleanup(dialect, dbPath);
}

async function testDecisionEvidenceRecorded() {
  const { dialect, dbPath } = await setup();
  const { org, evaluator, ctxFor } = bootstrap(dialect);
  const ctx = ctxFor(org.userClerk);
  const d = evaluator.evaluate({ permission: 'crm:crm_lead:delete', ctx });
  assert.strictEqual(d.allowed, false);
  const row = dialect.prepare('SELECT * FROM authorization_decisions WHERE decision_id = ?').get(d.decisionId);
  assert.ok(row, 'every denial is persisted as evidence');
  assert.strictEqual(row.actor_id, org.userClerk);
  assert.strictEqual(row.allowed, 0);
  assert.strictEqual(row.reason_code, REASON.NO_GRANT);
  assert.strictEqual(row.company_id, org.companyA1);
  assert.ok(row.correlation_id);
  await cleanup(dialect, dbPath);
}

async function testEvaluatorPerformanceUnderRealisticRoleCounts() {
  const { dialect, dbPath } = await setup();
  const { org, evaluator, roles, registry, ctxFor } = bootstrap(dialect);
  // 40 roles x 25 grants = 1000 grants, 12 assigned to the actor.
  for (let r = 0; r < 40; r++) {
    const roleId = `r_perf_${r}`;
    roles.createRole({ id: roleId, tenantId: org.tenantA, name: `perf_${r}` });
    const grants = [];
    for (let g = 0; g < 25; g++) {
      const perm = `mod${r}:res${g}:read`;
      registry.register({ id: perm, module_id: 'platform_kernel', kind: 'resource', label_ar: 'x' });
      grants.push({ permission: perm, scope: 'company' });
    }
    roles.setGrants(roleId, grants);
    if (r < 12) roles.assign({ userId: org.userManager, roleId, companyId: org.companyA1 });
  }
  const ctx = ctxFor(org.userManager);
  const started = Date.now();
  for (let i = 0; i < 500; i++) evaluator.evaluate({ permission: 'mod3:res7:read', ctx });
  const elapsed = Date.now() - started;
  assert.strictEqual(evaluator.evaluate({ permission: 'mod3:res7:read', ctx }).allowed, true);
  assert.ok(elapsed < 4000, `500 decisions over 12 roles / 1000 grants took ${elapsed}ms`);
  await cleanup(dialect, dbPath);
}

// --- 02.08 record and data scope --------------------------------------------

async function testListDetailAndCountAgree() {
  const { dialect, dbPath } = await setup();
  const { org, evaluator, roles, ctxFor } = bootstrap(dialect);
  roles.createRole({ id: 'r_own', tenantId: org.tenantA, name: 'own_only' });
  roles.setGrants('r_own', [{ permission: 'crm:crm_lead:read', scope: 'own' }]);
  roles.assign({ userId: org.userClerk, roleId: 'r_own', companyId: org.companyA1 });

  seedRecord(dialect, { id: 'lead_mine', companyId: org.companyA1, createdBy: org.userClerk });
  seedRecord(dialect, { id: 'lead_theirs', companyId: org.companyA1, createdBy: org.userManager });
  seedRecord(dialect, { id: 'lead_other_co', companyId: org.companyA2, createdBy: org.userClerk });

  const ctx = ctxFor(org.userClerk);
  const { rows } = evaluator.listScoped({ entity: 'crm_lead', ctx, permission: 'crm:crm_lead:read' });
  assert.deepStrictEqual(rows.map((r) => r.id), ['lead_mine'], 'list returns only own-scope rows');

  const count = evaluator.countScoped({ entity: 'crm_lead', ctx, permission: 'crm:crm_lead:read' });
  assert.strictEqual(count, rows.length, 'count cannot be a side channel that differs from list');

  // detail agrees with list
  assert.strictEqual(evaluator.evaluate({ permission: 'crm:crm_lead:read', ctx, entity: 'crm_lead', recordId: 'lead_mine' }).allowed, true);
  const denied = evaluator.evaluate({ permission: 'crm:crm_lead:read', ctx, entity: 'crm_lead', recordId: 'lead_theirs' });
  assert.strictEqual(denied.allowed, false);
  assert.strictEqual(denied.reasonCode, REASON.RECORD_OUT_OF_SCOPE);
  await cleanup(dialect, dbPath);
}

async function testDirectIdIdorAndCrossTenant() {
  const { dialect, dbPath } = await setup();
  const { org, evaluator, roles, ctxFor } = bootstrap(dialect);
  roles.createRole({ id: 'r_all', tenantId: org.tenantA, name: 'all_access' });
  roles.setGrants('r_all', [{ permission: 'crm:*', scope: 'all' }]);
  roles.assign({ userId: org.userManager, roleId: 'r_all', companyId: org.companyA1 });

  seedRecord(dialect, { id: 'lead_beta', companyId: org.companyB1, createdBy: org.userBeta });
  seedRecord(dialect, { id: 'lead_alpha2', companyId: org.companyA2, createdBy: org.userOutsider });

  const ctx = ctxFor(org.userManager); // member of c_alpha_1 only
  // Even a scope:'all' grant cannot reach a company the actor has no membership in.
  const crossTenant = evaluator.evaluate({ permission: 'crm:crm_lead:read', ctx, entity: 'crm_lead', recordId: 'lead_beta' });
  assert.strictEqual(crossTenant.allowed, false);
  assert.strictEqual(crossTenant.reasonCode, REASON.RECORD_OUT_OF_SCOPE);
  const crossCompany = evaluator.evaluate({ permission: 'crm:crm_lead:read', ctx, entity: 'crm_lead', recordId: 'lead_alpha2' });
  assert.strictEqual(crossCompany.allowed, false);
  // a guessed / nonexistent id is refused with the same reason — no existence oracle
  const guessed = evaluator.evaluate({ permission: 'crm:crm_lead:read', ctx, entity: 'crm_lead', recordId: 'lead_does_not_exist' });
  assert.strictEqual(guessed.reasonCode, crossTenant.reasonCode);
  assert.strictEqual(guessed.message, crossTenant.message);
  await cleanup(dialect, dbPath);
}

async function testExportUsesTheSameScope() {
  const { dialect, dbPath } = await setup();
  const { org, evaluator, roles, ctxFor } = bootstrap(dialect);
  roles.createRole({ id: 'r_dept', tenantId: org.tenantA, name: 'dept_reader' });
  roles.setGrants('r_dept', [
    { permission: 'crm:crm_lead:read', scope: 'department' },
    { permission: 'crm:crm_lead:export', scope: 'department' },
  ]);
  roles.assign({ userId: org.userClerk, roleId: 'r_dept', companyId: org.companyA1 });
  seedRecord(dialect, { id: 'lead_ops', companyId: org.companyA1, createdBy: org.userManager, data: { department_id: org.departmentOps } });
  seedRecord(dialect, { id: 'lead_fin', companyId: org.companyA1, createdBy: org.userManager, data: { department_id: 'dep_finance' } });

  const ctx = ctxFor(org.userClerk);
  const read = evaluator.listScoped({ entity: 'crm_lead', ctx, permission: 'crm:crm_lead:read' });
  const exported = evaluator.listScoped({ entity: 'crm_lead', ctx, permission: 'crm:crm_lead:export' });
  assert.deepStrictEqual(read.rows.map((r) => r.id), ['lead_ops']);
  assert.deepStrictEqual(exported.rows.map((r) => r.id), read.rows.map((r) => r.id), 'export cannot see more than read');
  await cleanup(dialect, dbPath);
}

async function testNoMembershipMeansNoRowsNotAllRows() {
  const { dialect, dbPath } = await setup();
  const { org, evaluator, roles } = bootstrap(dialect);
  roles.createRole({ id: 'r_all', tenantId: org.tenantA, name: 'all_access' });
  roles.setGrants('r_all', [{ permission: 'crm:*', scope: 'all' }]);
  seedRecord(dialect, { id: 'lead_1', companyId: org.companyA1, createdBy: org.userManager });
  // hand-built context with no memberships at all (the pathological case)
  const emptyCtx = { actorId: org.userManager, actorType: 'user', tenantId: org.tenantA, companyMemberships: [], activeCompanyId: null, now: new Date().toISOString(), enabledModules: [], delegations: [] };
  const filter = evaluator.scopeFilter({ entity: 'crm_lead', ctx: emptyCtx, scope: 'all' });
  const rows = dialect.prepare(`SELECT id FROM x_records WHERE ${filter.sql}`).all(...filter.params);
  assert.deepStrictEqual(rows, [], 'no membership yields zero rows, never every row');
  await cleanup(dialect, dbPath);
}

async function testServiceIdentityScopeOnJobs() {
  const { dialect, dbPath } = await setup();
  const { org, evaluator, roles, registry } = bootstrap(dialect);
  const svc = createServiceIdentityAuthority(dialect);
  const account = svc.createServiceAccount({ tenantId: org.tenantA, companyId: org.companyA1, name: 'nightly' });
  const key = svc.issueApiKey({ serviceAccountId: account.id, scopes: ['crm:crm_lead:read'] });
  const actor = svc.authenticateApiKey(key.key);
  const ctx = buildDecisionContext(dialect, actor, {}, {});

  // a service actor with no role grants is denied even inside its key scope
  assert.strictEqual(evaluator.evaluate({ permission: 'crm:crm_lead:read', ctx }).reasonCode, REASON.NO_GRANT);
  // outside the key scope it is refused earlier still
  assert.strictEqual(evaluator.evaluate({ permission: 'crm:crm_lead:delete', ctx }).reasonCode, REASON.API_KEY_SCOPE_DENIED);
  await cleanup(dialect, dbPath);
}

async function testDocumentStateAuthorization() {
  const { dialect, dbPath } = await setup();
  const { org, evaluator, roles, ctxFor } = bootstrap(dialect);
  roles.createRole({ id: 'r_qual', tenantId: org.tenantA, name: 'qualifier' });
  roles.setGrants('r_qual', [{ permission: 'crm:crm_lead:qualify', scope: 'all', documentStates: ['new'] }]);
  roles.assign({ userId: org.userManager, roleId: 'r_qual', companyId: org.companyA1 });
  seedRecord(dialect, { id: 'lead_new', companyId: org.companyA1, createdBy: org.userManager });
  const ctx = ctxFor(org.userManager);
  assert.strictEqual(evaluator.evaluate({ permission: 'crm:crm_lead:qualify', ctx, documentState: 'new' }).allowed, true);
  const wrongState = evaluator.evaluate({ permission: 'crm:crm_lead:qualify', ctx, documentState: 'won' });
  assert.strictEqual(wrongState.allowed, false);
  assert.strictEqual(wrongState.reasonCode, REASON.DOCUMENT_STATE_DENIED);
  await cleanup(dialect, dbPath);
}

// --- 02.09 field-level security ---------------------------------------------

function seedFieldRules(roles, org) {
  roles.createRole({ id: 'r_fields', tenantId: org.tenantA, name: 'field_limited' });
  roles.setGrants('r_fields', [
    { permission: 'crm:crm_lead:read', scope: 'all' },
    { permission: 'crm:crm_lead:update', scope: 'all' },
    { permission: 'crm:crm_lead:export', scope: 'all' },
  ]);
  roles.setFieldRules('r_fields', [
    { entity: 'crm_lead', field: 'national_id', access: 'masked', classification: 'personal' },
    { entity: 'crm_lead', field: 'internal_score', access: 'none' },
    { entity: 'crm_lead', field: 'source', access: 'read' },
  ]);
  roles.assign({ userId: org.userClerk, roleId: 'r_fields', companyId: org.companyA1 });
}

async function testFieldMaskingOnEverySurface() {
  const { dialect, dbPath } = await setup();
  const { org, evaluator, roles, ctxFor } = bootstrap(dialect);
  seedFieldRules(roles, org);
  seedRecord(dialect, {
    id: 'lead_pii', companyId: org.companyA1, createdBy: org.userClerk,
    data: { name: 'Acme', national_id: '199012345678', internal_score: 91, source: 'web' },
  });
  const ctx = ctxFor(org.userClerk);
  const roleIds = evaluator.effectiveRoleIds(ctx);

  // detail read
  const record = { name: 'Acme', national_id: '199012345678', internal_score: 91, source: 'web' };
  const maskedDetail = evaluator.maskRecord('crm_lead', record, roleIds);
  assert.strictEqual(maskedDetail.national_id, '19****78');
  assert.strictEqual('internal_score' in maskedDetail, false);
  assert.strictEqual(maskedDetail.source, 'web');
  assert.strictEqual(maskedDetail.name, 'Acme');

  // list surface uses the identical partition
  const list = evaluator.listScoped({ entity: 'crm_lead', ctx, permission: 'crm:crm_lead:read' });
  assert.strictEqual(list.rows[0].data.national_id, '19****78');
  assert.strictEqual('internal_score' in list.rows[0].data, false);

  // export surface uses the identical partition
  const exported = evaluator.listScoped({ entity: 'crm_lead', ctx, permission: 'crm:crm_lead:export' });
  assert.strictEqual(exported.rows[0].data.national_id, '19****78');
  assert.strictEqual('internal_score' in exported.rows[0].data, false);

  // the decision object itself advertises the mask so a report/template can apply it
  const d = evaluator.evaluate({ permission: 'crm:crm_lead:read', ctx, entity: 'crm_lead' });
  assert.deepStrictEqual(d.maskedFields, ['national_id']);
  await cleanup(dialect, dbPath);
}

async function testFieldWriteIsRejectedNotIgnored() {
  const { dialect, dbPath } = await setup();
  const { org, evaluator, roles, ctxFor } = bootstrap(dialect);
  seedFieldRules(roles, org);
  const ctx = ctxFor(org.userClerk);
  const roleIds = evaluator.effectiveRoleIds(ctx);

  // hidden field
  assert.throws(() => evaluator.assertWritableFields('crm_lead', { internal_score: 5 }, roleIds),
    (e) => e instanceof AuthorizationError && e.decision.reasonCode === REASON.FIELD_WRITE_DENIED);
  // masked field
  assert.throws(() => evaluator.assertWritableFields('crm_lead', { national_id: '1' }, roleIds),
    (e) => e.decision.reasonCode === REASON.FIELD_WRITE_DENIED);
  // read-only field, changed value
  assert.throws(() => evaluator.assertWritableFields('crm_lead', { source: 'phone' }, roleIds, { source: 'web' }),
    (e) => e.decision.reasonCode === REASON.FIELD_WRITE_DENIED);
  // read-only field, unchanged value is tolerated (round-tripped payloads still work)
  assert.strictEqual(evaluator.assertWritableFields('crm_lead', { source: 'web' }, roleIds, { source: 'web' }), true);
  // an unrestricted field is fine
  assert.strictEqual(evaluator.assertWritableFields('crm_lead', { name: 'New name' }, roleIds), true);

  // and the evaluate() path reports it too
  const d = evaluator.evaluate({ permission: 'crm:crm_lead:update', ctx, entity: 'crm_lead', fields: ['internal_score'] });
  assert.strictEqual(d.allowed, false);
  assert.strictEqual(d.reasonCode, REASON.FIELD_WRITE_DENIED);
  await cleanup(dialect, dbPath);
}

async function testMostRestrictiveRoleWinsForMasks() {
  const { dialect, dbPath } = await setup();
  const { org, evaluator, roles, ctxFor } = bootstrap(dialect);
  seedFieldRules(roles, org);
  // a second role that would happily expose the field
  roles.createRole({ id: 'r_open', tenantId: org.tenantA, name: 'open' });
  roles.setGrants('r_open', [{ permission: 'crm:crm_lead:read', scope: 'all' }]);
  roles.setFieldRules('r_open', [{ entity: 'crm_lead', field: 'national_id', access: 'write' }]);
  roles.assign({ userId: org.userClerk, roleId: 'r_open', companyId: org.companyA1 });

  const ctx = ctxFor(org.userClerk);
  const roleIds = evaluator.effectiveRoleIds(ctx);
  const masked = evaluator.maskRecord('crm_lead', { national_id: '199012345678' }, roleIds);
  assert.strictEqual(masked.national_id, '19****78', 'a mask is a protection: the strictest role wins');
  await cleanup(dialect, dbPath);
}

async function testMaskValueShape() {
  const { dialect, dbPath } = await setup();
  assert.strictEqual(PermissionEvaluator.maskValue('199012345678'), '19****78');
  assert.strictEqual(PermissionEvaluator.maskValue('abcd'), '****');
  assert.strictEqual(PermissionEvaluator.maskValue(null), null);
  await cleanup(dialect, dbPath);
}

// --- 02.10 route, menu, page ------------------------------------------------

async function testUnmappedRouteIsDenied() {
  const { dialect, dbPath } = await setup();
  const { org, evaluator, registry, ctxFor } = bootstrap(dialect);
  const routes = createRouteCoverageRegistry(dialect, { evaluator, permissionRegistry: registry });
  const ctx = ctxFor(org.userManager);
  assert.throws(() => routes.authorizeRoute({ method: 'POST', route: '/api/v1/unmapped', ctx }),
    (e) => e instanceof AuthorizationError && e.decision.reasonCode === 'ROUTE_NOT_COVERED');
  await cleanup(dialect, dbPath);
}

async function testPublicRouteNeedsRationale() {
  const { dialect, dbPath } = await setup();
  const { evaluator, registry } = bootstrap(dialect);
  const routes = createRouteCoverageRegistry(dialect, { evaluator, permissionRegistry: registry });
  assert.throws(() => routes.register({ method: 'GET', route: '/health', moduleId: 'platform_kernel', isPublic: true }),
    (e) => e.code === 'PUBLIC_ROUTE_NEEDS_RATIONALE');
  assert.throws(() => routes.register({ method: 'GET', route: '/api/v1/x', moduleId: 'platform_kernel' }),
    (e) => e.code === 'ROUTE_NEEDS_PERMISSION');
  const ok = routes.register({ method: 'GET', route: '/health', moduleId: 'platform_kernel', isPublic: true, rationale: 'liveness probe, no data' });
  assert.strictEqual(ok.public, true);
  await cleanup(dialect, dbPath);
}

async function testHiddenButtonDirectApiCallStillDenied() {
  const { dialect, dbPath } = await setup();
  const { org, evaluator, roles, registry, ctxFor } = bootstrap(dialect);
  roles.createRole({ id: 'r_read', tenantId: org.tenantA, name: 'reader' });
  roles.setGrants('r_read', [{ permission: 'crm:crm_lead:read', scope: 'company' }, { permission: 'crm:page:leads', scope: 'company' }]);
  roles.assign({ userId: org.userClerk, roleId: 'r_read', companyId: org.companyA1 });
  const routes = createRouteCoverageRegistry(dialect, { evaluator, permissionRegistry: registry });
  routes.register({ method: 'DELETE', route: '/api/v1/crm_lead/:id', moduleId: 'platform_kernel', permission: 'crm:crm_lead:delete' });

  const ctx = ctxFor(org.userClerk);
  const meta = routes.clientMetadata(ctx, {
    pages: [
      { id: 'leads', permission: 'crm:page:leads', labelAr: 'العملاء المحتملون', route: '/leads' },
      { id: 'admin', permission: 'crm:page:admin', labelAr: 'الإدارة', route: '/admin' },
    ],
    actions: [{ id: 'delete_lead', permission: 'crm:crm_lead:delete', entity: 'crm_lead' }],
  });
  assert.deepStrictEqual(meta.pages.map((p) => p.id), ['leads'], 'the admin page is not advertised');
  assert.strictEqual(meta.hiddenPageCount, 1);
  assert.strictEqual(meta.actions[0].enabled, false, 'the delete button is advertised as disabled');

  // and calling it directly anyway is refused by the server
  assert.throws(() => routes.authorizeRoute({ method: 'DELETE', route: '/api/v1/crm_lead/:id', ctx, entity: 'crm_lead' }),
    (e) => e instanceof AuthorizationError);
  await cleanup(dialect, dbPath);
}

async function testRouteCoverageReport() {
  const { dialect, dbPath } = await setup();
  const { evaluator, registry } = bootstrap(dialect);
  const routes = createRouteCoverageRegistry(dialect, { evaluator, permissionRegistry: registry });
  routes.register({ method: 'GET', route: '/api/v1/crm_lead', moduleId: 'platform_kernel', permission: 'crm:crm_lead:read' });
  const declared = [
    { method: 'GET', route: '/api/v1/crm_lead' },
    { method: 'POST', route: '/api/v1/crm_lead' },
  ];
  const report = routes.coverageReport(declared);
  assert.strictEqual(report.complete, false);
  assert.deepStrictEqual(report.unmapped, [{ method: 'POST', route: '/api/v1/crm_lead' }]);
  routes.register({ method: 'POST', route: '/api/v1/crm_lead', moduleId: 'platform_kernel', permission: 'crm:crm_lead:create' });
  assert.strictEqual(routes.coverageReport(declared).complete, true);
  await cleanup(dialect, dbPath);
}

async function testArabicNavigationSnapshotPerRole() {
  const { dialect, dbPath } = await setup();
  const { org, evaluator, roles, registry, ctxFor } = bootstrap(dialect);
  roles.createRole({ id: 'r_clerk', tenantId: org.tenantA, name: 'clerk' });
  roles.setGrants('r_clerk', [{ permission: 'crm:page:leads', scope: 'company' }]);
  roles.createRole({ id: 'r_admin', tenantId: org.tenantA, name: 'admin_role' });
  roles.setGrants('r_admin', [{ permission: 'crm:page:leads', scope: 'all' }, { permission: 'crm:page:admin', scope: 'all' }]);
  roles.assign({ userId: org.userClerk, roleId: 'r_clerk', companyId: org.companyA1 });
  roles.assign({ userId: org.userManager, roleId: 'r_admin', companyId: org.companyA1 });

  const routes = createRouteCoverageRegistry(dialect, { evaluator, permissionRegistry: registry });
  const pages = [
    { id: 'leads', permission: 'crm:page:leads', labelAr: 'العملاء المحتملون', route: '/leads' },
    { id: 'admin', permission: 'crm:page:admin', labelAr: 'الإدارة', route: '/admin' },
  ];
  const clerkNav = routes.clientMetadata(ctxFor(org.userClerk), { pages });
  const adminNav = routes.clientMetadata(ctxFor(org.userManager), { pages });
  assert.deepStrictEqual(clerkNav.pages.map((p) => p.labelAr), ['العملاء المحتملون']);
  assert.deepStrictEqual(adminNav.pages.map((p) => p.labelAr), ['العملاء المحتملون', 'الإدارة']);
  assert.strictEqual(clerkNav.direction, 'rtl', 'Arabic locale drives RTL in the bootstrap payload');
  await cleanup(dialect, dbPath);
}

// --- 02.11 role administration ----------------------------------------------

async function testTemplateVersioningAndDefaultDeny() {
  const { dialect, dbPath } = await setup();
  const { org, roles, evaluator, ctxFor } = bootstrap(dialect);
  const v1 = roles.createTemplate({ name: 'branch_clerk', labelAr: 'موظف فرع', permissions: [{ permission: 'crm:crm_lead:read', scope: 'branch' }] });
  assert.strictEqual(v1.version, 1);
  const v2 = roles.createTemplate({ name: 'branch_clerk', labelAr: 'موظف فرع', permissions: [{ permission: 'crm:crm_lead:read', scope: 'branch' }, { permission: 'crm:crm_lead:create', scope: 'branch' }] });
  assert.strictEqual(v2.version, 2);
  assert.strictEqual(roles.latestTemplate('branch_clerk').version, 2);

  // an empty template grants nothing
  const empty = roles.createTemplate({ name: 'nothing', permissions: [] });
  roles.createRole({ id: 'r_nothing', tenantId: org.tenantA, name: 'nothing_role', templateId: empty.id });
  roles.assign({ userId: org.userClerk, roleId: 'r_nothing', companyId: org.companyA1 });
  assert.strictEqual(evaluator.evaluate({ permission: 'crm:crm_lead:read', ctx: ctxFor(org.userClerk) }).allowed, false);
  await cleanup(dialect, dbPath);
}

async function testImpactPreviewBeforeChange() {
  const { dialect, dbPath } = await setup();
  const { org, roles, evaluator, ctxFor } = bootstrap(dialect);
  roles.createRole({ id: 'r_x', tenantId: org.tenantA, name: 'x' });
  roles.setGrants('r_x', [{ permission: 'crm:crm_lead:read', scope: 'company' }]);
  roles.assign({ userId: org.userClerk, roleId: 'r_x', companyId: org.companyA1 });
  roles.assign({ userId: org.userManager, roleId: 'r_x', companyId: org.companyA1 });

  const preview = roles.previewGrantChange('r_x', [{ permission: '*', scope: 'all' }]);
  assert.strictEqual(preview.affectedUserCount, 2);
  assert.deepStrictEqual(preview.permissionsGained, ['*@all']);
  assert.deepStrictEqual(preview.permissionsLost, ['crm:crm_lead:read@company']);
  assert.strictEqual(preview.escalation, true, 'a wildcard grant is flagged as escalation');
  // the preview did NOT mutate anything
  assert.strictEqual(evaluator.evaluate({ permission: 'crm:crm_lead:delete', ctx: ctxFor(org.userClerk) }).allowed, false);

  const access = roles.effectiveAccess(org.userClerk, org.companyA1);
  assert.deepStrictEqual(access.allows.map((a) => a.permission), ['crm:crm_lead:read']);
  await cleanup(dialect, dbPath);
}

async function testBulkAssignmentIsAtomic() {
  const { dialect, dbPath } = await setup();
  const { org, roles } = bootstrap(dialect);
  roles.createRole({ id: 'r_bulk', tenantId: org.tenantA, name: 'bulk' });
  roles.setGrants('r_bulk', [{ permission: 'crm:crm_lead:read', scope: 'company' }]);
  assert.throws(() => roles.bulkAssign([
    { userId: org.userClerk, roleId: 'r_bulk', companyId: org.companyA1 },
    { userId: org.userBeta, roleId: 'r_bulk', companyId: org.companyA1 }, // cross-tenant -> whole batch fails
  ]), (e) => e.code === 'CROSS_TENANT_ROLE');
  const applied = dialect.prepare("SELECT COUNT(*) AS n FROM authorization_role_assignments WHERE role_id = 'r_bulk' AND status='active'").get();
  assert.strictEqual(Number(applied.n), 0, 'a failed bulk assignment leaves nothing behind');

  // the valid subset succeeds on its own
  roles.bulkAssign([{ userId: org.userClerk, roleId: 'r_bulk', companyId: org.companyA1 }]);
  assert.strictEqual(Number(dialect.prepare("SELECT COUNT(*) AS n FROM authorization_role_assignments WHERE role_id='r_bulk' AND status='active'").get().n), 1);
  await cleanup(dialect, dbPath);
}

async function testCompanySpecificRoleAndRetirement() {
  const { dialect, dbPath } = await setup();
  const { org, roles, evaluator, ctxFor } = bootstrap(dialect);
  roles.createRole({ id: 'r_co1', tenantId: org.tenantA, name: 'co1_only' });
  roles.setGrants('r_co1', [{ permission: 'crm:crm_lead:read', scope: 'company' }]);
  roles.assign({ userId: org.userOwner, roleId: 'r_co1', companyId: org.companyA1 });

  assert.strictEqual(evaluator.evaluate({ permission: 'crm:crm_lead:read', ctx: ctxFor(org.userOwner, { companyId: org.companyA1 }) }).allowed, true);
  assert.strictEqual(evaluator.evaluate({ permission: 'crm:crm_lead:read', ctx: ctxFor(org.userOwner, { companyId: org.companyA2 }) }).allowed, false,
    'a company-scoped assignment does not follow the user into another company');

  // assignment into a company the user is not a member of is refused outright
  assert.throws(() => roles.assign({ userId: org.userClerk, roleId: 'r_co1', companyId: org.companyA2 }),
    (e) => e.code === 'COMPANY_NOT_A_MEMBERSHIP');

  roles.retireRole('r_co1');
  assert.strictEqual(evaluator.evaluate({ permission: 'crm:crm_lead:read', ctx: ctxFor(org.userOwner, { companyId: org.companyA1 }) }).allowed, false);
  assert.throws(() => roles.assign({ userId: org.userManager, roleId: 'r_co1', companyId: org.companyA1 }), (e) => e.code === 'ROLE_RETIRED');
  await cleanup(dialect, dbPath);
}

async function testOwnerRoleCannotBeFullyRemoved() {
  const { dialect, dbPath } = await setup();
  const { org, roles } = bootstrap(dialect);
  roles.createRole({ id: 'r_owner', tenantId: org.tenantA, name: 'tenant_owner' });
  roles.setGrants('r_owner', [{ permission: '*', scope: 'all' }]);
  roles.assign({ userId: org.userOwner, roleId: 'r_owner', companyId: org.companyA1 });
  assert.throws(() => roles.unassign(org.userOwner, 'r_owner'), (e) => e.code === 'OWNER_LOCKOUT_PREVENTED');

  // with a second owner present, removal is allowed
  roles.assign({ userId: org.userManager, roleId: 'r_owner', companyId: org.companyA1 });
  roles.unassign(org.userOwner, 'r_owner');
  assert.ok(roles.assignmentsFor(org.userOwner).find((a) => a.role_id === 'r_owner').status === 'revoked');
  await cleanup(dialect, dbPath);
}

async function testRoleAdministrationIsAudited() {
  const { dialect, dbPath } = await setup();
  const { org, roles } = bootstrap(dialect);
  roles.createRole({ id: 'r_aud', tenantId: org.tenantA, name: 'aud' }, org.userOwner);
  roles.setGrants('r_aud', [{ permission: 'crm:crm_lead:read', scope: 'company' }], org.userOwner);
  roles.assign({ userId: org.userClerk, roleId: 'r_aud', companyId: org.companyA1 }, org.userOwner);
  const actions = dialect.prepare("SELECT action FROM platform_audit_log WHERE resource = 'authorization_roles' ORDER BY occurred_at").all().map((r) => r.action);
  for (const expected of ['role.create', 'role.grants.replace', 'role.assign']) {
    assert.ok(actions.includes(expected), `missing audit action ${expected}`);
  }
  const actors = dialect.prepare("SELECT DISTINCT actor_id FROM platform_audit_log WHERE resource = 'authorization_roles'").all().map((r) => r.actor_id);
  assert.ok(actors.includes(org.userOwner));
  await cleanup(dialect, dbPath);
}

async function testSystemContextIsNotHttpReachable() {
  const { dialect, dbPath } = await setup();
  const { evaluator } = bootstrap(dialect);
  const sys = systemContext(dialect, { companyId: 'c_alpha_1', tenantId: 't_alpha' });
  assert.strictEqual(evaluator.evaluate({ permission: 'anything:at:all', ctx: sys }).allowed, true);
  // but it can only be produced by importing systemContext() — nothing derives it
  // from a request. buildDecisionContext never emits actorType 'system'.
  const membershipsDir = createMembershipDirectory(dialect);
  const org = { userClerk: 'u_clerk' };
  const ctx = buildDecisionContext(dialect, { actorId: org.userClerk, actorType: 'system' }, {}, { membershipDirectory: membershipsDir });
  assert.notStrictEqual(ctx.actorType, 'system', 'a request-derived context is never a system context');
  assert.strictEqual(ctx.actorType, 'user');
  await cleanup(dialect, dbPath);
}

// --- runner -----------------------------------------------------------------

await run('Phase 02 / authorization registry, evaluator, scopes, fields, routes, roles', [
  ['02.06 registry tokens, duplicates, dependencies', testRegistryTokensAndDuplicates],
  ['02.06 unknown and retired tokens fail closed', testUnknownAndRetiredTokensFailClosed],
  ['02.06 wildcard permission matching', testWildcardMatching],
  ['02.06 disabled module denies', testDisabledModuleDenies],
  ['02.06 registry consistency and snapshot', testRegistryConsistencyAndSnapshot],
  ['02.07 allow/deny precedence', testAllowDenyPrecedence],
  ['02.07 stale cache invalidation', testStaleCacheInvalidation],
  ['02.07 identical result across UI/API/domain surfaces', testSameResultAcrossInvocationSurfaces],
  ['02.07 decision evidence is persisted', testDecisionEvidenceRecorded],
  ['02.07 performance under realistic role/grant counts', testEvaluatorPerformanceUnderRealisticRoleCounts],
  ['02.08 list, detail, and count agree', testListDetailAndCountAgree],
  ['02.08 direct-id IDOR and cross-tenant denial', testDirectIdIdorAndCrossTenant],
  ['02.08 export uses the same scope as read', testExportUsesTheSameScope],
  ['02.08 no membership means no rows', testNoMembershipMeansNoRowsNotAllRows],
  ['02.08 service identity scope on job paths', testServiceIdentityScopeOnJobs],
  ['02.08 document-state authorization', testDocumentStateAuthorization],
  ['02.09 field masking on every surface', testFieldMaskingOnEverySurface],
  ['02.09 protected field write is rejected', testFieldWriteIsRejectedNotIgnored],
  ['02.09 most restrictive role wins for masks', testMostRestrictiveRoleWinsForMasks],
  ['02.09 mask value shape', testMaskValueShape],
  ['02.10 unmapped route is denied', testUnmappedRouteIsDenied],
  ['02.10 public route requires a rationale', testPublicRouteNeedsRationale],
  ['02.10 hidden button direct API call still denied', testHiddenButtonDirectApiCallStillDenied],
  ['02.10 route coverage report', testRouteCoverageReport],
  ['02.10 Arabic navigation snapshot per role', testArabicNavigationSnapshotPerRole],
  ['02.11 template versioning and default deny', testTemplateVersioningAndDefaultDeny],
  ['02.11 impact preview before change', testImpactPreviewBeforeChange],
  ['02.11 bulk assignment is atomic', testBulkAssignmentIsAtomic],
  ['02.11 company-specific role and retirement', testCompanySpecificRoleAndRetirement],
  ['02.11 owner role cannot be fully removed', testOwnerRoleCannotBeFullyRemoved],
  ['02.11 role administration is audited', testRoleAdministrationIsAudited],
  ['02.07 system context is not HTTP-reachable', testSystemContextIsNotHttpReachable],
]);
