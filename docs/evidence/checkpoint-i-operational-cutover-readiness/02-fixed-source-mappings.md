# Checkpoint I — Governed Legacy-to-Canonical Cutover Engine: Fixed Source Mappings

**Repository:** `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\octagon-erp`  
**Branch:** `cutover/octagon-operational-canonical-migration`  

---

## 1. Governance Rules for Source Mappings

All mappings between legacy collections/fields and canonical entities are registered in `cutover_mapping_registry` and enforced deterministically during migration.

### Key Fixed Mapping Authorities

1. **Location Topology Authority:**
   - Primary physical stock location topology source: `omni.storageLocations`.
   - Legacy physical locations migrated: `LOC_MAIN` (Main Store), `MAIN_STOCK` (Main Stock), `LOC_WIP` (Work In Progress).
   - Legacy virtual locations migrated: `LOC_SCRAP` (Scrap Location), `LOC_SUPPLIERS` (Supplier Location).
   - Legacy duplicate location definition quarantined: `LOC_MAIN` from legacy `locations` collection (quarantined as `quarantined_duplicate_location_definition`).

2. **Finance Source Authority:**
   - Authoritative header collection: `account_moves` (568 rows).
   - Validation-only evidence collection: `journal_entries` (568 rows). `journal_entries` is never migrated directly into `finance_documents` to prevent duplicate document insertion.

3. **Existing Canonical Finance Merge:**
   - Canonical CoA initialized with 16 accounts; merged with 34 legacy accounts on code matching. Total canonical accounts = 39.
   - Canonical Journals initialized with 6 journals; merged with 5 legacy journals on code matching. Total canonical journals = 6.

4. **Owner-Approved UOM Mapping Rules:**

| Legacy UOM Text | Canonical Category | Canonical UOM Code | Ratio Factor | Owner Approval Status |
| :--- | :--- | :--- | :---: | :--- |
| `قطعة` | `unit` | `piece` | 1.0 | Approved |
| `لوح` | `discrete_package` | `sheet` | 1.0 | Approved |
| `علبة` | `discrete_package` | `box` | 1.0 | Approved |
| `رول` | `discrete_package` | `roll` | 1.0 | Approved |
| `متر` | `length` | `meter` | 1.0 | Approved |

5. **Demo Data & Frozen Zone Rules:**
   - Quarantined: `finance.customers/cust_demo`, `omni.workOrders` starting with `demo_wo_`.
   - Frozen Collections (Not Migrated): `employees`, `employee_advances`, `omni.workshopAdvances`, `omni.employeeAttendance`, `employee_payroll_closings`, `payroll_periods`, `payroll_payments`, `omni.workshopAccountReviews`, `omni.workshopTimesheetCases`.
