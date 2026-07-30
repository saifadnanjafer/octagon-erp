# CRM Integration-Ready decision

**Decision: INTEGRATION READY**

CRM satisfies the breadth-wave definition:

- migrations 065 and 066 are accepted, rerunnable, and rollback-proven;
- Wave 1 services are the single CRM business write authority;
- 29 explicit runtime ActionExecutor commands are registered;
- six CRM permissions and server-derived scope are enforced;
- governed query API, Customer 360, and reports are live;
- the original shell contains dashboard, list, detail, Kanban, activities,
  Customer 360, reports, and settings;
- audit, outbox, transaction ownership, and required idempotency are active;
- backend lifecycle, HTTP/browser smoke, company isolation, Viewer denial, and
  disabled-module denial pass.

Deferred to Integration & Hardening: exhaustive Chromium lifecycle matrix,
multi-process concurrency matrix, exhaustive failure injection, accessibility
deep audit, final visual polish, performance benchmarking, PostgreSQL runtime,
backup/restore, operational migration, and production cutover.

No operational database or JSON database exists in this worktree. VNext,
administrator credentials, the original dirty worktree, and the Telegram
worktree were not modified.
