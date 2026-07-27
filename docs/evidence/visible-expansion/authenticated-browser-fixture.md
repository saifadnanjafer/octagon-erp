# Authenticated Browser Fixture — Wave 2A

## Why

Every prior Chromium run stopped at `401 Login session required`. No canonical
command had ever been executed from the browser. Production credentials must
never be used or requested, so the only correct path was a disposable fixture.

**This wave removed that blocker.** A real canonical write now executes through
the real UI, and a real permission denial is observed for a restricted role.

## What was built

| File | Purpose |
|---|---|
| `scripts/test-auth-fixture.mjs` | Seeds 8 disposable identities, roles and grants into an isolated database |
| `scripts/preview-authenticated-server.mjs` | Preview entry point that opts into the fixture |
| `.claude/launch.json` → `octagon-preview-auth` | Launch config for authenticated browser runs |
| `tests/phase04-finalization/test_auth_fixture.test.mjs` | 20 tests proving every guard and the seeding behaviour |

## Safety — three independent guards

All three must pass or the fixture throws `FixtureRefused`. There is **no force
flag and no bypass**, and a test asserts the source contains neither.

| # | Guard | Refusal code |
|---|---|---|
| 1 | `OCTAGON_TEST_FIXTURE` must be exactly `'1'` | `FIXTURE_FLAG_REQUIRED` |
| 2 | `NODE_ENV` must not be `production` (case-insensitive) | `FIXTURE_PRODUCTION_DENIED` |
| 3 | Target must not be `database.db` / `database.json` | `FIXTURE_OPERATIONAL_DENIED` |
| 3b | Target must not be **any** file in the repository root | `FIXTURE_REPO_ROOT_DENIED` |

Guard 3b defends against a future rename of `database.db` silently becoming
seedable. Guard 1 is proven to reject `'true'`, `'yes'`, `'on'`, `'0'` and `''`
— only the exact string `'1'` enables it.

The fixture **does not weaken authentication**: it uses the real
`setPassword`/`checkCredentials` path with the real policy, and a test proves a
wrong password is still rejected.

## The eight disposable roles

| Key | Login | Permissions |
|---|---|---|
| sysadmin | `test.sysadmin` | `platform:db:read`, `platform:db:write` (owner) |
| workshop | `test.workshop` | read + write |
| finance | `test.finance` | read + write |
| inventory | `test.inventory` | read + write |
| sales | `test.sales` | read + write |
| procurement | `test.procurement` | read + write |
| pos | `test.pos` | read + write |
| **viewer** | `test.viewer` | **read only** — exists so denial can be *proven*, not assumed |

All live in an isolated tenant `t_octagon_test` / company `c_octagon_test`.
Credentials exist only in the test source and in a manifest written to the OS
temp staging directory — never into committed docs.

## Real authenticated browser results

Server: `octagon-preview-auth` on `http://localhost:8080`, backed by a staged
**disposable copy**. The operational database was never opened.

### Authentication

```
POST /api/auth/login  {userId: test.sysadmin}  -> 200
  { authenticated: true, user: usr_test_sysadmin, tenantId: t_octagon_test }
POST /api/auth/context {companyId: c_octagon_test} -> 200
  { activeCompanyId: c_octagon_test, activeBranchId: b_octagon_test }
```

### Canonical write through the real UI — **the milestone**

Driven by dispatching a real `submit` event on the page's own create form, so
the whole chain executed: form → module handler → `CanonicalClient` →
`POST /api/v1/action/party:create` → ActionExecutor → atomic transaction →
response → UI refresh.

| Measurement | Value |
|---|---|
| Rows before | 0 |
| Rows after | **1** |
| Rendered row | `شركة الاختبار التجارية — supplier` |
| Record count label | `Records: 1` |
| Error state shown | none |

This is the first canonical command ever executed from the original Octagon
shell UI.

### Permission denial — restricted viewer

| Step | Result |
|---|---|
| Login as `test.viewer` | 200 |
| `GET /api/v1/commercial/parties` | **allowed**, 1 record (sees the admin's write) |
| `party:create` | **DENIED 403**, `isAuthorization: true`, server message `ليس لديك صلاحية تنفيذ هذا الإجراء` |

Two different roles, two different server-enforced outcomes, on the same page.
The denial comes from the server's grant evaluation, not from browser logic.

## Tests

| Suite | Command | Pass | Fail | Skip |
|---|---|---:|---:|---:|
| Fixture safety + behaviour | `node --test tests/phase04-finalization/test_auth_fixture.test.mjs` | 20 | 0 | 0 |

Proves: every guard independently; production denial; operational-path refusal;
no bypass exists; seeded users genuinely authenticate; wrong passwords still
rejected; viewer is read-only; grants and assignments persist; seeding is
idempotent; identities are tenant-isolated; the manifest never lands in docs.

Does not prove: that the fixture is unnecessary in CI, or anything about
production identity providers.

## Operational data

Unchanged — all four hashes byte-identical before and after the authenticated
run. The fixture wrote only to the temp-directory staged copy.
