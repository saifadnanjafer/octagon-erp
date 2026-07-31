# P0 — Architecture

```
server.js
  └─ createPlatformAuthority(dbSync)         [platform-runtime-bridge.mjs]
        ├─ jobQueue = createJobQueue(dialect)        (platform/jobs/index.mjs)
        │     └─ registerHandler('platform.jobs.maintenance_sweep', ...)
        ├─ webhookService = createWebhookService(dialect)
        ├─ seedDefaultJobDefinitions(dialect)          [idempotent seed]
        └─ authority.jobQueue / authority.webhookService exposed

  └─ setInterval (every OCTAGON_JOB_QUEUE_POLL_MS, default 5 min)
        ├─ jobQueue.tick()             — enqueue from platform_jobs defs
        ├─ jobQueue.drain({max:20})    — execute claimed jobs
        ├─ jobQueue.recoverStaleLeases()
        └─ webhookService.dispatch({batchSize:20})

platform/api/index.mjs
  └─ namespace 'control-plane' (requires control:admin)
        └─ handleControlPlaneQuery({resource:'job-queue'})   [platform/control_plane/index.mjs]
              reads job_runs directly (read-only)

modules/fpc-release-health.js
  └─ new tab "طابور المهام" → fetch('/api/v1/control-plane/job-queue')
```

No new schema, no new domain service, no new action — this is a pure wiring
slice per `dependency-and-build-order.md`.
