# Checkpoint H — Release Health

Closes Checkpoint G blocker 6 for **server diagnostics**. The Administration UI
page was not added — see "What was not built".

| | |
|---|---|
| Module | `platform/operations/release-health.mjs` |
| Endpoint | `GET /api/release/health` (permission-gated on `platform:db:read`) |
| Tests | `tests/checkpoint-h/release_health.test.mjs` — **12/12** |
| HTTP reachability | proven in the HTTP suite (200 with a full signal set; 401/403 unauthenticated) |

## The rule the module enforces

**No fabricated green.** A signal that cannot be computed reports `unknown`;
work nobody has done reports `not_executed`. Both are deliberately distinct from
`healthy`, because a dashboard that shows green for an unrun check converts an
open question into false confidence — worse than no dashboard.

Status vocabulary: `healthy` · `warning` · `blocked` · `unknown` ·
`not_executed`.

## The 27 signals

| Signal | Source | Value on a cutover-active fixture |
|---|---|---|
| `application_version` | `package.json` | unknown (no version field declared) |
| `commit_sha` | `.git/HEAD` + refs / packed-refs, read directly — no shell out | real 40-hex SHA |
| `branch` | same | `review/octagon-unified-release-candidate` |
| `migration_tip` | `schema_migrations` / `platform_migrations` | `062_warehouse_code_uniqueness` |
| `applied_migration_count` | same | 62 — **blocked** if 0 |
| `database_dialect` | dialect | `sqlite` |
| `postgres_adapter` | static | **healthy** — implemented and unit-tested |
| `postgres_runtime` | static | **not_executed** — never green |
| `canonical_cutover_mode` | cutover controller | `active` / `not_activated` (**warning**) |
| `domain_lock_state` | cutover controller | `14/14` enforced |
| `authority_conflicts` | cutover controller | 0 |
| `writer_conflicts` | retirement locks | 0 |
| `cutover_safety_guards` | controller safety report | `disposable` / `production_protected` |
| `production_cutover_approval` | `canonical_cutover_approvals` | 0 → **blocked** (fail-closed, expected) |
| `enabled_modules` | `platform_modules` | `18/18` |
| `licensed_modules` | `platform_module_licenses` | count |
| `unhealthy_modules` | `platform_modules` | 0 |
| `test_fixtures_in_release` | `platform_modules` | 1 → **warning** |
| `audit_health` | `platform_actions` | `330 actions, 0 without required audit` |
| `outbox_backlog` | `platform_outbox` | undelivered count |
| `failed_jobs` | `platform_outbox` status `dead` | 0 |
| `session_health` | `platform_sessions` | count |
| `configuration_warnings` | `platform_settings` vs `settings_values` | count |
| `backup_restore_last_result` | record of Checkpoint G | `disposable 10/10` |
| `warehouse_duplicate_gate` | record of Checkpoint H | `clear` |
| `opening_inventory_gate` | owner-unresolved | **blocked** |
| `vnext_freeze_attestation` | recorded fingerprint | `frozen` |

Rollup: `blocked` if any signal is blocked. On a fresh install the rollup is
**blocked** — correctly, because the opening-inventory gate is unresolved.

## Most assertions are negative

The suite is built to catch the report lying, not to watch it render:

- `postgres_runtime` must **never** be healthy, and must not inherit green from
  `postgres_adapter` — asserted to be separate signals with different statuses.
- `opening_inventory_gate` stays `blocked`.
- `production_cutover_approval` reports `blocked` while no approval exists.
- An un-activated cutover reports `warning`, not healthy, and says *why*
  ("legacy writers remain live").
- An unreadable database reports `unknown` and never rolls up to healthy.
- The shipped `checkpoint_c_test_module` is **surfaced** as a warning, not
  hidden.
- The rollup is `blocked` whenever any signal is blocked.

And one positive: after activating cutover on the fixture, the same signals flip
to healthy and `domain_lock_state` reaches `14/14` — the report tracks reality
rather than reporting a constant.

## Two defects in my own module, caught by these tests

1. I expected `domain_lock_state` to read `0/14` before cutover. It reads
   `1/14`: **FINANCE is enforced unconditionally since Phase 03**. The test
   expectation was wrong, not the module.
2. `applied_migration_count` reported **healthy** against an unmigrated
   database, because the ledger table is created on open, so the count is a
   known `0` rather than an error. A database with zero migrations applied is
   not healthy — the module now reports it **blocked**.

## What was not built

The Administration **UI page** was not added. `GET /api/release/health` returns
the complete report and is the substantive, server-derived part; rendering it in
the original shell was not done and is not claimed. Recorded in
[unresolved-risks.md](unresolved-risks.md).
