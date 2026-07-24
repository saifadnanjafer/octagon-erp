# Work Item Consolidation

Canonical owner: `platform/work_items/work_items.mjs`.

Migration 043 adds relations, watchers, approvals, version/history support, source/source-line references, and governance tables around the existing `work_items` foundation. Registered actions create, update, archive/delete, and approve through ActionExecutor.

`tests/phase04/canonical_work_items.test.mjs` proves:

- one versioned record is read consistently through Task Manager/Kanban-style queries;
- parent/dependency/watcher relations persist;
- approval transition and optimistic version checks work;
- company scope is enforced.

Disposable migration mapped 3 work orders, 5 Task Manager tasks, and 3 Kanban cards into 11/11 Work Items with stable source keys and idempotent rerun.

Live Task Manager/Kanban/Calendar/mobile/TV/project/helpdesk/QC/maintenance writers were not converted after the stock/GL hard stop. The backend authority is ready, but exclusive UI authority is not claimed.
