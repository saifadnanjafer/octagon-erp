# Checkpoint I — Governed Legacy-to-Canonical Cutover Engine: Master Data Migration

**Repository:** `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\octagon-erp`  
**Branch:** `cutover/octagon-operational-canonical-migration`  

---

## 1. Master Data Migration Scope & Results

The `master-data-migrator.mjs` module processes all foundational master data collections into canonical tables:

| Source Collection | Target Canonical Table | Source Count | Migrated / Merged | Quarantined | Lineage Recorded |
| :--- | :--- | :---: | :---: | :---: | :---: |
| `organization_departments` | `organization_departments` | 1 | 1 | 0 | Yes |
| UOM Seed Rules | `uom_categories`, `uoms` | 5 rules | 5 categories, 5 UOMs | 0 | Yes |
| `omni.categories` | `product_categories` | 3 | 3 | 0 | Yes |
| `materials` | `product_templates`, `variants` | 8 | 8 templates, 8 variants | 0 | Yes |
| `finance.customers` | `parties`, `party_roles` | 7 | 6 | 1 (`cust_demo`) | Yes |
| `finance.suppliers` | `parties`, `party_roles` | 2 | 2 (1 merged) | 0 | Yes |
| `omni.storageLocations` | `warehouses`, `stock_locations` | 5 | 1 warehouse, 5 locs | 0 | Yes |
| `locations` | `stock_locations` | 2 | 0 | 1 (`LOC_MAIN` dup) | Yes |
| `assets` | `asset_categories`, `assets` | 46 | 46 assets | 0 | Yes |
| **TOTALS** | — | **78 candidates** | **78 migrated, 1 merged** | **2 quarantined** | **Exact Lineage** |

---

## 2. Entity Mapping & ID Lineage Verification

- **Products / Materials:** Legacy material ID `mat_acrylic` maps to `product_templates.id = 'mat_acrylic'` and `product_variants.id = 'var_mat_acrylic'`. Standard price, SKU, cost method (`fifo`), valuation method (`automated`) seeded.
- **Parties & Suppliers:** Legacy customer `cust_1` maps to `parties.id = 'party_cust_1'` with role `customer`. Legacy supplier `supp_1` merged cleanly with existing supplier records. Demo customer `cust_demo` quarantined with reason `legacy_demo_record`.
- **Locations & Warehouses:** Legacy physical location `LOC_MAIN` mapped to `stock_locations.id = 'LOC_MAIN'`. Legacy duplicate `locations/LOC_MAIN` quarantined as `quarantined_duplicate_location_definition`.
- **Assets:** 46 legacy asset records migrated into `assets` with state `active`, valid category FK `acat_machine`/`acat_equipment`, acquisition cost, and book value.
