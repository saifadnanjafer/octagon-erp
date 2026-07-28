# Checkpoint G — authority lock register

After the disposable rehearsal, `authority_retirement_locks` on the rehearsal database.

| Domain | Authority key | Canonical target | Status | Enforced |
|---|---|---|---|---|
| FINANCE | *(none — unconditional)* | finance_canonical | n/a | **yes** (since Phase 03) |
| COMMERCIAL | COMMERCIAL_CANONICAL_AUTHORITY_REQUIRED | commercial_core | RETIRED | **yes** |
| INVENTORY | INVENTORY_CANONICAL_AUTHORITY_REQUIRED | stock_inventory | RETIRED | **yes** |
| SALES | SALES_CANONICAL_AUTHORITY_REQUIRED | commercial_sales | RETIRED | **yes** |
| PROCUREMENT | PROCUREMENT_CANONICAL_AUTHORITY_REQUIRED | commercial_procurement | RETIRED | **yes** |
| POS | POS_CANONICAL_AUTHORITY_REQUIRED | commercial_cutover | RETIRED | **yes** |
| WORK_ITEM | WORK_ITEM_CANONICAL_AUTHORITY_REQUIRED | work_item_canonical | RETIRED | **yes** |
| PROJECT | PROJECT_CANONICAL_AUTHORITY_REQUIRED | operations_projects | RETIRED | **yes** |
| ENGINEERING | ENGINEERING_CANONICAL_AUTHORITY_REQUIRED | operations_engineering | RETIRED | **yes** |
| MANUFACTURING | MANUFACTURING_CANONICAL_AUTHORITY_REQUIRED | operations_manufacturing | RETIRED | **yes** |
| QUALITY | QUALITY_CANONICAL_AUTHORITY_REQUIRED | operations_quality | RETIRED | **yes** |
| ASSET | ASSET_CANONICAL_AUTHORITY_REQUIRED | assets_management | RETIRED | **yes** |
| MAINTENANCE | MAINTENANCE_CANONICAL_AUTHORITY_REQUIRED | operations_maintenance | RETIRED | **yes** |
| FLEET | FLEET_CANONICAL_AUTHORITY_REQUIRED | fleet_telematics | RETIRED | **yes** |

**14 of 14 canonical authorities enforced on the rehearsal database.**

Feature flag `phase04.canonical_cutover` = enabled (set by the controller only
after all three safety guards passed).

## Persistence

Verified to survive: a reopened database handle, a migration rerun, and a
backup/restore round trip into a different path.

## Production

On the operational database **none of this is applied**. `phase04.canonical_cutover`
remains 0 there, `authority_retirement_locks` remains empty, and
`canonical_cutover_approvals` is empty by design, so production activation stays
fail-closed. This register describes a rehearsal, not the live system.
