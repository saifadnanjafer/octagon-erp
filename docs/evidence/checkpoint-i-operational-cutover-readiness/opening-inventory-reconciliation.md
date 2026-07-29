# Checkpoint I — Opening Inventory Reconciliation (I3)

**Source:** legacy `omni.materials`, 8 rows, read from the staged clone
**Status:** quantities and valuation **fully reconciled**; accounting date remains
an **open owner gate**; canonical batch **not yet built**

## Source-backed snapshot

| Material | Unit | On hand | Reserved | Available | Unit cost | Value (IQD) |
|---|---|---:|---:|---:|---:|---:|
| أكريلك | لوح | 45 | 12 | 33 | 15,000 | 675,000 |
| لاصق صناعي | علبة | 18 | 2 | 16 | 3,500 | 63,000 |
| فوم بورد | لوح | 60 | 5 | 55 | 3,000 | 180,000 |
| شريط LED | متر | 200 | 50 | 150 | 1,500 | 300,000 |
| MDF | لوح | 30 | 8 | 22 | 8,000 | 240,000 |
| طلاء سبراي | علبة | 25 | 4 | 21 | 5,000 | 125,000 |
| محول كهرباء | قطعة | 15 | 3 | 12 | 12,000 | 180,000 |
| فينايل طباعة | رول | 8 | 2 | 6 | 25,000 | 200,000 |
| **Total** | | **401** | **86** | **315** | | **1,963,000** |

## Reconciliation against the Checkpoint H stated snapshot

| Metric | Expected | Actual | Result |
|---|---:|---:|---|
| Materials | 8 | 8 | **MATCH** |
| On hand | 401 | 401 | **MATCH** |
| Reserved | 86 | 86 | **MATCH** |
| Available | 315 | 315 | **MATCH** |
| Inventory value (IQD) | 1,963,000 | 1,963,000 | **MATCH** |

### Required identity

```
on_hand = reserved + available
401     = 86       + 315
```

**HOLDS**, and holds per-material as well as in aggregate — every row satisfies
`stock − reserved = available` independently.

### Redundant reserved field — consistent

Legacy rows carry reservation quantity twice, as `reserved` and `reservedQty`.
All 8 materials have **identical values in both fields**, so no divergence has to
be resolved. The migration will read `reserved` and assert `reservedQty` agrees,
quarantining any row where they differ.

## Reservation ownership — material finding

**All 86 reserved units have zero backing reservation records.**

Every material carries `reservations: []` — an empty array — while reporting a
non-zero reserved quantity:

| Material | Reserved qty | Reservation records |
|---|---:|---:|
| أكريلك | 12 | 0 |
| لاصق صناعي | 2 | 0 |
| فوم بورد | 5 | 0 |
| شريط LED | 50 | 0 |
| MDF | 8 | 0 |
| طلاء سبراي | 4 | 0 |
| محول كهرباء | 3 | 0 |
| فينايل طباعة | 2 | 0 |

There is no sales order, work order, or demand record anywhere in the legacy
layer that claims any of these units. Ownership is **unprovable for 100% of
reserved quantity**.

### Consequence for migration

The established opening-inventory policy anticipates exactly this case:
*"preserve `reserved_unallocated` when ownership cannot be proven."*

Therefore **all 86 reserved units migrate as `reserved_unallocated`**, not as
allocated reservations against a demand document. Zero units qualify for
`legacy_opening_reservation` with a proven owner.

This is a source-faithful outcome, not a defect: the legacy system tracked
reservation as a bare quantity on the material, never as a linked commitment.
Fabricating demand documents to justify the 86 units would violate the policy's
prohibition on inventing sales-order lines.

## Planned canonical batch shape

| Property | Value |
|---|---|
| Batch type | `opening_inventory_cutover` |
| Source location | virtual `OPENING_BALANCE` |
| Destination location | pending resolution of the `LOC_MAIN` conflict — see [`legacy-data-inventory.md`](legacy-data-inventory.md) |
| Reservation representation | `reserved_unallocated` × 86 units |
| Fake receipts | none |
| Fake purchase orders | none |
| Fake sale order lines | none |
| Fake historical stock moves | none |
| Revenue / COGS / AP / AR / cash / retained earnings | none created |

## Owner gate — accounting date

**UNRESOLVED, and deliberately not invented.**

The opening-inventory accounting date has never been approved by the owner. This
checkpoint does not assume one, does not default to the cutover timestamp, and
does not post any accounting entry.

Accounting posting for the opening batch is **fail-closed**: the batch can be
built and quantity-reconciled without it, but no GL entry is produced until the
owner supplies the date.

Every non-date-dependent reconciliation above is complete.

## Not yet done

- The canonical opening batch has **not been built** — this requires the staged
  database to be upgraded past migration 044/045 first (I4) and the location
  conflict resolved.
- `phase04_opening_stock_batches`, `_lines`, `_reservations` are all empty in the
  staged clone, consistent with tip 045.
- Account mapping for the opening batch has not been inspected; the instruction's
  warning against hardcoding old account assumptions has been noted and will be
  verified against `finance_accounts` (16 existing rows) during I3 execution.
