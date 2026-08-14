# Cross-page Contradictions and Boundaries

Catalog baseline: `aa730dd23462aab3e90b70ad2db1bf6cc945ca99`  
Engineering reference: `25c24df753962bbf3c13301eed71624bc0ee39b6`

## Findings

| ID | Boundary | Evidence | Required reconciliation |
|---|---|---|---|
| C-001 | Canonical stock authority | Receiving, picking, putaway, cross-dock, count adjustment, production material, and scrap modules request/acknowledge canonical results; their WMS tables store workflow state, not a second stock ledger. | Keep request, awaiting_canonical, acknowledged, and completed distinct; never describe a page action as direct stock posting unless the cited canonical handler proves it. |
| C-002 | Warehouse scope | `platform/api/build09.mjs` requires company context and validates active warehouse membership for every resource family. | Client labels and raw IDs are insufficient; every spec and browser proof must show warehouse isolation. |
| C-003 | Receiving versus putaway | Mobile Receiving completes at `putaway_pending`; Putaway Task Queue owns the subsequent physical destination task. | Do not mark a receipt complete merely because canonical Inventory posted the inbound move. |
| C-004 | Wave Planning versus Wave Execution | Planning creates/calculates/reviews; execution releases, refreshes, cancels, and completes. | Keep creator/reviewer and release boundaries separate in UI and acceptance evidence. |
| C-005 | Quality versus Inventory | Quality Hold, Rework, and Scrap decide or request dispositions; canonical Inventory owns stock movement. | Quality pages may acknowledge a verified canonical result but must not invent inventory authority. |
| C-006 | Operational Performance missing data | The performance renderer preserves null/unreliable rates as “not available” and explains the missing evidence. | Never convert absent timing/output evidence into 0% or 100%. |
| C-007 | Traceability identity | Trace queries require lot_id or serial_id and validate product/lot/serial consistency. | Identity mismatch is a validation error; it is not an empty trace. |
| C-008 | Mobile scanner flows | Mobile Receiving and Mobile Picking use stepwise scanning, while desktop queues use list/detail workspaces. | Share domain actions, not assumptions about controls or responsive proof. |

## Duplicate or consolidation candidates

None identified from source evidence. Shared tables/resources are intentional cross-page workflow dependencies, not proof that the primary pages are duplicates.
