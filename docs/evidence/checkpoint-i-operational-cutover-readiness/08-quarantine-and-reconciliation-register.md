# Checkpoint I — Governed Legacy-to-Canonical Cutover Engine: Quarantine & Reconciliation Register

**Repository:** `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\octagon-erp`  
**Branch:** `cutover/octagon-operational-canonical-migration`  

---

## 1. Quarantine Register

A total of 5 legacy records were quarantined during staged migration into `cutover_quarantine`. All 5 quarantined records were classified as **non-blocking** demo or duplicate records:

| Record ID | Source Collection | Source ID | Domain | Reason Code | Severity | Proposed Resolution |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `quar_cust_demo` | `finance.customers` | `cust_demo` | `MASTER_DATA` | `legacy_demo_record` | `non_blocking` | Exclude demo customer from production master data |
| `quar_loc_main` | `locations` | `LOC_MAIN` | `MASTER_DATA` | `quarantined_duplicate_location_definition` | `non_blocking` | Exclude duplicate location definition in favor of `omni.storageLocations` |
| `quar_demo_wo_1` | `omni.workOrders` | `demo_wo_1` | `OPERATIONS` | `legacy_demo_record` | `non_blocking` | Exclude demo work order from production operations |
| `quar_demo_wo_2` | `omni.workOrders` | `demo_wo_2` | `OPERATIONS` | `legacy_demo_record` | `non_blocking` | Exclude demo work order from production operations |
| `quar_demo_wo_3` | `omni.workOrders` | `demo_wo_3` | `OPERATIONS` | `legacy_demo_record` | `non_blocking` | Exclude demo work order from production operations |

---

## 2. Reconciliation Register by Domain

| Domain | Metric | Expected Value | Actual Value | Difference | Status | Is Blocking |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **MASTER_DATA** | `master_data_source_count` | 81 | 81 | 0 | `exact` | Yes |
| **MASTER_DATA** | `master_data_migrated_lineage_count` | 78 | 78 | 0 | `exact` | Yes |
| **MASTER_DATA** | `master_data_quarantined_count` | 2 | 2 | 0 | `accepted_with_quarantine` | No |
| **INVENTORY** | `materials_count` | 8 | 8 | 0 | `exact` | Yes |
| **INVENTORY** | `total_on_hand` | 401 | 401 | 0 | `exact` | Yes |
| **INVENTORY** | `total_reserved` | 86 | 86 | 0 | `exact` | Yes |
| **INVENTORY** | `total_available` | 315 | 315 | 0 | `exact` | Yes |
| **INVENTORY** | `aggregate_value_iqd` | 1,963,000 | 1,963,000 | 0 | `exact` | Yes |
| **FINANCE** | `authoritative_account_moves_count` | 568 | 568 | 0 | `exact` | Yes |
| **FINANCE** | `total_debit_iqd` | 102,339,538 | 102,339,538 | 0 | `exact` | Yes |
| **FINANCE** | `total_credit_iqd` | 102,339,538 | 102,339,538 | 0 | `exact` | Yes |
| **FINANCE** | `debit_credit_balance_diff` | 0 | 0 | 0 | `exact` | Yes |
| **OPERATIONS** | `boms_count` | 7 | 7 | 0 | `exact` | Yes |
| **OPERATIONS** | `routings_count` | 7 | 7 | 0 | `exact` | Yes |
| **OPERATIONS** | `quality_plans_count` | 7 | 7 | 0 | `exact` | Yes |
| **OPERATIONS** | `quality_inspections_count` | 3 | 3 | 0 | `exact` | Yes |
| **OPERATIONS** | `machines_equipment_assets_count` | 46 | 46 | 0 | `exact` | Yes |
| **OVERALL** | — | — | — | **0** | **`reconciled`** | **Ready** |
