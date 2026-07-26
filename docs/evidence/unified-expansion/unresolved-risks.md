# Unified Expansion Unresolved Risks

## Critical/current hard-gate risks

1. Phase 04 disposable snapshot ignores live WAL pages.
2. Opening GL bypasses the Phase 03 finance lifecycle with direct posted-row
   inserts.
3. Phase 04 cutover flag remains disabled and writer-retirement claims are not
   runtime-enforced.
4. Original-shell stock/reservation/commercial/task writers remain active.
5. No real Phase 04 browser suite ran after the opening-cutover implementation.
6. Operational DB is intentionally unmigrated; production cutover is not
   authorized.

## High risks

1. Finance browser service defaults canonical selection OFF while generic
   finance writes are server-blocked.
2. Historical `CLOSED`, `FULL COMPLIANCE`, and `independently verified` evidence
   can mislead later agents.
3. The operational database has active WAL/SHM components; file-only hashes and
   copies do not represent the complete logical source.
4. VNext begins dirty; any write or cleanup there could destroy owner/user work.
5. Current full Phase 01-03 browser status is not refreshed.

## Deferred risks

Donor licensing, capability-selection, commercial packaging, and later-domain
authority risks are assessed progressively in Waves 3-9. They do not authorize
bypassing the Phase 04 hard gate.
