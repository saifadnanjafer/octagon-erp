# Visible UI Acceptance Matrix

**Branch:** `build/octagon-original-shell-visible-expansion`
**Base:** `f5e45ed` (a descendant of the published `643d930`)

## Wave 1 delivered: Canonical Operations console

One new page, visibly present in the sidebar, exposing eight canonical domains.
Every list is a real canonical query; every create is a real canonical command.

| Item | Value |
|---|---|
| Navigation label (AR) | العمليات الموحّدة |
| Navigation label (EN) | Canonical Operations |
| Nav button | `index.html` `data-page="canonical_console"` |
| Route / page key | `canonical_console` |
| Section id | `pageCanonicalConsole` |
| View template | `views/canonical_console.html` |
| Frontend entry | `modules/canonical-console.js` |
| Stylesheet | `modules/canonical-console.css` (fully scoped under `#pageCanonicalConsole`) |
| Client adapter | `services/canonicalClient.js` |
| API prefix | `/api/v1` |
| Permission | `canonical_console` → `workshop.manager`, `finance.manager`, `system.admin` |

### Domain sections

| # | Section (AR / EN) | Canonical query | Canonical command | Cutover domain |
|---|---|---|---|---|
| 1 | المنتجات والمواد / Products & Materials | `GET /api/v1/commercial/products` | `product:template:create` | COMMERCIAL |
| 2 | العملاء والموردون / Customers & Suppliers | `GET /api/v1/commercial/parties` | `party:create` | COMMERCIAL |
| 3 | المخزون والمستودعات / Inventory & Warehouses | `GET /api/v1/inventory/quants` | *(read-only by design)* | INVENTORY |
| 4 | المستودعات / Warehouses | `GET /api/v1/inventory/warehouses` | `warehouse:create` | INVENTORY |
| 5 | المبيعات / Sales | `GET /api/v1/sales/orders` | *(read surface this wave)* | SALES |
| 6 | المشتريات / Procurement | `GET /api/v1/procurement/orders` | *(read surface this wave)* | PROCUREMENT |
| 7 | نقطة البيع / Point of Sale | `GET /api/v1/pos/orders` | *(read surface this wave)* | POS |
| 8 | إدارة العمل / Work Management | `GET /api/v1/work-items` | `work_item:create` | WORK_ITEM |

Inventory balances deliberately have **no** create/edit path: quantities change
only through governed stock lifecycle commands, never a grid edit. The page says
so to the user in both languages. Sales/Procurement/POS are read surfaces until
their full lifecycle workflows are built — the console does not pretend
otherwise.

## Real browser verification

Real Chromium via the in-app browser pane, against the running server on
`http://localhost:8080` backed by a **disposable database copy**
(`scripts/preview-disposable-server.mjs`). The operational database was never
opened.

| Check | Result | Evidence |
|---|---|---|
| Nav entry present | **PASS** | `navButtonPresent: true`, label `العمليات الموحّدة` |
| Page opens on navigation | **PASS** | `sectionVisible: true`, `hasPageActive: true`, `navActive: true` |
| Module loaded, not a dead file | **PASS** | `typeof window.CanonicalConsole === 'object'` |
| Eight tabs render | **PASS** | 8 tabs, correct Arabic labels |
| Authority banner renders | **PASS** | 6 Phase 04 domain chips, server-derived |
| Canonical API actually called | **PASS** | real `401 Login session required` from `/api/v1/commercial/products` with correlation id `ui-ms34rty0-1` |
| Permission enforced | **PASS** | unauthenticated read denied by the server, not by the browser |
| Governed denial rendered correctly | **PASS** | "الوصول مرفوض" + server hint + correlation id shown |
| Create form wired to a real action | **PASS** | form present, declares `product:template:create` |
| Arabic RTL | **PASS** | `dir=rtl`, all labels Arabic |
| English LTR | **PASS** | `dir=ltr`, all 8 tabs + panel + error + banner in English |
| Language round-trip | **PASS** | AR → EN → AR via the shell's own toggle |
| Desktop layout | **PASS** | renders at native desktop width |
| Mobile 375×812 — no page overflow | **PASS** | `scrollWidth === clientWidth === 375` |
| Mobile with sidebar collapsed | **PASS** | content 295px, tabs fit, no overflow |
| No console errors from this module | **PASS** | only pre-existing `401` and `saveData` guard messages |

### What is NOT proven

- **No authenticated workflow ran.** Every canonical read returned `401`
  because there is no session. Creating or guessing a credential is not
  something this agent will do; authenticated browser flows need owner-supplied
  test credentials. Prior sessions hit the same wall — Phase 02/03 browser
  evidence also records reproducibly failing login transitions.
- **No canonical command has been executed from the browser.** The command path
  is wired and unit-proven, but a real create against disposable data still
  requires a session.
- **No screenshots.** The screenshot service times out on this app because the
  Browser pane is not compositing frames in this environment. DOM measurements
  are given instead, and are reported as DOM measurements — not as screenshots.
- **Mobile default is poor for the whole shell.** At 375px the sidebar keeps its
  full 260px, leaving `mainContent` at 115px. This affects **every** page, not
  this one; collapsing the sidebar fixes it. Pre-existing, flagged separately,
  not changed here.

## Acceptance gate status

| Gate | Status |
|---|---|
| `index.html` changed intentionally | yes — nav button, CSS link, script tag |
| `app.js` changed intentionally | yes — `pageMap` entry, prefetch entry |
| Navigation visibly changed | yes — new sidebar entry |
| Real module view added | yes — `views/canonical_console.html` |
| Original shell loads the new code | yes — verified in a real browser |
| No dead unmounted file | yes — module registers and renders |
| Canonical HTTP routes called | yes — verified 401 with correlation id |
| Canonical commands mutate disposable data | **not yet** — blocked on a session |
| Screenshots show the change | **no** — screenshot service unavailable |
| No VNext file changed | yes — 17 dirty files at entry and exit, untouched |
| Operational database unchanged | yes — all four hashes byte-identical |
