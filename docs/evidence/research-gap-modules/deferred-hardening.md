# Deferred Hardening — Stated Explicitly, Not Hidden

## This wave's P0 slice (platform/jobs wiring)

1. **`server-scheduler.js` is not retired or consolidated into `platform/jobs`
   this wave.** It remains a second, independent scheduler running its own 5
   cron jobs. This is a real, pre-existing duplicate-authority risk (see
   `canonical-authority-map.md`) that this wave chose not to fix, because
   doing so safely requires porting real business logic (dunning drafts,
   expiry-alert generation, the nightly-backup-verify integration with
   `runNightlyBackupCycle`, self-check) with its own dedicated regression
   proof — a separate, larger slice.
2. **`WebhookService` is wired into the authority object but has no live
   subscriber and no `transport` configured.** `dispatch()` will report
   `{dead: N, reason: 'no transport configured'}` for anything queued until a
   real HTTP transport is injected. Nothing currently calls `.queue()`, so
   this is inert, not broken — but it is not yet "Integration Ready" in the
   full sense of delivering a webhook.
3. **No browser/Chromium verification was performed for the new "طابور
   المهام" (Job Queue) tab in `modules/fpc-release-health.js`.** Verification
   this wave was HTTP/data-level (the new test suite) and code review of the
   existing tab-rendering pattern it reuses; a real-browser click-through of
   the new tab is deferred.
4. **The `platform_jobs` seed only registers one job kind
   (`platform.jobs.maintenance_sweep`).** No other business capability was
   moved onto the now-reachable queue this wave — that is deliberate (see
   `dependency-and-build-order.md`), not an oversight, but it does mean the
   "Integration Ready" queue currently has exactly one real tenant.
5. **PostgreSQL was not re-verified** for this slice; it inherits whatever
   PostgreSQL status `platform/jobs`/`platform/control_plane` already had
   (both are plain parameterized SQL against the shared `dialect` interface,
   consistent with the rest of the codebase, but this wave ran only against
   SQLite).

## Carried over from the broader gap register (not this wave's responsibility, not fixed)

- Collaboration/chatter (§7.1), notifications provider completion (§7.2),
  print/template consolidation (§7.3) — all REGISTERED BUT UNREACHABLE /
  BACKEND ONLY / EXISTING MODULE EXTENSION REQUIRED, same defect family,
  explicitly queued for the next continuation (see
  `dependency-and-build-order.md`).
- The three-way returns/warranty/NCR duplication (§7.11) — flagged high-risk,
  not attempted.
