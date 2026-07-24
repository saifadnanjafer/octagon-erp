# Compatibility Adapters

Remaining adapters/sources:

| Legacy surface | Intended adapter | Current status | Removal criterion |
|---|---|---|---|
| `omni.materials` / material arrays | canonical product/material read projection | legacy read/write still active | product + stock migration and browser parity |
| customer/supplier arrays | party role read projection | legacy read/write still active | party/contact/address parity |
| `services/stockService.js` | canonical balances/operation client | still owns legacy writes | quantity/reservation/valuation/GL pass |
| legacy sales/purchase/POS arrays | canonical query views | still active | lifecycle migration/UI parity |
| Task Manager/Kanban arrays | Work Item read projections | still active | cross-view browser parity and history acceptance |
| generic `/api/db`, `/api/collection`, `/api/record` | machine-readable strangler | Phase 04 denial dormant | explicit feature-flag cutover |

No adapter is described as read-only unless the server currently enforces it. This corrects the inherited report that presented planned adapters as completed retirement.
