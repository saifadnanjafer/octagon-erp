# Work Item Consolidation Evidence

## Authority

Canonical authority remains the existing `work_items` table and
`platform/work_items/work_items.mjs`. Migration 049 adds operating-view fields
and an append-only event table; no parallel Task/Kanban/Calendar store exists.

Visible reads use:

- `GET /api/v1/work-items/items`
- `GET /api/v1/work-items/items/:id`
- `GET /api/v1/work-items/reports`

Visible writes use registered actions:

- `work_item:create`, `work_item:update`, `work_item:assign`;
- `work_item:transition`, `work_item:add_subtask`,
  `work_item:add_dependency`;
- `work_item:complete`, `work_item:cancel`.

## Consolidated behavior

| Concern | Proof |
|---|---|
| Task/Kanban/Calendar identity | every view renders the same `id` and `version` |
| My Tasks | `mine=1` is evaluated against server-derived `ctx.userId` |
| Team workload | report groups open canonical Work Items by assignee |
| Subtasks | `parent_id` relation and inherited relevant commercial links |
| Dependencies | recursive cycle denial; predecessor/successor graph |
| Completion | open dependencies and subtasks fail closed |
| Recurrence | next dated occurrence created atomically on completion |
| SLA/aging/inactivity | derived from canonical timestamps and SLA facts |
| Visual behavior | due-risk color, inactivity opacity, five importance dots |
| Audit/outbox | ActionExecutor transaction plus `work_item_events` |

## Retirement boundary

Legacy Task Manager, Kanban and Workshop TV implementation code remains for
compatibility, but it no longer owns those visible routes while
`__canonicalWorkManagementAuthorityActive` is true. The existing broader HR
calendar is not reclassified as a Work Item calendar; Work Management provides
its own canonical Calendar tab.

## Executable proof

- C4 focused suite: 17/17.
- All Checkpoint C deterministic tests through C4: 73/73.
- Authenticated Chromium: 73/73 combined, 15/15 C4.
- Phase 04 finalization: 99/99.
- Permission regression: 35/35.
- Precommit: pass.

No third-party code was copied. VNext Work/Project and SLA sources were used
only as read-only behavior references.
