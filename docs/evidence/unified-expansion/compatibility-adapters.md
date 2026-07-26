# Compatibility Adapters

## Active adapters

| Adapter | Current role | Retirement condition |
|---|---|---|
| `services/financeService.js` | legacy UI shape over canonical finance API when server bootstrap is present | retain as projection/shape adapter; never restore legacy finance writes |
| `server.js` generic `/api/db`, `/api/collection`, `/api/record` | compatibility for unmigrated domains | deny each Phase 04 domain only after exact cutover flag+lock acceptance |
| `services/stockService.js` | active legacy inventory writer | replace mutations with durable canonical draft/validate/query adapter and browser proof |
| legacy commercial/task collections | active compatibility data and writers | migrate/reconcile projections, route writes to ActionExecutor, prove deep links |

Compatibility is not authority. A lock is not activated until the corresponding
adapter offers every workflow the original UI needs.
