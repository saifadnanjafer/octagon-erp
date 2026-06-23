# OCTAGON ERP / OMNISYSTEM — Active Handoff

> **Single source of truth = `MASTER_ROADMAP.md`** (read that first). This README is the *active handoff* — the short, current-state sheet you read at the start of every session.

---

## Where we are (2026-06-14)

**Latest add (2026-06-14): Server/API Tenant Enforcement.** `server.js` now protects direct persistence endpoints when multi-tenant mode is enabled. `/api/record` stamps active-company records and blocks foreign-company upserts; `/api/collection` preserves omitted foreign-company rows during collection replacement and blocks explicit foreign creates; `/api/db` applies the same protection across registered tenant collections and preserves missing tenant collections from the existing DB. Added a temp-database HTTP smoke (`scripts/test-server-tenant-api.mjs`) plus `OCTAGON_DB_FILE`, `OCTAGON_SQLITE_DB_FILE`, `OCTAGON_BACKUP_DIR`, and `USE_SQLITE=false` test hooks so server writes can be tested without touching live data. Browser Route Health remains **66/66 nav · 66/66 pages · 8/8 globals · 14/14 functions · 13/13 collections · 1/1 work-order links**, 0 console errors.

**Latest add (2026-06-14): Tenant Service Enforcement.** Added `services/tenantService.js` and wired the V5 services through it. `RecordService` now stamps creates, scopes reads/searches, and blocks foreign-company updates when multi-tenant mode is enabled. `FinanceService` now stamps/scopes moves, payments, reconciliations, reports, ledgers, open items, and blocks cross-company posting/reconciliation. `StockService` now stamps/scopes quants, stock moves, lots, transfers, valuations, and release/validate/cancel paths. The Multi-Entity UI delegates its tenant primitives to `TenantService` when present. Verified with `node scripts/test-v5-services.mjs` plus browser Route Health: **66/66 nav · 66/66 pages · 8/8 globals · 14/14 functions · 13/13 collections · 1/1 work-order links**, 0 console errors.

**Latest add (2026-06-13, browser-verified 2026-06-14): Multi-Entity Tenant Isolation Control Center.** `modules/multi-entity.js` now has a fourth tab **عزل البيانات** for multi-company readiness: it scans shared ERP collections, shows active-company / foreign-company / unstamped rows, and can safely stamp missing `companyId` rows to the active company without deleting or moving data. New shared API: `OctagonTenant` / `PentagonTenant` (`scope`, `stamp`, `summary`, `claimMissing`, `claimAllMissing`, etc.), and `window.scoped()` now delegates to it. Procurement and Approvals now stamp new POs, suppliers, approval requests, demo rows, edited/cancelled approvals, and approval→PO links with the active company; cancel/reject flows use Omni modals/prompts instead of native dialogs. Validation completed: syntax + encoding clean, touched paths have no native prompt/confirm calls, tenant tab renders, and Route Health is clean at **66/66 nav · 66/66 pages · 8/8 globals · 14/14 functions · 13/13 collections · 1/1 work-order links**, with 0 console errors.

**Previous 2026-06-13 batch: Procurement, Projects, Approvals, Field Service, Rental + cross-module handoffs.** The new universal pillars raised the app to the 66-page scale: dedicated Purchase/PO front door over the existing PO engine, Project Management, human Approvals, Field Service visits, Equipment Rental, then Approvals→Procurement and Helpdesk→Field Service one-click links. See `MASTER_ROADMAP.md` §6 for exact APIs and verification notes.

**Latest add (2026-06-12): Marketing/Campaigns + Budgeting.** **Marketing** (📣 التسويق والحملات — `modules/marketing.js`: campaigns across channels with budget/spend/leads/conversions/revenue → ROI, CPL, conversion-rate dashboard) and **Budgeting** (🧮 الموازنات — `modules/budgeting.js`: budget lines per scope/period/department vs **real actuals read from `window.getFinanceTransactions()` — read-only**, variance + over-budget alerts). Both were 0-occurrence gaps. **Route Health now 61/61 nav · 61/61 pages**, 0 console errors; marketing ROI math verified exact, budgeting actuals read-only. Registry entries in `MASTER_ROADMAP.md` §6.

**Earlier batch (2026-06-12): four more missing ERP pillars + two HR tabs.** Built **Helpdesk / Support Tickets** (🎫 خدمة العملاء — `modules/helpdesk.js`: tickets, priority-based SLA, assignment, resolution), **Fleet Management** (🚚 المركبات — `modules/fleet.js`: vehicles, fuel/trip logs, license & insurance expiry alerts), **Document Management/DMS** (🗂️ الوثائق — `modules/documents.js`: licenses/contracts/certs registry with expiry alerts), and extended **People Ops** to 5 tabs by adding **Expense Claims** (reimbursement posts debit expense / credit payables_people via the bridge — manager-confirmed) and **Performance Appraisal**. All were 0-occurrence gaps. **Route Health now 59/59 nav · 59/59 pages**, 0 console errors; finance-touching paths verified live (expense reimbursement v6 move 25,000 balanced) and all test data removed. Registry entries in `MASTER_ROADMAP.md` §6.

**Earlier (2026-06-12): People Operations — Recruitment (ATS) + Leave/Time-off (الموارد البشرية) — `modules/people-ops.js`.** Two HR pillars Octagon had zero of (`recruitment`/`applicant` = 0): job openings + candidate pipeline (applied→screening→interview→offer→hired/rejected) with ratings and one-click stage moves; leave requests (annual/sick/unpaid/emergency) with approve/reject and a 21-day annual-balance table. **Self-contained in `omni.peopleOps` — never touches payroll/timesheet** (hire just records the decision; the manager adds the employee on the Employees page). Nav 🧑‍💼 **التوظيف والإجازات**. **Route Health now 56/56 nav · 56/56 pages**, 0 console errors; verified live (stage move, leave approve, balance 21−4=17) and test data removed. Registry entry in `MASTER_ROADMAP.md` §6 (`people_ops`).

**Also (2026-06-12): Subscriptions & Recurring Billing (الاشتراكات والفوترة الدورية) — `modules/subscriptions.js`.** The SaaS/ERP recurring-revenue pillar Octagon had zero of (`subscription` was 0 occurrences): plans (monthly/quarterly/yearly), subscriptions with pause/resume/cancel, recurring invoicing that posts `customer_charge` (debit AR / credit income) through the proven finance bridge, mark-paid that settles the AR, MRR/ARR dashboard, renewal alerts, and copyable Arabic dunning drafts (never auto-sent). Pairs with the assets module for annual maintenance contracts. Nav 🔁 **الاشتراكات** (raised Route Health to 55/55 at the time; now 56/56 with people_ops). Invoice→AR→income chain verified live (v6 move debit `receivables_customers`/credit `income_sales`) and all test data removed. Registry entry in `MASTER_ROADMAP.md` §6 (`subscriptions`).

**Also (2026-06-12): Fixed Assets & Preventive Maintenance (الأصول والصيانة الوقائية) — `modules/asset-maintenance.js`.** A new universal-ERP pillar Octagon had zero of (`depreciation`/`warranty` were 0 occurrences before): depreciable asset register, straight-line depreciation with manager-gated non-cash GL posting (debit مصروف إهلاك / credit مجمع إهلاك), warranty expiry alerts, preventive-maintenance scheduling + log, one-click import from `omni.machines`, and a `report_assets_today` Jarvis tool. Add-only, behind the single login, nav 🏷️ **الأصول والصيانة** (raised Route Health to 54/54 at the time; now 55/55 with subscriptions). GL post verified balanced + reversible (ledger left pristine). Also corrected a stale roadmap item: the Phase 6 #21 "v6 receivable mapping bug" is already fixed in `syncLegacyTransactionToV6`. Full registry entry in `MASTER_ROADMAP.md` §6 (`assets`).

**The "Jarvis Brain Governance & AI Operating Core Upgrade" sprint (تحديث عقل جارفيس وحوكمة الذكاء الصناعي).** The AI layer is now governed: the five direct-write Jarvis tools (customer debt, journal entries, material/employee mutation, JS execution) are **approval-gated** — they queue with payload into طابور أوامر الذكاء and only execute after manager approval with re-validation. New AI Governance core (`modules/ai-governance.js`): `omni.aiSystem` manifest, Tool Registry v2 (47 tools incl. vertical `report_*_today` + 9 future computer-control tools seeded disabled/critical), prompt-injection guard (`detectAiPromptInjectionSignals` — high-risk inputs never reach the planner), scrubbed append-only `omni.aiAuditLog`, provider health (`OctagonAI.status()`/`testProvider()`), and a new page **🛡️ حالة الذكاء الصناعي** (`ai_status`). Full details in `MASTER_ROADMAP.md` §6 (ai_status entry).

Previous sprint (2026-06-11, Phase 4.7): **Workshop AI Operating Layer** — the ERP is ready to run inside a real workshop next month — on phones, on the TV, on the kiosk, and on PCs.

### What's live right now

| Layer | Built | Files |
|---|---|---|
| **Execution Core** (Phase 4.5) | Job intake wizard, 12-state machine, op-pack tasks, reservations, machine queue, QC gate, rework loop, delivery checklist, costing, CC alerts, audit timeline | `modules/work-orders.js` + `.css` |
| **System Integrity Doctor** | Route Health diagnostic — 47/47 nav/pages, 14/14 fns, 13/13 cols, 0 link orphans | `modules/route-health.js` + `.css` |
| **AI Brain (the "soul")** | Morning briefing (deterministic), Worker assistant, SOP draft generator, Customer message generator, Workshop memory, AI action queue, AI development factory, AI tool registry, Kiosk chat (روح النظام), `buildWorkshopAiContext` | `modules/workshop-ai.js` + `.css` |
| **Frontline devices** | Employee mobile mode (مهامي اليوم), Workshop TV mode (شاشة الورشة الحية), Role-based home, Universal problem button, Traveller card + QR placeholder, Deployment readiness | `modules/workshop-frontline.js` + `.css` |
| **Industry vertical** (Phase 5 first slice) | Pharmacy: drug catalog, FEFO dispensing, Rx + controlled enforcement, insurance split, controlled-substance log, prescriptions register, alerts dashboard | `modules/vertical-pharmacy.js` + `.css` |

All four layers run **from one window, behind one login** (`index.html` + `app.js` + `modules/*`). Add-only. No live business data reset.

---

## The chain that's real

```
Customer request
 → Job intake wizard (طلب جديد)
   → Work order (omni.jobOrders, ref WO-YYYY-NNNN, 12-state machine)
     → Operation pack steps → tasks (idempotency key per step)
     → Kanban card
     → Material reservation (material.reservedQty + stock movement)
     → Machine queue (machine.queue[])
     → SOP suggestion (or AI-drafted, manager-approved)
     → QC gate (job-type checklists)
       → on fail → rework task + blocking issue + state=rework
     → Delivery gate (QC + no shortages + tasks done + no blocking + packaging + person)
       → traveller card + delivery note + AI customer message draft
       → costing/profit snapshot (read-only)
     → Audit timeline (per-WO events + global history + AuditService)
     → Command Center (لوحة تشغيل اليوم + 🛡️ تنبيهات الورشة)
     → TV mode + Kiosk + Employee mobile pick up the same data in real time
```

Every WO has a single **next-action button**, and a **🚨 عندي مشكلة** button is on every relevant screen — mobile, WO file, task card, machines, QC, kiosk.

---

## AI philosophy in practice

**AI-first, NOT AI-only.** Every feature works deterministically from real system data with no provider. When `window.OctagonAI` has a live provider (Gemini / OpenRouter / future), it enhances — it never gates.

| Feature | Deterministic path | AI-enhanced path |
|---|---|---|
| Morning briefing | Real counts of overdue/blocked/shortages/conflicts + suggested actions | LLM can rewrite/summarize |
| Worker assistant | Intent matcher on my tasks / WO / SOP / material | LLM via JarvisBrain.handle |
| SOP draft | Structured Arabic from real WO data + past QC failures + memory | LLM can rewrite steps |
| Customer messages | 11 Arabic templates with WO + customer name | LLM can personalize |
| Workshop memory | Pattern detector on QC fails + shortages + downtime | LLM can recommend |
| Action queue | Risk gates; only 3 low-risk executors auto-run | LLM may *propose*, never auto-executes high/critical |

**Sensitive ops (finance, payroll, stock consumption, QC waiver, WO close/cancel, sending real WhatsApp, code patching) always require manager approval + manual execution.** AI proposes; manager approves; system executes.

---

## How to run

```powershell
# Backend (handles persistence, atomic save, recovery):
node server.js          # serves on :8080

# From phones on the same WiFi: use the PC's IP + :8080
```

Open <http://localhost:8080>, log in, then in the sidebar:

- 🏠 **الرئيسية حسب الدور** — your role's home
- 📱 **مهامي اليوم** — the worker phone view
- 📺 **شاشة الورشة الحية** — TV mode
- 🤖 **روح النظام** — kiosk + AI brain hub
- ⚙️ **طابور الذكاء** — pending AI proposals
- 🏗️ **مصنع التطوير** — dev-factory suggestions
- 🧰 **سجل أدوات الذكاء** — tool registry
- 🚀 **جاهزية التشغيل** — 12-point launch checklist + backup button
- 🛠️ **أوامر العمل** — the unified WO file
- 🩺 **فحص صحة النظام** — Route Health doctor

---

## Hard rules (excerpt — full list in `MASTER_ROADMAP.md` §5)

- Build straight through. No review gate.
- **Add only — remove nothing** from the running system without explicit permission.
- **Local-first.** Stays on the PC; prefer the solid local DB. Keys stay until owner pulls them.
- **`modules/*.css` are NOT auto-loaded** — every new module stylesheet needs a `<link>` in `index.html` head.
- **`omni.workOrders` is owned by MRP** (machine-operation runs). The Workshop Execution Core uses **`omni.jobOrders`**. One-time idempotent migration moves any of our records out of the shared array.
- **Single-entry rule:** one window, one login. Floating overlays gated until login.
- **De-monolith:** new features go in `modules/*.js`, NOT in `app.js`. `app.js` was not touched in this sprint.
- **Don't hard-delete business records.** Use `is_active=false` (archive).
- **Every important action writes an audit event** via `recordOmniHistoryEvent`, `AuditService.createEvent`, or the per-WO timeline.
- **AI proposes; manager approves; system executes.** Never the other way around for sensitive ops.

---

## What I checked before signing off (sprint 2026-06-11)

- `node --check` on every new/edited JS module — ALL OK.
- Live end-to-end run of spec §20's 24-step scenario: **22/24 ✓ + 5/5 bonus** (the 2 "misses" were a test-harness `window.open` suppression and the prior-failed-QC gate correctly continuing to block delivery until rework was explicitly marked resolved — Execution Core working **as designed**, confirmed by follow-up).
- Route Health: **47/47 nav · 47/47 pages · 14/14 fns · 13/13 cols · 0 link orphans · zero console errors.**
- Deployment Readiness: **12/12 green.**
- MRP `omni.workOrders` (3 demo machine-run records) untouched.

---

## Known limitations

- **No real QR camera scanner yet** — the Traveller Card has an inline-SVG QR placeholder that encodes the deep link, and the mobile QR-scan button accepts a pasted WO ref. Swap in a real QR canvas + camera reader when ready.
- **Voice notes are text fallback** — the mic button records a typed transcript. Real Web Speech / Gemini voice can be wired later (the data shape `{transcript, by, at, transcribed_by_ai}` is ready).
- **WhatsApp messages are draft-only** — real send awaits Business API webhook + approval gate. Spec rule.
- **Costing is operational/read-only.** No auto-post to finance; closing journal entries should wait for the v6 receivable-mapping fix (Phase 6 #21, already flagged).
- **Permissions are UI-level.** Roles and gates are right, but backend enforcement is still UI-side until the service layer hardens (Phase 6).
- **AI Tool Registry's high/critical tools are registered, NOT executable.** Toggling them only marks them. Actual sandbox/VM execution architecture comes in a later sprint — per spec, this sprint built the foundation.
- **AI Development Factory does not patch live code.** It only generates Codex prompts + tests + rollback plans for human review. Per spec.
- **`window.open` print preview can be blocked by the browser** — make sure pop-ups are allowed for the Octagon origin before printing the Traveller Card or delivery note.

---

## Next resume point

> ✅ **DONE 2026-06-12 — full workshop AI launch audit (re-run at 53-page scale) + Workshop-First Platform Stabilization Sprint.**
> Audit came back green (Route Health **53/53 nav · 53/53 pages**, 0 console errors, AI gate/injection-guard/manager-only all proven). One real find fixed: `briefingText()` no-arg crash. The sprint shipped `modules/workshop-stabilization.js` — a **read-only** 12-check launch-readiness self-test injected into **جاهزية التشغيل** (no new nav page) that re-proves the workshop is launch-ready after any edit; **12/12 جاهز للإطلاق ✅**. Details in [`LAUNCH_AUDIT.md`](LAUNCH_AUDIT.md) §5.
>
> **Next: Phase 6 audit / tenant hardening** (dead-code/performance pass, release notes, and deeper legacy companyId backfill policy). The old v6 receivable mapping issue is already fixed, the tenant control center is shipped in `multi_entity`, service-layer enforcement is shipped in `tenant_service`, direct API persistence enforcement is shipped in `server_api_tenant`, and browser Route Health proof is green at 66/66 as of 2026-06-14. Run **فحص صحة النظام** (66/66 target) **and 🏭 فحص استقرار الورشة** (12/12) before every checkpoint.

### AI governance sprint additions (2026-06-12)

- Risky AI tools no longer execute directly — Arabic gate message: «هذا الإجراء يحتاج موافقة المدير قبل التنفيذ». Approving in طابور الذكاء now actually executes the queued payload (with permission re-check at execution time + execution log).
- Auto WhatsApp send remains disabled; AI SOPs/messages remain drafts; computer-control tools are registry-only and OFF («أدوات التحكم بالحاسوب محضّرة للمستقبل ومطفأة حالياً لحماية النظام»).
- Verified live: gate→queue→approve→execute lifecycle, rejection, injection-guard refusal, deterministic navigation + briefing with no provider, 0 console errors, node --check clean.

### Already completed in this session (2026-06-11)

The non-device parts of the audit are done. See [`LAUNCH_AUDIT.md`](LAUNCH_AUDIT.md):

- ✅ **Button-by-button audit:** 15/15 surfaces verified, 0 real bugs.
- ✅ **Backup/restore drill:** 199KB snapshot round-tripped, 20/20 collections integrity-checked, audit trail written.
- ✅ **AI provider hardening review:** deterministic fallback proven (all 6 AI features work with no provider), 7-item owner checklist documented.
- ✅ **Route Health 47/47 + Deployment Readiness 12/12.**

### What still needs the owner / a physical device

1. **Real-phone test** (iPhone + Android, real WiFi): open `http://<PC-IP>:8080`, log in as a worker, run the full mobile flow — start task → problem → photo → finish.
2. **Real-TV test**: 1080p+ screen, several meters away. Verify text size, contrast, auto-refresh; toggle manager-mode.
3. **Real backup/restore drill on a file copy**: instructions in `LAUNCH_AUDIT.md` §2.
4. **AI key rotation**: 7-item checklist in `LAUNCH_AUDIT.md` §3.

### Then

5. Phase 6 audit (dead-code pass + v6 receivable-mapping fix + release notes).
6. Phase 5 next verticals (retail → clinic → restaurant) + multi-tenant core.

Everything else is in `MASTER_ROADMAP.md`.
