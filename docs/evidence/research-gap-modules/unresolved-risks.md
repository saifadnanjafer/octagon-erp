# Unresolved Risks

1. **Duplicate scheduler authority persists** (`server-scheduler.js` vs
   `platform/jobs`) — both now run in the same process after this wave
   (the legacy scheduler was already live; `platform/jobs` is now also
   ticking every 5 minutes via `server.js`). They do not share job codes
   (verified by test) and do not contend for the same rows, but the codebase
   now has two schedulers where the assignment's own rules say there should
   be one. This is a **known, reported** risk, not a silent one — resolving
   it requires a dedicated consolidation slice (see `deferred-hardening.md`).
2. **`WebhookService.dispatch()` has no transport configured** — see
   `deferred-hardening.md` item 2. Any future code that calls `.queue()`
   without also injecting a transport will silently dead-letter every
   delivery. Flagged so the next agent wiring a webhook producer does not
   assume delivery "just works."
3. **Three-way returns/warranty/NCR duplication** (§7.11 in the gap matrix) —
   the single highest business-risk finding of this audit: the same
   real-world event (a customer return) can currently be recorded in up to
   three disconnected places with no reconciliation. Not touched this wave;
   explicitly the top-priority item for whichever wave tackles returns.
4. **Full 223-row capability-matrix audit is incomplete** — only the 18
   mandatory-candidate groups were individually re-verified against live code
   this wave (see the scope note in `MASTER_RESEARCH_TO_IMPLEMENTATION_GAP_MATRIX.md`).
   The remaining ~205 rows' "Current Octagon" descriptions should not be
   trusted at face value without the same file:line verification, given how
   often this pass found the matrix's own current-state column out of date.
