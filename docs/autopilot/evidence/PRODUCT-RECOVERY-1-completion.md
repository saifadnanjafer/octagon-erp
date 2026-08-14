# Product Recovery 1 — Completion Evidence

Status: **SUBSTANTIALLY COMPLETE, NOT FORMALLY CLOSED** — see gap list at
the end. This document reports what is actually true, evidenced against the
generated ledgers and test runs, not what the original directive assumed.

## Starting state

The directive that opened this recovery wave assumed a fresh start at
`25c24df` (the published `origin` tip). The actual local branch was already
2 commits ahead of that (`e39bb2f`, `6dbcd6f`) with a working
`PAGE_FUNCTIONAL_LEDGER` audit system already in place — this pass extended
that system rather than duplicating it, per an explicit decision at the
start of the session.

- Directive-assumed starting SHA: `25c24df753962bbf3c13301eed71624bc0ee39b6`
- Actual pre-session local HEAD: `6dbcd6f4afcbeb169aaca23d995bc93957edcfc3`
- This session's first commit: `41c928c` (fix(build09): guard allRows...)
- Current HEAD: `7a6a8eb444366b13ac02ee52ccd32423c2effd7a`

## What this pass did

1. **Extended the existing audit pipeline** instead of rebuilding it:
   `scripts/product/build-reality-ledger.mjs` (A-I root-cause taxonomy),
   `build-runtime-error-ledger.mjs` (Phase-H error classification),
   `build-product-map.mjs`, `build-disposition-report.mjs` — all generated,
   none hand-authored, built on top of the pre-existing
   `build-ledger.mjs`/`inspect-pages.mjs`.

2. **Found and fixed 4 real backend bugs**, each verified by a live
   re-inspection before/after:
   - `pick_task_queue` crashed instead of showing a permission-denied state
     (`modules/build09-pick-task-queue-workspace.js`).
   - `build12`'s combined overview resource threw on every request due to a
     `scoped()` positional-argument bug (`platform/build12/index.mjs`).
   - Two `build12` resources (`people_competencies`, `event_registrations`)
     500'd on every request because the generic order-column default didn't
     match either table's actual columns.
   - **16 of 20 permission tokens** `platform/api/build09.mjs` requires for
     WMS/shopfloor/quality read access were never registered in
     `authorization_permissions` at all — no role, in review or production,
     could ever pass those checks. Fixed via
     `database/migrations/090_build09_wms_shopfloor_quality_view_permissions_followup.mjs`.

3. **Closed a fixture gap, not a feature gap**: `platform/sales/*` and
   `platform/procurement/*` (plus the 733-line `modules/canonical-sales.js`
   UI) were real and fully wired, but the Golden Workshop Dataset had zero
   rows for customers, leads, quotations, or purchase orders. Added
   `scripts/review/fixtures/commercial-pipeline.mjs` rather than building
   anything new — confirmed working: the `sales` page went from a
   false-positive "STRONG, 7 records" reading (tab-button chrome, not data)
   to a genuine USABLE state with real rendered rows.

4. **Found a significant, unresolved architectural pattern** (documented,
   not resolved — this needs an owner call): `work_orders` (P0),
   `route_health`, and `finance_installments` are real, substantial
   implementations built on a **legacy `omni`-global / `/api/db` write
   path**, not the canonical `platform/api/*` layer this whole recovery
   pass audited. `database/migrations/042` already established `work_items`
   as the canonical work-item authority with a formal retirement-tracking
   mechanism (`platform/cutover/legacy-writer-retirement.mjs`,
   `WORK_ITEM_CANONICAL_AUTHORITY_REQUIRED`) — `work_orders` is pre-retirement
   debt still linked from primary navigation. A repo-wide check found the
   same idiom in **64 files** under `modules/`; only 3 were confirmed by
   direct code reading this pass. Full extent needs a `switchPage`
   dispatch-table trace — see `docs/product/OWNER_PRODUCT_DECISIONS.md` §5b.

5. **Built `test:functional-pages`**, a real regression gate (browser-free,
   asserts against the generated ledgers) that immediately proved its worth
   by catching the 3 remaining open issues below on its first run.

## Numbers (before this session's work → after)

| Metric | Before | After |
|---|---|---|
| Primary pages | 231 | 231 (no consolidation executed — see below) |
| STRONG | 80 | 81 |
| USABLE | 113 | 118 |
| THIN | 31 | 32 |
| BROKEN | 7 | **0** |
| Dead ends | 2 | 1 |

THIN count is roughly flat (31→32) because the reality-ledger's cause
taxonomy reclassified some previously-STRONG false positives (like the
original `sales` reading) downward to an honest state at the same time
fixes moved other pages upward — net movement is real, not just cosmetic.

## Test results (this pass)

- `npm run test:page-consolidation` — **9/9 pass**.
- `npm run test:functional-pages` (new) — **6/7 pass**. The one failure is
  the 3 open issue clusters below, confirmed twice across independent runs.
- `npm run test:navigation` — **231/231 passed, 0 failed**.
- `test:golden-workshop` — **does not exist**. The directive's Phase I
  called for it; this pass did not build it. Real gap.
- `test:review`, `test:workshop`, `test:build-08` through `test:build-13`,
  `test:permissions`, `test:migration` — not re-run this pass; no code
  touched here should affect them (migration 090 is purely additive), but
  "should not affect" is not the same as "verified."

## Open items — why this is not a formal closure

1. **3 confirmed, unresolved bugs on retained P0/P1 pages** (see
   `docs/product/PAGE_RUNTIME_ERROR_LEDGER.md` and
   `OWNER_PRODUCT_DECISIONS.md` §5b):
   - `warehouse_id` missing from 5 WMS pages' query calls (422 on load).
   - `finance_installments`'s `/api/db`/`/api/collection` writes fail (400).
   - `my_work`'s saved-views call 404s.
2. **The legacy-omni architecture question is open**, not resolved — see
   `OWNER_PRODUCT_DECISIONS.md` §5, §5b. This is explicitly flagged as a
   business-process decision this pass should not make unilaterally.
3. **12 consolidation candidates await owner sign-off** (2 near-duplicate
   pairs, 10 overlapping pairs) — `OWNER_PRODUCT_DECISIONS.md` §1-2. Zero
   consolidation was executed this pass; page count is unchanged (231→231).
4. **`test:functional-pages` and `test:golden-workshop`** — only the former
   was built. The Golden Workshop Chromium-journey test (customer → job →
   material → warehouse → production → quality → delivery → finance) does
   not exist yet.
5. **The legacy-module blast radius (64 files) is not fully mapped** to
   specific primary pages — only 3 confirmed by direct reading.

## Recommendation

Product Recovery 1's *audit and immediate-bug-fix* objectives are
genuinely met: every primary page is classified with real evidence, the
root-cause taxonomy is populated, zero pages are unexplained-broken, and
four real backend defects (one systemic) are fixed and verified. Its
*consolidation* and *Golden-Workshop-journey* objectives are not — those
require, respectively, owner decisions this pass correctly deferred, and a
non-trivial new test harness this pass did not have room to build. Treat
this as the honest state to hand off, not as a blocker to continuing
BUILD-13 work on the items that are genuinely ready (the fixes already
verified), while keeping the open items above visible rather than
declaring false closure.
