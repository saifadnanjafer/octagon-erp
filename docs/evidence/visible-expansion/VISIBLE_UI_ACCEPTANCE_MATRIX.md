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

### Superseded by Wave 2A — now PROVEN

The two items below were unproven when this matrix was first written. The
disposable authenticated fixture closed both. Full detail in
`authenticated-browser-fixture.md`.

| Previously unproven | Status now |
|---|---|
| No authenticated workflow ran | **PASS** — `test.sysadmin` logged in (200), company scope set, canonical read succeeded |
| No canonical command executed from the browser | **PASS** — `party:create` executed via a real form submit; rows 0 → 1; row rendered `شركة الاختبار التجارية — supplier` |
| Permission denial only demonstrable as 401 | **PASS** — `test.viewer` allowed to read, **denied 403** on write with the server's Arabic message |

Wave 2A also revealed that **every canonical command had been broken since Wave
1**: the client percent-encoded the action id, so the server answered
`ACTION_NOT_REGISTERED`. The 401s had masked it, and the unit tests asserted the
encoded URL and so locked the defect in. Fixed, with the assertions corrected to
the literal contract.

### What is still NOT proven

- **No screenshots.** The screenshot service times out on this app because the
  Browser pane is not compositing frames in this environment. DOM measurements
  are given instead, and are reported as DOM measurements — not as screenshots.
- **Only the console page exists.** Distinct module pages for Products, Parties,
  Inventory, Sales, Procurement, POS, Work Management and Administration are not
  built (Checkpoints B–C), and Projects/Manufacturing/Quality/Assets/
  Maintenance/Fleet are not started (Checkpoints D–E).
- **Only `party:create` has been executed end-to-end.** The other three wired
  commands (`product:template:create`, `warehouse:create`, `work_item:create`)
  are unit-proven and now use a correct URL, but have not been driven through
  the UI against live disposable data.
- **No inventory, sales, procurement or POS lifecycle workflow exists.** Those
  domains remain read surfaces.
- **Mobile default is poor for the whole shell.** At 375px the sidebar keeps its
  full 260px, leaving `mainContent` at 115px. This affects **every** page, not
  this one; collapsing the sidebar fixes it. Pre-existing, flagged separately,
  not changed here.

## Checkpoint C1 — canonical Sales (2026-07-28)

The earlier statement that Sales was a read-only console tab is superseded.

| Gate | Result |
|---|---|
| Original Sales page replaced by canonical workspace | PASS |
| Delayed Phase 7J legacy pack retired | PASS |
| 11 required Sales areas visible | PASS |
| Full lead-to-return/credit-note browser lifecycle | PASS |
| Opportunity follow-up activity | PASS |
| Project/attachment/profitability/timeline order detail | PASS |
| Explicit warehouse selection | PASS |
| Inventory delivery consequence | PASS |
| Finance invoice and credit-note consequences | PASS |
| Sales operational role succeeds | PASS |
| Restricted viewer denied server-side | PASS |
| Arabic RTL / English LTR | PASS |
| Desktop / tablet 768 / mobile 375 | PASS |
| No page-level mobile overflow | PASS |
| No unexpected browser/runtime/resource error | PASS |
| Evidence screenshots | PASS — 8 PNGs |

Trace: `test-artifacts/checkpoint-c-2026-07-28T03-06-05-015Z/`,
20/20 in `Chrome/150.0.7871.24`.

## Checkpoint C2 — canonical Procurement (2026-07-28)

The earlier statement that Procurement was a read-only console tab is
superseded.

| Gate | Result |
|---|---|
| Original Procurement page replaced by canonical workspace | PASS |
| Legacy Procurement renderer retires under canonical authority | PASS |
| 12 required Procurement areas plus reports visible | PASS |
| Request → requisition → RFQ → two quotations → comparison → award | PASS |
| Awarded quotation → PO approval/commitment/confirmation | PASS |
| Quality requirement propagated across the lifecycle | PASS |
| Canonical Inventory receipt and quality consequence | PASS |
| Clean three-way match and mismatch worklist | PASS |
| Canonical Finance supplier bill consequence | PASS |
| Supplier return/debit-note consequence | PASS |
| Supplier score and reports | PASS |
| Procurement operational role succeeds | PASS |
| Restricted viewer denied server-side | PASS |
| Arabic RTL / English LTR | PASS |
| Desktop / tablet 768 / mobile 375 | PASS |
| No page-level mobile overflow | PASS |
| No unexpected browser/runtime/resource error | PASS |
| Evidence screenshots | PASS — 12 PNGs |

Final combined C1+C2 trace:
`test-artifacts/checkpoint-c-2026-07-28T03-06-05-015Z/`, 42/42 in
`Chrome/150.0.7871.24`.

## Checkpoint C3 — canonical POS (2026-07-28)

The earlier statement that POS had no canonical lifecycle workflow is
superseded.

| Gate | Result |
|---|---|
| Original POS page replaced by canonical workspace | PASS |
| Legacy POS/deepening route ownership retired | PASS |
| 10 required POS areas visible | PASS |
| Terminal configuration creates a canonical Finance cashbox | PASS |
| Session opening creates a canonical Finance cash shift | PASS |
| Catalogue, search, barcode foundation, and warehouse availability | PASS |
| Split cash/card sale and fiscal receipt | PASS |
| Tax, discount, payment, and receipt totals persisted | PASS |
| Partial refund restores Inventory stock | PASS |
| Refund posts canonical Finance credit-note consequences | PASS |
| Expected/counted/variance reconciliation closes at 100/100/0 | PASS |
| Audit/outbox consequences visible | PASS |
| POS operational role opens, sells, and reconciles | PASS |
| Restricted viewer denied server-side | PASS |
| Arabic RTL / English LTR | PASS |
| Desktop / tablet 768 / mobile 375 | PASS |
| No page-level mobile overflow | PASS |
| No unexpected browser/runtime/resource error | PASS |
| Evidence screenshots | PASS — 12 PNGs |

Final combined C1+C2+C3 trace:
`test-artifacts/checkpoint-c-2026-07-28T03-51-11-913Z/`, 58/58 in
`Chrome/150.0.7871.24`.

## Checkpoint C4 — canonical Work Management (2026-07-28)

| Gate | Result |
|---|---|
| Original Task Manager replaced by canonical workspace | PASS |
| Duplicate Kanban and Workshop TV navigation retired | PASS |
| Nine required operating views visible | PASS |
| Create, assign, subtask and dependency | PASS |
| Five-level importance, watchers and canonical links | PASS |
| Working search, group and sort controls | PASS |
| My Tasks filtered by server-derived user identity | PASS |
| Versioned Kanban drag/drop | PASS |
| Same-record Calendar movement | PASS |
| Dependency/subtask-gated completion | PASS |
| Recurrence, SLA, aging and inactivity behavior | PASS |
| Team workload and completion reports | PASS |
| Workshop TV and mobile views | PASS |
| Workshop operational role succeeds | PASS |
| Restricted viewer denied server-side | PASS |
| Arabic RTL / English LTR | PASS |
| Desktop / tablet 768 / mobile 375 | PASS |
| No page-level mobile overflow | PASS |
| No unexpected browser/runtime/resource error | PASS |
| Evidence screenshots | PASS — 12 PNGs |

Final combined C1+C2+C3+C4 trace:
`test-artifacts/checkpoint-c-2026-07-28T05-26-01-449Z/`, 73/73 in
`Chrome/150.0.7871.24`.

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
