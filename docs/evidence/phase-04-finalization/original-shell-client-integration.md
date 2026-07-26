# Original-Shell Canonical Client Integration — Wave 1

## What was built

`services/canonicalClient.js` — one durable transport layer between the
original Octagon UI and the governed canonical runtime. Registered in
`index.html` after `stockService.js` and before `financeService.js`, so it is
available to every shell workflow before `app.js` runs.

Exposed as `window.CanonicalClient` and `PentagonServices.canonicalClient`,
matching the existing service convention.

This wave is **additive only**. No legacy call site was converted yet, so
runtime behavior is unchanged. Conversion happens in Waves 2–4, after the
transport is proven.

## Target chain implemented

```
original UI
  -> CanonicalClient
  -> raw Node HTTP route (/api/v1/...)
  -> server-derived identity and scope
  -> ActionExecutor command or canonical query
  -> atomic domain transaction
  -> audit and outbox
  -> canonical response
  -> original UI refresh (octagon:canonical-changed)
```

## Required capabilities — status

| Requirement | Implementation | Proven by |
|---|---|---|
| Authenticated HTTP transport | `request()` sends `credentials: 'same-origin'`; session cookie is the only identity carrier | `session cookie is the only identity carrier` |
| Standard response envelope | unwraps `{success,data,error,meta,correlationId}` | `envelope is unwrapped to data` |
| Correlation IDs | `x-correlation-id` on every request; server value preferred on return | `every command carries an idempotency key and correlation id` |
| Idempotency keys | generated per command; header and `body.idempotency_key` agree; caller may supply a stable key | `a caller-supplied idempotency key is honoured for safe retries` |
| Server error mapping | `CanonicalError` with `status`, machine `code`, `correlationId` | `governed denial preserves the machine code…` |
| Canonical query calls | 14 query resources mirroring `platform/api/commercial.mjs` | `read paths issue GET and carry no body` |
| Canonical action calls | 27 action ids mirroring the registered executor surface | `action ids match the registered canonical action surface` |
| Optimistic concurrency | `expectVersion` → `If-Match`; 409 → `isConflict` | `optimistic concurrency version is sent as If-Match`, `conflict maps to isConflict` |
| Authorization failures | 401/403 → `isAuthorization` | `governed denial preserves the machine code…` |
| Feature-flag resolution | server decision outranks client flag outranks localStorage; default OFF | `server cutover decision outranks client flags` |
| Read-only legacy fallback | `isCanonical(domain)` gates **reads** only; writes never fall back | `cutover defaults to false…` |
| Shadow comparison | `shadowCompare()` reports drift, issues no request, never repairs | `shadow comparison reports drift without writing` |
| UI refresh events | `octagon:canonical-changed` on success only | `failed command emits no refresh event` |

## Security posture

### The browser is not an identity authority

`FORBIDDEN_INPUT_KEYS` (27 keys) are stripped from every command payload before
transmission: actor/user/tenant/company/branch/role/permission/session/
impersonator identity, plus server-owned governed results (posting status,
valuation, tax result, account mapping, approval identity).

This is **defence in depth, not the primary control**. The primary control is
server-side: `resolveApiContext` → `resolveContextFromRequest` →
`stripUntrustedContext` (`platform-runtime-bridge.mjs:247-276`) already ignores
caller-supplied scope. The client strip exists so a UI bug cannot even attempt
the spoof, and so the attempt is logged via `console.warn`.

Verified by `commands never transmit identity or scope fields`, which asserts
14 distinct spoof attempts are all dropped while the legitimate business field
survives.

### Fail closed

A network failure, a non-2xx response, or `success:false` on HTTP 200 all raise
`CanonicalError`. There is no path where a failed canonical write silently
falls through to a legacy write. Verified by `network failure fails closed…`
and `success:false with HTTP 200 is still treated as failure`.

### No duplicate domain logic

The client transports and maps errors. It does not compute balances,
availability, valuation, or posting effects. Valuation, quants, reservations
and operations are **reads** against canonical endpoints
(`/inventory/valuation`, `/inventory/quants`, `/inventory/reservations`,
`/inventory/operations`).

## Domain surface

| Namespace | Queries | Commands |
|---|---|---|
| `parties` | list, get | `party:create` |
| `products` | list, get | `product:template:create`, `product:variant:create` |
| `uoms` | list | `uom:create` |
| `warehouses` | list | `warehouse:create` |
| `locations` | list | `stock:location:create` |
| `stock` | balances, operations, valuation, lots, serials, packages | `stock:move:post`, `stock:quants:rebuild`, `stock:lot:create`, `stock:serial:create`, `stock:package:create`, `wms:picking:validate` |
| `reservations` | list | `stock:reservation:{reserve,release,consume,expire,reallocate,reverse}` |
| `sales` | listOrders, getOrder | `sales:quotation:create`, `sales:order:confirm`, `sales:invoice_request:create` |
| `procurement` | listOrders, getOrder | `procurement:order:{create,confirm}`, `procurement:threewaymatch:perform`, `procurement:bill_request:create` |
| `pos` | listOrders | `pos:session:{open,close}`, `pos:order:process` |
| `workItems` | list, get | `work_item:{create,update,approve,delete}` |

## Tests

| Suite | Command | Result |
|---|---|---|
| Canonical client contract | `node --test tests/phase04-finalization/canonical_client.test.mjs` | **25 pass / 0 fail / 0 skip** |
| Phase 04 aggregate | `node --test tests/phase04/*.test.mjs` | **47 pass / 0 fail / 0 skip** (15.1s) |
| Permission regression | `node scripts/permission-regression.mjs` | **35/35 passed** |
| Syntax | `node --check services/canonicalClient.js` | pass |

### What these tests prove

The client honours the canonical transport contract: identity is never sent,
commands are idempotent and correlated, envelopes are unwrapped, governed
denials keep their machine codes, the server's cutover decision is
authoritative, and failures fail closed.

### What these tests do NOT prove

- They do not prove browser behavior. `fetch` is a recording stub; no Chromium
  process ran. Real browser acceptance is Wave 7.
- They do not prove any legacy call site was converted. None were — Wave 1 is
  additive.
- They do not prove server-side authorization. That is enforced by the platform
  authority and covered by the Phase 04 aggregate suite.
- They do not prove parity between canonical and legacy values for real data.
  `shadowCompare` is the mechanism; parity evidence comes in Waves 2–4.

## Correction made during this wave

The first run was 24/25. `network failure fails closed…` failed with "Missing
expected rejection". Root cause was a **defect in the test**, not the client:
the test replaced `window.fetch`, but the client resolves the global `fetch` at
call time (the same pattern `services/financeService.js:156` uses). Replacing
`window.fetch` therefore left the VM global intact and the request succeeded.

Fixed by exposing the VM context and replacing the global `fetch`. The client
was not changed. Re-run: 25/25.

## Operational data

Unchanged. No migration was run, no database was opened. Hashes re-verified at
commit time and identical to the entry baseline in `starting-state.md`.

## Next

Wave 2 converts commercial writes (materials/products, customers, suppliers)
to this layer, keeping legacy reads as read-only projections until parity is
proven.
