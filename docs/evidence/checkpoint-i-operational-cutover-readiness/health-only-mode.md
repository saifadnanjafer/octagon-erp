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

## Not done

- **Browser proof of the blocked screen (§6 case 10) was not performed.** The
  operational database is at tip 062 — current — so health-only does not
  activate against it, and the containment rules forbid starting the operational
  server. Proving the rendered screen needs a disposable behind-tip clone served
  on an isolated port; that is outstanding and is not claimed.
- Release Health UI integration of these signals (§23) remains pending.

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
