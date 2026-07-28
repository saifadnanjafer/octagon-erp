# Checkpoint G — unresolved risks

**CRITICAL** blocks release · **HIGH** must be resolved before merge ·
**MEDIUM** should be resolved · **LOW** noted.

---

## HIGH

### H1 — No end-to-end lifecycle browser proof *(carried from Checkpoint F)*

`scripts/release-candidate-browser-acceptance.mjs` was not built. None of the 13
domain lifecycles (mission sections 10–22) were executed in an authenticated
Chromium session. No screenshots, traces, correlation IDs or command IDs exist
for them.

Consequence: **numeric agreement across a full posted lifecycle is unverified**
— inventory valuation vs the Finance stock-accounting link after a complete
cycle, project actual cost vs its source-linked facts, WIP reconciliation after
production close, cost-per-kilometre vs canonical maintenance facts.

This is the largest remaining gap and the primary reason the classification is
not RELEASE CANDIDATE VERIFIED.

### H2 — Legacy writer refusal is proven at the decision layer, not over HTTP

The tests call `createLegacyWriterRetirementGuard(db)` — the same constructor
`server.js` consults — so `enforced === true` is the same decision the server
makes, and all 28 governed collections resolve to an enforced authority.

But **no HTTP request was issued against a running server with cutover active**.
Nobody observed a real `403 <DOMAIN>_CANONICAL_AUTHORITY_REQUIRED` from
`POST /api/collection`. Mission section 8 items 10–11 are not satisfied. The
decision function is proven; the transport wiring around it is inferred from
source reading.

### H3 — Production cutover has never been rehearsed against production-shaped data

The rehearsal ran on a *fresh* disposable database with seeded fixtures. It did
not run against a disposable **copy of production-shaped data**, which is where
real conflicts (duplicate warehouse codes, orphan references, legacy rows that
violate a new constraint) would actually appear.

Migration 062 makes this concrete: it **fails closed** if duplicate warehouse
codes exist. Nobody has checked whether the operational database contains any.
If it does, the migration will refuse to apply and the owner must resolve real
stock duplicates first.

### H4 — PostgreSQL runtime never executed

The adapter is implemented and unit-tested against an injected fake client. It
has **never executed a statement against a live PostgreSQL server**. The `pg`
driver is not a dependency and no server was reachable. Translation correctness
is tested; wire behaviour is entirely untested.

### H5 — Mid-lifecycle fault injection covers one path

All 22 named workflows have **entry-point** precondition injection. Only stock
has genuine **mid-flight** rollback proof (`tests/phase04/canonical_stock.test.mjs`
— finance-port failure rolls back stock, valuation, balances, audit and outbox).
The other 21 workflows have no proof of what happens when a fault occurs
half-way through an otherwise valid posting.

### H6 — 14 of 18 named concurrency cases not exercised

Exercised: stock reservation, cross-process idempotency, duplicate warehouse
creation, post-race integrity. Not exercised: receipt validation, sales
confirmation, PO approval, limited-stock POS sale, POS payment, project billing,
BOM approval, production release, material issue, production completion, quality
release, capitalization, depreciation run, maintenance parts issue, fleet fuel,
Work Item transition.

They share the executor's transaction boundary and idempotency ledger, which the
exercised cases prove sound — but shared code is an argument, not a proof.

---

## MEDIUM

### M1 — Phase 02 isolation fix depends on how the runner is invoked

`npm run test:phase02` passes 11/11. But someone running
`node --test "tests/**/*.test.mjs"` with default concurrency can still starve the
machine and hit the same 30 s Puppeteer timeout. The robust fix — a cross-process
file-lock mutex acquired by any test that launches Chromium — was not
implemented.

### M2 — Running the tests still dirties the repository

Phase 02 and Phase 03 browser runners write screenshots and timestamped JSON into
**tracked** evidence directories. Checkpoint F identified this; Checkpoint G
reproduced it rather than fixing it. Fix: write to `test-artifacts/` (already
gitignored) and promote only deliberately kept images.

### M3 — Release Health view not built

Application version, commit SHA, branch, unhealthy modules, missing dependencies
and configuration, failed jobs, outbox backlog, backup readiness, session health
and operational mode are not wired to any endpoint or view.

### M4 — A test module still ships enabled *(carried from Checkpoint F)*

Migration 050 inserts `checkpoint_c_test_module` with `status='enabled'`, a
`control:test:ping` action and an admin-menu view. Gated behind `control:admin`,
so not a privilege issue — but a test fixture in the shipped module list.
Unresolved because the Checkpoint C suite asserts it is enabled by default;
disabling it requires editing a passing test, which needs owner review.

### M5 — Client-side legacy write call sites not enumerated

The three generic HTTP writers were audited. The `app.js` and module-script call
sites that use them, direct SQLite writes outside domain engines, and legacy page
submit handlers were **not** individually enumerated.

### M6 — Browser-authoritative calculation not audited

The requirement that no browser-calculated balance is authoritative was not
systematically verified against `app.js` and the module scripts.

### M7 — Per-module UI state matrix and full permission matrix unverified

Permission-denied, server-error, empty, loading and post-command-refresh states
per module; the tablet breakpoint; branch-level isolation for the D/E domains;
expired-session as distinct from revoked-session; and individual denial paths for
the manufacturing operator, quality, asset, maintenance and fleet roles.

---

## LOW

### L1 — `test-artifacts/` holds 72 directories, 39 MB

Gitignored and never committed. Disposable; safe to clear, not cleared here.

### L2 — Root-level `database.backup.*.json` (24 files, ~150 MB)

Pre-existing. Not created, modified, staged or deleted. Nothing is removed merely
for being old, least of all backups.

---

## Explicitly out of scope and unchanged

- **Opening inventory accounting date** — unresolved. Not invented, not
  defaulted. Production opening cutover and activation gate remain fail-closed.
- **Payroll, attendance, timesheet** — frozen, and asserted to remain claimed by
  no canonical authority both before and after cutover activation.
- **`omni.jobOrders`** — the workshop execution chain, deliberately excluded from
  MANUFACTURING.
- **VNext** — frozen. HEAD and dirty fingerprint identical at entry and exit.
- **Operational data** — four SHA-256 hashes identical at entry and exit.
- **`main`** — not merged, not attempted.
