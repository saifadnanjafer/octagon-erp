# Checkpoint H — backend record consistency

## Established and unchanged

| Metric | Value |
|---|---|
| Registered actions | 330, **0 duplicate ids** |
| Registered entities | 158, **0 owned by two modules** |
| Actions without required audit | 0 |
| Actions with idempotency `none` | 0 |
| Canonical stores | one each for Party, Product, UOM, Quant, Work Item, Asset |
| Competing stores (`customers`, `suppliers`, `products`, `tasks`, `vendors`) | none exist |

Cross-domain foreign-key evidence (Checkpoint F, re-verified): `parties`
referenced by 20 tables including `sale_orders`/`purchase_orders`/`projects`;
`product_variants` by 39 including `stock_quants`/`sale_order_lines`/
`pos_order_lines`; `work_items` by `mfg_production_orders`/`mfg_work_orders`/
`quality_capas`/`maintenance_orders`/`fleet_trips`; `assets` by
`maintenance_*`/`fleet_vehicles`.

## Added by Checkpoint H

| Fact | Evidence |
|---|---|
| A refused legacy HTTP write reaches no canonical table | `parties`, `warehouses`, `stock_moves`, `stock_quants`, `work_items` all still 0 rows after 40 refused writes |
| A refused write publishes no outbox event | 0 outbox rows referencing any probe record |
| A refused write writes no audit success | 0 audit rows with `result=success` for any probe record |
| Release Health reads the real registry | `audit_health` reports the live action count and 0 without required audit |

## Still unproven

Numeric agreement across a full posted lifecycle — inventory valuation versus
the Finance stock-accounting link after a complete cycle, project actual cost
versus source-linked facts, WIP reconciliation after production close,
cost-per-kilometre versus canonical maintenance facts. That requires the
lifecycle runs which were not built. Structural connection is proved;
arithmetic agreement across a lifecycle is not, and is not claimed.
