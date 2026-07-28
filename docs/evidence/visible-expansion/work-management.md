# Checkpoint C4 — Canonical Work Management

## Outcome

The original Task Manager page now owns a single canonical Work Management
workspace backed by the existing Work Item authority. The separate legacy
Kanban and Workshop TV navigation entries are retired while the canonical
module is active.

Nine real views read the same versioned records:

- Task Manager, Kanban, Calendar, My Tasks, Team Workload;
- Workshop TV, Mobile Tasks, SLA Worklist, Dependency View.

The UI exposes description, assignment, team, watchers, priority, five-level
importance, dates, effort, recurrence, SLA, project/commercial/quality/
maintenance links, checklist, attachments, comments, subtasks and dependencies.
Task Manager supports working search, sort and grouping; My Tasks is filtered
server-side to the authenticated user.

## Canonical lifecycle

Migration `049_work_item_operating_views` extends the existing `work_items`
authority and adds `work_item_events`; it does not introduce a second task
engine. Explicit ActionExecutor commands cover assign, transition, subtask,
dependency, complete and cancel. Completion blocks while a predecessor or
subtask is open. Recurring completion creates the next occurrence in the same
transaction.

All transitions preserve company scope, optimistic concurrency, idempotency,
audit and outbox. Failure injection proves that Work Item state, event, audit
and outbox roll back together.

## Browser proof

`scripts/checkpoint-c-browser-acceptance.mjs` passed **73/73** combined and
**15/15** for C4 under `Chrome/150.0.7871.24`.

Trace:
`test-artifacts/checkpoint-c-2026-07-28T05-26-01-449Z/checkpoint-c-browser-results.json`.

The original-shell scenario executed create → assign → subtask → dependency →
versioned Kanban move → calendar due-date move → dependency/subtask-gated
completion → workload report → Workshop TV. The Workshop operational role
created a record and the restricted viewer received a server-side denial.

Reviewed screenshots are under
`docs/evidence/visible-expansion/screenshots-c/work-management/`.

## Boundaries

C4 is complete, but Checkpoint C is not. C5 Administration/Module Control and
C6 final cross-domain closure remain. PostgreSQL execution, broad Phase 04
cutover and the owner-approved opening-inventory accounting date remain
unproven or blocked. Operational files were never written.

## C6 closure addendum

Work Management is included in the final 100/100 deterministic and 90/90
Chromium gates. One authority powers all nine views; transition rollback,
stale-version denial, idempotency, dependency gating, recurrence, SLA,
workload, Calendar, Kanban, mobile, and Workshop TV remain green.
