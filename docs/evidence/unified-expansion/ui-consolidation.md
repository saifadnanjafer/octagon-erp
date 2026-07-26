# UI Consolidation

## Completed in this checkpoint

The authenticated governance bootstrap now exposes a server-derived `cutover`
object. Finance client selection reads
`__octagonBootstrap.cutover.finance.enforced` first, so browser-local storage or
a default-OFF client flag cannot choose a legacy finance writer against an
always-canonical server.

The Arabic RTL shell, routes, and page structure were not replaced.

## Blocking gap

`services/stockService.js` still persists draft moves, quants, transfers, lots,
and reservations through legacy PentagonDB structures. The current canonical
inventory action can post an executed move, but the original UI also requires a
durable canonical draft/edit/validate workflow. Pretending that a transient
browser object is a durable draft would lose data on refresh and is rejected.

Therefore INVENTORY and the remaining Phase 04 retirement locks stay inactive.
No original-shell Phase 04 browser closure is claimed.
