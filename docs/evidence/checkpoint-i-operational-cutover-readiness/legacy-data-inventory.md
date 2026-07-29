# Checkpoint I — Legacy Data Inventory (I2)

**Source:** staged clone `checkpoint-i_2026-07-29T13-35-40-967Z`
**Legacy store:** `collections` table — 4,067 rows across 37 collections
**Method:** read-only field-frequency analysis of every row in every collection

Field lists below are exhaustive per collection. `field(n/total)` marks a field
present on only some rows — i.e. a genuinely optional or drifted attribute.

## Frozen zone — READ ONLY, NOT MIGRATED

Per `CLAUDE.md`, payroll, attendance and timesheet data are read-only in every
edit. These collections are inventoried for completeness and **excluded from all
migration scope**. No canonical destination is assigned and no write is planned.

| Collection | Rows | Note |
|---|---:|---|
| `employees` | 26 | frozen |
| `employee_advances` | 374 | frozen |
| `omni.workshopAdvances` | 373 | frozen |
| `omni.employeeAttendance` | 104 | frozen |
| `omni.workshopTimesheetCases` | 24 | frozen |
| `omni.workshopAccountReviews` | 24 | frozen |
| `omni.workshopExcelChangeLog` | 23 | frozen |
| `employee_payroll_closings` | 7 | frozen |
| `payroll_payments` | 3 | frozen |
| `payroll_periods` | 3 | frozen |
| **Total frozen** | **961** | **23.6% of legacy rows** |

## Migration-scope inventory

### I1 — Identity and control plane

| Collection | Rows | Destination | Risk |
|---|---:|---|---|
| `omni.departments` | 7 | `organization_departments` | low — `id`, `name` only |
| `finance.departments` | 5 | `finance_dimensions` / departments | **duplicate authority** — overlaps `omni.departments`; reconcile before migrating |
| `omni.migrationsApplied` | 33 | **none — not business data** | bare JSON strings (`"admin_settings_v1"`), legacy feature-flag markers |
| `omni.aiProviders` | 7 | existing AI config | contains `apiKeySource` — verify no key material migrates |
| `omni.aiToolRegistry` | 51 | existing AI registry | already governed; out of cutover scope |
| `omni.aiAuditLog` | 1,199 | `platform_audit_log` or retain-in-place | **largest collection**; append-only log, low value to migrate |

### I2 — Master data

| Collection | Rows | Destination | Risk |
|---|---:|---|---|
| `omni.materials` | 8 | `product_templates` + `product_variants` + `uoms` | UOMs are free-text Arabic (`لوح`, `علبة`, `متر`, `قطعة`, `رول`) — need a `uom_categories`/`uoms` mapping table, not inference |
| `omni.suppliers` | 6 | `parties` + `party_roles(supplier)` | carries embedded `catalog`/`priceHistory` arrays → separate destinations |
| `finance.customers` | 1 | `parties` + `party_roles(customer)` | **demo record** — `cust_demo` / "عميل تجريبي"; quarantine, do not migrate as real |
| `omni.warehouses` | 1 | `warehouses` | `MAIN_WORKSHOP`; clean |
| `omni.storageLocations` | 3 | `stock_locations` | **conflicts with `locations`** — see below |
| `locations` | 4 | `stock_locations` | **conflicts with `omni.storageLocations`** — see below |
| `omni.equipment` | 39 | `finance_asset_categories` / assets | lifecycle state is `status` free-text |
| `omni.machines` | 7 | assets + maintenance | carries `maintenanceIntervalHours/Days`, `activityLog` |

#### Location model conflict — BLOCKING for I2

Two legacy location authorities exist with **overlapping IDs and contradictory
semantics**:

| ID | `omni.storageLocations` | `locations` |
|---|---|---|
| `LOC_MAIN` | `type: "stock"`, name "المخزن الرئيسي (Entity)", `warehouseId: MAIN_WORKSHOP` | `type: "internal"`, name "المخزن الرئيسي", `parent_id: null` |
| `MAIN_STOCK` | `type: "stock"`, "المخزن الرئيسي" | absent |
| `LOC_WIP` | `type: "internal"`, "ورشة التنفيذ" | absent |
| `LOC_SCRAP` | absent | `type: "inventory"`, "تسوية الفروقات" |
| `LOC_SUPPLIERS` | absent | `type: "supplier"`, "الموردون" |

`LOC_MAIN` exists in both with a different `type`. A naive merge would either
silently drop one definition or create a duplicate business key. This must be
resolved by an explicit mapping decision before any stock quantity is migrated,
because `stock_quants` rows are keyed on location.

**Recommended resolution (owner confirmation required):** treat
`omni.storageLocations` as authoritative for physical stock topology (it carries
`warehouseId` linkage), and `locations` as the source for the virtual//accounting
locations `LOC_SCRAP` and `LOC_SUPPLIERS` that it uniquely defines. Migrate
`LOC_MAIN` once, from `omni.storageLocations`, as `type: stock`.

### I3 — Opening inventory

Sourced entirely from `omni.materials` (8 rows). Fully reconciled — see
[`opening-inventory-reconciliation.md`](opening-inventory-reconciliation.md).

### I4 — Commercial and finance

| Collection | Rows | Destination | Risk |
|---|---:|---|---|
| `account_moves` | 568 | `finance_journal_entries` + `finance_journal_lines` | canonical-shaped already: has `sourceType`, `sourceId`, `sourceCanonicalKey`, `hash`, `previous_hash` |
| `journal_entries` | 568 | **duplicate of `account_moves`** | same count — legacy v5/v6 dual representation; migrate ONE, prove equivalence first |
| `finance.transactions` | 526 | source-fact layer | `sourceType`/`importSource` present; 567/568 `account_moves` carry `financeTransactionId` back-reference |
| `finance.accounts` | 34 | `finance_accounts` | operational `finance_accounts` already has **16 rows** — merge/dedup required, not a clean insert |
| `journals` | 5 | `finance_journals` | operational `finance_journals` already has 6 rows — same issue |

#### Finance duplicate-representation hazard — BLOCKING for I4

`account_moves` (568) and `journal_entries` (568) hold the same count and
overlapping fields (`name`, `date`, `journal_id`, `state`, `amount_total`,
`hash`). `account_moves` additionally carries `sourceCanonicalKey`,
`postingEngine` and `financeTransactionId`, and is referenced by
`employee_advances.accountMoveId`.

Migrating both would double every journal entry and break debit/credit equality
against the source. Migrating neither loses all finance history.

**Recommended:** treat `account_moves` as authoritative; prove
1:1 correspondence with `journal_entries` by `id`/`name` during `cutover:validate`;
quarantine any `journal_entries` row without a matching `account_moves` row.

Note also that `finance_accounts` (16) and `finance_journals` (6) are **already
populated** in the canonical schema, unlike every other canonical business table.
The legacy `finance.accounts` (34) and `journals` (5) must therefore be
reconciled against existing canonical rows rather than inserted blind.

### I5 — Operations

| Collection | Rows | Destination | Risk |
|---|---:|---|---|
| `omni.workOrders` | 3 | `work_items` | **all 3 are demo records** — ids `demo_wo_surface_1..3`, titles prefixed "مثال تشغيل" (example run). Quarantine, do not migrate as real work. |
| `omni.boms` | 7 | BOM tables | references `sourcePackId` → `omni.opPacks` |
| `omni.opPacks` | 7 | routings / operation packs | carries `steps`, `materials`, `machines`, `qcGates` |
| `omni.qcTemplates` | 7 | quality templates | clean |
| `omni.qcRecords` | 3 | quality records | clean |
| `omni.sops` | 5 | knowledge / SOP | large text; low migration risk |
| `omni.employeeRequests` | 1 | people ops | single row |
| `omni.whatsappGroups` | 1 | integration config | not business data |

## Summary

| Category | Collections | Rows |
|---|---:|---:|
| Frozen (excluded) | 10 | 961 |
| Migration candidates | 22 | 1,874 |
| Not business data (logs/flags/config) | 5 | 1,232 |
| **Total** | **37** | **4,067** |

## Unresolved items requiring owner decision

1. **Location model conflict** — `LOC_MAIN` defined twice with different types.
2. **Finance dual representation** — `account_moves` vs `journal_entries`, 568 each.
3. **Pre-populated canonical finance tables** — `finance_accounts` (16),
   `finance_journals` (6) must be merged, not inserted.
4. **Demo data in operational store** — `finance.customers/cust_demo` and all 3
   `omni.workOrders`. Confirm these are disposable before quarantining.
5. **Arabic free-text UOMs** — require an explicit mapping table; must not be
   inferred.
6. **Opening inventory accounting date** — unchanged owner gate, see
   [`opening-inventory-reconciliation.md`](opening-inventory-reconciliation.md).

No values were inferred or fabricated to satisfy required canonical fields.
Every unresolved item above is routed to quarantine rather than guessed.
