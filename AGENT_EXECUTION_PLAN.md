# OCTAGON ERP — MASTER EXECUTION PLAN v2 (A → Z)

**Date:** 2026-07-12
**Author:** Claude (Fable 5) + Owner (Saif)
**Executors:** Multiple Claude Sonnet 5 agents, working in sequenced phases
**Status:** APPROVED FOR EXECUTION — no owner check-ins required EXCEPT §12 (Timesheet proposals)
**Product root:** `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\octagon-erp\`
**Canonical roadmap:** `octagon-erp/MASTER_ROADMAP.md` (read it at session start; this plan is the execution layer on top of it)

---

## 0. READ THIS FIRST — EVERY AGENT, EVERY SESSION

Octagon ERP is a **local-first, Arabic-first (RTL) ERP** for a workshop/manufacturing business, built to surpass Odoo/SAP on *fit* (Arabic, WhatsApp, workshop workflow). It is a single-page app:

- **Entry:** `index.html` → `style.css` + `omni-*.css` → `services/*.js` → `modules/*.js` (loaded BEFORE app.js where required) → `app.js` (~36k-line monolith being decomposed) → overlay scripts (`omni-ux-v2.js`, `omni-admin-crud-v2.js`, `omni-language-fix.js`).
- **Backend:** `server.js` (raw Node http, no framework) + `server-jarvis-security.js`. Truth store = **SQLite `database.db`** (WAL); `database.json` is only a thin 8-collection git fallback. Launch via `start.ps1`.
- **Client data:** global `omni` object (bare `omni`, not `window.omni`) + legacy finance via `window.ensureFinance()` + v6 finance via `PentagonDB.getCached()` (a DIFFERENT object from `omni`).
- **~93 pages** registered; Route Health doctor at page key `route_health` validates all of them.
- `erp-local/` is DEAD WEIGHT (a separate FastAPI+React experiment, not wired in). Never touch it, never confuse it for the live app.

### Session protocol (mandatory)

1. Read this file top to bottom. Read `MASTER_ROADMAP.md` §rules if anything is unclear.
2. Find the first unchecked task in §13 Progress Log. That is your task. Do not skip ahead unless the task is marked `[PARALLEL-OK]`.
3. Execute the task per its spec. Do NOT ask the owner anything — the only owner-gated area is §12.
4. Run the Verification Gates (§3) required by the task.
5. Commit (conventional commits, §11.4) and append a row to §13 Progress Log.
6. If blocked > 30 minutes on the same error, write a `BLOCKED:` row in §13 with full detail and move to the next `[PARALLEL-OK]` task.

### The 3 identities rule

Product name is **Octagon** (was Pentagon). Keep `Pentagon`/`pentagon` identifiers as working aliases (e.g. `callOctagonAi` = `callPentagonAi`, `PentagonDB`, `PentagonAuth`). Never rename existing globals.

---

## 1. FROZEN ZONE — THE SMART TIMESHEET (التايم شيت الذكي) 🧊

**The Smart Timesheet is DONE and owner-approved. It is FROZEN.**

You must NOT modify, refactor, extract, restyle, "improve", or re-render-optimize ANY of the following without explicit owner approval recorded in §12:

| Frozen surface | Where |
|---|---|
| Timesheet page + all its render functions | `app.js` timesheet module (page key `timesheet`) |
| Payroll calculation logic (OT, Friday rules, forecast cutoff) | `app.js` payroll/attendance functions |
| Attendance forecast + regression suite | `runAttendanceForecastRegressionTests()` (6/6) |
| `omni.employees` and all attendance/fingerprint data | client + server collections |
| The Workshop Ledger → legacy timesheet bridge (timesheet side) | `modules/workshop-ledger*.js` bridge functions |
| Payroll/shift config elements (`cfg*` ids) | admin Settings tab |

**Allowed interactions with the frozen zone (read-only):**
- Running its regression tests as part of verification gates.
- Reading its data for reports/other modules (never writing).
- Listing improvement *proposals* in §12 (text only, zero code).

**Known invariants you must never violate even indirectly:**
- One `cfg*` element per id — duplicate config ids broke payroll before.
- Never full-render the timesheet on keystroke.
- Friday-OT must not be double-counted.
- Every reload must preserve employees (3-layer fix exists: server preserves, client prefers non-empty localStorage, init skips empty save). Never weaken any layer.
- There are **17 open attendance cases** (missing checkouts, manual-default days) awaiting the owner's business decision — do NOT auto-resolve them.

---

## 2. SAFETY INVARIANTS — HARD RULES FROM REAL PRODUCTION INCIDENTS ⚠️

Every rule below exists because it already burned us once. Violating any of these is a critical failure.

1. **NEVER send a partial/raw `POST /api/db`.** The server replaces collections wholesale (preserves only an allowlist). A partial POST once wiped omni/employees/finance. Write through the app's `saveData()`/`PentagonDB.mutate` paths only. (Recovery if it ever happens: localStorage key `octagon_payroll`.)
2. **NEVER run a second server instance against the live `database.db`.** SQLite WAL + busy_timeout are configured, but a dual-server run corrupted state once. For verification, copy the DB to a scratch dir and run on port **8090** against the copy (the `octagon-verify` recipe, §3.8).
3. **NEVER use PowerShell `Get-Content`/`Set-Content` on the UTF-8 Arabic source files.** It converts Arabic to mojibake (cp1252). Use the Edit/Write tools or Node scripts only.
4. **ADD-ONLY.** Never delete existing modules, pages, functions, or stray files (`hub.html`, `index-v2.html`, etc.) without explicit permission. Extraction (move verbatim, then delete from origin) per the §8 pipeline is the sanctioned exception.
5. **SINGLE-ENTRY RULE.** One window, one `index.html`, one login (`loginOverlay` + `PentagonAuth`). Never create a second app/window/login. New overlays must hide until login passes.
6. **LOCAL-FIRST.** Nothing moves online/cloud. No external services, no telemetry.
7. **`modules/*.css` are NOT auto-loaded** — every new module stylesheet needs a `<link>` in `index.html` `<head>`.
8. **Every new page/tab must self-activate** (the core `pageMap` excludes module pages). Follow the canonical "add a new tab" pattern: `views/` template + marker + pageMap entry + prefetch + navGroup + `switchPage`-wrap (see `modules/pos.js` / `modules/vertical-pharmacy.js` as reference implementations). Route Health does NOT catch a missing self-activation.
9. **Cache-bust after editing `app.js`** — bump the `?v=` query in `index.html` or a stale copy gets served.
10. **v6 finance writes go through `await PentagonDB.mutate(db => {...})`** — never write finance to `omni`. Journals: `j_gen`, `j_sale`, `j_purc`, `j_bank`, `j_payroll` (`j_misc` does NOT exist). `FinanceService.resolveAccount` silently falls back to `'suspense'` on unknown ids — always verify account ids against `PentagonDB.getCached().finance.accounts`.
11. **Legacy finance is NOT `omni.finance`** (that's undefined). Use `const finance = window.ensureFinance()`; write transactions via `window.addFinanceTransaction(tx)`; read via `window.getFinanceTransactions()`.
12. **New AI write-tools must be registered in BOTH gates:** `SERVER_ENFORCED_TOOLS` in `jarvis-brain.js` (client) AND `TOOL_RISK` in `server-jarvis-security.js` (server). Unknown tools fail closed — that is intentional.
13. **NO API keys in client JS, ever.** Keys live only in `octagon-erp/.env` (gitignored). All AI calls go through `/api/ai/chat` and `/api/ai/gemini`.
14. **Module CSS must be scoped** — an unscoped selector once leaked a light-theme `.btn-secondary` globally (white-on-white buttons). Scope with the module's body class; contrast overrides go in `ui-contrast-fix.css`.
15. **`omni.workOrders` belongs to MRP; the workshop chain uses `omni.jobOrders`.** Never mix them.
16. **Inside a module's `ensureData()`**, helpers must read `O().x` directly — calling the ensure-wrapper from inside itself caused infinite recursion (loyalty module incident).
17. **Headless testing:** `confirm()` hangs headless evaluation — stub it (`window.confirm = () => true`) before driving flows. The screenshot service times out on this heavy app — verify via DOM reads, not screenshots.
18. **All UI text is Arabic.** New user-facing strings must be Arabic (RTL-safe). Internal identifiers/comments stay English.
19. **Native `input[type=date]` ignores `lang="ar"`** — the global YYYY-MM-DD hint mechanism already handles this; don't fight the widget.
20. **Jarvis employee reads:** `window.employees` is empty by design — use `JarvisBrain.employeeList()`.

---

## 3. VERIFICATION GATES

Run the gates listed in each task's `Verify:` line. Gate letters below.

### Gate A — Syntax
```bash
node --check app.js && for f in modules/*.js services/*.js; do node --check "$f"; done
```
Expected: zero errors.

### Gate B — Duplicate-function scan
```bash
grep -noE "^(async )?function [A-Za-z0-9_]+" app.js | sed -E 's/.*function //' | sort | uniq -d
```
Expected: **zero output** after Phase 0 completes (T0.4). Any new duplicate = fix before commit.

### Gate C — Route Health
Open the app, navigate to page key `route_health`, run the doctor. Expected: **all categories green, count ≥ 93/93** (never lower than the previous run; new pages raise the target).

### Gate D — Workshop stabilization self-test
Page `deploy_ready` → «🏭 فحص استقرار الورشة» (read-only, 12 checks). Expected: **12/12**. Run after ANY structural edit.

### Gate E — Regression suites (all read-only, safe to run)
- `runAttendanceForecastRegressionTests()` → 6/6 (this is the frozen zone's canary — if it drops, you touched something you shouldn't have; revert immediately).
- Jarvis audit regression suite → 52/52.
- Workshop Ledger suite → 15/15.

### Gate F — Clean boot
Reload the app, check console: **zero errors** (the historical "Octagon startup interrupted" is fixed; it must stay fixed). Verify employees + finance survive the reload.

### Gate G — Commit
Conventional commit created (§11.4), working tree clean, `.env` still untracked.

### 3.8 How to run the app for verification (the safe recipe)
```text
1. COPY database.db (+ -wal/-shm if present) to the scratch dir.
2. Start a second Node server from a COPY of the folder (or with a DB-path override) on port 8090.
3. Drive http://localhost:8090 headlessly. Stub confirm(). Verify via DOM text, not screenshots.
4. Kill the 8090 server when done. NEVER point it at the live database.db.
```
If the live server (default port) is already running, do not start a duplicate on the same DB — see Invariant 2.

---

## 4. PHASE 0 — DEBT CLEARANCE (sequential; one agent; do this before everything)

### T0.1 — Commit all pending work
- **Goal:** The 2026-07-02 checkup fixes (auto-login-as-admin, cashbox bugs, HTML injection, key-leak scrub) and anything else dirty in `octagon-erp/` is sitting uncommitted. Zero uncommitted work may remain.
- **Steps:** `git status` in the repo → group changes into logical conventional commits (`fix: …`, `feat: …`, `chore: …`). Do NOT commit `.env`, `database.db`, `*.log`, backups, `coordination/verify.lock`. Add all of these to `.gitignore` if missing.
- **Verify:** Gate G. `git log --oneline -10` shows clean history.

### T0.2 — Server restart to activate WAL — ✅ DONE 2026-07-12
- **Goal:** WAL + `busy_timeout` were added 2026-07-05 but require a server restart to take effect.
- **Steps:** Gracefully stop the running server (if any), restart via **`node server.js`** (correction: `start.ps1` and `start-all.ps1` are BOTH stale/legacy — `start.ps1` is a pre-SQLite plain-PowerShell static server with zero DB/WAL involvement, `start-all.ps1` launches the dead `erp-local/` experiment; the real launcher is documented in `README.md`/`docs/RELEASE_CANDIDATE_PILOT_CHECKLIST.md` as `node server.js`, port 8080), then confirm WAL via `node:sqlite`'s `DatabaseSync` (server.js's actual driver — NOT `better-sqlite3`):
  `node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('database.db',{readOnly:true});console.log(db.prepare('PRAGMA journal_mode').get());"` → expects `wal`.
- **Note:** In-memory Jarvis grants are voided by restart — that is expected.
- **Verify:** Gate F. Confirmed 2026-07-12: journal_mode=wal, server boots clean, employees=26 intact, finance present.

### T0.3 — API key rotation — ⚠️ OWNER ACTION REQUIRED (the only other owner touchpoint besides §12)
- **Goal:** `OPENROUTER_API_KEY`, `CONTACTBOX_API_KEY`, `GEMINI_API_KEY` were exposed in git history; rotation is manual and only the owner can do it in the provider dashboards.
- **Agent's part:** (a) verify zero key material in any client JS (`grep -rE "sk-|AIza|Bearer [A-Za-z0-9]" --include="*.js" .` excluding node_modules/server-side .env loading); (b) verify `.env` is untracked and gitignored; (c) verify `scrubLeakedKeys()` still runs at boot; (d) leave a single reminder line in §13: `OWNER TODO: rotate 3 API keys`.
- **Verify:** Gate A, G.

### T0.4 — Eliminate the 23 duplicate top-level functions in app.js
- **Goal:** `app.js` has ~23 duplicate `function NAME()` declarations (last-def-wins silently). One already cost the AI dashboard 4 panels. Bring the count to ZERO.
- **The list (as of 2026-07-02):** `renderAdminTabWireUp` (×3, worst), `updateTaskField`, `updateSubtaskTitle`, `toggleTaskManagerView`, `toggleSubtask`, `switchFinanceTab`, `setWaTab`, `saveNewJE`, `reverseJEFromUI`, `renderWhatsAppSimulatorPanel`, `renderWhatsAppIntegrationPage`, `renderTaskManager`, `renderTaskInspectorTab`, `renderOpPacks`, `renderMachinesPage`, `renderMachineInspectorTab`, `renderJournalEntryTab`, `renderAutomationEngine`, `openNewJEModal`, `getAdminWireUpRows`, `escapeHtml`, `editClickupTask`, `deleteSubtask`. Re-run Gate B first — the list may have grown.
- **Proven method (per pair):** read BOTH definitions; the LATER one is live. Diff them. Merge any unique, still-referenced logic from the dead one into the live one. Rename the dead copy `NAME_deprecated_dupN` (add-only — don't delete yet). `node --check app.js`. Smoke-test the page that renders it.
- **Batching:** max 5 functions per commit. Run Gates A+B+C+F per batch.
- **Danger:** `escapeHtml` is used everywhere — merge with extreme care; the surviving version must escape `& < > " '`.
- **Verify:** Gate B returns empty. Gates A, C, D, F, G.

### T0.5 — Register this plan in the canonical roadmap
- **Steps:** Append one line to `MASTER_ROADMAP.md`: a pointer to `AGENT_EXECUTION_PLAN.md` as the active execution layer. Do not duplicate content (single-roadmap-doc rule).
- **Verify:** Gate G.

---

## 5. PHASE 1 — DATA INTEGRITY CORE (Odoo-ORM-inspired) 🏗️

The root cause of every historical data disaster (employee wipes, reload races, partial-POST wipes) is *unvalidated mutation of shared state*. This phase builds the missing boundary.

### T1.1 — `modules/schema-registry.js` — collection schemas
- **Goal:** A lightweight, declarative schema for every major collection — Odoo's field definitions without the ORM weight.
- **Design:**
```js
// modules/schema-registry.js  (loaded in index.html BEFORE app.js)
const OctagonSchema = {
  collections: {
    'omni.customers':   { idField: 'id', required: ['id','name'], types: { name:'string', phone:'string' }, protect: false },
    'omni.jobOrders':   { idField: 'id', required: ['id','state','customerId'], types: { state:'string' }, protect: false },
    'omni.employees':   { idField: 'id', required: ['id','name'], protect: true },   // protect: NEVER accept an empty overwrite
    'finance.accounts': { layer: 'pentagondb', idField: 'id', required: ['id','name','type'] },
    'account_moves':    { layer: 'pentagondb', idField: 'id', required: ['id','journal_id','lines'],
                          validate: (rec) => FinanceService.validateBalanced(rec.lines) },
    // … cover, at minimum: customers, jobOrders, employees(protect), inventory, machines, tasks,
    //   pharmacy.products, subscriptions, tickets, vehicles, documents, assets, members(loyalty),
    //   appointments, surveys, visitors, esign, events, knowledge, peopleOps, finance.accounts, account_moves
  },
  validate(collectionKey, record) { /* returns {ok, errors[]} — never throws */ },
  validateCollection(collectionKey, array) { /* checks emptiness against protect flag + per-record */ }
};
window.OctagonSchema = OctagonSchema;
```
- **Rules:** validation is **warn-first** for 1 week of usage (log to console + `omni.schemaViolations` ring buffer, max 200 entries), then flip `ENFORCE = true` for *new writes only*. Existing bad records are never rejected on read — this is a boundary guard, not a migration.
- **Steps:** Enumerate real collections by reading `app.js` + `modules/*.js` `ensureData` functions (grep `omni\.[a-zA-Z]+ *=` and `ensureMoveCollections`). Write schemas for the top ~25. Wire `<script>` into `index.html` before `app.js`.
- **Verify:** Gates A, C, F, G. Boot with zero schemaViolations for normal navigation.

### T1.2 — Enforce schemas at the two client write choke-points
- **Goal:** All writes funnel through validation.
- **Choke-point 1:** `PentagonDB.mutate` — wrap: after the mutator runs, `OctagonSchema.validateCollection` on touched top-level keys (track via a Proxy or a shallow before/after key diff — keep it cheap). On violation with `ENFORCE=false`: log. With `ENFORCE=true`: reject the mutation (return pre-mutation snapshot) + Arabic toast «تم رفض حفظ غير صالح: …».
- **Choke-point 2:** `saveData()` in `app.js` — before POSTing, run `validateCollection` on protected collections (employees above all). An empty-array write to a `protect:true` collection is ALWAYS rejected, even in warn mode — this codifies the existing 3-layer employee protection as schema law.
- **Constraint:** do not slow the hot path — validation must be O(records-changed), never full-DB on every keystroke. NEVER add validation inside timesheet render/keystroke paths (frozen + perf invariant).
- **Verify:** Gates A, C, D, E (all suites — especially attendance 6/6), F, G. Manual: attempt a bad write from console → warn logged.

### T1.3 — Server-side write guard in `server.js`
- **Goal:** The server currently accepts collection-replacing POSTs (Invariant 1's root cause). Make the server defend itself.
- **Steps:** In the `/api/db` write path: (a) reject any payload that would replace a non-empty protected collection (employees, finance, account_moves, jobOrders) with an empty/missing one — respond `409` with a JSON body naming the collection; (b) log every rejected write to `server-write-guard.log`; (c) add `X-Octagon-Full-Sync: yes` header requirement for full-DB replacement writes so the app's own `saveData` (updated to send it) keeps working but naive probes bounce. Read `server.js`'s existing preserve-allowlist first and BUILD ON it, don't replace it.
- **API envelope (ECC):** while in the file, ensure new/modified endpoints respond `{ ok, data, error }` consistently. Do not rewrite existing endpoints' shapes (add-only).
- **Verify:** Gates A, F, G + manual: a raw `curl -X POST /api/db -d '{"omni":{}}'` against the **8090 copy** (never live) returns 409 and destroys nothing.

### T1.4 — `modules/sequence-service.js` — unified document numbering (Odoo `ir.sequence`)
- **Goal:** One service issues all document numbers: `INV-2026-00042`, `JOB-2026-0117`, `TKT-…`, `SR-…`, visitor badges, etc.
- **Design:** `OctagonSeq.next(code)` → server `POST /api/sequence/next {code}` → SQLite table `sequences(code, prefix, padding, next_number)` with the increment inside a transaction (race-safe). Client falls back to a localStorage counter with an `OFFLINE-` prefix marker if the server is unreachable (never silently reuse numbers).
- **Adoption:** NEW documents only. Existing numbering call sites keep working (add-only); migrate a call site only when you're already inside that module for another task.
- **Verify:** Gates A, F, G + unit: two rapid parallel `next('inv')` calls on the 8090 copy return distinct numbers.

### T1.5 — Nightly local backup + verify loop (uses existing endpoints)
- **Goal:** `/api/backup` exists; `/api/backup/verify` fails on stale backups by design. Automate: create → verify → prune (keep last 14).
- **Steps:** Implement inside the Phase-3 scheduler if it exists already; otherwise a minimal `setInterval` in `server.js` (24h) calling the same internal functions. Log to `server-backup.log`.
- **Verify:** Gates A, F, G + trigger once manually and confirm verify passes.

---

## 6. PHASE 2 — FINANCIAL HARDENING 💰

### T2.1 — Fiscal period lock (Odoo lock-date)
- **Goal:** Nobody can post, edit, or reverse a journal move dated inside a locked period. Protects historical P&L.
- **Design:** Setting `finance.lockDate` (ISO date) stored via `PentagonDB.mutate`. `FinanceService.createMove` and `cancelMove` reject when `move.date <= lockDate` → Arabic error «الفترة المالية مقفلة حتى …». Manager-role override deliberately NOT implemented (owner is the only manager; unlocking = changing the date in settings).
- **UI:** One field + button in the finance settings area (new small section; do not restructure the finance page). Show current lock date prominently in the journal entries tab.
- **Frozen-zone note:** payroll posting from the Workshop Ledger respects the lock like everything else — but do NOT modify ledger code beyond the shared `FinanceService` gate (the gate lives in FinanceService, so no ledger edits needed).
- **Verify:** Gates A, C, E (ledger 15/15 must still pass — post-dated test entries must be after any lock you set during testing; reset lockDate to empty after tests), F, G.

### T2.2 — Fix the known `customer_charge` bridge bug (roadmap Phase-6 #21)
- **Goal:** `syncLegacyTransactionToV6` maps `customer_charge` through the *expense* branch — wrong v6 journal for receivables (legacy balances are fine; v6 mirror is wrong).
- **Steps:** Read `syncLegacyTransactionToV6` fully. Route `customer_charge` to a receivable entry: debit `receivables_customers`, credit `income_sales`, journal `j_sale`. Add a one-off, **idempotent** repair function `repairCustomerChargeMoves()` (manual trigger from finance settings, not automatic) that finds mis-journaled historical moves and posts correcting reversals via `cancelMove` + re-post — never mutates posted moves in place.
- **Verify:** Gates A, E, F, G + on the 8090 copy: create a `customer_charge` via `addFinanceTransaction`, confirm the v6 move debits receivables in `j_sale`; run trial-balance check (T2.4).

### T2.3 — `modules/change-tracker.js` — chatter-lite (Odoo `mail.thread`)
- **Goal:** Per-record change history for accountability: who, when, field, old→new.
- **Design:** `TrackChanges.record(collection, id, patch, actor)` appends to `omni.changeLog` (ring buffer, cap 5,000 entries, oldest evicted). Wire it into `PentagonDB.mutate`'s validation wrapper (T1.2) for pentagondb-layer collections and into the admin CRUD save paths for omni-layer ones. Reader UI: a small «سجل التغييرات» drawer component callable from any record modal — implement the component + wire it into finance moves and jobOrders first; other modules adopt opportunistically.
- **Exclusions:** timesheet/attendance/employees payroll edits are NOT wired (frozen zone) — their existing audit stays as-is.
- **Verify:** Gates A, C, F, G.

### T2.4 — Trial-balance assertion in the test arsenal
- **Goal:** A read-only check: sum(debits) − sum(credits) over all `account_moves` = 0, and no lines pointing at `'suspense'`.
- **Steps:** `runTrialBalanceCheck()` in `modules/finance-selftest.js`; surfaces count of moves, imbalance (must be 0), suspense-line count (report only — historical suspense lines are findings for the owner, not auto-fixes). Register it in the §9 unified runner.
- **Verify:** Gates A, F, G + the check itself passes (imbalance = 0) on live data; if it does NOT pass, record the finding in §13 and continue (repair is owner-decision territory).

---

## 7. PHASE 3 — PLATFORM SERVICES (Odoo `ir.cron` / `base_import` / `ir.model.access`) 🧰

Tracks A–D are `[PARALLEL-OK]` relative to each other (different agents may take different tracks), but all depend on Phase 1.

### Track A / T3.1 — Server-side scheduler (`ir.cron` equivalent)
- **Goal:** Time-based business logic currently only fires when someone opens the right page. Move it server-side.
- **Design:** `server-scheduler.js` (new file, required by `server.js` after init). A jobs table in SQLite: `cron_jobs(code, interval_hours, last_run, enabled)`. Every 15 min the loop checks due jobs. Jobs are **notification-generators, not mutators** — they write to a server-owned `scheduled_alerts` collection that the client's command center renders; they do NOT post finance moves or change business records autonomously (AI-governance philosophy: deterministic-first, approval-gated writes).
- **Initial jobs:** (1) subscription dunning-draft generation; (2) vehicle/document/asset expiry alerts (30/14/3-day thresholds); (3) preventive-maintenance due alerts; (4) nightly backup+verify (absorbs T1.5); (5) daily Route-Health-style server self-check (collections readable, DB size, WAL checkpoint).
- **Client:** command center gets a «تنبيهات مجدولة» feed reading `scheduled_alerts` (read-only render; dismiss = flag update).
- **Verify:** Gates A, C, F, G + force-run each job once on the 8090 copy via a `POST /api/cron/run {code}` dev endpoint.

### Track B / T3.2 — Universal CSV/Excel import wizard (`base_import` equivalent)
- **Goal:** One generic import flow for any schema-registered collection: choose collection → paste/upload CSV → column mapping UI → preview 20 rows with validation results → confirm → write through the standard mutate path.
- **Design:** `modules/import-wizard.js` + `modules/import-wizard.css` (linked!). New page key `import_center` («استيراد البيانات»), following the §2.8 new-tab pattern. Parsing: hand-rolled CSV parser (quoted fields, UTF-8 BOM tolerant) — no new dependencies (local-first). Mapping presets saved to `omni.importPresets`. Every imported record passes `OctagonSchema.validate`; failures shown per-row in Arabic; partial imports allowed with an explicit «استيراد الصالح فقط» choice.
- **Hard exclusion:** `omni.employees` and attendance collections are NOT importable through this wizard (frozen zone) — hide them from the collection picker.
- **Verify:** Gates A, C, D, F, G + import a 10-row customer CSV on the 8090 copy end-to-end.

### Track C / T3.3 — Role × collection ACL, server-enforced (`ir.model.access` equivalent)
- **Goal:** Today any logged-in UI user reaches everything; only AI tools are gated. Add a coarse permission matrix.
- **Design:** `acl.json` (server-owned, like `server-ai-approvals.json`): `{ role: { collectionGroup: "read"|"write"|"none" } }` with groups `finance`, `hr_payroll`, `operations`, `crm`, `admin`. Server: on `/api/db` writes, resolve session role (`PentagonAuth` session already syncs via `/api/auth/login`) and strip/reject collection groups the role can't write (reuse the T1.3 guard machinery). Client: `Acl.can('finance','write')` helper; modules *may* hide buttons with it, but **the server check is the real gate** — client hiding is cosmetic and adopted opportunistically.
- **Default matrix:** `manager` = write-all; `employee` = write operations/crm, read finance, **none** hr_payroll; `viewer` = read-all. Owner can edit `acl.json` by hand later.
- **Verify:** Gates A, F, G + on the 8090 copy: employee-role session attempting a finance write gets stripped + logged; security-reviewer agent pass over the diff (§11.2).

### Track D / T3.4 — Unified document-state registry (Odoo statusbar)
- **Goal:** Every stateful document type declares its states + legal transitions in one place; illegal jumps are rejected.
- **Design:** `modules/state-registry.js`:
```js
const OctagonStates = {
  jobOrder:     { states: ['draft','confirmed','in_progress','qc','rework','ready','delivered','closed','cancelled'], /* mirror the EXISTING 12-state machine exactly — read modules/work-orders.js first, do not invent */ },
  ticket:       { states: ['new','open','pending','resolved','closed'], transitions: {...} },
  subscription: { ... }, invoiceDraft: { ... }, leaveRequest: { ... }, maintenance: { ... },
};
OctagonStates.transition(type, record, toState) // returns {ok, error} — never throws, never mutates on failure
```
- **Adoption rule:** the registry MIRRORS existing behavior first (extract each module's real states verbatim), then modules are pointed at `transition()` one by one — behavior-preserving refactor, each module = one commit. Any module whose states are ambiguous: document what you found in §13, mirror as-is, move on.
- **Verify per module:** Gates A, C, D, F, G + drive that module's happy path on the 8090 copy.

---

## 8. PHASE 4 — DE-MONOLITH `app.js` (ECC file-organization) 📦

**Target:** `app.js` from ~36k lines down to < 20k, using the sanctioned GO-16 extraction pipeline. New code NEVER lands in `app.js`.

### The pipeline (per extraction batch — proven, do not improvise)
1. Pick ONE cohesive module from the priority list below.
2. Copy its functions **verbatim** into `modules/<name>.js` (no refactoring during the move — move ≠ improve).
3. Add the `<script>` tag in `index.html` BEFORE `app.js` (or after, matching the functions' dependency direction — read call sites first).
4. Delete the originals from `app.js` (this deletion is the sanctioned add-only exception).
5. `node --check` both files. Bump `?v=`.
6. Smoke-test every moved page render with stubbed runtime globals.
7. Run Gates A, B, C, D, F. Commit: `refactor: extract <name> from app.js (N lines)`.

### Priority order (biggest cohesive wins first, frozen zone excluded)
1. WhatsApp module (`renderWhatsAppIntegrationPage` cluster — freshly de-duped in T0.4)
2. Task manager cluster
3. Machines + machine-inspector cluster
4. Finance UI tabs (journal-entry UI only — `FinanceService` core stays where it lives)
5. Admin wire-up cluster
6. Automation engine
7. Op-packs, QC center, SOP, kanban, cashbox, analytics… continue down `MASTER_ROADMAP.md`'s module inventory.

**NEVER extract:** timesheet, payroll/attendance, employee_ui payroll parts (frozen zone), and anything `omni-language-fix.js` monkey-patches by name (check first with grep).

**Cadence rule:** one extraction batch per session maximum, always leaving Gates green. A half-extracted module is worse than an unextracted one — never end a session mid-pipeline.

---

## 9. PHASE 5 — UNIFIED TEST RUNNER + PRE-COMMIT (ECC testing/security) ✅

### T5.1 — `system_check` page — one button runs the whole arsenal
- **Goal:** Aggregate every existing self-test into one page with a single «فحص شامل» button and a pass/fail matrix.
- **Suites to wire (all exist already):** Route Health (≥93), workshop stabilization (12), attendance forecast regression (6 — read-only frozen-zone canary), Jarvis audit regression (52), Workshop Ledger (15), handler-wiring audit (the static 2-phase onclick/onchange scan), trial-balance check (T2.4), schema-violations report (T1.1), duplicate-function count (client-side re-implementation of Gate B via a fetch of app.js + regex).
- **Design:** `modules/system-check.js` + page key `system_check`, new-tab pattern per §2.8. Results table: suite / نتيجة / مدة / تفاصيل. Export report as JSON download. Every suite runs sandboxed in try/catch — one crashing suite must not kill the run.
- **Verify:** Gates A, C, D, F, G — and the new page itself reports all-green.

### T5.2 — `scripts/precommit.js` + git hook
- **Goal:** Codify our actual historical failure modes as mechanical checks.
- **Checks (exit non-zero on any hit):**
  1. Secret patterns in staged files: `AIza[A-Za-z0-9_\-]{30,}`, `sk-[A-Za-z0-9]{20,}`, `Bearer [A-Za-z0-9\-_\.]{20,}`, `OPENROUTER_API_KEY *= *['"]`.
  2. New duplicate top-level functions in `app.js` (Gate B logic, compare against a committed baseline file `scripts/dup-baseline.txt` which after T0.4 contains nothing).
  3. `node --check` on every staged `.js`.
  4. Staged `.env` or `database.db` → hard fail.
  5. New `innerHTML =` assignments whose right side contains `${` without a wrapping `escapeHtml(` → warn (list them; fail only if the file is in `modules/` — new code must be clean; legacy app.js hits are warnings).
- **Hook:** `.git/hooks/pre-commit` (a 3-line sh shim calling `node scripts/precommit.js`) + a `chore:` commit documenting how to reinstall it (hooks don't travel with clones).
- **Verify:** Gate G + deliberately stage a fake key in a scratch file → hook blocks → unstage.

### T5.3 — Headless boot smoke script
- **Goal:** `scripts/smoke-boot.js` — starts the 8090-copy recipe, loads the app headless, stubs `confirm`, waits for login overlay, logs in with the test account, asserts: zero console errors, employees count > 0, `route_health` reachable. Exits 0/1. This becomes the fast Gate F automation.
- **Verify:** run it twice back-to-back (idempotence), Gates A, G.

---

## 10. PHASE 6 — UNIFIED SETTINGS + REPOSITORY LAYER 🎛️

### T6.1 — System Settings page (planned consolidation, roadmap item)
- **Goal:** One «إعدادات النظام» page (key `system_settings`, §2.8 pattern) consolidating scattered config: finance lock date (T2.1), sequences admin (T1.4 prefixes/padding), scheduler job toggles (T3.1), ACL viewer (T3.3, read-only render of acl.json), import presets (T3.2), theme/skin picker (existing THEMES system — link, don't move), schema-enforcement toggle (T1.1).
- **⚠️ Payroll/shift config (`cfg*` controls):** these stay physically in the admin tab (frozen zone). In the new settings page render a read-only summary card «إعدادات الرواتب والدوام (للقراءة)» + a link that navigates to the existing admin tab. Moving or duplicating the actual controls requires owner approval → it is listed as proposal P5 in §12.
- **Funnel rule (standing, from roadmap):** every NEW config any future module introduces registers a section here via `SystemSettings.registerSection(id, title, renderFn)` — build that registration API now.
- **Verify:** Gates A, C, D, E (attendance 6/6 — proves the cfg* area untouched), F, G.

### T6.2 — `modules/repo.js` — repository facade for NEW code (ECC repository pattern)
- **Goal:** Stop the 3-way data-access sprawl (`omni.x` / `PentagonDB.getCached()` / `ensureFinance()`) from growing.
- **Design:** `Repo.get(key)` / `Repo.list(key, filter)` / `Repo.save(key, record)` / `Repo.remove(key, id)` — a thin facade that routes to the correct layer per the schema registry's `layer` field, applies `OctagonSchema.validate` + `TrackChanges.record` + ACL check, and uses the right persistence call. It wraps existing paths; it does NOT migrate them.
- **Standing rule (append to §2 as invariant 21 when done):** all NEW modules use `Repo.*`; existing modules migrate only when already being touched.
- **Verify:** Gates A, F, G + unit exercise of each layer routing on the 8090 copy.

---

## 11. AGENT ORCHESTRATION & WORKING RULES 🤖

### 11.1 Sequencing map
```
PHASE 0 (sequential, blocking everything)
   └─► PHASE 1 (sequential: T1.1 → T1.2 → T1.3; T1.4, T1.5 parallel-ok after T1.1)
          ├─► PHASE 2 (sequential: T2.1 → T2.2 → T2.3 → T2.4)
          ├─► PHASE 3 (Tracks A,B,C,D parallel-ok; each track internally sequential)
          └─► PHASE 4 (one extraction batch per session, interleave freely with 2/3/5)
                 └─► PHASE 5 (T5.1 after Phase 2+3 suites exist; T5.2, T5.3 anytime after Phase 0)
                        └─► PHASE 6 (last: it consolidates everything before it)
```

### 11.2 Agent roles per task type
| Situation | Agent |
|---|---|
| Any task in this plan (default executor) | general-purpose Sonnet agent following this file |
| After completing any task that wrote code | **code-reviewer** pass over the diff; fix CRITICAL/HIGH before commit |
| T1.3, T3.3, T5.2, anything in `server.js`/`server-jarvis-security.js`/auth | **security-reviewer** pass, mandatory |
| A gate fails and the fix isn't obvious in 30 min | **debugger / build-error-resolver**, then resume |
| Ambiguity about existing behavior | **code-explorer** (read-only) BEFORE writing — never guess at app.js behavior |

### 11.3 Parallel execution rules
- Max ONE agent inside `app.js` at a time (merge conflicts in a 36k-line file are unrecoverable). Phase-3 tracks touch only their own new `modules/*` files + small `index.html`/`server.js` additions — coordinate `index.html` `<link>`/`<script>` insertions by appending only (each agent appends its own lines; never reorder others').
- The live server is a shared singleton — verification always on the 8090 copy (§3.8).

### 11.4 Commit convention (ECC git-workflow)
```
<type>: <arabic-or-english summary, imperative>

types: feat | fix | refactor | chore | test | docs | perf
one logical change per commit; gates green before every commit;
never commit .env, database.db, *.log, backups.
```

### 11.5 Multi-vendor rotation protocol (Claude / Codex / Gemini / Hermes)

This plan is executed by agents from DIFFERENT vendors. None of them share memory — **this file + git history are the only shared context.** Rules:

**Role assignment (fixed, do not improvise):**
| Vendor | Role | Allowed surfaces |
|---|---|---|
| Claude (Sonnet) | Surgeon | `app.js`, `server.js`, `server-jarvis-security.js`, auth — all high-risk sequential tasks (Phase 0, 1, 2, 4) |
| Codex (GPT) | Second builder | Phase 3 parallel tracks + Phase 5/6 greenfield `modules/*.js` files ONLY. Never edits `app.js` or server files |
| Gemini (Flash/Pro) | Verifier / reviewer | Read-only: runs Gates on the latest commit, code-review passes, writes §13 rows, §12 proposal drafting. Pro tier may take small greenfield modules if both builders are quota-exhausted |
| Hermes | Reserve | Arabic UI strings review, test-data generation (CSV fixtures), §12 proposal text. NEVER touches server files or `app.js` |

**Concurrency — UNLIMITED agents via the LANE system (v2, supersedes the old 2-agent limit):**
The full mechanics live in `AGENT_PROMPT.txt` (lane list + claim algorithm) and `coordination/README.md` (lock formats). Summary of the guarantees:
1. Every lane owns a DISJOINT set of files. LANE-A (backbone) is the ONLY writer of the shared files (`app.js`, `server.js`, `server-jarvis-security.js`, `index.html`, `MASTER_ROADMAP.md`, §13 of this file) and runs exactly one agent at all times.
2. All other lanes write only their own new `modules/*` / `scripts/*` files; any needed one-line edit to a shared file is appended to `coordination/integration-queue.md` and applied by LANE-A at its session start/end.
3. Task locking = one claim file per task in `coordination/claims/` (create+commit to claim; DONE/BLOCKED/HANDOFF states; 24h staleness takeover). Two agents claiming the same task produce a git collision — the loser picks the next lane. Zero-conflict by construction.
4. Git discipline (single shared working tree): add/commit by explicit paths ONLY; never `git add .`/`-A`/`commit -a`/`stash`; dirty files of another lane are invisible.
5. The 8090 verification server is a singleton guarded by `coordination/verify.lock` (runtime-only, gitignored, 30-min staleness). Agents that can't verify mark gates `deferred`; LANE-V verifiers sweep deferred gates.
6. §13 in this file becomes a human-readable SUMMARY maintained by LANE-A/LANE-V from the claim files; the claim files are the source of truth.

**Quota-exhaustion relay:**
- Finish-then-switch: NEVER hand a half-done task across vendors. If quota dies mid-task: commit whatever is syntactically valid (`node --check` green) with `wip:` prefix, set the task's claim file to `status: HANDOFF` with exact state + next step, and the successor (same-lane, any vendor) resumes from that claim file FIRST before taking anything new.
- When Claude quota is exhausted, Surgeon-role tasks PAUSE (they do not transfer to Codex/Gemini/Hermes). Work continues on Builder/Verifier tasks until quota resets.
- Do not burn Claude quota on verification or log-writing — that is Gemini's job.

**Vendor-capability caveats:**
- Non-Claude agents may lack some tools (browser drivers etc.). All Gates are runnable with plain `node`, `git`, `grep`, and a headless fetch — if a vendor cannot run Gate C/D/F (needs the app), it marks the row `gates deferred` and the next Verifier session runs them BEFORE any new commit lands on top.
- Every vendor MUST respect §1 (frozen timesheet) and §2 (invariants) verbatim — these are not Claude-specific conventions, they are system law.

### 11.6 What agents must NEVER do (recap)
- Touch the frozen zone (§1) — the attendance 6/6 suite is the tripwire.
- Ask the owner questions (except the two marked owner touchpoints: T0.3 key rotation, §12 approvals).
- Start a second server on the live DB, raw-POST `/api/db`, use PowerShell on source files.
- Delete anything outside the sanctioned extraction pipeline.
- Add npm dependencies (local-first, zero-dependency discipline in the live app).
- Create new top-level `.md` docs (single-roadmap rule) — progress goes in §13 of THIS file.

---

## 12. TIMESHEET IMPROVEMENT PROPOSALS — ⛔ OWNER VERIFICATION REQUIRED ⛔

**Nothing in this section may be implemented until the owner writes an explicit approval next to the item.** Agents: you may APPEND new proposals here (text only); you may never start one.

| # | Proposal | Why | Risk if done wrong | Owner decision |
|---|---|---|---|---|
| P1 | **Payroll month lock** — after a month's payroll is finalized, freeze its attendance records (mirrors T2.1 fiscal lock) | Prevents silent retroactive edits to paid months | Blocks legitimate corrections; must include an owner-only unlock | ☐ approve / ☐ reject |
| P2 | **Resolution UI for the 17 open cases** — a screen listing each missing-checkout/manual-default day with one-click rulings (per owner's policy decisions) | The 17 cases currently need manual DB-level handling | Wrong default policy could miscalculate wages | ☐ approve / ☐ reject |
| P3 | **Signed monthly PDF export** — printable per-employee month sheet with totals + a hash footer for tamper-evidence | Paper trail for disputes | None to calc logic (read-only), but render code lives near frozen code | ☐ approve / ☐ reject |
| P4 | **Fingerprint anomaly alerts** — surface the existing read-only Jarvis audit findings (impossible sequences, duplicate punches) as a passive command-center card | The audit exists; nobody sees it unless they ask Jarvis | Alert fatigue if thresholds wrong | ☐ approve / ☐ reject |
| P5 | **Move payroll/shift `cfg*` controls into the new System Settings page** (T6.1 currently renders them read-only) | One place for all config | The cfg* duplicate-id class of bug broke payroll before | ☐ approve / ☐ reject |
| P6 | **Timesheet change-tracker wiring** — extend T2.3 chatter to attendance edits (who changed which day) | Accountability on the most sensitive data | Write-path touch on frozen collections | ☐ approve / ☐ reject |

---

## 13. PROGRESS LOG (append-only; one row per task per session)

| Date | Agent/session | Task | Result | Gates run | Commit | Notes |
|---|---|---|---|---|---|---|
| 2026-07-12 | plan authored (Fable 5) | — | Plan created | — | — | OWNER TODO: rotate 3 API keys (T0.3) |
| 2026-07-12 | claude-sonnet-5 (LANE-A) | T0.1 | DONE | A pass, G pass; C/D/E/F deferred (no 8090 copy stood up) | ec0ed7f..b94997a (21 commits) | Zero uncommitted work remains. Archive move verified against ARCHIVE_MANIFEST.md before staging. FLAGS for owner: (1) new duplicate `renderAttendanceCalendar` in app.js beyond T0.4's 23-name list, confirmed independently by LANE-V codex's Gate B fail — fold into T0.4. (2) database.json shows payroll periods 2026-05/2026-06 reverted from posted/paid to draft with closings removed, replaced by a new 2026-04 draft calc — not modified, surfaced for owner review (§1). |
| 2026-07-12 | claude-sonnet-5 (LANE-A) | T0.2 | DONE | F pass (journal_mode=wal confirmed, clean boot, employees=26 + finance intact) | — (no product-file diff; started server + fixed this file's stale launch instructions) | Corrected T0.2's own launch instructions (start.ps1 -> node server.js) and driver (better-sqlite3 -> node:sqlite) — see updated task text above. No server was running beforehand; started `node server.js`, left it running. |
| 2026-07-12 | claude-sonnet-5 (LANE-A) | T0.3 | DONE (agent part only) | A pass (grep-based) | — (verification only) | Verified: no key-shaped material in client JS; .env gitignored+untracked; scrubLeakedKeys() active on every AI-config read. Key rotation itself remains OWNER TODO (needs provider dashboard access). |

**BLOCKED format:** `| date | session | task | BLOCKED | gates | — | full error + what was tried |`

---

## APPENDIX A — File map (verify on first session; memories age)
```
octagon-erp/
├── index.html                    ← THE single entry (canonical; other .html files are strays, keep but ignore)
├── app.js                        ← ~36k-line monolith (Phase 4 shrinks it; ?v= cache-bust on edit)
├── server.js                     ← raw Node http; SQLite database.db is truth; database.json = thin fallback
├── server-jarvis-security.js     ← AI tool gate + key proxy (/api/jarvis/*, /api/ai/*)
├── .env                          ← keys (gitignored, NEVER commit/print)
├── start.ps1                     ← launch script
├── style.css, omni-*.css, ui-contrast-fix.css
├── services/*.js                 ← loaded before app.js
├── modules/*.js + *.css          ← ALL new code lives here (css needs manual <link>)
├── views/                        ← page templates (hydrated via ensurePageTemplateLoaded — has in-flight Set guard)
├── jarvis-brain.js, ai-governance.js, ai-providers.js, omni-*.js
├── MASTER_ROADMAP.md             ← canonical doc; archive/ holds consolidated old docs
└── erp-local/                    ← DEAD — never touch
```

## APPENDIX B — Data layer cheat sheet
| Data | Access | Notes |
|---|---|---|
| Operational collections | bare `omni.*` | customers, jobOrders (workshop!), employees (FROZEN), inventory, machines, tasks, pharmacy, tickets, vehicles, documents, assets, members, appointments, surveys, visitors… |
| Legacy finance | `window.ensureFinance()` returns it | `omni.finance` is UNDEFINED. Write via `addFinanceTransaction`, read via `getFinanceTransactions` |
| v6 double-entry | `PentagonDB.getCached()` / `PentagonDB.mutate` | accounts at `.finance.accounts`, moves at `.account_moves`; journals `j_gen/j_sale/j_purc/j_bank/j_payroll` |
| AI approvals/audit | server-owned files | `server-ai-approvals.json`, `server-ai-audit.log` — immune to client writes |
| Employees for AI | `JarvisBrain.employeeList()` | `window.employees` is empty by design |

## APPENDIX C — Definition of DONE for the whole plan
1. §13 shows every task ✅ with gates green; zero BLOCKED rows unresolved.
2. Gate B permanently empty; `app.js` < 20k lines.
3. `system_check` page: one click → all suites green (Route Health ≥ 93, stabilization 12/12, attendance 6/6, Jarvis 52/52, ledger 15/15, trial balance 0, handler audit clean).
4. Pre-commit hook active; clean `git log` of conventional commits; `.env` untracked; owner has rotated keys.
5. Server rejects partial-DB probes and unauthorized-role writes; sequences, scheduler, import center, ACL, state registry, settings page, Repo facade all live.
6. The Smart Timesheet byte-identical to today unless the owner approved a §12 item.
