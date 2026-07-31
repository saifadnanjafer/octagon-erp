# P0 — platform/jobs wiring — Integration Ready Decision

## Classification: INTEGRATION READY

## Why

- Canonical ownership: `platform/jobs` (existing, unchanged authority) —
  no new/duplicate authority created.
- No new migration needed; schema pre-existed.
- Real domain service (`JobQueue`/`WebhookService`) — pre-existing, now
  reachable from the actual running server (`server.js`) and API
  (`platform/api/index.mjs` → `platform/control_plane/index.mjs`).
- Server-derived scope: the new query has no client-suppliable filter —
  it reads `job_runs` directly, gated by the pre-existing `control:admin`
  permission evaluated server-side.
- Original-shell navigation preserved: extended an existing, already-wired
  page (`fpc-release-health.js`) rather than forking a new frontend.
- Tests: 5/5 new tests pass, proving the exact defect ("no handler
  registered" dead-lettering) is fixed and that no duplicate-scheduler
  collision was introduced.
- Idempotent, safe seed (`ON CONFLICT DO NOTHING`) — safe to re-run.

## Why not "COMPLETE AND PROVEN"

- No live-browser proof of the new dashboard tab (deferred).
- `server-scheduler.js` duplicate-authority risk not resolved, only
  contained/verified-non-colliding (deferred, explicit next-wave item).
- `WebhookService` has no transport configured — inert, not exercised
  end-to-end for an actual delivery (deferred).
- Only one job kind is a real tenant of the now-reachable queue.

These are genuine, stated limitations, not hidden gaps — see
`../deferred-hardening.md` and `../unresolved-risks.md`.
