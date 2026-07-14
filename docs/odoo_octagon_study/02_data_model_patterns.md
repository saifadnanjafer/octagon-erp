# 02 — Database & Model Design Patterns
## How Odoo Structures Data (And What Octagon Needs)

---

## 1. The Golden Fields (Every Model Has These)

Every Odoo model automatically gets these audit/system fields:

```
┌─────────────────────────────────────────────────────────────┐
│  GOLDEN FIELDS — Present on EVERY Odoo record              │
├─────────────────────────────────────────────────────────────┤
│  id            │ Auto-increment integer primary key         │
│  create_uid    │ FK → res.users (who created)               │
│  create_date   │ Timestamp (when created)                   │
│  write_uid     │ FK → res.users (who last modified)         │
│  write_date    │ Timestamp (when last modified)             │
│  active        │ Boolean (soft-delete / archive flag)       │
│  company_id    │ FK → res.company (multi-company filter)    │
│  display_name  │ Computed human-readable name               │
└─────────────────────────────────────────────────────────────┘
```

### 🎯 Octagon Lesson — CRITICAL

Octagon records have NONE of these fields. Every record in `database.json`
should gain at minimum:

```javascript
{
    id: "auto_uuid",          // Unique identifier
    created_by: "user_id",    // Who created this
    created_at: "ISO_DATE",   // When created
    updated_by: "user_id",    // Who last edited
    updated_at: "ISO_DATE",   // When last edited
    is_active: true,          // Soft-delete flag
}
```

**Implementation Rule:** These fields must be added by the service layer
automatically — NOT by each page manually.

---

## 2. The `res.partner` Pattern (Universal Contact)

Odoo uses ONE model for all contacts: customers, vendors, employees, companies.

```
res.partner
├── name              "شركة الفجر"
├── is_company        true              ← Company vs Person
├── type              "contact"         ← contact|invoice|delivery|other
├── parent_id         → res.partner     ← Company this person belongs to
├── child_ids         ← res.partner[]   ← People in this company
├── ref               "CUST-001"        ← Reference code
├── vat               "1234567890"      ← Tax ID
├── email             "info@alfajr.com"
├── phone             "+964..."
├── street / city     address fields
├── country_id        → res.country
├── category_ids      → res.partner.category[]  ← Tags
├── bank_ids          → res.partner.bank[]
├── commercial_partner_id  → res.partner  ← Top-level billing entity
└── user_ids          ← res.users[]     ← Linked system users
```

### Key Pattern: Parent/Child Hierarchy

```
شركة الفجر (Company)
├── أحمد (Contact — employee)
├── محمد (Invoice Address)
└── عنوان التسليم (Delivery Address)
```

### 🎯 Octagon Lesson

Octagon stores customers/suppliers as flat strings in task records.
No dedicated contact entity exists.

**V5 Goal:** Create a lightweight `Contact` model:

```javascript
// contacts collection in database.json
{
    id: "contact_001",
    name: "شركة الفجر",
    is_company: true,
    type: "customer",       // customer | supplier | both
    phone: "+964...",
    address: "بغداد",
    parent_id: null,
    tags: ["عميل VIP"],
    // audit fields...
}
```

---

## 3. The State Machine Pattern

Odoo uses `Selection` fields to model document lifecycle:

```python
# stock.picking states
state = fields.Selection([
    ('draft', 'Draft'),          # Initial
    ('waiting', 'Waiting'),      # Waiting for stock
    ('confirmed', 'Confirmed'),  # Order confirmed
    ('assigned', 'Ready'),       # Stock reserved
    ('done', 'Done'),            # Completed
    ('cancel', 'Cancelled'),     # Voided
])
```

**Transition Rules** (enforced in Python methods):

```
draft → confirmed → assigned → done
  ↓         ↓                    ↓
cancel    cancel              (final)
```

### 🎯 Octagon Lesson

Octagon tasks use simple status strings ("pending", "in_progress", "done")
with NO transition validation. Anyone can set any status.

**V5 Goal:** Enforce state transitions:

```javascript
const TASK_TRANSITIONS = {
    'draft':       ['confirmed', 'cancelled'],
    'confirmed':   ['in_progress', 'cancelled'],
    'in_progress': ['quality_check', 'cancelled'],
    'quality_check': ['done', 'rework'],
    'rework':      ['in_progress'],
    'done':        [],           // Terminal state
    'cancelled':   ['draft'],    // Can reopen
};

function transitionTask(task, newState) {
    const allowed = TASK_TRANSITIONS[task.state];
    if (!allowed.includes(newState)) {
        throw new Error(`لا يمكن الانتقال من ${task.state} إلى ${newState}`);
    }
    task.state = newState;
    task.updated_at = new Date().toISOString();
    createAuditEvent('task.state_change', task.id, { from: task.state, to: newState });
}
```

---

## 4. Soft Delete Pattern

Odoo NEVER hard-deletes business records. It uses the `active` field:

```python
active = fields.Boolean(default=True)

# "Deleting" a record:
record.active = False   # → Hidden from search, but data preserved

# Searching includes active filter by default:
self.search([])                              # Only active=True
self.with_context(active_test=False).search([])  # Include archived
```

### 🎯 Octagon Lesson

Octagon uses `delete` operations that permanently remove data.

**V5 Rule:** NEVER delete records. Always soft-delete:

```javascript
function archiveRecord(collection, id) {
    const record = db[collection].find(r => r.id === id);
    record.is_active = false;
    record.archived_at = new Date().toISOString();
    record.archived_by = currentUser.id;
    saveDatabase();
}
```

---

## 5. Naming Conventions

| Odoo Convention | Example | Octagon V5 Convention |
|----------------|---------|----------------------|
| `snake_case` model names | `stock.move` | `stock_move` |
| `_id` suffix for FK | `product_id` | `product_id` |
| `_ids` suffix for M2M | `tag_ids` | `tag_ids` |
| `_count` for aggregates | `maintenance_count` | `_count` suffix |
| `is_` prefix for booleans | `is_company` | `is_` prefix |
| `date_` prefix for dates | `date_start` | `date_` prefix |

---

## 6. Inheritance Patterns

Odoo has 3 types of model inheritance:

| Type | Syntax | What It Does |
|------|--------|-------------|
| **Extension** | `_inherit = 'res.partner'` | Adds fields to existing model |
| **Delegation** | `_inherits = {'res.partner': 'partner_id'}` | Links to parent via FK |
| **Abstract** | `_inherit = ['mail.thread']` | Mixin — adds capabilities |

### Key Mixins Used Everywhere:

```python
class MyModel(models.Model):
    _inherit = ['mail.thread',           # Adds chatter/messaging
                'mail.activity.mixin',   # Adds scheduled activities
                'resource.mixin']        # Adds working calendar support
```

### 🎯 Octagon Lesson

Octagon has no inheritance system. V5 should use JS mixins:

```javascript
// Core mixin — adds audit fields to any model
const AuditMixin = {
    addAuditFields(record) {
        record.created_at = record.created_at || new Date().toISOString();
        record.created_by = record.created_by || getCurrentUser().id;
        record.updated_at = new Date().toISOString();
        record.updated_by = getCurrentUser().id;
    }
};
```

---

*Next: [03_security_permissions.md](./03_security_permissions.md) — Security groups and access control*
