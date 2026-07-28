# Checkpoint F — release candidate decision

# PARTIAL — REMEDIATION REQUIRED

Repository `saifadnanjafer/octagon-erp` ·
source `487409a3dfa4fc99acb14da45809f9168a55a588` ·
review branch `review/octagon-unified-release-candidate`.

---

## The decision in one paragraph

Octagon's canonical architecture is real and, in the places it was possible to
check by machine, it is genuinely sound: one dispatcher, one ActionExecutor, one
database, 330 registered actions with no duplicate id, 158 entities with no
competing ownership, mandatory audit and idempotency on every governed action,
and — proved by foreign key rather than by screenshot — one Party, one Product,
one UOM, one Work Item and one Asset register shared across the domains that
consume them. What prevents a release-candidate verification is not a flaw in
that design but the fact that it is **not yet switched on**: for 12 of 13
business domains the legacy write routes still accept writes that bypass the
executor entirely, and the end-to-end lifecycle, backup/restore and
multi-process concurrency proofs required to switch them on do not exist.

## Why not "VERIFIED"

The first classification requires *all* of the following. Status:

| Requirement | Status |
|---|---|
| Complete lifecycle browser proof | **NOT MET** — no D/E Chromium lifecycle runner exists; the inherited 8/8 claim is unproven |
| Canonical backend consistency | **MET** — registry, schema and FK evidence |
| No competing writer for delivered canonical facts | **NOT MET** — only FINANCE is enforced |
| Atomicity | **PARTIALLY MET** — 3 of 20 named injection points proved atomic |
| Concurrency | **PARTIALLY MET** — single-process only |
| Permissions | **PARTIALLY MET** — server-side enforcement proved; full 13-role matrix not run |
| Migrations | **MET** — 60/60 fresh, sequential and idempotent-on-rerun |
| Backup/restore proof | **NOT MET** — not executed |
| PostgreSQL honestly classified | **MET** — classified BLOCKED BY IMPLEMENTATION |
| Operational data unchanged | **MET** — four SHA-256 identical at entry and exit |
| VNext unchanged | **MET** — HEAD and dirty fingerprint identical |
| No critical/high unresolved defect | **NOT MET** — 1 critical, 5 high |
| Complete evidence | **MET** for what was executed; gaps named rather than papered over |
| Local/remote SHA equality | **MET** after every push |

## Why not "BLOCKED"

Verification was not prevented. The audit ran end to end, produced reproducible
runtime evidence rather than source-reading, found a real defect that previous
reporting had missed, and remediated the part of it that was safe to remediate.
336 of 337 repository tests pass and the single failure is a harness isolation
issue, not a product defect.

## What Checkpoint F changed

One defect found and fixed:

**The seven Checkpoint D/E domains had no canonical-authority entry and no
retirement lock at all.** Their legacy collections — `omni.workOrders`,
`omni.boms`, `omni.assets`, `omni.fleet`, `omni.projects` and others — could not
be refused by the legacy write routes even in principle, and `enforced()`
returned false for those domains as *unknown*, so they could never have been
retired even after the owner ran the cutover. A domain could look fully
canonical while its legacy back door stood permanently open.

Remediation (additive, inert at runtime, reversible by reverting two files):

1. Extracted the authority map out of the `server.js` request handler into
   `platform/cutover/canonical-authority-map.js` so its coverage is importable
   and testable — the reason the gap survived this long is that the table could
   not be imported by a test.
2. Registered all seven D/E domains, deliberately leaving `omni.jobOrders`
   (workshop chain) and the payroll/attendance/timesheet paths unclaimed.
3. Declared `CHECKPOINT_DE_RETIREMENT_LOCKS` so those domains are lockable and
   visible to release health.
4. Added `tests/checkpoint-f/` (27 tests) so the omission cannot recur silently.

Verified no regression afterwards: Checkpoint C 100/100, Phase 04 47/47,
Phase 04 finalization 100/100, Checkpoint D/E 56/56.

## Claims rejected

- **"134/134 repository tests"** — no suite or combination yields 134. The real
  total is 363 (362 pass / 1 fail). The claim is simply wrong.
- **"8/8 Chromium checks"** — NOT PROVEN; the runner does not exist.
- **"No competing writer"** — false for 12 of 13 domains.
- The inherited D/E register understates itself (50 vs 56) and calls five
  existing, passing suites "not written".
- The Phase 02 "pre-existing product failure" is a **test isolation defect** —
  the file passes in isolation.

## Path to verified

In order:

1. Owner runs the Phase 04 cutover per domain after parity evidence, then the
   same for the seven D/E domains (now possible for the first time).
2. Build and run the authenticated Chromium lifecycle acceptance for all 13
   domains, capturing screenshots, command ids and correlation ids.
3. Execute the disposable backup/restore cycle.
4. Add multi-process concurrency tests against the `operation_locks` path.
5. Extend failure injection to the remaining 17 named points.
6. Resolve M1 (test module shipped enabled) and M2 (Phase 02 suite interference).

Items 1–3 are the gating ones.

## Statement

This is an independent verification result, not a production certification. No
merge into `main` was performed or attempted. Main-merge readiness is assessed
separately in [MAIN_MERGE_READINESS.md](MAIN_MERGE_READINESS.md).

**Classification: PARTIAL — REMEDIATION REQUIRED**
