# Checkpoint H — unresolved risks

**CRITICAL** blocks release · **HIGH** must be resolved before merge ·
**MEDIUM** should be resolved · **LOW** noted.

---

## CRITICAL

### C1 — The operational database is seventeen migrations behind, and unpopulated

Discovered by the Checkpoint H read-only gate. The operational database is at
migration tip `045_governed_master_data_and_inventory_actions` (45 applied)
against a repository tip of `062`. `platform_actions` holds 190 rows rather than
330, `platform_modules` 9 rather than 18, the `assets` table does not exist, and
**every canonical business table is empty**.

Everything proven across Checkpoints F, G and H was proven on disposable
databases at migration 062 with canonical data. **The operational database is a
different system.** The live workshop runs on the legacy JSON collection layer.

Consequences:

- Migration 062 cannot be applied on its own; applying it means applying
  046–061 first, which is the Phase 04 + Checkpoint C/D/E schema arriving on the
  live database for the first time.
- The canonical cutover cannot be activated there at all yet — there is nothing
  to cut over to.
- The warehouse duplicate gate must be **re-run after** that upgrade; today's
  clear result describes an empty table, not the workshop's real warehouse data.

This is not a defect in the work. It is the deployment step nobody has taken,
now measured instead of assumed. It is CRITICAL because it means "release
candidate verified on disposable fixtures" and "safe to deploy" are separated by
an unexecuted seventeen-migration upgrade plus a data migration.

**Owner decision required.** Checkpoint H did not attempt, prepare, or stage it.

---

## HIGH

### H1 — No end-to-end lifecycle browser proof *(carried from F and G)*

`scripts/release-candidate-browser-acceptance.mjs` was not built. None of the
thirteen domain lifecycles were executed in an authenticated Chromium session.
Numeric agreement across a full posted lifecycle remains unverified.

### H2 — Mid-lifecycle failure injection covers one path *(carried from G)*

All 22 named workflows have command-boundary proof. Only stock has genuine
mid-flight rollback proof. Twenty-one workflows have no proof of behaviour when
a fault occurs part-way through an otherwise valid posting.

### H3 — 14 of 18 concurrency scenarios unexercised *(carried from G)*

Four are proven with real separate OS processes. The other fourteen share the
same executor and idempotency ledger — an argument, not a proof.

### H4 — PostgreSQL runtime never executed *(carried from G, re-verified)*

Re-checked at Checkpoint H: no binaries, no `pg` module, no server on 5432, no
connection string. The adapter is implemented and unit-tested but has never
executed a statement against a live server. Reported honestly by
`GET /api/release/health` as `not_executed`, enforced by test.

### H5 — Legacy UI pages will break after cutover, not adapt

No compatibility adapter routes a legacy call through a canonical command. The
design refuses and names the replacement. So a legacy page writing a governed
collection will **fail** after cutover rather than silently keep working. That
is architecturally correct and operationally sharp: every such page must be
migrated to `POST /api/v1/action/:actionId` **before** the cutover, or it stops
working the moment it is activated. No inventory of those call sites exists.

---

## MEDIUM

### M1 — Release Health has no Administration UI page

`GET /api/release/health` returns the full 27-signal report and is proven
reachable, but nothing renders it in the original shell.

### M2 — Running the tests still dirties the repository *(carried from F and G)*

Phase 02/03 browser runners write into tracked evidence directories.

### M3 — Phase 02 isolation depends on invocation *(carried from G)*

`npm run test:phase02` passes. A default-concurrency run of the whole tree can
still starve the machine. The cross-process Chromium mutex was not implemented.

### M4 — A test module still ships enabled *(carried from F and G)*

`checkpoint_c_test_module` ships `status='enabled'`. Now at least **surfaced**:
Release Health reports `test_fixtures_in_release` as a warning rather than
hiding it. Still unresolved because disabling it requires editing a passing
Checkpoint C test.

### M5 — Client-side legacy write call sites not enumerated *(carried from G)*

Directly compounds H5: nobody knows which UI pages will break at cutover.

### M6 — Per-module UI state matrix and full permission matrix unverified

### M7 — Browser-authoritative calculation not audited

---

## LOW

### L1 — `test-artifacts/` and root backup JSON

72+ ignored directories; 24 pre-existing `database.backup.*.json` (~150 MB).
Untouched. Nothing removed merely for being old.

---

## Explicitly out of scope and unchanged

- **Opening inventory accounting date** — unresolved, not invented, reported as
  `blocked` by Release Health with a test preventing it reading otherwise.
- **Payroll, attendance, timesheet** — frozen, and now proven over real HTTP to
  be unaffected by the cutover.
- **`omni.jobOrders`** — the workshop execution chain, deliberately excluded.
- **VNext** — frozen; identical fingerprint across F, G and H.
- **Operational data** — four SHA-256 hashes identical across F, G and H.
- **`main`** — not merged, not attempted.
