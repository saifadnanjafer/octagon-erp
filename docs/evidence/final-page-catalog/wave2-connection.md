# Octagon ERP — Final Page Catalog · Wave 2 Connection (FP-A foundation)

**Branch:** `build/octagon-final-page-catalog`
**Source SHA:** `237febe23b4192542b4e43e54192c43f88540706`

The single highest-value finding of FP-0 was that Module Expansion Wave 2
shipped 16 business domains with **no visible surface and no runtime
connection**. This document records what was wrong and exactly what was done.

---

## 1. What Wave 2 actually shipped

Migrations `067`–`082` created **130 tables** across 16 domains, plus service
modules and 80 passing unit tests. What it did **not** ship:

| Missing | Consequence |
|---|---|
| `platform_modules` rows | The control plane could not enable, license, or scope any of them. |
| `platform_entities` rows | `platform_actions.entity_id` is a foreign key into that table, so **no action definition could be inserted at all**. |
| `authorization_permissions` rows | No page could be gated by a real permission. |
| Runtime registration | `platform-runtime-bridge.mjs` registered `crm` only. |
| A governed read path | No `/api/v1` route reached any Wave 2 table. |
| Any page | Nothing in the product could display a Wave 2 fact. |

**Net effect: 105 declared actions, 0 executable.**

## 2. Two registration dialects, neither real

Wave 2 shipped two mutually incompatible registration shapes:

```js
// platform/domains/contracts/index.mjs      (contracts, subscriptions, rental)
executor.registerAction('contracts:create', { permission, handler })

// platform/domains/wms/index.mjs            (the other 13)
actionRegistry.register('wms:create-warehouse', async (ctx, params) => …)
```

The kernel (`platform/kernel/actions/index.mjs`) exposes **neither**. Its actual
contract is `actionExecutor.registerHandler(actionId, fn)` plus a
`platform_actions` row — exactly what `platform/domains/crm/index.mjs` does.

Per §81 this is a *nonfunctional primary action*, which may not be deferred. It
was corrected, not recorded.

---

## 3. What was built

| File | Role |
|---|---|
| `platform/domains/wave2-registry.mjs` | One declarative registry: 16 modules, **105 actions**, **130 query resources**, **110 permissions**. Single source of truth for everything downstream. |
| `platform/domains/wave2-actions.mjs` | Seeds `platform_actions` definitions and registers every handler on the real `ActionExecutor`. Replaces both broken dialects. |
| `platform/api/wave2.mjs` | The governed read surface. |
| `database/migrations/083_final_page_catalog_registry.mjs` | Registers 16 modules, 82 entities (bilingual labels), 110 permissions; creates the `platform_pages` registry. |
| `platform-runtime-bridge.mjs` | Calls `registerWave2Actions(actionExecutor)`. |
| `platform/api/index.mjs` | Dispatches the 16 Wave 2 namespaces. |
| `services/canonicalClient.js` | Adds `CanonicalClient.wave2` — one client for all 16. |

### 3.1 The query layer is whitelist-only

Nothing in a Wave 2 read is built from caller input:

| Element | Source |
|---|---|
| table | static registry — never the request |
| columns | `SELECT *` minus `REDACTED_COLUMNS` — never the request |
| filters | only registry-declared columns, always bound as parameters |
| `ORDER BY` | registry, re-validated against a strict identifier pattern |
| company scope | `ctx.companyId`, server-derived from the session cookie |
| row cap | clamped to 500 server-side |

A caller chooses *which declared resource* and *which declared filters*. There
is no path from request text into SQL. Proven by test 13: an undeclared filter
carrying `x' OR '1'='1` is ignored, and the declared filter still applies.

### 3.2 Scope rules

| Rule | Applies to | SQL |
|---|---|---|
| `company` | 118 resources | `WHERE company_id = ?` |
| `parent` | 11 child resources with no `company_id` | `WHERE <fk> IN (SELECT id FROM <parent> WHERE company_id = ?)` |
| `global` | 1 (`iq_governorates`) | no company column by design |

Proven by tests 12 and 15: cross-company rows never appear, including through
parent-scoped children.

### 3.3 Secrets never leave the server

`REDACTED_COLUMNS` nulls `key_hash`, `access_token_hash`, `secret_ref`,
`signature`, `password_hash`, `system_prompt`, `parameters_json` on every row.
Test 14 asserts `api_keys.key_hash` is null while the displayable `key_prefix`
survives.

---

## 4. Modules are `installed`, not `enabled`

Migration 083 registers each module as **`installed`** — its schema exists —
and stops there. Enabling for a company is a control-plane decision, not a
migration decision.

That is why a Wave 2 page can render a real `module_disabled` state instead of
an empty table. Test 22 proves the server refuses `hse:incident_report` with
`MODULE_NOT_ENABLED` and writes nothing.

Three modules (`contracts`, `rental`, `subscriptions`) had placeholder rows from
migration 064 at status `available`; 083 advances them to `installed`
**conditionally** — a module an administrator has already enabled is never
pushed back down.

---

## 5. Defects found and fixed during this work

| # | Defect | Where | Fix |
|---|---|---|---|
| 1 | 105 actions unexecutable — two invented registration APIs | Wave 2, all 16 domains | Registered against the real kernel contract. |
| 2 | Action definitions rejected by a foreign key — no entity rows | Wave 2 | 083 registers 82 entities. |
| 3 | **My own defect:** 083 re-parented two pre-existing canonical entities (`purchase_requisition`, `purchase_requisition_line`, owned by `commercial_procurement`) via `ON CONFLICT DO UPDATE`, and rollback then deleted them, orphaning that module's actions. | 083 | Changed to `ON CONFLICT DO NOTHING`; rollback scoped to Wave 2 module ids only. One entity, one owner. |
| 4 | **My own defect:** entity rows had `label_ar = NULL`, which the entity registry rejects — and is an Arabic-first violation. | 083 | Bilingual labels written for all 82 entities. |
| 5 | **My own defect:** `fields`/`relations` seeded as `'[]'` where the descriptor requires an object. | 083 | Changed to `'{}'`. |
| 6 | Pre-existing: two CRM migration tests pinned migration 066 as the tip and used positional `steps:` rollbacks — broken since Wave 2 landed above them. | `tests/module-wave-1/crm/*` | Re-expressed as ordering assertions and explicit rollback `target`s. |
| 7 | Pre-existing: two Wave 2 tests asserted module status `available`. | `tests/module-wave-2/{rental,subscriptions}` | Updated to `installed`, with the reason recorded inline. |

Defects 3–5 were mine and were caught by the test suite before commit. Defect 3
is the most serious: it would have silently transferred ownership of a canonical
Procurement entity to a Wave 2 module.

---

## 6. Test evidence

`tests/final-page-catalog/wave2-wiring.test.mjs` — **22/22 passing**, entirely
against disposable databases under the OS temp directory.

| # | Proves |
|---|---|
| 1–6 | Registry integrity: every action binds to a real service function; ids unique and kernel-legal; migration and runtime lists agree. |
| 7–8 | 083 registers 16 modules, 110 permissions and `platform_pages`; re-running is idempotent. |
| 9 | Every action gets a `platform_actions` row with the right permission, scope and policies. |
| 10 | A Wave 2 action **executes** and writes a canonical fact with server-derived company scope. |
| 11 | A body-supplied `company_id` is **refused**, and nothing is written. |
| 12 | Governed reads return only the session company's rows. |
| 13 | An undeclared filter carrying SQL is ignored, not injected. |
| 14 | Secret columns are redacted. |
| 15 | Parent-scoped children cannot leak another company's rows. |
| 16–17 | Missing company scope refused; global reference data still readable. |
| 18 | Unknown resource → 404, never a table guess. |
| 19 | `_meta` describes the domain so a page can render a truthful state. |
| 20 | Every namespace exposes a `.view` permission for the router gate. |
| 21 | Row limit clamped to 500. |
| 22 | An installed-but-not-enabled module refuses its actions and writes nothing. |

Full consolidated run (unit + final-page-catalog + Wave 1 + Wave 2):
**128 tests, 128 passing, 0 failing.**

---

## 7. Live proof

Disposable server on port 8137 against a throwaway database
(`scripts/fpc-disposable-server.mjs`, which **refuses to start** if the resolved
path aliases an operational database — verified by attempting
`../octagon-erp/database.db` and being refused).

```
Database Engine: SQLite Active
Phase 02 platform authority initialized
```

Every Wave 2 route is mounted and fail-closed:

| Route | Unauthenticated response |
|---|---|
| `/api/v1/work-items/items` | `401 Login session required` |
| `/api/v1/treasury/bank-accounts` | `401 Login session required` |
| `/api/v1/hse/_meta` | `401 Login session required` |
| `/api/v1/iraq_localization/governorates` | `401 Login session required` |
| `/api/v1/treasury/employees` (undeclared) | `401 Login session required` |

---

## 8. What is NOT yet done

Wave 2 is **connected**, not **surfaced**. The 16 domains now have working
actions, governed queries and control-plane identity, but only three pages exist
so far (the Home & Work group). Building the remaining page families on top of
this foundation is the continuation work — see
`INTEGRATION_AND_HARDENING_READINESS.md`.
