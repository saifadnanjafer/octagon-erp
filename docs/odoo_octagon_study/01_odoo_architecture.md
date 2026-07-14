# 01 — Odoo Core Architecture Overview
## How Odoo 19.0 Is Built (And What Octagon Can Learn)

---

## 1. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     ODOO 19.0 STACK                          │
├──────────────────────────────────────────────────────────────┤
│  Frontend    │ OWL 2 Framework (Component-based JS/XML)     │
│  API Layer   │ JSON-RPC + HTTP Controllers                  │
│  ORM Layer   │ Python ORM with computed fields, constraints │
│  Service     │ Business logic in model methods              │
│  Database    │ PostgreSQL (relational, ACID-compliant)      │
│  Modules     │ 619+ addons with __manifest__.py declarations│
└──────────────────────────────────────────────────────────────┘
```

### Octagon Equivalent

```
┌──────────────────────────────────────────────────────────────┐
│                   OCTAGON V4.0 STACK                         │
├──────────────────────────────────────────────────────────────┤
│  Frontend    │ Vanilla HTML/CSS/JS (SPA in app.js ~820KB)   │
│  API Layer   │ None (direct localStorage / file I/O)        │
│  ORM Layer   │ None (raw JSON object manipulation)          │
│  Service     │ Inline functions in app.js                   │
│  Database    │ database.json (flat-file, no relations)      │
│  Modules     │ Page functions registered in app.js          │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. Odoo's Module System

Every Odoo module is a self-contained directory:

```
addons/stock/
├── __manifest__.py          ← Module metadata (name, depends, data files)
├── __init__.py              ← Python package entry
├── models/                  ← Business logic & data models
│   ├── stock_move.py
│   ├── stock_quant.py
│   ├── stock_picking.py
│   └── stock_location.py
├── views/                   ← XML UI definitions
├── security/                ← Access control lists & record rules
│   ├── stock_security.xml   ← Groups & rule definitions
│   └── ir.model.access.csv  ← CRUD permissions per model per group
├── data/                    ← Default data, sequences
├── report/                  ← PDF report templates
├── wizard/                  ← Transient models (popup forms)
└── static/                  ← JS, CSS, images
```

### The `__manifest__.py` Pattern (Key Lesson)

```python
{
    'name': 'Inventory',                    # Human name
    'version': '1.1',                       # Semantic version
    'depends': ['product', 'barcodes_gs1_nomenclature', 'digest'],  # Dependencies
    'category': 'Supply Chain/Inventory',   # Grouping
    'data': [                               # Files loaded in order
        'security/stock_security.xml',      # ← Security FIRST
        'security/ir.model.access.csv',
        'data/stock_data.xml',              # ← Then default data
        'views/stock_picking_views.xml',    # ← Then UI
    ],
}
```

### 🎯 Octagon Lesson

Octagon has NO module system. Everything lives in `app.js`.

**V5 Goal:** Create a lightweight manifest system:
```javascript
// octagon-erp/modules/inventory/manifest.json
{
  "name": "المخزون",           // Arabic-first naming
  "version": "1.0",
  "depends": ["core", "products"],
  "pages": ["inventory_dashboard", "stock_move_form"],
  "services": ["stockService", "quantService"]
}
```

---

## 3. Odoo's ORM (Object-Relational Mapping)

Odoo models define fields declaratively:

```python
class StockMove(models.Model):
    _name = 'stock.move'                    # Table name
    _description = 'Stock Move'             # Human label
    _order = 'sequence, id'                 # Default sort

    name = fields.Char('Description', required=True)
    product_id = fields.Many2one('product.product', required=True)  # FK
    product_qty = fields.Float('Quantity')
    state = fields.Selection([              # State machine
        ('draft', 'New'),
        ('confirmed', 'Waiting'),
        ('assigned', 'Ready'),
        ('done', 'Done'),
        ('cancel', 'Cancelled'),
    ], default='draft')
    company_id = fields.Many2one('res.company')  # Multi-company
    date = fields.Datetime(default=fields.Datetime.now)
```

### Field Types Summary

| Odoo Type | PostgreSQL | Octagon Equivalent | Notes |
|-----------|-----------|-------------------|-------|
| `Char` | `varchar` | `string` | Text field |
| `Text` / `Html` | `text` | `string` | Long text |
| `Integer` | `integer` | `number` | Whole numbers |
| `Float` | `numeric` | `number` | Decimals |
| `Monetary` | `numeric` | `number` | Currency amounts |
| `Boolean` | `boolean` | `boolean` | True/false |
| `Date` | `date` | `string` (ISO) | Date only |
| `Datetime` | `timestamp` | `string` (ISO) | Date + time |
| `Selection` | `varchar` | `string` | Enum-like |
| `Many2one` | `integer` (FK) | ❌ Missing | Foreign key |
| `One2many` | (reverse FK) | ❌ Missing | Reverse relation |
| `Many2many` | (junction table) | ❌ Missing | M2M relation |
| `Binary` | `bytea` | ❌ Missing | File attachments |
| `Json` | `jsonb` | `object` | Structured data |

### 🎯 Octagon Lesson

Octagon uses flat JSON objects with NO foreign keys. The V5 migration must
introduce `_id` suffix fields to create relationships:

```javascript
// Current Octagon (flat)
{ name: "أحمد", department: "لحام" }

// V5 Octagon (relational)
{ name: "أحمد", department_id: "dept_001", department_name: "لحام" }
```

---

## 4. Computed Fields Pattern

Odoo's computed fields automatically recalculate:

```python
qty_remaining = fields.Float(
    compute='_compute_qty_remaining',
    store=True                        # Stored = persisted in DB
)

@api.depends('qty_production', 'qty_produced')
def _compute_qty_remaining(self):
    for order in self:
        order.qty_remaining = order.qty_production - order.qty_produced
```

### 🎯 Octagon Lesson

Octagon has NO computed field system. Values are calculated inline in
render functions. V5 should introduce getters:

```javascript
class StockQuant {
    get available_qty() {
        return this.qty_on_hand - this.qty_reserved;
    }
}
```

---

## 5. Key Architectural Differences

| Aspect | Odoo 19.0 | Octagon V4.0 | V5 Target |
|--------|-----------|---------------|-----------|
| Language | Python + JS | JavaScript only | JavaScript only |
| Database | PostgreSQL | JSON file | JSON file → IndexedDB |
| Relations | Full FK system | None | Soft FK with `_id` fields |
| ORM | Full ORM | None | Lightweight model layer |
| Modules | 619 addons | 1 monolith | 8-10 service modules |
| Security | Groups + Rules | Role string check | Group-based permissions |
| API | JSON-RPC | None | Event-based service bus |
| Multi-company | Built-in | Single company | Single company (keep) |
| Multi-language | Full i18n | Arabic-first | Arabic-first (keep) |

---

*Next: [02_data_model_patterns.md](./02_data_model_patterns.md) — Deep dive into database design patterns*
