# 03 — Security Groups & Record Rules
## How Odoo Controls Access (And What Octagon Must Build)

---

## 1. Odoo's 3-Layer Security Model

```
┌─────────────────────────────────────────────────────┐
│  Layer 1: GROUPS (Who are you?)                     │
│  ─────────────────────────────────                  │
│  User belongs to groups → groups grant permissions  │
│                                                     │
│  Layer 2: ACCESS RIGHTS (What can you do?)          │
│  ─────────────────────────────────────              │
│  Per model: Read / Write / Create / Delete          │
│  Defined in ir.model.access.csv                     │
│                                                     │
│  Layer 3: RECORD RULES (What can you see?)          │
│  ────────────────────────────────────               │
│  Filter records per group using domain expressions  │
│  Defined in stock_security.xml                      │
└─────────────────────────────────────────────────────┘
```

---

## 2. Security Groups (from stock_security.xml)

Odoo defines a hierarchy of access levels per module:

```xml
<!-- Privilege Category -->
<record model="res.groups.privilege" id="res_groups_privilege_inventory">
    <field name="name">Inventory</field>
    <field name="category_id" ref="base.module_category_supply_chain"/>
</record>

<!-- Basic User -->
<record id="group_stock_user" model="res.groups">
    <field name="name">User</field>
    <field name="sequence">10</field>
    <field name="privilege_id" ref="res_groups_privilege_inventory"/>
    <field name="implied_ids" eval="[(4, ref('base.group_user'))]"/>
</record>

<!-- Administrator (inherits User) -->
<record id="group_stock_manager" model="res.groups">
    <field name="name">Administrator</field>
    <field name="sequence">20</field>
    <field name="privilege_id" ref="res_groups_privilege_inventory"/>
    <field name="implied_ids" eval="[(4, ref('group_stock_user'))]"/>
</record>
```

### Group Hierarchy Pattern

```
base.group_user (Internal User)
└── stock.group_stock_user (Inventory User)
    └── stock.group_stock_manager (Inventory Admin)
```

### Feature Toggle Groups (Hidden)

Odoo uses hidden groups to toggle features on/off:

```xml
<record id="group_stock_multi_locations" model="res.groups">
    <field name="name">Manage Multiple Stock Locations</field>
</record>

<record id="group_production_lot" model="res.groups">
    <field name="name">Manage Lots / Serial Numbers</field>
</record>

<record id="group_tracking_owner" model="res.groups">
    <field name="name">Manage Different Stock Owners</field>
</record>
```

---

## 3. Access Rights (ir.model.access.csv)

Per-model CRUD permissions:

```csv
id,name,model_id/id,group_id/id,perm_read,perm_write,perm_create,perm_unlink
access_stock_picking_user,stock.picking.user,model_stock_picking,group_stock_user,1,1,1,0
access_stock_picking_manager,stock.picking.manager,model_stock_picking,group_stock_manager,1,1,1,1
access_stock_move_user,stock.move.user,model_stock_move,group_stock_user,1,1,1,0
```

**Translation:** Stock Users can read/write/create picks but NOT delete them.
Only Managers can delete.

---

## 4. Record Rules (Row-Level Security)

Record rules filter which records a user can see:

```xml
<!-- Multi-company isolation -->
<record model="ir.rule" id="stock_picking_rule">
    <field name="name">stock_picking multi-company</field>
    <field name="model_id" search="[('model','=','stock.picking')]"/>
    <field name="domain_force">[('company_id', 'in', company_ids)]</field>
</record>

<record model="ir.rule" id="stock_move_rule">
    <field name="name">stock_move multi-company</field>
    <field name="model_id" search="[('model','=','stock.move')]"/>
    <field name="domain_force">[('company_id', 'in', company_ids)]</field>
</record>
```

**Effect:** A user in Company A can NEVER see Company B's stock movements,
even with direct database queries through the ORM.

---

## 5. Octagon's Current Security (Weak)

```javascript
// Current Octagon approach — simple role string check
if (currentUser.role === 'admin' || currentUser.role === 'manager') {
    showDeleteButton();
}
```

### Problems:
- ❌ No group hierarchy (admin OR manager, no inheritance)
- ❌ No per-model permissions (one role for everything)
- ❌ No record-level filtering (everyone sees everything)
- ❌ Roles are checked in UI only (no backend enforcement)
- ❌ No feature toggles (all-or-nothing)

---

## 6. Octagon V5 Permission Design

### Group Definitions

```javascript
const PERMISSION_GROUPS = {
    // Base groups
    'base.user': {
        name: 'مستخدم داخلي',
        implies: []
    },

    // Workshop groups
    'workshop.user': {
        name: 'عامل الورشة',
        implies: ['base.user'],
        permissions: {
            'task': ['read', 'write'],
            'machine': ['read'],
            'stock_item': ['read'],
        }
    },
    'workshop.supervisor': {
        name: 'مشرف الورشة',
        implies: ['workshop.user'],
        permissions: {
            'task': ['read', 'write', 'create'],
            'machine': ['read', 'write'],
            'stock_item': ['read', 'write', 'create'],
            'employee': ['read'],
        }
    },
    'workshop.manager': {
        name: 'مدير الورشة',
        implies: ['workshop.supervisor'],
        permissions: {
            'task': ['read', 'write', 'create', 'delete'],
            'machine': ['read', 'write', 'create', 'delete'],
            'stock_item': ['read', 'write', 'create', 'delete'],
            'employee': ['read', 'write', 'create'],
            'salary': ['read', 'write'],
        }
    },

    // Finance groups
    'finance.user': {
        name: 'محاسب',
        implies: ['base.user'],
        permissions: {
            'salary': ['read'],
            'journal_entry': ['read', 'write', 'create'],
        }
    },
    'finance.manager': {
        name: 'مدير مالي',
        implies: ['finance.user'],
        permissions: {
            'salary': ['read', 'write', 'create'],
            'journal_entry': ['read', 'write', 'create', 'delete'],
        }
    },

    // System admin
    'system.admin': {
        name: 'مدير النظام',
        implies: ['workshop.manager', 'finance.manager'],
        permissions: '*'  // All permissions
    }
};
```

### Permission Check Function

```javascript
function checkPermission(user, model, operation) {
    if (!user || !user.groups) return false;

    // Resolve all implied groups
    const allGroups = resolveGroupHierarchy(user.groups);

    for (const groupKey of allGroups) {
        const group = PERMISSION_GROUPS[groupKey];
        if (!group) continue;
        if (group.permissions === '*') return true;
        const modelPerms = group.permissions[model];
        if (modelPerms && modelPerms.includes(operation)) return true;
    }

    return false;
}

function resolveGroupHierarchy(groupKeys) {
    const resolved = new Set();
    const queue = [...groupKeys];
    while (queue.length > 0) {
        const key = queue.shift();
        if (resolved.has(key)) continue;
        resolved.add(key);
        const group = PERMISSION_GROUPS[key];
        if (group && group.implies) {
            queue.push(...group.implies);
        }
    }
    return resolved;
}
```

---

## 7. Field-Level Security

Odoo restricts field visibility by group:

```python
# Only HR users can see private employee data
private_email = fields.Char(groups="hr.group_hr_user")
birthday = fields.Date(groups="hr.group_hr_user")
salary_distribution = fields.Json(groups='hr.group_hr_user')

# Only managers can see contract details
contract_wage = fields.Monetary(groups="hr.group_hr_manager")
```

### 🎯 Octagon V5 Goal

```javascript
const FIELD_VISIBILITY = {
    'employee': {
        'salary':        ['finance.user', 'finance.manager', 'system.admin'],
        'phone_private': ['workshop.manager', 'system.admin'],
        'bank_account':  ['finance.manager', 'system.admin'],
    }
};

function canSeeField(user, model, fieldName) {
    const restrictions = FIELD_VISIBILITY[model]?.[fieldName];
    if (!restrictions) return true;  // No restriction = visible to all
    const userGroups = resolveGroupHierarchy(user.groups);
    return restrictions.some(g => userGroups.has(g));
}
```

---

*Next: [04_inventory_stock.md](./04_inventory_stock.md) — Stock module deep dive*
