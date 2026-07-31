# Query Register

One new governed query namespace this wave:

| Namespace | Resource | Permission | Scope |
|---|---|---|---|
| `returns` (`platform/domains/returns/returns-queries.mjs` → `handleReturnsQuery`, mounted in `platform/api/index.mjs`) | `rma` (list + detail w/ lines+timeline), `rma_timeline` | `platform:db:read` (reused, matches the `quality`/`assets` namespace convention — no new permission) | Every query filters `WHERE company_id = ctx.companyId` — the server-derived company, never a client-suppliable filter; `400` if no company scope is present |

**Queries added this wave: 1 namespace, 2 resources.**
