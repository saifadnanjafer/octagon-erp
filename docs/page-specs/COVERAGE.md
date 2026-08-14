# Coverage and Forensic Deep Review — Wave 3

## Evidence boundary

- Wave 3 catalog starting SHA: `3c047bb0d04985cd88a536d4dbb16b74d2d6405a` (Wave 2 expected SHA).
- Moving engineering reference SHA: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Primary catalog population: **231/231** specs present; embedded tabs and compatibility aliases remain outside the primary count.
- Deep review before Wave 3: **32/231** pages.
- Wave 3 deep review: **26** pages.
- Total deep review after Wave 3: **58/231**; shallow remaining: **173**.
- Wave 3 functional classifications: `CONNECTED` 17, `THIN` 5, `SIMULATED_BY_DESIGN` 3, `PARTIALLY_CONNECTED` 1.

## Coverage by domain

| Domain | Specs present | Deep reviewed | Shallow remaining |
|---|---:|---:|---:|
| `admin` | 13 | 0 | 13 |
| `commercial` | 43 | 7 | 36 |
| `core` | 11 | 1 | 10 |
| `finance` | 25 | 5 | 20 |
| `intelligence` | 19 | 0 | 19 |
| `ops` | 72 | 39 | 33 |
| `resources` | 48 | 6 | 42 |

## Wave 3 deep-reviewed pages

| Page | AS-IS classification | Usability | Disposition | Query/action boundary | Domain authority | Spec |
|---|---|---|---|---|---|---|
| `workshop_command_center` | CONNECTED | USABLE | KEEP_PRIMARY | GET /api/v1/workshop/command-center | platform/workshop/command-center.mjs | [spec](./ops/workshop_command_center.md) |
| `my_work` | CONNECTED | USABLE | KEEP_PRIMARY | GET /api/v1/workshop/my-work | platform/workshop/my-work.mjs; platform/workshop/my-work-sources.mjs | [spec](./core/my_work.md) |
| `workshop_readiness` | CONNECTED | USABLE | KEEP_PRIMARY | GET /api/v1/workshop/readiness | platform/workshop/readiness.mjs; platform/workshop/readiness-catalog.mjs | [spec](./ops/workshop_readiness.md) |
| `workshop_pack_setup` | CONNECTED | USABLE | KEEP_PRIMARY | POST /api/v1/action/packs:validate|packs:approve|packs:stage|packs:enable | Build-12 pack lifecycle authority (exact domain source path NOT VERIFIED) | [spec](./commercial/workshop_pack_setup.md) |
| `task_manager` | CONNECTED | USABLE | KEEP_PRIMARY | GET /api/v1/work-items; POST /api/v1/action/work_item:* | Canonical Work Item authority (exact domain source path NOT VERIFIED) | [spec](./ops/task_manager.md) |
| `work_orders` | THIN | THIN | STRENGTHEN | NOT VERIFIED in page module; legacy/local work-order surface | Legacy workshop job handlers (exact source path NOT VERIFIED) | [spec](./ops/work_orders.md) |
| `service_queue_board` | CONNECTED | STRONG | KEEP_PRIMARY | GET /api/v1/service/queue; POST /api/v1/action/service:* | Service queue authority (source path NOT VERIFIED) | [spec](./ops/service_queue_board.md) |
| `parties` | CONNECTED | USABLE | KEEP_PRIMARY | GET /api/v1/commercial/parties; POST /api/v1/action/party:* | platform/commercial/parties.mjs | [spec](./ops/parties.md) |
| `customers` | CONNECTED | USABLE | CONSOLIDATE_WITH_PARTIES_REVIEW | GET /api/v1/commercial/parties?role=customer; GET /api/v1/finance/* | platform/commercial/parties.mjs; platform/finance/engine.mjs | [spec](./finance/customers.md) |
| `sales` | CONNECTED | USABLE | KEEP_PRIMARY | GET /api/v1/commercial/sales/*; POST /api/v1/action/{crm,sales}:* | platform/sales/index.mjs; platform/sales/lifecycle.mjs; platform/sales/orders.mjs | [spec](./commercial/sales.md) |
| `sales_contracts` | SIMULATED_BY_DESIGN | THIN | CONSOLIDATE_WITH_CANONICAL_SALES | No /api/v1 call in module; browser/local storage save() | platform/sales/contracts.mjs (canonical source exists but is not consumed by this renderer) | [spec](./commercial/sales_contracts.md) |
| `sales_price_lists` | CONNECTED | USABLE | KEEP_PRIMARY | GET /api/v1/commercial/price-lists; POST /api/v1/action/price_list:* | platform/commercial/pricing.mjs; platform/sales/orders.mjs | [spec](./commercial/sales_price_lists.md) |
| `customer_portal` | CONNECTED | USABLE | KEEP_PRIMARY | GET /api/v1/commercial/portal/*; POST /api/v1/action/portal:* | Customer portal authority (source path NOT VERIFIED); platform/sales/orders.mjs; platform/finance/engine.mjs | [spec](./commercial/customer_portal.md) |
| `warranty` | CONNECTED | THIN | STRENGTHEN | GET /api/v1/commercial/warranty; POST /api/v1/action/sales:warranty:* | platform/sales/warranty.mjs | [spec](./commercial/warranty.md) |
| `contracts` | THIN | THIN | OWNER_DECISION_REQUIRED | NOT VERIFIED in page-specific evidence | Contracts authority NOT VERIFIED; platform/sales/contracts.mjs is a competing candidate | [spec](./resources/contracts.md) |
| `procurement` | CONNECTED | USABLE | KEEP_PRIMARY | GET /api/v1/procurement/*; POST /api/v1/action/procurement:* | platform/procurement/index.mjs; platform/procurement/governance.mjs; platform/procurement/lifecycle.mjs; platform/procurement/orders.mjs; platform/procurement/matching.mjs | [spec](./resources/procurement.md) |
| `supplier_portal` | THIN | THIN | STRENGTHEN | NOT VERIFIED in page-specific evidence | platform/procurement authority is the canonical candidate | [spec](./resources/supplier_portal.md) |
| `logistics` | THIN | THIN | STRENGTHEN | GET /api/v1/commercial/warehouse/* and procurement/stock resources; exact page wiring NOT VERIFIED | Inventory/WMS authority (source paths NOT VERIFIED); platform/api/commercial.mjs | [spec](./resources/logistics.md) |
| `approvals` | CONNECTED | STRONG | KEEP_PRIMARY | GET /api/v1/approvals; POST /api/v1/action/approval:* | Governance approval authority (source path NOT VERIFIED) | [spec](./resources/approvals.md) |
| `projects` | CONNECTED | USABLE | KEEP_PRIMARY | GET /api/v1/projects/*; POST /api/v1/action/projects:* | platform/projects/index.mjs; platform/projects/projects.mjs; platform/projects/budget.mjs; platform/projects/billing.mjs; platform/projects/effort.mjs; platform/projects/costing.mjs | [spec](./resources/projects.md) |
| `field_service` | PARTIALLY_CONNECTED | THIN | CONSOLIDATE_WITH_SERVICE_REVIEW | No canonical field-service API shown; local omni.fieldService state and finance bridge | local omni.fieldService; platform/finance engine is a downstream candidate | [spec](./commercial/field_service.md) |
| `fleet_operations_board` | THIN | THIN | STRENGTHEN | GET /api/v1/fleet/*; exact page wiring NOT VERIFIED | Fleet domain candidate; platform/workshop/readiness.mjs | [spec](./ops/fleet_operations_board.md) |
| `finance` | CONNECTED | USABLE | KEEP_PRIMARY | GET /api/v1/finance/*; POST /api/v1/action/finance:* | platform/finance/index.mjs; platform/finance/engine.mjs | [spec](./finance/finance.md) |
| `ar_ap` | CONNECTED | USABLE | KEEP_PRIMARY | GET /api/v1/finance/ar|ap/*; POST /api/v1/action/finance_ar|finance_ap:* | platform/finance/engine.mjs; platform/finance/index.mjs | [spec](./finance/ar_ap.md) |
| `workshop_ledger` | SIMULATED_BY_DESIGN | THIN | RETIRE_OR_MIGRATE | Fetch /workshop_migration_data.json plus local import/actions; no canonical Finance API shown | local workshop_migration_data and local finance transaction helpers | [spec](./finance/workshop_ledger.md) |
| `finance_installments` | SIMULATED_BY_DESIGN | THIN | RETIRE_OR_MIGRATE | No /api/v1 call; omni.finance.installmentPlans and saveData/local state | local browser finance object; Finance AR is canonical candidate | [spec](./finance/finance_installments.md) |

## Wave 2 historical record

Wave 2 deepened 32 BUILD-09 operational pages. Their specifications and findings remain in this catalog unchanged except for manifest/index deep-review labeling. The Wave 2 source baseline, page list, and contradictions remain preserved in the prior catalog history and in each Wave 2 spec change history. Wave 3 did not redo those pages.

## Interpretation

A page is documented when its manifest entry and spec exist. Deep review means source/API/domain/table/action/workflow evidence was examined at the recorded engineering reference and the 23-section specification was refreshed. `CONNECTED` means a page-to-domain edge is evidenced; it does not mean every target behavior, role/isolation path, responsive flow, or browser lifecycle is accepted. `SIMULATED_BY_DESIGN`, `THIN`, and `PARTIALLY_CONNECTED` identify recovery or ownership risk.

## Not covered by this wave

- No source/product/test implementation was changed.
- No engineering worktree files were written.
- Build-12 commercial remediation, unrelated intelligence/admin pages, and unresolved owner decisions remain for later waves.
