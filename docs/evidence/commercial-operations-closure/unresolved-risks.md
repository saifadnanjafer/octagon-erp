# Unresolved Risks

1. **The old local `omni.warrantyHub.claims` tracking model still exists
   alongside the new canonical `returns_rma` authority** — two representable
   truths for the same real-world event until a deliberate migration/
   deprecation decision is made. See `duplicate-authority-retirement.md`.
2. **`replace`/`refurbish`/`scrap` dispositions have no canonical execution
   wired** — the decision is recorded honestly (no fabricated reference),
   but nothing actually moves stock or posts a scrap valuation yet. See
   `returns-rma/deferred-hardening.md`.
3. **No live-browser proof for the new RMA tab.** Domain-layer tests are
   real and thorough; the UI itself was not clicked through in a real
   browser this wave.
4. **Two pre-existing, unrelated test failure classes were re-confirmed**
   (not introduced, not fixed): `PERIOD_MISSING` fiscal-period errors in
   `checkpoint-d-e` (3 tests) and `finance-closure-audit` (3 tests),
   independently reproduced on the untouched `octagon-research-gap-modules`
   branch. Very likely caused by the wall-clock date advancing past
   hard-coded/relative fiscal-period test fixtures, unrelated to Returns/RMA.
   Not this wave's responsibility to fix; flagged so the next agent does not
   assume it introduced them.
5. **Slices 2–4 (Credit and Collections, Printing, Sales Commissions) were
   not started** — see `COMMERCIAL_OPERATIONS_CLOSURE_DECISION.md`.
