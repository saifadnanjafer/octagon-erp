# Jobs, Scheduler, and Webhook Report

`platform/jobs/index.mjs` owns durable job runs, leases, heartbeats, retry/backoff,
dead-letter, idempotency, cancellation/progress, and cron-to-job behavior.
Webhook delivery uses scoped credentials, signatures, replay protection, retry
and duplicate suppression. External calls occur after committed outbox effects.

Evidence: `node tests/phase02/collaboration-files-jobs.test.mjs` **29/29 passed**,
including lease/crash/retry/dead-letter, idempotency/scope/cron, webhook signing
and replay, and post-commit-only external effects. The remaining operational gap
is a separately supervised external worker topology; it is carried in
`unresolved-risks.md`.

