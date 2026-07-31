# Action Register

8 governed actions registered this wave, all via
`platform/domains/returns/returns-actions.mjs` → `registerDomainHandler`
(the same server-derived-scope wrapper every other canonical action file in
this codebase uses):

| Action ID | Permission | Idempotency |
|---|---|---|
| `returns:rma_create` | `returns:write` | supported (`idempotency_key`) |
| `returns:rma_submit` | `returns:write` | supported |
| `returns:rma_approve` | `returns:approve` | supported |
| `returns:rma_reject` | `returns:approve` | supported |
| `returns:record_receipt` | `returns:write` | supported |
| `returns:record_inspection` | `returns:write` | supported |
| `returns:record_disposition` | `returns:approve` | supported |
| `returns:rma_close` | `returns:approve` | supported |

Every action's input passes through
`platform/kernel/actions/domain-handler.mjs`'s `trustedActionInput()`, which
requires a verified `companyId`/`userId` from the session context, rejects
any client-supplied `company_id`/`actor_id`/`branch_id` that disagrees with
the verified session, and strips/replaces those fields before the domain
function ever sees them — the same body-supplied-identity defense proven by
`tests/phase02/runtime-adversarial.test.mjs`.

**Actions added this wave: 8.**
