# Commercial and Materials Cutover — Wave 2

## Status

**Seam built and wired. Cutover NOT activated.**

The server still reports `COMMERCIAL` as not retired, so every code path in
this wave currently executes the original legacy write, byte-for-byte. The
canonical path is implemented, tested, and dormant until the server flips the
domain — which cannot happen before browser parity (Wave 7).

## What was built

`services/commercialAdapter.js` — the strangler seam between the original
commercial UI (materials, customers, suppliers) and the canonical commercial
authority. Registered in `index.html` after `canonicalClient.js`.

### Authority rule

```
isCanonical('COMMERCIAL') === false  ->  legacy write only  (current state)
isCanonical('COMMERCIAL') === true   ->  canonical write only
```

Never both. There is no path that writes to both authorities, and no path
where a failed canonical write falls back to a legacy write — that would
recreate the exact duplicate-authority problem this phase exists to remove.
Proven by `canonical failure does not fall back to a legacy write`.

The decision is the server's alone (`CanonicalClient.isCanonical`), which reads
`__octagonBootstrap.cutover.phase04.domains.COMMERCIAL.enforced`.

## Field mapping

The workshop UI keeps its Arabic vocabulary and its legacy record shape. The
adapter is the only place the legacy and canonical vocabularies meet.

| Legacy material field | Canonical product field | Note |
|---|---|---|
| `name` | `name` | |
| `barcode` / `sku` | `sku`, `barcode` | |
| `tracking` (`none`/`lot`/`serial`) | `tracking` | unknown values fall back to `none`, never passed through |
| `costingMethod` (`avco`/`fifo`/`lifo`) | `costing_method` | unknown values fall back to `avco` |
| `cost` | `standard_cost` | an accounting **input**; the server decides the resulting cost and posting |
| `unit`, `category` | `uom_id`, `category_id` | resolved by the caller and passed in options |
| **`stock`, `reserved`, `movements`, `reservations`** | **not mapped** | governed inventory facts — see below |

### Opening stock is a separate governed command

A product master record and an inventory balance are different facts with
different authorities and different audit trails. The adapter never writes a
quantity onto a product create. When a material is created with an opening
quantity, it issues **two** commands:

1. `product:template:create`
2. `stock:move:post` with `source_document_type: 'inventory_adjustment'`

so the opening balance carries valuation, accounting links, audit and outbox
like any other receipt.

Proven by `opening stock is posted as a separate governed stock move, not a
product field`, which asserts `stock`, `reserved` and `movements` are absent
from the product create body, and by `zero opening stock posts no stock move`.

### Customers and suppliers are canonical parties

Both map to `party:create` with the appropriate role: `['customer']` or
`['supplier']`. Governed identifiers (`tax_id`, `registration_number`,
`is_company`) are carried when supplied. Addresses and contacts pass through.

## Shell wiring

`app.js` `addMaterial()` (~line 23223) now routes its write through the
adapter. The original legacy block was moved verbatim into a `legacyWrite`
callback — including the `recordStockMovement` opening-balance call — so when
the domain is not cut over the behavior is identical to before.

When the adapter is absent (`window.CommercialAdapter` undefined), the legacy
path still runs. Proven by `adapter is inert when the canonical client is
absent`.

Call sites **not** yet converted in this wave: `editMaterial`,
`addCustomerFromForm`, `editSupplier`, and the remaining commercial read sites.
The adapter methods they need (`updateMaterial`, `createCustomer`,
`createSupplier`, `listMaterials`, `listParties`) exist and are tested; the
shell wiring for them is outstanding.

## Correction made during this wave — real defect found

The first run was 35/38. Three failures, two causes:

**1. Real bug in `services/canonicalClient.js` (Wave 1 code).**
`roles` was in `FORBIDDEN_INPUT_KEYS`. On `party:create`, `roles: ['customer']`
is a **business attribute of the party record**, not the acting user's identity
role — so the client was silently stripping a legitimate governed field and
every canonical customer/supplier create would have been submitted without its
role. The test caught it exactly as intended.

Fixed by removing `'roles'` from the forbidden list, with a comment recording
why. `role`, `role_id` and `roleId` remain forbidden: the actor's identity role
is derived server-side from the session and is never read from a command body.
Note the parties **query** filter uses `role` as a URL parameter, which does
not pass through `stripForbidden` and is unaffected.

**2. Test-harness defect (not product code).**
Two assertions used strict deep-equality against arrays created inside the
`vm` context. Those arrays do not share the outer realm's `Array` prototype, so
`deepStrictEqual` failed on prototype identity while reporting identical
content (`actual: ['supplier'], expected: ['supplier']`). Fixed by spreading
into the outer realm before comparing, and by asserting `.length` for empty
arrays. Product code unchanged for this cause.

Re-run: 38/38.

## Tests

| Suite | Command | Result |
|---|---|---|
| Phase 04 finalization (client + adapter) | `node --test tests/phase04-finalization/*.test.mjs` | **38 pass / 0 fail / 0 skip** |
| Phase 04 aggregate | `node --test tests/phase04/*.test.mjs` | **47 pass / 0 fail / 0 skip** |
| Permission regression | `node scripts/permission-regression.mjs` | **35/35 passed** |
| Syntax | `node --check services/commercialAdapter.js app.js` | pass |

### What these prove

The seam is safe in both positions: with the domain not cut over the legacy
writer runs and **zero** canonical requests are issued; with it cut over the
canonical path runs and the legacy writer is never invoked. Governed quantities
never ride on a product master write. A canonical failure never degrades into a
legacy write.

### What these do NOT prove

- No browser ran. `fetch` is a recording stub. Real Chromium acceptance is
  Wave 7 and is a hard gate before any retirement lock is activated.
- No parity was measured against real data. `shadowCompare` is the mechanism;
  parity evidence requires a disposable accepted database.
- The canonical path has never executed against a real platform runtime from
  the browser — only against a stub. The Phase 04 aggregate proves the
  server-side actions work; it does not prove this client reaches them.
- `editMaterial`, `addCustomerFromForm` and `editSupplier` are still wholly
  legacy.

## Operational data

Unchanged. All four hashes re-verified identical to the entry baseline. No
migration was run and no database was opened.
