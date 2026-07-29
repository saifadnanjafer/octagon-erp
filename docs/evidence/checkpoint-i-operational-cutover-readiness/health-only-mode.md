# Health-Only Startup Mode (I1D-5)

**Status: IMPLEMENTED AND PROVEN (browser proof outstanding)**
**Date:** 2026-07-30
**Owner decision:** restricted diagnostic runtime, chosen over the hard process stop shipped in Continuation 4.

## Behaviour change

| Situation | Continuation 4 | Now |
|---|---|---|
| Operational DB **at** repository tip | starts normally, zero writes | unchanged |
| Operational DB **behind** tip | **process refuses to start** | **health-only mode** |
| Unknown database identity | refuses | refuses (unchanged) |
| Disposable / staged / test | auto-migrates | unchanged |

The safety property is identical — **zero migrations run and the database is
untouched**. What changed is that the administrator can now authenticate and read
migration readiness instead of facing a dead process.

`refuse` is retained for `unknown` identities: a database we cannot classify must
not reach even a diagnostic runtime bound to it.

## Route allowlist — default deny

`platform/operations/health-only-mode.mjs`

Allowed while health-only is active:

| Route | Why it must exist |
|---|---|
| `GET /api/auth/session` | render the correct screen state |
| `POST /api/auth/login` | the administrator must be able to authenticate |
| `POST /api/auth/logout` | end the session |
| `GET /api/release/health` | **admin only** — the payload this mode exists to expose |
| `GET /api/migration/readiness` | **admin only** — tip, pending list, authorization state |
| `GET /api/system/mode` | unauthenticated availability probe (non-sensitive) |
| `GET` static: `/`, `/index.html`, `/health-only.html`, `/style.css`, `/ui-contrast-fix.css`, `/themes.css`, `/manifest.json`, `/favicon.ico`, `/assets/health-only/*` | render login and the blocked screen |

**Everything else is denied** with HTTP 503 and code `SYSTEM_HEALTH_ONLY_MODE`.
There is no fall-through: an unmatched path denies rather than passes.

Denials verified for business reads, business mutations, the generic legacy
writers (`/api/db`, `/api/collection/*`, `/api/record`), canonical action
execution, cutover actions, and a correct path with the wrong method.

### The gate runs before any domain handler

Wired in `server.js` immediately after URL parsing and **before**
`jarvisSecurity.handle`, the scheduler, the sequence handler, and every route
below them. A test asserts this ordering by index, so the gate cannot be
reordered behind a domain handler unnoticed.

## Information disclosure

| Caller | Receives |
|---|---|
| Anonymous | `{ ok:false, code, mode, releaseHealthRoute }` — nothing more |
| Restricted user | same as anonymous; no migration IDs, no tips |
| Owner / system-admin | full diagnostics: current tip, target tip, pending count and IDs, database class, restart requirement |

Tests assert the anonymous and restricted payloads do not contain migration IDs,
the database class, tips, or `database.db`, and that no diagnostic payload
contains `password`, `hash`, `salt`, `token`, `cookie`, or `secret`.

Authentication uses the canonical session authority (`resolveContext`). There is
no test-only auth path and no alternate default credential. **The existing
verified administrator credential was not changed and was not needed here.**

## Restart requirement

The module exposes no runtime deactivator. A test enumerates the module's exports
and fails if anything matching `deactivate|clear|disable|exit` appears (excluding
the explicit `__resetHealthOnlyModeForTests` helper). Leaving the blocked state
requires a fresh process, so a half-migrated runtime can never quietly become a
normal one.

## Blocked-state screen

`health-only.html` — served with **HTTP 503** at `/` and `/index.html` while the
mode is active, so the normal app shell and its module navigation never render.

Shows: Octagon branding, Arabic RTL with English LTR throughout, current
migration tip, repository tip, pending count, automatic-migration disabled,
authorization required, cutover inactive, checksum baseline gate,
opening-inventory date gate, restart requirement, plus login, re-check, Release
Health and sign-out actions.

Does not show: database path, credentials, hashes, tokens, cookies, stack traces,
or SQL. It is responsive down to 560px and follows the OS light/dark preference.

## Tests

`tests/migration/health-only-mode.test.mjs` — 12 cases:

```
PASS: inactiveByDefaultAllowsEverything
PASS: allowlistedRoutes
PASS: businessRoutesDeniedDefaultDeny (13 routes)
PASS: ownerCannotMutateInHealthOnlyMode
PASS: anonymousLearnsNothingSensitive
PASS: restrictedUserTreatedAsNonAdmin
PASS: adminReceivesDiagnostics
PASS: restartRequiredToLeaveMode
PASS: startupPolicyYieldsHealthOnlyForOperationalBehind (5 pending, 0 applied, unchanged)
PASS: operationalAtTipStaysNormal
PASS: unknownIdentityStillRefusesRatherThanHealthOnly
PASS: serverWiresGateBeforeDomainHandlers
```

### Suite

```
$ npm run test:migration
✔ health-only-mode.test.mjs        (8,427ms)
✔ historical_immutability.test.mjs   (355ms)
✔ rollback-remediation.test.mjs   (17,028ms)
✔ runner.test.mjs                 (17,835ms)
✔ startup-policy.test.mjs          (8,544ms)
ℹ tests 5   ℹ pass 5   ℹ fail 0

$ node --check server.js      → OK
$ node scripts/precommit.js   → Octagon precommit passed
```

### Startup-policy tests updated, not weakened

Four assertions in `startup-policy.test.mjs` expected `mode === 'refuse'` for a
behind-tip operational database. They now expect `health_only`. Every safety
assertion is retained and one was added:

- `autoMigrate === false` — unchanged
- `migrationsApplied` empty — unchanged
- database byte-identical before/after — unchanged
- migration ledger unchanged — unchanged
- `restartRequiredAfterResolution === true` — **new**

The incident-reproduction case still runs the real 62-migration chain 17
migrations behind and asserts zero applied with the file unchanged.

## Browser proof — COMPLETED 2026-07-30

The gap flagged in the previous revision is now closed.

### Isolated fixture

A disposable clone was rolled back 6 migrations (tip `056_quality_management_and_subcontracting`,
6 behind repository tip `062_warehouse_code_uniqueness`), had its
`cutover_staged_fixture` marker removed so it would classify as operational, and
was renamed `database.db` inside `temp/health-only-proof/`.

`scripts/health-only-proof-server.mjs` sets the database paths **itself** rather
than via `launch.json`, and refuses to run if the target resolves to the
operational database. This matters: if an environment field were silently
ignored, the server would have attached to the live database on another port —
the dual-server hazard. The launcher logged its actual targets, which were
verified before any request was made.

### Server boot — the policy fired

```
sqlite : .../temp/health-only-proof/database.db
port   : 8099
Migrations pending (6) on a production database; not applied automatically.
Octagon is starting in HEALTH-ONLY MODE: 6 pending migration(s).
Business routes are closed. Release Health and migration readiness remain
available to the system administrator.
```

Operational `database.db` verified byte-identical immediately afterwards.

### HTTP results

| Caller | Route | Status | Code |
|---|---|---|---|
| anonymous | `GET /api/system/mode` | 200 | availability only, no diagnostics |
| anonymous | `GET /api/release/health` | **403** | `HEALTH_ONLY_ADMIN_REQUIRED` |
| anonymous | `GET /api/migration/readiness` | **403** | `HEALTH_ONLY_ADMIN_REQUIRED` |
| anonymous | `POST /api/db` | **503** | `SYSTEM_HEALTH_ONLY_MODE` |
| anonymous | `GET /` | **503** | blocked screen, 7,008 bytes |
| **admin** | `POST /api/auth/login` | **200** | `isOwner: true` |
| **admin** | `GET /api/migration/readiness` | **200** | full diagnostics |
| **admin** | `GET /api/release/health` | **200** | permitted |
| **admin** | `POST /api/db` | **503** | `SYSTEM_HEALTH_ONLY_MODE` — authority does not unlock business routes |
| **admin** | `GET /api/inventory/items` | **503** | `SYSTEM_HEALTH_ONLY_MODE` |

Admin readiness payload: mode `health_only`, current tip `056_…`, repository tip
`062_…`, pending 6 with all six IDs, `automaticStartupMigration: disabled`,
`operationalMigrationAuthorization: required`, `restartRequiredAfterResolution: true`.
Leak check across the payload for `password|hash|salt|token|cookie|secret`: **clean**.

### Rendered screen

Blocked screen renders with the Octagon brand, the Arabic status heading with its
English counterpart, all 10 diagnostic rows, and the login / re-check / Release
Health / sign-out actions. **No module navigation is present** — the normal app
shell never loads.

Mobile viewport: 10 rows intact, **no horizontal overflow**. In-browser
`fetch('/inventory.html')` → **503**, `fetch('/api/inventory/items')` → **503**
with `SYSTEM_HEALTH_ONLY_MODE`.

Screenshots captured in-session (desktop and mobile, authenticated diagnostic
state). No credential value appears in any screenshot — the password field is
masked and the diagnostics carry no secret material.

### Two defects found by this proof

Both were real, and neither was visible to the unit tests:

1. **Admin was denied its own diagnostics.** `resolveHealthOnlyIdentity()` in
   `server.js` read `user.is_owner`, but `UserDirectory.get()` returns camelCase
   `isOwner` as a boolean. The raw column name yielded `undefined`, so every
   administrator was treated as non-admin and received 403 on Release Health and
   readiness. Fixed; re-verified end to end.

2. **RTL corrupted migration IDs.** Migration IDs begin with digits
   (`056_quality…`). Inside the RTL document the bidi algorithm moved the leading
   number to the visual end, rendering `quality_management_and_subcontracting_056`
   — a wrong version number on a maintenance screen whose purpose is reporting the
   version. Fixed with `dir="ltr"` plus `unicode-bidi: isolate`; both tips now
   render verbatim.

The first defect is the reason this proof was worth doing: the unit tests passed
against the module contract while the server wiring silently denied the only user
the mode exists to serve.

### Disposable fixture credential

The staged clone redacts credentials, so `system_admin` had none in the fixture
and login initially returned 401 — correct snapshot behaviour, not a product
bug. A **disposable** fixture-only credential was seeded through the same
canonical reset script. **The owner's operational credential was neither used in
the fixture nor changed.**

## Still not done

- Release Health UI integration of these signals into Administration (§23).
- Tablet viewport and an explicit restricted-user browser case (both covered at
  the unit level, not in-browser).

## Operational data

The operational server was **not started**. All work used disposable databases
under the OS temp directory. Verified unchanged against the corrected
post-incident baseline:

```
database.db      75cfc408ab7e224ea03294dfb6757afc326dc0c74cce16e099ffddd193524e8b
database.db-wal  63ea57446e283a53a17bccc52a04dc33570120208b65c09f9c05ea0f52173b21
database.db-shm  38619b106aab11d7e23fd17466714fdee55e9b76ac76536fdd71c151d052d743
database.json    2e4d7d91b15b053d276cf1b5ac2b73524be3bd73da096e5ba925724b61c700a1
```

Tip remains 062. No rollback. No cutover activation. No credential change.
Secret scan: 0 matches in tracked content.
