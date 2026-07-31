# Returns/RMA — Integration Ready Decision

## Classification: INTEGRATION READY

## Why

- One governed orchestration authority (`returns_rma`), owning only what the
  program rules allow it to own; every downstream effect calls a real
  existing canonical authority (Inventory, Quality, Finance, Work Items,
  Procurement) — none duplicated.
- Real forward migration (084), not runtime DDL.
- Real server-derived-scope enforcement (`registerDomainHandler`) on all 8
  actions, matching the codebase's established pattern exactly — the
  draft's broken registration (calling a nonexistent method) is fixed.
- Real permission gating (`returns:write`/`returns:approve`), auto-derived
  the same way every other domain in this codebase derives its permissions.
- Idempotent create, proven by test, not just declared.
- Atomic multi-statement writes (`BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`).
- No fabricated references — a failed or unattempted canonical call throws a
  real, typed error; proven by two dedicated tests (10, 11) plus a real
  end-to-end success-path test (15) for the highest-value disposition
  (refund).
- A governed, company-scoped read query.
- A real, backend-wired UI surface (not a mock), added to the existing page
  rather than forking a new one.
- 15/15 new tests pass; full phase02 regression (see
  `../test-suite-register.md`) shows zero regressions attributable to this
  change.

## Why not "COMPLETE AND PROVEN"

- `replace`/`refurbish`/`scrap` dispositions and the `return_to_supplier`
  success path have no canonical execution/proof yet.
- No live-browser proof.
- The old local claims registry was not migrated/retired.
- No audit/outbox event beyond the RMA's own timeline.

These are genuine, stated limitations — see `deferred-hardening.md` — not
hidden gaps. Per the assignment's own §40 bar, the overall
**wave** classification is separately recorded in
`../COMMERCIAL_OPERATIONS_CLOSURE_DECISION.md` as **PARTIAL** (3 of 4 slices
not started), while this one slice is Integration Ready on its own.
