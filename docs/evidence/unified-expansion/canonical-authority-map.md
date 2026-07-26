# Canonical Authority Map

**Audit baseline:** `c315f7976353f3fd483091977136c645cf92e483`

Status values describe current runtime truth, not intended architecture.

| Domain/fact | Canonical implementation | Original-shell/live writer | Runtime status | Required disposition |
|---|---|---|---|---|
| Platform registries | `platform/kernel/**`, migrations 001-006 | platform runtime bridge | Canonical backend mounted | Preserve and regression-test |
| Identity/session/permissions/settings/workflow | `platform/governance/**`, `platform/server/governance-strangler.mjs` | compatibility projections in legacy store | Canonical backend mounted; current browser proof not refreshed | Verify runtime/browser before broader expansion |
| Finance documents/GL/payments | `platform/finance/**`, `/api/v1/action/*`, `/api/v1/finance/*` | `services/financeService.js` chooses canonical only when client flag is ON | Split selection; server blocks generic finance writes but client defaults flag OFF | Make server-authoritative client selection and close missing canonical read/action gaps |
| Parties/products/pricing | `platform/commercial/**` | legacy arrays and full-state `saveData()` paths | Canonical backend exists; Phase 04 guard disabled | Migrate/reconcile, cut UI/API, then enable guard |
| Inventory moves/quants/valuation | `platform/inventory/**`, `platform/finance/ports/stock-accounting.mjs` | `services/stockService.js`, `modules/phase6a-core.js`, legacy arrays | Duplicate active authority | Replace mutations with canonical action/query adapter |
| Reservations | `platform/inventory/reservations.mjs` | material reservation arrays in `services/stockService.js` and legacy UI | Duplicate active authority | Migrate lineage; canonicalize reserve/release/read paths |
| Sales/CRM | `platform/sales/**` | legacy sales/CRM collections and UI persistence | Canonical backend exists; original shell not proven cut over | Build client adapter and browser parity |
| Procurement | `platform/procurement/**` | legacy purchase-order/supplier collections | Canonical backend exists; original shell not proven cut over | Build client adapter and browser parity |
| POS | `platform/pos/**` | legacy POS collections/UI | Canonical backend exists; original shell not proven cut over | Build client adapter and browser parity |
| Work Items/tasks | canonical `work_items` schema/actions | `tasks`, `omni.kanban.cards`, `omni.taskManager`, work-order task views | Canonical backend exists; original views still persist legacy state | Convert views to projections over Work Items |
| Audit/outbox/idempotency | platform kernel/runtime transaction | legacy audit helpers also exist | Canonical for platform actions; legacy mutations create parallel evidence | Retire legacy governed mutations |
| Manufacturing/projects/assets/HR additive | none at starting tree | legacy modules/arrays | No later canonical authority created | Do not begin until Phase 04 hard gate passes |
| Payroll/attendance/timesheet | frozen legacy behavior | existing legacy runtime | Sole preserved authority by owner decision | Read-only forever; no migration/write |

## Authority invariant

One business fact may have multiple read projections but only one write
authority. Feature flags may stage a strangler cutover, but a flag is not a
closure: the original shell, server guards, data migration, browser flow, and
rollback must agree on the same authority.
