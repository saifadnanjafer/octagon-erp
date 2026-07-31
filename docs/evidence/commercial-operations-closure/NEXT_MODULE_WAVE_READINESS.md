# Next Module Wave Readiness

## Slice 1 (Returns/RMA): done, Integration Ready

See `returns-rma/INTEGRATION_READY_DECISION.md`.

## Slices 2–4: not started this wave

| Slice | Status | Why not started |
|---|---|---|
| Credit and Collections | Not started | Full slice (policy model, collections queue, dunning, UI) not attempted this wave — see rationale in `COMMERCIAL_OPERATIONS_CLOSURE_DECISION.md` |
| Printing/Templates/Labels/Barcode | Not started | Same |
| Sales Commissions | Not started | Same |

## What the next wave should do first

1. Re-verify this wave's real ending SHA against GitHub before assuming
   anything (the same discipline this wave applied — see
   `source-checkpoint.md`).
2. Start Slice 2 (Credit and Collections) from the canonical
   `platform/finance/engine.mjs` authorities already confirmed real and
   wired in the research-gap-modules audit (`getCustomerAging`,
   `holdCredit`, `getCreditExposure` — already enforced in
   `platform/sales/lifecycle.mjs`'s quotation approval). The backend
   largely already exists; the gap is almost entirely a missing UI
   workspace, matching the same "REGISTERED BUT UNREACHABLE" pattern found
   repeatedly in this program.
3. Watch for the same defect class this wave found twice now (fabricated
   fallback references, broken action registration) in whatever draft/
   interrupted work is found — verify before extending, the same way this
   wave did for Returns/RMA.
4. The `PERIOD_MISSING` pre-existing test failures (see
   `unresolved-risks.md` item 4) are worth a dedicated look if they start
   blocking new finance-adjacent work — they were out of scope to fix here
   but are not disappearing on their own as the wall-clock date advances.
