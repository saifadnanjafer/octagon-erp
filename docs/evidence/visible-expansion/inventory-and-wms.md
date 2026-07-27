# Inventory and WMS — Checkpoint B

## Status

A **distinct, visible original-shell module** with seven working surfaces and a
real Draft → Validate lifecycle proven end to end in a browser, including the
failure path.

| Item | Value |
|---|---|
| Navigation label | المخزون القانوني / Canonical Inventory |
| Page key / section | `canonical_inventory` / `pageCanonicalInventory` |
| View | `views/canonical_inventory.html` |
| Module | `modules/canonical-inventory.js` |
| Stylesheet | `modules/canonical-inventory.css` (every selector scoped under `#pageCanonicalInventory`, asserted by test) |
| Permission | `canonical_inventory` → `workshop.user`, `workshop.manager`, `system.admin` |
| Tests | `tests/phase04-finalization/canonical_inventory.test.mjs` — 15 |

## Surfaces

| Tab | Canonical read | Canonical command |
|---|---|---|
| المستودعات / Warehouses | `GET /inventory/warehouses` | `warehouse:create` |
| المواقع / Locations | `GET /inventory/locations` | `stock:location:create` |
| استلام مخزني / Stock Receipt | — | `stock:move:post` (per line) |
| الأرصدة والتقييم / Balances & Valuation | `GET /inventory/quants?product_id=`, `GET /inventory/valuation?product_id=` | read-only |
| الحركات / Movements | `GET /inventory/operations` | read-only |
| الحجوزات / Reservations | `GET /inventory/reservations` | `stock:reservation:reserve`, `:release` |
| التتبّع / Traceability | `GET /inventory/lots|serials|packages` | `stock:lot:create` |

### Why Balances is a lookup, not a grid

`/inventory/quants` and `/inventory/valuation` **require** a `product_id` and
return a single object, not a list. Rendering a grid there would mean inventing
an aggregate the engine does not expose. So that tab is an explicit per-product
lookup showing on-hand / reserved / available / valuation as four read-only
metrics.

This also fixed a latent defect in the Canonical Operations console, whose
inventory tab called `balances` with no `product_id` and therefore rendered a
permanently empty grid with no error. That tab now shows movement history
(`/inventory/operations`), which is a genuine list.

## Draft → Validate lifecycle

```
Draft (client-side staging, nothing persisted)
  -> Validate
  -> stock:move:post per line
  -> atomic canonical transaction
  -> success / failure per line
  -> refresh + durable per-line outcome
```

**"Draft" is honestly a client-side staging step.** The canonical engine posts
a stock move atomically and has no separate server-side draft state for a bare
move, so the draft exists only so the operator can review before committing.
That is stated in the module header, shown to the user in both languages, and
asserted by test.

A failed line **stays in the draft**; a posted line leaves it. The operator sees
a durable per-line result table with the machine code and reason — not just a
toast that disappears.

## Real authenticated browser results

Server: `octagon-preview-auth` on a **disposable database copy**, authenticated
as `test.sysadmin` with company scope `c_octagon_test`.

### Page mount

| Check | Result |
|---|---|
| Sidebar entry visible | **PASS** — `المخزون القانوني` |
| Page opens and self-activates | **PASS** — `sectionVisible: true`, `page-active`, nav active |
| Module mounted | **PASS** — `typeof window.CanonicalInventory === 'object'` |
| Seven tabs render | **PASS** |
| Authority banner | **PASS** — INVENTORY reported `legacy` (server-decided, correct: nothing retired) |

### Warehouse creation — real command through the real form

| Measurement | Value |
|---|---|
| Rows before | 0 |
| Rows after | **1** |
| Rendered row | `مستودع الورشة الرئيسي · WH-MAIN · loc_stock_c04bdaf2ac1492e9` |
| Created id | `wh_c6a32838813a7912` |

The canonical engine auto-created the warehouse's `view` / `Input` / `Output` /
`Stock` locations — visible immediately in the Locations tab. A supplier
location `مورد خارجي` (`loc_14f4dd48fe12e99c`) was then created the same way.

### Draft → Validate, including the failure path

| Measurement | Value | Meaning |
|---|---|---|
| Lines staged | 1 | draft accepted the line |
| **Action requests during staging** | **0** | the draft genuinely persists nothing |
| Validate enabled | true | |
| After Validate (bad input) — draft lines remaining | **1** | the failed line was kept, not lost |
| **Stock moves persisted** | **0** | nothing partial committed |
| Failure visible in panel | **PASS** | `Last validation result: posted 0 · failed 1` |
| Failure row | `var_does_not_exist · 5 · INPUT_MISSING_FIELD · input missing required field: uom_id` | |
| Rollback statement shown | **PASS** | |

## Corrections made during this checkpoint

1. **Failure was invisible.** The first run handled the failure correctly
   (line retained, nothing persisted) but surfaced it only as a transient toast,
   so an operator could not see *why* a line failed. Added a durable per-line
   validation result table with code and reason.
2. **The receipt form was missing a required field.** The visible failure
   immediately revealed `INPUT_MISSING_FIELD: input missing required field:
   uom_id` — `stock:move:post` requires `uom_id` and the form never collected
   it. Added the field and threaded it through validation, staging and the
   command. This is a good example of the failure surface paying for itself
   within minutes of existing.
3. **A test asserted a comment across a line break.** Made the assertion
   whitespace-normalised rather than depending on where a comment wraps.

## Tests

| Suite | Command | Pass | Fail | Skip |
|---|---|---:|---:|---:|
| Phase 04 finalization (all modules) | `node --test tests/phase04-finalization/*.test.mjs` | 83 | 0 | 0 |
| Phase 04 aggregate | `node --test tests/phase04/*.test.mjs` | 47 | 0 | 0 |
| Permission regression | `node scripts/permission-regression.mjs` | 35 | 0 | 0 |

Sidebar baseline moved 97 → 98 for the new page. The real invariant (every
sidebar page explicitly mapped) is unchanged and still asserted.

### What the inventory tests prove

No arithmetic on governed quantities anywhere in the module; every read targets
a real canonical query route with the session cookie; every command uses a
registered action id sent **unencoded**; balance and valuation reads carry the
required `product_id`; the draft is documented as client-side staging and
issues no request; `draftLines` is exposed as a copy so external mutation
cannot corrupt module state; distinct lines get distinct idempotency keys;
identity and scope are never sent; the stylesheet cannot leak.

### What they do not prove

- **No successful stock receipt has posted.** Creating a product needs a
  `product_category` and a `uom`, and the canonical action surface exposes
  `uom:create` but **no action for creating a UOM category or a product
  category** — so a product cannot be bootstrapped from the UI alone. The
  receipt path is proven up to and including correct server-side rejection and
  rollback, not a successful post. This gap is a genuine finding, recorded in
  `unresolved-risks.md`.
- No delivery, transfer, return, adjustment, cycle-count or reorder workflow
  exists yet.
- No stock-to-GL drill-down surface exists yet.
- No screenshots — the screenshot service cannot composite in this environment.

## Operational data

Unchanged — all four hashes byte-identical. Everything above ran against the
staged disposable copy.
