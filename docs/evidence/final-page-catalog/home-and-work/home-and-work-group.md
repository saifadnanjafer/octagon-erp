# FP-1 — Home & Work page group

**Branch:** `build/octagon-final-page-catalog`
**Navigation group:** `home_work` — «الرئيسية والأعمال» / "Home & Work", domain `core`

Three pages, each meeting the §4 completion standard. Nothing here is a shell:
every one reads governed facts, and every one renders an explicit state rather
than an empty table.

---

## Pages

| Page ID | Arabic | English | Section | View | Controller | Permission |
|---|---|---|---|---|---|---|
| `enterprise_home` | مساحة العمل | Enterprise Home | `pageEnterpriseHome` | `views/enterprise_home.html` | `modules/fpc-enterprise-home.js` | any authenticated role |
| `my_work` | أعمالي | My Work | `pageMyWork` | `views/my_work.html` | `modules/fpc-my-work.js` | any authenticated role |
| `unified_inbox` | صندوق الوارد والاعتمادات | Unified Inbox & Approval Center | `pageUnifiedInbox` | `views/unified_inbox.html` | `modules/fpc-unified-inbox.js` | `workshop.manager`, `finance.manager`, `system.admin` |

An empty permission list means "any authenticated role may open the page" — the
rows behind it are still scoped server-side to the acting user and company. It
does not mean unauthenticated access: `switchPage` still requires a session, and
every governed query is gated independently.

## Authority per page

| Page | Query authority | Mutation authority |
|---|---|---|
| `enterprise_home` | canonical Work Items, platform bootstrap, control-plane module list | **none** — navigation only |
| `my_work` | canonical Work Items | `work_item:transition`, `work_item:complete` via ActionExecutor |
| `unified_inbox` | approval engine, notifications, CRM activities, outbox | `approval:decide` via ActionExecutor |

No page in this group writes through `/api/db`, `PentagonDB.mutate`, or
`saveData()`. Asserted by the regression suite.

## Consolidation

`unified_inbox` is the canonical approval surface. `approvals` and
`manager_approvals` remain as **route aliases** — `switchPage('approvals')`
resolves here — until their call sites are migrated. Retirement condition is
recorded in `page-consolidation-register.md` §B1. Neither old page was deleted.

## Bulk approval is deliberately absent

§11 forbids bulk approval where maker-checker or individual review is required.
There is no per-queue policy flag today that could prove a queue is exempt, so
one decision = one click. Recorded in `DEFERRED_INTEGRATION_AND_HARDENING.md`.

---

## Browser evidence

Real Chromium against a disposable database on port 8137. The launcher
(`scripts/fpc-disposable-server.mjs`) refuses to start if the resolved database
path aliases an operational one — verified:

```
$ node scripts/fpc-disposable-server.mjs --db "../octagon-erp/database.db"
REFUSED: the requested database aliases an operational path.
  resolves  : C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\octagon-erp\database.db
```

Server state:

```
Database Engine: SQLite Active
Phase 02 platform authority initialized
```

### Page activation (RTL desktop, unauthenticated session)

| Page | `.page-active` | nav highlighted | Title rendered | KPI cards | KPIs shown unavailable | Fake zeros | State |
|---|---|---|---|---|---|---|---|
| `enterprise_home` | yes | yes | صباح الخير | 4 | **4** | **0** | `permission_denied` |
| `my_work` | yes | yes | أعمالي | 0 | 0 | **0** | `permission_denied` |
| `unified_inbox` | yes | yes | صندوق الوارد ومركز الاعتمادات | 1 | **1** | **0** | `permission_denied` |

This is the important result. With no session, every governed query returns
`401`. The pages classify that as **`permission_denied`** and render every KPI
as "غير متاح / Not available". **Zero KPIs rendered a value**, so there is no
green zero standing in for an unknown — the exact defect §74 forbids.

### API fail-closed proof

| Route | Unauthenticated |
|---|---|
| `/api/v1/work-items/items` | `401 Login session required` |
| `/api/v1/treasury/bank-accounts` | `401 Login session required` |
| `/api/v1/hse/_meta` | `401 Login session required` |
| `/api/v1/iraq_localization/governorates` | `401 Login session required` |

### Arabic RTL / English LTR

| Direction | Title | First tab | Body overflow-x | Grid scroll container | Header align |
|---|---|---|---|---|---|
| `rtl` / `ar` | صندوق الوارد ومركز الاعتمادات | بانتظار اعتمادي | none | `overflow-x: auto` | `start` |
| `ltr` / `en` | Unified Inbox & Approval Center | Awaiting my approval | none | `overflow-x: auto` | `start` |

Every identifier, code and number is wrapped in U+2068 / U+2069 directional
isolates, so an invoice number cannot be reordered by the bidi algorithm inside
Arabic text.

### Mobile — 375 × 812

| Page | Page overflow-x | Tab height | Action button height | KPI columns |
|---|---|---|---|---|
| `enterprise_home` | **none** | — | 42px | 1 |
| `my_work` | **none** | 42px | 42px | — |
| `unified_inbox` | **none** | 42px | 42px | 1 |

No page scrolls horizontally; wide tables scroll inside their own container.
Touch targets reach 42px.

### Console

No error originating from this wave's code. The messages present are the
unauthenticated `401`/`503` responses (expected for this fixture) and the
pre-existing `[saveData] BLOCKED — refusing to persist an empty employees array`
guard, which is the employee-wipe protection working correctly on a fresh
database.

---

## Not proven here (deferred)

- Populated state with real rows — requires an authenticated session; the
  administrator credential was deliberately not used (§2).
- Mutation round-trip (`work_item:complete`, `approval:decide`) against a live
  server. Server-side refusal behaviour **is** proven by
  `wave2-wiring.test.mjs` tests 11 and 22.
- Screenshots: the Browser pane was not compositing during this run, so image
  capture timed out. DOM-level assertions above are the substitute evidence.

All three are recorded in `DEFERRED_INTEGRATION_AND_HARDENING.md`.
