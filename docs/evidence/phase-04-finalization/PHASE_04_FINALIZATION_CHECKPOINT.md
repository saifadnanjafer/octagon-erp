# Phase 04 Finalization Checkpoint

## Classification

**PARTIAL — REMEDIATION REQUIRED**

## Completed this session

- Wave 0 forensic starting-state audit against real source, not inherited
  narrative: canonical HTTP contract, complete action/query surface, 16
  legacy `StockService` call sites resolved to enclosing functions, 79 legacy
  commercial array references, operational-data hash baseline.
- Verified that identity is already server-derived and unspoofable at the API
  boundary (`resolveApiContext` → `resolveContextFromRequest` →
  `stripUntrustedContext`). The exposure is the in-browser legacy writers that
  bypass the API entirely, not the API itself.
- Wave 1 canonical client layer: one durable transport with server-derived
  identity, envelope handling, correlation, idempotency, typed errors,
  optimistic concurrency, server-authoritative cutover resolution, shadow
  comparison, refresh events, 14 query resources and 27 action ids.
- Wave 2 commercial strangler seam with canonical-XOR-legacy authority, and
  opening stock posted as a separate governed stock move rather than a field
  on a product create. `addMaterial` wired; legacy path preserved verbatim.
- Wave 6 opening-date gate verified closed. No date exists; none invented.
- Preserved ~16k lines of pre-existing uncommitted Phase 05 work to its own
  branch rather than destroying it or dragging it onto this branch.
- Phase 04 finalization 38/38, Phase 04 aggregate 47/47, permission regression
  35/35, precommit green on every commit.
- Operational database byte-identical at entry and exit. VNext untouched.

## Not completed

- Wave 2 is partially wired: `editMaterial`, `addCustomerFromForm` and
  `editSupplier` remain wholly legacy.
- Wave 3 inventory original-shell cutover — not started.
- Wave 4 sales / procurement / POS / Work Items — not started.
- Wave 5 compatibility adapter disposition — not started.
- Wave 7 real Chromium acceptance — not started. **No browser process ran.**
- Wave 8 acceptance cutover proof — not started.
- No duplicate writer retired; no feature flag or retirement lock activated.

## Exact blockers

1. **Owner-approved opening inventory accounting date is absent.** Blocks the
   real operational-source migration and any production-readiness claim. Only
   the owner can supply it. The guard is implemented and fails closed.
2. **No real Chromium acceptance.** Activating any retirement lock before
   browser parity would break live workshop workflows. This is a hard gate.
3. The canonical client path has never executed against a real platform runtime
   from a browser — only against a recording stub.

## Honest limits of the evidence

The suites in this session are deterministic contract tests. They prove the
transport and seam contracts hold. They do **not** prove browser behavior, do
not prove parity against real data, and do not prove any legacy call site
behaves correctly after conversion — because only one write path was converted
and it is still executing the legacy branch.

## Next safest work

Continue Waves 3–5 against disposable databases. None of that requires the
opening date. Retirement locks and real-source migration must stay untouched
until the date is approved and browser acceptance passes.

## Single owner decision required

> **Approved opening inventory accounting date: `YYYY-MM-DD`**
