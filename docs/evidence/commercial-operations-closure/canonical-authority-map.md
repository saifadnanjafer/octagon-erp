# Canonical Authority Map

## New orchestration authority (this wave)

| Authority | Owns | Does NOT own |
|---|---|---|
| `platform/domains/returns/rma.mjs` (`returns_rma`, `returns_rma_lines`, `returns_rma_timeline` — migration 084) | Return authorization, RMA number, reason, type, requested/received quantity, disposition decision, lifecycle state, orchestration links | Stock balances, posted stock movements, GL entries, credit notes, payments, Service Tickets, Assets, serial masters, Quality NCR/CAPA facts |

## Canonical authorities reused (not duplicated)

| Fact | Authority | Called from |
|---|---|---|
| Stock receipt / return movement | `platform/inventory/wms_workflows.mjs` (`createReceiptDraft`, `validateReturn`) | `recordReceipt()` |
| Quality inspection / NCR | `platform/quality/ncr-capa.mjs` (`createNCR`), real `quality_inspections` table (migration 056) | `recordInspection()` |
| Work Item (repair) | `platform/work_items/lifecycle.mjs` (`createWorkItemLifecycle`) | `recordDisposition()` disposition=`repair` |
| Finance credit note | `platform/finance/engine.mjs` (`createCreditNote`, `getDocument`) | `recordDisposition()` disposition=`refund` |
| Supplier return / stock issue / debit note | `platform/procurement/lifecycle.mjs` (`createPurchaseReturn`) | `recordDisposition()` disposition=`return_to_supplier` |
| Server-derived actor/company/branch scope | `platform/kernel/actions/domain-handler.mjs` (`registerDomainHandler`/`trustedActionInput`) | `returns-actions.mjs` (all 8 actions) |
| Permission/action registry | `platform_actions`/`platform_entities` (migration 084, same pattern as migration 057) | bridge auto-derives permission tokens from `required_permission` |

No second stock movement engine, Quality authority, Sales/Purchase return
engine, Service Ticket authority, Asset/serial authority, Finance
credit-note engine, or Work Item engine was created.

## Duplicate-authority risk found in the interrupted draft, and fixed

The draft found in the worktree (see `returns-rma/current-gap-proof.md`)
fabricated random reference ids (`rec_fallback_...`, `qncr_fallback_...`,
`cn_req_...`, `supp_ret_...`) instead of calling these real authorities when
a call failed or wasn't attempted — meaning the RMA record could claim a
credit note or supplier return existed when it did not. This wave's rewrite
removes every fabricated id: a canonical call either succeeds for real or
throws a real, typed error (see `duplicate-authority-retirement.md`).
