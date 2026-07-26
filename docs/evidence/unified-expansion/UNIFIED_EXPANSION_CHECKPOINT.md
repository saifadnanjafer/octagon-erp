# Unified Expansion Checkpoint

## Current classification

**PARTIAL — REMEDIATION REQUIRED**

## Completed

- Waves 0-1 branch/freeze/provenance and architecture/closure audit.
- Wave 2 implementation checkpoint `73248c23b5f9751cbdbfaefb6171a1eb44c039fd`.
- WAL-aware staged snapshot that never opens the operational SQLite path.
- Current operational source verified unchanged: 8 materials, 401 on hand, 86
  reserved, 315 available, IQD 1,963,000 valuation, zero invalid costs.
- Opening finance posting now uses Phase 03 create → submit → approve → post.
- Explicit cutover date, exact accounts/journal/period/warehouse/location, and
  component drift all fail closed.
- Fixture reconciliation proves quantity, reservation, available, valuation,
  balanced GL, no duplicates, rerun, rollback, and WAL-only committed facts.
- Two-key per-domain runtime writer retirement and server-authoritative finance
  client selection.
- Phase 04 aggregate 47/47; permission regression 35/35; precommit passed.
- Operational DB/WAL/SHM/JSON hashes remain identical.

## Not completed

- Owner/source-approved opening accounting cutover date.
- Real operational-source disposable migration and accepted sign-off.
- Durable original-shell canonical inventory/commercial/work-item adapters.
- Activation of flag/domain locks on a disposable accepted database.
- Real Phase 04 Chromium browser acceptance.
- Complete Wave 3 capability-harvest matrix and later waves.

## Exact blockers

1. Selecting an accounting date without owner/source authority would invent a
   material accounting fact.
2. Activating inventory retirement before the original UI has a durable
   canonical draft/edit/validate workflow would make existing workflows fail.
3. Browser closure before those two facts is invalid.

## Next safest work

Continue Wave 2 by implementing durable canonical stock draft/validate and
original-shell adapters without activating cutover. The real-source migration
must remain blocked until the accounting date is supplied.
