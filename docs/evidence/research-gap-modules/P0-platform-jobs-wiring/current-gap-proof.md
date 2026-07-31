# P0 — Current Gap Proof (before this wave's fix)

Verified by a dedicated research pass at the start of this wave:

```
platform/jobs/index.mjs — 385 lines, exports createJobQueue/createWebhookService
grep -rln "from '.*jobs/index.mjs'" (excluding node_modules):
  tests/phase02/collaboration-files-jobs.test.mjs
  tests/unit/control-plane.test.mjs
  (platform-runtime-bridge.mjs and server.js: NOT in this list)
```

`server.js` installed only the legacy `server-scheduler.js`
(`installOctagonScheduler`, 511 lines) — an independent cron loop with zero
references to `platform/jobs`, `job_runs`, or `platform_jobs`. No job
dashboard page existed; `modules/fpc-release-health.js`'s existing "jobs" tab
only ever read job **definitions** (`platform_jobs`), never queue health
(`job_runs`).

**Conclusion: REGISTERED BUT UNREACHABLE**, confirmed by absence of any
runtime import, not by absence of code.
