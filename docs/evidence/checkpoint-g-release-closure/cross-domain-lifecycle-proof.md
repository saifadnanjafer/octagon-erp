# Checkpoint G — cross-domain lifecycle proof

## Result: NOT PERFORMED through the browser.

The thirteen end-to-end business lifecycles (mission sections 10-22) were NOT
executed. See browser-acceptance.md.

## What is proven instead, and how far it goes

Checkpoint F established the STRUCTURAL cross-domain claim by foreign key
against a real migrated schema — stronger than a screenshot for "is this the
same record", weaker for "does the arithmetic come out right":

| Canonical fact | Consuming domains proven by FK |
|---|---|
| `parties` | 20 tables incl. `sale_orders`, `purchase_orders`, `projects` |
| `product_variants` | 39 tables incl. `stock_quants`, `sale_order_lines`, `purchase_order_lines`, `pos_order_lines` |
| `work_items` | `mfg_production_orders`, `mfg_work_orders`, `quality_capas`, `maintenance_orders`, `fleet_trips` |
| `assets` | `maintenance_requests`, `maintenance_orders`, `maintenance_preventive_plans`, `fleet_vehicles` |
| `uoms` | `boms`, `bom_lines`, `mfg_production_orders`, `maintenance_spare_parts` |

Checkpoint G adds two behavioural facts along a real posting path:

- a governed `stock:move:post` produces a stock move, move line, quant,
  valuation fact AND a stock-to-GL link, and all those links survive a
  backup/restore round trip into a different path;
- 22 canonical workflow entry points reject cleanly with no residue and no
  false outbox event.

## What remains unproven

Numeric agreement across a full posted lifecycle, specifically:

- inventory valuation equals the Finance stock-accounting link after a
  complete sales or procurement cycle;
- project actual cost equals the sum of its source-linked Inventory,
  Procurement, Manufacturing and Finance facts;
- WIP reconciles after a production order closes;
- cost-per-vehicle and cost-per-kilometre reconcile to canonical maintenance
  facts;
- warehouse and location balances agree across Sales delivery, Procurement
  receipt, POS, Manufacturing and Maintenance after real movement.

Structural connection is proved. Arithmetic agreement across a full lifecycle
is not, and is not claimed.
