# Canonical Authority Map (as verified this wave)

## Authorities confirmed real and already canonical (do not duplicate)

| Business fact | Authority | Evidence |
|---|---|---|
| Durable job/run queue | `platform/jobs/index.mjs` `JobQueue` (`job_runs` table, migration 010) | now wired — see P0 folder |
| Job/webhook definitions | `platform_jobs` table (migration 005) | pre-existing, extended additively (one new row) |
| Webhook delivery | `platform/jobs/index.mjs` `WebhookService` | now wired — see P0 folder |
| Entity chatter/threads/followers/activities | `platform/collaboration/index.mjs` | real, tested, still unwired (P1 for next wave) |
| In-app/email/WhatsApp notification dispatch | `platform/notifications/index.mjs` | real, partially wired (bootstrap counter only) |
| Print template rendering (versioned, RTL-safe) | `platform/data-exchange/index.mjs` | real, tested, unwired |
| Customer credit exposure / AR aging | `platform/finance/engine.mjs` | real, enforced in sales approval, no UI |
| MRP demand netting / reorder policy | `platform/engineering/mrp.mjs` | real, wired (into `modules/canonical-engineering.js`) |
| Quality NCR/CAPA | `platform/quality/ncr-capa.mjs` | real, read-wired only |
| Stock return command | `platform/inventory/wms_workflows.mjs` | real, zero callers |
| Sales commission calculation | `platform/sales/lifecycle.mjs` | real (basic), zero callers |
| Legacy 5 cron jobs (dunning drafts, expiry alerts, maintenance-due alerts, backup verify, self-check) | `server-scheduler.js` | real, live, **left untouched this wave** |

## Duplicate-authority risks identified (not created by this wave, flagged for the owner)

1. **Scheduler:** `server-scheduler.js` (legacy, live) vs `platform/jobs` (canonical, now reachable). This wave did **not** merge them — see `deferred-hardening.md`. The one new job definition added this wave (`platform_kernel:maintenance_sweep`) uses a handler/id namespace verified (by test) to not collide with any of the legacy scheduler's 5 job codes.
2. **Returns/warranty:** `modules/warranty-rma.js` (mock) vs `platform/inventory` stock-return command (real, unreachable) vs `platform/quality` NCR/CAPA (real, read-only) — three disconnected representations of the same business event. Not touched this wave; flagged P1/high-risk in the verified-missing register.
3. **Sales commission:** `modules/sales-commission.js` (mock, full-featured UI) vs `platform/sales/lifecycle.mjs` (real, basic engine) — not touched this wave.
4. **Aging/credit:** `modules/finance-close.js` primitive single-bucket aging mock vs `platform/finance/engine.mjs` real aging — not touched this wave.

None of these four risks were created by this wave; all four pre-date it and
are reported, not silently left for someone else to discover.
