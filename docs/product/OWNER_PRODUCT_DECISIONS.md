# Owner Product Decisions — Product Recovery 1

Status: **awaiting owner review**. Everything below requires a business-judgment
call this pass could not make on its own — either two pages look like
duplicates and only the owner knows if they're meant to be, or a workspace's
correct behavior depends on something only Saif knows about how Al-Warsha
actually plans to use it. Routine technical cleanup (dead links, broken
permissions, missing order columns) was fixed directly and is **not** listed
here — see [PAGE_DISPOSITION_REPORT.md](PAGE_DISPOSITION_REPORT.md) for that.

Five prior consolidation decisions (`calculator`, `kanban`, `locations`,
`pos_deepening`, `workshop_tv`, plus four orphan-page dispositions) are already
owner-approved — see `docs/navigation/OWNER_CONSOLIDATION_DECISIONS.md`. This
file only adds *new* decisions surfaced by this pass.

---

## 1. Near-duplicate page pairs (from PAGE_OVERLAP_MATRIX.md, class A)

Both pairs score ≥0.6 on label-vocabulary similarity, share a sidebar group,
and share the same functional-purpose category. Both pages in each pair are
currently STRONG or USABLE — so this isn't "one is broken, keep the other,"
it's "two working pages doing what reads as the same job."

- [ ] **`geofence_events` vs `geofence_management`** (resources domain, STRONG/STRONG).
      Is `geofence_events` the event LOG for geofences `geofence_management`
      configures (keep both — one is config, one is history), or did the
      fleet/IoT build accidentally ship two entry points to the same job?
      If it's config-vs-log, no action needed beyond renaming for clarity
      (e.g. "Geofence Events" reads like a sibling feature, not a detail view
      of "Geofence Management"). If it's a genuine duplicate, fold
      `geofence_events` into `geofence_management` as a tab.

- [ ] **`knowledge` vs `knowledge_base`** (resources domain, USABLE/STRONG).
      These read as the same feature under two names. Recommend: pick one
      canonical id (suggest `knowledge_base`, since it's the STRONG one) and
      alias/redirect the other, following the `pos_deepening` → `pos` pattern
      already established. Needs owner confirmation only because it touches
      whatever bookmarks/links may already point at the id being retired.

## 2. Overlapping pairs needing a "tab, not two pages" call (class B, 10 pairs)

All ten score 0.6 on the same sidebar-group + same-purpose-category signal
but lower label similarity than class A — these read less like accidental
duplicates and more like "this should probably be one workspace with tabs,"
which is exactly the Phase D pattern the recovery brief asks for
(Warehouse Operations example). Owner call needed because collapsing these
changes muscle memory for whoever uses them daily.

| Pair | Domain | Likely shape |
|---|---|---|
| `consolidation_groups` / `consolidation_lineage` / `consolidation_runs` | finance | one **Consolidation** workspace, three tabs (Groups / Lineage / Runs) |
| `device_enrollment` / `device_registry` | resources | one **Device Registry** workspace; enrollment as an action/tab on it |
| `forecast_accuracy` / `forecast_overrides` / `forecast_versions` | ops | one **Forecasting** workspace, three tabs |
| `mobile_receiving` / `receiving_discrepancies` | ops | keep separate *if* mobile_receiving is genuinely a distinct mobile-scan flow (not just a variant view); `receiving_discrepancies` is currently THIN either way — see disposition report |
| `mps` / `mps_proposals` | ops | plan vs proposal-queue: likely a legitimate two-step workflow, not a duplicate — recommend **keep separate**, downgrade to informational unless owner disagrees |
| `putaway_rules` / `replenishment_rules` | ops | both rule-editor workspaces for adjacent WMS mechanics; candidate for one **Warehouse Rules** workspace with two tabs |

Recommendation default where a plan/queue or config/log split looks
legitimate (mps/mps_proposals, device_enrollment/device_registry): **keep
separate**, no action, unless the owner says otherwise. Recommendation
default for the three same-purpose triplets (consolidation, forecasting):
**merge into one workspace with tabs** — three sidebar entries for one
business object (a consolidation run, a forecast) is exactly the pattern
Phase D asks to reduce.

## 3. Ambiguous "zero records, no error" pages — A vs B judgment calls

`docs/product/PAGE_REALITY_LEDGER.md` flags cases where a page renders a
data surface (a table/list) with zero rows, no console errors, and no failed
requests — meaning the runtime evidence genuinely cannot tell "nobody seeded
this resource in the fixture" (cause A) apart from "zero is this page's
correct state" (cause B). As of this pass, automated inspection found none
that stayed ambiguous after the permission-registry fix (see
PAGE_DISPOSITION_REPORT.md) — but re-run `npm run product:reality-ledger`
after any future fixture expansion and check the "most likely (A)" rows
before assuming a zero-row page is broken.

## 4. Golden Workshop Dataset had no commercial front-end — CONFIRMED and closed

Investigated, not just suspected: `platform/sales/*` (crm.mjs, orders.mjs,
lifecycle.mjs, contracts.mjs) and `platform/procurement/*` (lifecycle.mjs,
rfq.mjs, orders.mjs, matching.mjs, governance.mjs) are real, substantial API
layers over the canonical schema
(`database/migrations/039_crm_sales_contracts_commissions.mjs`,
`040_suppliers_procurement_threeway_match.mjs`), and `modules/canonical-sales.js`
(733 lines: lead/quotation forms, opportunity actions, order lifecycle
buttons) is a real, wired UI. Querying the live review database directly
confirmed `parties`, `crm_leads`, `sale_orders`, `price_lists`,
`purchase_requisitions`, `purchase_orders`, and `supplier_quotations` all had
**zero rows** — this was pure fixture absence, not a missing feature. This
is exactly the FIXTURE_ONLY case the recovery brief asks to distinguish from
a real gap, and confirms the `sales` page's earlier "STRONG, 7 records"
reading was measuring UI chrome (tab buttons picked up by the record-count
heuristic), not actual pipeline data.

**Action taken**: added `scripts/review/fixtures/commercial-pipeline.mjs`,
wired into `scripts/review/setup.mjs`, seeding parties (3 customers + 2
suppliers, one customer inactive), 3 CRM leads across stages, 4 sale orders
(draft quotation, sent quotation, confirmed/accepted, cancelled — no
"rejected" state exists in `platform/sales/lifecycle.mjs`, so that scenario
genuinely isn't representable yet), one recurring contract, and a full
procurement chain (requisition→RFQ→2 competing supplier quotes→purchase
order→pending three-way match). No new backend or UI code — this was a data
problem, closed with data. Re-run `npm run review:setup` to apply.

## 5. `work_orders` (P0) and `route_health` run on a legacy, pre-canonical authority

Not a fixture gap and not a missing feature — a genuine architecture question.
`views/work_orders.html` and `views/route_health.html` are both empty shell
containers populated at runtime by `modules/work-orders.js` (1513 lines) and
`modules/route-health.js`, and **both read and write through the legacy
`omni` global** (`typeof omni !== 'undefined' ? omni : ...`), not through the
canonical `platform/api/*` + SQLite layer everything else in this recovery
pass has been auditing.

`modules/work-orders.js`'s own header says it orchestrates
`omni.jobOrders` — "customer-facing workshop job orders — distinct from
MRP's `omni.workOrders` machine runs." But
`database/migrations/042_canonical_work_item_and_authority_retirement.mjs`
already established a `work_items` table as the **canonical** work-item
authority, plus a formal `authority_retirement_locks` governance mechanism
(`platform/cutover/legacy-writer-retirement.mjs`) specifically listing
`WORK_ITEM_CANONICAL_AUTHORITY_REQUIRED` as a tracked, enforced authority key.
`scripts/review/fixtures/workshop.mjs`'s own comment confirms: "There is no
dedicated workshop_jobs table: the real business models workshop jobs as
canonical work items." The Golden Workshop Dataset's 11 job-state fixture
rows all go into `work_items` — `work_orders` and `route_health` cannot see
any of it, because they read from a different, older state system entirely.

This is why these two pages show as "no domain implementation" in the
reality ledger: not because nothing was built, but because what was built
predates the authority-retirement migration and nothing ever repointed the
`work_orders` nav entry at the canonical replacement (which is functionally
covered today by `task_manager`/`my_work`/`command_center`, all already
built on `work_items`).

**Decision needed, not executed**: this is exactly the kind of "business
decision changing canonical process" this recovery pass should not resolve
unilaterally.
- [ ] Is `work_orders` fully superseded by `task_manager`/`command_center`
      today, making it a **RETIRE_CANDIDATE** (alias/redirect, same pattern
      as `pos_deepening` → `pos`)? Or does `omni.jobOrders` carry something
      genuinely not yet ported (op-pack generation, machine-queue linkage,
      SOP/QC-gate/rework loop, the audit timeline mentioned in its header)
      that would be real capability loss if simply redirected?
- [ ] Same question for `route_health` — does anything still depend on the
      omni-based diagnostic, or is it dead code left linked from primary
      navigation?
- [ ] If real capability lives only in `omni.jobOrders`, porting it to
      `work_items` is BUILD-13-scale work (data model translation, not a
      fixture fix) and should be scoped as its own gap-register entry, not
      folded into this pass.

## 5b. The legacy-authority pattern is wider than 2 pages — extent not yet fully mapped

`test:functional-pages` (new this pass) caught a third instance while
verifying: `finance_installments` fails with `400` on `POST /api/db` and
`POST /api/collection`. Reading `modules/finance-installments.js` confirms
the same signature as `work-orders.js` — `typeof omni !== 'undefined'`,
`window.saveData`, a raw `/api/db`/`/api/collection` write path instead of
`platform/api/*`. **A repo-wide grep for this exact idiom
(`typeof omni !== 'undefined'`) matches 64 files under `modules/`** —
including `sales-price-lists.js` and `procurement.js`, which are *different,
legacy files* from the canonical `platform/sales/*` and `platform/procurement/*`
this pass verified and fed with fixture data in §4. That means the `sales`
page (→ `canonical-sales.js`, canonical, now fixture-fed) and the
`sales_price_lists` page (→ `sales-price-lists.js`, apparently legacy) may
be two different architectures serving what reads as one business area —
worth re-checking once `sales_price_lists`'s actual behavior is re-observed
against the new fixture data.

I could not reliably map all 64 files to specific primary nav pages this
pass: `docs/navigation/NAVIGATION_FORENSIC_REPORT.json`'s `rendererSource`
field records the initial static view file (`views/work_orders.html`) for
many of these, not the JS module that populates it at runtime (`work-orders.js`)
— so a direct cross-reference undercounts. Confirmed by direct code reading
so far: `work_orders` (P0), `route_health`, `finance_installments`.
**Recommend as a BUILD-13-scoped task, not something to individually patch
page-by-page**: trace `app.js`'s `switchPage` dispatch table to build a
precise map of which of the 231 primary pages resolve to a `typeof omni`
module vs. the canonical platform, before deciding case-by-case whether each
is retire/port/leave-as-is. This is a bigger, more consequential finding
than any single page fix in this pass — it may mean a meaningful fraction of
"Tier 2-5" secondary-domain pages (loyalty, subscriptions, surveys, visitors,
warranty/RMA, verticals, helpdesk, documents, esign, appointments) never
touch the canonical database the Golden Workshop Dataset feeds, which would
explain a lot of thin/empty readings across those domains beyond what any
fixture expansion can fix.

## 6. `scenario_planner` (P2) confirmed as a generic-shell template, not a real page

`modules/enterprise-suite.js` implements `scenario_planner` via the same
generic factory that also produces `training_lms`, `data_quality`, and
several other secondary-domain pages — each is a `{title, body, fields,
kpis, demo}` config object rendered by one shared template. `scenario_planner`'s
entry has `demo: []` (empty), while sibling entries like `training_lms` at
least carry one hardcoded demo row. There is no cash-flow/inventory-risk/
staffing-pressure/delivery-capacity calculation anywhere behind it despite
the page's subtitle promising exactly that ("مدى التدفق النقدي · مخاطر
المخزون · ضغوط التوظيف · طاقة التوصيل"). Recommend: **HIDE** from primary
navigation (or relabel honestly as a placeholder) rather than leave a P2 page
promising simulation capability that was never built — unless the owner
wants this built as a real BUILD-13 feature, in which case it needs its own
gap-register entry with a defined calculation source, not a fixture.

---

_Generated during Product Recovery 1. Update this file as the owner rules on_
_each item, striking through resolved rows rather than deleting them, so the_
_audit trail stays intact — see the checkbox pattern in_
_`docs/navigation/OWNER_CONSOLIDATION_DECISIONS.md`._
