# Octagon ERP — Final Page Catalog · Deferred Integration & Hardening

**Branch:** `build/octagon-final-page-catalog`

§81 forbids deferring: duplicate authority, missing permission, cross-company
leakage, direct protected-table writes, fake data, data loss, nonfunctional
primary actions, invalid migrations, security defects. **Nothing in that list is
deferred here** — every such finding in this wave was fixed (see
`wave2-connection.md` §5).

What follows is legitimately deferred work.

## Wave 2 foundation

| Item | Detail |
|---|---|
| Populated-state browser proof | Every Wave 2 page family needs a run with an authenticated session and seeded synthetic rows. Server-side behaviour is proven by unit tests; the visual populated state is not. |
| Mutation round-trip in a browser | `work_item:complete`, `approval:decide` and the 105 Wave 2 actions are proven executable in-process (test 10) but not yet clicked through a live page. |
| Bulk approval policy flag | `unified_inbox` deliberately has no bulk approve. Enabling it for any queue first requires a per-queue policy flag proving that queue is not maker-checker. |
| Module enablement UX | Modules are registered `installed`. `module_pack_center` (target page 07) is the page that must let an administrator enable them; until it exists, enabling requires a control-plane action. |
| Wave 2 `index.mjs` files | The 16 original `platform/domains/*/index.mjs` files still contain their non-functional registration dialects. They are now dead code — `wave2-actions.mjs` is the live path — and should be deleted once nothing imports them. |
| PostgreSQL proof | The query layer and migration 083 are written dialect-neutral but are only exercised against SQLite. |

## Page catalog

| Item | Detail |
|---|---|
| Remaining page families | 62 of the 65 target families are not yet built. FP-0's consolidation register maps each to REUSE / CONSOLIDATE / NEW; the foundation they need now exists. |
| `executive_cockpit`, `global_search` | Target pages 02 and 06. View stubs were created and then **removed** rather than shipped empty — an isolated page is a defect, not progress. |
| Nav-group assignment | 14 pre-existing pages are not in any navigation group and are swept into `admin_org` at runtime by `rebuildSidebarNavigation()`. Listed in `page-regression.test.mjs` `KNOWN_INCOMPLETE`. |
| `settings` / `system_check` retirement | Permission keys with no page. Dispositioned in the consolidation register §B2/§B3; not yet removed. |
| Sales satellite consolidation | `sales_price_lists`, `sales_commission`, `sales_contracts` → tabs of `sales` (§B4). |
| Screenshots | The Browser pane was not compositing during this run; image capture timed out. DOM assertions were used instead. |

## Accessibility & performance

| Item | Detail |
|---|---|
| Deep accessibility audit | The kit ships visible focus rings, roving-tabindex tabs, ARIA roles, non-colour status channels and `prefers-reduced-motion`. A full screen-reader and contrast audit has not been run. |
| Keyboard walkthrough | Tab/arrow navigation implemented; not yet exercised end to end in a browser. |
| Performance | No page-load budget measured for the new pages. |

## Operational

| Item | Detail |
|---|---|
| Operational migration of 083 | Migration 083 has **not** been applied to any operational database, by design. |
| Backup / restore / cutover | Out of scope for a page wave. |
| Concurrency & failure injection | Not exercised. |
