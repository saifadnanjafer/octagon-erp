# Phase 01 Route Policy Coverage

**Phase:** 01  
**Date:** 2026-07-21  

---

## Convention

- **Module owner** — the module responsible for the route.
- **Required permission** — the permission token checked by the permission hook (or implicit `system` for platform internals).
- **Policy** — how access is decided.

---

## Phase 01 registered routes

| Route | Namespace | Module owner | Required permission | Policy | Notes |
|---|---|---|---|---|---|
| `GET /api/v1/meta/entities` | meta | `platform_kernel` | implicit `system` | open read (metadata) | Returns entity metadata. |
| `GET /api/v1/x/:entity` | x | owning module of entity | `{entity}:read` | generic query resource | Bound by repository `query_policy` and company scope. |
| `GET /api/v1/x/:entity/:id` | x | owning module of entity | `{entity}:read` | generic read | Allowed for all governed entities. |
| `POST /api/v1/x/:entity` | x | owning module of entity | `{entity}:create` | generic create only if `lifecycle_policy === 'generic'` | Protected entities return `403`. |
| `PATCH /api/v1/x/:entity/:id` | x | owning module of entity | `{entity}:update` | generic update only if `lifecycle_policy === 'generic'` and not terminal state | Protected/terminal entities return `403`/`409`. |
| `DELETE /api/v1/x/:entity/:id` | x | owning module of entity | `{entity}:delete` | generic delete only if `lifecycle_policy === 'generic'` and not terminal state | Protected/terminal entities return `403`/`409`. |
| `POST /api/v1/action/:actionId` | action | owning module of action | action's `required_permission` | registered command only | Requires `idempotency_key` for actions with `idempotency_policy: required`. |

---

## Route ownership rules

1. Every route must be owned by an enabled module.
2. Generic mutation routes (`POST/PATCH/DELETE /api/v1/x/:entity`) are rejected for protected/workflow/state_machine/immutable/append_only entities.
3. Command routes (`/api/v1/action/*`) are rejected for unregistered action IDs.
4. Disabled modules have their routes removed from active registration (views) and actions denied (action executor checks module status).
5. No route uses body-supplied actor, company, branch, or tenant.

---

## Unmapped route behavior

- Any request under `/api/v1/*` that does not match the table above returns `404` with the stable error envelope.
- Existing Octagon routes outside `/api/v1` remain active and are not covered by this Phase 01 policy table.

---

## Next review

Update this coverage table as domain phases add routes.
