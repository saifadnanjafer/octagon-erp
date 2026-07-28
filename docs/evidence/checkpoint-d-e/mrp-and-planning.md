# Checkpoint D2 — MRP and Planning

Status: **DELIVERED AND PROVEN**

Implementation: `platform/engineering/mrp.mjs`, migration
`053_engineering_bom_routing_mrp.mjs`, query surface
`platform/api/engineering.mjs` (`/api/v1/mrp/*`).

## The defining authority boundary

**MRP PRODUCES PROPOSALS ONLY.**

A planning run reads canonical facts and writes `mrp_requirements` +
`mrp_proposals`. It creates no purchase order, no stock move, no reservation,
and no financial commitment. Every run result explicitly returns:

```json
{ "created_financial_commitment": false, "created_stock_movement": false }
```

Turning a proposal into a real document is a separate governed approval
(`mrp:proposal:approve`) which returns the receiving authority
(`platform.procurement` / `platform.inventory` / `platform.manufacturing`) and
still reports `created_financial_commitment: false`. Approval authorises the
hand-off; it does not itself create the downstream document.

Proven by test and in the browser: after a run that produced a purchase
proposal, `SELECT COUNT(*) FROM purchase_orders` is **0**.

## Capabilities

**Item policies** (`mrp_item_policies`): sourcing (make / buy / transfer /
subcontract), safety stock, reorder point, lead-time days, lot sizing
(lot-for-lot / fixed / min-max / economic), fixed lot size, minimum order
quantity, multiple-of, preferred supplier, source warehouse.

A `make` policy is refused unless the product has an **approved** BOM
(`MRP_MAKE_REQUIRES_APPROVED_BOM`), so a plan can never be unbuildable.

**Demand** (`mrp_demands`): sales order, project, forecast, manual, and
master-schedule types, with warehouse, required date, and project link.
Demand is aggregated per product before explosion so one product cannot
produce N competing proposals for the same shortage.

**Runs** (`mrp_runs`): numbered `MRP-NNNNN`, with demand / requirement /
proposal / shortage counters and an execution trail. Planned demand is marked
`planned` so the next run does not double-count it.

## Netting — the correct availability figure

For each requirement the run computes:

```
available = internal_on_hand - reserved + scheduled_receipts - safety_stock
net       = max(0, gross - available)
```

### A real bug this caught

The first implementation used the canonical `getQuantBalance()`. That helper
deliberately sums **every** location for a product — correct for ledger
integrity, but wrong as an availability figure, because the ledger is
double-entry across locations: receiving 10 units from a supplier leaves +10
in internal stock and −10 in the supplier location, so the sum is zero.

The test `MRP explodes a multi-level BOM and nets against real on-hand stock`
failed with `on_hand: 0, expected 10` and exposed this. Fixed by adding
`internalBalance()`, which joins `stock_locations` and counts
`usage = 'internal'` only, optionally scoped to a warehouse.

`scheduled_receipts` are read from `stock_moves` in
`assigned`/`confirmed`/`waiting` state — from the canonical ledger, never
tracked separately.

## Multi-level explosion and phantoms

Explosion walks approved BOM versions recursively, guarded at
`MAX_EXPLOSION_DEPTH = 12` (`MRP_EXPLOSION_TOO_DEEP`) so a circular bill
cannot hang a run.

Per level the child gross applies the parent's scrap factor and yield:

```
childGross = (orderQty / bomBaseQty) * lineQty * (1 + scrap%) / (yield% / 100)
```

**Phantom lines are transparent.** A phantom does not become a requirement of
its own — it expands straight into its children at the next depth, which is
precisely what makes it a phantom.

A shortage on a `make` item produces a `manufacture` proposal naming the
approved BOM version and (when one exists) the approved routing version, and
then explodes further. `buy` / `transfer` / `subcontract` terminate the
explosion.

## Lot sizing

`applyLotSizing()` applies, in order: fixed lot rounding, minimum order
quantity, then multiple-of rounding. Unit-tested directly:

| Net | Policy | Result |
|---|---|---|
| 7 | fixed, lot 5 | 10 |
| 3 | MOQ 10 | 10 |
| 11 | multiple of 4 | 12 |
| 0 | any | 0 |

## Reports

`shortages`, `proposals`, `planner_worklist`, `runs`, `demand`. An unknown
report is a governed denial (`MRP_REPORT_UNKNOWN`).

## Live browser proof

Disposable database, port 8093, authenticated as `test.manufacturing`:

```
policy: FG = make, component = buy (lead 7d)
demand: FG x 10
run (horizon 60d) -> completed
  requirements: level 0 FG gross 10 net 10
                level 1 component gross 30 net 30   (10 x 3)
  proposals:    manufacture FG  qty 10  (names approved BOM version)
                purchase   comp qty 30
  created_financial_commitment: false
  created_stock_movement:       false
  purchase_orders in database:  0
```

## Not yet implemented

- **Reschedule proposals**: the `reschedule` proposal type and
  `reschedule_reason` column exist in the schema and the state machine accepts
  them, but no rule currently *generates* a reschedule suggestion. Recorded
  rather than claimed.
- **Forecast and master-production-schedule** are supported as demand *types*
  (a foundation, as specified) — there is no forecasting engine.
- Executing an approved proposal into a real purchase order / transfer /
  production order is Checkpoint D3 work; `executed_authority` and
  `executed_ref` columns exist for it and are currently unset.
