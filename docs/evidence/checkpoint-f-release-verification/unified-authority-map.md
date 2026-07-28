# Checkpoint F — unified authority map

Derived from a disposable fresh-install database (`node scripts/migrate.mjs
fresh`), not from source text.

## Registry totals

| Metric | Value | Query |
|---|---|---|
| Modules | 18 | `SELECT COUNT(*) FROM platform_modules` |
| Actions | 330 | `SELECT COUNT(*) FROM platform_actions` |
| Entities | 158 | `SELECT COUNT(*) FROM platform_entities` |
| Duplicate action ids | **0** | `GROUP BY id HAVING COUNT(*)>1` |
| Entities owned by >1 module | **0** | `GROUP BY id HAVING COUNT(DISTINCT module_id)>1` |
| Actions without required audit | **0** | `WHERE audit_policy != 'required'` |
| Actions with idempotency `none` | **0** | `WHERE idempotency_policy = 'none'` |

There is exactly one registered authority per business fact at the registry
level. No fact is claimed by two modules.

## Actions per module

| Module | Actions | Authority domain |
|---|---|---|
| finance_canonical | 93 | FINANCE |
| commercial_core | 31 | COMMERCIAL |
| operations_projects | 27 | PROJECT |
| stock_inventory | 22 | INVENTORY |
| commercial_sales | 20 | SALES |
| stock_wms | 20 | INVENTORY |
| operations_engineering | 19 | ENGINEERING |
| operations_manufacturing | 19 | MANUFACTURING |
| commercial_procurement | 16 | PROCUREMENT |
| platform_kernel | 11 | (owns no business facts) |
| work_item_canonical | 10 | WORK_ITEM |
| operations_quality | 9 | QUALITY |
| assets_management | 8 | ASSET |
| operations_maintenance | 7 | MAINTENANCE |
| commercial_cutover | 6 | POS |
| fleet_telematics | 6 | FLEET |
| operations_mrp | 5 | ENGINEERING |
| checkpoint_c_test_module | 1 | **test fixture — see unresolved-risks.md** |

## Canonical storage authority

One table per business fact, verified against the migrated schema:

| Fact | Canonical table | Competing store present? |
|---|---|---|
| Party | `parties` + `party_roles` | no `customers`, `suppliers`, `vendors` table |
| Product | `product_templates` / `product_variants` | no `products` table |
| UOM | `uoms` + `uom_categories` | none |
| Inventory quantity | `stock_quants` | none |
| Work Item | `work_items` | no `tasks` table |
| Asset | `assets` | none |

Asserted by the test `there is exactly one canonical store for each core
business fact`.

## The ActionExecutor contract

`platform/kernel/actions/index.mjs` enforces, per action: module access,
required permission, required scope, input schema, preconditions, an explicit
transaction boundary, an idempotency policy, and mandatory audit + outbox
evidence. All 330 registered actions declare `audit_policy='required'`.

## Registration is complete; enforcement is not

Registration and storage authority are genuinely unified. **Enforcement of the
legacy-writer strangler is not.** On a fresh install only FINANCE refuses legacy
writes — see [legacy-writer-retirement.md](legacy-writer-retirement.md). That
gap, not the registry, is why this checkpoint does not classify as verified.
