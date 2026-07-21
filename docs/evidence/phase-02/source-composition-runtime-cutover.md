# Source Composition Ledger — Phase 02 Runtime Authority Cutover

**Packet:** `012_runtime_authority_cutover`  
**Branch:** `remediation/phase-02-final-closure`  
**Owner:** `platform.identity` / `platform.authorization` / `platform.kernel`  
**Goal:** Make the Phase 02 governance platform the sole runtime authority for identity, sessions, authorization, settings, workflows, approvals, files, and notifications inside the existing Octagon application (`server.js` + `app.js`), without creating a second application or VNext runtime.

---

## 1. Sources Adopted (with real paths)

| Source | Path | Usage |
|--------|------|-------|
| Phase 01 route-strangler / API adapter | `platform/api/index.mjs` | Canonical `/api/v1` envelope, but must be wrapped with session-derived `DecisionContext` (currently header-based) |
| Phase 02 identity authority | `platform/identity/sessions/index.mjs` | Replaces `authSessions` Map + `auth_sessions` table |
| Phase 02 user / membership directory | `platform/identity/users/index.mjs`, `platform/organizations/memberships/index.mjs` | Replaces `userListFromDb` / `enrichAuthUser` legacy user resolution |
| Phase 02 authorization evaluator | `platform/authorization/evaluator/index.mjs` | Replaces `acl.json` / `ACL_MATRIX` / `resolveAclRole` |
| Phase 02 context builder | `platform/identity/context/index.mjs` | Enforces server-derived actor, tenant, company, branch, roles |
| Phase 02 governance bootstrap | `platform/client/governance-bootstrap.mjs` | Drives the existing Octagon shell menu, page visibility, action buttons, field metadata |
| Phase 02 route coverage | `platform/authorization/route-coverage/index.mjs` | Every protected HTTP route must be registered or denied |
| Phase 02 migration runner | `database/migration-runner/index.mjs` | Server must apply migrations 001–012 on startup instead of hand-rolling DDL |
| Octagon legacy runtime | `server.js` lines 1–2789 | The shell is preserved; only the authority layer is replaced |
| Octagon legacy UI | `app.js`, `index.html` | The shell is preserved; it consumes the bootstrap payload |
| Legacy VNext DB schema | `database.db` tables: `collections`, `auth_sessions`, `x_acl_roles`, `x_acl_grants`, `x_records` | Migrated into canonical Phase 02 tables by migration 012 |

## 2. Authorities Retired

- `authSessions` in-memory Map (server.js:76)
- `auth_sessions` SQLite table (server.js initializeDatabase creates it directly)
- `acl.json` file + `ACL_MATRIX` (server.js:177–181)
- `ACL_SEED_USER_ROLE_OVERRIDES` (server.js:196–203)
- `resolveAclRole`, `aclGroupForCollection`, `aclCan`, `aclAccessRank` (server.js:205–249)
- `isLocalWriteTrusted`, `isLoopbackSocket`, `isDevMode` bypasses (server.js:1456–1483)
- `isLocalRequest` bypass for `POST /api/tts` and `POST /api/review-report` (server.js:1918–1958)
- Legacy `requireSession` / `requireRoleSession` / `requireAdminSession` (server.js:1501–1542)
- Client-side `x-user` / `x-company` header trust in `platform/api/index.mjs` (resolved in `resolveContext`)

## 3. Authorities Canonicalized

- `identity_sessions` — revocable, idle + absolute expiry, fixation-proof rotation
- `identity_credentials` — scrypt with one-time legacy-sha256 migration path
- `authorization_grants` + `authorization_roles` + `authorization_role_assignments`
- `authorization_decisions` audit log
- `organization_memberships` for company/branch scope
- `platform_settings` + `secret_values` for settings and secrets
- `platform_modules` for module/feature gates
- `platform_api` with session-derived `DecisionContext`

## 4. Runtime Entry Points to Modify

- `server.js` initialization: run migrations via `database/migration-runner`, create platform authorities, remove legacy DDL and auth
- `POST /api/auth/login` → `SessionAuthority.authenticate` + `createSession`
- `POST /api/auth/logout` → `SessionAuthority.revoke`
- `GET /api/auth/session` → `SessionAuthority.resolve` + `GovernanceBootstrap` preview
- `GET /api/auth/bootstrap` → `GovernanceBootstrap.build(ctx)`
- `POST /api/tts` and `POST /api/review-report` → require real session (no `isLocalRequest` bypass)
- All `requireSession`/`requireRoleSession`/`requireAdminSession` callers → `requireDecisionContext` + `evaluator.require`
- `platform/api/index.mjs` `resolveContext` → derive from session cookie, reject headers
- `app.js` → fetch `/api/auth/bootstrap` after login, use it for navigation/actions/fields, keep Arabic RTL

## 5. Testing Strategy

- Run all Phase 01 unit tests (`tests/unit/*.test.mjs`) — must remain 100% passing
- Run all Phase 02 unit tests (`tests/phase02/*.test.mjs`) — must remain 100% passing
- Run migration tests (`tests/migration/runner.test.mjs`) including down/up
- Add `tests/phase02/runtime-integration.test.mjs` for server route behavior
- Add `tests/phase02/browser-evidence.test.mjs` using Puppeteer against the real Octagon shell
- Add adversarial tests: request-body spoofing, localhost bypass, direct hidden API calls, revoked session, cross-tenant API, CSRF mismatch

## 6. Risk Register

- **R1 — Legacy password hash format:** Existing passwords use SHA256(password+salt). Migration 012 will create `legacy_sha256` credential rows; the platform password module will verify them and rehash to scrypt on first successful login. No plaintext is stored.
- **R2 — x_records schema mismatch:** Existing `x_records` lacks `company_id` and `version`. Migration 012 will add the columns, backfill `company_id` from `data.company_id` or `data.company`, and set `version=1`. This is best-effort and documented; a future data-quality job may refine it.
- **R3 — Production database:** No runtime change is tested against `database.db` directly; tests use temporary databases and a dedicated `OCTAGON_SQLITE_DB_FILE` test copy.
- **R4 — ACL fallback:** The legacy `acl.json` fallback (fail-open when missing) is removed; missing grants now deny by default.
- **R5 — Payroll/Attendance frozen:** No changes to payroll/attendance logic, tables, or tests.
