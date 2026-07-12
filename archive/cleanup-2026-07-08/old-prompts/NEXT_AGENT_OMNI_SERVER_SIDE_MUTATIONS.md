# TASK: Omni Jarvis Server-Side Mutation Sprint

You are working inside the Octagon / Omni ERP codebase.

Goal:
Close the remaining security gap after the Jarvis security hardening sprint.

Current state:
- Server-side gate exists.
- API keys moved to .env/server proxies.
- Dangerous tools now require server grant/approval.
- However, some mutations still execute client-side after a valid grant.
- Raw browser console edits to client-side omni state may still mutate local/app state.

This sprint must move real mutation execution to the server.

IMPORTANT RULES:
- Do not build KB RAG.
- Do not build durable memory.
- Do not enrich snapshot except where necessary.
- Do not redesign the whole Jarvis system.
- Keep existing UI behavior working.
- Make small traceable changes.
- Dangerous/write tools must not mutate persistent data from browser code.
- The browser may request actions, but the server must execute them.

---

# PART 1 — Inspect Current Mutation Paths

Inspect:

- server.js
- server-jarvis-security.js
- octagon-erp/modules/jarvis-brain.js
- octagon-erp/modules/ai-governance.js
- octagon-erp/omni-ai-assistant.js
- octagon-erp/app.js
- DB/data helper files
- any localStorage/database/json persistence helpers

Find all Jarvis tools that write or mutate:

- tasks
- customers
- journal entries
- finance records
- payroll
- attendance
- inventory
- approvals
- settings
- projects
- employees
- any database.json/database.db state

Create a mutation map:

| Tool | Current Execution Location | Persistent Target | Risk | Should Move Server-Side? |
|---|---|---|---|---|

---

# PART 2 — Create Server-Side Tool Executors

Create a server-side executor registry, for example:

server-jarvis-tools.js

It should export:

- getServerJarvisTool(toolName)
- listServerJarvisTools()
- executeServerJarvisTool(toolName, args, context)

For each dangerous/write tool:
1. Move the real mutation logic into the server executor.
2. Validate args server-side.
3. Sanitize args.
4. Check required fields.
5. Execute DB/file mutation server-side.
6. Return a clean result object.
7. Write audit logs.

Do not trust client-computed IDs, timestamps, risk levels, user names, or status fields unless validated.

The server must generate:
- IDs
- timestamps
- audit metadata
- execution status

---

# PART 3 — Update /api/jarvis/action

Update the existing server endpoint so:

POST /api/jarvis/action

For safe read-only tools:
- either execute server-side if available
- or allow existing client-side read-only behavior if no mutation risk exists

For write/dangerous tools:
- never ask the client to run the real mutation
- if safe after policy:
  - execute server-side
- if gated:
  - create approval server-side
  - do not mutate yet
- if denied:
  - fail closed

The response for write tools should contain only:
{
  "ok": true,
  "status": "executed" | "approval_required" | "denied" | "failed",
  "result": {...},
  "auditId": "...",
  "approvalId": "...optional..."
}

Do not return grants that allow client-side mutation for write tools anymore.

---

# PART 4 — Update Approved Execution

Update:

POST /api/jarvis/execute-approved

So that approved write actions:
1. Re-load approval from server storage.
2. Confirm it is pending.
3. Re-check current user/session.
4. Re-check manager/admin permission.
5. Re-check policy.
6. Execute mutation server-side through server-jarvis-tools.js.
7. Mark approval executed.
8. Prevent double execution.
9. Write before/after audit log.

Do not send a grant back to the browser for mutation.

---

# PART 5 — Strip Client-Side Mutation Runners

In octagon-erp/modules/jarvis-brain.js:

For every dangerous/write tool exposed in window.JarvisBrain.tools:

- Replace direct mutation .run() with a server call wrapper.
- The wrapper must call /api/jarvis/action.
- It must never directly mutate persistent state.
- If server is unreachable, fail closed.
- If server says approval_required, show/return approval state.
- If server says denied, show/return denial.
- If server says executed, update UI by refreshing/re-reading state, not by trusting client-local mutation.

Add comments explaining:
- write tools are server-authoritative
- client wrappers are requesters only
- direct browser execution is intentionally blocked

---

# PART 6 — State Refresh After Server Mutation

After a successful server-side mutation:

- Refresh affected UI state from the real data source.
- Do not fake success by locally pushing data into arrays.
- If no read endpoint exists, create minimal read endpoint needed for verification/refresh.
- Keep the UI stable.

Examples:
- create_task → server writes task → frontend reloads task list/count
- create_customer → server writes customer → frontend reloads customer list/count
- create_journal_entry → server writes finance record → frontend reloads finance data/count

---

# PART 7 — Lock Down Local State Mutation Risks

Search for places where browser code writes persistent business state directly:

- localStorage.setItem(...)
- window.omniData = ...
- database writes from frontend
- exposed global mutable stores
- direct JSON mutation helpers
- unsafe import/export save calls

Do not remove legitimate UI state storage blindly.

Classify:

| Storage / Global | Purpose | Business-Critical? | Action |
|---|---|---|---|

For business-critical state:
- move writes to server when related to Jarvis tools
- or mark as remaining risk if too large for this sprint

---

# PART 8 — Tests / Smoke Checks

Run or create smoke checks for at least these cases:

1. Browser console direct call to create_journal_entry does not mutate records.
2. Browser console direct call to create_task does not mutate records without server.
3. Normal Jarvis create_task request succeeds through server.
4. Dangerous finance action returns approval_required.
5. Approved finance action executes server-side only.
6. Approved action cannot be executed twice.
7. Arg swapping after approval is impossible.
8. UI refreshes after server-side mutation.
9. Server unavailable → write tool fails closed.
10. Unknown tool fails closed.
11. Read-only tools still work.
12. Audit log records requested/approved/executed/denied/failed states.

If full automation is not available, create a manual checklist with exact commands and expected outputs.

---

# PART 9 — Final Report

Create:

OMNI_JARVIS_SERVER_SIDE_MUTATIONS_REPORT.md

Include:

## 1. Summary
Explain what was moved server-side.

## 2. Files Changed
| File | Change | Reason |
|---|---|---|

## 3. Mutation Map
Show before/after for each write tool.

## 4. Server Tool Registry
Explain how server-jarvis-tools.js works.

## 5. Updated Action Flow
Show the new flow:

User → Client Wrapper → /api/jarvis/action → server gate → server executor → audit → UI refresh

## 6. Approval Execution Flow
Show the approved action flow without client-side grants.

## 7. Client-Side Bypass Result
Show proof that direct browser calls cannot mutate data.

## 8. Smoke Test Results
List all tests and pass/fail status.

## 9. Remaining Risks
Be honest:
- any remaining localStorage business state
- temporary auth placeholder
- any tools not fully migrated
- any old deployed JS/cache risks

## 10. Next Sprint Recommendation
Only after this sprint passes, recommend:
1. Enriched snapshot
2. KB RAG grounding
3. Post-execution read-back verification
4. Durable memory
5. DOM reader hardening

Use Arabic for explanations, but keep file names, routes, function names, and code identifiers in English.
EOF
