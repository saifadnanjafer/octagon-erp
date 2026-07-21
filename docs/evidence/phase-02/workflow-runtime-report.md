# Workflow Runtime Report

`platform/workflow/index.mjs` owns versioned definitions and durable resumable
instances. Nodes are registry/permission checked; protected payroll, attendance,
timesheet, and employee entities are frozen; timers, leases, retries, dead-letter,
compensation, cancellation, idempotency, and version pinning are durable.

Evidence: `node tests/phase02/workflow-approvals.test.mjs` **31/31 passed**,
covering invalid/frozen definitions, activation immutability, canvas compatibility,
completion, duplicate dispatch, leases, worker crash recovery, timers, failure
handling, cancellation, node authorization, and outbox-only notification.

