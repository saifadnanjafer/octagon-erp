# Identity and Session Report

## Implemented

- Canonical user, credential, session, login-attempt, MFA, SSO-state, service-account, API-key, and impersonation authorities are in `platform/identity/`.
- Migration `006_identity_authority.mjs` creates the identity and membership families; migration `011_service_identity_authorization.mjs` preserves actor-type authorization assignments.
- Passwords use scrypt hashes; reset/MFA tokens are single-use and stored hashed; session expiry, revocation, lockout, CSRF, concurrent-session limits, API-key rotation, rate limits, and SSO nonce/PKCE replay checks are fail-closed.
- `platform/identity/context/index.mjs` derives actor, tenant, company, branch, and service scope from trusted authority data and strips untrusted request fields.

## Evidence

Command: `node tests/phase02/identity.test.mjs`  
Result: **31/31 passed** (2026-07-21). The suite covers body-supplied actor rejection, membership and suspension, session fixation/expiry/revocation, lockout, CSRF, password/reset, TOTP/recovery, impersonation, SSO replay/denial, API-key lifecycle, and secret redaction.

## Cutover boundary

The canonical authority is proven on disposable SQLite databases. The current
legacy `server.js` login cookie/session map remains the live shell writer until
the runtime cutover is performed; this is an explicit unresolved Gate B/I item,
not counted as complete by this report.

