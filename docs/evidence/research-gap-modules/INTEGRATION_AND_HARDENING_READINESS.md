# Integration and Hardening Readiness

## Built this wave

**platform/jobs wiring (P0)** — INTEGRATION READY. See
`P0-platform-jobs-wiring/INTEGRATION_READY_DECISION.md`.

## Readiness against the assignment's own 31-point bar (§10)

| # | Requirement | Status |
|---|---|---|
| 1–4 | Canonical ownership / metadata / dependencies / migration | N/A — reuses existing `platform/jobs`, zero new schema (see `migration-register.md`) |
| 5 | Migration manifest/checksum | N/A, no new migration |
| 6–9 | Domain services / actions / queries / permissions | Existing service reused; 1 new read-only query; 0 new actions/permissions (deliberate, see `action-register.md`/`permission-register.md`) |
| 10 | Server-derived scope | Yes — `job-queue` query takes no client-suppliable filter, gated by existing `control:admin` |
| 11 | Audit | Not added this slice — the queue itself has no audit trail beyond `job_runs` history; flagged as future hardening, not silently skipped |
| 12 | Outbox | N/A to this slice (webhook delivery already integrates with the outbox via `WebhookService.consumeOutbox`, not newly wired this wave) |
| 13 | Idempotency | Yes — proven by test (`ON CONFLICT DO NOTHING` seed; job idempotency keys are inherent to `JobQueue.enqueue`) |
| 14 | Original-shell navigation | Yes — extended existing `release_health` page, no new nav |
| 15–16 | Dashboard / list view | Yes — new "طابور المهام" tab with KPI cards + dead-letter table |
| 17–18 | Detail/form view, primary workflow view | N/A — read-only observability slice, no create/edit workflow introduced |
| 19 | Settings | N/A |
| 20–21 | Arabic RTL / English LTR | Arabic labels added consistent with the page's existing convention; not independently browser-verified this wave (see `deferred-hardening.md`) |
| 22 | Desktop/mobile baseline | Reuses the page's existing responsive grid classes; not independently verified |
| 23 | Migration tests | N/A |
| 24 | Domain lifecycle tests | Yes — `tests/phase02/jobs-wiring.test.mjs`, 5/5 |
| 25 | Permission/isolation tests | Reuses `control:admin`'s existing test coverage; no new isolation surface introduced |
| 26 | HTTP smoke | Covered indirectly — `handleControlPlaneQuery` tested directly; the full HTTP route wasn't separately curled this wave (same permission gate as 11 already-tested resources) |
| 27 | Basic browser smoke | **Not done** — explicit deferred item |
| 28 | Evidence | Yes — this directory |
| 29–31 | Commit / push / SHA equality | Done — see final report |

## Overall wave classification

**PARTIAL — VERIFIED MODULE GAPS REMAIN.** 1 of 18 audited candidates was
brought to Integration Ready this wave; 17 remain, fully dispositioned and
queued in `VERIFIED_MISSING_MODULE_AND_SERVICE_REGISTER.md` with an explicit
dependency order in `dependency-and-build-order.md`. The wave is not, and is
not claimed to be, complete.
