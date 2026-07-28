# Checkpoint G — disposable cutover rehearsal

All of this ran on disposable databases under `os.tmpdir()`. The controller's
path guard refuses the operational store by construction.

## Sequence executed

| # | Step | Result |
|---|---|---|
| 1 | Fresh disposable database | created under `os.tmpdir()/octagon-ckg-cutover-*` |
| 2 | Apply migrations 001–062 | all applied, including new 061 and 062 |
| 3 | Baseline status | `cutoverFlag=false`; all 13 domains `enforced=false`; FINANCE `enforced=true` |
| 4 | Dry run | 13 domains `wouldActivate`, **0 blocked**; flag still false afterwards |
| 5 | Per-domain validation | every domain resolves to a registered, enabled canonical target with ≥1 action; **0 conflicts** |
| 6 | `activateAll()` | 13 domains activated, **0 blocked**; flag enabled |
| 7 | Lock registry verified | see [authority-lock-register.md](authority-lock-register.md) |
| 8 | Server-consulted guard | `createLegacyWriterRetirementGuard(db).enforced(d)` → **true for all 13** |
| 9 | Governed collections | all 28 tested legacy collections resolve to an enforced authority |
| 10 | Frozen zone | 9 frozen paths remain claimed by **no** authority |
| 11 | Re-activation | idempotent — lock row count unchanged |
| 12 | Reopen database handle | flag and all 13 locks persist |
| 13 | Re-run migrations | `executed: []`; all 13 still enforced |
| 14 | Rollback one domain | FLEET released; **the other 12 untouched**; then re-activated |
| 15 | Attempt audit | `ACTIVATED`, `REFUSED` and `ROLLED_BACK` all present, each with an actor, all `mode='disposable'` |
| 16 | Production approval | `canonical_cutover_approvals` empty — production stays fail-closed |

## Persistence — the part that matters for a release

Cutover state survives a reopened handle (step 12) **and** a migration rerun
(step 13). A cutover that evaporated on restart would be worse than no cutover
at all, because operators would believe the back door was shut.

It also survives **backup and restore**: `canonical cutover locks survive the
round trip` in the backup suite asserts all 13 domains are still enforced in a
database restored into a different path. Restoring a backup does not reopen a
legacy back door.

## What the rehearsal does NOT prove

Steps 8–9 are **decision-layer** proof. `server.js` decides whether to refuse a
legacy write with:

```js
canonicalAuthorityEnforced(authority)
  = authority.domain === 'FINANCE'
    || legacyWriterRetirement.enforced(authority.domain) === true
```

where `legacyWriterRetirement` is `createLegacyWriterRetirementGuard(db)`. The
tests call that same constructor against the same database, so a `true` here is
the same decision the server makes.

**No HTTP round trip was executed.** Nobody started a disposable server with
cutover active and issued `POST /api/collection` to observe a real 403. That
step — mission section 8, items 10–11 — is **not done**, and is recorded in
[unresolved-risks.md](unresolved-risks.md). The decision function is proven; the
transport wiring around it is inferred from source reading, not observed.
