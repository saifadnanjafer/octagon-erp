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

---

_Generated during Product Recovery 1. Update this file as the owner rules on_
_each item, striking through resolved rows rather than deleting them, so the_
_audit trail stays intact — see the checkbox pattern in_
_`docs/navigation/OWNER_CONSOLIDATION_DECISIONS.md`._
