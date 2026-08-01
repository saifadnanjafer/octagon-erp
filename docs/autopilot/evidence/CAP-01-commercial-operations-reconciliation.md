# CAP-01 — Commercial Operations Reconciliation

**Scope authorized:** read-only reconciliation of
`build/octagon-commercial-operations-closure` against the owner-selected
lineage (`cutover/octagon-operational-canonical-migration`). No merge,
cherry-pick, rebase, checkout, operational-data access, or duplicate canonical
authority was created. Performed on 2026-08-01 after `git fetch origin --prune`.

## Measured topology

| Item | Commit | Result |
| --- | --- | --- |
| Safety baseline (owner-selected) | `4c7e58bb3ba3cb149561826146b91d5cc96683e2` | authoritative; equals `origin/cutover/octagon-operational-canonical-migration` |
| Common ancestor | `00e60a8d894ed5e4b9a613246fe1b46264e20550` | last shared commit |
| Commercial-operations tip | `220f1cc6ec2ee7b6c301c56445640300066301de` | 40 commits beyond ancestor; equals `origin/build/octagon-commercial-operations-closure` |
| Divergence | `1 / 40` | baseline-only / expansion-only commits |

The baseline-only delta is the Telegram-bot integration commit (touches
`app.js`, `server.js`, Telegram files/tests). It carries no commercial-domain
substance. Shared conflict candidates remain `app.js` and `server.js` only
(CAP-00 finding, unchanged).

## Authority reuse matrix (commercial domain)

The branch descends from the baseline's parent, so it shares the baseline's
canonical commercial substrate. Reconciliation verdict per authority:

| Canonical authority | Baseline owner (`4c7e58b`) | Branch disposition (`220f1cc`) | Verdict |
| --- | --- | --- | --- |
| Finance GL / documents / payments / credit notes / aging / credit holds | `platform/finance/engine.mjs` | reused as-is (RMA refund calls `createCreditNote` with GL reversal lines) | REUSED — no duplicate |
| Inventory / WMS receipts & return validation | `platform/inventory/*`, `platform/wms/*`, `platform/inventory/wms_workflows.mjs` | reused (RMA receipt disposition) | REUSED — no duplicate |
| Procurement lifecycle / purchase returns | `platform/procurement/lifecycle.mjs` | reused (RMA return-to-supplier disposition) | REUSED — no duplicate |
| Work items (repair) | `platform/work_items/lifecycle.mjs` | reused (RMA repair disposition) | REUSED — no duplicate |
| Quality NCR/CAPA | `platform/quality/ncr-capa.mjs` | reused (RMA failed-inspection disposition) | REUSED — no duplicate |
| Commercial master data (parties, products, UoM, price lists) | `platform/commercial/*.mjs` | reused; W2 modules build on it | REUSED — no duplicate |
| Kernel mutation gateway (ActionExecutor, idempotency, audit, outbox) | `platform/kernel/actions/*` | same kernel; new domains register through `registerDomainHandler` | REUSED — no duplicate |
| CRM (leads/opportunities/activities) | `platform/sales/crm.mjs`, `platform/sales/lifecycle.mjs` | authority **migrated** to `platform/domains/crm/*`; baseline CRM actions demoted to delegating aliases, documented in `docs/evidence/module-expansion-wave-1/crm/opportunity-write-authority-map.md`, enforced by single-write-authority tests (6/6) | CONSOLIDATED — single write authority, not a duplicate |
| Sales lifecycle (quote → order → reserve → deliver → invoice request) | `platform/sales/orders.mjs`, `platform/sales/lifecycle.mjs` | retained as the canonical sales authority; CRM integration only hands off unpriced quotation requests (`platform/domains/crm/sales-integration.mjs`: "CRM does not price, tax, discount, reserve stock, deliver, invoice or post") | REUSED — no duplicate |
| Returns / RMA / repair / warranty | baseline: `sales:return:create` (`platform/sales/lifecycle.mjs:691`) + POS refunds (`platform/pos/refunds.mjs`); warranty legacy-only (`modules/warranty-rma.js`, `omni.warrantyHub`) | new orchestration authority `platform/domains/returns/rma.mjs` over the canonical engines above, honest-refusal semantics, migration 084, 8 actions, 15/15 tests | EXTENDED — but see overlap O1 |
| Contracts | `platform/sales/contracts.mjs` (`sale_contracts`) | second model added: W2-M1 `platform/domains/contracts/service.mjs` (`contracts`) | OVERLAP O2 — two contract models, not unified |
| Commissions | `sales:commission:*` + `sales_commission_rules` (canonical); legacy `omni.salesCommission` UI pack | canonical actions untouched; branch declares "Sales Commissions" slice NOT STARTED; legacy pack still live | RISK O3 — future duplicate if slice 4 starts without adopting the canonical engine |
| Treasury / subscriptions / rental / expenses / WMS-advanced / etc. (W2-M1..M16) | absent at baseline | new domains, registered through the same kernel and authority map | EXTENDED — new, not duplicates |
| Cutover engine / authority-retirement locks | `platform/cutover/*`; enforcement `server.js:2149` FINANCE unconditional, others behind flag + RETIRED lock | same engine present; lock register evidence is rehearsal-DB only | UNCHANGED — operational DB still has no locks applied on either line |

## Duplicate-lifecycle findings (must resolve before any closure claim)

- **O1 — two return writers.** At the branch tip both the pre-existing
  `sales:return:create` → `createSalesReturn` (registered in
  `platform/sales/index.mjs`) and the new RMA authority
  (`returns:rma_*` → `platform/domains/returns/rma.mjs`) are live, with no
  document reconciling them. Either demote `sales:return:create` to a
  delegating alias of the RMA authority (the CRM pattern) or record an
  explicit scope split. The branch's closure docs are silent on this.
- **O2 — two contract models.** `sale_contracts` (`platform/sales/contracts.mjs`)
  and `contracts` (`platform/domains/contracts/service.mjs`) coexist with no
  authority map entry choosing one writer.
- **O3 — commission duplication risk.** The canonical commission engine
  (`sales:commission:accrue|approve|mark_paid`, `sales_commission_rules`) is
  already registered on both lines, yet the branch's closure decision lists
  "Sales Commissions" as a NOT STARTED slice. Starting it without adopting the
  existing engine would create a duplicate lifecycle, which CAP-01 forbids.
- **O4 — local warranty claims registry.** `omni.warrantyHub.claims` remains a
  parallel local writer next to the canonical RMA; migration is explicitly
  deferred in the branch's `deferred-hardening.md` (items 1–6 also: untested
  return-to-supplier success path, no browser proof, no outbox events, no
  quantity/valuation assertions).

## Branch self-declared closure status

`docs/evidence/commercial-operations-closure/COMMERCIAL_OPERATIONS_CLOSURE_DECISION.md`
(at `220f1cc`): **PARTIAL — COMMERCIAL OPERATIONS REMEDIATION REQUIRED.**
Slice 1 (Returns/RMA) Integration Ready; Slices 2–4 (Credit & Collections,
Printing/Templates, Sales Commissions) NOT STARTED. Pre-existing red tests at
tip include `PERIOD_MISSING` fiscal-period failures (wall-clock vs fixtures)
and five other declared-pre-existing suite failures.

## Reconciliation decision

1. The branch **reuses** the baseline's canonical commercial authorities for
   finance, inventory/WMS, procurement, work items, quality, parties/products/
   pricing, and the sales lifecycle. No duplicate lifecycle was found for
   these; CAP-01's "reuse canonical authorities" condition holds for them.
2. The branch **consolidated** CRM under a documented single write authority
   with the legacy actions demoted to aliases — this is the approved pattern,
   not a duplicate.
3. Four overlaps (O1–O4) remain as **parallel or at-risk writers**. They are
   recorded here as the binding reconciliation register for any future
   commercial-operations work: no new slice may start, and no closure may be
   claimed, while O1 and O2 are unresolved, and slice 4 (commissions) must
   adopt the existing canonical commission engine.
4. The baseline-only Telegram delta is unaffected and out of commercial scope.
   `app.js` / `server.js` remain the only conflict candidates for any future
   integration, which stays **explicitly unauthorized** — this reconciliation
   grants no merge, cherry-pick, or cutover activation.

## Next boundary

CAP-02 (governance, service, and collaboration reconciliation) is eligible
once this record is published. Any remediation of O1–O4 is new work on the
expansion line and is outside this read-only mandate; it requires its own
queue entry and owner authorization.
