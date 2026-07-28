# Checkpoint F — unresolved risks

Severity: **CRITICAL** blocks release · **HIGH** must be resolved before merge ·
**MEDIUM** should be resolved · **LOW** noted.

---

## CRITICAL

### C1 — Legacy writers remain live for 12 of 13 business domains

On a fresh install `phase04.canonical_cutover = 0` and
`authority_retirement_locks` is empty, so only FINANCE refuses legacy writes. A
caller holding `platform:db:write` can still write `customers`, `suppliers`,
`materials`, `quants`, `stock_moves`, `salesOrders`, `purchaseOrders`,
`posOrders` and `tasks` through `POST /api/collection` or `POST /api/record`,
bypassing the ActionExecutor, its audit trail and its outbox.

The release requirement *"no competing writer for delivered canonical facts"* is
**not met**.

**Not fixable by this checkpoint.** Enabling the cutover is an owner decision
with immediate production consequences for the running workshop, and the design
deliberately gates it on disposable migration, parity and browser evidence.

**Resolution:** owner runs the cutover per domain after parity evidence, then
`enforced()` returns true and the legacy routes fail closed. The machinery is
in place and now covers all 13 domains.

---

## HIGH

### H1 — No end-to-end lifecycle browser proof

None of the 13 domain lifecycles (sections 7A–7M) were executed in an
authenticated Chromium session. No screenshots, traces, command ids or
correlation ids exist for them. The inherited "8/8 Chromium" claim is NOT
PROVEN and the D/E runner does not exist.

Consequence: numeric cross-domain agreement after real posting — inventory
valuation vs the Finance stock-accounting link, project actual cost vs its
source-linked facts, cost-per-kilometre vs canonical maintenance facts — is
unverified. Structural connection is proved; arithmetic agreement is not.

### H2 — Backup and restore not exercised

The disposable backup/restore cycle was not performed. Manifest and hash
validation, restore into a second location, post-restore integrity comparison,
and confirmation that sessions/secrets are not copied insecurely all remain
unproven.

### H3 — Multi-process concurrency unproven

All concurrency evidence is single-process against a synchronous SQLite driver.
The 17 named concurrency cases were not exercised under genuine multi-process
contention. This deployment has a recorded dual-server WAL incident and relies
on `operation_locks` for cross-tab races; those locks were not load-tested.

### H4 — PostgreSQL is unimplemented, not merely unavailable

`database/dialects/postgres-dialect.mjs` is a fail-closed stub whose every
method throws. 297 `STRICT` declarations plus `AUTOINCREMENT`,
`INSERT OR REPLACE`, `PRAGMA table_info` and `sqlite_master` are SQLite-only.
The claim of PostgreSQL-compatible SQL design is not supportable today.

### H5 — Failure injection covers 3 of 20 named points

Input-schema, precondition and unknown-action rejection paths were proved
atomic. The 17 remaining named lifecycle injection points (delivery, three-way
match, POS payment, production release, material issue, quality hold/release,
depreciation request, maintenance parts issue, fleet fuel posting, and the rest)
were not individually exercised. They share the executor transaction boundary,
but shared code is an argument, not a proof.

---

## MEDIUM

### M1 — A test module ships enabled in every production install

Migration `050_control_plane_module_management.mjs` inserts
`checkpoint_c_test_module` with `status='enabled'`, a `control:test:ping`
action, and a view routed at `checkpoint_c_test` in the `administration_preview`
menu.

Gated behind `control:admin`, so not a privilege escalation — but a test fixture
in the shipped module list, admin menu and licensing surface.

**Not remediated here.** `tests/checkpoint-c/control_plane_administration.test.mjs`
asserts `control:test:ping` succeeds before it enables anything, so the module
must be enabled by default for that suite to pass. Disabling it requires editing
a currently-passing test, which needs owner review rather than a unilateral
change during a verification checkpoint.

**Recommended fix:** forward migration 061 setting `status='disabled'`, plus an
explicit enable step in the Checkpoint C test arrange block.

### M2 — Phase 02 browser test fails only under the glob run

`tests/phase02/browser-live-evidence.test.mjs` passes in isolation (1/1, exit 0)
and fails under `node --test "tests/phase02/*.test.mjs"` (10/11, exit 1). This
is suite interference — shared port or resource contention — not an application
defect, but it makes the Phase 02 gate unreliable and masks real regressions.

### M3 — Running the tests dirties the repository

Phase 02 and Phase 03 browser runners write screenshots and timestamped JSON
into tracked evidence directories, so every regression run produces churn that
leaks into unrelated commits. This is the mechanism behind the Phase 03
artefacts observed in the Checkpoint D/E commit, and Checkpoint F reproduced it
(4→12 modified, 9→29 untracked). See
[artifact-hygiene.md](artifact-hygiene.md).

### M4 — Release-health view not built

Required signals — running version, commit SHA, unhealthy modules, missing
dependencies and configuration, failed jobs, outbox backlog, session health —
are not wired to any view. Authority-conflict and legacy-writer-conflict signals
are now *computable* for all 13 domains but are not surfaced.

### M5 — Per-module UI state matrix unverified

Permission-denied, server-error, empty, loading and post-command-refresh states
were not verified per module, nor was the tablet breakpoint.

### M6 — Permission matrix partially covered

Branch-level isolation for the D/E domains, expired-session denial as distinct
from revoked-session, and individual denial paths for the manufacturing
operator, quality, asset, maintenance and fleet roles were not exercised.

### M7 — Down-migration and rollback execution unverified

`rollbackPolicy` is declared per migration, but no `down` run was executed and
no mid-migration failure rollback was injected.

### M8 — Browser-authoritative calculation not audited

The requirement that no browser-calculated balance is authoritative was not
systematically verified against `app.js` and the module scripts.

---

## LOW

### L1 — Repository carries ~150 MB of root-level backup JSON

24 `database.backup.*.json` files plus several `browser-*.log` and `workflow*.log`
files sit in the repository root. Not created or modified here, and deliberately
not deleted — nothing is removed merely for being old, least of all backups.

### L2 — Inherited D/E test register is stale

`docs/evidence/checkpoint-d-e/test-suite-register.md` reports 50 tests (actual
56) and describes five existing, passing suites as "not written". Left in place
as the historical record; corrected in
[test-suite-register.md](test-suite-register.md).

---

## Explicitly out of scope and unchanged

- **Opening inventory accounting date** — remains unresolved. Not invented, not
  defaulted. The opening cutover and production activation gate remain
  fail-closed.
- **Payroll, attendance, timesheet** — frozen. Untouched, and now protected by
  an assertion that no canonical authority may claim those paths.
- **VNext** — frozen. HEAD and dirty fingerprint identical at entry and exit.
