# 11 — Odoo ↔ Octagon Entity Mapping Matrix
## Complete Translation Table

---

## 1. Core Entity Mapping

| # | Odoo Model | Odoo Purpose | Octagon V4 | Octagon V5 Collection | Priority |
|---|-----------|-------------|-------------|----------------------|----------|
| 1 | `res.partner` | Universal contact | Flat strings in tasks | `contacts[]` | 🔴 High |
| 2 | `res.users` | System user | `currentUser` role string | `users[]` with groups | 🔴 High |
| 3 | `res.company` | Company entity | Single company (implicit) | Keep single | ⚪ None |
| 4 | `hr.employee` | Employee record | `employees[]` (basic) | `employees[]` (enriched) | 🟡 Medium |
| 5 | `hr.department` | Department | String in employee | `departments[]` | 🟡 Medium |
| 6 | `product.product` | Product/material | `omni.materials[]` (current V4 source) | `products[]` / future material view | 🔴 High |
| 7 | `stock.location` | Warehouse location | ❌ Missing | `locations[]` | 🔴 High |
| 8 | `stock.quant` | On-hand inventory | stock/reserved fields in `omni.materials[]` | `quants[]` | 🔴 High |
| 9 | `stock.move` | Stock movement | ❌ Missing | `stock_moves[]` | 🔴 High |
| 10 | `stock.picking` | Transfer document | ❌ Missing | `transfers[]` | 🟡 Medium |
| 11 | `mrp.production` | Manufacturing order | `omni.kanban.cards[]` / `omni.orders[]` | `production_orders[]` | 🟡 Medium |
| 12 | `mrp.workorder` | Work operation | task subtasks inside Omni cards/task manager | `work_orders[]` | 🟡 Medium |
| 13 | `mrp.workcenter` | Machine/station | `omni.machines[]` | `omni.machines[]` (enriched) | 🟡 Medium |
| 14 | `mrp.bom` | Bill of Materials | ❌ Missing | `bom[]` (future) | 🟢 Low |
| 15 | `maintenance.equipment` | Equipment asset | `omni.machines[]` (basic) | `omni.machines[]` (with MTBF) | 🟡 Medium |
| 16 | `maintenance.request` | Maintenance ticket | ❌ Missing | `maintenance_requests[]` | 🟡 Medium |
| 17 | `account.account` | Chart of Accounts | `finance.accounts[]` | keep `finance.accounts[]` | 🔴 High |
| 18 | `account.journal` | Journal (Sales/Bank) | ❌ Missing | `journals[]` | 🟡 Medium |
| 19 | `account.move` | Journal Entry | ❌ Missing | `journal_entries[]` | 🔴 High |
| 20 | `account.move.line` | Journal Item | ❌ Missing | Embedded in entry | 🔴 High |
| 21 | `account.payment` | Payment record | ❌ Missing | `payments[]` | 🟡 Medium |

---

## 2. Field-Level Mapping: Employee

| Odoo Field | Type | Octagon V4 | V5 Field | Notes |
|-----------|------|-------------|----------|-------|
| `id` | int | array index | `id` (UUID) | Must be unique |
| `name` | Char | `name` ✅ | `name` | Keep as-is |
| `barcode` | Char | ❌ | `badge_id` | Add unique badge |
| `department_id` | FK | `department` (str) | `department_id` (FK) | Convert to reference |
| `job_title` | Char | ❌ | `job_title` | Add |
| `parent_id` | FK | ❌ | `manager_id` | Add manager reference |
| `work_phone` | Char | ❌ | `phone` | Add |
| `birthday` | Date | ❌ | `birthday` | Add (restricted) |
| `contract_wage` | Monetary | `baseSalary` | `wage` | Already exists |
| `contract_date_start` | Date | ❌ | `contract_start` | Add |
| `hr_presence_state` | Selection | ❌ | `presence` | From attendance |
| `active` | Boolean | ❌ | `is_active` | Add soft-delete |
| `create_date` | Datetime | ❌ | `created_at` | Add audit |
| `write_date` | Datetime | ❌ | `updated_at` | Add audit |

## 3. Field-Level Mapping: Stock Item → Product

| Odoo Field | Octagon V4 | V5 Field |
|-----------|-------------|----------|
| `name` | `name` ✅ | `name` |
| `default_code` | ❌ | `code` (SKU) |
| `type` | ❌ | `type` (product/consumable/service) |
| `categ_id` | `category` (str) | `category_id` (FK) |
| `uom_id` | `unit` ✅ | `unit_id` |
| `list_price` | ❌ | `sale_price` |
| `standard_price` | `price` | `cost_price` |
| `qty_available` | `quantity` | Computed from quants |
| `virtual_available` | ❌ | Computed (on_hand - reserved + incoming) |
| `tracking` | ❌ | `tracking` (none/lot/serial) |
| `active` | ❌ | `is_active` |

## 4. Field-Level Mapping: Task → Work Order

| Odoo Field | Octagon V4 | V5 Field |
|-----------|-------------|----------|
| `name` | Task title | `name` |
| `production_id` | Parent task | `production_id` (FK) |
| `workcenter_id` | `machine` (str) | `machine_id` (FK) |
| `state` | `status` | `state` (with transitions) |
| `qty_producing` | ❌ | `qty_planned` |
| `qty_produced` | ❌ | `qty_done` |
| `duration_expected` | ❌ | `duration_expected` (min) |
| `duration` | ❌ | `duration_actual` (min) |
| `date_start` | ❌ | `date_start` |
| `date_finished` | ❌ | `date_finished` |
| `costs_hour` | ❌ | `cost_per_hour` |
| `blocked_by_workorder_ids` | ❌ | `blocked_by_ids[]` |
| `time_ids` | ❌ | `time_entries[]` |

## 5. New Collections Needed for V5

```javascript
// database.json V5 structure
{
    // Existing (enhanced)
    employees: [],          // + audit fields, FK refs, badge
    finance: {
        accounts: [],       // Existing chart of accounts, enriched in place
    },
    omni: {
        materials: [],      // Current stock/product source
        machines: [],       // + MTBF, maintenance schedule
        kanban: { cards: [] } // Current task/work source
    },

    // NEW collections
    contacts: [],           // Customers, suppliers
    departments: [],        // Department definitions
    users: [],              // System users with groups
    locations: [],          // Warehouse locations
    quants: [],             // Real-time stock per location
    stock_moves: [],        // Stock movement records
    transfers: [],          // Transfer documents
    journals: [],           // Accounting journals
    journal_entries: [],    // Double-entry records
    payments: [],           // Payment records
    maintenance_requests: [], // Maintenance tickets
    production_orders: [],  // Manufacturing orders
    work_orders: [],        // Individual operations
    audit_log: [],          // Append-only audit trail
}
```

---

*Next: [12_octagon_upgrade_roadmap.md](./12_octagon_upgrade_roadmap.md)*
