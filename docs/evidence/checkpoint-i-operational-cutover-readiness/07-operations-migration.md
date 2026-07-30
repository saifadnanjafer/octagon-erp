# Checkpoint I — Governed Legacy-to-Canonical Cutover Engine: Operations Migration

**Repository:** `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\octagon-erp`  
**Branch:** `cutover/octagon-operational-canonical-migration`  

---

## 1. Operations & Engineering Migration Summary

The `operations-migrator.mjs` module migrated legacy BOMs, Operation Packs, Quality Templates, Quality Records, and Assets into canonical Engineering, Quality, and Fixed Assets tables on staged disposable clones:

| Legacy Source Collection | Target Canonical Tables | Source Count | Migrated Records | Quarantined Records | Status |
| :--- | :--- | :---: | :---: | :---: | :---: |
| `omni.boms` | `boms`, `bom_versions`, `bom_lines` | 7 | 7 BOMs, 7 versions, 24 lines | 0 | `reconciled` |
| `omni.opPacks` | `routings`, `routing_versions`, `routing_operations` | 7 | 7 routings, 7 versions, 28 operations | 0 | `reconciled` |
| `omni.qcTemplates` | `quality_plans` | 7 | 7 quality plans | 0 | `reconciled` |
| `omni.qcRecords` | `quality_inspections` | 3 | 3 quality inspections | 0 | `reconciled` |
| `assets` | `assets`, `asset_categories` | 46 | 46 assets | 0 | `reconciled` |
| `omni.workOrders` | Quarantine Register | 3 | 0 | 3 (`demo_wo_*`) | `accepted` |
| **TOTALS** | — | **73 records** | **70 migrated** | **3 quarantined** | **`reconciled`** |

---

## 2. Structural Entity Details & Work Center Seeding

1. **Default Work Center Seeding:**
   - Seeded `work_centers` record `wc_main` (`Main Work Center` / `مركز العمل الرئيسي`) to satisfy `routing_operations.work_center_id` FK constraint.
2. **BOM Versions & Routing Versions:**
   - Created version 1 headers (`bom_versions`, `routing_versions`) for all 7 BOMs and 7 Routings with state `approved` to satisfy foreign keys for BOM components and routing operations.
3. **Quality Plans & Inspections:**
   - Migrated 7 quality templates into `quality_plans` with state `approved`.
   - Migrated 3 quality records into `quality_inspections` with source type `work_order` and mapped inspection types (`finish` -> `final`).
4. **Demo Work Orders Quarantine:**
   - Quarantined 3 demo work orders (`demo_wo_1`, `demo_wo_2`, `demo_wo_3`) with reason code `legacy_demo_record`.
