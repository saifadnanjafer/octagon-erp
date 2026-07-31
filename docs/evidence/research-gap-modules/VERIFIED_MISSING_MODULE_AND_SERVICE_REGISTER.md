# Verified Missing Module and Service Register

For each of the 18 audited mandatory candidates: research evidence, current
implementation evidence, final classification, canonical owner, duplicate-
authority risk, dependency order, and build/no-build decision for **this**
wave. (Detailed file:line evidence for each is in
`MASTER_RESEARCH_TO_IMPLEMENTATION_GAP_MATRIX.md`; this register is the
decision layer on top of it.)

| # | Item | Classification | Canonical owner (if any) | Duplicate-authority risk | Build this wave? |
|---|---|---|---|---|---|
| 1 | Scheduler/Jobs/Retry (§7.4) | REGISTERED BUT UNREACHABLE | `platform/jobs` (existing) | **Yes — `server-scheduler.js` is a live, independent second scheduler.** Not retired this wave (see `deferred-hardening.md`); this wave is additive only. | **YES — BUILT** (see `P0-platform-jobs-wiring/`) |
| 2 | Report designer / scheduled reports (§7.7) | INTEGRATION READY (unwired) | `platform/domains/bi` (existing) | Low — `bi_scheduled_reports` has no competing writer, it simply has no reader/dispatcher yet | No — P1, next logical continuation (dispatch needs a rendering/export pipeline platform/jobs can now host) |
| 3 | Notifications provider wiring (§7.2) | BACKEND ONLY | `platform/notifications` (existing) | None found | No — P1 |
| 4 | Print/template engine wiring (§7.3) | EXISTING MODULE EXTENSION REQUIRED | `platform/data-exchange` (existing) | Medium — several pages independently reinvent `window.print()`; consolidating them is itself a multi-page migration | No — P1 |
| 5 | Search/saved-views write path (§7.5) | PARTIAL IMPLEMENTATION | `platform/configuration`, `platform/approvals` (existing) | None found | No — P2 |
| 6 | Master data governance (§7.6) | NEW MODULE REQUIRED | none — genuinely absent | Must be careful not to become "a second Party/Product master"; scope as a stewardship/merge-request layer *over* existing masters only | No — P1 (new module, real design work needed) |
| 7 | Sales commissions backend rewire (§7.8) | PARTIAL IMPLEMENTATION | `platform/sales/lifecycle.mjs` (existing, needs tiers/rules) | **Yes — `modules/sales-commission.js`'s local mock vs the real engine are two competing "truths"** until the page is repointed | No — P1/P2 |
| 8 | Credit/collections UI (§7.9) | BACKEND ONLY | `platform/finance` (existing) | Medium — `modules/finance-close.js`'s primitive aging mock competes with the real `getCustomerAging` | No — P1 |
| 9 | Demand planning / MPS (§7.10) | EXISTING MODULE EXTENSION REQUIRED | `platform/engineering/mrp.mjs` (existing, wrong nominal owner per matrix) | None found; matrix target-owner (`modules/planning`) vs actual owner (`platform/engineering`) is a naming mismatch, not a duplicate | No — P2 |
| 10 | Returns/RMA/repair (§7.11) | ~~PAGE ONLY~~ → **INTEGRATION READY** | `platform/domains/returns/rma.mjs` (new orchestration authority, migration 084) | Reduced — the 3-way duplication is now 2-way: the old local `omni.warrantyHub.claims` mock still exists alongside the new canonical authority (not yet migrated/retired); the real inventory-return and NCR/CAPA authorities are now genuinely wired in, not duplicated | **YES — BUILT** (commercial-operations-closure wave, see `../commercial-operations-closure/returns-rma/INTEGRATION_READY_DECISION.md`) |
| 11 | Service entitlements (§7.12) | NEW MODULE REQUIRED | none | None (nothing to collide with yet) | No — P2 |
| 12 | Electronic signature hash/backend (§7.13) | PAGE ONLY | none clearly owns it; `contract_signature_requests` (migration 067) is orphaned | Low — the orphaned table has no competing writer either | No — P2 |
| 13 | IoT device management (§7.14) | NEW MODULE REQUIRED | none | None | No — P3 (no dependent modules block on this) |
| 14 | Kiosk/large-screen mode (§7.15) | PARTIAL IMPLEMENTATION | `apps/pwa` doesn't formally exist but the real service worker is fine as-is | None | No — P3 |
| 15 | Marketplace hardening (§7.16) | PARTIAL IMPLEMENTATION | `platform/marketplace` doesn't exist; `modules/fpc-module-pack-center.js` owns activation | Low | No — P4 (commercial, post-GA per source matrix itself) |
| 16 | Tenant provisioning (§7.17) | NOT APPLICABLE | none | None | No — explicitly out of scope until the owner prioritizes SaaS multi-tenant commercial operations |
| 17 | Workshop/advertising vertical pack (§7.18) | VERTICAL PACK REQUIRED | `packs/workshop` doesn't exist; content lives in `modules/workshop-*.js` | Low — restructuring existing code, not new authority | No — P3, and explicitly a restructuring effort (extract a pack SDK first — `PK-003` — before repackaging workshop) |
| 18 | Collaboration/Chatter wiring (§7.1) | ~~REGISTERED BUT UNREACHABLE~~ → **INTEGRATION READY** | `platform/collaboration` (existing) | Resolved — wired into the runtime, same pattern as jobs (#1) | **YES — BUILT** (see `P0-collaboration-wiring/`) |

## Build queue for continuation (dependency order, P0 first)

1. ~~Scheduler/Jobs (#1)~~ — **done** (research-gap-modules wave).
2. ~~Collaboration/Chatter wiring (#18)~~ — **done** (research-gap-modules wave continuation).
3. ~~Returns/RMA consolidation (#10)~~ — **done** (commercial-operations-closure wave, Slice 1 of 4).
4. Credit/collections UI (#8) — **next**: commercial-operations-closure Slice 2, not started. Backend largely already exists (`getCustomerAging`/`holdCredit`/`getCreditExposure`), same "unwired" pattern as jobs/collaboration were.
5. Print/template consolidation (#4) — commercial-operations-closure Slice 3, not started.
6. Sales commission rewire (#7) — commercial-operations-closure Slice 4, not started.
7. Notifications provider completion (#3) — now that jobs exist, retry/dead-letter delivery can be driven by the job queue instead of ad hoc. Not scheduled into the commercial-operations-closure wave; still open.
8. Report dispatch (#2) — depends on #1 (done) and a new rendering/export capability. Still open.
9. Master data governance (#6), Service entitlements (#11) — genuinely new modules; scope/design needed before building. Still open.
10. IoT (#13), Kiosk (#14), Marketplace (#15), Workshop pack (#17), Tenant provisioning (#16) — lower priority per the source matrix's own phase assignments (06/08/post-GA). Still open.
