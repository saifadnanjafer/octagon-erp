# Owner Consolidation Decisions

Status: **owner-approved 2026-08-08** (Page Consolidation & Functional Depth Wave 1 dispatch). Navigation Recovery 1 made no irreversible deletion or merge; the items below were implemented as TAB/ALIAS reclassifications before this approval and are confirmed still correct against the running app as of this pass.

- [x] Retain `calculator` as TAB under `timesheet`. **Verified in code**: `app.js` `switchPage()` redirects `calculator` → `timesheet` whenever the user has timesheet permission (app.js:4475); the calculator UI is docked inside the Timesheet page. Confirmed `visibleInPrimaryNavigation:false` in `docs/navigation/NAVIGATION_FORENSIC_REPORT.json`.
- [x] Retain `kanban` as TAB under `task_manager`. **Verified**: not a primary sidebar destination (forensic report), activated as a Task Manager view.
- [x] Retain `locations` as TAB under `warehouses`. **Verified**: not a primary sidebar destination; subordinate to the Warehouses workspace.
- [x] Retain `pos_deepening` as ALIAS under `pos`. **Verified in code**: `modules/pos-deepening.js` wraps `switchPage` and redirects `pos_deepening` → `pos` (`activatePage()`); its nav button carries `hidden` directly in `index.html:1569`.
- [x] Retain `workshop_tv` as TAB under `task_manager`. **Verified**: not a primary sidebar destination (forensic report).

- [x] `credit_collections`: **preserve** as a compatibility surface pending Finance/Accounts-Receivable/Collections alignment. Do not delete. Currently a true orphan: `views/credit_collections.html` exists but has no `pageMap`/nav-button wiring — unreachable through normal navigation, so preservation carries zero user-facing risk today.
- [x] `electronic_signatures`: **alias** to the canonical e-signature surface (`esign`). Currently unreachable (no `pageMap`/nav-button wiring — `views/electronic_signatures.html` is a true orphan file). No redirect exists yet; since nothing currently links to this id, implementing the redirect is deferred to when/if a real inbound link (bookmark, deep link, or docs reference) is found — tracked as a residual item rather than blocking this wave. If implemented, follow the `pos-deepening.js` pattern (small module wrapping `switchPage`, redirecting the legacy id to the canonical page).
- [x] `sales_commissions`: **alias** to canonical `sales_commission`. Same status as `electronic_signatures`: orphan view file (`views/sales_commissions.html`), zero wiring, zero current inbound links, redirect deferred as a residual item using the same `pos-deepening.js` pattern if/when needed.
- [x] `service_contracts`: **preserve** pending canonical Contracts/After-sales comparison. Do not delete. Orphan view file (`views/service_contracts.html`), unreachable through normal navigation today.
