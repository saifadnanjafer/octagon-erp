# Page Register

No new page. One existing, already-navigable page (`modules/warranty-rma.js`,
page id `warranty`, already wired in navigation) was extended with a fourth
tab, "RMA (النظام المعتمد)" — real backend-wired list/create/detail/lifecycle
view — alongside the existing "الضمانات" (warranties), "المطالبات (محلي)"
(claims, relabelled to make clear it is the older local-tracking model), and
"اللوحة" (dashboard) tabs, which were left functionally unchanged.

The new tab calls `GET /api/v1/returns/rma` (list/detail) and
`POST /api/v1/actions` (all 8 lifecycle transitions) — no local/mock
fallback; a failed call surfaces a real error via `toast()`, never a
fabricated success.

**Pages added: 0. Pages extended: 1 (new tab + ~180 lines of real API-backed
list/detail/lifecycle UI).**
