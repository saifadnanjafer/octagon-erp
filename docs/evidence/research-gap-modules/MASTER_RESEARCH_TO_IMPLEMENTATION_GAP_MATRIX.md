# Master Research-to-Implementation Gap Matrix

## Scope of this pass — stated honestly

`MASTER_CAPABILITY_INTEGRATION_MATRIX.md` contains ~223 capability rows
(PK 30, GV 20, FN 28, SC 34, OP 25, HR 15, UX 13, AI 6, CM 5, TR 22). All ten
parts were read in full this wave (see `research-corpus-register.md`) and
their disposition/target-owner columns inform the mapping below.

Cross-referencing **every** row against live repository evidence (file
contents, migrations, tests, wiring) — the standard this document's own
source-precedence rule demands — is a large, multi-session audit in its own
right. This pass did that full executable cross-reference for the **18
mandatory-candidate capability groups** (§7.1–7.18 of the assignment), using
five parallel research passes, each required to cite file:line evidence and
forbidden from classifying anything it had not actually opened and read. The
remaining ~205 matrix rows were reviewed for their written content (disposition,
target owner, acceptance gate) but not individually re-verified against
current code in this pass. That is recorded here as an explicit limitation,
not hidden.

## The dominant finding

The audit did **not** find "missing modules" as the primary gap. It found a
recurring, systemic pattern: **real, tested backend engines that are never
imported by the runtime**, alongside **UI pages that call no backend at all**.
This matches a defect class the repository's own authors already found and
partially fixed for `workflow`/`automation` during FP-2 (see
`platform-runtime-bridge.mjs` comment: *"FP-2 Control Plane: WorkflowRegistry/
Runtime and AutomationEngine are real, tested engines that were never imported
outside their own test files."*). This wave's P0 build (below) fixes the same
class of defect for `platform/jobs`.

## Capability-group gap table (18 mandatory candidates, fully verified)

| § | Capability | Matrix ID(s) | Current Octagon reality (file:line evidence) | Classification |
|---|---|---|---|---|
| 7.1 | Collaboration/Chatter/Followers/Activities | `PK-016` | `platform/collaboration/index.mjs` (364 lines) — full `ChatterService`/`HistoryService`, migration `010`, tested (`tests/phase02/collaboration-files-jobs.test.mjs:181-258`). Never imported outside its own test file. | **REGISTERED BUT UNREACHABLE** |
| 7.2 | Notifications | `PK-017` | `platform/notifications/index.mjs` (290 lines) — templates, channels, dedup, retry/dead-letter, mandatory-category opt-out-proof. Imported and instantiated in the bridge (`platform-runtime-bridge.mjs:186`); `unreadCount()` feeds a bootstrap counter nothing in the frontend reads. No email/WhatsApp/SMS provider adapter wired. | **BACKEND ONLY** |
| 7.3 | Print, label, barcode, template designer | `PK-021` | `platform/printing` does not exist. Real versioned/RTL-safe templating engine lives in `platform/data-exchange/index.mjs` (`registerPrintTemplate`/`render`), tested, imported **only** by tests. Actual pages use ad hoc `window.print()` popups (`modules/pos.js`, `modules/documents.js`, 6+ others) each building their own HTML. One real hand-rolled Code39 barcode generator exists, local to `modules/equipment-management.js` only. | **EXISTING MODULE EXTENSION REQUIRED** |
| 7.4 | Scheduler, jobs, retry control | `PK-026` | `platform/jobs/index.mjs` (385 lines) — durable `JobQueue`+`WebhookService`, leases, backoff, dead-letter, idempotency, tested. Never imported by the bridge or `server.js`; a fully independent legacy `server-scheduler.js` (511 lines) runs its own 5 cron jobs with zero relationship to it. | **REGISTERED BUT UNREACHABLE — FIXED THIS WAVE (see P0 folder)** |
| 7.5 | Search, saved views, worklists | `PK-018`/`PK-023` | `platform/views`/`platform/search` don't exist. Command palette (`modules/command-palette.js`) is a pure client-side DOM/array filter — the repo's own `page-consolidation-register.md:33` already documents this as a named gap. Worklists (`platform/approvals`) and saved views (`platform/configuration/index.mjs:207-244`) are real and server-backed, but saved-view **writes** have no registered ActionExecutor action (`modules/fpc-customization-studio.js:10-13` says so explicitly). | **PARTIAL IMPLEMENTATION** |
| 7.6 | Master data governance | cross-cutting (`GV-004`,`SC-001`,`SC-019`) | No golden-record/merge-request/stewardship engine anywhere. What exists: CRM duplicate *detection only* (`platform/domains/crm/duplicate-service.mjs` — "nothing here auto-merges"), party uniqueness constraints at creation (`platform/commercial/parties.mjs:27-97`), and a one-time cutover-only dedup (`platform/cutover/master-data-migrator.mjs`). No product-master duplicate logic at all. | **NEW MODULE REQUIRED** |
| 7.7 | Report designer, scheduled reports | `UX-008` | `platform/domains/bi` (migration `079`) implements dashboards/KPIs/`bi_scheduled_reports` with `cron_expression`, and is self-labelled **INTEGRATION READY** in `docs/evidence/module-expansion-wave-2/bi/INTEGRATION_READY_DECISION.md` — but `page-consolidation-register.md:90` says outright "unwired — connect it." Client-side `modules/nl-reporting.js` scheduling is an explicit no-op (`status:'placeholder'`, literal Arabic note that no background job is created). | **INTEGRATION READY (unwired)** |
| 7.8 | Sales commissions | `SC-022` | `modules/sales-commission.js` (630 lines) is real, reachable, in nav — but entirely local/mock (`omni.salesCommission`, zero `fetch` calls). A real backend exists and is disconnected: `platform/sales/lifecycle.mjs:886-943` (`accrueCommission`/`approveCommission`/`markCommissionPaid`, single flat rate, no tiers), migration `046`, one read endpoint with zero callers. | **PARTIAL IMPLEMENTATION** |
| 7.9 | Credit, collections, dunning | `FN-020` | Real, wired, and enforced: `platform/finance/engine.mjs` (`getCustomerAging`, `holdCredit`, `getCreditExposure`), migration `028`, and genuinely blocks quotation approval on credit hold (`platform/sales/lifecycle.mjs:326-334`). Zero UI anywhere to view/set limits or releases; a separate primitive single-bucket aging mock exists in `modules/finance-close.js`, unrelated to the real engine. No AR dunning/collections queue (only unrelated subscription-billing dunning exists). | **BACKEND ONLY** |
| 7.10 | Demand planning / S&OP | `OP-008`/`SC-011` | No `modules/planning`/`platform/planning`. A real, substantial MRP/demand-netting engine exists under Engineering (`platform/engineering/mrp.mjs`, migration `053`) and **is** wired into `modules/canonical-engineering.js:400-405,666-699`. It sits in the wrong target-owner location per the matrix and has no capacity/MPS board. Separately, `modules/advanced-inventory.js` reorder feature is explicitly labeled `preview_only`, disconnected from the real `reorder_point` engine. | **EXISTING MODULE EXTENSION REQUIRED** |
| 7.11 | Returns, RMA, repair, warranty | `SC-016`/`OP-012` | `modules/warranty-rma.js` (276 lines) is a standalone mock register with no return authorization, disposition, or finance/stock writes (states this itself); its one cross-module call (`OctagonHelpdesk.createTicketFrom`) is dead code. Real inventory-return command (`platform/inventory/wms_workflows.mjs`, migration `045`) exists and is called by no UI. Real, more mature NCR/CAPA quality system (`platform/quality/ncr-capa.mjs`, migration `056`) is read-wired into `modules/canonical-quality.js` but has no create/close calls and no relationship to `warranty-rma.js`. | **PAGE ONLY** |
| 7.12 | Service contracts, warranties, entitlements | `OP-023` | No `modules/service-contracts.js`, no `platform/entitlements`, zero coverage/SLA-consumption code anywhere. | **NEW MODULE REQUIRED** |
| 7.13 | Electronic signature | (documents/PK-021 adjacent) | `modules/esign.js` (538 lines) is real (signing lifecycle, canvas/typed capture, audit trail) but entirely local (`omni.esign`, zero API calls) and stores no document hash. An orphaned `contract_signature_requests` table with `signature_hash` exists (migration `067`) but is referenced nowhere else. | **PAGE ONLY** |
| 7.14 | IoT device management | `OP-015` | No `modules/iot.js`/`platform/iot`. `modules/fleet.js` is explicit "Demo Mode" with a mock sensor reading; GPS/CAN-bus/RFID are listed as aspirational "Available API Integration Protocols," not wired connectors. | **NEW MODULE REQUIRED** |
| 7.15 | Mobile/PWA/offline/kiosk | `UX-009`/`UX-010` | A real service worker (`service-worker.js`) and `manifest.json` ARE registered and working. No `apps/pwa`/`apps/kiosk` structure; the "kiosk" page (`views/kiosk.html`) is an AI-chat assistant, not a kiosk/terminal display mode. No large-screen mode exists. | **PARTIAL IMPLEMENTATION** (PWA real; kiosk absent) |
| 7.16 | Marketplace, extension distribution | `CM-003` | `modules/platform-marketplace.js` (441 lines) is a pure client simulation (fake install toggles, fake hashed "secrets", simulated webhooks). `modules/fpc-module-pack-center.js` is real and control-plane-wired but is module activation/licensing, not package distribution — no signatures, versioning, or publisher workflow anywhere. | **PARTIAL IMPLEMENTATION** |
| 7.17 | Tenant provisioning, commercial ops | `CM-002` | No `platform/provisioning`/`platform/tenancy`. `modules/fpc-commercial-control-center.js` explicitly states "This is not a billing engine." No suspend/deprovision/plan-assignment workflow anywhere. | **NOT APPLICABLE** (no existing concept to extend — would be new capability if ever prioritized) |
| 7.18 | Workshop/advertising vertical pack | `HR-014`/`HR-015` | No `packs/` directory or pack-SDK anywhere in the repo (roadmap language only — `MASTER_ROADMAP.md:201-208`). Real, substantial workshop modules exist (`modules/workshop-frontline.js` 966 lines, `modules/workshop-ledger.js` 1399 lines) but are monolithic, single-tenant (hardcode specific employee names/one workbook import), not a composable pack — same pattern as every other `modules/vertical-*.js`. | **VERTICAL PACK REQUIRED** |

## Rows reviewed for content only (not individually re-audited this pass)

All ~205 remaining rows across `PK` (the other 26), `GV`, `FN`, `SC`, `OP`,
`HR`, `UX`, `AI`, `CM`, `TR` were read and their disposition/target-owner
columns are recorded as source-of-truth intent, but were not each individually
checked against current files this session. Given the "REGISTERED BUT
UNREACHABLE" pattern found in nearly every audited row, **the safe assumption
for continuation work is to re-verify wiring before building anything new**,
not to trust a row's `Current Octagon` column at face value — that column
predates several of the wave-1/wave-2/FP-2 builds that already landed
real (if sometimes unwired) implementations.
