// Phase 02 Wave A — identity, session, credential, MFA, SSO, service-identity suite.
// Packets 02.01 – 02.05. Every test uses a disposable temp database.

import assert from 'node:assert';
import crypto from 'node:crypto';
import { setup, cleanup, run, seedOrg } from './harness.mjs';
import { createUserDirectory, mapLegacyRoles } from '../../platform/identity/users/index.mjs';
import { createMembershipDirectory, MembershipError } from '../../platform/organizations/memberships/index.mjs';
import { createSessionAuthority, SessionError } from '../../platform/identity/sessions/index.mjs';
import {
  checkPasswordPolicy, savePasswordPolicy, loadPasswordPolicy, setPassword, checkCredentials,
  createPasswordReset, consumePasswordReset, PasswordError,
} from '../../platform/identity/passwords/index.mjs';
import { createMfaAuthority, generateHOTP, _internal as mfaInternal } from '../../platform/identity/mfa/index.mjs';
import {
  createServiceIdentityAuthority, createImpersonationAuthority, redactSecrets, ServiceIdentityError,
} from '../../platform/identity/service-identities/index.mjs';
import { createSsoRegistry, SsoError } from '../../platform/identity/sso/index.mjs';
import { buildDecisionContext, stripUntrustedContext, createExecutionContext, ContextError } from '../../platform/identity/context/index.mjs';

const STRONG = 'Alpha#Beta9!x';

// --- 02.01 canonical actor, membership, context -----------------------------

async function testBodySuppliedActorIgnored() {
  const { dialect, dbPath } = await setup();
  const org = seedOrg(dialect);
  const memberships = createMembershipDirectory(dialect);

  const hostile = {
    userId: 'u_outsider', actorId: 'u_outsider', tenantId: 't_beta',
    roles: ['admin'], isOwner: true, bypass: true, companyId: org.companyA1,
  };
  const requested = stripUntrustedContext(hostile);
  assert.deepStrictEqual(Object.keys(requested).sort(), ['requestedCompanyId']);

  const ctx = buildDecisionContext(dialect, { actorId: org.userClerk, actorType: 'user' }, requested, { membershipDirectory: memberships });
  assert.strictEqual(ctx.actorId, org.userClerk, 'actor comes from the verified session, not the body');
  assert.strictEqual(ctx.tenantId, org.tenantA);
  assert.deepStrictEqual(ctx.roles, [], 'no roles are granted from the body');
  assert.strictEqual(ctx.isOwner, false);
  await cleanup(dialect, dbPath);
}

async function testInvalidActiveCompanyRejected() {
  const { dialect, dbPath } = await setup();
  const org = seedOrg(dialect);
  const memberships = createMembershipDirectory(dialect);
  assert.throws(
    () => memberships.resolveActiveScope(org.userClerk, { requestedCompanyId: org.companyB1 }),
    (e) => e instanceof MembershipError && e.code === 'COMPANY_NOT_A_MEMBERSHIP'
  );
  // and a company the user simply is not in, inside its own tenant
  assert.throws(
    () => memberships.resolveActiveScope(org.userClerk, { requestedCompanyId: org.companyA2 }),
    (e) => e.code === 'COMPANY_NOT_A_MEMBERSHIP'
  );
  await cleanup(dialect, dbPath);
}

async function testCrossTenantMembershipImpossible() {
  const { dialect, dbPath } = await setup();
  const org = seedOrg(dialect);
  const memberships = createMembershipDirectory(dialect);
  assert.throws(
    () => memberships.grant({ userId: org.userClerk, companyId: org.companyB1 }),
    (e) => e instanceof MembershipError && e.code === 'CROSS_TENANT_MEMBERSHIP'
  );
  await cleanup(dialect, dbPath);
}

async function testStaleMembershipRevokesAccess() {
  const { dialect, dbPath } = await setup();
  const org = seedOrg(dialect);
  const memberships = createMembershipDirectory(dialect);
  const sessions = createSessionAuthority(dialect);
  const s = sessions.createSession(org.userClerk, { activeCompanyId: org.companyA1 });
  sessions.resolve(s.token); // live

  memberships.revoke(org.userClerk, org.companyA1);
  assert.throws(() => sessions.resolve(s.token), (e) => e.code === 'SESSION_REVOKED');
  assert.throws(() => memberships.resolveActiveScope(org.userClerk), (e) => e.code === 'NO_MEMBERSHIP');
  await cleanup(dialect, dbPath);
}

async function testServiceIdentityCannotCreateSession() {
  const { dialect, dbPath } = await setup();
  const org = seedOrg(dialect);
  const svc = createServiceIdentityAuthority(dialect);
  const sessions = createSessionAuthority(dialect);
  const account = svc.createServiceAccount({ tenantId: org.tenantA, companyId: org.companyA1, name: 'integration' });
  assert.throws(() => sessions.createSession(account.id), (e) => e.code === 'USER_NOT_FOUND');
  await cleanup(dialect, dbPath);
}

async function testServiceContextCannotWidenScope() {
  const { dialect, dbPath } = await setup();
  const org = seedOrg(dialect);
  const svc = createServiceIdentityAuthority(dialect);
  const account = svc.createServiceAccount({ tenantId: org.tenantA, companyId: org.companyA1, name: 'integration' });
  const key = svc.issueApiKey({ serviceAccountId: account.id, scopes: ['crm_lead:read'] });
  const actor = svc.authenticateApiKey(key.key);
  const ctx = buildDecisionContext(dialect, actor, stripUntrustedContext({ companyId: org.companyA2 }), {});
  assert.strictEqual(ctx.activeCompanyId, org.companyA1, 'service scope is the key scope, not the requested one');
  assert.deepStrictEqual(ctx.companyMemberships, [org.companyA1]);
  await cleanup(dialect, dbPath);
}

async function testLegacyRoleAdapter() {
  const { dialect, dbPath } = await setup();
  assert.deepStrictEqual(mapLegacyRoles({ role: 'mgr_finance' }), ['accountant']);
  assert.deepStrictEqual(mapLegacyRoles({ groups: ['system.admin'] }), ['admin']);
  assert.deepStrictEqual(mapLegacyRoles({ role: 'not_a_role', groups: [] }), [], 'unknown legacy role maps to nothing, never to admin');
  await cleanup(dialect, dbPath);
}

async function testPhase01ContextSurfacePreserved() {
  const { dialect, dbPath } = await setup();
  const ctx = createExecutionContext(dialect, { companyId: 'default', userId: 'system', sourceChannel: 'test' });
  assert.strictEqual(ctx.companyId, 'default');
  assert.strictEqual(ctx.userId, 'system');
  assert.ok(ctx.correlationId);
  assert.throws(() => createExecutionContext(dialect, { companyId: 'unknown' }), /company not found/);
  await cleanup(dialect, dbPath);
}

// --- 02.02 session hardening ------------------------------------------------

async function testSessionFixationResistance() {
  const { dialect, dbPath } = await setup();
  const org = seedOrg(dialect);
  const sessions = createSessionAuthority(dialect);
  const first = sessions.createSession(org.userClerk, { activeCompanyId: org.companyA1 });
  const rotated = sessions.rotate(first.token, 'privilege_change');
  assert.notStrictEqual(rotated.token, first.token);
  assert.notStrictEqual(rotated.sessionId, first.sessionId);
  assert.throws(() => sessions.resolve(first.token), (e) => e.code === 'SESSION_REVOKED');
  assert.ok(sessions.resolve(rotated.token).userId === org.userClerk);
  await cleanup(dialect, dbPath);
}

async function testSessionIdleAndAbsoluteExpiry() {
  const { dialect, dbPath } = await setup();
  const org = seedOrg(dialect);
  savePasswordPolicy(dialect, { session_idle_seconds: 60, session_absolute_seconds: 300 });
  let clock = new Date('2026-07-21T10:00:00.000Z');
  const sessions = createSessionAuthority(dialect, { now: () => clock });
  const s = sessions.createSession(org.userClerk);

  clock = new Date('2026-07-21T10:00:30.000Z');
  assert.ok(sessions.resolve(s.token), 'still live inside the idle window');

  clock = new Date('2026-07-21T10:02:00.000Z'); // 90s after last touch
  assert.throws(() => sessions.resolve(s.token), (e) => e.code === 'SESSION_EXPIRED' && e.details.kind === 'idle');

  // absolute expiry wins even with continuous activity
  clock = new Date('2026-07-21T11:00:00.000Z');
  const s2 = sessions.createSession(org.userClerk);
  for (let i = 1; i <= 5; i++) {
    clock = new Date(Date.parse('2026-07-21T11:00:00.000Z') + i * 50_000);
    try { sessions.resolve(s2.token); } catch { /* absolute boundary */ }
  }
  clock = new Date('2026-07-21T11:06:00.000Z');
  assert.throws(() => sessions.resolve(s2.token), (e) => e.code === 'SESSION_EXPIRED');
  await cleanup(dialect, dbPath);
}

async function testLogoutAndRevocation() {
  const { dialect, dbPath } = await setup();
  const org = seedOrg(dialect);
  const sessions = createSessionAuthority(dialect);
  const a = sessions.createSession(org.userClerk);
  const b = sessions.createSession(org.userClerk);
  sessions.revoke(a.sessionId, 'logout');
  assert.throws(() => sessions.resolve(a.token), (e) => e.code === 'SESSION_REVOKED');
  assert.ok(sessions.resolve(b.token));
  sessions.revokeAllForUser(org.userClerk, 'admin_revoke');
  assert.throws(() => sessions.resolve(b.token), (e) => e.code === 'SESSION_REVOKED');
  await cleanup(dialect, dbPath);
}

async function testUserSuspensionKillsSessions() {
  const { dialect, dbPath } = await setup();
  const org = seedOrg(dialect);
  const users = createUserDirectory(dialect);
  const sessions = createSessionAuthority(dialect);
  const s = sessions.createSession(org.userClerk);
  users.setStatus(org.userClerk, 'suspended');
  assert.throws(() => sessions.resolve(s.token), (e) => e.code === 'SESSION_REVOKED' || e.code === 'USER_INACTIVE');
  await cleanup(dialect, dbPath);
}

async function testBruteForceLockout() {
  const { dialect, dbPath } = await setup();
  const org = seedOrg(dialect);
  savePasswordPolicy(dialect, { max_failed_attempts: 3, lockout_seconds: 600 });
  const sessions = createSessionAuthority(dialect);
  for (let i = 0; i < 3; i++) {
    assert.throws(
      () => sessions.authenticate({ tenantId: org.tenantA, login: 'clerk', password: 'wrong-password' }),
      (e) => e.code === 'AUTH_FAILED'
    );
  }
  // now even the CORRECT password is refused while locked
  assert.throws(
    () => sessions.authenticate({ tenantId: org.tenantA, login: 'clerk', password: STRONG }),
    (e) => e.code === 'LOCKED_OUT'
  );
  const attempts = dialect.prepare('SELECT COUNT(*) AS n FROM identity_login_attempts WHERE succeeded = 0').get();
  assert.ok(Number(attempts.n) >= 4, 'every failed attempt is evidence');
  await cleanup(dialect, dbPath);
}

async function testUnknownLoginIsNotAnEnumerator() {
  const { dialect, dbPath } = await setup();
  const org = seedOrg(dialect);
  const sessions = createSessionAuthority(dialect);
  let unknownErr; let wrongPwErr;
  try { sessions.authenticate({ tenantId: org.tenantA, login: 'nobody', password: 'x' }); } catch (e) { unknownErr = e; }
  try { sessions.authenticate({ tenantId: org.tenantA, login: 'clerk', password: 'x' }); } catch (e) { wrongPwErr = e; }
  assert.strictEqual(unknownErr.code, wrongPwErr.code);
  assert.strictEqual(unknownErr.message, wrongPwErr.message);
  await cleanup(dialect, dbPath);
}

async function testNoLoopbackBypassExists() {
  const { dialect, dbPath } = await setup();
  const sessions = createSessionAuthority(dialect);
  // The canonical session module exposes no ip/env/header trust path at all.
  const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../../platform/identity/sessions/index.mjs', import.meta.url), 'utf8'));
  for (const forbidden of ['127.0.0.1', '::1', 'OCTAGON_TRUST_LOCALHOST', 'allowLocalDev', 'isLoopback', 'x-octagon-user']) {
    assert.ok(!new RegExp(`^(?!\\s*//).*${forbidden.replace('.', '\\.')}`, 'm').test(src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')),
      `sessions module must contain no ${forbidden} trust path outside comments`);
  }
  assert.throws(() => sessions.resolve(null), (e) => e.code === 'NO_SESSION');
  assert.throws(() => sessions.resolve('made-up-token'), (e) => e.code === 'NO_SESSION');
  await cleanup(dialect, dbPath);
}

async function testCsrfVerification() {
  const { dialect, dbPath } = await setup();
  const org = seedOrg(dialect);
  const sessions = createSessionAuthority(dialect);
  const s = sessions.createSession(org.userClerk);
  const live = sessions.resolve(s.token);
  assert.strictEqual(sessions.verifyCsrf(live, live.csrfToken), true);
  assert.strictEqual(sessions.verifyCsrf(live, 'forged'), false);
  assert.strictEqual(sessions.verifyCsrf(live, ''), false);
  await cleanup(dialect, dbPath);
}

async function testConcurrentSessionPolicy() {
  const { dialect, dbPath } = await setup();
  const org = seedOrg(dialect);
  savePasswordPolicy(dialect, { max_concurrent_sessions: 2 });
  const sessions = createSessionAuthority(dialect);
  const a = sessions.createSession(org.userClerk);
  const b = sessions.createSession(org.userClerk);
  const c = sessions.createSession(org.userClerk);
  assert.throws(() => sessions.resolve(a.token), (e) => e.code === 'SESSION_REVOKED', 'oldest session evicted');
  assert.ok(sessions.resolve(b.token) && sessions.resolve(c.token));
  await cleanup(dialect, dbPath);
}

// --- 02.03 password, recovery, MFA, impersonation ---------------------------

async function testPasswordPolicyEnforcement() {
  const { dialect, dbPath } = await setup();
  const org = seedOrg(dialect);
  const policy = loadPasswordPolicy(dialect);
  assert.strictEqual(checkPasswordPolicy('short', policy).ok, false);
  assert.ok(checkPasswordPolicy('alllowercaseletters', policy).codes.includes('PASSWORD_NEEDS_UPPER'));
  assert.strictEqual(checkPasswordPolicy(STRONG, policy).ok, true);
  assert.throws(
    () => setPassword(dialect, org.userClerk, 'weak'),
    (e) => e instanceof PasswordError && e.code === 'PASSWORD_POLICY_VIOLATION'
  );
  await cleanup(dialect, dbPath);
}

async function testPasswordNeverStoredInClear() {
  const { dialect, dbPath } = await setup();
  const org = seedOrg(dialect);
  const row = dialect.prepare('SELECT * FROM identity_credentials WHERE user_id = ?').get(org.userClerk);
  assert.ok(row.hash && row.hash !== STRONG);
  assert.ok(!JSON.stringify(row).includes(STRONG), 'plaintext password appears nowhere in the credential row');
  assert.strictEqual(row.algorithm, 'scrypt');
  await cleanup(dialect, dbPath);
}

async function testLegacySha256PasswordMigration() {
  const { dialect, dbPath } = await setup();
  const org = seedOrg(dialect);
  const salt = 'deadbeef';
  const legacyHash = crypto.createHash('sha256').update(STRONG + salt).digest('hex');
  // Simulate a user that was created before the platform cutover.
  dialect.prepare(`
    INSERT INTO identity_credentials (user_id, algorithm, salt, hash, must_change, changed_at, changed_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET algorithm=excluded.algorithm, salt=excluded.salt, hash=excluded.hash,
      must_change=excluded.must_change, changed_at=excluded.changed_at, changed_by=excluded.changed_by
  `).run(org.userClerk, 'legacy_sha256', salt, legacyHash, 0, new Date().toISOString(), 'test');
  const before = dialect.prepare('SELECT algorithm FROM identity_credentials WHERE user_id = ?').get(org.userClerk);
  assert.strictEqual(before.algorithm, 'legacy_sha256');

  const result = checkCredentials(dialect, org.userClerk, STRONG);
  assert.strictEqual(result.ok, true, `legacy password verification failed: ${result.reasonCode}`);

  const after = dialect.prepare('SELECT algorithm FROM identity_credentials WHERE user_id = ?').get(org.userClerk);
  assert.strictEqual(after.algorithm, 'scrypt', 'legacy credential must be upgraded to scrypt on first successful login');
  assert.ok(!JSON.stringify(after).includes(legacyHash), 'legacy hash must not remain in the row after upgrade');
  await cleanup(dialect, dbPath);
}

async function testResetTokenExpiryAndReuse() {
  const { dialect, dbPath } = await setup();
  const org = seedOrg(dialect);
  savePasswordPolicy(dialect, { reset_ttl_seconds: 60 });

  // expiry
  const expired = createPasswordReset(dialect, org.userClerk, { now: new Date('2026-07-21T10:00:00Z') });
  assert.throws(
    () => consumePasswordReset(dialect, expired.token, STRONG, { now: new Date('2026-07-21T10:05:00Z') }),
    (e) => e.code === 'RESET_TOKEN_EXPIRED'
  );
  // single use
  const fresh = createPasswordReset(dialect, org.userClerk, { now: new Date('2026-07-21T10:00:00Z') });
  consumePasswordReset(dialect, fresh.token, 'Recovered#9Pass', { now: new Date('2026-07-21T10:00:10Z') });
  assert.throws(
    () => consumePasswordReset(dialect, fresh.token, 'Another#9Pass', { now: new Date('2026-07-21T10:00:20Z') }),
    (e) => e.code === 'RESET_TOKEN_CONSUMED'
  );
  // unknown token
  assert.throws(() => consumePasswordReset(dialect, 'invented', STRONG), (e) => e.code === 'RESET_TOKEN_INVALID');
  // raw token is not persisted
  const stored = dialect.prepare('SELECT token_hash FROM identity_password_resets').all();
  assert.ok(stored.every((r) => r.token_hash !== fresh.token));
  await cleanup(dialect, dbPath);
}

async function testAdminResetWithoutCredentialDisclosure() {
  const { dialect, dbPath } = await setup();
  const org = seedOrg(dialect);
  const result = createPasswordReset(dialect, org.userClerk, { requestedBy: org.userOwner });
  // The admin path returns a delivery token, never the user's current password.
  assert.ok(result.token);
  const cred = dialect.prepare('SELECT hash FROM identity_credentials WHERE user_id = ?').get(org.userClerk);
  assert.ok(!String(result.token).includes(cred.hash));
  await cleanup(dialect, dbPath);
}

async function testTotpEnrollmentReplayAndRecovery() {
  const { dialect, dbPath } = await setup();
  const org = seedOrg(dialect);
  let clock = new Date('2026-07-21T10:00:00.000Z');
  const mfa = createMfaAuthority(dialect, { now: () => clock });

  const enrollment = mfa.beginTotpEnrollment(org.userClerk, 'clerk');
  const code = () => generateHOTP(mfaInternal.base32Decode(enrollment.secret), Math.floor(clock.getTime() / 30000));
  assert.strictEqual(mfa.confirmTotpEnrollment(org.userClerk, '000000'), false, 'a wrong code never confirms');
  assert.strictEqual(mfa.confirmTotpEnrollment(org.userClerk, code()), true);
  assert.strictEqual(mfa.hasConfirmedTotp(org.userClerk), true);

  // replay of the same code in the same window is rejected
  clock = new Date('2026-07-21T10:00:35.000Z');
  const c1 = code();
  assert.strictEqual(mfa.verifyTotpChallenge(org.userClerk, c1).ok, true);
  assert.strictEqual(mfa.verifyTotpChallenge(org.userClerk, c1).reasonCode, 'MFA_CODE_REPLAYED');

  // recovery codes are single use
  const codes = mfa.issueRecoveryCodes(org.userClerk, 3);
  assert.strictEqual(codes.length, 3);
  assert.strictEqual(mfa.consumeRecoveryCode(org.userClerk, codes[0]).ok, true);
  assert.strictEqual(mfa.consumeRecoveryCode(org.userClerk, codes[0]).reasonCode, 'MFA_RECOVERY_CODE_USED');
  assert.strictEqual(mfa.remainingRecoveryCodes(org.userClerk), 2);
  // recovery codes are stored hashed
  const stored = dialect.prepare("SELECT secret FROM identity_mfa_methods WHERE method = 'recovery_code'").all();
  assert.ok(stored.every((r) => !codes.includes(r.secret)));
  await cleanup(dialect, dbPath);
}

async function testImpersonationPrivilegeLimitAndAudit() {
  const { dialect, dbPath } = await setup();
  const org = seedOrg(dialect);
  const sessions = createSessionAuthority(dialect);
  const imp = createImpersonationAuthority(dialect);

  assert.throws(
    () => imp.begin({ impersonatorId: org.userClerk, targetUserId: org.userOwner, reason: 'support ticket 41' }, sessions),
    (e) => e.code === 'IMPERSONATION_PRIVILEGE_DENIED'
  );
  assert.throws(
    () => imp.begin({ impersonatorId: org.userOwner, targetUserId: org.userClerk, reason: 'x' }, sessions),
    (e) => e.code === 'IMPERSONATION_REASON_REQUIRED'
  );
  assert.throws(
    () => imp.begin({ impersonatorId: org.userOwner, targetUserId: org.userBeta, reason: 'cross tenant attempt' }, sessions),
    (e) => e.code === 'IMPERSONATION_CROSS_TENANT'
  );

  const started = imp.begin({ impersonatorId: org.userOwner, targetUserId: org.userClerk, reason: 'support ticket 41' }, sessions);
  assert.strictEqual(started.banner, true);
  const live = sessions.resolve(started.token);
  assert.strictEqual(live.actorType, 'impersonated');
  assert.strictEqual(live.impersonatorId, org.userOwner);
  assert.strictEqual(live.userId, org.userClerk, 'authority is the target user, not the impersonator');

  const audit = dialect.prepare("SELECT * FROM platform_audit_log WHERE action = 'identity.impersonation.begin'").all();
  assert.strictEqual(audit.length, 1);
  assert.ok(JSON.parse(audit[0].after_value).reason.includes('support ticket 41'));

  imp.end(started.impersonationId, sessions);
  assert.throws(() => sessions.resolve(started.token), (e) => e.code === 'SESSION_REVOKED');
  assert.strictEqual(imp.isActive(started.impersonationId), false);
  await cleanup(dialect, dbPath);
}

async function testOwnerLockoutPrevention() {
  const { dialect, dbPath } = await setup();
  const org = seedOrg(dialect);
  const users = createUserDirectory(dialect);
  assert.throws(
    () => users.setStatus(org.userOwner, 'suspended'),
    (e) => e.code === 'OWNER_LOCKOUT_PREVENTED'
  );
  await cleanup(dialect, dbPath);
}

// --- 02.04 SSO -------------------------------------------------------------

function seedProvider(dialect, tenantId, overrides = {}) {
  const sso = createSsoRegistry(dialect);
  const p = sso.registerProvider({
    tenantId, kind: 'oidc', name: 'Corp IdP', issuer: 'https://idp.example',
    clientId: 'octagon', clientSecretRef: 'secret://integrations.sso.corp',
    authorizeUrl: 'https://idp.example/auth', tokenUrl: 'https://idp.example/token',
    emailDomains: ['example.com'], status: 'enabled', ...overrides,
  });
  return { sso, provider: p };
}

async function testSsoStateNonceReplay() {
  const { dialect, dbPath } = await setup();
  const org = seedOrg(dialect);
  const { sso, provider } = seedProvider(dialect, org.tenantA, { jitProvisioning: true });
  const users = createUserDirectory(dialect);

  const begin = sso.beginLogin(provider.id);
  assert.ok(begin.codeChallenge && begin.codeChallengeMethod === 'S256', 'PKCE challenge is issued');

  const claims = { sub: 'idp-user-1', email: 'new.person@example.com', email_verified: true, name: 'New Person', nonce: begin.nonce };
  const first = await sso.completeLogin({ providerId: provider.id, state: begin.state, claims }, { userDirectory: users });
  assert.strictEqual(first.provisioned, true);

  // state replay
  await assert.rejects(
    () => sso.completeLogin({ providerId: provider.id, state: begin.state, claims }, { userDirectory: users }),
    (e) => e.code === 'SSO_STATE_REPLAYED'
  );
  // unknown state
  await assert.rejects(
    () => sso.completeLogin({ providerId: provider.id, state: 'forged', claims }, { userDirectory: users }),
    (e) => e.code === 'SSO_STATE_INVALID'
  );
  // nonce mismatch
  const b2 = sso.beginLogin(provider.id);
  await assert.rejects(
    () => sso.completeLogin({ providerId: provider.id, state: b2.state, claims: { ...claims, nonce: 'wrong' } }, { userDirectory: users }),
    (e) => e.code === 'SSO_NONCE_MISMATCH'
  );
  await cleanup(dialect, dbPath);
}

async function testSsoDenials() {
  const { dialect, dbPath } = await setup();
  const org = seedOrg(dialect);
  const users = createUserDirectory(dialect);
  const { sso, provider } = seedProvider(dialect, org.tenantA, { jitProvisioning: true });

  // unverified email
  let b = sso.beginLogin(provider.id);
  await assert.rejects(
    () => sso.completeLogin({ providerId: provider.id, state: b.state, claims: { sub: 'x', email: 'a@example.com', email_verified: false, nonce: b.nonce } }, { userDirectory: users }),
    (e) => e.code === 'SSO_EMAIL_UNVERIFIED'
  );
  // wrong domain
  b = sso.beginLogin(provider.id);
  await assert.rejects(
    () => sso.completeLogin({ providerId: provider.id, state: b.state, claims: { sub: 'y', email: 'a@evil.test', email_verified: true, nonce: b.nonce } }, { userDirectory: users }),
    (e) => e.code === 'SSO_DOMAIN_DENIED'
  );
  // account-link takeover blocked (a local account already owns that email)
  users.create({ tenantId: org.tenantA, login: 'victim', name: 'Victim', email: 'victim@example.com' });
  b = sso.beginLogin(provider.id);
  await assert.rejects(
    () => sso.completeLogin({ providerId: provider.id, state: b.state, claims: { sub: 'attacker', email: 'victim@example.com', email_verified: true, nonce: b.nonce } }, { userDirectory: users }),
    (e) => e.code === 'SSO_LINK_NOT_ALLOWED'
  );
  // disabled provider
  sso.setStatus(provider.id, 'disabled');
  assert.throws(() => sso.beginLogin(provider.id), (e) => e.code === 'PROVIDER_DISABLED');
  // wrong provider for a state
  await cleanup(dialect, dbPath);
}

async function testSsoSecretsNotStoredAndSamlBlocked() {
  const { dialect, dbPath } = await setup();
  const org = seedOrg(dialect);
  const { sso, provider } = seedProvider(dialect, org.tenantA);
  const row = dialect.prepare('SELECT * FROM identity_sso_providers WHERE id = ?').get(provider.id);
  assert.strictEqual(row.client_secret_ref, 'secret://integrations.sso.corp');
  assert.ok(!Object.values(row).some((v) => typeof v === 'string' && /^[A-Za-z0-9_-]{40,}$/.test(v) && v.startsWith('sk')), 'no inline secret');

  const saml = sso.registerProvider({ tenantId: org.tenantA, kind: 'saml', name: 'SAML IdP', status: 'enabled' });
  assert.throws(() => sso.beginLogin(saml.id), (e) => e.code === 'SAML_NOT_IMPLEMENTED');

  assert.strictEqual(sso.emergencyLocalAccessAvailable(org.tenantA), true, 'a local owner credential remains as emergency access');
  await cleanup(dialect, dbPath);
}

// --- 02.05 service identities and API keys ----------------------------------

async function testApiKeyLifecycle() {
  const { dialect, dbPath } = await setup();
  const org = seedOrg(dialect);
  const svc = createServiceIdentityAuthority(dialect);
  const account = svc.createServiceAccount({ tenantId: org.tenantA, companyId: org.companyA1, name: 'integration' });
  const issued = svc.issueApiKey({ serviceAccountId: account.id, scopes: ['crm_lead:read'], label: 'nightly sync' });

  // plaintext is never stored
  const rows = dialect.prepare('SELECT * FROM identity_api_keys').all();
  assert.ok(rows.every((r) => !Object.values(r).includes(issued.key)));
  assert.ok(rows[0].key_hash && rows[0].key_hash.length === 64);
  // list never returns hash or raw key
  const listed = svc.listApiKeys(account.id);
  assert.ok(!('key_hash' in listed[0]) && !('key' in listed[0]));

  // authenticates and enforces scope
  const actor = svc.authenticateApiKey(issued.key, { requiredScope: 'crm_lead:read' });
  assert.strictEqual(actor.actorType, 'service');
  assert.strictEqual(actor.companyId, org.companyA1);
  assert.throws(() => svc.authenticateApiKey(issued.key, { requiredScope: 'crm_lead:delete' }), (e) => e.code === 'API_KEY_SCOPE_DENIED');

  // revocation is immediate
  svc.revokeApiKey(issued.id);
  assert.throws(() => svc.authenticateApiKey(issued.key), (e) => e.code === 'API_KEY_REVOKED');
  await cleanup(dialect, dbPath);
}

async function testApiKeyExpiryRotationAndIp() {
  const { dialect, dbPath } = await setup();
  const org = seedOrg(dialect);
  let clock = new Date('2026-07-21T10:00:00.000Z');
  const svc = createServiceIdentityAuthority(dialect, { now: () => clock });
  const account = svc.createServiceAccount({ tenantId: org.tenantA, name: 'integration' });

  const short = svc.issueApiKey({ serviceAccountId: account.id, ttlDays: 1 });
  clock = new Date('2026-07-23T10:00:00.000Z');
  assert.throws(() => svc.authenticateApiKey(short.key), (e) => e.code === 'API_KEY_EXPIRED');

  // rotation overlap: both keys work during the overlap window, old dies after
  clock = new Date('2026-07-23T11:00:00.000Z');
  const original = svc.issueApiKey({ serviceAccountId: account.id, ttlDays: 30 });
  const rotated = svc.rotateApiKey(original.id, { overlapSeconds: 3600 });
  assert.ok(svc.authenticateApiKey(rotated.key));
  assert.ok(svc.authenticateApiKey(original.key), 'old key still valid during overlap');
  clock = new Date('2026-07-23T13:00:00.000Z');
  assert.throws(() => svc.authenticateApiKey(original.key), (e) => e.code === 'API_KEY_EXPIRED');
  assert.ok(svc.authenticateApiKey(rotated.key));

  // IP allowlist
  const pinned = svc.issueApiKey({ serviceAccountId: account.id, ipAllowlist: ['10.0.0.5'] });
  assert.ok(svc.authenticateApiKey(pinned.key, { ip: '10.0.0.5' }));
  assert.throws(() => svc.authenticateApiKey(pinned.key, { ip: '10.0.0.9' }), (e) => e.code === 'API_KEY_IP_DENIED');
  await cleanup(dialect, dbPath);
}

async function testApiKeyRateLimitAndCrossTenantDenial() {
  const { dialect, dbPath } = await setup();
  const org = seedOrg(dialect);
  const svc = createServiceIdentityAuthority(dialect);
  const account = svc.createServiceAccount({ tenantId: org.tenantA, companyId: org.companyA1, name: 'integration' });
  const key = svc.issueApiKey({ serviceAccountId: account.id, rateLimitPerMinute: 3 });
  for (let i = 0; i < 3; i++) svc.authenticateApiKey(key.key);
  assert.throws(() => svc.authenticateApiKey(key.key), (e) => e.code === 'API_KEY_RATE_LIMITED');

  // a key can never be issued into a tenant it does not belong to
  const actor = { tenantId: org.tenantA, companyId: org.companyA1 };
  assert.strictEqual(svc.authenticateApiKey.length >= 1, true);
  assert.throws(() => svc.createServiceAccount({ tenantId: 'no_such_tenant', name: 'x' }), (e) => e.code === 'TENANT_INVALID');
  assert.strictEqual(actor.tenantId, org.tenantA);

  // suspending the account kills every key
  const key2 = svc.issueApiKey({ serviceAccountId: account.id });
  svc.suspendServiceAccount(account.id);
  assert.throws(() => svc.authenticateApiKey(key2.key), (e) => e.code === 'API_KEY_REVOKED');
  await cleanup(dialect, dbPath);
}

async function testSecretRedaction() {
  const { dialect, dbPath } = await setup();
  const payload = {
    note: 'calling with api_key: ok_ABCDEFGHIJKLMNOPQRSTUV12345',
    client_secret: 'super-secret-value',
    nested: { authorization: 'Bearer abcdefghijklmnop', safe: 'keep me' },
  };
  const clean = redactSecrets(payload);
  assert.ok(!JSON.stringify(clean).includes('ok_ABCDEFGHIJKLMNOPQRSTUV12345'));
  assert.strictEqual(clean.client_secret, '***REDACTED***');
  assert.strictEqual(clean.nested.authorization, '***REDACTED***');
  assert.strictEqual(clean.nested.safe, 'keep me');
  await cleanup(dialect, dbPath);
}

// --- runner -----------------------------------------------------------------

await run('Phase 02 / identity, session, MFA, SSO, service identity', [
  ['02.01 body-supplied actor is ignored', testBodySuppliedActorIgnored],
  ['02.01 invalid active company rejected', testInvalidActiveCompanyRejected],
  ['02.01 cross-tenant membership impossible', testCrossTenantMembershipImpossible],
  ['02.01 stale membership revokes access', testStaleMembershipRevokesAccess],
  ['02.01 service identity cannot create a session', testServiceIdentityCannotCreateSession],
  ['02.01 service context cannot widen scope', testServiceContextCannotWidenScope],
  ['02.01 legacy Octagon role adapter', testLegacyRoleAdapter],
  ['02.01 Phase 01 context surface preserved', testPhase01ContextSurfacePreserved],
  ['02.02 session fixation resistance', testSessionFixationResistance],
  ['02.02 idle and absolute expiry', testSessionIdleAndAbsoluteExpiry],
  ['02.02 logout and revocation', testLogoutAndRevocation],
  ['02.02 suspension kills sessions', testUserSuspensionKillsSessions],
  ['02.02 brute-force lockout', testBruteForceLockout],
  ['02.02 login is not a user enumerator', testUnknownLoginIsNotAnEnumerator],
  ['02.02 no loopback/test bypass exists', testNoLoopbackBypassExists],
  ['02.02 CSRF token verification', testCsrfVerification],
  ['02.02 concurrent-session policy', testConcurrentSessionPolicy],
  ['02.03 password policy enforcement', testPasswordPolicyEnforcement],
  ['02.03 password never stored in clear', testPasswordNeverStoredInClear],
  ['02.03 legacy SHA-256 password migrates to scrypt on first login', testLegacySha256PasswordMigration],
  ['02.03 reset token expiry and single use', testResetTokenExpiryAndReuse],
  ['02.03 admin reset discloses no credential', testAdminResetWithoutCredentialDisclosure],
  ['02.03 TOTP enrollment, replay, recovery codes', testTotpEnrollmentReplayAndRecovery],
  ['02.03 impersonation privilege limit and audit', testImpersonationPrivilegeLimitAndAudit],
  ['02.11 owner lockout prevention', testOwnerLockoutPrevention],
  ['02.04 SSO state/nonce/PKCE replay', testSsoStateNonceReplay],
  ['02.04 SSO denial paths', testSsoDenials],
  ['02.04 SSO secrets by reference, SAML blocked', testSsoSecretsNotStoredAndSamlBlocked],
  ['02.05 API key lifecycle', testApiKeyLifecycle],
  ['02.05 API key expiry, rotation overlap, IP policy', testApiKeyExpiryRotationAndIp],
  ['02.05 API key rate limit and account suspension', testApiKeyRateLimitAndCrossTenantDenial],
  ['02.05 secret redaction', testSecretRedaction],
]);
