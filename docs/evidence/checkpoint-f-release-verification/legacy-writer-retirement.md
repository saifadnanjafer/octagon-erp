# Checkpoint F — legacy writer retirement and authority conflicts

This is the finding that decides the Checkpoint F classification.

## The three generic legacy writers

`server.js` exposes three routes that write business collections without going
through the ActionExecutor:

| Route | Line (source commit) | Guard |
|---|---|---|
| `POST /api/db` | 1992 | `platform:db:write` + `X-Octagon-Full-Sync: yes` header + fail-closed read-before-write + `HARD_PROTECTED_COLLECTIONS` + canonical-authority check |
| `POST /api/collection` | 2121 | `platform:db:write` + canonical-authority check |
| `POST /api/record` | 2149 | `platform:db:write` + canonical-authority check |

The mechanism is correct. Each route resolves the target collection to a
canonical authority and, if that authority is *enforced*, refuses the write:

- `POST /api/collection` / `POST /api/record` → **403** `<DOMAIN>_CANONICAL_AUTHORITY_REQUIRED`
- `POST /api/db` → **409** on any governed path whose value differs byte-for-byte

It fails closed, it logs to `server-write-guard.log`, and it names the canonical
replacement (`POST /api/v1/action/:actionId`). Nothing about the design is
wrong.

## What is actually enforced

`canonicalAuthorityEnforced()`:

```js
return authority?.domain === 'FINANCE'
  || legacyWriterRetirement?.enforced(authority?.domain) === true;
```

and `enforced()` requires **both** the `phase04.canonical_cutover` feature flag
**and** a matching `authority_retirement_locks` row with `status='RETIRED'`.

Probed on a disposable fresh install:

```
FLAG phase04.canonical_cutover = [{"key":"phase04.canonical_cutover","enabled":0}]
LOCKS = []
```

Guard status, all six Phase 04 domains:

```
COMMERCIAL   { cutoverEnabled: false, lock: null, enforced: false }
INVENTORY    { cutoverEnabled: false, lock: null, enforced: false }
SALES        { cutoverEnabled: false, lock: null, enforced: false }
PROCUREMENT  { cutoverEnabled: false, lock: null, enforced: false }
POS          { cutoverEnabled: false, lock: null, enforced: false }
WORK_ITEM    { cutoverEnabled: false, lock: null, enforced: false }
```

**Conclusion:** on a fresh install, exactly one domain — FINANCE — has no
competing writer. For COMMERCIAL, INVENTORY, SALES, PROCUREMENT, POS and
WORK_ITEM the legacy writers are live, and a client holding `platform:db:write`
can still write `customers`, `suppliers`, `materials`, `quants`, `stock_moves`,
`salesOrders`, `purchaseOrders`, `posOrders` and `tasks` directly, bypassing the
ActionExecutor, its audit trail and its outbox.

This is an **owner-gated operational cutover**, not a code defect — the design
deliberately withholds enforcement "until disposable migration, parity, and
browser evidence pass". But it means the release-architecture requirement *"no
competing writer for delivered canonical facts"* is **not met** for 12 of 13
business domains.

## The Checkpoint D/E gap — found and remediated

Worse than un-enforced: the seven Checkpoint D/E domains were **absent from the
strangler entirely**.

At the source commit `CANONICAL_AUTHORITY_COLLECTIONS` contained seven domains
(FINANCE, COMMERCIAL, INVENTORY, SALES, PROCUREMENT, POS, WORK_ITEM) and
`PHASE04_RETIREMENT_LOCKS` contained six. Neither mentioned PROJECT,
ENGINEERING, MANUFACTURING, QUALITY, ASSET, MAINTENANCE or FLEET.

Consequences at entry:

1. `canonicalAuthorityForCollection('omni.workOrders')` returned `null`, so the
   legacy routes applied **no** canonical-authority check to manufacturing work
   orders, BOMs, routings, assets, fleet, maintenance, quality or projects.
2. `enforced('MANUFACTURING')` returned `false` for an *unknown domain* and
   always would have — there was no lock definition, so those domains could
   never have been retired even after the owner ran the cutover.

Legacy collections confirmed to exist in the shipped client:
`omni.workOrders` (24 references), `omni.boms` (7), `omni.fleet` (3),
`omni.projects` (1).

### Remediation applied

**1. Authority map extracted and extended.**
`platform/cutover/canonical-authority-map.js` (new, CommonJS to match
`server.js`). The table previously lived inline inside the `server.js` request
handler, which is precisely why its coverage was never asserted — it could not
be imported. `server.js` now requires it; the array, the matchers and the lookup
are unchanged for the original seven domains.

Seven domains added:

| Domain | Legacy paths now claimed |
|---|---|
| PROJECT | `projects`, `omni.projects`, `omni.projectTasks`, `omni.projectPhases` |
| ENGINEERING | `boms`, `omni.boms`, `routings`, `omni.routings`, `omni.workCenters` |
| MANUFACTURING | `productionOrders`, `omni.productionOrders`, `workOrders`, `omni.workOrders` |
| QUALITY | `qualityChecks`, `omni.quality`, `omni.qualityChecks`, `omni.ncrs` |
| ASSET | `assets`, `omni.assets`, `omni.assetCategories`, `omni.depreciation` |
| MAINTENANCE | `maintenance`, `omni.maintenance`, `omni.maintenanceOrders`, `omni.maintenanceRequests` |
| FLEET | `fleet`, `omni.fleet`, `vehicles`, `omni.vehicles`, `omni.trips` |

**2. Retirement locks declared.**
`CHECKPOINT_DE_RETIREMENT_LOCKS` added to
`platform/cutover/legacy-writer-retirement.mjs`, and the guard now reads a
merged `RETIREMENT_LOCKS` map so all 13 non-finance domains are lockable and
appear in `status()` for release health. `PHASE04_RETIREMENT_LOCKS` is retained
as a separate export because Phase 04 tests assert against it exactly.

**3. Coverage made permanent.**
`tests/checkpoint-f/canonical_authority_coverage.test.mjs` fails if a registered
business module has no authority domain, or an authority domain has no
retirement lock. A future domain cannot repeat this omission silently.

### What the remediation does and does not change

It is **inert at runtime**. `enforced()` still requires the flag and a RETIRED
lock, neither of which exists. No legacy write that succeeded before now fails.
Verified by re-running Checkpoint C (100/100), Phase 04 (47/47), Phase 04
finalization (100/100) and Checkpoint D/E (56/56) after the change — no
regression.

What it changes is that the seven D/E domains are now **claimable and
retirable**. Before, they were invisible to the cutover machinery.

## Frozen zone

`omni.jobOrders` is deliberately **not** claimed by MANUFACTURING: it is the
workshop execution chain, a different authority from MRP work orders, and is
already protected by `HARD_PROTECTED_COLLECTIONS`. `employees`, payroll,
attendance and timesheet paths are claimed by no authority. Asserted by
`no canonical authority claims a frozen-zone path`.

## Classification of every legacy writer

| Writer | Classification |
|---|---|
| `POST /api/db` (full sync) | **Canonical-guarded, partially active** — refuses FINANCE mutations; refuses emptying any `HARD_PROTECTED_COLLECTIONS` path; otherwise active |
| `POST /api/collection` | **Canonical-guarded, partially active** — refuses FINANCE; active for all other domains until cutover |
| `POST /api/record` | **Canonical-guarded, partially active** — same |
| `GET /api/db` | **Read-only compatibility surface** — permitted to remain |
| `POST /api/upload`, `/api/operation-lock/*`, `/api/backup*`, `/api/restore*` | **Not business-fact writers** — out of scope for retirement |
| Payroll / attendance / timesheet writers | **Frozen-zone exception** — explicitly out of scope, unchanged |

No writer was deleted. No unrelated legacy page was removed. Rollback and
provenance are preserved: the remediation is additive and reversible by
reverting two files.

## Remaining blocker

Completing retirement requires the owner to run the cutover
(`phase04.canonical_cutover` + RETIRED locks per domain) after disposable
migration and parity evidence. That is an owner decision with production
consequences and is **not** something this checkpoint may perform. It is the
principal reason Checkpoint F classifies as **PARTIAL — REMEDIATION REQUIRED**.
