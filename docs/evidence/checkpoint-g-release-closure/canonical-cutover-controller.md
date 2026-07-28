# Checkpoint G — canonical cutover controller

`platform/cutover/canonical-cutover-controller.mjs`
Migration `061_canonical_cutover_controller`
Test `tests/checkpoint-g/canonical_cutover_controller.test.mjs` — **17/17 pass**

## Why it exists

Checkpoint F proved canonical authority was registered for every domain but
enforced for exactly one. Turning enforcement on was impossible to do safely
because there was no controller: no readiness assessment, no dry run, no
conflict report, no attempt record, no rollback, no approval fact. The only
lever was hand-editing a feature flag and inserting lock rows — precisely the
kind of change nobody should make by hand against a live workshop.

The controller does not decide to cut over. It makes the decision reviewable,
rehearsable and reversible.

## Surface

| Function | Purpose |
|---|---|
| `status()` | per-domain lock, enforcement, conflicts, safety-guard state |
| `dryRun()` | what would activate, what is blocked and why — changes nothing |
| `assessDomain()` / `validateDomain()` | eligibility + conflict list for one domain |
| `activateDomain()` | guarded activation of one domain |
| `activateAll()` | guarded activation of every eligible domain |
| `rollbackAttempt()` | guarded release of one domain's lock |
| `attempts()` | audit trail of every attempt, including refusals |
| `safety()` | the three guards, individually reported |

## The three safety guards — no bypass

Activation mutates enforcement for a whole business domain. On the operational
database that would immediately break every legacy UI write the running
workshop depends on. So activation requires **all three**:

| Guard | Requirement |
|---|---|
| `disposable_fixture_flag` | `OCTAGON_DISPOSABLE_FIXTURE=1` |
| `non_production_runtime` | `OCTAGON_RUNTIME_MODE` must not be `production` |
| `disposable_database_path` | path must be provably disposable |

The path guard refuses `database.db`, `database.json`, `database.db-wal` and
`database.db-shm` **outright** by basename, accepts paths under `os.tmpdir()`
or matching the disposable naming convention, and — critically — treats
anything it cannot prove disposable as operational (`NOT_PROVABLY_DISPOSABLE`).

There is no force flag, no bypass argument, and no silent fallback. Asserted:

- `the operational database path is refused outright`
- `a path that cannot be proven disposable fails closed`
- `each safety guard independently blocks activation`
- `activation is refused when the guards fail, and the refusal is audited`

A refused activation writes a `REFUSED` row to `canonical_cutover_attempts` and
leaves the domain un-enforced — refusals are auditable evidence, not silent
no-ops.

## Eligibility and conflict detection

A domain is eligible only when its canonical target module is registered,
`enabled`, and registers at least one action. Conflicts reported:
`CANONICAL_TARGET_MISSING`, `CANONICAL_TARGET_NOT_ENABLED`,
`NO_CANONICAL_ACTIONS`, `LOCK_TARGET_MISMATCH`, `UNKNOWN_DOMAIN`.

Locking a domain onto a module that does not exist would fail every legacy
write with no canonical replacement available — the worst possible outcome — so
this check runs before any lock is written.

## Production activation remains fail-closed

`canonical_cutover_approvals` is created **empty** by migration 061. An empty
approvals table is what keeps production activation fail-closed. Asserted by
`production activation remains fail-closed — no approval fact exists`.

**This checkpoint did not activate cutover on any production or operational
database, and the path guard makes doing so impossible without editing the
guard itself.**
