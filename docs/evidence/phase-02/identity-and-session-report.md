# Identity and Session Report

## Implemented

- Canonical user, credential, session, login-attempt, MFA, SSO-state, service-account, API-key, and impersonation authorities are in `platform/identity/`.
- Migration `006_identity_authority.mjs` creates the identity and membership families; migration `011_service_identity_authorization.mjs` preserves actor-type authorization assignments.
- Passwords use scrypt hashes; reset/MFA tokens are single-use and stored hashed; session expiry, revocation, lockout, CSRF, concurrent-session limits, API-key rotation, rate limits, and SSO nonce/PKCE replay checks are fail-closed.
- `platform/identity/context/index.mjs` derives actor, tenant, company, branch, and service scope from trusted authority data and strips untrusted request fields.
- `platform/identity/sessions/index.mjs` authenticates logins; when the legacy shell omits a tenantId, the tenant is derived from the matched user record so the Arabic RTL login flow continues to work without client-side tenant assertion.

## Evidence

Command: `node tests/phase02/identity.test.mjs`
Result: **32/32 passed** (2026-07-21). The suite covers body-supplied actor rejection, membership and suspension, session fixation/expiry/revocation, lockout, CSRF, password/reset, TOTP/recovery, impersonation, SSO replay/denial, API-key lifecycle, and secret redaction.

Command: `node tests/phase02/runtime-integration.test.mjs`
Result: **3/3 passed** — live HTTP login/session/bootstrap through the real `server.js`.

## Cutover boundary

The verified server session cutover is live: `server.js` routes login, logout,
session, bootstrap, and protected route context through the platform authority.
The legacy `auth_sessions` table is migrated by 012 and the live session state is
in `identity_sessions`. The shell still has a compatibility identity facade for
navigation and audit display, so the broader one-authority closure remains
partial; see `runtime-authority-map.md`.

