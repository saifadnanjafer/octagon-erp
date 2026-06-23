# 05 — Accounting Module Deep Dive
## Double-Entry Bookkeeping → Octagon Finance Engine

---

## 1. Core Accounting Models

| Odoo Model | Role | Octagon V5 |
|-----------|------|-------------|
| `account.move` | Journal Entry (header) | `journal_entries[]` |
| `account.move.line` | Journal Item (debit/credit line) | `journal_lines[]` |
| `account.account` | Chart of Accounts | `accounts[]` |
| `account.journal` | Journal (Sales/Purchase/Cash/Bank) | `journals[]` |
| `account.payment` | Payment record | `payments[]` |

## 2. The Double-Entry Rule

> **Every transaction must have EQUAL debits and credits.**

```
┌─────────────────────────────────────────────────┐
│  Journal Entry: INV/2026/00042                  │
├──────────────────┬──────────┬───────────────────┤
│  Account         │  Debit   │  Credit           │
├──────────────────┼──────────┼───────────────────┤
│  حسابات مدينة    │  1,500   │                   │
│  إيرادات المبيعات │          │  1,500            │
├──────────────────┼──────────┼───────────────────┤
│  TOTAL           │  1,500   │  1,500  ✅ Balanced│
└──────────────────┴──────────┴───────────────────┘
```

**SQL Constraint in Odoo:**
```python
_check_balanced = models.Constraint(
    "debit_credit_balanced",
    "Journal entry is not balanced."
)
```

## 3. account.move (Journal Entry Header)

Key fields from Odoo source:

```python
name = fields.Char('Number', default='/')          # Auto-sequence: INV/2026/0001
move_type = fields.Selection([
    ('entry', 'Journal Entry'),
    ('out_invoice', 'Customer Invoice'),
    ('out_refund', 'Customer Credit Note'),
    ('in_invoice', 'Vendor Bill'),
    ('in_refund', 'Vendor Credit Note'),
    ('out_receipt', 'Sales Receipt'),
    ('in_receipt', 'Purchase Receipt'),
])
state = fields.Selection([
    ('draft', 'Draft'),
    ('posted', 'Posted'),
    ('cancel', 'Cancelled'),
])
date = fields.Date(required=True)
partner_id = fields.Many2one('res.partner')
journal_id = fields.Many2one('account.journal', required=True)
line_ids = fields.One2many('account.move.line')
amount_total = fields.Monetary(compute=...)
currency_id = fields.Many2one('res.currency')
```

### State Machine:
```
draft → posted (irreversible in most configs)
draft → cancel
posted → (can only reverse with credit note)
```

## 4. account.move.line (Journal Item)

Key fields:

```python
account_id = fields.Many2one('account.account', required=True)
name = fields.Char('Label')
debit = fields.Monetary()
credit = fields.Monetary()
balance = fields.Monetary()  # = debit - credit
amount_currency = fields.Monetary()  # Multi-currency
partner_id = fields.Many2one('res.partner')
date_maturity = fields.Date('Due Date')

# Reconciliation
amount_residual = fields.Monetary(compute=...)
reconciled = fields.Boolean(compute=...)
full_reconcile_id = fields.Many2one('account.full.reconcile')

# Tax
tax_ids = fields.Many2many('account.tax')
tax_line_id = fields.Many2one('account.tax')

# Constraints
_check_credit_debit = "CHECK(credit * debit = 0)"  # Can't have both
_check_balanced = "CHECK(balance sign matches amount_currency)"
```

## 5. Octagon V5 Accounting Design

### Simplified Chart of Accounts

```javascript
const accounts = [
    { id: "1000", code: "1000", name: "النقدية",           type: "asset_cash" },
    { id: "1100", code: "1100", name: "حسابات مدينة",      type: "asset_receivable" },
    { id: "1200", code: "1200", name: "المخزون",           type: "asset_current" },
    { id: "2000", code: "2000", name: "حسابات دائنة",      type: "liability_payable" },
    { id: "2100", code: "2100", name: "رواتب مستحقة",      type: "liability_current" },
    { id: "4000", code: "4000", name: "إيرادات المبيعات",   type: "income" },
    { id: "5000", code: "5000", name: "تكلفة المواد",       type: "expense" },
    { id: "5100", code: "5100", name: "الرواتب والأجور",    type: "expense" },
    { id: "5200", code: "5200", name: "مصاريف الورشة",     type: "expense" },
];
```

### Create Journal Entry

```javascript
function createJournalEntry({ date, journal, partner_id, lines, origin }) {
    // Validate balance
    const totalDebit = lines.reduce((s, l) => s + (l.debit || 0), 0);
    const totalCredit = lines.reduce((s, l) => s + (l.credit || 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
        throw new Error('القيد غير متوازن! المدين يجب أن يساوي الدائن');
    }

    const entry = {
        id: generateId('JE'),
        name: generateSequence('JE', date),
        date,
        journal,
        partner_id,
        state: 'draft',
        lines: lines.map((l, i) => ({
            id: generateId('JL'),
            sequence: i,
            account_id: l.account_id,
            label: l.label,
            debit: l.debit || 0,
            credit: l.credit || 0,
            partner_id: l.partner_id || partner_id,
        })),
        amount_total: totalDebit,
        origin,
        created_by: getCurrentUser().id,
        created_at: new Date().toISOString(),
    };

    db.journal_entries.push(entry);
    createAuditEvent('journal.entry.created', entry.id, { total: totalDebit });
    return entry;
}
```

### Common Workshop Transactions

| Transaction | Debit | Credit |
|------------|-------|--------|
| شراء مواد (Purchase) | 1200 المخزون | 2000 دائنون |
| بيع منتج (Sale) | 1100 مدينون | 4000 إيرادات |
| دفع رواتب (Payroll) | 5100 رواتب | 1000 نقدية |
| صرف مواد للإنتاج | 5000 تكلفة مواد | 1200 المخزون |
| تحصيل من عميل | 1000 نقدية | 1100 مدينون |

## 6. Reconciliation (مطابقة)

Odoo matches receivables/payables to payments:
- Partial reconcile: `account.partial.reconcile`
- Full reconcile: `account.full.reconcile`
- Residual tracking: `amount_residual` on each line

**Octagon V5:** Start simple — link payments to invoices via `origin` field.

---

*Next: [06_hr_employee.md](./06_hr_employee.md)*
