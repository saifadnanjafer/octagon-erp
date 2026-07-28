# Checkpoint F — cross-domain record integrity

Proved by foreign keys against a real migrated schema. An FK is stronger
evidence than a screenshot: a screenshot shows a number rendered, an FK shows
the consuming domain is physically incapable of holding a different value.

Test: `tests/checkpoint-f/cross_domain_record_integrity.test.mjs` — 9/9 pass.

## Party — one legal entity across the commercial chain

`parties` is referenced by **20** tables, including:

`sale_orders`, `purchase_orders`, `projects`, `contacts`, `addresses`,
`crm_leads`, `crm_opportunities`, `sale_contracts`, `supplier_qualifications`,
`supplier_quotations`, `supplier_invoice_registry`, `purchase_rfq_suppliers`,
`supplier_scorecards`, `party_roles`

A customer created once is the row Sales sells to, Procurement buys from, and
Projects bills against.

**Dual-role party** — stored as ONE `parties` row plus role rows in
`party_roles`. Verified behaviourally: creating a party with
`roles: ['customer','supplier']` produced 1 party row and exactly 2 role rows.
It is not a customer record plus a separate supplier record, so the two roles
cannot diverge.

## Product — one item across Inventory, Sales, Procurement, POS

`product_variants` is referenced by **39** tables, including:

`stock_moves`, `stock_quants`, `stock_valuation_layers`, `stock_lots`,
`stock_serials`, `stock_move_lines`, `stock_inventory_count_lines`,
`stock_valuation_facts`, `landed_cost_allocations`, `sale_order_lines`,
`purchase_order_lines`, `purchase_requisition_lines`, `pos_order_lines`,
`product_barcodes`

`product_templates` is referenced only by `product_variants` — the
template/variant split is a hierarchy, not a duplicate store.

## Work Item — one task engine across four operational domains

The cross-domain claim most easily faked by a lookalike table, so it is asserted
directly against foreign keys.

`work_items` is referenced by **11** tables, including:

`mfg_production_orders`, `mfg_work_orders`, `quality_capas`,
`maintenance_orders`, `fleet_trips`, plus `work_item_dependencies`,
`work_item_watchers`, `work_item_approvals`, `work_item_governance`,
`work_item_events`

Manufacturing, Quality, Maintenance and Fleet do **not** run their own task
engines. The requirement "one Work Item appears consistently in Work
Management, Project, Manufacturing, Quality and Maintenance views" holds
structurally.

## Asset — one register shared by Maintenance and Fleet

`assets` is referenced by **6** tables:

`asset_depreciation_schedules`, `asset_transfers`, `maintenance_requests`,
`maintenance_preventive_plans`, `maintenance_orders`, `fleet_vehicles`

Asset maintenance cost and Fleet maintenance cost therefore derive from the same
canonical asset. Depreciation hangs off the same register rather than a
finance-local copy.

## UOM — one unit authority

`uoms` is referenced by `boms`, `bom_lines`, `mfg_production_orders`,
`mfg_material_requirements`, `mfg_material_issues`,
`quality_inspection_points`, `mfg_supplier_held_stock`,
`maintenance_spare_parts`.

## Referential hygiene

No `parties` row references a company absent from `platform_companies`.

## What this does NOT prove

Structural connection is proved. **Numeric agreement across a full posted
lifecycle is not** — that requires the end-to-end Chromium lifecycle runs, which
do not exist. Specifically unproven:

- inventory valuation equals the Finance stock-accounting link after a real
  posting run;
- project actual cost equals the sum of its source-linked Inventory,
  Procurement, Manufacturing and Finance facts;
- cost-per-vehicle / cost-per-kilometre reconciles to canonical maintenance
  facts;
- warehouse and location balances agree across Sales delivery, Procurement
  receipt, POS, Manufacturing and Maintenance after real movement.

Recorded in [unresolved-risks.md](unresolved-risks.md).
