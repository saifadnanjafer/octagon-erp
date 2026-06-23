# 06 — HR & Employee Management
## Odoo Employee Model → Octagon Worker System

---

## 1. Odoo HR Architecture

```
hr.employee (1862 lines!)
├── Inherits: mail.thread, mail.activity.mixin, resource.mixin, avatar.mixin
├── Delegation: hr.version (contract versioning)
├── Links to: res.users (system login)
├── Links to: res.partner (contact data via work_contact_id)
└── Links to: resource.resource (calendar/scheduling)
```

## 2. Key Employee Fields (from source)

### Identity & Work
| Field | Type | Octagon Equivalent |
|-------|------|-------------------|
| `name` | Char | `name` ✅ |
| `barcode` | Char (Badge ID) | ❌ Missing |
| `pin` | Char (PIN for kiosk) | ❌ Missing |
| `company_id` | Many2one | N/A (single company) |
| `department_id` | Many2one | `department` (string) |
| `job_id` / `job_title` | Many2one/Char | `position` (string) |
| `parent_id` | Many2one (Manager) | ❌ Missing |
| `coach_id` | Many2one | ❌ Missing |
| `category_ids` | Many2many (Tags) | ❌ Missing |
| `work_phone` / `mobile_phone` | Char | ❌ Missing |
| `work_email` | Char | ❌ Missing |
| `work_location_id` | Many2one | ❌ Missing |

### Private Info (restricted to HR group)
| Field | Type | Notes |
|-------|------|-------|
| `private_phone` | Char | groups="hr.group_hr_user" |
| `private_email` | Char | groups="hr.group_hr_user" |
| `birthday` | Date | groups="hr.group_hr_user" |
| `place_of_birth` | Char | groups="hr.group_hr_user" |
| `country_of_birth` | Many2one | groups="hr.group_hr_user" |
| `emergency_contact` | Char | groups="hr.group_hr_user" |
| `emergency_phone` | Char | groups="hr.group_hr_user" |
| `bank_account_ids` | Many2many | groups="hr.group_hr_user" |
| `certificate` | Selection | Education level |
| `permit_no` | Char | Work permit |
| `visa_expire` | Date | Visa tracking |

### Contract & Salary (restricted to HR manager)
| Field | Type | Notes |
|-------|------|-------|
| `contract_date_start` | Date | groups="hr.group_hr_manager" |
| `contract_date_end` | Date | groups="hr.group_hr_manager" |
| `contract_wage` | Monetary | groups="hr.group_hr_manager" |
| `structure_type_id` | Many2one | Salary structure |

### Presence
| Field | Type | Notes |
|-------|------|-------|
| `hr_presence_state` | Selection | present/absent/off-hours |
| `last_activity` | Date | Last login activity |
| `newly_hired` | Boolean | < 90 days |

## 3. Version System (Contract History)

Odoo 19 introduces `hr.version` — a time-based snapshot of employee contract data:

```python
version_ids = fields.One2many('hr.version', 'employee_id')
current_version_id = fields.Many2one('hr.version', compute=...)

# Version contains: date_start, date_end, wage, schedule, department, job...
# When you change an employee's department, it creates a NEW version
# Old data is PRESERVED — never overwritten
```

### 🎯 Octagon Lesson

Octagon overwrites employee data in-place. No history.

**V5 Goal:** Keep a `changes` array:
```javascript
{
    id: "emp_001",
    name: "أحمد",
    current: { department: "لحام", wage: 750000, start_date: "2026-01-01" },
    history: [
        { department: "مساعد", wage: 500000, start_date: "2025-06-01", end_date: "2025-12-31" },
    ]
}
```

## 4. Octagon V5 Employee Model

```javascript
const employeeSchema = {
    // Identity
    id: "emp_UUID",
    name: "أحمد محمد",               // Required
    badge_id: "EMP-001",             // Unique badge/barcode
    department_id: "dept_welding",
    job_title: "لحام أول",
    manager_id: "emp_002",           // FK to another employee

    // Contact
    phone: "+964...",
    emergency_contact: "محمد (أب)",
    emergency_phone: "+964...",

    // Employment
    hire_date: "2025-06-01",
    contract_start: "2026-01-01",
    contract_end: null,              // null = ongoing
    wage: 750000,
    wage_type: "monthly",            // monthly | daily | hourly

    // Status
    is_active: true,
    presence_state: "present",       // present | absent | off_hours

    // Audit
    created_at: "...",
    created_by: "...",
    updated_at: "...",
    updated_by: "...",
};
```

## 5. Unique Constraints

From Odoo source:
```python
_barcode_uniq = models.Constraint('unique (barcode)', 'Badge ID must be unique')
_user_uniq = models.Constraint('unique (user_id, company_id)', 'One user per company')
```

**Octagon V5:** Enforce in service layer:
```javascript
function createEmployee(data) {
    if (db.employees.some(e => e.badge_id === data.badge_id)) {
        throw new Error('رقم البطاقة مستخدم مسبقاً');
    }
    // ... create logic
}
```

---

*Next: [07_manufacturing_mrp.md](./07_manufacturing_mrp.md)*
