# Unified Expansion Unresolved Risks

## Critical/current hard-gate risks

1. The approved opening-inventory accounting date is not present in source or
   owner instructions. The real disposable migration remains fail-closed with
   `OPENING_CUTOVER_DATE_REQUIRED`.
2. Original-shell stock/reservation/commercial/task writers remain active; a
   complete canonical client adapter is not implemented.
3. No real Phase 04 browser suite ran after the remediation.
4. The Phase 04 flag and retirement locks remain inactive in the operational
   database, as required before acceptance.
5. Operational DB is intentionally unmigrated; production cutover is not
   authorized.

## High risks

1. Historical `CLOSED`, `FULL COMPLIANCE`, and `independently verified` evidence
   can mislead later agents.
2. The operational database has active WAL/SHM components; future observation
   must keep using staged byte copies rather than opening the live path.
3. VNext begins dirty; any write or cleanup there could destroy owner/user work.
4. Current full Phase 01-03 browser status is not refreshed.

## Deferred risks

Donor licensing, capability-selection, commercial packaging, and later-domain
authority risks are assessed progressively in Waves 3-9. They do not authorize
bypassing the Phase 04 hard gate.
