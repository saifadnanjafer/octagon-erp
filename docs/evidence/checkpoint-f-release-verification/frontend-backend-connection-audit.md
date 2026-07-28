# Checkpoint F — frontend / backend connection audit

Does the original Octagon shell actually talk to one authenticated backend
runtime through one canonical transport?

## The transport chain

```
index.html / app.js  (one shell, one switchPage dispatcher)
        │
        ├── canonical-*.js modules wrap the dispatcher, never replace it
        │
        ▼
POST /api/v1/action/:actionId          ← canonical governed transport
        │   server.js:1714  platformApiHandler handles /api/v1/*
        ▼
platform-runtime-bridge.mjs → createPlatformAuthority()
        │
        ▼
ActionExecutor.execute()
  module access → permission → scope → input schema → preconditions
  → transaction boundary → idempotency → audit + outbox
        │
        ▼
SQLite (database.db)   ← one database authority
```

Verified: `platformApiHandler` is mounted for `/api/v1/` in `server.js`, and
`createPlatformAuthority` is imported from `platform-runtime-bridge.mjs`. The
D/E dispatcher tests confirm the canonical modules load from the original shell
and mount through the effective dispatcher.

## The second, non-canonical transport — still open

Three generic legacy write routes bypass the ActionExecutor entirely:

| Route | Bypasses executor | Currently refused for |
|---|---|---|
| `POST /api/db` | yes | FINANCE paths, and any payload emptying a `HARD_PROTECTED_COLLECTIONS` path |
| `POST /api/collection` | yes | FINANCE only |
| `POST /api/record` | yes | FINANCE only |

So the architecture is **one canonical transport plus one live legacy
transport**, not one transport. The legacy path is guarded, logged
(`server-write-guard.log`), permission-checked (`platform:db:write`) and fails
closed — but for 12 of 13 domains it does not refuse.

Detail and remediation: [legacy-writer-retirement.md](legacy-writer-retirement.md).

## Backend record accuracy

Structural proof that the pages share canonical records — one Party across
Sales/Procurement/Projects, one Product across Inventory/Sales/Procurement/POS,
one Work Item across Manufacturing/Quality/Maintenance/Fleet, one Asset across
Maintenance/Fleet — is in
[cross-domain-record-integrity.md](cross-domain-record-integrity.md).

No page owns an independent conflicting balance **at the schema level**: there
is no second customer store, product store, or task engine. Whether posted
numeric balances agree end-to-end after a real lifecycle is **unproven**,
because the lifecycle browser runs were not performed.

## Client-side authoritative calculation

Not audited in this checkpoint. The requirement that no browser-calculated
balance is authoritative was **not** systematically verified against `app.js`
and the module scripts. Recorded in [unresolved-risks.md](unresolved-risks.md).

## Verdict

| Requirement | Status |
|---|---|
| One original Octagon shell | **met** |
| One canonical client transport | **partially met** — canonical transport exists and is used; a second legacy transport remains live for 12 domains |
| One authenticated backend runtime | **met** |
| One ActionExecutor | **met** |
| One canonical authority per business fact | **met at registry and schema level**; not enforced against the legacy transport |
| One database authority | **met** |
