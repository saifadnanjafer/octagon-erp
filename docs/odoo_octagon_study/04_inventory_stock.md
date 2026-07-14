# 04 — Stock Module Deep Dive
## Odoo Inventory → Octagon Warehouse

---

## 1. Core Models

| Model | Role | Octagon Equivalent |
|-------|------|-------------------|
| `stock.location` | WHERE items are | ❌ Missing → V5 locations[] |
| `stock.quant` | HOW MANY per location | stockItems[] (flat) |
| `stock.move` | Intent to move | ❌ Missing → V5 stock_moves[] |
| `stock.picking` | Transfer document | ❌ Missing → V5 transfers[] |

## 2. Location Tree

```
Physical Locations
├── WH/Stock (Main)         ← internal
├── WH/Input (Receiving)    ← internal
├── WH/Output (Shipping)    ← internal
├── Customers               ← customer
├── Vendors                 ← supplier
└── Scrap                   ← inventory loss
```

**Octagon V5:**
```javascript
const locations = [
    { id: "loc_main",  name: "المخزن الرئيسي",  type: "internal", parent_id: null },
    { id: "loc_weld",  name: "ورشة اللحام",     type: "internal", parent_id: "loc_main" },
    { id: "loc_scrap", name: "التالف",           type: "inventory", parent_id: null },
    { id: "loc_cust",  name: "العملاء",          type: "customer",  parent_id: null },
    { id: "loc_supp",  name: "الموردين",         type: "supplier",  parent_id: null },
];
```

## 3. Quant Model (Real-Time Stock)

One quant per: `(product_id, location_id, lot_id)`.

Key fields: `quantity`, `reserved_quantity`, `available_quantity` (computed).

**Octagon V5:**
```javascript
{ id: "q001", product_id: "prod_pipe", location_id: "loc_main",
  quantity: 150.0, reserved_quantity: 20.0, unit: "متر" }
```

## 4. Stock Move (Movement Intent)

States: `draft → confirmed → assigned → done` (or `cancel`).

Key fields: `product_id`, `product_uom_qty` (demand), `quantity` (done), `location_id` (from), `location_dest_id` (to), `origin` (source doc).

**Octagon V5:**
```javascript
function createStockMove({ product_id, quantity, from_loc, to_loc, origin }) {
    const move = {
        id: generateId('SM'), product_id, product_qty: quantity,
        qty_done: 0, location_id: from_loc, location_dest_id: to_loc,
        state: 'draft', origin, date: new Date().toISOString(),
        created_by: getCurrentUser().id,
    };
    db.stock_moves.push(move);
    createAuditEvent('stock.move.created', move.id, move);
    return move;
}

function validateStockMove(moveId) {
    const move = db.stock_moves.find(m => m.id === moveId);
    updateQuant(move.product_id, move.location_id, -move.product_qty);
    updateQuant(move.product_id, move.location_dest_id, +move.product_qty);
    move.qty_done = move.product_qty;
    move.state = 'done';
    move.date_done = new Date().toISOString();
    createAuditEvent('stock.move.done', move.id, { product: move.product_id, qty: move.product_qty });
}
```

## 5. Stock Picking (Transfer Document)

Groups multiple moves. Types: Incoming (receipt), Outgoing (delivery), Internal.
Supports backorders for partial deliveries.

---

*Next: [05_accounting_finance.md](./05_accounting_finance.md)*
